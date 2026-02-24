package main

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/BrianLeishman/karttrackpark.com/go/dynamo"
)

func handleCreateChampionship(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	trackID := r.PathValue("id")

	if err := requireTrackRole(r, trackID, uid, "owner", "admin"); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		LogoKey     string `json:"logo_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	champ, err := dynamo.CreateChampionship(r.Context(), dynamo.Championship{
		TrackID:     trackID,
		Name:        req.Name,
		Description: req.Description,
		LogoKey:     req.LogoKey,
	})
	if err != nil {
		log.Printf("create championship error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusCreated, champ)
}

func handleListChampionshipsForTrack(w http.ResponseWriter, r *http.Request) {
	trackID := r.PathValue("id")

	champs, err := dynamo.ListChampionshipsForTrack(r.Context(), trackID)
	if err != nil {
		log.Printf("list championships error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if champs == nil {
		champs = []dynamo.Championship{}
	}

	writeJSON(w, http.StatusOK, champs)
}

func handleGetChampionship(w http.ResponseWriter, r *http.Request) {
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

	writeJSON(w, http.StatusOK, champ)
}

func handleUpdateChampionship(w http.ResponseWriter, r *http.Request) {
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

	var req map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	allowed := map[string]bool{"name": true, "description": true, "logoKey": true}
	fields := map[string]interface{}{}
	for k, v := range req {
		if allowed[k] {
			fields[k] = v
		}
	}

	if err := dynamo.UpdateChampionship(r.Context(), champID, fields); err != nil {
		log.Printf("update championship error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func handleDeleteChampionship(w http.ResponseWriter, r *http.Request) {
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

	if err := dynamo.DeleteChampionship(r.Context(), champID); err != nil {
		log.Printf("delete championship error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
