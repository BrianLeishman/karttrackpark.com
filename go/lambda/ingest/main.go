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
	"net/http"
	"os"
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
	if os.Getenv("AWS_LAMBDA_FUNCTION_NAME") != "" {
		lambda.Start(handler)
	} else {
		// Local mode: POST /ingest {bucket, key}
		http.HandleFunc("POST /ingest", func(w http.ResponseWriter, r *http.Request) {
			var req struct {
				Bucket string `json:"bucket"`
				Key    string `json:"key"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if req.Bucket == "" {
				req.Bucket = bucket
			}
			log.Printf("Processing s3://%s/%s", req.Bucket, req.Key)
			if err := processUpload(r.Context(), req.Bucket, req.Key); err != nil {
				log.Printf("ERROR: %v", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusOK)
			fmt.Fprintln(w, "ok")
		})
		log.Println("Ingest server listening on :25567")
		log.Fatal(http.ListenAndServe(":25567", nil))
	}
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

type lapTelemetry struct {
	UploadID   string                  `json:"upload_id"`
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

// filterIncompleteLaps removes partial laps (first/last) that are significantly
// shorter than the median. With fewer than 3 laps, no filtering is applied.
func filterIncompleteLaps(laps []xrk.Lap) []xrk.Lap {
	if len(laps) < 3 {
		return laps
	}

	// Compute median duration
	durations := make([]uint32, len(laps))
	for i, l := range laps {
		durations[i] = l.DurationMs
	}
	sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
	median := durations[len(durations)/2]

	// Keep laps that are at least 50% of the median
	threshold := median / 2
	var filtered []xrk.Lap
	for _, l := range laps {
		if l.DurationMs >= threshold {
			filtered = append(filtered, l)
		} else {
			log.Printf("  Dropping incomplete lap %d: %dms (median: %dms)", l.Number, l.DurationMs, median)
		}
	}
	return filtered
}

// parseSessionTime tries common AIM Solo date/time formats and returns a UTC time.
func parseSessionTime(date, timeStr string) (time.Time, error) {
	combined := strings.TrimSpace(date) + " " + strings.TrimSpace(timeStr)
	formats := []string{
		"01/02/06 15:04:05",
		"01/02/2006 15:04:05",
		"02/01/06 15:04:05",
		"02/01/2006 15:04:05",
		"2006-01-02 15:04:05",
		"01/02/06 3:04:05 PM",
		"01/02/2006 3:04:05 PM",
	}
	for _, f := range formats {
		if t, err := time.Parse(f, combined); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("no matching format for %q", combined)
}

// extractUploadID pulls upload ID from key format: raw/uploads/{uploadId}/{filename}
func extractUploadID(key string) (string, error) {
	parts := strings.Split(key, "/")
	if len(parts) < 4 {
		return "", fmt.Errorf("unexpected key format: %s", key)
	}
	return parts[2], nil
}

func processUpload(ctx context.Context, bkt, key string) error {
	uploadID, err := extractUploadID(key)
	if err != nil {
		return err
	}

	upload, err := dynamo.GetUpload(ctx, uploadID)
	if err != nil {
		return fmt.Errorf("get upload: %w", err)
	}
	if upload == nil {
		return fmt.Errorf("upload %s not found", uploadID)
	}

	if err := dynamo.UpdateUpload(ctx, uploadID, map[string]any{
		"status": "processing",
	}); err != nil {
		return fmt.Errorf("set processing: %w", err)
	}

	if err := doIngest(ctx, bkt, key, upload); err != nil {
		_ = dynamo.UpdateUpload(ctx, uploadID, map[string]any{
			"status": "error",
			"error":  err.Error(),
		})
		return err
	}
	return nil
}

func doIngest(ctx context.Context, bkt, key string, upload *dynamo.Upload) error {
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

	// Gravity compensation: find a stationary window (GPS speed < 2 mph)
	// and subtract the mean accelerometer offset (which is the gravity component
	// due to mounting angle). Fallback: use the full-session mean if no
	// stationary period found.
	accelChannels := map[string]bool{"InlA": true, "LatA": true, "VrtA": true}
	if len(gpsRows) > 0 {
		// Find best stationary window: at least 0.5s of low-speed data
		type window struct{ startMs, endMs int32 }
		var stationaryWindows []window
		var wStart int32 = -1
		for _, gp := range gpsRows {
			if gp.SpeedMph < 2.0 {
				if wStart < 0 {
					wStart = gp.TimeMs
				}
			} else {
				if wStart >= 0 && gp.TimeMs-wStart >= 500 {
					stationaryWindows = append(stationaryWindows, window{wStart, gp.TimeMs})
				}
				wStart = -1
			}
		}
		if wStart >= 0 {
			lastTC := gpsRows[len(gpsRows)-1].TimeMs
			if lastTC-wStart >= 500 {
				stationaryWindows = append(stationaryWindows, window{wStart, lastTC})
			}
		}

		for si := range sensors {
			if !accelChannels[sensors[si].name] {
				continue
			}

			var offset float64
			var count int

			if len(stationaryWindows) > 0 {
				// Use stationary period mean
				for _, w := range stationaryWindows {
					for _, tv := range sensors[si].data {
						if tv.TimeMs >= w.startMs && tv.TimeMs <= w.endMs {
							offset += tv.Value
							count++
						}
					}
				}
			}

			// Fallback: use full-session mean
			if count < 10 {
				offset = 0
				count = 0
				for _, tv := range sensors[si].data {
					offset += tv.Value
					count++
				}
			}

			if count > 0 {
				mean := offset / float64(count)
				log.Printf("  Gravity offset for %s: %.4f G (%d samples)", sensors[si].name, mean, count)
				for j := range sensors[si].data {
					sensors[si].data[j].Value -= mean
				}
			}
		}
	}

	// Compute GPS-derived acceleration channels from ECEF velocity vectors.
	// These are gravity-free and match Race Studio's "GPS LonAcc" / "GPS LatAcc".
	if len(result.GPS) > 2 {
		sorted := make([]xrk.GPSRecord, len(result.GPS))
		copy(sorted, result.GPS)
		sort.Slice(sorted, func(i, j int) bool { return sorted[i].TC < sorted[j].TC })

		const g = 9.80665 // m/s²
		var gpsLonAcc []xrk.TVPair
		var gpsLatAcc []xrk.TVPair

		for i := 1; i < len(sorted)-1; i++ {
			prev := sorted[i-1]
			next := sorted[i+1]
			dt := float64(next.TC-prev.TC) / 1000.0
			if dt <= 0 {
				continue
			}

			// Current velocity vector (cm/s → m/s)
			vx := float64(sorted[i].EcefVX) / 100.0
			vy := float64(sorted[i].EcefVY) / 100.0
			vz := float64(sorted[i].EcefVZ) / 100.0
			speed := math.Sqrt(vx*vx + vy*vy + vz*vz)

			// Acceleration vector from central difference (m/s²)
			ax := (float64(next.EcefVX) - float64(prev.EcefVX)) / 100.0 / dt
			ay := (float64(next.EcefVY) - float64(prev.EcefVY)) / 100.0 / dt
			az := (float64(next.EcefVZ) - float64(prev.EcefVZ)) / 100.0 / dt

			tc := sorted[i].TC

			if speed < 0.5 { // nearly stationary
				gpsLonAcc = append(gpsLonAcc, xrk.TVPair{TimeMs: tc, Value: 0})
				gpsLatAcc = append(gpsLatAcc, xrk.TVPair{TimeMs: tc, Value: 0})
				continue
			}

			// Unit velocity vector (heading direction)
			ux, uy, uz := vx/speed, vy/speed, vz/speed

			// Longitudinal accel = projection of accel onto velocity direction
			dot := ax*ux + ay*uy + az*uz
			lonG := dot / g
			perpX := ax - dot*ux
			perpY := ay - dot*uy
			perpZ := az - dot*uz
			latG := math.Sqrt(perpX*perpX+perpY*perpY+perpZ*perpZ) / g

			// Sign lateral: use cross product to determine left/right
			// Cross velocity × accel, check if it points "up" (positive) or "down" (negative)
			crossZ := vx*perpY - vy*perpX
			if crossZ < 0 {
				latG = -latG
			}

			gpsLonAcc = append(gpsLonAcc, xrk.TVPair{TimeMs: tc, Value: math.Round(lonG*1000) / 1000})
			gpsLatAcc = append(gpsLatAcc, xrk.TVPair{TimeMs: tc, Value: math.Round(latG*1000) / 1000})
		}

		if len(gpsLonAcc) > 0 {
			sensors = append(sensors, sensorData{name: "GLnA", data: gpsLonAcc})
		}
		if len(gpsLatAcc) > 0 {
			sensors = append(sensors, sensorData{name: "GLtA", data: gpsLatAcc})
		}
	}

	// Extract metadata
	metadata := make(map[string]string)
	if result.Metadata != nil {
		for k, v := range result.Metadata {
			metadata[k] = v
		}
	}

	// Parse session start time from XRK metadata
	// AIM Solo records local time — store as RFC3339 UTC (display as UTC on frontend)
	var sessionTime string
	if d, t := metadata["date"], metadata["time"]; d != "" && t != "" {
		if parsed, err := parseSessionTime(d, t); err == nil {
			sessionTime = parsed.UTC().Format(time.RFC3339)
		} else {
			log.Printf("  Could not parse session time %q %q: %v", d, t, err)
		}
	}

	// Delete any existing laps for this user in this session (re-upload scenario)
	if upload.SessionID != "" {
		deleted, err := dynamo.DeleteLapsForUser(ctx, upload.SessionID, upload.UID)
		if err != nil {
			return fmt.Errorf("delete old laps: %w", err)
		}
		if deleted > 0 {
			log.Printf("  Deleted %d old laps for user %s in session %s", deleted, upload.UID, upload.SessionID)
		}
	}

	// Filter incomplete laps: drop any lap shorter than 50% of the median
	fullLaps := filterIncompleteLaps(result.Laps)

	var bestLapMs int64
	var totalTimeMs int64
	var uploadLaps []dynamo.UploadLap

	for lapIdx, lap := range fullLaps {
		startTC := int32(lap.EndTimeMs - lap.DurationMs)
		endTC := int32(lap.EndTimeMs)

		var lapGPS []xrk.GPSRow
		for _, gp := range gpsRows {
			if gp.TimeMs >= startTC && gp.TimeMs <= endTC {
				lapGPS = append(lapGPS, gp)
			}
		}
		if len(lapGPS) == 0 {
			continue
		}

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

		maxSpeed := 0.0
		for _, gp := range lapGPS {
			if gp.SpeedMph > maxSpeed {
				maxSpeed = gp.SpeedMph
			}
		}
		maxLatG := 0.0
		if latData, ok := lapSensors["GLtA"]; ok {
			for _, tv := range latData {
				if av := math.Abs(tv.Value); av > maxLatG {
					maxLatG = av
				}
			}
		}
		distFt := lapGPS[len(lapGPS)-1].DistFt - baseDist

		lapNo := lapIdx + 1 // Sequential numbering after filtering out incomplete laps
		telem := lapTelemetry{
			UploadID:   upload.UploadID,
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
		telemKey := fmt.Sprintf("telemetry/%s/lap-%d.json", upload.UploadID, lapNo)
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

		ms := int64(lap.DurationMs)
		totalTimeMs += ms
		if bestLapMs == 0 || ms < bestLapMs {
			bestLapMs = ms
		}
		uploadLaps = append(uploadLaps, dynamo.UploadLap{
			LapNo:     lapNo,
			LapTimeMs: ms,
			MaxSpeed:  math.Round(maxSpeed*10) / 10,
		})

		log.Printf("  Lap %d: %dms, %.1f mph max, %.0f ft", lapNo, lap.DurationMs, maxSpeed, distFt)
	}

	fields := map[string]any{
		"status":      "complete",
		"lapCount":    len(uploadLaps),
		"bestLapMs":   bestLapMs,
		"totalTimeMs": totalTimeMs,
		"laps":        uploadLaps,
		"metadata":    metadata,
	}
	if sessionTime != "" {
		fields["sessionTime"] = sessionTime
	}
	return dynamo.UpdateUpload(ctx, upload.UploadID, fields)
}
