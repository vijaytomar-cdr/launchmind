-- Add action column to campaigns for retargeting recommendations
-- Values: 'pause_recommendation' | 'scale_recommendation' | NULL (normal campaign)
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS action TEXT;
