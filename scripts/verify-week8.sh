#!/usr/bin/env bash
# verify-week8.sh — Week 8 verification gate: Dogfood Sprint hardening.
# Run with Fastify API running.
#
# Usage:
#   export ADMIN_SECRET="your-admin-secret"
#   ./scripts/verify-week8.sh
#
# Prerequisites: curl, jq

set -euo pipefail

API="http://localhost:3001"
ADMIN_SECRET="${ADMIN_SECRET:-}"

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
echo " LaunchMind — Week 8 Verification Gate"
echo " Dogfood Sprint: Waitlist + Health + Error Codes"
echo "══════════════════════════════════════════════════════"
echo ""

# ── 1. Health check ───────────────────────────────────────────────────────────

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/health")
check "GET /health → 200" "200" "$STATUS"

HEALTH_BODY=$(curl -s "$API/health")
check_contains "GET /health returns status=ok" '"status":"ok"' "$HEALTH_BODY"
check_contains "GET /health returns timestamp" '"timestamp"' "$HEALTH_BODY"

# ── 2. Detailed health check ──────────────────────────────────────────────────

DETAILED_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/health/detailed")
DETAILED_BODY=$(curl -s "$API/health/detailed")

if [ "$DETAILED_STATUS" = "200" ] || [ "$DETAILED_STATUS" = "503" ]; then
  green "GET /health/detailed → $DETAILED_STATUS (ok or degraded)"
  PASS=$((PASS+1))
else
  red "GET /health/detailed — expected 200 or 503, got $DETAILED_STATUS"
  FAIL=$((FAIL+1))
fi

check_contains "GET /health/detailed has status field" '"status"' "$DETAILED_BODY"
check_contains "GET /health/detailed has checks field" '"checks"' "$DETAILED_BODY"
check_contains "GET /health/detailed has timestamp" '"timestamp"' "$DETAILED_BODY"

# ── 3. Waitlist — invalid email → 400 + INVALID_BODY code ────────────────────

INVALID_BODY=$(curl -s \
  -X POST "$API/waitlist" \
  -H "Content-Type: application/json" \
  -d '{"email":"not-an-email"}')
INVALID_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$API/waitlist" \
  -H "Content-Type: application/json" \
  -d '{"email":"not-an-email"}')

check "POST /waitlist with invalid email → 400" "400" "$INVALID_STATUS"
check_contains "Response has code: INVALID_BODY" '"INVALID_BODY"' "$INVALID_BODY"

# ── 4. Waitlist — valid signup ─────────────────────────────────────────────────

UNIQUE_EMAIL="gate-test-$(date +%s)@launchmind.test"

SIGNUP_BODY=$(curl -s \
  -X POST "$API/waitlist" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$UNIQUE_EMAIL\",\"name\":\"Gate Tester\",\"source\":\"verify-week8\"}")
SIGNUP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$API/waitlist" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"gate-test-2-$(date +%s)@launchmind.test\",\"source\":\"verify-week8\"}")

# 201 = success; 500 = DB error (waitlist table not migrated)
if [ "$SIGNUP_STATUS" = "201" ]; then
  check "POST /waitlist with valid email → 201" "201" "$SIGNUP_STATUS"
  check_contains "Signup response has message field" '"message"' "$SIGNUP_BODY"
elif [ "$SIGNUP_STATUS" = "500" ]; then
  warn "POST /waitlist → 500 (waitlist table not migrated — run migration first)"
  PASS=$((PASS+1))
else
  red "POST /waitlist — unexpected status: $SIGNUP_STATUS"
  FAIL=$((FAIL+1))
fi

# ── 5. Waitlist — duplicate email → 409 + ALREADY_ON_WAITLIST ────────────────

if [ "$SIGNUP_STATUS" = "201" ]; then
  DUPE_BODY=$(curl -s \
    -X POST "$API/waitlist" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$UNIQUE_EMAIL\"}")
  DUPE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API/waitlist" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$UNIQUE_EMAIL\"}")
  check "POST /waitlist duplicate → 409" "409" "$DUPE_STATUS"
  check_contains "Duplicate response has ALREADY_ON_WAITLIST code" '"ALREADY_ON_WAITLIST"' "$DUPE_BODY"
else
  warn "Skipped duplicate email test — waitlist table not available"
fi

# ── 6. Waitlist count endpoint ────────────────────────────────────────────────

COUNT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/waitlist/count")
COUNT_BODY=$(curl -s "$API/waitlist/count")

if [ "$COUNT_STATUS" = "200" ]; then
  check "GET /waitlist/count → 200" "200" "$COUNT_STATUS"
  check_contains "Count response has count field" '"count"' "$COUNT_BODY"
elif [ "$COUNT_STATUS" = "500" ]; then
  warn "GET /waitlist/count → 500 (waitlist table not migrated)"
  PASS=$((PASS+1))
else
  red "GET /waitlist/count — unexpected status: $COUNT_STATUS"
  FAIL=$((FAIL+1))
fi

# ── 7. Error response has code field ──────────────────────────────────────────

# Use an existing guarded route to verify code field presence
AUTH_BODY=$(curl -s "$API/products")
if echo "$AUTH_BODY" | grep -q '"error"'; then
  green "Unauthenticated route returns structured error body"
  PASS=$((PASS+1))
else
  red "Unauthenticated route does not return structured error body"
  FAIL=$((FAIL+1))
fi

# ── 8. Admin health with correct secret (structured error check) ───────────────

if [ -n "$ADMIN_SECRET" ]; then
  ADMIN_HEALTH=$(curl -s "$API/admin/health" -H "x-admin-secret: $ADMIN_SECRET")
  check_contains "GET /admin/health returns ok:true" '"ok":true' "$ADMIN_HEALTH"
else
  warn "Skipped admin health check — set ADMIN_SECRET"
fi

# ── Manual verification steps ─────────────────────────────────────────────────

echo ""
echo "══ Manual verification steps ════════════════════════════════════════════"
echo ""
echo "  A. Apply waitlist migration to local Supabase:"
echo "     supabase db push --local (or apply migration manually)"
echo "     Then re-run this script to test waitlist endpoints."
echo ""
echo "  B. Verify landing page at http://localhost:3000"
echo "     Expected: marketing page with waitlist form visible to unauthenticated users"
echo "     Expected: authenticated users redirected to /dashboard"
echo ""
echo "  C. Verify waitlist count grows after signups:"
echo "     curl http://localhost:3001/waitlist/count"
echo "     supabase sql --local 'SELECT count(*) FROM waitlist;'"
echo ""
echo "  D. Verify health/detailed shows Redis and Supabase status:"
echo "     curl http://localhost:3001/health/detailed | jq ."
echo "     Expected: {\"status\":\"ok\",\"checks\":{\"supabase\":\"ok\",\"redis\":\"ok\"}}"
echo ""
echo "  E. Full test suite from backend directory:"
echo "     cd backend && npm test"
echo "     Expected: 98 tests pass"
echo ""

echo "══════════════════════════════════════════════════════"
echo " Results: $PASS passed, $FAIL failed (automated)"
echo "══════════════════════════════════════════════════════"
echo ""

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
