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
	mux.HandleFunc("GET /api/tracks/{id}/layouts/{layoutId}", handleGetLayout)
	mux.HandleFunc("PUT /api/tracks/{id}/layouts/{layoutId}", handleUpdateLayout)
	mux.HandleFunc("DELETE /api/tracks/{id}/layouts/{layoutId}", handleDeleteLayout)

	// Classes
	mux.HandleFunc("POST /api/tracks/{id}/classes", handleCreateKartClass)
	mux.HandleFunc("GET /api/tracks/{id}/classes", handleListKartClasses)
	mux.HandleFunc("GET /api/tracks/{id}/classes/{classId}", handleGetKartClass)
	mux.HandleFunc("PUT /api/tracks/{id}/classes/{classId}", handleUpdateKartClass)
	mux.HandleFunc("DELETE /api/tracks/{id}/classes/{classId}", handleDeleteKartClass)

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

	// User lookup
	mux.HandleFunc("GET /api/users/lookup", handleUserLookup)

	// Tokens
	mux.HandleFunc("GET /api/token", handleListTokens)
	mux.HandleFunc("POST /api/token", handleCreateToken)
	mux.HandleFunc("DELETE /api/token", handleDeleteToken)

	// Assets
	mux.HandleFunc("POST /api/asset-url", handleAssetURL)

	// Uploads (new upload manager)
	mux.HandleFunc("POST /api/uploads", handleCreateUpload)
	mux.HandleFunc("GET /api/uploads", handleListUploads)
	mux.HandleFunc("GET /api/uploads/{id}", handleGetUpload)
	mux.HandleFunc("POST /api/uploads/{id}/assign", handleAssignUpload)
	mux.HandleFunc("POST /api/uploads/{id}/ingest", handleTriggerIngest)
	mux.HandleFunc("DELETE /api/uploads/{id}", handleDeleteUpload)

	// Events
	mux.HandleFunc("GET /api/events", handleListEvents)
	mux.HandleFunc("GET /api/events/{id}", handleGetEvent)
	mux.HandleFunc("POST /api/tracks/{id}/events", handleCreateEvent)
	mux.HandleFunc("PUT /api/events/{id}", handleUpdateEvent)
	mux.HandleFunc("DELETE /api/events/{id}", handleDeleteEvent)

	// Championships
	mux.HandleFunc("POST /api/tracks/{id}/championships", handleCreateChampionship)
	mux.HandleFunc("GET /api/tracks/{id}/championships", handleListChampionshipsForTrack)
	mux.HandleFunc("GET /api/championships/{id}", handleGetChampionship)
	mux.HandleFunc("PUT /api/championships/{id}", handleUpdateChampionship)
	mux.HandleFunc("DELETE /api/championships/{id}", handleDeleteChampionship)

	// Formats
	mux.HandleFunc("POST /api/tracks/{id}/formats", handleCreateFormat)
	mux.HandleFunc("GET /api/tracks/{id}/formats", handleListFormatsForTrack)
	mux.HandleFunc("GET /api/formats/{id}", handleGetFormat)
	mux.HandleFunc("PUT /api/formats/{id}", handleUpdateFormat)
	mux.HandleFunc("DELETE /api/formats/{id}", handleDeleteFormat)

	// Series
	mux.HandleFunc("POST /api/championships/{id}/series", handleCreateSeries)
	mux.HandleFunc("GET /api/championships/{id}/series", handleListSeriesForChampionship)
	mux.HandleFunc("GET /api/series/{id}", handleGetSeries)
	mux.HandleFunc("PUT /api/series/{id}", handleUpdateSeries)
	mux.HandleFunc("DELETE /api/series/{id}", handleDeleteSeries)

	// Series Events
	mux.HandleFunc("POST /api/series/{id}/events", handleAddEventToSeries)
	mux.HandleFunc("GET /api/series/{id}/events", handleListSeriesEvents)
	mux.HandleFunc("DELETE /api/series/{id}/events/{eventId}", handleRemoveEventFromSeries)

	// Series Drivers
	mux.HandleFunc("POST /api/series/{id}/drivers", handleEnrollDriver)
	mux.HandleFunc("GET /api/series/{id}/drivers", handleListSeriesDrivers)
	mux.HandleFunc("PUT /api/series/{id}/drivers/{uid}", handleUpdateSeriesDriver)
	mux.HandleFunc("DELETE /api/series/{id}/drivers/{uid}", handleDeleteSeriesDriver)

	// Registrations (series)
	mux.HandleFunc("POST /api/series/{id}/registrations", handleCreateSeriesReg)
	mux.HandleFunc("GET /api/series/{id}/registrations", handleListSeriesRegs)
	mux.HandleFunc("GET /api/series/{id}/registrations/{uid}", handleGetSeriesReg)
	mux.HandleFunc("PUT /api/series/{id}/registrations/{uid}", handleUpdateSeriesReg)
	mux.HandleFunc("DELETE /api/series/{id}/registrations/{uid}", handleDeleteSeriesReg)

	// Registrations (events)
	mux.HandleFunc("POST /api/events/{id}/registrations", handleCreateEventReg)
	mux.HandleFunc("GET /api/events/{id}/registrations", handleListEventRegs)
	mux.HandleFunc("GET /api/events/{id}/registrations/{uid}", handleGetEventReg)
	mux.HandleFunc("PUT /api/events/{id}/registrations/{uid}", handleUpdateEventReg)
	mux.HandleFunc("DELETE /api/events/{id}/registrations/{uid}", handleDeleteEventReg)

	// Registrations (sessions)
	mux.HandleFunc("POST /api/sessions/{id}/registrations", handleCreateSessionReg)
	mux.HandleFunc("GET /api/sessions/{id}/registrations", handleListSessionRegs)
	mux.HandleFunc("GET /api/sessions/{id}/registrations/{uid}", handleGetSessionReg)
	mux.HandleFunc("PUT /api/sessions/{id}/registrations/{uid}", handleUpdateSessionReg)
	mux.HandleFunc("DELETE /api/sessions/{id}/registrations/{uid}", handleDeleteSessionReg)

	// My registrations
	mux.HandleFunc("GET /api/my/registrations", handleListMyRegistrations)

	// Event Sessions
	mux.HandleFunc("POST /api/events/{id}/sessions", handleCreateEventSession)
	mux.HandleFunc("GET /api/events/{id}/sessions", handleListEventSessions)

	// Sessions
	mux.HandleFunc("GET /api/sessions", handleListSessions)
	mux.HandleFunc("GET /api/sessions/{id}", handleGetSession)
	mux.HandleFunc("PUT /api/sessions/{id}", handleUpdateSession)
	mux.HandleFunc("GET /api/sessions/{id}/public", handleGetSessionPublic)
	mux.HandleFunc("GET /api/sessions/{id}/laps", handleListLaps)
	mux.HandleFunc("GET /api/sessions/{id}/laps/{lapNo}", handleGetLap)
	mux.HandleFunc("GET /api/sessions/{id}/sectors", handleGetSectors)

	// Results
	mux.HandleFunc("POST /api/sessions/{id}/results", handlePostResult)
	mux.HandleFunc("GET /api/sessions/{id}/results", handleListResults)
	mux.HandleFunc("DELETE /api/sessions/{id}/results/{uid}", handleDeleteResult)

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

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func pickFields(src map[string]any, keys ...string) map[string]any {
	out := make(map[string]any)
	for _, k := range keys {
		if v, ok := src[k]; ok {
			out[k] = v
		}
	}
	return out
}
