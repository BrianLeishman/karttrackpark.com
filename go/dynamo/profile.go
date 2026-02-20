package dynamo

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// ProfileField defines a required profile question.
type ProfileField struct {
	Key         string // DynamoDB attribute name
	Label       string // Human-readable label
	Description string // Prompt for the AI to ask the user
}

// ProfileFields is the canonical list of required profile fields.
// Adding a new entry here automatically makes it required.
var ProfileFields = []ProfileField{
	{Key: "height", Label: "Height", Description: "What is your height? (e.g. 5'10\", 178cm)"},
	{Key: "ideal_weight", Label: "Ideal weight", Description: "What is your ideal/goal weight? (e.g. 180 lbs, 82 kg)"},
	{Key: "diet", Label: "Diet", Description: "Are you on a diet or would like to be? If so, what diet? (e.g. keto, Mediterranean, calorie counting, none)"},
	{Key: "goal", Label: "Goal", Description: "What is your reason for using this app? (e.g. weight loss, muscle gain, general health tracking)"},
	{Key: "lifestyle", Label: "Lifestyle", Description: "How does your typical day look? Do you work at a desk? Are you usually active? (e.g. sedentary office job, active construction work, stay-at-home parent)"},
	{Key: "birthdate", Label: "Birthdate", Description: "What is your date of birth? (e.g. 1990-05-15, March 3 1985)"},
	{Key: "sex", Label: "Sex", Description: "What is your biological sex? (male or female) This is used for metabolic calculations."},
	{Key: "timezone", Label: "Timezone", Description: "What is your timezone? (e.g. America/New_York, America/Chicago, Europe/London). Must be a valid IANA timezone identifier."},
}

// AutoFields are set automatically (not asked by AI). They are still required.
var AutoFields = []ProfileField{}

// AllRequiredFields returns both user-facing and auto fields.
func AllRequiredFields() []ProfileField {
	return append(ProfileFields, AutoFields...)
}

// Timezone returns the user's timezone location, falling back to UTC.
func (p Profile) Timezone() *time.Location {
	tz := p["timezone"]
	if tz == "" {
		return time.UTC
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return time.UTC
	}
	return loc
}

// Age returns the user's age in years based on their birthdate, or -1 if unknown.
func (p Profile) Age(now time.Time) int {
	raw := p["birthdate"]
	if raw == "" {
		return -1
	}
	// Try common formats
	var bd time.Time
	var err error
	for _, fmt := range []string{"2006-01-02", "January 2 2006", "Jan 2 2006", "01/02/2006", "1/2/2006"} {
		bd, err = time.Parse(fmt, raw)
		if err == nil {
			break
		}
	}
	if err != nil {
		return -1
	}
	age := now.Year() - bd.Year()
	if now.YearDay() < bd.YearDay() {
		age--
	}
	return age
}

// Profile is a map of field key to value.
type Profile map[string]string

// MissingFields returns the user-facing fields that are empty or missing.
// Auto fields (like timezone) are not included since they're set programmatically.
func (p Profile) MissingFields() []ProfileField {
	var missing []ProfileField
	for _, f := range ProfileFields {
		if p[f.Key] == "" {
			missing = append(missing, f)
		}
	}
	return missing
}

func GetProfile(ctx context.Context, uid string) (Profile, error) {
	db, err := Client()
	if err != nil {
		return nil, err
	}

	out, err := db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"uid": &types.AttributeValueMemberS{Value: uid},
			"sk":  &types.AttributeValueMemberS{Value: "profile"},
		},
	})
	if err != nil {
		return nil, err
	}

	p := Profile{}
	if out.Item == nil {
		return p, nil
	}

	var raw map[string]string
	if err := attributevalue.UnmarshalMap(out.Item, &raw); err != nil {
		return nil, fmt.Errorf("unmarshal profile: %w", err)
	}

	for _, f := range AllRequiredFields() {
		if v, ok := raw[f.Key]; ok {
			p[f.Key] = v
		}
	}
	return p, nil
}

func UpdateProfile(ctx context.Context, uid string, fields map[string]string) error {
	if len(fields) == 0 {
		return nil
	}

	if tz, ok := fields["timezone"]; ok {
		if _, err := time.LoadLocation(tz); err != nil {
			return fmt.Errorf("invalid timezone %q: must be a valid IANA timezone (e.g. America/New_York)", tz)
		}
	}

	if sex, ok := fields["sex"]; ok {
		if sex != "male" && sex != "female" {
			return fmt.Errorf("invalid sex %q: must be \"male\" or \"female\"", sex)
		}
	}

	if bd, ok := fields["birthdate"]; ok {
		if _, err := time.Parse("2006-01-02", bd); err != nil {
			return fmt.Errorf("invalid birthdate %q: must be YYYY-MM-DD format", bd)
		}
	}

	db, err := Client()
	if err != nil {
		return err
	}

	expr := "SET "
	names := map[string]string{}
	values := map[string]types.AttributeValue{}
	i := 0
	for k, v := range fields {
		if i > 0 {
			expr += ", "
		}
		alias := fmt.Sprintf("#f%d", i)
		placeholder := fmt.Sprintf(":v%d", i)
		expr += alias + " = " + placeholder
		names[alias] = k
		values[placeholder] = &types.AttributeValueMemberS{Value: v}
		i++
	}

	_, err = db.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"uid": &types.AttributeValueMemberS{Value: uid},
			"sk":  &types.AttributeValueMemberS{Value: "profile"},
		},
		UpdateExpression:          aws.String(expr),
		ExpressionAttributeNames:  names,
		ExpressionAttributeValues: values,
	})
	return err
}
