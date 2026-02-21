package main

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/BrianLeishman/karttrackpark.com/go/dynamo"
)

// requireAuth extracts the Bearer token from the Authorization header,
// looks up the API key, and returns the user ID.
func requireAuth(r *http.Request) (string, error) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if token == "" || token == r.Header.Get("Authorization") {
		return "", fmt.Errorf("missing bearer token")
	}

	uid, err := dynamo.LookupAPIKey(r.Context(), token)
	if err != nil {
		return "", fmt.Errorf("invalid api key: %w", err)
	}
	return uid, nil
}

// requireTrackRole checks that the user is a member of the track with one of the allowed roles.
func requireTrackRole(r *http.Request, trackID, uid string, roles ...string) error {
	member, err := dynamo.GetTrackMember(r.Context(), trackID, uid)
	if err != nil {
		return fmt.Errorf("check membership: %w", err)
	}
	if member == nil {
		return fmt.Errorf("not a member of this track")
	}

	for _, role := range roles {
		if member.Role == role {
			return nil
		}
	}
	return fmt.Errorf("insufficient role: have %s, need one of %v", member.Role, roles)
}
