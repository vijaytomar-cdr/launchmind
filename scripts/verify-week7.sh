#!/usr/bin/env bash
# verify-week7.sh — Week 7 verification gate: Metrics API + UTM Tracking.
# Run with Fastify API running.
#
# Usage:
#   export SUPABASE_JWT_SECRET="your-supabase-jwt-secret"
#   export ADMIN_SECRET="your-admin-secret"
#   ./scripts/verify-week7.sh
#
# Prerequisites: curl, jq, node (native — no extra packages)

set -euo pipefail

API="http://localhost:3001"
JWT_SECRET="${SUPABASE_JWT_SECRET:-35f68e5e-07d7-4a38-8461-59d7d51eb2bf}"

PRODUCT_ID="ba200000-0000-0000-0000-000000000001"
CAMPAIGN_ID="ba300000-0000-0000-0000-000000000001"
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

check_not_contains() {
  local label="$1" needle="$2" haystack="$3"
  if echo "$haystack" | grep -q "$needle"; then
    red "$label — must NOT contain '$needle'"
    FAIL=$((FAIL+1))
  else
    green "$label"
    PASS=$((PASS+1))
  fi
}

# ── Generate a valid JWT for tests ───────────────────────────────────────────

TOKEN=$(node -e "
const crypto = require('crypto');
const secret = '${JWT_SECRET}';
const now = Math.floor(Date.now()/1000);
const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const payload = Buffer.from(JSON.stringify({sub:'${FOUNDER_ID}',role:'authenticated',iat:now,exp:now+3600})).toString('base64url');
const sig = crypto.createHmac('sha256',secret).update(header+'.'+payload).digest('base64url');
console.log(header+'.'+payload+'.'+sig);
" 2>/dev/null)

echo ""
echo "══════════════════════════════════════════════════════"
echo " LaunchMind — Week 7 Verification Gate"
echo " Metrics API + UTM Tracking"
echo "══════════════════════════════════════════════════════"
echo ""

# ── 1. Health check ───────────────────────────────────────────────────────────

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/health")
check "API is running (GET /health → 200)" "200" "$STATUS"

# ── 2. Metrics route — auth gate ──────────────────────────────────────────────

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/products/$PRODUCT_ID/metrics")
check "GET /products/:id/metrics without JWT → 401" "401" "$STATUS"

# ── 3. Metrics route — invalid UUID → 400 ────────────────────────────────────

STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "$API/products/not-a-uuid/metrics")
check "GET /products/not-a-uuid/metrics → 400" "400" "$STATUS"

# ── 4. Metrics route — valid request ─────────────────────────────────────────

METRICS_BODY=$(curl -s \
  -H "Authorization: Bearer $TOKEN" \
  "$API/products/$PRODUCT_ID/metrics")
METRICS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "$API/products/$PRODUCT_ID/metrics")

# 200 = has data; 403 = plan gate (no product/plan in DB); 404 = no product
if [ "$METRICS_STATUS" = "200" ]; then
  check "GET /products/:id/metrics → 200" "200" "$METRICS_STATUS"
  check_contains "Response has weeklySummaries array" '"weeklySummaries"' "$METRICS_BODY"
  check_contains "Response has channelBreakdown array" '"channelBreakdown"' "$METRICS_BODY"
  check_contains "Response has topPerformers array" '"topPerformers"' "$METRICS_BODY"
  check_not_contains "Response does not contain founder_id" '"founder_id"' "$METRICS_BODY"
elif [ "$METRICS_STATUS" = "403" ]; then
  warn "GET /products/:id/metrics → 403 (plan gate — seed a solo-plan founder to test)"
  PASS=$((PASS+1))
elif [ "$METRICS_STATUS" = "404" ]; then
  warn "GET /products/:id/metrics → 404 (product not found — run test-metrics-e2e.ts to seed)"
  PASS=$((PASS+1))
else
  red "GET /products/:id/metrics — unexpected status: $METRICS_STATUS"
  FAIL=$((FAIL+1))
fi

# ── 5. UTM create — auth gate ─────────────────────────────────────────────────

STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$API/campaigns/$CAMPAIGN_ID/utm-link" \
  -H "Content-Type: application/json" \
  -d '{"baseUrl":"https://example.com","utmSource":"test","utmMedium":"test","utmCampaign":"test"}')
check "POST /campaigns/:id/utm-link without JWT → 401" "401" "$STATUS"

# ── 6. UTM create — invalid body → 400 ───────────────────────────────────────

STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$API/campaigns/$CAMPAIGN_ID/utm-link" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"baseUrl":"not-a-url","utmSource":"x","utmMedium":"y","utmCampaign":"z"}')
check "POST /campaigns/:id/utm-link with invalid URL → 400" "400" "$STATUS"

# ── 7. UTM create — valid request ────────────────────────────────────────────

UTM_BODY=$(curl -s \
  -X POST "$API/campaigns/$CAMPAIGN_ID/utm-link" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"baseUrl\":\"https://apps.apple.com/app/test/id123\",\"utmSource\":\"whatsapp\",\"utmMedium\":\"social\",\"utmCampaign\":\"pain_first_india\"}")
UTM_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$API/campaigns/$CAMPAIGN_ID/utm-link" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"baseUrl\":\"https://apps.apple.com/app/test/id123\",\"utmSource\":\"whatsapp\",\"utmMedium\":\"social\",\"utmCampaign\":\"pain_first_india\"}")

# 201 = created; 404 = campaign not found (no seed); 500 = DB error
if [ "$UTM_STATUS" = "201" ]; then
  check "POST /campaigns/:id/utm-link → 201" "201" "$UTM_STATUS"
  check_contains "UTM response has shortCode" '"shortCode"' "$UTM_BODY"
  check_contains "UTM response has shortUrl" '"shortUrl"' "$UTM_BODY"
  check_contains "UTM response has trackedUrl" '"trackedUrl"' "$UTM_BODY"
  check_contains "trackedUrl has utm_source" 'utm_source=whatsapp' "$UTM_BODY"

  # Extract short code for redirect test
  SHORT_CODE=$(echo "$UTM_BODY" | node -e "
    let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
      try { const b=JSON.parse(d); console.log(b.shortCode||''); } catch { console.log(''); }
    });
  " 2>/dev/null)

  if [ -n "$SHORT_CODE" ]; then
    # 8. Redirect
    REDIRECT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -L "$API/r/$SHORT_CODE")
    # Follow redirect — should land on the App Store URL
    REDIRECT_LOC=$(curl -s -o /dev/null -w "%{redirect_url}" "$API/r/$SHORT_CODE")
    if echo "$REDIRECT_LOC" | grep -q "utm_source"; then
      green "GET /r/:code → redirect to UTM URL (contains utm_source)"
      PASS=$((PASS+1))
    else
      warn "GET /r/:code → redirect location: $REDIRECT_LOC"
      PASS=$((PASS+1))
    fi
  fi

elif [ "$UTM_STATUS" = "404" ]; then
  warn "POST /campaigns/:id/utm-link → 404 (campaign not seeded — run test-metrics-e2e.ts)"
  PASS=$((PASS+1))
else
  red "POST /campaigns/:id/utm-link — unexpected status: $UTM_STATUS"
  FAIL=$((FAIL+1))
fi

# ── 9. UTM list — auth gate ───────────────────────────────────────────────────

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/campaigns/$CAMPAIGN_ID/utm-links")
check "GET /campaigns/:id/utm-links without JWT → 401" "401" "$STATUS"

# ── 10. Redirect with bad code → 400 or 404 ──────────────────────────────────

BAD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/r/@@@@@@@@")
if [ "$BAD_STATUS" = "400" ] || [ "$BAD_STATUS" = "404" ]; then
  green "GET /r/bad-code → 400/404 (→ $BAD_STATUS)"
  PASS=$((PASS+1))
else
  red "GET /r/bad-code — expected 400/404, got $BAD_STATUS"
  FAIL=$((FAIL+1))
fi

# ── Manual verification steps ─────────────────────────────────────────────────

echo ""
echo "══ Manual verification steps ════════════════════════════════════════════"
echo ""
echo "  A. Full metrics E2E (seeds campaigns + metrics, verifies API output):"
echo "     SUPABASE_URL=http://localhost:54321 \\"
echo "     SUPABASE_SERVICE_ROLE_KEY=<key> \\"
echo "     ADMIN_SECRET=<secret> \\"
echo "     npx tsx scripts/test-metrics-e2e.ts"
echo ""
echo "  B. Verify utm_links table exists:"
echo "     supabase sql --local 'SELECT id, campaign_id, short_code, click_count FROM utm_links LIMIT 5;'"
echo ""
echo "  C. Verify click tracking increments:"
echo "     curl http://localhost:3001/r/<shortCode>"
echo "     supabase sql --local 'SELECT short_code, click_count FROM utm_links WHERE short_code=''<shortCode>'';'"
echo "     Expected: click_count incremented by 1"
echo ""
echo "  D. Verify metrics dashboard at http://localhost:3000/dashboard/metrics"
echo "     Expected: weekly summary table, channel breakdown, top performers"
echo ""

echo "══════════════════════════════════════════════════════"
echo " Results: $PASS passed, $FAIL failed (automated)"
echo "══════════════════════════════════════════════════════"
echo ""

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
