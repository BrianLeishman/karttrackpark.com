package main

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/BrianLeishman/karttrackpark.com/go/dynamo"
)

func handleAddEventToSeries(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	seriesID := r.PathValue("id")

	series, err := dynamo.GetSeries(r.Context(), seriesID)
	if err != nil {
		log.Printf("get series error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if series == nil {
		writeError(w, http.StatusNotFound, "series not found")
		return
	}

	if err := requireTrackRole(r, series.TrackID, uid, "owner", "admin"); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	var req struct {
		EventID     string `json:"event_id"`
		RoundNumber int    `json:"round_number"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.EventID == "" {
		writeError(w, http.StatusBadRequest, "event_id is required")
		return
	}
	if req.RoundNumber <= 0 {
		writeError(w, http.StatusBadRequest, "round_number must be positive")
		return
	}

	// Look up the event to denormalize name + startTime
	event, err := dynamo.GetEvent(r.Context(), req.EventID)
	if err != nil {
		log.Printf("get event error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if event == nil {
		writeError(w, http.StatusNotFound, "event not found")
		return
	}

	se, err := dynamo.AddEventToSeries(r.Context(), dynamo.SeriesEvent{
		SeriesID:    seriesID,
		EventID:     req.EventID,
		RoundNumber: req.RoundNumber,
		EventName:   event.Name,
		StartTime:   event.StartTime,
	})
	if err != nil {
		log.Printf("add event to series error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusCreated, se)
}

func handleListSeriesEvents(w http.ResponseWriter, r *http.Request) {
	seriesID := r.PathValue("id")

	events, err := dynamo.ListSeriesEvents(r.Context(), seriesID)
	if err != nil {
		log.Printf("list series events error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if events == nil {
		events = []dynamo.SeriesEvent{}
	}

	writeJSON(w, http.StatusOK, events)
}

func handleRemoveEventFromSeries(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	seriesID := r.PathValue("id")
	eventID := r.PathValue("eventId")

	series, err := dynamo.GetSeries(r.Context(), seriesID)
	if err != nil {
		log.Printf("get series error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if series == nil {
		writeError(w, http.StatusNotFound, "series not found")
		return
	}

	if err := requireTrackRole(r, series.TrackID, uid, "owner", "admin"); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	if err := dynamo.RemoveEventFromSeries(r.Context(), seriesID, eventID); err != nil {
		log.Printf("remove event from series error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
