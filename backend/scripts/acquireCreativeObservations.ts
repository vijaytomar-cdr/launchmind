/**
 * @file acquireCreativeObservations.ts
 * @description Records the REAL public creative observations gathered for
 *   Phase 3.5B6.5 §32, and re-derives this workspace's patterns.
 *
 *   EVERY ROW BELOW WAS ACTUALLY OBSERVED. Each `sourceRef` is a public,
 *   unauthenticated page that was fetched on `observedAt`, and every structural
 *   field is what that fetch reported. Nothing here is illustrative and nothing
 *   was invented to make a pattern reach its threshold — angi.com returned HTTP
 *   403 and is therefore ABSENT rather than guessed at, which is why the
 *   landing-page corpus is five publishers and not six.
 *
 *   NO COPY, NO IMAGES, NO BYTES were taken from any of these pages. The
 *   observation schema has nowhere to put them.
 *
 * @security Writes only creative_observations and creative_patterns, both of
 *   which are server-written by design. Touches no owner content.
 */

import { recordObservations } from '../src/services/creativeIntelligence/creativeIntelligenceService';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';


/** Public brand landing pages, fetched directly. */
import { LANDING, VIDEO } from './creativeObservationCorpus';

async function main() {
  const competitorsAll = ['TaskRabbit', 'Thumbtack', 'Handy', 'Care.com',
                          'Angi', "Angie's List", 'ServiceTitan', 'HomeAdvisor'];

  // PURE MODE. Derivation is where every decision lives — the independence
  // rule, the abstraction check, the confidence ceiling — and none of it needs
  // a database. Running it without one proves the pipeline on its own terms,
  // and is the only honest thing to do while migration 122 is unapplied.
  if (process.argv.includes('--pure')) {
    const { derivePatterns } = await import('../src/services/creativeIntelligence/patternDerivation');
    const { validateObservation } = await import('../src/services/creativeIntelligence/creativeIntelligenceService');
    const obs = [...LANDING, ...VIDEO].map((o, i) =>
      ({ ...validateObservation(o), id: `obs-${i}` }));
    const { patterns, rejected } = derivePatterns(obs, competitorsAll);
    console.log(`observations validated: ${obs.length}`);
    console.log(`\npatterns standing: ${patterns.length}`);
    for (const p of patterns) {
      console.log(`  ${p.key.padEnd(40)} sources=${p.independentSourceCount} ` +
        `channel=${p.channel ?? 'mixed'} conf=${p.quality.observationConfidence} ` +
        `fresh=${p.quality.freshness}`);
      console.log(`      ${p.description}`);
    }
    console.log(`\ncandidates REFUSED: ${rejected.length}`);
    for (const r of rejected) console.log(`  ${r.key.padEnd(40)} ${r.reason}`);
    return;
  }

  const db = getSupabaseAdmin();
  const { data: prods } = await db.from('products').select('id, name, workspace_id');
  const ax = (prods ?? []).find((p: { name: string }) => /allign/i.test(p.name)) as
    { id: string; workspace_id: string } | undefined;
  if (!ax) { console.error('AllignX product not found'); process.exit(1); }

  const competitors = ['TaskRabbit', 'Thumbtack', 'Handy', 'Care.com',
                       'Angi', "Angie's List", 'ServiceTitan', 'HomeAdvisor'];

  const res = await recordObservations(
    ax.workspace_id, ax.id, [...LANDING, ...VIDEO], competitors);

  console.log(`accepted ${res.accepted} observations`);
  for (const r of res.rejected) console.log('  REJECTED', r.sourceRef, '—', r.reason);
  console.log(`\npatterns standing: ${res.patterns.length}`);
  for (const p of res.patterns) {
    console.log(`  ${p.key.padEnd(42)} sources=${p.independentSourceCount} ` +
      `channel=${p.channel ?? 'mixed'} conf=${p.quality.observationConfidence} ` +
      `fresh=${p.quality.freshness}`);
    console.log(`      ${p.description}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
