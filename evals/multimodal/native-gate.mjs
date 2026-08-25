// WS-ANDROID-WATCH — the NATIVE (Android) half of the recording gate.
//
//   node evals/multimodal/native-gate.mjs
//
// The web lane's proofs live in scene-gate.mjs. This file proves the same
// guarantees for the native lane, which is a genuinely separate
// implementation of the geometry (SceneReader.java) driving a genuinely
// separate wake path (WatchCaptureService.dispatch -> LiveWatchEngine.nudge /
// WatchEngine.nudge). Nothing here re-models either one: the Java geometry is
// COMPILED AND RUN from the real shipping source, and the parts that cannot
// run off-device (the service and the two engines both need Android) are
// asserted against their real source text, by name, in place.
//
// What this proves, in order:
//
//   1. PARITY. The same frames through SceneReader.java and src/watch/scene.ts
//      produce the same wake sequence, tick for tick — including the blackout,
//      the landing, the return-to-the-same-picture (`wake-dedupe`), a scroll,
//      an overlay banner, a pointer and the ImageReader-null still path. The
//      Android copy is meant to be line-for-line; this is the check that it
//      still is where it counts.
//   2. BLACKOUT. A FLAG_SECURE / lock-screen blackout emits ZERO recordable
//      wakes from the native path and therefore stores zero rows — and the
//      documented ambient asymmetry (only the SHOW branches of pick() carry a
//      blank guard) is confirmed to be IDENTICAL in both files, so a
//      one-sided "fix" fails loudly instead of silently splitting the twins.
//   3. COMPOSITION. The real Java wake log, fed through the real (bundled)
//      armMomentWindow / consumeMomentWindow from useCallEngine.ts, records
//      exactly what it should: one moment for one landing, none in a
//      blackout, none for the second hold on an identical picture.
//   4. SUPPRESSORS AND THE FABRICATION GUARD, asserted against source: every
//      native suppressor sits upstream of the report, the report sits inside
//      the branch where the wake demonstrably went out, and nothing under
//      android/ ever posts an episode, a visual assertion or a claim itself.
//
// Requires a JDK (CI installs temurin 21 for the APK build). Without javac
// this reports UNVERIFIED and FAILS — it is never silently skipped, because a
// gate that quietly stops running is `dead-writers` with extra steps.
import { execFileSync, execSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const AND = join(ROOT, "android/app/src/main/java/app/meera/companion");

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}  ${detail}`);
  }
};

// ── 0. toolchain ────────────────────────────────────────────────────────
const javac = spawnSync("javac", ["-version"], { encoding: "utf8" });
if (javac.error) {
  console.log(
    "UNVERIFIED — no javac on PATH, so the Java geometry could not be run.\n" +
      "This suite is NOT skipped: it fails, because an unrun parity check is\n" +
      "indistinguishable from a parity check that would have failed.",
  );
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), "wsaw-native-"));
const classes = join(tmp, "classes");
// JAVA_TOOL_OPTIONS (a proxy/truststore banner in some sandboxes) is dropped
// so the harness output stays readable; nothing here touches the network.
const JENV = { ...process.env };
delete JENV.JAVA_TOOL_OPTIONS;
execFileSync(
  "javac",
  ["-d", classes, join(AND, "SceneReader.java"), join(ROOT, "evals/multimodal/java/SceneParity.java")],
  { stdio: ["ignore", "ignore", "inherit"], env: JENV },
);

// ── bundles of the REAL TypeScript, same recipe as scene-gate.mjs ───────
const SCENE_BUNDLE = join(tmp, "scene.bundle.mjs");
const ENGINE_BUNDLE = join(tmp, "useCallEngine.bundle.mjs");
for (const [src, out] of [
  ["src/watch/scene.ts", SCENE_BUNDLE],
  ["src/components/useCallEngine.ts", ENGINE_BUNDLE],
]) {
  execSync(
    `npx esbuild ${join(ROOT, src)} --bundle --format=esm --platform=node --outfile=${out} --log-level=error`,
    { stdio: "inherit", cwd: ROOT },
  );
}
const { SceneReader, SIG_LEN, isShowClass } = await import(SCENE_BUNDLE);
const { armMomentWindow, consumeMomentWindow } = await import(ENGINE_BUNDLE);

// ── stimulus, single-sourced here and fed to BOTH implementations ───────
const DETECT_MS = 120; // WatchCaptureService.DETECT_MS
const T0 = 1_000_000; // SceneParity.T0

const grid = (fn) => {
  const a = new Uint8Array(SIG_LEN);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) a[y * 32 + x] = fn(x, y) & 255;
  return a;
};
const uni = (v) => grid(() => v);
// scene.ts's own blank predicate: hi-lo <= 12 AND mean <= 40
const DARK = uni(5);
const A = uni(200);
const B = uni(50);
const C = uni(120);
// row-structured content, so a vertical shift is a real translation
const striped = (off) => grid((x, y) => (((y + off) * 37 + x * 11) % 200) + 30);
const banner = (base) => {
  const a = new Uint8Array(base);
  for (let y = 0; y < 6; y++) for (let x = 0; x < 32; x++) a[y * 32 + x] = 250;
  return a;
};
const dot = (base, cx, cy) => {
  const a = new Uint8Array(base);
  a[cy * 32 + cx] = (a[cy * 32 + cx] + 90) & 255;
  return a;
};

/** A tick list: Uint8Array = a redraw, null = ImageReader handed back null. */
const rep = (sig, n) => Array.from({ length: n }, () => sig);

const SCENARIOS = {
  // land on content, then the screen goes FLAG_SECURE black for ~48s
  blackout: [A, ...rep(A, 3), ...rep(DARK, 400)],
  // they navigated somewhere and it landed, then held
  landing: [A, B, ...rep(B, 15)],
  // ...and the still path: a held screen stops compositing entirely
  landing_still: [A, B, B, null, null, null, null, null, null, null, null, null, null, null, null],
  // rejected.md `wake-dedupe`: away and straight back to the SAME picture
  reshow_same: [A, B, ...rep(B, 15), C, B, ...rep(B, 15)],
  // a scroll is a TRANSLATION, not a new thing
  scroll: [striped(0), striped(3), striped(6), striped(9), striped(12), ...rep(striped(12), 12)],
  // a notification banner: an edge-anchored band that leaves the rest alone
  overlay: [striped(0), ...rep(striped(0), 8), banner(striped(0)), ...rep(banner(striped(0)), 12)],
  // a cursor circling a thing on an otherwise dead-still screen
  point: [
    striped(0),
    ...rep(striped(0), 6),
    dot(striped(0), 8, 8),
    dot(striped(0), 9, 9),
    dot(striped(0), 10, 10),
    dot(striped(0), 11, 11),
    dot(striped(0), 12, 12),
    dot(striped(0), 13, 13),
  ],
};

const AMBIENT = new Set(["along", "idle"]);

/** Run the TypeScript twin, producing SceneParity's exact output shape. */
function runTs(ticks) {
  const sr = new SceneReader();
  let at = T0;
  const lines = [];
  for (const sig of ticks) {
    const s = sig ? sr.read(sig, at) : sr.still(at);
    const wake = s.wake ?? "none";
    let emit = "-";
    if (s.wake) {
      if (!s.blank && isShowClass(s.wake)) emit = s.wake;
      sr.noteWake(s.wake, at);
    }
    lines.push(`${at} ${wake} ${s.blank} ${s.quiet} ${s.preroll} ${emit}`);
    at += DETECT_MS;
  }
  return lines;
}

/** Run the REAL Java geometry, compiled from android/. */
function runJava(ticks) {
  const stdin = ticks
    .map((sig) => (sig ? `R ${Buffer.from(sig).toString("base64")}` : "S"))
    .join("\n");
  const out = execFileSync("java", ["-cp", classes, "app.meera.companion.SceneParity"], {
    input: stdin,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: JENV,
  });
  return out.trim().split("\n").filter(Boolean);
}

// SceneReader.noteWake() re-rolls idleTarget with Math.random() on an AMBIENT
// wake (IDLE_JITTER — "the one remaining clock must not read as a clock"), in
// the Java exactly as in the TypeScript. So the two runs are only comparable
// up to and including the first ambient wake; past it a difference is the
// jitter, not a drift. Every scenario below is sized to hold at most one.
const truncateAtJitter = (lines) => {
  const i = lines.findIndex((l) => AMBIENT.has(l.split(" ")[1]));
  return i === -1 ? lines : lines.slice(0, i + 1);
};

// ── 1 + 2. parity, tick for tick ────────────────────────────────────────
const javaLogs = {};
for (const [name, ticks] of Object.entries(SCENARIOS)) {
  const ts = runTs(ticks);
  const jv = runJava(ticks);
  javaLogs[name] = jv;
  ok(`${name}: same tick count`, ts.length === jv.length, `${ts.length} vs ${jv.length}`);
  const a = truncateAtJitter(ts);
  const b = truncateAtJitter(jv);
  let firstDiff = -1;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      firstDiff = i;
      break;
    }
  }
  ok(
    `${name}: Java geometry matches scene.ts tick for tick`,
    firstDiff === -1 && a.length === b.length,
    firstDiff === -1 ? `${a.length} vs ${b.length} comparable ticks` : `tick ${firstDiff}: ts="${a[firstDiff]}" java="${b[firstDiff]}"`,
  );
  const tsWakes = ts.filter((l) => l.split(" ")[1] !== "none").map((l) => l.split(" ")[1]);
  const jvWakes = jv.filter((l) => l.split(" ")[1] !== "none").map((l) => l.split(" ")[1]);
  console.log(`      ${name}: ts wakes ${JSON.stringify(tsWakes)} | java wakes ${JSON.stringify(jvWakes)}`);
}

// the blackout, stated as the guarantee rather than as a sequence
{
  const jv = javaLogs.blackout;
  const emits = jv.filter((l) => l.split(" ")[5] !== "-");
  const ambient = jv.filter((l) => AMBIENT.has(l.split(" ")[1]));
  ok("blackout: the Java lane reports ZERO recordable wakes", emits.length === 0, JSON.stringify(emits));
  ok(
    "blackout: an ambient wake CAN still fire in Java too (the documented asymmetry)",
    ambient.length > 0,
    "if this ever fails, the ambient blank guard was added — check the parity assertion below",
  );
}

// ── the asymmetry itself, pinned to BOTH files at once ──────────────────
// scene.ts's pick() guards its SHOW branches with !blank and its ambient
// branches with nothing. That is a real, previously-undocumented finding, and
// the write path is safe anyway (arming ignores ambient classes). What must
// never happen is the two files disagreeing about it — a blank guard added to
// one twin and not the other is exactly the drift this port exists to avoid.
// So this asserts PARITY of the asymmetry, not the asymmetry: fixing both
// sides passes, fixing one side fails.
{
  const tsSrc = readFileSync(join(ROOT, "src/watch/scene.ts"), "utf8");
  const jvSrc = readFileSync(join(AND, "SceneReader.java"), "utf8");
  const tsPick = tsSrc.slice(tsSrc.indexOf("private pick("));
  const jvPick = jvSrc.slice(jvSrc.indexOf("private int pick("));
  const tsShow = tsPick.slice(0, tsPick.indexOf("// ── AMBIENT"));
  const jvShow = jvPick.slice(0, jvPick.indexOf("// ── AMBIENT"));
  const tsAmbient = tsPick.slice(tsPick.indexOf("// ── AMBIENT"));
  const jvAmbient = jvPick.slice(jvPick.indexOf("// ── AMBIENT"));
  const strip = (s) => s.replace(/\/\/[^\n]*/g, ""); // comments mention "blank"
  const tsShowGuarded = /!blank/.test(strip(tsShow));
  const jvShowGuarded = /!blank/.test(strip(jvShow));
  const tsAmbGuarded = /blank/.test(strip(tsAmbient));
  const jvAmbGuarded = /blank/.test(strip(jvAmbient));
  ok("scene.ts SHOW branches carry the blank guard", tsShowGuarded);
  ok("SceneReader.java SHOW branches carry the blank guard", jvShowGuarded);
  ok(
    "the ambient blank guard is the SAME in both twins (asymmetry parity)",
    tsAmbGuarded === jvAmbGuarded,
    `scene.ts=${tsAmbGuarded} SceneReader.java=${jvAmbGuarded}`,
  );
}

// ── 3. composition: real Java wakes through the real JS recording gate ──
function record(javaLog, herLineOffsets) {
  // exactly what useCallEngine does: arm on the reported wake, and on each
  // line she speaks consume the window (clearing it either way)
  let pending = null;
  const armedAt = [];
  for (const line of javaLog) {
    const [at, , , , , emit] = line.split(" ");
    if (emit !== "-") {
      pending = armMomentWindow(pending, emit, Number(at));
      armedAt.push(Number(at));
    }
  }
  // her lines are asked about relative to the first armed wake; with no wake
  // at all there is nothing to be relative to and nothing can be recorded
  const base = armedAt.length ? armedAt[0] : T0;
  const recorded = [];
  for (const off of herLineOffsets) {
    const m = consumeMomentWindow(pending, base + off);
    pending = null;
    if (m) recorded.push(m);
  }
  return recorded;
}

ok(
  "composition: a blackout records nothing, however much she says",
  record(javaLogs.blackout, [0, 500, 1000, 30_000]).length === 0,
);
{
  const r = record(javaLogs.landing, [900, 1200]);
  ok("composition: one landing records exactly one moment", r.length === 1, JSON.stringify(r));
  ok("composition: the moment carries the SHOW class it came from", r[0]?.cls === "settle", JSON.stringify(r));
}
ok(
  "composition: the still (ImageReader-null) path records a landing too",
  record(javaLogs.landing_still, [900]).length === 1,
);
{
  // `wake-dedupe` is not defeated: the second hold on the identical picture
  // never produces a second wake, so there is nothing to record twice
  const shows = javaLogs.reshow_same.filter((l) => l.split(" ")[5] !== "-");
  ok("wake-dedupe: one wake across away-and-back to the same picture", shows.length === 1, JSON.stringify(shows));
  ok("wake-dedupe: and therefore one moment, not two", record(javaLogs.reshow_same, [900, 6000]).length === 1);
}
ok(
  "a scroll (translation) records nothing while it is scrolling",
  javaLogs.scroll.slice(0, 5).every((l) => l.split(" ")[5] === "-"),
  JSON.stringify(javaLogs.scroll.slice(0, 5)),
);
ok(
  "an overlay banner never arms a moment on its own",
  javaLogs.overlay.filter((l) => l.split(" ")[5] !== "-").length === 0,
  JSON.stringify(javaLogs.overlay.filter((l) => l.split(" ")[5] !== "-")),
);

// ── 4. the parts that cannot run off-device, asserted against source ────
const svc = readFileSync(join(AND, "WatchCaptureService.java"), "utf8");
const liveSrc = readFileSync(join(AND, "LiveWatchEngine.java"), "utf8");
const cascadeSrc = readFileSync(join(AND, "WatchEngine.java"), "utf8");

/** The text of one method body, from its signature to the matching brace. */
function body(src, signature) {
  const i = src.indexOf(signature);
  if (i === -1) return "";
  let depth = 0;
  for (let j = src.indexOf("{", i); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(i, j + 1);
  }
  return "";
}
const dispatch = body(svc, "private void dispatch(");
const emitBody = body(svc, "private void emitShowWake(");
const liveNudge = body(liveSrc, "boolean nudge(int wake)");
const cascadeNudge = body(cascadeSrc, "boolean nudge(int wake)");
// WS-LIFECYCLE, 2026-08-23. The dispatch-side grounding gate — "a SHOW rides a
// picture of the HELD screen, ambient rides any delivered frame" — was written
// inline in dispatch() and has since moved into WatchPacer.fresh(show, now).
// The PROPERTY did not change (the parity battery in §1 still passes); only
// its address did. The two assertions below used to look for the ternary in
// dispatch(), found nothing, and failed — a gate reporting a defect that does
// not exist, which is how a suite stops being read and then stops being run.
// So the gate now follows the refactor: dispatch must still ASK, and the
// method it asks must still be the ternary against FRAME_FRESH_MS. Splitting
// it in two is the point — either half moving alone is a real failure.
const pacerSrc = readFileSync(join(AND, "WatchPacer.java"), "utf8");
const pacerFresh = body(pacerSrc, "boolean fresh(boolean show, long now)");

ok("WatchCaptureService.dispatch() found", dispatch.length > 0);
ok("WatchCaptureService.emitShowWake() found", emitBody.length > 0);
ok("LiveWatchEngine.nudge() found", liveNudge.length > 0);
ok("WatchEngine.nudge() found", cascadeNudge.length > 0);

// the report is made ONCE, and only inside the branch where the wake went out
{
  const calls = svc.match(/emitShowWake\(/g) || [];
  ok("emitShowWake is called exactly once (plus its definition)", calls.length === 2, `${calls.length}`);
  const sentIdx = dispatch.indexOf("if (sent)");
  const emitIdx = dispatch.indexOf("emitShowWake(");
  ok("the report sits inside dispatch's `if (sent)` branch", sentIdx !== -1 && emitIdx > sentIdx);
  ok(
    "...and after noteWake, i.e. on the same wake the dedupe ring is charged for",
    dispatch.indexOf("scene.noteWake(") !== -1 && emitIdx > dispatch.indexOf("scene.noteWake("),
  );
}

// every suppressor, by name, upstream of the report
for (const [what, needle, where, src] of [
  ["look-away (privateMode) gates dispatch", "if (privateMode) return;", "dispatch", dispatch],
  ["look-away re-checked at the report", "if (privateMode) return;", "emitShowWake", emitBody],
  ["FLAG_SECURE blackout refused by name", "if (blank) return;", "emitShowWake", emitBody],
  ["ambient classes are never reported", "if (!SceneReader.isShow(wake)) return;", "emitShowWake", emitBody],
  ["dispatch asks the pacer before any nudge", "pacer.fresh(show, now)", "dispatch", dispatch],
  ["a held frame backs a SHOW, a delivered one backs ambient", "show ? lastStillFrameAt : lastSentAt", "WatchPacer.fresh", pacerFresh],
  ["stale-frame gate", "FRAME_FRESH_MS", "WatchPacer.fresh", pacerFresh],
  ["her own voice", "if (speaking) return false;", "LiveWatchEngine.nudge", liveNudge],
  ["stale-frame gate", "FRAME_FRESH_MS", "LiveWatchEngine.nudge", liveNudge],
  ["quiet floor after their voice", "lastVoiceAt", "LiveWatchEngine.nudge", liveNudge],
  ["show floor", "SHOW_FLOOR_MS", "LiveWatchEngine.nudge", liveNudge],
  ["ambient share of the ring", "AMBIENT_CEILING", "LiveWatchEngine.nudge", liveNudge],
  ["hard per-minute ceiling", "WAKE_WINDOW_MS", "LiveWatchEngine.nudge", liveNudge],
  ["her own voice / mid-think", "if (!running || speaking || thinking) return false;", "WatchEngine.nudge", cascadeNudge],
  ["stale-frame gate", "FRAME_FRESH_MS", "WatchEngine.nudge", cascadeNudge],
  ["quiet floor after their voice", "lastUserSpokeAt", "WatchEngine.nudge", cascadeNudge],
  ["comment cooldown", "COMMENT_COOLDOWN_MS", "WatchEngine.nudge", cascadeNudge],
]) {
  ok(`${where}: ${what}`, src.includes(needle), `missing: ${needle}`);
}

// both nudges only report success past their LAST gate — so dispatch's
// `if (sent)` really is downstream of all of them
for (const [where, src, lastGate] of [
  ["LiveWatchEngine.nudge", liveNudge, "if (now - wakes[wakeIdx] < WAKE_WINDOW_MS) return false;"],
  ["WatchEngine.nudge", cascadeNudge, "if (b64.equals(lastAnalyzed)) return false;"],
]) {
  const gateAt = src.indexOf(lastGate);
  const trueAt = src.indexOf("return true");
  ok(
    `${where}: the success return comes after the last gate`,
    gateAt !== -1 && trueAt > gateAt,
    `gate at ${gateAt}, return true at ${trueAt}`,
  );
}

// ── the fabrication guard, as a property of the whole native tree ───────
{
  const forbidden = ["watch_moment", "watch_visual", "vy_shared_moment", "vy_visual_assertion", "/api/episodes"];
  const hits = [];
  const files = execFileSync("git", ["ls-files", "android"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f.endsWith(".java") || f.endsWith(".kt"));
  // comments are stripped first: the service's own comments explain WHY it
  // does not post, and explaining it must not read as doing it
  const decomment = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  for (const f of files) {
    const t = decomment(readFileSync(join(ROOT, f), "utf8"));
    for (const n of forbidden) if (t.includes(n)) hits.push(`${f}: ${n}`);
  }
  ok(
    "no CODE under android/ posts an episode or names a visual-assertion table",
    hits.length === 0,
    JSON.stringify(hits),
  );
}
// and the report itself carries no claim about the screen — only a class name
{
  const payload = /emitEvent\(\s*"watchwake",\s*new org\.json\.JSONObject\(\)\.put\("class", cls\)\s*\)/s;
  ok("the bridge event carries the wake CLASS and nothing else", payload.test(emitBody), emitBody.slice(-400));
}

console.log(failed ? `\nFAILED (${failed})` : "\nPASSED");
process.exit(failed ? 1 : 0);
