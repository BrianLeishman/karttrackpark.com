package dynamo

import (
	"context"
	"testing"
)

func TestCreateChampionship(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()
	ctx := context.Background()

	c, err := CreateChampionship(ctx, Championship{TrackID: "track1", Name: "2026 Championship"})
	if err != nil {
		t.Fatalf("CreateChampionship: %v", err)
	}
	if c.ChampionshipID == "" {
		t.Fatal("expected non-empty ChampionshipID")
	}
	if c.TrackID != "track1" {
		t.Errorf("TrackID = %q, want %q", c.TrackID, "track1")
	}
	if c.Name != "2026 Championship" {
		t.Errorf("Name = %q, want %q", c.Name, "2026 Championship")
	}
	if c.CreatedAt == "" {
		t.Error("expected non-empty CreatedAt")
	}
}

func TestGetChampionship(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()
	ctx := context.Background()

	created, _ := CreateChampionship(ctx, Championship{TrackID: "track1", Name: "Test Champ"})

	got, err := GetChampionship(ctx, created.ChampionshipID)
	if err != nil {
		t.Fatalf("GetChampionship: %v", err)
	}
	if got == nil {
		t.Fatal("expected non-nil championship")
	}
	if got.Name != "Test Champ" {
		t.Errorf("Name = %q, want %q", got.Name, "Test Champ")
	}
}

func TestGetChampionship_NotFound(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()

	got, err := GetChampionship(context.Background(), "nonexistent")
	if err != nil {
		t.Fatalf("GetChampionship: %v", err)
	}
	if got != nil {
		t.Fatal("expected nil for nonexistent championship")
	}
}

func TestUpdateChampionship(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()
	ctx := context.Background()

	c, _ := CreateChampionship(ctx, Championship{TrackID: "track1", Name: "Old Name"})

	if err := UpdateChampionship(ctx, c.ChampionshipID, map[string]interface{}{"name": "New Name"}); err != nil {
		t.Fatalf("UpdateChampionship: %v", err)
	}

	got, _ := GetChampionship(ctx, c.ChampionshipID)
	if got.Name != "New Name" {
		t.Errorf("Name = %q, want %q", got.Name, "New Name")
	}
}

func TestDeleteChampionship(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()
	ctx := context.Background()

	c, _ := CreateChampionship(ctx, Championship{TrackID: "track1", Name: "Doomed"})

	if err := DeleteChampionship(ctx, c.ChampionshipID); err != nil {
		t.Fatalf("DeleteChampionship: %v", err)
	}

	got, _ := GetChampionship(ctx, c.ChampionshipID)
	if got != nil {
		t.Fatal("expected nil after delete")
	}
}

func TestListChampionshipsForTrack(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()
	ctx := context.Background()

	CreateChampionship(ctx, Championship{TrackID: "trackA", Name: "C1"})
	CreateChampionship(ctx, Championship{TrackID: "trackA", Name: "C2"})
	CreateChampionship(ctx, Championship{TrackID: "trackB", Name: "Other"})

	list, err := ListChampionshipsForTrack(ctx, "trackA")
	if err != nil {
		t.Fatalf("ListChampionshipsForTrack: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("got %d championships, want 2", len(list))
	}

	names := map[string]bool{list[0].Name: true, list[1].Name: true}
	if !names["C1"] || !names["C2"] {
		t.Errorf("unexpected championship names: %v", names)
	}
}
