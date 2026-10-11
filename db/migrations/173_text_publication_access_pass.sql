-- 173: owner-minted private access for an existing text publication.
-- A pass is not a payment record. Plaintext exists only in the create response;
-- this table stores its hash and the authenticated visitor that claimed it.
alter table vy_text_publication
  add column if not exists access_pass_issued_count integer not null default 0;

alter table vy_text_publication
  drop constraint if exists vy_text_publication_access_pass_count_check;

alter table vy_text_publication
  add constraint vy_text_publication_access_pass_count_check
  check (access_pass_issued_count between 0 and 100);

create table if not exists vy_text_publication_access_pass (
  pass_id uuid primary key,
  publication_id uuid not null,
  replica_id uuid not null,
  owner_user_id uuid not null,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'available' check (state in ('available','claimed','revoked')),
  visitor_user_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  revoked_at timestamptz,
  constraint vy_text_access_pass_publication_fk
    foreign key (publication_id,replica_id,owner_user_id)
    references vy_text_publication(publication_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_text_access_pass_scope unique (pass_id,publication_id),
  constraint vy_text_access_pass_state_shape check (
    (state='available' and visitor_user_id is null and claimed_at is null and revoked_at is null)
    or (state='claimed' and visitor_user_id is not null and claimed_at is not null and revoked_at is null)
    or (state='revoked' and revoked_at is not null)
  )
);

create unique index if not exists vy_text_access_pass_code_hash_ix
  on vy_text_publication_access_pass(code_hash);

create unique index if not exists vy_text_access_pass_claimed_visitor_ix
  on vy_text_publication_access_pass(publication_id,visitor_user_id)
  where state='claimed' and visitor_user_id is not null;

create index if not exists vy_text_access_pass_owner_state_ix
  on vy_text_publication_access_pass(owner_user_id,replica_id,publication_id,state,created_at);

alter table vy_text_publication_visitor
  add column if not exists access_pass_id uuid;

alter table vy_text_publication_visitor
  drop constraint if exists vy_text_visitor_access_pass_fk;

alter table vy_text_publication_visitor
  add constraint vy_text_visitor_access_pass_fk
  foreign key (access_pass_id,publication_id)
  references vy_text_publication_access_pass(pass_id,publication_id) on delete cascade;
