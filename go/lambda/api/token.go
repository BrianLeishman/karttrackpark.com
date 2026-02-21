package main

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/BrianLeishman/karttrackpark.com/go/dynamo"
)

func handleListTokens(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	keys, err := dynamo.ListAPIKeys(r.Context(), uid)
	if err != nil {
		log.Printf("list api keys: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, keys)
}

func handleCreateToken(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req struct {
		Label string `json:"label"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Label == "" {
		writeError(w, http.StatusBadRequest, "label is required")
		return
	}

	rawKey, keyID, err := dynamo.CreateAPIKey(r.Context(), uid, req.Label)
	if err != nil {
		log.Printf("create api key: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{
		"api_key": rawKey,
		"key_id":  keyID,
	})
}

func handleDeleteToken(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	keyID := r.URL.Query().Get("id")
	if keyID == "" {
		writeError(w, http.StatusBadRequest, "id query param is required")
		return
	}

	if err := dynamo.DeleteAPIKey(r.Context(), uid, keyID); err != nil {
		log.Printf("delete api key: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
