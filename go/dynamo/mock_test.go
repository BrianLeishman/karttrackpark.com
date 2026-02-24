package dynamo

import (
	"context"
	"sort"
	"strings"
	"sync"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// mockDB is an in-memory DynamoDB mock for unit tests.
type mockDB struct {
	mu    sync.Mutex
	items map[string]map[string]types.AttributeValue // key: "pk\x00sk"
}

func newMockDB() *mockDB {
	return &mockDB{items: make(map[string]map[string]types.AttributeValue)}
}

func itemKey(pk, sk string) string { return pk + "\x00" + sk }

func strVal(av types.AttributeValue) string {
	if s, ok := av.(*types.AttributeValueMemberS); ok {
		return s.Value
	}
	return ""
}

func (m *mockDB) PutItem(_ context.Context, in *dynamodb.PutItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	pk := strVal(in.Item["pk"])
	sk := strVal(in.Item["sk"])
	// Deep copy the item
	cp := make(map[string]types.AttributeValue, len(in.Item))
	for k, v := range in.Item {
		cp[k] = v
	}
	m.items[itemKey(pk, sk)] = cp
	return &dynamodb.PutItemOutput{}, nil
}

func (m *mockDB) GetItem(_ context.Context, in *dynamodb.GetItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	pk := strVal(in.Key["pk"])
	sk := strVal(in.Key["sk"])
	item, ok := m.items[itemKey(pk, sk)]
	if !ok {
		return &dynamodb.GetItemOutput{}, nil
	}
	return &dynamodb.GetItemOutput{Item: item}, nil
}

func (m *mockDB) DeleteItem(_ context.Context, in *dynamodb.DeleteItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.DeleteItemOutput, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	pk := strVal(in.Key["pk"])
	sk := strVal(in.Key["sk"])
	delete(m.items, itemKey(pk, sk))
	return &dynamodb.DeleteItemOutput{}, nil
}

func (m *mockDB) Query(_ context.Context, in *dynamodb.QueryInput, _ ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Determine which attributes to query on
	pkAttr, skAttr := "pk", "sk"
	if in.IndexName != nil && *in.IndexName == "gsi1" {
		pkAttr, skAttr = "gsi1pk", "gsi1sk"
	}

	// Extract the partition key value from expression attribute values
	pkVal := strVal(in.ExpressionAttributeValues[":pk"])
	prefixVal := ""
	if v, ok := in.ExpressionAttributeValues[":prefix"]; ok {
		prefixVal = strVal(v)
	}

	expr := ""
	if in.KeyConditionExpression != nil {
		expr = *in.KeyConditionExpression
	}

	var matched []map[string]types.AttributeValue
	for _, item := range m.items {
		ipk := strVal(item[pkAttr])
		isk := strVal(item[skAttr])
		if ipk != pkVal {
			continue
		}

		if strings.Contains(expr, "begins_with") {
			if !strings.HasPrefix(isk, prefixVal) {
				continue
			}
		} else if strings.Contains(expr, ">=") {
			nowVal := strVal(in.ExpressionAttributeValues[":now"])
			if isk < nowVal {
				continue
			}
		} else if strings.Contains(expr, " < ") {
			nowVal := strVal(in.ExpressionAttributeValues[":now"])
			if isk >= nowVal {
				continue
			}
		}

		// Apply filter expression for trackId filter
		if in.FilterExpression != nil && strings.Contains(*in.FilterExpression, "trackId") {
			tid := strVal(in.ExpressionAttributeValues[":tid"])
			if strVal(item["trackId"]) != tid {
				continue
			}
		}

		matched = append(matched, item)
	}

	// Sort by sort key
	sort.Slice(matched, func(i, j int) bool {
		a := strVal(matched[i][skAttr])
		b := strVal(matched[j][skAttr])
		if in.ScanIndexForward != nil && !*in.ScanIndexForward {
			return a > b
		}
		return a < b
	})

	if in.Limit != nil && int(*in.Limit) < len(matched) {
		matched = matched[:*in.Limit]
	}

	return &dynamodb.QueryOutput{Items: matched}, nil
}

func (m *mockDB) UpdateItem(_ context.Context, in *dynamodb.UpdateItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	pk := strVal(in.Key["pk"])
	sk := strVal(in.Key["sk"])
	key := itemKey(pk, sk)
	item, ok := m.items[key]
	if !ok {
		return &dynamodb.UpdateItemOutput{}, nil
	}

	// Parse SET expression to apply updates: "SET #k1 = :v1, #k2 = :v2"
	if in.UpdateExpression != nil {
		expr := *in.UpdateExpression
		expr = strings.TrimPrefix(expr, "SET ")
		parts := strings.Split(expr, ", ")
		for _, part := range parts {
			sides := strings.SplitN(part, " = ", 2)
			if len(sides) != 2 {
				continue
			}
			nameRef := strings.TrimSpace(sides[0])
			valRef := strings.TrimSpace(sides[1])
			attrName := nameRef
			if in.ExpressionAttributeNames != nil {
				if resolved, ok := in.ExpressionAttributeNames[nameRef]; ok {
					attrName = resolved
				}
			}
			if val, ok := in.ExpressionAttributeValues[valRef]; ok {
				item[attrName] = val
			}
		}
	}

	m.items[key] = item
	return &dynamodb.UpdateItemOutput{}, nil
}

func (m *mockDB) TransactWriteItems(_ context.Context, in *dynamodb.TransactWriteItemsInput, _ ...func(*dynamodb.Options)) (*dynamodb.TransactWriteItemsOutput, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, tw := range in.TransactItems {
		if tw.Put != nil {
			pk := strVal(tw.Put.Item["pk"])
			sk := strVal(tw.Put.Item["sk"])
			cp := make(map[string]types.AttributeValue, len(tw.Put.Item))
			for k, v := range tw.Put.Item {
				cp[k] = v
			}
			m.items[itemKey(pk, sk)] = cp
		}
		if tw.Delete != nil {
			pk := strVal(tw.Delete.Key["pk"])
			sk := strVal(tw.Delete.Key["sk"])
			delete(m.items, itemKey(pk, sk))
		}
	}
	return &dynamodb.TransactWriteItemsOutput{}, nil
}

// setup creates a fresh mockDB and sets it as the test client. Returns a cleanup function.
func setup() (*mockDB, func()) {
	db := newMockDB()
	SetClient(db)
	return db, func() { SetClient(nil) }
}
