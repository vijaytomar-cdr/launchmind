-- Migration 043: Seed Prompt Registry
-- Seeds all known prompts used by the AI Platform (M05).
-- user_template is a skeleton; services build the full dynamic prompt at runtime.
-- This migration is idempotent (INSERT ... ON CONFLICT DO NOTHING).

INSERT INTO prompts (prompt_id, version, purpose, owner, model, system_template, user_template, token_cost, status)
VALUES
  (
    'strategy_generation', 1,
    'Generate 30/60/90-day marketing strategy with channel mix, budget tiers, and USP/India market recommendations',
    'system', 'sonnet',
    'You are a fractional CMO with deep expertise in mobile app marketing for both the USA and India markets. Return ONLY valid JSON — no markdown, no explanation, no code blocks.',
    'Generate a 30/60/90-day marketing strategy for app: {{appName}}, category: {{category}}, ICP: {{icp}}, playbook: {{playbookContext}}',
    50, 'active'
  ),
  (
    'content_assets', 1,
    'Generate channel-specific content assets (WhatsApp, Meta, Google, LinkedIn, Email) for a product',
    'system', 'sonnet',
    'You are a world-class mobile app copywriter. Write pain-first, outcome-focused copy. Return ONLY valid JSON — no markdown, no explanation.',
    'Write {{channel}} copy for: {{appName}}, pain points: {{painPoints}}, market: {{market}}',
    20, 'active'
  ),
  (
    'content_generation', 1,
    'Full content OS pipeline — generates all 9 asset types from product context',
    'system', 'sonnet',
    NULL,
    'Generate all content assets for product: {{productName}}, channel: {{channel}}, market: {{market}}, ICP: {{icp}}',
    30, 'active'
  ),
  (
    'weekly_brief', 1,
    'Weekly performance brief — what worked, what to kill, next actions',
    'system', 'haiku',
    'You are a concise performance marketing analyst. Return ONLY valid JSON — no markdown, no explanation.',
    'Analyse weekly campaign performance for {{productName}}: top performers: {{topPerformers}}, bottom performers: {{bottomPerformers}}',
    20, 'active'
  ),
  (
    'brand_voice_extract', 1,
    'Extract brand voice profile (tone, adjectives, avoid words) from app reviews',
    'system', 'haiku',
    NULL,
    'Analyse brand voice of "{{appName}}" from reviews: {{reviewText}}. Return JSON: {tone, adjectives, avoidWords, exampleCopy}',
    10, 'active'
  ),
  (
    'brand_voice_apply', 1,
    'Rewrite copy to match a given brand voice profile',
    'system', 'haiku',
    NULL,
    'Rewrite copy to match brand voice: tone={{tone}}, adjectives={{adjectives}}. Original: "{{copy}}"',
    5, 'active'
  ),
  (
    'icp_structure', 1,
    'Structure raw ICP data into a normalized ICPBrief from app metadata and founder context',
    'system', 'haiku',
    NULL,
    'Structure ICP for {{appName}}: metadata={{metadata}}, founderContext={{founderContext}}',
    10, 'active'
  ),
  (
    'review_analysis', 1,
    'Analyse app store reviews for pain points, copy signals, and marketing opportunities',
    'system', 'haiku',
    'You are a mobile app marketing analyst. Return ONLY valid JSON matching schema.',
    'Analyse these app store reviews: {{reviewText}}',
    15, 'active'
  ),
  (
    'content_score', 1,
    'Score generated content assets for quality and alignment with brand voice',
    'system', 'haiku',
    NULL,
    'Score these content assets for quality (1-10): {{assets}}. Return JSON: {scores: [{id, score, reason}]}',
    5, 'active'
  ),
  (
    'char_limit_rewrite', 1,
    'Rewrite copy to fit within character limits while preserving the pain-first message',
    'system', 'haiku',
    NULL,
    'Rewrite to fit {{maxChars}} chars: "{{copy}}". Keep pain-first message. Return only the rewritten text.',
    5, 'active'
  ),
  (
    'screenshot_analysis', 1,
    'Analyse app screenshots for UI/UX tone, primary color, and messaging summary',
    'system', 'haiku',
    NULL,
    'Analyse these app screenshots. Return JSON: {summary, tone, primaryColor, screenshots_analysed}',
    0, 'active'
  )
ON CONFLICT (prompt_id, version) DO NOTHING;
