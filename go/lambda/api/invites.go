package main

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/BrianLeishman/karttrackpark.com/go/dynamo"
)

func handleCreateInvite(w http.ResponseWriter, r *http.Request) {
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
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Email == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}
	if req.Role == "" {
		req.Role = "operator"
	}

	// Validate role
	validRoles := map[string]bool{"owner": true, "admin": true, "operator": true}
	if !validRoles[req.Role] {
		writeError(w, http.StatusBadRequest, "role must be owner, admin, or operator")
		return
	}

	invite, err := dynamo.CreateInvite(r.Context(), dynamo.TrackInvite{
		TrackID:   trackID,
		Email:     req.Email,
		Role:      req.Role,
		InvitedBy: uid,
	})
	if err != nil {
		log.Printf("create invite error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusCreated, invite)
}

func handleListTrackInvites(w http.ResponseWriter, r *http.Request) {
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

	invites, err := dynamo.ListInvitesForTrack(r.Context(), trackID)
	if err != nil {
		log.Printf("list invites error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, invites)
}

func handleDeleteInvite(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	trackID := r.PathValue("id")
	email := r.PathValue("email")

	if err := requireTrackRole(r, trackID, uid, "owner", "admin"); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	if err := dynamo.DeleteInvite(r.Context(), trackID, email); err != nil {
		log.Printf("delete invite error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func handleListMembers(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	trackID := r.PathValue("id")

	// Any member can list members
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

	members, err := dynamo.ListTrackMembers(r.Context(), trackID)
	if err != nil {
		log.Printf("list members error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, members)
}

func handleListMyInvites(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	// Look up user's email
	user, err := dynamo.GetUser(r.Context(), uid)
	if err != nil {
		log.Printf("get user error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if user == nil {
		writeJSON(w, http.StatusOK, []dynamo.TrackInvite{})
		return
	}

	invites, err := dynamo.ListInvitesForEmail(r.Context(), user.Email)
	if err != nil {
		log.Printf("list invites error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, invites)
}

func handleAcceptInvite(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	trackID := r.PathValue("trackId")

	// Look up user's email
	user, err := dynamo.GetUser(r.Context(), uid)
	if err != nil {
		log.Printf("get user error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if user == nil {
		writeError(w, http.StatusBadRequest, "user profile not found")
		return
	}

	if err := dynamo.AcceptInvite(r.Context(), trackID, user.Email, uid); err != nil {
		log.Printf("accept invite error: %v", err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
