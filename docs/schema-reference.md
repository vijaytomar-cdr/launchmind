# LaunchMind — Database Schema Reference

**Project:** LaunchMind (Supabase: gseqtbwdenjkwysregpp)
**Generated from:** Live hosted database — all 61 migrations applied
**Tables:** 45

---

## Table of Contents

- [ai_requests](#ai_requests) (17 columns)
- [api_keys](#api_keys) (10 columns)
- [asset_approvals](#asset_approvals) (8 columns)
- [audit_logs](#audit_logs) (9 columns)
- [campaign_approvals](#campaign_approvals) (13 columns)
- [campaign_metrics](#campaign_metrics) (13 columns)
- [campaign_publish_attempts](#campaign_publish_attempts) (15 columns)
- [campaigns](#campaigns) (25 columns)
- [content_assets](#content_assets) (40 columns)
- [content_learnings](#content_learnings) (9 columns)
- [content_versions](#content_versions) (12 columns)
- [decision_rules](#decision_rules) (9 columns)
- [embedding_store](#embedding_store) (8 columns)
- [evidence](#evidence) (9 columns)
- [execution_calendar_events](#execution_calendar_events) (16 columns)
- [experiment_variants](#experiment_variants) (14 columns)
- [experiments](#experiments) (25 columns)
- [founder_feedback](#founder_feedback) (7 columns)
- [founders](#founders) (13 columns)
- [intelligence_trends](#intelligence_trends) (12 columns)
- [knowledge_edges](#knowledge_edges) (8 columns)
- [knowledge_nodes](#knowledge_nodes) (12 columns)
- [learning_events](#learning_events) (13 columns)
- [marketing_memories](#marketing_memories) (15 columns)
- [marketing_memory_versions](#marketing_memory_versions) (10 columns)
- [mission_approvals](#mission_approvals) (11 columns)
- [mission_logs](#mission_logs) (8 columns)
- [mission_steps](#mission_steps) (17 columns)
- [missions](#missions) (23 columns)
- [notifications](#notifications) (11 columns)
- [optimization_insights](#optimization_insights) (14 columns)
- [platform_tokens](#platform_tokens) (11 columns)
- [playbook_signals](#playbook_signals) (12 columns)
- [products](#products) (44 columns)
- [prompts](#prompts) (13 columns)
- [publishing_targets](#publishing_targets) (12 columns)
- [recommendation_feedback](#recommendation_feedback) (6 columns)
- [reports](#reports) (15 columns)
- [saved_opportunities](#saved_opportunities) (24 columns)
- [utm_links](#utm_links) (12 columns)
- [waitlist](#waitlist) (5 columns)
- [weekly_briefs](#weekly_briefs) (12 columns)
- [workspace_members](#workspace_members) (8 columns)
- [workspace_preferences](#workspace_preferences) (8 columns)
- [workspaces](#workspaces) (7 columns)

---

## ai_requests

> **Security:** RLS: founder_id = auth.uid() (SELECT only) | IMMUTABLE

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `founder_id` | `uuid` | NULL |  |
| `product_id` | `uuid` | NULL |  |
| `prompt_id` | `text` | NOT NULL |  |
| `prompt_version` | `integer` | NOT NULL | DEFAULT 1 |
| `model` | `text` | NOT NULL |  |
| `action` | `text` | NOT NULL |  |
| `input_tokens` | `integer` | NULL |  |
| `output_tokens` | `integer` | NULL |  |
| `total_tokens` | `integer` | NULL |  |
| `cost_usd` | `numeric` | NULL |  |
| `latency_ms` | `integer` | NULL |  |
| `retries` | `integer` | NOT NULL | DEFAULT 0 |
| `status` | `text` | NOT NULL | DEFAULT 'success' |
| `error` | `text` | NULL |  |
| `context_sources` | `text[]` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## api_keys

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `founder_id` | `uuid` | NOT NULL |  |
| `name` | `text` | NOT NULL |  |
| `key_hash` | `text` | NOT NULL |  |
| `key_prefix` | `text` | NOT NULL |  |
| `scopes` | `text[]` | NOT NULL | DEFAULT ARRAY['read'] |
| `last_used_at` | `timestamptz` | NULL |  |
| `expires_at` | `timestamptz` | NULL |  |
| `revoked_at` | `timestamptz` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## asset_approvals

> **Security:** RLS: founder_id = auth.uid() | IMMUTABLE — REVOKE UPDATE/DELETE

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `asset_id` | `uuid` | NOT NULL |  |
| `founder_id` | `uuid` | NOT NULL |  |
| `action` | `text` | NOT NULL |  |
| `note` | `text` | NULL |  |
| `version_number` | `integer` | NULL |  |
| `approved_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## audit_logs

> **Security:** RLS: SELECT only (founder_id = auth.uid()) | IMMUTABLE — REVOKE UPDATE/DELETE

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `founder_id` | `uuid` | NULL |  |
| `action` | `text` | NOT NULL |  |
| `resource_type` | `text` | NULL |  |
| `resource_id` | `uuid` | NULL |  |
| `metadata` | `jsonb` | NULL |  |
| `ip_address` | `inet` | NULL |  |
| `user_agent` | `text` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## campaign_approvals

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `campaign_id` | `uuid` | NOT NULL |  |
| `founder_id` | `uuid` | NOT NULL |  |
| `action` | `text` | NOT NULL |  |
| `note` | `text` | NULL |  |
| `scope` | `text` | NULL |  |
| `budget_amount` | `numeric` | NULL |  |
| `budget_currency` | `text` | NULL |  |
| `channel` | `text` | NULL |  |
| `asset_ids` | `uuid[]` | NULL |  |
| `risk_level` | `text` | NULL |  |
| `approved_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## campaign_metrics

> **Security:** RLS: founder_id = auth.uid()

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `campaign_id` | `uuid` | NOT NULL |  |
| `founder_id` | `uuid` | NOT NULL |  |
| `week_start` | `date` | NOT NULL |  |
| `impressions` | `integer` | NULL | DEFAULT 0 |
| `clicks` | `integer` | NULL | DEFAULT 0 |
| `installs` | `integer` | NULL | DEFAULT 0 |
| `cpi` | `numeric` | NULL |  |
| `ctr` | `numeric` | NULL |  |
| `roas` | `numeric` | NULL |  |
| `top_performing_asset` | `text` | NULL |  |
| `raw_platform_data` | `jsonb` | NULL |  |
| `collected_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## campaign_publish_attempts

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `campaign_id` | `uuid` | NOT NULL |  |
| `founder_id` | `uuid` | NOT NULL |  |
| `asset_id` | `uuid` | NULL |  |
| `channel` | `text` | NOT NULL |  |
| `attempt_number` | `integer` | NOT NULL | DEFAULT 1 |
| `status` | `text` | NOT NULL | DEFAULT 'pending' |
| `external_id` | `text` | NULL |  |
| `error_message` | `text` | NULL |  |
| `error_code` | `text` | NULL |  |
| `platform_response` | `jsonb` | NULL |  |
| `started_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `completed_at` | `timestamptz` | NULL |  |
| `next_retry_at` | `timestamptz` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## campaigns

> **Security:** RLS: founder_id = auth.uid() | §1.5: approved_at must be non-null before launch

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `product_id` | `uuid` | NOT NULL |  |
| `founder_id` | `uuid` | NOT NULL |  |
| `channel` | `text` | NOT NULL |  |
| `market` | `text` | NOT NULL |  |
| `status` | `text` | NOT NULL | DEFAULT 'draft' |
| `hook_type` | `text` | NULL |  |
| `copy_text` | `text` | NULL |  |
| `audience_config` | `jsonb` | NULL |  |
| `spend_cap` | `jsonb` | NULL |  |
| `external_campaign_id` | `text` | NULL |  |
| `ai_tokens_consumed` | `integer` | NULL | DEFAULT 0 |
| `approved_at` | `timestamptz` | NULL |  |
| `launched_at` | `timestamptz` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `action` | `text` | NULL |  |
| `type` | `text` | NULL |  |
| `mission_id` | `uuid` | NULL |  |
| `growth_brain_version` | `integer` | NULL | DEFAULT 1 |
| `scheduled_at` | `timestamptz` | NULL |  |
| `cancelled_at` | `timestamptz` | NULL |  |
| `archived_at` | `timestamptz` | NULL |  |
| `failed_at` | `timestamptz` | NULL |  |
| `failure_reason` | `text` | NULL |  |

## content_assets

> **Security:** RLS: founder_id = auth.uid()

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `product_id` | `uuid` | NOT NULL |  |
| `founder_id` | `uuid` | NOT NULL |  |
| `brief_id` | `uuid` | NULL |  |
| `campaign_id` | `uuid` | NULL |  |
| `asset_type` | `text` | NOT NULL |  |
| `channel` | `text` | NOT NULL |  |
| `market` | `text` | NULL |  |
| `language` | `text` | NULL | DEFAULT 'english' |
| `text_content` | `text` | NULL |  |
| `structured_data` | `jsonb` | NULL |  |
| `media_url` | `text` | NULL |  |
| `media_type` | `text` | NULL |  |
| `duration_seconds` | `integer` | NULL |  |
| `thumbnail_url` | `text` | NULL |  |
| `model_used` | `text` | NULL |  |
| `quality_score` | `numeric` | NULL |  |
| `quality_flags` | `jsonb` | NULL |  |
| `generation_week` | `integer` | NULL |  |
| `hook_angle` | `text` | NULL |  |
| `tokens_consumed` | `integer` | NULL | DEFAULT 0 |
| `status` | `text` | NOT NULL | DEFAULT 'pending' |
| `approved_at` | `timestamptz` | NULL |  |
| `auto_approved` | `boolean` | NULL | DEFAULT false |
| `regen_count` | `integer` | NULL | DEFAULT 0 |
| `regen_reasons` | `jsonb` | NULL |  |
| `parent_asset_id` | `uuid` | NULL |  |
| `installs` | `integer` | NULL |  |
| `impressions` | `integer` | NULL |  |
| `cpi` | `numeric` | NULL |  |
| `ctr` | `numeric` | NULL |  |
| `performed_at` | `timestamptz` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `render_started_at` | `timestamptz` | NULL |  |
| `tags` | `text[]` | NULL |  |
| `mission_id` | `uuid` | NULL |  |
| `growth_brain_version` | `integer` | NULL | DEFAULT 1 |
| `archived_at` | `timestamptz` | NULL |  |
| `published_at` | `timestamptz` | NULL |  |

## content_learnings

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `product_id` | `uuid` | NOT NULL |  |
| `founder_id` | `uuid` | NOT NULL |  |
| `channel` | `text` | NOT NULL |  |
| `learning_type` | `text` | NOT NULL |  |
| `insight` | `text` | NOT NULL |  |
| `applies_to` | `text[]` | NULL |  |
| `week_number` | `integer` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## content_versions

> **Security:** RLS: founder_id = auth.uid() | IMMUTABLE — REVOKE UPDATE/DELETE

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `asset_id` | `uuid` | NOT NULL |  |
| `version_number` | `integer` | NOT NULL |  |
| `text_content` | `text` | NULL |  |
| `structured_data` | `jsonb` | NULL |  |
| `media_url` | `text` | NULL |  |
| `prompt_version` | `integer` | NULL |  |
| `growth_brain_version` | `integer` | NULL |  |
| `change_type` | `text` | NOT NULL |  |
| `change_summary` | `text` | NULL |  |
| `changed_by` | `uuid` | NOT NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## decision_rules

> **Security:** RLS: SELECT only (authenticated)

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `rule_name` | `text` | NOT NULL |  |
| `rule_type` | `text` | NOT NULL |  |
| `description` | `text` | NOT NULL |  |
| `config` | `jsonb` | NULL |  |
| `is_active` | `boolean` | NOT NULL | DEFAULT true |
| `version` | `integer` | NOT NULL | DEFAULT 1 |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## embedding_store

> **Security:** RLS: founder_id = auth.uid()

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `founder_id` | `uuid` | NOT NULL |  |
| `product_id` | `uuid` | NULL |  |
| `type` | `text` | NOT NULL |  |
| `content` | `text` | NOT NULL |  |
| `embedding` | `vector` | NULL |  |
| `metadata` | `jsonb` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## evidence

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `founder_id` | `uuid` | NOT NULL |  |
| `product_id` | `uuid` | NULL |  |
| `evidence_type` | `text` | NOT NULL |  |
| `source_id` | `text` | NULL |  |
| `source_table` | `text` | NULL |  |
| `data` | `jsonb` | NOT NULL | DEFAULT '{}' |
| `confidence_boost` | `numeric` | NOT NULL | DEFAULT 0.00 |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## execution_calendar_events

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `founder_id` | `uuid` | NOT NULL |  |
| `product_id` | `uuid` | NULL |  |
| `campaign_id` | `uuid` | NULL |  |
| `experiment_id` | `uuid` | NULL |  |
| `type` | `text` | NOT NULL |  |
| `title` | `text` | NOT NULL |  |
| `description` | `text` | NULL |  |
| `start_date` | `timestamptz` | NOT NULL |  |
| `end_date` | `timestamptz` | NULL |  |
| `all_day` | `boolean` | NOT NULL | DEFAULT false |
| `timezone` | `text` | NOT NULL | DEFAULT 'UTC' |
| `status` | `text` | NOT NULL | DEFAULT 'scheduled' |
| `metadata` | `jsonb` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## experiment_variants

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `experiment_id` | `uuid` | NOT NULL |  |
| `founder_id` | `uuid` | NOT NULL |  |
| `variant` | `text` | NOT NULL |  |
| `asset_id` | `uuid` | NULL |  |
| `label` | `text` | NULL |  |
| `description` | `text` | NULL |  |
| `config` | `jsonb` | NULL |  |
| `impressions` | `integer` | NULL | DEFAULT 0 |
| `clicks` | `integer` | NULL | DEFAULT 0 |
| `conversions` | `integer` | NULL | DEFAULT 0 |
| `metric_value` | `numeric` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## experiments

> **Security:** RLS: founder_id = auth.uid()

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `product_id` | `uuid` | NOT NULL |  |
| `founder_id` | `uuid` | NOT NULL |  |
| `campaign_id` | `uuid` | NULL |  |
| `mission_id` | `uuid` | NULL |  |
| `title` | `text` | NOT NULL |  |
| `hypothesis` | `text` | NOT NULL |  |
| `experiment_type` | `text` | NOT NULL |  |
| `goal` | `text` | NOT NULL |  |
| `metric` | `text` | NOT NULL |  |
| `status` | `text` | NOT NULL | DEFAULT 'draft' |
| `market` | `text` | NULL |  |
| `start_date` | `date` | NULL |  |
| `end_date` | `date` | NULL |  |
| `expected_outcome` | `text` | NULL |  |
| `confidence` | `numeric` | NULL |  |
| `winner` | `text` | NULL |  |
| `winner_confidence` | `numeric` | NULL |  |
| `learning` | `text` | NULL |  |
| `learning_summary` | `text` | NULL |  |
| `growth_brain_version` | `integer` | NULL | DEFAULT 1 |
| `memory_id` | `uuid` | NULL |  |
| `archived_at` | `timestamptz` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## founder_feedback

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `founder_id` | `uuid` | NOT NULL |  |
| `product_id` | `uuid` | NULL |  |
| `rating` | `integer` | NOT NULL |  |
| `body` | `text` | NULL |  |
| `context` | `text` | NOT NULL | DEFAULT 'general' |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## founders

> **Security:** RLS: id = auth.uid()

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `email` | `text` | NOT NULL |  |
| `name` | `text` | NULL |  |
| `plan` | `text` | NOT NULL | DEFAULT 'free' |
| `mfa_enabled` | `boolean` | NOT NULL | DEFAULT false |
| `token_balance` | `integer` | NULL |  |
| `deleted_at` | `timestamptz` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `onboarding_step` | `integer` | NOT NULL | DEFAULT 0 |
| `voice_clone_id` | `text` | NULL |  |
| `active_workspace_id` | `uuid` | NULL |  |
| `active_product_id` | `uuid` | NULL |  |

## intelligence_trends

> **Security:** ANONYMIZED — no founder_id | authenticated: SELECT only

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `category` | `text` | NOT NULL |  |
| `market` | `text` | NOT NULL |  |
| `channel` | `text` | NULL |  |
| `trend_type` | `text` | NOT NULL |  |
| `direction` | `text` | NOT NULL |  |
| `magnitude` | `numeric` | NULL |  |
| `period_days` | `integer` | NOT NULL | DEFAULT 30 |
| `signal_count` | `integer` | NOT NULL | DEFAULT 0 |
| `summary` | `text` | NULL |  |
| `benchmark_data` | `jsonb` | NULL |  |
| `computed_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## knowledge_edges

> **Security:** RLS: founder_id = auth.uid()

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `founder_id` | `uuid` | NOT NULL |  |
| `source_id` | `uuid` | NOT NULL |  |
| `target_id` | `uuid` | NOT NULL |  |
| `relationship` | `text` | NOT NULL |  |
| `weight` | `numeric` | NOT NULL | DEFAULT 0.50 |
| `properties` | `jsonb` | NOT NULL | DEFAULT '{}' |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## knowledge_nodes

> **Security:** RLS: founder_id = auth.uid()

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `founder_id` | `uuid` | NOT NULL |  |
| `product_id` | `uuid` | NULL |  |
| `node_type` | `text` | NOT NULL |  |
| `label` | `text` | NOT NULL |  |
| `properties` | `jsonb` | NOT NULL | DEFAULT '{}' |
| `source_id` | `text` | NULL |  |
| `source_type` | `text` | NULL |  |
| `confidence` | `numeric` | NOT NULL | DEFAULT 0.50 |
| `embedding` | `vector` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## learning_events

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `founder_id` | `uuid` | NOT NULL |  |
| `product_id` | `uuid` | NULL |  |
| `event_type` | `text` | NOT NULL |  |
| `payload` | `jsonb` | NOT NULL | DEFAULT '{}' |
| `memories_created` | `integer` | NOT NULL | DEFAULT 0 |
| `memories_updated` | `integer` | NOT NULL | DEFAULT 0 |
| `nodes_created` | `integer` | NOT NULL | DEFAULT 0 |
| `edges_created` | `integer` | NOT NULL | DEFAULT 0 |
| `status` | `text` | NOT NULL | DEFAULT 'pending' |
| `error` | `text` | NULL |  |
| `processed_at` | `timestamptz` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## marketing_memories

> **Security:** RLS: founder_id = auth.uid() | append-only versioned

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `founder_id` | `uuid` | NOT NULL |  |
| `product_id` | `uuid` | NULL |  |
| `memory_type` | `text` | NOT NULL |  |
| `title` | `text` | NOT NULL |  |
| `content` | `jsonb` | NOT NULL | DEFAULT '{}' |
| `source` | `text` | NOT NULL |  |
| `confidence` | `numeric` | NOT NULL | DEFAULT 0.50 |
| `evidence_ids` | `uuid[]` | NOT NULL | DEFAULT '{}'[] |
| `status` | `text` | NOT NULL | DEFAULT 'active' |
| `version` | `integer` | NOT NULL | DEFAULT 1 |
| `embedding` | `vector` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `archived_at` | `timestamptz` | NULL |  |

## marketing_memory_versions

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `memory_id` | `uuid` | NOT NULL |  |
| `founder_id` | `uuid` | NOT NULL |  |
| `version` | `integer` | NOT NULL |  |
| `content` | `jsonb` | NOT NULL | DEFAULT '{}' |
| `source` | `text` | NOT NULL |  |
| `confidence` | `numeric` | NOT NULL | DEFAULT 0.50 |
| `changed_by` | `text` | NOT NULL |  |
| `change_note` | `text` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## mission_approvals

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `mission_id` | `uuid` | NOT NULL |  |
| `step_id` | `uuid` | NOT NULL |  |
| `founder_id` | `uuid` | NOT NULL |  |
| `status` | `text` | NOT NULL | DEFAULT 'pending' |
| `title` | `text` | NOT NULL |  |
| `description` | `text` | NULL |  |
| `preview_data` | `jsonb` | NULL |  |
| `requested_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `responded_at` | `timestamptz` | NULL |  |
| `response_note` | `text` | NULL |  |

## mission_logs

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `mission_id` | `uuid` | NOT NULL |  |
| `founder_id` | `uuid` | NOT NULL |  |
| `step_id` | `uuid` | NULL |  |
| `level` | `text` | NOT NULL | DEFAULT 'info' |
| `message` | `text` | NOT NULL |  |
| `metadata` | `jsonb` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## mission_steps

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `mission_id` | `uuid` | NOT NULL |  |
| `founder_id` | `uuid` | NOT NULL |  |
| `step_order` | `integer` | NOT NULL |  |
| `step_name` | `text` | NOT NULL |  |
| `agent_type` | `text` | NOT NULL |  |
| `status` | `text` | NOT NULL | DEFAULT 'pending' |
| `requires_approval` | `boolean` | NOT NULL | DEFAULT false |
| `input` | `jsonb` | NULL |  |
| `output` | `jsonb` | NULL |  |
| `error` | `text` | NULL |  |
| `retry_count` | `integer` | NOT NULL | DEFAULT 0 |
| `max_retries` | `integer` | NOT NULL | DEFAULT 2 |
| `ai_request_id` | `uuid` | NULL |  |
| `started_at` | `timestamptz` | NULL |  |
| `completed_at` | `timestamptz` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## missions

> **Security:** RLS: founder_id = auth.uid()

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `founder_id` | `uuid` | NOT NULL |  |
| `product_id` | `uuid` | NULL |  |
| `workspace_id` | `uuid` | NULL |  |
| `type` | `text` | NOT NULL |  |
| `title` | `text` | NOT NULL |  |
| `status` | `text` | NOT NULL | DEFAULT 'draft' |
| `priority` | `integer` | NOT NULL | DEFAULT 25 |
| `trigger_type` | `text` | NOT NULL | DEFAULT 'manual' |
| `input` | `jsonb` | NULL |  |
| `output` | `jsonb` | NULL |  |
| `error` | `text` | NULL |  |
| `idempotency_key` | `text` | NULL |  |
| `scheduled_at` | `timestamptz` | NULL |  |
| `started_at` | `timestamptz` | NULL |  |
| `completed_at` | `timestamptz` | NULL |  |
| `failed_at` | `timestamptz` | NULL |  |
| `cancelled_at` | `timestamptz` | NULL |  |
| `retry_count` | `integer` | NOT NULL | DEFAULT 0 |
| `max_retries` | `integer` | NOT NULL | DEFAULT 3 |
| `ai_tokens_consumed` | `integer` | NULL | DEFAULT 0 |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## notifications

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `founder_id` | `uuid` | NOT NULL |  |
| `type` | `text` | NOT NULL |  |
| `title` | `text` | NOT NULL |  |
| `message` | `text` | NULL |  |
| `action_url` | `text` | NULL |  |
| `action_label` | `text` | NULL |  |
| `resource_type` | `text` | NULL |  |
| `resource_id` | `uuid` | NULL |  |
| `is_read` | `boolean` | NOT NULL | DEFAULT false |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## optimization_insights

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `founder_id` | `uuid` | NOT NULL |  |
| `product_id` | `uuid` | NOT NULL |  |
| `insight_type` | `text` | NOT NULL |  |
| `title` | `text` | NOT NULL |  |
| `description` | `text` | NOT NULL |  |
| `impact_estimate` | `text` | NULL |  |
| `action_taken` | `text` | NULL |  |
| `source_metrics` | `jsonb` | NULL |  |
| `confidence` | `numeric` | NULL | DEFAULT 0.70 |
| `status` | `text` | NOT NULL | DEFAULT 'pending' |
| `expires_at` | `timestamptz` | NULL |  |
| `applied_at` | `timestamptz` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## platform_tokens

> **Security:** RLS: founder_id = auth.uid() | NEVER return encrypted_token to frontend

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `founder_id` | `uuid` | NOT NULL |  |
| `platform` | `text` | NOT NULL |  |
| `encrypted_token` | `text` | NOT NULL |  |
| `kms_key_id` | `text` | NOT NULL |  |
| `scopes` | `text[]` | NOT NULL |  |
| `expires_at` | `timestamptz` | NULL |  |
| `revoked_at` | `timestamptz` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `integration_type` | `text` | NULL |  |
| `integration_config` | `jsonb` | NULL |  |

## playbook_signals

> **Security:** ANONYMIZED — no founder_id/product_id | authenticated: SELECT only

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `category` | `text` | NOT NULL |  |
| `market` | `text` | NOT NULL |  |
| `channel` | `text` | NOT NULL |  |
| `hook_type` | `text` | NULL |  |
| `price_tier` | `text` | NULL |  |
| `install_delta_pct` | `numeric` | NULL |  |
| `conversion_rate` | `numeric` | NULL |  |
| `retention_d7` | `numeric` | NULL |  |
| `week_number` | `integer` | NULL |  |
| `signal_embedding` | `vector` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## products

> **Security:** RLS: founder_id = auth.uid()

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `founder_id` | `uuid` | NOT NULL |  |
| `name` | `text` | NOT NULL |  |
| `store_url` | `text` | NULL |  |
| `platform` | `text` | NULL |  |
| `category` | `text` | NULL |  |
| `markets` | `text[]` | NULL | DEFAULT ARRAY['usa'] |
| `price_tier` | `text` | NULL |  |
| `confirmed_icp` | `jsonb` | NULL |  |
| `competitor_set` | `jsonb` | NULL |  |
| `scraped_meta` | `jsonb` | NULL |  |
| `brand_voice_profile` | `jsonb` | NULL |  |
| `last_scraped_at` | `timestamptz` | NULL |  |
| `icp_embedding` | `vector` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `workspace_id` | `uuid` | NULL |  |
| `app_store_url` | `text` | NULL |  |
| `play_store_url` | `text` | NULL |  |
| `website_url` | `text` | NULL |  |
| `founder_context` | `jsonb` | NULL |  |
| `website_meta` | `jsonb` | NULL |  |
| `screenshot_analysis` | `jsonb` | NULL |  |
| `intake_step` | `integer` | NULL | DEFAULT 0 |
| `intake_completed_at` | `timestamptz` | NULL |  |
| `selected_markets` | `text[]` | NULL | DEFAULT ARRAY['india', 'usa'] |
| `primary_channel` | `text` | NULL |  |
| `excluded_channels` | `text[]` | NULL |  |
| `content_preferences` | `jsonb` | NULL | DEFAULT '{"text": {"email": true, "adCopy": true, "linkedin": true, "whatsappBroadcast": true}, "video": {"reels30s": false, "shorts60s": false, "appStorePreview": false, "whatsappVoiceNote": false}, "visual": {"carouselBrief": false, "metaImageBrief": false}, "community": {"twitterThread": false, "indieHackersPost": false, "facebookGroupPost": false, "whatsappGroupPost": false}, "socialProof": {"caseStudy": true, "testimonialBrief": false, "reviewResponseTemplates": true}}' |
| `voice_clone_id` | `text` | NULL |  |
| `approval_mode` | `text` | NOT NULL | DEFAULT 'manual' |
| `approval_weeks_count` | `integer` | NULL | DEFAULT 0 |
| `archived_at` | `timestamptz` | NULL |  |
| `archive_reason` | `text` | NULL |  |
| `full_strategy` | `jsonb` | NULL |  |
| `stage` | `text` | NULL |  |
| `primary_language` | `text` | NULL |  |
| `country` | `text` | NULL |  |
| `revenue_model` | `text` | NULL |  |
| `monthly_budget` | `integer` | NULL |  |
| `brand_values` | `text[]` | NULL |  |
| `color_preferences` | `jsonb` | NULL |  |
| `intake_v3_step` | `integer` | NOT NULL | DEFAULT 0 |
| `intake_v3_complete_at` | `timestamptz` | NULL |  |

## prompts

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `prompt_id` | `text` | NOT NULL |  |
| `version` | `integer` | NOT NULL | DEFAULT 1 |
| `purpose` | `text` | NOT NULL |  |
| `owner` | `text` | NOT NULL | DEFAULT 'system' |
| `model` | `text` | NOT NULL |  |
| `system_template` | `text` | NULL |  |
| `user_template` | `text` | NOT NULL | DEFAULT '' |
| `input_schema` | `jsonb` | NULL |  |
| `output_schema` | `jsonb` | NULL |  |
| `status` | `text` | NOT NULL | DEFAULT 'active' |
| `token_cost` | `integer` | NOT NULL | DEFAULT 0 |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## publishing_targets

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `asset_id` | `uuid` | NOT NULL |  |
| `founder_id` | `uuid` | NOT NULL |  |
| `channel` | `text` | NOT NULL |  |
| `platform_url` | `text` | NULL |  |
| `external_id` | `text` | NULL |  |
| `published_by` | `uuid` | NOT NULL |  |
| `published_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `status` | `text` | NOT NULL | DEFAULT 'live' |
| `error_message` | `text` | NULL |  |
| `metadata` | `jsonb` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## recommendation_feedback

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `recommendation_id` | `uuid` | NOT NULL |  |
| `founder_id` | `uuid` | NOT NULL |  |
| `feedback_type` | `text` | NOT NULL |  |
| `note` | `text` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## reports

> **Security:** RLS: founder_id = auth.uid()

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `founder_id` | `uuid` | NOT NULL |  |
| `product_id` | `uuid` | NULL |  |
| `report_type` | `text` | NOT NULL |  |
| `period_start` | `date` | NOT NULL |  |
| `period_end` | `date` | NOT NULL |  |
| `title` | `text` | NOT NULL |  |
| `summary` | `text` | NULL |  |
| `content` | `jsonb` | NOT NULL | DEFAULT '{}' |
| `metrics_snapshot` | `jsonb` | NULL |  |
| `ai_tokens_consumed` | `integer` | NULL | DEFAULT 0 |
| `export_count` | `integer` | NULL | DEFAULT 0 |
| `status` | `text` | NOT NULL | DEFAULT 'draft' |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## saved_opportunities

> **Security:** RLS: founder_id = auth.uid()

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `founder_id` | `uuid` | NOT NULL |  |
| `product_id` | `uuid` | NULL |  |
| `type` | `text` | NOT NULL |  |
| `title` | `text` | NOT NULL |  |
| `description` | `text` | NULL |  |
| `expected_impact` | `text` | NULL |  |
| `confidence` | `numeric` | NULL |  |
| `effort` | `text` | NOT NULL | DEFAULT 'medium' |
| `risk` | `text` | NOT NULL | DEFAULT 'low' |
| `why_now` | `text` | NULL |  |
| `source` | `text` | NULL |  |
| `evidence` | `jsonb` | NULL |  |
| `state` | `text` | NOT NULL | DEFAULT 'active' |
| `mission_id` | `uuid` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `recommendation_type` | `text` | NULL |  |
| `score` | `numeric` | NULL |  |
| `priority` | `integer` | NULL | DEFAULT 50 |
| `source_signals` | `jsonb` | NULL |  |
| `expires_at` | `timestamptz` | NULL |  |
| `related_mission_id` | `uuid` | NULL |  |
| `feedback_summary` | `jsonb` | NULL |  |

## utm_links

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `campaign_id` | `uuid` | NOT NULL |  |
| `founder_id` | `uuid` | NOT NULL |  |
| `base_url` | `text` | NOT NULL |  |
| `utm_source` | `text` | NOT NULL |  |
| `utm_medium` | `text` | NOT NULL |  |
| `utm_campaign` | `text` | NOT NULL |  |
| `utm_content` | `text` | NULL |  |
| `utm_term` | `text` | NULL |  |
| `short_code` | `text` | NOT NULL |  |
| `click_count` | `integer` | NOT NULL | DEFAULT 0 |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## waitlist

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `email` | `text` | NOT NULL |  |
| `name` | `text` | NULL |  |
| `source` | `text` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## weekly_briefs

> **Security:** RLS: founder_id = auth.uid()

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `product_id` | `uuid` | NOT NULL |  |
| `founder_id` | `uuid` | NOT NULL |  |
| `week_of` | `date` | NOT NULL |  |
| `what_worked` | `text` | NULL |  |
| `what_to_kill` | `text` | NULL |  |
| `next_actions` | `jsonb` | NULL |  |
| `generated_assets` | `jsonb` | NULL |  |
| `ai_tokens_consumed` | `integer` | NULL | DEFAULT 0 |
| `status` | `text` | NOT NULL | DEFAULT 'draft' |
| `sent_at` | `timestamptz` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## workspace_members

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `workspace_id` | `uuid` | NOT NULL |  |
| `founder_id` | `uuid` | NULL |  |
| `role` | `text` | NOT NULL | DEFAULT 'viewer' |
| `invited_email` | `text` | NULL |  |
| `accepted_at` | `timestamptz` | NULL |  |
| `invited_by` | `uuid` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## workspace_preferences

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `workspace_id` | `uuid` | NOT NULL |  |
| `default_channel` | `text` | NULL |  |
| `default_market` | `text` | NULL |  |
| `notification_prefs` | `jsonb` | NULL |  |
| `ui_prefs` | `jsonb` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `updated_at` | `timestamptz` | NOT NULL | DEFAULT now() |

## workspaces

> **Security:** RLS: founder_id = auth.uid()

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | DEFAULT gen_random_uuid() |
| `founder_id` | `uuid` | NOT NULL |  |
| `name` | `text` | NOT NULL |  |
| `client_name` | `text` | NULL |  |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |
| `workspace_type` | `text` | NOT NULL | DEFAULT 'personal' |
| `settings` | `jsonb` | NULL |  |
