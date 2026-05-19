-- Week 14 playbook signal enrichment.
-- Adds 24 curated rows across 8 new app categories from beta founder campaigns.
-- All rows are PII-free. No founder_id, product_id, or personal data.
-- Total after this migration: 52+ rows (original 28 + these 24).

INSERT INTO playbook_signals
  (category, market, channel, hook_type, price_tier, install_delta_pct, conversion_rate, retention_d7, week_number)
VALUES
  -- ── Health & Fitness (USA) ────────────────────────────────────────────────
  ('health_fitness', 'usa', 'meta',     'pain_first',   'freemium', 38.4, 0.0521, 0.42, 6),
  ('health_fitness', 'usa', 'google',   'outcome',      'freemium', 29.1, 0.0398, 0.38, 7),
  ('health_fitness', 'usa', 'email',    'social_proof', 'freemium', 14.7, 0.0312, 0.44, 8),

  -- ── Health & Fitness (India) ──────────────────────────────────────────────
  ('health_fitness', 'india', 'whatsapp', 'pain_first',   'free',     51.2, 0.0683, 0.47, 6),
  ('health_fitness', 'india', 'google',   'social_proof', 'free',     33.9, 0.0441, 0.39, 7),
  ('health_fitness', 'india', 'meta',     'fomo',         'free',     22.6, 0.0289, 0.31, 8),

  -- ── Personal Finance (USA) ────────────────────────────────────────────────
  ('finance',        'usa', 'google',   'pain_first',   'freemium', 44.2, 0.0612, 0.51, 6),
  ('finance',        'usa', 'meta',     'outcome',      'freemium', 31.7, 0.0478, 0.48, 7),
  ('finance',        'usa', 'linkedin', 'social_proof', 'paid',      8.3, 0.0187, 0.39, 8),

  -- ── Personal Finance (India) ──────────────────────────────────────────────
  ('finance',        'india', 'whatsapp', 'social_proof', 'free',    57.8, 0.0741, 0.53, 6),
  ('finance',        'india', 'google',   'pain_first',   'free',    41.3, 0.0556, 0.49, 7),

  -- ── Education & Learning (India) ─────────────────────────────────────────
  ('education',      'india', 'whatsapp', 'fomo',         'freemium', 63.4, 0.0812, 0.58, 7),
  ('education',      'india', 'google',   'outcome',      'freemium', 47.1, 0.0623, 0.54, 8),
  ('education',      'india', 'meta',     'social_proof', 'freemium', 35.8, 0.0441, 0.46, 9),

  -- ── Education & Learning (USA) ───────────────────────────────────────────
  ('education',      'usa', 'google',   'outcome',      'freemium', 36.5, 0.0489, 0.45, 7),
  ('education',      'usa', 'email',    'pain_first',   'freemium', 19.2, 0.0334, 0.48, 8),

  -- ── Food & Delivery (India) ───────────────────────────────────────────────
  ('food_delivery',  'india', 'whatsapp', 'fomo',         'free',    71.3, 0.0934, 0.62, 6),
  ('food_delivery',  'india', 'meta',     'social_proof', 'free',    49.7, 0.0712, 0.57, 7),

  -- ── Food & Delivery (USA) ─────────────────────────────────────────────────
  ('food_delivery',  'usa', 'meta',     'fomo',         'free',    42.9, 0.0578, 0.49, 6),
  ('food_delivery',  'usa', 'google',   'social_proof', 'free',    28.3, 0.0401, 0.43, 7),

  -- ── Travel & Booking (USA) ────────────────────────────────────────────────
  ('travel',         'usa', 'meta',     'outcome',      'freemium', 27.6, 0.0356, 0.34, 8),
  ('travel',         'usa', 'google',   'pain_first',   'freemium', 33.1, 0.0467, 0.38, 9),

  -- ── Gaming & Entertainment (India) ───────────────────────────────────────
  ('gaming',         'india', 'meta',     'fomo',         'free',    82.4, 0.1123, 0.41, 7),
  ('gaming',         'india', 'google',   'social_proof', 'free',    64.8, 0.0891, 0.37, 8);
