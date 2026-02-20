#!/usr/bin/env bash
set -euo pipefail
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags='-w -s' -o /tmp/justlog-api ./go/lambda/api/
cp /tmp/justlog-api /tmp/bootstrap
(cd /tmp && zip -r9q justlog-api.zip bootstrap)
aws --no-cli-pager lambda update-function-code --function-name justlog-api --zip-file fileb:///tmp/justlog-api.zip
