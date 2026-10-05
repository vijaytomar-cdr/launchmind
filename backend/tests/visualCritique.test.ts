import { beforeEach, expect, it, vi } from 'vitest';
import { critiqueRenderedVisual } from '../src/services/creative/visualCritique';
import { buildScenePlan } from '../src/services/creative/scenePlan';
const { call } = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../src/lib/aiPlatform', () => ({ callMessages: call, stripMarkdownFences: (v: string) => v }));
const checks = { semanticContext: 'PASS', backgroundText: 'PASS', conceptClarity: 'PASS', visualHierarchy: 'PASS', legibility: 'PASS',
  composition: 'PASS', brandFit: 'PASS', authenticity: 'PASS', noInventedClaims: 'PASS' };
const input = { bytes: Buffer.from('final pixels'),
  plan: buildScenePlan({conceptLabel:'Problem recognition',channel:'META_AD'})!,
  governedText:['Still calling around?'],brand:['#5446ff'],
  founderId:'founder',productId:'product',workspaceId:'workspace' };
beforeEach(()=>{ call.mockReset(); });
it('requires every actual-image check to pass, regardless of model summary', async()=>{
  call.mockResolvedValue(JSON.stringify({summary:'Ready',checks:{...checks,composition:'NEEDS_ATTENTION'}}));
  expect((await critiqueRenderedVisual(input)).outcome).toBe('NEEDS_CREATIVE_REVISION');
  expect(call.mock.calls[0][1][0].content[0].source.data).toBe(input.bytes.toString('base64'));
});
it('fails closed on missing checks and provider failure',async()=>{
  call.mockResolvedValue(JSON.stringify({summary:'Ready',checks:{composition:'PASS'}}));
  expect((await critiqueRenderedVisual(input)).outcome).toBe('NEEDS_CREATIVE_REVISION');
  call.mockRejectedValue(new Error('provider unavailable'));
  expect((await critiqueRenderedVisual(input)).outcome).toBe('NEEDS_CREATIVE_REVISION');
});
it('returns review eligibility, never approval, when all checks pass',async()=>{
  call.mockResolvedValue(JSON.stringify({summary:'Clear recognition and authentic product.',checks}));
  const result=await critiqueRenderedVisual(input);
  expect(result.outcome).toBe('READY_FOR_OWNER_REVIEW');
  expect(result).not.toHaveProperty('approved');
});

it.each(['semanticContext','backgroundText'])('rejects deficient %s despite otherwise passing layout',async(check)=>{
 call.mockResolvedValue(JSON.stringify({summary:'Layout is clean',checks:{...checks,[check]:'NEEDS_ATTENTION'}}));
 const result=await critiqueRenderedVisual(input);
 expect(result.outcome).toBe('NEEDS_CREATIVE_REVISION');
 expect(result.checks[check]).toBe('NEEDS_ATTENTION');
});
