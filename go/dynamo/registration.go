package dynamo

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type RegistrationSettings struct {
	RegistrationMode     string `dynamodbav:"registrationMode,omitempty" json:"registration_mode,omitempty"`
	MaxSpots             int    `dynamodbav:"maxSpots,omitempty" json:"max_spots,omitempty"`
	PriceCents           int    `dynamodbav:"priceCents,omitempty" json:"price_cents,omitempty"`
	Currency             string `dynamodbav:"currency,omitempty" json:"currency,omitempty"`
	RegistrationDeadline string `dynamodbav:"registrationDeadline,omitempty" json:"registration_deadline,omitempty"`
}

type ScoringConfig struct {
	Method       string `dynamodbav:"method,omitempty" json:"method,omitempty"`
	PointsScheme []int  `dynamodbav:"pointsScheme,omitempty" json:"points_scheme,omitempty"`
	DropRounds   int    `dynamodbav:"dropRounds,omitempty" json:"drop_rounds,omitempty"`
	Tiebreaker   string `dynamodbav:"tiebreaker,omitempty" json:"tiebreaker,omitempty"`
}

type Registration struct {
	PK         string `dynamodbav:"pk" json:"-"`
	SK         string `dynamodbav:"sk" json:"-"`
	ParentType string `dynamodbav:"parentType" json:"parent_type"`
	ParentID   string `dynamodbav:"parentId" json:"parent_id"`
	TrackID    string `dynamodbav:"trackId" json:"track_id"`
	UID        string `dynamodbav:"uid" json:"uid"`
	Email      string `dynamodbav:"email,omitempty" json:"email,omitempty"`
	DriverName string `dynamodbav:"driverName" json:"driver_name"`
	Status     string `dynamodbav:"status" json:"status"`
	Paid       bool   `dynamodbav:"paid,omitempty" json:"paid,omitempty"`
	PriceCents int    `dynamodbav:"priceCents,omitempty" json:"price_cents,omitempty"`
	InvitedBy  string `dynamodbav:"invitedBy,omitempty" json:"invited_by,omitempty"`

	Standings map[string]any `dynamodbav:"standings,omitempty" json:"standings,omitempty"`

	GSI2PK string `dynamodbav:"gsi2pk,omitempty" json:"-"`
	GSI2SK string `dynamodbav:"gsi2sk,omitempty" json:"-"`

	RegisteredAt string `dynamodbav:"registeredAt" json:"registered_at"`
	CreatedAt    string `dynamodbav:"createdAt" json:"created_at"`
}

func parentPK(parentType, parentID string) string {
	switch parentType {
	case "series":
		return SeriesPK(parentID)
	case "event":
		return EventPK(parentID)
	case "session":
		return SessionPK(parentID)
	default:
		return parentType + "#" + parentID
	}
}

func CreateRegistration(ctx context.Context, reg Registration) (*Registration, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	pk := parentPK(reg.ParentType, reg.ParentID)
	reg.PK = pk
	reg.SK = RegSK(reg.UID)
	reg.GSI2PK = UserRegGSI2PK(reg.UID)
	reg.GSI2SK = pk
	now := time.Now().UTC().Format(time.RFC3339)
	if reg.RegisteredAt == "" {
		reg.RegisteredAt = now
	}
	reg.CreatedAt = now

	item, err := attributevalue.MarshalMap(reg)
	if err != nil {
		return nil, fmt.Errorf("marshal registration: %w", err)
	}

	_, err = c.PutItem(ctx, &dynamodb.PutItemInput{
		TableName:           aws.String(TableName),
		Item:                item,
		ConditionExpression: aws.String("attribute_not_exists(pk)"),
	})
	if err != nil {
		return nil, fmt.Errorf("create registration: %w", err)
	}
	return &reg, nil
}

func GetRegistration(ctx context.Context, parentType, parentID, uid string) (*Registration, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: parentPK(parentType, parentID)},
			"sk": &types.AttributeValueMemberS{Value: RegSK(uid)},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("get registration: %w", err)
	}
	if out.Item == nil {
		return nil, nil
	}

	var reg Registration
	if err := attributevalue.UnmarshalMap(out.Item, &reg); err != nil {
		return nil, fmt.Errorf("unmarshal registration: %w", err)
	}
	return &reg, nil
}

func ListRegistrations(ctx context.Context, parentType, parentID string) ([]Registration, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		KeyConditionExpression: aws.String("pk = :pk AND begins_with(sk, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":     &types.AttributeValueMemberS{Value: parentPK(parentType, parentID)},
			":prefix": &types.AttributeValueMemberS{Value: "REG#"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("list registrations: %w", err)
	}

	var regs []Registration
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &regs); err != nil {
		return nil, fmt.Errorf("unmarshal registrations: %w", err)
	}
	return regs, nil
}

func CountRegistrations(ctx context.Context, parentType, parentID string) (int, error) {
	c, err := client()
	if err != nil {
		return 0, err
	}

	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		KeyConditionExpression: aws.String("pk = :pk AND begins_with(sk, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":     &types.AttributeValueMemberS{Value: parentPK(parentType, parentID)},
			":prefix": &types.AttributeValueMemberS{Value: "REG#"},
		},
		Select: types.SelectCount,
	})
	if err != nil {
		return 0, fmt.Errorf("count registrations: %w", err)
	}
	return int(out.Count), nil
}

func UpdateRegistration(ctx context.Context, parentType, parentID, uid string, fields map[string]any) error {
	if len(fields) == 0 {
		return nil
	}

	c, err := client()
	if err != nil {
		return err
	}

	expr, names, values, err := BuildUpdateExpression(fields)
	if err != nil {
		return err
	}

	_, err = c.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: parentPK(parentType, parentID)},
			"sk": &types.AttributeValueMemberS{Value: RegSK(uid)},
		},
		UpdateExpression:          aws.String(expr),
		ExpressionAttributeNames:  names,
		ExpressionAttributeValues: values,
	})
	return err
}

func DeleteRegistration(ctx context.Context, parentType, parentID, uid string) error {
	c, err := client()
	if err != nil {
		return err
	}

	_, err = c.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: parentPK(parentType, parentID)},
			"sk": &types.AttributeValueMemberS{Value: RegSK(uid)},
		},
	})
	return err
}

// FindRegistrationByEmail scans registrations under a parent for one matching the given email.
// Used to find invite-by-email registrations when the user later creates an account.
func FindRegistrationByEmail(ctx context.Context, parentType, parentID, email string) (*Registration, error) {
	regs, err := ListRegistrations(ctx, parentType, parentID)
	if err != nil {
		return nil, err
	}
	lower := strings.ToLower(email)
	for i := range regs {
		if strings.ToLower(regs[i].Email) == lower {
			return &regs[i], nil
		}
	}
	return nil, nil
}

func ListUserRegistrations(ctx context.Context, uid, filterType string) ([]Registration, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	input := &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		IndexName:              aws.String("gsi2"),
		KeyConditionExpression: aws.String("gsi2pk = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": &types.AttributeValueMemberS{Value: UserRegGSI2PK(uid)},
		},
	}

	if filterType != "" {
		input.FilterExpression = aws.String("parentType = :pt")
		input.ExpressionAttributeValues[":pt"] = &types.AttributeValueMemberS{Value: filterType}
	}

	out, err := c.Query(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("list user registrations: %w", err)
	}

	var regs []Registration
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &regs); err != nil {
		return nil, fmt.Errorf("unmarshal user registrations: %w", err)
	}
	return regs, nil
}
