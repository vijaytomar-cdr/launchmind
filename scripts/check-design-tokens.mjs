#!/usr/bin/env node
/**
 * @file check-design-tokens.mjs
 * @description Compares the `:root` design tokens in app/globals.css against the
 *   approved UX HTML, and exits non-zero on any drift.
 *
 *   This is the half of visual regression that needs no browser, no server, and no
 *   credentials, so it can gate every PR. A screenshot diff cannot tell you that
 *   `--sage` changed by one hex digit across forty components; this can, and it
 *   fails with the exact token name.
 *
 *   Screenshot baselines remain a separate, environment-dependent job.
 *
 * Usage: node scripts/check-design-tokens.mjs
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS  = join(ROOT, 'app', 'globals.css');

/**
 * Resolves the approved UX file. The revision suffix changes as the design is
 * revised, so the highest-numbered file wins rather than a hard-coded name that
 * silently goes stale.
 */
function approvedHtmlPath() {
  const candidates = readdirSync(ROOT)
    .filter(f => /^LaunchMind_Production_UX_.*\.html$/.test(f))
    .map(f => ({ f, n: Number((f.match(/\((\d+)\)/) ?? [])[1] ?? 0) }))
    .sort((a, b) => b.n - a.n);
  if (candidates.length === 0) throw new Error('No approved UX HTML found in the repository root.');
  return join(ROOT, candidates[0].f);
}

/** Extracts `--token: value` declarations from the first :root block. */
function specTokens(text) {
  const block = text.match(/:root\s*\{([\s\S]*?)\}/);
  if (!block) throw new Error('No :root block found in the approved HTML.');
  const out = {};
  for (const decl of block[1].split(';')) {
    const m = decl.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/\s+/g, ' ').trim();
  }
  return out;
}

/**
 * globals.css interleaves comments inside :root, and a brace-bounded regex can end
 * early on one of them, so declarations are scanned line by line.
 */
function cssTokens(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(--[\w-]+)\s*:\s*([^;]+);/);
    if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/\s+/g, ' ').trim();
  }
  return out;
}

/** `#fff` and `#ffffff` are the same colour; failing on spelling trains people to ignore this. */
function normalize(v) {
  const s = String(v).trim().toLowerCase();
  const short = s.match(/^#([0-9a-f]{3})$/);
  if (short) {
    const [r, g, b] = short[1];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return s;
}

/** Tokens the dashboard surfaces actually consume. */
const CHECKED = [
  '--page', '--surface', '--raised', '--ink', '--ink2', '--ink3',
  '--border', '--border2', '--sage', '--sage2', '--sage3',
  '--nav', '--amber', '--amber2', '--danger', '--danger2',
  '--violet', '--violet2', '--blue', '--blue2',
  '--r1', '--r2', '--r3',
];

const htmlPath = approvedHtmlPath();
if (!existsSync(CSS)) { console.error(`Missing ${CSS}`); process.exit(1); }

const spec = specTokens(readFileSync(htmlPath, 'utf8'));
const app  = cssTokens(readFileSync(CSS, 'utf8'));

const drift = [];
let checked = 0;
for (const token of CHECKED) {
  if (!(token in spec)) continue;          // not defined in the approved file
  checked++;
  if (normalize(app[token]) !== normalize(spec[token])) {
    drift.push({ token, approved: spec[token], actual: app[token] ?? '(missing)' });
  }
}

console.log(`Design tokens checked against ${htmlPath.split('/').pop()}`);
console.log(`${checked - drift.length}/${checked} match`);

if (drift.length > 0) {
  console.error('\nDRIFT:');
  for (const d of drift) console.error(`  ${d.token}: approved=${d.approved} actual=${d.actual}`);
  process.exit(1);
}
