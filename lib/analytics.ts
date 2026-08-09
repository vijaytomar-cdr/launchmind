/**
 * @file lib/analytics.ts
 * @description Typed PostHog event helpers for LaunchMind onboarding funnel.
 *   Import and call these at each key milestone — never pass PII to events.
 * @security No emails, names, or store URLs in event properties.
 * @dependencies posthog-js
 */

import posthog from 'posthog-js';

export type OnboardingStep =
  | 'signup_complete'
  | 'icp_confirmed'
  | 'strategy_generated'
  | 'channel_connected'
  | 'brief_received'
  | 'feedback_submitted';

/**
 * Track a named onboarding funnel step.
 * @param step - The onboarding milestone name.
 * @param props - Optional additional properties. Must not contain PII.
 * @security Never pass email, name, or store URL in props.
 */
export function trackOnboarding(
  step: OnboardingStep,
  props?: Record<string, string | number | boolean>
) {
  posthog.capture(`onboarding_${step}`, {
    step,
    ...props,
  });
}

/**
 * Identify the current founder in PostHog.
 * @param founderId - The founder's UUID from Supabase auth. Never pass email.
 * @security Uses UUID only — never email or any other PII.
 */
export function identifyFounder(founderId: string) {
  posthog.identify(founderId);
}

/**
 * Track a manual pageview event.
 * @param path - The current URL path (e.g. '/dashboard').
 */
export function trackPageView(path: string) {
  posthog.capture('$pageview', { $current_url: path });
}

// ── Improve Intelligence (spec §20) ───────────────────────────────────────────

/**
 * The Improve Intelligence funnel events from the Phase 2 specification.
 * Names match the spec exactly so dashboards built against it work unchanged.
 */
export type IntelligenceEvent =
  | 'improve_intelligence_viewed'
  | 'recommended_source_shown'
  | 'source_preview_opened'
  | 'connection_started'
  | 'permission_reviewed'
  | 'account_selected'
  | 'oauth_succeeded'
  | 'oauth_failed'
  | 'sync_started'
  | 'sync_partial'
  | 'sync_failed'
  | 'sync_completed'
  | 'first_insight_viewed'
  | 'growth_brain_updated_from_source'
  | 'morning_brief_updated_from_source'
  | 'connection_refreshed'
  | 'connection_reauthorized'
  | 'connection_disconnected'
  | 'execution_permission_upgrade_viewed'
  | 'execution_permission_upgrade_granted'
  | 'execution_permission_upgrade_declined';

/**
 * Safe analytics dimensions. Deliberately narrow: only identifiers and coarse
 * counters, never anything that could carry credential or customer data.
 */
export interface IntelligenceEventProps {
  /** Provider slug, e.g. 'app_store_connect'. Never an account name. */
  provider?:      string;
  workspaceId?:   string;
  productId?:     string;
  connectionId?:  string;
  /** Correlation id linking the event to the server-side sync run. */
  traceId?:       string;
  /** Canonical connection state, e.g. 'HEALTHY'. */
  status?:        string;
  /** Coarse counters only. */
  signalCount?:   number;
  insightCount?:  number;
  /** Machine-readable failure code, e.g. 'ADAPTER_UNAVAILABLE'. Never a message. */
  errorCode?:     string;
  /** Permission levels involved in an upgrade event. */
  levels?:        string;
}

/**
 * Keys that must never reach analytics. Anything credential-shaped is dropped
 * rather than trusted to caller discipline.
 */
const FORBIDDEN_KEY = /token|secret|key|password|credential|authorization|cookie|email|p8/i;

/**
 * Emits an Improve Intelligence event.
 *
 * @param event - One of the spec's event names
 * @param props - Safe dimensions only
 * @security Any property whose name looks credential-shaped, and any string longer
 *   than 120 characters, is dropped before the event is sent. This is a backstop:
 *   callers are also expected not to pass such values.
 */
export function trackIntelligence(event: IntelligenceEvent, props: IntelligenceEventProps = {}) {
  const safe: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (FORBIDDEN_KEY.test(key)) continue;
    if (typeof value === 'string') {
      // Long strings are the shape secrets and payloads take. Skip them.
      if (value.length > 120) continue;
      safe[key] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      safe[key] = value;
    }
  }

  posthog.capture(event, safe);
}
