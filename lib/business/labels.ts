/**
 * @file labels.ts
 * @description Owner-facing labels for the Business Switcher.
 *
 *   Pure functions, extracted so they can be tested. The switcher renders the
 *   most context-heavy control in the product — it names the company the founder
 *   is currently operating — and the strings it shows come from scraper output,
 *   which is messy.
 *
 *   THE REDUNDANCY PROBLEM. Discovery names a product after its store listing,
 *   so AllignX's product row is literally:
 *
 *       "AllignX・Home Services App - App Store"
 *
 *   Rendered under the business name that reads:
 *
 *       AllignX
 *       AllignX・Home Services App - App Store
 *
 *   which tells the owner nothing twice. The business name and the store suffix
 *   are both stripped, leaving "Home Services App".
 *
 *   NOTHING IS INVENTED. A market or maturity that was never confirmed produces
 *   no text at all — an unconfirmed geography must read as absent, not as a
 *   plausible default.
 *
 * @security None — display strings only, no owner data leaves the client.
 * @dependencies none
 */

/**
 * Separators discovery puts between a brand and its product.
 * U+30FB (katakana middle dot) is what the App Store scraper actually emits;
 * U+00B7 is the one everybody assumes. Both appear in real rows.
 */
const SEPARATORS = ['・', '·', '|', '–', '—', ':'];

/** Store suffixes that add nothing once the platform is shown separately. */
const STORE_SUFFIXES = [
  ' - App Store', ' - Play Store', ' - Google Play', ' on the App Store',
  ' - Apps on Google Play',
];

/**
 * The product name with the business name and store boilerplate removed.
 *
 * @param businessName - the workspace name, e.g. "AllignX"
 * @param productName  - the raw product row name
 * @returns a clean product label, or null when nothing distinct remains
 */
export function productLabel(
  businessName: string | null | undefined,
  productName: string | null | undefined,
): string | null {
  if (!productName) return null;
  let out = productName.trim();

  for (const suffix of STORE_SUFFIXES) {
    if (out.toLowerCase().endsWith(suffix.toLowerCase())) {
      out = out.slice(0, out.length - suffix.length).trim();
    }
  }

  // Strip a leading "<business><separator>" prefix.
  if (businessName) {
    const b = businessName.trim().toLowerCase();
    for (const sep of SEPARATORS) {
      const prefix = `${b}${sep}`;
      if (out.toLowerCase().startsWith(prefix)) {
        out = out.slice(prefix.length).trim();
        break;
      }
    }
    // Or a bare "<business> " prefix with no separator at all.
    if (out.toLowerCase().startsWith(`${b} `)) out = out.slice(b.length).trim();
    // Identical to the business name means there is no second thing to say.
    if (out.toLowerCase() === b) return null;
  }

  return out.length > 0 ? out : null;
}

/** Owner-facing maturity. Unknown maturity yields nothing, never a guess. */
export function maturityLabel(maturity: string | null | undefined): string | null {
  switch (maturity) {
    case 'pre_launch': return 'Pre-launch';
    case 'early':      return 'Early';
    case 'growing':    return 'Live';
    case 'mature':     return 'Established';
    default:           return null;
  }
}

/** "united_states" → "United States". Empty markets yield nothing. */
export function marketLabel(markets: string[] | null | undefined): string | null {
  if (!markets?.length) return null;
  return markets
    .map(m => m.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
    .join(', ');
}

/** "iOS" / "Android". Anything else yields nothing rather than a guess. */
export function platformLabel(platform: string | null | undefined): string | null {
  if (platform === 'app_store') return 'iOS';
  if (platform === 'play_store') return 'Android';
  return null;
}

/**
 * The one-line secondary label under the business name in the top bar.
 *
 * Product first because it is what distinguishes this business; maturity second
 * because it is the state the owner most often wants at a glance. Market is
 * deliberately left to the open menu — the closed control has to stay scannable.
 *
 * @returns e.g. "Home Services App · Live", or null when nothing is known
 */
export function secondaryLabel(b: {
  name?: string | null;
  productName?: string | null;
  maturity?: string | null;
}): string | null {
  const parts = [productLabel(b.name, b.productName), maturityLabel(b.maturity)]
    .filter((x): x is string => Boolean(x));
  return parts.length ? parts.join(' · ') : null;
}

/**
 * The tertiary line inside the open menu: maturity and market.
 *
 * @returns e.g. "Live · United States", or null when neither is confirmed
 */
export function menuMetaLabel(b: {
  maturity?: string | null;
  markets?: string[] | null;
}): string | null {
  const parts = [maturityLabel(b.maturity), marketLabel(b.markets)]
    .filter((x): x is string => Boolean(x));
  return parts.length ? parts.join(' · ') : null;
}
