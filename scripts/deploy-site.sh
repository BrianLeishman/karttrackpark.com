#!/usr/bin/env bash
set -euo pipefail
go run ./go/cmd/compile-ts
(cd site && hugo --minify)
aws --no-cli-pager s3 sync site/public/ s3://justlog.io/ --delete --exclude "demo.mp4"
aws --no-cli-pager cloudfront create-invalidation --distribution-id E1LT80V2EBQZX0 --paths "/*"
