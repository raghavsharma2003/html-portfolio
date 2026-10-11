-- Migration 033 - provider-specific voice-talent consent evidence.
--
-- Microsoft Personal Voice requires a separate spoken statement whose name,
-- company and locale exactly match the provider request. This is not the
-- platform consent receipt and is never ordinary training material.

alter table vy_replica_source
  drop constraint if exists vy_replica_source_capture_mode_check,
  add constraint vy_replica_source_capture_mode_check
    check (capture_mode in ('live_challenge','provider_consent','upload','import','derived'));

create table if not exists vy_replica_provider_consent (
  provider_consent_id uuid primary key,
  replica_id          uuid not null,
  owner_user_id       uuid not null,
  provider            text not null check (provider = 'azure_personal_voice'),
  policy_version      text not null,
  provider_policy_version text not null,
  template_version    text not null,
  locale              text not null check (locale = 'en-US'),
  statement_sha256    text not null check (statement_sha256 ~ '^[0-9a-f]{64}$'),
  state               text not null default 'issued'
                      check (state in ('issued','uploaded','accepted','revoked','expired','failed')),
  source_id           uuid,
  attempt             integer not null check (attempt between 1 and 5),
  algorithm           text not null check (algorithm = 'AES-256-GCM'),
  key_id              text not null,
  nonce               bytea not null,
  ciphertext          bytea not null,
  auth_tag             bytea not null,
  wrapped_dek         bytea not null,
  wrap_nonce          bytea not null,
  wrap_auth_tag       bytea not null,
  aad_sha256          text not null check (aad_sha256 ~ '^[0-9a-f]{64}$'),
  failure_code        text not null default '',
  issued_at           timestamptz not null default now(),
  expires_at          timestamptz not null,
  uploaded_at         timestamptz,
  accepted_at         timestamptz,
  revoked_at          timestamptz,
  updated_at          timestamptz not null default now(),
  constraint vy_replica_provider_consent_crypto_shape check (
    octet_length(nonce) = 12 and octet_length(auth_tag) = 16 and octet_length(ciphertext) > 0
    and octet_length(wrapped_dek) = 32 and octet_length(wrap_nonce) = 12
    and octet_length(wrap_auth_tag) = 16
  ),
  constraint vy_replica_provider_consent_owner_identity
    unique (provider_consent_id, replica_id, owner_user_id),
  constraint vy_replica_provider_consent_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_provider_consent_source_fk
    foreign key (source_id, replica_id, owner_user_id)
    references vy_replica_source(source_id, replica_id, owner_user_id) on delete restrict
);

create index if not exists vy_replica_provider_consent_owner_ix
  on vy_replica_provider_consent (owner_user_id, replica_id, issued_at desc);

create unique index if not exists vy_replica_provider_consent_live_ix
  on vy_replica_provider_consent (replica_id, provider)
  where state in ('issued','uploaded');
