package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/rs/xid"

	"github.com/BrianLeishman/karttrackpark.com/go/dynamo"
)

func handleCreateUpload(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req struct {
		TrackID  string `json:"track_id"`
		EventID  string `json:"event_id"`
		Filename string `json:"filename"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Filename == "" {
		writeError(w, http.StatusBadRequest, "filename is required")
		return
	}

	presigner, err := s3Presigner()
	if err != nil {
		log.Printf("s3 presigner error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	uploadID := xid.New().String()
	s3Key := "raw/uploads/" + uploadID + "/" + req.Filename

	presigned, err := presigner.PresignPutObject(r.Context(), &s3.PutObjectInput{
		Bucket: aws.String(uploadBucket),
		Key:    aws.String(s3Key),
	}, s3.WithPresignExpires(15*time.Minute))
	if err != nil {
		log.Printf("presign error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	upload, err := dynamo.CreateUpload(r.Context(), dynamo.Upload{
		UploadID: uploadID,
		UID:      uid,
		TrackID:  req.TrackID,
		EventID:  req.EventID,
		Filename: req.Filename,
		S3Key:    s3Key,
		Status:   "uploading",
	})
	if err != nil {
		log.Printf("create upload error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"upload":     upload,
		"upload_url": presigned.URL,
	})
}

func handleListUploads(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	uploads, err := dynamo.ListUploadsForUser(r.Context(), uid)
	if err != nil {
		log.Printf("list uploads error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, uploads)
}

// requireOwnUpload authenticates the user and returns their upload, writing errors to w if needed.
func requireOwnUpload(w http.ResponseWriter, r *http.Request) (string, *dynamo.Upload, bool) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return "", nil, false
	}

	uploadID := r.PathValue("id")
	upload, err := dynamo.GetUpload(r.Context(), uploadID)
	if err != nil {
		log.Printf("get upload error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return "", nil, false
	}
	if upload == nil || upload.UID != uid {
		writeError(w, http.StatusNotFound, "upload not found")
		return "", nil, false
	}

	return uid, upload, true
}

func handleGetUpload(w http.ResponseWriter, r *http.Request) {
	_, upload, ok := requireOwnUpload(w, r)
	if !ok {
		return
	}

	writeJSON(w, http.StatusOK, upload)
}

func handleAssignUpload(w http.ResponseWriter, r *http.Request) {
	uid, upload, ok := requireOwnUpload(w, r)
	if !ok {
		return
	}
	uploadID := upload.UploadID

	if upload.Status != "complete" && upload.Status != "assigned" {
		writeError(w, http.StatusBadRequest, "upload is not ready for assignment")
		return
	}

	var req struct {
		SessionID    string `json:"session_id"`
		IncludedLaps []int  `json:"included_laps"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.SessionID == "" {
		writeError(w, http.StatusBadRequest, "session_id is required")
		return
	}

	session, err := dynamo.GetSession(r.Context(), req.SessionID)
	if err != nil {
		log.Printf("get session error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if session == nil {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}

	// Build included set (if empty, include all)
	includedSet := make(map[int]bool)
	for _, n := range req.IncludedLaps {
		includedSet[n] = true
	}
	includeAll := len(includedSet) == 0

	// Delete existing laps for this user in the session (PUT semantics: replace)
	if _, err := dynamo.DeleteLapsForUser(r.Context(), req.SessionID, uid); err != nil {
		log.Printf("delete existing laps error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Write new lap items from upload
	for _, ul := range upload.Laps {
		if !includeAll && !includedSet[ul.LapNo] {
			continue
		}
		telemKey := "telemetry/" + uploadID + "/lap-" + strconv.Itoa(ul.LapNo) + ".json"
		if err := dynamo.PutLap(r.Context(), dynamo.Lap{
			SessionID:    req.SessionID,
			LapNo:        ul.LapNo,
			LapTimeMs:    ul.LapTimeMs,
			MaxSpeed:     ul.MaxSpeed,
			UID:          uid,
			LayoutID:     session.LayoutID,
			TelemetryKey: telemKey,
			CreatedAt:    upload.CreatedAt,
		}); err != nil {
			log.Printf("put lap %d error: %v", ul.LapNo, err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
	}

	// Recompute session stats from ALL laps (all users)
	allLaps, err := dynamo.ListLapsForSession(r.Context(), req.SessionID)
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
	// Resolve driver name for whoever holds the best lap
	if bestLapUID != "" {
		if user, err := dynamo.GetUser(r.Context(), bestLapUID); err == nil && user != nil && user.Name != "" {
			sessionFields["bestLapDriverName"] = user.Name
		}
	}

	if err := dynamo.UpdateSession(r.Context(), req.SessionID, sessionFields); err != nil {
		log.Printf("update session error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Mark upload as assigned
	if err := dynamo.UpdateUpload(r.Context(), uploadID, map[string]any{
		"status":    "assigned",
		"sessionId": req.SessionID,
	}); err != nil {
		log.Printf("update upload error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "assigned"})
}

func handleTriggerIngest(w http.ResponseWriter, r *http.Request) {
	_, upload, ok := requireOwnUpload(w, r)
	if !ok {
		return
	}

	if upload.Status != "uploading" {
		writeError(w, http.StatusConflict, "upload already processed")
		return
	}

	// In Lambda, S3 notifications handle ingest automatically.
	// Locally, proxy to the ingest server.
	if os.Getenv("AWS_LAMBDA_FUNCTION_NAME") != "" {
		writeJSON(w, http.StatusOK, map[string]string{"status": "triggered"})
		return
	}

	body, _ := json.Marshal(map[string]string{"key": upload.S3Key})
	resp, err := http.Post("http://localhost:25567/ingest", "application/json", bytes.NewReader(body))
	if err != nil {
		log.Printf("ingest proxy error: %v", err)
		writeError(w, http.StatusBadGateway, "ingest server unavailable — is it running?")
		return
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		writeError(w, http.StatusBadGateway, "ingest failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "triggered"})
}

func handleDeleteUpload(w http.ResponseWriter, r *http.Request) {
	_, upload, ok := requireOwnUpload(w, r)
	if !ok {
		return
	}

	if err := dynamo.DeleteUpload(r.Context(), upload.UploadID); err != nil {
		log.Printf("delete upload error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
