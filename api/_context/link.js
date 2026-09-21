// Links: what they are, where they belong, and the HTML→text pass for the ones
// that stay here.
//
// ── routing is a first-class outcome, not a failure ──────────────────────
// Two kinds of link arrive in this lane and neither belongs to it:
//
//   a YouTube link  → WS-S's channel lane (`api/_channel-watch.js`), which has
//                     the ownership attestation, the OAuth grant, the
//                     back-catalogue cursor and the extraction posture that
//                     downloading from YouTube requires;
//   an audio link   → the existing voice-evidence / ASR lane, which has the
//                     biometric consent gate and the speaker-diarization the
//                     Person Model's voice half is built on.
//
// Duplicating either here would be a second definition of a permission that a
// real, named, living person granted once — the exact shape `api/_teachersheet.js`
// refuses for teacher clones. So they are stored with `status='routed'` and a
// named destination, and the studio sends the owner to the right step. That is
// deliberately NOT a refusal: nothing is wrong with the link, it is simply not
// this lane's.
//
// ── the article fetch is a SEAM, and an absent seam is a refusal ─────────
// This module never reaches the network by itself. A deployment supplies a
// fetcher; one that does not has no article lane, and an article item is
// refused with `article_fetch_not_configured` rather than stored as a URL the
// platform quietly never read. `voice-panel-has-never-synthesised` and
// `plausible-return-hides-a-dead-pipeline` are the same lesson from two
// directions: a lane that returns something believable while doing nothing is
// worse than a lane that says it is off.
import { assertReadable, canonicalText, paragraphSegments, refuse } from "./limits.js";

const YOUTUBE_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be",
]);
const AUDIO_EXTENSIONS = /\.(mp3|m4a|wav|aac|ogg|opus|flac|wma|mp4|mov|webm|mkv)(\?|#|$)/i;

/** Hosts that can only mean "inside our own network". A server-side fetch of an
 *  owner-supplied URL is an SSRF primitive by construction, so the check is a
 *  refusal on the URL rather than a trust in the fetcher. It is deliberately
 *  strict — public https, default port, no credentials — because every case it
 *  rejects has a legitimate alternative (upload the file) and the case it would
 *  let through does not. */
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * @returns `{ kind: "route", routedTo, note }` | `{ kind: "article", url }`
 * @throws {ContextRefusal} `link_unparseable`, `link_scheme_unsupported`,
 *   `link_host_not_public`
 */
export function classifyLink(value) {
  let url;
  try { url = new URL(String(value || "").trim()); }
  catch { refuse("link_unparseable", { note: "not a URL" }); }

  if (url.protocol !== "https:") {
    refuse("link_scheme_unsupported", { protocol: url.protocol, note: "only https links are read" });
  }
  if (url.username || url.password) refuse("link_host_not_public", { note: "a URL carrying credentials is never fetched" });
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (PRIVATE_HOST.test(host) || host === "0.0.0.0" || host.startsWith("[") || IPV4.test(host)) {
    refuse("link_host_not_public", { host, note: "IP literals and private hostnames are never fetched" });
  }
  if (!host.includes(".")) refuse("link_host_not_public", { host, note: "not a public domain name" });
  if (url.port && url.port !== "443") refuse("link_host_not_public", { port: url.port, note: "only the default https port is fetched" });

  if (YOUTUBE_HOSTS.has(host)) {
    return {
      kind: "route",
      routedTo: "channel_lane",
      note: "YouTube belongs to the Channel step, which carries the ownership attestation and the audio-extraction posture this lane does not have.",
    };
  }
  if (AUDIO_EXTENSIONS.test(url.pathname)) {
    return {
      kind: "route",
      routedTo: "voice_evidence_lane",
      note: "This looks like an audio or video file. Voice goes through the Voice step, which carries the biometric consent gate.",
    };
  }
  return { kind: "article", url: url.toString() };
}

/** An uploaded FILE whose bytes are audio, routed the same way and for the same
 *  reason. Sniffed on magic bytes as well as extension, because a `.txt` that
 *  is really an m4a should not be handed to the text decoder. */
export function audioRouting(filename, buffer) {
  const name = String(filename || "").toLowerCase();
  if (AUDIO_EXTENSIONS.test(name)) return true;
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  const head = buffer.subarray(0, 12);
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WAVE") return true;
  if (head.subarray(4, 8).toString("latin1") === "ftyp") return true;      // mp4 / m4a / mov
  if (head.subarray(0, 4).toString("latin1") === "OggS") return true;
  if (head.subarray(0, 4).toString("latin1") === "fLaC") return true;
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return true; // ID3 → mp3
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return true;            // bare mpeg frame
  return false;
}

const BLOCK_TAGS = /<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre)\s*>/gi;

/**
 * HTML → text, at the honesty level this lane needs.
 *
 * `<script>`, `<style>`, `<noscript>`, `<svg>` and HTML comments are removed
 * with their contents; block-level closers become paragraph breaks; every other
 * tag is dropped. This is NOT boilerplate removal — the nav and the footer come
 * through — and the extractor name says `html-text/v1` so a future
 * readability-extraction pass is a NEW name rather than a silent change in what
 * a stored citation means.
 *
 * @throws {ContextRefusal} `article_no_text`, `article_unreadable`
 */
export function extractHtml(html, url) {
  const stripped = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe|template)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(BLOCK_TAGS, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, code) => {
      if (code[0] === "#") {
        const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
      }
      return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”" }[code] ?? whole;
    })
    .replace(/[ \t ]+/g, " ");
  const text = canonicalText(stripped);
  if (!text) refuse("article_no_text", { url, note: "the page returned no readable text" });
  const body = assertReadable(text, "article_unreadable", { url });
  return { format: "article", extractor: "html-text/v1", body, segments: paragraphSegments(body) };
}
