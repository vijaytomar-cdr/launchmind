-- Migration: add unique constraint on campaigns(product_id, channel, market)
-- Required for the upsert in strategyService.generateStrategy() to work correctly.
-- Additive only — no columns dropped or renamed.
-- Idempotent: wrapped in DO block.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_indexes
    WHERE  tablename = 'campaigns'
    AND    indexname = 'campaigns_product_channel_market_unique'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS campaigns_product_channel_market_unique
      ON campaigns (product_id, channel, market);
  END IF;
END
$$;
