-- Content-free infrastructure accounting. No owner, source, audio or prompt.
-- A held row is an exclusive resource lease even after its proposed deadline.
create table if not exists vy_gpu_allocation_window (
  window_id uuid primary key default gen_random_uuid(),
  budget_id text not null references vy_provider_budget(budget_id) on delete restrict,
  resource_sha256 text not null check (resource_sha256 ~ '^[0-9a-f]{64}$'),
  revision_sha256 text not null check (revision_sha256 ~ '^[0-9a-f]{64}$'),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  provider_request_sha256 text not null check (provider_request_sha256 ~ '^[0-9a-f]{64}$'),
  contract_sha256 text not null check (contract_sha256 ~ '^[0-9a-f]{64}$'),
  reserved_microusd bigint not null check (reserved_microusd > 0),
  max_allocation_seconds integer not null check (max_allocation_seconds between 1 and 3600),
  state text not null check (state in ('reserved','in_flight','accounting_pending','uncertain','settled','released')),
  response_sha256 text check (response_sha256 is null or response_sha256 ~ '^[0-9a-f]{64}$'),
  usage_sha256 text check (usage_sha256 is null or usage_sha256 ~ '^[0-9a-f]{64}$'),
  actual_microusd bigint check (actual_microusd >= 0 and actual_microusd <= reserved_microusd),
  created_at timestamptz not null default now(),
  begun_at timestamptz,
  finished_at timestamptz,
  unique (budget_id,request_sha256),
  check (state <> 'settled' or (usage_sha256 is not null and actual_microusd is not null and finished_at is not null)),
  check (state <> 'accounting_pending' or response_sha256 is not null)
);

-- All revisions and all budgets share the same resource exclusion.
create unique index if not exists vy_gpu_allocation_window_exclusive
  on vy_gpu_allocation_window(resource_sha256)
  where state not in ('settled','released');

alter table vy_replica_comparison_dispatch add column if not exists response_recorded_at timestamptz;

-- A provider response is not a settled Azure invoice. Preserve historical rows.
alter table vy_replica_comparison_dispatch drop constraint if exists vy_replica_comparison_dispatch_state_check;

alter table vy_replica_comparison_dispatch add constraint vy_replica_comparison_dispatch_state_check
  check (state in ('started','settled','response_recorded','reconciliation_required'));

alter table vy_replica_comparison_dispatch drop constraint if exists vy_comparison_response_receipt_check;

alter table vy_replica_comparison_dispatch add constraint vy_comparison_response_receipt_check
  check (state<>'response_recorded' or (result_sha256 is not null and result_sha256 ~ '^[0-9a-f]{64}$' and response_recorded_at is not null));
