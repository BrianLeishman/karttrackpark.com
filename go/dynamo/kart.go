package dynamo

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type Kart struct {
	PK        string `dynamodbav:"pk" json:"-"`
	SK        string `dynamodbav:"sk" json:"-"`
	KartID    string `dynamodbav:"kartId" json:"kart_id"`
	TrackID   string `dynamodbav:"trackId" json:"track_id"`
	Number    string `dynamodbav:"number" json:"number"`
	Class     string `dynamodbav:"class,omitempty" json:"class,omitempty"`
	CreatedAt string `dynamodbav:"createdAt" json:"created_at"`
}

func PutKart(ctx context.Context, k Kart) error {
	c, err := client()
	if err != nil {
		return err
	}

	k.PK = KartPK(k.KartID)
	k.SK = ProfileSK

	item, err := attributevalue.MarshalMap(k)
	if err != nil {
		return fmt.Errorf("marshal kart: %w", err)
	}

	_, err = c.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(TableName),
		Item:      item,
	})
	return err
}

func GetKart(ctx context.Context, kartID string) (*Kart, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: KartPK(kartID)},
			"sk": &types.AttributeValueMemberS{Value: ProfileSK},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("get kart: %w", err)
	}
	if out.Item == nil {
		return nil, nil
	}

	var k Kart
	if err := attributevalue.UnmarshalMap(out.Item, &k); err != nil {
		return nil, fmt.Errorf("unmarshal kart: %w", err)
	}
	return &k, nil
}
