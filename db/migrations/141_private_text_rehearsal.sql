-- 141: one owner-authorized private text question. No verified model scope.
alter table vy_replica add column if not exists private_text_epoch bigint not null default 0 check (private_text_epoch >= 0);

alter table vy_replica_consent drop constraint if exists vy_replica_consent_scope_check;

alter table vy_replica_consent add constraint vy_replica_consent_scope_check check (scope in ('capture','transcription','biometric','training','inference','storage','sharing','api','telephony','model_improvement','private_text_rehearsal'));

create unique index if not exists vy_private_text_consent_request_ix on vy_replica_consent ((metadata->>'request_id')) where scope='private_text_rehearsal';

create table if not exists vy_private_text_rehearsal (
  request_id uuid primary key,
  replica_id uuid not null,
  owner_user_id uuid not null,
  consent_id uuid not null,
  receipt_hash text not null check (receipt_hash ~ '^[0-9a-f]{64}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  question_hash text not null check (question_hash ~ '^[0-9a-f]{64}$'),
  sheet_id uuid not null,
  context_item_id uuid not null references vy_context_item(item_id) on delete cascade,
  source_id uuid not null,
  authority_epoch bigint not null check (authority_epoch >= 0),
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object'),
  state text not null default 'admitted' check (state in ('admitted','dispatched','complete','blocked','uncertain','withdrawn')),
  dispatch_token_hash text,
  dispatched_at timestamptz,
  reservation_id uuid,
  budget_id text,
  spend_request_hash text,
  provider jsonb,
  billing_state text not null default 'not_started' check (billing_state in ('not_started','reserved','in_flight','settled','reconcile_required')),
  question_envelope jsonb,
  raw_envelope jsonb,
  answer_envelope jsonb,
  raw_hash text,
  answer_hash text,
  gate_sidecar jsonb not null default '{}'::jsonb,
  failure_code text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vy_private_text_owner_fk foreign key(replica_id,owner_user_id) references vy_replica(replica_id,owner_user_id) on delete cascade,
  constraint vy_private_text_consent_fk foreign key(consent_id,replica_id,owner_user_id) references vy_replica_consent(consent_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_private_text_source_fk foreign key(source_id,replica_id,owner_user_id) references vy_replica_source(source_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_private_text_receipt_once unique(consent_id),
  constraint vy_private_text_complete_payload check (state<>'complete' or (answer_envelope is not null and answer_hash ~ '^[0-9a-f]{64}$')),
  constraint vy_private_text_withdrawn_payload check (state<>'withdrawn' or (question_envelope is null and raw_envelope is null and answer_envelope is null))
);

create index if not exists vy_private_text_owner_ix on vy_private_text_rehearsal(owner_user_id,replica_id,created_at desc);
