# Kart Track Park

Go-kart track information and community site.

## Stack

- **Frontend**: Hugo + Bootstrap 5.3 (SCSS via Dart Sass) + TypeScript (esbuild)
- **API**: Pure Go HTTP server, deployed to AWS Lambda behind API Gateway
- **Hosting**: S3 + CloudFront

## Project Structure

```
site/          Hugo frontend (layouts, SCSS, TypeScript, content)
go/api/        Minimal HTTP handler library (context-based, no frameworks)
go/cmd/        CLI tools (esbuild compiler, hugo dev server)
go/lambda/api/ REST API (Lambda + API Gateway)
go/dynamo/     DynamoDB helpers
```

See `AGENTS.md` for the full development guide.

## Prerequisites

- Go 1.22+
- Hugo (extended edition)
- Dart Sass
- Node.js + pnpm
- AWS CLI (configured with `ktp` profile)

## Development

```bash
# Install frontend dependencies
cd site && pnpm install && cd ..

# Start dev server (esbuild watch + Hugo server)
go run ./go/cmd/hugo-server

# Run API locally (port 8090)
go run ./go/lambda/api
```

## Deploy

```bash
pnpm deploy:api   # Deploy API Lambda
pnpm deploy:site  # Deploy Hugo site to S3 + CloudFront
pnpm deploy:all   # Deploy everything
```

## License

MIT
