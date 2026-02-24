package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/BrianLeishman/karttrackpark.com/go/dynamo"
	"github.com/nyaruka/phonenumbers"
)

// parsePhoneRFC3966 parses a phone string (RFC 3966 tel: URI expected) and validates it.
// Returns the normalized RFC 3966 string or an error.
func parsePhoneRFC3966(raw string) (string, error) {
	// Strip "tel:" prefix if present so the library can parse the number
	num := strings.TrimPrefix(raw, "tel:")
	parsed, err := phonenumbers.Parse(num, "US")
	if err != nil {
		return "", fmt.Errorf("invalid phone number: %w", err)
	}
	if !phonenumbers.IsValidNumber(parsed) {
		return "", fmt.Errorf("invalid phone number")
	}
	return phonenumbers.Format(parsed, phonenumbers.RFC3966), nil
}

func handleCreateTrack(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req struct {
		Name      string `json:"name"`
		LogoKey   string `json:"logo_key"`
		Email     string `json:"email"`
		Phone     string `json:"phone"`
		City      string `json:"city"`
		State     string `json:"state"`
		Timezone  string `json:"timezone"`
		Website   string `json:"website"`
		Facebook  string `json:"facebook"`
		Instagram string `json:"instagram"`
		YouTube   string `json:"youtube"`
		TikTok    string `json:"tiktok"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.LogoKey == "" {
		writeError(w, http.StatusBadRequest, "logo_key is required")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}
	req.Phone = strings.TrimSpace(req.Phone)
	if req.Phone == "" {
		writeError(w, http.StatusBadRequest, "phone is required")
		return
	}
	phone, phoneErr := parsePhoneRFC3966(req.Phone)
	if phoneErr != nil {
		writeError(w, http.StatusBadRequest, "invalid phone number")
		return
	}

	track, err := dynamo.CreateTrack(r.Context(), uid, dynamo.Track{
		Name:      req.Name,
		LogoKey:   req.LogoKey,
		Email:     req.Email,
		Phone:     phone,
		City:      req.City,
		State:     req.State,
		Timezone:  req.Timezone,
		Website:   req.Website,
		Facebook:  req.Facebook,
		Instagram: req.Instagram,
		YouTube:   req.YouTube,
		TikTok:    req.TikTok,
	})
	if err != nil {
		log.Printf("create track error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusCreated, track)
}

func handleListTracks(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	members, err := dynamo.ListTracksForUser(r.Context(), uid)
	if err != nil {
		log.Printf("list tracks error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Fetch full track details for each membership
	type trackWithRole struct {
		dynamo.Track
		Role string `json:"role"`
	}

	tracks := make([]trackWithRole, 0, len(members))
	for _, m := range members {
		t, err := dynamo.GetTrack(r.Context(), m.TrackID)
		if err != nil {
			log.Printf("get track %s error: %v", m.TrackID, err)
			continue
		}
		if t == nil {
			continue
		}
		tracks = append(tracks, trackWithRole{Track: *t, Role: m.Role})
	}

	writeJSON(w, http.StatusOK, tracks)
}

func handleGetTrackPublic(w http.ResponseWriter, r *http.Request) {
	trackID := r.PathValue("id")

	track, err := dynamo.GetTrack(r.Context(), trackID)
	if err != nil {
		log.Printf("get track public error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if track == nil {
		writeError(w, http.StatusNotFound, "track not found")
		return
	}

	writeJSON(w, http.StatusOK, track)
}

func handleGetTrack(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	trackID := r.PathValue("id")

	// Verify the user is a member
	member, err := dynamo.GetTrackMember(r.Context(), trackID, uid)
	if err != nil {
		log.Printf("get track member error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if member == nil {
		writeError(w, http.StatusForbidden, "not a member of this track")
		return
	}

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

	type trackWithRole struct {
		dynamo.Track
		Role string `json:"role"`
	}

	writeJSON(w, http.StatusOK, trackWithRole{Track: *track, Role: member.Role})
}

func handleUpdateTrack(w http.ResponseWriter, r *http.Request) {
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

	var req map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	// Only allow updating safe fields
	allowed := map[string]bool{"name": true, "logoKey": true, "email": true, "phone": true, "city": true, "state": true, "timezone": true, "website": true, "facebook": true, "instagram": true, "youtube": true, "tiktok": true}
	fields := map[string]interface{}{}
	for k, v := range req {
		if allowed[k] {
			fields[k] = v
		}
	}

	if p, ok := fields["phone"]; ok {
		s, isStr := p.(string)
		if !isStr {
			writeError(w, http.StatusBadRequest, "invalid phone number")
			return
		}
		normalized, phoneErr := parsePhoneRFC3966(s)
		if phoneErr != nil {
			writeError(w, http.StatusBadRequest, "invalid phone number")
			return
		}
		fields["phone"] = normalized
	}

	if err := dynamo.UpdateTrack(r.Context(), trackID, fields); err != nil {
		log.Printf("update track error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func handleCreateLayout(w http.ResponseWriter, r *http.Request) {
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
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	layout, err := dynamo.CreateLayout(r.Context(), dynamo.Layout{
		TrackID: trackID,
		Name:    req.Name,
	})
	if err != nil {
		log.Printf("create layout error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusCreated, layout)
}

func handleListLayouts(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	trackID := r.PathValue("id")

	// Verify membership
	member, err := dynamo.GetTrackMember(r.Context(), trackID, uid)
	if err != nil {
		log.Printf("check membership error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if member == nil {
		writeError(w, http.StatusForbidden, "not a member of this track")
		return
	}

	layouts, err := dynamo.ListLayouts(r.Context(), trackID)
	if err != nil {
		log.Printf("list layouts error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, layouts)
}
