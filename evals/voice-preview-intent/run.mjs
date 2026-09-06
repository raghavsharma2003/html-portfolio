import { readReconciledMigration } from "../lib/reconciled-migration.mjs";
// Durable ordinary voice-preview intent controls. Offline, deterministic, $0.
// The fake store below models the table's exact uniqueness and single-writer
// lease. It is not a SQL parser; the live EXPLAIN gate must parse the real
// statement after migration 067 is applied.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OWNER = randomUUID();
const OTHER_OWNER = randomUUID();
const BASE = Object.freeze({
  owner: OWNER,
  replica: randomUUID(),
  genome: 2,
  artifact: randomUUID(),
  language: "hi",
  textHash: "a".repeat(64),
  textPlanHash: "b".repeat(64),
  modelCommitment: "c".repeat(64),
  style: JSON.stringify({ key: "identity_anchor", cfg_weight: 0.78 }),
  seed: 1729,
  regenerationKey: "",
});

const semantic = (input) => [input.owner, input.replica, input.genome, input.artifact,
  input.language, input.textHash, input.textPlanHash, input.modelCommitment,
  input.style, input.seed, input.regenerationKey].join("\u001f");

function fakeIntentStore({ enforceUnique = true } = {}) {
  const rows = new Map();
  let chain = Promise.resolve();
  const claim = (input, now = 1_000) => {
    const run = async () => {
      const key = enforceUnique ? semantic(input) : `${semantic(input)}:${randomUUID()}`;
      const existing = rows.get(key);
      if (!existing) {
        const row = {
          intentId: randomUUID(), generationId: randomUUID(), role: "execute", attempt: 1,
          state: "synthesizing", leaseExpiresAt: now + 290_000, sealed: null,
        };
        rows.set(key, row);
        return { ...row };
      }
      if (existing.state === "sealed") return { ...existing, role: "sealed" };
      if (existing.state === "retryable" || existing.state === "warming" ||
          (existing.state === "synthesizing" && existing.leaseExpiresAt <= now)) {
        Object.assign(existing, {
          generationId: randomUUID(), role: "execute", attempt: existing.attempt + 1,
          state: "synthesizing", leaseExpiresAt: now + 290_000,
        });
        return { ...existing };
      }
      return { ...existing, role: "observe" };
    };
    const result = chain.then(run);
    chain = result.then(() => undefined);
    return result;
  };
  return { rows, claim };
}

let passed = 0;
function ok(name, condition) {
  assert.equal(Boolean(condition), true, name);
  passed++;
  console.log(`  ok  ${name}`);
}

const store = fakeIntentStore();
const five = await Promise.all(Array.from({ length: 5 }, () => store.claim(BASE)));
ok("five concurrent identical clients receive one intent", new Set(five.map((x) => x.intentId)).size === 1);
ok("exactly one concurrent client owns the synthesis lease", five.filter((x) => x.role === "execute").length === 1);
ok("the other four clients are observers", five.filter((x) => x.role === "observe").length === 4);

const broken = fakeIntentStore({ enforceUnique: false });
const duplicate = await Promise.all(Array.from({ length: 5 }, () => broken.claim(BASE)));
ok("NEGATIVE CONTROL: removing exact uniqueness admits five syntheses",
  duplicate.filter((x) => x.role === "execute").length === 5);

const otherOwner = await store.claim({ ...BASE, owner: OTHER_OWNER });
ok("an owner boundary cannot reuse another owner's intent", otherOwner.intentId !== five[0].intentId);

for (const [field, value] of [
  ["genome", 3], ["artifact", randomUUID()], ["language", "en"], ["textHash", "b".repeat(64)],
  ["textPlanHash", "d".repeat(64)], ["modelCommitment", "e".repeat(64)],
  ["style", JSON.stringify({ key: "balanced" })], ["seed", 1730],
]) {
  const changed = await store.claim({ ...BASE, [field]: value });
  ok(`${field} is part of the exact intent identity`, changed.intentId !== five[0].intentId);
}

const regenerationKey = randomUUID();
const regenerated = await store.claim({ ...BASE, regenerationKey });
const regeneratedRetry = await store.claim({ ...BASE, regenerationKey });
ok("explicit regeneration is distinct from the ordinary intent", regenerated.intentId !== five[0].intentId);
ok("retries of one explicit regeneration reuse its key", regeneratedRetry.intentId === regenerated.intentId);
ok("only the first explicit-regeneration request executes", regenerated.role === "execute" && regeneratedRetry.role === "observe");

const staleStore = fakeIntentStore();
const staleFirst = await staleStore.claim(BASE, 1_000);
const staleObserver = await staleStore.claim(BASE, 1_001);
const staleRecovered = await staleStore.claim(BASE, 291_001);
ok("an active lease is observed, not stolen", staleFirst.role === "execute" && staleObserver.role === "observe");
ok("an expired lease deliberately recovers the same intent", staleRecovered.intentId === staleFirst.intentId);
ok("stale recovery increments attempt and uses a new generation",
  staleRecovered.attempt === 2 && staleRecovered.generationId !== staleFirst.generationId);

const migration = readReconciledMigration("db/migrations/067_replica_voice_preview_intent.sql");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
const preview = readFileSync(join(ROOT, "api/_replica-voice-preview.js"), "utf8");
const panel = readFileSync(join(ROOT, "api/_voice/preview-panel.js"), "utf8");
const route = readFileSync(join(ROOT, "api/voice-preview.js"), "utf8");
const storage = readFileSync(join(ROOT, "api/_replica-storage.js"), "utf8");
const relcheck = readFileSync(join(ROOT, "scripts/relcheck.mjs"), "utf8");
ok("the database owns exact semantic uniqueness",
  /unique\s*\(owner_user_id, replica_id, genome_version, preview_artifact_id, language_id,[\s\S]*text_hash, text_plan_sha256, model_commitment, style, preview_seed, regeneration_key\)/.test(migration));
ok("migration 067 is one-statement-runner safe and mirrored in canonical schema",
  splitSql(migration).length >= 10 && !/\bdo\s+\$/i.test(migration) &&
  schema.replace(/\r\n/g, "\n").includes(migration.replace(/\r\n/g, "\n").slice(migration.replace(/\r\n/g, "\n").indexOf("create table if not exists vy_replica_voice_preview_intent")).trim()));
ok("the lease is expiring and owner-scoped",
  /lease_expires_at/.test(migration) && /i\.owner_user_id=\$2::uuid/.test(preview) && /i\.lease_token_hash=\$13/.test(preview));
ok("sealed intents require a private WAV locator and SHA-256",
  /state='sealed'[\s\S]*result_storage_bucket is not null[\s\S]*result_mime='audio\/wav'[\s\S]*result_sha256/.test(migration));
ok("the exact protected WAV is stored before the intent is sealed",
  panel.indexOf("await deps.storeResult") > panel.indexOf("await protectedAudio.completion") &&
  panel.indexOf("await deps.sealIntent") > panel.indexOf("await deps.storeResult"));
ok("sealed replay reads only the private result and verifies its digest",
  /role === "sealed"/.test(panel) && /await deps\.readResult/.test(panel) && /voice_preview_result_binding_failed/.test(panel));
ok("the route uses immutable private create-only storage",
  /writeImmutableReplicaArtifact/.test(route) && /ifNoneMatch: "\*"/.test(route));
ok("generation and intent identities have an owner-scoped composite foreign key",
  /foreign key \(preview_intent_id, replica_id, owner_user_id\)[\s\S]*references vy_replica_voice_preview_intent\(intent_id, replica_id, owner_user_id\)/.test(migration));
ok("the generic live relcheck auto-discovers the new owner table and reaches it by replica cascade",
  /column_name = any\(\$1::text\[\]\)/.test(relcheck) && /const OWNER_KEYS = \["owner_user_id", "redeemed_by_user_id"\]/.test(relcheck) &&
  /c\.confdeltype del/.test(relcheck) && /const reached = new Set\(\["vy_replica"\]\)/.test(relcheck) &&
  /references vy_replica\(replica_id, owner_user_id\) on delete cascade/.test(migration));
ok("transient settlement caps failures and exposes a terminal failed state",
  /failure_count=least\(3,i\.failure_count\+1\)/.test(preview) &&
  /state=case when i\.failure_count>=2 then 'failed' else 'retryable' end/.test(preview) &&
  /role = row\.intent_state === "failed"/.test(preview) && /started\.intent\?\.role === "failed"/.test(panel));
ok("a verified synthesis renews the exact owner attempt lease before protection",
  /renewVoicePreviewIntentLease/.test(preview) &&
  panel.indexOf("await deps.renewIntent") < panel.indexOf("await deps.protect"));
ok("preview renewal and seal recheck the live source and outlast the enclosing request",
  /leaseMs = 420_000/.test(preview) && /Math\.max\(360_000, Math\.min\(600_000/.test(preview) &&
  (preview.match(/join vy_replica_source s/g) || []).length >= 2 &&
  (preview.match(/s\.state='ready'/g) || []).length >= 2);
ok("an aborted or erased preview cannot write late bytes without exact cleanup",
  route.indexOf("signal?.throwIfAborted?.()") < route.indexOf("const stored = await writeArtifact") &&
  (route.match(/signal\?\.throwIfAborted\?\.\(\)/g) || []).length === 2 &&
  /timeoutMs: 60_000,[\s\S]*signal,[\s\S]*beforeWriteRequest/.test(route) &&
  /acquireVoicePreviewSourceStorageWriter/.test(route) && /renewSourceStorageWriter/.test(route) &&
  /return storeVoicePreviewResult\(q, user\.id, started, bodyBytes, aborter\.signal\)/.test(route) &&
  /options\.signal\?\.throwIfAborted\(\)/.test(storage) &&
  panel.indexOf("await deps.deleteResult(storedResult)") > panel.indexOf("await deps.sealIntent"));
ok("the public receipt and segment ledger remain on the original generation path",
  /createNeonVoicePreviewLedger/.test(route) && /vy_replica_generation_receipt/.test(preview) &&
  /vy_replica_generation_segment_receipt/.test(preview));
ok("no raw source bytes are returned before protection",
  panel.indexOf("body: bodyBytes") > panel.indexOf("await deps.protect") &&
  panel.indexOf("body: stored.body") > panel.indexOf("role === \"sealed\""));

const beforeProtection = ["synthesize", "protect", "store", "seal", "respond"];
const unsafe = ["synthesize", "respond", "protect", "store", "seal"];
const protectedBeforeResponse = (events) => events.indexOf("protect") < events.indexOf("respond") &&
  events.indexOf("store") < events.indexOf("respond") && events.indexOf("seal") < events.indexOf("respond");
ok("POSITIVE CONTROL: protected, stored, sealed audio may be returned", protectedBeforeResponse(beforeProtection));
ok("NEGATIVE CONTROL: a response before protection is rejected", !protectedBeforeResponse(unsafe));

const intentKey = createHash("sha256").update(semantic(BASE)).digest("hex");
ok("the audit key is content-free", /^[0-9a-f]{64}$/.test(intentKey) && !intentKey.includes(BASE.textHash));

console.log(`\n${passed} voice-preview intent controls passed`);
