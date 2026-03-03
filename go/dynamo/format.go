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

type FormatSession struct {
	SessionName string `dynamodbav:"sessionName" json:"session_name"`
	SessionType string `dynamodbav:"sessionType" json:"session_type"`
	Duration    int    `dynamodbav:"duration,omitempty" json:"duration,omitempty"`
	LapCount    int    `dynamodbav:"lapCount,omitempty" json:"lap_count,omitempty"`
	KartClass   string `dynamodbav:"kartClass,omitempty" json:"kart_class,omitempty"`
	Notes       string `dynamodbav:"notes,omitempty" json:"notes,omitempty"`
}

type Format struct {
	PK        string          `dynamodbav:"pk" json:"-"`
	SK        string          `dynamodbav:"sk" json:"-"`
	FormatID  string          `dynamodbav:"formatId" json:"format_id"`
	TrackID   string          `dynamodbav:"trackId" json:"track_id"`
	Name      string          `dynamodbav:"name" json:"name"`
	Sessions  []FormatSession `dynamodbav:"sessions" json:"sessions"`
	GSI1PK    string          `dynamodbav:"gsi1pk,omitempty" json:"-"`
	GSI1SK    string          `dynamodbav:"gsi1sk,omitempty" json:"-"`
	CreatedAt string          `dynamodbav:"createdAt" json:"created_at"`
}

func CreateFormat(ctx context.Context, f Format) (*Format, error) {
	db, err := client()
	if err != nil {
		return nil, err
	}

	f.FormatID = xid.New().String()
	f.PK = FormatPK(f.FormatID)
	f.SK = ProfileSK
	f.GSI1PK = TrackPK(f.TrackID)
	f.GSI1SK = FormatPK(f.FormatID)
	f.CreatedAt = time.Now().UTC().Format(time.RFC3339)

	item, err := attributevalue.MarshalMap(f)
	if err != nil {
		return nil, fmt.Errorf("marshal format: %w", err)
	}

	_, err = db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(TableName),
		Item:      item,
	})
	if err != nil {
		return nil, fmt.Errorf("create format: %w", err)
	}
	return &f, nil
}

func GetFormat(ctx context.Context, formatID string) (*Format, error) {
	db, err := client()
	if err != nil {
		return nil, err
	}

	out, err := db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: FormatPK(formatID)},
			"sk": &types.AttributeValueMemberS{Value: ProfileSK},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("get format: %w", err)
	}
	if out.Item == nil {
		return nil, nil
	}

	var f Format
	if err := attributevalue.UnmarshalMap(out.Item, &f); err != nil {
		return nil, fmt.Errorf("unmarshal format: %w", err)
	}
	return &f, nil
}

func UpdateFormat(ctx context.Context, formatID string, fields map[string]any) error {
	if len(fields) == 0 {
		return nil
	}

	db, err := client()
	if err != nil {
		return err
	}

	expr, names, values, err := BuildUpdateExpression(fields)
	if err != nil {
		return err
	}

	_, err = db.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: FormatPK(formatID)},
			"sk": &types.AttributeValueMemberS{Value: ProfileSK},
		},
		UpdateExpression:          aws.String(expr),
		ExpressionAttributeNames:  names,
		ExpressionAttributeValues: values,
	})
	return err
}

func DeleteFormat(ctx context.Context, formatID string) error {
	db, err := client()
	if err != nil {
		return err
	}

	_, err = db.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: FormatPK(formatID)},
			"sk": &types.AttributeValueMemberS{Value: ProfileSK},
		},
	})
	return err
}

func ListFormatsForTrack(ctx context.Context, trackID string) ([]Format, error) {
	db, err := client()
	if err != nil {
		return nil, err
	}

	out, err := db.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		IndexName:              aws.String("gsi1"),
		KeyConditionExpression: aws.String("gsi1pk = :pk AND begins_with(gsi1sk, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":     &types.AttributeValueMemberS{Value: TrackPK(trackID)},
			":prefix": &types.AttributeValueMemberS{Value: "FORMAT#"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("list formats for track: %w", err)
	}

	var formats []Format
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &formats); err != nil {
		return nil, fmt.Errorf("unmarshal formats: %w", err)
	}
	return formats, nil
}
