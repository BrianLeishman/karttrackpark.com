#!/usr/bin/env bash
set -euo pipefail
go run ./go/cmd/compile-ts
(cd site && hugo --minify)
aws --no-cli-pager s3 sync site/public/ s3://karttrackpark.com/ --delete
aws --no-cli-pager cloudfront create-invalidation --distribution-id E243U30VS4F2OV --paths "/*"
