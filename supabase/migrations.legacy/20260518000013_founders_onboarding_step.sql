-- Additive: adds onboarding_step tracking to founders.
-- Step values: 0=registered, 1=icp_confirmed, 2=strategy_generated,
--              3=channel_connected, 4=brief_received, 5=feedback_submitted
ALTER TABLE founders ADD COLUMN IF NOT EXISTS onboarding_step INTEGER NOT NULL DEFAULT 0;
