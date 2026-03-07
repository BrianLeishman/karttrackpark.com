package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"github.com/BrianLeishman/karttrackpark.com/go/dynamo"
)

func handleListSessions(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	sessions, err := dynamo.ListSessionsForUser(r.Context(), uid)
	if err != nil {
		log.Printf("list sessions error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, sessions)
}

func handleGetSession(w http.ResponseWriter, r *http.Request) {
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

	// Verify the user owns this session or is a member of the track
	if session.UID != uid {
		member, err := dynamo.GetTrackMember(r.Context(), session.TrackID, uid)
		if err != nil {
			log.Printf("check membership error: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if member == nil {
			writeError(w, http.StatusForbidden, "access denied")
			return
		}
	}

	// Also fetch laps
	laps, err := dynamo.ListLapsForSession(r.Context(), sessionID)
	if err != nil {
		log.Printf("list laps error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"session": session,
		"laps":    laps,
	})
}

func handleGetSessionPublic(w http.ResponseWriter, r *http.Request) {
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

	writeJSON(w, http.StatusOK, session)
}

func handleStartIngest(w http.ResponseWriter, r *http.Request) {
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
		writeError(w, http.StatusForbidden, "access denied")
		return
	}

	if session.IngestStatus == "processing" {
		writeError(w, http.StatusConflict, "ingest already processing")
		return
	}

	var req struct {
		S3Key string `json:"s3_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.S3Key == "" {
		writeError(w, http.StatusBadRequest, "s3_key is required")
		return
	}

	if err := dynamo.UpdateSession(r.Context(), sessionID, map[string]any{
		"ingestStatus": "pending",
		"rawS3Key":     req.S3Key,
		"ingestError":  "",
	}); err != nil {
		log.Printf("update session error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "pending"})
}

func handleListLaps(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")

	laps, err := dynamo.ListLapsForSession(r.Context(), sessionID)
	if err != nil {
		log.Printf("list laps error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, laps)
}

func handleGetLap(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	sessionID := r.PathValue("id")
	lapNoStr := r.PathValue("lapNo")

	lapNo, err := strconv.Atoi(lapNoStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid lap number")
		return
	}

	// Check session access
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

	if session.UID != uid {
		member, err := dynamo.GetTrackMember(r.Context(), session.TrackID, uid)
		if err != nil {
			log.Printf("check membership error: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if member == nil {
			writeError(w, http.StatusForbidden, "access denied")
			return
		}
	}

	lap, err := dynamo.GetLap(r.Context(), sessionID, lapNo)
	if err != nil {
		log.Printf("get lap error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if lap == nil {
		writeError(w, http.StatusNotFound, "lap not found")
		return
	}

	writeJSON(w, http.StatusOK, lap)
}
