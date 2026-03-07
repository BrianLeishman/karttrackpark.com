package xrk

import (
	"encoding/binary"
	"math"
	"sort"
)

// ChannelDef describes a single data channel in an XRK file.
type ChannelDef struct {
	Index       uint16
	ShortName   string
	LongName    string
	Size        int
	DecoderType byte
	RateByte    byte
	Units       string
}

// Lap represents a single lap record from the XRK file.
type Lap struct {
	Number     uint16
	DurationMs uint32
	EndTimeMs  uint32
}

// GPSRecord holds raw ECEF GPS data from the XRK file.
type GPSRecord struct {
	TC     int32
	EcefX  int32
	EcefY  int32
	EcefZ  int32
	EcefVX int32
	EcefVY int32
	EcefVZ int32
}

// Sample holds a raw sensor reading at a given timecode.
type Sample struct {
	TC  int32
	Raw []byte
}

// ParseResult holds all data extracted from an XRK binary file.
type ParseResult struct {
	Channels       map[uint16]*ChannelDef
	Groups         map[int][]uint16
	Laps           []Lap
	GPS            []GPSRecord
	ChannelSamples map[uint16][]Sample
	Metadata       map[string]string
}

// TVPair is a decoded time-value pair for a channel.
type TVPair struct {
	TimeMs int32   `json:"tc_ms"`
	Value  float64 `json:"val"`
}

var unitMap = map[byte]string{
	1: "%", 3: "G", 4: "deg", 5: "deg/s",
	6: "", 9: "Hz", 11: "", 12: "mm",
	14: "bar", 15: "rpm", 16: "km/h", 17: "C",
	18: "ms", 19: "Nm", 20: "km/h", 21: "V",
	22: "l", 24: "l/s", 26: "time", 27: "A",
	30: "lambda", 31: "gear", 33: "%", 43: "kg",
}

func nullterm(b []byte) string {
	for i, c := range b {
		if c == 0 {
			return string(b[:i])
		}
	}
	return string(b)
}

func le16(b []byte) uint16 { return binary.LittleEndian.Uint16(b) }
func le32(b []byte) uint32 { return binary.LittleEndian.Uint32(b) }
func lei32(b []byte) int32 { return int32(binary.LittleEndian.Uint32(b)) }

func tokenStr(v uint32) string {
	s := ""
	for v > 0 {
		s += string(rune(v & 0xFF))
		v >>= 8
	}
	return s
}

// Parse parses an XRK binary file from raw bytes.
func Parse(data []byte) (*ParseResult, error) {
	r := &ParseResult{
		Channels:       make(map[uint16]*ChannelDef),
		Groups:         make(map[int][]uint16),
		ChannelSamples: make(map[uint16][]Sample),
		Metadata:       make(map[string]string),
	}

	size := len(data)
	pos := 0

	for pos < size-1 {
		b0, b1 := data[pos], data[pos+1]

		if b0 == '<' && b1 == 'h' {
			if pos+11 >= size {
				pos++
				continue
			}
			token := le32(data[pos+2:])
			hlen := int(lei32(data[pos+6:]))
			ps := pos + 12
			pe := ps + hlen
			if pe > size || hlen < 0 {
				pos++
				continue
			}
			payload := data[ps:pe]
			tok := tokenStr(token)

			switch tok {
			case "CNF":
				pos = ps
				continue
			case "CHS":
				if len(payload) >= 112 {
					idx := le16(payload)
					ch := &ChannelDef{
						Index:       idx,
						ShortName:   nullterm(payload[24:32]),
						LongName:    nullterm(payload[32:56]),
						Size:        int(payload[72]),
						DecoderType: payload[20],
						RateByte:    payload[64] & 0x7F,
					}
					ui := payload[12] & 0x7F
					if u, ok := unitMap[ui]; ok {
						ch.Units = u
					}
					r.Channels[idx] = ch
				}
			case "GRP":
				if len(payload) >= 2 {
					var chs []uint16
					for i := 0; i+1 < len(payload); i += 2 {
						chs = append(chs, le16(payload[i:]))
					}
					r.Groups[len(r.Groups)] = chs
				}
			case "LAP":
				if len(payload) >= 20 && payload[1] == 0 {
					r.Laps = append(r.Laps, Lap{
						Number:     le16(payload[2:]),
						DurationMs: le32(payload[4:]),
						EndTimeMs:  le32(payload[16:]),
					})
				}
			case "GPS", "GPS1":
				for i := 0; i+55 < len(payload); i += 56 {
					r.GPS = append(r.GPS, GPSRecord{
						TC:     lei32(payload[i:]),
						EcefX:  lei32(payload[i+16:]),
						EcefY:  lei32(payload[i+20:]),
						EcefZ:  lei32(payload[i+24:]),
						EcefVX: lei32(payload[i+32:]),
						EcefVY: lei32(payload[i+36:]),
						EcefVZ: lei32(payload[i+40:]),
					})
				}
			case "TRK":
				if len(payload) >= 32 {
					r.Metadata["track"] = nullterm(payload[:32])
				}
			case "RCR":
				r.Metadata["racer"] = nullterm(payload)
			case "VEH":
				r.Metadata["vehicle"] = nullterm(payload)
			case "TMD":
				r.Metadata["date"] = nullterm(payload)
			case "TMT":
				r.Metadata["time"] = nullterm(payload)
			case "VTY":
				r.Metadata["session_type"] = nullterm(payload)
			}

			if pe+8 <= size {
				pos = pe + 8
			} else {
				pos = pe
			}
			continue
		}

		if b0 == '(' && b1 == 'G' {
			if pos+9 >= size {
				pos++
				continue
			}
			tc := lei32(data[pos+2:])
			gi := int(le16(data[pos+6:]))
			if chs, ok := r.Groups[gi]; ok {
				off := 8
				for _, ci := range chs {
					if ch, ok := r.Channels[ci]; ok {
						sz := ch.Size
						if sz == 0 {
							sz = 4
						}
						if pos+off+sz < size {
							raw := make([]byte, sz)
							copy(raw, data[pos+off:pos+off+sz])
							r.ChannelSamples[ci] = append(r.ChannelSamples[ci], Sample{TC: tc, Raw: raw})
						}
						off += sz
					}
				}
				pos += off
				for pos < size && data[pos] != ')' {
					pos++
				}
				pos++
			} else {
				pos++
			}
			continue
		}

		if b0 == '(' && b1 == 'S' {
			if pos+9 >= size {
				pos++
				continue
			}
			tc := lei32(data[pos+2:])
			ci := le16(data[pos+6:])
			if ch, ok := r.Channels[ci]; ok {
				sz := ch.Size
				if sz == 0 {
					sz = 4
				}
				if pos+8+sz < size {
					raw := make([]byte, sz)
					copy(raw, data[pos+8:pos+8+sz])
					r.ChannelSamples[ci] = append(r.ChannelSamples[ci], Sample{TC: tc, Raw: raw})
				}
				pos += 8 + sz + 1
			} else {
				pos++
			}
			continue
		}

		if b0 == '(' && b1 == 'M' {
			if pos+11 >= size {
				pos++
				continue
			}
			tc := lei32(data[pos+2:])
			ci := le16(data[pos+6:])
			count := int(le16(data[pos+8:]))
			if ch, ok := r.Channels[ci]; ok {
				sz := ch.Size
				if sz == 0 {
					sz = 4
				}
				rb := int(ch.RateByte)
				dt := 10
				if rb > 0 && sz > 0 {
					dt = rb / sz
				}
				for i := 0; i < count; i++ {
					so := 10 + i*sz
					if pos+so+sz < size {
						raw := make([]byte, sz)
						copy(raw, data[pos+so:pos+so+sz])
						r.ChannelSamples[ci] = append(r.ChannelSamples[ci], Sample{TC: tc + int32(i*dt), Raw: raw})
					}
				}
				pos += 10 + count*sz + 1
			} else {
				pos++
			}
			continue
		}

		pos++
	}

	sort.Slice(r.GPS, func(i, j int) bool { return r.GPS[i].TC < r.GPS[j].TC })
	return r, nil
}

// DecodeChannel decodes raw samples for a channel into time-value pairs.
func DecodeChannel(samples []Sample, ch *ChannelDef) []TVPair {
	var out []TVPair
	for _, s := range samples {
		if v, ok := decodeValue(s.Raw, ch); ok {
			out = append(out, TVPair{TimeMs: s.TC, Value: v})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].TimeMs < out[j].TimeMs })
	return out
}

func decodeValue(raw []byte, ch *ChannelDef) (float64, bool) {
	sz := ch.Size
	if len(raw) < sz {
		return 0, false
	}
	switch ch.DecoderType {
	case 0, 3, 12, 24:
		if sz >= 4 {
			return float64(lei32(raw)), true
		}
	case 1, 20:
		if sz >= 2 {
			return float64(float16ToFloat32(le16(raw))), true
		}
	case 4, 11:
		if sz >= 2 {
			return float64(int16(le16(raw))), true
		}
	case 6:
		if sz >= 4 {
			return float64(math.Float32frombits(le32(raw))), true
		}
	case 13:
		return float64(raw[0]), true
	case 15:
		if sz >= 2 {
			return float64(le16(raw)), true
		}
	default:
		if sz == 2 {
			return float64(int16(le16(raw))), true
		}
		if sz == 4 {
			return float64(math.Float32frombits(le32(raw))), true
		}
	}
	return 0, false
}

func float16ToFloat32(h uint16) float32 {
	sign := uint32(h>>15) & 1
	exp := uint32(h>>10) & 0x1F
	mant := uint32(h) & 0x3FF
	if exp == 0 {
		if mant == 0 {
			return math.Float32frombits(sign << 31)
		}
		for mant&0x400 == 0 {
			mant <<= 1
			exp--
		}
		exp++
		mant &= 0x3FF
		exp += 127 - 15
		return math.Float32frombits((sign << 31) | (exp << 23) | (mant << 13))
	}
	if exp == 0x1F {
		if mant == 0 {
			return math.Float32frombits((sign << 31) | 0x7F800000)
		}
		return math.Float32frombits((sign << 31) | 0x7FC00000)
	}
	exp += 127 - 15
	return math.Float32frombits((sign << 31) | (exp << 23) | (mant << 13))
}
