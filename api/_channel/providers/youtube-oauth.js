// YouTube Data API v3, acting as the channel's OWNER (Gurukul WS-I).
//
// docs/gurukul/ingestion-research.md §3 decides the shape of this file before
// a line of it is written, and the two findings that do it are:
//
//   1. "YouTube Data API v3 does not provide a general video/audio download
//      endpoint." There is no lawful `fetchAudio` here to write. What it has
//      is `captions.download`, which (a) requires the caller to own or hold
//      edit permission on the video and (b) returns only MANUALLY-uploaded
//      caption tracks, never the auto-generated ones.
//   2. "Since the teacher IS the uploader/copyright holder of their own
//      videos, self-authorization is the clean legal path" — either OAuth
//      acting as the owner (this file) or direct upload by the teacher (the
//      `upload` transcript source). yt-dlp-style scraping is a ToS exposure
//      the research recommends against as a default at multi-teacher scale.
//
// So `fetchAudio` below is IMPLEMENTED AS A REFUSAL with a code that names
// both lawful alternatives, and `fetchCaptions` is the operation that
// actually works. That is a provider declining a capability it does not
// lawfully have, and the worker treats the refusal as a per-lane failure
// rather than as a crash: the run row lands `failed` with the code, the
// teacher sees "this video needs a direct upload", and no cursor advances.
//
// **The legal-risk judgment above is synthesized from general-audience
// sources, not from a lawyer — ingestion-research.md §3 flags it in those
// words and it is flagged again here, at the file that acts on it, because a
// caveat that lives only in a research doc is a caveat nobody reads at the
// moment it matters.**
//
// ── env-gated, and never called in evals ─────────────────────────────────
// Constructed only by `registry.js`, which throws without
// YOUTUBE_OAUTH_CLIENT_ID / YOUTUBE_OAUTH_CLIENT_SECRET. evals/channel.mjs
// imports providers/fake.js and never this file, so there is no path by which
// a test run reaches the network.
//
// ── the refresh token is not in this codebase's database ─────────────────
// Migration 053 stores `oauth_grant_ref uuid` and nothing else. This provider
// therefore takes a `grantStore` — an injected object with
// `refreshToken(grantRef) -> string` — rather than reading a token from a
// row. Without one it fails closed. The vault behind that seam belongs to the
// consent lane (WS-E), which is where every other credential for a real named
// person already lives; duplicating it here would make two places that can
// leak a teacher's Google account.
import { captionTrack, videoListing } from "../contracts.js";

const NAME = "youtube-data-api-v3";
const VERSION = "1";
const API = "https://www.googleapis.com/youtube/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";
const PAGE_SIZE = 50;
const TIMEOUT_MS = 20_000;
const MAX_CAPTION_BYTES = 4 * 1024 * 1024;

function fail(code, status = 502, details) {
  throw Object.assign(new Error(code), { code, status, details });
}

/** ISO-8601 durations, the only format `videos.list` reports. Hours are
 *  included because a JEE lecture is routinely two of them. */
function durationMs(value) {
  const matched = /^P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(value || ""));
  if (!matched) return 0;
  return ((Number(matched[1] || 0) * 3600) + (Number(matched[2] || 0) * 60) + Number(matched[3] || 0)) * 1000;
}

async function json(fetchImpl, url, options, code) {
  let response;
  try { response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) }); }
  catch { fail(`${code}_unreachable`, 503); }
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { fail(`${code}_response_invalid`); }
  if (!response.ok) {
    // Google's error body carries `error.errors[0].reason`, which is the only
    // part worth keeping: `quotaExceeded` and `forbidden` need different
    // human answers and an HTTP status alone cannot tell them apart.
    const reason = String(body?.error?.errors?.[0]?.reason || body?.error?.status || response.status);
    fail(`${code}_${reason}`.replace(/[^a-z0-9_]/gi, "_").slice(0, 120), response.status === 403 ? 403 : 502);
  }
  return body;
}

async function accessToken(config, grantRef) {
  if (!config.grantStore || typeof config.grantStore.refreshToken !== "function") fail("channel_oauth_grant_store_unavailable", 503);
  if (!grantRef) fail("channel_oauth_grant_missing", 409);
  const refresh = await config.grantStore.refreshToken(grantRef);
  if (!refresh) fail("channel_oauth_grant_missing", 409);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: String(refresh),
    grant_type: "refresh_token",
  });
  const result = await json(config.fetchImpl, TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  }, "channel_oauth_token");
  const token = String(result?.access_token || "");
  // A scope narrower than force-ssl cannot read captions, and finding that
  // out at the captions call would report it as a captions failure.
  if (!token) fail("channel_oauth_token_missing", 401);
  if (result?.scope && !String(result.scope).split(/\s+/).includes(SCOPE)) fail("channel_oauth_scope_insufficient", 403);
  return token;
}

async function uploadsPlaylistId(config, token, channel) {
  const query = new URLSearchParams({ part: "contentDetails", maxResults: "1" });
  if (channel.kind === "channel_id") query.set("id", channel.key);
  else if (channel.key.startsWith("@")) query.set("forHandle", channel.key);
  else query.set("forUsername", channel.key);
  const result = await json(config.fetchImpl, `${API}/channels?${query}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  }, "channel_lookup");
  const uploads = result?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) fail("channel_uploads_playlist_missing", 404);
  return String(uploads);
}

/** Walks the uploads playlist newest-first (the only order YouTube offers)
 *  until the cursor is reached, then REVERSES. The reversal is not cosmetic:
 *  the worker advances `last_seen_video_id` to the last SUCCESS, so an
 *  oldest-first listing means a mid-listing failure strands only the tail. */
async function listSince(config, token, playlistId, sinceVideoId) {
  const collected = [];
  let pageToken = "";
  let reachedCursor = false;
  for (let page = 0; page < 4 && !reachedCursor; page++) {
    const query = new URLSearchParams({ part: "contentDetails", playlistId, maxResults: String(PAGE_SIZE) });
    if (pageToken) query.set("pageToken", pageToken);
    const result = await json(config.fetchImpl, `${API}/playlistItems?${query}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    }, "channel_listing");
    for (const item of result?.items || []) {
      const id = String(item?.contentDetails?.videoId || "");
      if (!id) continue;
      if (sinceVideoId && id === sinceVideoId) { reachedCursor = true; break; }
      collected.push({ videoId: id, publishedAt: item?.contentDetails?.videoPublishedAt });
    }
    pageToken = String(result?.nextPageToken || "");
    if (!pageToken) break;
  }
  // A first-ever sweep (no cursor) would otherwise ingest an entire back
  // catalogue in one run. Bounded to the newest slice; the next sweep does
  // not continue backwards, because "stay current" is forward-looking and a
  // back-catalogue import is a different, teacher-initiated operation.
  const window = collected.slice(0, 25).reverse();
  if (!window.length) return [];
  const details = await json(config.fetchImpl,
    `${API}/videos?${new URLSearchParams({ part: "contentDetails,snippet", id: window.map((v) => v.videoId).join(",") })}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }, "channel_video_details");
  const byId = new Map((details?.items || []).map((item) => [String(item?.id || ""), item]));
  return window.map((video) => {
    const item = byId.get(video.videoId);
    return {
      videoId: video.videoId,
      title: item?.snippet?.title || "",
      publishedAt: video.publishedAt || item?.snippet?.publishedAt,
      durationMs: durationMs(item?.contentDetails?.duration),
    };
  });
}

/** SRT to the one turn shape the rest of the pipeline speaks. There is no
 *  diarization in a caption file, so every turn carries the SAME speaker
 *  label — and that is stated, not hidden: `transcriptStats` chooses the
 *  most-talkative speaker, so a single-speaker transcript measures the whole
 *  file, which is correct for a caption track and would be WRONG if this
 *  function invented per-line speakers it did not know. */
function srtTurns(text) {
  const turns = [];
  for (const block of String(text).replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = block.split("\n").filter(Boolean);
    const timing = lines.find((line) => line.includes("-->"));
    if (!timing) continue;
    const [start, end] = timing.split("-->").map((part) => part.trim());
    const ms = (stamp) => {
      const matched = /^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(stamp || "");
      return matched
        ? ((Number(matched[1]) * 3600) + (Number(matched[2]) * 60) + Number(matched[3])) * 1000 + Number(matched[4])
        : 0;
    };
    const body = lines.slice(lines.indexOf(timing) + 1).join(" ").trim();
    if (body) turns.push({ speaker: "SPEAKER_00", text: body, t0: ms(start), t1: ms(end) });
  }
  return turns;
}

export function createYouTubeOAuthChannelProvider(options = {}) {
  const config = Object.freeze({
    clientId: String(options.clientId || ""),
    clientSecret: String(options.clientSecret || ""),
    fetchImpl: options.fetchImpl || fetch,
    grantStore: options.grantStore || null,
  });
  if (!config.clientId || !config.clientSecret) fail("channel_provider_unavailable", 503);

  return Object.freeze({
    name: NAME,
    version: VERSION,
    transcriptSource: "captions",

    async listNewVideos(channel, sinceVideoId = "", grantRef = null) {
      const token = await accessToken(config, grantRef);
      const playlistId = await uploadsPlaylistId(config, token, channel);
      return videoListing(await listSince(config, token, playlistId, String(sinceVideoId || "")), sinceVideoId);
    },

    /** The refusal. See this file's header: the Data API has no download
     *  endpoint, and the two lawful ways to get this audio are named in the
     *  code so the studio can render them without a lookup table. */
    async fetchAudio() {
      fail("channel_audio_download_unavailable_use_owner_captions_or_direct_upload", 409);
    },

    async fetchCaptions(video, grantRef = null) {
      const token = await accessToken(config, grantRef);
      const list = await json(config.fetchImpl,
        `${API}/captions?${new URLSearchParams({ part: "snippet", videoId: video.videoId })}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }, "channel_captions_list");
      // `trackKind: 'ASR'` is YouTube's auto-generated track, which
      // captions.download refuses for anybody including the owner
      // (ingestion-research.md §3). Filtering it here turns a 403 three
      // seconds later into an honest "this video has no owner-uploaded
      // captions" now.
      const track = (list?.items || []).find((item) => String(item?.snippet?.trackKind || "standard") !== "ASR");
      if (!track?.id) return null;
      let response;
      try {
        response = await config.fetchImpl(`${API}/captions/${encodeURIComponent(track.id)}?tfmt=srt`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch { fail("channel_captions_download_unreachable", 503); }
      if (!response.ok) fail(`channel_captions_download_http_${response.status}`, response.status === 403 ? 403 : 502);
      const body = await response.text();
      if (!body || body.length > MAX_CAPTION_BYTES) fail("channel_captions_size_invalid", 413);
      return captionTrack({
        language: track?.snippet?.language,
        trackKind: track?.snippet?.trackKind || "standard",
        turns: srtTurns(body),
      });
    },
  });
}
