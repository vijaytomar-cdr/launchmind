/**
 * @file threeSignalContractFreeze.test.ts
 * @description The three-signal V2 contract freeze, made re-derivable.
 *
 *   P1-40: the V3 classifier hash `880e99cda2d9e158` was recorded as a literal
 *   and its RECIPE was never written down, so "V3 is preserved" could not be
 *   re-derived from the code — only asserted from memory. A frozen number
 *   nobody can recompute is a claim, not a control.
 *
 *   This test IS the recipe. It recomputes the hash from the named files, in the
 *   named order, and fails if either the hash or the file list drifts. Changing
 *   claim behaviour now requires changing this file, which is the point: an
 *   evaluation corpus is only held out with respect to a contract that cannot
 *   move underneath it.
 *
 * @security No network, no database.
 * @dependencies claimGates fixture, the seven contract files
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  THREE_SIGNAL_CONTRACT_HASH, THREE_SIGNAL_CONTRACT_HASH_V2,
  THREE_SIGNAL_CONTRACT_FILES, V3_FILE_DIGESTS,
} from './fixtures/content/claimGates';

const DIR = join(__dirname, '../src/services/content');
const digest = (buf: Buffer | string) =>
  createHash('sha256').update(buf).digest('hex').slice(0, 16);

describe('three-signal V2 contract freeze', () => {
  it('the recorded hash is reproducible from the recorded recipe', () => {
    // RECIPE, in one line, identical to the shell form documented in claimGates:
    //   cat <THREE_SIGNAL_CONTRACT_FILES in order> | shasum -a 256 | cut -c1-16
    const concatenated = Buffer.concat(
      THREE_SIGNAL_CONTRACT_FILES.map(f => readFileSync(join(DIR, f))));
    expect(digest(concatenated)).toBe(THREE_SIGNAL_CONTRACT_HASH_V2);
    expect(THREE_SIGNAL_CONTRACT_HASH).toBe(THREE_SIGNAL_CONTRACT_HASH_V2);
  });

  it('the contract covers every surface that can change claim behaviour', () => {
    // Named individually so a file cannot be dropped from the freeze quietly.
    for (const required of [
      'generatorClaimDeclaration.ts',   // declaration contract + DECLARATION_PROMPT + validation
      'threeSignalClaimDiscovery.ts',   // union/merge + grounding composition + failure behaviour
      'governedContentGeneration.ts',   // production composition + generation prompt
      'hybridClaimDetection.ts',        // V3 union of deterministic and semantic
      'copyClaimClassifier.ts',         // V3 deterministic arm
      'semanticClaimClassifier.ts',     // V3 semantic arm + its prompt
      'contentClaimPolicy.ts',          // claim policy dependency
    ]) {
      expect(THREE_SIGNAL_CONTRACT_FILES as readonly string[]).toContain(required);
    }
    expect(THREE_SIGNAL_CONTRACT_FILES).toHaveLength(7);
  });

  it('the V3 arm is byte-identical to its pinned digests', () => {
    for (const [file, expected] of Object.entries(V3_FILE_DIGESTS)) {
      expect(digest(readFileSync(join(DIR, file))), `${file} changed`).toBe(expected);
    }
  });
});
