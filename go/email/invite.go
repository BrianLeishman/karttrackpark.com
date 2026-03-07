package email

import (
	"context"
	"fmt"
	htmltpl "html/template"
	texttpl "text/template"
)

type InviteData struct {
	InviterName string
	EntityName  string
	TrackName   string
	Link        string
}

var inviteHTML = htmltpl.Must(htmltpl.New("invite").Parse(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
  <h2 style="color:#111">You've been invited!</h2>
  <p><strong>{{.InviterName}}</strong> invited you to join <strong>{{.EntityName}}</strong> at <strong>{{.TrackName}}</strong>.</p>
  <p>
    <a href="{{.Link}}" style="display:inline-block;padding:12px 24px;background:#0d6efd;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">
      View Invite
    </a>
  </p>
  <p style="color:#666;font-size:14px;margin-top:32px">
    If you don't have an account yet, you can sign up when you visit.
  </p>
</body>
</html>`))

var inviteText = texttpl.Must(texttpl.New("invite").Parse(
	`{{.InviterName}} invited you to join {{.EntityName}} at {{.TrackName}} on Kart Track Park.

Accept your invite: {{.Link}}
`))

func SendInvite(ctx context.Context, to string, data InviteData) error {
	subject := fmt.Sprintf("You're invited to %s", data.EntityName)

	htmlBody, err := renderHTML(inviteHTML, data)
	if err != nil {
		return fmt.Errorf("render invite html: %w", err)
	}

	textBody, err := renderText(inviteText, data)
	if err != nil {
		return fmt.Errorf("render invite text: %w", err)
	}

	return Send(ctx, to, subject, htmlBody, textBody)
}
