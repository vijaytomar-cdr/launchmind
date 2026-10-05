import { expect, it, vi } from 'vitest';
import { generateChannelContent } from '../src/services/content/b3ContentGeneration';
import { validateMetaAd } from '../src/services/content/channelValidators';
import first from './fixtures/copyFieldFitting/attempt-1.json';
import second from './fixtures/copyFieldFitting/attempt-2.json';
import third from './fixtures/copyFieldFitting/attempt-3.json';
import { fitTerminalPunctuation, navigationCtaCandidates } from '../src/services/content/metaFieldFitting';

const ctx:any = {workspaceId:'11111111-1111-4111-8111-111111111111',productId:'p',
 application:{name:'AllignX',description:'AllignX connects you with trusted, vetted professionals in your neighborhood — quickly, safely, and conveniently.',markets:[]},
 founderDirection:{competitors:[]},brand:{fields:{},missing:[]},
 evidence:[{ref:'product',kind:'PRODUCT_CONTEXT',label:'Your product profile',text:'AllignX・Home Services App. AllignX connects you with trusted, vetted professionals in your neighborhood — quickly, safely, and conveniently. Home projects should not start with phone tag.'}]};
const input:any={ctx,founderId:'f',requireVisualCopy:true,maxRewrites:0,
 brief:{channel:'META_AD',proofAvailable:[],proofUnavailable:[],ownerConfirmationRequired:[],brandConstraints:[],channelConstraints:[],prohibitedTerminology:[]},
 strategy:{campaignThesis:'Phone tag',coreNarrative:'Home projects on hold'},
 semantic:async()=>({byField:new Map(),artifactClaims:[],unresolvedFields:[],unverifiable:false,failureReason:null})};
const alternatives=(values:unknown[])=>JSON.stringify({alternatives:{description:values}});

it('A: exact 30 passes and recorded 31 fails the unchanged validator',()=>{
 const at30='Connect with vetted local pros';
 // Literal fixture includes the original exact bytes; measure with the validator's String.length.
 expect(first.content.description.length).toBe(31);
 expect(validateMetaAd({...first.content,description:'a'.repeat(30)}).valid).toBe(true);
 expect(validateMetaAd({...first.content,description:'a'.repeat(31)}).valid).toBe(false);
 expect(at30.length).toBe(30);
});

it('a recorded punctuation overflow is internally fitted without a semantic field-repair call',async()=>{
 // Isolate mechanics: retained generator declarations are tested separately below.
 const initial={content:first.content,declaredClaims:[]};
 const generate=vi.fn().mockResolvedValueOnce(JSON.stringify(initial));
  const result=await generateChannelContent({...input,generate});
  expect(result.disposition).toBe('ELIGIBLE');
 expect(result.payload.description).toBe('Connect with vetted local pros');
 expect(result.payload.headline).toBe(first.content.headline);
 expect(result.payload.primaryText).toBe(first.content.primaryText);
 expect(result.payload.cta).toBe(first.content.cta);
 expect(generate).toHaveBeenCalledTimes(1);
});

it('fits only a one-character dispensable terminal punctuation overflow',()=>{
 expect(fitTerminalPunctuation('Connect with vetted local pros.',30)).toBe('Connect with vetted local pros');
 expect(fitTerminalPunctuation('Connect with vetted local pros.',29)).toBeNull();
 expect(fitTerminalPunctuation('Is Plumbing help needed?',20)).toBeNull();
 expect(fitTerminalPunctuation('Already valid.',30)).toBeNull();
});

it('C/E: ignores claimed counts, rejects an unsupported short alternative, then selects governed text',async()=>{
 const overlong={...first.content,description:'Connect with vetted local pros!!'};
 const generate=vi.fn().mockResolvedValueOnce(JSON.stringify({content:overlong,declaredClaims:[]}))
 .mockResolvedValueOnce(alternatives([{text:'x'.repeat(31),characterCount:20},{text:'Save 40%',declaredClaims:[{fieldId:'description',textSpan:'Save 40%',category:'OUTCOME_PROMISE'}]}, {text:'Connect with vetted pros.',characterCount:500}]));
 const result=await generateChannelContent({...input,generate});
 expect(result.disposition).toBe('ELIGIBLE');expect(result.payload.description).toBe('Connect with vetted pros.');
 expect(result.claims.some(c=>c.text==='Save 40%')).toBe(false);
});

it('D: five overlong alternatives stop without broad rewrites',async()=>{
 const overlong={...first.content,description:'Connect with vetted local pros!!'};
 const generate=vi.fn().mockResolvedValueOnce(JSON.stringify({content:overlong,declaredClaims:[]}))
 .mockResolvedValue(alternatives(Array(5).fill('x'.repeat(31))));
 const result=await generateChannelContent({...input,maxRewrites:2,generate});
 expect(result.disposition).toBe('REWRITE_REQUIRED');expect(result.payload).toEqual(overlong);expect(generate).toHaveBeenCalledTimes(2);
});

it('F: missing CTA uses a bounded neutral label and governance checks it without another generation',async()=>{
 const generate=vi.fn().mockResolvedValue(JSON.stringify({content:{...first.content,description:'Connect with vetted pros.',cta:''},declaredClaims:[]}));
 const result=await generateChannelContent({...input,generate});
 expect(result.disposition).toBe('ELIGIBLE');expect(result.payload.cta).toBe('See AllignX');expect(generate).toHaveBeenCalledTimes(1);
 expect(navigationCtaCandidates('AllignX')).not.toContain('Book now');
});

it('B: safe whitespace fitting preserves valid fields byte for byte',async()=>{
 const content={...first.content,description:'    Connect with  vetted pros.    '};
 const generate=vi.fn().mockResolvedValue(JSON.stringify({content,declaredClaims:[]}));
 const result=await generateChannelContent({...input,generate});
 expect(result.payload).toEqual({...content,description:'Connect with vetted pros.'});expect(result.disposition).toBe('ELIGIBLE');expect(generate).toHaveBeenCalledTimes(1);
});

it('unchanged structurally valid governed copy avoids fitting',async()=>{
 const content={...first.content,description:'Connect with vetted pros.'};
 const generate=vi.fn().mockResolvedValue(JSON.stringify({content,declaredClaims:[]}));
 const result=await generateChannelContent({...input,generate});expect(result.payload).toEqual(content);expect(generate).toHaveBeenCalledTimes(1);
});

it('retained generator claims remain authoritative when field lengths alone are not the problem', async()=>{
 const generate=vi.fn().mockResolvedValue(JSON.stringify(second));
 const result=await generateChannelContent({...input,generate});
 expect(result.disposition).toBe('REWRITE_REQUIRED');
 expect(result.claims.some(c=>c.verdict==='UNSUPPORTED')).toBe(true);
 expect(generate).toHaveBeenCalledTimes(1);
});

it.each([first,third])('retained full declared candidate reaches eligible fitted copy %#',async fixture=>{
 const generate=vi.fn().mockResolvedValueOnce(JSON.stringify(fixture)).mockResolvedValueOnce(alternatives(['Connect with vetted pros.']));
 const result=await generateChannelContent({...input,generate});
 expect(result.disposition).toBe('ELIGIBLE');expect(result.payload.description).toBe(fixture===first?'Connect with vetted local pros':'Connect with vetted pros.');
 expect(result.payload.headline).toBe(fixture.content.headline);expect(generate).toHaveBeenCalledTimes(fixture===first?1:2);
});
it('recorded semantic failure receives semantic repair before deterministic field fitting',async()=>{
 const generate=vi.fn().mockResolvedValueOnce(JSON.stringify(second)).mockResolvedValueOnce(JSON.stringify(first))
 .mockResolvedValueOnce(alternatives(['Connect with vetted pros.']));
 const result=await generateChannelContent({...input,maxRewrites:2,generate});
 expect(result.disposition).toBe('ELIGIBLE');expect(generate).toHaveBeenCalledTimes(2);
 expect(generate.mock.calls[1][0]).not.toContain('TARGETED FIELD FITTING');
});
