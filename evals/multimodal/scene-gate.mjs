// WS-MULTIMODAL — offline, DB-free proofs of the RECORDING GATE: the
// composition of src/watch/scene.ts (pure geometry, unmodified by this
// workstream) and the pure decision functions this workstream added to
// src/components/useCallEngine.ts (armMomentWindow / consumeMomentWindow).
//
// Bundled fresh via esbuild each run — same recipe as
// evals/wsdepth-test-roundtrip.mjs — so this exercises the REAL shipping
// code, not a JS re-model of it. useCallEngine.ts bundles cleanly for Node
// (verified: its only module-scope side effect is `Capacitor.isNativePlatform()`,
// which returns false off-device and touches nothing else); only the two
// exported pure functions are used here — nothing that touches React, the
// DOM, or a socket is ever invoked.
//
// What this file proves, in order:
//   1. a FLAG_SECURE / lock-screen-shaped blackout produces ZERO wakes this
//      pipeline would ever record from — not because scene.ts refuses every
//      wake on a blank screen (it does not: an ambient `idle` CAN fire on a
//      blank screen, since the ambient branch carries no !blank guard — see
//      the finding below), but because armMomentWindow only arms on a SHOW
//      class, and blank structurally can never produce one.
//   2. a normal landing produces exactly one recordable moment.
//   3. a repeated wake on the identical picture (the `wake-dedupe` mechanism,
//      rejected.md) is NOT defeated — scene.ts itself refuses the second
//      wake, so armMomentWindow is never even called a second time.
//
// node evals/multimodal/scene-gate.mjs
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "wsmm-gate-"));
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
const { armMomentWindow, consumeMomentWindow, WATCH_MOMENT_WINDOW_MS } = await import(ENGINE_BUNDLE);

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}  ${detail}`);
  }
};

const uni = (v) => {
  const a = new Uint8Array(SIG_LEN);
  a.fill(v);
  return a;
};
// mean<=40 and hi-lo<=12 is scene.ts's own blank predicate (FLAG_SECURE /
// lock screen / display asleep) — a uniform 5 satisfies it exactly.
const DARK = uni(5);
const A = uni(200); // "content" — well above the blank luma ceiling
const B = uni(50);
const C = uni(120);

// A tiny stand-in for the two lines useCallEngine.ts actually runs: arm on
// every wake, then ask "does a her-line right now get recorded". Mirrors
// wake()'s `pendingShowWake.current = armMomentWindow(...)` and
// noteHerLine's `consumeMomentWindow(...)` + unconditional clear.
function makeGate() {
  let pending = null;
  return {
    onWake(cls, at) {
      pending = armMomentWindow(pending, cls, at);
    },
    onHerLine(at) {
      const m = consumeMomentWindow(pending, at);
      pending = null;
      return m; // non-null => this is what would be POSTed as a moment
    },
  };
}

// ── 1. blackout ─────────────────────────────────────────────────────────
{
  const T0 = 1_000_000;
  let t = T0;
  const sr = new SceneReader();
  const gate = makeGate();
  const seenClasses = [];
  const recorded = [];
  const step = (sig) => {
    const s = sr.read(sig, t);
    if (s.wake) {
      seenClasses.push(s.wake);
      gate.onWake(s.wake, t);
      sr.noteWake(s.wake, t);
    }
    t += 120;
  };
  step(A);
  for (let i = 0; i < 3; i++) step(A); // land on real content first
  for (let i = 0; i < 400; i++) step(DARK); // ~48s of blackout
  // she may still say something during the blackout (ordinary conversation) —
  // that must never be recorded as a shared moment
  for (let i = 0; i < 5; i++) {
    const m = gate.onHerLine(t);
    if (m) recorded.push(m);
    t += 500;
  }
  ok(
    "blackout: scene.ts fires no SHOW class",
    !seenClasses.some(isShowClass),
    `classes seen: ${JSON.stringify(seenClasses)}`,
  );
  ok(
    "blackout: ambient CAN still fire (documented, not a bug — see report)",
    seenClasses.includes("idle") || seenClasses.includes("along"),
    `classes seen: ${JSON.stringify(seenClasses)}`,
  );
  ok(
    "blackout: the recording gate produces ZERO moments regardless",
    recorded.length === 0,
    `recorded: ${JSON.stringify(recorded)}`,
  );
}

// ── 2. a normal shared moment: exactly one ─────────────────────────────
{
  const T0 = 1_500_000;
  let t = T0;
  const sr = new SceneReader();
  const gate = makeGate();
  const settleAt = [];
  const step = (sig) => {
    const s = sr.read(sig, t);
    if (s.wake) {
      if (s.wake === "settle") settleAt.push(t);
      gate.onWake(s.wake, t);
      sr.noteWake(s.wake, t);
    }
    t += 120;
    return s;
  };
  step(A);
  step(B); // replaces A — a landing
  for (let i = 0; i < 15; i++) step(B); // hold past HOLD_REPLACE_MIN
  ok("landing: exactly one settle wake fires", settleAt.length === 1, JSON.stringify(settleAt));

  // her first line, well inside the window: recorded
  const firstLine = gate.onHerLine(settleAt[0] + 900);
  ok("her first line inside the window is recorded", firstLine !== null, JSON.stringify(firstLine));
  ok(
    "the recorded wake is the settle class, not a later ambient one",
    firstLine?.cls === "settle",
    JSON.stringify(firstLine),
  );

  // her SECOND line, moments later, same wake: NOT recorded again — the
  // window is one-shot, consumed by the first line whether or not it hit
  const secondLine = gate.onHerLine(settleAt[0] + 1200);
  ok("her second line does not double-record the same wake", secondLine === null, JSON.stringify(secondLine));

  // a line arriving after the window has lapsed, with a FRESH gate (nothing
  // consumed it early): confirms the window really does expire
  const lateGate = makeGate();
  lateGate.onWake("settle", 0);
  const late = lateGate.onHerLine(WATCH_MOMENT_WINDOW_MS + 1);
  ok("a line after the window lapses is not recorded", late === null, JSON.stringify(late));
}

// ── 3. wake-dedupe (rejected.md) must not be defeated ──────────────────
{
  const T0 = 2_000_000;
  let t = T0;
  const sr = new SceneReader();
  const gate = makeGate();
  const settleAt = [];
  const step = (sig) => {
    const s = sr.read(sig, t);
    if (s.wake) {
      if (s.wake === "settle") settleAt.push(t);
      gate.onWake(s.wake, t);
      sr.noteWake(s.wake, t);
    }
    t += 120;
    return s;
  };
  step(A);
  step(B);
  for (let i = 0; i < 15; i++) step(B); // first landing -> settle
  // "they scrolled away and came back" (rejected.md's own description):
  // a brief detour through C, then straight back to the EXACT same picture B
  step(C);
  step(B);
  for (let i = 0; i < 15; i++) step(B); // a fresh hold on the SAME picture

  ok("exactly one settle across the whole sequence", settleAt.length === 1, JSON.stringify(settleAt));

  // consume the (only) wake, then ask again later in the same session: a
  // repeated identical picture must never re-arm the window a second time
  const first = gate.onHerLine(settleAt[0] + 900);
  ok("the one settle is recordable", first !== null);
  const second = gate.onHerLine(settleAt[0] + 5000);
  ok(
    "no second moment from the re-formed hold on the identical picture",
    second === null,
    JSON.stringify(second),
  );
}

// ── 4. WS-ANDROID-WATCH: the same gate, driven from the native bridge ──
// The Android lane does not run scene.ts — it runs SceneReader.java and
// reports a SHOW-class wake to JS as a "watchwake" event, which
// useCallEngine.ts feeds into these same two functions. native-gate.mjs
// proves the Java half (real compiled geometry) and the composition; what
// belongs HERE is the property the bridge boundary rests on: the gate is
// closed to anything that is not a deliberate SHOW, whatever arrives on it.
// A string crossing a process boundary is not a typed union, so this is
// checked rather than assumed.
{
  const at = 5_000_000;
  for (const cls of ["along", "idle", "start"]) {
    ok(`bridge: an ambient/start class ("${cls}") never arms a window`, armMomentWindow(null, cls, at) === null);
  }
  for (const junk of ["", "SETTLE", "settle ", "watch_visual", "undefined", "0"]) {
    ok(
      `bridge: an unrecognised class (${JSON.stringify(junk)}) never arms a window`,
      armMomentWindow(null, junk, at) === null,
    );
  }
  for (const cls of ["settle", "reshow", "point", "switch"]) {
    ok(`bridge: the SHOW class "${cls}" arms exactly one window`, armMomentWindow(null, cls, at)?.cls === cls);
  }
  // an ambient wake arriving while a show window is open must not clobber it
  const open = armMomentWindow(null, "settle", at);
  ok("bridge: an ambient wake cannot clobber an open show window", armMomentWindow(open, "idle", at + 10) === open);
}

console.log(failed ? `\nFAILED (${failed})` : "\nPASSED");
process.exit(failed ? 1 : 0);
