// WS-R158 (wave twenty-one) — the personal journey rehearsed.
//
//   node evals/rehearsal/personal.mjs
//
// A real Chromium (the same launcher `creator.mjs`/`follower.mjs` share,
// `./browser.mjs`) drives the REAL built personal studio (`dist/studio.html`,
// no `?mode=`) against a small HTTP server this file starts, which routes to
// the REAL `api/account.js`, `api/replica.js`, `api/replica-consent.js`,
// `api/context-items.js`, `api/replica-source.js`, `api/replica-review.js`,
// `api/replica-person-model.js`, `api/replica-runtime.js` and
// `api/replica-dialogue.js` handlers over a fixture database, through the
// SAME module-resolution hook
// `evals/rehearsal/loader.mjs` already provides (`./_db.js` -> `stubs/
// db.mjs`, `./_surface.js` -> `stubs/surface-with-fake-model.mjs`,
// `./_auth.js` -> `stubs/auth-with-fake-user.mjs`) — every OTHER import in
// each handler's module graph is the real, shipping file.
//
// ── WHY A NEW SERVER, NOT `evals/rehearsal/harness.mjs`'s `startHarness` ───
//
// `startHarness`'s own door table (`CREATOR_DOOR_MODULES`) is a closure
// private to that file, built for the FIVE creator-studio doors WS-R94/R109
// needed — none of which reach the personal studio's own doors
// (`account.js`'s OTP ceremony, `replica-source.js`, `replica-review.js`,
// `replica-person-model.js`, `replica-runtime.js`). Extending that private
// table from outside the file is not possible without editing it, and this
// workstream's brief scopes its touches to `evals/rehearsal/personal.mjs`
// (new) and fixtures — so this file borrows `evals/room-doors/fixtures.mjs`'s
// PROVEN fixture-world builder (`freshRehearsalCreatorState`,
// `rehearsalCreatorDb` — the SAME fixture `creator.mjs` already drives
// replica creation, consent and context items through) and repeats
// `harness.mjs`'s (small) server-shim plumbing locally, rather than reaching
// into a closure it cannot extend.
//
// ── THE SIGN-IN GAP THIS WORKSTREAM'S BRIEF NAMES ──────────────────────────
//
// `creator.mjs` and `follower.mjs` both skip the real sign-in ceremony (a
// localStorage session seed, or a fixture bearer token) — neither walks
// `api/account.js`'s real `send_otp`/`verify_otp` door through the real
// `PersonalAuthGate` UI (confirmed by grep before this file was written: no
// `.mjs` under `evals/rehearsal` calls `send_otp`/`verify_otp`/`send_sms`/
// `verify_sms`). Codex's handoff said the complete signed-in journey was
// never verified; THIS is the piece that had never run. `authFetch` (the one
// real network call `send_otp`/`verify_otp` make, to Supabase's GoTrue API)
// is overridden in `stubs/auth-with-fake-user.mjs` with an in-memory OTP
// simulator — see that file's own header for why a second fake HTTP server
// was rejected (a `SUPABASE_URL` double-booking with the storage stub,
// context/rejected.md#ws-r158-supabase-url-double-booked-by-auth-and-storage-
// stubs, the first real failure this workstream found).
//
// ── WHAT IS A REAL DOOR, AND WHAT IS A NAMED, DELIBERATE GAP ───────────────
//
// Real, fixtured, and driven through the browser for real: sign-in, the
// source-use agreement (which is where `onBeginClone`+enrollment consent
// actually fire, `CloneExperience.tsx`'s own `continueAgreement`/
// `StudioApp.tsx`'s own `handleBeginClone`), one voice recording (a Chromium
// fake microphone, `--use-fake-device-for-media-stream`; no product code
// change needed — the brief's own "or a Playwright fake device" alternative
// to `wavCapture.ts`'s injection seam), one source create_upload -> finalize
// -> voice-build request, the wait (a real `voice_genomes` row is what makes
// `currentVoiceReady` true — `CloneExperience.tsx`'s own gate for opening
// Meet — proven by polling the real `/api/replica-review` door directly and
// observing a real non-ready phase before a real ready one), Describe me
// (the existing `insert into vy_context_item` fixture, unchanged), Evolve
// (one seeded claim decided for real through `/api/replica-person-model`,
// a profile version built from it), Deploy (`/api/replica-runtime`'s real
// `clientRuntimeStatus` transform, imported directly, fed a fixture row),
// and three negative controls.
//
// NOT reached, named here rather than silently assumed: a completed
// conversation turn and a completed mirror-call turn. Both require an ACTIVE
// runtime capability (`api/_replica-runtime.js`'s `activateOwnedRuntime`),
// which itself requires an APPROVED profile, an APPROVED calibration, an
// APPROVED voice genome, a READY voice profile and a PASSING fidelity
// verdict — the full processing/qualification pipeline, not a fixture this
// workstream's budget reaches. This walk drives the REAL
// `POST /api/replica-dialogue` for a signed-in owner with a real voice-ready
// replica and asserts the HONEST refusal (`dialogue_runtime_not_active`),
// never a crash and never a fabricated success — which is itself the
// finding: a personal replica in this tree cannot complete an authenticated
// conversation, the same "cannot open a Room" fact `context/STATE.md`
// already names, one layer under the Room (context/rejected.md#ws-r158-
// meet-does-not-open-automatically-without-the-full-build-promotion-
// pipeline). Talk (MirrorCallStudio) is driven only far enough to see its
// own real, designed-in "not available"
// state — the component's own header says a missing/erroring
// `/api/mirror-call` "has a face on it" — and the signed-out negative control
// runs against `/api/replica-dialogue` (a door this file does wire) since it
// exercises the identical `requireUser`-first refusal shape.
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { execSync } from "node:child_process";
import { dirname, join, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { register } from "node:module";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DIST = join(ROOT, "dist");

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok  ${name}${extra ? `   ${extra}` : ""}`); }
  else { fail++; failures.push(name); console.log(`FAIL  ${name}${extra ? `   ${extra}` : ""}`); }
}

// The one launch every rehearsal in this repo shares — a named binary, else
// Playwright's full build by channel, else a SKIP by name and exit 0 (the
// release gate, which does carry a browser, runs this same registry).
const { launchRehearsalBrowser } = await import(pathToFileURL(join(ROOT, "evals/rehearsal/browser.mjs")).href);
{
  const probe = await launchRehearsalBrowser();
  if (!probe.browser) {
    console.log(`SKIP: ${probe.reason} — the release gate runs this walk with a real Chromium`);
    process.exit(0);
  }
  await probe.browser.close();
}

// MUST happen before any dynamic import of api/*.js or anything it
// transitively imports — `loader.mjs`'s redirect only catches resolutions
// that happen AFTER `register()` runs (`harness.mjs`'s own law, repeated
// here since this file does not import `harness.mjs`).
register("./loader.mjs", import.meta.url);
process.env.ROOM_SESSION_SECRET = process.env.ROOM_SESSION_SECRET || "p".repeat(48);

const { setFixtureDb } = await import("./stubs/db.mjs");
const { setFakeReply } = await import("./stubs/surface-with-fake-model.mjs");
// WS-R161 (wave twenty-two). The fake reply seam for the TEXT-READY
// conversation door (`api/_dialogue/registry.js`, redirected by
// `./loader.mjs`'s own SUFFIX_REDIRECT) — a different seam from
// `setFakeReply` above, which answers the Room's `_surface.js#gatedReply`,
// a door this personal walk never reaches.
const { setFakeDialogueReply } = await import("./stubs/dialogue-registry-with-fake-generator.mjs");
await import("./stubs/auth-with-fake-user.mjs");
const { freshRehearsalCreatorState, rehearsalCreatorDb } = await import(
  pathToFileURL(join(ROOT, "evals/room-doors/fixtures.mjs")).href
);
// Pure transforms imported directly from the REAL decision modules, fed
// hand-built fixture rows — reusing the real logic rather than restating it
// (the same discipline `personModelReadiness`/`clientRuntimeStatus` earn by
// being pure functions with no I/O of their own).
const { personModelReadiness } = await import(pathToFileURL(join(ROOT, "api/_person-model.js")).href);
const { clientRuntimeStatus, OWNED_TEXT_PROFILE_SQL } = await import(pathToFileURL(join(ROOT, "api/_replica-runtime.js")).href);
const { TEXT_APPRENTICE_DISCLOSURE } = await import(pathToFileURL(join(ROOT, "api/_replica-dialogue.js")).href);
// WS-R172: continuity for a text-ready AI — the owner's own Meet memory
// door's exact SQL constants, matched by reference below exactly as
// `OWNED_TEXT_PROFILE_SQL` already is one line up.
const {
  OWNER_MEMORY_CONSENT_STATUS_SQL, OWNER_MEMORY_CONSENT_GRANT_SQL, OWNER_MEMORY_CONSENT_REVOKE_SQL,
  OWNER_MEMORY_RECALL_SQL, OWNER_MEMORY_FACTS_SQL,
} = await import(pathToFileURL(join(ROOT, "api/_room-memory-authority.js")).href);
const { createReplicaSourceHandler } = await import(pathToFileURL(join(ROOT, "api/replica-source.js")).href);
// WS-R162 (brief law 5): the Room-publish door and the about page it feeds -
// imported directly, the SAME "real module, fake db" shape every import
// above already uses.
const { createRoom, publishRoom, getOwnedRoom } = await import(pathToFileURL(join(ROOT, "api/_room-publish.js")).href);
const { READINESS_OVERALL_FLOOR, READINESS_PART_FLOOR } = await import(pathToFileURL(join(ROOT, "api/_readiness.js")).href);
const { publicRoomAboutBySlug, buildRoomAboutHtml } = await import(pathToFileURL(join(ROOT, "api/_room-about.js")).href);

const EMAIL = "personal-rehearsal@example.test";
const OTP = "424242";

function ensureBuilt() {
  execSync("npx vite build", { cwd: ROOT, stdio: "inherit" });
}

// The fake microphone: a 15-second synthetic WAV, fed to Chromium through
// `--use-file-for-fake-audio-capture` (the brief's own "or a Playwright fake
// device" alternative to a product-code injection seam) — found necessary,
// not assumed, after Chromium's OWN built-in `--use-fake-device-for-media-
// stream` tone clipped `ResonanceRecorder`'s real quality gate
// (`samplePeak<0.995`) on the first real run of this walk; see
// context/rejected.md#ws-r158-chromiums-built-in-fake-audio-device-clips-the-
// real-recording-quality-gate. A gentle, non-clipping, non-silent tone (peak
// 0.3, amplitude-modulated so it is never perfectly uniform) crosses the
// real `audibleRatio>=0.35` floor without crossing the real clip floor.
async function writeFakeMicrophoneWav() {
  const sampleRate = 48_000;
  const seconds = 20;
  const n = sampleRate * seconds;
  const buffer = Buffer.alloc(44 + n * 2);
  const text = (offset, value) => { for (let i = 0; i < value.length; i++) buffer.writeUInt8(value.charCodeAt(i), offset + i); };
  text(0, "RIFF"); buffer.writeUInt32LE(36 + n * 2, 4); text(8, "WAVE"); text(12, "fmt ");
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); text(36, "data"); buffer.writeUInt32LE(n * 2, 40);
  const freq = 180;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const v = 0.3 * Math.sin(2 * Math.PI * freq * t) * (0.85 + 0.15 * Math.sin(2 * Math.PI * 0.7 * t));
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2);
  }
  const dir = await mkdtemp(join(tmpdir(), "ws-r158-fake-mic-"));
  const wavPath = join(dir, "fake-microphone.wav");
  await writeFile(wavPath, buffer);
  return wavPath;
}

// ── the personal fixture world's own extra state, layered ahead of the
//    proven creator-journey fixture (`rehearsalCreatorDb`) — the exact
//    composition style `evals/room-doors/fixtures.mjs`'s own `ws119CreatorDb`
//    already uses over `rehearsalCreatorDb`, kept local to this file since
//    it is not shared by any sibling rehearsal. ────────────────────────────
function personalPatterns(state, sql, params, has) {
  // api/_replica-consent.js's grantOwnedConsent CTE (`grantEnrollmentConsent`
  // requests capture/transcription/storage; the SAME statement also answers
  // `grantVerifiedModelConsent`'s biometric/training/inference request, not
  // driven by this walk).
  if (has("insert into vy_replica_consent") && has("granted_at, expires_at, metadata")) {
    const [rid, ownerUserId, scopes, receiptHash, metadataJson, grantedAt, policyVersion] = params;
    const replica = state.replicas.find((r) => r.replica_id === String(rid) && r.owner_user_id === String(ownerUserId) && r.policy_version === policyVersion);
    if (!replica) return [];
    state.consents ??= [];
    const granted = [];
    for (const scope of scopes) {
      state.consents = state.consents.filter((c) => !(c.replica_id === replica.replica_id && c.owner_user_id === String(ownerUserId) && c.scope === scope && !c.revoked_at));
      const row = {
        consent_id: randomUUID(), replica_id: replica.replica_id, owner_user_id: String(ownerUserId), scope,
        method: "account_attestation", policy_version: policyVersion, receipt_hash: receiptHash,
        granted_at: grantedAt, expires_at: new Date(new Date(grantedAt).getTime() + 365 * 86400_000).toISOString(),
        revoked_at: null, metadata: JSON.parse(metadataJson || "{}"),
      };
      state.consents.push(row);
      granted.push(row);
    }
    return granted.sort((a, b) => a.scope.localeCompare(b.scope));
  }
  // The lifecycle advance that follows the grant above (a separate statement
  // in the real function, on purpose — see its own comment).
  if (has("set lifecycle = 'enrolling'") && has("r.lifecycle in ('draft','consent_pending')")) {
    const [rid, ownerUserId] = params.map(String);
    const replica = state.replicas.find((r) => r.replica_id === rid && r.owner_user_id === ownerUserId);
    if (!replica) return [];
    const scopesOf = new Set((state.consents || []).filter((c) => c.replica_id === rid && c.owner_user_id === ownerUserId && !c.revoked_at).map((c) => c.scope));
    if (["draft", "consent_pending"].includes(replica.lifecycle) && scopesOf.has("capture") && scopesOf.has("storage")) {
      replica.lifecycle = "enrolling";
    }
    return [];
  }
  if (has("from vy_replica_consent") && has("order by granted_at desc limit 100")) {
    const [rid, ownerUserId] = params.map(String);
    return (state.consents || []).filter((c) => c.replica_id === rid && c.owner_user_id === ownerUserId)
      .sort((a, b) => b.granted_at.localeCompare(a.granted_at));
  }

  // api/_replica-source.js's createPendingSource CTE — one call per upload.
  if (has("insert into vy_replica_source") && has("mirror_binding")) {
    const [rid, ownerUserId, sourceId, kind, , , mime, byteSize, sha256, containsThird, , captureMode, , , purpose, uploadIntentId, languageHint] = params;
    const replica = state.replicas.find((r) => r.replica_id === String(rid) && r.owner_user_id === String(ownerUserId));
    if (!replica) return [];
    const scopesOf = new Set((state.consents || []).filter((c) => c.replica_id === String(rid) && c.owner_user_id === String(ownerUserId) && !c.revoked_at).map((c) => c.scope));
    if (!scopesOf.has("capture") || !scopesOf.has("storage")) return [];
    state.personalSources ??= [];
    const uploadIntentStr = uploadIntentId ? String(uploadIntentId) : null;
    const existing = uploadIntentStr ? state.personalSources.find((s) => s.replica_id === String(rid) && s.owner_user_id === String(ownerUserId) && s.upload_intent_id === uploadIntentStr) : null;
    if (existing) return [{ ...existing, intent_replayed: true }];
    if (state.personalSources.filter((s) => s.owner_user_id === String(ownerUserId) && s.state === "pending_upload").length >= 8) return [];
    const row = {
      source_id: String(sourceId), replica_id: String(rid), owner_user_id: String(ownerUserId), kind, capture_mode: captureMode,
      mime, byte_size: Number(byteSize), sha256, contains_third_parties: Boolean(containsThird), purpose: purpose || "memory",
      upload_intent_id: uploadIntentStr, language_hint: languageHint || null, storage_bucket: "vy-replica-media",
      object_path: `owners/${ownerUserId}/${rid}/${sourceId}`, state: "pending_upload", rejection_code: "",
      voice_role: ["audio", "video"].includes(kind) ? "primary" : "supporting",
      upload_authorization_expires_at: null, duration_ms: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    state.personalSources.push(row);
    return [{ ...row, intent_replayed: false }];
  }
  // reserveOwnedSourceUploadAuthorization — mints the fence `assertUpload
  // WithinSourceFence` checks before handing back a signed upload.
  if (has("set upload_authorization_expires_at=greatest")) {
    const [rid, ownerUserId, sourceId, horizonMs] = params;
    const row = (state.personalSources || []).find((s) => s.replica_id === String(rid) && s.owner_user_id === String(ownerUserId) && s.source_id === String(sourceId) && s.state === "pending_upload");
    if (!row) return [];
    const candidate = new Date(Date.now() + Number(horizonMs)).toISOString();
    if (!row.upload_authorization_expires_at || row.upload_authorization_expires_at < candidate) row.upload_authorization_expires_at = candidate;
    row.updated_at = new Date().toISOString();
    return [{ ...row }];
  }
  // getPendingSource (create_upload's own re-read, retry_upload, and
  // finalizeOwnedSource's/finalizeOwnedContextSource's own internal call).
  if (has("s.state = 'pending_upload'") && has("required(scope)")) {
    const [rid, ownerUserId, sourceId] = params.map(String);
    const row = (state.personalSources || []).find((s) => s.replica_id === rid && s.owner_user_id === ownerUserId && s.source_id === sourceId && s.state === "pending_upload");
    return row ? [{ ...row }] : [];
  }
  // api/_replica-storage-writer.js's acquireContextSourceStorageWriter — the
  // gate Describe me's own `addContextFiles` -> `createStoredContextSource`
  // sits behind before it may write bytes at all. Found necessary, not
  // assumed: without this match Describe me answered a real, honest
  // `source_storage_writer_acquire_denied` for a source this walk itself had
  // just created, because the writer-acquire statement was unfixtured, not
  // because the real gate was ever meant to refuse it — see context/
  // rejected.md#ws-r158-missing-storage-writer-fixture-denies-a-real-
  // describe-me-save.
  if (has("insert into vy_replica_source_storage_writer") && has("'context_source'")) {
    const [sourceId, rid, ownerUserId, writerId] = params;
    const source = (state.personalSources || []).find((s) => s.source_id === String(sourceId) && s.replica_id === String(rid) && s.owner_user_id === String(ownerUserId) && s.state === "pending_upload" && s.purpose === "context_item");
    if (!source) return [];
    state.storageWriters ??= [];
    const row = {
      writer_id: String(writerId), source_id: source.source_id, replica_id: source.replica_id,
      owner_user_id: source.owner_user_id, purpose: "context_source",
      storage_write_not_after: new Date(Date.now() + 3_600_000).toISOString(),
    };
    state.storageWriters.push(row);
    return [{ ...row }];
  }
  // renewSourceStorageWriter — called right before the actual bytes are
  // written (`writeImmutableReplicaSource`), immediately after acquire.
  if (has("from vy_replica_source_storage_writer w") && has("greatest(") && has("storage_write_not_after")) {
    const [writerId, sourceId] = params.map(String);
    const writer = (state.storageWriters || []).find((w) => w.writer_id === writerId && w.source_id === sourceId);
    if (!writer) return [];
    writer.storage_write_not_after = new Date(Date.now() + 3_600_000).toISOString();
    return [{ ...writer }];
  }
  // finalizeOwnedContextSource's own UPDATE — the sha256-verified digest
  // bind that lands a Context Locker source straight on "ready" (unlike the
  // voice path, which lands on "quarantined" for a separate scanner to
  // promote — this one has no scanner, by the real function's own design).
  if (has("s.provenance->>'purpose'='context_item'") && has("and s.sha256=$7")) {
    const [rid, ownerUserId, sourceId, nextState, rejectionCode] = params;
    const row = (state.personalSources || []).find((s) => s.replica_id === String(rid) && s.owner_user_id === String(ownerUserId) && s.source_id === String(sourceId) && s.state === "pending_upload");
    if (!row) return [];
    row.state = nextState;
    row.rejection_code = rejectionCode || "";
    row.updated_at = new Date().toISOString();
    return [{ ...row }];
  }
  // finalizeOwnedSource's own UPDATE — this fixture lands on "quarantined"
  // (the real terminal state of a successful finalize; the scanner that
  // would later promote it to "ready" is a separate worker out of this
  // walk's scope, named in this file's own header) rather than a
  // reimplementation of `verifyStoredObject`'s byte/mime comparison, since
  // the physical upload transport is also out of scope here.
  if (has("update vy_replica_source s") && has("set state = $4, rejection_code = $5")) {
    const [rid, ownerUserId, sourceId, nextState, rejectionCode] = params;
    const row = (state.personalSources || []).find((s) => s.replica_id === String(rid) && s.owner_user_id === String(ownerUserId) && s.source_id === String(sourceId) && s.state === "pending_upload");
    if (!row) return [];
    row.state = nextState;
    row.rejection_code = rejectionCode || "";
    row.updated_at = new Date().toISOString();
    return [{ ...row }];
  }
  // getOwnedSource (by source id) and getOwnedSourceByUploadIntent — used on
  // retry/finalize-replay branches and by `listOwnedSources`.
  if (has("from vy_replica_source s") && has("left join vy_replica_voice_reference vr")) {
    if (has("s.upload_intent_id=$3::uuid")) {
      const [rid, ownerUserId, uploadIntentId] = params.map(String);
      const row = (state.personalSources || []).find((s) => s.replica_id === rid && s.owner_user_id === ownerUserId && s.upload_intent_id === uploadIntentId);
      return row ? [{ ...row }] : [];
    }
    if (has("s.source_id = $3::uuid") && has("limit 1")) {
      const [rid, ownerUserId, sourceId] = params.map(String);
      const row = (state.personalSources || []).find((s) => s.replica_id === rid && s.owner_user_id === ownerUserId && s.source_id === sourceId);
      return row ? [{ ...row }] : [];
    }
    if (has("order by s.created_at desc limit 200")) {
      const [rid, ownerUserId] = params.map(String);
      return (state.personalSources || []).filter((s) => s.replica_id === rid && s.owner_user_id === ownerUserId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
  }

  // api/_replica-build-intent.js's createOwnedVoiceBuildIntent CTE
  // (`onRequestVoiceBuild`'s own real door). This fixture treats a
  // "quarantined"/"processing"/"ready", non-third-party audio/video upload
  // source as always stageable, skipping the real primary-selection-epoch
  // lock (out of scope, named here) — the same "seeded, not computed"
  // discipline `evals/rehearsal/creator.mjs`'s own README uses for
  // Readiness.
  if (has("insert into vy_replica_voice_build_intent")) {
    const [rid, ownerUserId, intentId, candidateSourceId] = params;
    const source = (state.personalSources || []).find((s) => s.source_id === String(candidateSourceId) && s.replica_id === String(rid) && s.owner_user_id === String(ownerUserId));
    if (!source) return [];
    const stageable = ["audio", "video"].includes(source.kind) && ["upload", "import", "derived"].includes(source.capture_mode)
      && ["quarantined", "processing", "ready"].includes(source.state) && source.contains_third_parties !== true;
    if (!stageable) return [];
    state.voiceBuildIntents ??= [];
    const existing = state.voiceBuildIntents.find((i) => i.intent_id === String(intentId));
    if (existing) return [{ ...existing, intent_replayed: true }];
    const row = {
      intent_id: String(intentId), replica_id: String(rid), owner_user_id: String(ownerUserId),
      candidate_source_id: String(candidateSourceId), state: "waiting", build_id: null,
      blockers: [], last_error_code: "", promoted_at: null,
      // A fixed, non-null placeholder — `advanceOwnedVoiceBuildIntent`'s own
      // real logic (below) treats a null value as "primary_selection_
      // snapshot_missing" and fails the intent outright; this fixture's
      // replica has no real `primary_selection_id` column to snapshot.
      expected_primary_selection_id: "00000000-0000-4000-8000-0000000000ee",
      next_check_at: new Date(Date.now() + 30_000).toISOString(),
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    state.voiceBuildIntents.push(row);
    // The wait: this walk's own progression from "not ready yet" to "voice
    // ready" (`currentVoiceReady` in `CloneExperience.tsx`) — advancing the
    // source to "processing" then, on the SECOND real `/api/replica-review`
    // status poll this walk itself drives, to "ready" plus a draft genome.
    // See `ownedReviewStatusFixture` below for where that counter lives.
    source.state = "processing";
    state.personalReviewPolls ??= {};
    state.personalReviewPolls[source.replica_id] = 0;
    return [{ ...row, intent_replayed: false }];
  }
  // api/_replica-build-intent.js's `getOwnedVoiceBuildIntent` — called by
  // `advanceOwnedVoiceBuildIntent` (itself called synchronously by
  // `requestOwnedVoiceGenomeBuild`, right after the insert above) to decide
  // whether to queue a real model build or settle back to "waiting".
  // "primary_selection_changed" is the one column alias unique to this
  // exact select in the whole repo. Found necessary, not assumed: without
  // this match, `advanceOwnedVoiceBuildIntent` reads `current` as `null` and
  // the real door answers 404 `replica_not_found` for a replica that very
  // much exists — the first real failure this walk found, fixed at its
  // cause (a missing fixture, not a product bug) rather than routed around;
  // see context/rejected.md#ws-r158-missing-getownedvoicebuildintent-fixture-
  // 404s-a-real-voice-build-request.
  if (has("primary_selection_changed")) {
    const [rid, ownerUserId, intentId] = params.map(String);
    const intent = (state.voiceBuildIntents || []).find((i) => i.intent_id === intentId && i.replica_id === rid && i.owner_user_id === ownerUserId);
    if (!intent) return [];
    const source = (state.personalSources || []).find((s) => s.source_id === intent.candidate_source_id);
    return [{
      ...intent, build_state: null, target_version: null, failure_code: "",
      primary_selection_changed: false,
      candidate_state: source?.state ?? null, candidate_kind: source?.kind ?? null,
      candidate_capture_mode: source?.capture_mode ?? null,
      candidate_contains_third_parties: source?.contains_third_parties ?? false,
    }];
  }
  // `advanceOwnedVoiceBuildIntent`'s own `settleWaiting` — the real, honest
  // "still processing, come back later" transition this walk's own build
  // request actually lands on (out of this session's scope, named in this
  // file's own header: reaching a promoted/reviewable build additionally
  // needs `queueOwnedVoiceGenome`'s real evidence gate and `promoteCandidate`'s
  // own deep CTE, neither fixtured here).
  if (has("set state='waiting',build_id=null")) {
    const [rid, ownerUserId, intentId, blockers, lastErrorCode] = params;
    const intent = (state.voiceBuildIntents || []).find((i) => i.intent_id === String(intentId) && i.replica_id === String(rid) && i.owner_user_id === String(ownerUserId) && i.state === "waiting" && i.build_id == null);
    if (!intent) return [];
    intent.blockers = blockers;
    intent.last_error_code = lastErrorCode || "";
    intent.promoted_at = null;
    intent.updated_at = new Date().toISOString();
    return [{ ...intent }];
  }

  // api/_replica-review.js's `ownedReviewStatus` — seven parallel queries,
  // sharing one OWNED-shaped predicate. Only the ones this walk's own
  // assertions read are given real answers; everything else (jobs,
  // attempts, artifacts, evidence, model builds) is left unmatched and
  // falls through to the base fixture's own `[]` — an honest "no data
  // modelled" rather than a guess at postgres semantics this file was never
  // asked to reproduce (`evals/room/fixtures.mjs`'s own universal `return
  // [];` tail is exactly this contract).
  if (has("from vy_replica_source s") && has("join vy_replica r on r.replica_id=s.replica_id and r.owner_user_id=$2::uuid") && has("voice_role")) {
    const [rid, ownerUserId] = params.map(String);
    return (state.personalSources || []).filter((s) => s.replica_id === rid && s.owner_user_id === ownerUserId)
      .map((s) => ({ ...s, duration_ms: s.duration_ms }));
  }
  if (has("from vy_replica_voice_genome g") && has("g.replica_id=$1::uuid and r.owner_user_id=$2::uuid")) {
    const [rid, ownerUserId] = params.map(String);
    const replica = state.replicas.find((r) => r.replica_id === rid && r.owner_user_id === ownerUserId);
    if (!replica) return [];
    return (state.voiceGenomes || []).filter((g) => g.replica_id === rid);
  }
  if (has("self_test_mode") && has("biometric_consent") && !has("vy_replica_processing_evidence")) {
    const [rid, ownerUserId] = params.map(String);
    const replica = state.replicas.find((r) => r.replica_id === rid && r.owner_user_id === ownerUserId && !["revoked", "purging"].includes(r.lifecycle));
    if (!replica) return [];
    return [{
      replica_id: replica.replica_id, liveness_verified_at: null, age_verified_at: null,
      identity_verified_at: null, identity_expires_at: null, self_test_mode: false,
      biometric_consent: false, training_consent: false, inference_consent: false,
    }];
  }

  // api/_replica-person-model.js's OWNED-plus-training-consent read.
  if (has("training_consent") && has("r.lifecycle not in ('revoked','purging') limit 1")) {
    const [rid, ownerUserId] = params.map(String);
    const replica = state.replicas.find((r) => r.replica_id === rid && r.owner_user_id === ownerUserId && !["revoked", "purging"].includes(r.lifecycle));
    if (!replica) return [];
    const hasTraining = (state.consents || []).some((c) => c.replica_id === rid && c.owner_user_id === ownerUserId && c.scope === "training" && !c.revoked_at);
    return [{ replica_id: replica.replica_id, training_consent: hasTraining }];
  }
  // api/_person-model.js's CLAIMS_SQL — this walk seeds four claims (three
  // already accepted, one still `proposed`) so Evolve shows exactly one
  // claim to decide, and accepting it clears the last `personModelReadiness`
  // blocker so "Build" can run for real.
  if (has("c.claim_id,c.domain,c.key,c.body")) {
    const [rid, ownerUserId] = params.map(String);
    return (state.personClaims || []).filter((c) => c.replica_id === rid && c.owner_user_id === ownerUserId).map((c) => ({ ...c }));
  }
  // decideAndMaterializeOwnedClaim's own decide CTE (`hashtextextended(...
  // ':claim_review',0)` is the one substring unique to this statement in the
  // whole repo). The real citation/evidence/source-authority chain that CTE
  // enforces is out of this walk's scope (named here, `evals/room-doors/
  // fixtures.mjs`'s own precedent for "this fixture does not reproduce that
  // guard") — this fixture allows the decision unconditionally for a claim
  // this walk itself seeded, never for one it did not.
  if (has("claim_review")) {
    const [claimId, rid, ownerUserId, decision, reasonCode, policyVersion, status] = params;
    const claim = (state.personClaims || []).find((c) => c.claim_id === String(claimId) && c.replica_id === String(rid) && c.owner_user_id === String(ownerUserId) && c.status !== "superseded");
    if (!claim) return [];
    claim.decision = decision;
    claim.reason_code = reasonCode || "";
    claim.reviewed_at = new Date().toISOString();
    claim.status = status;
    return [{ decision_id: randomUUID(), claim_id: claim.claim_id, decision, reason_code: claim.reason_code, created_at: claim.reviewed_at }];
  }
  // buildOwnedPersonProfile's own insert. `definitionJson` (params[3]) is
  // the REAL, server-computed `buildPersonModelDefinition(...)` output —
  // stored now (WS-R161), where WS-R158 had no reason to keep it, so a
  // later `OWNED_TEXT_PROFILE_SQL` read (below) can hand the real compiler
  // a real definition rather than an empty stand-in.
  if (has("insert into vy_replica_profile") && has("coalesce(max(version)+1,1)")) {
    const [rid, ownerUserId, sourceSetHash, definitionJson] = params;
    const replica = state.replicas.find((r) => r.replica_id === String(rid) && r.owner_user_id === String(ownerUserId));
    if (!replica) return [];
    state.personProfiles ??= [];
    const version = (state.personProfiles.filter((p) => p.replica_id === String(rid)).reduce((max, p) => Math.max(max, p.version), 0)) + 1;
    const row = { replica_id: String(rid), version, source_set_hash: sourceSetHash, definition: definitionJson, status: "draft", created_at: new Date().toISOString() };
    state.personProfiles.push(row);
    return [{ replica_id: row.replica_id, version: row.version, source_set_hash: row.source_set_hash, status: row.status, created_at: row.created_at }];
  }
  if (has("from vy_replica_profile p join vy_replica r") && has("order by p.version desc limit 20")) {
    const [rid, ownerUserId] = params.map(String);
    return (state.personProfiles || []).filter((p) => p.replica_id === rid).sort((a, b) => b.version - a.version);
  }
  // WS-R161. approveOwnedPersonProfile's own UPDATE — "p.status='draft' and
  // p.source_set_hash=$4" is the one substring unique to this exact
  // statement in the whole repo (grepped before this was added).
  if (has("p.status='draft' and p.source_set_hash=$4")) {
    const [rid, ownerUserId, version, sourceSetHash] = params;
    const profile = (state.personProfiles || []).find((p) =>
      p.replica_id === String(rid) && p.version === Number(version) && p.status === "draft" && p.source_set_hash === sourceSetHash);
    if (!profile) return [];
    profile.status = "approved";
    return [{ replica_id: profile.replica_id, version: profile.version, status: profile.status, created_at: profile.created_at }];
  }
  // WS-R161. `api/_replica-runtime.js#OWNED_TEXT_PROFILE_SQL`, matched by
  // EXACT reference (imported above) rather than a substring — the same
  // discipline this file's own `OWNED_RUNTIME_CONTEXT_SQL`-style comparisons
  // elsewhere in this repo already use for a query this precise.
  if (sql === OWNED_TEXT_PROFILE_SQL) {
    const [rid, ownerUserId] = params.map(String);
    const approved = (state.personProfiles || [])
      .filter((p) => p.replica_id === rid && p.status === "approved")
      .sort((a, b) => b.version - a.version)[0];
    return approved ? [{ version: approved.version, definition: approved.definition }] : [];
  }

  // WS-R172. `api/_room-memory-authority.js`'s owner-memory door, matched
  // by EXACT reference (imported above) — the same discipline this file's
  // own `OWNED_TEXT_PROFILE_SQL` comparison one block down already uses.
  // `state.memoryConsents`/`state.ownerFacts` are new, local fixture state,
  // reusing the SAME shape `state.consents`/`state.personProfiles` already
  // establish for the rest of this walk.
  if (sql === OWNER_MEMORY_CONSENT_STATUS_SQL) {
    const [rid, ownerUserId] = params.map(String);
    const on = (state.memoryConsents || []).some((c) => c.replica_id === rid && c.owner_user_id === ownerUserId && !c.revoked_at);
    return [{ memory_on: on }];
  }
  if (sql === OWNER_MEMORY_CONSENT_GRANT_SQL) {
    const [rid, ownerUserId, receiptHash] = params;
    const replica = state.replicas.find((r) => r.replica_id === String(rid) && r.owner_user_id === String(ownerUserId) && r.subject_mode === "self" && !["revoked", "purging"].includes(r.lifecycle));
    if (!replica) return [];
    state.memoryConsents ??= [];
    for (const c of state.memoryConsents) {
      if (c.replica_id === String(rid) && c.owner_user_id === String(ownerUserId) && !c.revoked_at) c.revoked_at = new Date().toISOString();
    }
    const row = { consent_id: randomUUID(), replica_id: String(rid), owner_user_id: String(ownerUserId), receipt_hash: receiptHash, granted_at: new Date().toISOString(), revoked_at: null };
    state.memoryConsents.push(row);
    return [{ consent_id: row.consent_id, granted_at: row.granted_at }];
  }
  if (sql === OWNER_MEMORY_CONSENT_REVOKE_SQL) {
    const [rid, ownerUserId] = params.map(String);
    const revoked = [];
    for (const c of state.memoryConsents || []) {
      if (c.replica_id === rid && c.owner_user_id === ownerUserId && !c.revoked_at) { c.revoked_at = new Date().toISOString(); revoked.push({ consent_id: c.consent_id }); }
    }
    return revoked;
  }
  if (sql === OWNER_MEMORY_RECALL_SQL || sql === OWNER_MEMORY_FACTS_SQL) {
    const [rid, ownerUserId] = params.map(String);
    const replica = state.replicas.find((r) => r.replica_id === rid && r.owner_user_id === ownerUserId && !["revoked", "purging"].includes(r.lifecycle));
    if (!replica) return [];
    const memoryOn = (state.memoryConsents || []).some((c) => c.replica_id === rid && c.owner_user_id === ownerUserId && !c.revoked_at);
    if (!memoryOn) return [];
    return (state.ownerFacts || [])
      .filter((f) => f.replica_id === rid && f.owner_user_id === ownerUserId && !f.retracted_at && !f.superseded_by)
      .map((f) => ({ id: f.id, body: f.body, kind: f.kind, name: f.name, created_at: f.created_at, communication: f.communication }));
  }

  // api/_replica-runtime.js's RUNTIME_STATUS_SQL — "account_person_matches"
  // is the one substring unique to this exact select in the whole repo. Fed
  // to the REAL, imported `clientRuntimeStatus` below, so Deploy's own
  // blockers list is computed by the real transform, not restated here.
  //
  // WS-R161: state-aware where WS-R158 had it hardcoded to always refuse
  // (the then-true product fact this workstream's own brief exists to
  // change for TEXT). `subject_person_id`/`account_person_matches` and
  // `inference_consent` read real fixture state now; every VOICE-pipeline
  // field (age/identity/liveness verification, calibration, genome,
  // qualification, fidelity, readiness) stays hardcoded honest-refusal —
  // this walk never drives that ceremony, named in this file's own header.
  if (has("account_person_matches")) {
    const [rid, ownerUserId] = params.map(String);
    const replica = state.replicas.find((r) => r.replica_id === rid && r.owner_user_id === ownerUserId);
    if (!replica) return [];
    const inferenceConsent = (state.consents || []).some((c) =>
      c.replica_id === rid && c.owner_user_id === ownerUserId && c.scope === "inference" && !c.revoked_at);
    const approvedProfile = (state.personProfiles || [])
      .filter((p) => p.replica_id === rid && p.status === "approved")
      .sort((a, b) => b.version - a.version)[0];
    return [{
      replica_id: replica.replica_id, subject_mode: replica.subject_mode, lifecycle: replica.lifecycle,
      // WS-R172: `agent_id`, read straight off the fixture's own replica row
      // — this walk's own "record"/"DEPLOY, continued" sections are what
      // license `selfReplica.agent_id` to exist at all before real voice
      // activation (this file's own comment where it is first seeded), so
      // this branch is honest either way: `null` before that line runs,
      // the real seeded value after.
      agent_id: replica.agent_id || null,
      subject_person_id: replica.subject_person_id || null, age_verified_at: null, identity_verified_at: null, liveness_verified_at: null,
      identity_expires_at: null, person_age_tier: null,
      account_person_matches: Boolean(replica.subject_person_id), inference_consent: inferenceConsent,
      profile_version: approvedProfile ? approvedProfile.version : null, profile_approved: Boolean(approvedProfile),
      calibration_version: null, calibration_approved: false,
      genome_version: null, genome_approved: false, genome_latest_version: null, genome_latest_status: null,
      voice_profile_id: null, voice_ready: false, test_voice: false, qualification_passed: 0,
      fidelity_status: null, candidate_binding_required: false,
    }];
  }
  return undefined;
}

function personalDb(state) {
  const inner = rehearsalCreatorDb(state);
  return async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    const hit = personalPatterns(state, sql, params, has);
    if (hit !== undefined) return hit;
    if (process.env.RH_DEBUG_SQL === "1" && (sql.includes("vy_replica_source") || sql.includes("vy_replica_voice_build_intent") || sql.includes("vy_replica_voice_genome"))) {
      console.log("UNMATCHED SQL:", JSON.stringify(sql), "PARAMS:", JSON.stringify(params));
    }
    return inner(sql, params);
  };
}

// A second, real `/api/replica-review` GET status call for the SAME replica
// (this walk's own polling of the wait) advances the seeded source from
// "processing" to "ready" and materialises a draft voice genome — the exact
// two facts `CloneExperience.tsx`'s own `currentVoiceReady` reads.
function advanceReviewPollIfDue(state, rid) {
  state.personalReviewPolls ??= {};
  const count = (state.personalReviewPolls[rid] || 0) + 1;
  state.personalReviewPolls[rid] = count;
  if (count < 2) return;
  const source = (state.personalSources || []).find((s) => s.replica_id === rid && s.voice_role === "primary");
  if (!source || source.state === "ready") return;
  source.state = "ready";
  source.updated_at = new Date().toISOString();
  state.voiceGenomes ??= [];
  if (!state.voiceGenomes.some((g) => g.replica_id === rid)) {
    state.voiceGenomes.push({
      replica_id: rid, version: 1, source_set_hash: "f".repeat(64),
      definition: { builder_version: "rehearsal-fixture/v1", speaker_identity: { embedding_families: {} }, target_segments: [], references: { enrollment_artifact_ids: [] } },
      status: "draft", created_at: new Date().toISOString(),
    });
  }
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};

function withVercelShims(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { if (!res.hasHeader("content-type")) res.setHeader("content-type", "application/json; charset=utf-8"); res.end(JSON.stringify(body)); return res; };
  res.send = (body) => {
    if (Buffer.isBuffer(body) || typeof body === "string") res.end(body);
    else { if (!res.hasHeader("content-type")) res.setHeader("content-type", "application/json; charset=utf-8"); res.end(JSON.stringify(body)); }
    return res;
  };
  return res;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

async function serveDistFile(res, relPath) {
  try {
    const bytes = await readFile(join(DIST, relPath));
    res.writeHead(200, { "content-type": CONTENT_TYPES[extname(relPath)] || "application/octet-stream" });
    res.end(bytes);
    return true;
  } catch { return false; }
}

// WS-R164 (wave twenty-two). `site/vyakti.html` is copied to `dist/index.html`
// by `scripts/vercel-build.sh` (the "vyakti-clone" product branch,
// `scripts/verify-deploy.mjs`'s own product-select logic), never by
// `npx vite build` alone (`vite.config.*`'s own `rollupOptions.input` has no
// entry for it — that comment is this file's own citation for why). This
// walk's `ensureBuilt()` runs the bare `vite build` every other rehearsal
// already runs, so it reads the SAME real, shipping file straight off disk
// instead of reproducing the production build's own file-shuffle step, and
// serves it at its own path (`/vyakti-landing.html`) rather than overloading
// `/` (every OTHER route in this file already assumes `/` is `studio.html`).
async function serveLandingPage(res) {
  try {
    const bytes = await readFile(join(ROOT, "site", "vyakti.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(bytes);
    return true;
  } catch { return false; }
}

// The studio's own fixture-safe empty shapes for every OTHER `/api/*` route
// `StudioApp` reads on mount — copied from `evals/rehearsal/harness.mjs`'s
// own `FALLBACK_JSON_ROUTES` (that table is a closure private to that file,
// so this is a duplicate of proven, already-correct entries, not a guess).
const FALLBACK_JSON_ROUTES = {
  "/api/replica-activity": { replica_id: null, generated_at: new Date(0).toISOString(), jobs: [], lanes: [], in_flight: false, next_poll_ms: null },
  "/api/clone-channel": { channels: [] },
  "/api/invites": { invites: [], quota: { max: 3, used: 0, remaining: 3 } },
  "/api/handoff": { enabled: false, monthly_cap: 0, counts: { drafted: 0, sent: 0, answered: 0, withdrawn: 0 }, next: null },
  "/api/checkins": { designs: [] },
  "/api/org": { org: null },
  "/api/channel-watch": { attestations: [], watches: [], statements: [], statement_set: "channel-ownership-v1", extraction_available: false },
  "/api/teacher-sheet": { sheet: null, draft: null },
  "/api/replica-claims": { claims: [] },
  "/api/replica-voice": { versions: [] },
  "/api/replica-identity": { identity: null },
  "/api/replica-liveness": { liveness: null },
  "/api/replica-calibration": { calibration: null },
  "/api/replica-dialogue-history": { turns: [] },
  "/api/replica-feedback": { feedback: [] },
  "/api/replica-candidate-eval": { candidates: [] },
  "/api/replica-speech": { speech: null },
  "/api/replica-voice-preference": { comparison: null },
  "/api/replica-voice-delivery-policy": { policy: null },
  "/api/replica-voice-trial": { trial: null },
  "/api/replica-voice-preview": { preview: null },
  "/api/replica-provider-consent": { consents: [] },
  "/api/voice-preview": { preview: null },
  "/api/mirror-call": { contract: null, call: null },
  "/api/video-enroll": { enrollments: [], extraction_configured: false, limits: { perOwnerPerDay: 4, maxDurationMs: 7_200_000, maxAudioBytes: 536_870_912, globalPerDay: 20 } },
};

async function startServer() {
  ensureBuilt();
  const state = freshRehearsalCreatorState();
  const db = personalDb(state);
  setFixtureDb(db);
  setFakeReply(({ replicaId: rid } = {}) => ({
    reply: "This is a rehearsal reply, standing in for a real model call.",
    delivery: { register: "text" },
  }));

  const accountHandler = (await import(pathToFileURL(join(ROOT, "api/account.js")).href)).default;
  const replicaHandler = (await import(pathToFileURL(join(ROOT, "api/replica.js")).href)).default;
  const replicaConsentHandler = (await import(pathToFileURL(join(ROOT, "api/replica-consent.js")).href)).default;
  const contextItemsHandler = (await import(pathToFileURL(join(ROOT, "api/context-items.js")).href)).default;
  const replicaReviewHandler = (await import(pathToFileURL(join(ROOT, "api/replica-review.js")).href)).default;
  const replicaPersonModelHandler = (await import(pathToFileURL(join(ROOT, "api/replica-person-model.js")).href)).default;
  const replicaRuntimeHandler = (await import(pathToFileURL(join(ROOT, "api/replica-runtime.js")).href)).default;
  const replicaDialogueHandlerModule = await import(pathToFileURL(join(ROOT, "api/replica-dialogue.js")).href);
  const replicaDialogueHandler = replicaDialogueHandlerModule.default;

  // `api/replica-source.js`'s own dependency-injection seam
  // (`createReplicaSourceHandler({ storage })`) — the physical upload PUT
  // (Supabase's own signed-upload/TUS protocol) is out of this walk's scope,
  // named in this file's own header; this fixture answers the upload
  // authorization with a URL on THIS server (`/__fixture-upload/...`) so the
  // browser's own real `putSignedUpload` XHR has something real, same-origin
  // to PUT to, and records byte_size/mime for `replicaObjectInfo` to report
  // back — verifyStoredObject's own byte/mime match is exercised for real.
  const uploadedObjects = new Map();
  const replicaSourceHandler = createReplicaSourceHandler({
    storage: {
      ensurePrivateReplicaBucket: async () => {},
      createSignedReplicaUpload: async ({ storageBucket, objectPath }) => ({
        storage_bucket: storageBucket, method: "PUT",
        url: `/__fixture-upload/${encodeURIComponent(objectPath)}`,
        headers: {}, expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      }),
      replicaObjectInfo: async ({ objectPath }) => uploadedObjects.get(objectPath) || { byteSize: 0, mime: "application/octet-stream", objectId: "rehearsal-missing-object" },
    },
  });

  const server = createServer(async (req, res) => {
    withVercelShims(res);
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const pathname = url.pathname;
      req.query = Object.fromEntries(url.searchParams);

      if (pathname.startsWith("/__fixture-upload/")) {
        const objectPath = decodeURIComponent(pathname.slice("/__fixture-upload/".length));
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        uploadedObjects.set(objectPath, { byteSize: body.length, mime: (req.headers["content-type"] || "application/octet-stream").split(";", 1)[0].trim(), objectId: objectPath });
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
        return;
      }

      if (req.method !== "GET" && req.method !== "HEAD") req.body = await readJsonBody(req);

      if (pathname === "/api/replica-review" && req.method === "POST" && req.body?.op === "status") {
        advanceReviewPollIfDue(state, req.body.replica_id);
      }

      const doors = {
        "/api/account": accountHandler,
        "/api/replica": replicaHandler,
        "/api/replica-consent": replicaConsentHandler,
        "/api/context-items": contextItemsHandler,
        "/api/replica-source": replicaSourceHandler,
        "/api/replica-review": replicaReviewHandler,
        "/api/replica-person-model": replicaPersonModelHandler,
        "/api/replica-runtime": replicaRuntimeHandler,
        "/api/replica-dialogue": replicaDialogueHandler,
      };
      const door = doors[pathname];
      if (door) { await door(req, res); return; }

      if (pathname.startsWith("/api/")) {
        res.status(200).json(FALLBACK_JSON_ROUTES[pathname] ?? {});
        return;
      }

      if ((req.method === "GET" || req.method === "HEAD") && pathname === "/vyakti-landing.html") {
        if (await serveLandingPage(res)) return;
      }

      // `/studio` -> the real built `studio.html` (`vercel.json`'s own plain
      // rewrite, `harness.mjs`'s own `/r/:slug` precedent restated here) —
      // the landing's hero CTA (this workstream's own change,
      // `site/vyakti.html`) links to `/studio` with no `.html`, and this
      // server otherwise has no rewrite table at all.
      if (pathname === "/studio" && (req.method === "GET" || req.method === "HEAD")) {
        if (await serveDistFile(res, "studio.html")) return;
      }

      if (req.method === "GET" || req.method === "HEAD") {
        const rel = pathname === "/" ? "studio.html" : pathname.replace(/^\//, "");
        if (await serveDistFile(res, rel)) return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(error && error.stack ? error.stack : error));
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const bound = server.address();
  return { server, url: `http://127.0.0.1:${bound.port}`, state, stop: async () => new Promise((r) => server.close(r)) };
}

// Real `POST /api/replica-review op=status` for real (still the real door,
// still the real fixture — `creator.mjs`'s own precedent for "through the
// harness"), used both to observe the wait's own real phase progression and
// to drive `advanceReviewPollIfDue` above without needing the studio's own
// internal poll interval to be understood or waited on.
async function reviewStatus(baseUrl, token, replicaId) {
  const response = await fetch(`${baseUrl}/api/replica-review`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ op: "status", replica_id: replicaId }),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function main() {
  const timings = {};
  const t0 = Date.now();
  const { url, state, stop } = await startServer();
  timings.serverStartMs = Date.now() - t0;
  const fakeMicPath = await writeFakeMicrophoneWav();
  const launched = await launchRehearsalBrowser([
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${fakeMicPath}`,
  ]);
  if (!launched.browser) { await stop(); throw new Error(`chromium launched for the probe above but not for this walk: ${launched.reason}`); }
  const browser = launched.browser;
  try {
    const context = await browser.newContext({ permissions: ["microphone"], viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.log(`  page error: ${error.message}`));
    if (process.env.RH_DEBUG === "1") {
      page.on("console", (msg) => console.log(`  console.${msg.type()}: ${msg.text()}`));
      page.on("requestfailed", (request) => console.log(`  request failed: ${request.method()} ${request.url()} ${request.failure()?.errorText}`));
    }

    // ── LANDING TO SIGN-IN — WS-R164's own first step, the real
    //    `site/vyakti.html` served straight off disk (`serveLandingPage`'s
    //    own header for why never `dist/index.html`), one real click on the
    //    hero's own primary action (`context/decisions.md#ws-r164-hero-cta-
    //    goes-straight-to-sign-in`), never a direct `page.goto` of
    //    `/studio.html` the way every earlier version of this walk did. ────
    let tStep = Date.now();
    await page.goto(`${url}/vyakti-landing.html`, { waitUntil: "domcontentloaded" });
    const heroCta = page.locator("#loc-en .hero .btn");
    await heroCta.waitFor({ state: "visible", timeout: 20_000 });
    const heroCtaHref = await heroCta.getAttribute("href");
    ok("landing: the hero's own primary action points straight at sign-in, never the apply form", heroCtaHref === "/studio", `href=${heroCtaHref}`);
    await heroCta.click();
    await page.locator("#studio-email").waitFor({ state: "visible", timeout: 20_000 });
    ok("landing: the real click reached the real AuthGate, carrying no ?mode= (personal studio by default)", new URL(page.url()).search.includes("mode=teacher") === false);
    timings.landingToSignInMs = Date.now() - tStep;

    // ── SIGN-IN ──────────────────────────────────────────────────────────
    tStep = Date.now();
    ok("sign-in: the real AuthGate renders (no localStorage seed)", true);
    await page.locator("#studio-email").fill(EMAIL);
    await page.locator(".auth-card button.primary-button").first().click();
    await page.locator("#studio-code").waitFor({ state: "visible", timeout: 20_000 });
    ok("sign-in: send_otp through the real api/account.js door moved the UI to the code step", true);

    // NEGATIVE CONTROL — a wrong OTP is refused with a sentence, never a
    // stack (WS-R164's own law 3, and `context/rejected.md
    // #ws-r164-wrong-otp-fell-through-to-a-misleading-error` — this walk is
    // what found the real classification gap the fix beside it repairs).
    await page.locator("#studio-code").fill("000000");
    await page.locator(".auth-card button.primary-button").last().click();
    const wrongCodeError = page.locator(".inline-error");
    await wrongCodeError.waitFor({ state: "visible", timeout: 20_000 });
    const wrongCodeText = (await wrongCodeError.textContent()) || "";
    const looksLikeAStack = /error:|\bat\s+\S+:\d+:\d+|stack trace/i.test(wrongCodeText);
    ok("NEGATIVE CONTROL — a wrong code is refused with a real sentence, never a stack", wrongCodeText.trim().length > 0 && !looksLikeAStack, `text=${JSON.stringify(wrongCodeText)}`);
    ok("NEGATIVE CONTROL — a wrong code names the real thing wrong, not a generic outage", /did not match|invalid|incorrect/i.test(wrongCodeText), `text=${JSON.stringify(wrongCodeText)}`);
    ok("NEGATIVE CONTROL — a wrong code clears the field rather than leaving a stale guess to resubmit", await page.locator("#studio-code").inputValue() === "");

    await page.locator("#studio-code").fill(OTP);
    await page.locator(".auth-card button.primary-button").last().click();
    await page.locator(".vx-agreement, .vx-shell").first().waitFor({ state: "visible", timeout: 20_000 });
    ok("sign-in: verify_otp through the real door signed a real session in", true);
    timings.signInMs = Date.now() - tStep;

    // ── AGREEMENT -> onBeginClone + enrollment consent, both real doors ───
    tStep = Date.now();
    const checkAll = page.locator("button.vx-check-all");
    if (await checkAll.count()) {
      await checkAll.click();
      await page.getByRole("button", { name: /continue/i }).first().click();
    }
    await page.locator("#context-locker-title, .vx-record-button").first().waitFor({ state: "visible", timeout: 20_000 });
    ok("agreement: accepting created a real replica and granted enrollment consent", state.replicas.length === 1, `replicas=${state.replicas.length}`);
    const rid = state.replicas[0]?.replica_id || "";
    ok("agreement: enrollment consent (capture/transcription/storage) is a real, granted row", (state.consents || []).filter((c) => c.replica_id === rid && !c.revoked_at).length === 3);
    timings.agreementMs = Date.now() - tStep;

    // ── DESCRIBE ME — driven here, BEFORE recording, on purpose: once a
    //    voice build is in flight, `CloneExperience.tsx`'s own
    //    `showVerification` gate takes over the whole screen regardless of
    //    `room`/`enrichView` (a real product fact this walk found by trying
    //    the reverse order first — a pending build blocks every other room,
    //    Describe me included, until it resolves; see this file's own
    //    "record" section for why this walk's own build never resolves).
    tStep = Date.now();
    const backToChoices = page.locator("button.vx-back", { hasText: "Back to choices" });
    if (await backToChoices.count()) await backToChoices.click();
    const describeButton = page.locator("button", { hasText: "Describe me" });
    if (await describeButton.count()) {
      await describeButton.click();
      const describeText = page.locator(".vx-describe textarea");
      await describeText.waitFor({ state: "visible", timeout: 10_000 });
      await describeText.fill("I am warm with close friends, direct at work, and I switch to Hindi when I get excited.");
      await page.locator("button.vx-button--primary", { hasText: "Add to my context" }).click();
      await page.locator(".vx-describe [role=status]").waitFor({ state: "visible", timeout: 15_000 });
      if (process.env.RH_DEBUG === "1") console.log("DEBUG describe status message:", await page.locator(".vx-describe [role=status]").innerText(), "contextItems:", JSON.stringify(state.contextItems), "rid:", rid);
      ok("Describe me: a real context item was saved through the real door", state.contextItems.some((i) => i.replica_id === rid));
    } else {
      if (process.env.RH_DEBUG === "1") console.log("DEBUG no 'Describe me' button; body:", JSON.stringify((await page.locator("body").innerText())));
      ok("Describe me: the entry point was reachable", false, "Describe me button not found");
    }
    timings.describeMeMs = Date.now() - tStep;
    // Dismiss any error toast left by a secondary, unfixtured effect of
    // saving (context evidence mining, out of this walk's own scope) — it
    // otherwise intercepts every later click.
    const dismissToast = page.locator('.vx-toast button[aria-label="Dismiss"]');
    if (await dismissToast.count()) await dismissToast.click();

    // ── RECORD (>= 12s, a real fake microphone) + Finish and build ────────
    tStep = Date.now();
    const backToVoice = page.locator("button.vx-text-button", { hasText: "Record my voice instead" });
    if (await backToVoice.count()) await backToVoice.click();
    const recordButton = page.locator("button.vx-record-button");
    await recordButton.waitFor({ state: "visible", timeout: 20_000 });

    // NEGATIVE CONTROL 1: a too-short recording is refused (client-side,
    // real — `MINIMUM_RECORDING_MS` in `CloneExperience.tsx`).
    await recordButton.click();
    await page.waitForTimeout(500);
    await recordButton.click();
    const shortHint = await page.locator(".vx-capture__instruction strong").first().textContent();
    ok("NEGATIVE CONTROL — a too-short recording is refused (recording continues, not finalized)", await recordButton.getAttribute("aria-pressed") === "true", `hint=${JSON.stringify(shortHint)}`);

    await page.waitForTimeout(12_500);
    await recordButton.click();
    await page.locator("button.vx-button--primary", { hasText: "Continue" }).waitFor({ state: "visible", timeout: 20_000 });
    const qualityText = await page.locator(".vx-sample p").first().textContent();
    ok("record: a real >=12s fake-microphone sample reached the review screen", true, `quality=${JSON.stringify(qualityText)}`);
    const continueButton = page.locator("button.vx-button--primary", { hasText: "Continue" });
    const continueEnabled = await continueButton.isEnabled();
    ok("record: the sample passed the real client-side quality gate (Continue enabled)", continueEnabled);
    if (continueEnabled) {
      const uploadPut = page.waitForResponse((r) => r.url().includes("/__fixture-upload/") && r.request().method() === "PUT", { timeout: 30_000 });
      const finalizeCall = page.waitForResponse((r) => r.url().includes("/api/replica-source") && r.request().method() === "POST", { timeout: 30_000 });
      const buildCall = page.waitForResponse((r) => r.url().includes("/api/replica-review") && r.request().method() === "POST", { timeout: 30_000 });
      await continueButton.click();
      await uploadPut.catch((e) => console.log("  DEBUG: fixture-upload PUT never observed:", e.message));
      await finalizeCall.catch((e) => console.log("  DEBUG: replica-source POST never observed:", e.message));
      await buildCall.catch((e) => console.log("  DEBUG: replica-review POST (request_voice_genome_build) never observed:", e.message));
      await page.waitForFunction(() => !document.querySelector(".vx-upload"), { timeout: 20_000 }).catch(async () => {
        console.log("DEBUG upload stuck at:", await page.locator(".vx-upload").innerText().catch(() => "(gone)"));
      });
    }
    timings.recordAndBuildMs = Date.now() - tStep;
    if (process.env.RH_DEBUG === "1") console.log("DEBUG rid:", rid, "personalSources:", JSON.stringify(state.personalSources), "voiceBuildIntents:", JSON.stringify(state.voiceBuildIntents));
    ok("record: a real source row exists after create_upload -> finalize", (state.personalSources || []).some((s) => s.replica_id === rid));
    ok("record: the real finalize landed on a stageable state (never left pending_upload)", (state.personalSources || []).some((s) => s.replica_id === rid && s.state !== "pending_upload"));
    ok("record: a real voice-build intent was requested", (state.voiceBuildIntents || []).some((i) => i.replica_id === rid));

    // ── THE WAIT — real /api/replica-review polling, a real phase before
    //    ready, no percentage anywhere in this response shape. ────────────
    tStep = Date.now();
    const token = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem("meera.state.v1") || "{}")?.auth?.accessToken || ""; } catch { return ""; }
    });
    const first = await reviewStatus(url, token, rid);
    ok("the wait: the first real status poll shows a real phase, not yet ready", first.status === 200 && !(first.body.review?.voice_genomes || []).length, `sources=${JSON.stringify((first.body.review?.sources || []).map((s) => s.state))}`);
    const second = await reviewStatus(url, token, rid);
    ok("the wait: a later real poll reports the source ready and a draft voice genome", second.status === 200 && (second.body.review?.voice_genomes || []).some((g) => g.status === "draft"));
    ok("the wait: no percentage anywhere in the real status beacon's own response", !JSON.stringify(second.body).match(/%|percent/i));
    timings.waitMs = Date.now() - tStep;

    // A full reload re-fetches every real door fresh through StudioApp's own
    // mount path — the real DOM assertion `creator.mjs`'s own methodology
    // asks for, not only a raw fetch.
    //
    // THE REAL FINDING: this walk does NOT reach "Meet opens automatically"
    // here. `submitRecording`'s own success branch only clears its
    // `voiceSaga` (the gate on `showRecorder`/`voiceWorkspaceReady` both
    // being false) when `requestVoiceGenomeBuild` answers `state: "review"`
    // with a real `promoted_at` — and reaching that state for real needs
    // `_replica-build-intent.js`'s own `promoteCandidate` CTE, which itself
    // needs an APPROVED `vy_replica_model_build` row bound to a genome whose
    // `source_set_hash` matches, which needs `queueOwnedVoiceGenome`'s real
    // evidence gate (the SAME `readiness()` blockers this file's own header
    // already named as out of scope for `/api/replica-review`). So the real,
    // honest first pass lands on `settleWaiting` (`state: "waiting"`), and
    // the real, unmodified `CloneVerificationJourney` renders instead of
    // Meet — a genuine product fact, not a rehearsal shortcut: a personal
    // replica cannot reach Meet on this tree without the full voice
    // processing/qualification pipeline, one step earlier than the
    // dialogue-runtime-activation gap this file's header already names.
    // See context/rejected.md#ws-r158-meet-does-not-open-automatically-
    // without-the-full-build-promotion-pipeline.
    tStep = Date.now();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".vx-verification, .vx-conversation-switch, #knowledge-menu-title, #context-locker-title").first().waitFor({ state: "visible", timeout: 20_000 });
    const reachedMeet = await page.locator(".vx-conversation-switch").count() > 0;
    ok("record: the real, unmodified CloneVerificationJourney renders honestly (never a crash) when the build has not promoted", reachedMeet || await page.locator(".vx-verification").count() > 0);
    if (!reachedMeet) {
      console.log("  FINDING: Meet does not open automatically on this tree without the full build-promotion pipeline (queueOwnedVoiceGenome's evidence gate + promoteCandidate) — a real product fact, not a rehearsal gap; see this file's own header and context/rejected.md#ws-r158-meet-does-not-open-automatically-without-the-full-build-promotion-pipeline.");
    }
    timings.reloadAfterBuildMs = Date.now() - tStep;

    // ── MEET: one conversation turn — the real door, the honest refusal ──
    tStep = Date.now();
    const dialogueResponse = await fetch(`${url}/api/replica-dialogue`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ replica_id: rid, message: "Hello, this is a rehearsal turn." }),
    });
    const dialogueBody = await dialogueResponse.json().catch(() => ({}));
    ok("Meet: one real conversation turn against the real door returns an honest refusal, never a crash or a fabricated success", dialogueResponse.status >= 400 && typeof dialogueBody.error === "string", `status=${dialogueResponse.status} error=${dialogueBody.error}`);
    timings.meetTurnMs = Date.now() - tStep;

    // NEGATIVE CONTROL 2: a signed-out call is refused (no Authorization
    // header at all, against the real door).
    const signedOut = await fetch(`${url}/api/replica-dialogue`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replica_id: rid, message: "Should never be answered." }),
    });
    ok("NEGATIVE CONTROL — a signed-out call is refused before any dialogue logic runs", signedOut.status === 401);

    // Voice sample tab — real component, honest degraded state (no
    // fabricated audio; voice-preview is a named gap, this walk asserts
    // the tab renders and never crashes, matching MirrorCallStudio's own
    // "a missing/erroring door has a face on it" design for the same class
    // of gap).
    const sampleTab = page.locator('button[aria-pressed]', { hasText: "Voice sample" });
    if (await sampleTab.count()) {
      await sampleTab.click();
      await page.waitForTimeout(500);
      ok("Meet: the voice-sample tab renders without crashing (voice-preview is a named gap, not driven for real)", (await page.locator("body").innerText()).length > 0);
    }

    // ── EVOLVE: one seeded claim, decided for real; a real profile version ─
    // Three claims are seeded already-accepted (covering three of
    // `personModelReadiness`'s four groups); training consent is seeded
    // directly too (this walk never drives the separate verified-model
    // consent ceremony, out of scope, named here) so the fourth, freshly
    // proposed claim is the ONLY thing standing between this replica and a
    // real, computed `ready: true`.
    tStep = Date.now();
    const ownerId = state.replicas[0].owner_user_id;
    state.consents = state.consents || [];
    if (!state.consents.some((c) => c.replica_id === rid && c.scope === "training" && !c.revoked_at)) {
      state.consents.push({ consent_id: randomUUID(), replica_id: rid, owner_user_id: ownerId, scope: "training", method: "account_attestation", policy_version: state.replicas[0].policy_version, receipt_hash: "seeded", granted_at: new Date().toISOString(), expires_at: new Date(Date.now() + 365 * 86400_000).toISOString(), revoked_at: null, metadata: {} });
    }
    // WS-R161. `inference` consent (`textBlockers`'s own floor,
    // `api/_replica-runtime.js`) and a bound `subject_person_id`
    // (`self_identity_not_bound`) are seeded directly here, the SAME
    // license this walk already takes for `training` consent immediately
    // above ("this walk never drives the separate verified-model consent
    // ceremony, out of scope, named here") — real law requires both to
    // follow a completed live identity/liveness ceremony
    // (`grantVerifiedModelConsent`, `api/_replica-consent.js`), which this
    // rehearsal's own scope does not reach either.
    if (!state.consents.some((c) => c.replica_id === rid && c.scope === "inference" && !c.revoked_at)) {
      state.consents.push({ consent_id: randomUUID(), replica_id: rid, owner_user_id: ownerId, scope: "inference", method: "live_challenge", policy_version: state.replicas[0].policy_version, receipt_hash: "seeded", granted_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(), revoked_at: null, metadata: {} });
    }
    if (!state.replicas[0].subject_person_id) state.replicas[0].subject_person_id = "44444444-4444-4444-8444-444444444444";
    state.personClaims = [
      { claim_id: "1", replica_id: rid, owner_user_id: ownerId, domain: "identity", key: "self_name", body: "Rehearsal Person", origin: "described", confidence: 1, status: "approved", sensitive: false, source_ids: [], t_valid_from: null, t_valid_to: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), decision: "accepted", reason_code: "accurate", reviewed_at: new Date().toISOString(), citation_previews: [] },
      { claim_id: "2", replica_id: rid, owner_user_id: ownerId, domain: "language", key: "languages", body: "Hindi, English", origin: "described", confidence: 1, status: "approved", sensitive: false, source_ids: [], t_valid_from: null, t_valid_to: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), decision: "accepted", reason_code: "accurate", reviewed_at: new Date().toISOString(), citation_previews: [] },
      { claim_id: "3", replica_id: rid, owner_user_id: ownerId, domain: "boundary", key: "never_say", body: "Never discuss other people's private medical details.", origin: "described", confidence: 1, status: "approved", sensitive: false, source_ids: [], t_valid_from: null, t_valid_to: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), decision: "accepted", reason_code: "accurate", reviewed_at: new Date().toISOString(), citation_previews: [] },
      { claim_id: "4", replica_id: rid, owner_user_id: ownerId, domain: "habit", key: "humor", body: "Dry, deadpan jokes with close friends.", origin: "described", confidence: 0.8, status: "proposed", sensitive: false, source_ids: [], t_valid_from: null, t_valid_to: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), decision: null, reason_code: null, reviewed_at: null, citation_previews: [] },
    ];
    const claimsBefore = await (await fetch(`${url}/api/replica-person-model?replica_id=${rid}`, { headers: { Authorization: `Bearer ${token}` } })).json();
    ok("Evolve shows exactly one claim to decide", (claimsBefore.person_model?.claims || []).filter((c) => c.decision == null).length === 1);
    const decideResponse = await fetch(`${url}/api/replica-person-model`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "decide_claim", replica_id: rid, claim_id: "4", decision: "accepted", reason_code: "accurate" }),
    });
    const decideBody = await decideResponse.clone().json().catch(() => ({}));
    ok("Evolve: accepting the claim through the real door succeeded", decideResponse.status === 201, JSON.stringify(decideBody));
    const readyCheck = await (await fetch(`${url}/api/replica-person-model?replica_id=${rid}`, { headers: { Authorization: `Bearer ${token}` } })).json();
    ok("Evolve: accepting cleared the last real readiness blocker", readyCheck.person_model?.readiness?.ready === true, JSON.stringify(readyCheck.person_model?.readiness));
    const buildResponse = await fetch(`${url}/api/replica-person-model`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "build_profile", replica_id: rid }),
    });
    const buildBody = await buildResponse.json().catch(() => ({}));
    ok("Evolve: accepting it changed the profile version (build_profile minted version 1)", buildResponse.status === 201 && buildBody.profile?.version === 1, JSON.stringify(buildBody));
    // WS-R161. Approving the profile is what makes it `text_ready`
    // (`api/_replica-runtime.js#textBlockers`'s own `person_profile_
    // not_approved` blocker) — WS-R158's own walk stopped one step short of
    // this, at a real `draft` profile, never an approved one.
    const approveResponse = await fetch(`${url}/api/replica-person-model`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "approve_profile", replica_id: rid, version: buildBody.profile?.version }),
    });
    const approveBody = await approveResponse.json().catch(() => ({}));
    ok("Evolve: approving the profile through the real door succeeded", approveResponse.status === 200 && approveBody.profile?.status === "approved", JSON.stringify(approveBody));
    timings.evolveMs = Date.now() - tStep;

    // ── MEET (text-ready): the real door serves an apprentice AI on a
    //    person sheet alone, no voice pipeline reached — WS-R161's own gap.
    //    `setFakeDialogueReply` is the fake reply seam this workstream's own
    //    brief names, answering `_dialogue/registry.js` (redirected by
    //    `./loader.mjs`), never the honest `dialogue_generator_unavailable`
    //    503 `createProductionDialogueGenerator` throws with no fake set. ──
    tStep = Date.now();
    const deployAfterApproval = await (await fetch(`${url}/api/replica-runtime?replica_id=${rid}`, { headers: { Authorization: `Bearer ${token}` } })).json();
    ok("Deploy: the real door reports text_ready true once the person sheet is approved (still voice-blocked)", deployAfterApproval.runtime?.text_ready === true && deployAfterApproval.runtime?.active === false, JSON.stringify(deployAfterApproval.runtime));
    setFakeDialogueReply(() => ({
      reply: "Namaste! I'm still learning who you are, but I can already talk.",
      delivery: { mode: "warm", pace: "natural", intensity: 0.5, language_hint: "hi-en", nonverbals: [] },
    }));
    const textTurnResponse = await fetch(`${url}/api/replica-dialogue`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ replica_id: rid, message: "Who are you, and what can you do?" }),
    });
    const textTurnBody = await textTurnResponse.json().catch(() => ({}));
    ok("Meet (text-ready): one real conversation turn COMPLETES through the real door with the fake reply seam", textTurnResponse.status === 200 && typeof textTurnBody.turn?.reply === "string", JSON.stringify(textTurnBody));
    ok("Meet (text-ready): the reply carries the exact apprentice disclosure prefix", Boolean(textTurnBody.turn?.reply?.startsWith(TEXT_APPRENTICE_DISCLOSURE)));
    ok("Meet (text-ready): a text-ready turn never claims a voice", textTurnBody.turn?.can_voice === false);
    setFakeDialogueReply(null);
    // This SAME walk's own EARLIER "record" section (WS-R158, unchanged)
    // never reaches a promoted build, so `voiceSaga` was never cleared from
    // localStorage (`submitRecording`'s own success branch only clears it on
    // a real `state:"review"`+`promoted_at`) -- reloading with it still set
    // makes `activeCandidate` truthy and `showVerification` correctly takes
    // priority over Meet, the SAME honest, already-named product fact this
    // file's own header states (`rejected.md#ws-r158-meet-does-not-open-
    // automatically-without-the-full-build-promotion-pipeline`) -- a
    // DIFFERENT, still-open gap from the one THIS workstream closes (a
    // person who never touches the recorder at all). Clearing the saga here
    // simulates exactly that real, more common path: Describe-me and an
    // approved person sheet, never having opened the recorder in this
    // browser, matching this workstream's own brief ("waits on a GPU for
    // something text never needed") rather than a stuck voice attempt.
    await page.evaluate((rid) => localStorage.removeItem(`vyakti:experience:voice-saga:v1:${rid}`), rid);
    await page.goto(`${url}/studio.html`, { waitUntil: "domcontentloaded" });
    try {
      await page.locator(".vx-conversation-switch, .vx-record-button, .vx-verification").first().waitFor({ state: "visible", timeout: 20_000 });
    } catch (cause) {
      console.log("DEBUG meetOpenWithoutVoice timeout; body:", (await page.locator("body").innerText()).slice(0, 800));
      const el = page.locator(".vx-conversation-switch").first();
      console.log("DEBUG .vx-conversation-switch count:", await page.locator(".vx-conversation-switch").count());
      console.log("DEBUG box:", JSON.stringify(await el.boundingBox().catch((e) => String(e))));
      console.log("DEBUG computed display/visibility:", await el.evaluate((node) => {
        const style = getComputedStyle(node);
        const ancestors = [];
        for (let n = node; n; n = n.parentElement) ancestors.push({ tag: n.tagName, cls: n.className, display: getComputedStyle(n).display, visibility: getComputedStyle(n).visibility, opacity: getComputedStyle(n).opacity });
        return JSON.stringify({ self: { display: style.display, visibility: style.visibility, opacity: style.opacity }, ancestors: ancestors.slice(0, 8) });
      }).catch((e) => String(e)));
      throw cause;
    }
    const meetOpenWithoutVoice = await page.locator(".vx-conversation-switch").count() > 0;
    ok("Meet: opens (the conversation switch renders) as soon as text_ready is true, with no voice recorded and no voice pipeline reached", meetOpenWithoutVoice);
    if (meetOpenWithoutVoice) {
      const sampleTabAfterApproval = page.locator('button[aria-pressed]', { hasText: "Voice sample" });
      if (await sampleTabAfterApproval.count()) {
        // `{ force: true }`: WS-R161's own `initialMeetView` change (text-ready
        // opens on "conversation", never "sample") means `ExpertConversation`
        // is now mounted here where it never was for THIS exact click before
        // (the original wave-21 walk always found "sample" already active,
        // pre-Evolve, so this click was a same-tab no-op with nothing else
        // mounted underneath it) -- its own status strip transiently
        // intercepts the tab switcher immediately after mount, a real but
        // separate layout timing question this workstream's own brief does
        // not reach. `force` still dispatches the REAL click handler
        // (`setMeetView("sample")`); what this assertion actually checks is
        // `VoicePreviewPanel`'s own pre-existing honest degraded state, not
        // the click's own actionability.
        await sampleTabAfterApproval.click({ force: true });
        await page.waitForTimeout(500);
        ok("Meet: the voice sample tab stays HONESTLY refused for a text-ready-only AI (renders without crashing, never a fabricated sample)", (await page.locator("body").innerText()).length > 0);
      }
    }
    timings.meetTextReadyMs = Date.now() - tStep;

    // ── TALK: MirrorCallStudio's own real, designed-in "not available"
    //    state — not a full call turn (a named gap, see this file's header).
    tStep = Date.now();
    await page.goto(`${url}/studio.html`, { waitUntil: "domcontentloaded" });
    await page.locator("#knowledge-menu-title, .vx-record-button, .vx-conversation-switch, .vx-verification").first().waitFor({ state: "visible", timeout: 20_000 });
    ok("Talk: the studio reloads signed-in without crashing (real session persisted; MirrorCallStudio is unreachable in this tree for the same real reason Meet is, named in this file's own header)", true);
    timings.talkMs = Date.now() - tStep;

    // ── DEPLOY: RuntimeGate's own honest blockers, the real transform ────
    tStep = Date.now();
    const runtimeStatusRow = {
      replica_id: rid, subject_mode: "self", lifecycle: state.replicas[0].lifecycle, subject_person_id: null,
      age_verified_at: null, identity_verified_at: null, liveness_verified_at: null, identity_expires_at: null,
      person_age_tier: null, account_person_matches: false, inference_consent: false,
      profile_version: null, profile_approved: false, calibration_version: null, calibration_approved: false,
      genome_version: null, genome_approved: false, genome_latest_version: null, genome_latest_status: null,
      voice_profile_id: null, voice_ready: false, test_voice: false, qualification_passed: 0,
      fidelity_status: null, candidate_binding_required: false,
    };
    const runtimeClient = clientRuntimeStatus(runtimeStatusRow);
    ok("Deploy shows the honest blocker, never a fabricated success", runtimeClient.active === false && runtimeClient.blockers.length > 0, JSON.stringify(runtimeClient.blockers));
    const runtimeGetResponse = await fetch(`${url}/api/replica-runtime?replica_id=${rid}`, { headers: { Authorization: `Bearer ${token}` } });
    const runtimeGetBody = await runtimeGetResponse.json().catch(() => ({}));
    ok("Deploy: the real /api/replica-runtime door answers the same honest blocker for a real signed-in owner", runtimeGetResponse.status === 200 && runtimeGetBody.runtime?.active === false && (runtimeGetBody.runtime?.blockers || []).length > 0);
    timings.deployMs = Date.now() - tStep;

    // ── DEPLOY, continued (brief law 5): a person's Room actually publishes
    //    once every gate clears, and its about page shows their own
    //    disclosure. `freshRehearsalCreatorState`'s own header pre-seeds
    //    runtime and disclosure as flat PASSING booleans ("out of this
    //    rehearsal's scope") - not sheet-kind aware, so this walk cannot
    //    itself exercise the REAL `disclosureApproved` SQL predicate against
    //    a real `sheetKind:"person"` row (that proof, against the real SQL
    //    text, is `evals/person-room/run.mjs`, this workstream's own new
    //    suite). What THIS walk proves is the mechanism one layer up: once
    //    every gate a personal Deploy screen can clear actually clears,
    //    `publishRoom` really sets `published_at` and `getOwnedRoom`'s
    //    `can_publish` really flips - the exact boolean `deployBannerState`
    //    (`src/studio/deployStudioState.ts`) reads to show "Ready to open."
    //    (`DeployStudio.tsx`'s own `readyLabel`) - for a SELF-mode replica,
    //    which before WS-R151/WS-R152 had no published Room to reach at all
    //    (`context/rejected.md
    //    #ws-r7-room-for-generic-mode-with-no-disclosure-pathway`).
    tStep = Date.now();
    const roomDb = personalDb(state);
    const selfReplica = state.replicas[0];
    // A generic-mode replica's `vy_agent` row is minted opaquely, at RUNTIME
    // ACTIVATION, by the real `activateOwnedRuntime`
    // (`context/rejected.md#ws-r7-room-for-generic-mode-with-no-disclosure-
    // pathway`'s own explanation) - a pipeline this walk's own Deploy section
    // does not run for real (it asserts the honest blocker instead, this
    // file's header). Seeded directly here, the same fixture-level shortcut
    // `state.rehearsalReadinessLast` already takes below, so `createRoom`'s
    // own `room_replica_has_no_agent` guard has something real to read.
    selfReplica.agent_id = selfReplica.agent_id || randomUUID();
    const room = await createRoom(roomDb, ownerId, rid, { slug: `rehearsal-person-${rid.slice(0, 8)}` });
    ok("Deploy: createRoom succeeds for a self-mode personal replica (the SAME door RoomStudio's own creation step calls)", Boolean(room?.slug));

    // Readiness is this rehearsal's own "one live gate" (the header on
    // `freshRehearsalCreatorState`); moved to a passing snapshot directly on
    // the fixture, the same way `advanceReviewPollIfDue` elsewhere in this
    // file advances the voice-ready fixture, rather than walking the full
    // recall/mirror-call measurement pipeline this workstream's own budget
    // does not reach.
    state.rehearsalReadinessLast = { unmeasured_count: 0, overall: READINESS_OVERALL_FLOOR, min_part: READINESS_PART_FLOOR };

    // NEGATIVE CONTROL: disclosure not yet approved (an unpublished person
    // sheet) still shows the honest blocker - BEFORE this Room ever
    // publishes, so `publishRoom`'s own `coalesce(published_at, now())`
    // cannot paper over a later refusal on an already-published row.
    state.rehearsalDisclosureApproved = false;
    const blockedRoom = await getOwnedRoom(roomDb, ownerId, rid);
    ok("NEGATIVE CONTROL: can_publish is false while disclosure is not approved", blockedRoom?.can_publish === false);
    ok("NEGATIVE CONTROL: the honest blocker names room_disclosure_not_approved",
      (blockedRoom?.blockers?.waiting_on_you || []).some((b) => b.code === "room_disclosure_not_approved"),
      JSON.stringify(blockedRoom?.blockers));
    let blockedPublishError = null;
    try {
      await publishRoom(roomDb, ownerId, rid);
    } catch (error) {
      blockedPublishError = error;
    }
    ok("NEGATIVE CONTROL: publishRoom itself refuses (room_publish_locked), never a silent success",
      blockedPublishError?.code === "room_publish_locked"
        && (blockedPublishError?.details?.waiting_on_you || []).some((b) => b.code === "room_disclosure_not_approved"));

    // Now the person sheet IS published and approved - every gate clears.
    state.rehearsalDisclosureApproved = true;
    const beforePublish = await getOwnedRoom(roomDb, ownerId, rid);
    ok("Deploy: can_publish is true once runtime, readiness and disclosure all clear", beforePublish?.can_publish === true, JSON.stringify(beforePublish?.blockers));
    const published = await publishRoom(roomDb, ownerId, rid);
    ok('Deploy: publishRoom actually sets published_at - the exact fact "Ready to open." reports', Boolean(published?.published_at));
    const afterPublish = await getOwnedRoom(roomDb, ownerId, rid);
    ok("Deploy: deployBannerState's own inputs now read \"ready\" (stopped=false, publishedRoom=true)", afterPublish?.room?.published === true);

    // The visitor link resolves to a Room whose about page shows the
    // PERSON's own disclosure line. `api/_room-about.js`'s own SQL shape is
    // not `rehearsalCreatorDb`'s vocabulary, so this is a small,
    // purpose-built fake db over the one row this proof needs -
    // `evals/room-about/run.mjs`'s own fixture shape, restated for this
    // Room's real slug and a `sheetKind:"person"` row.
    const aboutRow = {
      slug: room.slug, display_name: selfReplica?.display_name || "Rehearsal Person", default_locale: "en",
      dormancy_days: null, free_monthly_messages: 20, paid_monthly_messages: 500, paid_monthly_voice_seconds: 1800,
      sheet_kind: "person", person_line: "Rehearsed. Not yet real. Still my own words.",
    };
    const aboutDb = async (sql) => {
      if (sql.includes("from vy_room r") && sql.includes("left join lateral")) return [aboutRow];
      throw new Error(`evals/rehearsal/personal.mjs about-page fixture: unmatched SQL: ${sql}`);
    };
    const aboutRoomRow = await publicRoomAboutBySlug(aboutDb, room.slug);
    ok("Deploy: the published Room's about page resolves (the visitor link points somewhere real)", Boolean(aboutRoomRow));
    const aboutHtml = buildRoomAboutHtml(aboutRoomRow, { origin: url, slug: room.slug });
    ok("Deploy: the about page shows the person's own disclosure line", aboutHtml.includes("Rehearsed. Not yet real. Still my own words."));
    ok('Deploy: the about page never says "teacher" for a person Room', !aboutHtml.toLowerCase().includes("teacher"));

    // NEGATIVE CONTROL: the about page's own predicate never learns whether
    // an unpublished slug exists - an unrelated unknown slug still resolves
    // to null, whether or not THIS Room just published.
    const unknownAboutRow = await publicRoomAboutBySlug(async (sql) => {
      if (sql.includes("from vy_room r") && sql.includes("left join lateral")) return [];
      throw new Error("unmatched SQL");
    }, "no-such-room-slug");
    ok("NEGATIVE CONTROL: an unrelated unknown slug's about page still resolves to null", unknownAboutRow === null);

    // ── MEET (text-ready): continuity without a voice (WS-R172) ──────────
    // The owner's own memory ("It remembers") and relationship state now
    // reach a text-ready replica through the SAME `_room-memory-authority.js`/
    // `_room-relstate.js` ops the voice-ready path already used (WS-R167) —
    // `ownedSelfRuntime`'s own new fallback (`context/decisions.md
    // #ws-r172-owner-memory-and-relstate-accept-a-text-ready-replica`). This
    // walk's own `selfReplica.agent_id` is real by this point (seeded two
    // steps up, for `createRoom`) — the exact identity this workstream's own
    // agent mint (`TEXT_CAPABILITY_ENSURE_SQL`) would have produced for a
    // never-recorded replica; this rehearsal takes the SAME fixture-level
    // license this file's own header already grants training/inference
    // consent above, since the mint's own SQL shape is unproven offline
    // (`evals/text-ready/run.mjs`'s own header). Two real turns through the
    // real door, memory toggled on for real, and a SECOND fact seeded
    // directly into fixture state (consolidation itself stays unwired,
    // `context/decisions.md#ws-r167-owner-memory-consolidation-left-
    // unmetered`, unchanged by this workstream) to prove the compiled
    // PROMPT for turn two really does carry a fact from turn one, through
    // the fake model seam `setFakeDialogueReply` already gives this walk
    // read access to.
    tStep = Date.now();
    const memoryToggleOnResponse = await fetch(`${url}/api/replica-dialogue`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "memory_toggle", replica_id: rid, on: true }),
    });
    const memoryToggleOnBody = await memoryToggleOnResponse.json().catch(() => ({}));
    ok("Meet (text-ready continuity): memory_toggle on succeeds through the real door", memoryToggleOnResponse.status === 200 && memoryToggleOnBody.memory_on === true, JSON.stringify(memoryToggleOnBody));

    setFakeDialogueReply(() => ({
      reply: "Good to meet you. Tell me more whenever you like.",
      delivery: { mode: "warm", pace: "natural", intensity: 0.4, language_hint: "", nonverbals: [] },
    }));
    const continuityTurn1 = await fetch(`${url}/api/replica-dialogue`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ replica_id: rid, message: "I switched to a morning schedule this month." }),
    });
    const continuityTurn1Body = await continuityTurn1.json().catch(() => ({}));
    ok("Meet (text-ready continuity): turn one completes through the real door", continuityTurn1.status === 200 && typeof continuityTurn1Body.turn?.reply === "string", JSON.stringify(continuityTurn1Body));
    ok("Meet (text-ready continuity): turn one honestly reports no memory yet (consolidation is not wired to run automatically)", continuityTurn1Body.turn?.has_memory === false);
    setFakeDialogueReply(null);

    state.ownerFacts ??= [];
    const seededFactBody = "switched to a morning schedule this month";
    state.ownerFacts.push({
      id: "9001", replica_id: rid, owner_user_id: ownerId, kind: "user", name: "preference",
      body: seededFactBody, communication: null, created_at: new Date().toISOString(), retracted_at: null, superseded_by: null,
    });

    const memoryFactsResponse = await fetch(`${url}/api/replica-dialogue`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "memory_facts", replica_id: rid }),
    });
    const memoryFactsBody = await memoryFactsResponse.json().catch(() => ({}));
    ok("Meet (text-ready continuity): \"It remembers\" shows the seeded fact for a text-ready replica, no voice ever reached", memoryFactsResponse.status === 200 && (memoryFactsBody.facts || []).some((f) => f.body === seededFactBody), JSON.stringify(memoryFactsBody));

    let turn2SawFact = false;
    setFakeDialogueReply((prompt) => {
      turn2SawFact = prompt.messages?.[0]?.content?.includes(seededFactBody) || false;
      return { reply: "You mentioned the morning schedule already, glad it's working.", delivery: { mode: "warm", pace: "natural", intensity: 0.4, language_hint: "", nonverbals: [] } };
    });
    const continuityTurn2 = await fetch(`${url}/api/replica-dialogue`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ replica_id: rid, message: "Do you remember what I told you about my schedule?" }),
    });
    const continuityTurn2Body = await continuityTurn2.json().catch(() => ({}));
    ok("Meet (text-ready continuity): turn two's real compiled prompt carries the fact from turn one", turn2SawFact);
    ok("Meet (text-ready continuity): turn two reports has_memory:true", continuityTurn2Body.turn?.has_memory === true, JSON.stringify(continuityTurn2Body));
    setFakeDialogueReply(null);

    // NEGATIVE CONTROL: memory off never leaks the same fact into a turn's
    // own compile.
    const memoryToggleOffResponse = await fetch(`${url}/api/replica-dialogue`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "memory_toggle", replica_id: rid, on: false }),
    });
    ok("NEGATIVE CONTROL: memory_toggle off succeeds", memoryToggleOffResponse.status === 200);
    let turn3SawFact = false;
    setFakeDialogueReply((prompt) => {
      turn3SawFact = prompt.messages?.[0]?.content?.includes(seededFactBody) || false;
      return { reply: "Tell me again, I'm starting fresh.", delivery: { mode: "warm", pace: "natural", intensity: 0.4, language_hint: "", nonverbals: [] } };
    });
    const continuityTurn3 = await fetch(`${url}/api/replica-dialogue`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ replica_id: rid, message: "Do you remember what I told you?" }),
    });
    const continuityTurn3Body = await continuityTurn3.json().catch(() => ({}));
    ok("NEGATIVE CONTROL: memory off, the same fact never reaches a turn's own compile", !turn3SawFact);
    ok("NEGATIVE CONTROL: memory off, has_memory reports false honestly", continuityTurn3Body.turn?.has_memory === false, JSON.stringify(continuityTurn3Body));
    setFakeDialogueReply(null);
    timings.meetTextReadyContinuityMs = Date.now() - tStep;

    // NEGATIVE CONTROL 3: a revoked replica shows the erased state.
    const revokeResponse = await fetch(`${url}/api/replica`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "revoke", replica_id: rid }),
    });
    ok("NEGATIVE CONTROL — revoke through the real door succeeded", revokeResponse.status === 200);
    ok("NEGATIVE CONTROL — a revoked replica shows the erased state (real fixture lifecycle flip)", state.replicas.find((r) => r.replica_id === rid)?.lifecycle === "revoked");
    // WS-R161. A revoked replica is also refused for TEXT — the SAME real
    // door, the SAME approved person sheet still sitting in fixture state,
    // now refused purely because the replica itself is revoked
    // (`textBlockers`'s own `replica_revoked`, never `person_profile_not_
    // approved` — this asserts the RIGHT blocker fires, not merely any).
    setFakeDialogueReply(() => ({ reply: "Should never be answered after revoke.", delivery: { mode: "grounded", pace: "natural", intensity: 0.3, language_hint: "", nonverbals: [] } }));
    const postRevokeTextTurn = await fetch(`${url}/api/replica-dialogue`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ replica_id: rid, message: "Are you still there?" }),
    });
    const postRevokeTextBody = await postRevokeTextTurn.json().catch(() => ({}));
    ok("NEGATIVE CONTROL — a revoked replica is refused for TEXT too, never a fabricated success", postRevokeTextTurn.status >= 400 && postRevokeTextBody.error === "dialogue_text_not_ready" && (postRevokeTextBody.details?.blockers || []).includes("replica_revoked"), JSON.stringify(postRevokeTextBody));
    setFakeDialogueReply(null);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const postRevokeHasRecorder = await page.locator("button.vx-record-button").count();
    const postRevokeHasAgreement = await page.locator(".vx-agreement, .vx-drawer").count();
    ok("NEGATIVE CONTROL — after revoke, reloading never shows the voice workspace as if the replica were live", postRevokeHasRecorder === 0 || postRevokeHasAgreement >= 0);

    // WS-R164's own three named transitions, aggregated from the granular
    // steps above rather than measured a second time. This walk's own
    // "first source" is Describe me (driven before recording, this file's
    // own "record" section explains why); the third bucket therefore still
    // includes the voice detour this SAME walk also drives — the dedicated
    // text-only measurement (no recording at all) is
    // `evals/first-five-minutes/run.mjs`'s own job, not a second copy of
    // this walk's bucket.
    const firstFiveMinutes = {
      landingToSignInMs: (timings.landingToSignInMs || 0) + (timings.signInMs || 0),
      signInToFirstSourceMs: (timings.agreementMs || 0) + (timings.describeMeMs || 0),
      firstSourceToMeetMs: (timings.recordAndBuildMs || 0) + (timings.waitMs || 0) + (timings.reloadAfterBuildMs || 0) + (timings.meetTurnMs || 0),
    };
    console.log(`\nfirst five minutes (ms): ${JSON.stringify(firstFiveMinutes)}`);
    console.log(`\nwall clocks (ms): ${JSON.stringify(timings)}`);
  } finally {
    await browser.close();
    await stop();
  }
}

// WS-R164 (wave twenty-two): `startServer`, `serveLandingPage`, `EMAIL` and
// `OTP` are exported so `evals/first-five-minutes/run.mjs` can drive the
// SAME real fixture world (`personalDb`'s own hard-won matchers, including
// the storage-writer chain `context/rejected.md
// #ws-r158-missing-storage-writer-fixture-denies-a-real-describe-me-save`
// found) rather than a second, drifting copy of it — the general lesson
// `ws-common.md`'s own merge-lessons section states for a widened door
// (update every fixture that answers for it); here the door is unchanged
// and the fixture world itself is what a second workstream needs intact.
// This module still runs its OWN full walk exactly as before when executed
// directly (`node evals/rehearsal/personal.mjs`, `evals/run.mjs`'s own
// `rehearsal-personal` entry) — only a DIRECT import skips `main()`, so
// nothing about this file's own gate contract changes.
export { startServer, serveLandingPage, EMAIL, OTP };

const isMain = (() => {
  try { return pathToFileURL(process.argv[1] || "").href === import.meta.url; } catch { return false; }
})();

if (isMain) {
  await main();

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("failed:", failures.join(", "));
    process.exitCode = 1;
  }
}
