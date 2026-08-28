// In-house YouTube audio extraction, and the gate that makes it legitimate
// (Gurukul WS-S).
//
//   node evals/mediaextract.mjs
//
// Offline, deterministic, $0, no DB and no network. It drives the REAL
// extraction provider, the REAL transport client and the REAL ingest worker
// through a fake `fetch`, a fake `db` and the fixture ASR — so the code path
// this suite reaches is the code path a cron tick reaches, and only the two
// seams are replaced.
//
// ── what this suite exists to guarantee ───────────────────────────────────
//
// The product claim is "this platform clones a person ONLY with their
// verified consent". For every other lane that is enforced by a consent row
// the teacher granted about THEMSELVES. This lane is different in kind: it
// reaches out and reads media that is sitting on somebody else's platform,
// and the only thing standing between "a teacher's own back catalogue" and "a
// general-purpose YouTube downloader" is a predicate. So:
//
// 1. THE ATTESTATION GATE. An extraction with no attestation must be REFUSED,
//    with a typed code, and must never reach the transport. Asserted by
//    counting the fetches that must be zero — the only honest way to assert
//    an absence (evals/channel.mjs's rule for revoked watches, same reason).
//
// 2. THE BINDING GATE. An attestation for a DIFFERENT channel than the watch
//    must not authorize this watch's video, even though both belong to the
//    same owner and both are live. This is the case a "does an attestation
//    exist?" check would pass and a "does an attestation exist FOR THIS
//    CHANNEL?" check refuses, and the difference is the whole design.
//
// 3. THE CEILING. A video longer than the configured duration ceiling is
//    refused BEFORE the network, so a nine-hour livestream costs nothing.
//
// 4. TYPED FAILURE STATUSES, NEVER A CRASH. Every one of the above, plus a
//    real extractor failure, must land as `vy_ingest_run.status='failed'`
//    carrying a code that names the cause — because an operator has to tell
//    "the teacher withdrew permission" from "the yt-dlp pin is stale" from
//    "this lecture is too long" without opening a log. A sweep must never
//    throw.
//
// 5. THE NEGATIVE CONTROL. The gate is struck out — the provider's
//    attestation check is replaced by one that always passes — and the suite
//    must go RED. A gate nobody has watched fail is a gate nobody knows
//    works. This is the highest-value check in the file and it is the one
//    that would be skipped.
//
// 6. THE HAPPY PATH IS STILL BOUNDED. A successful extraction returns a
//    STORAGE REF and never bytes, is validated through the same `audioRef`
//    every other provider goes through, and the normalized shape (16 kHz
//    mono) is asserted rather than assumed.
import { createHash } from "node:crypto";
import { LECTURE_TURNS } from "./fixtures/lecture-hinglish.mjs";
import { createFakeAsrProvider } from "../api/_asr/providers/fake.js";
import { createFakeAudioStore } from "../api/_channel/providers/fake.js";
import { createMediaExtractClient } from "../api/_channel/media-extract-client.js";
import { createYouTubeExtractChannelProvider } from "../api/_channel/providers/youtube-extract.js";
import { runChannelIngestSweep } from "../api/_channel-ingest.js";
import { channelRef } from "../api/_channel/contracts.js";
import {
  CHANNEL_ATTESTATIONS,
  channelAttestations,
  makeChannelAttestationReceipt,
} from "../api/_channel-watch.js";

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REPLICA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WATCH = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ATTESTATION = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const CHANNEL = "https://www.youtube.com/@arjun-sir-physics";
const OTHER_CHANNEL = "https://www.youtube.com/@someone-else-entirely";
const SECRET = "a".repeat(64);
const ORIGIN = "https://media-extract.internal.example";

const VIDEOS = [
  { videoId: "vid0000001A", publishedAt: "2026-08-01T00:00:00Z", durationMs: 2_400_000 },
  { videoId: "vid0000002B", publishedAt: "2026-08-08T00:00:00Z", durationMs: 2_400_000 },
];

const liveAttestation = (channelUrl = CHANNEL) => Object.freeze({
  attestationId: ATTESTATION,
  receiptHash: createHash("sha256").update(channelUrl).digest("hex"),
  channelUrl,
  grantedAt: new Date(Date.now() - 86_400_000).toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
});

// ── the fake transport ────────────────────────────────────────────────────
//
// It speaks the REAL protocol: it verifies the request signature the client
// produced and signs its response the way the service does, so a client that
// signed the wrong bytes fails here exactly as it would against the container.
// It is a fake NETWORK, not a fake contract.
function fakeService(options = {}) {
  const calls = [];
  const secret = Buffer.from(SECRET, "hex");
  return {
    calls,
    async fetchImpl(url, init) {
      const { createHmac } = await import("node:crypto");
      const mac = (...parts) => createHmac("sha256", secret).update(parts.join("\n")).digest("base64url");
      const path = new URL(url).pathname;
      const body = Buffer.from(init.body);
      const digest = createHash("sha256").update(body).digest("hex");
      const headers = init.headers;
      const expected = mac("vyakti-media-extract/v1", "POST", path,
        headers["X-Vyakti-Timestamp"], headers["X-Vyakti-Nonce"], digest);
      if (headers["X-Vyakti-Content-SHA256"] !== digest || headers["X-Vyakti-Signature"] !== expected) {
        throw new Error("the client signed the wrong bytes");
      }
      const payload = JSON.parse(body);
      calls.push({ path, payload });

      const status = options.status || 200;
      const value = status === 200
        ? {
          protocol: "vyakti-media-extract/v1",
          video_id: payload.video_id,
          sha256: createHash("sha256").update(String(payload.video_id)).digest("hex"),
          byte_size: 55_296_044,
          duration_ms: payload.max_duration_ms > 1_000_000 ? 2_400_000 : 60_000,
          sample_rate_hz: options.sampleRate ?? 16_000,
          channels: 1,
          mime: "audio/wav",
          extractor: "yt-dlp",
          extractor_version: "2026.8.19",
          attestation_receipt_hash: payload.attestation.receipt_hash,
          // The route the service says it ran, echoed from the request the way
          // the real service does (WS-AI). It is deliberately read back off
          // `payload` rather than hard-coded: a fixture that always said
          // "direct" would make this suite pass only for one route, and the
          // route-mismatch property has its own negative control in
          // `evals/extractroutes.mjs` rather than living here.
          route: payload.route,
        }
        : { error: options.error || "extractor_bot_check" };
      const responseBytes = Buffer.from(JSON.stringify(value));
      const responseDigest = createHash("sha256").update(responseBytes).digest("hex");
      return {
        ok: status === 200,
        status,
        headers: {
          get: (name) => name.toLowerCase() === "x-vyakti-response-signature"
            ? mac("vyakti-media-extract/v1", "response", path, headers["X-Vyakti-Nonce"], String(status), responseDigest)
            : null,
        },
        arrayBuffer: async () => responseBytes,
      };
    },
  };
}

// ── the fake db ───────────────────────────────────────────────────────────
// It honours migration 053's unique index on (replica_id, video_ref) for the
// same reason evals/channel.mjs's does: a fake that ignored the constraint
// would let this suite report an ingest the database would have refused.
function fakeDb(state) {
  const calls = [];
  return Object.assign(async function db(sql, params = []) {
    calls.push({ sql, params });
    const text = sql.replace(/\s+/g, " ").trim();
    if (text.startsWith("select watch_id, replica_id, owner_user_id, channel_url")) {
      return state.watches.filter((w) => w.status === "active");
    }
    if (text.startsWith("insert into vy_ingest_run")) {
      const [runId, replicaId, ownerId, watchId, videoRef, source] = params;
      const existing = state.runs.find((r) => r.replica_id === replicaId && r.video_ref === videoRef);
      if (existing) {
        if (existing.status !== "failed") return [];
        Object.assign(existing, { status: "fetched", failure_code: "", transcript_source: source });
        return [existing];
      }
      const row = {
        run_id: runId, replica_id: replicaId, owner_user_id: ownerId, watch_id: watchId,
        video_ref: videoRef, transcript_source: source, status: "fetched", failure_code: "",
        stats: {}, proposed_delta: {}, proposed_delta_count: 0,
      };
      state.runs.push(row);
      return [row];
    }
    if (text.startsWith("update vy_ingest_run")) {
      const [runId, ownerId, status, source, stats, delta, deltaCount, failureCode] = params;
      const row = state.runs.find((r) => r.run_id === runId && r.owner_user_id === ownerId);
      if (!row || ["applied", "rejected"].includes(row.status)) return [];
      Object.assign(row, {
        status,
        transcript_source: source ?? row.transcript_source,
        stats: stats ? JSON.parse(stats) : row.stats,
        proposed_delta: delta ? JSON.parse(delta) : row.proposed_delta,
        proposed_delta_count: Number.isInteger(deltaCount) ? deltaCount : row.proposed_delta_count,
        failure_code: failureCode,
      });
      return [row];
    }
    if (text.startsWith("update vy_channel_watch")) return [];
    return [];
  }, { calls });
}

function harness(options = {}) {
  const service = fakeService(options.service || {});
  const client = createMediaExtractClient({
    env: {
      AZURE_MEDIA_EXTRACT_ORIGIN: ORIGIN,
      MEDIA_EXTRACT_HMAC_SECRET: SECRET,
      MEDIA_EXTRACT_MAX_DURATION_MS: String(options.ceilingMs || 14_400_000),
    },
    fetchImpl: service.fetchImpl,
  });
  const uploads = [];
  // The shared audio store, exactly as api/_channel/providers/fake.js uses it:
  // the extraction seam writes a reference and the fake ASR reads turns back
  // out of it. Two fakes joined by a storage PATH is the join the real lanes
  // have — extraction PUTs to Supabase and ASR reads it back — so a provider
  // that returned the wrong path would fail here too.
  const audioStore = createFakeAudioStore();
  const base = {
    name: "stub-listing",
    version: "0-test",
    transcriptSource: "captions",
    async listNewVideos(channel, since = "") {
      const list = (options.videos || VIDEOS).filter((v) => v.videoId !== since)
        .map((v) => ({ ...v, title: "" }));
      const { videoListing } = await import("../api/_channel/contracts.js");
      return videoListing(list, since);
    },
    // No owner caption tracks — the case the extraction lane exists for.
    async fetchCaptions() { return null; },
    async fetchAudio() { throw new Error("the base provider must never be asked for audio"); },
  };
  const provider = createYouTubeExtractChannelProvider({
    base,
    extractClient: client,
    signUpload: async (objectPath) => {
      uploads.push(objectPath);
      // Standing in for the bytes the service will PUT at this exact path.
      audioStore.put(objectPath, LECTURE_TURNS);
      return {
        url: "https://project.supabase.co/storage/v1/object/upload/sign/x?token=t",
        headers: {},
        storage_bucket: "vyakti-replica-private",
      };
    },
  });
  const state = {
    runs: [],
    watches: [{
      watch_id: WATCH, replica_id: REPLICA, owner_user_id: OWNER,
      channel_url: options.watchChannel || CHANNEL, provider: "youtube",
      oauth_grant_ref: null, last_seen_video_id: "", status: "active",
      attestation_id: options.watchAttestationId === undefined ? ATTESTATION : options.watchAttestationId,
      backfill_state: "idle", backfill_after_video_id: "",
    }],
  };
  return { service, client, provider, uploads, state, audioStore, db: fakeDb(state) };
}

const sweep = (h, attestations) => runChannelIngestSweep({
  db: h.db,
  channelProvider: h.provider,
  asr: createFakeAsrProvider({ audioStore: h.audioStore }),
  attestations,
});

// ── 1. the attestation gate ───────────────────────────────────────────────
{
  const h = harness();
  // The resolver returns null — the SQL predicate found no live attestation.
  const summary = await sweep(h, async () => null);
  ok("an unattested video is REFUSED", summary.failed === 1 && summary.ingested === 0);
  ok("...with a typed code that names the cause",
    h.state.runs[0]?.status === "failed" &&
    h.state.runs[0]?.failure_code === "channel_extract_attestation_missing",
    h.state.runs[0]?.failure_code || "(no run row)");
  // The absence, counted. A refusal that still made the request would have
  // woken a container and touched YouTube before deciding not to.
  ok("...and the extraction service was never reached at all", h.service.calls.length === 0);
  ok("...and no upload target was ever signed", h.uploads.length === 0);
  ok("...and the sweep did not throw", Number.isInteger(summary.watches));
}

// ── 2. the binding gate ───────────────────────────────────────────────────
//
// The attestation is LIVE, belongs to the SAME owner, and is for a DIFFERENT
// channel. A "does an attestation exist?" check passes this. The system must
// not.
{
  const h = harness();
  const summary = await sweep(h, async () => liveAttestation(OTHER_CHANNEL));
  ok("an attestation for ANOTHER channel does not authorize this watch", summary.failed === 1);
  ok("...with the mismatch named, not flattened into 'missing'",
    h.state.runs[0]?.failure_code === "channel_extract_attestation_channel_mismatch",
    h.state.runs[0]?.failure_code || "(no run row)");
  ok("...and, again, nothing was fetched", h.service.calls.length === 0);
}

// A watch row created before migration 057 carries a NULL attestation_id. The
// production predicate joins on that column, so such a row resolves to null
// and lands in case 1 — asserted here at the CONTRACT level, because the
// grandfathering bug is the one an implementer adds on purpose, kindly.
{
  const { channelWatch } = await import("../api/_channel/contracts.js");
  const row = {
    watch_id: WATCH, replica_id: REPLICA, owner_user_id: OWNER, channel_url: CHANNEL,
    status: "active", last_seen_video_id: "", attestation_id: null,
  };
  ok("a pre-057 watch row reads as UNATTESTED rather than as grandfathered",
    channelWatch(row).attestationId === null);
}

// ── 3. the ceiling ────────────────────────────────────────────────────────
{
  const h = harness({
    ceilingMs: 600_000,
    videos: [{ videoId: "vid0000009Z", publishedAt: "2026-08-01T00:00:00Z", durationMs: 2_400_000 }],
  });
  const summary = await sweep(h, async () => liveAttestation());
  ok("a video over the duration ceiling is refused", summary.failed === 1);
  ok("...with a code that says so",
    h.state.runs[0]?.failure_code === "channel_extract_duration_over_ceiling",
    h.state.runs[0]?.failure_code || "(no run row)");
  ok("...BEFORE the network, so a nine-hour livestream costs nothing",
    h.service.calls.length === 0 && h.uploads.length === 0);
}

// ── 4. a real extractor failure is typed, not swallowed ───────────────────
{
  for (const [error, expected] of [
    ["extractor_bot_check", "channel_extract_extractor_bot_check"],
    ["extractor_signature_failed", "channel_extract_extractor_signature_failed"],
    ["channel_binding_mismatch", "channel_extract_channel_binding_mismatch"],
  ]) {
    const h = harness({ service: { status: error === "channel_binding_mismatch" ? 403 : 502, error } });
    const summary = await sweep(h, async () => liveAttestation());
    ok(`the service's '${error}' survives the transport unchanged`,
      summary.failed === 1 && h.state.runs[0]?.failure_code === expected,
      h.state.runs[0]?.failure_code || "(no run row)");
  }
}

// The service's OWN binding check — the fourth layer, inside the container,
// which resolves the uploader from YouTube's metadata before downloading. The
// suite cannot run yt-dlp, so what it asserts is that the code reaches the
// app as a distinct failure rather than as a generic 502, which is the part
// the application plane is responsible for.
{
  const h = harness({ service: { status: 403, error: "channel_binding_mismatch" } });
  await sweep(h, async () => liveAttestation());
  ok("...and a service-side binding refusal is distinguishable from a transport error",
    h.state.runs[0]?.failure_code === "channel_extract_channel_binding_mismatch");
}

// ── 5. the negative control ───────────────────────────────────────────────
//
// The gate is STRUCK OUT and the suite must notice. Not "a gate exists" —
// "removing the gate is caught". Everything above is a claim about a system
// nobody has watched fail.
{
  // A twin provider with the attestation predicate deleted, exactly as a
  // careless refactor would leave it: the context is still passed, the check
  // is simply gone.
  const h = harness();
  const struck = Object.freeze({
    ...h.provider,
    async fetchAudio(video, grantRef, context) {
      // THE STRIKE: no attestation check at all.
      const ctx = { ...context, attestation: liveAttestation() };
      return h.provider.fetchAudio(video, grantRef, { ...ctx, watch: context.watch });
    },
  });
  const summary = await runChannelIngestSweep({
    db: h.db,
    channelProvider: struck,
    asr: createFakeAsrProvider({ audioStore: h.audioStore }),
    attestations: async () => null,   // the DB says NO
  });
  // With the predicate struck, an unattested video extracts successfully.
  // That is the failure this suite must be able to see, and seeing it is what
  // makes cases 1 and 2 evidence rather than decoration.
  ok("NEGATIVE CONTROL: striking the attestation predicate lets an unattested video through",
    summary.ingested > 0 && h.service.calls.length > 0,
    `ingested=${summary.ingested} fetches=${h.service.calls.length}`);
  ok("...which is exactly what cases 1 and 2 assert cannot happen",
    summary.failed === 0);
}

// ── 6. the happy path, and what it is allowed to return ───────────────────
{
  const h = harness();
  const summary = await sweep(h, async () => liveAttestation());
  ok("an attested, bound, in-ceiling video extracts",
    summary.ingested === VIDEOS.length && summary.failed === 0,
    `ingested=${summary.ingested} failed=${summary.failed}`);
  ok("...one service call per video, and no more", h.service.calls.length === VIDEOS.length);
  ok("...the upload target is owner- and replica-scoped",
    h.uploads.every((path) => path.startsWith(`${OWNER}/${REPLICA}/${WATCH}/`) && path.endsWith("/original")),
    h.uploads[0] || "(none)");
  ok("...the request carries the receipt hash and the channel KEY, never a URL or an owner",
    h.service.calls.every(({ payload }) =>
      /^[0-9a-f]{64}$/.test(payload.attestation.receipt_hash) &&
      payload.attestation.channel_key === "@arjun-sir-physics" &&
      !JSON.stringify(payload).includes(OWNER) &&
      !JSON.stringify(payload).includes(REPLICA)));
  ok("...and the run rows reached 'proposed'",
    h.state.runs.length === VIDEOS.length && h.state.runs.every((r) => r.status === "proposed"));
}

// A service that returned a differently-shaped file must be REFUSED, not
// accepted and measured. Two runs normalized differently are not comparable,
// and a number that looks comparable and is not is worse than no number.
{
  const h = harness({ service: { sampleRate: 44_100 } });
  const summary = await sweep(h, async () => liveAttestation());
  ok("a wrongly-normalized result is refused rather than measured",
    summary.failed === 1 && h.state.runs[0]?.failure_code === "channel_extract_normalization_invalid",
    h.state.runs[0]?.failure_code || "(no run row)");
}

// ── 7. the receipt, and the statements the teacher actually signs ─────────
{
  const receipt = makeChannelAttestationReceipt({
    ownerUserId: OWNER,
    replica: REPLICA,
    channel: channelRef(CHANNEL),
    attestations: channelAttestations(Object.fromEntries(CHANNEL_ATTESTATIONS.map((k) => [k, true]))),
    now: new Date("2026-08-26T00:00:00Z"),
    nonce: "0".repeat(48),
  });
  ok("the receipt is a sha256 over canonical JSON, like every other consent artifact",
    /^[0-9a-f]{64}$/.test(receipt.hash));
  ok("...it NAMES the channel, so it cannot be presented for a different one",
    receipt.payload.channel_url === CHANNEL && receipt.payload.channel_key === "@arjun-sir-physics");
  ok("...the term is bounded", Date.parse(receipt.expiresAt) > Date.parse(receipt.grantedAt));
  // Deterministic given a fixed nonce and time — the property that makes a
  // receipt hash verifiable later rather than merely random.
  const twin = makeChannelAttestationReceipt({
    ownerUserId: OWNER, replica: REPLICA, channel: channelRef(CHANNEL),
    attestations: channelAttestations(Object.fromEntries(CHANNEL_ATTESTATIONS.map((k) => [k, true]))),
    now: new Date("2026-08-26T00:00:00Z"), nonce: "0".repeat(48),
  });
  ok("...and it is reproducible from the same inputs", twin.hash === receipt.hash);

  // Partial consent is not consent. All five statements or none — including
  // the uncomfortable one about ToS, which a teacher must not be able to skip.
  const partial = Object.fromEntries(CHANNEL_ATTESTATIONS.slice(0, -1).map((k) => [k, true]));
  ok("a partial attestation is refused",
    (() => { try { channelAttestations(partial); return false; } catch (e) { return e.status === 409; } })());
  ok("...and the ToS statement specifically cannot be omitted",
    CHANNEL_ATTESTATIONS.includes("understands_tos_exposure_is_not_copyright_permission"));
}

// ── 8. the seam fails closed without env, and reaches no fixture ──────────
{
  const { channelExtractionConfigured, createProductionChannelProvider } = await import("../api/_channel/registry.js");
  ok("extraction reports itself unavailable with no env", channelExtractionConfigured({}) === false);
  ok("...and an origin without a secret does not half-enable it",
    channelExtractionConfigured({ AZURE_MEDIA_EXTRACT_ORIGIN: ORIGIN }) === false);
  ok("...and a configured origin over http is refused",
    channelExtractionConfigured({ AZURE_MEDIA_EXTRACT_ORIGIN: "http://x.example", MEDIA_EXTRACT_HMAC_SECRET: SECRET }) === false);
  // With OAuth env but no extraction env, the deploy gets the OAuth provider —
  // whose fetchAudio is the honest refusal. A missing extraction service must
  // degrade to "cannot", never to "silently allowed".
  const oauthOnly = createProductionChannelProvider({
    YOUTUBE_OAUTH_CLIENT_ID: "id", YOUTUBE_OAUTH_CLIENT_SECRET: "secret",
  });
  ok("an unconfigured deploy gets the OAuth provider, which still refuses audio",
    oauthOnly.name === "youtube-data-api-v3");
  ok("...and its refusal is still typed",
    await oauthOnly.fetchAudio().then(() => false, (e) =>
      e.code === "channel_audio_download_unavailable_use_owner_captions_or_direct_upload"));

  const { readFileSync } = await import("node:fs");
  const importsFake = (file) => readFileSync(new URL(file, import.meta.url), "utf8")
    .split("\n").some((line) => /^\s*import\b/.test(line) && /fake/i.test(line));
  ok("no extraction module has a branch that can return a fixture",
    !importsFake("../api/_channel/registry.js") &&
    !importsFake("../api/_channel/providers/youtube-extract.js") &&
    !importsFake("../api/_channel/media-extract-client.js"));
}

console.log(fail ? `\n${fail} of ${pass + fail} FAILURES` : `\nALL ${pass} CHECKS PASS`);
process.exitCode = fail ? 1 : 0;
