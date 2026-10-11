// The channel seam's contract — what a channel provider is allowed to hand
// back, and the shape everything downstream may assume (Gurukul WS-I).
//
// SPEC-GURUKUL.md §8 item 3: "Channel link → new-video detection →
// re-ingestion → PROPOSED claims/sheet deltas the expert approves". This file
// is the first arrow. It defines two operations and nothing else:
//
//   listNewVideos(channel, sinceVideoId) -> readonly VideoRef[]  (oldest-first)
//   fetchAudio(videoRef)                 -> AudioRef             (a storage ref)
//
// and a provider MAY additionally offer:
//
//   fetchCaptions(videoRef)              -> CaptionTrack | null
//
// ── why fetchCaptions is optional and fetchAudio may legally refuse ───────
// docs/gurukul/ingestion-research.md §3 is unambiguous and it constrains the
// interface rather than just the implementation: "YouTube Data API v3 does
// not provide a general video/audio download endpoint." It exposes metadata
// and `captions.download`, and that method works only for the OWNER's
// manually-uploaded caption tracks. The lawful paths are (i) OAuth acting as
// the owner or (ii) the teacher direct-uploading the file; yt-dlp-style
// scraping is a ToS exposure the research explicitly recommends against as a
// default at multi-teacher scale.
//
// So `fetchAudio` is part of the contract because the UPLOAD lane and the
// fake both satisfy it — and `api/_channel/providers/youtube-oauth.js`'s
// implementation of it fails closed with a code that names the two lawful
// alternatives. That is a provider honestly declining a capability it does
// not lawfully have, which is a different thing from the seam not having the
// capability, and the difference is visible at the call site.
//
// ── nothing here reaches the network ─────────────────────────────────────
// Same split as api/_claim-extraction/contracts.js: validation and value
// construction live here, transport lives in providers/, selection lives in
// registry.js. The worker imports this file and never a provider directly,
// which is what lets evals/channel.mjs drive the real worker with a fake
// channel and no env at all.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

/** YouTube video ids are 11 chars of the URL-safe base64 alphabet. Bounded
 *  here rather than "any string" because this value ends up in a WHERE
 *  clause, a storage path and a cursor comparison, and an unbounded id makes
 *  all three unbounded. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Channel handles (`@name`), legacy ids (`UC…`) and `/c/` vanity paths are
 *  all still live on YouTube in 2026, so all three are accepted — and nothing
 *  else, because the fourth thing a paste box receives is a watch URL for one
 *  video, which is not a channel and must not be silently treated as one. */
const CHANNEL_PATHS = [
  /^\/channel\/(UC[A-Za-z0-9_-]{22})$/,
  /^\/(@[A-Za-z0-9._-]{3,30})$/,
  /^\/c\/([A-Za-z0-9._-]{1,64})$/,
  /^\/user\/([A-Za-z0-9._-]{1,64})$/,
];

export const CHANNEL_SCHEMA = "gurukul.channel.v1";

/** The audio a provider may hand to ASR. Deliberately narrow: these are the
 *  container types api/_replica-source.js already admits for `audio`, so a
 *  file that arrives through this lane and a file a teacher uploads through
 *  the studio are the same set of things. */
export const CHANNEL_AUDIO_MIMES = Object.freeze(new Set([
  "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/webm", "audio/ogg", "audio/flac",
]));

/** One sweep must not be able to spend an unbounded amount of ASR money on
 *  one channel that uploaded 400 videos while we were not looking. The
 *  remainder is not lost — the cursor advances to the last SUCCESS, so the
 *  next sweep resumes exactly where this one stopped. */
export const MAX_VIDEOS_PER_LISTING = 25;

export class ChannelError extends Error {
  constructor(code, status = 502, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

function fail(code, status = 502, details) {
  throw new ChannelError(code, status, details);
}

function clean(value, max = 200) {
  return Array.from(String(value ?? ""))
    .filter((character) => {
      const code = character.codePointAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Parses a pasted channel link into the thing a provider can actually query.
 *  Rejects rather than guesses: a watch URL, a playlist URL, a shortened link
 *  and a bare search string all end up here and none of them is a channel. */
export function channelRef(value) {
  let url;
  try { url = new URL(String(value || "").trim()); }
  catch { fail("channel_url_invalid", 400); }
  if (url.protocol !== "https:") fail("channel_url_invalid", 400);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "youtube.com" && host !== "m.youtube.com") fail("channel_url_not_youtube", 400);
  for (const pattern of CHANNEL_PATHS) {
    const matched = pattern.exec(url.pathname.replace(/\/+$/, ""));
    if (matched) {
      return Object.freeze({
        provider: "youtube",
        url: `https://www.youtube.com${url.pathname.replace(/\/+$/, "")}`,
        kind: matched[1].startsWith("UC") && url.pathname.startsWith("/channel/") ? "channel_id" : "handle",
        key: matched[1],
      });
    }
  }
  return fail("channel_url_not_a_channel", 400);
}

/** The watch row, validated once at the top of the worker so every statement
 *  after it can assume its shape. `oauth_grant_ref` is asserted to be a uuid
 *  here as well as in the column type — migration 053's reason, restated at
 *  the only other place a value could enter: a reference, never a token. */
export function channelWatch(row) {
  const status = String(row?.status || "");
  if (!new Set(["active", "paused", "revoked"]).has(status)) fail("channel_watch_status_invalid", 409);
  if (!UUID.test(String(row?.watch_id || "")) || !UUID.test(String(row?.replica_id || "")) ||
      !UUID.test(String(row?.owner_user_id || ""))) fail("channel_watch_identity_invalid", 409);
  const grant = row?.oauth_grant_ref == null ? null : String(row.oauth_grant_ref);
  if (grant !== null && !UUID.test(grant)) fail("channel_watch_grant_ref_invalid", 409);
  // Migration 057. `attestationId` is validated to uuid-or-null for the same
  // reason `oauth_grant_ref` is: it is the reference the extraction gate
  // joins on, and a reference that could be an arbitrary string is a
  // reference a future writer can put a channel URL in.
  const attestation = row?.attestation_id == null ? null : String(row.attestation_id);
  if (attestation !== null && !UUID.test(attestation)) fail("channel_watch_attestation_ref_invalid", 409);
  const backfillState = String(row?.backfill_state || "idle");
  if (!new Set(["idle", "running", "done"]).has(backfillState)) fail("channel_watch_backfill_state_invalid", 409);
  return Object.freeze({
    watchId: String(row.watch_id).toLowerCase(),
    replicaId: String(row.replica_id).toLowerCase(),
    ownerUserId: String(row.owner_user_id).toLowerCase(),
    channel: channelRef(row.channel_url),
    provider: String(row.provider || "youtube"),
    oauthGrantRef: grant ? grant.toLowerCase() : null,
    lastSeenVideoId: String(row.last_seen_video_id || ""),
    // NULL means "created before attestations existed", which every gate
    // treats as UNATTESTED. Failing closed rather than grandfathering.
    attestationId: attestation ? attestation.toLowerCase() : null,
    backfillState,
    backfillAfterVideoId: String(row?.backfill_after_video_id || ""),
    status,
  });
}

/** One video, as a provider reports it. `publishedAt` is required because the
 *  listing's ORDER is load-bearing — the cursor advances to the last success,
 *  so an unordered listing would strand every video before the failure. */
export function videoRef(value) {
  const id = String(value?.videoId ?? value?.video_id ?? "");
  if (!VIDEO_ID.test(id)) fail("channel_video_id_invalid");
  const publishedAt = Date.parse(String(value?.publishedAt ?? value?.published_at ?? ""));
  if (!Number.isFinite(publishedAt)) fail("channel_video_published_at_invalid");
  const durationMs = Number(value?.durationMs ?? value?.duration_ms ?? 0);
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 6 * 60 * 60 * 1000) {
    fail("channel_video_duration_invalid");
  }
  return Object.freeze({
    videoId: id,
    // Titles are DISPLAY-ONLY and are never fed to the persona: a channel
    // title is text a third party controls, and `api/_claim-extraction`'s
    // cleaner exists because that is the definition of untrusted input.
    title: clean(value?.title, 200),
    publishedAt: new Date(publishedAt).toISOString(),
    durationMs: Math.round(durationMs),
  });
}

/** A provider's listing, validated as a whole: oldest-first, deduplicated,
 *  bounded, and never containing the cursor itself. That last rule is where
 *  double-ingestion would otherwise start — a provider that includes
 *  `sinceVideoId` in its own answer is a common off-by-one, and it must be
 *  caught HERE rather than by the unique index, because reaching the unique
 *  index means an ASR bill was already paid. */
export function videoListing(values, sinceVideoId = "") {
  const list = Array.isArray(values) ? values : fail("channel_listing_invalid");
  const since = String(sinceVideoId || "");
  const seen = new Set();
  const out = [];
  for (const value of list) {
    const video = videoRef(value);
    if (video.videoId === since) fail("channel_listing_includes_cursor");
    if (seen.has(video.videoId)) fail("channel_listing_duplicate", 502, { videoId: video.videoId });
    seen.add(video.videoId);
    out.push(video);
  }
  for (let i = 1; i < out.length; i++) {
    if (Date.parse(out[i].publishedAt) < Date.parse(out[i - 1].publishedAt)) fail("channel_listing_unordered");
  }
  if (out.length > MAX_VIDEOS_PER_LISTING) fail("channel_listing_too_large", 502, { count: out.length });
  return Object.freeze(out);
}

/** What `fetchAudio` returns: a REFERENCE, never bytes. The bytes belong in
 *  the replica's private storage under api/_replica-storage.js's rules, and a
 *  contract that returned a Buffer would put an hour of a real teacher's
 *  audio in a worker's heap and, on the next careless edit, in a log line. */
export function audioRef(value) {
  const storageBucket = clean(value?.storageBucket ?? value?.storage_bucket, 192);
  const plainBucket = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(storageBucket);
  const azureBucket = /^azureblob:[a-z0-9]{3,24}:[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(storageBucket);
  if (!plainBucket && !azureBucket) fail("channel_audio_bucket_invalid");
  const storagePath = clean(value?.storagePath ?? value?.storage_path, 512);
  if (!storagePath || storagePath.includes("://") || storagePath.startsWith("/")) fail("channel_audio_path_invalid");
  const sha256 = String(value?.sha256 || "").toLowerCase();
  if (!SHA256.test(sha256)) fail("channel_audio_sha256_invalid");
  const mime = String(value?.mime || "").split(";", 1)[0].trim().toLowerCase();
  if (!CHANNEL_AUDIO_MIMES.has(mime)) fail("channel_audio_mime_invalid");
  const byteSize = Number(value?.byteSize ?? value?.byte_size);
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > 268_435_456) fail("channel_audio_size_invalid");
  const durationMs = Number(value?.durationMs ?? value?.duration_ms ?? 0);
  if (!Number.isFinite(durationMs) || durationMs < 0) fail("channel_audio_duration_invalid");
  // WHICH EGRESS SERVED THESE BYTES. Optional, because the upload lane and the
  // fake store have no route and inventing one for them would be a fabricated
  // provenance field. Present, it must be a route name this build knows: an
  // unrecognized string here is a service speaking a protocol we do not, and
  // a row stamped with it would be unreadable a month from now.
  const extractionRoute = clean(value?.extractionRoute ?? value?.extraction_route, 32);
  if (extractionRoute && !EXTRACTION_ROUTES.has(extractionRoute)) fail("channel_audio_route_invalid");
  return Object.freeze({
    storageBucket, storagePath, sha256, mime, byteSize,
    durationMs: Math.round(durationMs),
    extractionRoute,
  });
}

/** Kept as a literal set rather than imported from `extract-routes.js` so this
 *  contracts module stays dependency-free, which is what lets every provider
 *  and every eval import it without dragging config-reading code along.
 *  `evals/extractroutes.mjs` asserts the two lists have not drifted apart. */
const EXTRACTION_ROUTES = new Set(["proxy", "provider", "cookies", "pot", "direct"]);

/** An owner-uploaded caption track, when a provider can lawfully reach one.
 *  `turns` is the SAME shape ASR returns, so the worker has one downstream
 *  path and `transcript_source` is the only thing that differs. */
export function captionTrack(value) {
  if (value == null) return null;
  const turns = Array.isArray(value?.turns) ? value.turns : fail("channel_captions_invalid");
  if (!turns.length) return null;
  return Object.freeze({
    language: clean(value?.language, 32) || "hi-IN",
    trackKind: clean(value?.trackKind ?? value?.track_kind, 32) || "standard",
    turns: Object.freeze(turns.map((turn) => Object.freeze({
      speaker: clean(turn?.speaker, 64) || "SPEAKER_00",
      text: clean(turn?.text, 4_000),
      t0: Number(turn?.t0) || 0,
      t1: Number(turn?.t1) || 0,
    }))),
  });
}

/** The seam's admission check. A provider missing an operation is a 503 with
 *  a code, not a TypeError at the call site three frames deeper. */
export function assertChannelProvider(provider) {
  if (!provider || typeof provider.listNewVideos !== "function" || typeof provider.fetchAudio !== "function" ||
      !provider.name || !provider.version) {
    fail("channel_provider_unavailable", 503);
  }
  return provider;
}
