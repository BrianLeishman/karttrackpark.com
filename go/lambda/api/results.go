package main

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/BrianLeishman/karttrackpark.com/go/dynamo"
)

func handlePostResult(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

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

	if err := requireTrackRole(r, session.TrackID, uid, "owner", "admin"); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	var req struct {
		UID          string `json:"uid"`
		DriverName   string `json:"driver_name"`
		Position     int    `json:"position"`
		Points       int    `json:"points"`
		FastestLapMs int64  `json:"fastest_lap_ms"`
		KartID       string `json:"kart_id"`
		GridPosition int    `json:"grid_position"`
		Penalties    string `json:"penalties"`
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
	if req.Position <= 0 {
		writeError(w, http.StatusBadRequest, "position must be positive")
		return
	}

	result, err := dynamo.PutResult(r.Context(), dynamo.Result{
		SessionID:    sessionID,
		UID:          req.UID,
		DriverName:   req.DriverName,
		Position:     req.Position,
		Points:       req.Points,
		FastestLapMs: req.FastestLapMs,
		KartID:       req.KartID,
		GridPosition: req.GridPosition,
		Penalties:    req.Penalties,
	})
	if err != nil {
		log.Printf("put result error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusCreated, result)
}

func handleListResults(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")

	results, err := dynamo.ListResultsForSession(r.Context(), sessionID)
	if err != nil {
		log.Printf("list results error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if results == nil {
		results = []dynamo.Result{}
	}

	writeJSON(w, http.StatusOK, results)
}

func handleDeleteResult(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	sessionID := r.PathValue("id")
	resultUID := r.PathValue("uid")

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

	if err := requireTrackRole(r, session.TrackID, uid, "owner", "admin"); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	if err := dynamo.DeleteResult(r.Context(), sessionID, resultUID); err != nil {
		log.Printf("delete result error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
