/** Applies the REAL derived patterns to the REAL AllignX message. */
import { derivePatterns } from '../src/services/creativeIntelligence/patternDerivation';
import { buildCreativeDirection, summariseDirection } from '../src/services/creativeIntelligence/creativeInfluence';
import { LANDING, VIDEO } from './creativeObservationCorpus';

const obs = [...LANDING, ...VIDEO].map((o, i) => ({ ...o, id: `o${i}` }));
const { patterns } = derivePatterns(obs as never, ['TaskRabbit','Thumbtack','Handy','Angi','HomeAdvisor']);

const MSG = 'Lean into the universally recognized absurdity of home service coordination — hold music, three-day callback windows, contractors who disappear — framed as a problem that does not have to exist';

for (const channel of ['meta_ad', 'short_form_video', 'landing_page']) {
  const d = buildCreativeDirection({ patterns, messageAngle: MSG, channel,
    brandDirectives: ['Plain, unhurried, never hyperbolic'] });
  const s = summariseDirection(d);
  console.log(`\n=== ${channel} ===`);
  console.log('recommends:', s.recommends.join(' · ') || '(none)');
  console.log('why:', s.why ?? '(none)');
  console.log('limitation:', s.limitation ?? '(none)');
  console.log('influences:');
  for (const i of d.influences) console.log(`   [${i.dimension}] ${i.directive}\n      → ${i.ownerRationale}`);
  console.log('notImitated:', JSON.stringify(d.notImitated, null, 1));
}

// NEGATIVE: a message with nothing in common with the corpus.
const d2 = buildCreativeDirection({ patterns, messageAngle: 'quarterly compliance reporting for auditors', channel: 'meta_ad' });
console.log('\n=== irrelevant message ===');
console.log('influences:', d2.influences.length, '| limitation:', d2.limitation ?? '(none)');

// NEGATIVE: no patterns at all.
const d3 = buildCreativeDirection({ patterns: [], messageAngle: MSG, channel: 'meta_ad' });
console.log('\n=== no creative intelligence ===');
console.log('influences:', d3.influences.length, '| limitation:', d3.limitation);
