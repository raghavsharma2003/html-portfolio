-- Vyakti-only auth email outbox. This does not configure Supabase SMTP or hooks.
create sequence if not exists vy_auth_email_pilot_slot_seq as bigint minvalue 1 maxvalue 50 no cycle;

create table if not exists vy_auth_email_outbox (
  request_id uuid primary key,
  pilot_slot bigint not null default nextval('vy_auth_email_pilot_slot_seq') unique,
  retry_pilot_slot bigint unique,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  redirect_url text not null check (length(redirect_url) between 12 and 2048),
  redirect_hash text not null check (redirect_hash ~ '^[0-9a-f]{64}$'),
  owner_user_id uuid,
  state text not null default 'admitted'
    check (state in ('admitted','preparing','prepared','dispatching','pending','succeeded','failed','reconcile_required','expired')),
  preparation_token_hash text check (preparation_token_hash is null or preparation_token_hash ~ '^[0-9a-f]{64}$'),
  preparation_lease_expires_at timestamptz,
  payload_envelope jsonb,
  payload_hash text check (payload_hash is null or payload_hash ~ '^[0-9a-f]{64}$'),
  acs_operation_id uuid not null unique,
  repeatability_first_sent timestamptz not null,
  operation_location text check (operation_location is null or length(operation_location) between 20 and 2048),
  provider_status text check (provider_status is null or provider_status in ('NotStarted','Running','Succeeded','Failed')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  last_error_code text not null default '' check (last_error_code ~ '^[a-z0-9_]{0,100}$'),
  expires_at timestamptz not null,
  payload_erased_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pilot_slot between 1 and 50),
  check (retry_pilot_slot is null or retry_pilot_slot between 1 and 50),
  check (expires_at > created_at and expires_at <= created_at + interval '1 day'),
  check ((payload_envelope is null) = (payload_hash is null)),
  check ((preparation_token_hash is null) = (preparation_lease_expires_at is null)),
  check (payload_erased_at is null or payload_envelope is null)
);

create index if not exists vy_auth_email_outbox_state_ix
  on vy_auth_email_outbox(state,updated_at);

create index if not exists vy_auth_email_outbox_owner_ix
  on vy_auth_email_outbox(owner_user_id,created_at desc)
  where owner_user_id is not null;

create index if not exists vy_auth_email_outbox_expiry_ix
  on vy_auth_email_outbox(expires_at)
  where payload_envelope is not null;
