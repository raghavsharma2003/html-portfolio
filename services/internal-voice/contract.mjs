import {createHash} from 'node:crypto';

export const SCOPE='internal_owner_voice';
export const TEXT='आज हम इस सवाल को धीरे धीरे समझेंगे, फिर सही उत्तर निकालेंगे।';
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const HASH=/^[a-f0-9]{64}$/;
export const AXES=['owner_likeness','naturalness','indian_accent','pronunciation'];
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function fail(code,status=409){throw Object.assign(new Error(code),{code,status});}
export function configuredOwner(env){
  if(env.VYAKTI_INTERNAL_VOICE_MODE!=='owner-only'||env.VYAKTI_MODEL_SERVING!=='azure_only'||
    !UUID.test(env.VYAKTI_INTERNAL_VOICE_OWNER_USER_ID||'')||
    !UUID.test(env.VYAKTI_INTERNAL_VOICE_REPLICA_ID||'')||
    ![undefined,'','false'].includes(env.REPLICA_SELF_TEST_MODE)||env.REPLICA_SELF_TEST_ACCESS)
    fail('internal_voice_disabled',404);
  return env.VYAKTI_INTERNAL_VOICE_OWNER_USER_ID.toLowerCase();
}
export function authorizeOwner(env,user,replica){
  const owner=configuredOwner(env);
  if(String(user?.id||'').toLowerCase()!==owner||String(replica||'').toLowerCase()!==env.VYAKTI_INTERNAL_VOICE_REPLICA_ID.toLowerCase())
    fail('internal_voice_not_available',404);
  return owner;
}
export function readConfiguration(env,now=Date.now()){
  const owner=configuredOwner(env);
  let grant,plan,policy;
  try{grant=JSON.parse(env.VYAKTI_INTERNAL_VOICE_AUTHORIZATION_JSON);plan=JSON.parse(env.AZURE_VOICE_APP_PLAN_JSON);policy=JSON.parse(env.AZURE_VOICE_APP_POLICY_JSON);}catch{fail('internal_voice_configuration_missing',503);}
  if(sha(Buffer.from(env.VYAKTI_INTERNAL_VOICE_AUTHORIZATION_JSON))!==env.VYAKTI_INTERNAL_VOICE_AUTHORIZATION_SHA256||
    grant.scope!==SCOPE||grant.owner_user_id!==owner||grant.replica_id!==env.VYAKTI_INTERNAL_VOICE_REPLICA_ID.toLowerCase()||
    !HASH.test(grant.reference_sha256||'')||grant.identity_claim_allowed!==false||grant.release_eligible!==false||grant.training_allowed!==false||
    !Array.isArray(grant.purposes)||grant.purposes.join(',')!=='reference_processing,zero_shot_synthesis,private_playback,owner_ratings'||
    !Number.isFinite(Date.parse(grant.expires_at))||Date.parse(grant.expires_at)<=now||!UUID.test(grant.authorization_id||''))
    fail('internal_voice_authorization_invalid',503);
  if(!['general','hindi_v3'].includes(env.OPEN_VOICE_MODEL_ARM||'general'))fail('internal_voice_model_arm_invalid',503);
  const maxAttempts=Number(env.VYAKTI_INTERNAL_VOICE_MAX_ATTEMPTS||'1');
  if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>12)fail('internal_voice_attempt_limit_invalid',503);
  return {owner,replica:grant.replica_id,grant,plan,policy,maxAttempts,
    grantHash:env.VYAKTI_INTERNAL_VOICE_AUTHORIZATION_SHA256,
    referencePath:env.VYAKTI_INTERNAL_VOICE_REFERENCE_PATH,modelArm:env.OPEN_VOICE_MODEL_ARM||'general'};
}
export function ratings(value){
  if(!value||Object.keys(value).sort().join(',')!==[...AXES].sort().join(',')||AXES.some(k=>!Number.isInteger(value[k])||value[k]<1||value[k]>5))fail('internal_voice_ratings_invalid',400);
  return Object.fromEntries(AXES.map(k=>[k,value[k]]));
}
export function safeError(error){return /^[a-z][a-z0-9_]{2,100}$/.test(error?.code||'')?error.code:'internal_voice_operation_failed';}
