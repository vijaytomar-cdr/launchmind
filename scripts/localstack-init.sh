#!/bin/bash
## @file localstack-init.sh
## @description Creates the KMS key inside LocalStack on startup.
##   Mirrors the production AWS KMS key used for OAuth token encryption.
##   LOCAL DEV ONLY — never runs in production.
set -e
echo "[LaunchMind] Creating KMS key..."
KEY_ID=$(awslocal kms create-key \
  --description "LaunchMind token key - LOCAL DEV ONLY" \
  --key-usage ENCRYPT_DECRYPT \
  --query 'KeyMetadata.KeyId' --output text)
awslocal kms create-alias \
  --alias-name alias/launchmind-token-key \
  --target-key-id "$KEY_ID"
echo "[LaunchMind] Add to .env.dev:"
echo "KMS_KEY_ARN=arn:aws:kms:us-east-1:000000000000:key/$KEY_ID"
