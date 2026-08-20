// The spoken-text sanitiser's case battery.
//
//   node evals/voice/spoken.mjs
//
// Run as part of `node scripts/verify-voice.mjs`, which is itself a gate in
// `scripts/verify-release.mjs`. Bundled from the REAL src/voice/spokenText.ts
// on every run for the same reason evals/run.mjs does it: a frozen copy passes
// forever while the source rots.
//
// TWO KINDS OF CASE, and the second kind is the point.
//
//   POSITIVE  a string that SHOULD be transformed, with the exact expected
//             output. A rule that fires is easy to believe in.
//   NEGATIVE  a string that must come back UNTOUCHED. This is the whole risk
//             of a sanitiser: over-stripping is silent. Delete every dash and
//             you have deleted "well-known" and "1800-599-0019"; strip every
//             bracket and you have deleted a crisis helpline's address.
//
// The helpline cases are here on purpose. `evals/persona-invariants.mjs`
// protects the helplines in the text she WRITES; nothing protected them in the
// text she SAYS, and on a call the spoken copy is the only copy there is.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rmSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const BUNDLE = join(HERE, `.spoken.${process.pid}.bundle.mjs`); // pid-scoped: concurrent runs must not delete each other's bundle

execFileSync(
  "npx",
  [
    "esbuild",
    join(ROOT, "src/voice/spokenText.ts"),
    "--bundle",
    "--format=esm",
    "--platform=node",
    `--outfile=${BUNDLE}`,
    "--log-level=error",
  ],
  { stdio: "inherit", cwd: ROOT },
);

const { spokenText, spokenTextKeepingAudioTags, SPOKEN_RULES_VERSION } = await import(
  `file://${BUNDLE}`
);

/** [what it proves, input, expected output] */
const POSITIVE = [
  // ── the reported bug ──
  ["em-dash between clauses becomes a pause, not the word 'dash'",
    "haan yaar — main aa rahi hu", "haan yaar, main aa rahi hu"],
  ["two em-dashes in one line — the 'Dash dash' report",
    "arre — sun na — kal chalein?", "arre, sun na, kal chalein?"],
  ["en-dash likewise", "socha tha – phir nahi gayi", "socha tha, phir nahi gayi"],
  ["ASCII double hyphen is the same convention",
    "matlab -- pata nahi", "matlab, pata nahi"],
  ["a lone hyphen with space on both sides is a dash, not a spelling",
    "bas - chhod na", "bas, chhod na"],
  ["a trailing cut-off dash just ends the utterance",
    "chhod, yeh bata—", "chhod, yeh bata"],
  ["trailing ASCII hyphen too", "nahi main bol-", "nahi main bol"],

  // ── bracket-shaped text (ack-bracket-direction) ──
  ["a stage direction is dropped whole, never performed as a word",
    "[laughs softly] arre wah", "arre wah"],
  ["a leaked protocol marker is dropped whole",
    "[tone: low, gentle] kya hua", "kya hua"],
  ["a [forget: ...] leak never reaches the speaker",
    "theek hai [forget: uska naam]", "theek hai"],
  ["an unclosed tag at the end is dropped, not read",
    "acha suno [laughs", "acha suno"],
  ["machine framing in angle brackets is dropped whole",
    "<context: look at their screen> dekh yeh", "dekh yeh"],
  ["template residue is dropped whole", "hi {name} kaise ho", "hi kaise ho"],

  // ── markdown ──
  ["bold markers go, the emphasised word stays", "yeh **sach** mein hua", "yeh sach mein hua"],
  ["italic markers go, the word stays", "main *bilkul* thak gayi", "main bilkul thak gayi"],
  ["underscore emphasis likewise", "woh _bahut_ acha tha", "woh bahut acha tha"],
  ["a stray asterisk is never a word", "arre * kya", "arre kya"],
  ["code fences and backticks are not sounds", "bol na `haan` bol", "bol na haan bol"],

  // ── list and line structure ──
  ["bullets become a spoken list, the items survive",
    "• doodh\n• cheeni\n• chai", "doodh, cheeni, chai"],
  ["dash bullets are bullets, not dashes",
    "- doodh\n- cheeni", "doodh, cheeni"],
  ["numbered items keep the item, drop the numbering",
    "1. doodh\n2. cheeni", "doodh, cheeni"],
  ["a heading marker is not spoken", "## plan\nkal milte hain", "plan, kal milte hain"],
  ["a horizontal rule / bubble separator is not spoken",
    "haan\n---\nkal baat karte hain", "haan, kal baat karte hain"],

  // ── the rest of the class ──
  ["an arrow becomes a pause and never invents a word",
    "ghar → office → ghar", "ghar, office, ghar"],
  ["an ASCII arrow likewise", "pehle chai -> phir baat", "pehle chai, phir baat"],
  ["a parenthetical keeps its words and loses its brackets",
    "aa jaungi (shayad) kal", "aa jaungi, shayad, kal"],
  ["emoji are dropped — some engines say their names out loud",
    "hahaha 😂😂 pagal hai tu", "hahaha pagal hai tu"],
  ["a URL loses its protocol and keeps its address",
    "dekh https://meera-silk.vercel.app/chat pe", "dekh meera-silk.vercel.app/chat pe"],
  ["www. is protocol too", "www.aasra.org.in pe jaa", "aasra.org.in pe jaa"],
  ["an HTML entity is decoded to its character, not to a word",
    "tu &amp; main", "tu & main"],
  ["a pipe separator becomes a pause",
    "iCall: 9152987821 | Vandrevala: 9999666555",
    "iCall: 9152987821, Vandrevala: 9999666555"],
  ["markdown underscores at a word edge are markup",
    "woh _bahut_ acha tha", "woh bahut acha tha"],
  ["absurd dot runs cap to one ellipsis", "acha......... theek hai", "acha… theek hai"],

  // ── nothing speakable ──
  ["a reply that was only a tag produces silence, not punctuation", "[laughs]", ""],
  ["a reply that was only emoji produces silence", "😂😂", ""],
  ["a reply that was only a separator produces silence", "---", ""],
  ["an empty string stays empty", "", ""],
];

/** [what it proves, string that must survive byte for byte] */
const NEGATIVE = [
  // THE hyphen control. Delete every dash and every one of these breaks.
  ["a hyphenated word is a spelling, not a dash", "woh well-known jagah hai"],
  ["a compound number keeps its hyphen", "twenty-two log aaye the"],
  ["e-mail keeps its hyphen", "mujhe e-mail kar dena"],
  ["T-shirt keeps its hyphen", "naya T-shirt liya"],
  ["a hyphenated Hinglish compound survives", "thoda so-so tha yaar"],
  ["an underscore BETWEEN word characters holds an address together",
    "meri e-mail id priya_sharma@gmail.com hai"],
  ["a snake_case token is not silently re-spaced", "snake_case_name"],

  // THE helpline controls. These are what the invariant suite protects in
  // writing; this is the same protection for speech.
  ["a crisis helpline number survives untouched", "AASRA: 9820466726"],
  ["a hyphenated helpline number survives untouched", "Kiran helpline: 1800-599-0019"],
  ["two helplines in one line survive", "iCall 9152987821, Vandrevala 9999666555"],

  // Ordinary speech must be inert.
  ["ordinary Hinglish is untouched", "kal shaam ko chai peene chalein?"],
  ["her written-out laughter is untouched", "hahaha nahi yaar, sach mein"],
  ["her ellipsis prosody is untouched — it IS her softness", "haan… pata nahi…"],
  ["her stretched vowels are untouched", "nahiii mat karo aisa"],
  ["a question mark run is untouched", "kya?? sach mein??"],
  ["a decimal and a time survive", "3.30 baje, 2.5 ghante"],
  ["an apostrophe survives", "it's fine, don't worry"],
];

let fail = 0;
const show = (s) => JSON.stringify(s);

console.log(`  rules ${SPOKEN_RULES_VERSION}`);
console.log(`\n  ── positive: text that MUST be transformed (${POSITIVE.length}) ──`);
for (const [why, input, want] of POSITIVE) {
  const got = spokenText(input);
  if (got === want) {
    console.log(`  ok    ${why}`);
  } else {
    fail++;
    console.log(`  FAIL  ${why}\n          in   ${show(input)}\n          want ${show(want)}\n          got  ${show(got)}`);
  }
}

console.log(`\n  ── negative: text that MUST survive untouched (${NEGATIVE.length}) ──`);
for (const [why, input] of NEGATIVE) {
  const got = spokenText(input);
  if (got === input) {
    console.log(`  ok    ${why}`);
  } else {
    fail++;
    console.log(`  FAIL  ${why} — over-stripped\n          in  ${show(input)}\n          got ${show(got)}`);
  }
}

/* ── THE ONE ENGINE THAT PERFORMS BRACKETS ───────────────────────────────
   ElevenLabs v3 actually performs `[laughs]`, and src/voice/speech.ts routes a
   TAGGED reply to it on purpose. Handing that door the plain sanitiser would
   delete the one thing the routing chose it for. So the tag-keeping variant
   has to prove two opposite things at once: the tags survive, and every OTHER
   writing convention is stripped by the same rules as everywhere else. It is
   the same `spokenTextCore` either way — the tags are cut out, the segments go
   through it, the tags go back. */
const TAGGED = [
  ["a dash AWAY from a tag still becomes a pause",
    "[laughs] arre — sach mein", "[laughs] arre, sach mein"],
  // The documented tradeoff, pinned so it is a known behaviour and not a
  // surprise: each segment is tidied at its own edges, so punctuation directly
  // against a tag is absorbed. Harmless here — the tag IS a pause — and much
  // safer than masking tags behind a sentinel token that could itself be SAID.
  ["punctuation hard against a tag is absorbed by it",
    "arre [laughs] — sach mein", "arre [laughs] sach mein"],
  ["two tags survive", "[sighs] pata nahi [laughs]", "[sighs] pata nahi [laughs]"],
  ["markdown around a tag is still stripped",
    "yeh **sach** [laughs] mein", "yeh sach [laughs] mein"],
  ["a tag-only reply is still performable, so it is NOT silence", "[laughs]", "[laughs]"],
  ["a LONG bracket is a stage direction, not an audio tag, and is dropped",
    "[she pauses for a long moment] acha", "acha"],
  ["a protocol marker with a colon is dropped even here",
    "[tone: low, gentle] kya hua", "kya hua"],
  ["an emoji-only reply is silence on this door too", "😂😂", ""],
  ["a helpline still survives untouched beside a tag",
    "[softly] Kiran: 1800-599-0019", "[softly] Kiran: 1800-599-0019"],
];

console.log(`\n  ── tag-keeping door (ElevenLabs v3 only) (${TAGGED.length}) ──`);
for (const [why, input, want] of TAGGED) {
  const got = spokenTextKeepingAudioTags(input);
  if (got === want) {
    console.log(`  ok    ${why}`);
  } else {
    fail++;
    console.log(`  FAIL  ${why}\n          in   ${show(input)}\n          want ${show(want)}\n          got  ${show(got)}`);
  }
}

// IDEMPOTENCE. The same string can pass this seam twice (a phrase is
// synthesised, then re-synthesised by the hedge or the complete-file fallback),
// and a rule that keeps eating on each pass would quietly shorten her.
console.log("\n  ── idempotence ──");
let notIdem = 0;
for (const [, input] of [...POSITIVE, ...NEGATIVE]) {
  const once = spokenText(input);
  if (spokenText(once) !== once) {
    notIdem++;
    console.log(`  FAIL  not idempotent: ${show(input)} -> ${show(once)} -> ${show(spokenText(once))}`);
  }
}
// The tag-keeping door has the same obligation, and a stronger reason for it:
// it JOINS segments back together, so a rule that shifted a space or ate a
// comma on each pass would shorten her a little more every time a phrase was
// re-synthesised.
for (const [, input] of TAGGED) {
  const once = spokenTextKeepingAudioTags(input);
  if (spokenTextKeepingAudioTags(once) !== once) {
    notIdem++;
    console.log(
      `  FAIL  tag-keeping not idempotent: ${show(input)} -> ${show(once)} -> ${show(spokenTextKeepingAudioTags(once))}`,
    );
  }
}
if (!notIdem)
  console.log(
    `  ok    all ${POSITIVE.length + NEGATIVE.length + TAGGED.length} cases are fixed points after one pass`,
  );
fail += notIdem;

rmSync(BUNDLE, { force: true });

const total = POSITIVE.length + NEGATIVE.length + TAGGED.length;
console.log(
  fail
    ? `\nspoken-text: ${fail} FAILED of ${total} cases (+ idempotence)`
    : `\n  ok  spoken-text: ${POSITIVE.length} positive + ${NEGATIVE.length} negative + ${TAGGED.length} tag-keeping cases, all idempotent`,
);
process.exit(fail ? 1 : 0);
