import { readReconciledMigration } from "../lib/reconciled-migration.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHANNEL_UPLOAD_AUTHORIZATION_MS,
  CHANNEL_UPLOAD_MAX_CHUNK_BYTES,
  CHANNEL_UPLOAD_PROTOCOL,
  channelExtractionObjectPath,
  cleanupReplicaChannelExtractionStorage,
  issueChannelExtractionUpload,
  reserveChannelExtractionUpload,
} from "../../api/_channel/extraction-storage.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REPLICA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WATCH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VIDEO = "vid0000001A";
const BUCKET = "azureblob:vyaktitest:replica-private";
const NOW = Date.parse("2026-09-02T00:00:00.000Z");
const PATH = `${OWNER}/${REPLICA}/${WATCH}/${VIDEO}/original`;
let checks = 0;
const ok = (name, condition) => {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
};

ok("the channel object name is an exact owner replica scope and video locator",
  channelExtractionObjectPath({
    ownerUserId: OWNER, replicaId: REPLICA, scopeKind: "channel_watch", scopeId: WATCH, videoId: VIDEO,
  }) === PATH);
assert.throws(() => channelExtractionObjectPath({
  ownerUserId: OWNER, replicaId: REPLICA, scopeKind: "channel_watch", scopeId: WATCH,
  videoId: "../another-owner",
}), /channel_extraction_video_id_invalid/);
ok("a video id cannot escape the exact replica namespace", true);

const events = [];
let reserveSql = "";
const db = async (sql, params) => {
  events.push("persist");
  reserveSql = sql;
  return [{
    extraction_object_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    replica_id: params[0], owner_user_id: params[1], scope_kind: params[2], scope_id: params[3],
    video_id: params[4], storage_bucket: params[5], object_path: params[6],
    upload_authorization_expires_at: params[7],
  }];
};
const upload = await issueChannelExtractionUpload(db, {
  ownerUserId: OWNER, replicaId: REPLICA, scopeKind: "channel_watch", scopeId: WATCH,
  videoId: VIDEO, storageBucket: BUCKET, objectPath: PATH,
}, {
  nowMs: NOW,
  ensureBucket: async () => { events.push("ensure"); },
  createUpload: async () => {
    events.push("mint");
    const url = "https://vyaktitest.blob.core.windows.net/replica-private/object?sig=opaque";
    return {
      storage_bucket: BUCKET,
      expires_at: new Date(NOW + 120 * 60 * 1000).toISOString(),
      url,
      headers: { "x-ms-version": "2026-04-06" },
      resumable: {
        protocol: "azure-block-v1",
        endpoint: url,
        headers: { "x-ms-version": "2026-04-06" },
        chunk_size: 8 * 1024 * 1024,
      },
    };
  },
});
ok("the exact durable locator commits before bucket access and capability mint",
  events.join(",") === "persist,ensure,mint" && upload.storage_bucket === BUCKET);
ok("the 210-minute authority covers the two-hour capability plus one legitimate 8 MiB Azure write and margin",
  CHANNEL_UPLOAD_AUTHORIZATION_MS === 210 * 60 * 1000 &&
  CHANNEL_UPLOAD_MAX_CHUNK_BYTES === 8 * 1024 * 1024 &&
  CHANNEL_UPLOAD_PROTOCOL === "azure-block-v1" &&
  /insert into vy_channel_extraction_object/.test(reserveSql) &&
  /lifecycle not in \('revoked','purging'\)/.test(reserveSql) &&
  /for update of r/.test(reserveSql) &&
  /exists \([\s\S]*from vy_ingest_run i[\s\S]*i\.watch_id=\$4::uuid and i\.video_ref=\$5/.test(reserveSql) &&
  /exists \([\s\S]*from vy_video_enrollment e[\s\S]*e\.enrollment_id=\$4::uuid and e\.video_id=\$5/.test(reserveSql) &&
  /count\(\*\) from watch_fence\)=1/.test(reserveSql) &&
  /count\(\*\) from enrollment_fence\)=1/.test(reserveSql) &&
  reserveSql.indexOf("reserved as") < reserveSql.indexOf("watch_fence as") &&
  reserveSql.includes("upload_authorization_expires_at=$8::timestamptz"));

let unsupportedPersisted = false;
let unsupportedMinted = false;
await assert.rejects(() => issueChannelExtractionUpload(async () => {
  unsupportedPersisted = true;
  return [];
}, {
  ownerUserId: OWNER, replicaId: REPLICA, scopeKind: "channel_watch", scopeId: WATCH,
  videoId: VIDEO, storageBucket: "vyakti-replica-private", objectPath: PATH,
}, {
  nowMs: NOW,
  ensureBucket: async () => { unsupportedMinted = true; },
  createUpload: async () => { unsupportedMinted = true; },
}), /channel_extraction_upload_protocol_unsupported/);
ok("an unsupported single-PUT provider is refused before ledger work or capability mint",
  !unsupportedPersisted && !unsupportedMinted);

let mintAfterRefusal = false;
await assert.rejects(() => issueChannelExtractionUpload(async () => [], {
  ownerUserId: OWNER, replicaId: REPLICA, scopeKind: "channel_watch", scopeId: WATCH,
  videoId: VIDEO, storageBucket: BUCKET, objectPath: PATH,
}, {
  nowMs: NOW,
  ensureBucket: async () => { mintAfterRefusal = true; },
  createUpload: async () => { mintAfterRefusal = true; },
}), /channel_extraction_storage_authorization_refused/);
ok("a purging non-owned missing or concurrently deleted scope can never receive an upload capability",
  !mintAfterRefusal);

let deleted = false;
await assert.rejects(() => cleanupReplicaChannelExtractionStorage(async (sql) => {
  if (sql.includes("from vy_channel_extraction_object")) return [{
    storage_bucket: BUCKET, object_path: PATH,
    upload_authorization_expires_at: new Date(NOW + 1).toISOString(),
  }];
  return [{ has_channel_storage_history: true }];
}, { ownerUserId: OWNER, replicaId: REPLICA }, {
  nowMs: NOW,
  deletePrefix: async () => { deleted = true; },
}), /channel_extraction_upload_authorization_active/);
ok("full erasure cannot inspect or delete while a write capability remains live", !deleted);

const aborter = new AbortController();
let cleanupCall = null;
const cleanup = await cleanupReplicaChannelExtractionStorage(async (sql) => {
  if (sql.includes("from vy_channel_extraction_object")) return [{
    storage_bucket: BUCKET, object_path: PATH,
    upload_authorization_expires_at: new Date(NOW - 1).toISOString(),
  }];
  return [{ has_channel_storage_history: true }];
}, { ownerUserId: OWNER, replicaId: REPLICA }, {
  nowMs: NOW,
  signal: aborter.signal,
  deletePrefix: async (...args) => {
    cleanupCall = args;
    return { discovered: 3, confirmedAbsent: 4, providers: 2 };
  },
});
ok("expired ledgers drive an exact owner replica prefix proof across durable providers",
  cleanup.ledgerObjects === 1 && cleanup.hasHistory &&
  cleanupCall[0].ownerUserId === OWNER && cleanupCall[0].replicaId === REPLICA &&
  cleanupCall[1].length === 1 && cleanupCall[1][0].objectPath === PATH);
ok("the final storage drain receives the renewable lease abort signal",
  cleanupCall[3].signal === aborter.signal);

let emptyPrefixCalled = false;
const empty = await cleanupReplicaChannelExtractionStorage(async (sql) =>
  sql.includes("from vy_channel_extraction_object") ? [] : [{ has_channel_storage_history: false }],
{ ownerUserId: OWNER, replicaId: REPLICA }, {
  nowMs: NOW,
  deletePrefix: async () => {
    emptyPrefixCalled = true;
    return { discovered: 0, confirmedAbsent: 0, providers: 1 };
  },
});
ok("even a replica with no ledger receives an empty exact-prefix proof for pre-ledger crash gaps",
  emptyPrefixCalled && !empty.hasHistory && empty.storage.providers === 1);

const migration = readReconciledMigration("db/migrations/074_channel_extraction_storage_fence.sql");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
const registry = readFileSync(join(ROOT, "api/_channel/registry.js"), "utf8");
const watchEndpoint = readFileSync(join(ROOT, "api/channel-ingest-sweep.js"), "utf8");
const videoEndpoint = readFileSync(join(ROOT, "api/video-enroll.js"), "utf8");
ok("migration 074 is splitter-safe and mirrors its exact owner cascade and rollout fence",
  splitSql(migration).length >= 7 && migration.includes("interval '210 minutes'") &&
  migration.includes("vy_channel_extraction_object_owner_fk") &&
  migration.includes("on delete cascade") && schema.includes("vy_channel_extraction_object_owner_fk"));
ok("both production extraction callers inject the database-backed issuer",
  /configuredChannelProvider\(process\.env, \{ db: q \}\)/.test(watchEndpoint) &&
  /configuredChannelProvider\(env, \{ db: q \}\)/.test(videoEndpoint) &&
  registry.indexOf("issueChannelExtractionUpload(db") < registry.indexOf("createUpload: createSignedReplicaUpload"));
ok("one-link enrollment labels its durable scope separately from a standing watch",
  videoEndpoint.includes('storageScopeKind: "video_enrollment"'));

// Directly exercise reservation's path mismatch, not just the path builder.
await assert.rejects(() => reserveChannelExtractionUpload(async () => [], {
  ownerUserId: OWNER, replicaId: REPLICA, scopeKind: "channel_watch", scopeId: WATCH,
  videoId: VIDEO, storageBucket: BUCKET, objectPath: `${OWNER}/${REPLICA}/${WATCH}/other/original`,
}, { nowMs: NOW }), /channel_extraction_storage_path_mismatch/);
ok("the persisted locator cannot differ from the provider upload target", true);

console.log(`\n${checks} channel storage erasure checks passed`);
