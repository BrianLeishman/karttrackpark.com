package dynamo

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/rs/xid"
)

type Session struct {
	PK          string `dynamodbav:"pk" json:"-"`
	SK          string `dynamodbav:"sk" json:"-"`
	SessionID   string `dynamodbav:"sessionId" json:"session_id"`
	TrackID     string `dynamodbav:"trackId" json:"track_id"`
	LayoutID    string `dynamodbav:"layoutId,omitempty" json:"layout_id,omitempty"`
	UID         string `dynamodbav:"uid" json:"uid"`
	SessionType string `dynamodbav:"sessionType,omitempty" json:"session_type,omitempty"`
	KartClass   string `dynamodbav:"kartClass,omitempty" json:"kart_class,omitempty"`
	EventID      string `dynamodbav:"eventId,omitempty" json:"event_id,omitempty"`
	SessionOrder int    `dynamodbav:"sessionOrder,omitempty" json:"session_order,omitempty"`
	SessionName  string `dynamodbav:"sessionName,omitempty" json:"session_name,omitempty"`
	Notes        string `dynamodbav:"notes,omitempty" json:"notes,omitempty"`
	LapCount    int    `dynamodbav:"lapCount,omitempty" json:"lap_count,omitempty"`
	BestLapMs   int64  `dynamodbav:"bestLapMs,omitempty" json:"best_lap_ms,omitempty"`
	GSI1PK      string `dynamodbav:"gsi1pk,omitempty" json:"-"`
	GSI1SK      string `dynamodbav:"gsi1sk,omitempty" json:"-"`
	CreatedAt   string `dynamodbav:"createdAt" json:"created_at"`
}

func CreateSession(ctx context.Context, s Session) (*Session, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	s.SessionID = xid.New().String()
	s.PK = SessionPK(s.SessionID)
	s.SK = ProfileSK
	s.GSI1PK = UserPK(s.UID)
	s.GSI1SK = SessionPK(s.SessionID)
	s.CreatedAt = time.Now().UTC().Format(time.RFC3339)

	item, err := attributevalue.MarshalMap(s)
	if err != nil {
		return nil, fmt.Errorf("marshal session: %w", err)
	}

	_, err = c.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(TableName),
		Item:      item,
	})
	if err != nil {
		return nil, fmt.Errorf("create session: %w", err)
	}
	return &s, nil
}

func GetSession(ctx context.Context, sessionID string) (*Session, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: SessionPK(sessionID)},
			"sk": &types.AttributeValueMemberS{Value: ProfileSK},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("get session: %w", err)
	}
	if out.Item == nil {
		return nil, nil
	}

	var s Session
	if err := attributevalue.UnmarshalMap(out.Item, &s); err != nil {
		return nil, fmt.Errorf("unmarshal session: %w", err)
	}
	return &s, nil
}

func UpdateSession(ctx context.Context, sessionID string, fields map[string]interface{}) error {
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
			"pk": &types.AttributeValueMemberS{Value: SessionPK(sessionID)},
			"sk": &types.AttributeValueMemberS{Value: ProfileSK},
		},
		UpdateExpression:          aws.String(expr),
		ExpressionAttributeNames:  names,
		ExpressionAttributeValues: values,
	})
	return err
}

// ListSessionsForUser returns sessions for a user (via GSI1).
func ListSessionsForUser(ctx context.Context, uid string) ([]Session, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		IndexName:              aws.String("gsi1"),
		KeyConditionExpression: aws.String("gsi1pk = :pk AND begins_with(gsi1sk, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":     &types.AttributeValueMemberS{Value: UserPK(uid)},
			":prefix": &types.AttributeValueMemberS{Value: "SESSION#"},
		},
		ScanIndexForward: aws.Bool(false),
	})
	if err != nil {
		return nil, fmt.Errorf("list sessions for user: %w", err)
	}

	var sessions []Session
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &sessions); err != nil {
		return nil, fmt.Errorf("unmarshal sessions: %w", err)
	}
	return sessions, nil
}
