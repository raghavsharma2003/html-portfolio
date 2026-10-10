// The per-Room web app manifest (WS-R59) — GET /r/<slug>/manifest.webmanifest.
//
// `api/_room-page.js`'s own shape, one file over: every decision lives here,
// where a fake `db` can reach it (`evals/room-install/run.mjs`);
// `api/room-manifest.js` is the thin door.
//
// ── WHY THE PLATFORM FALLBACK IS THE STATIC public/room.webmanifest'S OWN
//    BYTES, NOT A RE-SERIALIZED COPY ─────────────────────────────────────
//
// `publicRoomBySlug` (api/_room-publish.js) already returns null for
// unpublished, paused AND unknown slugs alike — `api/_room-page.js`'s own
// law, restated for a manifest instead of an og:card: a manifest must never
// let an installer learn whether a slug exists, exists-but-paused, or never
// existed at all. The three cases collapse to ONE response, and that
// response has to be BYTE IDENTICAL every time or "identical bytes" is a
// claim nobody checked. So `PLATFORM_ROOM_MANIFEST_JSON` below is not
// JSON.stringify'd from an object at request time — formatting choices (key
// order, indent width, whether a one-entry `icons` array gets its own line)
// are invisible to a browser and exactly the kind of thing a future edit
// changes without anyone noticing — it is the literal bytes of
// `public/room.webmanifest`, copied once. `evals/room-install/run.mjs`
// hashes both and asserts they still match; diverge the two and the eval
// fails before a deploy ever could.
import { publicRoomBySlug } from "./_room-publish.js";
import { roomDisclosureCard, normalizeLocale } from "./_room-surface.js";

/** `--paper` — src/studio/studio.css's own design token — restated as a
 *  literal because a JS module cannot read a CSS custom property. Already
 *  the exact value `public/room.webmanifest` and `RoomApp.tsx`'s
 *  now-superseded blob-manifest technique (WS-R22) both used — this
 *  workstream changes where the Room's manifest comes from, never its
 *  colour. */
export const ROOM_THEME_COLOR = "#f4f1e9";

/** Byte-for-byte `public/room.webmanifest` — see this file's own header for
 *  why this is a literal rather than a built object. Served for a
 *  unpublished, paused, or unknown slug alike, and whenever a read fails. */
export const PLATFORM_ROOM_MANIFEST_JSON = `{
  "name": "The Room",
  "short_name": "Room",
  "description": "A private, continuing conversation with a creator's AI.",
  "start_url": "/r/",
  "display": "standalone",
  "background_color": "${ROOM_THEME_COLOR}",
  "theme_color": "${ROOM_THEME_COLOR}",
  "icons": [
    { "src": "/favicon.svg", "sizes": "any", "type": "image/svg+xml" }
  ]
}
`;

/** slug -> the Room's public row, or null (unpublished, paused, unknown —
 *  `publicRoomBySlug`'s own three-way collapse, `api/_room-page.js`'s
 *  precedent restated for a manifest instead of a card). */
export async function resolveRoomManifest(db, slug) {
  return publicRoomBySlug(db, slug);
}

/**
 * PURE. `row` is exactly what `resolveRoomManifest` returns (or null).
 * Returns a JSON STRING, never an object, so the door hands it straight to
 * the response with no second serialization step that could drift from what
 * an eval hashed.
 *
 * `row === null`: the platform manifest, verbatim — see this file's header.
 *
 * `row` present: THIS Room's own manifest.
 *  - `name`/`short_name`: `<Name> AI` — the disclosure vocabulary
 *    (`api/_room-surface.js`'s own naming, copy-gated the same as every
 *    other user-visible string this workstream adds).
 *  - `start_url`: `/r/<slug>?via=install` — an install launch counts as its
 *    own arrival channel (`ROOM_ARRIVAL_VIA`, this workstream's one line in
 *    `api/_room-surface.js`).
 *  - `description`: the disclosure card's own FIRST sentence
 *    (`api/_room-page.js`'s own reuse of `roomDisclosureCard`, restated) —
 *    never a second, hand-written summary of what the card already says.
 *  - colour and icon: the SAME ones the platform manifest already carries —
 *    a Room gets a name of its own in v1, not a colour.
 */
export function buildRoomManifestJson(row, { slug } = {}) {
  if (!row) return PLATFORM_ROOM_MANIFEST_JSON;
  const s = String(slug || row.slug || "").trim();
  const locale = normalizeLocale(row.default_locale);
  const displayName = String(row.display_name || "").trim();
  const name = displayName ? `${displayName} AI` : "The Room";
  const description = roomDisclosureCard(displayName, locale).split("\n")[0];
  const manifest = {
    name,
    short_name: displayName || "Room",
    description,
    start_url: `/r/${encodeURIComponent(s)}?via=install`,
    display: "standalone",
    background_color: ROOM_THEME_COLOR,
    theme_color: ROOM_THEME_COLOR,
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }],
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
