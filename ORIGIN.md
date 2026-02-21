Here’s a detailed “state of the design” snapshot of where we left things, organized so you can drop it into a fresh session and keep building without re-deriving decisions.

---

## Product goal

You want **karttrackpark.com** to feel like **Garage61** (and generally “fast bootstrap site” like Cars & Bids):

* Track pages: top times / leaderboards with filters.
* Driver pages: sessions and laps, compare laps.
* Session pages: all laps + summary table.
* “Analyze” view: map line(s) overlay + telemetry charts (initially just GPS/speed; later throttle/brake/etc).
* Optional social: comments on sessions.

You also want the system to eventually grow into **track management software** (driver↔kart assignment, pit status, events/leagues, flags, etc.), but **Phase 1 is history-only telemetry review**, not live timing.

---

## Phase 1 scope (MVP)

### Data source you actually have today

You confirmed you already own an **AIM Solo** and use it for rental karts.

For early version:

* You **will** have: GPS position + speed (from GPS), timestamps
* You **might** have: steering/wheel angle (if you mount it on the wheel and can derive)
* You **do not** have yet: throttle/brake/gear/RPM (rental karts)

So the first version should implement the Garage61 screens you posted, but with fewer channels:

* Map overlay
* Speed trace
* Steering trace if available

### UX pages to build first

1. **Driver → Session list** (recent sessions, filters by track/layout/type)
2. **Session detail** (list of laps with summary stats, “Analyze” button per lap)
3. **Lap analyze page** (map polyline overlay(s), speed plot, steering plot)

---

## High-level AWS architecture decisions

You wanted:

* AWS
* Serverless
* No home-rolled auth or infrastructure
* Go Lambdas

### Final “serverless backbone”

* **Hugo** static site deployment (you already have Git→deploy solved)
* **Auth**: Amazon Cognito (Hosted UI + Google login support)
* **API**: API Gateway → **one Go Lambda** (HTTP-router style)
* **Raw uploads**: API returns **pre-signed S3 PUT** URL; client uploads file directly to S3
* **Ingest**: S3 ObjectCreated event triggers a Lambda that parses Solo exports
* **Storage**:

  * **S3** = canonical raw archive (CSV/whatever you upload)
  * **DynamoDB** = metadata + indices + summaries (fast reads)
  * **Timestream** = optional for dense time-series later (and/or second stage)

Key design stance:

* For MVP uploads-after-session, **skip Kinesis/Firehose**. Those are for *live streaming* later.
* Keep the UI fast by **serving small precomputed summaries** and only loading heavier data when user clicks “Analyze”. CPU isn’t the limiting factor; bandwidth + parsing overhead is.

### Live streaming (future, not MVP)

When you eventually do real-time:

* IoT Core → (rules) → Firehose → Timestream/S3
* WebSockets for live dashboards, etc.

---

## ID strategy

You said you want to use **XID** (12 bytes, time-ordered-ish) and prefer it over UUID.

Decision:

* XID is fine.
* Main caution: don’t use purely time-ordered IDs as high-write **partition keys** in a way that could hotspot.
* Use stable grouping keys for PKs (e.g., `SESSION#<sid>`, `USER#<uid>`) and XID as the session/lap id inside those.

---

## DynamoDB mental model we converged on

You’re relational-heavy, so the approach was:

* **Single-table design**
* Prefix-based PK/SK (“USER#…”, “SESSION#…”, etc.)
* Model **queries** first; avoid scans; joins are “pre-joined” by co-locating items in the same partition.

### Your “query inventory” that drove the schema

Core hot queries:

* Q1: My sessions (recent)
* Q2: Event dashboard (sessions in an event ordered by schedule)
* Q3: Session roster (karts/drivers in session)
* Q4: Fastest laps leaderboards (track/layout, by time window, by class)
* Q5: Lap overlays (fetch 1–N laps’ data)

Plus new ones:

* Kart performance: fastest/slowest karts, theoretical kart ceiling using “fast drivers”
* Verified vs unverified filtering everywhere

---

## Data model you built up (entities + hierarchy)

### Core entities

* Users: drivers, track operators/owners
* Tracks
* Layouts (track can have multiple layouts, reverse/short/etc.)
* Sessions (always tied to one track + one layout)
* Events (group sessions; may span multiple tracks)
* Seasons (group events; have points; points rules vary by event)

### Session types you described

* Rental/quali/best-time sessions
* Position/race sessions
* Complex league-night flow: multiple groups, multiple heats, C/B/A finals, mixed layouts, mixed kart types

Decision: represent those as **sessions under an event** with attributes like:

* `session_type` (quali/heat/final/practice/etc.)
* `group` (A/B)
* `class` or `kart_class` (rental-light, rental-heavy, pro, etc.)
* `layout_id` (can differ even within an event)

---

## Telemetry storage approach (MVP vs later)

### MVP lap summary object

Instead of storing full dense streams everywhere:

* Parse Solo export → create **per-lap summary item** that includes enough to draw map + speed plot:

  * Lap time
  * Sector times
  * Downsampled polyline (e.g., ~10Hz or reduced points)
  * Max speed
  * Optional steering series aligned to poly points
* Keep the raw file in S3 as source-of-truth.

Rule: Keep Dynamo items small; shove big blobs into S3 and store a pointer.

### Timestream stance

* Timestream is a good fit for real time-series querying and longer-term evolution.
* For Phase 1, you could ship just with:

  * S3 raw
  * Dynamo lap summaries
    …and add Timestream when you want richer analytics or higher-frequency channels.

---

## One-Lambda API design (your preference)

You wanted a single Go Lambda that behaves like a stdlib HTTP server locally, and adapts to API Gateway in Lambda.

Decision:

* That’s a good approach.
* API Gateway routes → same Lambda binary → router dispatches by path/method.

Routes we discussed as MVP:

* `POST /presign` → returns pre-signed S3 upload URL
* `GET /sessions?user=me&trackId=...` → session list
* `GET /laps?sessionId=...` → lap list for session
* `GET /lap?lapId=...` → fetch lap payload for analysis view (or `GET /sessions/{sid}/laps/{lapNo}`)

---

## Dynamo single-table schema snapshot (the “current” shape)

We ended up with a single Dynamo table with `pk` and `sk`, plus a few GSIs.

### Main item groups (by PK)

* `USER#<uid>`

  * `PROFILE`
  * `SESSION#<sid>` (index entry so “my sessions” is a single Query)
* `TRACK#<trackId>`

  * `SEASON#<seasonId>`
  * `SEASON#...#EVENT#...` (indexing)
* `SEASON#<seasonId>`

  * `PROFILE`
  * `POINTS_RULES` (JSON blob rules)
  * `EVENT#<eventId>` (events in season)
  * `DRIVER#<uid>` (season standings rows)
* `EVENT#<eventId>`

  * `SESSION#<sid>` (sessions in event)
  * optionally cached per-class leaderboard items
* `SESSION#<sid>`

  * `KART#<kartId>` roster entries (supports swaps)
  * `LAP#<lapNo>` lap summary rows
* `KART#<kartId>`

  * `PROFILE`
  * `TRACK#<trackId>#STATS` (kart health/performance rollups)

### GSIs (the ones that mattered)

* Fastest lap leaderboard index (verified-only)

  * `GSI_FastLap`:

    * PK: `LAYOUT#<layoutId>#CLASS#<kartClass>`
    * SK: `lap_ms` (ascending)
* Kart ranking index (verified-only derived stats)

  * `GSI_KartRank`:

    * PK: `TRACK#<trackId>#<layoutId>` (or similar)
    * SK: `theoretical_best_ms` (ascending)

We also talked about an event agenda/time ordering index if needed.

---

## Verified laps requirement (this was a key late addition)

You need to support:

* Users uploading laps themselves (unverified)
* Operators “publishing”/verifying laps
* Filtering everywhere between **verified only** vs **all**
* Leaderboards should default to verified-only

### Final approach

* Add `verified: bool` on lap items (default false).
* **Do not put unverified laps into leaderboard GSIs**.

  * Mechanism: only populate GSI attributes (`gsi1pk/gsi1sk`) when verified.
  * If unverified, those attributes are absent → the item never appears in the index.
* For session-level lists (which are already small), you can filter in the Query using `FilterExpression verified = true` when needed.
* Add an operator API: `PATCH /lap/{lapId}` → flips verified to true.
* When a lap becomes verified, you trigger “side effects” (recompute session best lap, update kart stats, update leaderboards, season points, etc.). This can be done via Dynamo Streams or an explicit secondary Lambda.

Net effect:

* Verified-only leaderboards stay fast (pure GSI Query).
* “Show me everything including unverified” remains possible via base-table Query + optional filter.

---

## Kart performance requirement (fastest/slowest kart, ceiling, anomalies)

You added:

* Every kart has a unique number; want per-kart performance and a way to infer “kart ceiling” using only top drivers to remove driver skill bias.
* Future: identify advantaged/problem karts.

Approach chosen:

* Store per-kart stats rollups as items under `KART#<kartId>` (e.g. `SK=TRACK#<trackId>#STATS`).
* Drive rankings via GSI on `theoretical_best_ms`.
* Normalization heuristic (initially simple): compare lap times to driver baseline at that track/layout; use top cohort of drivers to compute “ceiling”.
* Only feed verified laps into those rollups so the “health” metrics aren’t polluted.

---

## Seasons + variable points rules

You added:

* Events belong to seasons.
* Driver points accumulate per season.
* Points rules vary by event.

Model chosen:

* `SEASON#<seasonId>` partition contains:

  * `POINTS_RULES` item (JSON blob)
  * `EVENT#<eventId>` items
  * `DRIVER#<uid>` standings items
* When finalizing an event, a Lambda applies the rule JSON (event override or season default) and updates season standings items.

---

## Where you planned to start implementation

The concrete “first build” path was:

1. Stand up **Cognito** + Hosted UI Google login.
2. Create **S3 raw bucket** + presigned upload endpoint.
3. S3 upload triggers **ingest Lambda**:

   * parse Solo file
   * segment laps
   * compute lap summaries (polyline + speed + sectors, etc.)
   * write into Dynamo under `SESSION#<sid>` + `LAP#<lapNo>`
   * create session summary + session index under `USER#<uid>`
4. Hugo pages call APIs:

   * sessions list → session details → analyze lap
5. Only after that works:

   * add leaderboards (verified-only GSI)
   * add kart stats rollups
   * add events/seasons UI

---

## Open questions / things not fully pinned down yet

These are the areas you’d likely need to decide next in a new session:

1. **Exact lap summary storage**

   * Store polyline directly in Dynamo vs store in S3 and keep pointer?
   * (We leaned toward S3 for anything that grows beyond a few KB.)
2. **Lap segmentation**

   * How to detect lap boundaries from Solo export reliably (start/finish GPS gate? time gap?).
3. **Layout identity**

   * How you represent layouts (manual polygons? operator-defined start/finish + sectors?).
4. **Operator workflow**

   * What counts as “verified”: per lap, per session, or both?
   * Who has permission: track owner/operator role.
5. **Leaderboards “by day/week/month/year”**

   * If you need fast leaderboard queries by time window, you’ll likely need either:

     * precomputed leaderboard bucket items per period, or
     * additional GSI partitioning by time bucket.

---

If you want, in the new session you can ask for the next most useful artifact: a **concrete Dynamo single-table + GSI definition** (CloudFormation/SAM) plus a **Go data access layer** with strongly typed structs and helper functions (`PutLap`, `ListSessionsForUser`, `ListLapsForSession`, `VerifyLap`, `QueryFastestVerifiedLaps`, etc.). That’s usually the moment Dynamo “clicks” for relational folks because you stop thinking in tables and start thinking in “item collections + queries.”
