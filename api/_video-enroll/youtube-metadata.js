import { parseVideoUrl, VideoEnrollError } from "../_video-enroll.js";
import { channelRef } from "../_channel/contracts.js";

const OEMBED = "https://www.youtube.com/oembed";
const MAX_RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 12_000;

function clean(value, max) {
  return Array.from(String(value || ""))
    .filter((character) => {
      const code = character.codePointAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function fail(code, status = 502) {
  throw new VideoEnrollError(code, status);
}

/** Resolve display metadata before a media byte is requested.
 *
 * The request URL is rebuilt from the validated video id, so a pasted URL
 * cannot steer this fetch. The extractor still performs the authoritative
 * uploader/channel equality check before it downloads any media.
 */
export async function resolveYouTubeVideoMetadata(videoUrl, options = {}) {
  const videoId = parseVideoUrl(videoUrl);
  const fetchImpl = options.fetchImpl || fetch;
  const query = new URLSearchParams({
    url: `https://www.youtube.com/watch?v=${videoId}`,
    format: "json",
  });
  let response;
  try {
    response = await fetchImpl(`${OEMBED}?${query}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    fail("video_metadata_unreachable", 503);
  }
  if (!response?.ok) {
    fail(response?.status === 404 ? "video_metadata_not_found" : "video_metadata_unavailable", response?.status === 404 ? 404 : 503);
  }
  const bodyText = await response.text();
  if (!bodyText || Buffer.byteLength(bodyText, "utf8") > MAX_RESPONSE_BYTES) fail("video_metadata_response_invalid");
  let body;
  try { body = JSON.parse(bodyText); } catch { fail("video_metadata_response_invalid"); }
  const title = clean(body?.title, 160);
  const channelName = clean(body?.author_name, 100);
  const rawChannelUrl = clean(body?.author_url, 300);
  if (!title || !channelName || !rawChannelUrl) fail("video_metadata_response_invalid");
  let channel;
  try { channel = channelRef(rawChannelUrl); }
  catch { fail("video_metadata_channel_invalid"); }
  return Object.freeze({
    video_id: videoId,
    title,
    channel_name: channelName,
    channel_url: channel.url,
  });
}
