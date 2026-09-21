-- Repair the actual PostgreSQL name observed in the 2026-09-08 dev catalog.
-- Migration147 references two columns, so PostgreSQL named this constraint
-- vy_gpu_allocation_window_check, not the column-specific name dropped in149.
-- Keep149's nonnegative check and check1's settled-receipt requirements.
-- Verified debt must be recorded in full; reconciliation pauses new admission.
alter table vy_gpu_allocation_window drop constraint if exists vy_gpu_allocation_window_check;
