package email

import (
	"bytes"
	"context"
	"fmt"
	htmltpl "html/template"
	"sync"
	texttpl "text/template"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sesv2"
	"github.com/aws/aws-sdk-go-v2/service/sesv2/types"
)

const fromAddress = "Kart Track Park <noreply@karttrackpark.com>"

var initClient = sync.OnceValues(func() (*sesv2.Client, error) {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		return nil, err
	}
	return sesv2.NewFromConfig(cfg), nil
})

func Send(ctx context.Context, to, subject, htmlBody, textBody string) error {
	c, err := initClient()
	if err != nil {
		return fmt.Errorf("ses client: %w", err)
	}

	_, err = c.SendEmail(ctx, &sesv2.SendEmailInput{
		FromEmailAddress: aws.String(fromAddress),
		Destination: &types.Destination{
			ToAddresses: []string{to},
		},
		Content: &types.EmailContent{
			Simple: &types.Message{
				Subject: &types.Content{
					Data:    aws.String(subject),
					Charset: aws.String("UTF-8"),
				},
				Body: &types.Body{
					Html: &types.Content{
						Data:    aws.String(htmlBody),
						Charset: aws.String("UTF-8"),
					},
					Text: &types.Content{
						Data:    aws.String(textBody),
						Charset: aws.String("UTF-8"),
					},
				},
			},
		},
	})
	if err != nil {
		return fmt.Errorf("send email: %w", err)
	}
	return nil
}

func renderHTML(tmpl *htmltpl.Template, data any) (string, error) {
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", err
	}
	return buf.String(), nil
}

func renderText(tmpl *texttpl.Template, data any) (string, error) {
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", err
	}
	return buf.String(), nil
}
