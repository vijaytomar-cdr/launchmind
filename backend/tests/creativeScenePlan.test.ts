import { describe, expect, it } from 'vitest';
import { buildScenePlan, critiqueComposition, selectVisualExecution,
  visualExecutionSignature } from '../src/services/creative/scenePlan';

describe('structured creative scene plans', () => {
  it('gives A/B/C materially different visual journeys', () => {
    const plans = [
      buildScenePlan({ conceptLabel: 'Problem recognition', visualBrief: 'recognition', channel: 'META_AD' }),
      buildScenePlan({ conceptLabel: 'Product demonstration', visualBrief: 'demo', channel: 'META_AD' }),
      buildScenePlan({ conceptLabel: 'Relief', visualBrief: 'relief', channel: 'META_AD' }),
    ];
    expect(plans.every(Boolean)).toBe(true);
    expect(new Set(plans.map(p => p!.composition)).size).toBe(3);
    expect(new Set(plans.map(p => p!.primaryFocalPoint)).size).toBe(3);
    expect(new Set(plans.map(p => p!.productRevealOrder)).size).toBe(3);
  });

  it('rejects a render that lost the intended composition', () => {
    const plan = buildScenePlan({ conceptLabel: 'Product demonstration', visualBrief: 'demo', channel: 'META_AD' })!;
    expect(critiqueComposition({ plan, widthPx: 1024, heightPx: 1024,
      screenshotComposited: true, overlayLineCount: 2,
      actualLayout: 'PROBLEM_FRAME' }).outcome).toBe('CONCEPT_DID_NOT_SURVIVE_RENDER');
  });

  it('keeps creative critique separate and blocks missing authentic assets', () => {
    const plan = buildScenePlan({ conceptLabel: 'Relief', visualBrief: 'relief', channel: 'META_AD' })!;
    const result = critiqueComposition({ plan, widthPx: 1024, heightPx: 1024,
      screenshotComposited: false, overlayLineCount: 1, actualLayout: plan.composition });
    expect(result.outcome).toBe('ASSET_PROBLEM');
    expect(result).not.toHaveProperty('approved');
    expect(result).not.toHaveProperty('governanceEligible');
  });

  it('does not call a message-led render ready when all governed wording was omitted', () => {
    const plan = buildScenePlan({ conceptLabel: 'Problem recognition',
      visualBrief: 'recognition', channel: 'META_AD' })!;
    const result = critiqueComposition({ plan, widthPx: 1024, heightPx: 1024,
      screenshotComposited: true, overlayLineCount: 0, actualLayout: plan.composition });
    expect(result.outcome).toBe('CONCEPT_DID_NOT_SURVIVE_RENDER');
  });

  it('selects a materially different execution from recent visual history', () => {
    const first = selectVisualExecution({ conceptLabel: 'Problem recognition' })!;
    const second = selectVisualExecution({ conceptLabel: 'Problem recognition', recentIds: [first.id] })!;
    expect(second.id).not.toBe(first.id);
    expect(second.visualIdea).not.toBe(first.visualIdea);
    expect(second.compositionStructure).not.toBe(first.compositionStructure);
    expect(visualExecutionSignature(second)).not.toBe(visualExecutionSignature(first));
  });

  it('refuses to present a repeated structure after all bounded executions were used', () => {
    const used = ['question-led-product', 'interruption-then-reveal', 'problem-product-split'];
    expect(selectVisualExecution({ conceptLabel: 'Problem recognition', recentIds: used }))
      .toBeNull();
  });

  it('rejects a candidate whose structural signature already exists under another id', () => {
    const first = selectVisualExecution({ conceptLabel: 'Problem recognition' })!;
    const next = selectVisualExecution({ conceptLabel: 'Problem recognition',
      recentSignatures: [visualExecutionSignature(first)] })!;
    expect(next.id).not.toBe(first.id);
  });
});

it('keeps product demonstration strict while allowing a brand-led recognition concept',()=>{
  const recognition=buildScenePlan({conceptLabel:'Problem recognition',channel:'META_AD'})!;
  const demonstration=buildScenePlan({conceptLabel:'Product demonstration',channel:'META_AD'})!;
  expect(critiqueComposition({plan:recognition,widthPx:1024,heightPx:1024,
    screenshotComposited:false,overlayLineCount:3,actualLayout:'PROBLEM_FRAME'}).outcome)
    .toBe('READY_FOR_OWNER_REVIEW');
  expect(critiqueComposition({plan:demonstration,widthPx:1024,heightPx:1024,
    screenshotComposited:false,overlayLineCount:3,actualLayout:'PRODUCT_HERO'}).outcome)
    .toBe('ASSET_PROBLEM');
});

it('carries executable relationships and selects distinct recognition grammars', () => {
  const a = selectVisualExecution({conceptLabel:'Problem recognition',grammar:'HOOK_PRODUCT_FRAGMENT'})!;
  const b = selectVisualExecution({conceptLabel:'Problem recognition',grammar:'PROBLEM_VISUAL_MESSAGE'})!;
  expect(buildScenePlan({conceptLabel:'Problem recognition',channel:'META_AD'})?.compositionIntent).toEqual(a.compositionIntent);
  expect(a.compositionIntent?.crop).toBe('PARTIAL_OFF_CANVAS');
  expect(a.compositionIntent?.assetRole).toBe('UI_FRAGMENT');
  expect(b.compositionIntent?.grammar).not.toBe(a.compositionIntent?.grammar);
  expect(b.compositionIntent?.typography.hookScale).toBeGreaterThan(a.compositionIntent!.typography.hookScale);
});
