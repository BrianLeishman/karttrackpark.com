package main

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/BrianLeishman/karttrackpark.com/go/dynamo"
	"github.com/rs/xid"
)

func handleAuthSession(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code        string `json:"code"`
		RedirectURI string `json:"redirect_uri"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Code == "" || req.RedirectURI == "" {
		writeError(w, http.StatusBadRequest, "code and redirect_uri are required")
		return
	}

	cognitoDomain := os.Getenv("COGNITO_DOMAIN")
	clientID := os.Getenv("COGNITO_CLIENT_ID")
	clientSecret := os.Getenv("COGNITO_CLIENT_SECRET")

	// Exchange authorization code for tokens
	tokenURL := "https://" + cognitoDomain + "/oauth2/token"
	form := url.Values{
		"grant_type":   {"authorization_code"},
		"code":         {req.Code},
		"redirect_uri": {req.RedirectURI},
		"client_id":    {clientID},
	}

	tokenReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		log.Printf("build token request: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	tokenReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	tokenReq.SetBasicAuth(clientID, clientSecret)

	resp, err := http.DefaultClient.Do(tokenReq)
	if err != nil {
		log.Printf("token exchange request: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		log.Printf("token exchange failed: %s %s", resp.Status, body)
		writeError(w, http.StatusUnauthorized, "invalid code")
		return
	}

	var tokenResp struct {
		IDToken string `json:"id_token"`
	}
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		log.Printf("parse token response: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Decode ID token payload (base64url, no verification needed — direct from Cognito over HTTPS)
	parts := strings.Split(tokenResp.IDToken, ".")
	if len(parts) != 3 {
		writeError(w, http.StatusInternalServerError, "invalid id token")
		return
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		log.Printf("decode id token payload: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	var claims struct {
		Email   string `json:"email"`
		Name    string `json:"name"`
		Picture string `json:"picture"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		log.Printf("parse id token claims: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if claims.Email == "" {
		writeError(w, http.StatusBadRequest, "email not present in token")
		return
	}

	email := strings.ToLower(claims.Email)

	// Find or create user
	existing, err := dynamo.GetUserByEmail(r.Context(), email)
	if err != nil {
		log.Printf("get user by email: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	var rawUID string
	if existing != nil {
		rawUID = strings.TrimPrefix(existing.UID, "USER#")
		// Update name/picture if changed
		updates := map[string]interface{}{}
		if claims.Name != "" && claims.Name != existing.Name {
			updates["name"] = claims.Name
		}
		if claims.Picture != "" {
			updates["picture"] = claims.Picture
		}
		if len(updates) > 0 {
			if err := dynamo.UpdateUser(r.Context(), rawUID, updates); err != nil {
				log.Printf("update user: %v", err)
			}
		}
	} else {
		rawUID = xid.New().String()
		now := time.Now().UTC().Format(time.RFC3339)
		if err := dynamo.PutUser(r.Context(), dynamo.UserProfile{
			UID:       dynamo.UserPK(rawUID),
			Email:     email,
			Name:      claims.Name,
			CreatedAt: now,
		}); err != nil {
			log.Printf("create user: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
	}

	// Create session API key
	apiKey, keyID, err := dynamo.CreateAPIKey(r.Context(), rawUID, "Browser session")
	if err != nil {
		log.Printf("create session key: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"api_key": apiKey,
		"key_id":  keyID,
		"user": map[string]string{
			"uid":     rawUID,
			"email":   email,
			"name":    claims.Name,
			"picture": claims.Picture,
		},
	})
}
