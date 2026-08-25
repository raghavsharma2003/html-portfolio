// WHAT THE PLATFORM ENGINE IS ACTUALLY HANDED.
//
//   node evals/voice/device.mjs
//
// Run as part of `node scripts/verify-voice.mjs`, which is a gate inside
// `scripts/verify-release.mjs`.
//
// ── why this exists and why it is not a grep ─────────────────────────────
// `evals/voice/spoken.mjs` proves the RULES are right. It cannot prove they are
// APPLIED: it calls `spokenText` directly, which is the same mistake as a
// `sourceStatus: "wired"` string (`context/rejected.md#selfbundle-never-set`) —
// a claim about wiring, checked by nothing. Three engines in src/voice/speech.ts
// never touch /api/speech, so for them there is no server seam to fall back on:
//
//   ElevenLabs   `elevenFetch`  — user key, direct POST
//   Sarvam       `sarvamFetch`  — user key, direct POST
//   device TTS   `speak()` tier 2 — Capacitor TextToSpeech, or speechSynthesis
//
// The device tier is the deepest fallback in the product and it is REACHABLE
// TODAY: `one-key-two-jobs` measured OPENROUTER_KEY exhausted (limit 25, usage
// 25.021) and `free-tts-daily` measured the free Google pool dying inside one
// session, at which point /api/speech answers 502 and `speakCall` /
// `createStreamSpeaker` fall through to `speak(allText, …)`.
//
// So this harness bundles the REAL src/voice/speech.ts, replaces the platform
// engines and `fetch` with recorders, drives the REAL entry points a call uses,
// and asserts on the exact strings that would have been spoken or POSTed. It is
// the difference between "the sanitiser is imported" and "the engine got clean
// text".
//
// It runs no network and costs nothing. The free Gemini pool is a DAILY budget
// shared with production (`free-tts-daily`) and is never touched here.

import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { rmSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const STUB = join(HERE, "stubs/platform.mjs");
// Pid-scoped: `verify-release.mjs` and a hand-run of this file can overlap, and
// a fixed name meant one run's cleanup deleted the other run's bundle
// mid-import — which surfaced as ERR_MODULE_NOT_FOUND and was reported by the
// gate as "a path is unsanitised". A shared temp path is a shared mutable, and
// a false red on a safety gate is worse than a slow one.
const BUNDLE = join(HERE, `.device.${process.pid}.bundle.mjs`);

execFileSync(
  process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npx",
  [
    ...(process.platform === "win32" ? ["/d", "/s", "/c", "npx"] : []),
    "esbuild",
    join(ROOT, "src/voice/speech.ts"),
    "--bundle",
    "--format=esm",
    "--platform=node",
    `--outfile=${BUNDLE}`,
    "--log-level=error",
    `--alias:@capacitor/core=${STUB}`,
    `--alias:@capacitor-community/text-to-speech=${STUB}`,
    `--alias:@capgo/capacitor-speech-recognition=${STUB}`,
  ],
  { stdio: "inherit", cwd: ROOT },
);

/* ── the room the module wakes up in ─────────────────────────────────────
   No AudioContext: that is the honest shape of the failure this covers — the
   device tier is where a call lands when the clips do not arrive, and it is
   also the only tier that makes sound without one. `fetch` always fails, which
   is the production condition of `screen-share-triple-swap`: paid arm
   exhausted, free pool 429ing, /api/speech answering 502. */
const CAP = (globalThis.__VOICE_CAPTURE = { device: [], eleven: [], sarvam: [], proxy: [] });

const bodyText = (init) => {
  try {
    return JSON.parse(init?.body ?? "{}").text ?? "";
  } catch {
    return "";
  }
};

globalThis.fetch = async (url, init) => {
  const u = String(url);
  const text = bodyText(init);
  if (/api\.elevenlabs\.io/.test(u)) CAP.eleven.push(text);
  else if (/api\.sarvam\.ai/.test(u)) CAP.sarvam.push(text);
  else if (/\/api\/speech/.test(u)) CAP.proxy.push(text);
  // Every engine refuses, so every path walks to the end of its cascade. That
  // is the point: the last rung is the one nothing was guarding.
  return { ok: false, status: 502, headers: { get: () => "" }, body: null };
};

class FakeUtterance {
  constructor(text) {
    this.text = text;
    CAP.device.push(String(text ?? ""));
  }
}
globalThis.SpeechSynthesisUtterance = FakeUtterance;
globalThis.window = {
  speechSynthesis: {
    cancel() {},
    getVoices: () => [],
    speak: (u) => setTimeout(() => u.onend?.(), 0),
  },
  setInterval: (...a) => setInterval(...a),
  clearInterval: (...a) => clearInterval(...a),
};

/* ── the corpus ──────────────────────────────────────────────────────────
   Her real conventions, not a regex fixture: the em-dash three of persona.ts's
   rules ask her for, markdown emphasis, a bullet list, an arrow, a leaked tag,
   an emoji, a URL — and, as the control that matters most, a crisis helpline
   whose hyphens must SURVIVE. Over-stripping is the silent failure of any
   sanitiser and the helplines are what this repo protects hardest. */
//
// `mustSay` is the half that keeps this honest. A sanitiser that returned ""
// for everything would pass every markup assertion in this file, and
// over-stripping is the silent failure mode — this repo has now measured it
// twice (`stripProtocol` deleted the word between two `**bold**` spans for as
// long as that rule existed). Words she actually said have to arrive.
const CORPUS = [
  ["the reported bug, twice in one line", "arre — sun na — kal chalein? main free hu.",
    ["arre", "sun na", "kal chalein", "main free hu"]],
  ["a cut-off mid-sentence, which is what she was told to write", "he said— no wait, he messaged actually.",
    ["he said", "no wait", "he messaged actually"]],
  ["markdown emphasis on a real word", "yeh **sach** mein hua tha. main *bilkul* thak gayi.",
    ["yeh", "sach", "mein hua tha", "thak gayi"]],
  ["a bullet list read as a list", "laana hai:\n- doodh\n- cheeni\n- chai",
    ["laana hai", "doodh", "cheeni", "chai"]],
  ["an arrow and a pipe", "ghar → office → ghar. iCall: 9152987821 | Vandrevala: 9999666555",
    ["ghar", "office", "9152987821", "9999666555"]],
  ["a leaked stage direction and an emoji", "[laughs softly] pagal hai tu 😂 sach mein",
    ["pagal hai tu", "sach mein"]],
  ["a URL she would say out loud", "dekh https://meera-silk.vercel.app/chat pe hai",
    ["dekh", "meera-silk.vercel.app/chat", "pe hai"]],
  ["THE control: a crisis helpline must survive intact", "please call Kiran — 1800-599-0019 — abhi.",
    ["Kiran", "1800-599-0019", "abhi"]],
];

/** Every writing convention that has no spoken form, with what an engine does
 *  with it if it survives. Measured where the entry says measured. */
const FORBIDDEN = [
  [/[‒-―]/, "an em/en dash"],
  [/(^|\s)-{2,}(\s|$)/, "a doubled ASCII hyphen"],
  [/ - /, "a spaced ASCII hyphen (a dash, not a spelling)"],
  [/\*/, "an asterisk (espeak-ng 1.51 says \"asterisk\" out loud — measured)"],
  [/[←-⇿]/, "an arrow (espeak-ng 1.51 says \"right arrow\" — measured)"],
  [/(^|\s)(->|=>|<-)(\s|$)/, "an ASCII arrow"],
  [/\|/, "a pipe"],
  [/[•·▪]/, "a bullet"],
  [/[<>{}]/, "machine framing"],
  [/https?:\/\//, "a URL scheme (h-t-t-p-s colon slash slash)"],
  [/&(amp|nbsp|quot|apos);/i, "an undecoded HTML entity"],
  [/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u, "an emoji"],
];
/** Rule B drops `[...]` everywhere EXCEPT the one engine that performs it. */
const BRACKET = [/\[[^\]]*\]|\[/, "a bracket segment"];
const AUDIO_TAG = /^\[[a-z][a-z ]{0,14}[a-z]\]$/i;

let fail = 0;
const show = (s) => JSON.stringify(s);

/** One lane's verdict. `tagsOk` is true only for ElevenLabs v3. */
function check(lane, why, captured, { tagsOk = false, mustSay = [] } = {}) {
  const joined = captured.join(" ⏎ ");
  const bad = [];
  for (const [re, what] of FORBIDDEN) if (re.test(joined)) bad.push(what);
  for (const words of mustSay)
    if (!joined.includes(words)) bad.push(`her own words ${show(words)} were DELETED`);
  if (!tagsOk) {
    if (BRACKET[0].test(joined)) bad.push(BRACKET[1]);
  } else {
    for (const m of joined.match(/\[[^\]]*\]?/g) ?? [])
      if (!AUDIO_TAG.test(m)) bad.push(`a non-performable bracket ${show(m)}`);
  }
  if (!captured.length) {
    fail++;
    console.log(`  FAIL  ${lane}: nothing reached the engine at all — the harness proved nothing`);
    return;
  }
  if (bad.length) {
    fail++;
    console.log(`  FAIL  ${lane}: ${why}\n          spoke ${show(joined)}\n          carries ${bad.join("; ")}`);
  } else {
    console.log(`  ok    ${lane}: ${why}`);
  }
}

const load = async (native) => {
  globalThis.__MEERA_NATIVE = native;
  // A fresh module instance per lane: `isNative` is captured at load.
  const url = pathToFileURL(BUNDLE);
  url.searchParams.set("lane", native ? "native" : "web");
  url.searchParams.set("t", String(Date.now()));
  return import(url.href);
};

const reset = () => {
  CAP.device.length = 0;
  CAP.eleven.length = 0;
  CAP.sarvam.length = 0;
  CAP.proxy.length = 0;
};

const settled = () => new Promise((r) => setTimeout(r, 60));

console.log("── what the platform engines are handed ──");

/* ── 1. Android device TTS, reached the way production reaches it ────────── */
{
  const { speakCall } = await load(true);
  for (const [why, text, mustSay] of CORPUS) {
    reset();
    await new Promise((done) => speakCall(text, undefined, done, {}, undefined));
    await settled();
    check("device TTS (Capacitor, via speakCall→speak fallback)", why, CAP.device, { mustSay });
  }
}

/* ── 2. the web device voice — same tier, different engine ───────────────── */
{
  const { speak } = await load(false);
  for (const [why, text, mustSay] of CORPUS) {
    reset();
    await new Promise((done) => speak(text, undefined, done, {}));
    await settled();
    check("device TTS (speechSynthesis)", why, CAP.device, { mustSay });
  }
}

/* ── 3. the streaming entry point — the one a real call uses ─────────────── */
{
  const { createStreamSpeaker } = await load(true);
  for (const [why, text, mustSay] of CORPUS) {
    reset();
    await new Promise((done) => {
      const s = createStreamSpeaker({}, undefined, undefined, done);
      for (const ch of text.match(/.{1,7}/gs) ?? []) s.push(ch);
      s.finish();
    });
    await settled();
    check("device TTS (createStreamSpeaker→speak fallback)", why, CAP.device, { mustSay });
  }
}

/* ── 4. the two user-key engines, at their own doors ─────────────────────── */
{
  const { speak } = await load(false);
  for (const [why, text, mustSay] of CORPUS) {
    reset();
    await new Promise((done) => speak(text, undefined, done, { sarvamKey: "test-key" }));
    await settled();
    check("Sarvam (direct POST, user key)", why, CAP.sarvam, { mustSay });
  }
  for (const [why, text, mustSay] of CORPUS) {
    reset();
    await new Promise((done) => speak(text, undefined, done, { elevenKey: "test-key" }));
    await settled();
    // ElevenLabs v3 PERFORMS `[laughs]`, and speech.ts routes tagged replies to
    // it on purpose. Its door keeps the tag and strips everything else.
    check("ElevenLabs (direct POST, user key)", why, CAP.eleven, { tagsOk: true, mustSay });
  }
}

/* ── 5. the control: the proxy lane, which is sanitised server-side too ──── */
{
  const { speak } = await load(false);
  reset();
  await new Promise((done) => speak(CORPUS[0][1], undefined, done, {}));
  await settled();
  check("hosted proxy (/api/speech — belt AND braces)", CORPUS[0][0], CAP.proxy, {
    mustSay: CORPUS[0][2],
  });
}

/* ── 6. THE NEGATIVE CONTROL, and it is the whole risk of a sanitiser ─────
   Over-stripping is silent: delete every dash and you have deleted
   "1800-599-0019", and on a call the spoken copy is the ONLY copy of a crisis
   helpline there is. This asserts the number arrives at the engine intact. */
{
  const { speak } = await load(true);
  reset();
  await new Promise((done) =>
    speak("please call Kiran — 1800-599-0019 — abhi, promise me", undefined, done, {}),
  );
  await settled();
  const joined = CAP.device.join(" ");
  if (joined.includes("1800-599-0019")) {
    console.log("  ok    the crisis helpline reaches the device engine with its hyphens intact");
  } else {
    fail++;
    console.log(
      `  FAIL  the crisis helpline was mangled on the way to the device engine\n          spoke ${show(joined)}`,
    );
  }
}

rmSync(BUNDLE, { force: true });

console.log(
  fail
    ? `\nplatform engines: ${fail} FAILED — a path from her text to audio is unsanitised`
    : "\n  ok  every text→audio path in src/voice/speech.ts hands the engine sanitised text",
);
process.exit(fail ? 1 : 0);
