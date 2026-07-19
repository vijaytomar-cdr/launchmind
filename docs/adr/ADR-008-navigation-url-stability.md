# ADR-008: Navigation Refactor — URL Stability During Migration
Status: Accepted
Date: July 2026

## Context
Milestone 01 introduces a new navigation structure (Architecture Baseline §6). Old URLs like `/dashboard/briefs`, `/dashboard/insights`, `/dashboard/workspaces` must not break — founders may have bookmarks, and Google may index them.

## Decision
**Old routes are not deleted — they become redirects.**

| Old URL | New URL | Action |
|---|---|---|
| `/dashboard/briefs` | `/dashboard/content` | `redirect()` |
| `/dashboard/insights` | `/dashboard/results` | `redirect()` |
| `/dashboard/workspaces` | `/dashboard/settings` | `redirect()` |
| `/dashboard` | `/dashboard` | No change — becomes new Home |

New routes are added as stub pages immediately in Milestone 01. Full feature content is added in Phases 6–9 as backend services are built.

The new sidebar navigation links to new URLs from day 1. Old bookmarked URLs still work via server-side redirects in `next.config.js`.

## Consequences
- No broken links for existing users
- New navigation is live immediately
- Redirect file (`next.config.js` redirects array) becomes the migration audit trail
- Removes need for parallel URL maintenance
