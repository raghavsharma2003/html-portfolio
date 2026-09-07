-- 142: an owned terminal request ID can exist without ever minting consent.
alter table vy_private_text_rehearsal
  alter column consent_id drop not null,
  alter column receipt_hash drop not null,
  alter column request_hash drop not null,
  alter column question_hash drop not null,
  alter column sheet_id drop not null,
  alter column context_item_id drop not null,
  alter column source_id drop not null,
  alter column authority_epoch drop not null,
  alter column snapshot_hash drop not null,
  alter column snapshot drop not null;

alter table vy_private_text_rehearsal drop constraint if exists vy_private_text_rehearsal_billing_state_check;

alter table vy_private_text_rehearsal add constraint vy_private_text_rehearsal_billing_state_check
 check (billing_state in ('not_started','reserved','in_flight','settled','reconcile_required','unknown'));

alter table vy_private_text_rehearsal drop constraint if exists vy_private_text_authority_or_cancel;

alter table vy_private_text_rehearsal add constraint vy_private_text_authority_or_cancel check (
 (consent_id is not null and receipt_hash is not null and request_hash is not null and question_hash is not null
  and sheet_id is not null and context_item_id is not null and source_id is not null
  and authority_epoch is not null and snapshot_hash is not null and snapshot is not null)
 or (state='withdrawn' and billing_state='unknown' and consent_id is null and receipt_hash is null
  and request_hash is null and question_hash is null and sheet_id is null and context_item_id is null
  and source_id is null and authority_epoch is null and snapshot_hash is null and snapshot is null
  and reservation_id is null and budget_id is null and spend_request_hash is null and provider is null
  and dispatch_token_hash is null and dispatched_at is null and raw_hash is null and answer_hash is null)
);

alter table vy_private_text_rehearsal drop constraint if exists vy_private_text_live_request_payload;

alter table vy_private_text_rehearsal add constraint vy_private_text_live_request_payload
 check (state='withdrawn' or (question_envelope is not null and billing_state<>'unknown'));

-- Existing request PK arbitrates cancellation versus late admission. Existing
-- owner index and replica FK also cover tombstones with no source/consent FK.
