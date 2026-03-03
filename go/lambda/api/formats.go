package main

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/BrianLeishman/karttrackpark.com/go/dynamo"
)

func handleCreateFormat(w http.ResponseWriter, r *http.Request) {
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
		Name     string                 `json:"name"`
		Sessions []dynamo.FormatSession `json:"sessions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	f, err := dynamo.CreateFormat(r.Context(), dynamo.Format{
		TrackID:  trackID,
		Name:     req.Name,
		Sessions: req.Sessions,
	})
	if err != nil {
		log.Printf("create format error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusCreated, f)
}

func handleListFormatsForTrack(w http.ResponseWriter, r *http.Request) {
	trackID := r.PathValue("id")

	formats, err := dynamo.ListFormatsForTrack(r.Context(), trackID)
	if err != nil {
		log.Printf("list formats error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if formats == nil {
		formats = []dynamo.Format{}
	}

	writeJSON(w, http.StatusOK, formats)
}

func handleGetFormat(w http.ResponseWriter, r *http.Request) {
	formatID := r.PathValue("id")

	f, err := dynamo.GetFormat(r.Context(), formatID)
	if err != nil {
		log.Printf("get format error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if f == nil {
		writeError(w, http.StatusNotFound, "format not found")
		return
	}

	writeJSON(w, http.StatusOK, f)
}

func handleUpdateFormat(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	formatID := r.PathValue("id")

	f, err := dynamo.GetFormat(r.Context(), formatID)
	if err != nil {
		log.Printf("get format error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if f == nil {
		writeError(w, http.StatusNotFound, "format not found")
		return
	}

	if err := requireTrackRole(r, f.TrackID, uid, "owner", "admin"); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	var req struct {
		Name     *string                `json:"name"`
		Sessions []dynamo.FormatSession `json:"sessions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	fields := map[string]any{}
	if req.Name != nil {
		fields["name"] = *req.Name
	}
	if req.Sessions != nil {
		fields["sessions"] = req.Sessions
	}

	if err := dynamo.UpdateFormat(r.Context(), formatID, fields); err != nil {
		log.Printf("update format error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func handleDeleteFormat(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	formatID := r.PathValue("id")

	f, err := dynamo.GetFormat(r.Context(), formatID)
	if err != nil {
		log.Printf("get format error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if f == nil {
		writeError(w, http.StatusNotFound, "format not found")
		return
	}

	if err := requireTrackRole(r, f.TrackID, uid, "owner", "admin"); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	if err := dynamo.DeleteFormat(r.Context(), formatID); err != nil {
		log.Printf("delete format error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
