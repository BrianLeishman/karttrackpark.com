# JustLog — Development Guide

This document is the canonical reference for how JustLog is built. It covers architecture, patterns, and conventions across the entire stack. AI agents working on this codebase should follow the patterns described here.

## Project Overview

JustLog is a calorie, macro, and weight tracking service. There is no app UI for data entry — users interact through AI assistants via the MCP server. The web frontend is for account management, dashboards, and settings.

**Philosophy:** Minimal dependencies. Pure Bootstrap, pure Go, pure TypeScript. Every technology choice should be idiomatic to the tool itself — no unnecessary abstractions, wrappers, or frameworks.

**AWS Profile:** All AWS operations use `AWS_PROFILE=justlog`. Set this in your shell or prefix commands with it. Never use the default profile — that points to a different account.

## Directory Structure

```
justlog.io/
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
│   ├── api/                     # HTTP handler library
│   │   ├── http.go
│   │   ├── response.go
│   │   ├── decode.go
│   │   └── status.go
│   ├── cmd/
│   │   ├── compile-ts/          # esbuild Go wrapper
│   │   ├── hugo-server/         # Dev server (esbuild watch + hugo)
│   │   └── deploy-site/         # Hugo build → S3 → CloudFront KVS
│   ├── lambda/
│   │   ├── api/                 # REST API
│   │   │   ├── main.go
│   │   │   ├── router.go
│   │   │   ├── context.go
│   │   │   └── entries.go
│   │   └── mcp/                 # MCP server
│   │       ├── main.go
│   │       ├── auth.go
│   │       └── tools/
│   │           ├── register.go
│   │           ├── food.go
│   │           ├── exercise.go
│   │           └── weight.go
│   └── dynamo/                  # DynamoDB helpers
├── aws/
│   └── cloudfront/
│       └── funcs/               # CloudFront Functions
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

The API is a pure Go HTTP server. No frameworks — no gin, no chi, no echo.

Every handler has the same signature:

```go
func handleSomething(ctx context.Context) error
```

The HTTP request and response writer are stored in the context. Handlers never touch `http.ResponseWriter` or `*http.Request` directly. Instead they use the `go/api/` library:

```go
// Reading input
api.BodyInto(ctx, &dest)     // JSON request body → struct (with validation)
api.QueryInto(ctx, &dest)    // Query params → struct
api.PathInto(ctx, &dest)     // Path params like {id} → struct

// Writing output
api.JSON(ctx, http.StatusOK, data)   // Send JSON response
api.String(ctx, http.StatusOK, msg)  // Send plain text
api.Header(ctx, "X-Custom", "val")   // Set response header
```

Input parsing uses struct tags (`json`, `form`, `uri`) with automatic validation. Handlers return errors — the middleware decides the HTTP status code.

### Route Registration

Routes are registered with options:

```go
func init() {
    registerRoute("GET /entries", handleEntriesGet, withAuth())
    registerRoute("POST /entries", handleEntryCreate, withAuth())
    registerRoute("DELETE /entries/{id}", handleEntryDelete, withAuth())
}
```

Route options:
- `withAuth()` — require authenticated Cognito user
- `withTimeout(d)` — override default request timeout

### Middleware

The `wrapHandler()` function is the middleware chain. It wraps every handler:

1. Creates request context with request ID, structured logger, DynamoDB client
2. Authenticates the user via Cognito JWT (if `withAuth()` is set)
3. Stores the user in context (lazy-loaded — only fetched when accessed)
4. Calls the handler
5. Maps returned errors to HTTP status codes:
   - `errs.ErrBadRequest` → 400
   - `errs.ErrForbidden` → 403
   - `errs.ErrNotFound` → 404
   - Untyped errors → 500
6. Recovers from panics

### Dual-Mode Entry Point

The API runs as a Lambda function in production or as a local HTTP server in development:

```go
func main() {
    if os.Getenv("AWS_EXECUTION_ENV") != "" {
        lambda.Start(handleLambdaEvent)
    } else {
        http.ListenAndServe(":8090", handler)
    }
}
```

Lambda events are API Gateway proxy requests. The handler converts them to standard `http.Request`/`http.ResponseWriter` via `httpadapter`.

## MCP Server

The MCP server uses `mark3labs/mcp-go` with Streamable HTTP transport (per the 2025-06-18 MCP specification). SSE is not supported.

### Tool Registration

Tools are registered using a Spec pattern:

```go
tools.Register(func(s *tools.Spec) {
    s.Define("log_food",
        mcp.WithDescription("Log a food entry with calories and macros"),
        mcp.WithObjectSchema(/* input schema */),
    )
    s.Handler(func(ctx context.Context, request json.RawMessage) (*server.ToolResult, error) {
        // Parse input, write to DynamoDB, return confirmation
    })
})
```

Each tool definition lives in its own file under `tools/` — `food.go`, `exercise.go`, `weight.go`.

### Authentication

The MCP server extracts the Bearer token from the Authorization header, verifies it against Cognito, and stores the authenticated user in context. All tool handlers can access the user from context.

### Dual-Mode

Same pattern as the API — Lambda in production, local HTTP server in development:

```go
if os.Getenv("AWS_EXECUTION_ENV") != "" {
    // Lambda: stateless, streaming disabled (API Gateway limitation)
    server.WithStateLess(true)
    server.WithDisableStreaming(true)
    lambda.Start(lambdaHandler)
} else {
    httpSrv.Start(":8088")
}
```

## Database

DynamoDB. Single-table or minimal-table design.

- Partition key: `userID`
- Sort key: `type#timestamp` or similar composite key
- All data isolated per user — no cross-user queries
- GSIs as needed for date range queries or type filtering

DynamoDB helpers live in `go/dynamo/`.

## Authentication

AWS Cognito user pool with Google sign-in. No custom auth system.

- Users authenticate via Cognito hosted UI or Google OAuth
- API and MCP both validate Cognito JWT bearer tokens
- Each user's data is isolated — you can only access your own entries
- Never expose or echo auth tokens in responses

## Deployment

### Lambda Functions

All Lambda functions follow the same build and deploy pattern:

```bash
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags="-w -s" -o bootstrap
zip -r9q lambda.zip bootstrap
aws lambda update-function-code --function-name <name> --zip-file fileb://lambda.zip
```

Deploy scripts live alongside each Lambda function. The API is served via API Gateway.

### Hugo Site

The site deploys to S3 and is served via CloudFront:

1. **Build**: Hugo builds the site to `public/` with minification
2. **Upload**: Files sync to S3 under a unique directory (`prod/{randomId}/`)
   - HTML files: `Cache-Control: public,max-age=0,s-maxage=0,must-revalidate`
   - Fingerprinted assets: `Cache-Control: public,max-age=31536000,immutable`
3. **Switch**: CloudFront KVS key is updated to point to the new directory

A CloudFront Function runs on every viewer request, reads the active origin path from KVS, and rewrites the request to the correct S3 directory. This gives zero-downtime blue-green deployments — the old version stays in S3 until the next deploy.

The deploy command lives at `go/cmd/deploy-site/`.

## Agent Behavior

This section is for AI agents (Claude, ChatGPT, etc.) that interact with the JustLog MCP server on behalf of a user.

### Architecture

The MCP server stores numbers and text. The AI does the thinking. The server is the database. You are the application.

### Data Model

JustLog tracks three things:

**Food intake** — calories, protein (g), carbs (g), fat (g), fiber (g), and a text description.

**Exercise** — calories burned and a text description.

**Weight** — body weight in pounds.

All entries are timestamped. The description is freeform text and should capture what the user actually said, not a normalized version. This matters for future queries — six months from now the user might ask "how often did I eat Publix chicken tenders" and you need the original language.

### Estimating Food Intake

When a user describes what they ate, estimate the macros and log them.

**Use web search when you can.** Chain restaurants publish nutrition info. Look it up — don't guess when the data exists.

**For home-cooked or ambiguous meals, estimate reasonably.** Consistent reasonable estimates are more valuable than sporadic precise ones.

**Work from components.** Break meals into parts. Estimate each component and sum.

**Ask clarifying questions only when it matters.** "I had a sandwich" needs more detail. "I had a turkey sandwich on wheat with lettuce and mustard" is enough.

**Default to realistic portions.** A bowl of rice is about 1.5 cups cooked (~300 cal), not a label serving of 0.75 cups.

**Round to reasonable precision.** Log 350, not 347. Protein of 23g is fine.

### Estimating Exercise Calories

**Body weight matters.** Use the user's most recent logged weight.

**Use MET values.** Calories burned = MET x weight in kg x duration in hours. Walking at 3.0 mph flat is ~3.5 METs. At 12% incline it's closer to 8-9 METs.

**Estimate strength training conservatively.** Roughly 3-6 cal/min depending on intensity and rest.

**Log gross calories**, not net above resting.

### Logging Weight

Just the number in pounds and a timestamp. If given in kg, convert (multiply by 2.205). Don't comment on daily fluctuations unless asked.

### Querying and Reporting

**Daily summaries** total calories in, macros, calories out, and note if weight was logged.

**Weekly/monthly trends** focus on averages. Average daily calories, average protein, weight trend direction.

**Be honest about gaps.** If the user didn't log for three days, say so.

**Descriptions are searchable.** "How many times did I eat pizza this month" works because original language is preserved.

### General Behavior

- Log immediately when the user provides information. Don't ask "would you like me to log that?" — just do it and confirm what you logged.
- Batch multiple tool calls when logging food + exercise in one message.
- Confirm with actual numbers: "Logged: 850 cal, 45g protein, 90g carbs, 32g fat — Publix 3-tender meal with roll, wedges, and onion rings."
- Don't lecture about nutrition unless asked.

### Protocol Notes

Streamable HTTP transport (2025-06-18 MCP specification). SSE is not supported.

Tools use `inputSchema` for parameter validation and `outputSchema` for typed return values. Use `structuredContent` for programmatic access, fall back to `content` text blocks for display.

Tool calls should be idempotent where possible — the server handles deduplication by timestamp.

All tools require authentication via bearer token. Never expose or echo auth tokens.
