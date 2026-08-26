// The channel provider that CAN fetch audio (Gurukul WS-S).
//
// `youtube-oauth.js` is not replaced and not edited into something else — it
// is DELEGATED TO. That file's listing and captions work, are quota-cheap,
// and are the path YouTube itself sanctions; the only thing it could not do
// was `fetchAudio`, and this file is a provider that composes the OAuth one
// with an extraction seam for exactly that operation.
//
// The ordering is the safety posture expressed as code, and it is the
// recommended default rather than a fallback:
//
//   1. `fetchCaptions` (delegated, OAuth, owner's own uploaded tracks) —
//      no download of media at all, sanctioned by the platform, free.
//   2. `fetchAudio` (this file) — extraction, gated on the attestation.
//
// `api/_channel-ingest.js`'s `transcriptFor` already tries captions first, so
// the safest lane that can produce a transcript is the one that runs, every
// time, with no flag. Extraction is reached only when the teacher has not
// uploaded caption tracks — which, for the Hinglish lecture corpus this
// product exists for, is nearly always, and that is precisely why it had to
// be built.
//
// ── THE GATE, and why it is not in this file alone ───────────────────────
// `fetchAudio` receives an attestation envelope in its context and refuses
// without one. That is layer three. Layers one and two are:
//
//   1. `api/_channel-watch.js`'s `attestationForWatch` — a SQL join on
//      attestation_id AND channel_url AND owner_user_id, with
//      `revoked_at is null and expires_at > now()`. Nothing reaches this file
//      unless that predicate matched.
//   2. `api/_channel-watch.js`'s `createChannelWatch` — a watch row cannot be
//      inserted at all without a live attestation, so there is nothing for
//      the sweep to select.
//
// and layer four is inside `services/media-extract`, which resolves the
// video's uploader from YouTube's own metadata before downloading a byte and
// refuses on `channel_binding_mismatch`.
//
// Four layers for one property, which is more than the house rule's two, and
// the reason is that the property is "this is not a general-purpose
// downloader". `gate0-structural` is the measurement that says a predicate
// beats an intention; four predicates say it four times.
import { audioRef, videoListing } from "../contracts.js";
import { createYouTubeOAuthChannelProvider } from "./youtube-oauth.js";

const NAME = "youtube-owner-extract";
const VERSION = "1";

function fail(code, status = 502, details) {
  throw Object.assign(new Error(code), { code, status, details });
}

/** The channel KEY, not the URL — `@handle` or `UC…`. It is what the service
 *  matches the video's own uploader against, and it is derived from the
 *  attested `channel_url` rather than from anything the caller passed, so a
 *  watch whose URL drifted from its attestation cannot smuggle a key. */
function keyFromUrl(url) {
  const path = String(url || "").replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "");
  const matched = /^\/channel\/(UC[A-Za-z0-9_-]{22})$/.exec(path) ||
    /^\/(@[A-Za-z0-9._-]{3,30})$/.exec(path) ||
    /^\/(?:c|user)\/([A-Za-z0-9._-]{1,64})$/.exec(path);
  if (!matched) fail("channel_extract_attestation_channel_invalid", 403);
  return matched[1];
}

/** Where the bytes land. Owner- and replica-scoped so a teacher's audio
 *  cannot be written under another teacher's prefix even if every other layer
 *  failed at once, and `/original` because that is the suffix
 *  `api/_replica-processing/storage.js` admits — an extracted lecture and an
 *  uploaded one are the same kind of object and are stored the same way. */
function objectPathFor(watch, video) {
  return `${watch.ownerUserId}/${watch.replicaId}/${watch.watchId}/${video.videoId}/original`;
}

/**
 * @param {object} options
 * @param {object} options.extractClient  `createMediaExtractClient()`'s value.
 * @param {(objectPath: string) => Promise<{url: string, headers?: object}>}
 *        options.signUpload  a pre-signed PUT target. The service never holds
 *        a storage credential; it is handed one URL, for one object, that
 *        expires. `api/_replica-storage.js`'s `createSignedReplicaUpload`.
 * @param {object} [options.base]  the delegate (defaults to the OAuth
 *        provider built from the same clientId/clientSecret).
 */
export function createYouTubeExtractChannelProvider(options = {}) {
  const extractClient = options.extractClient || fail("channel_provider_unavailable", 503);
  const signUpload = typeof options.signUpload === "function"
    ? options.signUpload
    : fail("channel_provider_unavailable", 503);
  const base = options.base || createYouTubeOAuthChannelProvider({
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    fetchImpl: options.fetchImpl,
    grantStore: options.grantStore,
  });

  return Object.freeze({
    name: NAME,
    version: VERSION,
    // Still `captions`: the SAFEST lane this provider can offer is what the
    // seam advertises, and `transcriptFor` honours it before ever calling
    // `fetchAudio`. A provider that advertised `asr` here would push every
    // video down the extraction path including the ones with owner captions.
    transcriptSource: "captions",

    listNewVideos: (...args) => base.listNewVideos(...args),
    fetchCaptions: (...args) => base.fetchCaptions(...args),

    /**
     * The operation `youtube-oauth.js` had to refuse.
     *
     * Fails closed, with a distinct typed code per cause, because
     * `api/_channel-ingest.js` writes whichever code arrives onto the
     * `vy_ingest_run` row and an operator has to be able to tell "the teacher
     * withdrew permission" from "the extractor pin is stale" from "this
     * lecture is nine hours long" without opening a log.
     */
    async fetchAudio(video, _grantRef = null, context = null) {
      const watch = context?.watch;
      // UNBOUND. There is no video-without-a-watch path into extraction: the
      // upload lane has its own source rows and never reaches a channel
      // provider at all.
      if (!watch?.watchId || !watch?.ownerUserId || !watch?.replicaId) {
        fail("channel_extract_unbound_video", 409);
      }
      const attestation = context?.attestation;
      if (!attestation) fail("channel_extract_attestation_missing", 403);
      // The attestation must be for THIS watch's channel. The SQL join
      // already required it; asserted again here because this is the last
      // place before a network call and the cost of the assertion is a string
      // comparison.
      if (String(attestation.channelUrl || "") !== String(watch.channel?.url || "")) {
        fail("channel_extract_attestation_channel_mismatch", 403);
      }
      const ceiling = extractClient.maxDurationMs;
      if (Number(video?.durationMs || 0) > ceiling) {
        fail("channel_extract_duration_over_ceiling", 413, { durationMs: video.durationMs, ceiling });
      }

      const objectPath = objectPathFor(watch, video);
      let upload;
      try { upload = await signUpload(objectPath); }
      catch { fail("channel_extract_upload_target_unavailable", 503); }

      const result = await extractClient.extractAudio({
        videoId: video.videoId,
        attestation: { ...attestation, channelKey: keyFromUrl(attestation.channelUrl) },
        upload,
        maxDurationMs: ceiling,
      });

      // Validated through the same `audioRef` every other provider goes
      // through — including the fake — so a real extraction and a fixture are
      // the same shape by construction and the eval's coverage is real.
      return audioRef({
        storagePath: objectPath,
        sha256: result.sha256,
        mime: result.mime,
        byteSize: result.byteSize,
        durationMs: result.durationMs,
        // The route the SERVICE reported, already checked against the route
        // this deploy asked for by `media-extract-client.js`. Carried onto the
        // ref so the run row records which egress produced the bytes, which is
        // the only way a proxy bill can ever be reconciled against work done.
        extractionRoute: result.route,
      });
    },

    /**
     * The back catalogue, oldest-first and resumable.
     *
     * Optional on the seam (`assertChannelProvider` does not require it), so
     * a deployment with no extraction service simply has no backfill lane
     * rather than a broken one. Returns the SAME validated listing shape as
     * `listNewVideos` — `videoListing` refuses an unordered, duplicated,
     * oversized or cursor-including list here exactly as it does there.
     */
    async listCatalogue(channel, afterVideoId = "", context = null) {
      const attestation = context?.attestation;
      if (!attestation) fail("channel_extract_attestation_missing", 403);
      if (String(attestation.channelUrl || "") !== String(channel?.url || "")) {
        fail("channel_extract_attestation_channel_mismatch", 403);
      }
      const page = await extractClient.enumerateCatalogue({
        attestation: { ...attestation, channelKey: keyFromUrl(attestation.channelUrl) },
        afterVideoId: String(afterVideoId || ""),
        limit: Number(context?.limit || 25),
      });
      // The flat listing carries no reliable publish timestamp — the service
      // says so with a null rather than inventing one. `videoRef` REQUIRES a
      // publishedAt because the forward lane's ordering is load-bearing, so
      // the backfill lane supplies a synthetic monotone one derived from the
      // catalogue POSITION, which is the true ordering here, and records
      // nothing else about it. A date that claimed to be an upload date and
      // was not would be a fabricated measurement on a row.
      const base = Date.parse("2000-01-01T00:00:00Z");
      const videos = page.videos.map((video, index) => ({
        videoId: video.videoId,
        title: "",
        publishedAt: new Date(base + index * 60_000).toISOString(),
        durationMs: video.durationMs,
      }));
      return Object.freeze({
        exhausted: page.exhausted,
        videos: videoListing(videos, ""),
      });
    },
  });
}
