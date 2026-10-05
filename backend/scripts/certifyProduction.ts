/**
 * Gate 1 developer certification. It deliberately uses the same authenticated
 * HTTP routes as an owner action; it owns no generation, governance or writes.
 */
import { createClient } from '@supabase/supabase-js';
import WS from 'ws';

if (!('WebSocket' in globalThis)) Object.assign(globalThis, { WebSocket: WS });

async function main() {
const planningId = process.argv[2];
if (!planningId) throw new Error('Usage: npm run certify:production -- <planning-id>');
const base = process.env.API_URL ?? 'http://localhost:3001';
const url = process.env.SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = process.env.TEST_EMAIL, password = process.env.TEST_PASSWORD;
if (!url || !anon || !email || !password) throw new Error('Certification credentials are not configured');

const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await auth.auth.signInWithPassword({ email, password });
if (error || !data.session) throw new Error(`PRECHECK: authentication failed: ${error?.message ?? 'no session'}`);
const headers = { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' };
async function call(path: string, method = 'GET') {
  const r = await fetch(`${base}${path}`, { method, headers, body: method === 'POST' ? '{}' : undefined });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

const plan = await call(`/studio/governed/planning/${planningId}`);
if (plan.status !== 200) throw new Error(`PLANNING: ${plan.status}`);
const prep = await call(`/studio/governed/planning/${planningId}/production-contract`, 'POST');
if (prep.status !== 200 || !prep.body.canGenerate) throw new Error(`PRODUCTION_CONTRACT: ${prep.status}`);
console.log(`PREFLIGHT PASS\nPlanning: ${planningId}\nConcept: ${plan.body.handoff?.concept?.family}\ncanGenerate: true`);

const run = await call(`/studio/governed/planning/${planningId}/generate`, 'POST');
const final = await call(`/studio/governed/planning/${planningId}`);
const generation = final.body.generation;
console.log(JSON.stringify({
  stage: generation?.status === 'READY_FOR_REVIEW' ? 'COMPLETE' : 'GENERATION',
  result: generation?.status ?? 'SYSTEM_FAILURE', runStatus: run.status,
  generation, artifact: final.body.content ?? null,
}, null, 2));
if (generation?.status !== 'READY_FOR_REVIEW' || !final.body.content) process.exitCode = 1;
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
