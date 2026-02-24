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

type Championship struct {
	PK             string `dynamodbav:"pk" json:"-"`
	SK             string `dynamodbav:"sk" json:"-"`
	ChampionshipID string `dynamodbav:"championshipId" json:"championship_id"`
	TrackID        string `dynamodbav:"trackId" json:"track_id"`
	Name           string `dynamodbav:"name" json:"name"`
	Description    string `dynamodbav:"description,omitempty" json:"description,omitempty"`
	LogoKey        string `dynamodbav:"logoKey,omitempty" json:"logo_key,omitempty"`
	GSI1PK         string `dynamodbav:"gsi1pk,omitempty" json:"-"`
	GSI1SK         string `dynamodbav:"gsi1sk,omitempty" json:"-"`
	CreatedAt      string `dynamodbav:"createdAt" json:"created_at"`
}

func CreateChampionship(ctx context.Context, c Championship) (*Championship, error) {
	db, err := client()
	if err != nil {
		return nil, err
	}

	c.ChampionshipID = xid.New().String()
	c.PK = ChampionshipPK(c.ChampionshipID)
	c.SK = ProfileSK
	c.GSI1PK = TrackPK(c.TrackID)
	c.GSI1SK = ChampionshipPK(c.ChampionshipID)
	c.CreatedAt = time.Now().UTC().Format(time.RFC3339)

	item, err := attributevalue.MarshalMap(c)
	if err != nil {
		return nil, fmt.Errorf("marshal championship: %w", err)
	}

	_, err = db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(TableName),
		Item:      item,
	})
	if err != nil {
		return nil, fmt.Errorf("create championship: %w", err)
	}
	return &c, nil
}

func GetChampionship(ctx context.Context, championshipID string) (*Championship, error) {
	db, err := client()
	if err != nil {
		return nil, err
	}

	out, err := db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: ChampionshipPK(championshipID)},
			"sk": &types.AttributeValueMemberS{Value: ProfileSK},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("get championship: %w", err)
	}
	if out.Item == nil {
		return nil, nil
	}

	var c Championship
	if err := attributevalue.UnmarshalMap(out.Item, &c); err != nil {
		return nil, fmt.Errorf("unmarshal championship: %w", err)
	}
	return &c, nil
}

func UpdateChampionship(ctx context.Context, championshipID string, fields map[string]interface{}) error {
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
			"pk": &types.AttributeValueMemberS{Value: ChampionshipPK(championshipID)},
			"sk": &types.AttributeValueMemberS{Value: ProfileSK},
		},
		UpdateExpression:          aws.String(expr),
		ExpressionAttributeNames:  names,
		ExpressionAttributeValues: values,
	})
	return err
}

func DeleteChampionship(ctx context.Context, championshipID string) error {
	db, err := client()
	if err != nil {
		return err
	}

	_, err = db.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: ChampionshipPK(championshipID)},
			"sk": &types.AttributeValueMemberS{Value: ProfileSK},
		},
	})
	return err
}

// ListChampionshipsForTrack returns all championships belonging to a track (via GSI1).
func ListChampionshipsForTrack(ctx context.Context, trackID string) ([]Championship, error) {
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
			":prefix": &types.AttributeValueMemberS{Value: "CHAMPIONSHIP#"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("list championships for track: %w", err)
	}

	var champs []Championship
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &champs); err != nil {
		return nil, fmt.Errorf("unmarshal championships: %w", err)
	}
	return champs, nil
}
