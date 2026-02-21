#!/usr/bin/env bash
set -euo pipefail
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags='-w -s' -o /tmp/ktp-api ./go/lambda/api/
cp /tmp/ktp-api /tmp/bootstrap
(cd /tmp && zip -r9q ktp-api.zip bootstrap)
aws --no-cli-pager lambda update-function-code --function-name ktp-api --zip-file fileb:///tmp/ktp-api.zip
