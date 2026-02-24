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

// EventSession is the link item stored under EVENT#<id> / SESSION#<sid>.
type EventSession struct {
	PK           string `dynamodbav:"pk" json:"-"`
	SK           string `dynamodbav:"sk" json:"-"`
	EventID      string `dynamodbav:"eventId" json:"event_id"`
	SessionID    string `dynamodbav:"sessionId" json:"session_id"`
	SessionOrder int    `dynamodbav:"sessionOrder" json:"session_order"`
	SessionType  string `dynamodbav:"sessionType,omitempty" json:"session_type,omitempty"`
	SessionName  string `dynamodbav:"sessionName,omitempty" json:"session_name,omitempty"`
	CreatedAt    string `dynamodbav:"createdAt" json:"created_at"`
}

// AddSessionToEvent creates an EVENT#id / SESSION#sid link item.
func AddSessionToEvent(ctx context.Context, es EventSession) (*EventSession, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	es.PK = EventPK(es.EventID)
	es.SK = EventSessionSK(es.SessionID)
	es.CreatedAt = time.Now().UTC().Format(time.RFC3339)

	item, err := attributevalue.MarshalMap(es)
	if err != nil {
		return nil, fmt.Errorf("marshal event session: %w", err)
	}

	_, err = c.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(TableName),
		Item:      item,
	})
	if err != nil {
		return nil, fmt.Errorf("add session to event: %w", err)
	}
	return &es, nil
}

// ListEventSessions returns all session links for an event.
func ListEventSessions(ctx context.Context, eventID string) ([]EventSession, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		KeyConditionExpression: aws.String("pk = :pk AND begins_with(sk, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":     &types.AttributeValueMemberS{Value: EventPK(eventID)},
			":prefix": &types.AttributeValueMemberS{Value: "SESSION#"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("list event sessions: %w", err)
	}

	var sessions []EventSession
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &sessions); err != nil {
		return nil, fmt.Errorf("unmarshal event sessions: %w", err)
	}
	return sessions, nil
}
