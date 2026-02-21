package dynamo

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type UserProfile struct {
	UID       string `dynamodbav:"pk" json:"uid"`
	SK        string `dynamodbav:"sk" json:"-"`
	Email     string `dynamodbav:"email" json:"email"`
	Name      string `dynamodbav:"name,omitempty" json:"name,omitempty"`
	GSI1PK    string `dynamodbav:"gsi1pk,omitempty" json:"-"`
	GSI1SK    string `dynamodbav:"gsi1sk,omitempty" json:"-"`
	CreatedAt string `dynamodbav:"createdAt" json:"created_at"`
}

func PutUser(ctx context.Context, u UserProfile) error {
	c, err := client()
	if err != nil {
		return err
	}

	u.SK = ProfileSK
	u.GSI1PK = EmailGSI1PK(u.Email)
	u.GSI1SK = u.UID // store raw UID in GSI1SK for easy retrieval

	item, err := attributevalue.MarshalMap(u)
	if err != nil {
		return fmt.Errorf("marshal user: %w", err)
	}

	_, err = c.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(TableName),
		Item:      item,
	})
	return err
}

func GetUser(ctx context.Context, uid string) (*UserProfile, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: UserPK(uid)},
			"sk": &types.AttributeValueMemberS{Value: ProfileSK},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("get user: %w", err)
	}
	if out.Item == nil {
		return nil, nil
	}

	var u UserProfile
	if err := attributevalue.UnmarshalMap(out.Item, &u); err != nil {
		return nil, fmt.Errorf("unmarshal user: %w", err)
	}
	return &u, nil
}

func GetUserByEmail(ctx context.Context, email string) (*UserProfile, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		IndexName:              aws.String("gsi1"),
		KeyConditionExpression: aws.String("gsi1pk = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": &types.AttributeValueMemberS{Value: EmailGSI1PK(email)},
		},
		Limit: aws.Int32(1),
	})
	if err != nil {
		return nil, fmt.Errorf("query user by email: %w", err)
	}
	if len(out.Items) == 0 {
		return nil, nil
	}

	var u UserProfile
	if err := attributevalue.UnmarshalMap(out.Items[0], &u); err != nil {
		return nil, fmt.Errorf("unmarshal user: %w", err)
	}
	return &u, nil
}

func UpdateUser(ctx context.Context, uid string, fields map[string]interface{}) error {
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
			"pk": &types.AttributeValueMemberS{Value: UserPK(uid)},
			"sk": &types.AttributeValueMemberS{Value: ProfileSK},
		},
		UpdateExpression:          aws.String(expr),
		ExpressionAttributeNames:  names,
		ExpressionAttributeValues: values,
	})
	return err
}
