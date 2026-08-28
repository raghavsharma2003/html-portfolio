// WS-Q — THE CLONE ALIVENESS GATE.
//
//   node evals/run.mjs clonelife
//
// Offline, deterministic, $0, no DB, no network, ZERO model calls, ~1s.
// Re-bundled from the REAL source by evals/run.mjs on every run.
//
// ═════════════════════════════════════════════════════════════════════════
// WHAT THIS GATES, AND WHY EACH HALF IS SILENT WHEN IT BREAKS
// ═════════════════════════════════════════════════════════════════════════
//
// Owner intent (2026-08-26): "can we make a literal human in every way using
// relationalOS" — a clone must feel like a continuous being with a life, not a
// persona that answers questions. Two mechanisms carry that, and both fail
// quietly:
//
//  §1-§2 CONTINUITY. A clone's present is a pure function of its sheet and the
//    clock. When that breaks it does not throw — it answers "what are you
//    doing" two different ways four minutes apart, which is precisely the
//    defect `herNow.ts` was built for on Meera's side ("reading a book", then
//    "setting fairy lights", sixty seconds apart) and which nothing in this
//    tree would have caught for a clone.
//
//  §3-§4 PROACTIVITY. The predicate that decides whether a clone may speak
//    first. When THAT breaks the product still works: it just sends a
//    sixteen-year-old a message because they went quiet. `persona.ts:570-577`
//    deleted exactly that mechanic from Meera and wrote "do not re-add a
//    silence-triggered ping in any form"; `teacher-arc.md` §7 rows 8/9 ban it
//    outright for minors. A ban with no test is a comment.
//
//  §5 BYTE IDENTITY. The seam must be provably free for every incumbent.
//
// ── NEGATIVE CONTROLS ────────────────────────────────────────────────────
// A suite that would pass against the defect it exists to catch is not a suite
// (this repo's law). Three run here, each re-running a claim against the input
// that must break it:
//   NC1 the pre-fix "roll" — a present drawn per-minute instead of per-slot,
//       seen disagreeing across a four-minute gap;
//   NC2 the citation requirement struck from the predicate, seen firing on a
//       record with nothing to cite;
//   NC3 an absence-triggered predicate — the deleted idle nudge, rebuilt —
//       seen firing on silence alone.
import {
  compile,
  DEFAULT_AGENT,
  TAIL_MANIFEST,
  TAIL_ORDER,
  assertManifestArithmetic,
  cloneNowAt,
  renderCloneNow,
  localParts,
  CLONE_NOW_BUDGET,
  CLONE_NOW_HEADER,
  MINUTES_IN_DAY,
  initiativeVerdict,
  renderInitiative,
  INITIATIVE_BUDGET,
  DAYTIME_FROM_MIN,
  DAYTIME_TO_MIN,
  OVERDUE_GRACE_MS,
  PATTERN_MIN_OBSERVATIONS,
  DEMO_TEACHER,
  sheetToModule,
  validateTeacherSheet,
  validateCloneLife,
  cloneLifeRows,
  lintLine,
  moodWordsIn,
} from "../.bundle.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

let fail = 0;
let pass = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${extra ? " — " + extra : ""}`);
  }
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const LIFE = DEMO_TEACHER.life;

// A Monday, 10:00 IST. Mid-slot on purpose: a fixture sitting on a boundary
// measures the boundary, not the property.
const MON_1000 = Date.UTC(2026, 7, 24, 4, 30, 0);

console.log("\n═══ WS-Q — clone aliveness ═══");

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§1 the sheet's life shape is well-formed and un-recitable");
// ═════════════════════════════════════════════════════════════════════════
{
  ok("demo sheet's life passes the structural validator", validateCloneLife(LIFE).length === 0,
    JSON.stringify(validateCloneLife(LIFE)));

  const rows = cloneLifeRows(LIFE);
  ok("life shape carries rows at all", rows.length >= 20, String(rows.length));

  const recitable = rows.filter((r) => lintLine(r).reasons.length);
  ok("no life row is sentence-shaped (recited-prompt)", recitable.length === 0,
    recitable.slice(0, 3).join(" | "));

  const moody = rows.filter((r) => moodWordsIn(r).length);
  ok("no life row carries a mood word (G8: a calendar is not a mood engine)", moody.length === 0,
    moody.slice(0, 3).join(" | "));

  // Both covers must reach midnight, or the clone's evening silently becomes
  // its afternoon — a silent-truncation in a calendar.
  for (const [name, cover] of [["weekday", LIFE.weekdayShape], ["weekend", LIFE.weekendShape]]) {
    ok(`${name} cover reaches midnight`, cover[cover.length - 1].untilMin === MINUTES_IN_DAY);
  }

  ok("full sheet validation is green (life errors included)", validateTeacherSheet(DEMO_TEACHER).ok,
    JSON.stringify(validateTeacherSheet(DEMO_TEACHER).errors.slice(0, 3)));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§2 continuity — the present does not re-roll, and the day moves in order");
// ═════════════════════════════════════════════════════════════════════════
{
  // THE OWNER'S ORIGINAL CASE, transposed: ask, wait four minutes, ask again.
  //
  // Compared on the SEMANTIC fields, not on the whole entry: `minuteOfDay` is
  // a clock reading and is SUPPOSED to advance. What may never change inside a
  // slot is the answer to "what are you doing" — which is the thing that
  // changed on Meera sixty seconds apart, and the only thing that reaches a
  // model here.
  const said = (e) => JSON.stringify([e.dateKey, e.slotKey, e.note, e.next, e.preoccupation, e.todayBeats]);
  const a = cloneNowAt(LIFE, MON_1000);
  const b = cloneNowAt(LIFE, MON_1000 + 4 * MIN);
  ok("the same slot four minutes later says the SAME thing", said(a) === said(b));
  ok("…and the rendered block is identical too", renderCloneNow(a) === renderCloneNow(b));

  // Determinism with no state anywhere: two independent readers, no ledger.
  ok("two independent computations of the same instant agree",
    JSON.stringify(cloneNowAt(LIFE, MON_1000)) === JSON.stringify(cloneNowAt(LIFE, MON_1000)));

  // Sweep a whole week, minute by minute at 5-minute resolution: the slot key
  // may only ever advance within a day, never jump backwards.
  let jumps = 0;
  let distinctNotes = new Set();
  let coverGaps = 0;
  // The continuity metric is position WITHIN TODAY'S cover, so it is tracked
  // per local calendar day and reset when the date rolls — a day ending and
  // another beginning is not a backwards jump, and a sweep that counted it as
  // one would be measuring midnight.
  {
    let prevIndex = -1;
    let prevDate = "";
    // Start well before the first local midnight in range so every one of the
    // seven days is walked from its own 00:00.
    const start = MON_1000 - 4 * HOUR - 30 * MIN;
    for (let m = 0; m < 7 * MINUTES_IN_DAY; m += 5) {
      const e = cloneNowAt(LIFE, start + m * MIN);
      if (!e) { coverGaps++; continue; }
      distinctNotes.add(e.note);
      if (e.dateKey !== prevDate) { prevIndex = -1; prevDate = e.dateKey; }
      const cover = e.dow === 0 || e.dow === 6 ? LIFE.weekendShape : LIFE.weekdayShape;
      const idx = cover.findIndex((s) => s.key === e.slotKey);
      if (idx < prevIndex) jumps++;
      prevIndex = idx;
    }
  }
  ok("every minute of a full week resolves to a slot", coverGaps === 0, String(coverGaps));
  ok("the day never runs backwards over a full week sweep", jumps === 0, String(jumps));
  ok("a week produces a real variety of notes, not one", distinctNotes.size >= 8, String(distinctNotes.size));

  // Two SURFACES compiling the same instant must agree — the property that
  // stops a clone remembering on the phone and forgetting in text.
  const clone = sheetToModule(DEMO_TEACHER);
  const base = {
    user: { name: "Ishan", vibe: [], facts: {} },
    messageCount: 40,
    isDirective: false,
    watching: false,
    innerThread: "",
    innerWants: "",
    memories: "",
    herLife: "",
    cultureNoteText: "",
    latestUserText: "sir yeh doubt hai",
    nowMs: MON_1000,
    agent: clone,
    cloneNow: cloneNowAt(LIFE, MON_1000),
  };
  const chat = compile({ ...base, medium: "text", mode: "chat", voiceEngine: "none" });
  const call = compile({ ...base, medium: "voice", mode: "call", voiceEngine: "gemini" });
  const blockOf = (t) => {
    const i = t.indexOf(CLONE_NOW_HEADER);
    if (i < 0) return "";
    const rest = t.slice(i);
    const end = rest.indexOf("\n\n");
    return end < 0 ? rest : rest.slice(0, end);
  };
  ok("T18 renders on the chat lane", blockOf(chat.tail).length > 0);
  ok("T18 renders on the call lane", blockOf(call.tail).length > 0);
  ok("the clone's stated life is identical across both surfaces",
    blockOf(chat.tail) === blockOf(call.tail));

  // A LONG SESSION: the same instant compiled at turn 1 and turn 44 must carry
  // the same life. This is drift.mjs's question asked of the aliveness layer.
  const t1 = compile({ ...base, messageCount: 1, medium: "text", mode: "chat", voiceEngine: "none" });
  const t44 = compile({ ...base, messageCount: 44, medium: "text", mode: "chat", voiceEngine: "none" });
  ok("the life block is unchanged between turn 1 and turn 44 of one session",
    blockOf(t1.tail) === blockOf(t44.tail));

  ok("T18 respects its declared budget", blockOf(chat.tail).length <= CLONE_NOW_BUDGET,
    `${blockOf(chat.tail).length} > ${CLONE_NOW_BUDGET}`);

  const rendered = blockOf(chat.tail).split("\n").slice(1);
  const badRows = rendered.filter((r) => lintLine(r.replace(/^- [^:]*: /, "")).reasons.length);
  ok("every rendered row survives shapelint", badRows.length === 0, badRows.join(" | "));

  // ── NC1: the pre-fix ROLL. A present keyed on the MINUTE instead of the
  // slot — the shape herNow.ts was written to kill. It must be seen breaking.
  const rolled = (at) => {
    const p = localParts(at, LIFE.tzOffsetMin);
    const cover = p.dow === 0 || p.dow === 6 ? LIFE.weekendShape : LIFE.weekdayShape;
    let start = 0;
    for (const s of cover) {
      if (p.minuteOfDay < s.untilMin) {
        // the defect: re-draw per minute rather than per (date, slot)
        return s.notes[p.minuteOfDay % s.notes.length];
      }
      start = s.untilMin;
    }
    return String(start);
  };
  const nc1Differs = rolled(MON_1000) !== rolled(MON_1000 + 4 * MIN);
  ok("NC1 the per-minute roll IS caught disagreeing across four minutes", nc1Differs);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§3 proactivity — absence alone can NEVER trigger it");
// ═════════════════════════════════════════════════════════════════════════
{
  const EMPTY = {
    nowMs: MON_1000,
    localMinuteOfDay: 600,
    commitments: [],
    statedTimes: [],
    patterns: [],
  };

  // THE NEGATIVE CONTROL THE BRIEF REQUIRES, swept rather than sampled: an
  // empty record at every gap from one minute to one year. Silence is not an
  // input this predicate has, so no gap may ever produce a verdict.
  let fired = 0;
  const gaps = [];
  for (let m = 1; m <= 525_600; m = Math.ceil(m * 1.3)) gaps.push(m);
  for (const gapMin of gaps) {
    for (let minute = 0; minute < MINUTES_IN_DAY; minute += 17) {
      const v = initiativeVerdict({ ...EMPTY, nowMs: MON_1000 + gapMin * MIN, localMinuteOfDay: minute });
      if (v) fired++;
    }
  }
  ok(`absence alone never initiates (${gaps.length} gaps x 85 minutes-of-day, 0 verdicts)`, fired === 0,
    String(fired));

  // STRUCTURAL, not merely behavioural: the record has no field absence could
  // arrive through, so the sweep above is a demonstration of a type property
  // rather than a hope about a branch.
  const src = readFileSync(join(ROOT, "src/engine/agents/initiative.ts"), "utf8");
  // Comments AND string literals are stripped before the check. The header the
  // module renders into the prompt necessarily contains the words "silence"
  // and "absence" — it is the instruction never to mention them — and a check
  // that flagged its own prohibition would be the lint that cries wolf. What
  // must be absent is CODE: an identifier, a field, a branch.
  const body = src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
  const forbidden = [
    "lastSeen", "lastSpoke", "gapSince", "silen", "streak", "daysSince",
    "inactiv", "absen", "sessionCount", "messageCount", "lastMsgAt",
  ];
  const found = forbidden.filter((f) => new RegExp(f, "i").test(body));
  ok("initiative.ts's code carries no absence-shaped identifier", found.length === 0, found.join(", "));

  ok("initiative.ts imports nothing (leaf rule)", !/^\s*import\s/m.test(src));

  // ── NC3: the DELETED IDLE NUDGE, rebuilt. A predicate that fires on silence
  // must be seen firing, or "we banned it" is a comment.
  const idleNudge = (rec, gapMs) => (gapMs > 30 * MIN ? { mayInitiate: true, kind: "silence" } : null);
  ok("NC3 a silence-triggered predicate IS caught firing on an empty record",
    Boolean(idleNudge(EMPTY, 45 * MIN)));
  ok("NC3 …and the real predicate refuses the identical situation",
    initiativeVerdict({ ...EMPTY, nowMs: MON_1000 + 45 * MIN }) === null);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§4 proactivity — a real, citable reason, and nothing else");
// ═════════════════════════════════════════════════════════════════════════
{
  const at = MON_1000;
  const withReason = (over) => ({
    nowMs: at,
    localMinuteOfDay: 600,
    commitments: [],
    statedTimes: [],
    patterns: [],
    ...over,
  });

  const promised = initiativeVerdict(withReason({
    commitments: [{ what: "rotational-inertia problem set", dueAt: at - 10 * MIN, citedAt: at - 2 * DAY }],
  }));
  ok("a due promise initiates", promised?.kind === "promised-followup");
  ok("…and carries a citation", (promised?.citedAt || 0) > 0);

  const stated = initiativeVerdict(withReason({
    statedTimes: [{ what: "mock test today, four o'clock", at: at + 2 * HOUR, citedAt: at - 20 * HOUR }],
  }));
  ok("a time THEY stated initiates", stated?.kind === "stated-time");

  const pattern = initiativeVerdict(withReason({
    patterns: [{ what: "sign convention dropped under time pressure", observations: 4, lastObservedAt: at - 2 * DAY }],
  }));
  ok("a pattern with enough evidence initiates", pattern?.kind === "named-pattern");

  // Every way a reason is NOT a reason.
  ok("an uncited promise never initiates",
    initiativeVerdict(withReason({
      commitments: [{ what: "problem set", dueAt: at - 10 * MIN, citedAt: 0 }],
    })) === null);
  ok("a promise not yet due never initiates",
    initiativeVerdict(withReason({
      commitments: [{ what: "problem set", dueAt: at + HOUR, citedAt: at - DAY }],
    })) === null);
  ok("a promise long past its grace never initiates",
    initiativeVerdict(withReason({
      commitments: [{ what: "problem set", dueAt: at - OVERDUE_GRACE_MS - HOUR, citedAt: at - 5 * DAY }],
    })) === null);
  ok(`a pattern under ${PATTERN_MIN_OBSERVATIONS} observations never initiates`,
    initiativeVerdict(withReason({
      patterns: [{ what: "sign convention", observations: PATTERN_MIN_OBSERVATIONS - 1, lastObservedAt: at - DAY }],
    })) === null);
  ok("a stale pattern never initiates",
    initiativeVerdict(withReason({
      patterns: [{ what: "sign convention", observations: 9, lastObservedAt: at - 90 * DAY }],
    })) === null);

  // Time-of-day fences (teacher-arc.md §7 row 11).
  const nightly = initiativeVerdict(withReason({
    localMinuteOfDay: 2 * 60,
    commitments: [{ what: "problem set", dueAt: at - 10 * MIN, citedAt: at - DAY }],
  }));
  ok("a real reason at 2am is still refused (daytime only)", nightly === null);
  ok(`daytime window is ${DAYTIME_FROM_MIN}-${DAYTIME_TO_MIN}`, DAYTIME_FROM_MIN < DAYTIME_TO_MIN);
  ok("a real reason inside a stated study block is refused",
    initiativeVerdict(withReason({
      localMinuteOfDay: 17 * 60,
      quietWindows: [{ fromMin: 16 * 60, toMin: 19 * 60 }],
      commitments: [{ what: "problem set", dueAt: at - 10 * MIN, citedAt: at - DAY }],
    })) === null);

  // Determinism: the predicate is swept twice and must agree with itself.
  const twice = [promised, stated, pattern].every((v, i) => {
    const again = [
      () => initiativeVerdict(withReason({ commitments: [{ what: "rotational-inertia problem set", dueAt: at - 10 * MIN, citedAt: at - 2 * DAY }] })),
      () => initiativeVerdict(withReason({ statedTimes: [{ what: "mock test today, four o'clock", at: at + 2 * HOUR, citedAt: at - 20 * HOUR }] })),
      () => initiativeVerdict(withReason({ patterns: [{ what: "sign convention dropped under time pressure", observations: 4, lastObservedAt: at - 2 * DAY }] })),
    ][i]();
    return JSON.stringify(v) === JSON.stringify(again);
  });
  ok("the predicate is deterministic", twice);

  // The render, and its own refusals.
  const block = renderInitiative(promised);
  ok("T19 renders for a real verdict", block.length > 0);
  ok("T19 respects its budget", block.length <= INITIATIVE_BUDGET, String(block.length));
  ok("T19 renders nothing for null", renderInitiative(null) === "");
  ok("T19 refuses a verdict with no citation",
    renderInitiative({ mayInitiate: true, kind: "promised-followup", reason: "x", citedAt: 0 }) === "");
  const row = block.split("\n").slice(1).join(" ").replace(/^- /, "");
  ok("the rendered reason survives shapelint", lintLine(row).reasons.length === 0, row);

  // ── NC2: the citation requirement struck out. It must be seen firing on a
  // record that cites nothing.
  const uncitedOk = (rec) => {
    for (const c of rec.commitments) {
      // the defect: `if (!c.citedAt) continue;` removed
      if (rec.nowMs >= c.dueAt) return { mayInitiate: true, kind: "promised-followup", citedAt: c.citedAt };
    }
    return null;
  };
  const uncitedRec = withReason({ commitments: [{ what: "problem set", dueAt: at - MIN, citedAt: 0 }] });
  ok("NC2 the uncited predicate IS caught firing", Boolean(uncitedOk(uncitedRec)));
  ok("NC2 …and the real predicate refuses the identical record",
    initiativeVerdict(uncitedRec) === null);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§5 the seam is provably free for every incumbent (gate Q1)");
// ═════════════════════════════════════════════════════════════════════════
{
  const base = {
    user: { name: "Sam", vibe: ["company"], facts: {} },
    messageCount: 200,
    medium: "text",
    mode: "chat",
    voiceEngine: "none",
    isDirective: false,
    watching: false,
    innerThread: "",
    innerWants: "",
    memories: "",
    herLife: "",
    cultureNoteText: "",
    latestUserText: "kya kar rahi ho",
    nowMs: MON_1000,
  };
  const without = compile(base);
  const withNulls = compile({ ...base, cloneNow: null, initiative: null });
  ok("absent vs explicitly-null clone fields compile byte-identically",
    without.system === withNulls.system);
  ok("T18 renders zero bytes for the default agent", (without.sections?.T18 ?? -1) === 0);
  ok("T19 renders zero bytes for the default agent", (without.sections?.T19 ?? -1) === 0);
  ok("the default agent's tail carries no clone-life header",
    !without.tail.includes(CLONE_NOW_HEADER));
  ok("DEFAULT_AGENT is unchanged by this seam", DEFAULT_AGENT.slug === "meera");

  // Manifest hygiene: the rows exist, the arithmetic still closes, and neither
  // new row joined the undroppable set (which would move the undroppable
  // arithmetic for a block Meera can never carry).
  let arithOk = true;
  try { assertManifestArithmetic(); } catch (e) { arithOk = false; console.log(`        ${e.message}`); }
  ok("manifest arithmetic still closes", arithOk);
  const t18 = TAIL_MANIFEST.find((b) => b.id === "T18");
  const t19 = TAIL_MANIFEST.find((b) => b.id === "T19");
  ok("T18 and T19 are declared", Boolean(t18 && t19));
  ok("neither joined the undroppable set",
    t18?.dropPriority !== "never" && t19?.dropPriority !== "never");
  ok("T18/T19 sit in TAIL_ORDER where compile() puts them",
    TAIL_ORDER.indexOf("T18") > TAIL_ORDER.indexOf("T7") &&
    TAIL_ORDER.indexOf("T18") < TAIL_ORDER.indexOf("T12") &&
    TAIL_ORDER.indexOf("T19") > TAIL_ORDER.indexOf("T16") &&
    TAIL_ORDER.indexOf("T19") < TAIL_ORDER.indexOf("T10"));
  ok("T18's declared budget matches the renderer's own constant",
    t18?.budget === CLONE_NOW_BUDGET);
  ok("T19's declared budget matches the renderer's own constant",
    t19?.budget === INITIATIVE_BUDGET);

  // T10 is still pinned last even with both new blocks present.
  const clone = sheetToModule(DEMO_TEACHER);
  const loud = compile({
    ...base,
    agent: clone,
    cloneNow: cloneNowAt(LIFE, MON_1000),
    initiative: {
      mayInitiate: true,
      kind: "promised-followup",
      reason: "promised: rotational-inertia problem set",
      citedAt: MON_1000 - DAY,
    },
  });
  ok("with both clone blocks present, FORGET_DECISION is still the tail's suffix",
    loud.tail.endsWith(clone.FORGET_DECISION));
  ok("…and SEARCH_DECISION is still immediately before it",
    loud.tail.endsWith(clone.SEARCH_DECISION + clone.FORGET_DECISION));
  ok("the crisis lines survive a compile carrying both new blocks",
    loud.core.includes(DEMO_TEACHER.crisisLines.slice(0, 40)));

  // ── THE SEAM IS REAL, not merely declared (`dead-writers`) ──────────────
  //
  // A compiler slot with no producer anywhere is indistinguishable from a slot
  // that does not exist. The producer for a client lane is brain.ts's think(),
  // which before WS-Q passed NO `agent` at all — so a clone could only ever be
  // served by a lane that assembled none of the aliveness stack. Asserted over
  // the source because the alternative is driving think(), which needs a
  // model, a device and a network.
  const brain = readFileSync(join(ROOT, "src/engine/brain.ts"), "utf8");
  ok("brain.ts's compile() forwards the injected agent", /agent:\s*keys\.agent/.test(brain));
  ok("brain.ts's compile() forwards the clone's present", /cloneNow:\s*keys\.cloneNow/.test(brain));
  ok("brain.ts's compile() forwards the speak-first verdict", /initiative:\s*keys\.initiative/.test(brain));
}

console.log(`\n${fail ? "FAILED" : "PASSED"} — ${pass} ok, ${fail} failed`);
if (fail) process.exit(1);
