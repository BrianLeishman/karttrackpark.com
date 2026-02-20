package tools

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/BrianLeishman/justlog.io/go/dynamo"
)

func buildContext(ctx context.Context, uid string) string {
	var b strings.Builder
	b.WriteString("=== USER CONTEXT ===\n")

	// Profile
	profile, err := dynamo.GetProfile(ctx, uid)
	if profile == nil {
		profile = dynamo.Profile{}
	}
	if err == nil && len(profile) > 0 {
		b.WriteString("\n## Profile\n")
		for _, f := range dynamo.ProfileFields {
			if v := profile[f.Key]; v != "" {
				b.WriteString(fmt.Sprintf("- %s: %s\n", f.Label, v))
			}
		}
		if age := profile.Age(time.Now()); age >= 0 {
			b.WriteString(fmt.Sprintf("- Age: %d years old\n", age))
		}
	}

	loc := profile.Timezone()
	now := time.Now().In(loc)
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc).UTC()
	todayEnd := todayStart.Add(24 * time.Hour)
	sevenAgo := todayStart.AddDate(0, 0, -7)
	thirtyAgo := todayStart.AddDate(0, 0, -30)

	// Today's food
	food, _ := dynamo.GetEntries(ctx, uid, "food", todayStart, todayEnd)
	b.WriteString("\n## Today's Food\n")
	if len(food) == 0 {
		b.WriteString("No food logged yet today.\n")
	} else {
		var totalCal, totalP, totalC, totalF, totalFib float64
		for _, e := range food {
			b.WriteString(fmt.Sprintf("- %s — %g cal, %gp/%gc/%gf\n", e.Description, e.Calories, e.Protein, e.Carbs, e.Fat))
			totalCal += e.Calories
			totalP += e.Protein
			totalC += e.Carbs
			totalF += e.Fat
			totalFib += e.Fiber
		}
		b.WriteString(fmt.Sprintf("Today's totals: %.0f cal, %.0fg protein, %.0fg carbs, %.0fg fat, %.0fg fiber\n", totalCal, totalP, totalC, totalF, totalFib))
	}

	// Today's exercise
	exercise, _ := dynamo.GetEntries(ctx, uid, "exercise", todayStart, todayEnd)
	b.WriteString("\n## Today's Exercise\n")
	if len(exercise) == 0 {
		b.WriteString("No exercise logged yet today.\n")
	} else {
		var totalBurned float64
		for _, e := range exercise {
			b.WriteString(fmt.Sprintf("- %s — %.0f min, %.0f cal burned\n", e.Description, e.Duration, e.Calories))
			totalBurned += e.Calories
		}
		b.WriteString(fmt.Sprintf("Today's total burned: %.0f cal\n", totalBurned))
	}

	// Today's weight
	weight, _ := dynamo.GetEntries(ctx, uid, "weight", todayStart, todayEnd)
	b.WriteString("\n## Today's Weight\n")
	if len(weight) == 0 {
		b.WriteString("No weight logged today.\n")
	} else {
		for _, e := range weight {
			b.WriteString(fmt.Sprintf("- %.1f %s\n", e.Value, e.Unit))
		}
	}

	// 7-day and 30-day averages
	food7, _ := dynamo.GetEntries(ctx, uid, "food", sevenAgo, todayEnd)
	food30, _ := dynamo.GetEntries(ctx, uid, "food", thirtyAgo, todayEnd)
	exercise7, _ := dynamo.GetEntries(ctx, uid, "exercise", sevenAgo, todayEnd)
	exercise30, _ := dynamo.GetEntries(ctx, uid, "exercise", thirtyAgo, todayEnd)

	b.WriteString("\n## Averages\n")
	writeCalAvg(&b, "Calories in (7-day avg)", food7, 7, func(e dynamo.Entry) float64 { return e.Calories })
	writeCalAvg(&b, "Calories in (30-day avg)", food30, 30, func(e dynamo.Entry) float64 { return e.Calories })
	writeCalAvg(&b, "Protein (7-day avg)", food7, 7, func(e dynamo.Entry) float64 { return e.Protein })
	writeCalAvg(&b, "Protein (30-day avg)", food30, 30, func(e dynamo.Entry) float64 { return e.Protein })
	writeCalAvg(&b, "Calories burned (7-day avg)", exercise7, 7, func(e dynamo.Entry) float64 { return e.Calories })
	writeCalAvg(&b, "Calories burned (30-day avg)", exercise30, 30, func(e dynamo.Entry) float64 { return e.Calories })

	// 30-day weight history
	weight30, _ := dynamo.GetEntries(ctx, uid, "weight", thirtyAgo, todayEnd)
	b.WriteString("\n## Weight History (30 days)\n")
	if len(weight30) == 0 {
		b.WriteString("No weight recordings in the last 30 days.\n")
	} else {
		// Group by day, take latest per day
		byDay := map[string]dynamo.Entry{}
		for _, e := range weight30 {
			day := e.CreatedAt[:10]
			if existing, ok := byDay[day]; !ok || e.CreatedAt > existing.CreatedAt {
				byDay[day] = e
			}
		}
		// Sort days
		days := sortedKeys(byDay)
		for _, day := range days {
			e := byDay[day]
			b.WriteString(fmt.Sprintf("- %s: %.1f %s\n", day, e.Value, e.Unit))
		}
	}

	b.WriteString("\n=== END CONTEXT ===\n\n")
	return b.String()
}

func writeCalAvg(b *strings.Builder, label string, entries []dynamo.Entry, days int, extract func(dynamo.Entry) float64) {
	if len(entries) == 0 {
		b.WriteString(fmt.Sprintf("- %s: no data\n", label))
		return
	}
	var total float64
	for _, e := range entries {
		total += extract(e)
	}
	b.WriteString(fmt.Sprintf("- %s: %.0f/day\n", label, total/float64(days)))
}

func sortedKeys(m map[string]dynamo.Entry) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	// Simple sort — dates in YYYY-MM-DD format sort lexically
	for i := range out {
		for j := i + 1; j < len(out); j++ {
			if out[j] < out[i] {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
}
