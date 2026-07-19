# ADR-004: Agent Communication — Mission Orchestrator as Sole Broker
Status: Accepted
Date: July 2026

## Context
Current service functions call each other directly. `strategyService` calls `playbookService`. `contentService` calls `replicateClient`, `elevenLabsClient`, `creatomateClient` directly. There is no concept of agents or orchestration — it is a flat call graph.

Architecture Baseline §14 states: "Agents communicate through Mission Orchestrator."

## Decision
Introduce a named agent registry at `backend/src/services/agents/`. Each agent is a module that:
1. Accepts `(context: AIContext, payload: AgentPayload) => Promise<AgentResult>`
2. Never calls another agent directly
3. Communicates its outputs by returning structured results to Mission Orchestrator

Mission Orchestrator (`missionOrchestrator.ts`) coordinates agents based on mission type and current state. It uses BullMQ for async execution and maintains mission state in the `missions` table.

**This does not mean rewriting existing services.** Existing services (`contentService.ts`, `strategyService.ts`) are wrapped as agents — they become the implementation behind `ContentAgent` and `StrategyAgent`. The service functions stay; the agent is a thin routing layer.

## Consequences
- Founders never interact with agents directly (hidden from UI)
- Each agent has a single named responsibility — easier to debug
- Mission Orchestrator can pause, retry, and recover agent steps
- Agents can be upgraded independently
- Initial cost: wrapping 6 existing services as agents
- Not needed until Phase 7 — current direct calls remain valid through Phase 6
