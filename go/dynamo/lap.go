package dynamo

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type Lap struct {
	PK           string  `dynamodbav:"pk" json:"-"`
	SK           string  `dynamodbav:"sk" json:"-"`
	SessionID    string  `dynamodbav:"sessionId" json:"session_id"`
	LapNo        int     `dynamodbav:"lapNo" json:"lap_no"`
	LapTimeMs    int64   `dynamodbav:"lapTimeMs" json:"lap_time_ms"`
	MaxSpeed     float64 `dynamodbav:"maxSpeed,omitempty" json:"max_speed,omitempty"`
	UID          string  `dynamodbav:"uid" json:"uid"`
	LayoutID     string  `dynamodbav:"layoutId,omitempty" json:"layout_id,omitempty"`
	KartClass    string  `dynamodbav:"kartClass,omitempty" json:"kart_class,omitempty"`
	KartID       string  `dynamodbav:"kartId,omitempty" json:"kart_id,omitempty"`
	Verified     bool    `dynamodbav:"verified" json:"verified"`
	S3Key        string  `dynamodbav:"s3Key,omitempty" json:"s3_key,omitempty"`
	TelemetryKey string  `dynamodbav:"telemetryKey,omitempty" json:"telemetry_key,omitempty"`
	GSI1PK       string  `dynamodbav:"gsi1pk,omitempty" json:"-"`
	GSI1SK       string  `dynamodbav:"gsi1sk,omitempty" json:"-"`
	CreatedAt    string  `dynamodbav:"createdAt" json:"created_at"`
}

func PutLap(ctx context.Context, l Lap) error {
	c, err := client()
	if err != nil {
		return err
	}

	l.PK = SessionPK(l.SessionID)
	l.SK = LapSK(l.UID, l.LapNo)

	item, err := attributevalue.MarshalMap(l)
	if err != nil {
		return fmt.Errorf("marshal lap: %w", err)
	}

	_, err = c.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(TableName),
		Item:      item,
	})
	return err
}

func GetLap(ctx context.Context, sessionID, uid string, lapNo int) (*Lap, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: SessionPK(sessionID)},
			"sk": &types.AttributeValueMemberS{Value: LapSK(uid, lapNo)},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("get lap: %w", err)
	}
	if out.Item == nil {
		return nil, nil
	}

	var l Lap
	if err := attributevalue.UnmarshalMap(out.Item, &l); err != nil {
		return nil, fmt.Errorf("unmarshal lap: %w", err)
	}
	return &l, nil
}

// ListLapsForSession returns all laps in a session ordered by lap number.
func ListLapsForSession(ctx context.Context, sessionID string) ([]Lap, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		KeyConditionExpression: aws.String("pk = :pk AND begins_with(sk, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":     &types.AttributeValueMemberS{Value: SessionPK(sessionID)},
			":prefix": &types.AttributeValueMemberS{Value: "LAP#"},
		},
		ScanIndexForward: aws.Bool(true),
	})
	if err != nil {
		return nil, fmt.Errorf("list laps: %w", err)
	}

	var all []Lap
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &all); err != nil {
		return nil, fmt.Errorf("unmarshal laps: %w", err)
	}
	// Filter out old-format laps (SK = LAP#000001) — new format is LAP#uid#000001
	laps := make([]Lap, 0, len(all))
	for _, l := range all {
		if IsNewFormatLapSK(l.SK) {
			laps = append(laps, l)
		}
	}
	return laps, nil
}

// DeleteLapsForUser deletes all laps belonging to a specific user in a session.
func DeleteLapsForUser(ctx context.Context, sessionID, uid string) (int, error) {
	c, err := client()
	if err != nil {
		return 0, err
	}

	// Query only this user's laps using the UID-scoped sort key prefix
	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		KeyConditionExpression: aws.String("pk = :pk AND begins_with(sk, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":     &types.AttributeValueMemberS{Value: SessionPK(sessionID)},
			":prefix": &types.AttributeValueMemberS{Value: LapSKPrefixUser(uid)},
		},
		ProjectionExpression: aws.String("pk, sk"),
	})
	if err != nil {
		return 0, fmt.Errorf("query user laps: %w", err)
	}

	deleted := 0
	for _, item := range out.Items {
		_, err := c.DeleteItem(ctx, &dynamodb.DeleteItemInput{
			TableName: aws.String(TableName),
			Key: map[string]types.AttributeValue{
				"pk": item["pk"],
				"sk": item["sk"],
			},
		})
		if err != nil {
			return deleted, fmt.Errorf("delete lap: %w", err)
		}
		deleted++
	}
	return deleted, nil
}

// QueryFastestLaps returns verified laps from the leaderboard GSI, sorted by time ascending.
func QueryFastestLaps(ctx context.Context, layoutID, class string, limit int32) ([]Lap, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		IndexName:              aws.String("gsi1"),
		KeyConditionExpression: aws.String("gsi1pk = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": &types.AttributeValueMemberS{Value: LeaderboardGSI1PK(layoutID, class)},
		},
		ScanIndexForward: aws.Bool(true),
		Limit:            aws.Int32(limit),
	})
	if err != nil {
		return nil, fmt.Errorf("query fastest laps: %w", err)
	}

	var laps []Lap
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &laps); err != nil {
		return nil, fmt.Errorf("unmarshal laps: %w", err)
	}
	return laps, nil
}

// VerifyLap marks a lap as verified and populates GSI1 attributes for the leaderboard.
func VerifyLap(ctx context.Context, sessionID, uid string, lapNo int, layoutID, class string) error {
	c, err := client()
	if err != nil {
		return err
	}

	lap, err := GetLap(ctx, sessionID, uid, lapNo)
	if err != nil {
		return err
	}
	if lap == nil {
		return fmt.Errorf("lap not found")
	}

	_, err = c.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: SessionPK(sessionID)},
			"sk": &types.AttributeValueMemberS{Value: LapSK(uid, lapNo)},
		},
		UpdateExpression: aws.String("SET verified = :v, gsi1pk = :gpk, gsi1sk = :gsk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":v":   &types.AttributeValueMemberBOOL{Value: true},
			":gpk": &types.AttributeValueMemberS{Value: LeaderboardGSI1PK(layoutID, class)},
			":gsk": &types.AttributeValueMemberS{Value: LeaderboardGSI1SK(lap.LapTimeMs)},
		},
	})
	return err
}
