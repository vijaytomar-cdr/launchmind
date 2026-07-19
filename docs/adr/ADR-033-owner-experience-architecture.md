# ADR-033: Owner Experience Architecture

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 07 — Owner Experience

---

## Context

LaunchMind has a complete backend foundation (Milestones 01–06): Context Engine, AI Platform, Marketing Memory, Knowledge Graph, Mission Orchestrator. The frontend has 12+ real pages but they are organized around platform modules (Campaigns, Briefs, Channels) rather than founder questions. Founders open a marketing tool and wonder: "What should I do today?"

---

## Decision

### Owner UX is organized around six founder questions

| Question | Screen |
|---|---|
| What happened? | Results, Timeline |
| What should I do? | Morning Brief, Approvals |
| What did LaunchMind prepare? | Approvals, Content |
| Why is this recommended? | Evidence panels everywhere |
| What changed over time? | Timeline |
| What result did we get? | Results |

### Navigation stays fixed from Milestone 01

Do not restructure the sidebar. The approved navigation is:
- **Home:** Brief · Opportunities · Ask · Missions · Approvals · Results
- **Execution:** Content · Campaigns · Experiments · Calendar
- **Intelligence:** Growth Brain · Market · Reviews · Ideas · Timeline
- **Manage:** Settings · Billing

### Internal architecture is never exposed

Agent names, prompt IDs, queue names, and memory store labels must never appear as primary UI text. Acceptable: "LaunchMind suggested this" / "Based on your campaign data". Not acceptable: "Agent: research" / "Prompt: strategy_generation".

### Progressive disclosure is the default

Every screen defaults to the answer (what to do), not the data. Evidence, confidence scores, and source attribution are available via expand/chip/drawer — never the primary view.

### Adapter pattern for missing endpoints

Where backend endpoints don't yet exist, `routes/owner.route.ts` provides adapters that aggregate from existing services. These adapters remain forward-compatible with future Recommendation Engine (Milestone 08) output format.

---

## Consequences

- 8 new frontend pages (brief, opportunities, ask, approvals, results, timeline, ideas, growth-brain)
- 1 backend route file (owner.route.ts) with 10 adapter endpoints
- 1 DB migration (046: notifications + saved_opportunities)
- Zero changes to existing campaigns, missions, billing, products, channels pages
