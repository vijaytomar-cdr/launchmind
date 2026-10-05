import {getSupabaseAdmin} from '../src/lib/supabaseAdmin';
for(const table of ['market_intelligence_source_records','market_intelligence_resolutions']){
 const {error}=await getSupabaseAdmin().from(table).select('id').limit(1);
 console.log(JSON.stringify({table,available:!error,error:error?.message??null,code:error?.code??null}));
}
