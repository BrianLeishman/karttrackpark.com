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

type Result struct {
	PK           string `dynamodbav:"pk" json:"-"`
	SK           string `dynamodbav:"sk" json:"-"`
	SessionID    string `dynamodbav:"sessionId" json:"session_id"`
	UID          string `dynamodbav:"uid" json:"uid"`
	DriverName   string `dynamodbav:"driverName" json:"driver_name"`
	Position     int    `dynamodbav:"position" json:"position"`
	Points       int    `dynamodbav:"points,omitempty" json:"points,omitempty"`
	FastestLapMs int64  `dynamodbav:"fastestLapMs,omitempty" json:"fastest_lap_ms,omitempty"`
	KartID       string `dynamodbav:"kartId,omitempty" json:"kart_id,omitempty"`
	GridPosition int    `dynamodbav:"gridPosition,omitempty" json:"grid_position,omitempty"`
	Penalties    string `dynamodbav:"penalties,omitempty" json:"penalties,omitempty"`
	CreatedAt    string `dynamodbav:"createdAt" json:"created_at"`
}

// PutResult creates or overwrites a result for a driver in a session.
func PutResult(ctx context.Context, r Result) (*Result, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	r.PK = SessionPK(r.SessionID)
	r.SK = ResultSK(r.UID)
	r.CreatedAt = time.Now().UTC().Format(time.RFC3339)

	item, err := attributevalue.MarshalMap(r)
	if err != nil {
		return nil, fmt.Errorf("marshal result: %w", err)
	}

	_, err = c.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(TableName),
		Item:      item,
	})
	if err != nil {
		return nil, fmt.Errorf("put result: %w", err)
	}
	return &r, nil
}

// GetResult returns a single driver's result for a session.
func GetResult(ctx context.Context, sessionID, uid string) (*Result, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: SessionPK(sessionID)},
			"sk": &types.AttributeValueMemberS{Value: ResultSK(uid)},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("get result: %w", err)
	}
	if out.Item == nil {
		return nil, nil
	}

	var r Result
	if err := attributevalue.UnmarshalMap(out.Item, &r); err != nil {
		return nil, fmt.Errorf("unmarshal result: %w", err)
	}
	return &r, nil
}

// ListResultsForSession returns all results for a session, sorted by SK.
func ListResultsForSession(ctx context.Context, sessionID string) ([]Result, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		KeyConditionExpression: aws.String("pk = :pk AND begins_with(sk, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":     &types.AttributeValueMemberS{Value: SessionPK(sessionID)},
			":prefix": &types.AttributeValueMemberS{Value: "RESULT#"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("list results for session: %w", err)
	}

	var results []Result
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &results); err != nil {
		return nil, fmt.Errorf("unmarshal results: %w", err)
	}
	return results, nil
}

// DeleteResult removes a driver's result from a session.
func DeleteResult(ctx context.Context, sessionID, uid string) error {
	c, err := client()
	if err != nil {
		return err
	}

	_, err = c.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: SessionPK(sessionID)},
			"sk": &types.AttributeValueMemberS{Value: ResultSK(uid)},
		},
	})
	return err
}
