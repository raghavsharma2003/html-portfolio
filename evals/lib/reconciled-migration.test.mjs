import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readReconciledMigration } from "./reconciled-migration.mjs";

const originalPath = "db/migrations/066_replica_primary_voice_source.sql";
function fixture(change, check) {
  const root = mkdtempSync(join(tmpdir(), "vyakti-migration-source-"));
  const archive = join(root, "db/migrations/reconciliation/local-voice-20260906");
  mkdirSync(archive, { recursive: true });
  const sql = "select 1;\n";
  const sha256 = createHash("sha256").update(sql).digest("hex");
  const entry = { originalPath, sha256, artifact: sha256.slice(0,16) + "-066_replica_primary_voice_source.sql" };
  const manifest = { entries: [entry] };
  writeFileSync(join(archive, entry.artifact), sql);
  change({ manifest, entry, archive });
  writeFileSync(join(archive, "manifest.json"), JSON.stringify(manifest));
  try { check(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
test("all 11 preserved migration identities pass their full SHA256 checks", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../db/migrations/reconciliation/local-voice-20260906/manifest.json", import.meta.url)));
  assert.equal(manifest.entries.length, 11);
  for (const entry of manifest.entries) assert.match(readReconciledMigration(entry.originalPath), /(?:alter|create)/i);
});
test("a colliding Rooms numeric prefix does not resolve the wrong source", () => {
  assert.throws(() => readReconciledMigration("db/migrations/072_replica_voice_identity_challenge.sql"), /missing or ambiguous/);
});
test("tampered artifact is rejected", () => fixture(({entry,archive}) => writeFileSync(join(archive,entry.artifact), "select 2;"), root => assert.throws(() => readReconciledMigration(originalPath,{root}), /integrity mismatch/)));
test("duplicate original identities are rejected", () => fixture(({manifest,entry}) => manifest.entries.push({...entry}), root => assert.throws(() => readReconciledMigration(originalPath,{root}), /missing or ambiguous/)));
test("manifest path traversal is rejected", () => fixture(({entry}) => {entry.artifact = "../secret.sql";}, root => assert.throws(() => readReconciledMigration(originalPath,{root}), /Invalid archived/)));
test("input path traversal is rejected", () => assert.throws(() => readReconciledMigration("../secret.sql"), /Invalid original/));
