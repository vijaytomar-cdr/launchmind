# ADR-002: Growth Brain Versioning — Immutable Rows + is_current Flag
Status: Accepted
Date: July 2026

## Context
The current `products.confirmed_icp` (JSONB) and `products.brand_voice_profile` (JSONB) store the latest ICP without history. When a founder updates their strategy, the previous version is lost. There is no way to trace why a campaign worked or failed to a specific strategic position.

Architecture Baseline §10 states Growth Brain must store "Historical versions, Confidence scores, Evidence, Timeline."

## Decision
Create a `growth_brain` table with one row per version. The current version is marked with `is_current = true`. A partial unique index `CREATE UNIQUE INDEX growth_brain_current ON growth_brain(product_id) WHERE is_current = true` ensures only one current version exists per product.

When the strategy is updated:
1. Set `is_current = false` on the existing current row
2. INSERT a new row with `is_current = true` and `version = prev + 1`

The `products` table keeps `confirmed_icp` and `brand_voice_profile` for backward compatibility. On product confirm, the system also creates the first `growth_brain` row.

## Consequences
- Complete strategy history preserved forever
- Every content asset can reference the `growth_brain_version_id` it was generated with
- Growth Brain becomes auditable — "why did we run this campaign?" has an answer
- Slightly more complex queries (always filter `is_current = true`)
- Additive: existing products work without a `growth_brain` row until their next confirm
