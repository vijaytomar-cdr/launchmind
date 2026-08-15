-- ============================================================================
-- 106 · Alignment suggestion claims
--
-- WHY. The onboarding positioning screen already renders a "✦ suggestion"
-- badge and prefills three fields from product_claims:
--
--     pick('positioning')  ·  pick('value_prop')  ·  pick('problem')
--
-- None of those categories are permitted by the CHECK constraint below, and
-- nothing in the codebase ever emitted them. So the prefill silently resolved
-- to empty every time, the badge never rendered, and the owner was shown three
-- blank strategy textareas — the exact "fill in a marketing worksheet"
-- experience the product promise contradicts. The UI was built for a capability
-- that was never wired up.
--
-- Adding the categories is what lets suggestions reuse the EXISTING claim
-- provenance machinery (UNREVIEWED → CONFIRMED | CORRECTED | REJECTED) rather
-- than growing a second, parallel confirmation model beside it.
--
-- STRICTLY WIDENING. Every previously valid category remains valid, so no
-- existing row can be invalidated. Idempotent.
-- ============================================================================

ALTER TABLE product_claims
  DROP CONSTRAINT IF EXISTS product_claims_category_check;

ALTER TABLE product_claims
  ADD CONSTRAINT product_claims_category_check
  CHECK (category IN (
    'icp',
    'pain_point',
    'competitor',
    'market',
    'feature',
    'channel',
    'pricing',
    'other',
    -- G1 · how customers should think about the product
    'positioning',
    -- G1 · why customers choose it
    'value_prop',
    -- G2 · what customers are hiring it to solve
    'problem'
  ));

COMMENT ON CONSTRAINT product_claims_category_check ON product_claims IS
  'Must stay in step with CLAIM_CATEGORIES in backend/src/types/onboarding.ts. '
  'positioning/value_prop/problem back the Alignment understanding cards; the '
  'frontend read them before they were permitted here, which is why the screen '
  'showed blank textareas instead of suggestions.';

-- ── current_channels provenance ─────────────────────────────────────────────
-- current_channels is JSONB, so `status: 'observed'` needs no DDL. The comment
-- is the schema-level record of the distinction, because the whole point is
-- that it must never be collapsed again.
--
--   observed  LaunchMind saw this listing in verified public evidence.
--             NOT founder-confirmed marketing. Never enters confirmed_fields,
--             never grants authority, never answers "what are you actively
--             using to acquire customers".
--   using     Owner explicitly confirmed active acquisition through it.
--   planning  Owner explicitly confirmed intent to use or test it.
COMMENT ON COLUMN founder_context.current_channels IS
  'G5. Array of { channel, status } where status is observed | using | planning. '
  'observed = detected public presence (App Store/Play/website), NOT owner-confirmed '
  'marketing: it must never enter confirmed_fields nor satisfy "actively using". '
  'using/planning are owner assertions. Legacy rows carry only using/planning.';
