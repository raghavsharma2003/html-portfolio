// Offline enrollment boundary suite. It exercises consent restrictions,
// private-source validation, owner-derived object paths and the signed-upload
// storage adapter without touching a real database or bucket.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
process.env.SUPABASE_URL = "https://unit-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-test-service-role-secret";

const Consent = await import(pathToFileURL(join(ROOT, "api/_replica-consent.js")));
const Source = await import(pathToFileURL(join(ROOT, "api/_replica-source.js")));
const Storage = await import(pathToFileURL(join(ROOT, "api/_replica-storage.js")));
const Liveness = await import(pathToFileURL(join(ROOT, "api/_replica-liveness.js")));
const { splitSql } = await import(pathToFileURL(join(ROOT, "db/migrations/apply.mjs")));

let failed = 0;
const ok = (name, condition, extra = "") => {
  if (condition) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}${extra ? `\n      ${extra}` : ""}`);
  }
};
const throws = (fn, message = "") => {
  try { fn(); return false; } catch (error) { return message ? error.message === message : true; }
};

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REPLICA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SOURCE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SHA = "d".repeat(64);

{
  const scopes = Consent.consentScopes(["storage", "capture", "storage"]);
  ok("account attestation scopes are deduplicated and canonical", scopes.join(",") === "capture,storage");
  ok("account attestation cannot grant biometric consent", throws(
    () => Consent.consentScopes(["biometric"]),
    "live verification is required for this consent scope",
  ));
  ok("account attestation cannot grant inference consent", throws(() => Consent.consentScopes(["inference"])));
  ok("all four self-replica statements are mandatory", throws(() => Consent.accountAttestations({ is_self: true })));
  const attestations = Consent.accountAttestations({
    is_self: true,
    is_adult: true,
    has_source_rights: true,
    understands_synthetic_disclosure: true,
    ignored_client_field: "not retained",
  });
  const receipt = Consent.makeConsentReceipt({
    ownerUserId: OWNER,
    replica: REPLICA,
    scopes,
    method: "account_attestation",
    attestations,
    now: new Date("2026-08-24T00:00:00.000Z"),
    nonce: "fixed-nonce",
  });
  ok("consent receipt is a deterministic SHA-256 digest", /^[0-9a-f]{64}$/.test(receipt.hash));
  ok("unrecognized client attestation fields are not retained", !("ignored_client_field" in receipt.metadata.attestations));
}

{
  const phrase = Liveness.livenessPhrase(() => 0);
  ok("live phrase is server-generated and bilingual", phrase.includes("100000") && phrase.includes("Aaj") && phrase.includes("This recording"));
  ok("live phrase has enough unpredictable spoken material", phrase.split(/\s+/).length >= 20);
  const client = Liveness.clientChallenge({
    challenge_id: SOURCE, replica_id: REPLICA, phrase, phrase_hash: SHA,
    state: "issued", attempt: 1, verifier: "secret", verifier_result: { embedding: [1] },
    issued_at: "now", expires_at: "later", updated_at: "now",
  });
  ok("challenge response hides verifier internals and phrase digest", !client.phrase_hash && !client.verifier && !client.verifier_result);
  ok("third-party challenge capture is refused before SQL", await (async () => {
    try {
      await Liveness.createChallengeSource(async () => [], OWNER, REPLICA, SOURCE, {
        kind: "video", mime: "video/webm", byte_size: 12, sha256: SHA, contains_third_parties: true,
      });
      return false;
    } catch (error) { return error.message.includes("only the verified subject"); }
  })());
  ok("audio-only challenge evidence cannot satisfy independent face liveness", await (async () => {
    try {
      await Liveness.createChallengeSource(async () => [], OWNER, REPLICA, SOURCE, {
        kind: "audio", mime: "audio/wav", byte_size: 12, sha256: SHA, contains_third_parties: false,
      });
      return false;
    } catch (error) { return error.message.includes("voice and video"); }
  })());

  const calls = [];
  const db = async (sql, params) => {
    calls.push({ sql, params });
    return [{
      challenge_id: params[2], replica_id: params[0], phrase: params[3], state: "issued",
      attempt: 1, source_id: null, failure_code: "", issued_at: "now", expires_at: "later", updated_at: "now",
    }];
  };
  const issued = await Liveness.issueOwnedChallenge(db, OWNER, REPLICA, {
    challengeId: SOURCE, phrase: "A sufficiently long server phrase for this unit test.",
  });
  ok("challenge issuance is owner-scoped", issued?.challenge_id === SOURCE && calls[0].params[1] === OWNER);
  ok("challenge SQL requires current capture and storage consent", /scope = required\.scope/.test(calls[0].sql) && /policy_version = \$6/.test(calls[0].sql));
  ok("challenge issuance is capped at ten attempts per day", /attempts\.n < 10/.test(calls[0].sql));

  const finalizeCalls = [];
  const finalizeDb = async (sql, params) => {
    finalizeCalls.push({ sql, params });
    return [{
      source: {
        source_id: params[3], replica_id: params[0], owner_user_id: params[1],
        kind: "audio", capture_mode: "live_challenge", mime: "audio/wav",
        byte_size: 4096, state: "quarantined", contains_third_parties: false,
      },
      challenge: {
        challenge_id: params[2], replica_id: params[0], phrase: "test",
        state: "uploaded", attempt: 1,
      },
    }];
  };
  const finalized = await Liveness.finalizeChallengeSource(
    finalizeDb,
    OWNER,
    REPLICA,
    SOURCE,
    "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    { byteSize: 4096, mime: "audio/wav", expectedByteSize: 4096, expectedMime: "audio/wav" },
  );
  const finalizeSql = finalizeCalls[0].sql;
  ok("liveness finalization binds the exact challenge and source", finalized?.challenge?.state === "uploaded"
    && /ch\.challenge_id = \$3/.test(finalizeSql) && /ch\.source_id = s\.source_id/.test(finalizeSql));
  ok("expired challenges cannot enter biometric quarantine", /ch\.expires_at > now\(\)/.test(finalizeSql));
  ok("source quarantine, challenge consumption, audit and integrity enqueue are atomic",
    /updated_source as/.test(finalizeSql) && /updated_challenge as/.test(finalizeSql)
    && /insert into vy_replica_processing_job/.test(finalizeSql)
    && /insert into vy_replica_audit/.test(finalizeSql));
}

{
  const audio = Source.sourceUploadInput({
    kind: "audio", mime: "audio/wav; codecs=1", byte_size: 4096,
    sha256: SHA.toUpperCase(), contains_third_parties: false,
  });
  ok("source MIME and SHA-256 are canonicalized", audio.mime === "audio/wav" && audio.sha256 === SHA);
  ok("empty evidence is rejected", throws(() => Source.sourceUploadInput({
    kind: "audio", mime: "audio/wav", byte_size: 0, sha256: SHA, contains_third_parties: false,
  })));
  ok("executable masquerading as evidence is rejected", throws(() => Source.sourceUploadInput({
    kind: "document", mime: "application/x-msdownload", byte_size: 1, sha256: SHA, contains_third_parties: false,
  })));
  ok("third-party declaration cannot be omitted", throws(() => Source.sourceUploadInput({
    kind: "audio", mime: "audio/wav", byte_size: 1, sha256: SHA,
  })));
  ok("server object path contains only opaque ids", Source.privateObjectPath(OWNER, REPLICA, SOURCE) === `${OWNER}/${REPLICA}/${SOURCE}/original`);
  ok("filenames and URL fragments cannot enter object paths", throws(() => Source.privateObjectPath(OWNER, REPLICA, "voice.wav")));
  const client = Source.clientSource({
    source_id: SOURCE, replica_id: REPLICA, kind: "audio", capture_mode: "upload",
    storage_bucket: "secret", object_path: "secret/path", sha256: SHA,
    mime: "audio/wav", byte_size: "4096", state: "quarantined",
    contains_third_parties: false, rejection_code: "", created_at: "now", updated_at: "now",
  });
  ok("client source cannot leak bucket, path or source digest", !client.storage_bucket && !client.object_path && !client.sha256);
  ok("matching object metadata enters quarantine", Source.verifyStoredObject({ byte_size: 4096, mime: "audio/wav" }, { byteSize: 4096, mime: "audio/wav" }).ok);
  ok("size mismatch cannot finalize", Source.verifyStoredObject({ byte_size: 4096, mime: "audio/wav" }, { byteSize: 2048, mime: "audio/wav" }).code === "byte_size_mismatch");
  ok("MIME mismatch cannot finalize", Source.verifyStoredObject({ byte_size: 4096, mime: "audio/wav" }, { byteSize: 4096, mime: "audio/mpeg" }).code === "mime_mismatch");
}

{
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith(`/bucket/${Storage.REPLICA_STORAGE_BUCKET}`)) {
      return new Response(JSON.stringify({ id: Storage.REPLICA_STORAGE_BUCKET, public: false, file_size_limit: 536_870_912 }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/object/upload/sign/")) {
      return new Response(JSON.stringify({ url: "/object/upload/sign/private/path?token=signed-token" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected storage URL ${url}`);
  };
  await Storage.ensurePrivateReplicaBucket(fakeFetch);
  const upload = await Storage.createSignedReplicaUpload(`${OWNER}/${REPLICA}/${SOURCE}/original`, fakeFetch);
  ok("bucket access is checked before signed upload", calls[0].url.includes("/storage/v1/bucket/"));
  ok("storage admin calls use a server-only authorization header", calls.every((call) => call.init.headers.Authorization === "Bearer unit-test-service-role-secret"));
  ok("signed upload uses PUT and keeps the storage/v1 base", upload.method === "PUT" && upload.url.includes("/storage/v1/object/upload/sign/"));
  ok("signed upload is a time-limited capability, never a public URL", upload.url.includes("token=signed-token") && !upload.url.includes("/public/"));

  const publicFetch = async () => new Response(JSON.stringify({ public: true, file_size_limit: 536_870_912 }), {
    status: 200, headers: { "content-type": "application/json" },
  });
  let refusedPublic = false;
  try { await Storage.ensurePrivateReplicaBucket(publicFetch); } catch (error) {
    refusedPublic = error.code === "replica_bucket_must_be_private";
  }
  ok("a public biometric bucket is a hard failure", refusedPublic);

  const storageCode = readFileSync(join(ROOT, "api/_replica-storage.js"), "utf8");
  ok("biometric storage requires the dedicated service-role secret",
    /process\.env\.SUPABASE_SERVICE_ROLE_KEY/.test(storageCode)
    && !/process\.env\.SUPABASE_KEY\s*\|\|\s*config\.SUPABASE_KEY/.test(storageCode));
}

{
  const calls = [];
  const db = async (sql, params) => {
    calls.push({ sql, params });
    return [{
      source_id: params[2], replica_id: params[0], owner_user_id: params[1],
      kind: params[3], capture_mode: "upload", storage_bucket: params[4], object_path: params[5],
      mime: params[6], byte_size: params[7], sha256: params[8], state: "pending_upload",
      contains_third_parties: params[9], rejection_code: "", created_at: "now", updated_at: "now",
    }];
  };
  const source = await Source.createPendingSource(db, OWNER, REPLICA, {
    kind: "audio", mime: "audio/wav", byte_size: 4096, sha256: SHA, contains_third_parties: false,
  }, { sourceId: SOURCE });
  ok("database source row is owner-scoped", calls[0].params[1] === OWNER && /owner_user_id = \$2/.test(calls[0].sql));
  ok("source insert requires both capture and storage consent in SQL", /scope = 'capture'/.test(calls[0].sql) && /scope = 'storage'/.test(calls[0].sql));
  ok("the client never chooses the stored path", source.object_path === `${OWNER}/${REPLICA}/${SOURCE}/original`);
}

for (const endpoint of ["api/replica-consent.js", "api/replica-source.js"]) {
  const code = readFileSync(join(ROOT, endpoint), "utf8");
  ok(`${endpoint} derives authority from requireUser`, /requireUser\(req\)/.test(code));
  ok(`${endpoint} never trusts a body owner id`, !/body\.(?:owner|ownerUserId|owner_user_id|user|user_id|device)\b/.test(code));
}

{
  const endpoint = readFileSync(join(ROOT, "api/replica-liveness.js"), "utf8");
  ok("liveness endpoint derives authority from requireUser", /requireUser\(req\)/.test(endpoint));
  ok("owner-facing liveness endpoint cannot mark itself passed", !/body\.op\s*===\s*["'](?:pass|verify)/.test(endpoint));
  ok("liveness endpoint never trusts a body owner id", !/body\.(?:owner|ownerUserId|owner_user_id|user|user_id|device)\b/.test(endpoint));

  const migration = readFileSync(join(ROOT, "db/migrations/016_replica_enrollment.sql"), "utf8");
  const statements = splitSql(migration);
  ok("enrollment migration is a real multi-statement schema", statements.length >= 6);
  ok("enrollment migration statements are independently idempotent", statements.every((statement) =>
    /^(?:--[^\n]*\n\s*)*(?:create table if not exists|create (?:unique )?index if not exists)/i.test(statement)));
  const sourceCode = readFileSync(join(ROOT, "api/_replica-source.js"), "utf8");
  ok("quarantined evidence enters a retryable integrity queue", /insert into vy_replica_processing_job/.test(sourceCode) && /'integrity', 'queued'/.test(sourceCode));
  const sourceEndpoint = readFileSync(join(ROOT, "api/replica-source.js"), "utf8");
  ok("generic finalization cannot bypass the live-challenge transition",
    /pending\.capture_mode === "live_challenge"/.test(sourceEndpoint)
    && /use_liveness_finalize/.test(sourceEndpoint));
}

console.log(failed ? `\n${failed} FAILURES` : "\nALL PASS");
process.exit(failed ? 1 : 0);
