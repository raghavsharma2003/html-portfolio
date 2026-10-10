import {AUTHORITY,args,one} from '../../services/private-voice/store.mjs';
import {privateVoiceError} from '../_private-voice-store.js';
export const PRIVATE_LEDGER_SQL={
 manifest:`with ${AUTHORITY} update vy_private_voice_run h set protection=h.protection||jsonb_build_object('manifest',$7::jsonb)
 from authorized a where h.run_id=a.run_id and h.protection->>'state'='open' returning h.run_id`,
 open:`with ${AUTHORITY} update vy_private_voice_run h set protection=jsonb_build_object('state','open','open',$7::jsonb,'segments','[]'::jsonb)
 from authorized a where h.run_id=a.run_id and h.protection is null returning h.run_id`,
 append:`with ${AUTHORITY} update vy_private_voice_run h set protection=jsonb_set(h.protection,'{segments}',(h.protection->'segments')||jsonb_build_array($7::jsonb))
 from authorized a where h.run_id=a.run_id and h.protection->>'state'='open'
 and jsonb_array_length(h.protection->'segments')=($7::jsonb->>'sequence')::int4
 and jsonb_array_length(h.protection->'segments')<400 and pg_column_size(h.protection)<524288 returning h.run_id`,
 seal:`with ${AUTHORITY} update vy_private_voice_run h set protection=h.protection||jsonb_build_object('state','sealed','receipt',$7::jsonb,'envelope',$8::text)
 from authorized a where h.run_id=a.run_id and h.protection->>'state'='open'
 and jsonb_array_length(h.protection->'segments')=$9::int4 returning h.run_id`,
 abort:`with ${AUTHORITY} update vy_private_voice_run h set protection=coalesce(h.protection,'{}'::jsonb)||jsonb_build_object('state','aborted')
 from authorized a where h.run_id=a.run_id returning h.run_id`,
};
export function createPrivateVoiceLedger(db,row){
 const bound=authorization=>{if(authorization.generationId!==row.run_id||authorization.replicaId!==row.replica_id||authorization.ownerUserId!==row.owner_user_id)
  throw privateVoiceError('private_voice_ledger_scope_invalid');};
 return {name:'neon-private-voice-ledger',
  async persistManifest(input){bound({generationId:input.generationId,replicaId:row.replica_id,ownerUserId:row.owner_user_id});
   if(Buffer.byteLength(JSON.stringify(input))>1500000)throw privateVoiceError('private_voice_manifest_oversized');
   return [one(await db(PRIVATE_LEDGER_SQL.manifest,[...args(row),JSON.stringify(input)]))];},
  async open(input){bound(input);one(await db(PRIVATE_LEDGER_SQL.open,[...args(row),JSON.stringify(input)]));},
  async appendSegment({authorization,receipt}){bound(authorization);if(Buffer.byteLength(JSON.stringify(receipt))>8192)throw privateVoiceError('private_voice_receipt_oversized');
   one(await db(PRIVATE_LEDGER_SQL.append,[...args(row),JSON.stringify(receipt)]));},
  async seal({authorization,receipt,envelopeCanonical,segmentCount}){bound(authorization);
   if(Buffer.byteLength(envelopeCanonical)>16384||Buffer.byteLength(JSON.stringify(receipt))>16384)throw privateVoiceError('private_voice_receipt_oversized');
   one(await db(PRIVATE_LEDGER_SQL.seal,[...args(row),JSON.stringify(receipt),envelopeCanonical,segmentCount]));},
  async abort(input){bound(input);one(await db(PRIVATE_LEDGER_SQL.abort,args(row)));},
 };
}
