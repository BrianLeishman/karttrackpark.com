package dynamo

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

func hashKey(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

type APIKeyInfo struct {
	KeyID     string `json:"key_id"`
	Label     string `json:"label"`
	CreatedAt string `json:"created_at"`
}

// CreateAPIKey generates a new API key for the user.
// Returns the raw key (only time it's available) and the key ID.
func CreateAPIKey(ctx context.Context, uid, label string) (rawKey string, keyID string, err error) {
	c, err := client()
	if err != nil {
		return "", "", err
	}

	keyID, err = randomHex(4)
	if err != nil {
		return "", "", fmt.Errorf("generate key id: %w", err)
	}

	raw, err := randomHex(32)
	if err != nil {
		return "", "", fmt.Errorf("generate key: %w", err)
	}
	hash := hashKey(raw)
	now := time.Now().UTC().Format(time.RFC3339)

	_, err = c.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{
				Put: &types.Put{
					TableName: aws.String(TableName),
					Item: map[string]types.AttributeValue{
						"pk":        &types.AttributeValueMemberS{Value: UserPK(uid)},
						"sk":        &types.AttributeValueMemberS{Value: APIKeySK(keyID)},
						"keyHash":   &types.AttributeValueMemberS{Value: hash},
						"label":     &types.AttributeValueMemberS{Value: label},
						"createdAt": &types.AttributeValueMemberS{Value: now},
					},
				},
			},
			{
				Put: &types.Put{
					TableName: aws.String(TableName),
					Item: map[string]types.AttributeValue{
						"pk":    &types.AttributeValueMemberS{Value: APIKeyLookupPK(hash)},
						"sk":    &types.AttributeValueMemberS{Value: APIKeyLookupPK(hash)},
						"uid":   &types.AttributeValueMemberS{Value: uid},
						"keyId": &types.AttributeValueMemberS{Value: keyID},
					},
				},
			},
		},
	})
	if err != nil {
		return "", "", fmt.Errorf("write api key: %w", err)
	}

	return raw, keyID, nil
}

// ListAPIKeys returns metadata for all API keys belonging to a user.
func ListAPIKeys(ctx context.Context, uid string) ([]APIKeyInfo, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		KeyConditionExpression: aws.String("pk = :pk AND begins_with(sk, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":     &types.AttributeValueMemberS{Value: UserPK(uid)},
			":prefix": &types.AttributeValueMemberS{Value: "APIKEY#"},
		},
		ProjectionExpression: aws.String("sk, #lbl, createdAt"),
		ExpressionAttributeNames: map[string]string{
			"#lbl": "label",
		},
	})
	if err != nil {
		return nil, fmt.Errorf("list api keys: %w", err)
	}

	keys := make([]APIKeyInfo, 0, len(out.Items))
	for _, item := range out.Items {
		sk := item["sk"].(*types.AttributeValueMemberS).Value
		keyID := sk[len("APIKEY#"):]
		info := APIKeyInfo{KeyID: keyID}
		if v, ok := item["label"].(*types.AttributeValueMemberS); ok {
			info.Label = v.Value
		}
		if v, ok := item["createdAt"].(*types.AttributeValueMemberS); ok {
			info.CreatedAt = v.Value
		}
		keys = append(keys, info)
	}
	return keys, nil
}

// LookupAPIKey finds the user ID for a raw API key.
func LookupAPIKey(ctx context.Context, rawKey string) (string, error) {
	c, err := client()
	if err != nil {
		return "", err
	}

	hash := hashKey(rawKey)
	pk := APIKeyLookupPK(hash)

	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: pk},
			"sk": &types.AttributeValueMemberS{Value: pk},
		},
		ProjectionExpression: aws.String("uid"),
	})
	if err != nil {
		return "", fmt.Errorf("lookup api key: %w", err)
	}
	if out.Item == nil {
		return "", fmt.Errorf("api key not found")
	}

	uid, ok := out.Item["uid"].(*types.AttributeValueMemberS)
	if !ok {
		return "", fmt.Errorf("invalid api key record")
	}
	return uid.Value, nil
}

// DeleteAPIKey revokes a specific API key by key ID.
func DeleteAPIKey(ctx context.Context, uid, keyID string) error {
	c, err := client()
	if err != nil {
		return err
	}

	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: UserPK(uid)},
			"sk": &types.AttributeValueMemberS{Value: APIKeySK(keyID)},
		},
		ProjectionExpression: aws.String("keyHash"),
	})
	if err != nil {
		return fmt.Errorf("get key for delete: %w", err)
	}
	if out.Item == nil {
		return nil
	}

	hash, ok := out.Item["keyHash"].(*types.AttributeValueMemberS)
	if !ok {
		return nil
	}
	lookupPK := APIKeyLookupPK(hash.Value)

	_, err = c.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{
				Delete: &types.Delete{
					TableName: aws.String(TableName),
					Key: map[string]types.AttributeValue{
						"pk": &types.AttributeValueMemberS{Value: UserPK(uid)},
						"sk": &types.AttributeValueMemberS{Value: APIKeySK(keyID)},
					},
				},
			},
			{
				Delete: &types.Delete{
					TableName: aws.String(TableName),
					Key: map[string]types.AttributeValue{
						"pk": &types.AttributeValueMemberS{Value: lookupPK},
						"sk": &types.AttributeValueMemberS{Value: lookupPK},
					},
				},
			},
		},
	})
	if err != nil {
		return fmt.Errorf("delete api key: %w", err)
	}
	return nil
}

// DeleteAllAPIKeys revokes all API keys for a user.
func DeleteAllAPIKeys(ctx context.Context, uid string) error {
	keys, err := ListAPIKeys(ctx, uid)
	if err != nil {
		return err
	}
	for _, k := range keys {
		if err := DeleteAPIKey(ctx, uid, k.KeyID); err != nil {
			return err
		}
	}
	return nil
}
