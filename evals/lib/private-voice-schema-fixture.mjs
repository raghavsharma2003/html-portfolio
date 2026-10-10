// Older erasure fixtures explicitly model databases before optional migration
// 172. Private runtime tests separately exercise the present-schema branch.
export const withoutPrivateVoiceSchema=db=>async(sql,params)=>
 sql==="select to_regclass('public.vy_private_voice_run') is not null private_voice_present"
 ?[{private_voice_present:false}]:db(sql,params);
