package dynamo

import (
	"context"
	"testing"
)

func TestCreateSeries(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()
	ctx := context.Background()

	s, err := CreateSeries(ctx, Series{TrackID: "track1", ChampionshipID: "champ1", Name: "Super League"})
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	if s.SeriesID == "" {
		t.Fatal("expected non-empty SeriesID")
	}
	if s.TrackID != "track1" {
		t.Errorf("TrackID = %q, want %q", s.TrackID, "track1")
	}
	if s.ChampionshipID != "champ1" {
		t.Errorf("ChampionshipID = %q, want %q", s.ChampionshipID, "champ1")
	}
	if s.Name != "Super League" {
		t.Errorf("Name = %q, want %q", s.Name, "Super League")
	}
	if s.CreatedAt == "" {
		t.Error("expected non-empty CreatedAt")
	}
	if s.Status != "upcoming" {
		t.Errorf("Status = %q, want %q", s.Status, "upcoming")
	}
}

func TestCreateSeries_ExplicitStatus(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()

	s, _ := CreateSeries(context.Background(), Series{TrackID: "t1", ChampionshipID: "c1", Name: "Active", Status: "active"})
	if s.Status != "active" {
		t.Errorf("Status = %q, want %q", s.Status, "active")
	}
}

func TestGetSeries(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()
	ctx := context.Background()

	created, _ := CreateSeries(ctx, Series{TrackID: "track1", ChampionshipID: "champ1", Name: "Test Series"})

	got, err := GetSeries(ctx, created.SeriesID)
	if err != nil {
		t.Fatalf("GetSeries: %v", err)
	}
	if got == nil {
		t.Fatal("expected non-nil series")
	}
	if got.Name != "Test Series" {
		t.Errorf("Name = %q, want %q", got.Name, "Test Series")
	}
}

func TestGetSeries_NotFound(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()

	got, err := GetSeries(context.Background(), "nonexistent")
	if err != nil {
		t.Fatalf("GetSeries: %v", err)
	}
	if got != nil {
		t.Fatal("expected nil for nonexistent series")
	}
}

func TestUpdateSeries(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()
	ctx := context.Background()

	s, _ := CreateSeries(ctx, Series{TrackID: "track1", ChampionshipID: "champ1", Name: "Old Name"})

	if err := UpdateSeries(ctx, s.SeriesID, map[string]interface{}{"name": "New Name"}); err != nil {
		t.Fatalf("UpdateSeries: %v", err)
	}

	got, _ := GetSeries(ctx, s.SeriesID)
	if got.Name != "New Name" {
		t.Errorf("Name = %q, want %q", got.Name, "New Name")
	}
}

func TestDeleteSeries(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()
	ctx := context.Background()

	s, _ := CreateSeries(ctx, Series{TrackID: "track1", ChampionshipID: "champ1", Name: "Doomed"})

	if err := DeleteSeries(ctx, s.SeriesID); err != nil {
		t.Fatalf("DeleteSeries: %v", err)
	}

	got, _ := GetSeries(ctx, s.SeriesID)
	if got != nil {
		t.Fatal("expected nil after delete")
	}
}

func TestListSeriesForChampionship(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()
	ctx := context.Background()

	CreateSeries(ctx, Series{TrackID: "trackA", ChampionshipID: "champA", Name: "S1"})
	CreateSeries(ctx, Series{TrackID: "trackA", ChampionshipID: "champA", Name: "S2"})
	CreateSeries(ctx, Series{TrackID: "trackB", ChampionshipID: "champB", Name: "Other"})

	list, err := ListSeriesForChampionship(ctx, "champA")
	if err != nil {
		t.Fatalf("ListSeriesForChampionship: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("got %d series, want 2", len(list))
	}

	names := map[string]bool{list[0].Name: true, list[1].Name: true}
	if !names["S1"] || !names["S2"] {
		t.Errorf("unexpected series names: %v", names)
	}
}

func TestUpdateSeries_StatusAndRules(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()
	ctx := context.Background()

	s, _ := CreateSeries(ctx, Series{TrackID: "t1", ChampionshipID: "c1", Name: "League"})
	UpdateSeries(ctx, s.SeriesID, map[string]interface{}{"status": "active", "rules": "No contact"})

	got, _ := GetSeries(ctx, s.SeriesID)
	if got.Status != "active" {
		t.Errorf("Status = %q, want %q", got.Status, "active")
	}
	if got.Rules != "No contact" {
		t.Errorf("Rules = %q, want %q", got.Rules, "No contact")
	}
}

// --- Series Events ---

func TestSeriesEvents(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()
	ctx := context.Background()

	se, err := AddEventToSeries(ctx, SeriesEvent{
		SeriesID:    "series1",
		EventID:     "evt1",
		RoundNumber: 1,
		EventName:   "Round 1",
	})
	if err != nil {
		t.Fatalf("AddEventToSeries: %v", err)
	}
	if se.CreatedAt == "" {
		t.Error("expected non-empty CreatedAt")
	}

	AddEventToSeries(ctx, SeriesEvent{SeriesID: "series1", EventID: "evt2", RoundNumber: 2, EventName: "Round 2"})
	AddEventToSeries(ctx, SeriesEvent{SeriesID: "other", EventID: "evt3", RoundNumber: 1})

	list, err := ListSeriesEvents(ctx, "series1")
	if err != nil {
		t.Fatalf("ListSeriesEvents: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("got %d events, want 2", len(list))
	}

	// Remove one
	RemoveEventFromSeries(ctx, "series1", "evt1")
	list, _ = ListSeriesEvents(ctx, "series1")
	if len(list) != 1 {
		t.Fatalf("got %d after removal, want 1", len(list))
	}
}

// --- Series Drivers ---

func TestSeriesDrivers(t *testing.T) {
	_, cleanup := setup()
	defer cleanup()
	ctx := context.Background()

	sd, err := EnrollDriver(ctx, SeriesDriver{
		SeriesID:   "series1",
		UID:        "u1",
		DriverName: "Alice",
		Seeded:     true,
	})
	if err != nil {
		t.Fatalf("EnrollDriver: %v", err)
	}
	if sd.SeriesID != "series1" {
		t.Errorf("SeriesID = %q", sd.SeriesID)
	}

	EnrollDriver(ctx, SeriesDriver{SeriesID: "series1", UID: "u2", DriverName: "Bob"})

	// Get single driver
	got, err := GetSeriesDriver(ctx, "series1", "u1")
	if err != nil {
		t.Fatalf("GetSeriesDriver: %v", err)
	}
	if got.DriverName != "Alice" {
		t.Errorf("DriverName = %q, want Alice", got.DriverName)
	}

	// Update
	UpdateSeriesDriver(ctx, "series1", "u1", map[string]interface{}{"totalPoints": 42})

	// List
	list, err := ListSeriesDrivers(ctx, "series1")
	if err != nil {
		t.Fatalf("ListSeriesDrivers: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("got %d drivers, want 2", len(list))
	}

	// Delete
	DeleteSeriesDriver(ctx, "series1", "u2")
	list, _ = ListSeriesDrivers(ctx, "series1")
	if len(list) != 1 {
		t.Fatalf("got %d after delete, want 1", len(list))
	}
}
