package main

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/BrianLeishman/karttrackpark.com/go/dynamo"
)

func handleEnrollDriver(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	seriesID := r.PathValue("id")

	series, err := dynamo.GetSeries(r.Context(), seriesID)
	if err != nil {
		log.Printf("get series error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if series == nil {
		writeError(w, http.StatusNotFound, "series not found")
		return
	}

	if err := requireTrackRole(r, series.TrackID, uid, "owner", "admin"); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	var req struct {
		UID                 string `json:"uid"`
		DriverName          string `json:"driver_name"`
		Seeded              bool   `json:"seeded"`
		RelegationProtected bool   `json:"relegation_protected"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.UID == "" {
		writeError(w, http.StatusBadRequest, "uid is required")
		return
	}
	if req.DriverName == "" {
		writeError(w, http.StatusBadRequest, "driver_name is required")
		return
	}

	sd, err := dynamo.EnrollDriver(r.Context(), dynamo.SeriesDriver{
		SeriesID:            seriesID,
		UID:                 req.UID,
		DriverName:          req.DriverName,
		Seeded:              req.Seeded,
		RelegationProtected: req.RelegationProtected,
	})
	if err != nil {
		log.Printf("enroll driver error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusCreated, sd)
}

func handleListSeriesDrivers(w http.ResponseWriter, r *http.Request) {
	seriesID := r.PathValue("id")

	drivers, err := dynamo.ListSeriesDrivers(r.Context(), seriesID)
	if err != nil {
		log.Printf("list series drivers error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if drivers == nil {
		drivers = []dynamo.SeriesDriver{}
	}

	writeJSON(w, http.StatusOK, drivers)
}

func handleUpdateSeriesDriver(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	seriesID := r.PathValue("id")
	driverUID := r.PathValue("uid")

	series, err := dynamo.GetSeries(r.Context(), seriesID)
	if err != nil {
		log.Printf("get series error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if series == nil {
		writeError(w, http.StatusNotFound, "series not found")
		return
	}

	if err := requireTrackRole(r, series.TrackID, uid, "owner", "admin"); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	var req map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	allowed := map[string]bool{
		"driverName": true, "seeded": true, "relegationProtected": true,
		"totalPoints": true, "weeklyScores": true, "droppedRound": true,
	}
	fields := map[string]interface{}{}
	for k, v := range req {
		if allowed[k] {
			fields[k] = v
		}
	}

	if err := dynamo.UpdateSeriesDriver(r.Context(), seriesID, driverUID, fields); err != nil {
		log.Printf("update series driver error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func handleDeleteSeriesDriver(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	seriesID := r.PathValue("id")
	driverUID := r.PathValue("uid")

	series, err := dynamo.GetSeries(r.Context(), seriesID)
	if err != nil {
		log.Printf("get series error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if series == nil {
		writeError(w, http.StatusNotFound, "series not found")
		return
	}

	if err := requireTrackRole(r, series.TrackID, uid, "owner", "admin"); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	if err := dynamo.DeleteSeriesDriver(r.Context(), seriesID, driverUID); err != nil {
		log.Printf("delete series driver error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
