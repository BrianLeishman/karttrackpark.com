package xrk

import (
	"math"
	"sort"
)

// GPSRow is a decoded GPS data point with WGS84 coordinates.
type GPSRow struct {
	TimeMs   int32   `json:"tc_ms"`
	Lat      float64 `json:"lat"`
	Lon      float64 `json:"lon"`
	AltM     float64 `json:"alt_m"`
	SpeedMph float64 `json:"speed_mph"`
	DistFt   float64 `json:"dist_ft"`
}

// BuildGPSRows converts raw ECEF GPS records to WGS84 rows with speed and cumulative distance.
func BuildGPSRows(records []GPSRecord) []GPSRow {
	var rows []GPSRow
	for _, rec := range records {
		if rec.EcefX == 0 && rec.EcefY == 0 {
			continue
		}
		lat, lon, alt := ecefToLatLonAlt(rec.EcefX, rec.EcefY, rec.EcefZ)
		vx := float64(rec.EcefVX) / 100.0
		vy := float64(rec.EcefVY) / 100.0
		vz := float64(rec.EcefVZ) / 100.0
		speed := math.Sqrt(vx*vx+vy*vy+vz*vz) * 3.6 * 0.621371
		rows = append(rows, GPSRow{TimeMs: rec.TC, Lat: lat, Lon: lon, AltM: alt, SpeedMph: speed})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].TimeMs < rows[j].TimeMs })

	for i := 1; i < len(rows); i++ {
		d := haversineFt(rows[i-1].Lat, rows[i-1].Lon, rows[i].Lat, rows[i].Lon)
		dt := float64(rows[i].TimeMs-rows[i-1].TimeMs) / 1000.0
		if dt > 0 && d/dt < 300 {
			rows[i].DistFt = rows[i-1].DistFt + d
		} else {
			rows[i].DistFt = rows[i-1].DistFt
		}
	}
	return rows
}

func ecefToLatLonAlt(xCm, yCm, zCm int32) (lat, lon, alt float64) {
	x := float64(xCm) / 100.0
	y := float64(yCm) / 100.0
	z := float64(zCm) / 100.0
	a := 6378137.0
	b := 6356752.314245
	e2 := 1 - (b*b)/(a*a)
	ep2 := (a*a)/(b*b) - 1
	p := math.Sqrt(x*x + y*y)
	lon = math.Atan2(y, x)
	theta := math.Atan2(z*a, p*b)
	lat = math.Atan2(z+ep2*b*math.Pow(math.Sin(theta), 3), p-e2*a*math.Pow(math.Cos(theta), 3))
	sinLat := math.Sin(lat)
	N := a / math.Sqrt(1-e2*sinLat*sinLat)
	if math.Abs(lat) < math.Pi/4 {
		alt = p/math.Cos(lat) - N
	} else {
		alt = z/math.Sin(lat) - N*(1-e2)
	}
	return radToDeg(lat), radToDeg(lon), alt
}

func degToRad(deg float64) float64 { return deg * math.Pi / 180 }
func radToDeg(rad float64) float64 { return rad * 180 / math.Pi }

func haversineFt(lat1, lon1, lat2, lon2 float64) float64 {
	dlat := degToRad(lat2 - lat1)
	dlon := degToRad(lon2 - lon1)
	a := math.Sin(dlat/2)*math.Sin(dlat/2) +
		math.Cos(degToRad(lat1))*math.Cos(degToRad(lat2))*math.Sin(dlon/2)*math.Sin(dlon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return 6371000 * c * 3.28084
}
