# ADR-011: Workspace Model
Status: Accepted
Date: July 2026

## Context
The existing `workspaces` table has 4 columns: id, founder_id, name, client_name. It is Studio-tier only and supports no roles, no preferences, and no active-product switching. Milestone 02 requires: workspace roles (Owner/Admin/Editor/Viewer), workspace-level preferences, and active product state per founder.

## Options Considered
1. **New workspace schema** — drop old table, create new with full role model
2. **Extend existing table** — add columns to `workspaces`, add `workspace_members` and `workspace_preferences` tables

## Decision
Extend existing. Engineering Contract §3: "Never duplicate database tables."

Changes:
- `workspaces` table: add `workspace_type` (personal|team), `settings` JSONB
- New `workspace_members` table: id, workspace_id, founder_id, role (owner|admin|editor|viewer), invited_email, accepted_at
- New `workspace_preferences` table: id, workspace_id, default_channel, default_market, notification_prefs JSONB
- `founders` table: add `active_workspace_id` and `active_product_id` for active state persistence

**Personal workspace auto-created on founder signup** (via existing auto-create trigger in migration 022 — extend that trigger).

**Tier rules** (Decision Engine — not AI):
- Free/Solo: 1 workspace max, personal only, owner role only
- Builder: 3 workspaces, team support, up to 5 members
- Studio: unlimited workspaces, all roles

## Consequences
- Existing Studio workspace rows remain valid — `workspace_type` defaults to 'personal' (nullable, set on creation)
- `workspace_members` starts empty for all existing workspaces — owner is implicit from `workspaces.founder_id`
- Role enforcement added to all workspace routes — owner always has full access
- Future team invite flow slots into `workspace_members.invited_email` + `accepted_at` pattern
