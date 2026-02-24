package dynamo

import (
	"context"
	"testing"
)

func TestPutResult(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()
	ctx := context.Background()

	r, err := PutResult(ctx, Result{
		SessionID:  "sess1",
		UID:        "u1",
		DriverName: "Alice",
		Position:   1,
		Points:     25,
	})
	if err != nil {
		t.Fatalf("PutResult: %v", err)
	}
	if r.CreatedAt == "" {
		t.Error("expected non-empty CreatedAt")
	}
}

func TestGetResult(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()
	ctx := context.Background()

	PutResult(ctx, Result{SessionID: "sess1", UID: "u1", DriverName: "Alice", Position: 1})

	got, err := GetResult(ctx, "sess1", "u1")
	if err != nil {
		t.Fatalf("GetResult: %v", err)
	}
	if got == nil {
		t.Fatal("expected non-nil")
	}
	if got.DriverName != "Alice" {
		t.Errorf("DriverName = %q, want Alice", got.DriverName)
	}
}

func TestGetResult_NotFound(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()

	got, err := GetResult(context.Background(), "nope", "nope")
	if err != nil {
		t.Fatalf("GetResult: %v", err)
	}
	if got != nil {
		t.Fatal("expected nil")
	}
}

func TestListResultsForSession(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()
	ctx := context.Background()

	PutResult(ctx, Result{SessionID: "sess1", UID: "u1", DriverName: "Alice", Position: 1})
	PutResult(ctx, Result{SessionID: "sess1", UID: "u2", DriverName: "Bob", Position: 2})
	PutResult(ctx, Result{SessionID: "sess2", UID: "u3", DriverName: "Charlie", Position: 1})

	list, err := ListResultsForSession(ctx, "sess1")
	if err != nil {
		t.Fatalf("ListResultsForSession: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("got %d results, want 2", len(list))
	}
}

func TestDeleteResult(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()
	ctx := context.Background()

	PutResult(ctx, Result{SessionID: "sess1", UID: "u1", DriverName: "Alice", Position: 1})
	DeleteResult(ctx, "sess1", "u1")

	got, _ := GetResult(ctx, "sess1", "u1")
	if got != nil {
		t.Fatal("expected nil after delete")
	}
}

func TestPutResult_Overwrite(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()
	ctx := context.Background()

	PutResult(ctx, Result{SessionID: "sess1", UID: "u1", DriverName: "Alice", Position: 1, Points: 10})
	PutResult(ctx, Result{SessionID: "sess1", UID: "u1", DriverName: "Alice", Position: 1, Points: 25})

	got, _ := GetResult(ctx, "sess1", "u1")
	if got.Points != 25 {
		t.Errorf("Points = %d, want 25", got.Points)
	}
}
