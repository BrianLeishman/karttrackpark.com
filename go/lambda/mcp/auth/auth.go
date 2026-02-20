package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/BrianLeishman/justlog.io/go/dynamo"
)

type contextKey struct{}

type User struct {
	Sub     string `json:"sub"`
	Email   string `json:"email"`
	Name    string `json:"username"`
	Picture string `json:"picture"`
}

const cognitoDomain = "https://justlog.auth.us-east-1.amazoncognito.com"

func FromToken(ctx context.Context, accessToken string) (User, error) {
	// Try API key lookup first
	if uid, err := dynamo.LookupAPIKey(ctx, accessToken); err == nil {
		return User{Sub: uid}, nil
	}

	// Fall back to Cognito access token
	return FromCognito(ctx, accessToken)
}

func FromCognito(ctx context.Context, accessToken string) (User, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cognitoDomain+"/oauth2/userInfo", nil)
	if err != nil {
		return User{}, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return User{}, fmt.Errorf("cognito userInfo: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return User{}, fmt.Errorf("cognito userInfo returned %d", resp.StatusCode)
	}

	var u User
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		return User{}, fmt.Errorf("decode userInfo: %w", err)
	}
	return u, nil
}

func NewContext(ctx context.Context, u User) context.Context {
	return context.WithValue(ctx, contextKey{}, u)
}

func FromContext(ctx context.Context) (User, error) {
	u, ok := ctx.Value(contextKey{}).(User)
	if !ok {
		return User{}, errors.New("unauthorized")
	}
	return u, nil
}

func UserID(ctx context.Context) (string, error) {
	u, err := FromContext(ctx)
	if err != nil {
		return "", err
	}
	return u.Sub, nil
}
