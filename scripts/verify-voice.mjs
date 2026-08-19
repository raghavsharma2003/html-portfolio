// Her voice is one voice, and the three places that name it must agree.
//
// WHY THIS EXISTS — this bug already shipped once, and api/speech.js's own
// header is the incident report:
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

import { readFileSync, existsSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(ROOT + p, "utf8");

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

let fail = 0;
const found = [];

for (const site of SITES) {
  const src = read(site.file);
  const m = src.match(site.re);
  if (!m) {
    console.log(`  FAIL  ${site.file}: no voice literal matched — the pattern moved, so this guard is no longer guarding anything`);
    fail++;
    continue;
  }
  found.push({ ...site, voice: m[1] });
}

if (existsSync(ROOT + NATIVE.file)) {
  const m = read(NATIVE.file).match(NATIVE.re);
  if (m) found.push({ ...NATIVE, voice: m[1] });
  else console.log(`  note  ${NATIVE.file} present but no voice literal matched — check by hand`);
} else {
  console.log(`  note  ${NATIVE.file} not in this checkout — skipped`);
}

const voices = [...new Set(found.map((f) => f.voice))];

for (const f of found) console.log(`  ok    ${f.voice.padEnd(8)} ${f.file} — ${f.governs}`);

if (voices.length > 1) {
  console.log(`\n  FAIL  her voice disagrees across lanes: ${voices.join(", ")}`);
  console.log("        A call that starts on one lane and falls back to another will swap her");
  console.log("        for a different woman mid-sentence. This exact bug shipped once and was");
  console.log("        reported as 'multiple personalities' — see api/speech.js's header.");
  fail++;
}

// The allow-list must contain whatever the lanes agreed on, or a request that
// names her own voice gets rejected as invalid.
if (voices.length === 1) {
  const allowed = read("api/speech.js").match(/const ALLOWED_VOICES = new Set\(\[([^\]]*)\]\)/);
  if (allowed && !allowed[1].includes(`"${voices[0]}"`)) {
    console.log(`\n  FAIL  ALLOWED_VOICES does not contain ${voices[0]} — her own voice would be refused`);
    fail++;
  }
}

console.log(fail ? `\nvoice mirrors DISAGREE (${fail} problem${fail > 1 ? "s" : ""})` : `\n  ok  her voice is ${voices[0]} on all ${found.length} lanes that name it`);
process.exit(fail ? 1 : 0);
