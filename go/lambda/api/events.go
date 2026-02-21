package main

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/BrianLeishman/karttrackpark.com/go/dynamo"
)

func handleListEvents(w http.ResponseWriter, r *http.Request) {
	upcoming, err := dynamo.ListUpcomingEvents(r.Context(), 10)
	if err != nil {
		log.Printf("list upcoming events error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	recent, err := dynamo.ListRecentEvents(r.Context(), 10)
	if err != nil {
		log.Printf("list recent events error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if upcoming == nil {
		upcoming = []dynamo.Event{}
	}
	if recent == nil {
		recent = []dynamo.Event{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"upcoming": upcoming,
		"recent":   recent,
	})
}

func handleGetEvent(w http.ResponseWriter, r *http.Request) {
	eventID := r.PathValue("id")

	event, err := dynamo.GetEvent(r.Context(), eventID)
	if err != nil {
		log.Printf("get event error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if event == nil {
		writeError(w, http.StatusNotFound, "event not found")
		return
	}

	writeJSON(w, http.StatusOK, event)
}

func handleCreateEvent(w http.ResponseWriter, r *http.Request) {
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
		EventType   string `json:"event_type"`
		StartTime   string `json:"start_time"`
		EndTime     string `json:"end_time"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.StartTime == "" {
		writeError(w, http.StatusBadRequest, "start_time is required")
		return
	}

	// Look up track to denormalize the name
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

	event, err := dynamo.CreateEvent(r.Context(), dynamo.Event{
		TrackID:     trackID,
		TrackName:   track.Name,
		Name:        req.Name,
		Description: req.Description,
		EventType:   req.EventType,
		StartTime:   req.StartTime,
		EndTime:     req.EndTime,
	})
	if err != nil {
		log.Printf("create event error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusCreated, event)
}

func handleUpdateEvent(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	eventID := r.PathValue("id")

	// Look up the event to find its track
	event, err := dynamo.GetEvent(r.Context(), eventID)
	if err != nil {
		log.Printf("get event error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if event == nil {
		writeError(w, http.StatusNotFound, "event not found")
		return
	}

	if err := requireTrackRole(r, event.TrackID, uid, "owner", "admin"); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	var req map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	allowed := map[string]bool{
		"name": true, "description": true, "eventType": true,
		"startTime": true, "endTime": true,
	}
	fields := map[string]interface{}{}
	for k, v := range req {
		if allowed[k] {
			fields[k] = v
		}
	}

	// If startTime is updated, also update the GSI1SK
	if st, ok := fields["startTime"]; ok {
		fields["gsi1sk"] = st
	}

	if err := dynamo.UpdateEvent(r.Context(), eventID, fields); err != nil {
		log.Printf("update event error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func handleDeleteEvent(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	eventID := r.PathValue("id")

	// Look up the event to find its track
	event, err := dynamo.GetEvent(r.Context(), eventID)
	if err != nil {
		log.Printf("get event error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if event == nil {
		writeError(w, http.StatusNotFound, "event not found")
		return
	}

	if err := requireTrackRole(r, event.TrackID, uid, "owner", "admin"); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	if err := dynamo.DeleteEvent(r.Context(), eventID); err != nil {
		log.Printf("delete event error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
