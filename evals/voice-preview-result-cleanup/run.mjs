import { readReconciledMigration } from "../lib/reconciled-migration.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runVoicePreviewResultCleanup } from "../../api/_voice-preview-result-cleanup.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let passed = 0;
function ok(name, condition) {
  assert.equal(Boolean(condition), true, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

function item(name) {
  const owner = randomUUID();
  const replica = randomUUID();
  const source = randomUUID();
  return {
    cleanup_kind: "expired",
    intent_id: randomUUID(),
    replica_id: replica,
    owner_user_id: owner,
    generation_id: randomUUID(),
    source_id: source,
    result_storage_bucket: "private-test",
    result_object_path: `${owner}/${replica}/${source}/derived/voice-preview/${name}.wav`,
    result_sha256: "a".repeat(64),
  };
}

const rows = [item("one"), item("two")];
const sql = [];
const db = async (statement, params) => {
  sql.push({ statement, params });
  if (/^with expired/i.test(statement.trim())) return rows;
  if (/^update vy_replica_generation/i.test(statement.trim())) return [{ generation_id: params[0] }];
  return [];
};
const deleted = [];
const summary = await runVoicePreviewResultCleanup({
  db,
  deleteObject: async (locator) => { deleted.push(locator); },
  limit: 2,
});
ok("bounded cleanup deletes every claimed exact private locator", summary.claimed === 2 && summary.deleted === 2 &&
  deleted.length === 2 && deleted.every((entry) => entry.storageBucket === "private-test"));
ok("successful deletion is durably acknowledged on its owner-bound generation",
  sql.filter((call) => /^update vy_replica_generation/i.test(call.statement.trim())).length === 2 &&
  sql.slice(1).every((call) => /g\.owner_user_id=\$3::uuid/.test(call.statement)));

let attempts = 0;
const retrySql = [];
const retry = await runVoicePreviewResultCleanup({
  db: async (statement, params) => {
    retrySql.push({ statement, params });
    return /^with expired/i.test(statement.trim()) ? [rows[0]] : [{ generation_id: params[0] }];
  },
  deleteObject: async () => { attempts += 1; throw new Error("storage unavailable"); },
  limit: 1,
});
ok("a failed object delete is reported and is not falsely acknowledged",
  attempts === 1 && retry.failed === 1 && retry.deleted === 0 && retrySql.length === 1);

let acknowledgedDeletes = 0;
const lostAck = await runVoicePreviewResultCleanup({
  db: async (statement) => /^with expired/i.test(statement.trim()) ? [rows[0]] : [],
  deleteObject: async () => { acknowledgedDeletes += 1; },
  limit: 1,
});
ok("an object delete without the durable owner-bound acknowledgement is not reported as success",
  acknowledgedDeletes === 1 && lostAck.deleted === 0 && lostAck.failed === 1);

let unsafeDeletes = 0;
const corrupt = { ...rows[0], result_object_path: `${randomUUID()}/other.wav` };
const refused = await runVoicePreviewResultCleanup({
  db: async (statement) => /^with expired/i.test(statement.trim()) ? [corrupt] : [],
  deleteObject: async () => { unsafeDeletes += 1; },
  limit: 1,
});
ok("a corrupted cross-owner locator is refused before private storage deletion",
  refused.failed === 1 && unsafeDeletes === 0);

const cleanup = readFileSync(join(ROOT, "api/_voice-preview-result-cleanup.js"), "utf8");
const panel = readFileSync(join(ROOT, "api/_voice/preview-panel.js"), "utf8");
const erasure = readFileSync(join(ROOT, "api/_replica-source-erasure.js"), "utf8");
const migration = readReconciledMigration("db/migrations/067_replica_voice_preview_intent.sql");
const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
ok("expiry atomically clears the sealed locator before any delete is attempted",
  /with expired as materialized[\s\S]*set state='retryable'[\s\S]*returning[\s\S]*e\.result_storage_bucket/.test(cleanup) &&
  panel.indexOf("await deps.expireIntent") < panel.indexOf("await deps.deleteResult(expired)"));
ok("pre-seal or failed-attempt objects remain discoverable through generation locators",
  /g\.generation_id<>i\.generation_id[\s\S]*i\.state in \('warming','retryable','failed'\)/.test(cleanup) &&
  /g\.preview_result_deleted_at is null/.test(cleanup));
ok("confirmed deletion is one-way and bounded to the exact intent owner and object path",
  /preview_result_deleted_at=coalesce/.test(cleanup) &&
  /g\.preview_intent_id=\$4::uuid[\s\S]*g\.preview_result_storage_bucket=\$5[\s\S]*g\.preview_result_object_path=\$6/.test(cleanup));
ok("overlapping cleanup runs elect one durable generation claim before touching storage",
  /preview_result_cleanup_claimed_at<=now\(\)-interval '10 minutes'[\s\S]*for update of g skip locked/.test(cleanup) &&
  /set preview_result_cleanup_claimed_at=now\(\)/.test(cleanup) &&
  /preview_result_cleanup_claimed_at is not null/.test(cleanup));
ok("source erasure independently includes undeleted preview results",
  /preview_result_object_path path[\s\S]*preview_result_deleted_at is null/.test(erasure));
ok("migration 067 mirrors the durable deletion acknowledgement",
  /add column if not exists preview_result_deleted_at timestamptz/.test(migration) &&
  /add column if not exists preview_result_cleanup_claimed_at timestamptz/.test(migration));
ok("the bounded cleanup is scheduled instead of waiting for owner erasure",
  vercel.crons?.some((entry) => entry.path === "/api/voice-preview-result-cleanup" && entry.schedule === "*/10 * * * *"));

console.log(`\n${passed} voice-preview result cleanup controls passed`);
