# LaunchMind — Compliance Readiness

**Date:** 2026-07-10  
**Milestone:** M12 — Production Hardening  
**Standards:** GDPR (EU) · CCPA (California) · India DPDP Act 2023

---

## 1. GDPR Compliance (EU — Regulation 2016/679)

### 1.1 Lawful Basis for Processing

| Data category | Lawful basis | Article |
|---|---|---|
| Founder account data | Contract performance | Art. 6(1)(b) |
| App metadata (scraped) | Legitimate interests (publicly available data) | Art. 6(1)(f) |
| Campaign performance metrics | Contract performance | Art. 6(1)(b) |
| Marketing analytics + reports | Contract performance | Art. 6(1)(b) |
| Audit logs | Legal obligation | Art. 6(1)(c) |
| Anonymised playbook signals | Legitimate interests (no personal data) | N/A |

### 1.2 Data Subject Rights

| Right | Endpoint | Implementation | Status |
|---|---|---|---|
| Access (Art. 15) | `GET /founders/me/export` | Returns JSON package with all personal data | ✅ |
| Rectification (Art. 16) | `PATCH /founders/me` | Name, notification preferences editable | ✅ |
| Erasure (Art. 17) | `DELETE /founders/me` | Full purge + soft-delete + Auth deletion | ✅ |
| Restriction (Art. 18) | Manual (ops team) | Not automated — handle via support ticket | ⚠️ Manual |
| Portability (Art. 20) | `GET /founders/me/export` | JSON format, machine-readable | ✅ |
| Objection (Art. 21) | `PATCH /founders/me/notifications` | Unsubscribe from marketing emails | ✅ |

### 1.3 Privacy by Design

- **Data minimisation:** Only data necessary for marketing intelligence is collected. `playbook_signals` has no PII columns by design.
- **Purpose limitation:** Founder data used only for their own marketing intelligence — not sold, not shared, not used for cross-founder analytics with PII.
- **Storage limitation:** Retention policy enforced (see ADR-064). `ai_requests` purged after 90 days.
- **Pseudonymisation:** Deleted founders' emails anonymised to `deleted_{uuid}@deleted.launchmind.com`.
- **Encryption:** AES-256 at rest, TLS 1.3 in transit.

### 1.4 Privacy Notice Requirements

Privacy notice must cover (in-app + launchmind.com/privacy):
- Controller identity: LaunchMind (company legal name to be added)
- Data categories collected
- Purposes and lawful bases
- Retention periods
- Third-party processors: Supabase, Anthropic, Stripe, Razorpay, Resend, Replicate, ElevenLabs, Creatomate, Oracle, AWS
- International transfers: Supabase (AWS US-East), Anthropic (US), AWS KMS (US) — covered by SCCs
- Data subject rights + contact: privacy@launchmind.com

**Action:** Privacy notice must be published at `launchmind.com/privacy` before production launch.

### 1.5 Processor Agreements (DPAs)

| Processor | DPA status |
|---|---|
| Supabase | DPA available at supabase.com/dpa ✅ |
| Anthropic | DPA available at anthropic.com/policies ✅ |
| Stripe | DPA available at stripe.com/legal/dpa ✅ |
| Razorpay | Standard contractual terms cover India ✅ |
| Resend | DPA available at resend.com ✅ |
| AWS (KMS) | AWS GDPR DPA ✅ |
| Oracle (VM) | Oracle GDPR DPA ✅ |
| Cloudflare | Cloudflare DPA ✅ |
| Replicate | Review required ⚠️ |
| ElevenLabs | Review required ⚠️ |
| Creatomate | Review required ⚠️ |

**Action:** Obtain and sign DPAs with Replicate, ElevenLabs, and Creatomate before enabling those features in production.

---

## 2. CCPA Compliance (California — Civil Code §1798)

### 2.1 Consumer Rights

| Right | Endpoint | Status |
|---|---|---|
| Know (§1798.100) | `GET /founders/me/export` | ✅ |
| Delete (§1798.105) | `DELETE /founders/me` | ✅ |
| Opt-out of sale | N/A — LaunchMind does not sell personal information | ✅ N/A |
| Non-discrimination | All features available regardless of rights exercise | ✅ |
| Correct (§1798.106) | `PATCH /founders/me` | ✅ |

### 2.2 Notice at Collection

LaunchMind collects: email, name, product URLs, app metadata (scraped), campaign performance.

**"Do Not Sell or Share My Personal Information":** LaunchMind does not sell, rent, or share personal information with third parties for cross-context behavioural advertising. No CCPA opt-out link required.

### 2.3 California-Specific Requirements

- Annual data inventory: maintain a record of data processing activities.
- Consumer request response: within 45 days (extendable to 90 with notice).
- Contact for CCPA requests: privacy@launchmind.com or in-app delete flow.

---

## 3. India DPDP Act 2023

### 3.1 Consent Requirements

- **Explicit, informed consent:** Obtained at account creation and at product intake start.
- **Granular consent:** Separate consent for marketing communications (vs. service emails).
- **Consent withdrawal:** Account deletion serves as full consent withdrawal.
- **Consent record:** `audit_logs` captures consent timestamp (action: `founder_consent_given`).

### 3.2 Data Principal Rights

All rights from GDPR Section 1 above apply equally under DPDP.

Additional DPDP-specific:
- Right to nominate: allows a trusted person to exercise rights on behalf of incapacitated individual. Not yet implemented — handle via ops team support ticket.

### 3.3 Cross-Border Data Transfer

India requires adequate protection for transfers outside India. Supabase database for Indian founders should be hosted in `ap-south-1` (Mumbai). **Action:** Verify Supabase region configuration for India market.

### 3.4 Grievance Officer

Required by DPDP § 13: a designated Grievance Officer for processing Indian personal data.
- **Designated officer email:** privacy@launchmind.com
- **Response SLA:** 30 days
- **Action:** Display Grievance Officer name and contact on `launchmind.com/privacy`.

### 3.5 Data Breach Notification

Under DPDP: notify DPBI (Data Protection Board of India) and affected data principals "without delay" (interpreted as 72 hours per industry guidance).

Incident playbook at `docs/incidents/playbook.md` — DPBI notification step required.

**Action:** Add DPBI notification to incident playbook.

---

## 4. Compliance Checklist

| Item | Status |
|---|---|
| Privacy notice published | ⚠️ Pre-launch action |
| DPAs signed with all processors | ⚠️ Replicate, ElevenLabs, Creatomate pending |
| Grievance officer designated (India) | ⚠️ Name required |
| GDPR delete implemented | ✅ |
| GDPR export implemented | ✅ |
| Data retention policy documented | ✅ |
| Purge jobs implemented | ✅ (scheduled in `scheduler.ts`) |
| Consent collection at intake | ✅ |
| Audit log immutability | ✅ |
| Cookie consent before PostHog | ✅ |
| SOC 2 Type II | 🔴 Not yet — 6–9 month programme |

---

## 5. Compliance Contacts

| Role | Contact |
|---|---|
| DPO (if required) | privacy@launchmind.com |
| GDPR supervisory authority | ICO (UK) or relevant EU DPA |
| CCPA requests | privacy@launchmind.com |
| India Grievance Officer | privacy@launchmind.com |
| Security incidents | security@launchmind.com |
