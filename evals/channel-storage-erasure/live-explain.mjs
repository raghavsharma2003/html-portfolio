// Read-only Neon parser gate for migration 074 and its erasure SQL. EXPLAIN
// without ANALYZE parses and plans data-modifying CTEs but executes none.
import { q } from "../../api/_db.js";
import { reserveChannelExtractionUpload } from "../../api/_channel/extraction-storage.js";
import {
  completeReplicaErasure,
  confirmReplicaChannelStorageErasure,
  createReplicaErasureReceipt,
  leaseNextReplicaErasure,
} from "../../api/_replica-full-erasure.js";

const JOB = "10000000-0000-4000-8000-000000000001";
const REPLICA = "20000000-0000-4000-8000-000000000002";
const OWNER = "30000000-0000-4000-8000-000000000003";
const WATCH = "40000000-0000-4000-8000-000000000004";
const TOKEN = "channel-storage-live-explain-token-more-than-thirty-two-bytes";
const VIDEO = "vid0000001A";
const PATH = `${OWNER}/${REPLICA}/${WATCH}/${VIDEO}/original`;

const installed = await q(
  `select to_regclass('vy_channel_extraction_object') is not null installed`,
);
if (!installed[0]?.installed) {
  console.log("skip channel storage live EXPLAIN: migration 074 is not applied");
  process.exit(0);
}

const statements = [];
const capture = async (sql, params) => {
  statements.push({ sql, params });
  if (sql.includes("insert into vy_channel_extraction_object")) return [{
    extraction_object_id: "50000000-0000-4000-8000-000000000005",
    replica_id: REPLICA,
    owner_user_id: OWNER,
    scope_kind: "channel_watch",
    scope_id: WATCH,
    video_id: VIDEO,
    storage_bucket: "vyakti-replica-private",
    object_path: PATH,
    upload_authorization_expires_at: "2026-09-02T03:00:00.000Z",
  }];
  if (sql.startsWith("update vy_replica_erasure_job")) return [{ job_id: JOB }];
  if (sql.includes("insert into vy_replica_deletion_receipt")) return [{ receipt_id: JOB }];
  return [];
};

await reserveChannelExtractionUpload(capture, {
  ownerUserId: OWNER,
  replicaId: REPLICA,
  scopeKind: "channel_watch",
  scopeId: WATCH,
  videoId: VIDEO,
  storageBucket: "vyakti-replica-private",
  objectPath: PATH,
}, { nowMs: Date.parse("2026-09-02T00:00:00.000Z") });
await leaseNextReplicaErasure(capture, { token: TOKEN });
const lease = { jobId: JOB, replicaId: REPLICA, ownerUserId: OWNER, leaseToken: TOKEN, agentId: null };
await confirmReplicaChannelStorageErasure(capture, lease);
const receipt = createReplicaErasureReceipt(REPLICA, OWNER, {
  REPLICA_ERASURE_RECEIPT_KEY_B64: Buffer.alloc(32, 7).toString("base64"),
  REPLICA_BACKUP_RETENTION_DAYS: "30",
}, { erasureRequestId: JOB, nonce: "a".repeat(64), nowMs: 0 });
await completeReplicaErasure(capture, lease, receipt);

for (const statement of statements) {
  const rows = await q(`explain (format json) ${statement.sql}`, statement.params);
  if (!rows[0]?.["QUERY PLAN"]) throw new Error("channel_storage_live_explain_missing_plan");
}
console.log(`ok channel storage live EXPLAIN parsed ${statements.length} statements without executing them`);
