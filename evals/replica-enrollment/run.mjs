// Offline enrollment boundary suite. It exercises consent restrictions,
// private-source validation, owner-derived object paths and the signed-upload
// storage adapter without touching a real database or bucket.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
process.env.SUPABASE_URL = "https://unit-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-test-service-role-secret";
process.env.SUPABASE_KEY = "unit-test-public-anon-key";

const Consent = await import(pathToFileURL(join(ROOT, "api/_replica-consent.js")));
const Source = await import(pathToFileURL(join(ROOT, "api/_replica-source.js")));
const Storage = await import(pathToFileURL(join(ROOT, "api/_replica-storage.js")));
const Liveness = await import(pathToFileURL(join(ROOT, "api/_replica-liveness.js")));
const { canonicalJson } = await import(pathToFileURL(join(ROOT, "api/_provenance/contracts.js")));
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
  ok("account consent receipts survive JSONB key reordering", receipt.metadata.canonicalization === "vyakti-canonical-json/v1" &&
    createHash("sha256").update(canonicalJson(Object.fromEntries(Object.entries(receipt.metadata).reverse()))).digest("hex") === receipt.hash);
}

{
  const exact = Object.fromEntries(Consent.VERIFIED_MODEL_ATTESTATIONS.map((key) => [key, true]));
  ok("verified model ceremony requires every exact affirmative statement",
    throws(() => Consent.verifiedModelAttestations({ private_self_replica_only: true })) &&
    throws(() => Consent.verifiedModelAttestations({ ...exact, injected: true })));
  const calls = [];
  const basis = {
    consent_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    receipt_hash: "e".repeat(64),
    granted_at: "2026-08-24T00:00:00.000Z",
  };
  const db = async (sql, params) => {
    calls.push({ sql, params });
    if (calls.length === 1) return [basis];
    return ["inference", "training"].map((scope, index) => ({
      consent_id: `${index + 1}1111111-1111-4111-8111-111111111111`,
      replica_id: REPLICA,
      scope,
      method: "live_challenge",
      policy_version: "replica-self-v1",
      receipt_hash: params[5],
      metadata: JSON.parse(params[8]),
      granted_at: params[6],
      expires_at: "2027-01-01T00:00:00.000Z",
      revoked_at: null,
    }));
  };
  const granted = await Consent.grantVerifiedModelConsent(db, OWNER, REPLICA, {
    scopes: ["inference", "training"],
    attestations: exact,
  }, { now: new Date("2026-08-24T01:00:00.000Z"), nonce: "a".repeat(48) });
  ok("training and inference are minted only from a current live-challenge biometric receipt",
    granted.length === 2 && /c\.scope='biometric'/.test(calls[0].sql) && /c\.method='live_challenge'/.test(calls[0].sql));
  ok("the mutation boundary rechecks the exact biometric receipt hash and current verified identity",
    /basis\.receipt_hash=\$5/.test(calls[1].sql) && /r\.identity_expires_at>now\(\)/.test(calls[1].sql) &&
    calls[1].params[3] === basis.consent_id && calls[1].params[4] === basis.receipt_hash);
  const payload = JSON.parse(calls[1].params[8]);
  ok("verified model receipt is independently canonical and binds both scopes plus its verification basis",
    payload.statement_set === Consent.VERIFIED_MODEL_STATEMENT_SET && payload.scopes.join(",") === "inference,training" &&
    payload.verification_basis.consent_id === basis.consent_id &&
    createHash("sha256").update(canonicalJson(Object.fromEntries(Object.entries(payload).reverse()))).digest("hex") === calls[1].params[5]);
  ok("inference expires sooner than training and neither enables public channels",
    /requested\.scope='inference'[\s\S]*interval '30 days'[\s\S]*interval '180 days'/.test(calls[1].sql) &&
    !calls[1].params[2].some((scope) => ["sharing", "api", "telephony", "model_improvement"].includes(scope)));
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
    now: new Date("2026-08-24T00:00:00.000Z"), nonce: "f".repeat(48),
    attestations: {
      live_face_and_voice_processing: true,
      compare_face_to_my_id: true,
      anti_spoof_and_synthetic_detection: true,
      erase_raw_and_provider_session: true,
      self_only_private_replica: true,
    },
  });
  ok("challenge issuance is owner-scoped", issued?.challenge_id === SOURCE && calls[0].params[1] === OWNER);
  ok("challenge SQL requires current capture and storage consent", /scope = required\.scope/.test(calls[0].sql) && /policy_version = \$6/.test(calls[0].sql));
  ok("challenge issuance requires a current authentic adult ID case with a usable face reference",
    /c\.state='evidence_ready'/.test(calls[0].sql) && /c\.document_authentic=true/.test(calls[0].sql) &&
    /c\.face_reference_ready=true/.test(calls[0].sql) && /c\.credential_expires_at>now\(\)/.test(calls[0].sql));
  ok("challenge issuance is capped at ten attempts per day", /attempts\.n < 10/.test(calls[0].sql));
  ok("a second challenge cannot supersede uploaded or verifying evidence and only an unprocessed issue is auto-expired",
    /active_verification\.state in \('uploaded','verifying'\)/.test(calls[0].sql) &&
    /and state = 'issued'/.test(calls[0].sql));
  ok("concurrent challenge issuance is resolved by the live unique arbiter without surfacing a database error",
    /insert into vy_replica_liveness_challenge[\s\S]*on conflict do nothing[\s\S]*returning/.test(calls[0].sql) &&
    !/pg_advisory_xact_lock/.test(calls[0].sql));
  ok("challenge issuance atomically records narrow pre-processing biometric consent",
    /vy_replica_biometric_verification_grant/.test(calls[0].sql) &&
    /biometric-verification-consent\/v1/.test(JSON.stringify(calls[0].params)));
  const receiptPayload = JSON.parse(calls[0].params[9]);
  const reorderedReceipt = Object.fromEntries(Object.entries({
    ...receiptPayload,
    attestations: Object.fromEntries(Object.entries(receiptPayload.attestations).reverse()),
  }).reverse());
  ok("the persisted JSONB consent receipt remains independently hash-verifiable after key reordering",
    receiptPayload.canonicalization === "vyakti-canonical-json/v1" &&
    createHash("sha256").update(canonicalJson(reorderedReceipt)).digest("hex") === calls[0].params[6]);

  let cancelSql = "";
  const cancelled = await Liveness.cancelOwnedChallenge(async (sql, params) => {
    cancelSql = sql;
    return [{
      challenge_id: params[2], replica_id: params[0], phrase: "test", state: "failed", attempt: 1,
      source_id: SOURCE, failure_code: "owner_cancelled", issued_at: "now", expires_at: "later", updated_at: "now",
    }];
  }, OWNER, REPLICA, SOURCE);
  ok("owner cancellation remains available during asynchronous verification and atomically terminates its lease and ledger",
    cancelled?.failure_code === "owner_cancelled" && /state in \('issued','uploaded','verifying'\)/.test(cancelSql) &&
    /verification_lease_token_hash=''/.test(cancelSql) && /vy_replica_liveness_verification_attempt/.test(cancelSql) &&
    /failure_code='owner_cancelled'/.test(cancelSql) && /set state='deleting'/.test(cancelSql));

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
  ok("audio sources above the former 256 MiB ceiling are accepted up to one GiB",
    Source.sourceUploadInput({
      kind: "audio", mime: "audio/flac", byte_size: 300 * 1024 * 1024,
      sha256: SHA, contains_third_parties: false,
    }).byteSize === 300 * 1024 * 1024
    && throws(() => Source.sourceUploadInput({
      kind: "audio", mime: "audio/flac", byte_size: 1_073_741_825,
      sha256: SHA, contains_third_parties: false,
    })));
  const commonAudioMimes = [
    "audio/aac", "audio/x-aiff", "audio/opus", "audio/amr", "audio/x-ms-wma", "audio/x-m4a",
  ];
  ok("common Windows and phone audio MIME variants pass the same one-GiB source boundary",
    commonAudioMimes.every((mime) => Source.sourceUploadInput({
      kind: "audio", mime, byte_size: 4096, sha256: SHA, contains_third_parties: false,
    }).mime === mime));
  const enrollmentWorkspace = readFileSync(join(ROOT, "src/studio/EnrollmentWorkspace.tsx"), "utf8");
  ok("the Windows audio picker exposes every common supported recording extension",
    [".wav", ".mp3", ".m4a", ".aac", ".aiff", ".ogg", ".opus", ".flac", ".webm", ".amr", ".wma"]
      .every((extension) => enrollmentWorkspace.includes(extension)));
  ok("empty evidence is rejected", throws(() => Source.sourceUploadInput({
    kind: "audio", mime: "audio/wav", byte_size: 0, sha256: SHA, contains_third_parties: false,
  })));
  ok("executable masquerading as evidence is rejected", throws(() => Source.sourceUploadInput({
    kind: "document", mime: "application/x-msdownload", byte_size: 1, sha256: SHA, contains_third_parties: false,
  })));
  ok("third-party declaration cannot be omitted", throws(() => Source.sourceUploadInput({
    kind: "audio", mime: "audio/wav", byte_size: 1, sha256: SHA,
  })));
  const identityDocument = Source.sourceUploadInput({
    purpose: "identity_document", kind: "image", mime: "image/jpeg", byte_size: 4096,
    sha256: SHA, contains_third_parties: false,
  });
  ok("identity documents enter a dedicated non-training capture mode",
    identityDocument.captureMode === "identity_document");
  ok("identity mode accepts only self-only JPEG PNG or PDF evidence",
    throws(() => Source.sourceUploadInput({
      purpose: "identity_document", kind: "image", mime: "image/webp", byte_size: 4096,
      sha256: SHA, contains_third_parties: false,
    })) && throws(() => Source.sourceUploadInput({
      purpose: "identity_document", kind: "document", mime: "application/pdf", byte_size: 4096,
      sha256: SHA, contains_third_parties: true,
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
      return new Response(JSON.stringify({ id: Storage.REPLICA_STORAGE_BUCKET, public: false, file_size_limit: 1_073_741_824 }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/object/upload/sign/")) {
      const signedPath = new URL(url).pathname.replace(/^\/storage\/v1/, "");
      return new Response(JSON.stringify({ url: `${signedPath}?token=signed-token` }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected storage URL ${url}`);
  };
  await Storage.ensurePrivateReplicaBucket(Storage.REPLICA_STORAGE_BUCKET, fakeFetch);
  const upload = await Storage.createSignedReplicaUpload({
    storageBucket: Storage.REPLICA_STORAGE_BUCKET,
    objectPath: `${OWNER}/${REPLICA}/${SOURCE}/original`,
  }, fakeFetch);
  ok("bucket access is checked before signed upload", calls[0].url.includes("/storage/v1/bucket/"));
  ok("legacy service_role storage calls use apikey plus Bearer authorization", calls.every((call) =>
    call.init.headers.apikey === "unit-test-service-role-secret"
    && call.init.headers.Authorization === "Bearer unit-test-service-role-secret"));
  ok("signed upload uses PUT and keeps the storage/v1 base", upload.method === "PUT" && upload.url.includes("/storage/v1/object/upload/sign/"));
  ok("signed upload is a time-limited capability, never a public URL", upload.url.includes("token=signed-token") && !upload.url.includes("/public/"));
  ok("large uploads receive direct signed TUS without exposing the service role",
    upload.resumable?.protocol === "tus-1.0"
    && upload.resumable.endpoint === "https://unit-test.storage.supabase.co/storage/v1/upload/resumable"
    && upload.resumable.chunk_size === 6 * 1024 * 1024
    && upload.resumable.headers.apikey === "unit-test-public-anon-key"
    && !Object.values(upload.resumable.headers).includes("unit-test-service-role-secret"));

  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_unit-test-storage-admin";
  const secretCalls = [];
  const secretFetch = async (url, init = {}) => {
    secretCalls.push({ url, init });
    if (url.endsWith(`/bucket/${Storage.REPLICA_STORAGE_BUCKET}`)) {
      return new Response(JSON.stringify({ id: Storage.REPLICA_STORAGE_BUCKET, public: false, file_size_limit: 1_073_741_824 }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/object/upload/sign/")) {
      const signedPath = new URL(url).pathname.replace(/^\/storage\/v1/, "");
      return new Response(JSON.stringify({ url: `${signedPath}?token=signed-token` }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected storage URL ${url}`);
  };
  await Storage.ensurePrivateReplicaBucket(Storage.REPLICA_STORAGE_BUCKET, secretFetch);
  await Storage.createSignedReplicaUpload({
    storageBucket: Storage.REPLICA_STORAGE_BUCKET,
    objectPath: `${OWNER}/${REPLICA}/${SOURCE}/original`,
  }, secretFetch);
  ok("sb_secret storage calls use apikey without Bearer authorization", secretCalls.every((call) =>
    call.init.headers.apikey === "sb_secret_unit-test-storage-admin"
    && !("Authorization" in call.init.headers)));

  const rawCalls = [];
  const rawBytes = Buffer.from("verified immutable artifact", "utf8");
  const rawFetch = async (url, init = {}) => {
    rawCalls.push({ url, init });
    if (init.method === "POST") return new Response(null, { status: 200 });
    if (url.includes("/object/authenticated/")) {
      return new Response(rawBytes, {
        status: 200,
        headers: { "content-type": "application/octet-stream", "content-length": String(rawBytes.length) },
      });
    }
    throw new Error(`unexpected raw storage URL ${url}`);
  };
  const written = await Storage.writeImmutableReplicaArtifact({
    bucket: Storage.REPLICA_STORAGE_BUCKET,
    objectPath: `${OWNER}/${REPLICA}/${SOURCE}/derived/test/artifact.bin`,
    mime: "application/octet-stream",
    body: rawBytes,
    ifNoneMatch: "*",
  }, { fetchImpl: rawFetch });
  ok("sb_secret raw object GET and POST use apikey without Bearer authorization",
    written.byteSize === rawBytes.length
    && rawCalls.some((call) => call.init.method === "POST" && call.url.includes("/storage/v1/object/"))
    && rawCalls.some((call) => (call.init.method || "GET") === "GET" && call.url.includes("/object/authenticated/"))
    && rawCalls.every((call) => call.init.headers.apikey === "sb_secret_unit-test-storage-admin"
      && !("Authorization" in call.init.headers)));
  process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-test-service-role-secret";

  process.env.SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let refusedServiceRole = false;
  try {
    await Storage.createSignedReplicaUpload({
      storageBucket: Storage.REPLICA_STORAGE_BUCKET,
      objectPath: `${OWNER}/${REPLICA}/${SOURCE}/original`,
    }, fakeFetch);
  }
  catch (error) { refusedServiceRole = error.code === "public_storage_key_must_not_be_service_role"; }
  process.env.SUPABASE_KEY = "unit-test-public-anon-key";
  ok("resumable upload refuses to expose a service-role key as apikey", refusedServiceRole);

  const publicFetch = async () => new Response(JSON.stringify({ public: true, file_size_limit: 1_073_741_824 }), {
    status: 200, headers: { "content-type": "application/json" },
  });
  let refusedPublic = false;
  try { await Storage.ensurePrivateReplicaBucket(Storage.REPLICA_STORAGE_BUCKET, publicFetch); } catch (error) {
    refusedPublic = error.code === "replica_bucket_must_be_private";
  }
  ok("a public biometric bucket is a hard failure", refusedPublic);

  const storageCode = readFileSync(join(ROOT, "api/_replica-storage.js"), "utf8");
  ok("biometric storage requires the dedicated service-role secret",
    /const key = process\.env\.SUPABASE_SERVICE_ROLE_KEY \|\| config\.SUPABASE_SERVICE_ROLE_KEY/.test(storageCode)
    && !/const key = [^;]*SUPABASE_KEY/.test(storageCode));
}

{
  process.env.AZURE_REPLICA_STORAGE_ACCOUNT = "vyaktireplicatest";
  process.env.AZURE_REPLICA_STORAGE_ACCOUNT_KEY = Buffer.alloc(64, 7).toString("base64");
  process.env.AZURE_REPLICA_STORAGE_CONTAINER = "replica-private";
  const azureBucket = "azureblob:vyaktireplicatest:replica-private";
  const calls = [];
  const artifact = Buffer.from("azure immutable artifact", "utf8");
  const azureFetch = async (rawUrl, init = {}) => {
    const url = new URL(rawUrl);
    calls.push({ url, init });
    if (url.hostname === "vyaktireplicatest.blob.core.windows.net") {
      if (init.method === "HEAD" && url.searchParams.get("restype") === "container") {
        return new Response(null, { status: 200 });
      }
      if (init.method === "HEAD") {
        return new Response(null, { status: 200, headers: {
          "content-length": url.pathname.includes("/derived/") ? String(artifact.length) : "4096",
          "content-type": url.pathname.includes("/derived/") ? "application/octet-stream" : "audio/wav",
          etag: '"azure-etag"',
        } });
      }
      if (init.method === "PUT") return new Response(null, { status: 201 });
      if (init.method === "DELETE") return new Response(null, { status: 202 });
      if (!init.method || init.method === "GET") return new Response(artifact, { status: 200, headers: {
        "content-length": String(artifact.length), "content-type": "application/octet-stream",
      } });
    }
    throw new Error(`unexpected Azure storage URL ${url}`);
  };
  const locator = {
    storageBucket: azureBucket,
    objectPath: `${OWNER}/${REPLICA}/${SOURCE}/original`,
  };
  const checked = await Storage.ensurePrivateReplicaBucket(azureBucket, azureFetch);
  const upload = await Storage.createSignedReplicaUpload(locator, azureFetch);
  const uploadUrl = new URL(upload.url);
  ok("Azure persists a durable provider locator without changing opaque object paths",
    checked.provider === "azure_blob" && checked.bucket === azureBucket
    && uploadUrl.pathname === `/replica-private/${OWNER}/${REPLICA}/${SOURCE}/original`);
  ok("Azure browser capability is one-blob, HTTPS, create-only and never contains the account key",
    uploadUrl.protocol === "https:" && uploadUrl.hostname === "vyaktireplicatest.blob.core.windows.net"
    && uploadUrl.searchParams.get("sr") === "b" && uploadUrl.searchParams.get("sp") === "c"
    && uploadUrl.searchParams.get("sv") === "2026-04-06"
    && !/[rwdl]/.test(uploadUrl.searchParams.get("sp") || "")
    && uploadUrl.searchParams.has("sig") && !upload.url.includes(process.env.AZURE_REPLICA_STORAGE_ACCOUNT_KEY));
  ok("Azure large uploads use resumable blocks with create-only final commit headers",
    upload.resumable?.protocol === "azure-block-v1" && upload.resumable.chunk_size === 8 * 1024 * 1024
    && upload.headers["if-none-match"] === "*" && upload.headers["x-ms-blob-type"] === "BlockBlob");
  const info = await Storage.replicaObjectInfo(locator, azureFetch);
  ok("Azure finalize reads exact private blob size and MIME", info.byteSize === 4096 && info.mime === "audio/wav");
  const signedRead = await Storage.createSignedReplicaRead(locator, { fetchImpl: azureFetch });
  ok("Azure audition/read capability is read-only and bound to one blob",
    new URL(signedRead.url).searchParams.get("sp") === "r" && new URL(signedRead.url).searchParams.get("sr") === "b");
  const written = await Storage.writeImmutableReplicaArtifact({
    bucket: azureBucket,
    objectPath: `${OWNER}/${REPLICA}/${SOURCE}/derived/test/azure.bin`,
    mime: "application/octet-stream",
    body: artifact,
    ifNoneMatch: "*",
  }, { fetchImpl: azureFetch });
  ok("Azure derived artifacts are create-only and byte-verified after write",
    written.byteSize === artifact.length && calls.some((call) => call.init.method === "PUT"
      && call.init.headers["If-None-Match"] === "*" && call.init.headers["x-ms-blob-type"] === "BlockBlob"));
  await Storage.deleteReplicaObjects([locator], azureFetch);
  ok("erasure dispatches only to the provider persisted with the object",
    calls.some((call) => call.url.hostname.endsWith(".blob.core.windows.net") && call.init.method === "DELETE")
    && !calls.some((call) => call.url.hostname === "unit-test.supabase.co" && call.init.method === "DELETE"));
  delete process.env.AZURE_REPLICA_STORAGE_ACCOUNT;
  delete process.env.AZURE_REPLICA_STORAGE_ACCOUNT_KEY;
  delete process.env.AZURE_REPLICA_STORAGE_CONTAINER;
}

{
  const calls = [];
  const db = async (sql, params) => {
    calls.push({ sql, params });
    return [{
      source_id: params[2], replica_id: params[0], owner_user_id: params[1],
      kind: params[3], capture_mode: params[11], storage_bucket: params[4], object_path: params[5],
      mime: params[6], byte_size: params[7], sha256: params[8], state: "pending_upload",
      contains_third_parties: params[9], rejection_code: "", created_at: "now", updated_at: "now",
    }];
  };
  const source = await Source.createPendingSource(db, OWNER, REPLICA, {
    kind: "audio", mime: "audio/wav", byte_size: 4096, sha256: SHA, contains_third_parties: false,
  }, { sourceId: SOURCE });
  ok("database source row is owner-scoped", calls[0].params[1] === OWNER && /owner_user_id = \$2/.test(calls[0].sql));
  ok("source insert requires both capture and storage consent in SQL", /scope = 'capture'/.test(calls[0].sql) && /scope = 'storage'/.test(calls[0].sql));
  ok("source insert serializes and caps abandoned pending uploads per owner",
    /pg_advisory_xact_lock/.test(calls[0].sql) && /s\.state='pending_upload'\)<8/.test(calls[0].sql));
  ok("the client never chooses the stored path", source.object_path === `${OWNER}/${REPLICA}/${SOURCE}/original`);
  const identitySource = await Source.createPendingSource(db, OWNER, REPLICA, {
    purpose: "identity_document", kind: "document", mime: "application/pdf", byte_size: 4096,
    sha256: SHA, contains_third_parties: false,
  }, { sourceId: SOURCE });
  ok("identity-only purpose is persisted server-side instead of inferred later",
    identitySource.capture_mode === "identity_document" && calls[1].params[11] === "identity_document");
}

for (const endpoint of ["api/replica-consent.js", "api/replica-source.js"]) {
  const code = readFileSync(join(ROOT, endpoint), "utf8");
  ok(`${endpoint} derives authority from requireUser`, /requireUser\(req\)/.test(code));
  ok(`${endpoint} never trusts a body owner id`, !/body\.(?:owner|ownerUserId|owner_user_id|user|user_id|device)\b/.test(code));
}

{
  const browserUpload = readFileSync(join(ROOT, "src/studio/enrollmentApi.ts"), "utf8");
  const workspace = readFileSync(join(ROOT, "src/studio/EnrollmentWorkspace.tsx"), "utf8");
  ok("browser large uploads use signed TUS chunks with offset recovery and no whole-file buffering",
    /"PATCH"/.test(browserUpload) && /"HEAD"/.test(browserUpload)
    && /file\.slice\(offset, end\)/.test(browserUpload)
    && /upload-offset/.test(browserUpload)
    && !/file\.arrayBuffer\(/.test(browserUpload));
  ok("browser Azure uploads restage deterministic blocks and commit create-only without read or whole-file buffering",
    /putAzureBlockUpload/.test(browserUpload) && /azureBlockId\(index\)/.test(browserUpload)
    && /file\.slice\(start, end\)/.test(browserUpload) && /"If-None-Match":\s*"\*"/.test(browserUpload)
    && /"x-ms-content-crc64":\s*crc64/.test(browserUpload)
    && !/azureRequest\("(?:GET|HEAD)"/.test(browserUpload)
    && !/file\.arrayBuffer\(/.test(browserUpload));
  ok("source picker queues multiple files and distinguishes upload from processing",
    /multiple=\{uploadMode !== "identity_document"\}/.test(workspace)
    && /for \(const \[index, current\] of files\.entries\(\)\)/.test(workspace)
    && /Upload complete\. Processing queued\./.test(workspace));
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
  ok("identity-only documents can never enter the generic memory processing DAG",
    /where state = 'quarantined' and capture_mode = 'upload'/.test(sourceCode));
  const sourceEndpoint = readFileSync(join(ROOT, "api/replica-source.js"), "utf8");
  ok("generic finalization cannot bypass the live-challenge transition",
    /pending\.capture_mode === "live_challenge"/.test(sourceEndpoint)
    && /use_liveness_finalize/.test(sourceEndpoint));
}

console.log(failed ? `\n${failed} FAILURES` : "\nALL PASS");
process.exit(failed ? 1 : 0);
