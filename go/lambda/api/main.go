package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/BrianLeishman/justlog.io/go/dynamo"
	mcpauth "github.com/BrianLeishman/justlog.io/go/lambda/mcp/auth"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/awslabs/aws-lambda-go-api-proxy/httpadapter"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/token", handleToken)
	mux.HandleFunc("/api/profile", handleProfile)
	mux.HandleFunc("/", handleEntries)

	handler := cors(mux)

	if os.Getenv("AWS_LAMBDA_FUNCTION_NAME") != "" {
		adapter := httpadapter.NewV2(handler)
		lambda.Start(adapter.ProxyWithContext)
	} else {
		log.Println("API server listening on :8080")
		log.Fatal(http.ListenAndServe(":8080", handler))
	}
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func handleToken(w http.ResponseWriter, r *http.Request) {
	// Auth via Cognito access token (short-lived) to issue/revoke API key
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if token == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	u, err := mcpauth.FromToken(r.Context(), token)
	if err != nil {
		log.Printf("auth error: %v", err)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	switch r.Method {
	case http.MethodPost:
		var req struct {
			Label string `json:"label"`
		}
		if r.Body != nil {
			_ = json.NewDecoder(r.Body).Decode(&req)
		}
		if req.Label == "" {
			req.Label = "Web UI"
		}

		key, keyID, err := dynamo.CreateAPIKey(r.Context(), u.Sub, req.Label)
		if err != nil {
			log.Printf("create api key error: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"api_key": key,
			"key_id":  keyID,
		})

	case http.MethodGet:
		keys, err := dynamo.ListAPIKeys(r.Context(), u.Sub)
		if err != nil {
			log.Printf("list api keys error: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(keys)

	case http.MethodDelete:
		keyID := r.URL.Query().Get("id")
		if keyID == "" {
			http.Error(w, "id parameter required", http.StatusBadRequest)
			return
		}
		if err := dynamo.DeleteAPIKey(r.Context(), u.Sub, keyID); err != nil {
			log.Printf("delete api key error: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleEntries(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Auth
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if token == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	u, err := mcpauth.FromToken(r.Context(), token)
	if err != nil {
		log.Printf("auth error: %v", err)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// Parse query params
	q := r.URL.Query()
	entryType := q.Get("type")
	if entryType == "" {
		http.Error(w, "type parameter required (food, exercise, weight)", http.StatusBadRequest)
		return
	}

	loc := time.UTC
	if profile, err := dynamo.GetProfile(r.Context(), u.Sub); err == nil && profile != nil {
		loc = profile.Timezone()
	}

	now := time.Now().In(loc)
	from := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc).UTC()
	to := from.Add(24 * time.Hour)

	if v := q.Get("from"); v != "" {
		t, err := time.ParseInLocation("2006-01-02", v, loc)
		if err != nil {
			http.Error(w, "invalid from date", http.StatusBadRequest)
			return
		}
		from = t.UTC()
	}
	if v := q.Get("to"); v != "" {
		t, err := time.ParseInLocation("2006-01-02", v, loc)
		if err != nil {
			http.Error(w, "invalid to date", http.StatusBadRequest)
			return
		}
		to = t.AddDate(0, 0, 1).UTC()
	}

	entries, err := dynamo.GetEntries(r.Context(), u.Sub, entryType, from, to)
	if err != nil {
		log.Printf("dynamo error: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(entries)
}

func handleProfile(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if token == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	u, err := mcpauth.FromToken(r.Context(), token)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	switch r.Method {
	case http.MethodGet:
		profile, err := dynamo.GetProfile(r.Context(), u.Sub)
		if err != nil {
			log.Printf("get profile error: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(profile)

	case http.MethodPut:
		var fields map[string]string
		if err := json.NewDecoder(r.Body).Decode(&fields); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		if err := dynamo.UpdateProfile(r.Context(), u.Sub, fields); err != nil {
			log.Printf("update profile error: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
