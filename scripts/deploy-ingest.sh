#!/usr/bin/env bash
set -euo pipefail
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags='-w -s' -o /tmp/ktp-ingest ./go/lambda/ingest/
cp /tmp/ktp-ingest /tmp/bootstrap
(cd /tmp && zip -r9q ktp-ingest.zip bootstrap)
aws --no-cli-pager lambda update-function-code --function-name ktp-ingest --zip-file fileb:///tmp/ktp-ingest.zip
