# ADR-044: Experiment Framework

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 09

---

## Context

Founders need to run A/B experiments on content, copy, channel, and creative — with data-driven winner selection that feeds back into Growth Brain and Marketing Memory.

---

## Decision

### Two-Table Design

**`experiments`** — one row per experiment, stores hypothesis, goal, metric, status, winner, learning.

**`experiment_variants`** — two rows per experiment (variant 'a' and 'b'), each linking to one content asset, tracking impressions, conversions, and metric value.

### Lifecycle

```
draft → ready → running → waiting_for_data → completed
                                           → inconclusive
```

`POST /experiments/:id/winner` marks the winner, stores the learning, and triggers:
1. Ingest learning event → `learningPipelineService.ingestLearningEvent('experiment_result', ...)`
2. Marketing Memory: create memory of type 'learning_log' with the experiment result
3. Timeline event: ExperimentCompleted

### Experiment Types (Structural)

Experiments are typed by what's being varied:
- `copy` — headline or body text
- `creative` — image or video
- `channel` — distribution channel (e.g. WhatsApp vs Email)
- `aso` — App Store screenshot order or description
- `audience` — targeting config

Type stored in `experiments.experiment_type`.

### Metrics

`experiments.metric` stores the primary metric name (e.g. `install_rate`, `click_rate`, `open_rate`). Actual measurement is done by the founder who inputs final values via `PUT /experiments/:id/variants/:variantId/results`.

---

## Consequences

- Experiments are not automatically run via platform APIs (Milestone 09 scope)
- Winner selection is founder-triggered (not automated) — prevents false positives
- Learning is always stored regardless of outcome (inconclusive is still valuable)
- Experiments can be linked to campaigns via `experiments.campaign_id`
