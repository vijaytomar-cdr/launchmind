/* eslint-disable security/detect-non-literal-fs-filename -- Fixed private root; scope components validated, no user-supplied filesystem paths. */
import { mkdir, readdir, stat, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

export interface CreativeCallCounts {
  providerCalls: number;
  pixelCritiqueCalls: number;
  layoutOnlyRecompositions: number;
  semanticRegenerations: number;
}

/** Local private evidence only. Never an asset, storage upload, API or owner version. */
export async function createCreativeDiagnostics(jobId: string, workspaceId: string,
  root = resolve(__dirname, '../../../../artifacts/creative-debug')) {
  if ((process.env.NODE_ENV ?? 'development') !== 'development') return null;
  if (![jobId, workspaceId].every(value => /^[a-z0-9-]+$/i.test(value))) throw new Error('Invalid diagnostic scope');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const entries = await readdir(root, { withFileTypes: true });
  const jobs = await Promise.all(entries.filter(e => e.isDirectory() && /^[a-z0-9-]+$/i.test(e.name))
    .map(async e => ({ path: join(root, e.name), age: (await stat(join(root, e.name))).mtimeMs })));
  // At most ten local jobs, at most three bounded candidates each; expire after a day.
  for (const [index, job] of jobs.sort((a, b) => b.age - a.age).entries()) {
    if (index >= 9 || job.age < Date.now() - 86400000) await rm(job.path, { recursive: true, force: true });
  }
  const dir = join(root, `${workspaceId}-${jobId}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return {
    async finish(evidence:object){await writeFile(join(dir,'result.json'),JSON.stringify(evidence,null,2),{mode:0o600});},
    async write(attempt: number, evidence: object, counts: CreativeCallCounts, pixels?: Buffer, background?: Buffer) {
      if (!Number.isInteger(attempt) || attempt < 1 || attempt > 3) throw new Error('Diagnostic attempt outside bound');
      if (background) await writeFile(join(dir, `attempt-${attempt}-background.png`), background, { mode: 0o600 });
      if (pixels) await writeFile(join(dir, `attempt-${attempt}.png`), pixels, { mode: 0o600 });
      await writeFile(join(dir, `attempt-${attempt}.json`), JSON.stringify({ jobId, workspaceId, attempt, ...evidence, counts }, null, 2), { mode: 0o600 });
      await writeFile(join(dir, 'accounting.json'), JSON.stringify({ jobId, workspaceId, ...counts }, null, 2), { mode: 0o600 });
    },
  };
}
