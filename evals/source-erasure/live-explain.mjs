// Read-only Neon parser and impact inventory for source-bound Mirror erasure.
// EXPLAIN without ANALYZE plans the deleting statements but performs no write.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { q } from "../../api/_db.js";
import {
  completeSourceErasure,
  leaseNextSourceErasure,
  renewSourceErasureLease,
} from "../../api/_replica-source-erasure.js";
import {
  acquireContextSourceStorageWriter,
  acquireProcessingSourceStorageWriter,
  acquireVoicePreviewSourceStorageWriter,
  releaseSourceStorageWriter,
  renewSourceStorageWriter,
} from "../../api/_replica-storage-writer.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = "10000000-0000-4000-8000-000000000001";
const REPLICA = "20000000-0000-4000-8000-000000000002";
const OWNER = "30000000-0000-4000-8000-000000000003";
const TOKEN = "source-erasure-live-explain-token-more-than-thirty-two-bytes";

const inventory = await q(
  `with orphan as materialized (
     select w.window_id,w.session_id,w.replica_id,w.owner_user_id,w.seq,
            (w.transcript<>'' or w.asr_provider<>'' or w.asr_model<>'') has_private_text
       from vy_mirror_window w where w.source_id is null
   )
   select count(*)::integer windows,
          count(*) filter (where o.has_private_text)::integer private_windows,
          count(distinct o.session_id) filter (where o.has_private_text)::integer private_sessions,
          count(distinct o.owner_user_id) filter (where o.has_private_text)::integer private_owners,
          count(distinct o.replica_id) filter (where o.has_private_text)::integer private_replicas,
          count(distinct t.turn_id)::integer turns,
          count(distinct d.delta_id)::integer deltas,
          count(distinct c.selection_id)::integer conditioning,
          count(distinct x.observation_id)::integer expressions
     from orphan o
     left join vy_mirror_turn t on t.window_id=o.window_id and t.session_id=o.session_id
      and t.replica_id=o.replica_id and t.owner_user_id=o.owner_user_id
     left join vy_mirror_delta d on d.session_id=o.session_id and d.replica_id=o.replica_id
      and d.owner_user_id=o.owner_user_id and o.seq=any(d.cited_windows)
     left join vy_mirror_conditioning c on c.window_id=o.window_id and c.session_id=o.session_id
      and c.replica_id=o.replica_id and c.owner_user_id=o.owner_user_id
     left join vy_replica_expression_observation x on x.window_id=o.window_id and x.session_id=o.session_id
      and x.replica_id=o.replica_id and x.owner_user_id=o.owner_user_id`,
  [],
);
console.log("live content-free orphan inventory", inventory[0]);
if (process.argv.includes("--inventory-only")) process.exit(0);

const storageWriterInstalled = await q(
  `select to_regclass('public.vy_replica_source_storage_writer') is not null present`,
  [],
);
if (storageWriterInstalled[0]?.present) {
  let planned = 0;
  await completeSourceErasure(async (sql, params) => {
    const rows = await q(`explain (format json) ${sql}`, params);
    if (!rows?.[0]?.["QUERY PLAN"]) throw new Error("source_erasure_live_explain_missing_plan");
    planned += 1;
    return [{ source_id: SOURCE }];
  }, {
    source: { sourceId: SOURCE, replicaId: REPLICA, ownerUserId: OWNER },
    leaseToken: TOKEN,
  });
  if (planned !== 1) throw new Error("source_erasure_live_explain_incomplete");
  await leaseNextSourceErasure(async (sql, params) => {
    const rows = await q(`explain (format json) ${sql}`, params);
    if (!rows?.[0]?.["QUERY PLAN"]) throw new Error("source_erasure_lease_live_explain_missing_plan");
    return [];
  }, { token: TOKEN, leaseMs: 240_000 });
  await renewSourceErasureLease(async (sql, params) => {
    const rows = await q(`explain (format json) ${sql}`, params);
    if (!rows?.[0]?.["QUERY PLAN"]) throw new Error("source_erasure_renew_live_explain_missing_plan");
    return [{ source_id: SOURCE }];
  }, {
    source: { sourceId: SOURCE, replicaId: REPLICA, ownerUserId: OWNER },
    leaseToken: TOKEN,
  });
  const explainWriter = async (sql, params, result) => {
    const rows = await q(`explain (format json) ${sql}`, params);
    if (!rows?.[0]?.["QUERY PLAN"]) throw new Error("source_storage_writer_live_explain_missing_plan");
    return result;
  };
  const writerRow = (purpose) => ({
    writer_id: "40000000-0000-4000-8000-000000000004",
    source_id: SOURCE, replica_id: REPLICA, owner_user_id: OWNER, purpose,
    storage_write_not_after: "2026-09-02T12:00:00.000Z",
  });
  const contextWriter = await acquireContextSourceStorageWriter(
    (sql, params) => explainWriter(sql, params, [writerRow("context_source")]),
    { sourceId: SOURCE, replicaId: REPLICA, ownerUserId: OWNER },
    { writerId: "40000000-0000-4000-8000-000000000004", token: TOKEN },
  );
  await acquireProcessingSourceStorageWriter(
    (sql, params) => explainWriter(sql, params, [writerRow("processing_artifact")]),
    { jobId: "50000000-0000-4000-8000-000000000005", sourceId: SOURCE,
      replicaId: REPLICA, ownerUserId: OWNER, leaseTokenHash: "a".repeat(64) },
    { writerId: "60000000-0000-4000-8000-000000000006", token: TOKEN },
  );
  await acquireVoicePreviewSourceStorageWriter(
    (sql, params) => explainWriter(sql, params, [writerRow("voice_preview_result")]),
    OWNER,
    { intent: { intentId: "70000000-0000-4000-8000-000000000007", attempt: 1, leaseTokenHash: "b".repeat(64) },
      generation: { generation_id: "80000000-0000-4000-8000-000000000008", replica_id: REPLICA },
      reference: { sourceId: SOURCE } },
    { writerId: "90000000-0000-4000-8000-000000000009", token: TOKEN },
  );
  await renewSourceStorageWriter(
    (sql, params) => explainWriter(sql, params, [writerRow("context_source")]),
    contextWriter,
  );
  await releaseSourceStorageWriter(
    (sql, params) => explainWriter(sql, params, [{ writer_id: contextWriter.writerId }]),
    contextWriter,
  );
  console.log("ok live Neon read-only EXPLAIN parsed source erasure and all token-fenced storage writer SQL");
} else {
  console.log("skip source erasure/storage-writer live EXPLAIN: migration 075 is not applied");
}

const cleanupSql = readFileSync(join(HERE, "orphan-cleanup.sql"), "utf8");
const cleanupPlan = await q(`explain (format json) ${cleanupSql}`, [OWNER, null, 25]);
if (!cleanupPlan?.[0]?.["QUERY PLAN"]) throw new Error("mirror_orphan_cleanup_live_explain_missing_plan");
console.log("ok live Neon read-only EXPLAIN parsed bounded orphan cleanup SQL");
