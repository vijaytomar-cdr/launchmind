#!/usr/bin/env bash
# verify-billing.sh — Billing verification gate for Phase 1 / Week 4.
# Run with the Fastify API + Supabase local both running.
#
# Usage:
#   export SUPABASE_JWT_SECRET="test-jwt-secret-min-32-chars-long!!"
#   export STRIPE_WEBHOOK_SECRET="whsec_test_..."
#   export RAZORPAY_WEBHOOK_SECRET="test-rzp-secret"
#   ./scripts/verify-billing.sh
#
# Prerequisites: curl, jq, node (for HMAC), stripe CLI (for live checkout test)

set -euo pipefail

API="http://localhost:3001"
PASS=0
FAIL=0

green() { printf '\033[0;32m✓  %s\033[0m\n' "$1"; }
red()   { printf '\033[0;31m✗  %s\033[0m\n' "$1"; }

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

echo ""
echo "══════════════════════════════════════════════"
echo " LaunchMind — Billing Verification Gate"
echo "══════════════════════════════════════════════"
echo ""

# ── 1. Health check ─────────────────────────────────────────────────────────

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/health")
check "API is running (GET /health → 200)" "200" "$STATUS"

# ── 2. Stripe webhook: missing header → 400 ─────────────────────────────────

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/billing/webhooks/stripe" \
  -H "Content-Type: application/json" \
  -d '{"type":"checkout.session.completed","data":{"object":{}}}')
check "Missing stripe-signature → 400" "400" "$STATUS"

# ── 3. Stripe webhook: wrong signature → 401 ────────────────────────────────

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/billing/webhooks/stripe" \
  -H "Content-Type: application/json" \
  -H "stripe-signature: t=1234,v1=wrong_signature_value" \
  -d '{"type":"checkout.session.completed","data":{"object":{}}}')
check "Wrong stripe-signature → 401" "401" "$STATUS"

BODY=$(curl -s -X POST "$API/billing/webhooks/stripe" \
  -H "Content-Type: application/json" \
  -H "stripe-signature: t=1234,v1=wrong_signature_value" \
  -d '{"type":"checkout.session.completed","data":{"object":{}}}' | jq -r '.error // empty')
if echo "$BODY" | grep -qi "invalid stripe"; then
  green "Wrong stripe-signature error message contains 'Invalid Stripe'"
  PASS=$((PASS+1))
else
  red "Wrong stripe-signature error message missing 'Invalid Stripe' — got: $BODY"
  FAIL=$((FAIL+1))
fi

# ── 4. Razorpay webhook: missing header → 400 ───────────────────────────────

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/billing/webhooks/razorpay" \
  -H "Content-Type: application/json" \
  -d '{"event":"payment.captured","payload":{}}')
check "Missing x-razorpay-signature → 400" "400" "$STATUS"

# ── 5. Razorpay webhook: wrong HMAC → 401 ───────────────────────────────────

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/billing/webhooks/razorpay" \
  -H "Content-Type: application/json" \
  -H "x-razorpay-signature: deadbeef00000000000000000000000000000000000000000000000000000000" \
  -d '{"event":"payment.captured","payload":{}}')
check "Wrong x-razorpay-signature → 401" "401" "$STATUS"

BODY=$(curl -s -X POST "$API/billing/webhooks/razorpay" \
  -H "Content-Type: application/json" \
  -H "x-razorpay-signature: deadbeef00000000000000000000000000000000000000000000000000000000" \
  -d '{"event":"payment.captured","payload":{}}' | jq -r '.error // empty')
if echo "$BODY" | grep -qi "invalid razorpay"; then
  green "Wrong razorpay-signature error message contains 'Invalid Razorpay'"
  PASS=$((PASS+1))
else
  red "Wrong razorpay-signature error message missing 'Invalid Razorpay' — got: $BODY"
  FAIL=$((FAIL+1))
fi

# ── 6. Razorpay webhook: correct HMAC → 200 ─────────────────────────────────

# Correct-HMAC test requires the script's secret to match the running server's secret.
# Run with RAZORPAY_WEBHOOK_SECRET matching what's in the server's environment.
# See docker-compose.yml / Oracle VM env file for the production value.
if [ -n "${RAZORPAY_WEBHOOK_SECRET:-}" ]; then
  BODY_JSON='{"event":"payment.captured","payload":{"payment":{"entity":{"notes":{"founderId":"00000000-0000-0000-0000-000000000000","plan":"solo"}}}}}'
  SIG=$(echo -n "$BODY_JSON" | openssl dgst -sha256 -hmac "$RAZORPAY_WEBHOOK_SECRET" | awk '{print $NF}')
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/billing/webhooks/razorpay" \
    -H "Content-Type: application/json" \
    -H "x-razorpay-signature: $SIG" \
    -d "$BODY_JSON")
  check "Correct Razorpay HMAC → 200 (requires matching server secret)" "200" "$STATUS"
  if [ "$STATUS" = "401" ]; then
    printf '\033[0;33m  ↳ Got 401 — RAZORPAY_WEBHOOK_SECRET in script does not match server. Set both to the same value.\033[0m\n'
  fi
else
  printf '\033[0;33m⚠  Skipped: set RAZORPAY_WEBHOOK_SECRET to match the server env to test correct HMAC path\033[0m\n'
fi

# ── 7. Billing checkout: no auth → 401 ──────────────────────────────────────

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/billing/checkout" \
  -H "Content-Type: application/json" \
  -d '{"plan":"solo","currency":"usd"}')
check "POST /billing/checkout without token → 401" "401" "$STATUS"

# ── 8. Billing subscription: no auth → 401 ──────────────────────────────────

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/billing/subscription")
check "GET /billing/subscription without token → 401" "401" "$STATUS"

# ── 9. Billing cancel: no auth → 401 ────────────────────────────────────────

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/billing/cancel")
check "POST /billing/cancel without token → 401" "401" "$STATUS"

# ── 10. Plan gate: strategy requires solo+ ───────────────────────────────────
# (Requires a valid JWT for a FREE founder — see note below)

echo ""
echo "══ Manual steps (require Stripe CLI + local Supabase) ══════════════════"
echo ""
echo "  A. Stripe test checkout flow:"
echo "     1. stripe listen --forward-to localhost:3001/billing/webhooks/stripe"
echo "     2. stripe trigger checkout.session.completed \\"
echo "        --add checkout_session:metadata.founderId=<uuid> \\"
echo "        --add checkout_session:metadata.plan=solo"
echo "     3. Query DB: SELECT plan, token_balance FROM founders WHERE id='<uuid>';"
echo "        Expected: plan='solo', token_balance=300 (within 5s)"
echo "     4. Query DB: SELECT * FROM audit_logs WHERE action='subscription_activated';"
echo "        Expected: row with metadata.plan='solo', metadata.source='stripe'"
echo ""
echo "  B. Razorpay INR test checkout:"
echo "     1. Use Razorpay test dashboard → send payment.captured webhook"
echo "        notes: { founderId: '<uuid>', plan: 'builder' }"
echo "     2. Query DB: SELECT plan, token_balance FROM founders WHERE id='<uuid>';"
echo "        Expected: plan='builder', token_balance=1000 (within 5s)"
echo "     3. Query DB: SELECT * FROM audit_logs WHERE action='subscription_activated';"
echo "        Expected: row with metadata.source='razorpay'"
echo ""
echo "  C. Cancel does NOT revoke access:"
echo "     1. POST /billing/cancel  (with valid solo JWT)"
echo "     2. GET /billing/subscription → plan must still be 'solo', NOT 'free'"
echo "     3. Query DB: SELECT * FROM audit_logs WHERE action='cancel_scheduled';"
echo "        Expected: row present. founders.plan must remain 'solo'."
echo ""
echo "  D. Solo founder blocked from content assets:"
echo "     curl -X POST localhost:3001/products/<id>/strategy/assets \\"
echo "       -H 'Authorization: Bearer <solo_jwt>' \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"channel\":\"whatsapp\",\"market\":\"india\"}'"
echo "     Expected: 403 { code: 'PLAN_FEATURE_RESTRICTED', requiredPlan: 'builder' }"
echo ""
echo "  E. Supabase queries for token_balance verification:"
echo "     Solo activation:    token_balance should be 300"
echo "     Builder activation: token_balance should be 1000"
echo "     Studio activation:  token_balance should be 3000"
echo ""

echo "══════════════════════════════════════════════"
echo " Results: $PASS passed, $FAIL failed (automated)"
echo "══════════════════════════════════════════════"

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
