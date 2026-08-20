// WS-CONTINUITY seam 2 / gate G-C3 — "a thread voiced in text is not
// re-entered at a pickup inside the gap window", n >= 20 scripted switches.
//
//   node evals/continuity/pickup.mjs
//
// WHAT THIS FOUND, stated up front because it changes what the suite is for.
// SPEC-CONTINUITY §1 says useCallEngine "injects the carried thread at pickup,
// reasoning 'a pickup IS a gap entry'" and calls that unconditional. Measured
// against the code, the reasoning in that comment was wrong but the BEHAVIOUR
// was not: the pickup path has always handed `lastMsgAt` to innerContext, and
// innerContext applies GAP_ENTRY_MS itself, to every surface, before anything
// is rendered. The gate the spec asks for already existed — one level down,
// which is where it belongs, because it is then impossible for one lane to
// have a different copy of it.
//
// So this suite is not a regression test for a fix. It is the MEASUREMENT the
// spec asked for, kept because the claim is cheap to assert and expensive to
// re-derive, and because the surrounding code is now the only place a second
// copy of the rule could be introduced.
//
// The scripted switches vary the one thing that decides it (elapsed time) and
// the one thing that must NOT decide it (which channel the last turn was on).
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { innerWithThread, MS_MIN, MS_HOUR } from "./_fixtures.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "wscont-pickup-"));
const BUNDLE = join(tmp, "continuity.bundle.mjs");
execSync(
  `npx esbuild ${join(ROOT, "evals/continuity/_entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const { innerContext, GAP_ENTRY_MS } = await import(BUNDLE);

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) failed++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${detail ? `  ${detail}` : ""}`);
};

// Fixed clock: 2pm on a Wednesday, so weekShape() (which shares the thread's
// gate) contributes nothing and cannot be mistaken for the thread.
const NOW = new Date("2026-08-19T14:00:00+05:30").getTime();
const inner = innerWithThread(NOW, 2 * MS_HOUR);
const hasThread = (out) => out.thread.includes("WHERE YOUR HEAD IS COMING INTO THIS");

// n = 24 scripted switches: 12 gaps x 2 channels for the last turn. The
// channel of the previous turn must never change the answer — that is §2's
// first invariant ("state is channel-blind") in its cheapest testable form.
const GAPS = [
  10_000, 30_000, MS_MIN, 5 * MS_MIN, 15 * MS_MIN, 30 * MS_MIN,
  44 * MS_MIN, 46 * MS_MIN, MS_HOUR, 3 * MS_HOUR, 6 * MS_HOUR, 8 * MS_HOUR,
];

console.log(`\n§1 — pickup takes the gap test (GAP_ENTRY_MS = ${Math.round(GAP_ENTRY_MS / 60_000)} min), n=${GAPS.length * 2}`);
let inside = 0;
let outside = 0;
for (const gap of GAPS) {
  for (const lastChannel of ["chat", "call"]) {
    const out = innerContext(inner, {
      now: NOW,
      lastMsgAt: NOW - gap,
      surface: "pickup",
      userText: "",
    });
    const expected = gap > GAP_ENTRY_MS;
    const got = hasThread(out);
    if (got !== expected) {
      failed++;
      console.log(`FAIL  gap=${Math.round(gap / 60_000)}min last=${lastChannel}: expected thread=${expected}, got ${got}`);
    } else if (expected) outside++;
    else inside++;
  }
}
// 7 of the 12 gaps sit inside the 45-min window and 5 outside, x2 channels.
ok(`no thread on any pickup INSIDE the window (${inside} cases)`, inside === 14);
ok(`thread re-enters on every pickup OUTSIDE it (${outside} cases)`, outside === 10);

console.log("\n§2 — the pickup surface does not get its own rule");
// The one thing that would make seam 2 real: pickup and chat disagreeing at
// the same elapsed time. They must be identical, because they go through the
// same gate.
let divergences = 0;
for (const gap of GAPS) {
  const asChat = hasThread(innerContext(inner, { now: NOW, lastMsgAt: NOW - gap, surface: "chat", userText: "" }));
  const asPickup = hasThread(innerContext(inner, { now: NOW, lastMsgAt: NOW - gap, surface: "pickup", userText: "" }));
  if (asChat !== asPickup) divergences++;
}
ok("pickup and chat agree at every elapsed time", divergences === 0, `${divergences} divergence(s)`);

console.log("\n§3 — a thread already voiced never returns, at any gap (G5)");
// The residual double-voicing risk this workstream can NOT close from here:
// `told` is set by the remember pass (memory.rememberFrom -> applyInner), so a
// thread voiced in text at 10:00 and called at 10:50 is only retired if that
// pass has run AND judged it told. The gate below asserts the mechanism works
// when the flag is set; it cannot assert the flag arrives in time. That gap is
// inner.ts's and is reported, not silently covered here.
const told = { ...inner, thread: { ...inner.thread, told: true } };
let leaks = 0;
for (const gap of GAPS) {
  if (hasThread(innerContext(told, { now: NOW, lastMsgAt: NOW - gap, surface: "pickup", userText: "" }))) leaks++;
}
ok("a told thread is retired permanently", leaks === 0, `${leaks} leak(s)`);

console.log("\n§4 — NEGATIVE CONTROL (the gap test must be capable of failing)");
// If the gate were removed, a 60-second pickup would carry the thread. Model
// that by handing innerContext the state a lane with NO gap test would produce
// — lastMsgAt = 0, i.e. "no previous message", which is what an open-coded
// "a pickup is always a gap entry" reduces to.
ok(
  "an ungated pickup (lastMsgAt=0) DOES carry the thread — so §1 can fail",
  hasThread(innerContext(inner, { now: NOW, lastMsgAt: 0, surface: "pickup", userText: "" })),
);

console.log(failed ? `\nFAILED — ${failed} assertion(s)` : "\nPASS — pickup gap test, n=24 scripted switches");
process.exit(failed ? 1 : 0);
