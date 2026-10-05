import React from 'react';
import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProductionBrief} from './GroundedPlanningWork';
const work={id:'plan',state:'PLANNED',handoff:{service:{name:'Plumbing'},concept:{key:'B',family:'PRODUCT_DEMONSTRATION'},groundedBrief:{concepts:[{key:'B',name:'Product demonstration'}]},audience:'Home-service customers',geography:'Phoenix, Arizona, United States',productTruth:'Connect with vetted home-service professionals.',growthThesis:'Test a clear Plumbing explanation.'},decision:{overridden:false}} as any;

it('before generation, shows only owner-useful brief fields — no technical or duplicated explanatory text',()=>{
 const html=renderToStaticMarkup(<ProductionBrief work={work}/>);
 for(const text of ['Plumbing','Product demonstration','Content type','Message direction','Audience','Market','Goal','Generate content','Change direction','Why this direction?'])
  expect(html).toContain(text);
 // Removed per the AI CMO flow: duplicated/overly technical explanatory text.
 for(const text of ['Arizona-level search demand','instant provider availability','observation window','provenance'])
  expect(html).not.toContain(text);
 expect(html).toContain('/dashboard/intelligence/content#recommended-concepts');
 expect(html).toContain('Back to Content Intelligence');
});

it('enables creation only after server preparation and handles stale state',()=>{
 const html=renderToStaticMarkup(<ProductionBrief work={work}/>);
 expect(html).toContain('disabled');
 const ready=renderToStaticMarkup(<ProductionBrief work={work} ready/>);
 expect(ready).not.toContain('disabled');
 expect(ready).toContain('Generate content');
 const stale=renderToStaticMarkup(<ProductionBrief work={work} stale/>);
 expect(stale).toContain('This brief needs to be refreshed');
 expect(stale).toContain('Return to Content Intelligence');
});

it('shows persistent failure beside its retry action, before the brief',()=>{
 const failed=renderToStaticMarkup(<ProductionBrief work={{...work,generation:{status:'NEEDS_ATTENTION',reason:'FORMAT'}}} ready/>);
 expect(failed).toContain('Needs attention');
 expect(failed).toContain('Nothing was replaced');
 expect(failed).toContain('Try again');
 expect(failed.indexOf('Try again')).toBeLessThan(failed.indexOf('Content type'));
 expect(failed).not.toContain('internal repair');
 const creating=renderToStaticMarkup(<ProductionBrief work={work} creating ready/>);
 expect(creating).toContain('LaunchMind is creating');
});

it('after generation, the generated copy is the dominant content and the brief collapses',()=>{
 const success=renderToStaticMarkup(<ProductionBrief work={{...work,
   generation:{status:'READY_FOR_REVIEW',assetId:'a1',versionNumber:1},
   content:{content:{h1:'Actual saved heading',subhead:'Sub',benefits:['One','Two'],ctas:['Learn more']},versionNumber:1,status:'ELIGIBLE_FOR_CONTENT_APPROVAL'}}} ready/>);
 expect(success).toContain('Actual saved heading');
 expect(success).toContain('Ready for review');
 expect(success).not.toContain('Generate content');
 // Owner review actions live on this same page.
 expect(success).toContain('Approve');
 expect(success).toContain('Edit creative');
 expect(success).toContain('Create another version');
 // The brief is present but demoted to a collapsed secondary section.
 expect(success).toContain('<summary');
 expect(success).toContain('Brief');
 // Ordering: generated copy appears before the collapsed brief.
 expect(success.indexOf('Actual saved heading')).toBeLessThan(success.indexOf('<summary'));
});

it('renders the certified core marketing-message fields before owner actions',()=>{
 const html=renderToStaticMarkup(<ProductionBrief work={{...work,
  generation:{status:'READY_FOR_REVIEW',assetId:'a1',versionNumber:1},
  content:{content:{primaryText:'Have a plumbing problem at home?',headline:'Start Your Plumbing Request in AllignX',description:'Connect with vetted local pros',cta:'Learn More'},versionNumber:1,status:'ELIGIBLE_FOR_CONTENT_APPROVAL'}}} ready/>);
 expect(html).toContain('Primary text');
 expect(html).toContain('Have a plumbing problem at home?');
 expect(html).toContain('Start Your Plumbing Request in AllignX');
 expect(html).toContain('Connect with vetted local pros');
 expect(html).toContain('Learn More');
 expect(html).toContain('Core marketing message');
 expect(html).not.toContain('Landing page for');
});

it('an approved version shows Approved state and no Approve button',()=>{
 const approved=renderToStaticMarkup(<ProductionBrief work={{...work,
   generation:{status:'READY_FOR_REVIEW',assetId:'a1',versionNumber:1},
   content:{content:{h1:'H',ctas:['Learn more']},versionNumber:1,status:'CONTENT_APPROVED'}}} ready/>);
 expect(approved).toContain('Approved');
 expect(approved).not.toContain('>Approve<');
 expect(approved).toContain('Edit creative');
 expect(approved).toContain('Create another version');
});

it('the editor shows all fields and never the old artifact page as the primary path',()=>{
 const html=renderToStaticMarkup(<ProductionBrief work={{...work,
   generation:{status:'READY_FOR_REVIEW',assetId:'a1',versionNumber:1},
   content:{content:{h1:'H1',subhead:'Sub',benefits:['One'],objectionSection:'Obj',ctas:['Learn more']},versionNumber:1,status:'ELIGIBLE_FOR_CONTENT_APPROVAL'}}}
   ready editing draft={{h1:'H1',subhead:'Sub',benefits:'One',objectionSection:'Obj',cta:'Learn more'}}/>);
 expect(html).toContain('Editing draft');
 expect(html).toContain('Save edit');
 expect(html).toContain('Cancel');
 expect(html).not.toContain('/studio/assets/');   // never routes to the older generic asset editor
});
