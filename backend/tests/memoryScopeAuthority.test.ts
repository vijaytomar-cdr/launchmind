/**
 * @file memoryScopeAuthority.test.ts
 * @description Scope normalization/comparison and the persisted authority model —
 *   3.2A §5, §2, §26, §30. ADR-067 C4, C10, C12, C13.
 *
 *   The scope tests exist because Pre-Design found every component inventing its
 *   own scope semantics. The single most consequential assertion here is that
 *   ANY, BOUND and UNKNOWN stay three distinct things — collapsing them is how a
 *   segment-specific finding silently becomes a claim about every customer.
 *
 *   The authority tests exist because authority used to be re-derived at read
 *   time from a hard-coded switch, so editing that switch reinterpreted history.
 *
 * @security Includes the forged-founder-authority case (§30).
 * @dependencies scopePolicy, authorityPolicy (both pure)
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeMemoryScope, compareMemoryScope, scopeKey, scopeSpecificity,
  scopeMatches, isScopedExceptionOf, describeScope, isGovernedScope,
  SCOPE_UNKNOWN, SCOPE_POLICY_VERSION, type MemoryScope,
} from '../src/services/memory/scopePolicy';
import {
  authorityForCandidate, authorityRank, mayAutoOverride, requiresFounderReview,
  qualifiesForImmediateActive, historicalAuthority, isFounderAuthority,
  AUTHORITY_TIERS, AUTHORITY_POLICY_VERSION,
} from '../src/services/memory/authorityPolicy';

// ── §5 scope normalization ───────────────────────────────────────────────────
describe('§5 scope normalization', () => {
  it('is idempotent and order-independent', () => {
    const a = normalizeMemoryScope({ channel: 'Google_Ads', audience_segment: 'SMB' });
    const b = normalizeMemoryScope({ audience_segment: 'smb', channel: 'google_ads' });
    expect(a.scopeKey).toBe(b.scopeKey);
    expect(normalizeMemoryScope(a.scope).scopeKey).toBe(a.scopeKey);
  });

  it('drops ungoverned dimensions rather than carrying them through', () => {
    // A seventh dimension nobody can filter on would recreate the exact
    // asymmetry C10 exists to remove.
    const n = normalizeMemoryScope({ channel: 'meta', vertical: 'saas', nonsense: 1 });
    expect(n.scope).toEqual({ channel: 'meta' });
    expect(n.droppedDimensions).toEqual(expect.arrayContaining(['vertical', 'nonsense']));
  });

  it('an empty string is NOT a scope value — it becomes ANY', () => {
    const n = normalizeMemoryScope({ channel: '   ', geography: 'usa' });
    expect(n.scope.channel).toBeUndefined();
    expect(n.scope.geography).toBe('usa');
  });

  it('refuses UNKNOWN unless explicitly allowed (legacy classification only)', () => {
    expect(normalizeMemoryScope({ channel: SCOPE_UNKNOWN }).scope.channel).toBeUndefined();
    const legacy = normalizeMemoryScope({ channel: SCOPE_UNKNOWN }, { allowUnknown: true });
    expect(legacy.scope.channel).toBe(SCOPE_UNKNOWN);
    expect(legacy.completeness).toBe('unknown');
  });

  it('malformed input normalizes to a fully-ANY scope rather than throwing', () => {
    for (const bad of [null, undefined, 42, 'channel=meta', ['meta'], true]) {
      const n = normalizeMemoryScope(bad);
      expect(n.scope).toEqual({});
      expect(n.specificity).toBe(0);
    }
  });

  it('caps value length so hostile provider text cannot become a scope key', () => {
    const n = normalizeMemoryScope({ channel: 'x'.repeat(500) });
    expect((n.scope.channel ?? '').length).toBeLessThanOrEqual(64);
  });

  it('completeness distinguishes partial from explicit', () => {
    expect(normalizeMemoryScope({ channel: 'meta' }).completeness).toBe('partial');
    expect(normalizeMemoryScope({
      product: 'p', channel: 'meta', audience_segment: 'smb',
      geography: 'usa', funnel_stage: 'acquisition', timeframe: 'q1',
    }).completeness).toBe('explicit');
  });

  it('the scope key is versioned, so changing normalization changes the key', () => {
    expect(SCOPE_POLICY_VERSION).toBe(1);
    expect(scopeKey({ channel: 'meta' })).toMatch(/^[a-f0-9]{64}$/);
  });

  it('unknown scope is not governed and may not create new memory', () => {
    expect(isGovernedScope('unknown')).toBe(false);
    expect(isGovernedScope('partial')).toBe(true);
    expect(isGovernedScope('explicit')).toBe(true);
  });
});

// ── §5 scope comparison ──────────────────────────────────────────────────────
describe('§5 scope comparison', () => {
  const s = (o: MemoryScope) => o;

  it('same scope', () => {
    expect(compareMemoryScope(s({ channel: 'meta' }), s({ channel: 'meta' }))).toBe('same');
  });

  it('a different segment is DIFFERENT, not narrower', () => {
    expect(compareMemoryScope(
      s({ audience_segment: 'smb' }), s({ audience_segment: 'enterprise' }))).toBe('different');
  });

  it('different product / channel / geography / timeframe all read as different', () => {
    const pairs: Array<[MemoryScope, MemoryScope]> = [
      [{ product: 'a' }, { product: 'b' }],
      [{ channel: 'meta' }, { channel: 'google_ads' }],
      [{ geography: 'usa' }, { geography: 'india' }],
      [{ timeframe: 'q1' }, { timeframe: 'q3' }],
    ];
    for (const [a, b] of pairs) {
      expect(compareMemoryScope(a, b), JSON.stringify(a)).toBe('different');
    }
  });

  it('binding MORE dimensions is narrower; binding fewer is broader', () => {
    const general = s({ channel: 'google_ads' });
    const specific = s({ channel: 'google_ads', audience_segment: 'enterprise' });
    expect(compareMemoryScope(general, specific)).toBe('narrower');
    expect(compareMemoryScope(specific, general)).toBe('broader');
  });

  it('ANY is not UNKNOWN — the distinction that protects exceptions', () => {
    const any = s({ channel: 'meta' });                       // segment ANY
    const unknown = s({ channel: 'meta', audience_segment: SCOPE_UNKNOWN });
    expect(compareMemoryScope(any, s({ channel: 'meta', audience_segment: 'smb' }))).toBe('narrower');
    // An unknown dimension makes the relation undecidable, never "same".
    expect(compareMemoryScope(unknown, s({ channel: 'meta', audience_segment: 'smb' }))).toBe('unknown');
  });

  it('specificity counts BOUND dimensions only', () => {
    expect(scopeSpecificity({ channel: 'meta', audience_segment: SCOPE_UNKNOWN })).toBe(1);
    expect(scopeSpecificity({})).toBe(0);
  });
});

// ── C12 conservative inheritance ─────────────────────────────────────────────
describe('C12 conservative scope matching', () => {
  it('a memory binding nothing applies broadly', () => {
    expect(scopeMatches({}, { channel: 'meta', audience_segment: 'smb' })).toBe(true);
  });

  it('a segment-bound memory never answers a different-segment question', () => {
    expect(scopeMatches({ audience_segment: 'enterprise' }, { audience_segment: 'smb' })).toBe(false);
  });

  it('a query silent on a dimension does not exclude a memory bound on it', () => {
    // The memory is more specific than the question; it still applies.
    expect(scopeMatches({ channel: 'meta' }, { audience_segment: 'smb' })).toBe(true);
  });

  it('product A learning does not transfer to product B', () => {
    expect(scopeMatches({ product: 'A' }, { product: 'B' })).toBe(false);
  });

  it('geography-specific evidence does not escape its geography', () => {
    expect(scopeMatches({ geography: 'india' }, { geography: 'usa' })).toBe(false);
  });

  it('an unknown-scope memory matches nothing automatically (C11)', () => {
    expect(scopeMatches({ channel: SCOPE_UNKNOWN }, { channel: 'meta' })).toBe(false);
  });
});

// ── C13 scoped exceptions ────────────────────────────────────────────────────
describe('C13 scoped-exception detection', () => {
  it('binding a dimension the general leaves open IS an exception', () => {
    expect(isScopedExceptionOf(
      { channel: 'google_ads', audience_segment: 'enterprise' },
      { channel: 'google_ads' })).toBe(true);
  });

  it('an equally-specific opposing claim is NOT an exception — it is a contradiction', () => {
    expect(isScopedExceptionOf({ channel: 'meta' }, { channel: 'google_ads' })).toBe(false);
  });

  it('a broader claim is not an exception to a narrower one', () => {
    expect(isScopedExceptionOf(
      { channel: 'google_ads' },
      { channel: 'google_ads', audience_segment: 'enterprise' })).toBe(false);
  });

  it('an unknown-scope general memory can never host an exception', () => {
    expect(isScopedExceptionOf(
      { channel: 'meta', audience_segment: 'enterprise' },
      { channel: SCOPE_UNKNOWN })).toBe(false);
  });

  it('renders for owner-facing explanation (C23)', () => {
    expect(describeScope({ channel: 'meta', audience_segment: 'enterprise' }))
      .toBe('audience segment: enterprise, channel: meta');
    expect(describeScope({})).toBe('applies generally');
  });
});

// ── §2/§30 authority ─────────────────────────────────────────────────────────
describe('§2 authority is granted from authenticated provenance', () => {
  it('an authenticated founder gets founder authority', () => {
    expect(authorityForCandidate({ actorType: 'founder', kind: 'onboarding' }).tier)
      .toBe('FOUNDER_ASSERTED');
    expect(authorityForCandidate({ actorType: 'founder', kind: 'ui', founderConfirmed: true }).tier)
      .toBe('FOUNDER_CONFIRMED');
  });

  it('a controlled experiment gets its own tier — the C4 addition', () => {
    expect(authorityForCandidate({
      actorType: 'system', kind: 'experiment_result', controlledExperiment: true }).tier)
      .toBe('EXPERIMENT_CONTROLLED');
    // Without a declared control it is only an observation.
    expect(authorityForCandidate({ actorType: 'system', kind: 'experiment_result' }).tier)
      .toBe('OBSERVED_FIRST_PARTY');
  });

  it('provider data is first-party observation, never founder authority', () => {
    expect(authorityForCandidate({ actorType: 'system', kind: 'connection_insight' }).tier)
      .toBe('OBSERVED_FIRST_PARTY');
  });

  it('unknown provenance falls to the WEAKEST usable tier, not a convenient default', () => {
    expect(authorityForCandidate({ actorType: 'system', kind: 'mystery' }).tier)
      .toBe('DERIVED_INFERENCE');
  });

  it('§30 — a system/ai actor can NEVER obtain founder authority', () => {
    // The forge test. Claim text is irrelevant: tier comes from the actor.
    for (const actor of ['system', 'ai'] as const) {
      for (const kind of ['connection_insight', 'campaign_result', 'onboarding', 'ai_conversation']) {
        const t = authorityForCandidate({
          actorType: actor, kind, founderConfirmed: true, controlledExperiment: false }).tier;
        expect(isFounderAuthority(t), `${actor}/${kind} must not be founder authority`).toBe(false);
      }
    }
  });

  it('stamps the policy version on every grant', () => {
    expect(authorityForCandidate({ actorType: 'system', kind: 'connection_insight' }).policyVersion)
      .toBe(AUTHORITY_POLICY_VERSION);
  });
});

describe('authority precedence', () => {
  it('is strictly ordered strongest to weakest', () => {
    const ranks = AUTHORITY_TIERS.map(authorityRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('equal authority never auto-overrides', () => {
    expect(mayAutoOverride('OBSERVED_FIRST_PARTY', 'OBSERVED_FIRST_PARTY')).toBe(false);
  });

  it('a controlled experiment now outranks a passive observation — impossible before C4', () => {
    expect(mayAutoOverride('OBSERVED_FIRST_PARTY', 'EXPERIMENT_CONTROLLED')).toBe(true);
    expect(mayAutoOverride('EXPERIMENT_CONTROLLED', 'OBSERVED_FIRST_PARTY')).toBe(false);
  });

  it('nothing non-founder may auto-override founder authority', () => {
    for (const t of AUTHORITY_TIERS.filter(x => !isFounderAuthority(x))) {
      expect(mayAutoOverride('FOUNDER_ASSERTED', t), t).toBe(false);
      expect(requiresFounderReview('FOUNDER_ASSERTED', t), t).toBe(true);
    }
  });

  it('only founder and controlled-experiment authority skip corroboration (C6)', () => {
    expect(qualifiesForImmediateActive('FOUNDER_ASSERTED')).toBe(true);
    expect(qualifiesForImmediateActive('FOUNDER_CONFIRMED')).toBe(true);
    expect(qualifiesForImmediateActive('EXPERIMENT_CONTROLLED')).toBe(true);
    for (const t of ['OBSERVED_FIRST_PARTY', 'DERIVED_INFERENCE', 'ANONYMIZED_PLAYBOOK'] as const) {
      expect(qualifiesForImmediateActive(t), t).toBe(false);
    }
  });
});

// ── §26 authority history ────────────────────────────────────────────────────
describe('§26 historical authority is READ, never re-derived', () => {
  it('a persisted tier is returned verbatim, regardless of the current mapping', () => {
    const h = historicalAuthority('FOUNDER_ASSERTED', 1, 'growth_brain');
    // The legacy source would map to DERIVED_INFERENCE. The persisted tier wins.
    expect(h.tier).toBe('FOUNDER_ASSERTED');
    expect(h.policyVersion).toBe(1);
    expect(h.reconstructed).toBe(false);
  });

  it('a pre-3.2A row is reconstructed AND flagged as such', () => {
    const h = historicalAuthority(null, null, 'founder_feedback');
    expect(h.tier).toBe('FOUNDER_ASSERTED');
    expect(h.reconstructed).toBe(true);
    // A caller can tell a recorded tier from a guessed one, which is the point.
    expect(h.policyVersion).toBeNull();
  });

  it('an unrecognised persisted tier falls back rather than trusting it', () => {
    expect(historicalAuthority('NOT_A_TIER', 1, 'analytics').reconstructed).toBe(true);
  });

  it('a v1 decision still reports v1 after the mapping changes to v2', () => {
    // Simulates the §26 requirement directly: the stored pair is the record.
    const stored = { tier: 'EXPERIMENT_CONTROLLED', version: 1 };
    const laterMappingWouldSay = authorityForCandidate({
      actorType: 'system', kind: 'experiment_result' }).tier;   // OBSERVED_FIRST_PARTY
    expect(laterMappingWouldSay).not.toBe(stored.tier);
    const h = historicalAuthority(stored.tier, stored.version, 'experiment');
    expect(h.tier).toBe('EXPERIMENT_CONTROLLED');
    expect(h.policyVersion).toBe(1);
  });
});
