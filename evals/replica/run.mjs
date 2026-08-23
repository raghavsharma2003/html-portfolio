// Replica control-plane gate. Offline, deterministic, no database or model.
// It bundles the real TypeScript contract on every run and carries negative
// controls for the failures most likely to turn self-replication into an
// impersonation product: stale consent, relabelled uploads, stale evals,
// unsafe lifecycle jumps, path injection and content-bearing audit logs.
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const tmp = mkdtempSync(join(tmpdir(), "replica-gate-"));
const entry = join(tmp, "entry.ts");
const bundle = join(tmp, "bundle.mjs");
writeFileSync(entry, `export * from ${JSON.stringify(join(ROOT, "src/replica/contracts.ts"))};\n`);
execSync(`npx esbuild ${entry} --bundle --format=esm --platform=node --outfile=${bundle} --log-level=error`, {
  cwd: ROOT,
  stdio: "inherit",
});

const C = await import(pathToFileURL(bundle));
const A = await import(pathToFileURL(join(ROOT, "api/_auth-core.js")));
const R = await import(pathToFileURL(join(ROOT, "api/_replica.js")));
const V = await import(pathToFileURL(join(ROOT, "api/_voice/contracts.js")));
const { createVoiceProvider } = await import(pathToFileURL(join(ROOT, "api/_voice/registry.js")));
const { splitSql } = await import(pathToFileURL(join(ROOT, "db/migrations/apply.mjs")));
let failed = 0;
const ok = (name, condition, extra = "") => {
  if (condition) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}${extra ? `\n      ${extra}` : ""}`);
  }
};
const throws = (fn) => {
  try { fn(); return false; } catch { return true; }
};

const NOW = 1_800_000_000_000;
const LIVE_ID = "11111111-1111-4111-8111-111111111111";
const UUIDS = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
];
const consents = C.ACTIVATION_CONSENT_SCOPES.map((scope, i) => ({
  id: `c-${i}`,
  scope,
  method: scope === "biometric" ? "live_challenge" : "account_attestation",
  policyVersion: C.REPLICA_POLICY_VERSION,
  receiptHash: "a".repeat(64),
  grantedAt: NOW - 1_000,
  evidenceSourceId: scope === "biometric" ? LIVE_ID : null,
}));
const evals = C.ACTIVATION_EVAL_SUITES.map((suite) => ({
  suite,
  verdict: "pass",
  corpusHash: "b".repeat(64),
  at: NOW - 100,
}));
const ready = () => ({
  lifecycle: "calibrating",
  subjectMode: "self",
  policyVersion: C.REPLICA_POLICY_VERSION,
  ageVerifiedAt: NOW - 2_000,
  identityVerifiedAt: NOW - 2_000,
  livenessVerifiedAt: NOW - 1_000,
  consents,
  sources: [{
    id: LIVE_ID,
    kind: "audio",
    captureMode: "live_challenge",
    state: "ready",
    sha256: "c".repeat(64),
    containsThirdParties: false,
  }],
  approvedGenomeVersion: 1,
  approvedProfileVersion: 1,
  readyVoiceProviders: 1,
  evals,
});

{
  const verdict = C.activationReadiness(ready(), NOW);
  ok("a fully evidenced self-replica is activation-ready", verdict.ready, verdict.blockers.join(", "));
  ok("ready transition requires that verdict", C.canTransitionReplica("calibrating", "ready", verdict));
  ok("ready transition rejects a missing verdict", !C.canTransitionReplica("calibrating", "ready"));
  ok("lifecycle cannot skip consent and enrollment", !C.canTransitionReplica("draft", "active", verdict));
  ok("revocation is always reachable before purge", C.canTransitionReplica("active", "revoked"));
  ok("revoked can only move toward purge", C.canTransitionReplica("revoked", "purging") && !C.canTransitionReplica("revoked", "active", verdict));
}

for (const scope of C.ACTIVATION_CONSENT_SCOPES) {
  const input = ready();
  input.consents = consents.filter((r) => r.scope !== scope);
  const verdict = C.activationReadiness(input, NOW);
  ok(`missing ${scope} consent blocks activation`, verdict.blockers.includes(`consent_missing:${scope}`));
}

{
  const input = ready();
  input.consents = input.consents.map((r) => r.scope === "storage" ? { ...r, revokedAt: NOW - 1 } : r);
  ok("revoked consent is not active", C.activationReadiness(input, NOW).blockers.includes("consent_missing:storage"));
  input.consents = consents.map((r) => ({ ...r, policyVersion: "old-policy" }));
  ok("old-policy consent is not active", C.activationReadiness(input, NOW).blockers.includes("consent_missing:capture"));
}

{
  const upload = ready();
  upload.sources[0] = { ...upload.sources[0], captureMode: "upload" };
  const verdict = C.activationReadiness(upload, NOW);
  ok("an upload cannot impersonate a live challenge", verdict.blockers.includes("live_challenge_missing"));

  const uncited = ready();
  uncited.consents = consents.map((r) => r.scope === "biometric" ? { ...r, evidenceSourceId: "other" } : r);
  ok("a live-labelled file needs verifier-issued biometric evidence", C.activationReadiness(uncited, NOW).blockers.includes("live_challenge_consent_missing"));

  const thirdParty = ready();
  thirdParty.sources[0] = { ...thirdParty.sources[0], containsThirdParties: true };
  ok("a third party in the challenge blocks activation", C.activationReadiness(thirdParty, NOW).blockers.includes("live_challenge_has_third_parties"));
}

{
  const stale = ready();
  stale.evals = [
    ...evals,
    { suite: "voice_identity", verdict: "fail", corpusHash: "d".repeat(64), at: NOW - 10 },
  ];
  ok("latest eval wins even when the input is not ordered", C.activationReadiness(stale, NOW).blockers.includes("eval_not_passed:voice_identity"));

  const future = ready();
  future.evals = evals.map((e) => e.suite === "speech_quality" ? { ...e, at: NOW + 1 } : e);
  ok("a future-dated eval cannot authorize activation", C.activationReadiness(future, NOW).blockers.includes("eval_not_passed:speech_quality"));
}

{
  const path = C.privateSourceObjectPath(...UUIDS);
  ok("private path contains only server ids", path === `${UUIDS[0]}/${UUIDS[1]}/${UUIDS[2]}/original`);
  ok("filenames cannot enter the private path", throws(() => C.privateSourceObjectPath(UUIDS[0], UUIDS[1], "../../voice.wav")));
  ok("URLs cannot enter the private path", throws(() => C.privateSourceObjectPath(UUIDS[0], UUIDS[1], "https://public.example/x")));
}

{
  C.assertContentFreeAuditFacts({ attempt: 1, allowed: true, reason_code: "ready" });
  ok("scalar content-free audit facts pass", true);
  for (const facts of [
    { transcript: "private words" },
    { provider_ref: "secret-id" },
    { metrics: { speaker_embedding: [1, 2] } },
    { detail: "x".repeat(201) },
  ]) ok(`audit rejects ${Object.keys(facts)[0]}`, throws(() => C.assertContentFreeAuditFacts(facts)));
}

ok("audible disclosure is fixed and explicit", C.SYNTHETIC_AUDIO_DISCLOSURE === "This is an AI-generated voice replica.");
ok("client and server pin the same disclosure", C.SYNTHETIC_AUDIO_DISCLOSURE === V.SYNTHETIC_AUDIO_DISCLOSURE);
ok("client and server pin the same policy version", C.REPLICA_POLICY_VERSION === R.REPLICA_POLICY_VERSION);

{
  const migration = readFileSync(join(ROOT, "db/migrations/015_replica_core.sql"), "utf8");
  const statements = splitSql(migration);
  ok("replica migration splits into independent statements", statements.length >= 20, String(statements.length));
  ok(
    "every replica migration statement is independently idempotent",
    statements.every((statement) => /^(?:--[^\n]*\n\s*)*(?:create table if not exists|create (?:unique )?index if not exists)/i.test(statement)),
  );
}

// Authorization boundary: only an RFC6750-style header counts. Body tokens,
// device ids and user ids are intentionally invisible to bearerToken().
{
  const token = "t".repeat(32);
  ok("Authorization Bearer token is parsed", A.bearerToken({ headers: { authorization: `Bearer ${token}` } }) === token);
  ok("Bearer scheme is case-insensitive", A.bearerToken({ headers: { Authorization: `bearer ${token}` } }) === token);
  ok("body access_token is not authentication", A.bearerToken({ headers: {}, body: { access_token: token } }) === null);
  ok("device UUID is not authentication", A.bearerToken({ headers: {}, body: { device: UUIDS[0] } }) === null);
  ok("malformed compound token is rejected", A.bearerToken({ headers: { authorization: `Bearer ${token} extra` } }) === null);
}

// Ownership and response minimization. The fake database obeys the SQL owner
// predicate; if a future helper drops it, these cross-account controls fail.
{
  const ownerA = UUIDS[0];
  const ownerB = UUIDS[1];
  const replicaA = UUIDS[2];
  const replicaB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const rows = [
    { replica_id: replicaA, owner_user_id: ownerA, display_name: "A", subject_mode: "self", lifecycle: "active", policy_version: R.REPLICA_POLICY_VERSION, provider_ref: "must-not-leak" },
    { replica_id: replicaB, owner_user_id: ownerB, display_name: "B", subject_mode: "self", lifecycle: "active", policy_version: R.REPLICA_POLICY_VERSION, provider_ref: "also-secret" },
  ];
  const calls = [];
  const db = async (sql, params) => {
    calls.push({ sql, params });
    if (/update vy_replica/i.test(sql)) {
      const row = rows.find((r) => r.replica_id === params[0] && r.owner_user_id === params[1]);
      if (!row) return [];
      row.lifecycle = "revoked";
      return [row];
    }
    if (/select/i.test(sql) && params.length === 1) return rows.filter((r) => r.owner_user_id === params[0]);
    if (/select/i.test(sql) && params.length === 2) return rows.filter((r) => r.replica_id === params[0] && r.owner_user_id === params[1]);
    throw new Error(`unexpected query: ${sql}`);
  };

  ok("owner A cannot read owner B's replica", await R.getOwnedReplica(db, ownerA, replicaB) === null);
  const before = calls.length;
  ok("owner A cannot revoke owner B's replica", await R.revokeOwnedReplica(db, ownerA, replicaB) === null);
  ok("failed cross-owner revoke is owner-predicated before erasure", calls.slice(before).every((c) => /owner_user_id = \$2/.test(c.sql)));
  const mine = await R.getOwnedReplica(db, ownerA, replicaA);
  ok("owned replica remains readable", mine?.replica_id === replicaA);
  ok("client replica response cannot leak ownership/provider ids", !("owner_user_id" in mine) && !("provider_ref" in mine));
  const revoked = await R.revokeOwnedReplica(db, ownerA, replicaA);
  ok("owner can revoke their replica", revoked?.lifecycle === "revoked");
  const revokeSql = calls.findLast((c) => /update vy_replica/i.test(c.sql))?.sql ?? "";
  ok("revocation disables, audits and enqueues erasure atomically", /update vy_replica/i.test(revokeSql) && /insert into vy_replica_audit/i.test(revokeSql) && /insert into vy_replica_erasure_job/i.test(revokeSql));
  ok("revocation CTE disables before erasure is declared", revokeSql.indexOf("update vy_replica") < revokeSql.indexOf("insert into vy_replica_erasure_job"));

  const endpoint = readFileSync(join(ROOT, "api/replica.js"), "utf8");
  ok("endpoint derives create ownership from verified user", /createSelfReplica\(q, user\.id,/.test(endpoint));
  ok("endpoint derives revoke ownership from verified user", /revokeOwnedReplica\(q, user\.id,/.test(endpoint));
  ok("endpoint never authorizes from body user/device fields", !/body\.(?:owner|ownerUserId|user|user_id|device)\b/.test(endpoint));
}

// The adapter seam proves create/status/synthesize/delete idempotency and the
// one PCM contract the existing cascade player can consume.
{
  ok("fake provider is unavailable without explicit test authority", throws(() => createVoiceProvider("fake")));
  const provider = createVoiceProvider("fake", { allowFake: true });
  const createInput = {
    replicaId: UUIDS[2],
    genomeVersion: 1,
    references: [{ sourceId: LIVE_ID, signedReadUrl: "https://private.invalid/signed" }],
    idempotencyKey: "idempotency-key-0001",
  };
  const first = await provider.createVoice(createInput);
  const duplicate = await provider.createVoice(createInput);
  ok("provider create is idempotent", first.providerRef === duplicate.providerRef);
  ok("created voice becomes ready", await provider.getVoiceStatus(first.providerRef) === "ready");
  const synthesis = V.assertSynthesisResult(await provider.synthesizeStream({ providerRef: first.providerRef, text: "Hello" }));
  ok("provider normalizes exact PCM wire contract", JSON.stringify(synthesis.format) === JSON.stringify(V.VOICE_PCM_FORMAT));
  ok("provider receives non-disableable disclosure", synthesis.renderedText.startsWith(V.SYNTHETIC_AUDIO_DISCLOSURE));
  let bytes = 0;
  for await (const chunk of synthesis.stream) bytes += chunk.byteLength;
  ok("provider streams bytes rather than a buffered public URL", bytes === 2_880);

  const ac = new AbortController();
  const cancelled = await provider.synthesizeStream({ providerRef: first.providerRef, text: "Stop", signal: ac.signal });
  const iterator = cancelled.stream[Symbol.asyncIterator]();
  await iterator.next();
  ac.abort(new Error("barge_in"));
  let aborted = false;
  try { await iterator.next(); } catch (error) { aborted = error.message === "barge_in"; }
  ok("barge-in abort reaches provider stream", aborted);
  await provider.deleteVoice(first.providerRef);
  await provider.deleteVoice(first.providerRef);
  ok("provider deletion is idempotent", await provider.getVoiceStatus(first.providerRef) === "missing");

  const client = V.clientVoiceProfile({
    voice_profile_id: UUIDS[0], replica_id: UUIDS[2], genome_version: 1,
    provider: "fake", provider_ref: first.providerRef, model: "fake", status: "ready",
  });
  ok("provider reference never enters client voice response", !("provider_ref" in client) && !("provider" in client));
}

// Negative control: the completely empty shape must trip every major family.
{
  const bad = C.activationReadiness({
    ...ready(), lifecycle: "revoked", policyVersion: "wrong", ageVerifiedAt: null,
    identityVerifiedAt: null, livenessVerifiedAt: null, consents: [], sources: [],
    approvedGenomeVersion: null, approvedProfileVersion: null, readyVoiceProviders: 0, evals: [],
  }, NOW);
  ok("negative control catches a structurally unsafe replica", !bad.ready && bad.blockers.length >= 18, bad.blockers.join(", "));
}

console.log(failed ? `\n${failed} FAILURES` : "\nALL PASS");
process.exit(failed ? 1 : 0);
