package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/BrianLeishman/justlog.io/go/dynamo"
	mcpauth "github.com/BrianLeishman/justlog.io/go/lambda/mcp/auth"
	"github.com/mark3labs/mcp-go/mcp"
)

func init() {
	Register(logExercise)
	Register(getExercise)
}

func logExercise(s *Spec) {
	s.Define("log_exercise",
		mcp.WithDescription("Log an exercise entry. Use this when the user tells you about a workout or physical activity."),
		mcp.WithReadOnlyHintAnnotation(false),
		mcp.WithOpenWorldHintAnnotation(false),
		mcp.WithDestructiveHintAnnotation(false),
		mcp.WithString("description", mcp.Description("What exercise was done, e.g. '30 min run'"), mcp.Required()),
		mcp.WithNumber("calories_burned", mcp.Description("Estimated calories burned")),
		mcp.WithNumber("duration_minutes", mcp.Description("Duration in minutes")),
		mcp.WithString("notes", mcp.Description("Optional notes")),
		mcp.WithString("timestamp", mcp.Description("ISO 8601 timestamp with timezone offset. IMPORTANT: call get_current_time first to get the correct time and offset. Example: 2026-02-08T17:30:00-05:00. Double-check AM vs PM."), mcp.Required()),
	)

	s.Handler(func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		uid, err := mcpauth.UserID(ctx)
		if err != nil {
			return nil, err
		}

		ts, err := parseTimestamp(req.GetString("timestamp", ""))
		if err != nil {
			return nil, err
		}

		entry := dynamo.Entry{
			UID:         uid,
			SK:          dynamo.MakeSK("exercise"),
			Type:        "exercise",
			Description: req.GetString("description", ""),
			Calories:    req.GetFloat("calories_burned", 0),
			Duration:    req.GetFloat("duration_minutes", 0),
			Notes:       req.GetString("notes", ""),
			CreatedAt:   ts.Format(time.RFC3339),
		}

		if err := dynamo.PutEntry(ctx, entry); err != nil {
			return nil, fmt.Errorf("save exercise entry: %w", err)
		}

		loc := userTimezone(ctx, uid)
		localTime := ts.In(loc).Format("Mon Jan 2 3:04 PM")

		return mcp.NewToolResultText(fmt.Sprintf("Logged exercise: %s at %s (%s)", entry.Description, localTime, loc.String())), nil
	})
}

func getExercise(s *Spec) {
	s.Define("get_exercise",
		mcp.WithDescription("Get exercise entries for a date range. Defaults to today."),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithOpenWorldHintAnnotation(false),
		mcp.WithDestructiveHintAnnotation(false),
		mcp.WithString("from", mcp.Description("Start date, ISO 8601 (e.g. 2026-02-05)")),
		mcp.WithString("to", mcp.Description("End date, ISO 8601 (e.g. 2026-02-05)")),
	)

	s.Handler(func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		uid, err := mcpauth.UserID(ctx)
		if err != nil {
			return nil, err
		}

		loc := userTimezone(ctx, uid)
		from, to := todayRange(loc)
		if v := req.GetString("from", ""); v != "" {
			t, err := time.ParseInLocation("2006-01-02", v, loc)
			if err != nil {
				return nil, fmt.Errorf("invalid from date: %w", err)
			}
			from = t.UTC()
		}
		if v := req.GetString("to", ""); v != "" {
			t, err := time.ParseInLocation("2006-01-02", v, loc)
			if err != nil {
				return nil, fmt.Errorf("invalid to date: %w", err)
			}
			to = t.AddDate(0, 0, 1).UTC()
		}

		entries, err := dynamo.GetEntries(ctx, uid, "exercise", from, to)
		if err != nil {
			return nil, err
		}

		if len(entries) == 0 {
			return mcp.NewToolResultText("No exercise entries found for that date range."), nil
		}

		b, _ := json.MarshalIndent(entries, "", "  ")
		return mcp.NewToolResultText(string(b)), nil
	})
}
