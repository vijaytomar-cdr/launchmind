/**
 * @file lib/__tests__/analytics.test.ts
 * @description Proves the analytics layer cannot leak credential material
 *   (spec §20: "Never include tokens, raw secrets, or sensitive external payloads").
 *
 *   This is tested rather than reviewed because the guarantee has to survive future
 *   call sites written by people who have not read the spec. The redaction is a
 *   backstop under caller discipline, and a backstop nobody tests is a comment.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const capture = vi.fn();
vi.mock('posthog-js', () => ({ default: { capture: (...args: unknown[]) => capture(...args) } }));

import { trackIntelligence, type IntelligenceEventProps } from '../analytics';

/** Last property bag PostHog was handed. */
function lastProps(): Record<string, unknown> {
  return capture.mock.calls[capture.mock.calls.length - 1][1] as Record<string, unknown>;
}

describe('trackIntelligence — safe dimensions only', () => {
  beforeEach(() => capture.mockClear());

  it('sends the event name and the safe dimensions', () => {
    trackIntelligence('sync_completed', {
      provider: 'app_store_connect',
      connectionId: 'c-1',
      signalCount: 12,
    });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][0]).toBe('sync_completed');
    expect(lastProps()).toEqual({ provider: 'app_store_connect', connectionId: 'c-1', signalCount: 12 });
  });

  it('drops every credential-shaped key, whatever the caller passes', () => {
    // Cast: the type already forbids these. The runtime guard exists for the call
    // site that gets written after someone widens the type.
    trackIntelligence('oauth_succeeded', {
      provider: 'ga4',
      accessToken:   'ya29.a0AfH6SM',
      refresh_token: 'rt-secret',
      apiKey:        'sk_live_123',
      client_secret: 'shh',
      password:      'hunter2',
      Authorization: 'Bearer abc',
      cookie:        'session=1',
      email:         'founder@example.com',
      p8:            '-----BEGIN PRIVATE KEY-----',
    } as unknown as IntelligenceEventProps);

    const props = lastProps();
    expect(props).toEqual({ provider: 'ga4' });

    // Belt and braces: no value anywhere in the payload looks like a secret.
    const serialized = JSON.stringify(props);
    for (const secret of ['ya29', 'rt-secret', 'sk_live', 'hunter2', 'Bearer', 'BEGIN PRIVATE KEY', '@example.com']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('drops long strings, which is the shape a raw provider payload takes', () => {
    trackIntelligence('sync_failed', {
      provider: 'stripe',
      // A serialized provider response smuggled through an innocuous key name.
      status: 'x'.repeat(400),
    });
    expect(lastProps()).toEqual({ provider: 'stripe' });
  });

  it('keeps a machine error code but never a message', () => {
    trackIntelligence('oauth_failed', { provider: 'meta_ads', errorCode: 'PERMISSION_DENIED' });
    expect(lastProps()).toEqual({ provider: 'meta_ads', errorCode: 'PERMISSION_DENIED' });
  });

  it('drops null and undefined rather than sending empty dimensions', () => {
    trackIntelligence('connection_refreshed', {
      provider: 'hubspot',
      traceId: undefined,
      errorCode: null as unknown as string,
    });
    expect(lastProps()).toEqual({ provider: 'hubspot' });
  });

  it('drops non-primitive values, so an object cannot smuggle a payload', () => {
    trackIntelligence('sync_partial', {
      provider: 'mailchimp',
      signalCount: 3,
      raw: { campaigns: [{ id: 'abc', subject: 'private' }] },
    } as unknown as IntelligenceEventProps);

    const props = lastProps();
    expect(props).toEqual({ provider: 'mailchimp', signalCount: 3 });
    expect(JSON.stringify(props)).not.toContain('private');
  });
});
