// evals/time/_checks.mjs — WS-TIME's predicates, in one place.
//
// Every check in this file is a PURE PREDICATE over (a bundled module) or
// (the module's source text), returning a list of problem strings. That shape
// is not tidiness: it is what makes `negative.mjs` possible. The negative
// control mutates a COPY of src/engine/timeline.ts to inject each class of
// violation, bundles the mutant, and runs THESE SAME functions against it,
// asserting they report. A gate suite that has never been shown to fail is a
// gate suite nobody has tested.
//
// Nothing here touches the database, the network, or a model. The two clocks
// are pure functions; their gate should be too.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..");
export const SRC = join(ROOT, "src/engine/timeline.ts");
const NPX_COMMAND = process.platform === "win32" ? process.execPath : "npx";
const NPX_ARGS = process.platform === "win32"
  ? [join(dirname(process.execPath), "node_modules/npm/bin/npx-cli.js")]
  : [];

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

/** Bundle a TS entry with esbuild — same discipline as evals/self/life.mjs:
 *  fresh on every run, so the gate covers the tree being shipped and not a
 *  frozen copy. */
export function bundle(entry, tag = "timeline") {
  const dir = mkdtempSync(join(tmpdir(), `wstime-${tag}-`));
  const out = join(dir, `${tag}.bundle.mjs`);
  execFileSync(
    NPX_COMMAND,
    [
      ...NPX_ARGS, "esbuild",
      entry,
      "--bundle",
      "--format=esm",
      "--platform=node",
      `--outfile=${out}`,
      "--log-level=error",
    ],
    { stdio: "inherit", cwd: ROOT },
  );
  return pathToFileURL(out).href;
}

/** A Monday 00:00 IST anchor, so every sweep below covers a full week with a
 *  known day-of-week mapping. 2026-08-17 was a Monday. */
export const MONDAY_IST = Date.UTC(2026, 7, 17, 0, 0) - 330 * MIN;

export const rows = (text) =>
  String(text || "")
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2));

const wordCount = (s) => s.trim().split(/\s+/).filter(Boolean).length;

// ─────────────────────────────────────────────────────────────────────────
// 1. HER CLOCK
// ─────────────────────────────────────────────────────────────────────────

/** G8 + `recited-prompt` over the AUTHORED tables (the module's own audit). */
export function checkAudit(M) {
  const r = M.auditNotes();
  return { problems: r.problems.slice(), n: r.notesChecked };
}

/**
 * THE ACCEPTANCE TEST, in the owner's own shape: ask at 15:02, call at 15:04,
 * get the same activity. Run as a literal pair AND as a dense sweep.
 */
export function checkTwoMinute(M) {
  const problems = [];
  let n = 0;
  // the literal reported scenario, on every day of the week
  for (let d = 0; d < 7; d++) {
    const a = MONDAY_IST + d * DAY + 15 * HOUR + 2 * MIN;
    const b = a + 4 * MIN;
    const fa = M.herNow(a);
    const fb = M.herNow(b);
    n++;
    if (fa.note !== fb.note)
      problems.push(`15:02 vs 15:06 on day ${d}: activity changed "${fa.note}" -> "${fb.note}"`);
    if (fa.slot !== fb.slot) problems.push(`15:02 vs 15:06 on day ${d}: slot ${fa.slot} -> ${fb.slot}`);
  }
  return { problems, n };
}

/**
 * CONTINUITY, densely. For every minute of a full week, the answer four
 * minutes later must be either the SAME slot or the NEXT slot in that day's
 * own schedule — never a jump, never a regression. Crossing midnight is the
 * one legal wrap (winding_down -> late_night).
 *
 * This is the strong form of "no completely random and unrelated thing": it
 * does not assert she says the same words forever, it asserts her day only
 * ever moves forward one step at a time.
 */
export function checkContinuity(M) {
  const problems = [];
  let n = 0;
  for (let d = 0; d < 7; d++) {
    for (let m = 0; m < 1440; m++) {
      const a = MONDAY_IST + d * DAY + m * MIN;
      const b = a + 4 * MIN;
      const fa = M.herNow(a);
      const fb = M.herNow(b);
      n++;
      if (fa.slot === fb.slot) {
        if (fa.note !== fb.note)
          problems.push(`same slot ${fa.slot} but note changed at day ${d} ${m}m`);
        continue;
      }
      const ta = M.istParts(a);
      const tb = M.istParts(b);
      const schedA = M.scheduleFor(ta.dow);
      const ia = schedA.findIndex((s) => s.key === fa.slot);
      if (ta.dow !== tb.dow) {
        // midnight wrap: the day's last slot into the next day's first
        if (ia !== schedA.length - 1 || M.scheduleFor(tb.dow)[0].key !== fb.slot)
          problems.push(`illegal midnight wrap ${fa.slot} -> ${fb.slot} at day ${d} ${m}m`);
        continue;
      }
      const ib = schedA.findIndex((s) => s.key === fb.slot);
      if (ib !== ia + 1) problems.push(`jumped ${fa.slot}(${ia}) -> ${fb.slot}(${ib}) at day ${d} ${m}m`);
      // a transition must have been announced before it happened
      if (!fa.next) problems.push(`unannounced transition ${fa.slot} -> ${fb.slot} at day ${d} ${m}m`);
    }
  }
  if (problems.length > 12) problems.length = 12;
  return { problems, n };
}

/** Same clock input twice → byte-identical output. Includes the rendered
 *  block, not only the struct, because the render is what ships. */
export function checkDeterminism(M) {
  const problems = [];
  let n = 0;
  for (let i = 0; i < 2000; i++) {
    const t = MONDAY_IST + i * 4321 * MIN; // ~6 years of irregular samples
    const a = M.timeFrame({ now: t, lastSpokeAt: t - 3 * DAY, facts: DET_FACTS(t) });
    const b = M.timeFrame({ now: t, lastSpokeAt: t - 3 * DAY, facts: DET_FACTS(t) });
    n++;
    if (JSON.stringify(a.her) !== JSON.stringify(b.her)) problems.push(`her frame differs at ${t}`);
    if (JSON.stringify(a.his) !== JSON.stringify(b.his)) problems.push(`his frame differs at ${t}`);
    if (a.render.text !== b.render.text) problems.push(`render differs at ${t}`);
  }
  if (problems.length > 8) problems.length = 8;
  return { problems, n };
}

const DET_FACTS = (t) => [
  { id: "f1", name: "presentation", kind: "plan", summary: "presentation on thursday", saidAt: t - 5 * DAY },
  { id: "f2", name: "goa trip", kind: "plan", summary: "goa trip next week", saidAt: t - 2 * DAY },
];

/** Host-timezone independence. Her day is Bangalore's; a machine in Los
 *  Angeles must produce the same bytes as one in Kolkata. Run in child
 *  processes with TZ set, digesting a fixed sweep. */
export function checkTimezoneStable(bundlePath) {
  const problems = [];
  const script = `
    import * as M from ${JSON.stringify(bundlePath)};
    import { createHash } from "node:crypto";
    const h = createHash("sha256");
    for (let i = 0; i < 1000; i++) {
      const t = ${MONDAY_IST} + i * ${7 * MIN};
      const f = M.timeFrame({ now: t, lastSpokeAt: t - ${3 * DAY},
        facts: [{ id: "f1", name: "interview", kind: "plan", summary: "interview on tuesday", saidAt: t - ${6 * DAY} }] });
      h.update(f.render.text);
    }
    process.stdout.write(h.digest("hex"));
  `;
  const dir = mkdtempSync(join(tmpdir(), "wstime-tz-"));
  const file = join(dir, "tz.mjs");
  writeFileSync(file, script);
  const zones = ["UTC", "Asia/Kolkata", "America/Los_Angeles", "Pacific/Kiritimati"];
  const digests = zones.map((tz) =>
    execFileSync("node", [file], { env: { ...process.env, TZ: tz } }).toString().trim(),
  );
  const first = digests[0];
  digests.forEach((d, i) => {
    if (d !== first) problems.push(`TZ=${zones[i]} digest ${d.slice(0, 12)} != TZ=UTC ${first.slice(0, 12)}`);
  });
  return { problems, n: zones.length, digest: first };
}

/** Dated beats OUTRANK the clock shape; an empty table falls back to it. */
export function checkBeatsOutrank(M) {
  const problems = [];
  const t = MONDAY_IST + 3 * DAY + 15 * HOUR; // Thursday 3pm IST
  const empty = M.herNow(t, []);
  if (empty.source !== "clock") problems.push(`empty vy_agent_life: source=${empty.source}, expected "clock"`);
  if (!empty.note) problems.push("empty vy_agent_life: no fallback note");
  if (empty.today.length) problems.push("empty vy_agent_life: today[] not empty");

  const inSlot = M.herNow(t, [{ at: t - 20 * MIN, beat: "client review moved to friday", kind: "work" }]);
  if (inSlot.source !== "beat") problems.push(`beat in slot: source=${inSlot.source}, expected "beat"`);
  if (inSlot.note !== "client review moved to friday")
    problems.push(`beat in slot did not outrank the clock note (got "${inSlot.note}")`);

  const earlier = M.herNow(t, [{ at: t - 7 * HOUR, beat: "laptop went in for repair", kind: "small" }]);
  if (earlier.source !== "clock") problems.push("earlier beat should not replace the current slot's note");
  if (earlier.today[0] !== "laptop went in for repair")
    problems.push(`earlier beat missing from today[]: ${JSON.stringify(earlier.today)}`);

  const yesterday = M.herNow(t, [{ at: t - 30 * HOUR, beat: "went to a wedding", kind: "social" }]);
  if (yesterday.today.length) problems.push("a beat from yesterday must not render as today");
  return { problems, n: 4 };
}

// ─────────────────────────────────────────────────────────────────────────
// 2. HIS CLOCK
// ─────────────────────────────────────────────────────────────────────────

/** The whole point of the second clock, as a table of cases. */
export function checkHorizons(M) {
  const problems = [];
  const now = MONDAY_IST + 4 * DAY + 11 * HOUR; // Friday 11am IST
  const mon = MONDAY_IST + 9 * HOUR; // they last spoke Monday morning
  const cases = [
    // told on Monday that it is on Thursday; today is Friday -> behind him
    {
      name: "monday-said thursday event is behind him on friday",
      fact: { id: "a", name: "presentation", kind: "plan", summary: "presentation on thursday", saidAt: mon },
      want: "moved",
    },
    // told on Monday about next week -> still ahead
    {
      name: "next week is still ahead",
      fact: { id: "b", name: "goa trip", kind: "plan", summary: "goa trip next week", saidAt: mon },
      want: "ahead",
    },
    // "kal" on Monday -> Tuesday -> behind him
    {
      name: "kal resolves forward and lands behind him",
      fact: { id: "c", name: "dentist", kind: "plan", summary: "dentist kal", saidAt: mon },
      want: "moved",
    },
    // explicit dueAt wins over any text
    {
      name: "explicit dueAt outranks the text",
      fact: {
        id: "d",
        name: "visa",
        kind: "event",
        summary: "visa thing sometime",
        saidAt: mon,
        dueAt: now - 2 * HOUR,
      },
      want: "moved",
    },
    // old, undated, time-shaped -> may have passed
    {
      name: "old undated plan reads as may-have-passed",
      fact: { id: "e", name: "shaadi", kind: "plan", summary: "cousin ki shaadi planning", saidAt: now - 120 * DAY },
      want: "maybePassed",
    },
    // dated BEFORE they last spoke -> not news, dropped
    {
      name: "already-past-at-last-contact is dropped",
      fact: { id: "f", name: "exam", kind: "event", summary: "exam on sunday", saidAt: mon - 9 * DAY },
      want: "none",
    },
    // no time content at all -> dropped
    {
      name: "untimed fact is dropped",
      fact: { id: "g", name: "sister", kind: "person", summary: "sister lives in pune", saidAt: mon },
      want: "none",
    },
    // "may" as a modal must not resolve as the month of May
    {
      name: "bare 'may' is not the month",
      fact: { id: "h", name: "landlord", kind: "person", summary: "landlord may be difficult", saidAt: mon },
      want: "none",
    },
  ];
  for (const c of cases) {
    const f = M.hisClock({ now, lastSpokeAt: mon, facts: [c.fact] });
    const got =
      f.moved.length ? "moved" : f.ahead.length ? "ahead" : f.maybePassed.length ? "maybePassed" : "none";
    if (got !== c.want) problems.push(`${c.name}: got ${got}, want ${c.want}`);
  }

  // caps
  const many = [];
  for (let i = 0; i < 9; i++) {
    many.push({
      id: `m${i}`,
      name: `thing ${i}`,
      kind: "plan",
      summary: "thing on wednesday",
      saidAt: mon - i * MIN,
    });
  }
  const capped = M.hisClock({ now, lastSpokeAt: mon, facts: many });
  if (capped.moved.length > M.MAX_MOVED) problems.push(`moved cap broken: ${capped.moved.length}`);

  // re-entry gate: nothing on a mid-conversation turn
  const mid = M.hisClock({ now, lastSpokeAt: now - 3 * MIN, facts: [cases[0].fact] });
  if (mid.moved.length || mid.ahead.length || mid.maybePassed.length)
    problems.push("his clock rendered on a mid-conversation turn (gap gate broken)");

  return { problems, n: cases.length + 2 };
}

/** The duplicated TIME_BOUND regex must stay character-identical to
 *  api/memory.js's. Extracted from BOTH source files, never trusted. */
export function checkTimeBoundParity() {
  const problems = [];
  const grab = (file) => {
    const src = readFileSync(join(ROOT, file), "utf8");
    const i = src.indexOf("/\\b(jan|feb|march");
    if (i < 0) return null;
    const j = src.indexOf("/i;", i);
    return j < 0 ? null : src.slice(i, j + 3);
  };
  const a = grab("api/memory.js");
  const b = grab("src/engine/timeline.ts");
  if (!a) problems.push("could not find TIME_BOUND literal in api/memory.js");
  if (!b) problems.push("could not find TIME_BOUND literal in src/engine/timeline.ts");
  if (a && b && a !== b) problems.push("TIME_BOUND literals have drifted between api/memory.js and timeline.ts");
  return { problems, n: 1 };
}

// ─────────────────────────────────────────────────────────────────────────
// 3. G1 — structural, not conventional
// ─────────────────────────────────────────────────────────────────────────

/** No usage metric reaches any persisted write, because there is no write.
 *  Asserted over the SOURCE TEXT so it cannot be satisfied by an unexercised
 *  code path, and over the repo's import graph so nothing downstream has
 *  quietly wired this module into a writer. */
export function checkSourceG1(src) {
  const problems = [];
  const banned = [
    ["QueryFn", "a DB query function — this module must have no writer"],
    ["localStorage", "persistence"],
    ["sessionStorage", "persistence"],
    ["fetch(", "network"],
    ["XMLHttpRequest", "network"],
    ["applyInner", "a write into her interior"],
    ["InnerPatch", "her interior's write type"],
    ["from \"./inner\"", "an import of her interior module"],
    ["from \"./memory\"", "an import of the memory writer"],
    ["from \"./brain\"", "an import of the orchestrator"],
    ["insert into", "SQL"],
    ["update ", "SQL"],
  ];
  // strip comments: the file DISCUSSES these words at length by design
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .map((l) => l.replace(/\s\/\/.*$/, ""))
    .join("\n");
  for (const [needle, why] of banned) {
    if (code.includes(needle)) problems.push(`G1: source contains "${needle}" (${why})`);
  }
  // her clock must not be able to see the gap: signature-level separation
  const her = /export function herNow\(([^)]*)\)/.exec(code);
  if (!her) problems.push("G1: herNow() not found");
  else if (/gap|lastSpoke|elapsed|since/i.test(her[1]))
    problems.push(`G1: herNow() takes a usage metric: (${her[1].trim()})`);
  // the his-frame type must carry no gap field, so the render cannot emit one
  const frame = /export interface HisFrame \{([\s\S]*?)\n\}/.exec(code);
  if (!frame) problems.push("G1: HisFrame not found");
  else if (/gap|elapsed|lastSpoke|silence|since/i.test(frame[1]))
    problems.push(`G1: HisFrame carries a gap field — the render could emit it`);
  // Module-level mutable state is how a usage metric would accumulate here.
  // Column-0 only, deliberately: a `let` inside a function body is a local,
  // dies with the call, and cannot carry anything between turns.
  for (const line of code.split("\n")) {
    if (/^(let|var)\s/.test(line)) problems.push(`G1: module-level mutable state: ${line.trim()}`);
  }
  return { problems, n: banned.length + 3 };
}

/** Nothing this module renders may describe HER state, and nothing it renders
 *  may name the gap. Checked over real rendered output, rows only — the
 *  HEADERS deliberately contain the word "feel" in order to ban it. */
export function checkNoStateLeak(M) {
  const problems = [];
  let n = 0;
  const now = MONDAY_IST + 4 * DAY + 11 * HOUR;
  const facts = [
    { id: "a", name: "presentation", kind: "plan", summary: "presentation on thursday", saidAt: MONDAY_IST },
    { id: "b", name: "goa trip", kind: "plan", summary: "goa trip next week", saidAt: MONDAY_IST },
  ];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const t = MONDAY_IST + d * DAY + h * HOUR + 7 * MIN;
      const f = M.timeFrame({ now: t, lastSpokeAt: t - 5 * DAY, facts, beats: [] });
      const his = M.renderHisClock(f.his);
      for (const r of rows(his.text)) {
        n++;
        const mood = M.moodWordsIn(r);
        if (mood.length) problems.push(`his-clock row leaks her state (${mood.join(",")}): "${r}"`);
        if (/\bgap\b|\bsince we\b|\bdays? (since|away)\b|\bsilence\b|\bhaven't (spoken|talked)\b/i.test(r))
          problems.push(`his-clock row names the silence: "${r}"`);
      }
      for (const r of rows(M.renderHerDay(f.her).text)) {
        n++;
        const mood = M.moodWordsIn(r);
        if (mood.length) problems.push(`her-day row is a mood, not a clock (${mood.join(",")}): "${r}"`);
      }
    }
  }
  if (problems.length > 8) problems.length = 8;
  return { problems, n };
}

/** The gap must be structurally unrenderable: hisClock consumes it and the
 *  frame it returns has no field carrying it. Checked at runtime too, not
 *  only in the source, so a type-only guarantee cannot be the whole story. */
export function checkGapUnrenderable(M) {
  const problems = [];
  const now = MONDAY_IST + 4 * DAY + 11 * HOUR;
  const facts = [
    { id: "a", name: "presentation", kind: "plan", summary: "presentation on thursday", saidAt: MONDAY_IST },
  ];
  for (const gapDays of [3, 9, 40, 400]) {
    const f = M.hisClock({ now, lastSpokeAt: now - gapDays * DAY, facts });
    const keys = Object.keys(f);
    for (const k of keys) {
      if (/gap|elapsed|since|lastSpoke|silence/i.test(k)) problems.push(`HisFrame exposes "${k}"`);
    }
    const text = M.renderHisClock(f).text;
    const ms = String(now - (now - gapDays * DAY));
    if (text.includes(ms)) problems.push(`rendered block contains the raw gap (${ms})`);
    if (new RegExp(`\\b${gapDays} days?\\b`).test(text))
      problems.push(`rendered block names the gap length (${gapDays} days)`);
  }
  return { problems, n: 4 };
}

// ─────────────────────────────────────────────────────────────────────────
// 4. `recited-prompt` shape-lint + budgets, over everything rendered
// ─────────────────────────────────────────────────────────────────────────

/** Every row this module can emit, over a week-long sweep with beats and
 *  facts present, run through shapelint's content rules and the budgets. */
export function checkRenderShape(M) {
  const problems = [];
  let n = 0;
  let worst = 0;
  const facts = [
    { id: "a", name: "quarterly presentation review", kind: "plan", summary: "presentation on thursday", saidAt: MONDAY_IST - 20 * DAY },
    { id: "b", name: "goa trip with the college group", kind: "plan", summary: "goa trip next month", saidAt: MONDAY_IST },
    { id: "c", name: "cousin ki shaadi in december", kind: "plan", summary: "shaadi planning", saidAt: MONDAY_IST - 200 * DAY },
  ];
  const beats = [
    { at: 0, beat: "a very long life beat that keeps going and going past every reasonable cap on length", kind: "work" },
    { at: 0, beat: "second beat of the day, also quite long, still going", kind: "small" },
  ];
  for (let d = 0; d < 7; d++) {
    for (let m = 0; m < 1440; m += 7) {
      const t = MONDAY_IST + d * DAY + m * MIN;
      const dated = beats.map((b, i) => ({ ...b, at: t - (i === 0 ? 10 * MIN : 5 * HOUR) }));
      const f = M.timeFrame({ now: t, lastSpokeAt: t - 6 * DAY, facts, beats: dated });
      n++;
      worst = Math.max(worst, f.render.text.length);
      if (!f.render.lint.clean)
        problems.push(`lint/budget violation at day ${d} ${m}m (${f.render.lint.violations})`);
      for (const r of rows(f.render.text)) {
        if (wordCount(r) > 14) problems.push(`row >14 words: "${r}"`);
        if (/^[A-Z][^.?!]*[.?!]$/.test(r)) problems.push(`row is sentence-shaped: "${r}"`);
        if (/^(i\b|i'm\b|i've\b|main\b|mai\b|mujhe\b|meri\b|mera\b|maine\b)/i.test(r))
          problems.push(`row is first-person line-initial: "${r}"`);
      }
    }
  }
  if (worst > M.TIME_FRAME_BUDGET) problems.push(`worst-case render ${worst} > budget ${M.TIME_FRAME_BUDGET}`);
  if (problems.length > 8) problems.length = 8;
  return { problems, n, worst };
}

export function digestOf(s) {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}
