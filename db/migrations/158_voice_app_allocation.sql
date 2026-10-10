-- 158 SOURCE ONLY: private authority cascades; infrastructure cost survives erasure.
create table if not exists vy_voice_app_lifecycle (
 window_id uuid primary key references vy_gpu_allocation_window(window_id) on delete restrict,
 app_id text not null, revision_name text not null,
 configuration_sha256 text not null check(configuration_sha256 ~ '^[0-9a-f]{64}$'),
 template_sha256 text not null check(template_sha256 ~ '^[0-9a-f]{64}$'),
 contract_sha256 text not null check(contract_sha256 ~ '^[0-9a-f]{64}$'),
 broker_origin text not null, runtime_origin text not null,
 state text not null check(state in ('open','closing','close_claimed','terminal_observed','observation_unknown')),
 activation_state text not null default 'not_started' check(activation_state in ('not_started','claimed','acknowledged','unknown')),
 activation_dispatched_at timestamptz,
 deactivation_state text not null default 'not_started' check(deactivation_state in ('not_started','claimed','acknowledged','unknown')),
 deactivation_dispatched_at timestamptz,
 dispatch_deadline_at timestamptz not null,
 observation jsonb,
 created_at timestamptz not null default now()
);

create table if not exists vy_voice_allocation_authority (
 window_id uuid primary key references vy_voice_app_lifecycle(window_id) on delete restrict,
 replica_id uuid not null, owner_user_id uuid not null, source_id uuid not null,
 generation_id uuid not null, reference_sha256 text not null check(reference_sha256 ~ '^[0-9a-f]{64}$'),
 intent_id uuid not null, intent_attempt integer not null check(intent_attempt>0),
 lease_token_hash text not null check(lease_token_hash ~ '^[0-9a-f]{64}$'),
 text_sha256 text not null check(text_sha256 ~ '^[0-9a-f]{64}$'),
 language_id text not null check(language_id in ('hi','en')),
 foreign key(replica_id,owner_user_id) references vy_replica(replica_id,owner_user_id) on delete cascade,
 foreign key(source_id,replica_id,owner_user_id) references vy_replica_source(source_id,replica_id,owner_user_id) on delete cascade
);

create table if not exists vy_voice_allocation_child (
 child_id uuid primary key, window_id uuid not null references vy_voice_allocation_authority(window_id) on delete cascade,
 ordinal integer not null check(ordinal between 0 and 31),
 operation text not null check(operation in ('status','synthesize')),
 body_sha256 text not null check(body_sha256 ~ '^[0-9a-f]{64}$'),
 consumed_at timestamptz,
 unique(window_id,ordinal)
);

create table if not exists vy_voice_app_supervisor_lease (
 app_id text primary key, contract_sha256 text not null,
 revision_sha256 text not null, source_sha256 text not null,
 heartbeat_at timestamptz not null, lease_expires_at timestamptz not null
);

-- Monetary liability remains held after verified App shutdown; only resource exclusion is released.
alter table vy_gpu_allocation_window add column if not exists resource_released_at timestamptz;

alter table vy_gpu_allocation_window add column if not exists resource_release_sha256 text check(resource_release_sha256 ~ '^[0-9a-f]{64}$');

-- Apply158 transactionally: install replacement exclusion before removing the original stricter index.
create unique index if not exists vy_gpu_allocation_window_resource_exclusive
 on vy_gpu_allocation_window(resource_sha256)
 where state not in ('settled','released') and resource_released_at is null;

drop index if exists vy_gpu_allocation_window_exclusive;
