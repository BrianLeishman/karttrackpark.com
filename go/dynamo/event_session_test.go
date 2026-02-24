package dynamo

import (
	"context"
	"testing"
)

func TestAddSessionToEvent(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()
	ctx := context.Background()

	es, err := AddSessionToEvent(ctx, EventSession{
		EventID:      "evt1",
		SessionID:    "sess1",
		SessionOrder: 1,
		SessionType:  "heat",
		SessionName:  "Heat 1",
	})
	if err != nil {
		t.Fatalf("AddSessionToEvent: %v", err)
	}
	if es.CreatedAt == "" {
		t.Error("expected non-empty CreatedAt")
	}
}

func TestListEventSessions(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()
	ctx := context.Background()

	AddSessionToEvent(ctx, EventSession{EventID: "evt1", SessionID: "s1", SessionOrder: 1, SessionName: "Quali"})
	AddSessionToEvent(ctx, EventSession{EventID: "evt1", SessionID: "s2", SessionOrder: 2, SessionName: "Heat 1"})
	AddSessionToEvent(ctx, EventSession{EventID: "evt1", SessionID: "s3", SessionOrder: 3, SessionName: "A-Final"})
	AddSessionToEvent(ctx, EventSession{EventID: "evt2", SessionID: "s4", SessionOrder: 1, SessionName: "Other"})

	list, err := ListEventSessions(ctx, "evt1")
	if err != nil {
		t.Fatalf("ListEventSessions: %v", err)
	}
	if len(list) != 3 {
		t.Fatalf("got %d sessions, want 3", len(list))
	}
}

func TestListEventSessions_Empty(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()

	list, err := ListEventSessions(context.Background(), "empty-event")
	if err != nil {
		t.Fatalf("ListEventSessions: %v", err)
	}
	if len(list) != 0 {
		t.Fatalf("got %d, want 0", len(list))
	}
}
