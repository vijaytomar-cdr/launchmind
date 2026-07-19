# ADR-020 — Knowledge Graph Architecture

**Date:** 2026-07-08
**Status:** Accepted
**Milestone:** 04 — Marketing Memory & Knowledge Graph

---

## Context

The spec requires a Knowledge Graph to represent relationships between marketing entities: Products, Features, Personas, ICPs, Competitors, Campaigns, Creatives, Channels, Reviews, Markets, Goals, Opportunities, and Risks. We need to store these relationships in a way that is queryable, isolatable per tenant, and consistent with our existing Postgres/Supabase stack.

---

## Decision

**Use a Postgres adjacency list stored in `knowledge_nodes` and `knowledge_edges` tables — no separate graph database.**

Architecture:

1. `knowledge_nodes` — represents entities. `node_type` enum covers the 13 entity types. `label` is a human-readable name. `properties` JSONB holds entity-specific fields. `confidence` reflects how well-established this entity is.
2. `knowledge_edges` — directed relationships between nodes. `source_id → target_id` with a `relationship` enum. `weight` (0.0–1.0) represents relationship strength.
3. Graph traversal in this milestone is limited to **direct edges** (depth 1). Recursive traversal (CTE-based) will be added in Milestone 05 when the Context Engine needs multi-hop paths.
4. Nodes and edges are isolated by `founder_id`. Cross-tenant access is prevented by RLS.
5. `UNIQUE(source_id, target_id, relationship)` prevents duplicate edges.
6. Nodes reference the source record via `source_id` + `source_type` (e.g. `source_id = campaign.id`, `source_type = 'campaigns'`). This allows reverse lookup and keeps the graph in sync with the canonical tables.

---

## Entity → Node Type Mapping

| Existing entity | knowledge_nodes node_type |
|---|---|
| products.id | product |
| products.confirmed_icp.painPoints[i] | feature |
| products.confirmed_icp.targetUser | persona |
| products.confirmed_icp (full) | icp |
| products.competitor_set | competitor |
| campaigns.id | campaign |
| content_assets.id | creative |
| campaigns.channel | channel |
| reviews (text review data) | review |
| campaigns.market | market |
| products.founder_context.primaryGoal | goal |
| playbook_signals (positive) | opportunity |
| playbook_signals (risk signals) | risk |

---

## Consequences

- No additional infrastructure required — Supabase Postgres handles the graph.
- Graph queries are SQL `JOIN`s on `knowledge_edges` — performant for depth-1. Deep traversal will need recursive CTEs with depth limiting.
- The graph is built and maintained by the Learning Pipeline (ADR-021), not manually.
- Founders see graph data through plain-English UI (e.g. "WhatsApp targets your Productivity persona") — raw node/edge terminology never shown.
- Duplicate nodes are detected by matching `(founder_id, product_id, node_type, label)` — see ADR-022 for merge strategy.

---

## Rejected Alternatives

- **Neo4j / dedicated graph DB**: Rejected. Adds operational complexity, separate auth, separate backup. Supabase Postgres with indexes handles the scale of LaunchMind's graph (hundreds, not millions of nodes per founder).
- **Storing graph as JSONB adjacency list in one row**: Rejected. Not queryable. Prevents partial updates. Breaks RLS.
- **Materialised view for graph**: Rejected for initial implementation. Can be added as optimisation in Milestone 05 if query latency becomes an issue.
