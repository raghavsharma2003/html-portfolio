-- Operator-controlled manual GPU experiment lifecycle, no personal payloads.
alter table vy_gpu_allocation_window add column if not exists azure_job_id text;

alter table vy_gpu_allocation_window add column if not exists azure_execution_name text;

alter table vy_gpu_allocation_window add column if not exists job_configuration_sha256 text;

alter table vy_gpu_allocation_window add column if not exists job_runtime_seconds integer;

alter table vy_gpu_allocation_window add column if not exists job_control_state text;

alter table vy_gpu_allocation_window add column if not exists job_observation_sha256 text;

alter table vy_gpu_allocation_window add column if not exists job_terminal_at timestamptz;

alter table vy_gpu_allocation_window drop constraint if exists vy_gpu_job_control_check;

alter table vy_gpu_allocation_window add constraint vy_gpu_job_control_check check (
  job_control_state is null or (
    job_control_state in ('start_claimed','start_unknown','running','stop_requested','stop_pending','observation_unknown','terminal_observed')
    and azure_job_id is not null and azure_job_id like '/subscriptions/%/providers/Microsoft.App/jobs/%'
    and job_configuration_sha256 is not null and job_configuration_sha256 ~ '^[0-9a-f]{64}$'
    and job_runtime_seconds is not null and job_runtime_seconds between 1 and 3600
  )
);

-- Estimates must not hide a larger verified invoice. Record actual cost,
-- pause further admission and allow the ledger to report the overrun.
alter table vy_gpu_allocation_window drop constraint if exists vy_gpu_allocation_window_actual_microusd_check;

alter table vy_gpu_allocation_window add constraint vy_gpu_allocation_window_actual_microusd_check
  check (actual_microusd is null or actual_microusd >= 0);

alter table vy_provider_budget drop constraint if exists vy_provider_budget_total_check;

alter table vy_provider_budget add constraint vy_provider_budget_total_check
  check (spent_microusd + reserved_microusd <= limit_microusd or state in ('paused','exhausted'));

-- Historical147 only admitted the older verified-bound interface. New
-- supervised experiments explicitly persist that their amount is estimated.
alter table vy_gpu_allocation_window add column if not exists accounting_basis text not null default 'verified_bound'
  check (accounting_basis in ('verified_bound','planning_estimate'));
