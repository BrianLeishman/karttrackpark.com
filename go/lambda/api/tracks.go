package main

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/BrianLeishman/karttrackpark.com/go/dynamo"
)

func handleCreateTrack(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req struct {
		Name     string `json:"name"`
		City     string `json:"city"`
		State    string `json:"state"`
		Timezone string `json:"timezone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	track, err := dynamo.CreateTrack(r.Context(), uid, dynamo.Track{
		Name:     req.Name,
		City:     req.City,
		State:    req.State,
		Timezone: req.Timezone,
	})
	if err != nil {
		log.Printf("create track error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusCreated, track)
}

func handleListTracks(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	members, err := dynamo.ListTracksForUser(r.Context(), uid)
	if err != nil {
		log.Printf("list tracks error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Fetch full track details for each membership
	type trackWithRole struct {
		dynamo.Track
		Role string `json:"role"`
	}

	tracks := make([]trackWithRole, 0, len(members))
	for _, m := range members {
		t, err := dynamo.GetTrack(r.Context(), m.TrackID)
		if err != nil {
			log.Printf("get track %s error: %v", m.TrackID, err)
			continue
		}
		if t == nil {
			continue
		}
		tracks = append(tracks, trackWithRole{Track: *t, Role: m.Role})
	}

	writeJSON(w, http.StatusOK, tracks)
}

func handleGetTrack(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	trackID := r.PathValue("id")

	// Verify the user is a member
	member, err := dynamo.GetTrackMember(r.Context(), trackID, uid)
	if err != nil {
		log.Printf("get track member error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if member == nil {
		writeError(w, http.StatusForbidden, "not a member of this track")
		return
	}

	track, err := dynamo.GetTrack(r.Context(), trackID)
	if err != nil {
		log.Printf("get track error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if track == nil {
		writeError(w, http.StatusNotFound, "track not found")
		return
	}

	writeJSON(w, http.StatusOK, track)
}

func handleUpdateTrack(w http.ResponseWriter, r *http.Request) {
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

	var req map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	// Only allow updating safe fields
	allowed := map[string]bool{"name": true, "city": true, "state": true, "timezone": true}
	fields := map[string]interface{}{}
	for k, v := range req {
		if allowed[k] {
			fields[k] = v
		}
	}

	if err := dynamo.UpdateTrack(r.Context(), trackID, fields); err != nil {
		log.Printf("update track error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func handleCreateLayout(w http.ResponseWriter, r *http.Request) {
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
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	layout, err := dynamo.CreateLayout(r.Context(), dynamo.Layout{
		TrackID: trackID,
		Name:    req.Name,
	})
	if err != nil {
		log.Printf("create layout error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusCreated, layout)
}

func handleListLayouts(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	trackID := r.PathValue("id")

	// Verify membership
	member, err := dynamo.GetTrackMember(r.Context(), trackID, uid)
	if err != nil {
		log.Printf("check membership error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if member == nil {
		writeError(w, http.StatusForbidden, "not a member of this track")
		return
	}

	layouts, err := dynamo.ListLayouts(r.Context(), trackID)
	if err != nil {
		log.Printf("list layouts error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, layouts)
}
