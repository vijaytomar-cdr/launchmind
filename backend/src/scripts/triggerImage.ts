// Load .env.local the same way server.ts does (no dotenv dependency needed)
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
const envPath = resolve(__dirname, '../../../.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { generateImageFromBrief } from '../services/contentService';

async function main() {
  const ASSET_ID = process.argv[2] ?? '68feb722-bfb6-4c44-b665-158b2a7ba23b';
  const STYLE    = (process.argv[3] ?? 'mockup') as 'photorealistic' | 'graphic' | 'mockup';

  const { data, error } = await getSupabaseAdmin()
    .from('content_assets').select('founder_id, asset_type').eq('id', ASSET_ID).single();
  if (error || !data) { console.error('Asset not found:', error?.message); process.exit(1); }

  console.log(`Asset: ${data.asset_type}, Founder: ${data.founder_id}`);
  console.log(`Generating ${STYLE} image (AllignX logo will be composited)…`);
  await generateImageFromBrief(ASSET_ID, data.founder_id as string, { style: STYLE });
  console.log('Done ✓');
}

main().catch(e => { console.error(e); process.exit(1); });
