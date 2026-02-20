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

type Entry struct {
	UID         string  `dynamodbav:"uid" json:"-"`
	SK          string  `dynamodbav:"sk" json:"sk"`
	Type        string  `dynamodbav:"type" json:"type"`
	Description string  `dynamodbav:"description,omitempty" json:"description,omitempty"`
	Calories    float64 `dynamodbav:"calories,omitempty" json:"calories,omitempty"`
	Protein     float64 `dynamodbav:"protein,omitempty" json:"protein,omitempty"`
	Carbs       float64 `dynamodbav:"carbs,omitempty" json:"carbs,omitempty"`
	NetCarbs    float64 `dynamodbav:"netCarbs,omitempty" json:"net_carbs,omitempty"`
	Fat         float64 `dynamodbav:"fat,omitempty" json:"fat,omitempty"`
	Fiber       float64 `dynamodbav:"fiber,omitempty" json:"fiber,omitempty"`
	Caffeine    float64 `dynamodbav:"caffeine,omitempty" json:"caffeine,omitempty"`
	Cholesterol float64 `dynamodbav:"cholesterol,omitempty" json:"cholesterol,omitempty"`
	Sodium      float64 `dynamodbav:"sodium,omitempty" json:"sodium,omitempty"`
	Sugar       float64 `dynamodbav:"sugar,omitempty" json:"sugar,omitempty"`
	Duration    float64 `dynamodbav:"duration,omitempty" json:"duration,omitempty"`
	Value       float64 `dynamodbav:"value,omitempty" json:"value,omitempty"`
	Unit        string  `dynamodbav:"unit,omitempty" json:"unit,omitempty"`
	Notes       string  `dynamodbav:"notes,omitempty" json:"notes,omitempty"`
	CreatedAt   string  `dynamodbav:"createdAt" json:"created_at"`
}

func MakeSK(entryType string) string {
	return entryType + "#" + xid.New().String()
}

func PutEntry(ctx context.Context, entry Entry) error {
	db, err := Client()
	if err != nil {
		return err
	}

	item, err := attributevalue.MarshalMap(entry)
	if err != nil {
		return fmt.Errorf("marshal entry: %w", err)
	}

	_, err = db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(TableName),
		Item:      item,
	})
	return err
}

func GetEntries(ctx context.Context, uid, entryType string, from, to time.Time) ([]Entry, error) {
	db, err := Client()
	if err != nil {
		return nil, err
	}

	out, err := db.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		KeyConditionExpression: aws.String("uid = :uid AND begins_with(sk, :prefix)"),
		FilterExpression:       aws.String("createdAt BETWEEN :from AND :to"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":uid":    &types.AttributeValueMemberS{Value: uid},
			":prefix": &types.AttributeValueMemberS{Value: entryType + "#"},
			":from":   &types.AttributeValueMemberS{Value: from.UTC().Format(time.RFC3339)},
			":to":     &types.AttributeValueMemberS{Value: to.UTC().Format(time.RFC3339)},
		},
		ScanIndexForward: aws.Bool(false),
	})
	if err != nil {
		return nil, err
	}

	var entries []Entry
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &entries); err != nil {
		return nil, err
	}
	return entries, nil
}

func UpdateEntry(ctx context.Context, uid, sk string, fields map[string]interface{}) error {
	if len(fields) == 0 {
		return nil
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

		av, err := attributevalue.Marshal(v)
		if err != nil {
			return fmt.Errorf("marshal field %s: %w", k, err)
		}
		values[placeholder] = av
		i++
	}

	_, err = db.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"uid": &types.AttributeValueMemberS{Value: uid},
			"sk":  &types.AttributeValueMemberS{Value: sk},
		},
		UpdateExpression:          aws.String(expr),
		ExpressionAttributeNames:  names,
		ExpressionAttributeValues: values,
	})
	return err
}

func DeleteEntry(ctx context.Context, uid, sk string) error {
	db, err := Client()
	if err != nil {
		return err
	}

	_, err = db.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"uid": &types.AttributeValueMemberS{Value: uid},
			"sk":  &types.AttributeValueMemberS{Value: sk},
		},
	})
	return err
}
