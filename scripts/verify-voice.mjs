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

import { readFileSync, writeFileSync, existsSync } from "node:fs";
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
  {
    file: "src/voice/speech.ts",
    re: /const MEERA_VOICE = "([A-Za-z]+)"/,
    governs:
      "the CACHE NAMESPACE for every clip this client stores — pickup lines, backchannels, voice notes",
  },
  {
    file: "scripts/prosody-baseline.mjs",
    re: /const TTS_VOICE = "([A-Za-z]+)"/,
    governs: "the nightly vendor-drift alarm — the job whose only purpose is noticing her voice change",
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

/* ── THE SWITCH ───────────────────────────────────────────────────────────
 *
 *   node scripts/verify-voice.mjs --set Leda
 *
 * Moves her voice in EVERY lane at once and then verifies the result with the
 * same checks a normal run makes, so the switch and its proof are one command.
 *
 * WHY THIS EXISTS RATHER THAN A CONSTANT EVERYONE IMPORTS. The lanes cannot
 * share one: `api/speech.js` is a serverless function holding server secrets,
 * `src/voice/liveCall.ts` is a browser module forbidden to import anything
 * beyond `./level` and `../engine/diag` (the echosim law — `evals/echosim/`
 * builds it standalone on that basis), `LiveWatchEngine.java` is Java, and
 * `scripts/prosody-baseline.mjs` is a Node job. Six sites, four languages, no
 * import that spans them. So the house pattern applies: MIRROR, then assert the
 * mirrors agree on every run — and give the mirrors ONE WRITER, because a
 * mirror set that can only be edited by hand is a mirror set that will be
 * edited incompletely.
 *
 * That is not a worry, it is the incident. `api/speech.js`'s header already
 * asked the next person to "move it HERE and in the two live speechConfigs
 * together — or this comes straight back", and it came straight back: the
 * 2026-08-21 Aoede → Autonoe switch moved the four lanes it named and left the
 * drift alarm on Aoede and every cached clip in Aoede. A comment asking for
 * discipline is not a mechanism, and neither is a checklist. A writer is.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: pick the voice. `voice-ears` is the entry
 * that says numbers cannot, and `scripts/voice-samples.mjs` is the blind deck
 * that lets ears do it. This only moves what the ears chose. */
const setIdx = process.argv.indexOf("--set");
if (setIdx >= 0) {
  const next = process.argv[setIdx + 1];
  if (!next || !/^[A-Za-z]+$/.test(next)) {
    console.log("  --set needs a prebuilt voice name, e.g. --set Leda");
    process.exit(2);
  }
  // Verified against the live bidi lane on 2026-08-24 with setup-only
  // handshakes — no audio generated — and negative-controlled: a bogus name is
  // refused with 1007 "No matching speaker voice found for name: X and
  // language: hi-IN", so acceptance here is real rather than a probe that says
  // yes to everything. `api/live-token.js` makes the same point in reverse: a
  // TTS model taking a name says nothing about the realtime one, and a name the
  // live lane rejects is a broken call, not a wrong timbre.
  const LIVE_ACCEPTED = new Set([
    "Autonoe", "Aoede", "Leda", "Kore", "Zephyr",
    "Despina", "Callirrhoe", "Laomedeia", "Sulafat", "Erinome",
  ]);
  if (!LIVE_ACCEPTED.has(next)) {
    console.log(`  ${next} is not in the set of names VERIFIED to be accepted by the live bidi lane.`);
    console.log(`  Verified: ${[...LIVE_ACCEPTED].join(", ")}`);
    console.log("  A name the live lane refuses is a call that never connects, not a different timbre.");
    console.log("  Probe it first (setup-only handshake, no audio) and add it here with the date.");
    process.exit(2);
  }

  const targets = [...SITES, ...(existsSync(ROOT + NATIVE.file) ? [NATIVE] : [])];
  const changed = [];
  for (const site of targets) {
    const src = read(site.file);
    const m = src.match(site.re);
    if (!m) {
      console.log(`  FAIL  ${site.file}: no voice literal matched — refusing to switch a lane I cannot find`);
      process.exit(1);
    }
    if (m[1] === next) continue;
    // Rewrite the CAPTURED name inside the matched region only, so a file that
    // mentions the old name in prose (every one of them does — these headers are
    // incident reports) keeps its history.
    const patched = m[0].replace(`"${m[1]}"`, `"${next}"`);
    writeFileSync(ROOT + site.file, src.slice(0, m.index) + patched + src.slice(m.index + m[0].length));
    changed.push(`${site.file}: ${m[1]} → ${next}`);
  }
  // The allow-list has to admit her own voice or /api/speech refuses a request
  // that names it. Additive on purpose: the old name stays legal so a clip
  // cached or a request in flight under it is answered rather than 400'd.
  const sp = read("api/speech.js");
  const al = sp.match(/const ALLOWED_VOICES = new Set\(\[([^\]]*)\]\)/);
  if (al && !al[1].includes(`"${next}"`)) {
    const widened = al[0].replace("]", `, "${next}"]`);
    writeFileSync(ROOT + "api/speech.js", sp.replace(al[0], widened));
    changed.push(`api/speech.js: ALLOWED_VOICES += ${next}`);
  }
  console.log(changed.length ? `── switched her voice to ${next} ──` : `── already ${next} everywhere ──`);
  for (const c of changed) console.log(`  set   ${c}`);
  console.log("\n  Every cached clip is namespaced by the voice name (src/voice/speech.ts");
  console.log("  `engineTag`), so the old audio is stranded rather than replayed. Nothing to");
  console.log("  purge and no revision counter to bump.");
  console.log("\n  STILL YOURS TO DO: re-establish the drift baseline against the new voice —");
  console.log("  `node scripts/prosody-baseline.mjs --establish` — or every drift figure it prints");
  console.log("  compares two different women. It alarms rather than doing this silently.\n");
  console.log("── verifying the switch ──\n");
}

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
  // `gemini-2.5-flash-native-audio-latest` USED TO BE DECLARED HERE, as the
  // native watch engine's last-resort default. Declaring it was the right move
  // at the time — it made a rejected model visible instead of secret — but a
  // declaration is a description, and what this one described was a defect:
  // a malformed /api/live-token response silently moved the watch lane onto a
  // model measured at 0/24 barge-in and 3-5.5s to first audio, which is a
  // change of WHO SHE IS on the one surface where the triple-swap happens.
  // The fallback is now the live model itself (§7c pins the two strings), so
  // there is nothing left to declare. Kept as a comment rather than deleted
  // because the entry's absence is otherwise indistinguishable from having
  // forgotten it.
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

/* ══ 7. EVERY ENGINE THAT CAN BE HEARD, AND EVERY CACHE THAT REPLAYS ONE ══
 *
 * §1 checks the lanes that name a GEMINI PREBUILT VOICE. That is four of the
 * places she speaks from, and it is not all of them — which is why §1 could be
 * green on the day the owner reported, again, that "when we shift to different
 * modes her voice is changing".
 *
 * Two whole families sit outside §1's regexes:
 *
 *   OTHER VENDORS. `src/voice/speech.ts` will speak her through Sarvam
 *   (`speaker: "priya"`, bulbul:v3) or ElevenLabs (a voice id, eleven_v3) the
 *   moment a user key exists in Settings — on the call cascade, the pickup line
 *   and the backchannels. The live call, the native watch engine and her chat
 *   voice notes have no such option and stay on the Gemini voice. So on a
 *   keyed install every mode shift is a guaranteed change of woman, and not one
 *   character of it is visible to a check that reads prebuilt voice names.
 *
 *   CACHES. A clip is fetched once and replayed forever out of IndexedDB. A key
 *   that does not name the identity that produced it serves the OLD voice after
 *   a switch, indefinitely, with every lane and every gate agreeing on the new
 *   one. That is the exact shape of the recurrence: on 2026-08-21 four lanes
 *   moved Aoede → Autonoe, this file went green, and the pickup clip — the
 *   FIRST sound of every call — kept coming out of the cache in Aoede.
 *
 * So this section asserts two things §1 cannot:
 *   7a  every engine identity in the product is DECLARED, with what it governs
 *       and whether it is her.
 *   7b  every persistent clip cache key carries that identity.
 *
 * 7b is the one that makes the CLASS impossible rather than this instance of
 * it: with the identity in the key, changing the voice strands the stale audio
 * automatically and there is no purge step to forget. */
console.log("\n── 7. every engine that can be HEARD ──");
{
  const sp = read("src/voice/speech.ts");

  /** Identities that produce audible speech and are NOT the Gemini prebuilt
   *  voice §1 governs. Declared, not endorsed — the same contract §2 uses for
   *  models. An undeclared one fails the run. */
  const DECLARED_ENGINES = [
    {
      id: "sarvam",
      re: /const SARVAM_SPEAKER = "([a-z]+)"/,
      her: false,
      governs:
        "FAILOVER ONLY since IDENTITY WINS (2026-08-24) — reached on the cascade after her own voice returns no audio",
      why:
        "a different vendor and a different speaker. The live lane cannot use it, so an install with this key used to hear one woman on a live call and another the instant it fell back. It is no longer preferred over her voice; it survives below it because a different voice beats silence.",
    },
    {
      id: "eleven",
      re: /const ELEVEN_DEFAULT_VOICE = "([A-Za-z0-9]+)"/,
      her: false,
      governs: "FAILOVER ONLY, below her voice and below Sarvam",
      why:
        "a different vendor again, and the only one that can perform an audio tag. Losing tag performance is the priced cost of IDENTITY WINS.",
    },
    {
      id: "device",
      re: /(TextToSpeech)\.speak\(/,
      her: false,
      governs:
        "the last resort inside speak(), reached when EVERY cloud attempt for an utterance returned nothing",
      why:
        "the platform's own engine, with no voice of hers in it at all — the largest identity change in the product (docs/VOICE-LANE.md §6.4 row 10). It is audible MID-CALL: speakCall and createStreamSpeaker both fall through to speak() when no clip ever became audible. Kept because the alternative is silence, which is worse; named here so nobody mistakes its absence from §1 for its absence from the product.",
    },
  ];

  for (const e of DECLARED_ENGINES) {
    const m = sp.match(e.re);
    if (!m) {
      FAIL(
        `src/voice/speech.ts: the ${e.id} engine literal no longer matches`,
        "Either it was removed — in which case delete it from DECLARED_ENGINES and",
        "say so in docs/VOICE-LANE.md — or it moved, and this guard has stopped",
        "guarding an engine that can still be heard.",
      );
      continue;
    }
    console.log(`  ok    ${e.id.padEnd(7)} ${String(m[1]).padEnd(22)} ${e.her ? "HER VOICE" : "NOT her voice"} — ${e.governs}`);
  }

  // The engine must be chosen ONCE PER UTTERANCE. It used to be re-derived
  // inside fetchClipFor from `hasAudioTags(text)` — a property of the PHRASE —
  // so a reply whose second sentence carried a tag was fetched half from Sarvam
  // and half from ElevenLabs. §2 already asserts the identical property one
  // level down, for the cascade's two arms, "because a multi-phrase reply races
  // again per phrase". This is that assertion one level up, where the two
  // candidates are not even the same company.
  const derivations = (sp.match(/hasAudioTags\(/g) ?? []).length;
  if (derivations !== 2) {
    FAIL(
      `src/voice/speech.ts calls hasAudioTags() ${derivations} times, expected exactly 2 (its definition and pickEngine)`,
      "A third call site means the engine is being decided somewhere other than",
      "pickEngine — and every extra decision point is a place one reply can be",
      "split across two vendors mid-sentence.",
    );
  } else console.log("  ok    the engine is decided in ONE place (pickEngine) — one reply cannot be split across two vendors");

  // 7b — every persistent clip cache key carries the identity that made it.
  // Enumerated from the literals rather than from a list someone maintains, so
  // a NEW cache added tomorrow is caught by the same rule.
  const CACHE_SITES = [
    { file: "src/voice/speech.ts", src: sp },
    { file: "src/components/VoiceNote.tsx", src: read("src/components/VoiceNote.tsx") },
    { file: "src/voice/liveCall.ts", src: liveTs },
  ];
  const TAGGED = /\$\{(?:engineTag\([^)]*\)|tag|PROXY_VOICE_TAG|ACK_VOICE|clipVoiceTag\([^)]*\))\}/;
  let cacheKeys = 0;
  for (const site of CACHE_SITES) {
    // A cache key reaches cachedClip/saveClip either as a template literal
    // written in the call, or as an identifier bound to one a few lines above.
    // The first version of this check only saw the inline form and reported
    // "all 2 keys ok" while three of the five — including the pickup clip, the
    // one the bug was actually heard through — were bound to `const key` and
    // never looked at. A check that silently examines a subset is the shape
    // `sound-gate-proved-by-silence` names: it cannot fail, so it is not a
    // check. Both forms are resolved now, and the count is printed so a future
    // drop from five to two is visible rather than reassuring.
    const keys = [];
    for (const m of site.src.matchAll(/(?:cachedClip|saveClip)\(\s*(`[^`]*`|[A-Za-z_$][\w$]*)/g)) {
      // `cachedClip(key: string)` is where the function is DECLARED, not a
      // place a key is used, and a declaration has no literal to resolve. Both
      // declarations sit above every call site in the file, so counting them
      // turned this check red on a clean tree the moment the resolver got
      // strict enough to notice it could not read them.
      if (/function\s+$/.test(site.src.slice(Math.max(0, m.index - 20), m.index))) continue;
      const arg = m[1];
      if (arg.startsWith("`")) {
        keys.push(arg.slice(1, -1));
        continue;
      }
      // An identifier — resolve it to the template literal it was bound to.
      // NEAREST BINDING ABOVE THE CALL, not the first in the file. Two caches
      // here both name their key `key`, so a whole-file match resolved both to
      // the first one: the pickup cache could lose its tag entirely and this
      // check still reported "all 8 ok", because it was reading the backchannel
      // key twice. Found by breaking it on purpose, which is the only way that
      // failure is visible — a resolver that silently answers the wrong
      // question is green by construction.
      const bindRe = new RegExp(
        "(?:const|let|var)\\s+" + arg.replace(/\$/g, "\\$") + "\\s*=\\s*`([^`]*)`",
        "g",
      );
      let bind = null;
      for (const b of site.src.matchAll(bindRe)) {
        if (b.index < m.index) bind = b;
        else break;
      }
      if (bind) keys.push(bind[1]);
      else
        FAIL(
          `${site.file}: cache key \`${arg}\` handed to a clip cache could not be resolved to a literal`,
          "7b can only check keys it can read. An unresolvable one is an unchecked",
          "one, so it fails rather than passing quietly.",
        );
    }
    for (const key of keys) {
      cacheKeys++;
      if (!TAGGED.test(key)) {
        FAIL(
          `${site.file}: clip cache key \`${key}\` does not name the voice that produced it`,
          "This cache is permanent (IndexedDB), so the clip under this key outlives",
          "any voice change and gets replayed next to lanes that have moved on. That",
          "is how the fixed bug came back: on 2026-08-21 four lanes moved Aoede →",
          "Autonoe, this file passed, and the PICKUP CLIP — the first sound of every",
          "call — kept playing out of the cache in Aoede.",
          "Put the identity in the key (engineTag / PROXY_VOICE_TAG / ACK_VOICE).",
        );
      }
    }
  }
  if (cacheKeys === 0)
    FAIL(
      "no clip cache keys matched at all — the pattern moved and 7b is guarding nothing",
      "This check is only worth having if it can see the caches; a zero count is a",
      "silent pass, which is the failure this whole file exists to stop.",
    );
  else console.log(`  ok    all ${cacheKeys} persistent clip cache keys name the identity that produced them`);

  // ── 7b-i. THE PICKUP CLIP, BY NAME ──
  // 7b proves every cache key carries SOME identity token. This proves the one
  // that actually detonated carries THIS voice, by walking the chain rather
  // than trusting any single link:
  //
  //   pk1 key → engineTag(...) → `gm-${MEERA_VOICE}` → §1 says MEERA_VOICE
  //   equals api/speech.js's DEFAULT_VOICE.
  //
  // Named separately because the pickup clip is the FIRST SOUND OF A CALL and
  // the one the owner actually heard in the wrong voice: it is served from
  // IndexedDB with zero network, so it is the single clip most able to outlive
  // a voice switch, and the one whose staleness is heard soonest. A generic
  // "all keys are tagged" pass would still be true if this specific chain were
  // broken by a tag that interpolated something other than the voice.
  const pickupKey = sp.match(/const key = `pk1:[^`]*`/);
  const tagFn = sp.match(/function engineTag\([^)]*\)[^{]*\{[\s\S]*?\n\}/);
  if (!pickupKey) {
    FAIL("src/voice/speech.ts: the pk1 pickup cache key literal is gone — 7b-i cannot follow the chain");
  } else if (!/\$\{engineTag\(/.test(pickupKey[0])) {
    FAIL(
      `src/voice/speech.ts: the pickup key ${pickupKey[0]} does not go through engineTag()`,
      "This is the first sound of every call and it is served from IndexedDB with",
      "no network. Keyed on anything but the identity, it survives a voice switch",
      "and opens the call in the previous voice — which is the reported bug.",
    );
  } else if (!tagFn) {
    FAIL("src/voice/speech.ts: engineTag() not found — the pickup key points at nothing checkable");
  } else if (!/`gm-\$\{MEERA_VOICE\}`/.test(tagFn[0])) {
    FAIL(
      "src/voice/speech.ts: engineTag()'s hosted-voice branch no longer interpolates MEERA_VOICE",
      "The pickup key would then be namespaced by something that does not move when",
      "her voice moves, so switching the voice would leave the old clip reachable.",
    );
  } else {
    console.log(`  ok    pickup clip self-invalidates: pk1 → engineTag → gm-\${MEERA_VOICE} (${voices[0] ?? "?"})`);
  }

  // ── 7b-ii. IS THE DRIFT ALARM ANCHORED ON THE VOICE SHE ACTUALLY HAS? ──
  // A NOTE, NOT AN ASSERTION, and the distinction is the whole design. The
  // baseline can only be re-established by synthesising through the PAID
  // OpenRouter lane (prosody-baseline.mjs refuses the free pool on purpose —
  // `free-tts-daily`: that quota is shared product infrastructure). So a
  // failure here would block every build behind someone topping up a key,
  // which is a worse failure than the one it reports.
  //
  // It is printed rather than left silent because a stale anchor is exactly
  // the D4 defect: the drift alarm comparing two different women and calling
  // the difference drift. The alarm itself now refuses to do that quietly —
  // it says so and sets lastAlarm — and this line makes the same fact visible
  // without having to run the paid job to learn it.
  try {
    const log = JSON.parse(read("evals/dbattery/prosody-baseline-log.json"));
    const anchored = log?.baseline?.voice ?? null;
    if (anchored && voices.length === 1 && anchored !== voices[0]) {
      console.log(
        `  note  the drift baseline is anchored on ${anchored}, she is now ${voices[0]} — ` +
          `every drift figure compares two voices until \`node scripts/prosody-baseline.mjs --establish\` runs (needs a funded OpenRouter key)`,
      );
    } else if (anchored) {
      console.log(`  ok    the drift baseline is anchored on her current voice (${anchored})`);
    }
  } catch {
    console.log("  note  no prosody baseline recorded yet — the drift alarm has nothing to compare against");
  }

  // ── 7c. THE MODEL TWINS ──
  // `api/live-token.js` decides the live model; `LiveWatchEngine.java` carries a
  // fallback for a token response that arrives without one. §2 checks that both
  // are DECLARED. It cannot check that they are the SAME, and for two years
  // they were not: the Java fallback named a model this repo measured and
  // rejected, so a malformed response changed her voice rather than merely
  // costing latency. The JS twin has no fallback at all, which is the third
  // position — so the two twins disagreed about the model AND about whether a
  // fallback should exist.
  //
  // A fallback that differs from the primary is a second configuration reached
  // only when something has already gone wrong, i.e. the configuration nobody
  // ever observes. Pinning them makes the failure mode "one extra round trip"
  // instead of "a different woman".
  const tokenModel = read("api/live-token.js").match(/export const LIVE_MODEL = "([^"]+)"/);
  const javaFallback = nativePresent
    ? read(NATIVE.file).match(/DEFAULT_MODEL\s*=\s*"([^"]+)"/)
    : null;
  if (!tokenModel) {
    FAIL("api/live-token.js: LIVE_MODEL literal not found — 7c cannot pin the twins");
  } else if (!nativePresent) {
    console.log(`  note  ${NATIVE.file} not in this checkout — the model-twin pin is skipped`);
  } else if (!javaFallback) {
    FAIL(`${NATIVE.file}: DEFAULT_MODEL literal not found — 7c cannot pin the twins`);
  } else if (javaFallback[1] !== tokenModel[1]) {
    FAIL(
      `the live model and the native fallback disagree: ${tokenModel[1]} vs ${javaFallback[1]}`,
      "LiveWatchEngine.java falls back to its DEFAULT_MODEL when /api/live-token",
      "answers without a model. If that is a DIFFERENT model, a malformed response",
      "does not cost latency — it changes which model family speaks, and the same",
      "voice name on a different family is a different woman. Keep them equal, or",
      "declare the difference in DECLARED above and say why in docs/VOICE-LANE.md.",
    );
  } else {
    console.log(`  ok    live model and native fallback are the same string (${tokenModel[1]})`);
  }

  // ── 7d. EVERY WATCH-LANE EXIT TRIES TO GO BACK TO LIVE ──
  // Starting a screen share hands the whole audio path to the native engine
  // and KILLS the JS live session on the way in, before the consent dialog.
  // So every exit from the native lane lands on the cascade with no live
  // session left — a model-family change, and one nothing chose. #96 built
  // `reconnectLiveAfterWatch()` to undo it and wired it to the two paths its
  // framing covered ("stopping a share"), leaving the DENIAL path — where she
  // is downgraded in exchange for a share that never happened — unwired for
  // as long as it existed.
  //
  // This asserts the property rather than the three call sites, so a FOURTH
  // exit added tomorrow is caught by the same rule instead of inheriting the
  // same omission. `useCallEngine.ts` is checked but not owned here; the
  // failure message says what to add rather than assuming who adds it.
  // COMMENTS ARE STRIPPED BEFORE SCANNING, and that is not tidiness. The
  // second version of this check took "the next claimVoice(" as its boundary
  // and still failed a branch that HAD the reconnect — because the comment
  // explaining the branch MENTIONS `claimVoice("native", "watch_started")`,
  // and a text scan cannot tell code from prose about code. In a file whose
  // comments are incident reports quoting the calls they describe, every
  // proximity rule is a rule about the prose unless the prose is removed
  // first. Third attempt, and the first one measuring the code.
  const stripComments = (s) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const uce2 = stripComments(read("src/components/useCallEngine.ts"));
  const exits = [...uce2.matchAll(/claimVoice\("cascade",\s*"(watch_[a-z_]+)"\)/g)];
  if (!exits.length) {
    FAIL(
      "no claimVoice(\"cascade\", \"watch_*\") sites found — 7d is guarding nothing",
      "Either the watch lane stopped exiting to the cascade (in which case delete",
      "this check and say so) or the pattern moved and the guard is now blind.",
    );
  } else {
    for (const ex of exits) {
      // THE WINDOW IS STRUCTURAL, NOT A CHARACTER COUNT. The first version of
      // this check looked 1400 chars ahead, and it failed on a branch that
      // HAD the reconnect: the comment explaining why the reconnect was there
      // pushed the call itself past the window. A guard whose verdict depends
      // on how much prose sits next to the code is measuring the prose.
      // Each exit is followed by its own handling and then the next exit, so
      // "before the next claimVoice, or end of file" is the real boundary.
      const rest = uce2.slice(ex.index + ex[0].length);
      const nextExit = rest.search(/claimVoice\("cascade",\s*"watch_/);
      const after = nextExit === -1 ? rest : rest.slice(0, nextExit);
      if (!/reconnectLiveAfterWatch\(\)/.test(after)) {
        FAIL(
          `useCallEngine.ts: claimVoice("cascade", "${ex[1]}") never tries to return to the live lane`,
          "Starting a share killed the JS live session before the consent dialog, so",
          "this exit strands the call on a DIFFERENT MODEL FAMILY for the rest of its",
          "life — the same voice name rendered by a different model is a different",
          "woman (docs/VOICE-LANE.md §6.4).",
          "Add `void reconnectLiveAfterWatch();` to this branch. It is safe to call:",
          "it no-ops when nothing was compiled, when the owner is not cascade, and it",
          "hands off through adoptLiveLate so she is never cut mid-word.",
        );
      } else {
        console.log(`  ok    ${ex[1].padEnd(26)} returns to the live lane`);
      }
    }
  }
}

console.log(
  fail
    ? `\nvoice lane NOT shippable (${fail} problem${fail > 1 ? "s" : ""})`
    : `\n  ok  one name (${voices[0]}), ${distinct.length} declared models, one spoken-text core, ${speechCalls} live text→audio path, goAway rotation at parity`,
);
process.exit(fail ? 1 : 0);
