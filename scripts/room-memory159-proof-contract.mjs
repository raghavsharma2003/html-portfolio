// Preparation only: importing this module performs no DB/network/provider work.
// Use the existing root transaction/receipt runner and its synthetic Room owner.
import * as memory from '../api/_room-memory-authority.js';
import { MEERA_AGENT_ID } from '../api/_agentscope.js';

export const migrationPath='db/migrations/159_room_memory_authority.sql';
export const migrationStatementCount=11;
export const schemaReadinessSQL=`select
 (select jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'type',data_type,'nullable',is_nullable,'default',column_default)
 order by table_name,column_name) from information_schema.columns where table_schema='public' and
 ((table_name='vy_room_follower' and column_name='memory_epoch') or
 (table_name in ('meera_log','vy_episode') and column_name in ('room_memory_follower_id','room_memory_epoch')))) as columns,
 (select jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid)) order by c.conname)
 from pg_constraint c where c.contype='f' and c.confrelid='vy_room_follower'::regclass
 and c.conrelid in ('meera_log'::regclass,'vy_episode'::regclass)) as source_fks,
 (select jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid),
 'function',pg_get_functiondef(t.tgfoid)) order by t.tgname) from pg_trigger t
 where t.tgrelid='vy_room_follower'::regclass and t.tgname in ('vy_room_memory_epoch_change','vy_room_memory_follower_erasure')) as triggers`;

export function proofStatements({followerId,epoch,agentId,personId,roomId,deviceId,sourceId,sourceText}) {
 const authority=[followerId,String(epoch),agentId,personId];
 const sources=JSON.stringify([{id:String(sourceId),content:sourceText}]);
 const proposal=JSON.stringify([{source_id:String(sourceId),kind:'relationship',name:'preference',quote:sourceText}]);
 return [
   {name:'raw_insert',sql:memory.ROOM_MEMORY_LOG_SQL,params:[...authority,deviceId,'me',sourceText]},
   {name:'batch_read',sql:memory.ROOM_MEMORY_BATCH_SQL,params:[followerId,agentId,personId]},
   {name:'discover',sql:memory.ROOM_MEMORY_DISCOVERY_SQL,params:[3,MEERA_AGENT_ID]},
   {name:'commit',sql:memory.ROOM_MEMORY_COMMIT_SQL,params:[...authority,sources,proposal]},
   {name:'recall',sql:memory.ROOM_MEMORY_RECALL_SQL,params:authority},
   {name:'history',sql:memory.ROOM_MEMORY_HISTORY_SQL,params:[...authority,deviceId]},
   {name:'revoke',sql:memory.ROOM_MEMORY_REVOKE_SQL,params:[roomId,personId,agentId]},
   {name:'forget',sql:memory.ROOM_MEMORY_FORGET_SQL,params:[roomId,personId,agentId]},
 ];
}

export const actualProofRequirements=Object.freeze([
 'Use the existing development-only transaction/cleanup runner. Apply 11 statements separately inside rollback proof; repeat idempotent DDL there, never COMMIT from this contract.',
 'Read schemaReadinessSQL: five columns with correct bigint/uuid/default/nullability, two CASCADE source FKs, two enabled triggers and exact function definitions. Mirror DDL must equal migration159.',
 'EXPLAIN all eight exact proofStatements before runtime fixtures. Pass bigint source id as text; capture SQLSTATE and position safely without raw source content.',
 'Seed synthetic active replica, matching Room/agent/owner, follower age+memory consent, and device. Use raw_insert to produce the exact source id. No AI source may reach batch_read.',
 'Positive: batch -> shipped runRoomMemoryConsolidation with deterministic model -> commit writes one episode, fact and observation, sets raw episode cursor; recall/history contain the real fixture. Set log at >12 hours and >30 days to prove no rehearsal/publication TTL.',
 'While model promise is pending, revoke via shipped SQL. Resume provider stub and require zero episode/fact/observation/cursor writes and memory_authority_changed. No DB lock remains held during the await.',
 'Repeat with disable/re-enable (same follower, incremented epoch), delete/rejoin (fresh follower id), source deletion, source content replacement and consumed source id. Every stale commit refuses atomically.',
 'Second Room with SAME agent/person and different follower UUID: its consent must not admit the first Room batch, and its source/facts must survive first Room revoke+forget. Untagged historical logs are ineligible.',
 'Raw assistant INSERT with captured old authority after revoke must return no rows. Returning history/recall with stale generation returns no rows.',
 'Replica revoked/purging, Room paused/unpublished, mismatched replica.agent_id, missing consent or age: raw and commit reject, and BOTH returning recall/history return no rows even with a current follower epoch; no provider should run when initial batch has no authority.',
 'Repeat the same commit after success: source already consumed, zero further outputs. Invalid source id, invented quote, repeated expected source id or duplicate proposal(source_id,quote) must refuse in SQL even bypassing JS validation.',
 'Actual Room forget counts match three derived classes. Follower DELETE trigger also removes cited facts/observations and cascades raw/episode source rows. Account and full replica manifest reach remain intact.',
 'For concurrency acceptance use TWO DB sessions and only short statement transactions: writer waiting on follower revoke must observe new epoch; writer-first commit is erased by subsequent forget. Serial CTE controls alone are NOT cross-session proof.',
 'Rollback, independent fixture absence and closed connections required. Zero provider calls and no production SQL. Keep shipping flag false until root admits actual evidence.',
]);
