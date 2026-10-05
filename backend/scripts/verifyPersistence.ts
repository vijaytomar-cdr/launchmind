/** §11/§12 — persistence, reload, isolation, freshness, retraction. */
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import { activePatterns, listObservations, retractPattern }
  from '../src/services/creativeIntelligence/creativeIntelligenceService';
const db = getSupabaseAdmin();
async function main(){
  const { data: prods } = await db.from('products').select('id,name,workspace_id');
  const ax: any = (prods ?? []).find((p: any) => /allign/i.test(p.name))!;
  const ws = ax.workspace_id;

  const obs = await listObservations(ws);
  console.log('observations reloaded:', obs.length,
    '| publishers:', new Set(obs.map(o => o.publisher)).size);
  const pat = await activePatterns(ws, 'home_services');
  console.log('active patterns reloaded:', pat.length);
  console.log('freshness states:', JSON.stringify(
    pat.reduce((m: any, p) => { m[p.quality.freshness] = (m[p.quality.freshness] ?? 0) + 1; return m; }, {})));
  console.log('all >= 3 independent sources:', pat.every(p => p.independentSourceCount >= 3));

  // ISOLATION: a different workspace must see none of them.
  const { data: others } = await db.from('workspaces').select('id').neq('id', ws).limit(1);
  if (others?.length) {
    const foreign = await activePatterns((others[0] as any).id, 'home_services');
    const foreignObs = await listObservations((others[0] as any).id);
    console.log('another workspace sees:', foreign.length, 'patterns /', foreignObs.length, 'observations');
  } else console.log('no second workspace to test isolation against');

  // RETRACTION: withdrawn from influence, retained in the record.
  const key = pat[0]?.key;
  if (key) {
    await retractPattern(ws, key, 'probe: verifying retraction');
    const after = await activePatterns(ws, 'home_services');
    console.log(`retracted ${key} -> active now ${after.length} (was ${pat.length})`,
      '| still in table:', !!(await db.from('creative_patterns').select('id')
        .eq('workspace_id', ws).eq('pattern_key', key).maybeSingle()).data);
    // restore
    await db.from('creative_patterns').update({ retracted_at: null, retraction_reason: null })
      .eq('workspace_id', ws).eq('pattern_key', key);
    console.log('restored:', (await activePatterns(ws, 'home_services')).length, 'active');
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
