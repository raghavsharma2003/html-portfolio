// WS-SOUND — the gate on the sound layer.
//
//   node evals/sound.mjs
//
// Offline, deterministic, $0, no network, no browser, ~2s. Wired into
// evals/run.mjs for the reason every other suite there is: `dead-writers` does
// not stop being true for evals, and a guard nothing invokes is worse than an
// absent one because it produces false confidence
// (`engine-bundle-check-uncalled`).
//
// ── WHAT IT IS ACTUALLY GUARDING ──────────────────────────────────────────
//
// A sound layer fails in ways nothing else in this repo's gate set can see.
// A type checker cannot tell you that a cue plays during a call; a build
// cannot tell you the toggle has been bypassed; a screenshot has no audio
// track. Every failure mode below is silent in the literal sense, and three of
// them are the ones docs/PRODUCT-SUPERIORITY.md #1 pre-registered as "fails
// if" before a line was written:
//
//   (b) a sound plays while a call is live. It leaves the speaker, enters the
//       mic, and lands in the echo coefficient the whole audio floor at
//       evals/echosim/ is measured against. This is the only gate here with a
//       negative control, because it is the only one whose failure damages
//       something outside the sound layer.
//   (d) the vocabulary drifts. A closed set that nothing closes is a set, and
//       the next agent adds a notification chime.
//   (e) a cue with no user action in front of it. Enforced structurally: the
//       REFUSED table is asserted to still be refused.
//
// Plus the two the brief added: no path reaches the speaker around the toggle,
// and nothing can sound before the first user gesture.
//
// ── HOW THE BEHAVIOURAL HALF RUNS WITHOUT A BROWSER ───────────────────────
//
// A fake AudioContext that records every node, every envelope and every
// scheduled start/stop. That is enough to assert the gates AND the mix: the
// declared peak of every cue, its real duration, and the two-layer rule that
// gives the palette its character are all properties of what was scheduled,
// not of what was heard. What a fake context CANNOT tell you is whether it
// sounds any good, and this file does not pretend to — that is ears, and the
// browser battery at evals/sound-browser.mjs is what proves the cues reach a
// real one.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(HERE, ".sound");
mkdirSync(OUT, { recursive: true });

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) {
    fail++;
    console.log(`FAIL ${name}${extra ? " — " + extra : ""}`);
  }
};
const src = (f) => readFileSync(join(ROOT, f), "utf8");

/* ── stubs ────────────────────────────────────────────────────────────────
   react and @capacitor/haptics, because the module under test reaches both
   transitively and neither has anything to say about sound. Written to disk
   rather than kept in memory so esbuild can alias to a real path. */
writeFileSync(
  join(OUT, "react.mjs"),
  "export const useState = (v) => [typeof v === 'function' ? v() : v, () => {}];\n" +
    "export const useEffect = () => {};\nexport default { useState, useEffect };\n",
);
// The log hangs off globalThis rather than off this module's exports, and that
// is not laziness: esbuild INLINES the stub into the bundle, so a `hapticLog`
// imported here would be a different array from the one the bundled code
// pushes to — and every haptic assertion would read an empty list and pass
// only for the cues that fire nothing. It read as a real finding for a minute.
writeFileSync(
  join(OUT, "haptics.mjs"),
  "globalThis.__hapticLog = globalThis.__hapticLog || [];\n" +
    "export const ImpactStyle = { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' };\n" +
    "export const NotificationType = { Success: 'SUCCESS' };\n" +
    "export const Haptics = {\n" +
    "  impact: (o) => { globalThis.__hapticLog.push('impact:' + o.style); return Promise.resolve(); },\n" +
    "  notification: (o) => { globalThis.__hapticLog.push('notify:' + o.type); return Promise.resolve(); },\n" +
    "};\n",
);
writeFileSync(
  join(OUT, "entry.ts"),
  "export * from '../../src/sound/index';\n" +
    "export { publishCallStatus, clearCallStatus } from '../../src/state/callStatus';\n" +
    "export { RECIPES } from '../../src/sound/synth';\n",
);

const BUNDLE = join(OUT, "bundle.mjs");
execSync(
  `npx esbuild ${join(OUT, "entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error ` +
    `--alias:react=${join(OUT, "react.mjs")} ` +
    `--alias:@capacitor/haptics=${join(OUT, "haptics.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);

/* ── the fake context ─────────────────────────────────────────────────── */

/** Everything scheduled since the last `voices.length = 0`. */
const voices = [];

function param(node, name) {
  const p = {
    value: 0,
    peak: 0,
    setValueAtTime(v) {
      p.value = v;
      if (name === "gain") p.peak = Math.max(p.peak, v);
      return p;
    },
    exponentialRampToValueAtTime(v) {
      if (v <= 0) throw new Error("exponentialRamp to zero");
      p.value = v;
      if (name === "gain") p.peak = Math.max(p.peak, v);
      return p;
    },
    linearRampToValueAtTime(v) {
      p.value = v;
      if (name === "gain") p.peak = Math.max(p.peak, v);
      return p;
    },
    cancelScheduledValues() {
      return p;
    },
  };
  node[name] = p;
  return p;
}

function node(kind, ctx) {
  const n = { kind, ctx, out: null };
  n.connect = (dest) => {
    n.out = dest;
    return dest;
  };
  n.disconnect = () => {};
  return n;
}

class FakeAudioContext {
  constructor(opts) {
    this.options = opts ?? {};
    this.sampleRate = 48000;
    this.currentTime = 1.0;
    this.state = "running";
    this.destination = node("destination", this);
    this.built = [];
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  createBuffer(ch, len, rate) {
    const data = new Float32Array(len);
    return { numberOfChannels: ch, length: len, sampleRate: rate, getChannelData: () => data };
  }
  createGain() {
    const g = node("gain", this);
    param(g, "gain");
    this.built.push(g);
    return g;
  }
  createBiquadFilter() {
    const f = node("filter", this);
    f.type = "bandpass";
    param(f, "frequency");
    param(f, "Q");
    this.built.push(f);
    return f;
  }
  createOscillator() {
    const o = node("osc", this);
    o.type = "sine";
    param(o, "frequency");
    param(o, "detune");
    const v = { kind: "osc", node: o, start: null, end: null };
    o.start = (t) => {
      v.start = t;
      voices.push(v);
    };
    o.stop = (t) => {
      v.end = t;
    };
    this.built.push(o);
    return o;
  }
  createBufferSource() {
    const s = node("buffer", this);
    s.buffer = null;
    const v = { kind: "buffer", node: s, start: null, end: null };
    s.start = (t, _off, dur) => {
      v.start = t;
      v.end = t + (dur ?? 0);
      voices.push(v);
    };
    s.stop = (t) => {
      v.end = t;
    };
    this.built.push(s);
    return s;
  }
}

/** The gain node each voice ultimately routes through, and its peak. */
function voicePeak(v) {
  let n = v.node;
  let peak = 0;
  const seen = new Set();
  while (n && !seen.has(n)) {
    seen.add(n);
    if (n.kind === "gain" && n.gain) peak = Math.max(peak, n.gain.peak);
    n = n.out;
  }
  return peak;
}

class FakeWindow extends EventTarget {}
const win = new FakeWindow();
win.AudioContext = FakeAudioContext;
globalThis.window = win;
globalThis.document = { visibilityState: "visible" };
globalThis.AudioContext = FakeAudioContext;

const S = await import(pathToFileURL(BUNDLE).href);

/** Reset the module, arm it, and deliver the "first user gesture". */
function unlocked() {
  S._resetSound();
  S.clearCallStatus();
  globalThis.document.visibilityState = "visible";
  S.armSound();
  win.dispatchEvent(new Event("pointerdown"));
}

const IDLE_CALL = {
  live: false,
  connecting: false,
  muted: false,
  mmss: "",
  watching: false,
  watchPaused: false,
  laneDegraded: false,
};
const callOf = (over) => S.publishCallStatus({ ...IDLE_CALL, ...over });

/* ── 1. the vocabulary is closed ──────────────────────────────────────── */

const CUES = S.CUES;
const NAMES = S.SOUND_CUES;
ok("the set is small", NAMES.length >= 3 && NAMES.length <= 8, `${NAMES.length} cues`);
ok("no duplicates", new Set(NAMES).size === NAMES.length);
for (const c of NAMES) {
  const spec = CUES[c];
  ok(`${c} has a spec`, Boolean(spec));
  if (!spec) continue;
  // Every cue names a haptic level or names `null`, which is a DECISION.
  // `undefined` would be someone forgetting, and the two must not look alike.
  ok(`${c} decides its haptic`, "haptic" in spec && ["tap", "land", "moment", null].includes(spec.haptic), String(spec.haptic));
  ok(`${c} says what it sounds like`, typeof spec.sounds === "string" && spec.sounds.length > 40);
  // The rule from docs/PRODUCT-SUPERIORITY.md #1 fails-if (e), mechanised as
  // far as prose can be: a cue must state what it is CONFIRMING. A cue whose
  // answer is empty is a cue with nothing in front of it.
  ok(`${c} says what it answers`, typeof spec.answers === "string" && spec.answers.length > 20);
  ok(`${c} has a recipe`, typeof S.RECIPES[c] === "function");
  ok(`${c} is under the duration ceiling`, spec.ms > 0 && spec.ms <= S.MAX_CUE_MS, `${spec.ms}ms`);
  ok(`${c} is under the gain ceiling`, spec.gain > 0 && spec.gain <= 1, String(spec.gain));
}
ok(
  "no recipe without a cue",
  Object.keys(S.RECIPES).every((k) => NAMES.includes(k)),
  Object.keys(S.RECIPES).filter((k) => !NAMES.includes(k)).join(","),
);
ok("guard accepts every cue", NAMES.every(S.isCue));
for (const junk of ["", "ping", "Send", "typing", "notify", null, undefined, 0, {}]) {
  ok(`guard rejects ${JSON.stringify(junk)}`, !S.isCue(junk));
}

/* ── 2. the refusals stay refused ─────────────────────────────────────── */
//
// The point of REFUSED is that an absence with no reason attached is
// indistinguishable from an oversight and gets "fixed" by the next agent. So
// each one is asserted to still be absent AND to still carry its argument.
const REFUSED = S.REFUSED;
ok("something is refused", Object.keys(REFUSED).length >= 4);
for (const [name, why] of Object.entries(REFUSED)) {
  ok(`"${name}" is still not a cue`, !NAMES.includes(name));
  ok(`"${name}" still says why`, typeof why === "string" && why.length > 80);
}
ok("the typing tick is refused by name", "typing" in REFUSED);
ok("the call-connect tone is refused by name", "call-connect" in REFUSED);

/* ── 3. structure: one path to the speaker ────────────────────────────── */

const index = src("src/sound/index.ts");
const synth = src("src/sound/synth.ts");
const vocab = src("src/sound/vocabulary.ts");

// Strip comments before any structural claim. This file's own prose names
// every function it is asserting about, and a scan that counts a mention in a
// comment is a scan that passes on a codebase where the code was deleted.
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const iCode = code(index);
ok("RECIPES is invoked exactly once", (iCode.match(/RECIPES\[/g) || []).length === 1, String((iCode.match(/RECIPES\[/g) || []).length));
ok("that one invocation is inside play()", /export function play[\s\S]*?RECIPES\[/.test(iCode));
ok("play consults the gate first", /export function play\(cue: Cue\): void \{[\s\S]{0,200}?blockedBy\(cue, now\) !== null\) return;/.test(iCode));
ok("feel goes through play", /export function feel[\s\S]{0,120}?play\(cue\);/.test(iCode));

// Nothing outside src/sound may reach the synth, and src/sound may not reach
// the voice lane. The second half is the import law restated from the other
// side: the call owns audio, and the way this layer stays out of the echo
// coefficient is by having no edge to the code that carries it.
const sourceFiles = (dir, prefix = "src") =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${prefix}/${entry.name}`;
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute, relative);
    return /\.tsx?$/.test(entry.name) ? [relative] : [];
  });
const files = sourceFiles(join(ROOT, "src"));
const synthImporters = files.filter((f) => /from ["'][^"']*sound\/synth["']/.test(src(f)));
ok("only src/sound imports the synth", synthImporters.every((f) => f.startsWith("src/sound/")), synthImporters.join(","));
const soundFiles = files.filter((f) => f.startsWith("src/sound/"));
for (const f of soundFiles) {
  ok(`${f} does not import the voice lane`, !/from ["']\.\.\/voice\//.test(src(f)));
}

// An AudioContext built anywhere else is a second sound layer with no gate on
// it. The voice lane's contexts are named, along with Studio's capture-only
// graph. Studio connects through an exactly-zero gain node only so the browser
// delivers microphone frames; it is not a second audible output path.
const studioCapture = code(src("src/studio/wavCapture.ts"));
ok("Studio microphone capture keeps its processing graph silent", /silent\.gain\.value\s*=\s*0/.test(studioCapture));
// WS-Y's Mirror Call capture is the same capture-only shape: its context may
// exist ONLY under the same proof wavCapture carries — an exactly-zero gain
// between the processor and the destination. Listing it without asserting the
// silence would turn the enumeration into a bypass list.
const callCapture = code(src("src/studio/callCapture.ts"));
ok("Mirror Call capture keeps its processing graph silent", /silent\.gain\.value\s*=\s*0/.test(callCapture));
const AUDIO_CONTEXT_OWNERS = new Set([
  "src/voice/speech.ts",
  "src/voice/liveCall.ts",
  "src/sound/index.ts",
  "src/studio/wavCapture.ts",
  "src/studio/callCapture.ts",
]);
for (const f of files) {
  if (AUDIO_CONTEXT_OWNERS.has(f)) continue;
  ok(`${f} constructs no AudioContext`, !/new\s+(window\.)?(AudioContext|AC)\b/.test(code(src(f))));
}

// Every call site names a LITERAL cue, and the only computed form allowed is a
// ternary between two literals — which is still an enumerated choice between
// two members of the set, and is what a board needs to pick between place and
// take. Anything else (a variable, a lookup, a template string) is how a
// component ends up able to play a sound the vocabulary never agreed to.
//
// Scoped to the files that actually IMPORT the layer. The first version of
// this scan matched `play(` and `feel(` anywhere in src/, which caught the
// chess engine's `play(game, move)` and speech.ts's `play()` — a lint whose
// false positives are in unrelated modules is a lint that gets deleted.
const importers = files.filter((f) => /from\s+["'](?:\.\.\/)+sound["']/.test(src(f)));
ok("the layer has importers", importers.length >= 4, importers.join(","));
const LITERAL = /^"([a-z-]+)"$/;
const TERNARY = /\?\s*"([a-z-]+)"\s*:\s*"([a-z-]+)"$/;
let callSites = 0;
for (const f of importers) {
  for (const m of code(src(f)).matchAll(/\b(?:play|feel)\(\s*([^;]*?)\s*\);/g)) {
    const arg = m[1].replace(/\s+/g, " ").trim();
    callSites++;
    const lit = arg.match(LITERAL);
    const tern = arg.match(TERNARY);
    const cues = lit ? [lit[1]] : tern ? [tern[1], tern[2]] : [];
    ok(`${f}: ${arg} is a literal cue or a ternary of two`, cues.length > 0, arg);
    ok(`${f}: ${arg} names only cues from the set`, cues.length > 0 && cues.every((c) => NAMES.includes(c)), arg);
  }
}
ok("the layer actually has call sites", callSites >= 5, `${callSites}`);

// The toggle has exactly two publishers, and both are named in writing in
// src/sound/index.ts. A third would be a place the setting can be turned on
// by something that is not the setting.
const publishers = files.filter((f) => !f.startsWith("src/sound/") && /setSoundEnabled\(/.test(code(src(f))));
ok(
  "setSoundEnabled has exactly its two documented callers",
  publishers.length === 2 &&
    publishers.includes("src/components/Chat.tsx") &&
    publishers.includes("src/components/MoreSheet.tsx"),
  publishers.join(","),
);
// The test seam is a test seam: declared in the module, called by nothing that
// ships. (`src/sound/index.ts` itself is where it is DEFINED, not called.)
const resetters = files.filter((f) => !f.startsWith("src/sound/") && /_resetSound\(/.test(code(src(f))));
ok("the reset seam has no caller in src/", resetters.length === 0, resetters.join(","));

// The two-layer rule is the palette's whole character, so it is asserted on
// the source as well as on the schedule: a recipe that stops using air stops
// sounding physical, and the schedule assertion below would still pass if
// someone replaced the noise with a second oscillator.
ok("the synth builds noise", /createBufferSource\(\)/.test(code(synth)));
ok("the synth builds tones", /createOscillator\(\)/.test(code(synth)));
// `animation-implicit-end`, in audio: an envelope that rides down to a
// near-zero and is never SET to zero leaves a gain node parked forever.
ok("every envelope states its own end", /setValueAtTime\(0,\s*t0 \+ attackS \+ decayS/.test(code(synth)));
ok("the mix lives in the vocabulary", /CUES\[/.test(code(synth)) || /CUES\./.test(code(synth)));
ok("the vocabulary is pure data", !/AudioContext|createGain|window\./.test(code(vocab)));

/* ── 4. the gates, each one driven on its own ─────────────────────────── */

// LOCKED. Nothing exists and nothing sounds until a gesture. This is the one
// gate that is browser law as well as policy, and it is asserted first
// because every other assertion in this section depends on it being open.
S._resetSound();
S.clearCallStatus();
ok("silent before arming", S.blockedBy("send") === "locked", String(S.blockedBy("send")));
S.armSound();
ok("arming alone builds nothing", S.blockedBy("send") === "locked", String(S.blockedBy("send")));
voices.length = 0;
S.play("send");
ok("play before a gesture schedules nothing", voices.length === 0, `${voices.length} voices`);
win.dispatchEvent(new Event("pointerdown"));
ok("the first gesture opens the gate", S.blockedBy("send") === null, String(S.blockedBy("send")));

// THE TOGGLE.
unlocked();
S.setSoundEnabled(false);
ok("off blocks every cue", NAMES.every((c) => S.blockedBy(c) === "off"));
voices.length = 0;
for (const c of NAMES) S.play(c);
ok("off schedules nothing at all", voices.length === 0, `${voices.length} voices`);
S.setSoundEnabled(true);
ok("on reopens it", S.blockedBy("send") === null);

// THE CALL, from both sources and in all three of its shapes.
for (const [label, over] of [
  ["live", { live: true }],
  ["connecting", { connecting: true }],
  ["sharing the screen", { watching: true }],
]) {
  unlocked();
  callOf(over);
  ok(`callStatus ${label} blocks every cue`, NAMES.every((c) => S.blockedBy(c) === "in-call"), String(S.blockedBy("send")));
  voices.length = 0;
  for (const c of NAMES) S.play(c);
  ok(`callStatus ${label} schedules nothing`, voices.length === 0, `${voices.length} voices`);
}
unlocked();
S.setCallActive(true);
ok("the chat's own inCall blocks too", S.blockedBy("send") === "in-call", String(S.blockedBy("send")));
voices.length = 0;
S.play("send");
ok("the chat's own inCall schedules nothing", voices.length === 0);
S.setCallActive(false);
ok("and lifts when the call ends", S.blockedBy("send") === null);

// VISIBILITY.
unlocked();
globalThis.document.visibilityState = "hidden";
ok("a backgrounded app is silent", S.blockedBy("send") === "hidden");
globalThis.document.visibilityState = "visible";

// THE SILENT-MODE SEAM. Wired to nothing today; asserted to WORK, so the day
// a platform probe exists it is one line and not a rewrite.
unlocked();
S.registerSilenceProbe(() => true);
ok("a silence probe silences the layer", S.blockedBy("send") === "silenced");
S.registerSilenceProbe(() => false);
ok("and a probe that says no does not", S.blockedBy("send") === null);

// THE THROTTLE. Two transients inside a few milliseconds sum, and a summed
// transient is louder than either cue's declared peak.
unlocked();
S.play("place");
ok("a second cue on the same millisecond is throttled", S.blockedBy("place") === "throttled");

// AN UNKNOWN CUE. Nothing in TypeScript stops a value arriving from a stored
// blob or a future build; the gate answers rather than throwing.
unlocked();
ok("an unknown cue is refused, not thrown", S.blockedBy("nope") === "unknown-cue");
voices.length = 0;
S.play("nope");
ok("an unknown cue schedules nothing", voices.length === 0);

/* ── 5. the cues actually sound, and sound as declared ────────────────── */

for (const c of NAMES) {
  unlocked();
  voices.length = 0;
  S.play(c);
  ok(`${c} schedules something`, voices.length > 0, `${voices.length} voices`);
  if (!voices.length) continue;
  const t0 = Math.min(...voices.map((v) => v.start));
  const end = Math.max(...voices.map((v) => v.end ?? v.start));
  const ms = (end - t0) * 1000;
  // Declared duration is a ceiling on the SCHEDULE, not a description of it:
  // a tail is allowed to be shorter than the table says, never longer, or the
  // throttle and the call-gate cut are both reasoning from a wrong number.
  ok(`${c} rings for no longer than declared`, ms <= CUES[c].ms + 1, `${ms.toFixed(0)}ms vs ${CUES[c].ms}ms`);
  ok(`${c} is not a click by accident`, ms >= 40, `${ms.toFixed(0)}ms`);
  // THE TWO-LAYER RULE. A cue with only a body is a notification; a cue with
  // only a transient is a UI toolkit. Both halves, every time.
  ok(`${c} has a noise transient`, voices.some((v) => v.kind === "buffer"));
  ok(`${c} has a pitched body`, voices.some((v) => v.kind === "osc"));
  // THE MIX. Every voice's envelope peak must be at or under the cue's
  // declared gain, and the declared gain times the master must be under the
  // absolute ceiling. This is the assertion that keeps "furniture, not
  // notification spam" a number rather than an intention.
  const peak = Math.max(...voices.map(voicePeak));
  ok(`${c} respects its declared gain`, peak <= CUES[c].gain + 1e-6, `${peak.toFixed(3)} vs ${CUES[c].gain}`);
  ok(`${c} is under the absolute ceiling`, CUES[c].gain * 0.34 <= S.MAX_ABS_PEAK, `${(CUES[c].gain * 0.34).toFixed(3)}`);
}

// The palette must have a RANKING. If every cue peaks at the same level the
// ear stops ranking them, which is the exact failure haptics.ts describes for
// touch and the reason it has three levels rather than one.
const gains = NAMES.map((c) => CUES[c].gain);
ok("the palette is ranked, not flat", new Set(gains).size >= 3, gains.join(","));

/* ── 6. sound and haptic fire from one call ───────────────────────────── */

const hapticLog = globalThis.__hapticLog;
ok("the haptic stub is reachable", Array.isArray(hapticLog));
for (const c of NAMES) {
  unlocked();
  hapticLog.length = 0;
  S.feel(c);
  const want = CUES[c].haptic;
  if (want === null) {
    ok(`feel("${c}") fires no haptic, as declared`, hapticLog.length === 0, hapticLog.join(","));
  } else {
    ok(`feel("${c}") fires its declared haptic`, hapticLog.length === 1, hapticLog.join(","));
  }
}
// The toggle is a SOUND toggle. Someone who silenced their phone in a meeting
// has not asked it to stop confirming their taps.
unlocked();
S.setSoundEnabled(false);
hapticLog.length = 0;
voices.length = 0;
S.feel("send");
ok("sound off leaves the haptic alone", hapticLog.length === 1, hapticLog.join(","));
ok("sound off really is silent", voices.length === 0);

/* ── 7. THE NEGATIVE CONTROL ──────────────────────────────────────────── */
//
// Everything in section 4 asserts silence, and a test that only checks
// "nothing happened" passes just as happily when the audio graph is dead as
// when the gate is working — which is a test that cannot tell a working gate
// from a deleted feature. `measured-but-not-felt` is the entry that says a
// gate must run its own negative control in-run.
//
// So: take the REAL bundle, delete the in-call clause from it, and prove that
// the same fixture which was silent above now sounds. If this arm goes quiet,
// the silence in section 4 was never evidence of anything.
const patched = join(OUT, "nogate.mjs");
const bundleText = readFileSync(BUNDLE, "utf8");
const CLAUSE = /if \(callActive \|\| call\.live \|\| call\.connecting \|\| call\.watching\) return "in-call";/;
ok("the in-call clause is findable in the bundle", CLAUSE.test(bundleText));
writeFileSync(patched, bundleText.replace(CLAUSE, "/* gate removed for the negative control */"));
{
  const D = await import(pathToFileURL(patched).href);
  D._resetSound();
  D.clearCallStatus();
  globalThis.document.visibilityState = "visible";
  D.armSound();
  win.dispatchEvent(new Event("pointerdown"));
  D.publishCallStatus({ ...IDLE_CALL, live: true });
  voices.length = 0;
  D.play("send");
  ok(
    "NEGATIVE CONTROL: without the clause, a live call DOES leak a cue",
    voices.length > 0,
    "the gate assertions above prove nothing if this is silent",
  );
}

console.log(fail ? `\nsound: ${fail} FAILED` : "  ok  sound layer: vocabulary closed, gated, mixed and paired");
process.exit(fail ? 1 : 0);
