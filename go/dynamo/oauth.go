package dynamo

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// OAuthClient represents a dynamically registered OAuth client.
type OAuthClient struct {
	ClientID     string   `json:"client_id"`
	ClientName   string   `json:"client_name"`
	RedirectURIs []string `json:"redirect_uris"`
	GrantTypes   []string `json:"grant_types"`
	CreatedAt    string   `json:"created_at"`
}

// AuthSession stores state during the OAuth authorize flow.
type AuthSession struct {
	SessionID     string
	ClientID      string
	RedirectURI   string
	CodeChallenge string
	State         string
	CreatedAt     string
}

// AuthCode stores a generated authorization code pending exchange.
type AuthCode struct {
	Code                string
	SessionID           string
	UID                 string
	CognitoAccessToken  string
	CognitoRefreshToken string
	CodeChallenge       string
	ClientID            string
	RedirectURI         string
}

// PutOAuthClient stores a new OAuth client registration.
func PutOAuthClient(ctx context.Context, c OAuthClient) error {
	db, err := client()
	if err != nil {
		return err
	}

	pk := "oauth_client#" + c.ClientID
	item := map[string]types.AttributeValue{
		"uid":        &types.AttributeValueMemberS{Value: pk},
		"sk":         &types.AttributeValueMemberS{Value: pk},
		"ClientName": &types.AttributeValueMemberS{Value: c.ClientName},
		"CreatedAt":  &types.AttributeValueMemberS{Value: c.CreatedAt},
	}
	if len(c.RedirectURIs) > 0 {
		item["RedirectURIs"] = &types.AttributeValueMemberSS{Value: c.RedirectURIs}
	}
	if len(c.GrantTypes) > 0 {
		item["GrantTypes"] = &types.AttributeValueMemberSS{Value: c.GrantTypes}
	}

	_, err = db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(TableName),
		Item:      item,
	})
	return err
}

// GetOAuthClient retrieves an OAuth client by ID.
func GetOAuthClient(ctx context.Context, clientID string) (*OAuthClient, error) {
	db, err := client()
	if err != nil {
		return nil, err
	}

	pk := "oauth_client#" + clientID
	out, err := db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"uid": &types.AttributeValueMemberS{Value: pk},
			"sk":  &types.AttributeValueMemberS{Value: pk},
		},
	})
	if err != nil {
		return nil, err
	}
	if out.Item == nil {
		return nil, nil
	}

	c := &OAuthClient{ClientID: clientID}
	if v, ok := out.Item["ClientName"].(*types.AttributeValueMemberS); ok {
		c.ClientName = v.Value
	}
	if v, ok := out.Item["RedirectURIs"].(*types.AttributeValueMemberSS); ok {
		c.RedirectURIs = v.Value
	}
	if v, ok := out.Item["GrantTypes"].(*types.AttributeValueMemberSS); ok {
		c.GrantTypes = v.Value
	}
	if v, ok := out.Item["CreatedAt"].(*types.AttributeValueMemberS); ok {
		c.CreatedAt = v.Value
	}
	return c, nil
}

// PutAuthSession stores an OAuth authorization session with a 10-minute TTL.
func PutAuthSession(ctx context.Context, s AuthSession) error {
	db, err := client()
	if err != nil {
		return err
	}

	pk := "oauth_session#" + s.SessionID
	ttl := time.Now().Add(10 * time.Minute).Unix()

	_, err = db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(TableName),
		Item: map[string]types.AttributeValue{
			"uid":           &types.AttributeValueMemberS{Value: pk},
			"sk":            &types.AttributeValueMemberS{Value: pk},
			"ClientID":      &types.AttributeValueMemberS{Value: s.ClientID},
			"RedirectURI":   &types.AttributeValueMemberS{Value: s.RedirectURI},
			"CodeChallenge": &types.AttributeValueMemberS{Value: s.CodeChallenge},
			"State":         &types.AttributeValueMemberS{Value: s.State},
			"CreatedAt":     &types.AttributeValueMemberS{Value: s.CreatedAt},
			"ttl":           &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", ttl)},
		},
	})
	return err
}

// GetAuthSession retrieves an OAuth authorization session.
func GetAuthSession(ctx context.Context, sessionID string) (*AuthSession, error) {
	db, err := client()
	if err != nil {
		return nil, err
	}

	pk := "oauth_session#" + sessionID
	out, err := db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"uid": &types.AttributeValueMemberS{Value: pk},
			"sk":  &types.AttributeValueMemberS{Value: pk},
		},
	})
	if err != nil {
		return nil, err
	}
	if out.Item == nil {
		return nil, nil
	}

	s := &AuthSession{SessionID: sessionID}
	if v, ok := out.Item["ClientID"].(*types.AttributeValueMemberS); ok {
		s.ClientID = v.Value
	}
	if v, ok := out.Item["RedirectURI"].(*types.AttributeValueMemberS); ok {
		s.RedirectURI = v.Value
	}
	if v, ok := out.Item["CodeChallenge"].(*types.AttributeValueMemberS); ok {
		s.CodeChallenge = v.Value
	}
	if v, ok := out.Item["State"].(*types.AttributeValueMemberS); ok {
		s.State = v.Value
	}
	if v, ok := out.Item["CreatedAt"].(*types.AttributeValueMemberS); ok {
		s.CreatedAt = v.Value
	}
	return s, nil
}

// PutAuthCode stores an authorization code with a 5-minute TTL.
func PutAuthCode(ctx context.Context, ac AuthCode) error {
	db, err := client()
	if err != nil {
		return err
	}

	pk := "oauth_code#" + ac.Code
	ttl := time.Now().Add(5 * time.Minute).Unix()

	_, err = db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(TableName),
		Item: map[string]types.AttributeValue{
			"uid":                 &types.AttributeValueMemberS{Value: pk},
			"sk":                  &types.AttributeValueMemberS{Value: pk},
			"SessionID":           &types.AttributeValueMemberS{Value: ac.SessionID},
			"UID":                 &types.AttributeValueMemberS{Value: ac.UID},
			"CognitoAccessToken":  &types.AttributeValueMemberS{Value: ac.CognitoAccessToken},
			"CognitoRefreshToken": &types.AttributeValueMemberS{Value: ac.CognitoRefreshToken},
			"CodeChallenge":       &types.AttributeValueMemberS{Value: ac.CodeChallenge},
			"ClientID":            &types.AttributeValueMemberS{Value: ac.ClientID},
			"RedirectURI":         &types.AttributeValueMemberS{Value: ac.RedirectURI},
			"ttl":                 &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", ttl)},
		},
	})
	return err
}

// GetAuthCode retrieves and deletes an authorization code (one-time use).
func GetAuthCode(ctx context.Context, code string) (*AuthCode, error) {
	db, err := client()
	if err != nil {
		return nil, err
	}

	pk := "oauth_code#" + code
	key := map[string]types.AttributeValue{
		"uid": &types.AttributeValueMemberS{Value: pk},
		"sk":  &types.AttributeValueMemberS{Value: pk},
	}

	out, err := db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(TableName),
		Key:       key,
	})
	if err != nil {
		return nil, err
	}
	if out.Item == nil {
		return nil, nil
	}

	// Delete immediately (one-time use)
	_, _ = db.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(TableName),
		Key:       key,
	})

	ac := &AuthCode{Code: code}
	if v, ok := out.Item["SessionID"].(*types.AttributeValueMemberS); ok {
		ac.SessionID = v.Value
	}
	if v, ok := out.Item["UID"].(*types.AttributeValueMemberS); ok {
		ac.UID = v.Value
	}
	if v, ok := out.Item["CognitoAccessToken"].(*types.AttributeValueMemberS); ok {
		ac.CognitoAccessToken = v.Value
	}
	if v, ok := out.Item["CognitoRefreshToken"].(*types.AttributeValueMemberS); ok {
		ac.CognitoRefreshToken = v.Value
	}
	if v, ok := out.Item["CodeChallenge"].(*types.AttributeValueMemberS); ok {
		ac.CodeChallenge = v.Value
	}
	if v, ok := out.Item["ClientID"].(*types.AttributeValueMemberS); ok {
		ac.ClientID = v.Value
	}
	if v, ok := out.Item["RedirectURI"].(*types.AttributeValueMemberS); ok {
		ac.RedirectURI = v.Value
	}
	return ac, nil
}
