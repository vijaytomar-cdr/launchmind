# ADR-036: Opportunities as Growth Backlog

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 07 — Owner Experience

---

## Context

Founders need a place to review and prioritize growth actions. The full Recommendation Engine is Milestone 08. We need the Opportunities UX ready now with manually-seeded opportunities that will be populated by the engine later.

---

## Decision

### Opportunities are stored in `saved_opportunities` table

Not generated on the fly — stored, seeded, and state-tracked. This allows:
- Founders to save or dismiss opportunities
- Missions to be linked back to their source opportunity
- Future Recommendation Engine to INSERT into this table without UI changes

### Opportunity card schema (UI contract)

```typescript
interface Opportunity {
  id:             string;
  type:           string;   // 'aso' | 'competitor' | 'review_risk' | 'budget_shift' | ...
  title:          string;   // "Add Hindi keywords to ASO title"
  description:    string;
  expectedImpact: string;   // "~+12% organic installs"
  confidence:     number;   // 0–1
  effort:         'low' | 'medium' | 'high';
  risk:           'low' | 'medium' | 'high';
  whyNow:         string;   // "Competitor added 3 Hindi keywords this week"
  source:         string;   // "competitor_scrape" | "growth_brain" | "manual"
  evidence:       string[]; // Up to 3 chips
  state:          'active' | 'saved' | 'dismissed' | 'converted';
}
```

### Actions per opportunity

- **Create Mission** — opens Create Mission modal pre-filled with type + title
- **Save** — state → `saved`, kept in backlog
- **Dismiss** — state → `dismissed`, hidden from default view

### Opportunity types seeded in Milestone 07

- ASO keyword opportunity
- Competitor pricing change
- Review sentiment risk
- Campaign budget shift
- India launch opportunity
- Referral opportunity

Future Recommendation Engine will populate with scored, evidence-backed opportunities.

### `GET /owner/opportunities` adapter

Returns `active` + `saved` opportunities ordered by confidence DESC. If table is empty, seeds 3 example opportunities from the product context.

---

## Consequences

- `saved_opportunities` table created in migration 046
- Opportunities UI ready for Recommendation Engine output
- Mission creation from opportunities wires to Mission Orchestrator
- Zero changes to missions or campaigns table
