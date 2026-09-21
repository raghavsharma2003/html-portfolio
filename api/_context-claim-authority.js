function alias(value) {
  const result = String(value || '');
  if (!/^[a-z_][a-z0-9_]*$/i.test(result)) throw new Error('sql_alias_invalid');
  return result;
}
/** Current database authority for canonical owner-authored Context Locker text. */
export function contextTextEvidenceAuthoritySql(evidenceAlias = 'e') {
  const e = alias(evidenceAlias);
  return `(${e}.evidence_type='text_span'
 and ${e}.adapter_family='context-locker' and ${e}.adapter_version='canonical-evidence-v1'
 and ${e}.value#>>'{provenance,origin}'='context_locker'
 and ${e}.value#>>'{provenance,source_id}'=${e}.source_id::text
 and ${e}.value#>>'{provenance,protected_trait_inference}'='false'
 and ${e}.value#>>'{provenance,inner_state_inference}'='false'
 and ${e}.value#>>'{epistemic_status}'='observed'
 and ${e}.value#>>'{observation_target}'='owner_supplied_text'
 and exists (
   select 1 from vy_replica_source context_source
   join vy_context_item context_item
     on context_item.source_id=context_source.source_id
    and context_item.replica_id=context_source.replica_id
    and context_item.owner_user_id=context_source.owner_user_id
   join vy_context_item_text context_text
     on context_text.item_id=context_item.item_id
    and context_text.replica_id=context_item.replica_id
    and context_text.owner_user_id=context_item.owner_user_id
   where context_source.source_id=${e}.source_id
     and context_source.replica_id=${e}.replica_id
     and context_source.owner_user_id=${e}.owner_user_id
     and context_source.state='ready' and context_source.contains_third_parties=false
     and context_source.purpose='context_item'
     and context_source.provenance->>'purpose'='context_item'
     and context_item.status in ('extracted','mined')
     and context_item.format<>'whatsapp_export'
     and context_item.authorship='mine' and context_item.consent_scope='own_context'
     and context_item.content_sha256=context_source.sha256
     and ${e}.input_sha256=context_source.sha256
     and ${e}.value#>>'{provenance,context_item_id}'=context_item.item_id::text
     and ${e}.value#>>'{provenance,raw_content_sha256}'=context_source.sha256
     and ${e}.value#>>'{locator,canonical_text_sha256}'=
       encode(digest(convert_to(context_text.body,'UTF8'),'sha256'),'hex')
 ))`;
}
