-- One owner-requested private text comparison per exact candidate. No activation.
create table if not exists vy_replica_candidate_materialization (
 job_id uuid primary key,
 correction_job_id uuid not null references vy_replica_correction_candidate_job(job_id) on delete cascade,
 candidate_id uuid not null,
 dataset_id uuid not null,
 replica_id uuid not null,
 owner_user_id uuid not null,
 protocol text not null,
 model_commitment text not null check (model_commitment ~ '^[0-9a-f]{64}$'),
 source_set_hash text not null check (source_set_hash ~ '^[0-9a-f]{64}$'),
 baseline_hash text not null check (baseline_hash ~ '^[0-9a-f]{64}$'),
 artifact_sha256 text not null check (artifact_sha256 ~ '^[0-9a-f]{64}$'),
 manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
 blind_seed text not null check (blind_seed ~ '^[0-9a-f]{64}$'),
 total integer not null check (total between 60 and 200 and total % 2 = 0),
 state text not null check (state in ('preparing','working','packing','ready','held','failed')),
 package jsonb,
 eval_run_id uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (candidate_id),
 unique (job_id,replica_id,owner_user_id),
 foreign key (candidate_id,dataset_id,replica_id,owner_user_id)
  references vy_replica_candidate(candidate_id,dataset_id,replica_id,owner_user_id) on delete cascade,
 foreign key (dataset_id,replica_id,owner_user_id)
  references vy_replica_feedback_dataset(dataset_id,replica_id,owner_user_id) on delete cascade,
 check (state <> 'ready' or (package is not null and eval_run_id is not null))
);

create table if not exists vy_replica_candidate_materialization_item (
 item_id uuid primary key,
 job_id uuid not null,
 replica_id uuid not null,
 owner_user_id uuid not null,
 feedback_id uuid not null,
 sequence integer not null check (sequence between 1 and 200),
 role text not null check (role in ('baseline','candidate')),
 session_commitment text not null check (session_commitment ~ '^[0-9a-f]{64}$'),
 prompt_hash text not null check (prompt_hash ~ '^[0-9a-f]{64}$'),
 context_asset jsonb not null,
 output_asset jsonb,
 reservation_id uuid,
 usage jsonb,
 provider_identity jsonb,
 state text not null check (state in ('pending','claimed','running','response_recorded','complete','held','failed')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key (job_id,replica_id,owner_user_id)
  references vy_replica_candidate_materialization(job_id,replica_id,owner_user_id) on delete cascade,
 foreign key (feedback_id,replica_id,owner_user_id)
  references vy_replica_turn_feedback(feedback_id,replica_id,owner_user_id) on delete cascade,
 unique (job_id,feedback_id,role),
 unique (job_id,sequence),
 check (state not in ('running','response_recorded','complete') or reservation_id is not null),
 check (state <> 'complete' or (output_asset is not null and usage is not null and provider_identity is not null))
);

create index if not exists vy_replica_candidate_materialization_owner_ix
 on vy_replica_candidate_materialization(replica_id,owner_user_id,created_at desc);

create index if not exists vy_replica_candidate_materialization_item_job_ix
 on vy_replica_candidate_materialization_item(job_id,state,sequence);
