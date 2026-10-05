/**
 * @file copyQualityGate.test.ts
 * @description The creative-quality gate for generated marketing copy.
 *   MEASURED DEFECT: the real AllignX Plumbing landing page passed every
 *   factual gate and still read as a compliance memo. This gate is the fix.
 */
import { describe, it, expect } from 'vitest';
import { evaluateCopyQuality } from '../src/services/content/copyQualityGate';

const BAD_DRAFT = {
  h1: 'Plumbing starts with trusted professionals.',
  ctas: ['Learn more'],
  subhead: 'AllignX connects you with vetted, neighborhood plumbing professionals — ' +
    'described as local, trusted, and convenient to work with.',
  benefits: [
    "Trusted professionals, as described: The product's own language " +
      'characterizes the professionals as trusted — a qualifier that comes ' +
      'directly from the supported product description, not an external claim.',
    'Vetted and nearby: The product describes its professionals as vetted and ' +
      'neighborhood-based, meaning the connection is with local professionals ' +
      'rather than unknown, distant ones.',
  ],
  proofSection: '',
  objectionSection: 'AllignX is described as connecting you with trusted, vetted ' +
    'professionals in your neighborhood. The product\'s own language — trusted, ' +
    'vetted, local, quick, safe, convenient — characterizes who you are ' +
    'connected with and how that connection is framed. Questions about specific ' +
    'professionals or service scope go beyond what the product description ' +
    'addresses, and AllignX does not claim to speak to those details here.',
};

const GOOD_DRAFT = {
  h1: 'A trusted plumber, right in your neighborhood.',
  ctas: ['Learn more'],
  subhead: 'AllignX connects you with vetted, local plumbing professionals — ' +
    'quickly, safely, and conveniently.',
  benefits: [
    "Every plumbing pro on AllignX is trusted and vetted, so you're not " +
      'gambling on a stranger for a job inside your home.',
    'AllignX connects you with plumbing professionals in your own ' +
      'neighborhood, not a call center three states away.',
    "A leaking pipe won't wait — AllignX connects you with a nearby, vetted " +
      'plumbing pro quickly, safely, and conveniently.',
  ],
  proofSection: '',
  objectionSection: 'Worried about letting someone into your home? AllignX only ' +
    'connects you with plumbing professionals who are trusted and vetted, and ' +
    'who work in your own neighborhood.',
};

describe('evaluateCopyQuality — the measured defect', () => {
  it('the real bad draft FAILS on governance narration, deterministically, with no provider call', async () => {
    const v = await evaluateCopyQuality({ payload: BAD_DRAFT, serviceName: 'Plumbing' });
    expect(v.state).toBe('READS_AS_GOVERNANCE_COMMENTARY');
    expect(v.semanticEvaluated).toBe(false);
    const narration = v.findings.find(f => f.dimension === 'NO_GOVERNANCE_NARRATION')!;
    expect(narration.state).toBe('FAIL');
    expect(v.narrationFields.length).toBeGreaterThan(0);
  });

  it('a genuinely marketing-oriented, factually equivalent draft PASSES, with no provider call', async () => {
    const v = await evaluateCopyQuality({ payload: GOOD_DRAFT, serviceName: 'Plumbing' });
    expect(v.state).toBe('CERTIFIED_MARKETING_QUALITY');
    expect(v.semanticEvaluated).toBe(false);
    expect(v.blocking).toHaveLength(0);
  });

  it.each([
    'as described', 'described as', "the product's own language", 'characterizes',
    'a qualifier', 'supported product description', 'not an external claim',
    'does not claim to speak to',
  ])('rejects the exact anti-pattern: "%s"', async (phrase) => {
    const v = await evaluateCopyQuality({
      payload: { h1: 'A trusted plumber nearby.', ctas: ['Learn more'],
        subhead: `This service is ${phrase} good.`,
        benefits: ['One.', 'Two.'] },
      serviceName: null,
    });
    expect(v.state).toBe('READS_AS_GOVERNANCE_COMMENTARY');
  });

  it('fails when the copy never mentions the selected service', async () => {
    const v = await evaluateCopyQuality({
      payload: { h1: 'Home services made simple.', ctas: ['Learn more'],
        subhead: 'AllignX connects you with vetted local professionals.',
        benefits: ['Trusted and vetted.', 'Local and convenient.'] },
      serviceName: 'Plumbing',
    });
    expect(v.findings.find(f => f.dimension === 'SERVICE_SPECIFICITY')?.state).toBe('FAIL');
    expect(v.state).toBe('READS_AS_GOVERNANCE_COMMENTARY');
  });

  it('fails when there is no real marketing structure (no benefits, no CTA)', async () => {
    const v = await evaluateCopyQuality({
      payload: { h1: 'Plumbing help nearby.', ctas: [], subhead: 'x', benefits: [] },
      serviceName: 'Plumbing',
    });
    expect(v.findings.find(f => f.dimension === 'STRUCTURE')?.state).toBe('FAIL');
  });

  it('the semantic stage runs ONLY when deterministic checks already pass, and is fully injectable', async () => {
    let critiqueCalls = 0;
    const stubFail = async () => { critiqueCalls++; return 'FAIL: reads as generic filler.'; };
    const badResult = await evaluateCopyQuality({ payload: BAD_DRAFT, serviceName: 'Plumbing', critique: stubFail });
    expect(critiqueCalls).toBe(0);   // deterministic FAIL short-circuits before the critique runs
    expect(badResult.semanticEvaluated).toBe(false);

    const goodResult = await evaluateCopyQuality({ payload: GOOD_DRAFT, serviceName: 'Plumbing', critique: stubFail });
    expect(critiqueCalls).toBe(1);
    expect(goodResult.semanticEvaluated).toBe(true);
    expect(goodResult.state).toBe('READS_AS_GOVERNANCE_COMMENTARY');   // generic filler remains a blocker
  });

  it('a passing semantic stub lets an already-clean draft stay certified', async () => {
    const stubPass = async () => 'PASS: reads as real marketing copy.';
    const v = await evaluateCopyQuality({ payload: GOOD_DRAFT, serviceName: 'Plumbing', critique: stubPass });
    expect(v.state).toBe('CERTIFIED_MARKETING_QUALITY');
    expect(v.semanticEvaluated).toBe(true);
  });

  it('uses the shared marketing-hypothesis contract without requiring unproven pain psychology', async () => {
    const candidate={primaryText:'Got a Plumbing problem at home? Start a Plumbing request in AllignX. Customer service looks for a provider and connects you.',headline:'Start a Plumbing request',description:'Customer service connects you',cta:'Learn more'};
    let rubric='';
    const v=await evaluateCopyQuality({payload:candidate,serviceName:'Plumbing',channel:'META_AD',
      hypothesis:'Test whether a clear Plumbing request message earns attention.',
      customerSituation:'The customer needs Plumbing help.',
      critique:async(system)=>{rubric=system;return 'PASS: clear, service-relevant first-test marketing.';}});
    expect(v.state).toBe('CERTIFIED_MARKETING_QUALITY');
    expect(rubric).toContain('Do NOT require proven customer psychology');
    expect(rubric).not.toContain('actual plumbing pain points');
  });

  it('blocks generic filler but retains a coherent process-heavy message as an advisory', async () => {
    const base={channel:'META_AD' as const,serviceName:'Plumbing',hypothesis:'Test a Plumbing message',customerSituation:'The customer needs Plumbing help.'};
    const generic=await evaluateCopyQuality({...base,payload:{primaryText:'Plumbing services made simple with AllignX.',headline:'Plumbing services',description:'Explore AllignX',cta:'Learn more'},critique:async()=> 'FAIL: generic filler that does not execute the hypothesis.'});
    const memo=await evaluateCopyQuality({...base,payload:{primaryText:'AllignX receives a Plumbing request and routes it through customer service.',headline:'Plumbing request flow',description:'Process overview',cta:'Learn more'},critique:async()=> 'FAIL: internal process documentation, not customer marketing.'});
    expect(generic.state).toBe('READS_AS_GOVERNANCE_COMMENTARY');
    expect(memo.state).toBe('OWNER_REVIEWABLE_WITH_RESERVATIONS');
  });

  it('keeps a coherent, process-heavy first-test message owner-reviewable with a reservation', async () => {
    const candidate={primaryText:'Have a plumbing problem? In AllignX, you can place a plumbing request and customer service looks for a trusted, vetted provider in your neighborhood to connect with you.',headline:'Start a Plumbing Request in AllignX',description:'Trusted, vetted pros near you.',cta:'Learn More'};
    const v=await evaluateCopyQuality({payload:candidate,serviceName:'Plumbing',channel:'META_AD',
      critique:async()=> 'FAIL: internal marketplace-process documentation rather than commercially usable customer-facing marketing.'});
    expect(v.state).toBe('OWNER_REVIEWABLE_WITH_RESERVATIONS');
    expect(v.blocking).toHaveLength(0);
    expect(v.advisory).toHaveLength(1);
  });

  it.each([
    ['generic filler', 'BLOCK: generic filler with no meaningful Plumbing execution.'],
    ['governance narration', 'BLOCK: internal governance/provenance narration.'],
    ['broken copy', 'BLOCK: incoherent broken marketing text.'],
    ['wrong service', 'BLOCK: wrong service; this is about electrical work.'],
  ])('keeps %s as a blocking creative defect', async (_label, critique) => {
    const v=await evaluateCopyQuality({payload:{primaryText:'Need Plumbing help? Start a Plumbing request in AllignX today.',headline:'Plumbing help in AllignX',description:'Start your request',cta:'Learn More'},serviceName:'Plumbing',channel:'META_AD',critique:async()=>critique});
    expect(v.state).toBe('READS_AS_GOVERNANCE_COMMENTARY');
    expect(v.blocking).toHaveLength(1);
  });
});
