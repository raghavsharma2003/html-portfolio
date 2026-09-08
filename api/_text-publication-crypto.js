import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { canonicalJson, sha256Hex } from './_provenance/contracts.js';
const fail=code=>{throw Object.assign(new Error(code),{code,status:503});};
export const publicationTextBinding=(r,role,content_hash)=>({owner_user_id:r.owner_user_id,replica_id:r.replica_id,publication_id:r.publication_id,visitor_user_id:r.visitor_user_id,request_id:r.request_id,role,content_hash});
export function textPublicationKey(env=process.env){
 const id=String(env.PRIVATE_TEXT_REHEARSAL_KEK_ID||'').trim(),encoded=String(env.PRIVATE_TEXT_REHEARSAL_KEK_B64||'').trim();
 const key=Buffer.from(encoded,'base64');
 if(!/^[a-zA-Z0-9._-]{3,80}$/.test(id)||key.length!==32||key.toString('base64').replace(/=+$/,'')!==encoded.replace(/=+$/,''))fail('text_publication_encryption_unavailable');
 return {id,key};
}
function aad(binding){
 if(!['question','raw','answer'].includes(binding.role)||!binding.owner_user_id||!binding.replica_id||!binding.request_id||!binding.publication_id||!binding.visitor_user_id||typeof binding.content_hash!=='string'||binding.content_hash.length!==64||!/^[0-9a-f]{64}$/.test(binding.content_hash))fail('text_publication_encryption_binding_invalid');
 return Buffer.from(canonicalJson({domain:'vyakti.account-material-publication.v1',...binding}));
}
export function encryptPublicationText(text,binding,env=process.env){
 const {id,key}=textPublicationKey(env),associated=aad(binding),dataKey=randomBytes(32),nonce=randomBytes(12),wrapNonce=randomBytes(12);
 if(sha256Hex(String(text))!==binding.content_hash)fail('text_publication_content_hash_mismatch');
 const cipher=createCipheriv('aes-256-gcm',dataKey,nonce);cipher.setAAD(associated);const ciphertext=Buffer.concat([cipher.update(String(text),'utf8'),cipher.final()]);
 const wrapper=createCipheriv('aes-256-gcm',key,wrapNonce);wrapper.setAAD(Buffer.concat([associated,Buffer.from('|dek')]));const wrapped=Buffer.concat([wrapper.update(dataKey),wrapper.final()]);
 return {algorithm:'AES-256-GCM',key_id:id,nonce:nonce.toString('base64'),ciphertext:ciphertext.toString('base64'),auth_tag:cipher.getAuthTag().toString('base64'),wrap_nonce:wrapNonce.toString('base64'),wrapped_dek:wrapped.toString('base64'),wrap_auth_tag:wrapper.getAuthTag().toString('base64'),aad_hash:sha256Hex(associated)};
}
export function decryptPublicationText(envelope,binding,env=process.env){
 const {id,key}=textPublicationKey(env),associated=aad(binding);
 if(!envelope||envelope.algorithm!=='AES-256-GCM'||envelope.key_id!==id||envelope.aad_hash!==sha256Hex(associated))fail('text_publication_encryption_binding_invalid');
 try{
 const wrapper=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.wrap_nonce,'base64'));wrapper.setAAD(Buffer.concat([associated,Buffer.from('|dek')]));wrapper.setAuthTag(Buffer.from(envelope.wrap_auth_tag,'base64'));const dataKey=Buffer.concat([wrapper.update(Buffer.from(envelope.wrapped_dek,'base64')),wrapper.final()]);
 const cipher=createDecipheriv('aes-256-gcm',dataKey,Buffer.from(envelope.nonce,'base64'));cipher.setAAD(associated);cipher.setAuthTag(Buffer.from(envelope.auth_tag,'base64'));const text=Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext,'base64')),cipher.final()]).toString('utf8');if(sha256Hex(text)!==binding.content_hash)fail('text_publication_content_hash_mismatch');return text;
 }catch{fail('text_publication_decryption_failed');}
}
