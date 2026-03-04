package main

import (
	"context"
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

	// Fetch default layout's outline for hover card compatibility
	defaultLayout, err := dynamo.GetDefaultLayoutForTrack(r.Context(), trackID)
	if err != nil {
		log.Printf("get default layout error: %v", err)
	}

	type trackPublicResponse struct {
		dynamo.Track
		TrackOutline string                   `json:"track_outline,omitempty"`
		Annotations  []dynamo.TrackAnnotation `json:"annotations,omitempty"`
	}
	resp := trackPublicResponse{Track: *track}
	if defaultLayout != nil {
		resp.TrackOutline = defaultLayout.TrackOutline
		resp.Annotations = defaultLayout.Annotations
	}

	writeJSON(w, http.StatusOK, resp)
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

	var req map[string]any
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	// Only allow updating safe fields
	allowed := map[string]bool{"name": true, "logoKey": true, "email": true, "phone": true, "city": true, "state": true, "timezone": true, "website": true, "facebook": true, "instagram": true, "youtube": true, "tiktok": true, "mapBounds": true}
	fields := map[string]any{}
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
		Name         string                   `json:"name"`
		IsDefault    bool                     `json:"is_default"`
		TrackOutline string                   `json:"track_outline"`
		Annotations  []dynamo.TrackAnnotation `json:"annotations"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	if err := validateAnnotations(req.Annotations); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// If first layout for track, auto-set default
	existing, err := dynamo.ListLayouts(r.Context(), trackID)
	if err != nil {
		log.Printf("list layouts error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if len(existing) == 0 {
		req.IsDefault = true
	}

	// If setting as default, unset previous default
	if req.IsDefault {
		if err := unsetDefaultLayout(r.Context(), trackID); err != nil {
			log.Printf("unset default layout error: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
	}

	layout, err := dynamo.CreateLayout(r.Context(), dynamo.Layout{
		TrackID:      trackID,
		Name:         req.Name,
		IsDefault:    req.IsDefault,
		TrackOutline: req.TrackOutline,
		Annotations:  req.Annotations,
	})
	if err != nil {
		log.Printf("create layout error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusCreated, layout)
}

func handleGetLayout(w http.ResponseWriter, r *http.Request) {
	trackID := r.PathValue("id")
	layoutID := r.PathValue("layoutId")

	layout, err := dynamo.GetLayout(r.Context(), trackID, layoutID)
	if err != nil {
		log.Printf("get layout error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if layout == nil {
		writeError(w, http.StatusNotFound, "layout not found")
		return
	}

	writeJSON(w, http.StatusOK, layout)
}

func handleUpdateLayout(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	trackID := r.PathValue("id")
	layoutID := r.PathValue("layoutId")

	if err := requireTrackRole(r, trackID, uid, "owner", "admin"); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	var req map[string]any
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	allowed := map[string]bool{"name": true, "trackOutline": true, "isDefault": true, "annotations": true}
	fields := map[string]any{}
	for k, v := range req {
		if allowed[k] {
			fields[k] = v
		}
	}

	// Validate annotations if provided
	if raw, ok := fields["annotations"]; ok {
		// JSON decodes arrays as []interface{}, re-marshal and decode into typed slice
		b, err := json.Marshal(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid annotations")
			return
		}
		var annotations []dynamo.TrackAnnotation
		if err := json.Unmarshal(b, &annotations); err != nil {
			writeError(w, http.StatusBadRequest, "invalid annotations")
			return
		}
		if err := validateAnnotations(annotations); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		fields["annotations"] = annotations
	}

	// If setting as default, unset previous default first
	if isDefault, ok := fields["isDefault"]; ok {
		if b, isBool := isDefault.(bool); isBool && b {
			if err := unsetDefaultLayout(r.Context(), trackID); err != nil {
				log.Printf("unset default layout error: %v", err)
				writeError(w, http.StatusInternalServerError, "internal error")
				return
			}
		}
	}

	if err := dynamo.UpdateLayout(r.Context(), trackID, layoutID, fields); err != nil {
		log.Printf("update layout error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func handleDeleteLayout(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	trackID := r.PathValue("id")
	layoutID := r.PathValue("layoutId")

	if err := requireTrackRole(r, trackID, uid, "owner", "admin"); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	if err := dynamo.DeleteLayout(r.Context(), trackID, layoutID); err != nil {
		log.Printf("delete layout error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// unsetDefaultLayout clears isDefault on the current default layout for a track.
func unsetDefaultLayout(ctx context.Context, trackID string) error {
	layouts, err := dynamo.ListLayouts(ctx, trackID)
	if err != nil {
		return err
	}
	for _, l := range layouts {
		if l.IsDefault {
			return dynamo.UpdateLayout(ctx, trackID, l.LayoutID, map[string]any{"isDefault": false})
		}
	}
	return nil
}

func handleListLayouts(w http.ResponseWriter, r *http.Request) {
	trackID := r.PathValue("id")

	layouts, err := dynamo.ListLayouts(r.Context(), trackID)
	if err != nil {
		log.Printf("list layouts error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, layouts)
}

func handleCreateKartClass(w http.ResponseWriter, r *http.Request) {
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
		Name      string `json:"name"`
		IsDefault bool   `json:"is_default"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	// If first class for track, auto-set default
	existing, err := dynamo.ListKartClasses(r.Context(), trackID)
	if err != nil {
		log.Printf("list kart classes error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if len(existing) == 0 {
		req.IsDefault = true
	}

	// If setting as default, unset previous default
	if req.IsDefault {
		if err := unsetDefaultKartClass(r.Context(), trackID); err != nil {
			log.Printf("unset default kart class error: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
	}

	kc, err := dynamo.CreateKartClass(r.Context(), dynamo.KartClass{
		TrackID:   trackID,
		Name:      req.Name,
		IsDefault: req.IsDefault,
	})
	if err != nil {
		log.Printf("create kart class error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusCreated, kc)
}

func handleListKartClasses(w http.ResponseWriter, r *http.Request) {
	trackID := r.PathValue("id")

	classes, err := dynamo.ListKartClasses(r.Context(), trackID)
	if err != nil {
		log.Printf("list kart classes error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, classes)
}

func handleGetKartClass(w http.ResponseWriter, r *http.Request) {
	trackID := r.PathValue("id")
	classID := r.PathValue("classId")

	kc, err := dynamo.GetKartClass(r.Context(), trackID, classID)
	if err != nil {
		log.Printf("get kart class error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if kc == nil {
		writeError(w, http.StatusNotFound, "class not found")
		return
	}

	writeJSON(w, http.StatusOK, kc)
}

func handleUpdateKartClass(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	trackID := r.PathValue("id")
	classID := r.PathValue("classId")

	if err := requireTrackRole(r, trackID, uid, "owner", "admin"); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	var req map[string]any
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	allowed := map[string]bool{"name": true, "isDefault": true}
	fields := map[string]any{}
	for k, v := range req {
		if allowed[k] {
			fields[k] = v
		}
	}

	// If setting as default, unset previous default first
	if isDefault, ok := fields["isDefault"]; ok {
		if b, isBool := isDefault.(bool); isBool && b {
			if err := unsetDefaultKartClass(r.Context(), trackID); err != nil {
				log.Printf("unset default kart class error: %v", err)
				writeError(w, http.StatusInternalServerError, "internal error")
				return
			}
		}
	}

	if err := dynamo.UpdateKartClass(r.Context(), trackID, classID, fields); err != nil {
		log.Printf("update kart class error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func handleDeleteKartClass(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	trackID := r.PathValue("id")
	classID := r.PathValue("classId")

	if err := requireTrackRole(r, trackID, uid, "owner", "admin"); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	if err := dynamo.DeleteKartClass(r.Context(), trackID, classID); err != nil {
		log.Printf("delete kart class error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// validateAnnotations checks that all annotations have valid type and position values.
func validateAnnotations(annotations []dynamo.TrackAnnotation) error {
	sfCount := 0
	for _, a := range annotations {
		if a.Type != "turn" && a.Type != "start_finish" {
			return fmt.Errorf("invalid annotation type: %q", a.Type)
		}
		if a.Position < 0 || a.Position > 1 {
			return fmt.Errorf("annotation position must be 0.0-1.0")
		}
		if a.Type == "start_finish" {
			sfCount++
		}
	}
	if sfCount > 1 {
		return fmt.Errorf("at most one start_finish annotation allowed")
	}
	return nil
}

// unsetDefaultKartClass clears isDefault on the current default kart class for a track.
func unsetDefaultKartClass(ctx context.Context, trackID string) error {
	classes, err := dynamo.ListKartClasses(ctx, trackID)
	if err != nil {
		return err
	}
	for _, kc := range classes {
		if kc.IsDefault {
			return dynamo.UpdateKartClass(ctx, trackID, kc.ClassID, map[string]any{"isDefault": false})
		}
	}
	return nil
}
