package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/BrianLeishman/justlog.io/go/dynamo"
	mcpauth "github.com/BrianLeishman/justlog.io/go/lambda/mcp/auth"
	"github.com/google/uuid"
)

const (
	baseURL       = "https://k24xsd279c.execute-api.us-east-1.amazonaws.com"
	cognitoDomain = "https://justlog.auth.us-east-1.amazoncognito.com"
	cognitoClient = "11h4ggbj2m9hehirq0n7hcq5m8"
)

func handleProtectedResource(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"resource":              baseURL,
		"authorization_servers": []string{baseURL},
		"scopes_supported":      []string{"justlog"},
	})
}

func handleAuthServerMeta(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"issuer":                           baseURL,
		"authorization_endpoint":           baseURL + "/oauth/authorize",
		"token_endpoint":                   baseURL + "/oauth/token",
		"registration_endpoint":            baseURL + "/oauth/register",
		"response_types_supported":         []string{"code"},
		"grant_types_supported":            []string{"authorization_code", "refresh_token"},
		"code_challenge_methods_supported": []string{"S256"},
		"scopes_supported":                 []string{"justlog"},
	})
}

func handleAuthorize(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	clientID := q.Get("client_id")
	redirectURI := q.Get("redirect_uri")
	codeChallenge := q.Get("code_challenge")
	codeChallengeMethod := q.Get("code_challenge_method")
	state := q.Get("state")

	if clientID == "" || redirectURI == "" || codeChallenge == "" || state == "" {
		http.Error(w, "missing required parameters", http.StatusBadRequest)
		return
	}
	if codeChallengeMethod != "" && codeChallengeMethod != "S256" {
		http.Error(w, "unsupported code_challenge_method", http.StatusBadRequest)
		return
	}

	// Verify client exists
	client, err := dynamo.GetOAuthClient(r.Context(), clientID)
	if err != nil {
		log.Printf("get oauth client: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if client == nil {
		http.Error(w, "unknown client_id", http.StatusBadRequest)
		return
	}

	// Create auth session
	sessionID := uuid.New().String()
	err = dynamo.PutAuthSession(r.Context(), dynamo.AuthSession{
		SessionID:     sessionID,
		ClientID:      clientID,
		RedirectURI:   redirectURI,
		CodeChallenge: codeChallenge,
		State:         state,
		CreatedAt:     time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		log.Printf("put auth session: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// Redirect to Cognito, encoding our session ID in the state
	cognitoParams := url.Values{
		"client_id":     {cognitoClient},
		"response_type": {"code"},
		"scope":         {"openid email profile"},
		"redirect_uri":  {baseURL + "/oauth/callback"},
		"state":         {sessionID},
	}
	http.Redirect(w, r, cognitoDomain+"/oauth2/authorize?"+cognitoParams.Encode(), http.StatusFound)
}

func handleCallback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	sessionID := r.URL.Query().Get("state")
	if code == "" || sessionID == "" {
		http.Error(w, "missing code or state", http.StatusBadRequest)
		return
	}

	// Load session
	session, err := dynamo.GetAuthSession(r.Context(), sessionID)
	if err != nil || session == nil {
		http.Error(w, "invalid session", http.StatusBadRequest)
		return
	}

	// Exchange code with Cognito
	body := url.Values{
		"grant_type":   {"authorization_code"},
		"client_id":    {cognitoClient},
		"code":         {code},
		"redirect_uri": {baseURL + "/oauth/callback"},
	}
	resp, err := http.Post(cognitoDomain+"/oauth2/token", "application/x-www-form-urlencoded", strings.NewReader(body.Encode()))
	if err != nil {
		log.Printf("cognito token exchange: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("cognito token returned %d", resp.StatusCode)
		http.Error(w, "cognito auth failed", http.StatusBadGateway)
		return
	}

	var tokens struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokens); err != nil {
		log.Printf("decode cognito tokens: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// Get user info from Cognito
	u, err := mcpauth.FromCognito(r.Context(), tokens.AccessToken)
	if err != nil {
		log.Printf("cognito userinfo: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// Generate our authorization code
	ourCode := uuid.New().String()
	err = dynamo.PutAuthCode(r.Context(), dynamo.AuthCode{
		Code:                ourCode,
		SessionID:           sessionID,
		UID:                 u.Sub,
		CognitoAccessToken:  tokens.AccessToken,
		CognitoRefreshToken: tokens.RefreshToken,
		CodeChallenge:       session.CodeChallenge,
		ClientID:            session.ClientID,
		RedirectURI:         session.RedirectURI,
	})
	if err != nil {
		log.Printf("put auth code: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// Redirect back to the original client
	redirectURL, err := url.Parse(session.RedirectURI)
	if err != nil {
		http.Error(w, "invalid redirect_uri", http.StatusBadRequest)
		return
	}
	q := redirectURL.Query()
	q.Set("code", ourCode)
	q.Set("state", session.State)
	redirectURL.RawQuery = q.Encode()
	http.Redirect(w, r, redirectURL.String(), http.StatusFound)
}

func handleToken(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	grantType := r.FormValue("grant_type")

	switch grantType {
	case "authorization_code":
		handleTokenAuthCode(w, r)
	case "refresh_token":
		handleTokenRefresh(w, r)
	default:
		http.Error(w, "unsupported grant_type", http.StatusBadRequest)
	}
}

func handleTokenAuthCode(w http.ResponseWriter, r *http.Request) {
	code := r.FormValue("code")
	codeVerifier := r.FormValue("code_verifier")
	clientID := r.FormValue("client_id")
	redirectURI := r.FormValue("redirect_uri")

	if code == "" || codeVerifier == "" || clientID == "" {
		http.Error(w, "missing required parameters", http.StatusBadRequest)
		return
	}

	ac, err := dynamo.GetAuthCode(r.Context(), code)
	if err != nil || ac == nil {
		http.Error(w, "invalid code", http.StatusBadRequest)
		return
	}

	// Validate PKCE
	h := sha256.Sum256([]byte(codeVerifier))
	expectedChallenge := base64.RawURLEncoding.EncodeToString(h[:])
	if expectedChallenge != ac.CodeChallenge {
		http.Error(w, "invalid code_verifier", http.StatusBadRequest)
		return
	}

	// Validate client_id and redirect_uri
	if ac.ClientID != clientID {
		http.Error(w, "client_id mismatch", http.StatusBadRequest)
		return
	}
	if redirectURI != "" && ac.RedirectURI != redirectURI {
		http.Error(w, "redirect_uri mismatch", http.StatusBadRequest)
		return
	}

	// Create an API key for the user
	label := fmt.Sprintf("OAuth: %s", clientID)
	rawKey, _, err := dynamo.CreateAPIKey(r.Context(), ac.UID, label)
	if err != nil {
		log.Printf("create api key: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"access_token": rawKey,
		"token_type":   "Bearer",
	})
}

func handleTokenRefresh(w http.ResponseWriter, r *http.Request) {
	refreshToken := r.FormValue("refresh_token")
	if refreshToken == "" {
		http.Error(w, "missing refresh_token", http.StatusBadRequest)
		return
	}

	// Exchange refresh token with Cognito
	body := url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {cognitoClient},
		"refresh_token": {refreshToken},
	}
	resp, err := http.Post(cognitoDomain+"/oauth2/token", "application/x-www-form-urlencoded", strings.NewReader(body.Encode()))
	if err != nil {
		log.Printf("cognito refresh: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		http.Error(w, "refresh failed", http.StatusUnauthorized)
		return
	}

	var tokens struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokens); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// Get user from new access token
	u, err := mcpauth.FromCognito(r.Context(), tokens.AccessToken)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// Create a fresh API key
	label := "OAuth: refresh"
	rawKey, _, err := dynamo.CreateAPIKey(r.Context(), u.Sub, label)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"access_token": rawKey,
		"token_type":   "Bearer",
	})
}

func handleRegister(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ClientName   string   `json:"client_name"`
		RedirectURIs []string `json:"redirect_uris"`
		GrantTypes   []string `json:"grant_types"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	if len(req.RedirectURIs) == 0 {
		http.Error(w, "redirect_uris required", http.StatusBadRequest)
		return
	}
	if len(req.GrantTypes) == 0 {
		req.GrantTypes = []string{"authorization_code", "refresh_token"}
	}

	clientID := uuid.New().String()
	c := dynamo.OAuthClient{
		ClientID:     clientID,
		ClientName:   req.ClientName,
		RedirectURIs: req.RedirectURIs,
		GrantTypes:   req.GrantTypes,
		CreatedAt:    time.Now().UTC().Format(time.RFC3339),
	}

	if err := dynamo.PutOAuthClient(r.Context(), c); err != nil {
		log.Printf("put oauth client: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{
		"client_id":     clientID,
		"client_name":   c.ClientName,
		"redirect_uris": c.RedirectURIs,
		"grant_types":   c.GrantTypes,
	})
}
