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
	Register(logFood)
	Register(getFood)
}

func logFood(s *Spec) {
	s.Define("log_food",
		mcp.WithDescription("Log a food entry with nutritional info. Use this when the user tells you what they ate."),
		mcp.WithReadOnlyHintAnnotation(false),
		mcp.WithOpenWorldHintAnnotation(false),
		mcp.WithDestructiveHintAnnotation(false),
		mcp.WithString("description", mcp.Description("What was eaten, e.g. '2 eggs and toast'"), mcp.Required()),
		mcp.WithNumber("calories", mcp.Description("Total calories")),
		mcp.WithNumber("protein", mcp.Description("Protein in grams")),
		mcp.WithNumber("carbs", mcp.Description("Total carbohydrates in grams")),
		mcp.WithNumber("net_carbs", mcp.Description("Net carbs in grams (total carbs minus fiber and non-impact carbs like sugar alcohols). Not always simply carbs minus fiber — estimate based on the food.")),
		mcp.WithNumber("fat", mcp.Description("Fat in grams")),
		mcp.WithNumber("fiber", mcp.Description("Fiber in grams")),
		mcp.WithNumber("caffeine", mcp.Description("Caffeine in milligrams")),
		mcp.WithNumber("cholesterol", mcp.Description("Cholesterol in milligrams")),
		mcp.WithNumber("sodium", mcp.Description("Sodium in milligrams")),
		mcp.WithNumber("sugar", mcp.Description("Sugar in grams")),
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
			SK:          dynamo.MakeSK("food"),
			Type:        "food",
			Description: req.GetString("description", ""),
			Calories:    req.GetFloat("calories", 0),
			Protein:     req.GetFloat("protein", 0),
			Carbs:       req.GetFloat("carbs", 0),
			NetCarbs:    req.GetFloat("net_carbs", 0),
			Fat:         req.GetFloat("fat", 0),
			Fiber:       req.GetFloat("fiber", 0),
			Caffeine:    req.GetFloat("caffeine", 0),
			Cholesterol: req.GetFloat("cholesterol", 0),
			Sodium:      req.GetFloat("sodium", 0),
			Sugar:       req.GetFloat("sugar", 0),
			Notes:       req.GetString("notes", ""),
			CreatedAt:   ts.Format(time.RFC3339),
		}

		if err := dynamo.PutEntry(ctx, entry); err != nil {
			return nil, fmt.Errorf("save food entry: %w", err)
		}

		loc := userTimezone(ctx, uid)
		localTime := ts.In(loc).Format("Mon Jan 2 3:04 PM")

		// Fetch today's totals
		now := time.Now().In(loc)
		dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc).UTC()
		dayEnd := dayStart.Add(24 * time.Hour)
		todayFood, _ := dynamo.GetEntries(ctx, uid, "food", dayStart, dayEnd)
		var totCal, totP, totC, totNC, totFat, totFiber float64
		for _, e := range todayFood {
			totCal += e.Calories
			totP += e.Protein
			totC += e.Carbs
			totNC += e.NetCarbs
			totFat += e.Fat
			totFiber += e.Fiber
		}

		return mcp.NewToolResultText(fmt.Sprintf(
			"Logged food: %s (%.0f cal) at %s (%s)\n\nDaily totals: %.0f cal | %.0fg protein | %.0fg carbs | %.0fg net carbs | %.0fg fat | %.0fg fiber",
			entry.Description, entry.Calories, localTime, loc.String(),
			totCal, totP, totC, totNC, totFat, totFiber,
		)), nil
	})
}

func getFood(s *Spec) {
	s.Define("get_food",
		mcp.WithDescription("Get food entries for a date range. Defaults to today."),
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

		entries, err := dynamo.GetEntries(ctx, uid, "food", from, to)
		if err != nil {
			return nil, err
		}

		if len(entries) == 0 {
			return mcp.NewToolResultText("No food entries found for that date range."), nil
		}

		b, _ := json.MarshalIndent(entries, "", "  ")
		return mcp.NewToolResultText(string(b)), nil
	})
}

func parseTimestamp(v string) (time.Time, error) {
	if v == "" {
		return time.Now().UTC(), nil
	}
	t, err := time.Parse(time.RFC3339, v)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid timestamp: %w", err)
	}
	return t.UTC(), nil
}

func todayRange(loc *time.Location) (time.Time, time.Time) {
	now := time.Now().In(loc)
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc).UTC()
	end := start.Add(24 * time.Hour)
	return start, end
}

func userTimezone(ctx context.Context, uid string) *time.Location {
	profile, err := dynamo.GetProfile(ctx, uid)
	if err != nil || profile == nil {
		return time.UTC
	}
	return profile.Timezone()
}
