-- Migration 021 - remove the raw RelationalOS compatibility defaults left by
-- migration 018. After this point a writer that omits agent_id fails loudly
-- instead of silently filing a replica conversation under Meera.
--
-- Apply only after `node evals/run.mjs agentstrict` passes and the live 010
-- agent-isolation fixture has passed against the target database.

alter table meera_log alter column agent_id drop default;
alter table meera_nodes alter column agent_id drop default;
alter table meera_edges alter column agent_id drop default;
alter table meera_forget alter column agent_id drop default;
alter table meera_consolidate_lease alter column agent_id drop default;
