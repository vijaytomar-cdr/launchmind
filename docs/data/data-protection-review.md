# LaunchMind — Data Protection Review

**Date:** 2026-07-10  
**Milestone:** M12 — Production Hardening

---

## 1. Data Inventory

### 1.1 Personal Data (PII)

| Data element | Table/field | Collection point | Purpose |
|---|---|---|---|
| Email address | `founders.email` | Sign-up | Account identity, email notifications |
| Full name | `founders.name` | Sign-up (optional) | Personalisation |
| IP address | `audit_logs.ip_address` | Every authenticated request | Security audit, anomaly detection |
| User agent | `audit_logs.user_agent` | Every authenticated request | Anomaly detection |
| OAuth tokens | `platform_tokens.encrypted_token` | Channel connection flow | Post to ad platforms |
| App Store URL | `products.store_url` | Product intake | Scraping |
| App metadata | `products.scraped_meta` | Scraped from public stores | ICP generation |
| Payment info | Stripe/Razorpay (not stored locally) | Billing | Subscription |

### 1.2 Pseudonymous Data

| Data element | Table/field | Pseudonymisation |
|---|---|---|
| `founder_id` | Foreign key in all tables | UUID, not directly identifying |
| Campaign copy | `campaigns.copy_text` | Linked to founder via `founder_id` |
| AI-generated content | `content_assets.asset_data` | Linked to founder via `founder_id` |
| Marketing memories | `marketing_memories.content` | Linked to founder via `founder_id` |

### 1.3 Non-Personal Data

| Data | Table | Explanation |
|---|---|---|
| Performance signals | `playbook_signals` | No `founder_id`, no `product_id`, no email. Cohort-level only. |
| Intelligence trends | `intelligence_trends` | Aggregated. Min cohort = 3 before publish. No PII. |
| Decision rules | `decision_rules` | System configuration. No personal data. |

---

## 2. Encryption

### 2.1 Encryption at Rest

| Data | Method | Key location |
|---|---|---|
| Postgres tables | AES-256 (Supabase/RDS managed) | AWS RDS KMS |
| OAuth tokens (`encrypted_token`) | AES-256-GCM (application-level) | AWS KMS CMK |
| Supabase Storage objects | AES-256 SSE | Supabase/AWS |
| Oracle VM disk | LUKS (if enabled — verify) | VM key |

### 2.2 Encryption in Transit

| Connection | Protocol | Verified |
|---|---|---|
| Browser → Cloudflare → Vercel | TLS 1.3 | ✅ |
| Browser → Cloudflare → Oracle VM | TLS 1.3 | ✅ |
| Oracle VM → Supabase Postgres | TLS 1.3 | ✅ |
| Oracle VM → AWS KMS | TLS 1.2+ | ✅ |
| Oracle VM → Anthropic API | TLS 1.2+ | ✅ |
| Oracle VM → Stripe | TLS 1.2+ | ✅ |
| Oracle VM → Resend | TLS 1.2+ | ✅ |
| Emails from Resend | TLS + DKIM + DMARC + SPF | ✅ (configure DNS) |

### 2.3 Key Management

**AWS KMS CMK (OAuth tokens):**
- Key type: Symmetric (AES-256)
- Key rotation: AWS-managed annual rotation enabled
- Key policy: only the Oracle VM IAM role can call `Decrypt`
- Backup: AWS KMS replicates across 3 AZs automatically

**Supabase JWT signing keys:**
- Algorithm: ES256 (rotated May 2026)
- Rotation: Supabase manages — jwtPlugin uses `getUser()` (algorithm-agnostic)

---

## 3. Data Retention

| Table | Retention period | Deletion method |
|---|---|---|
| `founders` (active) | Account lifetime | Soft-delete on request |
| `founders` (deleted) | Soft-delete with anonymised email | Stored for 90 days post-deletion for dispute resolution, then hard-delete |
| `products`, `campaigns`, etc. | Cascade from founder | Immediate on founder delete |
| `platform_tokens` | Active token lifetime | Immediate on delete; upstream revoke attempted |
| `audit_logs` | 2 years | Field-level purge of `ip_address`/`user_agent`; keep `action`/`resource_id` |
| `ai_requests` | 90 days | Automated delete job |
| `content_assets` | Cascade from product | Immediate on product delete |
| `content_versions` | Cascade from asset | Immediate on asset delete |
| `marketing_memories` | Cascade from founder | Immediate on founder delete |
| `playbook_signals` | Indefinite | Not deleted (PII-free by design) |
| `intelligence_trends` | Indefinite | Not deleted (PII-free by design) |
| Supabase Storage objects | Cascade from product | Service role delete on product archive/delete |

### 3.1 Automated Purge Jobs (in `scheduler.ts`)

```typescript
// Runs 1st of every month
async function purgeAuditLogPII() {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 2);
  await supabase.from('audit_logs')
    .update({ ip_address: null, user_agent: null })
    .lt('created_at', cutoff.toISOString());
}

// Runs daily at 03:00 UTC
async function purgeOldAIRequests() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  await supabase.from('ai_requests')
    .delete()
    .lt('created_at', cutoff.toISOString());
}
```

**Action:** Verify both purge jobs are registered in `scheduler.ts`. If not, add them before production launch.

---

## 4. Storage Security

### 4.1 `content-assets` Bucket

- **Access:** Private (no public read). Cloudflare cannot bypass Supabase's storage auth.
- **Signed URLs:** Generated at API response time, 1-hour expiry.
- **Permanent URLs:** Only for source images collected at intake (publicly available from app stores/websites).

### 4.2 Storage Access Pattern

```typescript
// ✅ Correct — backend generates signed URL and returns in API response
const { data } = await supabase.storage
  .from('content-assets')
  .createSignedUrl(`${founderId}/${productId}/image.png`, 3600);
return { url: data.signedUrl };

// ❌ Wrong — direct public URL exposed
return { url: `https://supabase.co/storage/v1/object/public/content-assets/${path}` };
```

Frontend types for content assets include `url` (signed) not the storage path. ✅

---

## 5. Right to Be Forgotten — Verification

Test procedure for `DELETE /founders/me`:

1. Create test founder account
2. Create 1 product with 2 campaigns and 3 content assets
3. Connect a platform token (meta)
4. Call `DELETE /founders/me` with valid JWT
5. Verify:
   - `founders` row: `deleted_at` set, email anonymised ✅
   - `products`, `campaigns`, `content_assets`: rows deleted via CASCADE ✅
   - `platform_tokens`: row deleted ✅
   - `marketing_memories`: rows deleted via CASCADE ✅
   - Supabase Auth: user deleted (cannot log in) ✅
   - Storage objects: `content-assets/{founderId}/` deleted ✅
   - `audit_logs`: entry for `founder_deleted` present, other entries remain ✅
   - `playbook_signals`: no change (no founder_id) ✅

---

## 6. Data Protection Impact Assessment (DPIA)

For the AI marketing intelligence use case, a DPIA is advisable because:
- Processing large volumes of personal data (founder accounts, campaign performance)
- Using AI to profile individuals' marketing behaviour
- International transfers to US-based processors (Anthropic, AWS, Stripe)

**DPIA conclusion:** Processing is lawful (contract performance + legitimate interests). Risks are mitigated by:
- RLS + tenant isolation (no cross-founder data access)
- Anonymised playbook signals (no individual profiling for benchmarks)
- Token vault (OAuth credentials never exposed)
- Deletion implemented and tested

**Residual risk:** LOW. Acceptable for production launch.

---

## 7. Third-Party Data Sharing

LaunchMind shares founder data with the following processors:

| Processor | Data shared | Purpose | DPA |
|---|---|---|---|
| Supabase | All DB data (hosted) | Database hosting | ✅ |
| Anthropic | Prompt + product context (no direct PII) | AI generation | ✅ |
| Stripe | Email, payment method | Billing | ✅ |
| Razorpay | Email, payment method (India) | Billing | ✅ |
| Resend | Email address | Transactional email | ✅ |
| AWS | Encrypted tokens (KMS) | Token encryption | ✅ |
| Oracle | IP address in logs | Server hosting | ✅ |
| Replicate | App context for image prompts | Image generation | ⚠️ DPA needed |
| ElevenLabs | Brand voice text | Voice synthesis | ⚠️ DPA needed |
| Creatomate | Content text + images | Video rendering | ⚠️ DPA needed |
| Cloudflare | IP address, request metadata | CDN + WAF | ✅ |
| Sentry | Error details (no PII in errors by config) | Error tracking | ✅ |
| PostHog | Anonymous analytics (after consent) | Product analytics | ✅ |
| Axiom | Log data (structured, redacted PII) | Observability | ✅ |

**LaunchMind does NOT:**
- Sell founder data to any third party
- Share competitor analysis results across founders
- Use one founder's product data to train AI models for another founder's benefit
