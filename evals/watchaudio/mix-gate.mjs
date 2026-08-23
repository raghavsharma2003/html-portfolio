// WS-WATCHPERF part 2 — "let her hear it", and the proof that it cannot
// reach anything it must not reach.
//
//   node evals/watchaudio/mix-gate.mjs
//
// The owner reported that she cannot hear the phone's audio. She could not:
// the uplink has only ever carried the microphone. Fixing that means putting
// a second audio source into the one PCM stream a live session accepts, and
// there is no change in this repo with a worse failure mode available to it.
// The floor arbiter in LiveWatchEngine — ambience percentile, listen bar,
// barge threshold, the echo estimate and its lag lock, the hold ring — is the
// most expensively measured thing in the project (`evals/echosim`, five
// couplings x eight seeds, and the −6dB row of context/measurements.md that
// cost a rewrite). Feeding it a signal it thinks is the room would invalidate
// all of it silently.
//
// So this suite proves TWO things, in two different ways, because they fail
// differently:
//
//   1. THE ARITHMETIC, by running it. PcmMix is pure Java; it is compiled and
//      driven with real PCM. A mixer that wraps instead of saturating turns a
//      loud moment into a full-scale sign flip, which is the most speech-like
//      artefact there is and would be handed straight to a VAD.
//
//   2. THE POSITION, by reading the real source. Everything that decides
//      anything reads `buf`, the microphone; the mixer writes `up`. That is
//      not a threshold that was tuned to ignore media — it is the absence of
//      a code path, which is the only kind of guarantee this repo counts
//      (`structural-disclosure`, applied to audio). Position is the mechanism,
//      exactly as it is for prompt slots and for emitShowWake, so position is
//      what is asserted.
//
// Needs a JDK. Without javac it FAILS rather than skipping — same rule as
// native-gate.mjs.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const AND = join(ROOT, "android/app/src/main/java/app/meera/companion");
const HERE = join(ROOT, "evals/watchaudio/java");

let failed = 0;
let n = 0;
const ok = (name, cond, detail = "") => {
  n++;
  if (cond) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}  ${detail}`);
  }
};

const javac = spawnSync("javac", ["-version"], { encoding: "utf8" });
if (javac.error) {
  console.log(
    "UNVERIFIED — no javac on PATH, so the real mixer could not be run.\n" +
      "NOT skipped: an unrun audio-safety check is indistinguishable from one\n" +
      "that would have failed, and this is the check standing between a media\n" +
      "stream and the barge-in floor.",
  );
  process.exit(1);
}

// ── 1. the arithmetic, RUN ─────────────────────────────────────────────────
console.log("\n── 1. the mixer, run against real PCM ──");
const tmp = mkdtempSync(join(tmpdir(), "watchaudio-"));
const JENV = { ...process.env };
delete JENV.JAVA_TOOL_OPTIONS;
execFileSync("javac", ["-d", tmp, "-nowarn", join(AND, "PcmMix.java"), join(HERE, "MixProbe.java")], {
  stdio: ["ignore", "ignore", "inherit"],
  env: JENV,
});
const m = JSON.parse(
  execFileSync("java", ["-cp", tmp, "app.meera.companion.MixProbe"], {
    encoding: "utf8",
    env: JENV,
  }).trim(),
);
console.log(`  ${JSON.stringify(m)}`);

ok("the duck is −6 dB, declared", m.duckDb === -6);
ok(
  "the duck is −6 dB, MEASURED through the real mixer",
  Math.abs(m.measuredDuckDb + 6) < 0.15,
  `measured ${m.measuredDuckDb} dB`,
);
ok("no media, no change: the chunk is the microphone byte for byte", m.micOnlyIdentical === true);
ok("silent media, no change: nothing is invented to fill it", m.silentMediaIdentical === true);
ok(
  "his voice wins against a NORMALLY MASTERED track (−14 dBFS)",
  m.voiceOverTypicalDb > 3,
  `voice sits ${m.voiceOverTypicalDb} dB over the media term`,
);
// MEASURED AND STATED RATHER THAN ASSERTED AWAY. A fixed −6 dB duck is a
// duck, not an AGC: against FULL-SCALE media a conversational voice sits
// BELOW the media term, and the number is printed here so nobody has to
// rediscover it. It stays fixed anyway, because the alternative — a gain that
// chases levels — is a gain that ducks HIS voice the moment the music gets
// loud, which is the failure that actually matters.
//
// What protects the product at that level is not the duck: it is that media
// can make no DECISION (section 2), and that anything loud enough to bury him
// is loud enough that he turns it down. REVERSAL CONDITION: if the on-device
// trace shows his turns going untranscribed while `media_audio.on` is true,
// the answer is a media-side limiter, not an adaptive gain.
ok(
  "and the full-scale worst case is KNOWN rather than assumed",
  typeof m.voiceOverHotDb === "number" && m.voiceOverHotDb < m.voiceOverTypicalDb,
  `voice sits ${m.voiceOverHotDb} dB over full-scale media — a duck is not an AGC`,
);
ok(
  "the sum SATURATES — no two's-complement sign flip at any level",
  m.wrapped === false,
  "a wrapped sample is a full-scale transient a VAD would answer",
);
ok(
  "the worst case does clip, and clipping is the intended failure",
  m.clippedSamples > 0,
  "if this is 0 the saturation path was never exercised — the test is not testing",
);
ok("a short media chunk leaves the rest as microphone, not a hole", m.shortMediaTailIsMic === true);
ok(
  "the mixer never writes to the microphone buffer",
  m.micUnmodified === true,
  "everything that decides anything reads that buffer",
);

// ── 2. the position, READ ──────────────────────────────────────────────────
console.log("\n── 2. where the mixer sits, in the real source ──");
const eng = readFileSync(join(AND, "LiveWatchEngine.java"), "utf8");
const svc = readFileSync(join(AND, "WatchCaptureService.java"), "utf8");
const cap = readFileSync(join(AND, "MediaAudioCapture.java"), "utf8");
const plug = readFileSync(join(AND, "WatchPlugin.java"), "utf8");

const at = (hay, needle) => hay.indexOf(needle);
const mixAt = at(eng, "PcmMix.mix(buf, n, mediaBuf, mn");
ok("the mixer is called exactly once in the engine", eng.split("PcmMix.mix(").length - 1 === 1);

// every decision the floor arbiter makes, by the line that makes it
const decisions = [
  ["sub-frame RMS (the level everything else is derived from)", "sub[s] = Math.sqrt(acc"],
  ["the ambience floor", "floorRing[floorIdx] = sub[s]"],
  ["the hold-ring admission test", "if (sub[s2] > admitEcho) aboveEcho = true"],
  ["the gate's silence write", "if (gated) Arrays.fill(buf, 0, n, (byte) 0)"],
  ["the pre-roll stash", "System.arraycopy(buf, 0, prevChunk, 0, n)"],
];
for (const [what, line] of decisions) {
  const i = at(eng, line);
  ok(`${what} is computed BEFORE the mixer`, i > 0 && i < mixAt, `idx ${i} vs mixer ${mixAt}`);
}

ok(
  "the mixer's destination is `up`, never the microphone buffer",
  /PcmMix\.mix\(buf, n, mediaBuf, mn, PcmMix\.DUCK_GAIN, up\)/.test(eng),
);
// THE CENTRAL PROOF, and it is a proof about a REGION of code rather than
// about a line. Comments are stripped first — a guarantee that depends on
// prose is not a guarantee — and then the whole span from the top of the mic
// loop down to the mixer is searched for any mention at all of the media
// identifiers. Every level, every threshold, every gate decision and the
// entire echo estimate live inside that span. If none of them can even NAME
// the media buffers, none of them can be moved by media: it is the absence of
// a code path, which is the only kind of guarantee this repo counts.
const code = eng.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const loopStart = code.indexOf("while (running) {");
const mixStart = code.indexOf("byte[] wire = buf;");
ok(
  "the decision region was located (loop start before the mixer)",
  loopStart > 0 && mixStart > loopStart,
  `loop ${loopStart} mixer ${mixStart}`,
);
const region = code.slice(loopStart, mixStart);
for (const id of ["up", "mediaBuf", "mediaSource", "PcmMix", "MediaAudioCapture"]) {
  ok(
    `no decision in the mic loop can even name \`${id}\``,
    !new RegExp(`\\b${id}\\b`).test(region),
  );
}
ok(
  "the mixer runs only inside a chunk the MIC gate already opened (!gated)",
  /mc != null && !gated && !holding/.test(eng),
  "media that could open a turn is media the server VAD would answer",
);
ok(
  "the mixer never runs while she is audible (!holding)",
  /!gated && !holding/.test(eng),
  "while she speaks the wire carries digital silence, and it must keep doing so",
);
ok(
  "the hold ring is filled from the MICROPHONE, never from the mixed chunk",
  /System\.arraycopy\(buf, 0, hold\[k\], 0, n\)/.test(eng) && !/hold\[k\][^;]*\bup\b/.test(eng),
);
ok(
  "a gated tick still writes digital silence — the server VAD sees no new input",
  at(eng, "if (gated) Arrays.fill(buf, 0, n, (byte) 0)") > 0,
);

// ── 3. the loop that would be unrecoverable ────────────────────────────────
console.log("\n── 3. her own voice cannot come back round ──");
ok(
  "her AudioTrack is ALLOW_CAPTURE_BY_NONE (the platform refuses to hand it over)",
  /setAllowedCapturePolicy\(AudioAttributes\.ALLOW_CAPTURE_BY_NONE\)/.test(eng),
);
ok(
  "and the capture excludes this process's own uid outright",
  /excludeUid\(Process\.myUid\(\)\)/.test(cap),
);
ok(
  "only MEDIA / GAME / UNKNOWN are captured",
  /addMatchingUsage\(AudioAttributes\.USAGE_MEDIA\)/.test(cap) &&
    /addMatchingUsage\(AudioAttributes\.USAGE_GAME\)/.test(cap) &&
    /addMatchingUsage\(AudioAttributes\.USAGE_UNKNOWN\)/.test(cap),
);
ok(
  "notifications, alarms, ringtones and voice calls are NOT captured",
  !/USAGE_NOTIFICATION|USAGE_ALARM|USAGE_VOICE_COMMUNICATION|USAGE_ASSISTANCE|RINGTONE/.test(cap),
  "a WhatsApp call ringing through a share is not something to put on a wire",
);

// ── 4. consent, lifetime, and the absence of a store ───────────────────────
console.log("\n── 4. consent and lifetime ──");
ok(
  "device audio is scoped to the SAME MediaProjection as the picture",
  /MediaAudioCapture\.start\(projection\)/.test(svc) &&
    /AudioPlaybackCaptureConfiguration\.Builder\(projection\)/.test(cap),
);
ok(
  "it cannot start without a live capture session",
  /if \(!running \|\| !mediaAudioOn \|\| mediaAudio != null\) return;/.test(svc),
);
ok("it is OFF by default", /private static volatile boolean mediaAudioOn = false;/.test(svc));
ok(
  "it is turned OFF again at every teardown — a yes is never inherited",
  /mediaAudioOn = false;\s*\n\s*stopMediaAudio\(\);/.test(svc),
);
ok(
  "the engine's reference is cleared BEFORE the capture is released",
  /if \(l != null\) l\.setMediaSource\(null\);\s*\n\s*if \(m != null\) m\.stop\(\);/.test(svc),
);
ok(
  "nothing writes device audio anywhere: no file, no stream, no encoder",
  !/File|OutputStream|MediaMuxer|MediaRecorder|Uri|openFileOutput/.test(cap),
);
ok(
  "the ring drops its OLDEST chunk — stale media is worse than none",
  /head = \(head \+ 1\) % RING; \/\/ oldest goes/.test(cap),
);
ok("the toggle is a plugin method, default false", /getBoolean\("on", false\)/.test(plug));

// ── 5. the watch-content contract ──────────────────────────────────────────
console.log("\n── 5. the watch-content contract, unchanged ──");
// Comments are stripped with the SAME stripper section 2 uses, and that is a
// correction rather than a tidy-up. This test used to strip with
// /\*[^*]*\*/g, which eats `* … *` PAIRS: whether a given javadoc line
// survived depended on how many asterisks happened to precede it in the file.
// It passed for exactly that reason, and it started failing the moment an
// unrelated edit above it changed that parity — the assertion was about a
// property of the code and was reading the prose, so it was never really
// checking anything. A gate that can pass by luck is `gates-that-live-
// nowhere` in miniature.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
ok(
  "nothing under android/ names an episode op or an assertion table",
  !/watch_moment|watch_visual|vy_visual_assertion|vy_shared_moment/.test(strip(cap) + strip(svc)),
  "this is native-gate.mjs's rule; device audio does not get an exception to it",
);
ok(
  "...and that check reads CODE, not comments (the javadoc DOES name it)",
  /vy_shared_moment/.test(svc),
  "negative control: if the raw source stops naming it, the test above is passing on nothing",
);
ok(
  "device audio produces no turn, no episode and no claim of its own",
  !/onTurn|emitTurn|notifyListeners/.test(cap),
  "what she hears is present tense only, exactly like what she sees",
);

console.log(
  failed ? `\n${failed} of ${n} checks FAILED` : `\nall ${n} checks passed`,
);
process.exit(failed ? 1 : 0);
