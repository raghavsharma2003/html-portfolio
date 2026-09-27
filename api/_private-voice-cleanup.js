import {privateVoiceSchemaPresent,revokeDeletingPrivateVoice} from './_private-voice-erasure.js';
import {createExecutionStore} from '../services/private-voice/store.mjs';
export async function runPrivateVoiceResultCleanup({db,deleteObject}){
 if(!await privateVoiceSchemaPresent(db))return {enabled:false,examined:0,deleted:0};
 await revokeDeletingPrivateVoice(db);
 return {enabled:true,...await createExecutionStore(db).cleanup(deleteObject)};
}
