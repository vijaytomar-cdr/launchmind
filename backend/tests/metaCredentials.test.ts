/**
 * @file metaCredentials.test.ts
 * @description Proves the Meta app credential resolution has exactly one canonical
 *   source and cannot half-work.
 *
 *   The collision this fixes was NOT "Meta vs WhatsApp" despite the variable names.
 *   WhatsApp reads WHATSAPP_APP_ID / WHATSAPP_APP_SECRET and was never involved. The
 *   real problem was two Meta Ads OAuth flows reading different variables for the
 *   same app, and the legacy one resolving each half independently:
 *
 *     META_ADS_APP_ID     ?? WHATSAPP_APP_ID
 *     META_ADS_APP_SECRET ?? WHATSAPP_APP_SECRET
 *
 *   With only the WhatsApp app configured that silently ran Meta Ads OAuth against a
 *   different Meta app; with a partial Meta config it could pair one app's id with
 *   another app's secret. The mixing tests below are the ones that matter most.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveMetaAppCredentials,
  describeMetaConfig,
  warnOnMetaConfigAtStartup,
  __resetMetaWarningForTest,
  META_CANONICAL,
  META_DEPRECATED,
} from '../src/services/providers/metaCredentials';

const ALL = [
  META_CANONICAL.id, META_CANONICAL.secret,
  META_DEPRECATED.id, META_DEPRECATED.secret,
  'WHATSAPP_APP_ID', 'WHATSAPP_APP_SECRET',
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ALL.map(k => [k, process.env[k]]));
  for (const k of ALL) delete process.env[k];
  __resetMetaWarningForTest();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

// ── Canonical pair ───────────────────────────────────────────────────────────

describe('canonical pair', () => {
  it('resolves when both halves are set', () => {
    process.env[META_CANONICAL.id]     = 'canonical-app-id';
    process.env[META_CANONICAL.secret] = 'canonical-secret';

    expect(resolveMetaAppCredentials()).toEqual({
      appId: 'canonical-app-id', appSecret: 'canonical-secret', source: 'canonical',
    });
    expect(describeMetaConfig().state).toBe('canonical');
  });

  it('is what the OAuth config layer uses for meta_ads', async () => {
    process.env[META_CANONICAL.id]     = 'canonical-app-id';
    process.env[META_CANONICAL.secret] = 'canonical-secret';

    const { getOAuthProviderConfig } = await import('../src/services/providers/oauthConfig');
    const cfg = getOAuthProviderConfig('meta_ads');

    expect(cfg?.clientId).toBe('canonical-app-id');
    expect(cfg?.clientSecret).toBe('canonical-secret');
    // Read-only scopes are unrelated to this change but must not regress.
    expect(cfg?.scopes).toEqual(['ads_read', 'read_insights']);
  });
});

// ── Deprecated alias ─────────────────────────────────────────────────────────

describe('deprecated alias', () => {
  it('still works so existing environments do not break', () => {
    process.env[META_DEPRECATED.id]     = 'legacy-app-id';
    process.env[META_DEPRECATED.secret] = 'legacy-secret';

    expect(resolveMetaAppCredentials()).toEqual({
      appId: 'legacy-app-id', appSecret: 'legacy-secret', source: 'deprecated_alias',
    });
    expect(describeMetaConfig().state).toBe('deprecated');
  });

  it('warns exactly once at startup, naming variables but never values', () => {
    process.env[META_DEPRECATED.id]     = 'legacy-app-id';
    process.env[META_DEPRECATED.secret] = 'super-secret-value';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    warnOnMetaConfigAtStartup();
    warnOnMetaConfigAtStartup();     // a second call must stay quiet

    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain('DEPRECATED');
    expect(msg).toContain(META_DEPRECATED.id);
    expect(msg).toContain(META_CANONICAL.id);
    expect(msg).not.toContain('super-secret-value');
    expect(msg).not.toContain('legacy-app-id');
    warn.mockRestore();
  });

  it('reaches the OAuth config layer too, so both flows agree', async () => {
    process.env[META_DEPRECATED.id]     = 'legacy-app-id';
    process.env[META_DEPRECATED.secret] = 'legacy-secret';

    const { getOAuthProviderConfig } = await import('../src/services/providers/oauthConfig');
    expect(getOAuthProviderConfig('meta_ads')?.clientId).toBe('legacy-app-id');
  });
});

// ── Precedence ───────────────────────────────────────────────────────────────

describe('precedence', () => {
  it('canonical wins when both pairs are set', () => {
    process.env[META_CANONICAL.id]      = 'canonical-app-id';
    process.env[META_CANONICAL.secret]  = 'canonical-secret';
    process.env[META_DEPRECATED.id]     = 'legacy-app-id';
    process.env[META_DEPRECATED.secret] = 'legacy-secret';

    const creds = resolveMetaAppCredentials();
    expect(creds?.appId).toBe('canonical-app-id');
    expect(creds?.appSecret).toBe('canonical-secret');
    expect(creds?.source).toBe('canonical');
    expect(describeMetaConfig().state).toBe('shadowed');
  });

  it('says the alias is ignored and can be removed', () => {
    process.env[META_CANONICAL.id]      = 'a';
    process.env[META_CANONICAL.secret]  = 'b';
    process.env[META_DEPRECATED.id]     = 'c';
    process.env[META_DEPRECATED.secret] = 'd';

    expect(describeMetaConfig().detail).toContain('ignored');
  });
});

// ── Partial configuration must FAIL, not half-work ───────────────────────────

describe('partial configuration fails safely', () => {
  it.each([
    ['canonical id without secret',  META_CANONICAL.id],
    ['canonical secret without id',  META_CANONICAL.secret],
    ['alias id without secret',      META_DEPRECATED.id],
    ['alias secret without id',      META_DEPRECATED.secret],
  ])('%s → refused', (_label, envName) => {
    process.env[envName] = 'only-half';
    expect(resolveMetaAppCredentials()).toBeNull();
    expect(describeMetaConfig().state).toBe('partial');
  });

  it('NEVER pairs a canonical id with an alias secret', () => {
    // The exact half-working mode the old `??` chain allowed.
    process.env[META_CANONICAL.id]      = 'canonical-app-id';
    process.env[META_DEPRECATED.secret] = 'legacy-secret';

    expect(resolveMetaAppCredentials()).toBeNull();
  });

  it('NEVER pairs an alias id with a canonical secret', () => {
    process.env[META_DEPRECATED.id]    = 'legacy-app-id';
    process.env[META_CANONICAL.secret] = 'canonical-secret';

    expect(resolveMetaAppCredentials()).toBeNull();
  });

  it('logs the misconfiguration as an error, not a warning', () => {
    process.env[META_CANONICAL.id] = 'only-half';
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    warnOnMetaConfigAtStartup();

    const msg = String(err.mock.calls[0][0]);
    expect(msg).toContain('MISCONFIGURED');
    expect(msg).not.toContain('only-half');
    err.mockRestore();
  });

  it('makes the OAuth config layer report meta_ads as unconfigured', async () => {
    process.env[META_CANONICAL.id] = 'only-half';
    const { getOAuthProviderConfig } = await import('../src/services/providers/oauthConfig');
    // null → the route answers 501 "not available yet" rather than sending the owner
    // to a Meta screen built from a mismatched pair.
    expect(getOAuthProviderConfig('meta_ads')).toBeNull();
  });
});

// ── Neither pair required; WhatsApp is independent ───────────────────────────

describe('independence', () => {
  it('absent configuration is a clean "unavailable", not an error', () => {
    expect(resolveMetaAppCredentials()).toBeNull();
    expect(describeMetaConfig().state).toBe('absent');
  });

  it('never requires BOTH pairs — either one alone is sufficient', () => {
    process.env[META_CANONICAL.id]     = 'a';
    process.env[META_CANONICAL.secret] = 'b';
    expect(resolveMetaAppCredentials()).not.toBeNull();

    delete process.env[META_CANONICAL.id];
    delete process.env[META_CANONICAL.secret];
    process.env[META_DEPRECATED.id]     = 'c';
    process.env[META_DEPRECATED.secret] = 'd';
    expect(resolveMetaAppCredentials()).not.toBeNull();
  });

  it('does NOT fall back to the WhatsApp app', () => {
    // This was the real defect: Meta Ads OAuth silently ran against the WhatsApp
    // app, which is a different Meta app with different credentials.
    process.env.WHATSAPP_APP_ID     = 'whatsapp-app-id';
    process.env.WHATSAPP_APP_SECRET = 'whatsapp-secret';

    expect(resolveMetaAppCredentials()).toBeNull();
    expect(describeMetaConfig().state).toBe('absent');
  });

  it('ignores whitespace-only values rather than treating them as set', () => {
    process.env[META_CANONICAL.id]     = '   ';
    process.env[META_CANONICAL.secret] = 'b';
    expect(resolveMetaAppCredentials()).toBeNull();
  });
});

// ── No stray reads remain ────────────────────────────────────────────────────

describe('single source of truth', () => {
  it('nothing outside metaCredentials.ts reads the Meta app variables', async () => {
    const { readFileSync, readdirSync, statSync } = await import('fs');
    const { join } = await import('path');

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!full.endsWith('.ts')) continue;
        if (full.endsWith('metaCredentials.ts')) continue;

        for (const line of readFileSync(full, 'utf-8').split('\n')) {
          // Comments explaining the history are fine; actual reads are not.
          const code = line.split('//')[0];
          if (/process\.env\.META_ADS_(APP|CLIENT)_(ID|SECRET)/.test(code)) {
            offenders.push(`${full}: ${line.trim().slice(0, 70)}`);
          }
        }
      }
    };
    walk(join(__dirname, '..', 'src'));
    expect(offenders).toEqual([]);
  });

  it('the WhatsApp routes still read their own credentials', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(__dirname, '..', 'src', 'routes', 'channels.route.ts'), 'utf-8');

    // WhatsApp is a separate Meta app and must keep its own pair.
    expect(src).toContain('process.env.WHATSAPP_APP_ID');
    expect(src).toContain('process.env.WHATSAPP_APP_SECRET');
    // But Meta Ads must no longer borrow them.
    expect(src).not.toContain('META_ADS_APP_ID ?? process.env.WHATSAPP_APP_ID');
    expect(src).not.toContain('META_ADS_APP_SECRET ?? process.env.WHATSAPP_APP_SECRET');
  });
});
