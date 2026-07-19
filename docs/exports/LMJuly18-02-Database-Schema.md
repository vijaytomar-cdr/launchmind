# LMJuly18-02 — LaunchMind: Database Schema

**Date:** July 18, 2026 · Part 2 of 6  
**Database:** Supabase Postgres (`gseqtbwdenjkwysregpp`)  
**Total migrations:** 61 (migrations 001–061)  
**Rule:** Additive only — never drop/rename/retype columns, never delete tables

---

## Table of Contents

1. [Migration History Overview](#1-migration-history-overview)
2. [Core Founder & Product Tables](#2-core-founder--product-tables)
3. [Campaign & Metrics Tables](#3-campaign--metrics-tables)
4. [Content & Learning Tables](#4-content--learning-tables)
5. [Intelligence & Memory Tables](#5-intelligence--memory-tables)
6. [AI Platform Tables](#6-ai-platform-tables)
7. [Mission & Agent Tables](#7-mission--agent-tables)
8. [Owner Experience Tables](#8-owner-experience-tables)
9. [Analytics & Reporting Tables](#9-analytics--reporting-tables)
10. [Infrastructure Tables](#10-infrastructure-tables)
11. [RLS Summary](#11-rls-summary)

---

## 1. Migration History Overview

| Migration | Date | Description |
|-----------|------|-------------|
| 001 | 2026-05-16 | founders table |
| 002 | 2026-05-16 | products table |
| 003 | 2026-05-16 | platform_tokens table |
| 004 | 2026-05-16 | campaigns table |
| 005 | 2026-05-16 | campaign_metrics table |
| 006 | 2026-05-16 | weekly_briefs table |
| 007 | 2026-05-16 | playbook_signals table |
| 008 | 2026-05-16 | audit_logs table |
| 009 | 2026-05-16 | embedding_store table |
| 010 | 2026-05-17 | campaigns unique channel+market constraint |
| 011 | 2026-05-17 | utm_links table |
| 012 | 2026-05-17 | waitlist table |
| 013 | 2026-05-18 | founders.onboarding_step column |
| 014 | 2026-05-18 | founder_feedback table |
| 015 | 2026-05-18 | workspaces table |
| 016 | 2026-05-18 | products.workspace_id column |
| 017 | 2026-05-18 | api_keys table |
| 018 | 2026-05-18 | playbook_signals enrichment (week 14) |
| 019 | 2026-05-19 | seed playbook_signals base (28 rows) |
| 020 | 2026-05-19 | consume_tokens_fn SQL function |
| 021 | 2026-05-20 | campaigns.action column |
| 022 | 2026-05-23 | auto_create_founder_on_signup trigger |
| 023 | 2026-05-24 | products intake v2 (11 new columns) |
| 024 | 2026-05-24 | seed ClientPulse demo product |
| 025 | 2026-05-25 | seed ClientPulse fix (aligned with spec) |
| 026 | 2026-05-30 | content_assets table |
| 027 | 2026-05-30 | content_preferences table |
| 028 | 2026-05-30 | content_learnings table |
| 029 | 2026-05-30 | product_archive columns |
| 030 | 2026-06-19 | products.full_strategy column |
| 031 | 2026-06-20 | video_concept_status column |
| 032 | 2026-07-08 | workspace_members table |
| 033 | 2026-07-08 | products intake v3 columns |
| 034 | 2026-07-08 | integrations_extend table |
| 035 | 2026-07-08 | marketing_memories table |
| 036 | 2026-07-08 | marketing_memory_versions table |
| 037 | 2026-07-08 | knowledge_nodes table |
| 038 | 2026-07-08 | knowledge_edges table |
| 039 | 2026-07-08 | evidence table |
| 040 | 2026-07-08 | learning_events table |
| 041 | 2026-07-08 | prompts table |
| 042 | 2026-07-08 | ai_requests table |
| 043 | 2026-07-08 | seed_prompts (11 initial prompts) |
| 044 | 2026-07-08 | missions table |
| 045 | 2026-07-08 | mission_steps + mission_logs + mission_approvals |
| 046 | 2026-07-08 | saved_opportunities + notifications tables |
| 047 | 2026-07-08 | content_versions (append-only) |
| 048 | 2026-07-08 | asset_approvals (append-only) |
| 049 | 2026-07-08 | publishing_targets table |
| 050 | 2026-07-08 | content_assets_extend (tags, mission_id, 5 new types) |
| 051 | 2026-07-08 | campaigns_extend (type, new statuses, new channels) |
| 052 | 2026-07-08 | experiments + experiment_variants tables |
| 053 | 2026-07-08 | campaign_approvals (append-only) |
| 054 | 2026-07-08 | campaign_publish_attempts table |
| 055 | 2026-07-08 | execution_calendar_events table |
| 056 | 2026-07-09 | decision_rules table (8 seeded rules) |
| 057 | 2026-07-09 | recommendation_feedback table |
| 058 | 2026-07-09 | intelligence_trends table |
| 059 | 2026-07-09 | saved_opportunities_m10 (extends 046) |
| 060 | 2026-07-09 | reports table |
| 061 | 2026-07-09 | optimization_insights table |

**Pushed to hosted Supabase:** Migrations 001–031 confirmed pushed.  
**Pending push:** Migrations 032–061 must be pushed before production traffic.

---

## 2. Core Founder & Product Tables

### `founders`
```sql
CREATE TABLE founders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  name            TEXT,
  plan            TEXT NOT NULL DEFAULT 'free'
                  CHECK (plan IN ('free','solo','builder','studio')),
  mfa_enabled     BOOLEAN NOT NULL DEFAULT false,
  token_balance   INTEGER DEFAULT NULL,
  deleted_at      TIMESTAMPTZ,
  onboarding_step INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE founders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "founders_self" ON founders USING (id = auth.uid());
```

Soft-delete only: `deleted_at` is set, email is anonymised. GDPR `DELETE /founders/me` sets this.

### `products`
```sql
CREATE TABLE products (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id            UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  store_url             TEXT NOT NULL,
  platform              TEXT NOT NULL CHECK (platform IN ('app_store','play_store')),
  category              TEXT,
  markets               TEXT[] DEFAULT ARRAY['usa'],
  price_tier            TEXT,
  confirmed_icp         JSONB,
  competitor_set        JSONB,
  scraped_meta          JSONB,    -- includes marketingImages[] (permanent CDN URLs)
  brand_voice_profile   JSONB,
  last_scraped_at       TIMESTAMPTZ,
  icp_embedding         VECTOR(1536),
  workspace_id          UUID REFERENCES workspaces(id),
  -- Intake v2 columns (migration 023)
  primary_channel       TEXT,
  target_markets        TEXT[],
  founder_context       JSONB,
  intake_step           INTEGER DEFAULT 0,
  intake_completed_at   TIMESTAMPTZ,
  website_url           TEXT,
  website_meta          JSONB,    -- includes logoUrl
  app_store_url         TEXT,
  play_store_url        TEXT,
  screenshots           JSONB,
  -- Archive columns (migration 029)
  archived_at           TIMESTAMPTZ,
  archive_reason        TEXT,
  -- Strategy column (migration 030)
  full_strategy         JSONB,
  -- Intake v3 columns (migration 033)
  intake_version        INTEGER DEFAULT 2,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_owner" ON products USING (founder_id = auth.uid());
```

### `platform_tokens`
```sql
-- NEVER return encrypted_token to the frontend under any circumstance.
CREATE TABLE platform_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id      UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL
                  CHECK (platform IN ('meta','google','whatsapp','linkedin','email')),
  encrypted_token TEXT NOT NULL,   -- AES-256 encrypted, key via AWS KMS only
  kms_key_id      TEXT NOT NULL,
  scopes          TEXT[] NOT NULL,
  expires_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(founder_id, platform)
);
ALTER TABLE platform_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tokens_owner" ON platform_tokens USING (founder_id = auth.uid());
```

### `workspaces`
```sql
CREATE TABLE workspaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id  UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  client_name TEXT,
  workspace_type TEXT DEFAULT 'personal',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspaces_owner" ON workspaces USING (founder_id = auth.uid());
```

### `workspace_members`
```sql
CREATE TABLE workspace_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  founder_id   UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  invited_by   UUID REFERENCES founders(id),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, founder_id)
);
```

### `api_keys` (Studio-only)
```sql
CREATE TABLE api_keys (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  key_hash   TEXT NOT NULL UNIQUE,  -- bcrypt hash, never store plaintext
  scopes     TEXT[] NOT NULL,
  last_used  TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 3. Campaign & Metrics Tables

### `campaigns`
```sql
CREATE TABLE campaigns (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id           UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  founder_id           UUID NOT NULL REFERENCES founders(id),
  channel              TEXT NOT NULL
                       CHECK (channel IN
                         ('meta','google','whatsapp','linkedin','email','aso_rewrite',
                          'tiktok','youtube','pinterest','snapchat')),
  market               TEXT NOT NULL CHECK (market IN ('usa','india')),
  status               TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN
                         ('draft','pending_approval','approved','launched','paused',
                          'completed','scheduled','cancelled','failed')),
  hook_type            TEXT,
  copy_text            TEXT,
  audience_config      JSONB,
  spend_cap            JSONB,      -- { daily_usd, weekly_usd, monthly_usd }
  external_campaign_id TEXT,
  action               TEXT,
  ai_tokens_consumed   INTEGER DEFAULT 0,
  approved_at          TIMESTAMPTZ,  -- §1.5: must be non-null before any platform post
  launched_at          TIMESTAMPTZ,
  -- Extension columns (migration 051)
  type                 TEXT DEFAULT 'standard' CHECK (type IN ('standard','retargeting','aso','experiment')),
  scheduled_at         TIMESTAMPTZ,
  cancelled_at         TIMESTAMPTZ,
  failed_at            TIMESTAMPTZ,
  failure_reason       TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaigns_owner" ON campaigns USING (founder_id = auth.uid());
CREATE INDEX campaigns_product_status ON campaigns(product_id, status);
```

### `campaign_metrics`
```sql
CREATE TABLE campaign_metrics (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id          UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  founder_id           UUID NOT NULL REFERENCES founders(id),
  week_start           DATE NOT NULL,
  impressions          INTEGER DEFAULT 0,
  clicks               INTEGER DEFAULT 0,
  installs             INTEGER DEFAULT 0,
  cpi                  NUMERIC(10,4),
  ctr                  NUMERIC(6,4),
  roas                 NUMERIC(10,4),
  top_performing_asset TEXT,
  raw_platform_data    JSONB,
  collected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, week_start)
);
ALTER TABLE campaign_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "metrics_owner" ON campaign_metrics USING (founder_id = auth.uid());
```

### `campaign_approvals` (append-only, migration 053)
```sql
CREATE TABLE campaign_approvals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  founder_id  UUID NOT NULL REFERENCES founders(id),
  status      TEXT NOT NULL CHECK (status IN ('approved','rejected')),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- REVOKE UPDATE, DELETE FROM authenticated;
```

### `campaign_publish_attempts` (migration 054)
```sql
CREATE TABLE campaign_publish_attempts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  attempt_num INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL CHECK (status IN ('pending','success','failed')),
  error       TEXT,
  platform_response JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `utm_links` (migration 011)
```sql
CREATE TABLE utm_links (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id),
  original_url TEXT NOT NULL,
  utm_url    TEXT NOT NULL,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  clicks     INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `experiments` (migration 052)
```sql
CREATE TABLE experiments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id      UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES products(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  hypothesis      TEXT,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','running','completed','archived')),
  winner          TEXT CHECK (winner IN ('a','b',NULL)),
  learning_summary TEXT,
  start_date      TIMESTAMPTZ,
  end_date        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "experiments_owner" ON experiments USING (founder_id = auth.uid());
```

### `experiment_variants`
```sql
CREATE TABLE experiment_variants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id   UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  label           TEXT NOT NULL CHECK (label IN ('a','b')),
  copy_text       TEXT,
  audience_config JSONB,
  impressions     INTEGER DEFAULT 0,
  clicks          INTEGER DEFAULT 0,
  installs        INTEGER DEFAULT 0,
  cpi             NUMERIC(10,4),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 4. Content & Learning Tables

### `content_assets`
```sql
CREATE TABLE content_assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id      UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES products(id) ON DELETE CASCADE,
  campaign_id     UUID REFERENCES campaigns(id),
  type            TEXT NOT NULL CHECK (type IN (
    -- Original 26 types
    'instagram_reel','tiktok_video','youtube_short','meta_static_ad','google_display_ad',
    'whatsapp_message','linkedin_post','email_subject','email_body','push_notification',
    'app_store_title','app_store_description','app_store_keywords','play_store_listing',
    'tweet','facebook_post','voice_note','video_script','ad_copy_short','ad_copy_long',
    'headline','tagline','aso_title','aso_description','aso_keywords',
    -- M08 new types (migration 050)
    'blog_post','landing_page_copy','release_notes','press_release',
    -- Visual types
    'image_photorealistic','image_graphic','image_mockup'
  )),
  channel         TEXT,
  market          TEXT CHECK (market IN ('usa','india',NULL)),
  asset_data      JSONB NOT NULL,   -- { text?, imageUrl?, videoUrl?, audioUrl?, metadata? }
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','approved','published','archived')),
  -- Extension columns (migration 050)
  tags            TEXT[],
  mission_id      UUID REFERENCES missions(id),
  growth_brain_version INTEGER,
  archived_at     TIMESTAMPTZ,
  published_at    TIMESTAMPTZ,
  model_used      TEXT,            -- 'real-screenshot+mockup+logo' | 'sonnet+flux-schnell+...'
  tokens_consumed INTEGER DEFAULT 0,
  ctr             NUMERIC(6,4),
  performed_at    TIMESTAMPTZ,
  parent_asset_id UUID REFERENCES content_assets(id),
  render_started_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE content_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assets_owner" ON content_assets USING (founder_id = auth.uid());
```

### `content_preferences` (migration 027)
```sql
CREATE TABLE content_preferences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id  UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id  UUID REFERENCES products(id),
  asset_type  TEXT,
  preferences JSONB,              -- per-type settings
  voice_clone_id TEXT,            -- ElevenLabs voice ID
  visual      JSONB,              -- { logoUrl, imageStyle: 'photorealistic'|'graphic'|'mockup' }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `content_versions` (append-only, migration 047)
```sql
CREATE TABLE content_versions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id     UUID NOT NULL REFERENCES content_assets(id) ON DELETE CASCADE,
  founder_id   UUID NOT NULL REFERENCES founders(id),
  version_num  INTEGER NOT NULL,
  asset_data   JSONB NOT NULL,    -- snapshot before update
  changed_by   TEXT,             -- 'founder' | 'ai_transform' | 'api'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- REVOKE UPDATE, DELETE FROM authenticated;  -- append-only
```

### `content_learnings` (migration 028)
```sql
CREATE TABLE content_learnings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id    UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id    UUID REFERENCES products(id),
  learning_type TEXT NOT NULL,
  insight       TEXT NOT NULL,
  confidence    NUMERIC(4,2),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Note: currently 0 rows for demo founder
```

### `asset_approvals` (append-only, migration 048)
```sql
CREATE TABLE asset_approvals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id     UUID NOT NULL REFERENCES content_assets(id) ON DELETE CASCADE,
  founder_id   UUID NOT NULL REFERENCES founders(id),
  status       TEXT NOT NULL CHECK (status IN ('approved','rejected')),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- REVOKE UPDATE, DELETE FROM authenticated;
```

### `publishing_targets` (migration 049)
```sql
CREATE TABLE publishing_targets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_asset_id UUID NOT NULL REFERENCES content_assets(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','failed')),
  external_id     TEXT,
  published_at    TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `weekly_briefs`
```sql
CREATE TABLE weekly_briefs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  founder_id         UUID NOT NULL REFERENCES founders(id),
  week_of            DATE NOT NULL,
  what_worked        TEXT,
  what_to_kill       TEXT,
  next_actions       JSONB,
  generated_assets   JSONB,
  ai_tokens_consumed INTEGER DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','sent','acknowledged')),
  sent_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, week_of)
);
ALTER TABLE weekly_briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "briefs_owner" ON weekly_briefs USING (founder_id = auth.uid());
```

---

## 5. Intelligence & Memory Tables

### `marketing_memories` (migration 035)
```sql
CREATE TABLE marketing_memories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id  UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id  UUID REFERENCES products(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  memory_type TEXT NOT NULL CHECK (memory_type IN (
    'brand','product','customer','campaign','founder',
    'channel','market','competitor','experiment'
  )),
  source      TEXT NOT NULL,     -- 'intake_completed' | 'campaign_result' | 'review_ingested' | etc.
  confidence  NUMERIC(4,2) NOT NULL DEFAULT 0.5,
  version     INTEGER NOT NULL DEFAULT 1,
  tags        TEXT[],
  archived    BOOLEAN NOT NULL DEFAULT false,
  embedding   VECTOR(1536),
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE marketing_memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "memories_owner" ON marketing_memories USING (founder_id = auth.uid());
```

**Current seed data:** 5 rows for demo founder vijay@lm.com  
(brand: 0.81, product: 0.79, customer: 0.86, campaign: 0.58, founder: 0.63)

### `marketing_memory_versions` (append-only, migration 036)
```sql
CREATE TABLE marketing_memory_versions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id  UUID NOT NULL REFERENCES marketing_memories(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  body       TEXT,
  confidence NUMERIC(4,2),
  changed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- REVOKE UPDATE, DELETE FROM authenticated;
```

### `knowledge_nodes` (migration 037)
```sql
CREATE TABLE knowledge_nodes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id  UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  node_type   TEXT NOT NULL CHECK (node_type IN (
    'product','channel','market','competitor','audience_segment',
    'campaign_type','metric','insight','founder'
  )),
  label       TEXT NOT NULL,
  properties  JSONB,
  confidence  NUMERIC(4,2) DEFAULT 0.5,
  embedding   VECTOR(1536),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(founder_id, node_type, label)
);
ALTER TABLE knowledge_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nodes_owner" ON knowledge_nodes USING (founder_id = auth.uid());
```

### `knowledge_edges` (migration 038)
```sql
CREATE TABLE knowledge_edges (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id     UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  relation_type  TEXT NOT NULL,   -- 'outperforms', 'targets', 'competes_with', etc.
  weight         NUMERIC(4,2) DEFAULT 1.0,
  evidence       TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE knowledge_edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "edges_owner" ON knowledge_edges USING (founder_id = auth.uid());
```

### `evidence` (migration 039)
```sql
CREATE TABLE evidence (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  memory_id  UUID REFERENCES marketing_memories(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  source     TEXT NOT NULL,
  confidence NUMERIC(4,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `learning_events` (migration 040)
```sql
CREATE TABLE learning_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id  UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL CHECK (event_type IN (
    'intake_completed','campaign_result','review_ingested','founder_feedback',
    'growth_brain_approved','analytics_synced','experiment_result','ai_conversation'
  )),
  payload     JSONB NOT NULL,
  processed   BOOLEAN NOT NULL DEFAULT false,
  result      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `playbook_signals` (anonymized)
```sql
-- ANONYMIZED. No founder_id. No product_id. No PII.
-- service_role may INSERT. authenticated: SELECT only.
CREATE TABLE playbook_signals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category          TEXT NOT NULL,
  market            TEXT NOT NULL CHECK (market IN ('usa','india')),
  channel           TEXT NOT NULL,
  hook_type         TEXT,
  price_tier        TEXT,
  install_delta_pct NUMERIC(8,2),
  conversion_rate   NUMERIC(6,4),
  retention_d7      NUMERIC(6,4),
  week_number       INTEGER,
  signal_embedding  VECTOR(1536),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON playbook_signals TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON playbook_signals FROM authenticated;
-- 52 rows seeded (28 from migration 019 + 24 from migration 018)
```

### `embedding_store`
```sql
CREATE TABLE embedding_store (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id  UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id  UUID REFERENCES products(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('icp','campaign_history','learning_log')),
  content     TEXT NOT NULL,
  embedding   VECTOR(1536),
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE embedding_store ENABLE ROW LEVEL SECURITY;
CREATE POLICY "embeddings_owner" ON embedding_store USING (founder_id = auth.uid());
```

### `intelligence_trends` (anonymous, migration 058)
```sql
-- No founder_id, no product_id — fully anonymous aggregates
-- Min cohort=3 before a trend row is published
CREATE TABLE intelligence_trends (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category         TEXT NOT NULL,
  market           TEXT NOT NULL CHECK (market IN ('usa','india')),
  channel          TEXT NOT NULL,
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,
  signal_count     INTEGER NOT NULL DEFAULT 0,  -- cohort size
  avg_install_delta NUMERIC(8,2),
  avg_conversion    NUMERIC(6,4),
  avg_retention_d7  NUMERIC(6,4),
  top_hook_type    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(category, market, channel, period_start)
);
GRANT SELECT ON intelligence_trends TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON intelligence_trends FROM authenticated;
```

---

## 6. AI Platform Tables

### `prompts` (migration 041, 11 seeded via migration 043)
```sql
CREATE TABLE prompts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,           -- 'morning_brief', 'strategy_generation', etc.
  version     INTEGER NOT NULL DEFAULT 1,
  body        TEXT NOT NULL,           -- the prompt text
  model       TEXT,                    -- 'sonnet' | 'haiku'
  max_tokens  INTEGER,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(name, version)
);
```

11 seeded prompt names: morning_brief, strategy_generation, content_assets_generation, brand_voice_extract, brand_voice_apply, icp_structuring, review_analysis, weekly_brief, content_score, recommendation_generation, agent_campaign_draft

### `ai_requests` (immutable audit, migration 042)
```sql
CREATE TABLE ai_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id    UUID REFERENCES founders(id),
  product_id    UUID REFERENCES products(id),
  prompt_id     TEXT,              -- name of the prompt used
  action        TEXT NOT NULL,     -- action identifier (matches auditCtx.action)
  model         TEXT NOT NULL,     -- 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001'
  input_tokens  INTEGER,
  output_tokens INTEGER,
  cost_usd      NUMERIC(10,6),
  status        TEXT NOT NULL CHECK (status IN ('success','failed','timeout')),
  error_message TEXT,              -- 'output_validation_failed' on Zod parse error
  latency_ms    INTEGER,
  retries       INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE ai_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_requests_owner" ON ai_requests FOR SELECT USING (founder_id = auth.uid());
-- INSERT via service_role only. No UPDATE, DELETE.
```

---

## 7. Mission & Agent Tables

### `missions` (migration 044)
```sql
CREATE TABLE missions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id  UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id  UUID REFERENCES products(id),
  title       TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN (
    'research','strategy','content','campaign','memory',
    'reporting','planning','creative','publishing','optimization','learning','benchmark'
  )),
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','queued','running','requires_approval','completed','failed','cancelled'
  )),
  priority    INTEGER NOT NULL DEFAULT 5,  -- 1=highest, 10=lowest
  context     JSONB,
  result      JSONB,
  idempotency_key TEXT UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "missions_owner" ON missions USING (founder_id = auth.uid());
```

### `mission_steps` (migration 045)
```sql
CREATE TABLE mission_steps (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  agent_type TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','running','completed','failed','skipped','requires_approval'
  )),
  input      JSONB,
  output     JSONB,
  error      TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `mission_logs` (migration 045)
```sql
CREATE TABLE mission_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  founder_id UUID NOT NULL REFERENCES founders(id),
  message    TEXT NOT NULL,
  level      TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','warn','error')),
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Note: 0 rows for demo founder (missions haven't been run)
```

### `mission_approvals` (migration 045)
```sql
CREATE TABLE mission_approvals (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  step_id    UUID REFERENCES mission_steps(id),
  founder_id UUID NOT NULL REFERENCES founders(id),
  status     TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 8. Owner Experience Tables

### `saved_opportunities` (migration 046, extended by migration 059)
```sql
CREATE TABLE saved_opportunities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id      UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES products(id),
  type            TEXT NOT NULL,           -- 'aso', 'india_launch', 'review_risk', etc.
  title           TEXT NOT NULL,
  description     TEXT,
  expected_impact TEXT,
  effort          TEXT CHECK (effort IN ('low','medium','high')),
  risk            TEXT CHECK (risk IN ('low','medium','high')),
  confidence      NUMERIC(4,2),
  state           TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','saved','dismissed','converted')),
  evidence        JSONB,                   -- always stored as plain array (not JSON.stringify)
  why_now         TEXT,
  source          TEXT,
  -- M10 extension columns (migration 059)
  recommendation_type TEXT,
  score           NUMERIC(6,4),
  priority        INTEGER,
  source_signals  JSONB,
  expires_at      TIMESTAMPTZ,
  related_mission_id UUID REFERENCES missions(id),
  feedback_summary JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE saved_opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "opportunities_owner" ON saved_opportunities USING (founder_id = auth.uid());
```

### `notifications` (migration 046)
```sql
CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  read       BOOLEAN NOT NULL DEFAULT false,
  link       TEXT,
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications_owner" ON notifications USING (founder_id = auth.uid());
```

### `execution_calendar_events` (migration 055)
```sql
CREATE TABLE execution_calendar_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id  UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  event_type  TEXT NOT NULL CHECK (event_type IN (
    'campaign_launch','experiment_start','brief_delivery','content_publish',
    'review_window','manual'
  )),
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','campaign','experiment','brief')),
  source_id   UUID,                -- id of the source campaign/experiment/brief
  start_date  TIMESTAMPTZ NOT NULL,
  end_date    TIMESTAMPTZ,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE execution_calendar_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "calendar_owner" ON execution_calendar_events USING (founder_id = auth.uid());
```

---

## 9. Analytics & Reporting Tables

### `reports` (migration 060)
```sql
CREATE TABLE reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id   UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id   UUID REFERENCES products(id),
  type         TEXT NOT NULL CHECK (type IN (
    'weekly','monthly','executive','campaign','experiment'
  )),
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  content      JSONB NOT NULL,     -- AI narrative cache: { headline, whatWorked, fix, insights, actions }
  tokens_used  INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(founder_id, product_id, type, period_start)
);
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reports_owner" ON reports USING (founder_id = auth.uid());
```

### `optimization_insights` (migration 061)
```sql
CREATE TABLE optimization_insights (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id  UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id  UUID REFERENCES products(id),
  type        TEXT NOT NULL CHECK (type IN (
    'channel_shift','budget_reallocation','copy_refresh',
    'audience_expand','timing_optimization','market_opportunity'
  )),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  confidence  NUMERIC(4,2) NOT NULL,   -- high-confidence (≥0.8) triggers generateRecommendations
  impact      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','dismissed')),
  applied_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE optimization_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "insights_owner" ON optimization_insights USING (founder_id = auth.uid());
```

### `decision_rules` (8 seeded, migration 056)
```sql
CREATE TABLE decision_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  rule_fn     TEXT NOT NULL,        -- identifier for the TypeScript function
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Seeded rules: approve_before_post, spend_cap, budget_increase_reapproval,
-- studio_plan_gate, content_regen_limit, experiment_min_runtime,
-- token_balance_gate, workspace_tenant_isolation
```

### `recommendation_feedback` (append-only, migration 057)
```sql
CREATE TABLE recommendation_feedback (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL REFERENCES saved_opportunities(id) ON DELETE CASCADE,
  founder_id        UUID NOT NULL REFERENCES founders(id),
  feedback_type     TEXT NOT NULL CHECK (feedback_type IN (
    'helpful','not_relevant','too_early','already_done','wrong_context'
  )),
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- REVOKE UPDATE, DELETE FROM authenticated;
```

---

## 10. Infrastructure Tables

### `audit_logs` (immutable)
```sql
-- IMMUTABLE. INSERT only. REVOKE UPDATE, DELETE from all non-superuser roles.
CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id    UUID REFERENCES founders(id),
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   UUID,
  metadata      JSONB,
  ip_address    INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_owner_read" ON audit_logs FOR SELECT USING (founder_id = auth.uid());
REVOKE UPDATE, DELETE ON audit_logs FROM authenticated, anon;
```

### `waitlist` (migration 012)
```sql
CREATE TABLE waitlist (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL UNIQUE,
  source     TEXT DEFAULT 'landing',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `founder_feedback` (migration 014)
```sql
CREATE TABLE founder_feedback (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id UUID REFERENCES founders(id),
  rating     INTEGER CHECK (rating BETWEEN 1 AND 5),
  message    TEXT,
  context    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 11. RLS Summary

| Table | Policy | Access |
|-------|--------|--------|
| founders | `id = auth.uid()` | Self only |
| products | `founder_id = auth.uid()` | Owner only |
| platform_tokens | `founder_id = auth.uid()` | Owner only |
| campaigns | `founder_id = auth.uid()` | Owner only |
| campaign_metrics | `founder_id = auth.uid()` | Owner only |
| weekly_briefs | `founder_id = auth.uid()` | Owner only |
| embedding_store | `founder_id = auth.uid()` | Owner only |
| content_assets | `founder_id = auth.uid()` | Owner only |
| marketing_memories | `founder_id = auth.uid()` | Owner only |
| knowledge_nodes | `founder_id = auth.uid()` | Owner only |
| knowledge_edges | `founder_id = auth.uid()` | Owner only |
| ai_requests | `founder_id = auth.uid()` (SELECT) | Owner read, service_role write |
| missions | `founder_id = auth.uid()` | Owner only |
| saved_opportunities | `founder_id = auth.uid()` | Owner only |
| notifications | `founder_id = auth.uid()` | Owner only |
| audit_logs | `founder_id = auth.uid()` (SELECT only) | Owner read, INSERT all |
| playbook_signals | SELECT authenticated | All founders read, service_role write |
| intelligence_trends | SELECT authenticated | All founders read, service_role write |

---

*Continue to: [LMJuly18-03-Backend.md](./LMJuly18-03-Backend.md)*
