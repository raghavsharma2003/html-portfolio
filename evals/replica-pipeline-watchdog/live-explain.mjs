// Read-only parser gate for the exact production watchdog statement.
// EXPLAIN without ANALYZE plans the aggregate query and reads no tenant rows.
import { q } from "../../api/_db.js";
import { inspectReplicaPipeline } from "../../api/_replica-pipeline-watchdog.js";

const [shape] = await q(
  `select to_regclass('public.vy_replica_voice_build_intent') is not null build_intent_table,
          to_regclass('public.vy_replica_model_build') is not null model_build_table,
          exists(select 1 from information_schema.columns where table_schema='public'
            and table_name='vy_replica_voice_build_intent' and column_name='blockers') blockers_column,
          exists(select 1 from information_schema.columns where table_schema='public'
            and table_name='vy_replica_voice_build_intent' and column_name='next_check_at') next_check_column`,
);
if (!shape?.build_intent_table || !shape?.model_build_table
  || !shape?.blockers_column || !shape?.next_check_column) {
  throw new Error("voice build intent watchdog prerequisite schema is not live");
}

let explained = false;
await inspectReplicaPipeline(async (sql, params, timeoutMs) => {
  await q(`explain (format json) ${sql}`, params, timeoutMs);
  explained = true;
  return [{}];
});
if (!explained) throw new Error("production watchdog SQL was not captured");

console.log("replica pipeline watchdog live EXPLAIN: ok (no ANALYZE, no writes)");
