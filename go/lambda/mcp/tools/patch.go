package tools

import (
	"context"
	"fmt"
	"time"

	"github.com/BrianLeishman/justlog.io/go/dynamo"
	mcpauth "github.com/BrianLeishman/justlog.io/go/lambda/mcp/auth"
	"github.com/mark3labs/mcp-go/mcp"
)

func init() {
	Register(updateFood)
	Register(updateExercise)
	Register(updateWeight)
	Register(deleteEntry)
}

func updateFood(s *Spec) {
	s.Define("update_food",
		mcp.WithDescription("Update an existing food entry. Pass the entry's sk (sort key) and any fields to change."),
		mcp.WithReadOnlyHintAnnotation(false),
		mcp.WithOpenWorldHintAnnotation(false),
		mcp.WithDestructiveHintAnnotation(false),
		mcp.WithString("sk", mcp.Description("The sort key of the entry to update"), mcp.Required()),
		mcp.WithString("description", mcp.Description("New description")),
		mcp.WithNumber("calories", mcp.Description("New calories")),
		mcp.WithNumber("protein", mcp.Description("New protein in grams")),
		mcp.WithNumber("carbs", mcp.Description("New carbs in grams")),
		mcp.WithNumber("net_carbs", mcp.Description("New net carbs in grams")),
		mcp.WithNumber("fat", mcp.Description("New fat in grams")),
		mcp.WithNumber("fiber", mcp.Description("New fiber in grams")),
		mcp.WithNumber("caffeine", mcp.Description("New caffeine in mg")),
		mcp.WithNumber("cholesterol", mcp.Description("New cholesterol in mg")),
		mcp.WithNumber("sodium", mcp.Description("New sodium in mg")),
		mcp.WithNumber("sugar", mcp.Description("New sugar in grams")),
		mcp.WithString("timestamp", mcp.Description("New ISO 8601 timestamp")),
		mcp.WithString("notes", mcp.Description("New notes")),
	)

	s.Handler(func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		uid, err := mcpauth.UserID(ctx)
		if err != nil {
			return nil, err
		}

		sk := req.GetString("sk", "")
		fields := map[string]interface{}{}

		if v := req.GetString("description", ""); v != "" {
			fields["description"] = v
		}
		setFloat(fields, req, "calories", "calories")
		setFloat(fields, req, "protein", "protein")
		setFloat(fields, req, "carbs", "carbs")
		setFloat(fields, req, "net_carbs", "netCarbs")
		setFloat(fields, req, "fat", "fat")
		setFloat(fields, req, "fiber", "fiber")
		setFloat(fields, req, "caffeine", "caffeine")
		setFloat(fields, req, "cholesterol", "cholesterol")
		setFloat(fields, req, "sodium", "sodium")
		setFloat(fields, req, "sugar", "sugar")
		if v := req.GetString("notes", ""); v != "" {
			fields["notes"] = v
		}
		if v := req.GetString("timestamp", ""); v != "" {
			ts, err := parseTimestamp(v)
			if err != nil {
				return nil, err
			}
			fields["createdAt"] = ts.Format(time.RFC3339)
		}

		if len(fields) == 0 {
			return mcp.NewToolResultText("No fields to update."), nil
		}

		if err := dynamo.UpdateEntry(ctx, uid, sk, fields); err != nil {
			return nil, fmt.Errorf("update food entry: %w", err)
		}

		return mcp.NewToolResultText(fmt.Sprintf("Updated food entry %s", sk)), nil
	})
}

func updateExercise(s *Spec) {
	s.Define("update_exercise",
		mcp.WithDescription("Update an existing exercise entry. Pass the entry's sk (sort key) and any fields to change."),
		mcp.WithReadOnlyHintAnnotation(false),
		mcp.WithOpenWorldHintAnnotation(false),
		mcp.WithDestructiveHintAnnotation(false),
		mcp.WithString("sk", mcp.Description("The sort key of the entry to update"), mcp.Required()),
		mcp.WithString("description", mcp.Description("New description")),
		mcp.WithNumber("calories_burned", mcp.Description("New calories burned")),
		mcp.WithNumber("duration_minutes", mcp.Description("New duration in minutes")),
		mcp.WithString("timestamp", mcp.Description("New ISO 8601 timestamp")),
		mcp.WithString("notes", mcp.Description("New notes")),
	)

	s.Handler(func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		uid, err := mcpauth.UserID(ctx)
		if err != nil {
			return nil, err
		}

		sk := req.GetString("sk", "")
		fields := map[string]interface{}{}

		if v := req.GetString("description", ""); v != "" {
			fields["description"] = v
		}
		setFloat(fields, req, "calories_burned", "calories")
		setFloat(fields, req, "duration_minutes", "duration")
		if v := req.GetString("notes", ""); v != "" {
			fields["notes"] = v
		}
		if v := req.GetString("timestamp", ""); v != "" {
			ts, err := parseTimestamp(v)
			if err != nil {
				return nil, err
			}
			fields["createdAt"] = ts.Format(time.RFC3339)
		}

		if len(fields) == 0 {
			return mcp.NewToolResultText("No fields to update."), nil
		}

		if err := dynamo.UpdateEntry(ctx, uid, sk, fields); err != nil {
			return nil, fmt.Errorf("update exercise entry: %w", err)
		}

		return mcp.NewToolResultText(fmt.Sprintf("Updated exercise entry %s", sk)), nil
	})
}

func updateWeight(s *Spec) {
	s.Define("update_weight",
		mcp.WithDescription("Update an existing weight entry. Pass the entry's sk (sort key) and any fields to change."),
		mcp.WithReadOnlyHintAnnotation(false),
		mcp.WithOpenWorldHintAnnotation(false),
		mcp.WithDestructiveHintAnnotation(false),
		mcp.WithString("sk", mcp.Description("The sort key of the entry to update"), mcp.Required()),
		mcp.WithNumber("value", mcp.Description("New weight value")),
		mcp.WithString("unit", mcp.Description("New unit: lbs or kg")),
		mcp.WithString("timestamp", mcp.Description("New ISO 8601 timestamp")),
		mcp.WithString("notes", mcp.Description("New notes")),
	)

	s.Handler(func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		uid, err := mcpauth.UserID(ctx)
		if err != nil {
			return nil, err
		}

		sk := req.GetString("sk", "")
		fields := map[string]interface{}{}

		setFloat(fields, req, "value", "value")
		if v := req.GetString("unit", ""); v != "" {
			fields["unit"] = v
		}
		if v := req.GetString("notes", ""); v != "" {
			fields["notes"] = v
		}
		if v := req.GetString("timestamp", ""); v != "" {
			ts, err := parseTimestamp(v)
			if err != nil {
				return nil, err
			}
			fields["createdAt"] = ts.Format(time.RFC3339)
		}

		if len(fields) == 0 {
			return mcp.NewToolResultText("No fields to update."), nil
		}

		if err := dynamo.UpdateEntry(ctx, uid, sk, fields); err != nil {
			return nil, fmt.Errorf("update weight entry: %w", err)
		}

		return mcp.NewToolResultText(fmt.Sprintf("Updated weight entry %s", sk)), nil
	})
}

func deleteEntry(s *Spec) {
	s.Define("delete_entry",
		mcp.WithDescription("Delete an entry by its sort key."),
		mcp.WithReadOnlyHintAnnotation(false),
		mcp.WithOpenWorldHintAnnotation(false),
		mcp.WithDestructiveHintAnnotation(true),
		mcp.WithString("sk", mcp.Description("The sort key of the entry to delete"), mcp.Required()),
	)

	s.Handler(func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		uid, err := mcpauth.UserID(ctx)
		if err != nil {
			return nil, err
		}

		sk := req.GetString("sk", "")
		if err := dynamo.DeleteEntry(ctx, uid, sk); err != nil {
			return nil, fmt.Errorf("delete entry: %w", err)
		}

		return mcp.NewToolResultText(fmt.Sprintf("Deleted entry %s", sk)), nil
	})
}

// setFloat adds a float field to the update map only if the parameter was explicitly provided.
// We check for non-zero since MCP GetFloat returns 0 as default.
func setFloat(fields map[string]interface{}, req mcp.CallToolRequest, param, dbField string) {
	if v := req.GetFloat(param, 0); v != 0 {
		fields[dbField] = v
	}
}
