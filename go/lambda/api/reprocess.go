package main

import (
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/BrianLeishman/karttrackpark.com/go/dynamo"
)

func handleReprocessLaps(w http.ResponseWriter, r *http.Request) {
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

	// Check permissions: track admin/owner can reprocess all, otherwise only own laps
	isAdmin := false
	if err := requireTrackRole(r, session.TrackID, uid, "owner", "admin"); err == nil {
		isAdmin = true
	}

	// List ALL laps including old-format ones so we can find upload IDs and migrate them
	laps, err := dynamo.ListAllLapsForSession(r.Context(), sessionID)
	if err != nil {
		log.Printf("list laps error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if len(laps) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{
			"reprocessed": 0,
			"total_laps":  0,
		})
		return
	}

	// Check that the user has laps here (if not admin)
	if !isAdmin {
		hasOwnLaps := false
		for _, l := range laps {
			if l.UID == uid {
				hasOwnLaps = true
				break
			}
		}
		if !hasOwnLaps {
			writeError(w, http.StatusForbidden, "no laps to reprocess")
			return
		}
	}

	// Extract upload IDs and which original lap numbers were included per upload.
	// The telemetry key encodes both: telemetry/{uploadID}/lap-{originalLapNo}.json
	type uploadRef struct {
		uploadID     string
		ownerUID     string
		includedLaps map[int]bool // original lap numbers that were selected at import
	}
	uploadMap := map[string]*uploadRef{}
	for _, l := range laps {
		if !isAdmin && l.UID != uid {
			continue
		}
		uploadID, origLapNo := parseTelemKey(l.TelemetryKey)
		if uploadID == "" {
			continue
		}

		ref, ok := uploadMap[uploadID]
		if !ok {
			ownerUID := l.UID
			if ownerUID == "" {
				upload, err := dynamo.GetUpload(r.Context(), uploadID)
				if err != nil || upload == nil {
					continue
				}
				ownerUID = upload.UID
			}
			ref = &uploadRef{
				uploadID:     uploadID,
				ownerUID:     ownerUID,
				includedLaps: map[int]bool{},
			}
			uploadMap[uploadID] = ref
		}
		if origLapNo > 0 {
			ref.includedLaps[origLapNo] = true
		}
	}

	if len(uploadMap) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{
			"reprocessed": 0,
			"total_laps":  len(laps),
		})
		return
	}

	// Delete old laps before recreating
	if isAdmin {
		if _, err := dynamo.DeleteAllLapsForSession(r.Context(), sessionID); err != nil {
			log.Printf("delete all laps error: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
	} else {
		if _, err := dynamo.DeleteLapsForUser(r.Context(), sessionID, uid); err != nil {
			log.Printf("delete laps for user %s error: %v", uid, err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
	}

	// Determine kart class from session
	var kartClass string
	if len(session.ClassIDs) == 1 {
		kartClass = session.ClassIDs[0]
	}

	// Recreate laps from each upload, only including the originally selected laps
	reprocessed := 0
	for _, ref := range uploadMap {
		upload, err := dynamo.GetUpload(r.Context(), ref.uploadID)
		if err != nil {
			log.Printf("get upload %s error: %v", ref.uploadID, err)
			continue
		}
		if upload == nil || len(upload.Laps) == 0 {
			continue
		}

		seqNo := 0
		for _, ul := range upload.Laps {
			if !ref.includedLaps[ul.LapNo] {
				continue
			}
			seqNo++
			telemKey := "telemetry/" + ref.uploadID + "/lap-" + strconv.Itoa(ul.LapNo) + ".json"
			if err := dynamo.PutLap(r.Context(), dynamo.Lap{
				SessionID:    sessionID,
				LapNo:        seqNo,
				LapTimeMs:    ul.LapTimeMs,
				MaxSpeed:     ul.MaxSpeed,
				UID:          ref.ownerUID,
				LayoutID:     session.LayoutID,
				KartClass:    kartClass,
				TelemetryKey: telemKey,
				CreatedAt:    upload.CreatedAt,
			}); err != nil {
				log.Printf("put lap %d error: %v", seqNo, err)
				writeError(w, http.StatusInternalServerError, "internal error")
				return
			}
		}
		reprocessed++
	}

	// Recompute session stats from all new-format laps
	allLaps, err := dynamo.ListLapsForSession(r.Context(), sessionID)
	if err != nil {
		log.Printf("list laps for stats error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

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
		if user, err := dynamo.GetUser(r.Context(), bestLapUID); err == nil && user != nil && user.Name != "" {
			sessionFields["bestLapDriverName"] = user.Name
		}
	}

	if err := dynamo.UpdateSession(r.Context(), sessionID, sessionFields); err != nil {
		log.Printf("update session error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"reprocessed": reprocessed,
		"total_laps":  len(allLaps),
	})
}

// parseTelemKey extracts the upload ID and original lap number from a telemetry key
// like "telemetry/{uploadID}/lap-{n}.json".
func parseTelemKey(key string) (string, int) {
	parts := strings.Split(key, "/")
	if len(parts) < 3 || parts[0] != "telemetry" {
		return "", 0
	}
	uploadID := parts[1]
	// parts[2] = "lap-{n}.json"
	lapPart := strings.TrimPrefix(parts[2], "lap-")
	lapPart = strings.TrimSuffix(lapPart, ".json")
	lapNo, _ := strconv.Atoi(lapPart)
	return uploadID, lapNo
}
