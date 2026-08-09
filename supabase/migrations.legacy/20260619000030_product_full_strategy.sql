-- Migration 030: add full_strategy JSONB to products
-- Stores the Claude-generated 30/60/90 strategy so the strategy page can re-fetch it
-- after the confirm → navigate flow without re-generating (saving tokens).
-- Additive only — existing rows get NULL (no strategy generated yet).

ALTER TABLE products ADD COLUMN IF NOT EXISTS full_strategy JSONB;
