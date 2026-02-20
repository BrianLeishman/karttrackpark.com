package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	_ "time/tzdata"

	mcpauth "github.com/BrianLeishman/justlog.io/go/lambda/mcp/auth"
	"github.com/BrianLeishman/justlog.io/go/lambda/mcp/tools"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/awslabs/aws-lambda-go-api-proxy/httpadapter"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

func main() {
	isLambda := os.Getenv("AWS_LAMBDA_FUNCTION_NAME") != ""

	mcpServer := server.NewMCPServer(
		"JustLog",
		"1.0.0",
		server.WithInstructions("JustLog helps users track calories, macros, exercise, and weight. Use the provided tools to log and retrieve entries."),
		server.WithRecovery(),
	)

	for _, t := range tools.All() {
		mcpServer.AddTool(t.Tool, wrapTool(t.Handler))
	}

	// stdio mode for local MCP clients (e.g. Claude Code)
	if os.Getenv("MCP_STDIO") != "" {
		ctx := context.Background()
		if devUser := os.Getenv("DEV_USER"); devUser != "" {
			ctx = mcpauth.NewContext(ctx, mcpauth.User{Sub: devUser, Email: devUser})
		}
		stdio := server.NewStdioServer(mcpServer)
		if err := stdio.Listen(ctx, os.Stdin, os.Stdout); err != nil {
			log.Fatal(err)
		}
		return
	}

	if isLambda {
		mux := http.NewServeMux()

		// OpenAI domain verification
		mux.HandleFunc("GET /.well-known/openai-apps-challenge", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/plain")
			w.Write([]byte("RiotatjG6D-VQ-7RnzdYBxIeWm8ZKSYTlDjxxIJupT4"))
		})

		// OAuth discovery
		mux.HandleFunc("GET /.well-known/oauth-protected-resource", handleProtectedResource)
		mux.HandleFunc("GET /.well-known/oauth-authorization-server", handleAuthServerMeta)

		// OAuth flow
		mux.HandleFunc("GET /oauth/authorize", handleAuthorize)
		mux.HandleFunc("GET /oauth/callback", handleCallback)
		mux.HandleFunc("POST /oauth/token", handleToken)
		mux.HandleFunc("POST /oauth/register", handleRegister)

		// MCP JSON-RPC
		mux.HandleFunc("POST /mcp", func(w http.ResponseWriter, r *http.Request) {
			handleMCP(w, r, mcpServer)
		})

		// Catch-all for MCP at root (backwards compat)
		mux.HandleFunc("POST /", func(w http.ResponseWriter, r *http.Request) {
			handleMCP(w, r, mcpServer)
		})

		// Default: 404
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			log.Printf("unhandled: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		})

		adapter := httpadapter.NewV2(mux)
		lambda.Start(adapter.ProxyWithContext)
	} else {
		// Local: use StreamableHTTPServer for full MCP protocol support
		httpServer := server.NewStreamableHTTPServer(
			mcpServer,
			server.WithStateLess(true),
			server.WithHTTPContextFunc(authenticateRequest),
		)

		addr := ":8088"
		fmt.Printf("MCP server listening on %s\n", addr)
		if err := httpServer.Start(addr); err != nil {
			log.Fatal(err)
		}
	}
}

func handleMCP(w http.ResponseWriter, r *http.Request, mcpServer *server.MCPServer) {
	log.Printf("request: %s %s", r.Method, r.URL.Path)

	ctx := r.Context()
	ctx = authenticateRequest(ctx, r)

	// Check auth — return 401 with WWW-Authenticate if not authenticated
	if _, err := mcpauth.FromContext(ctx); err != nil {
		w.Header().Set("WWW-Authenticate", fmt.Sprintf(`Bearer resource_metadata="%s/.well-known/oauth-protected-resource"`, baseURL))
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	log.Printf("request body: %s", body)

	resp := mcpServer.HandleMessage(ctx, body)
	w.Header().Set("Content-Type", "application/json")
	out, _ := json.Marshal(resp)
	log.Printf("response: %s", out)
	w.Write(out)
}

func authenticateRequest(ctx context.Context, r *http.Request) context.Context {
	if devUser := os.Getenv("DEV_USER"); devUser != "" {
		return mcpauth.NewContext(ctx, mcpauth.User{Sub: devUser, Email: devUser})
	}

	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if token == "" {
		return ctx
	}
	u, err := mcpauth.FromToken(ctx, token)
	if err != nil {
		log.Printf("auth error: %v", err)
		return ctx
	}
	return mcpauth.NewContext(ctx, u)
}

func wrapTool(fn server.ToolHandlerFunc) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (result *mcp.CallToolResult, err error) {
		defer func() {
			if r := recover(); r != nil {
				result = mcp.NewToolResultError(fmt.Sprintf("internal error: %v", r))
				err = nil
			}
		}()

		result, err = fn(ctx, req)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return result, nil
	}
}
