package main

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/BrianLeishman/karttrackpark.com/go/dynamo"
)

func handleCreateEventSession(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

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

	if err := requireTrackRole(r, event.TrackID, uid, "owner", "admin"); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	var req struct {
		SessionName  string `json:"session_name"`
		SessionType  string `json:"session_type"`
		SessionOrder int    `json:"session_order"`
		LayoutID     string `json:"layout_id"`
		KartClass    string `json:"kart_class"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.SessionName == "" {
		writeError(w, http.StatusBadRequest, "session_name is required")
		return
	}

	// Create the session profile item
	session, err := dynamo.CreateSession(r.Context(), dynamo.Session{
		TrackID:      event.TrackID,
		UID:          uid,
		EventID:      eventID,
		SessionName:  req.SessionName,
		SessionType:  req.SessionType,
		SessionOrder: req.SessionOrder,
		LayoutID:     req.LayoutID,
		KartClass:    req.KartClass,
	})
	if err != nil {
		log.Printf("create session error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Create the EVENT#id / SESSION#sid link item
	_, err = dynamo.AddSessionToEvent(r.Context(), dynamo.EventSession{
		EventID:      eventID,
		SessionID:    session.SessionID,
		SessionOrder: req.SessionOrder,
		SessionType:  req.SessionType,
		SessionName:  req.SessionName,
	})
	if err != nil {
		log.Printf("add session to event error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusCreated, session)
}

func handleListEventSessions(w http.ResponseWriter, r *http.Request) {
	eventID := r.PathValue("id")

	sessions, err := dynamo.ListEventSessions(r.Context(), eventID)
	if err != nil {
		log.Printf("list event sessions error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if sessions == nil {
		sessions = []dynamo.EventSession{}
	}

	writeJSON(w, http.StatusOK, sessions)
}
