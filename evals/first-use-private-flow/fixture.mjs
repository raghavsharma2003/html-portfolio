const RID='10000000-0000-4000-8000-000000000001',OTHER='10000000-0000-4000-8000-000000000002';
const SHEET='20000000-0000-4000-8000-000000000001',ITEM='30000000-0000-4000-8000-000000000001',SOURCE='40000000-0000-4000-8000-000000000001',GRANT='50000000-0000-4000-8000-000000000001';
const TOKEN='private-text-fixture-token',OWNER='60000000-0000-4000-8000-000000000001',hash='a'.repeat(64);
const statements=[{id:'authorize_private_text_question',text:'I authorize this private text question using my selected draft and source.'},{id:'understand_ai_text_only',text:'I understand this is AI text only, without voice or public activation.'},{id:'understand_private_retention_and_withdrawal',text:'I understand this private test remains until removed; I can withdraw it.'}];

export {RID,OTHER,SHEET,ITEM,SOURCE,GRANT,TOKEN,OWNER,hash,statements};
