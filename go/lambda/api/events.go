package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	"github.com/BrianLeishman/karttrackpark.com/go/dynamo"
)

type seriesContext struct {
	SeriesID            string `json:"series_id"`
	SeriesName          string `json:"series_name"`
	ChampionshipID      string `json:"championship_id"`
	ChampionshipName    string `json:"championship_name"`
	ChampionshipLogoKey string `json:"championship_logo_key,omitempty"`
	RoundNumber         int    `json:"round_number"`
}

type eventWithContext struct {
	dynamo.Event
	Series []seriesContext `json:"series,omitempty"`
}

// buildSeriesContextMap walks championships → series → series events for a track
// and returns a map from eventID to its series contexts.
func buildSeriesContextMap(ctx context.Context, trackID string) map[string][]seriesContext {
	eventMap := map[string][]seriesContext{}

	champs, err := dynamo.ListChampionshipsForTrack(ctx, trackID)
	if err != nil {
		log.Printf("enrich: list championships error: %v", err)
		return eventMap
	}

	for _, c := range champs {
		seriesList, err := dynamo.ListSeriesForChampionship(ctx, c.ChampionshipID)
		if err != nil {
			log.Printf("enrich: list series error: %v", err)
			continue
		}
		for _, s := range seriesList {
			seriesEvents, err := dynamo.ListSeriesEvents(ctx, s.SeriesID)
			if err != nil {
				log.Printf("enrich: list series events error: %v", err)
				continue
			}
			for _, se := range seriesEvents {
				eventMap[se.EventID] = append(eventMap[se.EventID], seriesContext{
					SeriesID:            s.SeriesID,
					SeriesName:          s.Name,
					ChampionshipID:      c.ChampionshipID,
					ChampionshipName:    c.Name,
					ChampionshipLogoKey: c.LogoKey,
					RoundNumber:         se.RoundNumber,
				})
			}
		}
	}

	return eventMap
}

func applySeriesContext(events []dynamo.Event, ctxMap map[string][]seriesContext) []eventWithContext {
	result := make([]eventWithContext, len(events))
	for i, e := range events {
		result[i] = eventWithContext{Event: e, Series: ctxMap[e.EventID]}
	}
	return result
}

func handleListEvents(w http.ResponseWriter, r *http.Request) {
	trackID := r.URL.Query().Get("track_id")

	upcoming, err := dynamo.ListUpcomingEvents(r.Context(), 50, trackID)
	if err != nil {
		log.Printf("list upcoming events error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	recent, err := dynamo.ListRecentEvents(r.Context(), 50, trackID)
	if err != nil {
		log.Printf("list recent events error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if upcoming == nil {
		upcoming = []dynamo.Event{}
	}
	if recent == nil {
		recent = []dynamo.Event{}
	}

	if trackID != "" {
		ctxMap := buildSeriesContextMap(r.Context(), trackID)
		writeJSON(w, http.StatusOK, map[string]any{
			"upcoming": applySeriesContext(upcoming, ctxMap),
			"recent":   applySeriesContext(recent, ctxMap),
		})
		return
	}

	// Global events list: build context maps per unique track
	allEvents := append(upcoming, recent...)
	trackIDs := map[string]bool{}
	for _, e := range allEvents {
		trackIDs[e.TrackID] = true
	}
	merged := map[string][]seriesContext{}
	for tid := range trackIDs {
		for k, v := range buildSeriesContextMap(r.Context(), tid) {
			merged[k] = v
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"upcoming": applySeriesContext(upcoming, merged),
		"recent":   applySeriesContext(recent, merged),
	})
}

func handleGetEvent(w http.ResponseWriter, r *http.Request) {
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

	ctxMap := buildSeriesContextMap(r.Context(), event.TrackID)
	writeJSON(w, http.StatusOK, eventWithContext{Event: *event, Series: ctxMap[event.EventID]})
}

func handleCreateEvent(w http.ResponseWriter, r *http.Request) {
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
		Name        string `json:"name"`
		Description string `json:"description"`
		EventType   string `json:"event_type"`
		StartTime   string `json:"start_time"`
		EndTime     string `json:"end_time"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.StartTime == "" {
		writeError(w, http.StatusBadRequest, "start_time is required")
		return
	}

	// Look up track to denormalize the name
	track, err := dynamo.GetTrack(r.Context(), trackID)
	if err != nil {
		log.Printf("get track error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if track == nil {
		writeError(w, http.StatusNotFound, "track not found")
		return
	}

	event, err := dynamo.CreateEvent(r.Context(), dynamo.Event{
		TrackID:      trackID,
		TrackName:    track.Name,
		TrackLogoKey: track.LogoKey,
		Name:         req.Name,
		Description:  req.Description,
		EventType:    req.EventType,
		StartTime:    req.StartTime,
		EndTime:      req.EndTime,
	})
	if err != nil {
		log.Printf("create event error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusCreated, event)
}

func handleUpdateEvent(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	eventID := r.PathValue("id")

	// Look up the event to find its track
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

	var req map[string]any
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	allowed := map[string]bool{
		"name": true, "description": true, "eventType": true,
		"startTime": true, "endTime": true,
	}
	fields := map[string]any{}
	for k, v := range req {
		if allowed[k] {
			fields[k] = v
		}
	}

	// If startTime is updated, also update the GSI1SK
	if st, ok := fields["startTime"]; ok {
		fields["gsi1sk"] = st
	}

	if err := dynamo.UpdateEvent(r.Context(), eventID, fields); err != nil {
		log.Printf("update event error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func handleDeleteEvent(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	eventID := r.PathValue("id")

	// Look up the event to find its track
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

	if err := dynamo.DeleteEvent(r.Context(), eventID); err != nil {
		log.Printf("delete event error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
