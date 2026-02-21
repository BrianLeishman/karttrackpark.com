package dynamo

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/rs/xid"
)

type Track struct {
	PK        string `dynamodbav:"pk" json:"-"`
	SK        string `dynamodbav:"sk" json:"-"`
	TrackID   string `dynamodbav:"trackId" json:"track_id"`
	Name      string `dynamodbav:"name" json:"name"`
	City      string `dynamodbav:"city,omitempty" json:"city,omitempty"`
	State     string `dynamodbav:"state,omitempty" json:"state,omitempty"`
	Timezone  string `dynamodbav:"timezone,omitempty" json:"timezone,omitempty"`
	CreatedAt string `dynamodbav:"createdAt" json:"created_at"`
}

type TrackMember struct {
	PK        string `dynamodbav:"pk" json:"-"`
	SK        string `dynamodbav:"sk" json:"-"`
	UID       string `dynamodbav:"uid" json:"uid"`
	TrackID   string `dynamodbav:"trackId" json:"track_id"`
	Role      string `dynamodbav:"role" json:"role"` // owner, admin, operator
	GSI1PK    string `dynamodbav:"gsi1pk,omitempty" json:"-"`
	GSI1SK    string `dynamodbav:"gsi1sk,omitempty" json:"-"`
	CreatedAt string `dynamodbav:"createdAt" json:"created_at"`
}

type TrackInvite struct {
	PK        string `dynamodbav:"pk" json:"-"`
	SK        string `dynamodbav:"sk" json:"-"`
	Email     string `dynamodbav:"email" json:"email"`
	TrackID   string `dynamodbav:"trackId" json:"track_id"`
	Role      string `dynamodbav:"role" json:"role"`
	InvitedBy string `dynamodbav:"invitedBy" json:"invited_by"`
	GSI1PK    string `dynamodbav:"gsi1pk,omitempty" json:"-"`
	GSI1SK    string `dynamodbav:"gsi1sk,omitempty" json:"-"`
	TTL       int64  `dynamodbav:"ttl,omitempty" json:"-"`
	CreatedAt string `dynamodbav:"createdAt" json:"created_at"`
}

type Layout struct {
	PK        string `dynamodbav:"pk" json:"-"`
	SK        string `dynamodbav:"sk" json:"-"`
	LayoutID  string `dynamodbav:"layoutId" json:"layout_id"`
	TrackID   string `dynamodbav:"trackId" json:"track_id"`
	Name      string `dynamodbav:"name" json:"name"`
	CreatedAt string `dynamodbav:"createdAt" json:"created_at"`
}

// CreateTrack creates a track and adds the creator as owner in a transaction.
func CreateTrack(ctx context.Context, uid string, t Track) (*Track, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	t.TrackID = xid.New().String()
	t.PK = TrackPK(t.TrackID)
	t.SK = ProfileSK
	t.CreatedAt = time.Now().UTC().Format(time.RFC3339)

	trackItem, err := attributevalue.MarshalMap(t)
	if err != nil {
		return nil, fmt.Errorf("marshal track: %w", err)
	}

	member := TrackMember{
		PK:        TrackPK(t.TrackID),
		SK:        MemberSK(uid),
		UID:       uid,
		TrackID:   t.TrackID,
		Role:      "owner",
		GSI1PK:    UserPK(uid),
		GSI1SK:    TrackPK(t.TrackID),
		CreatedAt: t.CreatedAt,
	}
	memberItem, err := attributevalue.MarshalMap(member)
	if err != nil {
		return nil, fmt.Errorf("marshal member: %w", err)
	}

	_, err = c.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{Put: &types.Put{TableName: aws.String(TableName), Item: trackItem}},
			{Put: &types.Put{TableName: aws.String(TableName), Item: memberItem}},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("create track: %w", err)
	}
	return &t, nil
}

func GetTrack(ctx context.Context, trackID string) (*Track, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: TrackPK(trackID)},
			"sk": &types.AttributeValueMemberS{Value: ProfileSK},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("get track: %w", err)
	}
	if out.Item == nil {
		return nil, nil
	}

	var t Track
	if err := attributevalue.UnmarshalMap(out.Item, &t); err != nil {
		return nil, fmt.Errorf("unmarshal track: %w", err)
	}
	return &t, nil
}

func UpdateTrack(ctx context.Context, trackID string, fields map[string]interface{}) error {
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
			"pk": &types.AttributeValueMemberS{Value: TrackPK(trackID)},
			"sk": &types.AttributeValueMemberS{Value: ProfileSK},
		},
		UpdateExpression:          aws.String(expr),
		ExpressionAttributeNames:  names,
		ExpressionAttributeValues: values,
	})
	return err
}

// ListTracksForUser returns all tracks where the user is a member (via GSI1).
func ListTracksForUser(ctx context.Context, uid string) ([]TrackMember, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		IndexName:              aws.String("gsi1"),
		KeyConditionExpression: aws.String("gsi1pk = :pk AND begins_with(gsi1sk, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":     &types.AttributeValueMemberS{Value: UserPK(uid)},
			":prefix": &types.AttributeValueMemberS{Value: "TRACK#"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("list tracks for user: %w", err)
	}

	var members []TrackMember
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &members); err != nil {
		return nil, fmt.Errorf("unmarshal members: %w", err)
	}
	return members, nil
}

func GetTrackMember(ctx context.Context, trackID, uid string) (*TrackMember, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: TrackPK(trackID)},
			"sk": &types.AttributeValueMemberS{Value: MemberSK(uid)},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("get track member: %w", err)
	}
	if out.Item == nil {
		return nil, nil
	}

	var m TrackMember
	if err := attributevalue.UnmarshalMap(out.Item, &m); err != nil {
		return nil, fmt.Errorf("unmarshal member: %w", err)
	}
	return &m, nil
}

func ListTrackMembers(ctx context.Context, trackID string) ([]TrackMember, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		KeyConditionExpression: aws.String("pk = :pk AND begins_with(sk, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":     &types.AttributeValueMemberS{Value: TrackPK(trackID)},
			":prefix": &types.AttributeValueMemberS{Value: "MEMBER#"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("list track members: %w", err)
	}

	var members []TrackMember
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &members); err != nil {
		return nil, fmt.Errorf("unmarshal members: %w", err)
	}
	return members, nil
}

// CreateInvite creates a pending invite with a 30-day TTL.
func CreateInvite(ctx context.Context, inv TrackInvite) (*TrackInvite, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	inv.Email = strings.ToLower(inv.Email)
	inv.PK = TrackPK(inv.TrackID)
	inv.SK = InviteSK(inv.Email)
	inv.GSI1PK = InviteGSI1PK(inv.Email)
	inv.GSI1SK = TrackPK(inv.TrackID)
	inv.TTL = time.Now().Add(30 * 24 * time.Hour).Unix()
	inv.CreatedAt = time.Now().UTC().Format(time.RFC3339)

	item, err := attributevalue.MarshalMap(inv)
	if err != nil {
		return nil, fmt.Errorf("marshal invite: %w", err)
	}

	_, err = c.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(TableName),
		Item:      item,
	})
	if err != nil {
		return nil, fmt.Errorf("create invite: %w", err)
	}
	return &inv, nil
}

// ListInvitesForEmail returns pending invites for an email address (via GSI1).
func ListInvitesForEmail(ctx context.Context, email string) ([]TrackInvite, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		IndexName:              aws.String("gsi1"),
		KeyConditionExpression: aws.String("gsi1pk = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": &types.AttributeValueMemberS{Value: InviteGSI1PK(email)},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("list invites for email: %w", err)
	}

	var invites []TrackInvite
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &invites); err != nil {
		return nil, fmt.Errorf("unmarshal invites: %w", err)
	}
	return invites, nil
}

// ListInvitesForTrack returns all pending invites for a track.
func ListInvitesForTrack(ctx context.Context, trackID string) ([]TrackInvite, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		KeyConditionExpression: aws.String("pk = :pk AND begins_with(sk, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":     &types.AttributeValueMemberS{Value: TrackPK(trackID)},
			":prefix": &types.AttributeValueMemberS{Value: "INVITE#"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("list invites for track: %w", err)
	}

	var invites []TrackInvite
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &invites); err != nil {
		return nil, fmt.Errorf("unmarshal invites: %w", err)
	}
	return invites, nil
}

// AcceptInvite atomically deletes the invite and creates a membership.
func AcceptInvite(ctx context.Context, trackID, email, uid string) error {
	c, err := client()
	if err != nil {
		return err
	}

	email = strings.ToLower(email)

	// Look up the invite to get the role
	inv, err := getInvite(ctx, trackID, email)
	if err != nil {
		return err
	}
	if inv == nil {
		return fmt.Errorf("invite not found")
	}

	member := TrackMember{
		PK:        TrackPK(trackID),
		SK:        MemberSK(uid),
		UID:       uid,
		TrackID:   trackID,
		Role:      inv.Role,
		GSI1PK:    UserPK(uid),
		GSI1SK:    TrackPK(trackID),
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	memberItem, err := attributevalue.MarshalMap(member)
	if err != nil {
		return fmt.Errorf("marshal member: %w", err)
	}

	_, err = c.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{
				Delete: &types.Delete{
					TableName: aws.String(TableName),
					Key: map[string]types.AttributeValue{
						"pk": &types.AttributeValueMemberS{Value: TrackPK(trackID)},
						"sk": &types.AttributeValueMemberS{Value: InviteSK(email)},
					},
				},
			},
			{
				Put: &types.Put{
					TableName: aws.String(TableName),
					Item:      memberItem,
				},
			},
		},
	})
	if err != nil {
		return fmt.Errorf("accept invite: %w", err)
	}
	return nil
}

// DeleteInvite removes a pending invite.
func DeleteInvite(ctx context.Context, trackID, email string) error {
	c, err := client()
	if err != nil {
		return err
	}

	_, err = c.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: TrackPK(trackID)},
			"sk": &types.AttributeValueMemberS{Value: InviteSK(email)},
		},
	})
	return err
}

func getInvite(ctx context.Context, trackID, email string) (*TrackInvite, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: TrackPK(trackID)},
			"sk": &types.AttributeValueMemberS{Value: InviteSK(email)},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("get invite: %w", err)
	}
	if out.Item == nil {
		return nil, nil
	}

	var inv TrackInvite
	if err := attributevalue.UnmarshalMap(out.Item, &inv); err != nil {
		return nil, fmt.Errorf("unmarshal invite: %w", err)
	}
	return &inv, nil
}

// CreateLayout adds a layout to a track.
func CreateLayout(ctx context.Context, l Layout) (*Layout, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	l.LayoutID = xid.New().String()
	l.PK = TrackPK(l.TrackID)
	l.SK = LayoutSK(l.LayoutID)
	l.CreatedAt = time.Now().UTC().Format(time.RFC3339)

	item, err := attributevalue.MarshalMap(l)
	if err != nil {
		return nil, fmt.Errorf("marshal layout: %w", err)
	}

	_, err = c.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(TableName),
		Item:      item,
	})
	if err != nil {
		return nil, fmt.Errorf("create layout: %w", err)
	}
	return &l, nil
}

// ListLayouts returns all layouts for a track.
func ListLayouts(ctx context.Context, trackID string) ([]Layout, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		KeyConditionExpression: aws.String("pk = :pk AND begins_with(sk, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":     &types.AttributeValueMemberS{Value: TrackPK(trackID)},
			":prefix": &types.AttributeValueMemberS{Value: "LAYOUT#"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("list layouts: %w", err)
	}

	var layouts []Layout
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &layouts); err != nil {
		return nil, fmt.Errorf("unmarshal layouts: %w", err)
	}
	return layouts, nil
}
