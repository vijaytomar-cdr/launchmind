import {it,expect} from 'vitest';
import {studioSections} from './studioSections';
const base={planningWork:[{id:'p',campaignId:'current'}],campaigns:[],readyForReview:[],approved:[],needsAttention:[],launchMindCanRepair:[],recentCreative:[],earlierArtifacts:[],inProgress:[]} as any;
it('first production brief has no empty history or legacy sections',()=>{expect(studioSections(base).hasHistory).toBe(false)});
it('keeps current reviewable work out of history and groups old development work',()=>{const current={artifactId:'new',campaignId:'current'},old={artifactId:'old',campaignId:'legacy'};const s=studioSections({...base,campaigns:[{id:'current'},{id:'legacy'}],readyForReview:[current,old]});
 // The current item is NOT demoted to history — it is represented by the
 // production-brief card above, so it is not ALSO listed as a second review
 // row. One current job, one entry point.
 expect(s.currentReview).toEqual([]);
 expect(s.history.readyForReview).toEqual([old]);expect(s.history.campaigns).toEqual([{id:'legacy'}]);expect(s.hasHistory).toBe(true)});
it('without a production brief, reviewable work is still listed rather than hidden',()=>{const current={artifactId:'new',campaignId:'current'};
 const s=studioSections({...base,planningWork:[],campaigns:[{id:'current'}],readyForReview:[current]});
 expect(s.currentReview).toEqual([]);            // no planning lineage → belongs to history, unchanged
 expect(s.history.readyForReview).toEqual([current]);});
