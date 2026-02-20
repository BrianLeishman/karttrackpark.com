#!/usr/bin/env bash
set -euo pipefail
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags='-w -s' -o /tmp/justlog-mcp ./go/lambda/mcp/
cp /tmp/justlog-mcp /tmp/bootstrap
(cd /tmp && zip -r9q justlog-mcp.zip bootstrap)
aws --no-cli-pager lambda update-function-code --function-name justlog-mcp --zip-file fileb:///tmp/justlog-mcp.zip
