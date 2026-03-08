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
		SessionName  string   `json:"session_name"`
		SessionType  string   `json:"session_type"`
		SessionOrder int      `json:"session_order"`
		LayoutID     string   `json:"layout_id"`
		Reverse      bool     `json:"reverse"`
		StartType    string   `json:"start_type"`
		LapLimit     int      `json:"lap_limit"`
		ClassIDs     []string `json:"class_ids"`
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
		Reverse:      req.Reverse,
		StartType:    req.StartType,
		LapLimit:     req.LapLimit,
		ClassIDs:     req.ClassIDs,
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
		StartType:    req.StartType,
		LapLimit:     req.LapLimit,
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

	// If ?full=true, fetch the full Session items
	if r.URL.Query().Get("full") == "true" {
		var fullSessions []dynamo.Session
		for _, es := range sessions {
			s, err := dynamo.GetSession(r.Context(), es.SessionID)
			if err != nil {
				log.Printf("get session %s error: %v", es.SessionID, err)
				continue
			}
			if s != nil {
				fullSessions = append(fullSessions, *s)
			}
		}
		if fullSessions == nil {
			fullSessions = []dynamo.Session{}
		}
		writeJSON(w, http.StatusOK, fullSessions)
		return
	}

	writeJSON(w, http.StatusOK, sessions)
}
