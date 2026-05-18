#!/usr/bin/env bash
# verify-channels.sh — Channels verification gate for Phase 2 / Week 5.
# Run with Fastify API + Supabase local both running.
#
# Usage:
#   export SUPABASE_JWT_SECRET="super-secret-jwt-token-with-at-least-32-characters-long"
#   export WHATSAPP_APP_SECRET="your-meta-app-secret"       # optional: for correct-sig test
#   export WHATSAPP_WEBHOOK_VERIFY_TOKEN="your-verify-token" # optional
#   ./scripts/verify-channels.sh
#
# Prerequisites: curl, jq, node (native — no extra packages needed)

set -euo pipefail

API="http://localhost:3001"
SUPABASE_JWT_SECRET="${SUPABASE_JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}"
SEED_FOUNDER_ID="cc100000-0000-0000-0000-000000000001"
SEED_CAMPAIGN_DRAFT_ID="cc500000-0000-0000-0000-000000000001"

PASS=0
FAIL=0

green() { printf '\033[0;32m✓  %s\033[0m\n' "$1"; }
red()   { printf '\033[0;31m✗  %s\033[0m\n' "$1"; }
warn()  { printf '\033[0;33m⚠  %s\033[0m\n' "$1"; }

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    green "$label"
    PASS=$((PASS+1))
  else
    red "$label — expected $expected, got $actual"
    FAIL=$((FAIL+1))
  fi
}

check_contains() {
  local label="$1" needle="$2" haystack="$3"
  if echo "$haystack" | grep -q "$needle"; then
    green "$label"
    PASS=$((PASS+1))
  else
    red "$label — expected to contain '$needle', got: $haystack"
    FAIL=$((FAIL+1))
  fi
}

check_not_contains() {
  local label="$1" needle="$2" haystack="$3"
  if ! echo "$haystack" | grep -q "$needle"; then
    green "$label"
    PASS=$((PASS+1))
  else
    red "$label — response MUST NOT contain '$needle'"
    FAIL=$((FAIL+1))
  fi
}

echo ""
echo "══════════════════════════════════════════════════════"
echo " LaunchMind — Channels Verification Gate (Week 5)"
echo "══════════════════════════════════════════════════════"
echo ""

# ── 1. API health ─────────────────────────────────────────────────────────────

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/health")
check "API is running (GET /health → 200)" "200" "$STATUS"

# ── 2–5. Auth gates (no token → 401) ─────────────────────────────────────────

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/channels")
check "GET /channels without token → 401" "401" "$STATUS"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/channels/whatsapp/send" \
  -H "Content-Type: application/json" \
  -d '{"campaignId":"00000000-0000-0000-0000-000000000001","phoneNumberId":"111","recipientPhone":"+1234567890","templateName":"hello","languageCode":"en_US"}')
check "POST /channels/whatsapp/send without token → 401" "401" "$STATUS"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API/channels/whatsapp")
check "DELETE /channels/whatsapp without token → 401" "401" "$STATUS"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/channels/whatsapp/oauth/init")
check "GET /channels/whatsapp/oauth/init without token → 401" "401" "$STATUS"

# ── 6–7. Webhook signature gates ─────────────────────────────────────────────

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/channels/whatsapp/webhook" \
  -H "Content-Type: application/json" \
  -d '{"entry":[]}')
check "POST /channels/whatsapp/webhook without signature → 401" "401" "$STATUS"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/channels/whatsapp/webhook" \
  -H "Content-Type: application/json" \
  -H "x-hub-signature-256: sha256=wrongsignaturevalue00000000000000000000000000000000000000000000" \
  -d '{"entry":[]}')
check "POST /channels/whatsapp/webhook with wrong signature → 401" "401" "$STATUS"

# ── 8. Webhook GET challenge: wrong token → 403 ───────────────────────────────

STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "$API/channels/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=abc123")
check "GET /channels/whatsapp/webhook with wrong verify_token → 403" "403" "$STATUS"

# ── 9. Valid webhook signature test ───────────────────────────────────────────

if [ -n "${WHATSAPP_APP_SECRET:-}" ]; then
  WEBHOOK_BODY='{"entry":[]}'
  SIG="sha256=$(echo -n "$WEBHOOK_BODY" | openssl dgst -sha256 -hmac "$WHATSAPP_APP_SECRET" | awk '{print $NF}')"
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/channels/whatsapp/webhook" \
    -H "Content-Type: application/json" \
    -H "x-hub-signature-256: $SIG" \
    -d "$WEBHOOK_BODY")
  check "POST /channels/whatsapp/webhook with correct signature → 200" "200" "$STATUS"
else
  warn "Skipped: set WHATSAPP_APP_SECRET to test correct-signature path"
fi

# ── 10. Webhook GET challenge: correct token → 200 + challenge ────────────────

if [ -n "${WHATSAPP_WEBHOOK_VERIFY_TOKEN:-}" ]; then
  BODY=$(curl -s \
    "$API/channels/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${WHATSAPP_WEBHOOK_VERIFY_TOKEN}&hub.challenge=verify_me_123")
  check_contains "GET webhook challenge with correct token → returns challenge" "verify_me_123" "$BODY"
else
  warn "Skipped: set WHATSAPP_WEBHOOK_VERIFY_TOKEN to test hub challenge verification"
fi

# ── 11–14. Authenticated tests (generate JWT via node) ───────────────────────

echo ""
echo "── Generating test JWT (founderId: $SEED_FOUNDER_ID) ──────────────────────"

TOKEN=$(node -e "
const crypto = require('crypto');
const secret = '$SUPABASE_JWT_SECRET';
const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const payload = Buffer.from(JSON.stringify({
  sub: '$SEED_FOUNDER_ID',
  role: 'authenticated',
  exp: Math.floor(Date.now()/1000) + 3600,
  iat: Math.floor(Date.now()/1000)
})).toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(header+'.'+payload).digest('base64url');
console.log(header+'.'+payload+'.'+sig);
")

echo "   Token: ${TOKEN:0:40}…"

# 11. GET /channels → must NOT contain encrypted_token or kms_key_id
CHANNELS_BODY=$(curl -s "$API/channels" \
  -H "Authorization: Bearer $TOKEN")
check_not_contains "GET /channels response: no 'encrypted_token' field" \
  "encrypted_token" "$CHANNELS_BODY"
check_not_contains "GET /channels response: no 'kms_key_id' field" \
  "kms_key_id" "$CHANNELS_BODY"

# Verify response has the expected shape (only valid if DB is reachable)
if echo "$CHANNELS_BODY" | jq -e '.channels' > /dev/null 2>&1; then
  green "GET /channels returns { channels: [...] } shape"
  PASS=$((PASS+1))
elif echo "$CHANNELS_BODY" | grep -q '"error"'; then
  warn "GET /channels returned error (DB not reachable or migrations not run)"
  warn "  Run: cd backend && npm run db:migrate  then re-run this script"
  warn "  Also verify SUPABASE_SERVICE_ROLE_KEY is the service role key (not anon key)"
else
  red "GET /channels unexpected response shape: $CHANNELS_BODY"
  FAIL=$((FAIL+1))
fi

# 12. OAuth init returns a Meta URL
OAUTH_BODY=$(curl -s "$API/channels/whatsapp/oauth/init" \
  -H "Authorization: Bearer $TOKEN")
OAUTH_URL=$(echo "$OAUTH_BODY" | jq -r '.url // empty')

if [ -n "${OAUTH_URL}" ] && echo "$OAUTH_URL" | grep -q "facebook.com"; then
  green "GET /channels/whatsapp/oauth/init returns Meta OAuth URL"
  PASS=$((PASS+1))
else
  # Might 503 if WHATSAPP_APP_ID not set — that's acceptable
  if echo "$OAUTH_BODY" | grep -q "not configured"; then
    warn "GET /channels/whatsapp/oauth/init: WHATSAPP_APP_ID not set — set env var to test"
  else
    red "GET /channels/whatsapp/oauth/init unexpected response: $OAUTH_BODY"
    FAIL=$((FAIL+1))
  fi
fi

# 13. POST /channels/whatsapp/send with unapproved campaign → 422
#     (Requires seed data from test-channels-e2e.ts — run that first)
echo ""
echo "── Testing unapproved campaign gate ─────────────────────────────────────"
echo "   (Requires seed from: npx tsx scripts/test-channels-e2e.ts)"

SEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/channels/whatsapp/send" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"campaignId\":\"$SEED_CAMPAIGN_DRAFT_ID\",\"phoneNumberId\":\"111111111\",\"recipientPhone\":\"+1234567890\",\"templateName\":\"hello_world\",\"languageCode\":\"en_US\"}")

SEND_BODY=$(curl -s -X POST "$API/channels/whatsapp/send" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"campaignId\":\"$SEED_CAMPAIGN_DRAFT_ID\",\"phoneNumberId\":\"111111111\",\"recipientPhone\":\"+1234567890\",\"templateName\":\"hello_world\",\"languageCode\":\"en_US\"}")

if [ "$SEND_STATUS" = "422" ]; then
  check_contains "Unapproved campaign send → 422 + CAMPAIGN_NOT_APPROVED code" \
    "CAMPAIGN_NOT_APPROVED" "$SEND_BODY"
elif [ "$SEND_STATUS" = "404" ]; then
  warn "Campaign $SEED_CAMPAIGN_DRAFT_ID not found — run: npx tsx scripts/test-channels-e2e.ts"
else
  red "Unapproved campaign send — expected 422, got $SEND_STATUS: $SEND_BODY"
  FAIL=$((FAIL+1))
fi

# 14. DELETE /channels/invalidplatform → 400
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API/channels/invalidplatform" \
  -H "Authorization: Bearer $TOKEN")
check "DELETE /channels/invalidplatform → 400 (invalid platform)" "400" "$STATUS"

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "══ Manual verification steps ════════════════════════════════════════════"
echo ""
echo "  A. Connect real WhatsApp Business:"
echo "     1. Set WHATSAPP_APP_ID + WHATSAPP_APP_SECRET + WHATSAPP_WEBHOOK_VERIFY_TOKEN"
echo "     2. GET /channels/whatsapp/oauth/init  (with JWT)"
echo "     3. Visit the returned OAuth URL → authorise → verify callback redirects to"
echo "        /dashboard/channels?connected=whatsapp"
echo ""
echo "  B. Verify encrypted_token is NOT plaintext in DB:"
echo "     supabase sql --local 'SELECT platform, encrypted_token FROM platform_tokens LIMIT 5;'"
echo "     Expected: encrypted_token is a long base64 string, NOT a Bearer token starting with 'EAA'"
echo ""
echo "  C. RLS check — another founder cannot read your token:"
echo "     npx tsx scripts/test-channels-e2e.ts"
echo "     The script verifies RLS blocks cross-founder token reads."
echo ""
echo "  D. audit_logs after connect+send:"
echo "     supabase sql --local \\"
echo "       \"SELECT action, metadata FROM audit_logs WHERE action IN"
echo "        ('token_stored','token_decrypted','whatsapp_broadcast_sent')"
echo "        ORDER BY created_at DESC LIMIT 10;\""
echo "     Expected: token_stored (on connect), token_decrypted (on send),"
echo "               whatsapp_broadcast_sent (on approved send)"
echo ""
echo "  E. Revoke token from Meta → next send returns graceful error:"
echo "     1. Revoke in Meta Business Settings → System Users"
echo "     2. DELETE /channels/whatsapp  (with JWT)"
echo "     3. Attempt POST /channels/whatsapp/send → must return 500 with { error: ... }"
echo "        NOT a 500 with raw stack trace or token value"
echo ""
echo "  F. Full E2E seed + DB verification:"
echo "     npx tsx scripts/test-channels-e2e.ts"
echo ""

echo "══════════════════════════════════════════════════════"
echo " Results: $PASS passed, $FAIL failed (automated)"
echo "══════════════════════════════════════════════════════"
echo ""

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
