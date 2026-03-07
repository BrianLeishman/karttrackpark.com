package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/BrianLeishman/karttrackpark.com/go/dynamo"
	"github.com/BrianLeishman/karttrackpark.com/go/xrk"
)

const bucket = "ktp-raw-uploads"

var s3c *s3.Client

func init() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		log.Fatalf("load aws config: %v", err)
	}
	s3c = s3.NewFromConfig(cfg)
}

func main() {
	lambda.Start(handler)
}

func handler(ctx context.Context, event events.S3Event) error {
	for _, rec := range event.Records {
		key := rec.S3.Object.Key
		bkt := rec.S3.Bucket.Name
		log.Printf("Processing s3://%s/%s", bkt, key)
		if err := processUpload(ctx, bkt, key); err != nil {
			log.Printf("ERROR processing %s: %v", key, err)
		}
	}
	return nil
}

// extractSessionID pulls the session ID from key format: raw/{trackId}/{sessionId}/{uploadId}/{filename}
func extractSessionID(key string) (string, error) {
	parts := strings.Split(key, "/")
	if len(parts) < 4 {
		return "", fmt.Errorf("unexpected key format: %s", key)
	}
	return parts[2], nil
}

type lapTelemetry struct {
	SessionID  string                  `json:"session_id"`
	LapNo      int                     `json:"lap_no"`
	DurationMs uint32                  `json:"duration_ms"`
	GPS        []xrk.GPSRow            `json:"gps"`
	Sensors    map[string][]xrk.TVPair `json:"sensors"`
	Summary    lapSummary              `json:"summary"`
}

type lapSummary struct {
	MaxSpeedMph float64 `json:"max_speed_mph"`
	MaxLatG     float64 `json:"max_lat_g"`
	DistFt      float64 `json:"dist_ft"`
}

func processUpload(ctx context.Context, bkt, key string) error {
	sessionID, err := extractSessionID(key)
	if err != nil {
		return err
	}

	session, err := dynamo.GetSession(ctx, sessionID)
	if err != nil {
		return fmt.Errorf("get session: %w", err)
	}
	if session == nil {
		return fmt.Errorf("session %s not found", sessionID)
	}

	if err := dynamo.UpdateSession(ctx, sessionID, map[string]any{
		"ingestStatus": "processing",
	}); err != nil {
		return fmt.Errorf("set processing: %w", err)
	}

	if err := doIngest(ctx, bkt, key, session); err != nil {
		_ = dynamo.UpdateSession(ctx, sessionID, map[string]any{
			"ingestStatus": "error",
			"ingestError":  err.Error(),
		})
		return err
	}
	return nil
}

func doIngest(ctx context.Context, bkt, key string, session *dynamo.Session) error {
	out, err := s3c.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(bkt),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("s3 get: %w", err)
	}
	defer out.Body.Close()

	data, err := io.ReadAll(out.Body)
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}

	result, err := xrk.Parse(data)
	if err != nil {
		return fmt.Errorf("parse xrk: %w", err)
	}

	gpsRows := xrk.BuildGPSRows(result.GPS)

	// Decode sensor channels
	type sensorData struct {
		name string
		data []xrk.TVPair
	}
	var sensors []sensorData
	var chIndices []uint16
	for idx := range result.Channels {
		chIndices = append(chIndices, idx)
	}
	sort.Slice(chIndices, func(i, j int) bool { return chIndices[i] < chIndices[j] })

	for _, idx := range chIndices {
		ch := result.Channels[idx]
		samples := result.ChannelSamples[idx]
		if len(samples) == 0 || ch.Size > 8 {
			continue
		}
		decoded := xrk.DecodeChannel(samples, ch)
		if len(decoded) > 0 {
			sensors = append(sensors, sensorData{name: ch.ShortName, data: decoded})
		}
	}

	var bestLapMs int64
	lapCount := 0

	for _, lap := range result.Laps {
		startTC := int32(lap.EndTimeMs - lap.DurationMs)
		endTC := int32(lap.EndTimeMs)

		// Slice GPS to lap window
		var lapGPS []xrk.GPSRow
		for _, gp := range gpsRows {
			if gp.TimeMs >= startTC && gp.TimeMs <= endTC {
				lapGPS = append(lapGPS, gp)
			}
		}
		if len(lapGPS) == 0 {
			continue
		}

		// Rebase GPS: relative timecodes and distance
		baseDist := lapGPS[0].DistFt
		baseTC := startTC
		rebasedGPS := make([]xrk.GPSRow, len(lapGPS))
		for i, gp := range lapGPS {
			rebasedGPS[i] = xrk.GPSRow{
				TimeMs:   gp.TimeMs - baseTC,
				Lat:      gp.Lat,
				Lon:      gp.Lon,
				AltM:     gp.AltM,
				SpeedMph: gp.SpeedMph,
				DistFt:   gp.DistFt - baseDist,
			}
		}

		// Slice sensors to lap window
		lapSensors := make(map[string][]xrk.TVPair)
		for _, sc := range sensors {
			var lapData []xrk.TVPair
			for _, tv := range sc.data {
				if tv.TimeMs >= startTC && tv.TimeMs <= endTC {
					lapData = append(lapData, xrk.TVPair{TimeMs: tv.TimeMs - baseTC, Value: tv.Value})
				}
			}
			if len(lapData) > 0 {
				lapSensors[sc.name] = lapData
			}
		}

		// Compute summary stats
		maxSpeed := 0.0
		for _, gp := range lapGPS {
			if gp.SpeedMph > maxSpeed {
				maxSpeed = gp.SpeedMph
			}
		}
		maxLatG := 0.0
		if latData, ok := lapSensors["LatA"]; ok {
			for _, tv := range latData {
				if av := math.Abs(tv.Value); av > maxLatG {
					maxLatG = av
				}
			}
		}
		distFt := lapGPS[len(lapGPS)-1].DistFt - baseDist

		lapNo := int(lap.Number)
		telem := lapTelemetry{
			SessionID:  session.SessionID,
			LapNo:      lapNo,
			DurationMs: lap.DurationMs,
			GPS:        rebasedGPS,
			Sensors:    lapSensors,
			Summary: lapSummary{
				MaxSpeedMph: math.Round(maxSpeed*10) / 10,
				MaxLatG:     math.Round(maxLatG*100) / 100,
				DistFt:      math.Round(distFt),
			},
		}

		// Gzip + upload to S3
		telemKey := fmt.Sprintf("telemetry/%s/lap-%d.json", session.SessionID, lapNo)
		jsonData, err := json.Marshal(telem)
		if err != nil {
			return fmt.Errorf("marshal lap %d telemetry: %w", lapNo, err)
		}
		var buf bytes.Buffer
		gz := gzip.NewWriter(&buf)
		if _, err := gz.Write(jsonData); err != nil {
			return fmt.Errorf("gzip lap %d: %w", lapNo, err)
		}
		gz.Close()

		if _, err := s3c.PutObject(ctx, &s3.PutObjectInput{
			Bucket:          aws.String(bucket),
			Key:             aws.String(telemKey),
			Body:            bytes.NewReader(buf.Bytes()),
			ContentType:     aws.String("application/json"),
			ContentEncoding: aws.String("gzip"),
		}); err != nil {
			return fmt.Errorf("upload lap %d telemetry: %w", lapNo, err)
		}

		// Write lap to DynamoDB
		if err := dynamo.PutLap(ctx, dynamo.Lap{
			SessionID:    session.SessionID,
			LapNo:        lapNo,
			LapTimeMs:    int64(lap.DurationMs),
			MaxSpeed:     math.Round(maxSpeed*10) / 10,
			UID:          session.UID,
			LayoutID:     session.LayoutID,
			TelemetryKey: telemKey,
			CreatedAt:    time.Now().UTC().Format(time.RFC3339),
		}); err != nil {
			return fmt.Errorf("put lap %d: %w", lapNo, err)
		}

		lapCount++
		if bestLapMs == 0 || int64(lap.DurationMs) < bestLapMs {
			bestLapMs = int64(lap.DurationMs)
		}

		log.Printf("  Lap %d: %dms, %.1f mph max, %.0f ft", lapNo, lap.DurationMs, maxSpeed, distFt)
	}

	return dynamo.UpdateSession(ctx, session.SessionID, map[string]any{
		"ingestStatus": "complete",
		"lapCount":     lapCount,
		"bestLapMs":    bestLapMs,
	})
}
