// WRITING CONVENTIONS ARE NOT SPEAKING CONVENTIONS.
//
// The owner's report was "saying Dash dash in voice call". The cause is not a
// bug in any one lane, it is a missing layer: there has never been a point in
// this repo where text stops being TEXT and becomes SPEECH. Her reply string is
// the same object twice over — it is displayed in the chat AND handed to a
// synthesiser — and only the second copy should ever be transformed. That is
// the whole contract of this module: it is applied at the seam where text
// becomes audio, and NOWHERE else. Nothing here may touch what is shown.
//
// WHY IT IS A WHOLE CLASS AND NOT A DASH. `context/rejected.md`:
//
//   `recited-prompt`         anything sentence-shaped in her brief gets said.
//   `ack-bracket-direction`  "[laughs softly]" came back as laughter PLUS the
//                            spoken word "Softly." Bracket-shaped text is not
//                            inert anywhere in this system.
//
// Her brief is 45k characters of English prose containing 208 em-dashes, and
// `persona.ts:buildSpeechStyle` goes further than incidental style — it
// instructs her, on the lane whose prosody IS her spelling, to write "a dash
// where you cut yourself off", and the FINAL block tells both lanes that "the
// mid-sentence dash" lives inside her short sentences. She is doing exactly
// what she was told. The punctuation reaches the synthesiser and the
// synthesiser reads it. Every other writing convention in the same reply —
// markdown, bullets, arrows, brackets, emoji, URLs — has the same property and
// only the dash happened to be noticed first.
//
// ── THE ORDERING THIS MODULE DEPENDS ON, verified in source, not assumed ──
// Media/protocol tags are parsed and ACTED ON by the caller BEFORE any text
// reaches a synthesiser. Proof, in call order:
//
//   1. src/engine/brain.ts `parseReply()` lifts [tone:], [voicenote:], [photo:],
//      [gif:], [followup:], [search:] and [forget:] OUT of the reply into
//      structured fields (brain.ts:212-335). [forget:] then performs a real
//      delete (brain.ts:1012-1026) and [tone:] becomes the `style` argument.
//      In `mode === "call"` it additionally strips stage directions
//      (brain.ts:1037-1041).
//   2. src/voice/speech.ts `stripForCloud`/`stripForDevice` remove protocol
//      residue and emoji (speech.ts:125-152); `stripTagsForPlainVoice` turns a
//      short performable tag into a pause (speech.ts:163-173).
//   3. only then is the text POSTed to /api/speech, where this module runs.
//
// The one caller that skips step 2 — src/components/VoiceNote.tsx — posts
// `m.spoken`, which is the payload brain.ts already lifted out of a
// [voicenote: …] tag, so step 1 still holds there.
//
// So by the time this runs, every bracket that MEANT something has already been
// consumed. That is precisely what licenses rule B below to drop a surviving
// bracket segment whole: a bracket this module sees is residue or a leak, never
// an instruction anybody still needs. Reverse the order and that rule would eat
// a [forget: …] before it was honoured, which is the one failure this repo
// calls unrecoverable. **Tags first, then this.**
//
// ── WHAT THIS CANNOT REACH ──
// The live call lane (`gemini-3.1-flash-live-preview`) is speech-to-speech:
// there is no text step between her tokens and the audio, so no sanitiser can
// stand there. On that lane the dash can only be fixed in persona.ts. This
// module covers every lane that synthesises FROM TEXT — the cascade (both
// arms), voice notes, and the live lane's backchannel clips.
//
// Deliberately dependency-free and side-effect-free so the mirrored copy in
// api/speech.js can be byte-identical (see `scripts/verify-voice.mjs`, which
// fails the build if the two drift).

/* ─── SPOKEN-TEXT CORE — MIRRORED VERBATIM INTO api/speech.js ───────────────
   Do not edit one copy. `node scripts/verify-voice.mjs` compares the two
   regions character for character and fails when they differ. A Vercel
   function cannot import TypeScript (see scripts/build-engine-bundle.mjs's
   header for the same constraint), and this is small enough that mirroring it
   beats generating it — the house pattern is MIRROR, then assert. */
const SPOKEN_RULES_VERSION = "st1";

function spokenTextCore(input = "") {
  if (typeof input !== "string" || !input) return "";
  let t = input;

  // A. INVISIBLES AND ENTITIES — normalised.
  // Zero-width joiners and soft hyphens are invisible on screen and are read by
  // some engines as a break mid-word; non-breaking spaces are just spaces.
  t = t.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "");
  t = t.replace(/[\u00A0\u2007\u202F]/g, " ");
  // Decoded to the CHARACTER, never to a word: "&" is spoken "and" by every
  // engine on its own, and putting the word there ourselves would be text she
  // never wrote.
  t = t
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;|&gt;/gi, " ");

  // B. PROTOCOL SEGMENTS — the whole segment DROPPED, brackets and contents.
  // Justified only by the ordering above: every bracket that carried meaning
  // has already been parsed and acted on, so what is left is a leaked marker or
  // a stage direction, and `ack-bracket-direction` measured what happens to
  // those — they are performed as words. <…> is this app's own machine framing
  // (liveCall.ts `direct()` sends "<context: …>"); {…} is template residue.
  // Bounded lengths so a stray opener cannot swallow a whole reply.
  t = t.replace(/<[^<>\n]{0,200}>/g, " ");
  t = t.replace(/\{[^{}\n]{0,200}\}/g, " ");
  t = t.replace(/\[[^\][\n]{0,200}\]/g, " ");
  // An UNCLOSED tag at the very end is the truncation case brain.ts already
  // guards for its own path; a synthesiser hands back "bracket laughs".
  t = t.replace(/\[[^\][\n]{0,40}$/, " ");

  // C. URLs — the PROTOCOL removed, the address KEPT.
  // Not dropped, and this is a safety decision rather than a stylistic one. The
  // crisis-helpline block this repo protects with an invariant suite can carry
  // an address, and on a call the spoken copy is the ONLY copy — deleting it
  // would delete the helpline. "aasra.info" is said fine by every engine;
  // "h-t-t-p-s colon slash slash" is what actually had to go.
  t = t.replace(/\bhttps?:\/\/(?:www\.)?/gi, " ").replace(/\bwww\./gi, " ");

  // D. LINE STRUCTURE — the MARKER removed, the ITEM kept, joined as a list.
  // Runs BEFORE the dash rule on purpose: a line-leading "- " is a bullet, not
  // a dash, and treating it as one would put a comma in front of every item.
  t = t.replace(/^[ \t]*([-*_=\u2014\u2013]{3,})[ \t]*$/gm, " ");
  t = t.replace(/^[ \t]*#{1,6}[ \t]+/gm, "");
  t = t.replace(/^[ \t]*>[ \t]?/gm, "");
  t = t.replace(/^[ \t]*(?:[-*+\u2022\u00B7\u25AA\u2023\u25E6][ \t]+|\d{1,2}[.)][ \t]+)/gm, "");
  t = t.replace(/[\u2022\u00B7\u25AA\u2023\u25E6]/g, ", ");

  // E. MARKDOWN EMPHASIS — the MARKERS removed, the WORDS kept.
  // Not the same class as a stage direction: "*shrugs*" is an action the
  // caller's stripProtocol already dropped, but "**sach**" is emphasis on a
  // real word and deleting the word loses what she said. The opener has to sit
  // on a boundary so `snake_case` is not mistaken for emphasis.
  t = t.replace(/`{1,3}/g, " ");
  t = t.replace(/(^|[\s(,.!?;:"'])(\*\*|__)(?=\S)([\s\S]*?\S)\2/g, "$1$3");
  t = t.replace(/(^|[\s(,.!?;:"'])([*_])(?=\S)([^*_\n]*?\S)\2(?![\w])/g, "$1$3");
  // Anything still standing is not a word: an asterisk is a spoken asterisk.
  // An underscore is only removed at a word EDGE, where it is leftover markup —
  // one BETWEEN two word characters is part of an address or a name
  // ("priya_sharma@gmail.com") and "underscore" is exactly what a person says
  // for it, so removing it there would break the thing it is holding together.
  t = t.replace(/\*+/g, " ").replace(/(?<!\w)_+|_+(?!\w)/g, " ");

  // F. DASHES — REPLACED with the spoken equivalent, which is a PAUSE.
  // This is the reported bug, and the reason it is a replace and not a delete:
  // an em-dash between clauses is how she was told to cut herself off, so it
  // carries real timing. Delete it and two clauses run together breathlessly;
  // keep it and the engine says "dash". A comma is the pause token every
  // synthesiser here already honours.
  //
  // THE TRAP, and where the line is drawn. A hyphen INSIDE a word is a
  // spelling, not a dash: "well-known", "e-mail", "T-shirt", "1800-599-0019".
  // Those are never touched. Only a dash that is punctuation gets replaced —
  // the true dash characters, a doubled ASCII hyphen, or a single hyphen with
  // whitespace on both sides.
  t = t.replace(/\s*[\u2012-\u2015]+\s*$/g, "");
  t = t.replace(/[\u2012-\u2015]+/g, ", ");
  t = t.replace(/\s*-{2,}\s*/g, ", ");
  t = t.replace(/ +- +/g, ", ");
  t = t.replace(/[ ,]*-+\s*$/g, "");

  // G. ARROWS — REPLACED with a pause, never with a word.
  // "→" most often means "then" or "to", but which one is a guess, and putting
  // a word she did not write into her mouth is the thing this repo calls
  // fabrication. A pause keeps the sentence intact and invents nothing.
  t = t.replace(/[\u2190-\u21FF\u27F0-\u27FF\u2B00-\u2B11]+/g, ", ");
  t = t.replace(/(^|\s)(?:->|<-|=>|<=>|<->)(\s|$)/g, ", ");
  // A pipe is the same class — a separator that some engines announce as
  // "vertical bar". It never carries meaning she said out loud.
  t = t.replace(/\s*\|+\s*/g, ", ");

  // H. PARENTHESES — the WORDS kept, the brackets become pauses.
  // Different from rule B and deliberately so: a parenthetical is an aside a
  // person actually says out loud, so dropping the segment would drop real
  // speech. Only the punctuation is a writing convention.
  t = t.replace(/\s*[([]\s*/g, ", ").replace(/\s*[)\]]\s*/g, ", ");

  // I. EMOJI AND PICTOGRAPHS — DROPPED.
  // Engines disagree: some skip them, some announce the Unicode name aloud
  // ("face with tears of joy"). There is no spoken equivalent to substitute,
  // and her laughter is already written out as "hahaha" by her brief, so
  // nothing is lost by removing them.
  t = t.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2B55}\u{FE0F}\u{20E3}\u{2764}\u{2049}\u{203C}]/gu,
    " ",
  );

  // J. ELLIPSES — KEPT, only absurd runs capped.
  // NOT a writing convention here: "..." is load-bearing prosody in this
  // product. persona.ts uses it as her softness and speech.ts turns it into an
  // explicit thinking pause, and `stripTagsForPlainVoice` deliberately POSTs
  // "…" to this very endpoint in place of a tag. Removing it would flatten her.
  t = t.replace(/\.{4,}/g, "…").replace(/…{2,}/g, "…");

  // K. TIDY. Collapsing the debris the rules above leave behind — doubled
  // separators, a comma before a full stop, a phrase that now starts on
  // punctuation.
  t = t.replace(/[ \t]*\n[ \t]*/g, ", ");
  t = t.replace(/\s+/g, " ");
  t = t.replace(/\s+([,.;:!?…])/g, "$1");
  t = t.replace(/([,;:])(?:\s*[,;:])+/g, "$1");
  t = t.replace(/([,;:])\s*(?=[.!?…])/g, "");
  t = t.replace(/^[\s,;:.!?…]+/, "");
  t = t.replace(/[ ,;:]+$/, "");
  t = t.trim();

  // L. NOTHING SPEAKABLE LEFT. A reply that was only a tag, only emoji or only
  // a separator must produce SILENCE, not a synthesiser reading punctuation.
  // The caller is expected to refuse rather than send this upstream.
  if (!/[\p{L}\p{N}]/u.test(t)) return "";
  return t;
}
/* ─── END SPOKEN-TEXT CORE ─────────────────────────────────────────────── */

/**
 * Turn one string of her written reply into the string a synthesiser should be
 * given. Apply at the point text becomes speech and nowhere else — the copy
 * shown in the chat must stay exactly as she wrote it.
 *
 * Returns "" when nothing speakable survives; callers must treat that as
 * "say nothing", never as "synthesise an empty string".
 */
export const spokenText: (text: string) => string = spokenTextCore;

/* ─── THE ONE ENGINE THAT PERFORMS BRACKETS ──────────────────────────────
   Rule B drops `[...]` whole, and that is right for every synthesiser in this
   product EXCEPT ElevenLabs v3, which actually performs `[laughs]`, `[sighs]`,
   `[whispers]` as sound. speech.ts routes a tagged reply TO that engine on
   purpose (`preferEleven = hasAudioTags(text) …`), so handing it the plain
   sanitiser would delete the exact thing it was chosen for — the routing would
   still steer, and there would be nothing left to perform.

   This is NOT a second rule set, and that distinction is the whole reason it
   is written this way: the tags are cut OUT of the string, every remaining
   segment goes through `spokenTextCore` — the same function, the same rules —
   and the tags are put back untouched. A second implementation of the rules is
   a second persona by another name (`context/rejected.md#age-tier-never-realtime`),
   so there is exactly one, and this only decides what it is pointed at.

   `ack-bracket-direction` is why the tag pattern is narrow. `[laughs softly]`
   came back as laughter PLUS the spoken word "Softly", so what survives here
   is only the SHORT, single-word-ish audio tag shape that `speech.ts`'s own
   `hasAudioTags`/`stripTagsForPlainVoice` already treat as performable —
   letters and spaces, 2–16 chars. Anything longer is a stage direction and
   rule B still eats it.

   KNOWN AND ACCEPTED: punctuation immediately after a tag is absorbed
   ("arre [laughs], sach" → "arre [laughs] sach"), because each segment is
   tidied at its own edges. A lost comma next to a performed laugh is a smaller
   loss than a spoken "laughs", and the alternative — masking tags behind a
   sentinel token — risks the sentinel itself being SAID if a rule ever touches
   it, which is the failure this module exists to prevent. */
const AUDIO_TAG_SPLIT = /(\[[a-z][a-z ]{0,14}[a-z]\])/gi;
const AUDIO_TAG_ONLY = /^\[[a-z][a-z ]{0,14}[a-z]\]$/i;

/**
 * The sanitiser for a synthesiser that PERFORMS audio tags. Identical to
 * `spokenText` except that short `[audio tags]` are preserved verbatim.
 *
 * Returns "" when nothing survives — not even a tag — so the caller refuses,
 * exactly as with `spokenText`.
 */
export function spokenTextKeepingAudioTags(text: string): string {
  if (typeof text !== "string" || !text) return "";
  const parts = text.split(AUDIO_TAG_SPLIT);
  let kept = 0;
  const out: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (AUDIO_TAG_ONLY.test(part)) {
      kept++;
      out.push(part);
      continue;
    }
    const said = spokenTextCore(part);
    if (said) out.push(said);
  }
  const joined = out
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?…])/g, "$1")
    .trim();
  // Nothing speakable AND nothing performable — the caller must say nothing.
  if (!kept && !/[\p{L}\p{N}]/u.test(joined)) return "";
  return joined;
}

/** Bumped whenever the rules above change, so a production sample can say
 *  which version of them it was spoken under (api/speech.js returns it as
 *  `X-Meera-Rules`). */
export { SPOKEN_RULES_VERSION };
