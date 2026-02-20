package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/BrianLeishman/justlog.io/go/dynamo"
	mcpauth "github.com/BrianLeishman/justlog.io/go/lambda/mcp/auth"
	"github.com/mark3labs/mcp-go/mcp"
)

func init() {
	Register(getProfile)
	Register(updateProfile)
}

func getProfile(s *Spec) {
	s.SkipProfileCheck()
	s.Define("get_profile",
		mcp.WithDescription("Get the user's profile. The profile contains required information about the user that all other tools need. If any fields are missing, you MUST ask the user to fill them in before doing anything else."),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithOpenWorldHintAnnotation(false),
		mcp.WithDestructiveHintAnnotation(false),
	)

	s.Handler(func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		uid, err := mcpauth.UserID(ctx)
		if err != nil {
			return nil, err
		}

		p, err := dynamo.GetProfile(ctx, uid)
		if err != nil {
			return nil, fmt.Errorf("get profile: %w", err)
		}

		b, _ := json.MarshalIndent(p, "", "  ")
		return mcp.NewToolResultText(string(b)), nil
	})
}

func updateProfile(s *Spec) {
	s.SkipProfileCheck()
	opts := []mcp.ToolOption{
		mcp.WithDescription("Update the user's profile. Do NOT guess any answers — you MUST ask the user each question directly and use their exact response."),
	}
	for _, f := range dynamo.ProfileFields {
		opts = append(opts, mcp.WithString(f.Key, mcp.Description(f.Description)))
	}

	opts = append(opts,
		mcp.WithReadOnlyHintAnnotation(false),
		mcp.WithOpenWorldHintAnnotation(false),
		mcp.WithDestructiveHintAnnotation(false),
	)
	s.Define("update_profile", opts...)

	s.Handler(func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		uid, err := mcpauth.UserID(ctx)
		if err != nil {
			return nil, err
		}

		fields := map[string]string{}
		for _, f := range dynamo.ProfileFields {
			if v := req.GetString(f.Key, ""); v != "" {
				fields[f.Key] = v
			}
		}

		if len(fields) == 0 {
			return mcp.NewToolResultText("No fields provided."), nil
		}

		if err := dynamo.UpdateProfile(ctx, uid, fields); err != nil {
			return nil, fmt.Errorf("update profile: %w", err)
		}

		return mcp.NewToolResultText(fmt.Sprintf("Updated profile fields: %s", strings.Join(keys(fields), ", "))), nil
	})
}

func keys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
