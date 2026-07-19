# LMJuly18 — LaunchMind Complete Technical Reference
## Master Index

**Date:** July 18, 2026  
**Project:** LaunchMind — AI Marketing Operating System for App Founders  
**Status:** 12 Milestones Complete · Production-Ready · Pending Ops Tasks  
**Supabase Project:** `gseqtbwdenjkwysregpp`

---

## How to Use This Reference

This documentation is split into 6 focused files. Read them in order for a full understanding, or jump directly to the relevant section.

| File | Contents | Best for |
|------|----------|----------|
| [LMJuly18-01-Overview-Architecture.md](./LMJuly18-01-Overview-Architecture.md) | Product vision, tech stack, infrastructure, security, non-negotiable rules | Starting point — understand what LaunchMind is and how it's built |
| [LMJuly18-02-Database-Schema.md](./LMJuly18-02-Database-Schema.md) | All 61 migrations, every table schema, RLS policies, indexes | Database work, migrations, data modelling |
| [LMJuly18-03-Backend.md](./LMJuly18-03-Backend.md) | Every route endpoint, all services, workers, lib files, AI platform | Backend development, API integration, adding features |
| [LMJuly18-04-Frontend.md](./LMJuly18-04-Frontend.md) | All pages with routes, all components, design system tokens, UX conventions | Frontend development, UI work, new pages |
| [LMJuly18-05-Intelligence-Agents.md](./LMJuly18-05-Intelligence-Agents.md) | AI platform, agent system, intelligence network, recommendation engine, marketing memory | AI/ML work, agent development, intelligence features |
| [LMJuly18-06-Build-State-Roadmap.md](./LMJuly18-06-Build-State-Roadmap.md) | All 12 milestone summaries, test suite status, pending work, 65 ADRs index | Project management, understanding what's done, planning next steps |

---

## Quick-Reference Facts

```
Frontend:   Next.js 14 App Router  →  Vercel
Backend:    Node.js + Fastify       →  Oracle Cloud VM (Docker)
Database:   Supabase Postgres       →  gseqtbwdenjkwysregpp
AI models:  claude-sonnet-4-6 (strategy/copy) · claude-haiku-4-5-20251001 (scoring)
Image gen:  Flux.1 Schnell via Replicate
Video:      Creatomate API
Voice:      ElevenLabs API
Queue:      Upstash Redis + BullMQ
Payments:   Stripe (USA) · Razorpay (India)
Auth:       Supabase Auth (ES256 JWT, 15-min tokens, TOTP MFA enforced)
```

## Core Invariants (Never Violate)

1. **Backend first**: Migration → route → test → frontend. No exceptions.
2. **Additive migrations only**: Never drop/rename/retype columns or tables.
3. **All AI calls through `aiPlatform.ts`**: `callSonnet` / `callHaiku` with required `auditCtx`.
4. **Approve-before-post (§1.5)**: `campaigns.approved_at` must be non-null before any platform publish. Server-side enforced.
5. **Spend guardrails (§1.6)**: Check `spend_cap` before any paid campaign creation.
6. **Token-ready**: Every AI call routes through `consumeTokens(founderId, action, estimatedCost)`.
7. **RLS on every table**: `founder_id = auth.uid()` on all founder-data tables. No exceptions.
8. **Never return `encrypted_token` to frontend**: OAuth tokens are decrypted server-side only.
9. **Violet (`--ai`) = AI provenance only**: Never a button, never a gradient fill. Border/badge/text only.
10. **No invented metrics**: Only real data. Every degraded state renders honestly.

---

*Stack: Next.js 14 + Vercel · Fastify + Oracle Cloud · Supabase · pgvector · BullMQ · Claude API · AWS KMS · Cloudflare*  
*Markets: USA + India · Tiers: Free / Solo $19 / Builder $49 / Studio $99*
