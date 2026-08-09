-- Migration 025: Align ClientPulse seed data with validation spec.
-- Updates Vijay's founder record and ClientPulse product to match expected
-- field values (primary_channel=whatsapp, moat/quote copy, plan/balance).
-- Adds 3 ClientPulse campaigns + metrics + brief with 4 generated assets.
-- Idempotent: all UPDATEs and ON CONFLICT DO NOTHING inserts.

DO $$
DECLARE
  v_founder_id UUID;
  v_product_id UUID := 'c1000000-0000-0000-0000-000000000001';
  v_campaign_wa UUID := 'cc000000-0001-4000-8000-000000000001';
  v_campaign_meta UUID := 'cc000000-0002-4000-8000-000000000002';
  v_campaign_google UUID := 'cc000000-0003-4000-8000-000000000003';
BEGIN
  SELECT id INTO v_founder_id FROM founders WHERE email = 'vijay@lm.com' LIMIT 1;
  IF v_founder_id IS NULL THEN
    RAISE EXCEPTION 'Founder vijay@lm.com not found';
  END IF;

  -- ── 1. Founder: solo plan, 300 tokens, onboarding complete ─────────────────
  UPDATE founders
  SET
    plan            = 'solo',
    token_balance   = 300,
    onboarding_step = 6,
    updated_at      = now()
  WHERE id = v_founder_id;

  -- ── 2. ClientPulse product: align channel + context copy with spec ──────────
  UPDATE products
  SET
    primary_channel   = 'whatsapp',
    excluded_channels = ARRAY['meta', 'google', 'linkedin', 'email', 'aso_rewrite'],
    selected_markets  = ARRAY['india', 'usa'],
    founder_context   = jsonb_build_object(
      'budget',           '$50-$200/month',
      'stage',            'post-mvp',
      'primaryGoal',      'install_growth',
      'moat',             'Only CRM built natively on WhatsApp Business API — no 3rd-party gateway',
      'bestCustomerQuote','Stopped chasing fees the day I signed up — got ₹40k back in week one',
      'channelsTried',    jsonb_build_array('meta', 'cold-email'),
      'dropOffPoint',     'Users drop at Day 7 — never create their first invoice',
      'firstUserAction',  'Connect first client within 5 minutes of signup',
      'language',         jsonb_build_array('english', 'hinglish'),
      'monetisation',     'freemium',
      'peakSeason',       'q4_holiday',
      'audienceSize',     '1000-5000',
      'geography',        'India + USA freelancers'
    ),
    intake_step        = 6,
    intake_completed_at = COALESCE(intake_completed_at, now() - interval '2 days'),
    updated_at         = now()
  WHERE id = v_product_id AND founder_id = v_founder_id;

  -- ── 3. ClientPulse campaigns (3 rows, all launched + approved) ─────────────
  -- WhatsApp / India
  INSERT INTO campaigns (
    id, product_id, founder_id, channel, market, status,
    hook_type, copy_text, approved_at, launched_at,
    action, ai_tokens_consumed, created_at, updated_at
  ) VALUES (
    v_campaign_wa,
    v_product_id,
    v_founder_id,
    'whatsapp', 'india', 'launched',
    'pain_first',
    E'[Hinglish] Invoice yaad dilana band karo — ClientPulse karta hai.\n\nGhost-risk score dekho, auto-follow-up bhejo, ₹ wapas lo.\n\nFree mein shuru karo 👇',
    now() - interval '10 days',
    now() - interval '9 days',
    'install',
    15,
    now() - interval '10 days',
    now() - interval '10 days'
  ) ON CONFLICT (product_id, channel, market) DO UPDATE
    SET status = 'launched',
        copy_text = EXCLUDED.copy_text,
        approved_at = EXCLUDED.approved_at,
        launched_at = EXCLUDED.launched_at,
        updated_at = now();

  -- Meta / USA
  INSERT INTO campaigns (
    id, product_id, founder_id, channel, market, status,
    hook_type, copy_text, approved_at, launched_at,
    action, ai_tokens_consumed, created_at, updated_at
  ) VALUES (
    v_campaign_meta,
    v_product_id,
    v_founder_id,
    'meta', 'usa', 'launched',
    'benefit_first',
    E'Stop chasing clients who ghost.\n\nClientPulse tells you who''s about to disappear — before they do.\n\nBuilt for freelancers with 5–20 active clients. Free to start.',
    now() - interval '8 days',
    now() - interval '7 days',
    'install',
    15,
    now() - interval '8 days',
    now() - interval '8 days'
  ) ON CONFLICT (product_id, channel, market) DO UPDATE
    SET status = 'launched',
        copy_text = EXCLUDED.copy_text,
        approved_at = EXCLUDED.approved_at,
        launched_at = EXCLUDED.launched_at,
        updated_at = now();

  -- Google UAC / India
  INSERT INTO campaigns (
    id, product_id, founder_id, channel, market, status,
    hook_type, copy_text, approved_at, launched_at,
    action, ai_tokens_consumed, created_at, updated_at
  ) VALUES (
    v_campaign_google,
    v_product_id,
    v_founder_id,
    'google', 'india', 'launched',
    'pain_first',
    E'Client ne invoice ignore kiya fir se?\n\nClientPulse ka ghost-risk score batata hai kaun galega — 3 din pehle.\n\nFreelancers ke liye banaya gaya. Start free.',
    now() - interval '6 days',
    now() - interval '5 days',
    'install',
    15,
    now() - interval '6 days',
    now() - interval '6 days'
  ) ON CONFLICT (product_id, channel, market) DO UPDATE
    SET status = 'launched',
        copy_text = EXCLUDED.copy_text,
        approved_at = EXCLUDED.approved_at,
        launched_at = EXCLUDED.launched_at,
        updated_at = now();

  -- ── 4. Campaign metrics (1 week each) ──────────────────────────────────────
  INSERT INTO campaign_metrics (
    id, campaign_id, founder_id, week_start,
    impressions, clicks, installs, cpi, ctr, roas,
    top_performing_asset, collected_at
  ) VALUES
  (
    gen_random_uuid(), v_campaign_wa, v_founder_id, '2026-05-18',
    12400, 870, 54, 1.60, 0.0702, 2.1,
    'Hinglish pain hook — chasing fees',
    now() - interval '3 days'
  ),
  (
    gen_random_uuid(), v_campaign_meta, v_founder_id, '2026-05-18',
    18900, 420, 42, 4.90, 0.0222, 1.4,
    'Ghost detector benefit hook',
    now() - interval '3 days'
  ),
  (
    gen_random_uuid(), v_campaign_google, v_founder_id, '2026-05-18',
    9600, 310, 36, 3.95, 0.0323, 1.7,
    'Hindi pain headline',
    now() - interval '3 days'
  )
  ON CONFLICT (campaign_id, week_start) DO NOTHING;

  -- ── 5. Weekly brief for ClientPulse with all 4 required asset types ─────────
  INSERT INTO weekly_briefs (
    id, product_id, founder_id, week_of, status,
    what_worked, what_to_kill, next_actions,
    generated_assets, ai_tokens_consumed,
    sent_at, created_at
  ) VALUES (
    gen_random_uuid(),
    v_product_id,
    v_founder_id,
    '2026-05-18',
    'sent',
    'WhatsApp India: 54 installs at ₹133 CPI — Hinglish pain hook outperformed English by 2.3x. Ghost-risk angle resonating strongly.',
    'Meta India: paused — CPI ₹320, frequency 4.1, creative fatigue. Kill after this week if no improvement.',
    '[
      {"week": 2, "action": "Test 3 new WhatsApp hooks: price anchoring, social proof (50k clients tracked), outcome-first"},
      {"week": 2, "action": "Reactivate Meta USA with ghost-detector creative — new audience segment"},
      {"week": 3, "action": "Add ASO rewrite: subtitle ''Invoice Tracker + Client CRM''"}
    ]'::jsonb,
    jsonb_build_object(
      'whatsapp_broadcast', E'[Day 5 re-engagement]\nInvoice ka status kya hai?\n\nClientPulse shows you in real time — chasing fees se hamesha ke liye mukti.\n\nApp open karo → apna first invoice track karo today.',
      'app_store_subtitle', 'Stop chasing fees. Start getting paid.',
      'review_request',     E'Hey [Name] — you''ve recovered ₹{amount} with ClientPulse this month!\n\nIf it''s helped you stop chasing late payments, a quick review would mean the world to us. Takes 30 seconds 🙏',
      'email_rewrite',      E'Subject: The client who ghosted you last month?\n\nClientPulse flagged them 3 days before they went silent.\n\nOur ghost-risk score watches 14 signals — response time, invoice views, message read rates — and tells you who to follow up with before it''s too late.\n\n→ See your client health scores now'
    ),
    20,
    now() - interval '2 days',
    now() - interval '3 days'
  ) ON CONFLICT (product_id, week_of) DO UPDATE
    SET
      status           = 'sent',
      what_worked      = EXCLUDED.what_worked,
      what_to_kill     = EXCLUDED.what_to_kill,
      next_actions     = EXCLUDED.next_actions,
      generated_assets = EXCLUDED.generated_assets,
      sent_at          = EXCLUDED.sent_at;

END $$;
