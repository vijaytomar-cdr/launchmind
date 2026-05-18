#!/usr/bin/env bash
# verify-week6.sh — Week 6 verification gate: BullMQ cron + admin routes.
# Run with Fastify API + Redis running.
#
# Usage:
#   export ADMIN_SECRET="your-32-char-admin-secret"
#   export SUPABASE_JWT_SECRET="your-supabase-jwt-secret"
#   ./scripts/verify-week6.sh
#
# Prerequisites: curl, jq, node (native — no extra packages)

set -euo pipefail

API="http://localhost:3001"
ADMIN_SECRET="${ADMIN_SECRET:-}"
JWT_SECRET="${SUPABASE_JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}"

PRODUCT_ID="ba000000-0000-0000-0000-000000000001"
FOUNDER_ID="ba100000-0000-0000-0000-000000000001"

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

echo ""
echo "══════════════════════════════════════════════════════"
echo " LaunchMind — Week 6 Verification Gate"
echo " BullMQ Cron + Admin Routes + Brief Pipeline"
echo "══════════════════════════════════════════════════════"
echo ""

# ── 1. Health check ──────────────────────────────────────────────────────────

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/health")
check "API is running (GET /health → 200)" "200" "$STATUS"

# ── 2. Admin secret gates (no header → 401 if secret configured, 503 if not) ─
# Note: 503 means ADMIN_SECRET is not set in the server — both 401 and 503 are
# acceptable gate responses for missing/wrong header tests.

check_admin_gate() {
  local label="$1" status="$2"
  if [ "$status" = "401" ] || [ "$status" = "503" ]; then
    green "$label (→ $status)"
    PASS=$((PASS+1))
  else
    red "$label — expected 401 or 503, got $status"
    FAIL=$((FAIL+1))
  fi
}

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/admin/trigger-brief" \
  -H "Content-Type: application/json" \
  -d "{\"productId\":\"$PRODUCT_ID\",\"founderId\":\"$FOUNDER_ID\"}")
check_admin_gate "POST /admin/trigger-brief without secret → 401/503" "$STATUS"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/admin/schedule-brief")
check_admin_gate "POST /admin/schedule-brief without secret → 401/503" "$STATUS"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/admin/health")
check_admin_gate "GET /admin/health without secret → 401/503" "$STATUS"

# ── 3. Wrong secret → 401 or 503 ─────────────────────────────────────────────

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/admin/trigger-brief" \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: wrong-secret-that-doesnt-match" \
  -d "{\"productId\":\"$PRODUCT_ID\",\"founderId\":\"$FOUNDER_ID\"}")
check_admin_gate "POST /admin/trigger-brief with wrong secret → 401/503" "$STATUS"

# ── 4. Unconfigured secret → 503 (only testable if server has blank ADMIN_SECRET) ─

# We skip this test since server env is set — note it for manual verification

# ── 5. Invalid body → 400 ────────────────────────────────────────────────────

if [ -n "$ADMIN_SECRET" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/admin/trigger-brief" \
    -H "Content-Type: application/json" \
    -H "x-admin-secret: $ADMIN_SECRET" \
    -d '{"productId":"not-a-uuid","founderId":"also-not-a-uuid"}')
  check "POST /admin/trigger-brief with invalid UUIDs → 400" "400" "$STATUS"
else
  warn "Skipped body validation test: set ADMIN_SECRET to run authenticated tests"
fi

# ── 6. Correct secret + valid body → 200 ─────────────────────────────────────

if [ -n "$ADMIN_SECRET" ]; then
  TRIGGER_BODY=$(curl -s -X POST "$API/admin/trigger-brief" \
    -H "Content-Type: application/json" \
    -H "x-admin-secret: $ADMIN_SECRET" \
    -d "{\"productId\":\"$PRODUCT_ID\",\"founderId\":\"$FOUNDER_ID\"}")
  TRIGGER_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/admin/trigger-brief" \
    -H "Content-Type: application/json" \
    -H "x-admin-secret: $ADMIN_SECRET" \
    -d "{\"productId\":\"$PRODUCT_ID\",\"founderId\":\"$FOUNDER_ID\"}")

  check "POST /admin/trigger-brief with correct secret → 200" "200" "$TRIGGER_STATUS"

  if echo "$TRIGGER_BODY" | jq -e '.jobId' > /dev/null 2>&1; then
    green "POST /admin/trigger-brief returns { jobId, queued: true }"
    PASS=$((PASS+1))
  else
    red "POST /admin/trigger-brief unexpected response: $TRIGGER_BODY"
    FAIL=$((FAIL+1))
  fi
  check_contains "Response has queued=true" '"queued":true' "$TRIGGER_BODY"

  # 7. Schedule brief
  SCHEDULE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/admin/schedule-brief" \
    -H "x-admin-secret: $ADMIN_SECRET")
  check "POST /admin/schedule-brief → 200" "200" "$SCHEDULE_STATUS"

  SCHEDULE_BODY=$(curl -s -X POST "$API/admin/schedule-brief" \
    -H "x-admin-secret: $ADMIN_SECRET")
  check_contains "schedule-brief response has cron expression" '"cron"' "$SCHEDULE_BODY"

  # 8. Admin health
  HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/admin/health" \
    -H "x-admin-secret: $ADMIN_SECRET")
  check "GET /admin/health with correct secret → 200" "200" "$HEALTH_STATUS"
else
  warn "Skipped authenticated admin tests — set ADMIN_SECRET env var"
fi

# ── 9. Redis connectivity (BullMQ) ───────────────────────────────────────────

if command -v redis-cli &>/dev/null; then
  REDIS_PING=$(redis-cli -u "${REDIS_URL:-redis://localhost:6379}" ping 2>/dev/null || echo "FAIL")
  if [ "$REDIS_PING" = "PONG" ]; then
    green "Redis is reachable (BullMQ queue available)"
    PASS=$((PASS+1))

    # Check for weekly-brief queue existence
    QUEUE_KEYS=$(redis-cli -u "${REDIS_URL:-redis://localhost:6379}" keys "bull:weekly-brief:*" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$QUEUE_KEYS" -gt 0 ]; then
      green "BullMQ weekly-brief queue keys found in Redis ($QUEUE_KEYS keys)"
      PASS=$((PASS+1))
    else
      warn "No BullMQ weekly-brief queue keys found — restart server to register cron"
    fi
  else
    warn "Redis not reachable at ${REDIS_URL:-redis://localhost:6379} — BullMQ queue not verifiable"
  fi
else
  warn "redis-cli not installed — skipping Redis connectivity check"
fi

# ── Manual verification steps ─────────────────────────────────────────────────

echo ""
echo "══ Manual verification steps ════════════════════════════════════════════"
echo ""
echo "  A. Full brief pipeline E2E (seeds + Claude Haiku + DB verification):"
echo "     SUPABASE_URL=http://localhost:54321 \\"
echo "     SUPABASE_SERVICE_ROLE_KEY=<key> \\"
echo "     ANTHROPIC_API_KEY=<key> \\"
echo "     npx tsx scripts/test-brief-e2e.ts"
echo ""
echo "  B. Verify BullMQ cron is registered:"
echo "     redis-cli keys 'bull:weekly-brief:repeat*'"
echo "     Expected: at least one key with the cron pattern '0 17 * * 0'"
echo ""
echo "  C. Verify PII never reaches playbook_signals:"
echo "     supabase sql --local 'SELECT * FROM playbook_signals ORDER BY created_at DESC LIMIT 5;'"
echo "     Check: no UUIDs, emails, URLs, or names in any column"
echo ""
echo "  D. Verify weekly_briefs row is created:"
echo "     supabase sql --local 'SELECT product_id, week_of, status, ai_tokens_consumed FROM weekly_briefs ORDER BY created_at DESC LIMIT 5;'"
echo "     Expected: status='sent' (or 'draft' if email is not configured)"
echo ""
echo "  E. Verify audit_log has weekly_brief_generated:"
echo "     supabase sql --local 'SELECT action, metadata FROM audit_logs WHERE action=''weekly_brief_generated'' ORDER BY created_at DESC LIMIT 5;'"
echo ""
echo "  F. Verify email sent via Resend dashboard (if RESEND_API_KEY set):"
echo "     Check briefs@launchmind.com → founder email with subject '<productName> Weekly Brief'"
echo ""

echo "══════════════════════════════════════════════════════"
echo " Results: $PASS passed, $FAIL failed (automated)"
echo "══════════════════════════════════════════════════════"
echo ""

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
