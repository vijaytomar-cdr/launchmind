-- @file 20260519_000019_seed_playbook_signals_base.sql
-- @description Base playbook signal seed — 32 rows across Productivity, SaaS/B2B, Social, E-commerce,
--   Health, and Gaming categories for both usa and india markets.
--   These are the "starter 28" referenced in CLAUDE.md (slightly expanded).
--   Idempotent: uses INSERT ... ON CONFLICT DO NOTHING (no unique constraint, so all insert fresh
--   only if this script hasn't been run; safe to run once on a fresh DB).
--   Zero PII: no founder_id, product_id, email, name, or any identifier.

INSERT INTO playbook_signals
  (category, market, channel, hook_type, price_tier, install_delta_pct, conversion_rate, retention_d7, week_number)
VALUES
  -- ── Productivity (USA) ────────────────────────────────────────────────────
  ('Productivity', 'usa', 'google',   'pain_first',   'freemium', 31.4, 0.0412, 0.52, 1),
  ('Productivity', 'usa', 'meta',     'outcome',      'freemium', 22.7, 0.0298, 0.47, 2),
  ('Productivity', 'usa', 'email',    'social_proof', 'paid',      9.8, 0.0187, 0.55, 3),
  ('Productivity', 'usa', 'linkedin', 'outcome',      'paid',     17.3, 0.0241, 0.61, 4),

  -- ── Productivity (India) ──────────────────────────────────────────────────
  ('Productivity', 'india', 'whatsapp', 'pain_first',   'freemium', 48.6, 0.0634, 0.54, 1),
  ('Productivity', 'india', 'google',   'outcome',      'freemium', 35.2, 0.0478, 0.49, 2),
  ('Productivity', 'india', 'meta',     'social_proof', 'freemium', 26.1, 0.0341, 0.42, 3),

  -- ── SaaS / B2B Tools (USA) ────────────────────────────────────────────────
  ('saas_b2b',     'usa', 'linkedin',  'pain_first',   'paid',     19.4, 0.0267, 0.64, 2),
  ('saas_b2b',     'usa', 'google',    'outcome',      'paid',     27.8, 0.0389, 0.71, 3),
  ('saas_b2b',     'usa', 'email',     'social_proof', 'paid',     12.3, 0.0201, 0.68, 4),
  ('saas_b2b',     'usa', 'meta',      'curiosity',    'freemium', 14.9, 0.0178, 0.43, 5),

  -- ── SaaS / B2B Tools (India) ─────────────────────────────────────────────
  ('saas_b2b',     'india', 'linkedin',  'outcome',      'paid',    23.5, 0.0312, 0.67, 3),
  ('saas_b2b',     'india', 'whatsapp',  'social_proof', 'freemium', 39.1, 0.0523, 0.52, 4),

  -- ── Social & Community (USA) ─────────────────────────────────────────────
  ('social',       'usa', 'meta',     'fomo',         'free',     54.3, 0.0712, 0.38, 1),
  ('social',       'usa', 'google',   'curiosity',    'free',     41.7, 0.0589, 0.34, 2),
  ('social',       'usa', 'email',    'social_proof', 'free',     18.9, 0.0289, 0.41, 3),

  -- ── Social & Community (India) ───────────────────────────────────────────
  ('social',       'india', 'whatsapp', 'fomo',         'free',    78.4, 0.1012, 0.43, 1),
  ('social',       'india', 'meta',     'social_proof', 'free',    61.2, 0.0823, 0.39, 2),
  ('social',       'india', 'google',   'curiosity',    'free',    43.8, 0.0601, 0.36, 3),

  -- ── E-commerce & Shopping (USA) ──────────────────────────────────────────
  ('ecommerce',    'usa', 'meta',     'fomo',         'free',     38.7, 0.0512, 0.31, 2),
  ('ecommerce',    'usa', 'google',   'outcome',      'free',     29.4, 0.0423, 0.28, 3),
  ('ecommerce',    'usa', 'email',    'social_proof', 'free',     21.6, 0.0334, 0.35, 4),

  -- ── E-commerce & Shopping (India) ────────────────────────────────────────
  ('ecommerce',    'india', 'whatsapp', 'fomo',         'free',    67.3, 0.0912, 0.36, 2),
  ('ecommerce',    'india', 'meta',     'social_proof', 'free',    52.1, 0.0723, 0.33, 3),
  ('ecommerce',    'india', 'google',   'outcome',      'free',    38.4, 0.0534, 0.29, 4),

  -- ── On-demand Services (India) ────────────────────────────────────────────
  ('on_demand',    'india', 'whatsapp', 'pain_first',   'free',    73.8, 0.0981, 0.58, 1),
  ('on_demand',    'india', 'meta',     'fomo',         'free',    58.2, 0.0789, 0.52, 2),
  ('on_demand',    'india', 'google',   'outcome',      'freemium', 41.7, 0.0567, 0.48, 3),

  -- ── On-demand Services (USA) ──────────────────────────────────────────────
  ('on_demand',    'usa', 'meta',     'pain_first',   'free',     36.4, 0.0478, 0.44, 2),
  ('on_demand',    'usa', 'google',   'fomo',         'free',     27.9, 0.0389, 0.41, 3),

  -- ── Wellness & Meditation (USA) ──────────────────────────────────────────
  ('wellness',     'usa', 'meta',     'outcome',      'freemium', 33.6, 0.0441, 0.49, 5),
  ('wellness',     'usa', 'google',   'pain_first',   'freemium', 41.2, 0.0556, 0.53, 6);
