-- Migration 078: intelligence_signals_dedup
-- Adds a partial unique index on intelligence_signals to prevent duplicate rows
-- when a sync job is replayed or retried. Two rows are considered duplicates when
-- they share the same (founder_id, provider, signal_type, period_start, period_end).
-- Rows where period_start IS NULL are not deduped (ad-hoc signals without a period).
-- The index is PARTIAL (WHERE period_start IS NOT NULL) so it never conflicts with
-- signals that do not carry a time-range.
--
-- With this index in place, the service layer can use
--   INSERT INTO intelligence_signals (...) ON CONFLICT DO NOTHING
-- to make sync jobs idempotent.

CREATE UNIQUE INDEX IF NOT EXISTS intelligence_signals_dedup
  ON intelligence_signals (founder_id, provider, signal_type, period_start, period_end)
  WHERE period_start IS NOT NULL;
