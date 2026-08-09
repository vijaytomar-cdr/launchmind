#!/usr/bin/env node
/**
 * @file check-oci-vault.mjs
 * @description Pre-flight for the OCI credential vault.
 *
 *   Checks everything that must be true BEFORE `npm run test:vault` can pass, and
 *   says exactly which piece is missing. Running the test suite first tells you only
 *   that it skipped; this tells you why.
 *
 *   Prints NO secret values — field names and pass/fail only. The key fingerprint is
 *   shown because it is a public identifier you need to match against the console.
 *
 * Usage: node scripts/check-oci-vault.mjs
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const ok   = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad  = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
let failures = 0;
const fail = (m) => { bad(m); failures++; };

console.log('\nOCI credential vault — pre-flight\n');

// ── 1. ~/.oci/config ─────────────────────────────────────────────────────────
console.log('1. OCI config file');
const configPath = process.env.OCI_CONFIG_FILE || join(homedir(), '.oci', 'config');
const profile    = process.env.OCI_CONFIG_PROFILE || 'DEFAULT';

let cfg = {};
if (!existsSync(configPath)) {
  fail(`${configPath} does not exist`);
} else {
  ok(`${configPath} exists`);

  // Parse the requested profile only.
  const text = readFileSync(configPath, 'utf8');
  let current = null;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const section = t.match(/^\[(.+)\]$/);
    if (section) { current = section[1]; continue; }
    if (current !== profile) continue;
    const i = t.indexOf('=');
    if (i > 0) cfg[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }

  if (Object.keys(cfg).length === 0) fail(`profile [${profile}] not found in the config file`);
  else ok(`profile [${profile}] found`);

  for (const field of ['tenancy', 'user', 'fingerprint', 'key_file', 'region']) {
    if (cfg[field]) {
      // fingerprint is a public identifier — showing it helps match the console entry.
      ok(`${field} present${field === 'fingerprint' ? ` (${cfg[field]})` : ''}`);
    } else {
      fail(`${field} missing from [${profile}]`);
    }
  }

  // ── 2. private key ─────────────────────────────────────────────────────────
  console.log('\n2. API signing key');
  if (cfg.key_file) {
    const keyPath = cfg.key_file.replace(/^~/, homedir());
    if (!existsSync(keyPath)) {
      fail(`key_file points at ${keyPath}, which does not exist`);
    } else {
      ok('key_file exists');
      const mode = statSync(keyPath).mode & 0o777;
      if (mode & 0o077) {
        // The OCI SDK refuses a key readable by anyone else.
        fail(`key file permissions are ${mode.toString(8)} — run: chmod 600 ${keyPath}`);
      } else {
        ok(`key file permissions are ${mode.toString(8)}`);
      }
      const head = readFileSync(keyPath, 'utf8').slice(0, 40);
      if (!head.includes('PRIVATE KEY')) fail('key_file does not look like a PEM private key');
      else ok('key file is a PEM private key');
    }
  }
}

// ── 3. environment ───────────────────────────────────────────────────────────
console.log('\n3. Vault environment variables');
const env = {
  OCI_VAULT_AUTH_MODE:       process.env.OCI_VAULT_AUTH_MODE,
  OCI_VAULT_KEY_OCID:        process.env.OCI_VAULT_KEY_OCID,
  OCI_VAULT_CRYPTO_ENDPOINT: process.env.OCI_VAULT_CRYPTO_ENDPOINT,
  OCI_REGION:                process.env.OCI_REGION,
};

const placeholder = (v) => !v || /YOUR_|your_|<|EXAMPLE|xxxx/i.test(v);

if (env.OCI_VAULT_AUTH_MODE !== 'config_file' && env.OCI_VAULT_AUTH_MODE !== 'instance_principal') {
  fail(`OCI_VAULT_AUTH_MODE must be config_file (local) or instance_principal (production) — got ${env.OCI_VAULT_AUTH_MODE || '<unset>'}`);
} else ok(`OCI_VAULT_AUTH_MODE = ${env.OCI_VAULT_AUTH_MODE}`);

if (placeholder(env.OCI_VAULT_KEY_OCID)) fail('OCI_VAULT_KEY_OCID unset or still a placeholder');
else if (!env.OCI_VAULT_KEY_OCID.startsWith('ocid1.key.')) fail('OCI_VAULT_KEY_OCID must start with ocid1.key. — that is the KEY OCID, not the vault OCID');
else ok(`OCI_VAULT_KEY_OCID set (…${env.OCI_VAULT_KEY_OCID.slice(-8)})`);

if (placeholder(env.OCI_VAULT_CRYPTO_ENDPOINT)) fail('OCI_VAULT_CRYPTO_ENDPOINT unset or still a placeholder');
else if (!/^https:\/\//.test(env.OCI_VAULT_CRYPTO_ENDPOINT)) fail('OCI_VAULT_CRYPTO_ENDPOINT must start with https://');
else if (!/-crypto\./.test(env.OCI_VAULT_CRYPTO_ENDPOINT)) {
  // The management endpoint is a very easy thing to copy by mistake, and it fails
  // with a confusing 404 rather than a clear "wrong endpoint".
  warn(`OCI_VAULT_CRYPTO_ENDPOINT has no "-crypto." in it — you may have copied the MANAGEMENT endpoint`);
} else ok(`OCI_VAULT_CRYPTO_ENDPOINT = ${new URL(env.OCI_VAULT_CRYPTO_ENDPOINT).hostname}`);

if (!env.OCI_REGION) fail('OCI_REGION unset');
else ok(`OCI_REGION = ${env.OCI_REGION}`);

// Cross-check: the region in the config and the region in the env should agree.
if (cfg.region && env.OCI_REGION && cfg.region !== env.OCI_REGION) {
  warn(`region mismatch: ~/.oci/config says "${cfg.region}", OCI_REGION says "${env.OCI_REGION}"`);
}
// Cross-check: the crypto endpoint embeds the region too.
if (env.OCI_VAULT_CRYPTO_ENDPOINT && env.OCI_REGION && !env.OCI_VAULT_CRYPTO_ENDPOINT.includes(env.OCI_REGION)) {
  warn(`the crypto endpoint does not contain "${env.OCI_REGION}" — vault and region may not match`);
}

// ── verdict ──────────────────────────────────────────────────────────────────
console.log('');
if (failures === 0) {
  console.log('\x1b[32mReady.\x1b[0m Run the live round trip:\n');
  console.log('  npm run test:vault\n');
  process.exit(0);
}
console.log(`\x1b[31m${failures} item(s) still missing.\x1b[0m See docs/oci-local-setup.md\n`);
process.exit(1);
