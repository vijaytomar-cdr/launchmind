import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recognitionThesis, repairVisualThesis, buildScenePlan, type CreativeCritique } from '../src/services/creative/scenePlan';
import { problemScenePrompt } from '../src/services/creative/productComposition';
import { createCreativeDiagnostics } from '../src/services/creative/creativeDiagnostics';
const thesis = recognitionThesis('Connect with home-service professionals', "Home projects shouldn't start on hold.")!;
const literal = recognitionThesis('Connect with home-service professionals', 'Still waiting on that callback?', 'STALLED_PROJECT')!;
const fail = (summary: string): CreativeCritique => ({summary, outcome:'NEEDS_CREATIVE_REVISION', checks:{composition:'NEEDS_ATTENTION'}});
afterEach(() => vi.unstubAllEnvs());
it('grounds a concrete thesis in the problem context and refuses unrelated industries', () => {
  expect(thesis.type).toBe('WAITING_FOR_HELP');
  expect(recognitionThesis('Home services', "Shouldn't home services feel easier?")?.type).toBe('WAITING_FOR_HELP');
  expect(thesis.scenePattern).toBe('WAITING_SEATED');
  expect(thesis.scene).toContain('person is the dominant photographic subject');
  expect(thesis.scene).not.toMatch(/hinge|screws|recess/);
  expect(thesis.marketingProblem).toContain('Arranging home-service help');
  expect(recognitionThesis('Analytics for agencies', 'Still waiting on data?')).toBeNull();
  expect(buildScenePlan({conceptLabel:'Problem recognition',channel:'META_AD',recognitionContext:'residential repair',governedHeadline:'Home projects on hold'})?.visualThesis).toEqual(thesis);
});
it('describes two deliberate scenes with all semantic and text exclusions in the positive prompt', () => {
  for (const t of [thesis, repairVisualThesis(thesis, fail('Wrong industry cooking scene')).thesis]) {
    const p = problemScenePrompt(t);
    for (const word of [t.type,'residential living room','homeowner','Cooking','Restaurant','Office work','Beauty','Medical','NO readable text','pseudo-text','labels','signs','UI','app screens','logos','letters','numbers','watermarks','typography','branded marks']) expect(p).toContain(word);
    expect(p).not.toMatch(/rightmost|lower two thirds|upper third/);
  }
});
it.each(['Wrong industry and unrelated objects', 'Cooking-like imagery', 'The image does not reinforce the hook', 'Weak relationship to the hook', 'Invented scene meaning'])('switches semantic failure: %s', summary => {
  const repaired = repairVisualThesis(literal, fail(summary));
  expect(repaired.regenerate).toBe(true);
  expect(repaired.thesis.type).toBe('STALLED_PROJECT');
  expect(repaired.thesis.scenePattern).toBe('PAUSED_WALL_PAINT');
  expect(repairVisualThesis(repaired.thesis, fail(summary)).thesis.type).toBe('WAITING_FOR_HELP');
});
it('text artifacts regenerate the scene; deterministic layout defects reuse it', () => {
  expect(repairVisualThesis(thesis, fail('Invented lettering on the wall')).regenerate).toBe(true);
  for (const s of ['Headline too small', 'CTA isolated; excess whitespace', 'Product too small', 'Crop weak']) expect(repairVisualThesis(thesis, fail(s)).regenerate).toBe(false);
});
it('retains private rejected pixels and counts only in development, bounded by attempts and jobs', async () => {
  const root = await mkdtemp(join(tmpdir(),'creative-diagnostics-'));
  try {
    vi.stubEnv('NODE_ENV','production');
    expect(await createCreativeDiagnostics('job','workspace',root)).toBeNull();
    expect(await readdir(root)).toEqual([]);
    vi.stubEnv('NODE_ENV','development');
    for(let i=0;i<12;i++) {
      const d=await createCreativeDiagnostics(`job-${i}`,'workspace',root);
      await d!.write(1,{status:'REJECTED',visualThesis:thesis,critique:fail('Wrong scene')},
        {providerCalls:1,pixelCritiqueCalls:1,layoutOnlyRecompositions:0,semanticRegenerations:0},Buffer.from('test-candidate'),Buffer.from('raw-background'));
    }
    expect((await readdir(root)).length).toBe(10);
    expect(await readFile(join(root,'workspace-job-11/attempt-1.png'),'utf8')).toBe('test-candidate');
    expect(await readFile(join(root,'workspace-job-11/attempt-1-background.png'),'utf8')).toBe('raw-background');
    expect(JSON.parse(await readFile(join(root,'workspace-job-11/attempt-1.json'),'utf8')).status).toBe('REJECTED');
    const d=await createCreativeDiagnostics('bound','workspace',root);
    await expect(d!.write(4,{}, {providerCalls:0,pixelCritiqueCalls:0,layoutOnlyRecompositions:0,semanticRegenerations:0})).rejects.toThrow('bound');
  } finally {await rm(root,{recursive:true,force:true});}
});

it('semantic context failure changes the large project pattern, while layout repair preserves it', () => {
 const failed = {...fail('The room looks finished'), checks:{semanticContext:'NEEDS_ATTENTION' as const}};
 const second=repairVisualThesis(literal,failed).thesis;
 expect(second.scenePattern).toBe('PAUSED_WALL_PAINT');
 expect(second.scene).toContain('ragged roller edge');
 expect(second.scene).toContain('not a finished two-tone');
 expect(second.forbiddenSubjects.join(' ')).not.toContain('paint rollers');
 expect(repairVisualThesis(second,fail('CTA too far away')).thesis).toEqual(second);
 expect(problemScenePrompt(thesis)).toContain('readable at feed size');
 expect(problemScenePrompt(thesis)).toContain('quiet pale left field');
});

it('credibility failures exhaust the metaphor even across two different literal patterns', () => {
 const credibility={...fail('Artificial decorative panel'),checks:{authenticity:'NEEDS_ATTENTION' as const}};
 const first=repairVisualThesis(literal,credibility);
 expect(first.thesis.directionFailures).toBe(1);
 const second=repairVisualThesis(first.thesis,credibility);
 expect(second.reason).toContain('Creative-direction pivot');
 expect(second.thesis.type).toBe('WAITING_FOR_HELP');
});
it('human direction never returns to literal repair and only changes execution after repeated weakness', () => {
 let current=thesis;
 const weak={...fail('Emotion is unreadable'),checks:{semanticContext:'NEEDS_ATTENTION' as const}};
 current=repairVisualThesis(current,weak).thesis;
 expect(current.scenePattern).toBe('WAITING_SEATED');
 current=repairVisualThesis(current,weak).thesis;
 expect(current.scenePattern).toBe('WAITING_STANDING');
 for(let i=0;i<3;i++){
  expect(current.type).toBe('WAITING_FOR_HELP');
  const prompt=problemScenePrompt(current);
  expect(prompt).not.toMatch(/drywall|wall patch|hinge|broken door|paint patch|unfinished repair/i);
  expect(prompt).toContain('plain unmarked back of the phone');
  current=repairVisualThesis(current,weak).thesis;
 }
});
it('layout execution repair does not consume a direction-failure assessment', () => {
 const once=repairVisualThesis(literal,{...fail('Not believable'),checks:{authenticity:'NEEDS_ATTENTION'}}).thesis;
 const layout=repairVisualThesis(once,fail('CTA too small'));
 expect(layout.regenerate).toBe(false);expect(layout.thesis.directionFailures).toBe(1);
});
