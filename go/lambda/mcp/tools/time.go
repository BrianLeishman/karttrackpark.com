package tools

import (
	"context"
	"fmt"
	"time"

	mcpauth "github.com/BrianLeishman/justlog.io/go/lambda/mcp/auth"
	"github.com/mark3labs/mcp-go/mcp"
)

func init() {
	Register(getCurrentTime)
}

func getCurrentTime(s *Spec) {
	s.Define("get_current_time",
		mcp.WithDescription("Get the current date and time in the user's timezone. Call this BEFORE any logging tool to get an accurate timestamp."),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithOpenWorldHintAnnotation(false),
		mcp.WithDestructiveHintAnnotation(false),
	)
	s.SkipProfileCheck()

	s.Handler(func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		uid, err := mcpauth.UserID(ctx)
		if err != nil {
			return nil, err
		}

		loc := userTimezone(ctx, uid)
		now := time.Now().In(loc)

		return mcp.NewToolResultText(fmt.Sprintf(
			"Current time: %s\nTimezone: %s\nUTC: %s\n\nUse this to construct timestamps for logging tools. Format: %s",
			now.Format("2006-01-02T15:04:05-07:00"),
			loc.String(),
			now.UTC().Format(time.RFC3339),
			now.Format("2006-01-02T15:04:05-07:00"),
		)), nil
	})
}
