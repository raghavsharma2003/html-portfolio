-- Migration 041 - purpose-limited biometric verification consent and official
-- Azure Face liveness-with-verify session lifecycle. Provider session handles
-- are AES-GCM sealed by the broker; one-time quick links are never durably persisted.

create table if not exists vy_replica_biometric_verification_grant (
  grant_id          uuid primary key default gen_random_uuid(),
  challenge_id      uuid not null,
  replica_id         uuid not null,
  owner_user_id      uuid not null,
  statement_set      text not null,
  receipt_hash       text not null check (receipt_hash ~ '^[0-9a-f]{64}$'),
  receipt_payload    jsonb not null check (jsonb_typeof(receipt_payload)='object'),
  state              text not null default 'active'
                     check (state in ('active','consumed','revoked','expired')),
  granted_at         timestamptz not null default now(),
  expires_at         timestamptz not null,
  consumed_at        timestamptz,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now(),
  constraint vy_replica_biometric_grant_challenge_unique unique (challenge_id),
  constraint vy_replica_biometric_grant_owner_fk
    foreign key (challenge_id,replica_id,owner_user_id)
    references vy_replica_liveness_challenge(challenge_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_biometric_grant_time_check check (expires_at>granted_at)
);

-- A partially applied migration must never leave active grants without the
-- canonical receipt that makes their authorization independently auditable.
alter table vy_replica_biometric_verification_grant
  add column if not exists receipt_payload jsonb not null default '{}'::jsonb;
update vy_replica_biometric_verification_grant
   set state='revoked',revoked_at=coalesce(revoked_at,now())
 where receipt_payload='{}'::jsonb and state='active';
alter table vy_replica_biometric_verification_grant
  alter column receipt_payload drop default;

create index if not exists vy_replica_biometric_grant_active_ix
  on vy_replica_biometric_verification_grant (owner_user_id,replica_id,expires_at)
  where state='active';

alter table vy_replica_liveness_challenge
  add column if not exists face_session_state text not null default 'not_started';

alter table vy_replica_liveness_challenge
  add column if not exists face_session_attempt integer not null default 0;

alter table vy_replica_liveness_challenge
  add column if not exists face_session_handle text not null default '';

alter table vy_replica_liveness_challenge
  add column if not exists face_session_handle_hash text not null default '';

alter table vy_replica_liveness_challenge
  add column if not exists face_session_reference_sha256 text not null default '';

alter table vy_replica_liveness_challenge
  add column if not exists face_session_model_version text not null default '';

alter table vy_replica_liveness_challenge
  add column if not exists face_session_result jsonb not null default '{}'::jsonb;

alter table vy_replica_liveness_challenge
  add column if not exists face_session_expires_at timestamptz;

alter table vy_replica_liveness_challenge
  add column if not exists face_session_issued_at timestamptz;

alter table vy_replica_liveness_challenge
  add column if not exists face_session_terminal_at timestamptz;

alter table vy_replica_liveness_challenge
  add column if not exists face_session_provider_deleted_at timestamptz;

alter table vy_replica_liveness_challenge
  add column if not exists face_session_lease_token_hash text not null default '';

alter table vy_replica_liveness_challenge
  add column if not exists face_session_leased_at timestamptz;

alter table vy_replica_liveness_challenge
  add column if not exists face_session_lease_expires_at timestamptz;

do $replica_face_session_checks$
begin
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_biometric_grant_receipt_payload_check'
      and conrelid='vy_replica_biometric_verification_grant'::regclass
  ) then
    alter table vy_replica_biometric_verification_grant
      add constraint vy_replica_biometric_grant_receipt_payload_check
      check (jsonb_typeof(receipt_payload)='object' and (receipt_payload<>'{}'::jsonb or state='revoked'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_face_session_state_check'
      and conrelid='vy_replica_liveness_challenge'::regclass
  ) then
    alter table vy_replica_liveness_challenge add constraint vy_replica_face_session_state_check
      check (face_session_state in (
        'not_started','issuing','ready','polling',
        'passed_deleting','failed_deleting','expired_deleting',
        'passed_deleted','failed_deleted','expired_deleted'
      ));
  end if;
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_face_session_attempt_check'
      and conrelid='vy_replica_liveness_challenge'::regclass
  ) then
    alter table vy_replica_liveness_challenge add constraint vy_replica_face_session_attempt_check
      check (face_session_attempt>=0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_face_session_hash_check'
      and conrelid='vy_replica_liveness_challenge'::regclass
  ) then
    alter table vy_replica_liveness_challenge add constraint vy_replica_face_session_hash_check
      check (
        (face_session_handle_hash='' or face_session_handle_hash ~ '^[0-9a-f]{64}$') and
        (face_session_reference_sha256='' or face_session_reference_sha256 ~ '^[0-9a-f]{64}$') and
        (face_session_lease_token_hash='' or face_session_lease_token_hash ~ '^[0-9a-f]{64}$')
      );
  end if;
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_face_session_result_check'
      and conrelid='vy_replica_liveness_challenge'::regclass
  ) then
    alter table vy_replica_liveness_challenge add constraint vy_replica_face_session_result_check
      check (jsonb_typeof(face_session_result)='object');
  end if;
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_face_session_handle_lifecycle_check'
      and conrelid='vy_replica_liveness_challenge'::regclass
  ) then
    alter table vy_replica_liveness_challenge add constraint vy_replica_face_session_handle_lifecycle_check
      check (
        (face_session_state in ('not_started','issuing') and face_session_handle='') or
        (face_session_state in ('ready','polling','passed_deleting','failed_deleting','expired_deleting')
          and face_session_handle<>'' and face_session_handle_hash~'^[0-9a-f]{64}$'
          and face_session_reference_sha256~'^[0-9a-f]{64}$' and face_session_model_version<>''
          and face_session_expires_at is not null and face_session_provider_deleted_at is null) or
        (face_session_state in ('passed_deleted','failed_deleted','expired_deleted')
          and face_session_handle='' and face_session_provider_deleted_at is not null)
      );
  end if;
end;
$replica_face_session_checks$;

create index if not exists vy_replica_face_session_cleanup_ix
  on vy_replica_liveness_challenge (face_session_lease_expires_at,updated_at)
  where face_session_state in (
    'issuing','ready','polling','passed_deleting','failed_deleting','expired_deleting'
  );
