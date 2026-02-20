package tools

import (
	"context"
	"fmt"
	"strings"

	"github.com/BrianLeishman/justlog.io/go/dynamo"
	mcpauth "github.com/BrianLeishman/justlog.io/go/lambda/mcp/auth"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

type Spec struct {
	tool           mcp.Tool
	handler        server.ToolHandlerFunc
	skipProfileReq bool
}

func (s *Spec) Define(name string, opts ...mcp.ToolOption) {
	s.tool = mcp.NewTool(name, opts...)
}

func (s *Spec) Handler(fn func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error)) {
	s.handler = fn
}

// SkipProfileCheck marks this tool as exempt from the profile completeness requirement.
func (s *Spec) SkipProfileCheck() {
	s.skipProfileReq = true
}

var registry []Spec

func Register(fn func(*Spec)) {
	var s Spec
	fn(&s)
	registry = append(registry, s)
}

func All() []server.ServerTool {
	out := make([]server.ServerTool, len(registry))
	for i, s := range registry {
		handler := s.handler
		if !s.skipProfileReq {
			handler = withProfileCheck(handler)
		}
		handler = withContext(handler)
		out[i] = server.ServerTool{Tool: s.tool, Handler: handler}
	}
	return out
}

func withContext(next server.ToolHandlerFunc) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		uid, err := mcpauth.UserID(ctx)
		if err != nil {
			return next(ctx, req)
		}

		result, err := next(ctx, req)
		if err != nil || result == nil {
			return result, err
		}

		summary := buildContext(ctx, uid)

		// Prepend context to the first text content block
		for i, c := range result.Content {
			if tc, ok := c.(mcp.TextContent); ok {
				tc.Text = summary + tc.Text
				result.Content[i] = tc
				break
			}
		}

		return result, err
	}
}

func withProfileCheck(next server.ToolHandlerFunc) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		uid, err := mcpauth.UserID(ctx)
		if err != nil {
			return nil, err
		}

		p, err := dynamo.GetProfile(ctx, uid)
		if err != nil {
			return nil, fmt.Errorf("check profile: %w", err)
		}

		missing := p.MissingFields()
		if len(missing) > 0 {
			var lines []string
			lines = append(lines, "PROFILE INCOMPLETE — you must ask the user the following questions before proceeding. Do NOT guess; ask each one directly and save their answers with the update_profile tool.\n")
			for _, f := range missing {
				lines = append(lines, fmt.Sprintf("- %s: %s", f.Label, f.Description))
			}
			result := mcp.NewToolResultText(strings.Join(lines, "\n"))
			result.IsError = true
			return result, nil
		}

		return next(ctx, req)
	}
}
