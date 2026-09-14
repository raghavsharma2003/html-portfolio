-- Account-material text only. No agent, voice or verified identity grant.
-- Content-free claim-once URL ledger survives replica/source deletion. It cannot
-- resolve an owner, source, visitor, receipt or answer.
create table if not exists vy_text_publication_id_ledger (
 id uuid primary key,
 kind text not null check(kind in ('publication','request')),
 claimed_at timestamptz not null default now()
);

create table if not exists vy_text_publication (
 publication_id uuid primary key,
 replica_id uuid not null,
 owner_user_id uuid not null,
 source_id uuid,
 context_item_id uuid references vy_context_item(item_id) on delete cascade,
 sheet_id uuid,
 version integer not null default 1 check(version=1),
 epoch bigint not null default 0 check(epoch>=0),
 state text not null default 'active' check(state in ('active','revoked')),
 review_hash text check(review_hash ~ '^[0-9a-f]{64}$'),
 request_hash text check(request_hash ~ '^[0-9a-f]{64}$'),
 snapshot jsonb not null default '{}'::jsonb,
 projection jsonb,
 receipt jsonb,
 receipt_hash text check(receipt_hash ~ '^[0-9a-f]{64}$'),
 disclosure text not null default '',
 disclosure_hash text not null default '',
 terms jsonb not null default '{}'::jsonb,
 question_count integer not null default 0 check(question_count>=0),
 committed_microusd bigint not null default 0 check(committed_microusd>=0),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now(),
 revoked_at timestamptz,
 constraint vy_text_publication_owner_fk foreign key(replica_id,owner_user_id) references vy_replica(replica_id,owner_user_id) on delete cascade,
 constraint vy_text_publication_source_fk foreign key(source_id,replica_id,owner_user_id) references vy_replica_source(source_id,replica_id,owner_user_id) on delete cascade,
 constraint vy_text_publication_scope unique(publication_id,replica_id,owner_user_id),
 constraint vy_text_publication_active_payload check(state<>'active' or (projection is not null and receipt is not null and source_id is not null and context_item_id is not null and sheet_id is not null and review_hash is not null and request_hash is not null and receipt_hash is not null)),
 constraint vy_text_publication_revoked_payload check(state<>'revoked' or (projection is null and receipt is null))
);

create unique index if not exists vy_text_publication_one_active on vy_text_publication(replica_id,owner_user_id) where state='active';

create table if not exists vy_text_publication_visitor (
 publication_id uuid not null,
 replica_id uuid not null,
 owner_user_id uuid not null,
 visitor_user_id uuid not null,
 session_epoch bigint not null default 0 check(session_epoch>=0),
 question_count integer not null default 0 check(question_count>=0),
 admission jsonb,
 admission_hash text,
 expires_at timestamptz,
 created_at timestamptz not null default now(),
 primary key(publication_id,visitor_user_id),
 constraint vy_text_visitor_publication_fk foreign key(publication_id,replica_id,owner_user_id) references vy_text_publication(publication_id,replica_id,owner_user_id) on delete cascade
);

create table if not exists vy_text_publication_request (
 request_id uuid primary key,
 publication_id uuid not null,
 replica_id uuid not null,
 owner_user_id uuid not null,
 visitor_user_id uuid not null,
 publication_epoch bigint not null,
 session_epoch bigint not null,
 request_hash text not null,
 question_hash text not null,
 state text not null default 'admitted' check(state in ('admitted','dispatched','complete','blocked','uncertain','withdrawn')),
 dispatch_token_hash text,
 dispatch_authority_epoch bigint,
 reservation_id uuid,
 budget_id text,
 spend_request_hash text,
 provider jsonb,
 billing_state text not null default 'not_started' check(billing_state in ('not_started','reserved','in_flight','settled','reconcile_required')),
 question_envelope jsonb,
 answer_envelope jsonb,
 raw_envelope jsonb,
 answer_hash text,
 raw_hash text,
 gate_sidecar jsonb not null default '{}'::jsonb,
 failure_code text not null default '',
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now(),
 constraint vy_text_request_publication_fk foreign key(publication_id,replica_id,owner_user_id) references vy_text_publication(publication_id,replica_id,owner_user_id) on delete cascade,
 constraint vy_text_request_visitor_fk foreign key(publication_id,visitor_user_id) references vy_text_publication_visitor(publication_id,visitor_user_id) on delete cascade,
 constraint vy_text_request_complete_payload check(state<>'complete' or (answer_envelope is not null and answer_hash is not null)),
 constraint vy_text_request_withdrawn_payload check(state<>'withdrawn' or (question_envelope is null and answer_envelope is null and raw_envelope is null))
);

create index if not exists vy_text_publication_owner_ix on vy_text_publication(owner_user_id,replica_id);

create index if not exists vy_text_visitor_user_ix on vy_text_publication_visitor(visitor_user_id);

create index if not exists vy_text_request_user_ix on vy_text_publication_request(visitor_user_id,publication_id);
