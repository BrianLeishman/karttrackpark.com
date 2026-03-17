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

	// Always populate GSI1 for leaderboard queries when we have a layout
	if l.LayoutID != "" && l.LapTimeMs > 0 {
		l.GSI1PK = LeaderboardGSI1PK(l.LayoutID, l.KartClass)
		l.GSI1SK = LeaderboardGSI1SK(l.LapTimeMs)
	}

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

// ListAllLapsForSession returns all laps in a session including old-format ones.
// Used by reprocessing to find and migrate legacy laps.
func ListAllLapsForSession(ctx context.Context, sessionID string) ([]Lap, error) {
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
		return nil, fmt.Errorf("list all laps: %w", err)
	}

	var laps []Lap
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &laps); err != nil {
		return nil, fmt.Errorf("unmarshal laps: %w", err)
	}
	return laps, nil
}

// DeleteAllLapsForSession deletes every lap item in a session (old and new format).
func DeleteAllLapsForSession(ctx context.Context, sessionID string) (int, error) {
	c, err := client()
	if err != nil {
		return 0, err
	}

	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		KeyConditionExpression: aws.String("pk = :pk AND begins_with(sk, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":     &types.AttributeValueMemberS{Value: SessionPK(sessionID)},
			":prefix": &types.AttributeValueMemberS{Value: "LAP#"},
		},
		ProjectionExpression: aws.String("pk, sk"),
	})
	if err != nil {
		return 0, fmt.Errorf("query laps for delete: %w", err)
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

// DeleteLap deletes a single lap item.
func DeleteLap(ctx context.Context, sessionID, uid string, lapNo int) error {
	c, err := client()
	if err != nil {
		return err
	}

	_, err = c.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: SessionPK(sessionID)},
			"sk": &types.AttributeValueMemberS{Value: LapSK(uid, lapNo)},
		},
	})
	return err
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

// QueryFastestLaps returns laps from the leaderboard GSI, sorted by time ascending.
// If since is non-empty, only laps with createdAt >= since are returned.
// Paginates through results when a filter is applied to ensure we return up to limit items.
func QueryFastestLaps(ctx context.Context, layoutID, class string, limit int32, since string) ([]Lap, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	input := &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		IndexName:              aws.String("gsi1"),
		KeyConditionExpression: aws.String("gsi1pk = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": &types.AttributeValueMemberS{Value: LeaderboardGSI1PK(layoutID, class)},
		},
		ScanIndexForward: aws.Bool(true),
	}

	if since != "" {
		input.FilterExpression = aws.String("createdAt >= :since")
		input.ExpressionAttributeValues[":since"] = &types.AttributeValueMemberS{Value: since}
	} else {
		// No filter — Limit is exact
		input.Limit = aws.Int32(limit)
	}

	var laps []Lap
	// Paginate: when FilterExpression is used, Limit applies before filtering,
	// so we must page through until we have enough results or exhaust the partition.
	const maxPages = 10
	for page := 0; page < maxPages; page++ {
		out, err := c.Query(ctx, input)
		if err != nil {
			return nil, fmt.Errorf("query fastest laps: %w", err)
		}

		var batch []Lap
		if err := attributevalue.UnmarshalListOfMaps(out.Items, &batch); err != nil {
			return nil, fmt.Errorf("unmarshal laps: %w", err)
		}
		laps = append(laps, batch...)

		if int32(len(laps)) >= limit || out.LastEvaluatedKey == nil {
			break
		}
		input.ExclusiveStartKey = out.LastEvaluatedKey
	}

	if int32(len(laps)) > limit {
		laps = laps[:limit]
	}
	return laps, nil
}

// QueryFastestPersonalBests returns each driver's best lap, sorted by time ascending.
func QueryFastestPersonalBests(ctx context.Context, layoutID, class string, maxResults int, since string) ([]Lap, error) {
	// Fetch more than needed since we deduplicate by driver
	fetchLimit := int32(maxResults * 5)
	if fetchLimit < 100 {
		fetchLimit = 100
	}
	laps, err := QueryFastestLaps(ctx, layoutID, class, fetchLimit, since)
	if err != nil {
		return nil, err
	}

	seen := map[string]bool{}
	var bests []Lap
	for _, l := range laps {
		if seen[l.UID] {
			continue
		}
		seen[l.UID] = true
		bests = append(bests, l)
		if len(bests) >= maxResults {
			break
		}
	}
	return bests, nil
}

// VerifyLap marks a lap as verified. GSI1 attributes are already populated by PutLap.
func VerifyLap(ctx context.Context, sessionID, uid string, lapNo int) error {
	c, err := client()
	if err != nil {
		return err
	}

	_, err = c.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: SessionPK(sessionID)},
			"sk": &types.AttributeValueMemberS{Value: LapSK(uid, lapNo)},
		},
		UpdateExpression: aws.String("SET verified = :v"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":v": &types.AttributeValueMemberBOOL{Value: true},
		},
	})
	return err
}
