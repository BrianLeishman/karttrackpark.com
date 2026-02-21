package dynamo

import (
	"fmt"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// BuildUpdateExpression builds a DynamoDB SET update expression from a map of fields.
func BuildUpdateExpression(fields map[string]interface{}) (string, map[string]string, map[string]types.AttributeValue, error) {
	if len(fields) == 0 {
		return "", nil, nil, fmt.Errorf("no fields to update")
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
			return "", nil, nil, fmt.Errorf("marshal field %s: %w", k, err)
		}
		values[placeholder] = av
		i++
	}
	return expr, names, values, nil
}
