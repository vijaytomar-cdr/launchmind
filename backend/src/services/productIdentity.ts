/**
 * @file productIdentity.ts
 * @description Canonical product identity — BLOCKER 3.
 *
 *   WHY NOT THE NAME. Three AllignX rows exist because a fresh onboarding
 *   session starts with `product_id = null` and discovery inserts
 *   unconditionally. Two of those rows are literally named
 *   "AllignX・Home Services" and the third "AllignX・Home Services App -
 *   App Store" — so a name comparison would have missed one of them, and would
 *   equally have merged two genuinely different products that happened to share
 *   a name. Identity has to come from the id the platform itself issues.
 *
 *   Returns null when no stable identity can be derived. A manually created
 *   product legitimately has none, and such a product must stay creatable —
 *   the unique index is partial for exactly that reason.
 *
 * @security Pure parsing of URLs that may be attacker-supplied. No network, no
 *   database. Rejects non-http(s) schemes so a `javascript:` or `file:` URL
 *   cannot become an identity.
 * @dependencies none
 */

/** `apple:<id>` · `play:<package>` · `web:<domain>` */
export type CanonicalIdentity = string;

/** Apple numeric app id, e.g. /id1234567890 or ?id=1234567890 */
const APPLE_ID = /(?:\/id|[?&]id=)(\d{6,12})\b/;
/**
 * Validates a Play package id WITHOUT a regex.
 *
 * The obvious pattern — `([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+)` —
 * has nested quantifiers and is a ReDoS shape. This parses URLs that arrive
 * from the public web, so a linear check is used instead of suppressing the
 * lint rule.
 */
function isPackageId(v: string): boolean {
  if (v.length > 255) return false;
  const parts = v.split('.');
  if (parts.length < 2) return false;
  for (const part of parts) {
    if (!part) return false;
    if (!/^[A-Za-z]$/.test(part[0])) return false;
    for (const ch of part) if (!/^[A-Za-z0-9_]$/.test(ch)) return false;
  }
  return true;
}

/**
 * Derives a stable identity from a product URL.
 *
 * Handles the URL variants a founder may realistically paste — locale segments
 * (`/us/`, `/in/`), a slugged app name, tracking query strings, `www.`, a
 * trailing slash — because those all denote the SAME product and must not
 * produce a second row. That is test case 3 in the brief.
 */
export function canonicalIdentityFromUrl(rawUrl: string | null | undefined): CanonicalIdentity | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  // ── Apple App Store ───────────────────────────────────────────────────────
  if (host === 'apps.apple.com' || host === 'itunes.apple.com') {
    const m = APPLE_ID.exec(url.pathname + url.search);
    return m ? `apple:${m[1]}` : null;
  }

  // ── Google Play ───────────────────────────────────────────────────────────
  if (host === 'play.google.com') {
    const pkg = url.searchParams.get('id');
    return pkg && isPackageId(pkg) ? `play:${pkg.toLowerCase()}` : null;
  }

  // ── Website ───────────────────────────────────────────────────────────────
  // The registrable domain, not the full URL: a founder entering the homepage
  // on one pass and a pricing page on another means the same business.
  // Deliberately simple — a public-suffix list is not worth the dependency
  // here, and over-trimming would merge two genuinely different products.
  if (!host || !host.includes('.')) return null;
  return `web:${host}`;
}

/**
 * Best identity across all URLs an onboarding session collected.
 *
 * Store identities outrank a website: an App Store id is issued by Apple and
 * cannot collide, whereas two products can share a marketing domain.
 */
export function canonicalIdentityFromUrls(urls: Array<string | null | undefined>): CanonicalIdentity | null {
  const ids = urls.map(canonicalIdentityFromUrl).filter((x): x is string => Boolean(x));
  return ids.find(i => i.startsWith('apple:'))
      ?? ids.find(i => i.startsWith('play:'))
      ?? ids.find(i => i.startsWith('web:'))
      ?? null;
}

/**
 * EVERY identity derivable from a set of URLs, most authoritative first.
 *
 * WHY THIS EXISTS. One product legitimately lives on several platforms:
 * AllignX is `apple:6621240477` AND `play:com.allignx` AND `web:allignx.com`.
 * canonicalIdentityFromUrls picks ONE as the stored identity, so a founder who
 * first onboards with the App Store link and later pastes only the Play link
 * would derive `play:…`, match nothing, and create a DUPLICATE — reintroducing
 * exactly the defect the unique index was added to prevent.
 *
 * Dedup therefore looks up ANY of these, while only the preferred one is
 * stored. Order is preserved so callers can keep using the first as canonical.
 *
 * @param urls - every URL the owner supplied for one product
 * @returns de-duplicated identities, apple → play → web
 */
export function allCanonicalIdentities(urls: Array<string | null | undefined>): CanonicalIdentity[] {
  const ids = urls.map(canonicalIdentityFromUrl).filter((x): x is string => Boolean(x));
  const rank = (i: string) => i.startsWith('apple:') ? 0 : i.startsWith('play:') ? 1 : 2;
  return [...new Set(ids)].sort((a, b) => rank(a) - rank(b));
}
