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

type UploadLap struct {
	LapNo     int     `dynamodbav:"lapNo" json:"lap_no"`
	LapTimeMs int64   `dynamodbav:"lapTimeMs" json:"lap_time_ms"`
	MaxSpeed  float64 `dynamodbav:"maxSpeed,omitempty" json:"max_speed,omitempty"`
}

type Upload struct {
	PK          string            `dynamodbav:"pk" json:"-"`
	SK          string            `dynamodbav:"sk" json:"-"`
	UploadID    string            `dynamodbav:"uploadId" json:"upload_id"`
	UID         string            `dynamodbav:"uid" json:"uid"`
	TrackID     string            `dynamodbav:"trackId,omitempty" json:"track_id,omitempty"`
	EventID     string            `dynamodbav:"eventId,omitempty" json:"event_id,omitempty"`
	SessionID   string            `dynamodbav:"sessionId,omitempty" json:"session_id,omitempty"`
	Filename    string            `dynamodbav:"filename" json:"filename"`
	S3Key       string            `dynamodbav:"s3Key" json:"s3_key"`
	Status      string            `dynamodbav:"status" json:"status"`
	Error       string            `dynamodbav:"error,omitempty" json:"error,omitempty"`
	LapCount    int               `dynamodbav:"lapCount,omitempty" json:"lap_count,omitempty"`
	BestLapMs   int64             `dynamodbav:"bestLapMs,omitempty" json:"best_lap_ms,omitempty"`
	TotalTimeMs int64             `dynamodbav:"totalTimeMs,omitempty" json:"total_time_ms,omitempty"`
	Laps        []UploadLap       `dynamodbav:"laps,omitempty" json:"laps,omitempty"`
	SessionTime string            `dynamodbav:"sessionTime,omitempty" json:"session_time,omitempty"`
	Metadata    map[string]string `dynamodbav:"metadata,omitempty" json:"metadata,omitempty"`
	GSI1PK      string            `dynamodbav:"gsi1pk,omitempty" json:"-"`
	GSI1SK      string            `dynamodbav:"gsi1sk,omitempty" json:"-"`
	CreatedAt   string            `dynamodbav:"createdAt" json:"created_at"`
}

func CreateUpload(ctx context.Context, u Upload) (*Upload, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	u.PK = UploadPK(u.UploadID)
	u.SK = ProfileSK
	now := time.Now().UTC().Format(time.RFC3339)
	u.CreatedAt = now
	u.GSI1PK = UserUploadGSI1PK(u.UID)
	u.GSI1SK = now

	item, err := attributevalue.MarshalMap(u)
	if err != nil {
		return nil, fmt.Errorf("marshal upload: %w", err)
	}

	_, err = c.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(TableName),
		Item:      item,
	})
	if err != nil {
		return nil, fmt.Errorf("create upload: %w", err)
	}
	return &u, nil
}

func GetUpload(ctx context.Context, uploadID string) (*Upload, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: UploadPK(uploadID)},
			"sk": &types.AttributeValueMemberS{Value: ProfileSK},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("get upload: %w", err)
	}
	if out.Item == nil {
		return nil, nil
	}

	var u Upload
	if err := attributevalue.UnmarshalMap(out.Item, &u); err != nil {
		return nil, fmt.Errorf("unmarshal upload: %w", err)
	}
	return &u, nil
}

func UpdateUpload(ctx context.Context, uploadID string, fields map[string]any) error {
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
			"pk": &types.AttributeValueMemberS{Value: UploadPK(uploadID)},
			"sk": &types.AttributeValueMemberS{Value: ProfileSK},
		},
		UpdateExpression:          aws.String(expr),
		ExpressionAttributeNames:  names,
		ExpressionAttributeValues: values,
	})
	return err
}

func ListUploadsForUser(ctx context.Context, uid string) ([]Upload, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		IndexName:              aws.String("gsi1"),
		KeyConditionExpression: aws.String("gsi1pk = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": &types.AttributeValueMemberS{Value: UserUploadGSI1PK(uid)},
		},
		ScanIndexForward: aws.Bool(false),
	})
	if err != nil {
		return nil, fmt.Errorf("list uploads: %w", err)
	}

	var uploads []Upload
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &uploads); err != nil {
		return nil, fmt.Errorf("unmarshal uploads: %w", err)
	}
	return uploads, nil
}

func DeleteUpload(ctx context.Context, uploadID string) error {
	c, err := client()
	if err != nil {
		return err
	}

	_, err = c.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: UploadPK(uploadID)},
			"sk": &types.AttributeValueMemberS{Value: ProfileSK},
		},
	})
	return err
}
