/** Matches the bounded catalog API; free-text areas are owner truth, not geocodes. */
export function parseServiceAreas(value:string){return value.split(',').map(v=>v.trim()).filter(Boolean);}
export function serviceAreaError(value:string,unknown=false):string|null{
 if(unknown)return null;
 const areas=parseServiceAreas(value);
 if(!areas.length)return 'Enter a service area, or select “I haven’t confirmed the service area yet”.';
 if(areas.length>30)return 'Use no more than 30 areas.';
 if(areas.some(a=>a.length<2||a.length>80))return 'Each area must contain 2–80 characters. Separate areas with commas.';
 return null;
}
