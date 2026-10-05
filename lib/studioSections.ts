import type {StudioHome} from './api';
/** Planning lineage, not names or assumed performance, separates current work. */
export function studioSections(view:StudioHome){
 const campaigns=new Set((view.planningWork??[]).map(w=>w.campaignId).filter(Boolean));
 // ONE dominant current item. When a grounded production brief is on the page,
 // it already carries this work's name, state and action — listing the same
 // campaign again under "Ready for your review" gave the owner two entry points
 // to one job and a second review workspace to choose between. The artifacts,
 // versions and governance records are untouched; only the duplicate surface is.
 const currentReview=(view.planningWork?.length??0)>0
   ? [] : view.readyForReview.filter(i=>i.campaignId&&campaigns.has(i.campaignId));
 const currentArtifacts=new Set([...view.readyForReview,...view.approved,...view.needsAttention,...view.launchMindCanRepair].filter(i=>i.campaignId&&campaigns.has(i.campaignId)).map(i=>i.artifactId));
 const previous=(rows:StudioHome['readyForReview'])=>rows.filter(i=>!i.campaignId||!campaigns.has(i.campaignId));
 const history={...view,campaigns:view.campaigns.filter(c=>!campaigns.has(c.id)),readyForReview:previous(view.readyForReview),approved:previous(view.approved),needsAttention:previous(view.needsAttention),launchMindCanRepair:previous(view.launchMindCanRepair),recentCreative:view.recentCreative.filter(i=>!i.artifactId||!currentArtifacts.has(i.artifactId)),inProgress:view.inProgress.filter(i=>!i.artifactId||!currentArtifacts.has(i.artifactId))};
 const hasHistory=[history.campaigns,history.readyForReview,history.approved,history.needsAttention,history.launchMindCanRepair,history.recentCreative,history.earlierArtifacts,history.inProgress].some(a=>a.length>0);
 return {currentReview,history,hasHistory};
}
