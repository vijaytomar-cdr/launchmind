import {it,expect} from 'vitest';
import sharp from 'sharp';
import {composeProductCreative,regionsIntersect,type CompositionInput} from '../src/services/creative/productComposition';
import {recognitionThesis,recognitionIntent,repairVisualThesis} from '../src/services/creative/scenePlan';
const thesis=recognitionThesis('residential maintenance','Waiting for a callback')!;
async function input():Promise<CompositionInput>{return {intent:recognitionIntent('PROBLEM_VISUAL_MESSAGE'),visualThesis:thesis,
 backgroundBytes:await sharp({create:{width:1344,height:768,channels:3,background:'#252525'}}).png().toBuffer(),screenshotBytes:null,logoBytes:null,
 widthPx:1024,heightPx:1024,accentColor:'#2127b3',overlay:[
 {role:'HEADLINE',text:'Still waiting on that callback?',sourceContentVersion:2},
 {role:'SUPPORTING_COPY',text:'Connect with vetted local pros',sourceContentVersion:2},
 {role:'CTA',text:'See AllignX on App Store',sourceContentVersion:2}]};}
it('protects padded human region while retaining grouped readable typography at square and feed sizes',async()=>{
 for(const size of [1024,350]){const i=await input();i.widthPx=i.heightPx=size;
 const r=await composeProductCreative(i);const f=r.manifest.focalProtection!;
 const padded={x:f.subject.x-f.padding,y:f.subject.y,width:f.subject.width+f.padding,height:f.subject.height};
 for(const e of Object.values(f.elements))expect(regionsIntersect(e,padded)).toBe(false);
 expect(r.manifest.overlayLines).toEqual(i.overlay);
 expect(r.manifest.geometry!.hook.fontSize/size).toBeGreaterThanOrEqual(.078);
 expect(r.manifest.geometry!.support!.fontSize/size).toBeGreaterThanOrEqual(.033);
 expect(f.elements.cta.y-f.elements.support.y-f.elements.support.height).toBeLessThan(size*.04);
 expect(f.elements.cta.y+f.elements.cta.height).toBeLessThan(size*.9);
 }
});
it('uses a localized translucent fade and preserves protected photograph pixels',async()=>{
 const r=await composeProductCreative(await input());
 const pixel=async(x:number,y:number)=>[...await sharp(r.bytes).extract({left:x,top:y,width:1,height:1}).removeAlpha().raw().toBuffer()];
 expect(await pixel(900,900)).toEqual([37,37,37]);
 const left=await pixel(50,900);expect(left[0]).toBeGreaterThan(225);expect(left[0]).toBeLessThan(247);
 expect(r.manifest.focalProtection!.subject.x/1024).toBeLessThan(.5);
});
it('does not apply human protection to unrelated grammars',async()=>{
 const i=await input();i.visualThesis={...thesis,type:'STALLED_PROJECT'};
 expect((await composeProductCreative(i)).manifest.focalProtection).toBeUndefined();
});
it('reuses photograph for face collision despite semantic and no-text summary language',()=>{
 const r=repairVisualThesis(thesis,{outcome:'NEEDS_CREATIVE_REVISION',summary:'CTA covers the face and supporting copy is unreadable. No generated pseudo-text.',checks:{semanticContext:'NEEDS_ATTENTION',legibility:'NEEDS_ATTENTION',backgroundText:'PASS',authenticity:'PASS'}});
 expect(r.regenerate).toBe(false);expect(r.thesis).toBe(thesis);
});
it('regenerates actual photographic failures even with layout problems',()=>{
 const r=repairVisualThesis(thesis,{outcome:'NEEDS_CREATIVE_REVISION',summary:'CTA covers face; no toolbox or home-project cue is present.',checks:{semanticContext:'NEEDS_ATTENTION'}});
 expect(r.regenerate).toBe(true);
});
