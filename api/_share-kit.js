// The share kit (WS-R85, migration 122). One tap gives the creator the
// exact text and picture for WhatsApp, an Instagram bio, a YouTube
// description and a Telegram channel post — India's creators distribute in
// exactly these four places, and until this workstream the growth funnel
// only knew `share`/`embed`/`search`/`install`/`poster`: one bucket for
// every one of them. Four `via` values (migration 122,
// `api/_room-surface.js`'s `ROOM_ARRIVAL_VIA` widened in the same commit)
// let the Growth line say where followers actually come from.
//
// PURE by construction — `computeCardLayout` (`api/_room-card.js`)'s own
// shape, restated for text instead of pixels: `buildShareKit` touches no
// database, no filesystem, no network. Every decision a fake `db` would
// otherwise need to reach lives here, so `evals/share-kit/run.mjs` never
// needs one. `api/_room-publish.js`'s `ownerRoomShareKit` is the one owner
// read op that calls this with a real Room row.
//
// ── THE TEXT NEVER NAMES A FOLLOWER ─────────────────────────────────────
// `buildShareKit`'s inputs are exactly the Room's own public fields
// (`name`, `slug`, `locale`, `publishedAt`) plus the caller's own `origin` —
// the same closed shape `api/_room-card.js`'s `cardInputFor` already reads
// from `publicRoomBySlug`. No follower id, session, count or thread is
// reachable from this file's own source at all — `evals/share-kit/run.mjs`
// proves it with a static scan of this file's own text, the identical
// negative control `evals/room-share/run.mjs` already runs on
// `RoomApp.tsx`'s share-url builder.
//
// ── THE TEXT NEVER PROMISES WHAT READINESS HAS NOT PASSED ──────────────
// `buildShareKit` returns `null` for a Room that has not published
// (`publishedAt` falsy) — there is nothing honest to hand a creator to
// paste into a WhatsApp group for an address that answers "the link may be
// old, or the creator may have paused it" to every visitor. This is the
// SAME posture `api/_room-page.js`'s unfurl and `api/_room-card.js`'s
// picture take for an unpublished Room, restated for a text template
// instead of a card.
//
// ── WHY THE TEMPLATES CARRY NO BIO ──────────────────────────────────────
// `one_line_bio` is a creator-authored 140-character field (migration 105)
// with no upper bound this file could safely compose into a 150-character
// Instagram bio line without risking an overflow the copy gate would never
// catch (a length problem, not a banned-word one). Every template below
// interpolates only `{name}` and `{url}` — both already bounded elsewhere
// in the product (`assertSlugShape`'s 3-40, the disclosure card's own name
// handling) — and `buildShareKit` still ASSERTS every rendered text against
// its own channel's `SHARE_KIT_LIMITS` entry and THROWS rather than
// silently truncating (`CLAUDE.md`'s own prompt-budget lesson: truncation
// is silent and eats the newest, most important text at the end — the
// identical failure shape, refused here by construction rather than risked).
//
// ── WHERE THE TEMPLATE TEXT ITSELF LIVES ────────────────────────────────
// `SHARE_KIT_COPY` below is restated from `src/studio/copy.ts` and
// `src/studio/hiCopy.ts`'s own `shareKit` section — the creator SEES this
// exact text in the Share tab before they copy it, so its canonical source
// is studio copy, not a server-only string, the same reasoning
// `api/_creator-page.js`'s own header gives for restating `src/room/
// copy.ts`'s `taste` section as `TASTE_COPY` there. `evals/share-kit/
// run.mjs` bundles the REAL `src/studio/copy.ts`/`hiCopy.ts` with esbuild
// (`evals/studio-locale/run.mjs`'s own technique, `loadStudioCopy("hi")`
// awaited first) and asserts byte-for-byte parity, so a future edit to one
// side that forgets the other is caught mechanically.
import { roomDisclosureCard, normalizeLocale } from "./_room-surface.js";

export class ShareKitError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

/** The four channels this kit ever names, in the fixed display order the
 *  Share tab renders its rows in. */
export const SHARE_KIT_CHANNELS = Object.freeze(["whatsapp", "instagram", "youtube", "telegram"]);

/** Each platform's REAL character limit, cited, next to the ceiling this
 *  file actually enforces — WhatsApp's real cap is 65,536 but this
 *  product's own brief keeps a forwarded message well under 300 so it
 *  reads as a note, not a wall of text, in a group chat; the other three
 *  are the platform's own real number, unmodified. */
export const SHARE_KIT_LIMITS = Object.freeze({
  whatsapp: 300, // real limit 65,536; kept short on purpose (this workstream's own brief)
  instagram: 150, // Instagram's own bio field limit
  youtube: 5000, // YouTube's own description field limit
  telegram: 4096, // Telegram's own message/about-text limit
});

/** Which picture (if any) each channel's row links to —
 *  `api/_room-card.js`'s own three kinds, restated as a channel map: the
 *  story card for WhatsApp and Telegram (both apps render a forwarded
 *  portrait image well), the unfurl/og image for YouTube (a thumbnail
 *  next to a description, never a portrait crop), and no picture at all
 *  for Instagram — a bio holds one link, never an attached image. */
export const SHARE_KIT_PICTURE = Object.freeze({
  whatsapp: "story",
  instagram: null,
  youtube: "og",
  telegram: "story",
});

// ─────────────────────────────────────────────────────────────────────────
// SHARE_KIT_COPY — restated from src/studio/copy.ts#shareKit and
// src/studio/hiCopy.ts#shareKit, byte for byte (`evals/share-kit/run.mjs`'s
// own parity section proves it against the REAL bundled export). Every
// template carries exactly two holes, `{name}` and `{url}`, and nothing
// else — `withName`/`withLabel`-shaped substitution
// (`api/_creator-page.js`'s own `withName`, restated here as `fillTemplate`
// below rather than imported, that file's own header on why a server
// function cannot import a `.ts` module).
// ─────────────────────────────────────────────────────────────────────────
export const SHARE_KIT_COPY = {
  en: {
    whatsapp:
      "I have started {name} AI, a place to ask {name} anything, any time. It is upfront that it is an AI, not {name}, and it never shares what you say with anyone else. Talk to it here: {url}",
    instagram: "{name} AI, talk any time: {url}",
    youtube:
      "{name} AI is here.\n\nI built an AI version of myself so you can ask questions any time, even when I am offline. It is upfront that it is an AI, not {name}, and it never shares what you say with anyone else.\n\nTalk to it: {url}",
    telegram:
      "{name} AI is live. Ask anything, any time, right here: {url}\n\nIt is an AI built from {name}'s own material, not {name} themselves, and it never shares your messages with anyone.",
  },
  hi: {
    whatsapp:
      "मैंने {name} AI शुरू किया है, जिससे आप {name} से जुड़े कभी भी सवाल पूछ सकते हैं। यह साफ बताता है कि यह एक AI है, {name} नहीं, और आपकी बात किसी और को नहीं बताई जाती। यहां बात करें: {url}",
    instagram: "{name} AI, कभी भी बात करें: {url}",
    youtube:
      "{name} AI अब यहां है।\n\nमैंने अपनी एक AI बनाई है ताकि आप कभी भी सवाल पूछ सकें, भले ही मैं उपलब्ध न होऊं। यह साफ बताता है कि यह एक AI है, {name} नहीं, और आपकी बात किसी और को नहीं बताई जाती।\n\nयहां बात करें: {url}",
    telegram:
      "{name} AI अब लाइव है। यहां कभी भी कुछ भी पूछें: {url}\n\nयह {name} की अपनी सामग्री से बनी एक AI है, खुद {name} नहीं, और यह आपकी बात किसी और को नहीं बताती।",
  },
};

/** `{name}`/`{url}` substitution, `api/_creator-page.js`'s `withName`
 *  restated for two holes instead of one. */
function fillTemplate(template, name, url) {
  return String(template || "")
    .split("{name}").join(name)
    .split("{url}").join(url);
}

/**
 * The Room's own public row -> `{ channel, text, url, picture }[]`, or
 * `null` for a Room that has never published (nothing honest to share yet
 * — this file's own header on why). `name`/`slug`/`origin` mirror
 * `api/_room-card.js`'s `cardInputFor` inputs exactly; `locale` and
 * `publishedAt` are the two fields that file does not need and this one
 * does.
 *
 * THROWS `ShareKitError('share_kit_text_over_limit', 500, { channel, limit,
 * length })` rather than truncating — see this file's own header. This
 * should never fire in production (the templates above are authored to fit
 * comfortably under every limit for any name this product's own slug/name
 * shapes admit), but a defensive assertion that never fires costs nothing
 * and a silent truncation that ships once costs a great deal.
 */
/** WS-R126 (join from WhatsApp): a fifth, DIFFERENT-SHAPED row this file can
 *  append — not a message to compose in another app (the four rows above),
 *  a direct wa.me deep link that opens THIS business number's own chat with
 *  `join <slug>` already typed. Kept as its own channel key rather than
 *  folded into `"whatsapp"` above: that row's text/url/picture triple is
 *  already load-bearing for `SHARE_KIT_LIMITS`/`SHARE_KIT_PICTURE`/
 *  `SHARE_KIT_COPY`'s own per-channel maps and `CHANNEL_ORDER`
 *  (`ShareKitCard.tsx`) — overloading it would mean the whatsapp row's own
 *  `?via=whatsapp` web link and this new chat-opening link could never both
 *  be shown in the same place. This file stays PURE: `whatsappJoinUrl` is a
 *  plain string handed in by the caller (`api/_room-publish.js`'s
 *  `ownerRoomShareKit`, which is where an env var may be read), never
 *  derived here — an empty/missing value means "structurally absent", this
 *  workstream's own law 1, and the row is simply not appended. */
export const SHARE_KIT_WHATSAPP_JOIN_CHANNEL = "whatsapp_join";

export function buildShareKit({ name, slug, locale, origin, publishedAt, whatsappJoinUrl } = {}) {
  if (!publishedAt) return null;
  const displayName = String(name || "").trim();
  const cleanSlug = String(slug || "").trim();
  if (!displayName || !cleanSlug) return null;
  const base = String(origin || "").replace(/\/+$/, "");
  const loc = normalizeLocale(locale);
  const copy = SHARE_KIT_COPY[loc] || SHARE_KIT_COPY.en;

  const rows = SHARE_KIT_CHANNELS.map((channel) => {
    const url = base ? `${base}/r/${encodeURIComponent(cleanSlug)}?via=${channel}` : `/r/${encodeURIComponent(cleanSlug)}?via=${channel}`;
    const text = fillTemplate(copy[channel], displayName, url);
    const limit = SHARE_KIT_LIMITS[channel];
    if (text.length > limit) {
      throw new ShareKitError("share_kit_text_over_limit", 500, { channel, limit, length: text.length });
    }
    return { channel, text, url, picture: SHARE_KIT_PICTURE[channel] };
  });

  const joinUrl = String(whatsappJoinUrl || "").trim();
  if (joinUrl) {
    rows.push({ channel: SHARE_KIT_WHATSAPP_JOIN_CHANNEL, text: joinUrl, url: joinUrl, picture: "story" });
  }
  return rows;
}

// Named export so a caller (or this file's own eval) can build the
// identical disclosure-first-line text this product's other surfaces use,
// without a second import of `_room-surface.js` — never used by
// `buildShareKit` itself (the templates above are self-contained), kept
// here only because `evals/share-kit/run.mjs`'s own "the text never
// promises what Readiness has not passed" proof reads it for comparison.
export function shareKitDisclosureFirstLine(name, locale) {
  return roomDisclosureCard(name, locale).split("\n")[0];
}
