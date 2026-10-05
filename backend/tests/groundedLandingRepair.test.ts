import {it,expect} from 'vitest';
import {buildChannelPrompt,generateChannelContent,landingRepairFields,preserveLandingSections} from '../src/services/content/b3ContentGeneration';
const ctx={workspaceId:'w',productId:'p',application:{name:'AllignX',description:'Connect with vetted home service professionals.'},brand:{fields:{}},founderDirection:{competitors:[]},evidence:[{ref:'p',kind:'PRODUCT_CONTEXT',label:'Product',text:'AllignX connects with vetted home service professionals.'}],prohibitedTerms:[]} as any;
const input={ctx,founderId:'f',strategy:{campaignThesis:'Explain Plumbing',coreNarrative:'Explain the supported role'},brief:{channel:'LANDING_PAGE',audience:'Owners',proofAvailable:[],proofUnavailable:['No conversion proof'],ownerConfirmationRequired:[],brandConstraints:[],channelConstraints:['H1 ≤70 characters'],prohibitedTerminology:[],objective:'Test clarity',message:'Plumbing',hookDirection:'Product demonstration'},groundedContext:{service:'Plumbing',concept:'PRODUCT_DEMONSTRATION',geography:'Phoenix',demandScope:'US-AZ',growthThesis:'Test clarity',productTruth:'Connect with vetted home service professionals',missingEvidence:['No conversion']},semantic:async()=>({byField:new Map(),artifactClaims:[],unresolvedFields:[],unverifiable:false,failureReason:null})} as any;
it('delivers selected service, concept, market context and truth without treating demand as a claim',()=>{const p=buildChannelPrompt(input);for(const t of ['Plumbing','PRODUCT_DEMONSTRATION','Phoenix','US-AZ','No conversion'])expect(p.user).toContain(t);expect(p.user).toContain('never present it as a product claim');expect(p.system).toContain('leave it empty rather than invent proof');});
it('withholds inadmissible owner mechanics from the exact model prompt while keeping Plumbing request and connection truth',()=>{const withRaw={...input,groundedContext:{...input.groundedContext,serviceTruth:{provenance:'OWNER_CONFIRMED',serviceName:'Plumbing',statements:[{key:'whatWeProvide',supplies:'SERVICE_PRODUCT_TRUTH',text:'AllignX connects a plumbing provider with the customer. They finalize the price and get paid in cash.'},{key:'customerSituation',supplies:'CUSTOMER_PROBLEM',text:'Customers create a plumbing service request in AllignX.'}]}}} as any;const prompt=buildChannelPrompt(withRaw);expect(prompt.system).toContain('connects a plumbing provider');expect(prompt.user).toContain('create a plumbing service request');for(const forbidden of ['finalize the price','get paid','cash']){expect(prompt.system).not.toContain(forbidden);expect(prompt.user).not.toContain(forbidden);}});
it('PRODUCT_DEMONSTRATION gets the supported-description-vs-mechanism rule and a customer-facing target shape; other concepts do not',()=>{const demo=buildChannelPrompt(input);expect(demo.system).toContain('SUPPORTED DESCRIPTION vs UNSUPPORTED MECHANISM');expect(demo.system).toContain('do not describe a vetting process');expect(demo.system).toContain('CUSTOMER-FACING TARGET SHAPE');expect(demo.system).toContain('customer situation → customer action → supported product role → confirmed customer value → CTA');const other=buildChannelPrompt({...input,groundedContext:{...input.groundedContext,concept:'PROBLEM_RECOGNITION'}});expect(other.system).not.toContain('SUPPORTED DESCRIPTION vs UNSUPPORTED MECHANISM');expect(other.system).not.toContain('CUSTOMER-FACING TARGET SHAPE');});
it('does not ask the model to declare an ordinary navigation CTA as a factual claim',()=>{expect(buildChannelPrompt(input).system).toContain('Do not declare an ordinary navigation CTA as a claim.');});
it('rewrites the complete customer-facing hierarchy for a quality-only failure',()=>{const result={degraded:false,payload:{h1:'Plumbing requests',subhead:'AllignX process',benefits:['Step one','Step two'],objectionSection:'',ctas:['Learn more']},structuralIssues:[],claims:[],terminologyViolations:[]} as any;expect(landingRepairFields(result,[],[],true).sort()).toEqual(['benefits','h1','objectionSection','subhead']);});
it('repairs only invalid landing fields and retains declarations for safe sections',()=>{const prior={content:{h1:'Safe heading',subhead:'Long value',ctas:['Learn more']},declaredClaims:[{fieldId:'h1',textSpan:'Safe heading'}]};const next={content:{h1:'Unwanted replacement',subhead:'Fixed',ctas:['Book instantly']},declaredClaims:[]};expect(preserveLandingSections(prior,next,['subhead'])).toEqual({content:{h1:'Safe heading',subhead:'Fixed',ctas:['Learn more']},declaredClaims:prior.declaredClaims});});
it('includes structural, prohibited, unsupported and capability fields in targeted repairs',()=>{const result={degraded:false,payload:{h1:'Guaranteed booking',subhead:'Instant availability',ctas:['Too long']},structuralIssues:[{field:'ctas[0]',severity:'ERROR'}],claims:[{field:'h1',verdict:'PROHIBITED'}],terminologyViolations:[]} as any;expect(landingRepairFields(result,[{span:'Instant availability'}]).sort()).toEqual(['ctas','h1','subhead']);});
it('bounded loop preserves safe sections and still rejects unsupported promises',async()=>{let calls=0;const prompts:string[]=[];
  // Two safe, product-grounded benefits — enough real marketing shape to
  // clear the copy-quality gate (added later), so this test still exercises
  // only what it names: targeted field repair.
  const SAFE_BENEFITS=['AllignX connects you with vetted home service professionals.','The process stays simple from start to finish.'];
  const r=await generateChannelContent({...input,generate:async(system:string)=>{prompts.push(system);calls++;return JSON.stringify({content:{h1:calls===1?'Looking for plumbing help?':'Guaranteed plumbing booking',subhead:calls===1?'x'.repeat(170):'Considering your next home project?',ctas:['Learn more'],proofSection:'',benefits:SAFE_BENEFITS,objectionSection:''},declaredClaims:[]})}});expect(calls).toBe(2);expect(r.payload.h1).toBe('Looking for plumbing help?');expect(r.quality.structuralValidity).toBe('VALID');expect(prompts[1]).toContain('170 > 160');expect(prompts[1]).toContain('Only change these fields: subhead');// An unsupported promise NEVER survives. It no longer has to become an owner
// failure to be stopped: when the model's candidate cannot be used, LaunchMind
// composes the plain supported page itself (no extra provider call) and that is
// what is returned. The safety property asserted here is the real one — the
// unsafe wording is gone — not "the pipeline gave up".
const unsafe=await generateChannelContent({...input,maxRewrites:0,generate:async()=>JSON.stringify({content:{h1:'Guaranteed instant booking',subhead:'Book instantly with AllignX',ctas:['Learn more']},declaredClaims:[]})});
const survived=JSON.stringify(unsafe.payload).toLowerCase();
for(const banned of ['guaranteed','instantly','book instantly'])expect(survived,`unsafe wording "${banned}" survived`).not.toContain(banned);
if(unsafe.disposition==='ELIGIBLE'){expect(unsafe.quality.factualSafety).toBe('CERTIFIED_SUPPORTED');expect(unsafe.quality.creativeQuality).toBe('CERTIFIED_MARKETING_QUALITY');}});

it('the copy-quality gate downgrades a factually-eligible compliance-memo draft, then accepts the repair',async()=>{
  // Factually clean on BOTH attempts (only "vetted"/"connect" — everything
  // this ctx's product description actually grants) — isolates the
  // copy-quality gate as the reason attempt 1 is rejected.
  const NARRATED_BENEFITS=["Vetted, as described: the product's own language characterizes these professionals as vetted.","AllignX connects you with vetted professionals."];
  const CLEAN_BENEFITS=['AllignX connects you with vetted home service professionals.','Getting started takes just a few taps.'];
  let calls=0;
  const r=await generateChannelContent({...input,generate:async()=>{calls++;return JSON.stringify({content:{h1:'Plumbing help, made simple.',subhead:'AllignX connects you with vetted home service professionals.',ctas:['Learn more'],proofSection:'',benefits:calls===1?NARRATED_BENEFITS:CLEAN_BENEFITS,objectionSection:''},declaredClaims:[]})}});
  expect(calls).toBeGreaterThan(1);
  expect(r.disposition).toBe('ELIGIBLE');
  expect(r.quality.creativeQuality).toBe('CERTIFIED_MARKETING_QUALITY');
  expect(JSON.stringify(r.payload)).not.toMatch(/as described|characterizes|product's own language/i);
});

/**
 * The convergence architecture — the fix for six owner retries on one brief.
 * These run entirely offline: the model is stubbed, so provider calls = 0.
 */
it('a verbatim restatement of confirmed product truth is always supportable',async()=>{
  // MEASURED TRAP: the semantic arm extracted the bare fragment
  // "quickly, safely, and conveniently" out of the product's OWN tagline and
  // labelled it OUTCOME_PROMISE — a category PRODUCT_CONTEXT can never
  // support. The product's own words were structurally impossible to use, so
  // no repair could converge.
  const {discoverClaims,groundDiscoveredClaims}=await import('../src/services/content/threeSignalClaimDiscovery');
  const TRUTH='Connect with trusted, vetted home service professionals in your neighborhood — quickly, safely, and conveniently.';
  const handle={ref:'p',kind:'PRODUCT_CONTEXT',label:'Your product profile',text:TRUTH} as any;
  const d=await discoverClaims([{name:'subhead',text:'AllignX connects you with trusted, vetted home service professionals in your neighborhood — quickly, safely, and conveniently.'}],
    {declaredClaims:[]},
    {semantic:async()=>({byField:new Map([['subhead',[{textSpan:'quickly, safely, and conveniently',category:'OUTCOME_PROMISE',requirement:'EVIDENCE'}]]]),artifactClaims:[],unresolvedFields:[],unverifiable:false,failureReason:null})} as any);
  const g=groundDiscoveredClaims(d,[handle],[]);
  const fragment=g.results.find(r=>r.claim.textSpan==='quickly, safely, and conveniently')!;
  expect(fragment.verdict).toBe('SUPPORTED');
  expect(g.publishable).toBe(true);
});

it('an invented outcome is NOT rescued by the restatement rule',async()=>{
  const {discoverClaims,groundDiscoveredClaims}=await import('../src/services/content/threeSignalClaimDiscovery');
  const handle={ref:'p',kind:'PRODUCT_CONTEXT',label:'Your product profile',
    text:'Connect with trusted, vetted home service professionals in your neighborhood.'} as any;
  const d=await discoverClaims([{name:'h1',text:'A plumber at your door within two hours, guaranteed.'}],{declaredClaims:[]},
    {semantic:async()=>({byField:new Map([['h1',[{textSpan:'A plumber at your door within two hours',category:'OUTCOME_PROMISE',requirement:'EVIDENCE'}]]]),artifactClaims:[],unresolvedFields:[],unverifiable:false,failureReason:null})} as any);
  const g=groundDiscoveredClaims(d,[handle],[]);
  expect(g.results.every(r=>r.verdict!=='SUPPORTED')).toBe(true);
  expect(g.publishable).toBe(false);
});

it('repair instructions tell the model to DROP or SIMPLIFY, never to attribute',async()=>{
  // The measured cause of compliance-memo prose: the model was told the line
  // "reads as a statement of fact rather than a way of describing the
  // situation", and obediently started attributing instead of stating.
  const prompts:string[]=[];let calls=0;
  await generateChannelContent({...input,generate:async(system:string)=>{prompts.push(system);calls++;
    return JSON.stringify({content:{h1:calls===1?'Book a plumber in under an hour, guaranteed.':'Looking for plumbing help?',subhead:'AllignX connects you with vetted home service professionals.',ctas:['Learn more'],proofSection:'',benefits:['AllignX connects you with vetted home service professionals.','Start with plumbing.'],objectionSection:''},declaredClaims:[]})}});
  const repair=prompts[1]??'';
  expect(repair).toContain('DROP');
  expect(repair).toContain('NEVER repair by attribution');
  expect(repair).toContain('confirmed product truth');
  // The instruction that taught hedging must not reach the model any more.
  expect(repair).not.toContain('a way of describing the situation');
});

it('safe but awkward copy is repaired internally rather than becoming owner NEEDS_ATTENTION',async()=>{
  // Every attempt is factually clean and merely reads like a compliance memo.
  // LaunchMind must resolve this itself — it is not a decision for the owner.
  const memo={h1:'Plumbing, as described.',subhead:'AllignX connects you with vetted home service professionals.',
    ctas:['Learn more'],proofSection:'',
    benefits:['The product description characterizes these professionals as vetted.','AllignX connects you with vetted home service professionals.'],
    objectionSection:''};
  const r=await generateChannelContent({...input,generate:async()=>JSON.stringify({content:memo,declaredClaims:[]})});
  expect(r.disposition).toBe('ELIGIBLE');
  expect(r.quality.creativeQuality).toBe('CERTIFIED_MARKETING_QUALITY');
  expect(JSON.stringify(r.payload)).not.toMatch(/as described|characterizes/i);
});

it('the deterministic fallback costs no provider call and still passes full governance',async()=>{
  let calls=0;
  const r=await generateChannelContent({...input,maxRewrites:0,generate:async()=>{calls++;
    return JSON.stringify({content:{h1:'Guaranteed same-day plumbing.',subhead:'Book instantly.',ctas:['Learn more']},declaredClaims:[]})}});
  expect(calls).toBe(1);                       // no extra provider call for the fallback
  expect(r.copyGenerationCalls).toBe(1);
  expect(r.disposition).toBe('ELIGIBLE');
  expect(r.quality.factualSafety).toBe('CERTIFIED_SUPPORTED');
});

it('the current Plumbing product-demonstration contract admits a useful customer-facing page without a provider call',async()=>{
  // This is deliberately a real customer-facing draft, not a validator-shaped
  // fixture. It uses only the current company truth plus the owner's confirmed
  // Plumbing request/connection context. The same generation path evaluates
  // governance, capability, claims, structure, and the copy-quality gate.
  const plumbingTruth='Connect with trusted, vetted home service professionals in your neighborhood — quickly, safely, and conveniently.';
  const plumbingInput={...input,
    ctx:{...ctx,application:{name:'AllignX・Home Services App - App Store',description:plumbingTruth},
      evidence:[{ref:'product',kind:'PRODUCT_CONTEXT',label:'Your product profile',text:plumbingTruth}],
      signalFoundation:{catalog:{confirmed:[{id:'plumbing',name:'Plumbing',ownerKnowledge:{customerSituation:'when customer have plumbing problem, they go to allignx app or web and create plumbing service request',whatWeProvide:'allignx customer service will look for a plumbing service provider and connect him with the customer. they finalize the price and plumber will go and fix the issue and get paid in cash or CC on the app/ web.'}}]}}},
    brief:{...input.brief,audience:'Professionals and entrepreneurs seeking efficiency',
      objective:'Test whether a clear explanation of Plumbing helps the confirmed audience understand its relevance.',
      message:`Explain Plumbing using only the supported product description: ${plumbingTruth}`},
    groundedContext:{...input.groundedContext,service:'Plumbing',concept:'PRODUCT_DEMONSTRATION',
      geography:'Phoenix, Arizona, United States',demandScope:'US-AZ',productTruth:plumbingTruth,
      serviceTruth:{provenance:'OWNER_CONFIRMED',serviceName:'Plumbing',statements:[
        {key:'whatWeProvide',supplies:'SERVICE_PRODUCT_TRUTH',text:'allignx customer service will look for a plumbing service provider and connect him with the customer. they finalize the price and plumber will go and fix the issue and get paid in cash or CC on the app/ web.'},
        {key:'customerSituation',supplies:'SERVICE_PRODUCT_TRUTH',text:'when customer have plumbing problem, they go to allignx app or web and create plumbing service request'},
        {key:'customerValue',supplies:'CUSTOMER_VALUE',text:'Customers can start a Plumbing request in AllignX while customer service looks for a provider.'},
      ]}},
    copyCritique:async()=> 'PASS: This is clear, customer-facing Plumbing marketing.'};
  const candidate={content:{
    h1:'Start your Plumbing request with AllignX.',
    subhead:'Customers can start a Plumbing request in AllignX while customer service looks for a provider.',
    proofSection:'',
    benefits:[
      'Create your Plumbing service request in the AllignX app or web.',
      'AllignX customer service looks for a Plumbing service provider and connects you with them.',
    ],
    objectionSection:'Looking for Plumbing help? Start your request in AllignX.',
    ctas:['Learn more'],
  },declaredClaims:[]};
  const result=await generateChannelContent({...plumbingInput,generate:async()=>JSON.stringify(candidate)} as any);
  expect(result.disposition).toBe('ELIGIBLE');
  expect(result.quality).toMatchObject({factualSafety:'CERTIFIED_SUPPORTED',structuralValidity:'VALID',creativeQuality:'CERTIFIED_MARKETING_QUALITY'});
  expect(result.claims.every(c=>c.verdict==='SUPPORTED'||c.verdict==='NARRATIVE_FRAMING')).toBe(true);
  expect(result.terminologyViolations).toEqual([]);
  const prompt=buildChannelPrompt(plumbingInput as any);
  expect(prompt.system).toContain('PRIMARY CUSTOMER VALUE');
  expect(prompt.system).toContain('Customers can start a Plumbing request in AllignX while customer service looks for a provider.');
  expect(prompt.system).toContain('customer situation → customer action → supported product role → confirmed customer value → CTA');
  const fallback=await generateChannelContent({...plumbingInput,maxRewrites:0,generate:async()=>JSON.stringify({content:{h1:'Guaranteed plumbing repair',subhead:'Pay instantly',ctas:['Book now']},declaredClaims:[]})} as any);
  expect(fallback.disposition).toBe('ELIGIBLE');
  expect(JSON.stringify(fallback.payload)).not.toMatch(/guaranteed|pay instantly/i);
  expect(fallback.payload).toMatchObject({
    h1:'A plumbing problem? Start your request with AllignX.',
    benefits:[
      'Create a plumbing service request in AllignX.',
      'Customer service looks for a plumbing service provider and connects you.',
    ],
  });
});

it('accepts a supported, customer-facing core Meta message without a provider call',async()=>{
  const truth='Connect with trusted, vetted home service professionals in your neighborhood — quickly, safely, and conveniently.';
  const metaInput={...input,
    ctx:{...ctx,application:{name:'AllignX',description:truth},evidence:[{ref:'product',kind:'PRODUCT_CONTEXT',label:'Your product profile',text:truth}],signalFoundation:{catalog:{confirmed:[{id:'plumbing',name:'Plumbing',ownerKnowledge:{customerSituation:'When customer have plumbing problem, they go to AllignX app or web and create plumbing service request.',whatWeProvide:'AllignX customer service will look for a plumbing service provider and connect him with the customer.',customerValue:'Customers can start a Plumbing request in AllignX while customer service looks for a provider.'}}]}}},
    brief:{...input.brief,channel:'META_AD',channelConstraints:['headline ≤40 characters','description ≤30 characters'],objective:'Test a clear Plumbing request message',message:'Plumbing',hookDirection:'Lead with the customer need, then explain the supported service role.'},
    groundedContext:{...input.groundedContext,service:'Plumbing',concept:'PRODUCT_DEMONSTRATION',productTruth:truth,serviceTruth:{provenance:'OWNER_CONFIRMED',serviceName:'Plumbing',statements:[
      {key:'customerSituation',supplies:'CUSTOMER_PROBLEM',text:'When customer have plumbing problem, they go to AllignX app or web and create plumbing service request.'},
      {key:'whatWeProvide',supplies:'SERVICE_PRODUCT_TRUTH',text:'AllignX customer service will look for a plumbing service provider and connect him with the customer.'},
      {key:'customerValue',supplies:'CUSTOMER_VALUE',text:'Customers can start a Plumbing request in AllignX while customer service looks for a provider.'},
    ]}},
    copyCritique:async()=> 'PASS: This is customer-facing, specific Plumbing marketing.'
  } as any;
  const supported={content:{
    primaryText:'Need Plumbing help? Start a request in AllignX. Customer service looks for a Plumbing provider and connects you.',
    headline:'Start your Plumbing request',description:'Customer service connects you',cta:'Learn more',
    visualBrief:''
  },declaredClaims:[]};
  const pass=await generateChannelContent({...metaInput,requireVisualCopy:true,generate:async()=>JSON.stringify(supported)});
  expect(pass.disposition).toBe('ELIGIBLE');
  expect(pass.quality).toMatchObject({factualSafety:'CERTIFIED_SUPPORTED',structuralValidity:'VALID',creativeQuality:'CERTIFIED_MARKETING_QUALITY'});
  for(const unsafe of [
    {headline:'Guaranteed same-day Plumbing',primaryText:'Book instantly',description:'Guaranteed service',cta:'Book now',visualBrief:''},
    {headline:'Plumbing, as described',primaryText:'The product description characterizes the service role.',description:'Supported product description',cta:'Learn more',visualBrief:''},
    {headline:'Home services made simple',primaryText:'Everything you need in one place.',description:'A better way',cta:'Learn more',visualBrief:''},
  ]){
    const rejected=await generateChannelContent({...metaInput,maxRewrites:0,requireVisualCopy:true,generate:async()=>JSON.stringify({content:unsafe,declaredClaims:[]})});
    expect(rejected.disposition).not.toBe('ELIGIBLE');
  }
});
