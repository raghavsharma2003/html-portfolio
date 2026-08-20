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

/* ══ 5. THE PATHS THAT NEVER REACH /api/speech ═══════════════════════════ */
//
// This section used to be a `note`, and the note was right: three engines in
// src/voice/speech.ts never touch the server seam — ElevenLabs and Sarvam (user
// keys) and the device fallback (Capacitor TextToSpeech / speechSynthesis) — so
// nothing sanitised their text. The device tier is the DEEPEST rung in the
// product and it is reachable in production right now: `one-key-two-jobs`
// measured OPENROUTER_KEY exhausted, `free-tts-daily` measured the free Google
// pool dying inside one session, and at that point /api/speech answers 502 and
// `speakCall` / `createStreamSpeaker` fall through to `speak(allText, …)`.
//
// A note is not a mechanism. `selfbundle-never-set` is this repo's own entry
// about exactly that: a "wired" string I wrote myself, checked by nothing, over
// three slots that rendered zero bytes on every lane. Its rule — a slot is
// wired when a REAL PROMPT CONTAINS ITS BYTES — is what the two assertions
// below implement for speech: the harness bundles the REAL module, drives the
// REAL entry points, and asserts on the strings the platform engines and the
// two direct POSTs were actually handed.

console.log("\n── 5. the paths that never reach /api/speech ──");
const cascade = read("src/voice/speech.ts");

// (a) THE DOOR CENSUS. `screen-share-triple-swap` found a third path family
// nobody had counted, and the continuity workstream found a third prompt
// assembler after the spec said two. So the list of engines is not trusted to a
// comment: every text→audio door in this file is enumerated from the source and
// compared against what is DECLARED here. A new engine — or an old one moved to
// a new host — fails this run until somebody declares it and the harness in
// evals/voice/device.mjs proves its text is sanitised.
const DECLARED_DOORS = {
  "api.elevenlabs.io": "ElevenLabs v3, user key — the one door that KEEPS audio tags (it performs them)",
  "api.sarvam.ai": "Sarvam bulbul, user key",
  "PROXY_SPEECH_URL": "the hosted voice — /api/speech, sanitised server-side as well",
  "TextToSpeech.speak": "Capacitor device TTS (Android) — the deepest fallback",
  "SpeechSynthesisUtterance": "the browser device voice — the deepest fallback on web",
};
const doors = new Set();
for (const m of cascade.matchAll(/fetch\(\s*(?:`|")(https?:\/\/([a-z0-9.-]+))/gi)) doors.add(m[2]);
for (const m of cascade.matchAll(/fetch\(\s*(PROXY_SPEECH_URL)/g)) doors.add(m[1]);
if (/TextToSpeech\.speak\(/.test(cascade)) doors.add("TextToSpeech.speak");
if (/new SpeechSynthesisUtterance\(/.test(cascade)) doors.add("SpeechSynthesisUtterance");

const undeclared = [...doors].filter((d) => !DECLARED_DOORS[d]);
if (undeclared.length)
  FAIL(
    `UNDECLARED text→audio door(s) in src/voice/speech.ts: ${undeclared.join(", ")}`,
    "Something in this file can make her speak and nothing here says what it is,",
    "which means nothing proves its text was sanitised either. Declare it in",
    "DECLARED_DOORS, give it a case in evals/voice/device.mjs, and say in",
    "docs/VOICE-LANE.md when it is reachable.",
  );
const missing = Object.keys(DECLARED_DOORS).filter((d) => !doors.has(d));
if (missing.length)
  FAIL(
    `declared door(s) no longer found in src/voice/speech.ts: ${missing.join(", ")}`,
    "Either the door was removed — delete it from DECLARED_DOORS — or the pattern",
    "moved and this census is no longer censusing anything.",
  );
if (!undeclared.length && !missing.length)
  console.log(`  ok    ${doors.size} text→audio doors, all declared: ${[...doors].join(", ")}`);

// (b) THE SEAM ITSELF, asserted by what comes OUT of it rather than by a grep.
// evals/voice/device.mjs bundles src/voice/speech.ts with recorders in place of
// the platform engines, drives speakCall / speak / createStreamSpeaker with
// every failure the production cascade can hit, and checks the exact strings.
// It also carries the negative controls that matter: a crisis helpline's
// hyphens must SURVIVE, and her own words must not be deleted — over-stripping
// is the silent failure of any sanitiser.
try {
  execFileSync("node", [ROOT + "evals/voice/device.mjs"], { cwd: ROOT, stdio: "inherit" });
} catch {
  FAIL(
    "evals/voice/device.mjs failed — a path from her text to audio is unsanitised (see above)",
    "The engines in src/voice/speech.ts that never reach /api/speech have no",
    "server seam behind them: whatever this harness captured is what a user hears.",
  );
}

// (c) The Android CASCADE watch engine — the path VOICE-LANE.md's table missed.
// LiveWatchEngine.java is the realtime lane; WatchEngine.java is the older
// snapshot→think→speak brain WatchCaptureService falls back to when the live
// lane is unsupported or gives up (`startCascade()`). It speaks by POSTing to
// /api/speech, so it is sanitised at the server seam — but only for as long as
// nobody gives it a device-TTS fallback, which is precisely what the JS side
// has and what made the JS side the bug.
if (nativePresent) {
  const watch = read("android/app/src/main/java/app/meera/companion/WatchEngine.java");
  if (!/postBytes\(base \+ "\/api\/speech"/.test(watch))
    FAIL(
      "android WatchEngine.java no longer speaks through /api/speech",
      "That is the cascade watch lane's only text→audio path and the server seam is",
      "the only sanitiser it has. A local engine here would be unsanitised speech.",
    );
  else if (/TextToSpeech|SpeechSynthesis/.test(watch))
    FAIL(
      "android WatchEngine.java has gained a device-TTS path",
      "It would bypass /api/speech and therefore the sanitiser — the same shape of",
      "bug the JS device tier just was.",
    );
  else console.log("  ok    android WatchEngine.java (the cascade watch lane) speaks only through /api/speech");
} else {
  console.log("  note  android/ not in this checkout — the cascade watch lane was not checked");
}

/* ══ 6. THE SWAP — WHEN SHE IS ALLOWED TO CHANGE LANE ════════════════════ */
/* ── WS-ANDROID-SWAP: added section ───────────────────────────────────────── */
//
// Sections 1-3 answer "is it the same voice". This one answers a question they
// cannot: HOW OFTEN, AND ON WHOSE DECISION, does the product move her between
// the lanes that sound different. The owner's report — "in the screen sharing
// everything changing the whole voice" — is not a lane sounding wrong. It is
// too many lane changes, and the largest of them needed no failure at all.
//
// THE ONE THAT DID NOT NEED A FAILURE, AND IS NOW FIXED. Gemini Live announces
// a session rotation with `goAway`. `LiveWatchEngine.java` has always rotated
// on it and stayed on the live model; `src/voice/liveCall.ts` did not handle it
// at all, so the close that followed became `teardown("closed")` and
// useCallEngine answered with `claimVoice("cascade", …)` — a PERMANENT move
// from a speech-to-speech model to a TTS model, out of a routine server event.
// Continuous video shortens the time to that rotation, which is why screen
// share is where it was heard.
//
// WHY THIS IS A PARITY TEST AND NOT TWO TESTS. `blank-guard-parity`
// (context/measurements.md, 2026-08-18) settled the shape for this repo: a test
// that pins ONE twin's current behaviour has to be edited every time that
// behaviour legitimately changes, and drifts. A test that pins the two twins
// AGREEING never needs editing and catches the only failure that matters. So
// every assertion below is of the form "the TS and the Java say the same
// thing", never "the TS says 6".

console.log("\n── 6. the swap: goAway rotation, TS ⇄ Java ──");

const liveTs = live; // already read in section 4
const java = nativePresent ? read(NATIVE.file) : null;

if (!java) {
  FAIL(
    `${NATIVE.file} is not in this checkout, so the goAway parity cannot be checked`,
    "This section exists BECAUSE the two twins disagreed once and nothing noticed.",
    "A skip here is the state that let that happen; it is a failure, not a note.",
  );
} else {
  // ── 6a. both twins ROTATE on goAway; neither merely logs it ──
  const tsRotates = /if \(msg\.goAway\)[\s\S]{0,1400}?scheduleRotate\(leftMs\);/.test(liveTs);
  const javaRotates = /msg\.has\("goAway"\)[\s\S]{0,1200}?scheduleRotate\(leftMs\);/.test(java);
  if (!tsRotates || !javaRotates)
    FAIL(
      `goAway is not answered with a rotation in ${!tsRotates ? "src/voice/liveCall.ts" : ""}${!tsRotates && !javaRotates ? " and " : ""}${!javaRotates ? NATIVE.file : ""}`,
      "A goAway that is only logged becomes a close, a teardown, and a permanent",
      "handoff to the cascade — a DIFFERENT MODEL speaking her voice for the rest",
      "of the call, out of an event the server considers routine. That asymmetry",
      "between these two files is exactly what shipped. See docs/VOICE-LANE.md §6.",
    );
  else console.log("  ok    both twins rotate on goAway — the live model keeps the call");

  // ── 6b. the rotation constants agree, numerically ──
  // Same mechanism as the voice NAME above: the value cannot be imported across
  // a TS/Java boundary, so it is mirrored and the mirrors are asserted. A
  // rotation that fires at a different moment in the APK than on the web is a
  // voice that behaves differently on the two surfaces.
  const num = (src, name, re) => {
    const m = src.match(re);
    return m ? Number(m[1]) : null;
  };
  const ROTATION_CONSTANTS = [
    ["MAX_ROTATES", "how many rotations one call may take before it gives up"],
    ["ROTATE_DELAY_MS", "the gap between closing the old socket and opening the new one"],
    ["ROTATE_GRACE_MS", "how far clear of the server's own deadline the rotation stays"],
    ["ROTATE_WAIT_MAX_MS", "the longest a rotation waits for her to stop speaking"],
    ["ROTATE_POLL_MS", "how often 'is she still speaking' is re-asked"],
  ];
  for (const [name, governs] of ROTATION_CONSTANTS) {
    const a = num(liveTs, name, new RegExp(`const ${name} = (\\d+)`));
    const b = num(java, name, new RegExp(`static final (?:int|long) ${name} = ([0-9_]+)`));
    if (a === null || b === null)
      FAIL(
        `${name} is missing from ${a === null ? "src/voice/liveCall.ts" : NATIVE.file}`,
        `governs: ${governs}`,
        "Both twins must declare it, or there is nothing to compare and the two",
        "implementations are free to drift apart silently.",
      );
    else if (a !== b)
      FAIL(
        `${name} disagrees: ${a} in src/voice/liveCall.ts, ${b} in ${NATIVE.file}`,
        `governs: ${governs}`,
        "One surface would rotate at a moment the other would not. Change both.",
      );
    else console.log(`  ok    ${name.padEnd(20)} ${String(a).padEnd(5)} — ${governs}`);
  }

  // ── 6c. the rotation waits for a moment SOMEBODY CHOSE ──
  // A rotation flushes playback. Taking it the instant goAway lands cuts her
  // off mid-word, which is a worse artefact than the lane change it prevents —
  // and the server's own `timeLeft` exists precisely so a client need not.
  const tsWaits = /speakingUntil > Date\.now\(\) && Date\.now\(\) < rotateBy/.test(liveTs);
  const javaWaits = /speaking && System\.currentTimeMillis\(\) < rotateBy/.test(java);
  if (!tsWaits || !javaWaits)
    FAIL(
      `the rotation does not wait for her to stop speaking in ${!tsWaits ? "src/voice/liveCall.ts" : NATIVE.file}`,
      "rotate() flushes playback. Firing it inside one of her sentences trades a",
      "lane change for a guillotine, and `goAway.timeLeft` is the server telling",
      "you there is time not to.",
    );
  else console.log("  ok    both twins hold the rotation until she is not mid-utterance");

  // ── 6d. THE MODEL IS PINNED FOR THE LIFE OF THE CALL ──
  // A rotation mints a fresh token and /api/live-token returns a model with it.
  // Taking that model would let the token endpoint change model families
  // mid-call — the same voice NAME on a different model, which is the exact bug
  // sections 1 and 2 exist for, arriving through a door neither can see.
  const tsPins = /`\$\{WS_BASE\}\?access_token=\$\{fresh\.token\}`/.test(liveTs) &&
    !/model:\s*fresh\.model/.test(liveTs);
  const javaPins = /if \(firstConnect\)\s*\{\s*model = offered;/.test(java);
  if (!tsPins || !javaPins)
    FAIL(
      `the live model is not pinned across a rotation in ${!tsPins ? "src/voice/liveCall.ts" : NATIVE.file}`,
      "A call that starts on one model must finish on it. A rotation that adopts",
      "whatever model the token endpoint currently offers is a voice change with",
      "no lane change to explain it, and nothing else in this file would see it.",
    );
  else console.log("  ok    both twins keep the model the call started on across a rotation");

  // ── 6e. a replaced socket cannot end the call ──
  // The stale-callback guard is the whole safety story: rotate() deliberately
  // closes the old socket, and if that close reached the live handler it would
  // tear the call down and hand it to the cascade at the precise moment the
  // rotation was preventing exactly that.
  const tsGuard = /sock\.onclose = \(ev\) => \{[\s\S]{0,600}?if \(stale\(\)\) return;/.test(liveTs);
  const javaGuard = /public void onClosed\(WebSocket s, int code, String reason\) \{\s*if \(stale\(\)\) return;/.test(java);
  if (!tsGuard || !javaGuard)
    FAIL(
      `a replaced socket's close is not guarded in ${!tsGuard ? "src/voice/liveCall.ts" : NATIVE.file}`,
      "rotate() closes the old socket on purpose. Without a generation check that",
      "close runs the mid-call drop path and the call lands on the cascade anyway,",
      "which is the bug with an extra step.",
    );
  else console.log("  ok    both twins ignore a replaced socket's close");

  // ── 6f. ONE speechConfig per twin ──
  // The rotated session must be built by the same code that built the first
  // one. Two speechConfig literals in a file is how a rotation quietly acquires
  // a second voice while section 1 keeps passing, because section 1 matches the
  // FIRST literal it finds.
  const tsVoiceLiterals = (liveTs.match(/prebuiltVoiceConfig/g) ?? []).length;
  const javaVoiceLiterals = (java.match(/voiceName/g) ?? []).length;
  if (tsVoiceLiterals !== 1)
    FAIL(
      `src/voice/liveCall.ts has ${tsVoiceLiterals} prebuiltVoiceConfig literals, expected exactly 1`,
      "Section 1 matches the first one it finds. A second literal is a second",
      "voice that this file would keep reporting as agreeing with itself.",
    );
  else console.log("  ok    one speechConfig in the live lane — a rotation cannot pick a different voice");
  if (javaVoiceLiterals !== 1)
    FAIL(
      `${NATIVE.file} names voiceName ${javaVoiceLiterals} times, expected exactly 1`,
      "Same reason as above, on the surface where the triple-swap actually happens.",
    );
  else console.log("  ok    one speechConfig in the native watch engine");
}

// ── 6g. THE SWAP POINTS THIS FILE CANNOT FIX, NAMED SO THEY ARE NOT LOST ──
// NOT AN ASSERTION, and saying so is the point. `src/components/useCallEngine.ts`
// owns the other lane changes, and two of them are a guaranteed voice change on
// Android that nothing forced: starting a screen share hands the audio path to
// the native engine, and STOPPING it drops to the CASCADE rather than back to
// live. One screen-share episode is therefore live → native → cascade, and the
// second of those two crosses model families. That file is outside this
// workstream's ownership; the table is in docs/VOICE-LANE.md §6.4.
{
  const uce = read("src/components/useCallEngine.ts");
  const claims = [...uce.matchAll(/claimVoice\("(\w+)",\s*[`"]([^`"]*)/g)].map(
    (m) => `${m[2] || "?"}→${m[1]}`,
  );
  console.log(`  note  ${claims.length} lane changes are decided in useCallEngine.ts: ${claims.join(", ")}`);
  const backToLive = /claimVoice\("live",\s*[`"]watch_stopped/.test(uce);
  console.log(
    `  note  screen-share stop goes to ${backToLive ? "LIVE" : "CASCADE"} — ${
      backToLive ? "no model-family change" : "a model-family change nothing forced (docs/VOICE-LANE.md §6.4)"
    }`,
  );
}
/* ── end WS-ANDROID-SWAP added section ───────────────────────────────────── */

console.log(
  fail
    ? `\nvoice lane NOT shippable (${fail} problem${fail > 1 ? "s" : ""})`
    : `\n  ok  one name (${voices[0]}), ${distinct.length} declared models, one spoken-text core, ${speechCalls} live text→audio path, goAway rotation at parity`,
);
process.exit(fail ? 1 : 0);
