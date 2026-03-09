package main

import (
	"compress/gzip"
	"io"
	"log"
	"net/http"
	"strconv"

	"github.com/BrianLeishman/karttrackpark.com/go/dynamo"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

func handleGetLapTelemetry(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")
	driverUID := r.PathValue("uid")
	lapNoStr := r.PathValue("lapNo")

	lapNo, err := strconv.Atoi(lapNoStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid lap number")
		return
	}

	lap, err := dynamo.GetLap(r.Context(), sessionID, driverUID, lapNo)
	if err != nil {
		log.Printf("get lap error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if lap == nil {
		writeError(w, http.StatusNotFound, "lap not found")
		return
	}
	if lap.TelemetryKey == "" {
		writeError(w, http.StatusNotFound, "no telemetry for this lap")
		return
	}

	client, err := s3Client()
	if err != nil {
		log.Printf("s3 client error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	out, err := client.GetObject(r.Context(), &s3.GetObjectInput{
		Bucket: aws.String(uploadBucket),
		Key:    aws.String(lap.TelemetryKey),
	})
	if err != nil {
		log.Printf("s3 get %s error: %v", lap.TelemetryKey, err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	defer out.Body.Close()

	gz, err := gzip.NewReader(out.Body)
	if err != nil {
		log.Printf("gzip reader error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	defer gz.Close()

	raw, err := io.ReadAll(gz)
	if err != nil {
		log.Printf("read telemetry error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Write(raw)
}
