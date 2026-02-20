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

func apikeyLookupPK(hash string) string {
	return "apikey#" + hash
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// APIKeyInfo holds metadata about an API key (never the raw key).
type APIKeyInfo struct {
	KeyID     string `json:"key_id"`
	Label     string `json:"label"`
	CreatedAt string `json:"created_at"`
}

// CreateAPIKey generates a new API key for the user with the given label.
// Returns the raw key (only time it's available) and the key ID.
func CreateAPIKey(ctx context.Context, uid, label string) (rawKey string, keyID string, err error) {
	c, err := client()
	if err != nil {
		return "", "", err
	}

	keyID, err = randomHex(4) // 8-char hex
	if err != nil {
		return "", "", fmt.Errorf("generate key id: %w", err)
	}

	raw, err := randomHex(32)
	if err != nil {
		return "", "", fmt.Errorf("generate key: %w", err)
	}
	hash := hashKey(raw)
	lookupPK := apikeyLookupPK(hash)
	now := time.Now().UTC().Format(time.RFC3339)

	_, err = c.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{
				Put: &types.Put{
					TableName: aws.String(TableName),
					Item: map[string]types.AttributeValue{
						"uid":       &types.AttributeValueMemberS{Value: uid},
						"sk":        &types.AttributeValueMemberS{Value: "apikey#" + keyID},
						"KeyHash":   &types.AttributeValueMemberS{Value: hash},
						"Label":     &types.AttributeValueMemberS{Value: label},
						"CreatedAt": &types.AttributeValueMemberS{Value: now},
					},
				},
			},
			{
				Put: &types.Put{
					TableName: aws.String(TableName),
					Item: map[string]types.AttributeValue{
						"uid":   &types.AttributeValueMemberS{Value: lookupPK},
						"sk":    &types.AttributeValueMemberS{Value: lookupPK},
						"UID":   &types.AttributeValueMemberS{Value: uid},
						"KeyID": &types.AttributeValueMemberS{Value: keyID},
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
		KeyConditionExpression: aws.String("uid = :uid AND begins_with(sk, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":uid":    &types.AttributeValueMemberS{Value: uid},
			":prefix": &types.AttributeValueMemberS{Value: "apikey#"},
		},
		ProjectionExpression: aws.String("sk, Label, CreatedAt"),
	})
	if err != nil {
		return nil, fmt.Errorf("list api keys: %w", err)
	}

	keys := make([]APIKeyInfo, 0, len(out.Items))
	for _, item := range out.Items {
		sk := item["sk"].(*types.AttributeValueMemberS).Value
		keyID := sk[len("apikey#"):]
		info := APIKeyInfo{KeyID: keyID}
		if v, ok := item["Label"].(*types.AttributeValueMemberS); ok {
			info.Label = v.Value
		}
		if v, ok := item["CreatedAt"].(*types.AttributeValueMemberS); ok {
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
	lookupPK := apikeyLookupPK(hash)

	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"uid": &types.AttributeValueMemberS{Value: lookupPK},
			"sk":  &types.AttributeValueMemberS{Value: lookupPK},
		},
		ProjectionExpression: aws.String("UID"),
	})
	if err != nil {
		return "", fmt.Errorf("lookup api key: %w", err)
	}
	if out.Item == nil {
		return "", fmt.Errorf("api key not found")
	}

	uid, ok := out.Item["UID"].(*types.AttributeValueMemberS)
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

	// Get the key hash so we can delete the lookup record
	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"uid": &types.AttributeValueMemberS{Value: uid},
			"sk":  &types.AttributeValueMemberS{Value: "apikey#" + keyID},
		},
		ProjectionExpression: aws.String("KeyHash"),
	})
	if err != nil {
		return fmt.Errorf("get key for delete: %w", err)
	}
	if out.Item == nil {
		return nil
	}

	hash, ok := out.Item["KeyHash"].(*types.AttributeValueMemberS)
	if !ok {
		return nil
	}
	lookupPK := apikeyLookupPK(hash.Value)

	_, err = c.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{
				Delete: &types.Delete{
					TableName: aws.String(TableName),
					Key: map[string]types.AttributeValue{
						"uid": &types.AttributeValueMemberS{Value: uid},
						"sk":  &types.AttributeValueMemberS{Value: "apikey#" + keyID},
					},
				},
			},
			{
				Delete: &types.Delete{
					TableName: aws.String(TableName),
					Key: map[string]types.AttributeValue{
						"uid": &types.AttributeValueMemberS{Value: lookupPK},
						"sk":  &types.AttributeValueMemberS{Value: lookupPK},
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
