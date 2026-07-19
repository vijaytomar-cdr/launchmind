# ADR-005: Knowledge Graph — pgvector Relationships vs. Dedicated Graph DB
Status: Accepted
Date: July 2026

## Context
Architecture Baseline §12 requires a Knowledge Graph with entities and relationships. Options considered:

1. **Dedicated graph database** (Neo4j, ArangoDB) — optimal for graph traversal, complex relationship queries
2. **pgvector + Postgres tables** — `kg_entities` + `kg_relationships` tables in existing Supabase DB

## Decision
Use Postgres with `kg_entities` + `kg_relationships` tables. Reasons:

1. **No new infrastructure** — stays in Supabase, RLS applies automatically, existing supabaseAdmin client works
2. **Relationship queries at this scale** (100s of entities per product, not millions) are fast in Postgres
3. **Vector similarity** for entity matching (`embedding <-> query_embedding`) is already available via pgvector
4. **Engineering contract** §6 says "Never duplicate services" — adding a graph DB duplicates storage infrastructure
5. Migrating to a dedicated graph DB later is tractable — the data model is clean

The `kg_relationships.relationship` field stores relationship type as text (e.g. `solves`, `competes_with`, `targets`, `performed_on`). Traversal is done via recursive CTEs when needed.

## Consequences
- No new infrastructure to operate
- Limited to Postgres join performance for graph traversal (acceptable at product scale)
- Cannot do multi-hop graph traversal as efficiently as Neo4j
- Semantic entity lookup via embedding is fast
- Deferred to Phase 8 — not needed until Agent Platform
