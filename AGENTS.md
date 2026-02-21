# Kart Track Park — Development Guide

This document is the canonical reference for how Kart Track Park is built. It covers architecture, patterns, and conventions across the entire stack. AI agents working on this codebase should follow the patterns described here.

## Project Overview

Kart Track Park is a go-kart track information and community site.

**Philosophy:** Minimal dependencies. Pure Bootstrap, pure Go, pure TypeScript. Every technology choice should be idiomatic to the tool itself — no unnecessary abstractions, wrappers, or frameworks.

**AWS Profile:** All AWS operations use `AWS_PROFILE=ktp`. Set this in your shell or prefix commands with it. Never use the default profile — that points to a different account.

## Directory Structure

```
karttrackpark.com/
├── site/                        # Hugo frontend
│   ├── config/_default/
│   │   └── hugo.toml
│   ├── assets/
│   │   ├── scss/
│   │   │   ├── main.scss        # Imports variables → Bootstrap → custom styles
│   │   │   └── _variables.scss  # Bootstrap variable overrides
│   │   └── js/                  # esbuild output (gitignored)
│   ├── content/
│   ├── layouts/
│   │   └── _default/
│   │       └── baseof.html
│   ├── static/
│   ├── ts/                      # TypeScript source
│   │   └── index.ts
│   ├── package.json
│   └── tsconfig.json
├── go/
│   ├── cmd/
│   │   ├── compile-ts/          # esbuild Go wrapper
│   │   └── hugo-server/         # Dev server (esbuild watch + hugo)
│   ├── lambda/
│   │   └── api/                 # REST API
│   │       ├── main.go          # Route registration, CORS, Lambda/local entrypoint
│   │       ├── auth.go          # requireAuth(), requireTrackRole()
│   │       ├── tracks.go        # Track + layout handlers
│   │       ├── invites.go       # Invite + member handlers
│   │       ├── sessions.go      # Session + lap handlers
│   │       └── upload.go        # Presigned S3 upload URL handler
│   └── dynamo/                  # DynamoDB data access layer
│       ├── client.go            # DynamoDB client singleton (table: "ktp")
│       ├── keys.go              # PK/SK/GSI key builders
│       ├── update.go            # Reusable update expression builder
│       ├── apikey.go            # API key create/lookup/delete
│       ├── user.go              # User profile CRUD
│       ├── track.go             # Track, member, invite, layout CRUD
│       ├── session.go           # Session CRUD
│       ├── lap.go               # Lap CRUD + leaderboard queries
│       └── kart.go              # Kart CRUD (minimal)
├── go.mod
├── go.sum
├── AGENTS.md
└── README.md
```

## Frontend

### Hugo

The site is a Hugo static site. It should look like a Bootstrap documentation example — clean, standard, nothing fancy.

### Bootstrap SCSS

Bootstrap 5.3 is installed via npm and compiled through Hugo's Dart Sass asset pipeline.

**Variables-first customization.** Custom variables are imported _before_ Bootstrap's SCSS source so Bootstrap uses our values throughout its compilation. This is how Bootstrap is meant to be customized — via its variable system, not CSS overrides.

The SCSS import order in `main.scss`:

```scss
// 1. Bootstrap functions (required before variable overrides)
@import '../node_modules/bootstrap/scss/functions';

// 2. Custom variable overrides
@import 'variables';

// 3. Bootstrap source (uses our variables)
@import '../node_modules/bootstrap/scss/variables';
@import '../node_modules/bootstrap/scss/variables-dark';
@import '../node_modules/bootstrap/scss/maps';
@import '../node_modules/bootstrap/scss/mixins';
@import '../node_modules/bootstrap/scss/root';
@import '../node_modules/bootstrap/scss/utilities';
@import '../node_modules/bootstrap/scss/reboot';
@import '../node_modules/bootstrap/scss/type';
@import '../node_modules/bootstrap/scss/images';
@import '../node_modules/bootstrap/scss/containers';
@import '../node_modules/bootstrap/scss/grid';
@import '../node_modules/bootstrap/scss/helpers';
// ... selective component imports (only what's used) ...
@import '../node_modules/bootstrap/scss/utilities/api';

// 4. Custom component styles (after Bootstrap)
```

The current theme is default Bootstrap blue. The `_variables.scss` file is minimal for now.

Hugo makes `node_modules` accessible to SCSS by mounting it in `hugo.toml`:

```toml
[[module.mounts]]
source = "node_modules"
target = "assets/node_modules"
```

Hugo compiles, minifies, and fingerprints the CSS in `baseof.html`:

```html
{{ $opts := dict "transpiler" "dartsass" }}
{{ $css := resources.Get "scss/main.scss" | toCSS $opts | minify | fingerprint }}
<link rel="stylesheet" href="{{ $css.RelPermalink }}" integrity="{{ $css.Data.Integrity }}">
```

### TypeScript

TypeScript is compiled using the Go esbuild API — not the esbuild CLI.

The build tool lives at `go/cmd/compile-ts/`. It calls esbuild programmatically:

```go
api.BuildOptions{
    EntryPoints:       []string{"ts/index.ts"},
    Outfile:           "assets/js/app.js",
    Sourcemap:         api.SourceMapLinked,
    Bundle:            true,
    Format:            api.FormatESModule,
    Target:            api.ES2020,
    Write:             true,
    MinifyWhitespace:  true,
    MinifyIdentifiers: true,
    MinifySyntax:      true,
}
```

The dev server at `go/cmd/hugo-server/` runs esbuild in watch mode and then starts Hugo. Both rebuild on file changes.

Hugo includes the compiled JS in `baseof.html`:

```html
{{ with resources.Get "js/app.js" | fingerprint }}
    <script type="module" src="{{ .RelPermalink }}" integrity="{{ .Data.Integrity }}"></script>
{{ end }}
{{ with resources.Get "js/app.js.map" }}{{ .Publish }}{{ end }}
```

All assets are fingerprinted for cache busting and include SRI integrity attributes.

## API

### Handler Pattern

The API is a pure Go HTTP server using stdlib `net/http`. No frameworks.

Handlers use the standard signature:

```go
func handleSomething(w http.ResponseWriter, r *http.Request)
```

Helpers `writeJSON(w, status, v)` and `writeError(w, status, msg)` handle JSON responses.

### Authentication

Auth uses API keys only (no Cognito yet). The `requireAuth(r)` helper extracts Bearer token → `dynamo.LookupAPIKey` → returns userId. The `requireTrackRole(r, trackID, uid, roles...)` helper checks membership + role.

### Route Table

Routes are registered in `main.go` using Go 1.22+ method-based patterns:

```
POST   /api/tracks                      — create track (becomes owner)
GET    /api/tracks                      — list my tracks
GET    /api/tracks/{id}                 — track detail
PUT    /api/tracks/{id}                 — update track
POST   /api/tracks/{id}/layouts         — create layout
GET    /api/tracks/{id}/layouts         — list layouts
POST   /api/tracks/{id}/invites         — invite by email + role
GET    /api/tracks/{id}/invites         — list pending invites
DELETE /api/tracks/{id}/invites/{email} — revoke invite
GET    /api/tracks/{id}/members         — list members
GET    /api/invites                     — my pending invites
POST   /api/invites/{trackId}/accept    — accept invite
POST   /api/upload-url                  — presigned S3 PUT URL
GET    /api/sessions                    — list my sessions
GET    /api/sessions/{id}               — session detail + laps
GET    /api/sessions/{id}/laps/{lapNo}  — single lap
```

### DynamoDB Schema

Single-table design with `pk`/`sk` keys, two GSIs (`gsi1`, `gsi2`), and TTL. Prefix-based keys: `USER#`, `TRACK#`, `SESSION#`, `KART#`, `APIKEY#`. See `go/dynamo/keys.go` for all key builders.

### Dual-Mode Entry Point

The API runs as a Lambda function in production or as a local HTTP server in development:

```go
if os.Getenv("AWS_LAMBDA_FUNCTION_NAME") != "" {
    adapter := httpadapter.NewV2(handler)
    lambda.Start(adapter.ProxyWithContext)
} else {
    http.ListenAndServe(":25565", handler)
}
```

Lambda events are API Gateway v2 proxy requests converted via `httpadapter`.

## Deployment

### Lambda Functions

All Lambda functions follow the same build and deploy pattern:

```bash
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags="-w -s" -o bootstrap
zip -r9q lambda.zip bootstrap
aws lambda update-function-code --function-name <name> --zip-file fileb://lambda.zip
```

Deploy scripts are in `scripts/`. The API is served via API Gateway.

### Hugo Site

The site deploys to S3 and is served via CloudFront:

1. **Build**: Hugo builds the site to `public/` with minification
2. **Upload**: Files sync to S3
3. **Invalidate**: CloudFront cache is invalidated
