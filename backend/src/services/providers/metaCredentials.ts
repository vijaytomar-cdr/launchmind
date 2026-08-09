/**
 * @file metaCredentials.ts
 * @description The single place LaunchMind resolves Meta app credentials.
 *
 *   WHAT THE COLLISION ACTUALLY WAS
 *
 *   Two Meta Ads OAuth flows existed side by side, reading different variables for
 *   the same Meta app:
 *
 *     canonical  /connections/meta_ads/oauth/*     → META_ADS_CLIENT_ID / _SECRET
 *     legacy     /integrations/meta-ads/oauth/*    → META_ADS_APP_ID   / _SECRET
 *
 *   Despite the name, WhatsApp was never involved: it reads WHATSAPP_APP_ID /
 *   WHATSAPP_APP_SECRET and is untouched by this. There is no WhatsApp compatibility
 *   to preserve here.
 *
 *   Worse than the duplication: the legacy route fell back to
 *   `META_ADS_APP_ID ?? WHATSAPP_APP_ID` and `META_ADS_APP_SECRET ?? WHATSAPP_APP_SECRET`,
 *   resolving each side independently. With only the WhatsApp app configured, Meta
 *   Ads OAuth would silently run against a DIFFERENT Meta app — and with a partial
 *   Meta config it could pair one app's id with another app's secret. That is the
 *   precise "half-working" failure this module exists to make impossible: an id and
 *   a secret are only ever taken from the SAME pair, or nothing is returned at all.
 *
 * @security Never logs, returns, or reports a secret value — only which variable
 *   NAMES are set and whether the pair is complete.
 */

/** Which variable pair supplied the credentials. */
export type MetaCredentialSource = 'canonical' | 'deprecated_alias';

export interface MetaAppCredentials {
  appId:     string;
  appSecret: string;
  source:    MetaCredentialSource;
}

/** Canonical names. Everything Meta should use these. */
export const META_CANONICAL = {
  id:     'META_ADS_CLIENT_ID',
  secret: 'META_ADS_CLIENT_SECRET',
} as const;

/** Deprecated aliases, accepted for one release so existing envs keep working. */
export const META_DEPRECATED = {
  id:     'META_ADS_APP_ID',
  secret: 'META_ADS_APP_SECRET',
} as const;

/** How the environment is configured, for diagnostics and the startup warning. */
export type MetaConfigState =
  | 'canonical'        // canonical pair complete — the target state
  | 'deprecated'       // only the alias pair complete — works, warns
  | 'partial'          // one half of a pair set — refused
  | 'absent'           // nothing set — Meta simply unavailable
  | 'shadowed';        // both pairs complete — canonical wins, alias ignored

const read = (name: string): string | undefined => {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
};

/**
 * Classifies the current Meta configuration without exposing values.
 *
 * @returns The state plus the variable NAMES involved, safe to log
 */
export function describeMetaConfig(): {
  state: MetaConfigState;
  /** Names only — never values. */
  detail: string;
} {
  const cId = read(META_CANONICAL.id);
  const cSec = read(META_CANONICAL.secret);
  const dId = read(META_DEPRECATED.id);
  const dSec = read(META_DEPRECATED.secret);

  const canonicalComplete  = Boolean(cId && cSec);
  const canonicalPartial   = Boolean(cId) !== Boolean(cSec);
  const deprecatedComplete = Boolean(dId && dSec);
  const deprecatedPartial  = Boolean(dId) !== Boolean(dSec);

  // A half-configured pair is reported even when the other pair would work, because
  // it almost always means someone edited the wrong variable and expects it to apply.
  if (canonicalPartial) {
    return {
      state: 'partial',
      detail: `${cId ? META_CANONICAL.id : META_CANONICAL.secret} is set but ${cId ? META_CANONICAL.secret : META_CANONICAL.id} is not`,
    };
  }
  if (deprecatedPartial && !canonicalComplete) {
    return {
      state: 'partial',
      detail: `${dId ? META_DEPRECATED.id : META_DEPRECATED.secret} is set but ${dId ? META_DEPRECATED.secret : META_DEPRECATED.id} is not`,
    };
  }

  if (canonicalComplete && deprecatedComplete) {
    return {
      state: 'shadowed',
      detail: `${META_CANONICAL.id}/${META_CANONICAL.secret} are in use; ${META_DEPRECATED.id}/${META_DEPRECATED.secret} are ignored and can be removed`,
    };
  }
  if (canonicalComplete)  return { state: 'canonical',  detail: `${META_CANONICAL.id}/${META_CANONICAL.secret}` };
  if (deprecatedComplete) return { state: 'deprecated', detail: `${META_DEPRECATED.id}/${META_DEPRECATED.secret}` };
  return { state: 'absent', detail: 'no Meta app credentials configured' };
}

/**
 * Resolves the Meta app credentials.
 *
 * Both halves always come from the SAME pair. Canonical wins when both are present.
 * A partially configured pair returns null rather than borrowing the missing half
 * from anywhere else.
 *
 * @returns The credentials, or null when Meta is not usably configured
 * @security The returned secret must never be logged or returned to a client.
 */
export function resolveMetaAppCredentials(): MetaAppCredentials | null {
  const { state } = describeMetaConfig();

  if (state === 'canonical' || state === 'shadowed') {
    return {
      appId:     read(META_CANONICAL.id)!,
      appSecret: read(META_CANONICAL.secret)!,
      source:    'canonical',
    };
  }
  if (state === 'deprecated') {
    return {
      appId:     read(META_DEPRECATED.id)!,
      appSecret: read(META_DEPRECATED.secret)!,
      source:    'deprecated_alias',
    };
  }
  // 'partial' and 'absent' both mean: not usable. Failing here surfaces as a clean
  // 501/503 rather than an authorization URL built from a mismatched pair.
  return null;
}

/** Guards against the same warning being printed by every module that asks. */
let warned = false;

/**
 * Emits a one-time startup warning about the Meta configuration.
 *
 * Called from server startup so a deprecated or broken configuration is visible in
 * the logs immediately, not at the moment an owner tries to connect.
 *
 * @security Prints variable names and a state only — never a value.
 */
export function warnOnMetaConfigAtStartup(): void {
  if (warned) return;
  warned = true;

  const { state, detail } = describeMetaConfig();

  switch (state) {
    case 'deprecated':
      console.warn(
        `[meta] DEPRECATED: using ${detail}. Rename to ${META_CANONICAL.id}/${META_CANONICAL.secret}; ` +
        `the alias will be removed in a future release.`,
      );
      break;
    case 'shadowed':
      console.warn(`[meta] ${detail}.`);
      break;
    case 'partial':
      // Loud, because this is the case that used to half-work.
      console.error(
        `[meta] MISCONFIGURED: ${detail}. Meta is disabled until both halves of one pair are set — ` +
        `LaunchMind will not mix an app id with another app's secret.`,
      );
      break;
    case 'absent':
      console.info('[meta] no Meta app credentials configured — Meta connections are unavailable.');
      break;
    case 'canonical':
      break; // the target state; nothing to say
  }
}

/** Test seam: allow the one-time warning to fire again. */
export function __resetMetaWarningForTest(): void {
  warned = false;
}
