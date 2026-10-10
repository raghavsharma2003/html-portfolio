-- 161 SOURCE ONLY. Source authority cascades; infrastructure observations and monetary holds survive erasure.
create table if not exists vy_processing_gpu_lifecycle (
 window_id uuid primary key references vy_gpu_allocation_window(window_id) on delete restrict,
 resource_id text not null, revision_sha256 text not null check(revision_sha256 ~ '^[0-9a-f]{64}$'),
 origin text not null, contract_sha256 text not null check(contract_sha256 ~ '^[0-9a-f]{64}$'),
 state text not null check(state in ('open','closed','natural_zero_observed')),
 admission_deadline_at timestamptz not null, closed_at timestamptz, observation jsonb,
 created_at timestamptz not null default now()
);

create table if not exists vy_processing_gpu_authority (
 window_id uuid primary key references vy_processing_gpu_lifecycle(window_id) on delete restrict,
 source_id uuid not null, replica_id uuid not null, owner_user_id uuid not null,
 revision integer not null check(revision>0), source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
 foreign key(source_id,replica_id,owner_user_id) references vy_replica_source(source_id,replica_id,owner_user_id) on delete cascade,
 foreign key(replica_id,owner_user_id) references vy_replica(replica_id,owner_user_id) on delete cascade
);

create table if not exists vy_processing_gpu_child (
 window_id uuid not null references vy_processing_gpu_lifecycle(window_id) on delete restrict,
 job_sha256 text not null check(job_sha256 ~ '^[0-9a-f]{64}$'),
 operation text not null check(operation in ('diarize','separate','enhance','voice_quality')),
 request_sha256 text not null check(request_sha256 ~ '^[0-9a-f]{64}$'),
 state text not null check(state in ('claimed','response_received')),
 response_sha256 text check(response_sha256 ~ '^[0-9a-f]{64}$'),
 claimed_at timestamptz not null default now(), response_at timestamptz,
 primary key(window_id,job_sha256), unique(window_id,operation)
);
