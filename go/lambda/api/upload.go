package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/rs/xid"
)

const uploadBucket = "ktp-raw-uploads"

var s3Client = sync.OnceValues(func() (*s3.Client, error) {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		return nil, err
	}
	return s3.NewFromConfig(cfg), nil
})

var s3Presigner = sync.OnceValues(func() (*s3.PresignClient, error) {
	c, err := s3Client()
	if err != nil {
		return nil, err
	}
	return s3.NewPresignClient(c), nil
})

func handleUploadURL(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req struct {
		TrackID  string `json:"track_id"`
		Filename string `json:"filename"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.TrackID == "" || req.Filename == "" {
		writeError(w, http.StatusBadRequest, "track_id and filename are required")
		return
	}

	presigner, err := s3Presigner()
	if err != nil {
		log.Printf("s3 presigner error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	uploadID := xid.New().String()
	key := "raw/" + req.TrackID + "/" + uid + "/" + uploadID + "/" + req.Filename

	presigned, err := presigner.PresignPutObject(r.Context(), &s3.PutObjectInput{
		Bucket: aws.String(uploadBucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(15*time.Minute))
	if err != nil {
		log.Printf("presign error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"upload_url": presigned.URL,
		"key":        key,
		"upload_id":  uploadID,
	})
}
