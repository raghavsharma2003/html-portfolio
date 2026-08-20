// HER VOICE IS ONE VOICE — three things have to be true, and they are three
// DIFFERENT things. This file checks all three because the first one alone was
// checked, passed, and the owner still reported her voice changing.
//
//   1. NAME     every lane that names her voice names the same one.
//   2. MODEL    every lane records WHICH MODEL speaks it, and any divergence
//               is declared here rather than discovered in production.
//   3. SPEECH   the text handed to a synthesiser has had its WRITING
//               conventions removed, by rules that cannot drift between the
//               module and the serverless mirror of it.
//
// ── 1. NAME — why this existed first ──────────────────────────────────────
// This bug already shipped once, and api/speech.js's own header is the
// incident report:
//
//   "This default was Leda, so a call that started live (Aoede) and fell back
//    to the cascade (Leda) swapped her for a different woman mid-sentence, and
//    screen share — where the live→cascade handoff is most likely — was where
//    it was heard: 'two or three different voices', reported as multiple
//    personalities. Both lanes were working exactly as designed; they just
//    disagreed about who she was."
//
// That comment then asks the next person to "move it HERE and in the two live
// speechConfigs together — liveCall.ts and LiveWatchEngine.java — or this comes
// straight back". A comment asking for discipline is not a mechanism. This is.
//
// The house pattern for a constant that cannot be imported across a boundary
// is: MIRROR it, then assert the mirrors agree on every run. OPERATIONAL_CORE_CAP
// does it between api/chat.js and compiler.ts; MEERA_AGENT_ID does it across a
// migration, db/schema.sql and the agent registry. Her voice is the same shape
// of constant — the live lanes CANNOT be configured (Gemini Live and the native
// watch engine speak Aoede and there is no setting that changes them), so every
// lane that CAN choose has to match them or she changes voice mid-conversation.
//
// Deliberately NOT importing anything: api/speech.js is a serverless function
// with server secrets, liveCall.ts is a browser module, and LiveWatchEngine.java
// is Java. Source-text assertion is the only mechanism that spans all three.
//
// ── 2. MODEL — why check 1 was not enough ─────────────────────────────────
// The name check passes today and the owner still hears her voice change in
// screen share. The reason the name check cannot catch it: **the same voice
// name on a different model is a different voice.** The lanes deliberately run
// different models — a speech-to-speech dialog model for the live call, a TTS
// model for the cascade — and nothing recorded that, so a timbre change had no
// name and no owner. This section gives it both. It does NOT assert the models
// are equal (they cannot be); it asserts every model in the product is one this
// file has DECLARED, so a divergence is a decision somebody wrote down rather
// than a surprise. See docs/VOICE-LANE.md for the reasoning and the open
// measurement.

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(ROOT + p, "utf8");

let fail = 0;
const FAIL = (line, ...rest) => {
  console.log(`  FAIL  ${line}`);
  for (const r of rest) console.log(`        ${r}`);
  fail++;
};

/* ══ 1. HER VOICE NAME ═══════════════════════════════════════════════════ */

/** Sites that name her voice. Each is (file, regex capturing the voice name,
 *  what it governs) — the third field is what the failure message says, so a
 *  breakage explains itself rather than pointing at a line number. */
const SITES = [
  {
    file: "api/speech.js",
    re: /const DEFAULT_VOICE = "([A-Za-z]+)"/,
    governs: "the cascade TTS fallback — the lane a call falls back TO",
  },
  {
    file: "src/voice/liveCall.ts",
    re: /const ACK_VOICE = "([A-Za-z]+)"/,
    governs: "the acknowledgement clips played during a live call",
  },
  {
    file: "src/voice/liveCall.ts",
    re: /prebuiltVoiceConfig:\s*\{\s*voiceName:\s*"([A-Za-z]+)"\s*\}/,
    governs: "the Gemini Live session itself — the lane a call starts ON",
  },
];

/** The native watch engine is Java and is not always present in a checkout
 *  (android/ is excluded from some tooling). Checked when it exists, reported
 *  as skipped when it does not — a silent skip is how a mirror drifts. */
const NATIVE = {
  file: "android/app/src/main/java/app/meera/companion/LiveWatchEngine.java",
  re: /voiceName"?\s*[,:]\s*"([A-Za-z]+)"/,
  governs: "the native live watch engine",
};

console.log("── 1. her voice NAME ──");
const found = [];

for (const site of SITES) {
  const src = read(site.file);
  const m = src.match(site.re);
  if (!m) {
    FAIL(`${site.file}: no voice literal matched — the pattern moved, so this guard is no longer guarding anything`);
    continue;
  }
  found.push({ ...site, voice: m[1] });
}

const nativePresent = existsSync(ROOT + NATIVE.file);
if (nativePresent) {
  const m = read(NATIVE.file).match(NATIVE.re);
  if (m) found.push({ ...NATIVE, voice: m[1] });
  else console.log(`  note  ${NATIVE.file} present but no voice literal matched — check by hand`);
} else {
  console.log(`  note  ${NATIVE.file} not in this checkout — skipped`);
}

const voices = [...new Set(found.map((f) => f.voice))];

for (const f of found) console.log(`  ok    ${f.voice.padEnd(8)} ${f.file} — ${f.governs}`);

if (voices.length > 1) {
  FAIL(
    `her voice disagrees across lanes: ${voices.join(", ")}`,
    "A call that starts on one lane and falls back to another will swap her",
    "for a different woman mid-sentence. This exact bug shipped once and was",
    "reported as 'multiple personalities' — see api/speech.js's header.",
  );
}

// The allow-list must contain whatever the lanes agreed on, or a request that
// names her own voice gets rejected as invalid.
if (voices.length === 1) {
  const allowed = read("api/speech.js").match(/const ALLOWED_VOICES = new Set\(\[([^\]]*)\]\)/);
  if (allowed && !allowed[1].includes(`"${voices[0]}"`)) {
    FAIL(`ALLOWED_VOICES does not contain ${voices[0]} — her own voice would be refused`);
  }
  console.log(`  ok    one name: ${voices[0]} on all ${found.length} lanes that name it`);
}

/* ══ 2. WHICH MODEL SPEAKS IT ════════════════════════════════════════════ */
//
// A model literal that is not in this table fails the run. That is the whole
// invariant: her voice may be produced by more than one model — it has to be,
// the live lane is speech-to-speech and the cascade is TTS — but every one of
// them is DECLARED, with what it governs and why it differs. An undeclared
// model is how `gemini-2.5-flash-native-audio-latest` could speak to a user on
// a lane nobody was watching, three bake-offs after this repo measured and
// rejected it (context/measurements.md `live-model-bake`: 0/24 barge-in).
//
// To move a model: change the literal AND this table together, and say in
// docs/VOICE-LANE.md what it does to her timbre. There is no way to do one
// without the other, which is the point.
const DECLARED = {
  "gemini-3.1-flash-live-preview": {
    lanes: "the live call, and the native watch engine when the token names it",
    why: "speech-to-speech; the only bidi-audio model that accepts video AND makes the 600ms barge-in signal (`live-model-swap`)",
  },
  "gemini-3.1-flash-tts-preview": {
    lanes: "the cascade TTS, free arm (direct) and paid arm (via OpenRouter)",
    why: "text-to-speech; the only arm that can stream, and the lane a call falls back TO",
  },
  "gemini-2.5-flash-native-audio-latest": {
    lanes: "the native watch engine's LAST-RESORT default, if /api/live-token ever answers without a model",
    why: "MEASURED AND REJECTED for the live lane (0/24 barge-in, `live-model-bake`). Declared so it is visible, not so it is endorsed — api/live-token.js always sends a model, so this fires only on a malformed response. Removing it needs an android/ change and is not this file's to make.",
  },
};

/** Every place a model that produces her VOICE is named. */
const MODEL_SITES = [
  {
    file: "api/live-token.js",
    re: /export const LIVE_MODEL = "([^"]+)"/,
    governs: "the live call session (liveCall.ts and LiveWatchEngine.java both take it from the token response)",
  },
  {
    file: "api/speech.js",
    re: /^const MODEL = "([^"]+)"/m,
    governs: "the cascade paid arm (OpenRouter)",
  },
  {
    file: "api/speech.js",
    re: /^const FREE_MODEL = "([^"]+)"/m,
    governs: "the cascade free arm (Google direct, SSE)",
  },
];
const NATIVE_MODEL = {
  file: NATIVE.file,
  re: /DEFAULT_MODEL\s*=\s*"([^"]+)"/,
  governs: "the native watch engine's fallback if the token response carries no model",
};

/** OpenRouter prefixes its ids with the vendor and Google prefixes its own with
 *  "models/". Same model, three spellings — compare the bare id. */
const bare = (id) => id.replace(/^models\//, "").replace(/^[a-z-]+\//, "");

console.log("\n── 2. which MODEL speaks it ──");
const models = [];
for (const site of MODEL_SITES) {
  const m = read(site.file).match(site.re);
  if (!m) {
    FAIL(`${site.file}: no model literal matched — the pattern moved, so this guard is no longer guarding anything`);
    continue;
  }
  models.push({ ...site, model: bare(m[1]), raw: m[1] });
}
if (nativePresent) {
  const m = read(NATIVE_MODEL.file).match(NATIVE_MODEL.re);
  if (m) models.push({ ...NATIVE_MODEL, model: bare(m[1]), raw: m[1] });
  else console.log(`  note  ${NATIVE_MODEL.file} present but no DEFAULT_MODEL literal matched — check by hand`);
}

for (const m of models) {
  if (DECLARED[m.model]) console.log(`  ok    ${m.model.padEnd(38)} ${m.governs}`);
  else
    FAIL(
      `UNDECLARED model ${m.raw} in ${m.file}`,
      `governs: ${m.governs}`,
      "Her voice is produced by this and nothing in the repo says so. The same",
      "voice NAME on a different model is a DIFFERENT VOICE — that is the half",
      "of the 'multiple personalities' report the name check above cannot see.",
      "Add it to DECLARED here and to docs/VOICE-LANE.md, or put it back.",
    );
}

// The two cascade arms race each other inside ONE request, and a long reply is
// split into phrases that each race again — so if they ever named different
// models, a single reply could be spoken half by one voice and half by another.
const freeArm = models.find((m) => /FREE_MODEL/.test(m.re.source));
const paidArm = models.find((m) => /^const MODEL/.test(m.re.source));
if (freeArm && paidArm && freeArm.model !== paidArm.model) {
  FAIL(
    `the cascade's two arms name different models: ${freeArm.raw} vs ${paidArm.raw}`,
    "They race inside one request (PAID_ARM_MS) and a multi-phrase reply races",
    "again per phrase, so this would change her voice BETWEEN HER OWN SENTENCES.",
  );
} else if (freeArm && paidArm) {
  console.log(`  ok    both cascade arms are ${freeArm.model} — one reply cannot be split across two voices`);
}

const distinct = [...new Set(models.map((m) => m.model))];
console.log(
  `  note  ${distinct.length} distinct models produce her voice. This is DELIBERATE and is why the`,
);
console.log("        name check above cannot prove she sounds the same — see docs/VOICE-LANE.md.");

/* ══ 3. WHAT THE SYNTHESISER IS HANDED ═══════════════════════════════════ */
//
// Her written text and her spoken text are the same string today, so every
// writing convention in it gets read out loud: the owner's report was "saying
// Dash dash in voice call". src/voice/spokenText.ts is the seam that separates
// them, and api/speech.js carries a verbatim mirror of its core because a
// Vercel function cannot import TypeScript. Two copies of a regex battery is
// exactly the drift this file's whole pattern exists to stop.

const REGION = /\/\* ─── SPOKEN-TEXT CORE[\s\S]*?\/\* ─── END SPOKEN-TEXT CORE ─+ \*\//;

console.log("\n── 3. what the synthesiser is HANDED ──");
const tsRegion = read("src/voice/spokenText.ts").match(REGION);
const jsRegion = read("api/speech.js").match(REGION);

if (!tsRegion) FAIL("src/voice/spokenText.ts: the SPOKEN-TEXT CORE markers are gone — nothing is being compared");
else if (!jsRegion)
  FAIL(
    "api/speech.js: the SPOKEN-TEXT CORE mirror is missing",
    "Without it the serverless lane speaks her punctuation out loud again.",
  );
else if (tsRegion[0] !== jsRegion[0]) {
  const a = tsRegion[0].split("\n");
  const b = jsRegion[0].split("\n");
  const at = a.findIndex((l, i) => l !== b[i]);
  FAIL(
    "the spoken-text core has DRIFTED between src/voice/spokenText.ts and api/speech.js",
    `first difference at line ${at + 1} of the region:`,
    `  ts: ${JSON.stringify(a[at] ?? "<missing>")}`,
    `  js: ${JSON.stringify(b[at] ?? "<missing>")}`,
    "Edit src/voice/spokenText.ts and copy the whole region across; they are",
    "compared character for character on purpose.",
  );
} else {
  console.log(`  ok    the core is byte-identical in both copies (${tsRegion[0].length} chars)`);
}

// It is not enough that the two copies agree — they have to be RIGHT. The case
// battery carries the negative controls that matter: a hyphenated word and a
// crisis helpline number that must survive an over-eager dash rule.
try {
  execFileSync("node", [ROOT + "evals/voice/spoken.mjs"], { cwd: ROOT, stdio: "inherit" });
} catch {
  FAIL("evals/voice/spoken.mjs failed — the sanitiser's own case battery is red (see above)");
}

/* ══ 4. WHY THE LIVE LANE IS NOT WIRED TO THE SANITISER ══════════════════ */
//
// `grep spokenText src/voice/liveCall.ts` returns nothing, and that looks like
// the primary voice lane was forgotten. It was not. Written down here because
// the next person will grep, find nothing, and "fix" it.
//
// EVERY PATH ON THE LIVE LANE WHERE TEXT MEETS AUDIO:
//
//   her own voice          `serverContent.modelTurn.parts[].inlineData.data`
//                          is AUDIO. `gemini-3.1-flash-live-preview` is
//                          speech-to-speech: the characters she emits are
//                          turned into sound INSIDE the server and the client
//                          never sees them before they are already a waveform.
//                          There is no string to sanitise. If she says a dash
//                          on this lane, the only place that can be fixed is
//                          persona.ts — see docs/VOICE-LANE.md.
//   her transcript         `outputAudioTranscription` → `onHerText` → the chat
//                          log. This is the WRITTEN copy. Sanitising it would
//                          be the exact bug this whole module exists to avoid:
//                          only the spoken copy may be transformed.
//   `opts.system`          text INTO the model, not text to be spoken.
//   `direct(contextNote)`  a `clientContent` USER turn — machine framing that
//                          useCallEngine deliberately writes as "<context: …>".
//                          Sanitising it would strip the framing rule B is
//                          designed to delete on the way OUT. Text in is not
//                          text out.
//   ack / backchannel      the ONLY text-to-speech path on this lane. It POSTs
//                          to /api/speech (liveCall.ts `prewarmAckClips`), so
//                          it is sanitised at the server seam, by the same code
//                          the cascade uses, without an import.
//
// So the live lane needs no client-side sanitiser, and MUST NOT import one:
// liveCall.ts's header records that it deliberately has no imports beyond
// ./level and ../engine/diag because scratchpad/echosim builds it standalone
// on that basis. The two assertions below hold that shape.

console.log("\n── 4. the live lane's text→audio paths ──");
const live = read("src/voice/liveCall.ts");

const imports = [...live.matchAll(/^import .*? from "([^"]+)";/gm)].map((m) => m[1]);
const ALLOWED_IMPORTS = ["./level", "../engine/diag"];
const strayImport = imports.filter((i) => !ALLOWED_IMPORTS.includes(i));
if (strayImport.length)
  FAIL(
    `src/voice/liveCall.ts imports ${strayImport.join(", ")}`,
    "It is allowed ./level and ../engine/diag and nothing else: scratchpad/echosim",
    "transpiles this file standalone to drive the audio floor against a simulated",
    "room, and a new import breaks the one harness that can prove the floor did",
    "not move. If the new import is spokenText, read section 4's comment first —",
    "the live lane generates AUDIO, there is no text to sanitise.",
  );
else console.log(`  ok    imports only ${ALLOWED_IMPORTS.join(" + ")} — the echosim can still build it standalone`);

// The one synthesis endpoint this file may reach. A second one would be a new
// text-to-speech path on the live lane, and it would bypass the server seam
// unless it also went to /api/speech.
const speechCalls = (live.match(/fetch\(`\$\{base\}\/api\/speech`/g) ?? []).length;
if (speechCalls !== 1)
  FAIL(
    `src/voice/liveCall.ts makes ${speechCalls} /api/speech calls, expected exactly 1 (the ack clips)`,
    "Every text-to-speech path on this lane must go through /api/speech, which is",
    "where the spoken-text sanitiser runs. A path that does not is a path that",
    "reads her punctuation out loud.",
  );
else console.log("  ok    exactly one text→audio path (the ack clips), and it goes through /api/speech");

const directTts = /elevenlabs|api\.sarvam|speechSynthesis|TextToSpeech\.speak/i.exec(live);
if (directTts)
  FAIL(
    `src/voice/liveCall.ts calls a TTS provider directly (${directTts[0]})`,
    "That bypasses the /api/speech seam and therefore the sanitiser.",
  );
else console.log("  ok    no TTS provider is called directly from the live lane");

// NOT AN ASSERTION, AND SAYING SO IS THE POINT. src/voice/speech.ts owns three
// engines that never touch /api/speech — ElevenLabs and Sarvam (user keys) and
// the device fallback (Capacitor TextToSpeech / speechSynthesis). Their text is
// prepared by stripForCloud/stripForDevice, which remove tags and emoji and do
// NOT touch dashes, markdown, bullets or arrows. They are the remaining
// unsanitised text→audio paths in the product, and the device tier is the one a
// call lands on when BOTH the paid and free pools are spent. Fixing it is a
// one-line import in a file this checker does not own; recorded here so the
// gap has a name. See docs/VOICE-LANE.md §"What is still unsanitised".
const cascade = read("src/voice/speech.ts");
const unsanitised = [
  ["elevenFetch", /async function elevenFetch/.test(cascade)],
  ["sarvamFetch", /async function sarvamFetch/.test(cascade)],
  ["device TTS", /TextToSpeech\.speak|SpeechSynthesisUtterance/.test(cascade)],
].filter(([, present]) => present).map(([n]) => n);
if (unsanitised.length)
  console.log(
    `  note  ${unsanitised.length} text→audio paths in src/voice/speech.ts still bypass the seam: ${unsanitised.join(", ")}`,
  );
console.log(
  `  note  ${/spokenText/.test(cascade) ? "speech.ts imports spokenText" : "speech.ts does NOT import spokenText yet"} — see docs/VOICE-LANE.md`,
);

console.log(
  fail
    ? `\nvoice lane NOT shippable (${fail} problem${fail > 1 ? "s" : ""})`
    : `\n  ok  one name (${voices[0]}), ${distinct.length} declared models, one spoken-text core, ${speechCalls} live text→audio path`,
);
process.exit(fail ? 1 : 0);
