import { readReconciledMigration } from "../lib/reconciled-migration.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SOURCE_STORAGE_WRITE_HORIZON_MS,
  acquireContextSourceStorageWriter,
  acquireProcessingSourceStorageWriter,
  acquireVoicePreviewSourceStorageWriter,
  releaseSourceStorageWriter,
  renewSourceStorageWriter,
} from "../../api/_replica-storage-writer.js";
import { createStoredContextSource } from "../../api/context-items.js";
import { storeVoicePreviewResult } from "../../api/voice-preview.js";
import { deleteReplicaSourceObjects, writeImmutableReplicaArtifact } from "../../api/_replica-storage.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = "10000000-0000-4000-8000-000000000001";
const REPLICA = "20000000-0000-4000-8000-000000000002";
const OWNER = "30000000-0000-4000-8000-000000000003";
const JOB = "40000000-0000-4000-8000-000000000004";
const INTENT = "50000000-0000-4000-8000-000000000005";
const GENERATION = "60000000-0000-4000-8000-000000000006";
const WRITER = "70000000-0000-4000-8000-000000000007";
const WRITER_TWO = "80000000-0000-4000-8000-000000000008";
const TOKEN = "source-storage-writer-token-at-least-thirty-two-bytes";
const LEASE_HASH = "a".repeat(64);
let checks = 0;

function ok(name, condition) {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
}

function row(purpose, writerId = WRITER) {
  return {
    writer_id: writerId,
    source_id: SOURCE,
    replica_id: REPLICA,
    owner_user_id: OWNER,
    purpose,
    storage_write_not_after: "2026-09-02T12:00:00.000Z",
  };
}

let contextSql = "";
let contextParams = [];
const context = await acquireContextSourceStorageWriter(async (sql, params) => {
  contextSql = sql;
  contextParams = params;
  return [row("context_source")];
}, { sourceId: SOURCE, replicaId: REPLICA, ownerUserId: OWNER }, {
  writerId: WRITER,
  token: TOKEN,
});
ok("context authority is persisted before storage only for an owned live pending source",
  context.writerId === WRITER && context.token === TOKEN &&
  /state='pending_upload'/.test(contextSql) && /lifecycle not in \('revoked','purging'\)/.test(contextSql) &&
  /for update of s,r/.test(contextSql) && /'context_source'/.test(contextSql));
ok("storage writer secrets are one-way and the provider horizon cannot be shortened",
  contextParams[4] !== TOKEN && /^[0-9a-f]{64}$/.test(contextParams[4]) &&
  contextParams[5] === SOURCE_STORAGE_WRITE_HORIZON_MS);

let processingSql = "";
const processing = await acquireProcessingSourceStorageWriter(async (sql) => {
  processingSql = sql;
  return [row("processing_artifact")];
}, {
  jobId: JOB,
  sourceId: SOURCE,
  replicaId: REPLICA,
  ownerUserId: OWNER,
  leaseTokenHash: LEASE_HASH,
}, { writerId: WRITER, token: TOKEN });
ok("processing authority binds the exact live job lease and writable source tuple",
  processing.purpose === "processing_artifact" &&
  /j\.job_id=\$1::uuid/.test(processingSql) && /j\.lease_token_hash=\$5/.test(processingSql) &&
  /j\.lease_expires_at>now\(\)/.test(processingSql) && /for update of j,s,r/.test(processingSql));

let previewSql = "";
const preview = await acquireVoicePreviewSourceStorageWriter(async (sql) => {
  previewSql = sql;
  return [row("voice_preview_result")];
}, OWNER, {
  intent: { intentId: INTENT, attempt: 1, leaseTokenHash: LEASE_HASH },
  generation: { generation_id: GENERATION, replica_id: REPLICA },
  reference: { sourceId: SOURCE },
}, { writerId: WRITER, token: TOKEN });
ok("preview authority binds the exact intent attempt generation and ready source",
  preview.purpose === "voice_preview_result" &&
  /i\.intent_id=\$1::uuid/.test(previewSql) && /i\.attempt=\$5::int4/.test(previewSql) &&
  /i\.lease_token_hash=\$6/.test(previewSql) && /s\.state='ready'/.test(previewSql) &&
  /g\.state in \('streaming','sealed'\)/.test(previewSql));

let renewSql = "";
const renewed = await renewSourceStorageWriter(async (sql, params) => {
  renewSql = sql;
  assert.equal(params[6], SOURCE_STORAGE_WRITE_HORIZON_MS);
  return [row("processing_artifact")];
}, processing);
ok("every provider request renews only its own active token-fenced authority",
  renewed.writerId === WRITER && /w\.writer_id=\$1::uuid/.test(renewSql) &&
  /w\.token_hash=\$6/.test(renewSql) && /w\.state='active'/.test(renewSql) &&
  /j\.lease_token_hash=w\.guard_token_hash/.test(renewSql) &&
  /i\.lease_token_hash=w\.guard_token_hash/.test(renewSql));

let releaseParams = [];
assert.equal(await releaseSourceStorageWriter(async (_sql, params) => {
  releaseParams = params;
  return [{ writer_id: WRITER }];
}, context), true);
ok("one writer can release only its own exact source owner purpose and token",
  releaseParams[0] === WRITER && releaseParams[1] === SOURCE && releaseParams[2] === REPLICA &&
  releaseParams[3] === OWNER && releaseParams[4] === "context_source" && releaseParams[5] !== TOKEN);
const other = { ...context, writerId: WRITER_TWO };
assert.equal(await releaseSourceStorageWriter(async (_sql, params) => {
  assert.equal(params[0], WRITER_TWO);
  return [];
}, other), false);
ok("a different writer id cannot clear the first writer authority", true);

const migration = readReconciledMigration("db/migrations/075_replica_source_storage_writer.sql");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
ok("migration 075 is splitter-safe cascaded exact-scope storage authority",
  splitSql(migration).length === 6 && !/\bdo\s+\$/i.test(migration) &&
  /references vy_replica_source\(source_id,replica_id,owner_user_id\) on delete cascade/.test(migration) &&
  /where state='active'/.test(migration) && schema.includes("vy_replica_source_storage_writer"));
ok("mixed-version rollout is conservatively fenced beyond the old 64 MiB Azure single PUT ceiling",
  /purpose,guard_id,guard_token_hash/.test(migration) && /now\(\)\+interval '12 hours'/.test(migration) &&
  /'legacy_rollout'/.test(migration) &&
  /alter column upload_authorization_expires_at[\s\S]*set default/.test(migration) &&
  !schema.includes("alter column upload_authorization_expires_at drop default"));
ok("a source inserted by an old instance after migration still receives the temporary provider fence",
  migration.indexOf("set default (now()+interval '12 hours')") <
    migration.indexOf("create table if not exists vy_replica_source_storage_writer") &&
  !migration.includes("drop default"));
ok("repeatable migration runs cannot add a fresh rollout authority to current-code sources",
  /create table if not exists vy_replica_storage_writer_rollout/.test(migration) &&
  /with first_apply as \([\s\S]*on conflict \(rollout_key\) do nothing[\s\S]*returning rollout_key/.test(migration) &&
  /cross join first_apply/.test(migration) && schema.includes("vy_replica_storage_writer_rollout"));
const currentSourceWriters = ["api/_replica-source.js", "api/_replica-liveness.js", "api/_replica-provider-consent.js"]
  .map((file) => readFileSync(join(ROOT, file), "utf8"));
ok("current source inserts explicitly bypass the conservative old-instance default before exact authorization",
  currentSourceWriters.every((code) =>
    /insert into vy_replica_source[\s\S]{0,600}upload_authorization_expires_at\)[\s\S]{0,500}null/.test(code)));

const sourceErasure = readFileSync(join(ROOT, "api/_replica-source-erasure.js"), "utf8");
const fullErasure = readFileSync(join(ROOT, "api/_replica-full-erasure.js"), "utf8");
const sourceCompletion = sourceErasure.slice(sourceErasure.indexOf("export async function completeSourceErasure"),
  sourceErasure.indexOf("export function normalizeSourceErasureFailure"));
ok("source erasure rechecks active writer horizons both before lease and before SQL removal",
  (sourceErasure.match(/vy_replica_source_storage_writer/g) || []).length >= 3 &&
  (sourceErasure.match(/storage_write_not_after>now\(\)/g) || []).length >= 3 &&
  /coalesce\(s\.upload_authorization_expires_at,'-infinity'::timestamptz\)<=now\(\)/.test(sourceCompletion) &&
  /vy_replica_source_storage_writer/.test(sourceCompletion));
ok("full-replica receipt rechecks active writer horizons at lease and completion",
  (fullErasure.match(/vy_replica_source_storage_writer/g) || []).length >= 2 &&
  (fullErasure.match(/storage_write_not_after>now\(\)/g) || []).length >= 2);

const contextRoute = readFileSync(join(ROOT, "api/context-items.js"), "utf8");
const contextCore = readFileSync(join(ROOT, "api/_replica-source.js"), "utf8");
ok("storage-touched context failures retain the manifest for the standard fenced eraser",
  /acquireContextSourceStorageWriter/.test(contextRoute) && /renewSourceStorageWriter/.test(contextRoute) &&
  /if \(storageWriter\)[\s\S]*markOwnedSourceDeleting/.test(contextRoute) &&
  /discardCanonicalSource:[\s\S]*markOwnedSourceDeleting/.test(contextRoute) &&
  !/discardCanonicalSource:[\s\S]{0,300}discardUnboundContextSource/.test(contextRoute));
ok("hard context discard is SQL-limited to rows that never had any storage authority",
  /state='pending_upload' and s\.upload_authorization_expires_at is null/.test(contextCore) &&
  /not exists \([\s\S]*vy_replica_source_storage_writer/.test(contextCore));

// Context timeout -> deleting manifest -> late provider commit. This drives
// the production helper rather than merely checking its source text.
let contextMarkedDeleting = false;
let contextHardDiscarded = false;
let contextWriterReleased = false;
let finishContextLateCommit = null;
const lateObjects = new Set();
const contextOriginalPath = `${OWNER}/${REPLICA}/${SOURCE}/original`;
await assert.rejects(() => createStoredContextSource(async () => [], OWNER, REPLICA, {
  kind: "text",
  mime: "text/plain",
  bytes: Buffer.from("late context payload"),
  contentSha256: "b".repeat(64),
  containsThirdParties: false,
}, {
  createSource: async () => ({
    source_id: SOURCE,
    storage_bucket: "azureblob:vyaktireplicatest:replica-private",
    object_path: contextOriginalPath,
  }),
  acquireWriter: async () => context,
  renewWriter: async (_db, writer) => writer,
  writeSource: async (input, options) => {
    await options.beforeWriteRequest();
    finishContextLateCommit = () => lateObjects.add(input.objectPath);
    throw Object.assign(new Error("provider acknowledgement timeout"), {
      code: "private_storage_write_failed", status: 503,
    });
  },
  finalizeSource: async () => { throw new Error("must not finalize"); },
  releaseWriter: async () => { contextWriterReleased = true; return true; },
  markDeleting: async () => { contextMarkedDeleting = true; return true; },
  discardSource: async () => { contextHardDiscarded = true; return true; },
}), (error) => error?.code === "private_storage_write_failed");
finishContextLateCommit?.();
ok("context provider timeout keeps its manifest and writer while a late commit becomes visible",
  contextMarkedDeleting && !contextHardDiscarded && !contextWriterReleased && lateObjects.has(contextOriginalPath));

// Preview has the same physical failure mode. Storage settlement is allowed to
// time out, but its exact durable writer must survive for the erasure gate.
const previewPath = `${OWNER}/${REPLICA}/${SOURCE}/derived/preview/${GENERATION}.wav`;
let previewWriterReleased = false;
let finishPreviewLateCommit = null;
const previewStarted = {
  intent: { intentId: INTENT, attempt: 1, leaseTokenHash: LEASE_HASH },
  generation: {
    generation_id: GENERATION,
    replica_id: REPLICA,
    preview_result_storage_bucket: "azureblob:vyaktireplicatest:replica-private",
    preview_result_object_path: previewPath,
  },
  reference: { sourceId: SOURCE },
};
await assert.rejects(() => storeVoicePreviewResult(async () => [], OWNER, previewStarted,
  Buffer.from("late preview wav"), new AbortController().signal, {
    acquireWriter: async () => preview,
    renewWriter: async (_db, writer) => writer,
    writeArtifact: async (input, options) => {
      await options.beforeWriteRequest();
      finishPreviewLateCommit = () => lateObjects.add(input.objectPath);
      throw Object.assign(new Error("provider acknowledgement timeout"), {
        code: "private_storage_write_failed", status: 503,
      });
    },
    releaseWriter: async () => { previewWriterReleased = true; return true; },
  }), (error) => error?.code === "private_storage_write_failed");
finishPreviewLateCommit?.();
ok("preview provider timeout retains its writer while a late result commit becomes visible",
  !previewWriterReleased && lateObjects.has(previewPath));

process.env.AZURE_REPLICA_STORAGE_ACCOUNT = "vyaktireplicatest";
process.env.AZURE_REPLICA_STORAGE_ACCOUNT_KEY = Buffer.alloc(64, 11).toString("base64");
process.env.AZURE_REPLICA_STORAGE_CONTAINER = "replica-private";
const azureBucket = "azureblob:vyaktireplicatest:replica-private";
const objectPath = `${OWNER}/${REPLICA}/${SOURCE}/derived/test/bounded.bin`;
const payload = Buffer.alloc(9 * 1024 * 1024, 23);
const providerCalls = [];
const azureFetch = async (rawUrl, init = {}) => {
  const url = new URL(rawUrl);
  providerCalls.push({ url, init });
  if (init.method === "PUT") return new Response(null, { status: 201 });
  if (!init.method || init.method === "GET") {
    return new Response(payload, { status: 200, headers: {
      "content-length": String(payload.length),
      "content-type": "application/octet-stream",
      etag: '"bounded"',
    } });
  }
  throw new Error(`unexpected provider request ${init.method} ${url}`);
};
let authorityPulses = 0;
const stored = await writeImmutableReplicaArtifact({
  storageBucket: azureBucket,
  objectPath,
  mime: "application/octet-stream",
  body: payload,
  ifNoneMatch: "*",
}, {
  fetchImpl: azureFetch,
  maxBytes: 16 * 1024 * 1024,
  beforeWriteRequest: async () => { authorityPulses += 1; },
});
const blockCalls = providerCalls.filter((call) => call.url.searchParams.get("comp") === "block");
const commitCalls = providerCalls.filter((call) => call.url.searchParams.get("comp") === "blocklist");
ok("Azure server writes use bounded blocks and renew before every block plus create-only commit",
  stored.byteSize === payload.length && blockCalls.length === 2 && commitCalls.length === 1 &&
  authorityPulses === 3 && blockCalls.every((call) => Buffer.byteLength(call.init.body) <= 8 * 1024 * 1024) &&
  commitCalls[0].init.headers["If-None-Match"] === "*");

let providerReached = false;
await assert.rejects(() => writeImmutableReplicaArtifact({
  storageBucket: azureBucket,
  objectPath: `${OWNER}/${REPLICA}/${SOURCE}/derived/test/deletion-won.bin`,
  mime: "application/octet-stream",
  body: Buffer.from("blocked"),
  ifNoneMatch: "*",
}, {
  fetchImpl: async () => { providerReached = true; throw new Error("must not run"); },
  beforeWriteRequest: async () => {
    throw Object.assign(new Error("source_storage_writer_renew_denied"), { code: "source_storage_writer_renew_denied" });
  },
}), (error) => error?.code === "source_storage_writer_renew_denied");
ok("deletion winning the source-row lock prevents any later provider mutation", !providerReached);

await assert.rejects(() => writeImmutableReplicaArtifact({
  storageBucket: azureBucket,
  objectPath: `${OWNER}/${REPLICA}/${SOURCE}/derived/test/no-authority.bin`,
  mime: "application/octet-stream",
  body: Buffer.from("no authority"),
  ifNoneMatch: "*",
}, { fetchImpl: azureFetch }), (error) => error?.code === "source_storage_writer_authority_required");
ok("every immutable server write fails closed without a durable authority callback", true);

const previousSupabaseUrl = process.env.SUPABASE_URL;
const previousSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_URL = "https://storage-fixture.example";
process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-key";
const lateDeleteCalls = [];
const lateFetch = async (rawUrl, init = {}) => {
  const url = new URL(rawUrl);
  if (url.pathname.includes("/object/list/")) return Response.json([]);
  if (url.searchParams.get("comp") === "list") {
    const prefix = url.searchParams.get("prefix") || "";
    const names = [...lateObjects].filter((path) => path.startsWith(prefix));
    return new Response(`<?xml version="1.0"?><EnumerationResults><Blobs>${names.map((name) =>
      `<Blob><Name>${name}</Name></Blob>`).join("")}</Blobs><NextMarker></NextMarker></EnumerationResults>`,
    { status: 200 });
  }
  const path = decodeURIComponent(url.pathname.slice("/replica-private/".length));
  if (init.method === "DELETE") {
    lateDeleteCalls.push(path);
    lateObjects.delete(path);
    return new Response(null, { status: 202 });
  }
  if (init.method === "HEAD") return new Response(null, { status: lateObjects.has(path) ? 200 : 404 });
  throw new Error(`unexpected late-object request ${init.method} ${url}`);
};
const lateProof = await deleteReplicaSourceObjects({
  ownerUserId: OWNER, replicaId: REPLICA, sourceId: SOURCE,
}, [{ storageBucket: azureBucket, objectPath: contextOriginalPath }], lateFetch);
ok("the post-authority source prefix proof discovers and deletes both simulated late commits",
  lateProof.confirmedAbsent === 2 && lateObjects.size === 0 && lateDeleteCalls.length === 2 &&
  lateDeleteCalls.includes(contextOriginalPath) && lateDeleteCalls.includes(previewPath));

if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
else process.env.SUPABASE_URL = previousSupabaseUrl;
if (previousSupabaseKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
else process.env.SUPABASE_SERVICE_ROLE_KEY = previousSupabaseKey;

delete process.env.AZURE_REPLICA_STORAGE_ACCOUNT;
delete process.env.AZURE_REPLICA_STORAGE_ACCOUNT_KEY;
delete process.env.AZURE_REPLICA_STORAGE_CONTAINER;

console.log(`\n${checks} source storage writer checks passed`);
