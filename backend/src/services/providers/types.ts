/**
 * @file types.ts
 * @description Contract every Improve Intelligence provider adapter must satisfy.
 *   This is the seam real provider integrations plug into. Nothing in this file
 *   produces data — it only describes the shape a real adapter must return.
 *
 *   Design rule (spec §29.10): an adapter must return data it actually retrieved
 *   from the provider API. There is no "sample", "demo", or "representative"
 *   return path. When an adapter cannot reach its provider it throws a typed
 *   ProviderError so the sync run records the real reason.
 *
 * @security Adapters receive a decrypted credential for the duration of one call.
 *   They must never log it, persist it, or return it in any field.
 * @dependencies None — deliberately dependency-free so adapters stay testable.
 */

/** Providers the Improve Intelligence surface can model, per migration 074. */
export type ProviderKey =
  | 'app_store_connect'
  | 'revenue_cat'
  | 'ga4'
  | 'stripe'
  | 'search_console'
  | 'google_ads'
  | 'meta_ads'
  | 'hubspot'
  | 'mailchimp';

/** Signal types accepted by intelligence_signals (migration 074 CHECK constraint). */
export type SignalType =
  | 'impressions' | 'downloads' | 'conversion' | 'territory'
  | 'trials' | 'churn' | 'retention' | 'ltv'
  | 'sessions' | 'funnel' | 'source_quality'
  | 'mrr' | 'plan_movement' | 'revenue'
  | 'queries' | 'rankings' | 'ctr'
  | 'spend' | 'cac' | 'campaign_performance'
  | 'creative_performance' | 'audience'
  | 'lead_quality' | 'lifecycle'
  | 'email_engagement';

/**
 * A single normalized observation retrieved from a provider.
 * `periodStart`/`periodEnd` are REQUIRED: migration 078's dedup unique index is
 * partial (`WHERE period_start IS NOT NULL`), so signals without a period are not
 * deduplicated and would duplicate on job replay.
 */
export interface ProviderSignal {
  signalType:  SignalType;
  /** Values actually returned by the provider API. Never synthesized. */
  signalData:  Record<string, unknown>;
  periodStart: string; // ISO date (YYYY-MM-DD)
  periodEnd:   string; // ISO date (YYYY-MM-DD)
}

/** An account/property/app the authenticated credential is authorized to read. */
export interface ProviderAccount {
  id:          string;
  name:        string;
  /** Provider-reported access level, e.g. 'Admin', 'Viewer'. Optional. */
  accessLevel?: string;
}

/** Why a provider interaction failed. Drives the connection's recovery state. */
export type ProviderErrorKind =
  | 'PERMISSION_DENIED'
  | 'WRONG_ACCOUNT'
  | 'NEEDS_REAUTH'
  | 'PROVIDER_UNAVAILABLE'
  | 'ADAPTER_UNAVAILABLE'
  | 'SYNC_FAILED';

/**
 * Typed provider failure. `kind` maps 1:1 onto a workspace_connections recovery state,
 * so the UI can offer the correct remedy instead of a generic error.
 */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  /** Owner-safe explanation. Must never contain credentials or raw provider payloads. */
  readonly ownerMessage: string;

  constructor(kind: ProviderErrorKind, ownerMessage: string, cause?: unknown) {
    super(`${kind}: ${ownerMessage}`);
    this.name = 'ProviderError';
    this.kind = kind;
    this.ownerMessage = ownerMessage;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** Context handed to an adapter for a single operation. */
export interface AdapterContext {
  founderId:  string;
  /** Decrypted provider credential. Valid for this call only — never persist or log. */
  credential: string;
  /** Non-secret connection metadata (issuer_id, key_id, property id, …). */
  config:     Record<string, unknown>;
  /** Resource the owner selected (GA4 property, App Store app, ad account…). */
  selectedResourceId:   string | null;
  selectedResourceName: string | null;
  /** Correlation id for this action; adapters should include it in outbound logs. */
  traceId:    string;
}

/** Outcome of one sync attempt. */
export interface SyncResult {
  signals: ProviderSignal[];
  /**
   * True when the provider authorized the request but some requested reports were
   * unavailable. Drives status=PARTIAL and must be explained via `partialReason`.
   */
  partial?: boolean;
  partialReason?: string;
  /**
   * True when the connection is healthy but the provider holds no history yet.
   * Drives status=NO_HISTORY — a success state, not a failure.
   */
  noHistory?: boolean;
}

/**
 * How the adapter authenticates.
 *   'signed_jwt' — the adapter mints a short-lived signed assertion from a stored
 *                  private key on every call (App Store Connect).
 *   'oauth2'     — redirect flow handled by oauthService.
 *   'api_key'    — long-lived secret sent as-is.
 */
export type AuthMechanism = 'signed_jwt' | 'oauth2' | 'api_key';

/** Reported progress for one sync step. Persisted to connection_sync_runs. */
export interface SyncProgressUpdate {
  /** 0–100. Must reflect work actually completed, not elapsed time. */
  progress: number;
  /** Owner-facing label for the step that just finished. */
  step: string;
}

/** Callback an adapter invokes as real work completes. */
export type ProgressReporter = (update: SyncProgressUpdate) => Promise<void>;

/** Health probe result — a live check, not a cached status read. */
export interface ProviderHealth {
  reachable:   boolean;
  /** True when the stored credential is still accepted by the provider. */
  authorized:  boolean;
  /** Owner-facing detail when something is wrong. */
  detail:      string | null;
  checkedAt:   string;
}

/**
 * A real provider integration.
 *
 * `verifyCredential`, `listAccounts`, and `fetchSignals` are REQUIRED — they are the
 * minimum needed for an observation source. The remaining members are optional and
 * describe capabilities not every provider has (OAuth redirect, refreshable tokens,
 * server-side revocation). connectionService checks for their presence rather than
 * assuming them.
 */
export interface ProviderAdapter {
  readonly key: ProviderKey;
  /** Human name shown in owner-facing copy. */
  readonly displayName: string;
  readonly authMechanism: AuthMechanism;
  /** Least-privilege scopes this adapter requests. Read-only for observation sources. */
  readonly readScopes: readonly string[];
  /**
   * Ordered, provider-specific labels for the sync progress UI (spec §10).
   * These describe what the adapter genuinely does, in order.
   */
  readonly syncSteps: readonly string[];
  /** Human label for what the owner selects (e.g. 'app', 'property', 'ad account'). */
  readonly resourceNoun: string;

  /**
   * Verifies the supplied credential against the live provider API.
   * MUST perform a real network call. Returning without contacting the provider
   * would let a connection reach AUTHORIZED without authorization.
   * @throws {ProviderError} PERMISSION_DENIED | NEEDS_REAUTH | PROVIDER_UNAVAILABLE
   */
  verifyCredential(ctx: AdapterContext): Promise<{ externalAccountId: string; externalAccountName: string }>;

  /**
   * Lists accounts/properties this credential is authorized to read.
   * Returns [] only when the provider genuinely reports none.
   * @throws {ProviderError}
   */
  listAccounts(ctx: AdapterContext): Promise<ProviderAccount[]>;

  /**
   * Retrieves and normalizes observations from the provider.
   * @param report - Called as each real step completes, so progress reflects work
   * @throws {ProviderError}
   */
  fetchSignals(ctx: AdapterContext, report?: ProgressReporter): Promise<SyncResult>;

  /**
   * Confirms the owner's chosen resource still exists and is readable.
   * Guards against a stale selection and against an id from another account.
   * @throws {ProviderError} WRONG_ACCOUNT when the resource is not accessible
   */
  validateSelection?(ctx: AdapterContext, resourceId: string): Promise<ProviderAccount>;

  /** Live reachability + authorization probe. */
  checkHealth?(ctx: AdapterContext): Promise<ProviderHealth>;

  /** OAuth-only: exchange a refresh token. Absent for signed-JWT providers. */
  refreshAuthorization?(ctx: AdapterContext): Promise<{
    accessToken: string; refreshToken: string | null; expiresInSeconds: number | null;
  }>;

  /**
   * Best-effort revocation at the provider on disconnect.
   * Local revocation is authoritative regardless of the result.
   * @returns True when the provider acknowledged
   */
  revokeAtProvider?(ctx: AdapterContext): Promise<boolean>;
}
