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

type Event struct {
	PK          string `dynamodbav:"pk" json:"-"`
	SK          string `dynamodbav:"sk" json:"-"`
	EventID     string `dynamodbav:"eventId" json:"event_id"`
	TrackID     string `dynamodbav:"trackId" json:"track_id"`
	TrackName   string `dynamodbav:"trackName" json:"track_name"`
	Name        string `dynamodbav:"name" json:"name"`
	Description string `dynamodbav:"description,omitempty" json:"description,omitempty"`
	EventType   string `dynamodbav:"eventType,omitempty" json:"event_type,omitempty"`
	StartTime   string `dynamodbav:"startTime" json:"start_time"`
	EndTime     string `dynamodbav:"endTime,omitempty" json:"end_time,omitempty"`
	GSI1PK      string `dynamodbav:"gsi1pk,omitempty" json:"-"`
	GSI1SK      string `dynamodbav:"gsi1sk,omitempty" json:"-"`
	CreatedAt   string `dynamodbav:"createdAt" json:"created_at"`
}

func CreateEvent(ctx context.Context, e Event) (*Event, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	e.EventID = xid.New().String()
	e.PK = EventPK(e.EventID)
	e.SK = ProfileSK
	e.GSI1PK = AllEventsGSI1PK
	e.GSI1SK = e.StartTime
	e.CreatedAt = time.Now().UTC().Format(time.RFC3339)

	item, err := attributevalue.MarshalMap(e)
	if err != nil {
		return nil, fmt.Errorf("marshal event: %w", err)
	}

	_, err = c.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(TableName),
		Item:      item,
	})
	if err != nil {
		return nil, fmt.Errorf("create event: %w", err)
	}
	return &e, nil
}

func GetEvent(ctx context.Context, eventID string) (*Event, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: EventPK(eventID)},
			"sk": &types.AttributeValueMemberS{Value: ProfileSK},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("get event: %w", err)
	}
	if out.Item == nil {
		return nil, nil
	}

	var e Event
	if err := attributevalue.UnmarshalMap(out.Item, &e); err != nil {
		return nil, fmt.Errorf("unmarshal event: %w", err)
	}
	return &e, nil
}

func UpdateEvent(ctx context.Context, eventID string, fields map[string]interface{}) error {
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
			"pk": &types.AttributeValueMemberS{Value: EventPK(eventID)},
			"sk": &types.AttributeValueMemberS{Value: ProfileSK},
		},
		UpdateExpression:          aws.String(expr),
		ExpressionAttributeNames:  names,
		ExpressionAttributeValues: values,
	})
	return err
}

func DeleteEvent(ctx context.Context, eventID string) error {
	c, err := client()
	if err != nil {
		return err
	}

	_, err = c.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: EventPK(eventID)},
			"sk": &types.AttributeValueMemberS{Value: ProfileSK},
		},
	})
	return err
}

// ListUpcomingEvents returns events with startTime >= now, sorted ascending.
func ListUpcomingEvents(ctx context.Context, limit int) ([]Event, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC().Format(time.RFC3339)

	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		IndexName:              aws.String("gsi1"),
		KeyConditionExpression: aws.String("gsi1pk = :pk AND gsi1sk >= :now"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":  &types.AttributeValueMemberS{Value: AllEventsGSI1PK},
			":now": &types.AttributeValueMemberS{Value: now},
		},
		ScanIndexForward: aws.Bool(true),
		Limit:            aws.Int32(int32(limit)),
	})
	if err != nil {
		return nil, fmt.Errorf("list upcoming events: %w", err)
	}

	var events []Event
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &events); err != nil {
		return nil, fmt.Errorf("unmarshal events: %w", err)
	}
	return events, nil
}

// ListRecentEvents returns events with startTime < now, sorted descending (most recent first).
func ListRecentEvents(ctx context.Context, limit int) ([]Event, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC().Format(time.RFC3339)

	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		IndexName:              aws.String("gsi1"),
		KeyConditionExpression: aws.String("gsi1pk = :pk AND gsi1sk < :now"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":  &types.AttributeValueMemberS{Value: AllEventsGSI1PK},
			":now": &types.AttributeValueMemberS{Value: now},
		},
		ScanIndexForward: aws.Bool(false),
		Limit:            aws.Int32(int32(limit)),
	})
	if err != nil {
		return nil, fmt.Errorf("list recent events: %w", err)
	}

	var events []Event
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &events); err != nil {
		return nil, fmt.Errorf("unmarshal events: %w", err)
	}
	return events, nil
}
