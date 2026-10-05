-- Durable governed search-demand tournaments use the existing Market
-- Intelligence source/resolution model. They are immutable external evidence,
-- not Marketing Memory and not a permanent opportunity decision.
BEGIN;

ALTER TABLE market_intelligence_source_records
  ADD COLUMN IF NOT EXISTS observation_payload JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE market_intelligence_source_records
  DROP CONSTRAINT IF EXISTS market_intelligence_source_records_source_type_check,
  ADD CONSTRAINT market_intelligence_source_records_source_type_check
    CHECK (source_type IN ('STORE_LISTING', 'SEARCH_DEMAND'));

ALTER TABLE market_intelligence_source_records
  DROP CONSTRAINT IF EXISTS market_intelligence_source_records_source_provider_check,
  ADD CONSTRAINT market_intelligence_source_records_source_provider_check
    CHECK (source_provider IN ('app_store', 'play_store', 'serpapi_google_trends'));

ALTER TABLE market_intelligence_source_records
  DROP CONSTRAINT IF EXISTS market_intelligence_source_records_observation_type_check,
  ADD CONSTRAINT market_intelligence_source_records_observation_type_check
    CHECK (observation_type IN (
      'LISTING_POSITIONING', 'LISTING_RATING', 'LISTING_RATING_COUNT',
      'LISTING_PRICE_TIER', 'LISTING_CATEGORY', 'LISTING_UPDATE_RECENCY',
      'SEARCH_DEMAND_TOURNAMENT'
    ));

CREATE UNIQUE INDEX IF NOT EXISTS mi_resolution_source_product
  ON market_intelligence_resolutions(source_record_id, workspace_id, product_id);

COMMENT ON COLUMN market_intelligence_source_records.observation_payload IS
  'Immutable provider-normalized evidence payload. SEARCH_DEMAND_TOURNAMENT retains complete stage samples, provenance and query/window lineage.';

COMMIT;
