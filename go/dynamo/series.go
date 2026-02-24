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

type Series struct {
	PK             string `dynamodbav:"pk" json:"-"`
	SK             string `dynamodbav:"sk" json:"-"`
	SeriesID       string `dynamodbav:"seriesId" json:"series_id"`
	TrackID        string `dynamodbav:"trackId" json:"track_id"`
	ChampionshipID string `dynamodbav:"championshipId" json:"championship_id"`
	Name           string `dynamodbav:"name" json:"name"`
	Description    string `dynamodbav:"description,omitempty" json:"description,omitempty"`
	Status         string `dynamodbav:"status,omitempty" json:"status,omitempty"`
	Rules          string `dynamodbav:"rules,omitempty" json:"rules,omitempty"`
	GSI1PK         string `dynamodbav:"gsi1pk,omitempty" json:"-"`
	GSI1SK         string `dynamodbav:"gsi1sk,omitempty" json:"-"`
	CreatedAt      string `dynamodbav:"createdAt" json:"created_at"`
}

type SeriesEvent struct {
	PK          string `dynamodbav:"pk" json:"-"`
	SK          string `dynamodbav:"sk" json:"-"`
	SeriesID    string `dynamodbav:"seriesId" json:"series_id"`
	EventID     string `dynamodbav:"eventId" json:"event_id"`
	RoundNumber int    `dynamodbav:"roundNumber" json:"round_number"`
	EventName   string `dynamodbav:"eventName,omitempty" json:"event_name,omitempty"`
	StartTime   string `dynamodbav:"startTime,omitempty" json:"start_time,omitempty"`
	CreatedAt   string `dynamodbav:"createdAt" json:"created_at"`
}

type SeriesDriver struct {
	PK                  string `dynamodbav:"pk" json:"-"`
	SK                  string `dynamodbav:"sk" json:"-"`
	SeriesID            string `dynamodbav:"seriesId" json:"series_id"`
	UID                 string `dynamodbav:"uid" json:"uid"`
	DriverName          string `dynamodbav:"driverName" json:"driver_name"`
	Seeded              bool   `dynamodbav:"seeded" json:"seeded"`
	RelegationProtected bool   `dynamodbav:"relegationProtected" json:"relegation_protected"`
	TotalPoints         int    `dynamodbav:"totalPoints,omitempty" json:"total_points,omitempty"`
	WeeklyScores        string `dynamodbav:"weeklyScores,omitempty" json:"weekly_scores,omitempty"`
	DroppedRound        int    `dynamodbav:"droppedRound,omitempty" json:"dropped_round,omitempty"`
	CreatedAt           string `dynamodbav:"createdAt" json:"created_at"`
}

func CreateSeries(ctx context.Context, s Series) (*Series, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	s.SeriesID = xid.New().String()
	s.PK = SeriesPK(s.SeriesID)
	s.SK = ProfileSK
	s.GSI1PK = ChampionshipPK(s.ChampionshipID)
	s.GSI1SK = SeriesPK(s.SeriesID)
	if s.Status == "" {
		s.Status = "upcoming"
	}
	s.CreatedAt = time.Now().UTC().Format(time.RFC3339)

	item, err := attributevalue.MarshalMap(s)
	if err != nil {
		return nil, fmt.Errorf("marshal series: %w", err)
	}

	_, err = c.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(TableName),
		Item:      item,
	})
	if err != nil {
		return nil, fmt.Errorf("create series: %w", err)
	}
	return &s, nil
}

func GetSeries(ctx context.Context, seriesID string) (*Series, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: SeriesPK(seriesID)},
			"sk": &types.AttributeValueMemberS{Value: ProfileSK},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("get series: %w", err)
	}
	if out.Item == nil {
		return nil, nil
	}

	var s Series
	if err := attributevalue.UnmarshalMap(out.Item, &s); err != nil {
		return nil, fmt.Errorf("unmarshal series: %w", err)
	}
	return &s, nil
}

func UpdateSeries(ctx context.Context, seriesID string, fields map[string]interface{}) error {
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
			"pk": &types.AttributeValueMemberS{Value: SeriesPK(seriesID)},
			"sk": &types.AttributeValueMemberS{Value: ProfileSK},
		},
		UpdateExpression:          aws.String(expr),
		ExpressionAttributeNames:  names,
		ExpressionAttributeValues: values,
	})
	return err
}

func DeleteSeries(ctx context.Context, seriesID string) error {
	c, err := client()
	if err != nil {
		return err
	}

	_, err = c.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: SeriesPK(seriesID)},
			"sk": &types.AttributeValueMemberS{Value: ProfileSK},
		},
	})
	return err
}

// ListSeriesForChampionship returns all series belonging to a championship (via GSI1).
func ListSeriesForChampionship(ctx context.Context, championshipID string) ([]Series, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		IndexName:              aws.String("gsi1"),
		KeyConditionExpression: aws.String("gsi1pk = :pk AND begins_with(gsi1sk, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":     &types.AttributeValueMemberS{Value: ChampionshipPK(championshipID)},
			":prefix": &types.AttributeValueMemberS{Value: "SERIES#"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("list series for championship: %w", err)
	}

	var series []Series
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &series); err != nil {
		return nil, fmt.Errorf("unmarshal series: %w", err)
	}
	return series, nil
}

// AddEventToSeries creates a SERIES#id / EVENT#eventId link item.
func AddEventToSeries(ctx context.Context, se SeriesEvent) (*SeriesEvent, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	se.PK = SeriesPK(se.SeriesID)
	se.SK = SeriesEventSK(se.EventID)
	se.CreatedAt = time.Now().UTC().Format(time.RFC3339)

	item, err := attributevalue.MarshalMap(se)
	if err != nil {
		return nil, fmt.Errorf("marshal series event: %w", err)
	}

	_, err = c.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(TableName),
		Item:      item,
	})
	if err != nil {
		return nil, fmt.Errorf("add event to series: %w", err)
	}
	return &se, nil
}

// RemoveEventFromSeries deletes the SERIES#id / EVENT#eventId link.
func RemoveEventFromSeries(ctx context.Context, seriesID, eventID string) error {
	c, err := client()
	if err != nil {
		return err
	}

	_, err = c.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: SeriesPK(seriesID)},
			"sk": &types.AttributeValueMemberS{Value: SeriesEventSK(eventID)},
		},
	})
	return err
}

// ListSeriesEvents returns all events linked to a series.
func ListSeriesEvents(ctx context.Context, seriesID string) ([]SeriesEvent, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		KeyConditionExpression: aws.String("pk = :pk AND begins_with(sk, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":     &types.AttributeValueMemberS{Value: SeriesPK(seriesID)},
			":prefix": &types.AttributeValueMemberS{Value: "EVENT#"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("list series events: %w", err)
	}

	var events []SeriesEvent
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &events); err != nil {
		return nil, fmt.Errorf("unmarshal series events: %w", err)
	}
	return events, nil
}

// EnrollDriver adds a driver to a series.
func EnrollDriver(ctx context.Context, sd SeriesDriver) (*SeriesDriver, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	sd.PK = SeriesPK(sd.SeriesID)
	sd.SK = SeriesDriverSK(sd.UID)
	sd.CreatedAt = time.Now().UTC().Format(time.RFC3339)

	item, err := attributevalue.MarshalMap(sd)
	if err != nil {
		return nil, fmt.Errorf("marshal series driver: %w", err)
	}

	_, err = c.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(TableName),
		Item:      item,
	})
	if err != nil {
		return nil, fmt.Errorf("enroll driver: %w", err)
	}
	return &sd, nil
}

// GetSeriesDriver returns a single driver enrollment for a series.
func GetSeriesDriver(ctx context.Context, seriesID, uid string) (*SeriesDriver, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: SeriesPK(seriesID)},
			"sk": &types.AttributeValueMemberS{Value: SeriesDriverSK(uid)},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("get series driver: %w", err)
	}
	if out.Item == nil {
		return nil, nil
	}

	var sd SeriesDriver
	if err := attributevalue.UnmarshalMap(out.Item, &sd); err != nil {
		return nil, fmt.Errorf("unmarshal series driver: %w", err)
	}
	return &sd, nil
}

// UpdateSeriesDriver updates mutable fields on a driver enrollment.
func UpdateSeriesDriver(ctx context.Context, seriesID, uid string, fields map[string]interface{}) error {
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
			"pk": &types.AttributeValueMemberS{Value: SeriesPK(seriesID)},
			"sk": &types.AttributeValueMemberS{Value: SeriesDriverSK(uid)},
		},
		UpdateExpression:          aws.String(expr),
		ExpressionAttributeNames:  names,
		ExpressionAttributeValues: values,
	})
	return err
}

// DeleteSeriesDriver removes a driver from a series.
func DeleteSeriesDriver(ctx context.Context, seriesID, uid string) error {
	c, err := client()
	if err != nil {
		return err
	}

	_, err = c.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(TableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: SeriesPK(seriesID)},
			"sk": &types.AttributeValueMemberS{Value: SeriesDriverSK(uid)},
		},
	})
	return err
}

// ListSeriesDrivers returns all drivers enrolled in a series.
func ListSeriesDrivers(ctx context.Context, seriesID string) ([]SeriesDriver, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}

	out, err := c.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(TableName),
		KeyConditionExpression: aws.String("pk = :pk AND begins_with(sk, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":     &types.AttributeValueMemberS{Value: SeriesPK(seriesID)},
			":prefix": &types.AttributeValueMemberS{Value: "DRIVER#"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("list series drivers: %w", err)
	}

	var drivers []SeriesDriver
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &drivers); err != nil {
		return nil, fmt.Errorf("unmarshal series drivers: %w", err)
	}
	return drivers, nil
}
