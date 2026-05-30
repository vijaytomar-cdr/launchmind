-- Phase 5 Week 18: Seed ClientPulse demo product for vijay@lm.com.
-- Only inserts the product record with full intake v2 fields populated.
-- Campaigns/metrics/brief skipped — vijay already has seed data from the prior session.
-- Idempotent: ON CONFLICT (id) DO NOTHING.

DO $$
DECLARE
  v_founder_id UUID;
  v_product_id UUID := 'c1000000-0000-0000-0000-000000000001';
BEGIN
  -- Resolve vijay@lm.com founder UUID from the real DB
  SELECT id INTO v_founder_id FROM founders WHERE email = 'vijay@lm.com' LIMIT 1;

  IF v_founder_id IS NULL THEN
    RAISE EXCEPTION 'Founder vijay@lm.com not found — apply migration 22 (auto-create trigger) and sign up first';
  END IF;

  -- Upgrade to builder so the product doesn't hit the free/solo plan product limit
  UPDATE founders SET plan = 'builder', updated_at = now()
  WHERE id = v_founder_id AND plan IN ('free', 'solo');

  -- ClientPulse product with all intake v2 columns populated as a validation fixture
  INSERT INTO products (
    id, founder_id, name, store_url, platform, category, markets, price_tier,
    confirmed_icp, competitor_set, scraped_meta,
    app_store_url, play_store_url, website_url,
    founder_context, website_meta, screenshot_analysis,
    intake_step, intake_completed_at,
    selected_markets, primary_channel, excluded_channels,
    last_scraped_at, created_at, updated_at
  ) VALUES (
    v_product_id,
    v_founder_id,
    'ClientPulse',
    'https://apps.apple.com/app/clientpulse/id1234567890',
    'app_store',
    'Business',
    ARRAY['usa', 'india'],
    'freemium',
    '{"targetUser":"Freelancers and agency owners managing 5-20 clients","geography":["usa","india"],"priceTier":"freemium","painPoints":["Chasing unpaid invoices manually","No single view of client health","Clients ghosting after project delivery"],"competitorGaps":["No competitor offers automated follow-up plus health score combined","HoneyBook lacks India payment support"],"suggestedMarkets":["usa","india"]}',
    '[{"name":"HoneyBook","developer":"HoneyBook Inc","rating":4.5,"category":"Business","priceTier":"paid","platform":"app_store"},{"name":"Bonsai","developer":"Bonsai","rating":4.3,"category":"Business","priceTier":"paid","platform":"app_store"}]',
    '{"name":"ClientPulse","developer":"Pulse Labs","description":"Stop chasing clients. ClientPulse auto-tracks project health, sends smart follow-ups, and tells you which clients are about to ghost before they do.","category":"Business","rating":4.6,"ratingCount":2800,"priceTier":"freemium","screenshots":["https://is1-ssl.mzstatic.com/image/thumb/clientpulse1.png"],"reviews":[{"rating":5,"text":"Finally stopped losing money to late payments","date":"2026-03-01"},{"rating":4,"text":"The ghost detector is scary accurate","date":"2026-02-14"}],"platform":"app_store","storeUrl":"https://apps.apple.com/app/clientpulse/id1234567890"}',
    'https://apps.apple.com/app/clientpulse/id1234567890',
    NULL,
    'https://clientpulse.io',
    '{"budget":"$2000/month","moat":"Proprietary ghost-risk scoring model trained on 50k client interactions","bestCustomerQuote":"I recovered $18k in overdue invoices in the first 3 months","channelsTried":["instagram","cold-email"],"dropOffPoint":"Trial sign-ups drop after day 3 — users do not connect their first client","language":"en","peakSeason":"Q4 — agencies rush to close out annual retainers"}',
    '{"title":"ClientPulse — Client Health Monitor","description":"Automated client relationship monitoring for freelancers","keywords":["client management","invoice tracking","freelancer CRM"],"ogImage":"https://clientpulse.io/og.png"}',
    '{"summary":"Clean professional UI. Onboarding screenshots show 3-step flow. Dashboard prominently features ghost-risk score — strong visual differentiator. CTA copy on all screens says Connect your first client — consistent with drop-off data from founder context.","tone":"Professional","primaryColor":"#2563eb","screenshots_analysed":1}',
    6,
    now() - interval '2 days',
    ARRAY['usa', 'india'],
    'email',
    ARRAY[]::TEXT[],
    now() - interval '2 days',
    now() - interval '2 days',
    now() - interval '2 days'
  )
  ON CONFLICT (id) DO NOTHING;

END $$;
