# ADR-037: Progressive Disclosure UX

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 07 — Owner Experience

---

## Context

Every AI-generated recommendation, opportunity, content asset, and campaign needs explainability. But showing all evidence upfront creates cognitive overload. Founders should be able to trust first, verify if they want.

---

## Decision

### Three disclosure levels

**Level 1 — Default view (always visible)**
- What to do (recommendation title / opportunity title / asset headline)
- Why in one sentence
- Confidence (pill/badge)

**Level 2 — Expand (on click/tap)**
- Evidence chips (max 3)
- Risk level
- Source attribution
- Expected impact

**Level 3 — Deep link (deliberate navigation)**
- Full context package
- AI request audit trail
- Memory/knowledge graph link

### Confidence display standard

```
≥ 80%  → green (sage) chip: "High confidence"
60–79% → amber chip: "Medium confidence"  
< 60%  → ink3 chip: "Exploratory"
```

Never show raw 0.73 — round to "73%" and pair with the label.

### Evidence chip standard

Max 3 per item. Format: `[icon] Source text`. Examples:
- `📊 3 campaigns at < $1.20 CPI`
- `⭐ Review sentiment +12% this week`
- `🌍 India competitor added Hindi keywords`

Chips are non-interactive in default view. Clicking shows full evidence in a drawer.

### AI thinking states

When AI is generating (brief recommendation, ask response), show:
- Animated pulse ring on the LaunchMind logo
- "Thinking…" in sage color
- No fake progress bar — only real state-driven updates

### Accessibility

Progressive disclosure uses:
- `aria-expanded` on expandable sections
- `role="button"` + `tabIndex={0}` on interactive non-button elements
- Focus trap in modals/drawers
- Visible focus ring (2px sage, 2px offset)

---

## Consequences

- No component dumps all data on load
- Evidence is always available but never mandatory to read
- Confidence scores require the standard badge format
- AI thinking is surfaced honestly — no fake spinners
