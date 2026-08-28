-- Migration 064 - make a room address unique inside an agent, not globally.
--
-- Migration 055 made one inbound bot/number resolve to one clone, so two
-- different clone credentials may legitimately report the same opaque chat id.
-- The old indexes below ignored agent_id. Their conflict path either returned
-- another clone's room or made the second insert disappear. Runtime reads now
-- fail closed on agent_id; these indexes make the corresponding write possible.
--
-- Existing rows keep their ids and bindings. Build the agent-aware indexes
-- before removing the legacy global ones: the one-statement Neon migrator can
-- stop after any statement without leaving room addresses unconstrained.

create unique index if not exists vy_group_agent_surface_chat_ix
  on vy_group (agent_id, surface, surface_chat_id)
  where surface is not null and surface_chat_id is not null;

-- Telegram's legacy mirror remains live during the migration-013 compatibility
-- window, so it needs the same ownership boundary as the authoritative key.
create unique index if not exists vy_group_agent_tg_chat_ix
  on vy_group (agent_id, tg_chat_id)
  where tg_chat_id is not null;

drop index if exists vy_group_surface_chat_ix;

drop index if exists vy_group_tg_chat_ix;
