// The Context Locker's ceilings, its error shape, and the segment model every
// extractor speaks (Gurukul WS-AB).
//
// ── why a segment, and not just a string ─────────────────────────────────
// A delta this lane proposes must be CITABLE: "this fragment, from this item,
// at these character offsets, spoken by this person." A bare extracted string
// cannot carry the last two, and a citation that names only an item is a
// citation that cannot be checked — which is `plausible-return-hides-a-dead-
// pipeline` with a provenance label on it. So every extractor returns the
// canonical `body` AND the spans inside it, and every span carries whose words
// it holds. `api/_context-mining.js` then never emits a citation it did not
// resolve back into `body` first.
//
// ── the caps are refusals, never trims ───────────────────────────────────
// `silent-truncation` is the most expensive rejection in this repo — the crisis
// helplines were eaten off the end of a prompt because something trimmed
// quietly. Nothing here trims. An item over a ceiling is REFUSED with the
// ceiling named and the actual number attached, and the owner is told.

/** One item's raw bytes. Chosen under Vercel's ~4.5 MB request body limit:
 *  base64 inflates by 4/3, so 3 MiB raw is ~4 MiB on the wire and still leaves
 *  room for the JSON envelope. A bigger file is not silently chunked — it is
 *  refused with `file_too_large` and the two numbers. */
export const MAX_ITEM_BYTES = 3 * 1024 * 1024;

/** Extracted text per item. A 400k-character document is ~70k words — far past
 *  anything a person writes about themselves in one file, and the point of the
 *  ceiling is that an extractor cannot turn a 3 MiB upload into an unbounded
 *  `text` column. Over it is `extracted_text_too_large`, not a slice. */
export const MAX_EXTRACTED_CHARS = 400_000;

/** The virus-of-the-mind caps, per OWNER (not per replica): a locker is a
 *  place to put a life's context, and an unbounded one is a place to put a
 *  scraped corpus of somebody else's. Both are checked in SQL, as aggregates
 *  over the owner's own rows, before a byte is written. */
export const MAX_ITEMS_PER_OWNER = 200;
export const MAX_BYTES_PER_OWNER = 64 * 1024 * 1024;

/** Citations kept per proposed fragment. Three is enough for a reviewer to
 *  judge "is this really how I talk" and small enough that a delta stays under
 *  `INGEST_DELTA_MAX_BYTES`. */
export const MAX_CITATIONS_PER_CANDIDATE = 3;

/** Chat exports only: how many distinct speakers an export may name before it
 *  stops being a conversation and starts being a corpus. A 40-person group is
 *  39 people who never consented to being mined. */
export const MAX_EXPORT_SPEAKERS = 24;

export class ContextItemError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

/** A REFUSAL is not an error — it is a stored outcome with a named reason that
 *  the owner sees on the item's row. The distinction matters: an error means
 *  the request was wrong, a refusal means the FILE was something this platform
 *  will not pretend to have read. Refusals are the honest half of "formats you
 *  cannot extract are never silently stored-and-ignored". */
export class ContextRefusal extends Error {
  constructor(reason, details) {
    super(reason);
    this.reason = reason;
    if (details) this.details = details;
  }
}

export const refuse = (reason, details) => {
  throw new ContextRefusal(reason, details);
};

/**
 * One span of extracted text.
 *
 * `start`/`end` are character offsets into the extractor's `body`, half-open,
 * and they are the whole citation mechanism: a reviewer, an eval and a future
 * auditor can all take `body.slice(start, end)` and see the words the platform
 * says it mined. `speaker` is `""` when the format has no speaker concept —
 * which is DIFFERENT from an unattributed chat line, and the mining pass treats
 * the two differently.
 */
export function segment(body, start, end, speaker = "") {
  return { start, end, speaker: String(speaker || ""), text: body.slice(start, end) };
}

/** Paragraph segmentation for the formats that have no speakers: blank-line
 *  separated blocks, offsets preserved. Written as an index walk rather than a
 *  split/join because a split loses the offsets, and offsets ARE the citation. */
export function paragraphSegments(body) {
  const out = [];
  const re = /\n[ \t]*\n/g;
  let cursor = 0;
  let match;
  while ((match = re.exec(body))) {
    if (match.index > cursor) out.push(segment(body, cursor, match.index));
    cursor = re.lastIndex;
  }
  if (cursor < body.length) out.push(segment(body, cursor, body.length));
  return out.filter((s) => s.text.trim().length > 0);
}

/**
 * The readability gate — the structural form of
 * `plausible-return-hides-a-dead-pipeline`.
 *
 * Every extractor in this directory can return a STRING for input it did not
 * really understand: a PDF whose fonts use a subset encoding yields byte soup,
 * a mislabelled binary yields replacement characters. Byte soup is the worst
 * possible output, because it is plausible enough to store, mine, and cite —
 * and a clone would then be told these are its owner's habitual phrases.
 *
 * So nothing leaves this directory without clearing this: enough of the text
 * must be ordinary language characters, and it must contain word breaks. A
 * failure is a NAMED refusal, never a shrug.
 */
export function assertReadable(text, code, details) {
  const trimmed = String(text || "").trim();
  if (trimmed.length < 16) refuse(code, { ...details, chars: trimmed.length, note: "under 16 characters of text" });
  // The replacement character is a decoder telling you it guessed.
  const replacements = (trimmed.match(/�/g) || []).length;
  if (replacements > trimmed.length / 200) {
    refuse(code, { ...details, note: "decoder emitted U+FFFD replacement characters" });
  }
  let letters = 0;
  let spaces = 0;
  for (const ch of trimmed) {
    if (/\p{L}|\p{N}/u.test(ch)) letters++;
    else if (ch === " " || ch === "\n" || ch === "\t") spaces++;
  }
  if (letters / trimmed.length < 0.5) {
    refuse(code, { ...details, note: "under half the characters are letters or digits", letter_ratio: Number((letters / trimmed.length).toFixed(3)) });
  }
  if (spaces < trimmed.length / 40) {
    refuse(code, { ...details, note: "almost no word breaks — the text layer is probably a custom font encoding" });
  }
  return trimmed;
}

/** One newline convention, one trailing-space convention, no BOM. Applied
 *  BEFORE offsets are taken, so a citation computed here still resolves on the
 *  stored body — the two must be the same string or every span is off by the
 *  number of \r characters before it. */
export function canonicalText(raw) {
  return String(raw)
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
