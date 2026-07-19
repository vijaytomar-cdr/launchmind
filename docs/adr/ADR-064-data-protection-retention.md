# ADR-064 — Data Protection & Retention

**Status:** Accepted  
**Date:** 2026-07-10  
**Milestone:** M12 — Production Hardening

---

## Context

LaunchMind stores founder personal data, OAuth tokens, scraped app metadata, AI-generated content, and aggregate performance signals. This ADR documents how each category is protected, encrypted, and retained.

---

## Decision

### 1. Encryption at Rest

**Database (Supabase Postgres):**
- AES-256 encryption at rest managed by Supabase (AWS RDS-backed).
- pgvector embeddings: stored alongside other columns — same AES-256 at-rest protection.

**OAuth Tokens (`platform_tokens.encrypted_token`):**
- AES-256-GCM encrypted before insert.
- Encryption key: AWS KMS Customer Managed Key (CMK) — never stored in DB, never in env vars.
- `tokenVault.ts` decryptToken(): KMS `Decrypt` API call per access, audit_logs write before returning.
- IV (Initialization Vector) stored alongside ciphertext in `encrypted_token` field (base64: `iv:ciphertext`).

**Supabase Storage (content-assets bucket):**
- All objects stored with AES-256 server-side encryption (Supabase default).
- Bucket is private — all public access via signed URLs (1-hour expiry) or permanent CDN URLs for source images collected at intake.
- Marketing images collected at intake are permanent (never expiring) — stored as `content-assets/{founderId}/{productId}/source-images/{filename}`.

### 2. Encryption in Transit

- TLS 1.3 minimum enforced at Cloudflare WAF level. HSTS with `max-age=31536000; includeSubDomains`.
- Oracle VM → Supabase: TLS 1.3 (Supabase default).
- Oracle VM → AWS KMS: TLS 1.2+ (AWS SDK default, TLS 1.3 where supported).
- Oracle VM → Anthropic API: TLS 1.2+ (Anthropic SDK).
- All Resend email in transit: TLS with DKIM + DMARC + SPF on `launchmind.com` domain.

### 3. Data Retention Policy

| Category | Retention | Deletion trigger |
|---|---|---|
| `founders` (active) | Indefinite | Founder-initiated delete or account inactivity > 2 years |
| `founders` (deleted) | Soft-delete only — email anonymised | Immediate on `DELETE /founders/me` |
| `products`, `campaigns`, `content_assets` | Cascade from founder | Immediate on founder delete |
| `platform_tokens` | Cascade from founder | Immediate; revoke upstream OAuth |
| `audit_logs` | 2 years | Automated purge job (field-level: strip ip_address/user_agent after 2 years, keep action/resource_id) |
| `ai_requests` | 90 days rolling | Automated purge job |
| `reports` | Cascade from product | Immediate on product delete |
| `playbook_signals` | Indefinite | Never deleted (PII-free, anonymised cohort data) |
| `intelligence_trends` | Indefinite | Never deleted (aggregated, no founder_id) |
| Supabase Storage (marketing images) | Cascade from product | Immediate on product delete |

**Automated purge jobs:** Implemented as BullMQ cron tasks in `scheduler.ts`:
- `audit-purge`: runs 1st of every month, strips `ip_address`/`user_agent` from `audit_logs` older than 2 years
- `ai-request-purge`: runs daily, deletes `ai_requests` older than 90 days

### 4. Signed URLs for Storage

All content served from Supabase Storage must use:
1. **Signed URLs** (1-hour expiry) for in-app display of user-uploaded content and AI-generated images
2. **Permanent CDN URLs** only for source images collected at intake (App Store screenshots, website hero images) — these are publicly available images from public sources

Frontend must never construct Supabase Storage public URLs directly. All storage access via:
- `supabase.storage.from('content-assets').createSignedUrl(path, 3600)` — 1-hour expiry
- URLs generated at API response time and included in `asset_data.url` field

### 5. Right to Be Forgotten — Technical Implementation

`DELETE /founders/me` execution sequence (in `founders.route.ts`):
1. Verify JWT — confirm caller is the account being deleted
2. Revoke all platform OAuth tokens — `platformTokenService.revokeAll(founderId)` (calls upstream revoke where API supports it)
3. Delete Supabase Storage objects under `content-assets/{founderId}/`
4. Soft-delete founder: `UPDATE founders SET deleted_at=now(), email='deleted_{id}@deleted.launchmind.com', name=NULL WHERE id=?`
5. Cascade handled by DB: products, campaigns, content_assets, marketing_memories, missions (ON DELETE CASCADE)
6. Delete Supabase Auth user: `supabase.auth.admin.deleteUser(founderId)` — invalidates all sessions
7. Write audit_log: `action='founder_deleted', resource_type='founder', resource_id=founderId`

Guaranteed NOT deleted:
- `audit_logs` entries (immutable compliance record — founderId reference kept but personal data field-stripped on 2-year schedule)
- `playbook_signals` (no founder_id column, deletion impossible)
- `intelligence_trends` (no founder_id column, deletion impossible)

### 6. Data Export — Technical Implementation

`GET /founders/me/export` returns:
```json
{
  "exportedAt": "2026-07-10T08:00:00.000Z",
  "format": "GDPR-compliant JSON",
  "founder": { "email": "...", "name": "...", "plan": "...", "created_at": "..." },
  "products": [{ "name": "...", "store_url": "...", "category": "...", "created_at": "..." }],
  "campaigns": [{ "channel": "...", "status": "...", "copy_text": "...", "created_at": "..." }],
  "content_assets_count": 47,
  "ai_requests_count": 203,
  "deletion_instructions": "Send email to privacy@launchmind.com with subject 'Data Deletion Request'"
}
```

Excluded from export (per privacy-by-design):
- `encrypted_token` (security)
- `audience_config` JSONB (third-party targeting data)
- `ai_requests` full content (AI model internals)
- `audit_logs` (security audit trail — available on formal legal request)

---

## Consequences

**Positive:**
- No plaintext OAuth tokens ever in DB or logs.
- Storage signed URLs prevent unauthorised access to private content.
- Founder delete is complete and irreversible within minutes.

**Risks:**
- Upstream OAuth revocation may fail silently if platform API is unavailable — mitigated by immediate `platform_tokens` row deletion (token cannot be decrypted even if DB row somehow persists).
- Supabase Storage deletion in cascade requires service role — must not be RLS-restricted.

---

## References
- CLAUDE.md §4.2 (OAuth Token Vault)
- `backend/src/lib/tokenVault.ts`
- `backend/src/routes/founders.route.ts`
- `backend/src/services/anonymizationService.ts`
