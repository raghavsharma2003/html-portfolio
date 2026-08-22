// WS-WORLD — the sky is the clock, pinned.
//
// Every failure mode of a time-driven world is silent, which is the same
// argument evals/theme.mjs opens with and it is even more true here: a sky
// that resolves the wrong state at 04:29 is wrong for ninety seconds a day,
// on a screen nobody is looking at, and it looks perfect at every other
// moment. Nothing that runs the app can catch that. A table can.
//
// Bundled fresh from the REAL src/engine/sky.ts on every run (same discipline
// as evals/run.mjs: a frozen copy passes forever while the source rots), and
// self-contained rather than riding evals/.entry.ts so it can be run alone:
//
//   node evals/sky.mjs
//
// Offline, deterministic, no database, no network, no model call, ~1s.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const dir = mkdtempSync(join(tmpdir(), "skyeval-"));
const out = join(dir, "sky.mjs");
execFileSync(
  "npx",
  [
    "esbuild",
    "src/engine/sky.ts",
    "--bundle",
    "--format=esm",
    "--platform=node",
    `--outfile=${out}`,
    "--log-level=error",
  ],
  { cwd: ROOT, stdio: "inherit" },
);
const sky = await import(out);
// also bundle away.ts, because the consistency invariant below is a claim
// about TWO files and asserting it against a copied-out constant would be
// asserting it against nothing
const outAway = join(dir, "away.mjs");
execFileSync(
  "npx",
  [
    "esbuild",
    "src/engine/away.ts",
    "--bundle",
    "--format=esm",
    "--platform=node",
    `--outfile=${outAway}`,
    "--log-level=error",
  ],
  { cwd: ROOT, stdio: "inherit" },
);
const away = await import(outAway);

const {
  SKY_STATES,
  SKY_BOUNDARIES,
  SKY_TOKENS,
  SKY_TRANSITION_MIN,
  stateAtMinute,
  nextBoundaryAfter,
  skyAt,
  skyMode,
  moonPhaseAt,
  parseSkySeed,
  midpointOf,
  tokensFor,
} = sky;

let fail = 0;
let checks = 0;
const ok = (name, cond, extra = "") => {
  checks++;
  if (!cond) {
    fail++;
    console.log(`FAIL ${name}${extra ? " — " + extra : ""}`);
  }
};

/** A Bangalore minute-of-day, as an epoch ms on a fixed date. IST is UTC+5:30
 *  with no DST ever, so this is exact rather than approximate. */
const IST = 330 * 60_000;
const DAY = 86_400_000;
const BASE_MIDNIGHT = Math.floor((Date.UTC(2026, 7, 22) + IST) / DAY) * DAY - IST;
const atMin = (m) => BASE_MIDNIGHT + m * 60_000;

// ── 1. the table itself ───────────────────────────────────────────────────
ok("five states, no more", SKY_STATES.length === 5, String(SKY_STATES.length));
ok(
  "the five states are the direction doc's five",
  ["night", "predawn", "morning", "golden", "dusk"].every((s) => SKY_STATES.includes(s)),
);
ok("every state has tokens", SKY_STATES.every((s) => SKY_TOKENS[s]));
ok("tokensFor agrees with the table", SKY_STATES.every((s) => tokensFor(s) === SKY_TOKENS[s]));
ok(
  "every state names itself in its own row",
  SKY_STATES.every((s) => SKY_TOKENS[s].state === s),
);
ok(
  "every sky has exactly four stops",
  SKY_STATES.every((s) => SKY_TOKENS[s].stops.length === 4),
);
ok(
  "every stop is a 6-digit hex",
  SKY_STATES.every((s) => SKY_TOKENS[s].stops.every((c) => /^#[0-9a-f]{6}$/i.test(c))),
);
ok(
  "every state declares a light/dark mode",
  SKY_STATES.every((s) => SKY_TOKENS[s].mode === "light" || SKY_TOKENS[s].mode === "dark"),
);

// THE PAINTING SWAP POINT. Stage 2 changes `img` and nothing else; a state
// that lost the field would silently stay procedural forever while the other
// four swapped, which is the kind of bug that ships.
ok(
  "every state carries the --world-img swap point",
  SKY_STATES.every((s) => typeof SKY_TOKENS[s].img === "string"),
);
ok(
  "stage 1 ships with no painting wired",
  SKY_STATES.every((s) => SKY_TOKENS[s].img === ""),
  SKY_STATES.filter((s) => SKY_TOKENS[s].img !== "").join(","),
);

// ── 2. the boundaries, to the minute ──────────────────────────────────────
// Pinned as literals rather than re-derived from the table: a test that reads
// the table it is testing tests nothing at all.
const EXPECT = [
  [270, "predawn"], // 04:30
  [370, "morning"], // 06:10
  [980, "golden"], // 16:20
  [1090, "dusk"], // 18:10
  [1180, "night"], // 19:40
];
ok("the boundary count is pinned", SKY_BOUNDARIES.length === EXPECT.length);
for (let i = 0; i < EXPECT.length; i++) {
  const b = SKY_BOUNDARIES[i];
  ok(
    `boundary ${i}: ${EXPECT[i][1]} at minute ${EXPECT[i][0]}`,
    b && b.at === EXPECT[i][0] && b.state === EXPECT[i][1],
    b ? `${b.state}@${b.at}` : "missing",
  );
}
ok(
  "boundaries are strictly ascending",
  SKY_BOUNDARIES.every((b, i) => i === 0 || b.at > SKY_BOUNDARIES[i - 1].at),
);

// The state on EACH SIDE of every boundary, which is the assertion that
// actually catches an off-by-one — a boundary table can be right and the
// lookup still wrong.
for (const [min, state] of EXPECT) {
  ok(`minute ${min} IS ${state}`, stateAtMinute(min) === state, stateAtMinute(min));
  const prevExpected =
    EXPECT.filter((e) => e[0] < min).pop()?.[1] ?? "night";
  ok(
    `minute ${min - 1} is still ${prevExpected}`,
    stateAtMinute(min - 1) === prevExpected,
    stateAtMinute(min - 1),
  );
}

// ── 3. totality ───────────────────────────────────────────────────────────
// Every minute of the day resolves, and resolves to a state that has tokens.
// A gap here is a blank screen at a time of day nobody tested.
{
  let bad = 0;
  const seen = new Set();
  for (let m = 0; m < 1440; m++) {
    const s = stateAtMinute(m);
    if (!SKY_STATES.includes(s) || !SKY_TOKENS[s]) bad++;
    seen.add(s);
  }
  ok("all 1440 minutes resolve to a real state", bad === 0, `${bad} bad`);
  ok("every state is reachable from some minute", seen.size === 5, [...seen].join(","));
}
// Wrap-around: midnight belongs to night, which is the one the table does not
// state directly (night is the state BEFORE the first boundary and AFTER the
// last, and a lookup that got that wrong would be wrong for four and a half
// hours every night).
ok("00:00 is night", stateAtMinute(0) === "night");
ok("23:59 is night", stateAtMinute(1439) === "night");
ok("negative minutes fold rather than throw", stateAtMinute(-1) === "night");
ok("minutes past a day fold", stateAtMinute(1440) === stateAtMinute(0));

// ── 4. THE away.ts INVARIANT ──────────────────────────────────────────────
// The load-bearing cross-file claim, stated in sky.ts's header: every minute
// inside away.ts's night window (NIGHT_START_HOUR..NIGHT_END_HOUR, the hours
// whose crossing makes a gap "overnight") must resolve to a DARK sky.
//
// It is asserted against away.ts's REAL constants, bundled above. If someone
// widens that window to 00:00-07:00, this fails and the sky table has to
// answer for it, which is the entire point: two clocks that disagree in front
// of the user is the failure, and neither file can see the other.
{
  let light = [];
  for (let h = away.NIGHT_START_HOUR; h < away.NIGHT_END_HOUR; h++) {
    for (let m = 0; m < 60; m++) {
      const s = stateAtMinute(h * 60 + m);
      if (SKY_TOKENS[s].mode !== "dark") light.push(`${h}:${String(m).padStart(2, "0")}=${s}`);
    }
  }
  ok(
    `away.ts's night window (${away.NIGHT_START_HOUR}-${away.NIGHT_END_HOUR}) is dark sky throughout`,
    light.length === 0,
    light.slice(0, 4).join(" "),
  );
}
// …and the converse sanity: broad daylight is NOT dark.
ok("noon is a light sky", SKY_TOKENS[stateAtMinute(720)].mode === "light");
ok("11pm is a dark sky", SKY_TOKENS[stateAtMinute(23 * 60)].mode === "dark");

// ── 5. skyAt / the frame ──────────────────────────────────────────────────
{
  const f = skyAt(atMin(720)); // noon
  ok("frame reports the minute it resolved from", f.minuteOfDay === 720, String(f.minuteOfDay));
  ok("noon is morning", f.state === "morning", f.state);
  ok("noon's next is golden", f.next === "golden", f.next);
  ok("far from a boundary, blend is 0", f.blend === 0, String(f.blend));
  ok("frame carries its own tokens", f.tokens === SKY_TOKENS.morning);
  ok("frame carries the next state's tokens", f.nextTokens === SKY_TOKENS.golden);
  ok("msToNext is positive", f.msToNext > 0);
  // 16:20 - 12:00 = 260 minutes
  ok("msToNext counts to the real boundary", f.msToNext === 260 * 60_000, String(f.msToNext));
}
// The cross-fade window: blend rises to 1 AT the boundary and is 0 one minute
// before the window opens. A blend that never reached 1 would leave a visible
// snap at every boundary; one that started early would wash out the state.
{
  const b = 980; // golden begins
  ok("blend is 0 outside the window", skyAt(atMin(b - SKY_TRANSITION_MIN - 1)).blend === 0);
  ok(
    "blend opens at the window edge",
    skyAt(atMin(b - SKY_TRANSITION_MIN)).blend === 0,
    String(skyAt(atMin(b - SKY_TRANSITION_MIN)).blend),
  );
  const mid = skyAt(atMin(b - SKY_TRANSITION_MIN / 2)).blend;
  ok("blend is halfway at the window's midpoint", Math.abs(mid - 0.5) < 1e-9, String(mid));
  const last = skyAt(atMin(b - 1)).blend;
  ok("blend is nearly 1 at the last minute", last > 0.9, String(last));
  ok("blend is never above 1", last <= 1);
  ok(
    "the state on the far side of the window has actually changed",
    skyAt(atMin(b)).state === "golden" && skyAt(atMin(b - 1)).state === "morning",
  );
}
// Purity: the same instant answers the same way, always.
{
  const t = atMin(1000);
  const a = skyAt(t);
  const b = skyAt(t);
  ok(
    "skyAt is pure",
    a.state === b.state && a.blend === b.blend && a.minuteOfDay === b.minuteOfDay,
  );
}

// ── 6. nextBoundaryAfter ──────────────────────────────────────────────────
ok("next boundary after noon is 16:20", nextBoundaryAfter(720) === 980);
ok("next boundary after 20:00 wraps past midnight", nextBoundaryAfter(1200) === 1440 + 270);
ok("next boundary after 00:10 is 04:30", nextBoundaryAfter(10) === 270);

// ── 7. skyMode — the theme mode's only input ──────────────────────────────
ok("skyMode at noon is light", skyMode(atMin(720)) === "light");
ok("skyMode at 2am is dark", skyMode(atMin(120)) === "dark");
ok("skyMode at 5am (predawn) is dark", skyMode(atMin(300)) === "dark");
ok("skyMode at 5pm (golden) is light", skyMode(atMin(1020)) === "light");
ok("skyMode at 6:30pm (dusk) is dark", skyMode(atMin(1110)) === "dark");
ok(
  "skyMode never disagrees with the token table",
  Array.from({ length: 1440 }, (_, m) => skyMode(atMin(m)) === SKY_TOKENS[stateAtMinute(m)].mode)
    .every(Boolean),
);

// ── 8. the moon ───────────────────────────────────────────────────────────
// A moon that is always full is a sticker. These pin that it moves, that it
// is never invisible, and that it is the same moon on every device.
{
  const p = moonPhaseAt(Date.UTC(2026, 7, 22));
  ok("phase fraction is in range", p.fraction >= 0 && p.fraction < 1, String(p.fraction));
  ok("lit fraction is in range", p.lit >= 0 && p.lit <= 1, String(p.lit));
  ok("side is -1 or 1", p.side === -1 || p.side === 1, String(p.side));
  ok("phase has a label", typeof p.label === "string" && p.label.length > 0);

  let minOffset = Infinity;
  let maxOffset = -Infinity;
  const labels = new Set();
  for (let d = 0; d < 60; d++) {
    const q = moonPhaseAt(Date.UTC(2026, 0, 1) + d * DAY);
    minOffset = Math.min(minOffset, q.offset);
    maxOffset = Math.max(maxOffset, q.offset);
    labels.add(q.label);
  }
  // NEVER INVISIBLE: an absent moon on a sky that has one every other night
  // reads as a bug, so the crescent floors at a sliver rather than going to
  // nothing at new moon.
  ok("the moon is never fully eaten", minOffset >= 7, minOffset.toFixed(2));
  ok("the moon reaches (near) full", maxOffset > 97, maxOffset.toFixed(2));
  ok("two months produce several distinct phases", labels.size >= 4, [...labels].join(","));
  ok(
    "the phase is deterministic",
    moonPhaseAt(12345678).offset === moonPhaseAt(12345678).offset &&
      moonPhaseAt(12345678).label === moonPhaseAt(12345678).label,
  );
  // Both directions actually occur, or the crescent would only ever open one
  // way and half of every month would be drawn backwards.
  const sides = new Set(
    Array.from({ length: 40 }, (_, d) => moonPhaseAt(Date.UTC(2026, 0, 1) + d * DAY).side),
  );
  ok("waxing and waning both happen", sides.size === 2, [...sides].join(","));
}

// ── 9. the test seam ──────────────────────────────────────────────────────
// The seam is how the browser battery photographs all five states without
// waiting for a day to pass, so a broken seam is a battery that silently
// screenshots the same sky five times.
ok("a bad seed is rejected", parseSkySeed("nonsense") === null);
ok("an empty seed is rejected", parseSkySeed("") === null);
ok("a null seed is rejected", parseSkySeed(null) === null);
ok("an out-of-range time is rejected", parseSkySeed("25:00") === null);
ok("a bad minute is rejected", parseSkySeed("04:99") === null);
for (const s of SKY_STATES) {
  const at = parseSkySeed(s, BASE_MIDNIGHT + 11 * 3_600_000);
  ok(`seed "${s}" resolves`, at !== null);
  ok(
    `seed "${s}" lands in ${s}`,
    at !== null && skyAt(at).state === s,
    at === null ? "null" : skyAt(at).state,
  );
  // The midpoint, so a screenshot is of the STATE rather than of a cross-fade.
  ok(`seed "${s}" is clear of the transition window`, at !== null && skyAt(at).blend === 0);
}
{
  const at = parseSkySeed("04:45", BASE_MIDNIGHT + 11 * 3_600_000);
  ok("an explicit IST time resolves", at !== null);
  ok("04:45 is predawn", at !== null && skyAt(at).state === "predawn", String(at && skyAt(at).state));
  ok("04:45 resolves to minute 285", at !== null && skyAt(at).minuteOfDay === 285);
}
ok(
  "every midpoint is inside its own state",
  SKY_STATES.every((s) => stateAtMinute(midpointOf(s)) === s),
);
// The night midpoint is the one that has to cross midnight to be right.
ok("night's midpoint is in the small hours", midpointOf("night") < 270, String(midpointOf("night")));

// ── 10. the one clock ─────────────────────────────────────────────────────
// STRUCTURAL, on the source text, because this is a rule about what the file
// may CONTAIN rather than about what it returns. sky.ts must derive its hour
// from timeline.ts's istParts and from nothing else — a `new Date().getHours()`
// slipped in here would read the DEVICE's clock, and a user in California
// would get a night sky over her Bangalore morning while the prompt she is
// answering from says it is 10am.
{
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(join(ROOT, "src/engine/sky.ts"), "utf8"),
  );
  ok("sky.ts imports istParts from timeline", /import \{ istParts \} from "\.\/timeline"/.test(src));
  // Comment-blind, because this file's own header states the rule in prose
  // and the first version of this check failed on the sentence describing
  // what may not be there. A lint that flags its own justification is a lint
  // people delete.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
  ok(
    "sky.ts never reads local hours",
    !/getHours\(|getMinutes\(|getDay\(|toLocaleTimeString/.test(code),
  );
  ok(
    "sky.ts imports nothing but timeline",
    (src.match(/^import /gm) || []).length === 1,
    String((src.match(/^import /gm) || []).length),
  );
}

console.log(fail ? `${fail} of ${checks} FAILED` : `ALL PASS (${checks} checks)`);
try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  /* temp dir */
}
process.exit(fail ? 1 : 0);
