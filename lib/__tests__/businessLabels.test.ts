/**
 * @file businessLabels.test.ts
 * @description The strings the Business Switcher shows an owner.
 *
 *   Driven by the REAL row from the AllignX account, whose product name is
 *   "AllignX・Home Services App - App Store" — brand, product and store all in
 *   one field, with a U+30FB katakana middle dot rather than the U+00B7 anyone
 *   would guess. Rendered naively under the business name it reads:
 *
 *       AllignX
 *       AllignX・Home Services App - App Store
 *
 *   which says the same thing twice and buries the only useful part.
 *
 *   The other property under test is restraint: an unconfirmed market or
 *   maturity must produce NO text. A defaulted geography in the switcher would
 *   put back exactly what migration 102 removed from the data.
 *
 * @security None — display strings only.
 * @dependencies lib/business/labels
 */

import { describe, it, expect } from 'vitest';
import {
  productLabel, maturityLabel, marketLabel, platformLabel,
  secondaryLabel, menuMetaLabel,
} from '../business/labels';

const REAL_PRODUCT = 'AllignX・Home Services App - App Store';

describe('productLabel strips redundancy', () => {
  it('reduces the real AllignX row to the part that matters', () => {
    expect(productLabel('AllignX', REAL_PRODUCT)).toBe('Home Services App');
  });

  it('handles both middle dots — U+30FB and U+00B7', () => {
    expect(productLabel('AllignX', 'AllignX・Home Services')).toBe('Home Services');
    expect(productLabel('AllignX', 'AllignX·Home Services')).toBe('Home Services');
  });

  it('strips every store suffix variant', () => {
    for (const raw of [
      'Home Services App - App Store',
      'Home Services App - Play Store',
      'Home Services App - Google Play',
      'Home Services App on the App Store',
      'Home Services App - Apps on Google Play',
    ]) {
      expect(productLabel('AllignX', raw)).toBe('Home Services App');
    }
  });

  it('strips a bare business prefix with no separator', () => {
    expect(productLabel('LaunchMind', 'LaunchMind AI Growth Operating System'))
      .toBe('AI Growth Operating System');
  });

  it('returns null when the product name IS the business name', () => {
    // Showing "AllignX" under "AllignX" is noise, not information.
    expect(productLabel('AllignX', 'AllignX')).toBeNull();
    expect(productLabel('AllignX', 'AllignX - App Store')).toBeNull();
  });

  it('leaves an already-clean name alone', () => {
    expect(productLabel('AllignX', 'Home Services App')).toBe('Home Services App');
  });

  it('is case-insensitive about the prefix but preserves the product\'s own casing', () => {
    expect(productLabel('allignx', 'AllignX・Home Services App')).toBe('Home Services App');
  });

  it('returns null for a missing product rather than inventing one', () => {
    expect(productLabel('AllignX', null)).toBeNull();
    expect(productLabel('AllignX', '')).toBeNull();
  });

  it('survives a missing business name', () => {
    expect(productLabel(null, 'Home Services App - App Store')).toBe('Home Services App');
  });
});

describe('nothing is invented', () => {
  it('unknown maturity produces no text', () => {
    expect(maturityLabel(null)).toBeNull();
    expect(maturityLabel(undefined)).toBeNull();
    expect(maturityLabel('something_new')).toBeNull();
  });

  it('maps the four known maturities to owner language', () => {
    expect(maturityLabel('pre_launch')).toBe('Pre-launch');
    expect(maturityLabel('early')).toBe('Early');
    expect(maturityLabel('growing')).toBe('Live');
    expect(maturityLabel('mature')).toBe('Established');
  });

  it('an empty market list produces NO market text — never a default', () => {
    // The USA default is exactly what was removed from the data model.
    expect(marketLabel([])).toBeNull();
    expect(marketLabel(null)).toBeNull();
  });

  it('humanises real market values', () => {
    expect(marketLabel(['united_states'])).toBe('United States');
    expect(marketLabel(['united_states', 'india'])).toBe('United States, India');
  });

  it('unknown platform produces no text', () => {
    expect(platformLabel('app_store')).toBe('iOS');
    expect(platformLabel('play_store')).toBe('Android');
    expect(platformLabel('web_only')).toBeNull();
    expect(platformLabel(null)).toBeNull();
  });
});

describe('composed labels', () => {
  it('the closed control reads "Home Services App · Live"', () => {
    expect(secondaryLabel({
      name: 'AllignX', productName: REAL_PRODUCT, maturity: 'growing',
    })).toBe('Home Services App · Live');
  });

  it('a pre-launch business with no product name still says something useful', () => {
    expect(secondaryLabel({
      name: 'LaunchMind', productName: null, maturity: 'pre_launch',
    })).toBe('Pre-launch');
  });

  it('returns null when there is genuinely nothing to add', () => {
    expect(secondaryLabel({ name: 'AllignX', productName: 'AllignX', maturity: null })).toBeNull();
  });

  it('the menu tertiary line reads "Live · United States"', () => {
    expect(menuMetaLabel({ maturity: 'growing', markets: ['united_states'] }))
      .toBe('Live · United States');
  });

  it('menu meta omits an unconfirmed market entirely', () => {
    expect(menuMetaLabel({ maturity: 'pre_launch', markets: [] })).toBe('Pre-launch');
    expect(menuMetaLabel({ maturity: null, markets: [] })).toBeNull();
  });

  it('never leaks a raw workspace id or internal term', () => {
    const all = [
      secondaryLabel({ name: 'AllignX', productName: REAL_PRODUCT, maturity: 'growing' }),
      menuMetaLabel({ maturity: 'growing', markets: ['united_states'] }),
    ].join(' ');
    expect(all).not.toMatch(/workspace|founder_id|uuid|[0-9a-f]{8}-[0-9a-f]{4}/i);
  });
});
