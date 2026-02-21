package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	_ "time/tzdata"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/awslabs/aws-lambda-go-api-proxy/httpadapter"
)

func main() {
	mux := http.NewServeMux()

	// Tracks
	mux.HandleFunc("POST /api/tracks", handleCreateTrack)
	mux.HandleFunc("GET /api/tracks", handleListTracks)
	mux.HandleFunc("GET /api/tracks/{id}", handleGetTrack)
	mux.HandleFunc("GET /api/tracks/{id}/public", handleGetTrackPublic)
	mux.HandleFunc("PUT /api/tracks/{id}", handleUpdateTrack)

	// Layouts
	mux.HandleFunc("POST /api/tracks/{id}/layouts", handleCreateLayout)
	mux.HandleFunc("GET /api/tracks/{id}/layouts", handleListLayouts)

	// Invites (track-scoped)
	mux.HandleFunc("POST /api/tracks/{id}/invites", handleCreateInvite)
	mux.HandleFunc("GET /api/tracks/{id}/invites", handleListTrackInvites)
	mux.HandleFunc("DELETE /api/tracks/{id}/invites/{email}", handleDeleteInvite)

	// Members
	mux.HandleFunc("GET /api/tracks/{id}/members", handleListMembers)

	// Invites (user-scoped)
	mux.HandleFunc("GET /api/invites", handleListMyInvites)
	mux.HandleFunc("POST /api/invites/{trackId}/accept", handleAcceptInvite)

	// Auth
	mux.HandleFunc("POST /api/auth/session", handleAuthSession)

	// Tokens
	mux.HandleFunc("GET /api/token", handleListTokens)
	mux.HandleFunc("POST /api/token", handleCreateToken)
	mux.HandleFunc("DELETE /api/token", handleDeleteToken)

	// Upload
	mux.HandleFunc("POST /api/upload-url", handleUploadURL)
	mux.HandleFunc("POST /api/asset-url", handleAssetURL)

	// Events
	mux.HandleFunc("GET /api/events", handleListEvents)
	mux.HandleFunc("GET /api/events/{id}", handleGetEvent)
	mux.HandleFunc("POST /api/tracks/{id}/events", handleCreateEvent)
	mux.HandleFunc("PUT /api/events/{id}", handleUpdateEvent)
	mux.HandleFunc("DELETE /api/events/{id}", handleDeleteEvent)

	// Sessions
	mux.HandleFunc("GET /api/sessions", handleListSessions)
	mux.HandleFunc("GET /api/sessions/{id}", handleGetSession)
	mux.HandleFunc("GET /api/sessions/{id}/laps/{lapNo}", handleGetLap)

	handler := cors(mux)

	if os.Getenv("AWS_LAMBDA_FUNCTION_NAME") != "" {
		adapter := httpadapter.NewV2(handler)
		lambda.Start(adapter.ProxyWithContext)
	} else {
		log.Println("API server listening on :25565")
		log.Fatal(http.ListenAndServe(":25565", handler))
	}
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
