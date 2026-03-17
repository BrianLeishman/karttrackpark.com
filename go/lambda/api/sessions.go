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

type LapWithDriver struct {
	dynamo.Lap
	DriverName string `json:"driver_name,omitempty"`
}

func handleListLaps(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")

	laps, err := dynamo.ListLapsForSession(r.Context(), sessionID)
	if err != nil {
		log.Printf("list laps error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Collect unique UIDs
	uidSet := map[string]struct{}{}
	for _, l := range laps {
		if l.UID != "" {
			uidSet[l.UID] = struct{}{}
		}
	}

	// Look up driver names
	names := map[string]string{}
	for uid := range uidSet {
		u, err := dynamo.GetUser(r.Context(), uid)
		if err != nil {
			log.Printf("get user %s error: %v", uid, err)
			continue
		}
		if u != nil && u.Name != "" {
			names[uid] = u.Name
		}
	}

	// Build enriched response
	result := make([]LapWithDriver, len(laps))
	for i, l := range laps {
		result[i] = LapWithDriver{
			Lap:        l,
			DriverName: names[l.UID],
		}
	}

	writeJSON(w, http.StatusOK, result)
}

func handleUpdateSession(w http.ResponseWriter, r *http.Request) {
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

	var req map[string]any
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	allowed := map[string]bool{
		"sessionName": true, "sessionType": true, "sessionOrder": true,
		"layoutId": true, "reverse": true, "notes": true,
		"startType": true, "lapLimit": true,
		"classIds": true,
	}
	fields := map[string]any{}
	for k, v := range req {
		if allowed[k] {
			fields[k] = v
		}
	}

	if err := dynamo.UpdateSession(r.Context(), sessionID, fields); err != nil {
		log.Printf("update session error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Also update the EventSession link item if this belongs to an event
	if session.EventID != "" {
		linkFields := pickFields(fields, "sessionName", "sessionType", "sessionOrder", "startType", "lapLimit")
		if len(linkFields) > 0 {
			if err := dynamo.UpdateEventSession(r.Context(), session.EventID, sessionID, linkFields); err != nil {
				log.Printf("update event session link error: %v", err)
				// Non-fatal: session was already updated
			}
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

func handleDeleteDriverLaps(w http.ResponseWriter, r *http.Request) {
	authUID, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	sessionID := r.PathValue("id")
	driverUID := r.PathValue("uid")

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

	// Permission: must be the driver themselves or a track admin/owner
	if authUID != driverUID {
		if err := requireTrackRole(r, session.TrackID, authUID, "owner", "admin"); err != nil {
			writeError(w, http.StatusForbidden, "access denied")
			return
		}
	}

	// Optional body: specific lap numbers to delete. Empty = delete all.
	var req struct {
		LapNos []int `json:"lap_nos"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req) // ignore errors — empty body means delete all

	var deleted int
	if len(req.LapNos) > 0 {
		// Delete specific laps
		for _, lapNo := range req.LapNos {
			if err := dynamo.DeleteLap(r.Context(), sessionID, driverUID, lapNo); err != nil {
				log.Printf("delete lap %d error: %v", lapNo, err)
				continue
			}
			deleted++
		}
	} else {
		deleted, err = dynamo.DeleteLapsForUser(r.Context(), sessionID, driverUID)
		if err != nil {
			log.Printf("delete laps error: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
	}

	// Recompute session stats
	allLaps, err := dynamo.ListLapsForSession(r.Context(), sessionID)
	if err != nil {
		log.Printf("list laps for stats error: %v", err)
	} else {
		var bestLapMs int64
		var bestLapUID string
		for _, l := range allLaps {
			if bestLapMs == 0 || l.LapTimeMs < bestLapMs {
				bestLapMs = l.LapTimeMs
				bestLapUID = l.UID
			}
		}
		sessionFields := map[string]any{
			"lapCount":  len(allLaps),
			"bestLapMs": bestLapMs,
		}
		if bestLapUID != "" {
			if user, uErr := dynamo.GetUser(r.Context(), bestLapUID); uErr == nil && user != nil && user.Name != "" {
				sessionFields["bestLapDriverName"] = user.Name
			}
		} else {
			sessionFields["bestLapDriverName"] = ""
		}
		_ = dynamo.UpdateSession(r.Context(), sessionID, sessionFields)
	}

	writeJSON(w, http.StatusOK, map[string]int{"deleted": deleted})
}

func handleGetLap(w http.ResponseWriter, r *http.Request) {
	authUID, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	sessionID := r.PathValue("id")
	driverUID := r.PathValue("uid")
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

	if session.UID != authUID {
		member, err := dynamo.GetTrackMember(r.Context(), session.TrackID, authUID)
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

	writeJSON(w, http.StatusOK, lap)
}
