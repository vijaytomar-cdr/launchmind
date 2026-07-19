# ADR-045: Channel Adapter Architecture

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 09

---

## Context

Each publishing channel (Meta, Google, Email, App Store, etc.) has different APIs, credentials, and publishing patterns. Hardcoding per-channel logic creates unmaintainable spaghetti. We need a contract-based adapter pattern that allows each channel to be implemented independently.

---

## Decision

### Channel Adapter Contract

Every channel adapter implements this interface:

```typescript
interface ChannelAdapter {
  channel: string;
  supportedAssetTypes: string[];
  requiresApproval: boolean;
  validate(asset: ContentAsset, config: Record<string, unknown>): Promise<ValidationResult>;
  publish(asset: ContentAsset, target: PublishingTarget, creds: DecryptedToken): Promise<PublishResult>;
  schedule?(asset: ContentAsset, target: PublishingTarget, scheduledAt: Date, creds: DecryptedToken): Promise<PublishResult>;
  pause?(externalId: string, creds: DecryptedToken): Promise<void>;
  getMetrics?(externalId: string, creds: DecryptedToken): Promise<MetricsSnapshot>;
  retryPolicy: { maxAttempts: number; backoffMs: number };
}
```

### M09 Adapter Status

| Channel | Status | Notes |
|---|---|---|
| `whatsapp` | Partial | Existing route in channels.route.ts — adapted |
| `email` | Partial | Existing Resend integration |
| `app_store` | Manual export | No API integration yet — exports metadata JSON |
| `play_store` | Manual export | No API integration yet |
| `meta` | Stub | Requires OAuth token; M09 records intent only |
| `google` | Stub | Requires OAuth token; M09 records intent only |
| `push` | Stub | Requires FCM/APNS; M09 records intent only |
| `twitter` | Stub | M09 records intent only |
| `product_hunt` | Manual export | M09 exports formatted launch kit |
| `blog` | Manual export | M09 exports formatted markdown |

### Manual Export Pattern

Channels without full API integration produce a "publishing package" — a JSON/markdown export that the founder posts manually. The publishing_target record still gets status='live' after the founder confirms posting.

### Approval Gate (§1.5)

Before any adapter's `publish()` is called:
1. `campaigns.approved_at` MUST be non-null
2. `content_assets.approved_at` MUST be non-null for every asset being published

Both checks enforced in the route handler, not the adapter. Adapters receive pre-validated assets only.

---

## Consequences

- Channels that lack API integration don't block the publishing workflow
- Adding a new channel = implementing ChannelAdapter + registering in ADAPTER_REGISTRY
- Approval gate prevents adapter logic from bypassing security requirements
