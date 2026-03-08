package main

import (
	"compress/gzip"
	"encoding/json"
	"io"
	"log"
	"math"
	"net/http"
	"sync"

	"github.com/BrianLeishman/karttrackpark.com/go/dynamo"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type sectorResult struct {
	LapNo   int     `json:"lap_no"`
	UID     string  `json:"uid"`
	Sectors []int64 `json:"sectors"`
}

type gpsPoint struct {
	TcMs int64   `json:"tc_ms"`
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
}

type telemetryData struct {
	GPS []gpsPoint `json:"gps"`
}

type geojsonFeature struct {
	Geometry struct {
		Coordinates [][]float64 `json:"coordinates"`
	} `json:"geometry"`
}

// haversine returns the distance in meters between two lat/lon points.
func haversine(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadius = 6371000.0 // meters
	dLat := (lat2 - lat1) * math.Pi / 180.0
	dLon := (lon2 - lon1) * math.Pi / 180.0
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180.0)*math.Cos(lat2*math.Pi/180.0)*
			math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return earthRadius * c
}

// interpolatePoint returns a lat/lon that is fraction t (0..1) between p1 and p2.
func interpolatePoint(lat1, lon1, lat2, lon2, t float64) (float64, float64) {
	return lat1 + t*(lat2-lat1), lon1 + t*(lon2-lon1)
}

// findSectorBoundaries walks the outline coordinates and returns the lat/lon
// at 1/3 and 2/3 of the total haversine distance.
func findSectorBoundaries(coords [][]float64) (lat1, lon1, lat2, lon2 float64) {
	if len(coords) < 2 {
		return
	}

	// Compute cumulative distances.
	cumDist := make([]float64, len(coords))
	for i := 1; i < len(coords); i++ {
		// GeoJSON coordinates are [lon, lat]
		d := haversine(coords[i-1][1], coords[i-1][0], coords[i][1], coords[i][0])
		cumDist[i] = cumDist[i-1] + d
	}

	totalDist := cumDist[len(cumDist)-1]
	oneThird := totalDist / 3.0
	twoThird := 2.0 * totalDist / 3.0

	var found1, found2 bool
	for i := 1; i < len(coords); i++ {
		if !found1 && cumDist[i] >= oneThird {
			segLen := cumDist[i] - cumDist[i-1]
			if segLen > 0 {
				t := (oneThird - cumDist[i-1]) / segLen
				lat1, lon1 = interpolatePoint(coords[i-1][1], coords[i-1][0], coords[i][1], coords[i][0], t)
			} else {
				lat1, lon1 = coords[i][1], coords[i][0]
			}
			found1 = true
		}
		if !found2 && cumDist[i] >= twoThird {
			segLen := cumDist[i] - cumDist[i-1]
			if segLen > 0 {
				t := (twoThird - cumDist[i-1]) / segLen
				lat2, lon2 = interpolatePoint(coords[i-1][1], coords[i-1][0], coords[i][1], coords[i][0], t)
			} else {
				lat2, lon2 = coords[i][1], coords[i][0]
			}
			found2 = true
		}
		if found1 && found2 {
			break
		}
	}

	return
}

// findClosestPointTime finds the GPS point closest to the given lat/lon and returns its tc_ms.
func findClosestPointTime(gps []gpsPoint, lat, lon float64) int64 {
	bestDist := math.MaxFloat64
	var bestTc int64
	for _, p := range gps {
		d := haversine(p.Lat, p.Lon, lat, lon)
		if d < bestDist {
			bestDist = d
			bestTc = p.TcMs
		}
	}
	return bestTc
}

func handleGetSectors(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")

	session, err := dynamo.GetSession(r.Context(), sessionID)
	if err != nil {
		log.Printf("get session error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if session == nil {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}

	if session.LayoutID == "" {
		writeJSON(w, http.StatusOK, []sectorResult{})
		return
	}

	layout, err := dynamo.GetLayout(r.Context(), session.TrackID, session.LayoutID)
	if err != nil {
		log.Printf("get layout error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if layout == nil || layout.TrackOutline == "" {
		writeJSON(w, http.StatusOK, []sectorResult{})
		return
	}

	// Parse GeoJSON feature to extract coordinates.
	var feature geojsonFeature
	if err := json.Unmarshal([]byte(layout.TrackOutline), &feature); err != nil {
		log.Printf("parse track outline error: %v", err)
		writeError(w, http.StatusInternalServerError, "invalid track outline")
		return
	}
	coords := feature.Geometry.Coordinates
	if len(coords) < 2 {
		writeJSON(w, http.StatusOK, []sectorResult{})
		return
	}

	bLat1, bLon1, bLat2, bLon2 := findSectorBoundaries(coords)

	laps, err := dynamo.ListLapsForSession(r.Context(), sessionID)
	if err != nil {
		log.Printf("list laps error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Filter to laps with telemetry.
	type lapWithTelemetry struct {
		lap dynamo.Lap
		gps []gpsPoint
	}

	var mu sync.Mutex
	var wg sync.WaitGroup
	results := make([]lapWithTelemetry, 0, len(laps))

	client, err := s3Client()
	if err != nil {
		log.Printf("s3 client error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	sem := make(chan struct{}, 10) // limit concurrent S3 fetches
	for _, lap := range laps {
		if lap.TelemetryKey == "" {
			continue
		}
		wg.Add(1)
		go func(l dynamo.Lap) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			out, err := client.GetObject(r.Context(), &s3.GetObjectInput{
				Bucket: aws.String(uploadBucket),
				Key:    aws.String(l.TelemetryKey),
			})
			if err != nil {
				log.Printf("s3 get %s error: %v", l.TelemetryKey, err)
				return
			}
			defer out.Body.Close()

			gz, err := gzip.NewReader(out.Body)
			if err != nil {
				log.Printf("gzip reader for %s error: %v", l.TelemetryKey, err)
				return
			}
			defer gz.Close()

			raw, err := io.ReadAll(gz)
			if err != nil {
				log.Printf("read telemetry %s error: %v", l.TelemetryKey, err)
				return
			}

			var td telemetryData
			if err := json.Unmarshal(raw, &td); err != nil {
				log.Printf("parse telemetry %s error: %v", l.TelemetryKey, err)
				return
			}

			if len(td.GPS) == 0 {
				return
			}

			mu.Lock()
			results = append(results, lapWithTelemetry{lap: l, gps: td.GPS})
			mu.Unlock()
		}(lap)
	}
	wg.Wait()

	// Compute sector times for each lap.
	sectors := make([]sectorResult, 0, len(results))
	for _, r := range results {
		b1Tc := findClosestPointTime(r.gps, bLat1, bLon1)
		b2Tc := findClosestPointTime(r.gps, bLat2, bLon2)

		s1 := b1Tc
		s2 := b2Tc - b1Tc
		s3 := r.lap.LapTimeMs - b2Tc

		sectors = append(sectors, sectorResult{
			LapNo:   r.lap.LapNo,
			UID:     r.lap.UID,
			Sectors: []int64{s1, s2, s3},
		})
	}

	writeJSON(w, http.StatusOK, sectors)
}
