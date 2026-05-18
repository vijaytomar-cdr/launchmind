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
