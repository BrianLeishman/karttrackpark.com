package main

import (
	"log"
	"net/http"
	"sort"
	"time"

	"github.com/BrianLeishman/karttrackpark.com/go/dynamo"
)

const leaderboardLimit = 50

type LeaderboardEntry struct {
	Position   int     `json:"position"`
	DriverName string  `json:"driver_name"`
	UID        string  `json:"uid"`
	LapTimeMs  int64   `json:"lap_time_ms"`
	MaxSpeed   float64 `json:"max_speed,omitempty"`
	SessionID  string  `json:"session_id"`
	LapNo      int     `json:"lap_no"`
	LayoutID   string  `json:"layout_id"`
	KartClass  string  `json:"kart_class,omitempty"`
	CreatedAt  string  `json:"created_at"`
}

func handleGetLeaderboard(w http.ResponseWriter, r *http.Request) {
	trackID := r.PathValue("id")

	layoutID := r.URL.Query().Get("layout")
	classID := r.URL.Query().Get("class")
	period := r.URL.Query().Get("period")

	// Determine time filter
	var since string
	now := time.Now().UTC()
	switch period {
	case "week":
		since = now.AddDate(0, 0, -7).Format(time.RFC3339)
	case "month":
		since = now.AddDate(0, -1, 0).Format(time.RFC3339)
	case "year":
		since = now.AddDate(-1, 0, 0).Format(time.RFC3339)
	default:
		// "all" — no filter
	}

	// If no layout specified, get track's layouts and use the default (or first)
	layouts, err := dynamo.ListLayouts(r.Context(), trackID)
	if err != nil {
		log.Printf("list layouts error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if layoutID == "" && len(layouts) > 0 {
		for _, l := range layouts {
			if l.IsDefault {
				layoutID = l.LayoutID
				break
			}
		}
		if layoutID == "" {
			layoutID = layouts[0].LayoutID
		}
	}

	if layoutID == "" {
		writeJSON(w, http.StatusOK, map[string]any{
			"entries": []LeaderboardEntry{},
			"layouts": []any{},
			"classes": []any{},
		})
		return
	}

	// Get track's kart classes for the dropdown
	classes, err := dynamo.ListKartClasses(r.Context(), trackID)
	if err != nil {
		log.Printf("list classes error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Query leaderboard: if class specified, query that partition; otherwise query all classes
	var allLaps []dynamo.Lap
	if classID != "" {
		laps, err := dynamo.QueryFastestPersonalBests(r.Context(), layoutID, classID, leaderboardLimit, since)
		if err != nil {
			log.Printf("query leaderboard error: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		allLaps = laps
	} else {
		// Query each class partition + the empty-class partition, merge results
		classKeys := []string{""}
		for _, c := range classes {
			classKeys = append(classKeys, c.ClassID)
		}
		for _, ck := range classKeys {
			laps, err := dynamo.QueryFastestPersonalBests(r.Context(), layoutID, ck, leaderboardLimit, since)
			if err != nil {
				log.Printf("query leaderboard class=%q error: %v", ck, err)
				continue
			}
			allLaps = append(allLaps, laps...)
		}
		// Sort first, then deduplicate — so each driver keeps their fastest lap
		sort.Slice(allLaps, func(i, j int) bool { return allLaps[i].LapTimeMs < allLaps[j].LapTimeMs })
		seen := map[string]bool{}
		deduped := allLaps[:0]
		for _, l := range allLaps {
			if seen[l.UID] {
				continue
			}
			seen[l.UID] = true
			deduped = append(deduped, l)
		}
		allLaps = deduped
		if len(allLaps) > leaderboardLimit {
			allLaps = allLaps[:leaderboardLimit]
		}
	}

	// Enrich with driver names
	names := map[string]string{}
	for _, l := range allLaps {
		if l.UID != "" {
			names[l.UID] = ""
		}
	}
	for uid := range names {
		u, err := dynamo.GetUser(r.Context(), uid)
		if err != nil {
			log.Printf("get user %s error: %v", uid, err)
			continue
		}
		if u != nil && u.Name != "" {
			names[uid] = u.Name
		}
	}

	entries := make([]LeaderboardEntry, len(allLaps))
	for i, l := range allLaps {
		entries[i] = LeaderboardEntry{
			Position:   i + 1,
			DriverName: names[l.UID],
			UID:        l.UID,
			LapTimeMs:  l.LapTimeMs,
			MaxSpeed:   l.MaxSpeed,
			SessionID:  l.SessionID,
			LapNo:      l.LapNo,
			LayoutID:   l.LayoutID,
			KartClass:  l.KartClass,
			CreatedAt:  l.CreatedAt,
		}
	}

	// Build layout/class lists for frontend dropdowns
	type layoutInfo struct {
		LayoutID  string `json:"layout_id"`
		Name      string `json:"name"`
		IsDefault bool   `json:"is_default"`
	}
	type classInfo struct {
		ClassID   string `json:"class_id"`
		Name      string `json:"name"`
		IsDefault bool   `json:"is_default"`
	}

	layoutList := make([]layoutInfo, len(layouts))
	for i, l := range layouts {
		layoutList[i] = layoutInfo{LayoutID: l.LayoutID, Name: l.Name, IsDefault: l.IsDefault}
	}
	classList := make([]classInfo, len(classes))
	for i, c := range classes {
		classList[i] = classInfo{ClassID: c.ClassID, Name: c.Name, IsDefault: c.IsDefault}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"entries": entries,
		"layouts": layoutList,
		"classes": classList,
	})
}
