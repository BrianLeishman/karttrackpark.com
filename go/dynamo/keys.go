package dynamo

import (
	"fmt"
	"strings"
)

// Partition keys
func UserPK(uid string) string         { return "USER#" + uid }
func TrackPK(id string) string         { return "TRACK#" + id }
func SessionPK(id string) string       { return "SESSION#" + id }
func KartPK(id string) string          { return "KART#" + id }
func EventPK(id string) string         { return "EVENT#" + id }
func APIKeyLookupPK(hash string) string { return "APIKEY#" + hash }

// GSI1 keys for global event timeline
const AllEventsGSI1PK = "ALLEVENTS"

// Sort keys
const ProfileSK = "PROFILE"

func MemberSK(uid string) string    { return "MEMBER#" + uid }
func InviteSK(email string) string  { return "INVITE#" + strings.ToLower(email) }
func LayoutSK(id string) string     { return "LAYOUT#" + id }
func LapSK(lapNo int) string        { return fmt.Sprintf("LAP#%06d", lapNo) }
func APIKeySK(keyID string) string   { return "APIKEY#" + keyID }

// GSI1 keys for email lookup
func EmailGSI1PK(email string) string { return "EMAIL#" + strings.ToLower(email) }

// GSI1 keys for invite lookup
func InviteGSI1PK(email string) string { return "INVITE#" + strings.ToLower(email) }

// GSI1 keys for leaderboard
func LeaderboardGSI1PK(layoutID, class string) string {
	return "LAYOUT#" + layoutID + "#CLASS#" + class
}

func LeaderboardGSI1SK(lapTimeMs int64) string {
	return fmt.Sprintf("%010d", lapTimeMs)
}
