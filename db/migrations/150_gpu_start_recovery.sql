-- Preserve the original149 pin. New starts capture a durable idle inventory
-- before ARM POST. Legacy windows without it cannot infer an execution name.
alter table vy_gpu_allocation_window add column if not exists job_prestart_inventory jsonb;

alter table vy_gpu_allocation_window add column if not exists job_start_requested_at timestamptz;

alter table vy_gpu_allocation_window add column if not exists job_recovery_sha256 text;

alter table vy_gpu_allocation_window add column if not exists job_execution_template_sha256 text;

alter table vy_gpu_allocation_window drop constraint if exists vy_gpu_start_inventory_check;

alter table vy_gpu_allocation_window add constraint vy_gpu_start_inventory_check check (
  job_prestart_inventory is null or (
    jsonb_typeof(job_prestart_inventory)='array' and job_start_requested_at is not null
    and job_execution_template_sha256 is not null and job_execution_template_sha256 ~ '^[0-9a-f]{64}$'
  )
);

alter table vy_gpu_allocation_window drop constraint if exists vy_gpu_start_recovery_check;

alter table vy_gpu_allocation_window add constraint vy_gpu_start_recovery_check check (
  job_recovery_sha256 is null or (job_recovery_sha256 ~ '^[0-9a-f]{64}$'
    and azure_execution_name is not null and job_prestart_inventory is not null
    and job_start_requested_at is not null)
);
