package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/BrianLeishman/karttrackpark.com/go/dynamo"
	"github.com/BrianLeishman/karttrackpark.com/go/email"
)

type regParentInfo struct {
	TrackID              string
	ParentName           string
	RegistrationMode     string
	MaxSpots             int
	RegistrationDeadline string
}

func resolveSeriesParent(ctx context.Context, id string) (*regParentInfo, error) {
	s, err := dynamo.GetSeries(ctx, id)
	if err != nil {
		return nil, err
	}
	if s == nil {
		return nil, nil
	}
	return &regParentInfo{
		TrackID:              s.TrackID,
		ParentName:           s.Name,
		RegistrationMode:     s.RegistrationMode,
		MaxSpots:             s.MaxSpots,
		RegistrationDeadline: s.RegistrationDeadline,
	}, nil
}

func resolveEventParent(ctx context.Context, id string) (*regParentInfo, error) {
	e, err := dynamo.GetEvent(ctx, id)
	if err != nil {
		return nil, err
	}
	if e == nil {
		return nil, nil
	}
	return &regParentInfo{
		TrackID:              e.TrackID,
		ParentName:           e.Name,
		RegistrationMode:     e.RegistrationMode,
		MaxSpots:             e.MaxSpots,
		RegistrationDeadline: e.RegistrationDeadline,
	}, nil
}

func resolveSessionParent(ctx context.Context, id string) (*regParentInfo, error) {
	s, err := dynamo.GetSession(ctx, id)
	if err != nil {
		return nil, err
	}
	if s == nil {
		return nil, nil
	}
	return &regParentInfo{
		TrackID:              s.TrackID,
		ParentName:           s.SessionName,
		RegistrationMode:     s.RegistrationMode,
		MaxSpots:             s.MaxSpots,
		RegistrationDeadline: s.RegistrationDeadline,
	}, nil
}

func makeCreateRegHandler(parentType string, resolve func(context.Context, string) (*regParentInfo, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, err := requireAuth(r)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		parentID := r.PathValue("id")

		parent, err := resolve(r.Context(), parentID)
		if err != nil {
			log.Printf("resolve %s parent error: %v", parentType, err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if parent == nil {
			writeError(w, http.StatusNotFound, parentType+" not found")
			return
		}

		var req struct {
			Email      string `json:"email"`
			DriverName string `json:"driver_name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}

		// Check admin role once
		isAdmin := requireTrackRole(r, parent.TrackID, uid, "owner", "admin") == nil

		// If email is provided, admin is inviting another driver
		targetUID := uid
		inviteEmail := ""
		if req.Email != "" {
			if !isAdmin {
				writeError(w, http.StatusForbidden, "only admins can invite drivers")
				return
			}
			reqEmail := strings.ToLower(strings.TrimSpace(req.Email))

			// Look up user by email
			targetUser, err := dynamo.GetUserByEmail(r.Context(), reqEmail)
			if err != nil {
				log.Printf("lookup user by email error: %v", err)
				writeError(w, http.StatusInternalServerError, "internal error")
				return
			}
			if targetUser != nil {
				targetUID = strings.TrimPrefix(targetUser.UID, "USER#")
				if req.DriverName == "" {
					req.DriverName = targetUser.Name
				}
			} else {
				// User doesn't exist yet — use email as placeholder UID
				targetUID = "email:" + reqEmail
			}
			inviteEmail = reqEmail
		}

		// If no driver name provided, look up user profile
		driverName := req.DriverName
		if driverName == "" && inviteEmail == "" {
			user, err := dynamo.GetUser(r.Context(), targetUID)
			if err != nil {
				log.Printf("get user error: %v", err)
				writeError(w, http.StatusInternalServerError, "internal error")
				return
			}
			if user != nil && user.Name != "" {
				driverName = user.Name
			} else {
				driverName = targetUID
			}
		}
		if driverName == "" {
			driverName = inviteEmail
		}

		status := "confirmed"
		mode := parent.RegistrationMode
		if mode == "" {
			mode = "closed"
		}

		isSelfRegistering := targetUID == uid

		if isAdmin && !isSelfRegistering && mode == "invite_only" {
			// Admin inviting a driver — create as "invited" so they
			// still need to self-register (and potentially pay)
			status = "invited"
		} else if !isAdmin {
			switch mode {
			case "closed":
				writeError(w, http.StatusForbidden, "registration is closed")
				return
			case "open":
				status = "confirmed"
			case "invite_only":
				// Check if this driver has an existing "invited" registration
				existing, err := dynamo.GetRegistration(r.Context(), parentType, parentID, targetUID)
				if err != nil {
					log.Printf("check invite error: %v", err)
					writeError(w, http.StatusInternalServerError, "internal error")
					return
				}

				// If not found by UID, check by email (user may have been
				// invited before they created an account)
				if existing == nil {
					callerUser, err := dynamo.GetUser(r.Context(), targetUID)
					if err != nil {
						log.Printf("get caller user error: %v", err)
						writeError(w, http.StatusInternalServerError, "internal error")
						return
					}
					if callerUser != nil && callerUser.Email != "" {
						existing, err = dynamo.FindRegistrationByEmail(r.Context(), parentType, parentID, callerUser.Email)
						if err != nil {
							log.Printf("find invite by email error: %v", err)
							writeError(w, http.StatusInternalServerError, "internal error")
							return
						}
					}
				}

				if existing == nil || existing.Status != "invited" {
					writeError(w, http.StatusForbidden, "registration is invite only")
					return
				}

				// Upgrade the invited registration to confirmed
				// If the invite was by email (placeholder UID), delete old + create new with real UID
				if existing.UID != targetUID {
					if err := dynamo.DeleteRegistration(r.Context(), parentType, parentID, existing.UID); err != nil {
						log.Printf("delete placeholder reg error: %v", err)
						writeError(w, http.StatusInternalServerError, "internal error")
						return
					}
					existing.UID = targetUID
					existing.Status = "confirmed"
					existing.RegisteredAt = time.Now().UTC().Format(time.RFC3339)
					if driverName != "" {
						existing.DriverName = driverName
					}
					confirmed, err := dynamo.CreateRegistration(r.Context(), *existing)
					if err != nil {
						log.Printf("create confirmed reg error: %v", err)
						writeError(w, http.StatusInternalServerError, "internal error")
						return
					}
					writeJSON(w, http.StatusOK, confirmed)
					return
				}

				// Same UID — just update in place
				fields := map[string]any{
					"status":       "confirmed",
					"registeredAt": time.Now().UTC().Format(time.RFC3339),
				}
				if driverName != "" && driverName != existing.DriverName {
					fields["driverName"] = driverName
				}
				if err := dynamo.UpdateRegistration(r.Context(), parentType, parentID, targetUID, fields); err != nil {
					log.Printf("confirm invite error: %v", err)
					writeError(w, http.StatusInternalServerError, "internal error")
					return
				}
				existing.Status = "confirmed"
				writeJSON(w, http.StatusOK, existing)
				return
			case "approval_required":
				status = "pending"
			}

			// Check deadline
			if parent.RegistrationDeadline != "" {
				deadline, err := time.Parse(time.RFC3339, parent.RegistrationDeadline)
				if err == nil && time.Now().UTC().After(deadline) {
					writeError(w, http.StatusForbidden, "registration deadline has passed")
					return
				}
			}
		}

		// Check capacity (only count confirmed/pending, not invited)
		if parent.MaxSpots > 0 && status != "invited" {
			count, err := dynamo.CountRegistrations(r.Context(), parentType, parentID)
			if err != nil {
				log.Printf("count registrations error: %v", err)
				writeError(w, http.StatusInternalServerError, "internal error")
				return
			}
			if count >= parent.MaxSpots {
				status = "waitlisted"
			}
		}

		invitedBy := ""
		if isAdmin && !isSelfRegistering {
			invitedBy = uid
		}

		reg, err := dynamo.CreateRegistration(r.Context(), dynamo.Registration{
			ParentType: parentType,
			ParentID:   parentID,
			TrackID:    parent.TrackID,
			UID:        targetUID,
			Email:      inviteEmail,
			DriverName: driverName,
			Status:     status,
			InvitedBy:  invitedBy,
		})
		if err != nil {
			log.Printf("create registration error: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		// Send invite email (best-effort, don't fail the request)
		if inviteEmail != "" && status == "invited" {
			inviter, _ := dynamo.GetUser(r.Context(), uid)
			inviterName := uid
			if inviter != nil && inviter.Name != "" {
				inviterName = inviter.Name
			}
			track, _ := dynamo.GetTrack(r.Context(), parent.TrackID)
			trackName := parent.TrackID
			if track != nil {
				trackName = track.Name
			}
			if err := email.SendInvite(r.Context(), inviteEmail, email.InviteData{
				InviterName: inviterName,
				EntityName:  parent.ParentName,
				TrackName:   trackName,
				Link:        "https://karttrackpark.com",
			}); err != nil {
				log.Printf("send invite email error: %v", err)
			}
		}

		writeJSON(w, http.StatusCreated, reg)
	}
}

func makeListRegsHandler(parentType string, resolve func(context.Context, string) (*regParentInfo, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		parentID := r.PathValue("id")

		parent, err := resolve(r.Context(), parentID)
		if err != nil {
			log.Printf("resolve %s parent error: %v", parentType, err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if parent == nil {
			writeError(w, http.StatusNotFound, parentType+" not found")
			return
		}

		regs, err := dynamo.ListRegistrations(r.Context(), parentType, parentID)
		if err != nil {
			log.Printf("list registrations error: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if regs == nil {
			regs = []dynamo.Registration{}
		}

		writeJSON(w, http.StatusOK, regs)
	}
}

func makeGetRegHandler(parentType string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		parentID := r.PathValue("id")
		regUID := r.PathValue("uid")

		reg, err := dynamo.GetRegistration(r.Context(), parentType, parentID, regUID)
		if err != nil {
			log.Printf("get registration error: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if reg == nil {
			writeError(w, http.StatusNotFound, "registration not found")
			return
		}

		writeJSON(w, http.StatusOK, reg)
	}
}

func makeUpdateRegHandler(parentType string, resolve func(context.Context, string) (*regParentInfo, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, err := requireAuth(r)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		parentID := r.PathValue("id")
		regUID := r.PathValue("uid")

		parent, err := resolve(r.Context(), parentID)
		if err != nil {
			log.Printf("resolve %s parent error: %v", parentType, err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if parent == nil {
			writeError(w, http.StatusNotFound, parentType+" not found")
			return
		}

		if err := requireTrackRole(r, parent.TrackID, uid, "owner", "admin"); err != nil {
			writeError(w, http.StatusForbidden, err.Error())
			return
		}

		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}

		allowed := map[string]bool{
			"status": true, "driverName": true, "paid": true,
			"priceCents": true, "standings": true,
		}
		fields := map[string]any{}
		for k, v := range req {
			if allowed[k] {
				fields[k] = v
			}
		}

		if err := dynamo.UpdateRegistration(r.Context(), parentType, parentID, regUID, fields); err != nil {
			log.Printf("update registration error: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

func makeDeleteRegHandler(parentType string, resolve func(context.Context, string) (*regParentInfo, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, err := requireAuth(r)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		parentID := r.PathValue("id")
		regUID := r.PathValue("uid")

		parent, err := resolve(r.Context(), parentID)
		if err != nil {
			log.Printf("resolve %s parent error: %v", parentType, err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if parent == nil {
			writeError(w, http.StatusNotFound, parentType+" not found")
			return
		}

		// Allow self-unregister or admin
		if regUID != uid {
			if err := requireTrackRole(r, parent.TrackID, uid, "owner", "admin"); err != nil {
				writeError(w, http.StatusForbidden, err.Error())
				return
			}
		}

		if err := dynamo.DeleteRegistration(r.Context(), parentType, parentID, regUID); err != nil {
			log.Printf("delete registration error: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

func handleListMyRegistrations(w http.ResponseWriter, r *http.Request) {
	uid, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	filterType := r.URL.Query().Get("type")

	regs, err := dynamo.ListUserRegistrations(r.Context(), uid, filterType)
	if err != nil {
		log.Printf("list user registrations error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if regs == nil {
		regs = []dynamo.Registration{}
	}

	writeJSON(w, http.StatusOK, regs)
}

func handleUserLookup(w http.ResponseWriter, r *http.Request) {
	_, err := requireAuth(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	lookupEmail := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("email")))
	if lookupEmail == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}

	user, err := dynamo.GetUserByEmail(r.Context(), lookupEmail)
	if err != nil {
		log.Printf("lookup user error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if user == nil {
		writeJSON(w, http.StatusOK, nil)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"uid":  strings.TrimPrefix(user.UID, "USER#"),
		"name": user.Name,
	})
}

// Concrete handler functions
var (
	handleCreateSeriesReg = makeCreateRegHandler("series", resolveSeriesParent)
	handleListSeriesRegs  = makeListRegsHandler("series", resolveSeriesParent)
	handleGetSeriesReg    = makeGetRegHandler("series")
	handleUpdateSeriesReg = makeUpdateRegHandler("series", resolveSeriesParent)
	handleDeleteSeriesReg = makeDeleteRegHandler("series", resolveSeriesParent)

	handleCreateEventReg = makeCreateRegHandler("event", resolveEventParent)
	handleListEventRegs  = makeListRegsHandler("event", resolveEventParent)
	handleGetEventReg    = makeGetRegHandler("event")
	handleUpdateEventReg = makeUpdateRegHandler("event", resolveEventParent)
	handleDeleteEventReg = makeDeleteRegHandler("event", resolveEventParent)

	handleCreateSessionReg = makeCreateRegHandler("session", resolveSessionParent)
	handleListSessionRegs  = makeListRegsHandler("session", resolveSessionParent)
	handleGetSessionReg    = makeGetRegHandler("session")
	handleUpdateSessionReg = makeUpdateRegHandler("session", resolveSessionParent)
	handleDeleteSessionReg = makeDeleteRegHandler("session", resolveSessionParent)
)
