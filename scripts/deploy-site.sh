#!/usr/bin/env bash
set -euo pipefail
go run ./go/cmd/compile-ts
(cd site && hugo --minify)
aws --no-cli-pager s3 sync site/public/ s3://karttrackpark.com/ --delete

# Update CloudFront function
ETAG=$(aws --no-cli-pager cloudfront describe-function --name ktp-index-rewrite --query 'ETag' --output text)
ETAG=$(aws --no-cli-pager cloudfront update-function \
    --name ktp-index-rewrite \
    --function-config Comment="Rewrite SPA paths to index.html",Runtime=cloudfront-js-2.0 \
    --function-code fileb://scripts/cloudfront-track-rewrite.js \
    --if-match "$ETAG" \
    --query 'ETag' --output text)
aws --no-cli-pager cloudfront publish-function \
    --name ktp-index-rewrite \
    --if-match "$ETAG"

aws --no-cli-pager cloudfront create-invalidation --distribution-id E243U30VS4F2OV --paths "/*"
