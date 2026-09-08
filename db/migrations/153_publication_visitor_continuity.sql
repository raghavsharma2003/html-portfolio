-- Optional continuity for newly reviewed v2 publications. Existing v1 stays off.
alter table vy_text_publication drop constraint if exists vy_text_publication_version_check;

alter table vy_text_publication add constraint vy_text_publication_version_check check(version in (1,2));

alter table vy_text_publication_visitor add column if not exists memory_enabled boolean not null default false;

alter table vy_text_publication_visitor add column if not exists memory_epoch bigint not null default 0 check(memory_epoch>=0);

alter table vy_text_publication_visitor add column if not exists memory_policy_hash text check(memory_policy_hash is null or memory_policy_hash ~ '^[0-9a-f]{64}$');

alter table vy_text_publication_visitor add column if not exists memory_choice_at timestamptz;

alter table vy_text_publication_request add column if not exists memory_epoch bigint check(memory_epoch is null or memory_epoch>=0);

alter table vy_text_publication_request add column if not exists memory_refs jsonb not null default '[]'::jsonb check(jsonb_typeof(memory_refs)='array' and jsonb_array_length(memory_refs)<=3);

alter table vy_text_publication_request add column if not exists memory_refs_hash text check(memory_refs_hash is null or memory_refs_hash ~ '^[0-9a-f]{64}$');

create index if not exists vy_text_request_memory_scope_ix on vy_text_publication_request(publication_id,visitor_user_id,memory_epoch,created_at,request_id) where state='complete' and memory_epoch is not null;
