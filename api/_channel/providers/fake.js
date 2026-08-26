// A deterministic fixture channel (Gurukul WS-I).
//
// api/_replica-processing/providers/fake.js's role, one seam over: the thing
// evals/channel.mjs drives the REAL worker with, so the worker under test is
// the worker that ships and only the network is replaced. Nothing here is
// reachable from production — `api/_channel/registry.js` has no branch that
// returns it, by construction rather than by flag.
//
// ── it is a fixture, not a recording ─────────────────────────────────────
// Same rule evals/fixtures/lecture-hinglish.mjs states at length: nothing in
// this lane may carry a real person's speech without a consent artifact, so
// the corpus this fake hands out is supplied by the caller (the eval passes
// the fictional Arjun Sir fixture) and this file authors none of its own.
//
// ── it COUNTS ────────────────────────────────────────────────────────────
// `calls` is part of the contract, not a debugging aid. "A revoked watch
// produces no calls" is one of the four properties the eval asserts, and the
// only honest way to assert an absence is to count the thing that must be
// zero.
import { audioRef, captionTrack, videoListing } from "../contracts.js";

/** The shared audio store: `fetchAudio` writes a reference into it and
 *  `api/_asr/providers/fake.js` reads the turns back out. Two fakes joined by
 *  a storage path is exactly the join the real lanes have, so a worker that
 *  forgot to pass the ref through would fail here too. */
export function createFakeAudioStore() {
  const byPath = new Map();
  return Object.freeze({
    put(path, turns) { byPath.set(path, turns); return path; },
    get(path) { return byPath.get(path) || null; },
    size() { return byPath.size; },
  });
}

function hashOf(value) {
  // A stable 64 hex chars from the video id. Not a real digest and it does
  // not need to be: contracts.js asserts the SHAPE, and a fixture that
  // imported node:crypto to satisfy a regex would be pretending to a
  // provenance it does not have.
  let h = 0x811c9dc5;
  for (const ch of String(value)) { h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0").repeat(8);
}

/**
 * @param {object} options
 * @param {Array<{videoId,publishedAt,title?,durationMs?,turns,captions?}>} options.videos
 *   oldest-first, the order a real listing is normalized to.
 * @param {object} [options.audioStore] shared with the fake ASR.
 * @param {string} [options.failAudioFor] a videoId whose fetchAudio throws —
 *   the per-lane failure case, so the eval can prove the cursor does NOT
 *   advance past a failure.
 * @param {boolean} [options.captionsFirst] serve owner captions instead of
 *   audio, exercising the `transcript_source='captions'` path.
 */
export function createFakeChannelProvider(options = {}) {
  const videos = Array.isArray(options.videos) ? options.videos : [];
  const store = options.audioStore || createFakeAudioStore();
  const calls = { listNewVideos: 0, fetchAudio: 0, fetchCaptions: 0 };

  return Object.freeze({
    name: "deterministic-fake-channel",
    version: "0-test",
    calls,
    audioStore: store,

    async listNewVideos(channel, sinceVideoId = "") {
      calls.listNewVideos++;
      const since = String(sinceVideoId || "");
      const index = since ? videos.findIndex((v) => v.videoId === since) : -1;
      const fresh = videos.slice(index + 1).map((v) => ({
        videoId: v.videoId,
        title: v.title || "",
        publishedAt: v.publishedAt,
        durationMs: v.durationMs ?? 60_000,
      }));
      return videoListing(fresh, since);
    },

    async fetchAudio(video) {
      calls.fetchAudio++;
      if (options.failAudioFor && video.videoId === options.failAudioFor) {
        throw Object.assign(new Error("fixture_audio_unavailable"), { code: "fixture_audio_unavailable", status: 502 });
      }
      const found = videos.find((v) => v.videoId === video.videoId);
      if (!found) throw Object.assign(new Error("fixture_video_missing"), { code: "fixture_video_missing", status: 404 });
      const path = `fixture-owner/fixture-replica/${video.videoId}/original`;
      store.put(path, found.turns);
      return audioRef({
        storagePath: path,
        sha256: hashOf(video.videoId),
        mime: "audio/wav",
        byteSize: Math.max(1, found.turns.length * 1_024),
        durationMs: found.durationMs ?? 60_000,
      });
    },

    async fetchCaptions(video) {
      calls.fetchCaptions++;
      if (!options.captionsFirst) return null;
      const found = videos.find((v) => v.videoId === video.videoId);
      if (!found?.captions) return null;
      return captionTrack({ language: "hi-IN", trackKind: "standard", turns: found.captions });
    },
  });
}
