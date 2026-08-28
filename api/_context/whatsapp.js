// The chat-export parser — and the speaker attribution that decides whether a
// single word of it may ever be mined.
//
// ── why this format gets the most careful file in the directory ───────────
// A chat export is the richest style corpus this platform will ever be handed:
// years of a person's unguarded, unedited, unperformed writing. It is also, in
// the same file, years of SOMEBODY ELSE'S. There is exactly one thing standing
// between "the best evidence we have of how this person writes" and "a clone
// that talks like the owner's mother", and it is speaker attribution.
//
// So attribution here is STRUCTURAL, not advisory:
//
//   - every message line carries the sender name the export itself wrote;
//   - a line that continues a previous message inherits that sender and
//     nothing else — it is never re-attributed by proximity;
//   - a line the parser cannot attribute at all is kept as a segment with
//     `speaker: ""` and is NEVER an owner turn;
//   - system notices (encryption banners, "X joined", "You deleted this
//     message", media placeholders) are dropped as `system`, because they are
//     WhatsApp's words, not anyone's.
//
// `api/_context-mining.js` then filters to the owner's declared speaker and
// asserts, per emitted citation, that the cited span's speaker is that owner.
// An export whose owner speaker was never declared mines NOTHING and says so
// (`speaker_unattributed_no_style_evidence`) — an unattributable export
// contributes style evidence from nothing, and the honest answer is to say so
// rather than to average over everybody in the room.
//
// ── the two export shapes ────────────────────────────────────────────────
// Android:  `08/03/2026, 21:14 - Priya Menon: message`
// iOS:      `[08/03/2026, 21:14:07] Priya Menon: message`
// Both are matched; the date/time is parsed only far enough to recognise a
// message boundary, because nothing downstream uses the timestamp and a
// half-parsed date is a bug waiting for a locale.
import { canonicalText, refuse, MAX_EXPORT_SPEAKERS } from "./limits.js";

/** Android and iOS message headers. Deliberately anchored and deliberately
 *  non-greedy on the sender: a message whose TEXT contains ": " must not be
 *  re-split at the colon inside it. */
const ANDROID = /^(\d{1,4}[/.-]\d{1,2}[/.-]\d{2,4}),?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APap][Mm])?\s+-\s+(.*)$/;
const IOS = /^\[(\d{1,4}[/.-]\d{1,2}[/.-]\d{2,4}),?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APap][Mm])?\]\s+(.*)$/;

/** Lines that are WhatsApp speaking, not a person. Matched on the REMAINDER
 *  after the timestamp, so a person who literally types one of these sentences
 *  still loses that one line — an acceptable trade against attributing a
 *  system banner to a human. */
const SYSTEM = [
  /messages and calls are end-to-end encrypted/i,
  /^you (created|added|removed|joined|left|changed)\b/i,
  /\b(joined using this group's invite link|was added|was removed|left)$/i,
  /^(this message was deleted|you deleted this message)$/i,
  /changed (the group|their phone number|this group's)/i,
  /^security code changed/i,
];

/** Content placeholders. `<Media omitted>` is not the owner's writing and a
 *  corpus full of it would put "media omitted" in a phrase bank — which is the
 *  literal shape of a mined-from-noise defect. */
const PLACEHOLDER = /^(<media omitted>|image omitted|video omitted|audio omitted|sticker omitted|gif omitted|document omitted|this message was edited|null)$/i;

function isSystem(rest) {
  return SYSTEM.some((re) => re.test(rest.trim()));
}

/**
 * Parse a WhatsApp .txt export into speaker-attributed segments over a
 * canonical body.
 *
 * The BODY this returns is a rebuilt transcript, not the raw file: each message
 * becomes one line of pure message text, and the spans index into that. Rebuilt
 * rather than offset into the original because the original's offsets point at
 * timestamps and sender prefixes, and a citation that renders
 * `08/03/2026, 21:14 - Priya Menon: haan` as the owner's phrase would be citing
 * the export's formatting as the owner's habit.
 *
 * @returns `{ format, extractor, body, segments, speakers, messageCount }`
 * @throws {ContextRefusal} `whatsapp_export_unparseable`, `chat_export_too_many_speakers`
 */
export function extractWhatsAppExport(raw) {
  const text = canonicalText(raw);
  const lines = text.split("\n");
  const messages = [];
  let dropped = 0;

  for (const line of lines) {
    const m = ANDROID.exec(line) || IOS.exec(line);
    if (!m) {
      // A continuation line. It belongs to the message above it and to NOBODY
      // if there is no message above it — an orphan continuation at the top of
      // a file is a fragment of a message whose sender was never in this file.
      const previous = messages[messages.length - 1];
      if (previous && line.trim()) previous.text += `\n${line.trim()}`;
      else if (line.trim()) messages.push({ speaker: "", text: line.trim(), system: false });
      continue;
    }
    const rest = m[2];
    if (isSystem(rest)) { dropped++; continue; }
    const colon = rest.indexOf(": ");
    if (colon <= 0) { dropped++; continue; }  // a timestamped line with no sender is a system notice we do not have a pattern for
    const speaker = rest.slice(0, colon).trim();
    const body = rest.slice(colon + 2).trim();
    if (!speaker || PLACEHOLDER.test(body)) { dropped++; continue; }
    messages.push({ speaker, text: body, system: false });
  }

  const real = messages.filter((msg) => msg.text.trim().length > 0);
  const attributed = real.filter((msg) => msg.speaker);
  if (!attributed.length) {
    refuse("whatsapp_export_unparseable", {
      lines: lines.length,
      dropped,
      note: "no line in this file matched a WhatsApp export message header, so no message could be attributed to anyone. Export the chat again with 'Without media' and upload the .txt unchanged.",
    });
  }

  const speakers = [...new Set(attributed.map((msg) => msg.speaker))];
  if (speakers.length > MAX_EXPORT_SPEAKERS) {
    refuse("chat_export_too_many_speakers", {
      speakers: speakers.length,
      max: MAX_EXPORT_SPEAKERS,
      note: "a group this large is mostly other people's words; mine a one-to-one chat instead",
    });
  }

  // Rebuild the body and take offsets as we go, so the spans and the string are
  // constructed together and cannot drift.
  let body = "";
  const segments = [];
  for (const msg of real) {
    const start = body.length;
    body += msg.text;
    segments.push({ start, end: body.length, speaker: msg.speaker, text: msg.text });
    body += "\n";
  }
  body = body.slice(0, -1);

  return {
    format: "whatsapp_export",
    extractor: "whatsapp-export/v1",
    body,
    segments,
    speakers: speakers
      .map((name) => ({ name, messages: attributed.filter((msg) => msg.speaker === name).length }))
      .sort((a, b) => b.messages - a.messages),
    messageCount: real.length,
    droppedSystemLines: dropped,
  };
}

/** A .txt upload is either a chat export or plain prose, and the difference
 *  decides whether speaker attribution applies at all. Sniffed on the first 40
 *  non-empty lines rather than on the filename, because "chat.txt" and
 *  "notes.txt" are both `.txt` and only one of them has senders in it. */
export function looksLikeChatExport(raw) {
  const lines = String(raw).replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim()).slice(0, 40);
  if (lines.length < 3) return false;
  const hits = lines.filter((line) => ANDROID.test(line) || IOS.test(line)).length;
  return hits >= Math.max(3, Math.ceil(lines.length * 0.4));
}
