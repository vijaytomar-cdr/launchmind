import {z} from 'zod';
/** Small catalog value object, not a geocoder. Owner locality and analysis scope
 * are separate. Never parse a narrative or widen locality to national demand. */
export const US_STATES:Record<string,string>=Object.fromEntries('AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|DC:District of Columbia|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming'.split('|').map(v=>v.split(':')));
export const SERVICE_COUNTRIES:Record<string,string>={US:'United States',CA:'Canada',GB:'United Kingdom',IN:'India'};
const place=z.string().trim().min(2).max(60).regex(/^[\p{L}\p{M}][\p{L}\p{M} .’'-]*$/u,'Enter a place name, not a paragraph or comma-separated list.').refine(v=>v.split(/\s+/).length<=6,'Enter only the place name.');
export const OwnerServiceArea=z.object({city:place.or(z.literal('')),state:place,country:z.enum(['US','CA','GB','IN'])}).strict().superRefine((area,ctx)=>{if(area.country==='US'&&!Object.values(US_STATES).includes(area.state))ctx.addIssue({code:z.ZodIssueCode.custom,path:['state'],message:'Select a state.'});});
export type OwnerServiceAreaInput=z.infer<typeof OwnerServiceArea>;
export function normalizeServiceArea(value:unknown){
 const area=OwnerServiceArea.parse(value);const stateCode=area.country==='US'?Object.keys(US_STATES).find(code=>US_STATES[code]===area.state):null;
 return {city:area.city,state:area.state,country:SERVICE_COUNTRIES[area.country],countryCode:area.country,displayLabel:[area.city,area.state,SERVICE_COUNTRIES[area.country]].filter(Boolean).join(', '),providerGeography:stateCode?`US-${stateCode}`:null,providerScope:stateCode?'STATE':null,scopeDisclosure:stateCode?`Search-demand comparison uses ${area.state}-level interest${area.city?`, not ${area.city}-only demand`:''}.`:'Local search-demand geography is not supported for this area yet.'};
}
export type ServiceArea=ReturnType<typeof normalizeServiceArea>;
/** Recompute derived fields from recorded owner fields; stored provider codes
 * alone never confer applicability. */
export function resolvedServiceArea(entry:{serviceArea?:ServiceArea|null}){
 if(!entry.serviceArea)return null;
 const a=entry.serviceArea;try{return normalizeServiceArea({city:a.city,state:a.state,country:a.countryCode});}catch{return null;}
}
