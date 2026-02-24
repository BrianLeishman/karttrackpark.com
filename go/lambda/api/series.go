package main

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/BrianLeishman/karttrackpark.com/go/dynamo"
)

func handleCreateSeries(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	champID := r.PathValue("id")

	champ, err := dynamo.GetChampionship(r.Context(), champID)
	if err != nil {
		log.Printf("get championship error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if champ == nil {
		writeError(w, http.StatusNotFound, "championship not found")
		return
	}

	if err := requireTrackRole(r, champ.TrackID, uid, "owner", "admin"); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Status      string `json:"status"`
		Rules       string `json:"rules"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	series, err := dynamo.CreateSeries(r.Context(), dynamo.Series{
		TrackID:        champ.TrackID,
		ChampionshipID: champID,
		Name:           req.Name,
		Description:    req.Description,
		Status:         req.Status,
		Rules:          req.Rules,
	})
	if err != nil {
		log.Printf("create series error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusCreated, series)
}

func handleListSeriesForChampionship(w http.ResponseWriter, r *http.Request) {
	champID := r.PathValue("id")

	series, err := dynamo.ListSeriesForChampionship(r.Context(), champID)
	if err != nil {
		log.Printf("list series error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if series == nil {
		series = []dynamo.Series{}
	}

	writeJSON(w, http.StatusOK, series)
}

func handleGetSeries(w http.ResponseWriter, r *http.Request) {
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

	writeJSON(w, http.StatusOK, series)
}

func handleUpdateSeries(w http.ResponseWriter, r *http.Request) {
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

	var req map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	allowed := map[string]bool{"name": true, "description": true, "status": true, "rules": true}
	fields := map[string]interface{}{}
	for k, v := range req {
		if allowed[k] {
			fields[k] = v
		}
	}

	if err := dynamo.UpdateSeries(r.Context(), seriesID, fields); err != nil {
		log.Printf("update series error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func handleDeleteSeries(w http.ResponseWriter, r *http.Request) {
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

	if err := dynamo.DeleteSeries(r.Context(), seriesID); err != nil {
		log.Printf("delete series error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
