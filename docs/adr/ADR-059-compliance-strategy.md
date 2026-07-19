# ADR-059 — Compliance Strategy (GDPR / CCPA / India DPDP)

**Status:** Accepted  
**Date:** 2026-07-10  
**Milestone:** M12 — Production Hardening

---

## Context

LaunchMind operates in two markets from day 1: USA (governed by CCPA) and India (governed by DPDP Act 2023). Founders and their users in the EU may also fall under GDPR. Marketing data — scraped app metadata, ICP profiles, campaign performance, AI-generated content — must be handled in compliance with all applicable regulations.

CLAUDE.md §4.10 specifies:
- GDPR right-to-delete: `DELETE /founders/me` purges all personal data
- Soft-delete only for `founders` table (email anonymised)
- `playbook_signals` NOT deleted (PII-free by design)
- Data export: `GET /founders/me/export` — GDPR-compliant JSON
- India: review PDPB 2023 before Phase 3

---

## Decision

### 1. Data Classification

| Category | Tables | PII? | Retention |
|---|---|---|---|
| Identity | `founders` | YES | Until deletion; email anonymised on soft-delete |
| Product intel | `products`, `platform_tokens` | Indirect | Deleted with founder cascade |
| Campaign data | `campaigns`, `campaign_metrics` | Indirect | Deleted with product cascade |
| AI content | `content_assets`, `content_preferences` | No | Deleted with product cascade |
| Marketing memory | `marketing_memories`, `knowledge_nodes` | Indirect | Deleted with founder cascade |
| Audit trail | `audit_logs` | YES (ip_address, user_agent) | 2 years (compliance), then purge |
| Anonymous signals | `playbook_signals`, `intelligence_trends` | NO | Indefinite (anonymised, no founder_id) |
| AI audit | `ai_requests` | Minimal (founderId) | 90 days rolling |
| Reports | `reports` | Indirect | Deleted with product cascade |

### 2. GDPR / CCPA Compliance

**Right to Delete (Art. 17 GDPR / CCPA §1798.105):**
- `DELETE /founders/me` triggers:
  1. Set `founders.deleted_at = now()`, anonymise email to `deleted_{uuid}@deleted.launchmind.com`
  2. Cascade: `products`, `platform_tokens`, `campaigns`, `campaign_metrics`, `content_assets`, `marketing_memories`, `knowledge_nodes`, `missions` — all deleted via DB CASCADE
  3. Revoke all active sessions via Supabase Auth `admin.deleteUser()`
  4. `audit_logs` records the deletion event but is NOT deleted (immutable compliance record)
  5. `playbook_signals` / `intelligence_trends` are NOT deleted (no PII — anonymised cohort data)

**Right to Access / Export (Art. 15 GDPR / CCPA §1798.100):**
- `GET /founders/me/export` returns GDPR-compliant JSON package containing: founder profile, products, campaigns (copy_text only, not full audience config), content asset count, weekly brief summaries.
- Export excludes: encrypted platform tokens, AI request details, audit log IPs.
- Response includes `generatedAt` timestamp and instructions for requesting full erasure.

**Consent:**
- Cookie consent required before PostHog fires (§2 Tech Stack).
- Platform tokens stored only after explicit OAuth flow initiated by founder.
- No third-party data sharing without explicit consent.

**Data Minimisation:**
- `playbook_signals`: no `founder_id`, no `product_id`, no `email` — only aggregate performance cohorts.
- `intelligence_trends`: cohort ≥ 3 required before publish (min-cohort guard in `intelligenceNetworkService.ts`).

### 3. India DPDP Act 2023

The Digital Personal Data Protection Act 2023 (India) introduces the following requirements:
- **Consent Manager**: Data fiduciary (LaunchMind) must obtain explicit, informed consent before processing personal data. Implemented via intake wizard consent checkbox at product setup.
- **Purpose Limitation**: Personal data collected during intake (founder email, product metadata) used only for marketing intelligence — not sold or shared.
- **Data Principal Rights**: Same as GDPR delete/export rights above. No separate Indian endpoint required — `/founders/me/delete` and `/founders/me/export` satisfy both.
- **Cross-border Transfer**: Supabase (hosted on AWS ap-south-1 for India users) keeps data within India. Verify Supabase region selection in production. Oracle VM uses Mumbai region (ap-mumbai-1).
- **Grievance Officer**: Required for entities processing Indian personal data. Designated email: `privacy@launchmind.com`. Must respond within 30 days.
- **Breach Notification**: Must notify DPBI within 72 hours of discovery. Incident playbook at `docs/incidents/playbook.md` updated to include DPBI notification step.

### 4. SOC 2 Type II Readiness

LaunchMind is not yet SOC 2 certified but the architecture supports future certification:
- **Security** (CC6): MFA enforced, JWT 15-min, anomaly detection, audit logs immutable.
- **Availability** (A1): Oracle VM + Vercel with auto-scaling. BullMQ retries for background jobs.
- **Confidentiality** (C1): TLS 1.3, AES-256 at rest for tokens, RLS for tenant isolation.
- **Processing Integrity** (PI1): Approval gates before posts, spend caps before campaigns, Zod validation on all inputs.
- **Privacy** (P1–P8): GDPR delete/export, data minimisation, consent, retention policies.

Gaps for SOC 2:
- Formal vendor security assessments not yet documented.
- Penetration testing not yet scheduled (OWASP ZAP covers DAST but not full pentest).
- Business continuity plan not formalised beyond DR runbook.

---

## Consequences

**Positive:**
- GDPR/CCPA compliance implemented at architecture level (not bolted on).
- India DPDP compliance achievable without new features — policy + regional hosting changes only.
- `playbook_signals` anonymisation design means no compliance risk for aggregate benchmarking.

**Negative:**
- SOC 2 certification is 6–9 months away — not suitable for enterprise contracts until then.
- India grievance officer designation requires human assignment.
- Audit log retention (2 years) will require periodic purge job for `ip_address` / `user_agent` fields.

---

## References
- CLAUDE.md §4.10 (Data Privacy)
- `backend/src/routes/founders.route.ts` (GDPR delete + export)
- `backend/src/services/anonymizationService.ts`
- India DPDP Act 2023 — https://www.meity.gov.in/writereaddata/files/Digital%20Personal%20Data%20Protection%20Act%202023.pdf
