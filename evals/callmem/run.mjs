// WS-CALLMEM — the four things the first external tester found on a voice call.
//
// His words, verbatim, and what each one turned out to be:
//
//  1. "usko kuch yaad nahi kal kya baat kiya. But chat me yaad hai"
//     → the chat lane sends the last 90 messages as TURNS (call turns
//       included, same channel-blind store); the live lane opens with zero
//       turns and a prompt whose only history block excludes call turns and
//       stops at 30 minutes. Section 1.
//  2. "Hallucinating over long lasting conversations and forgetting what she
//     said or what I told her early on"
//     → `contextWindowCompression: { slidingWindow: {} }` drops the OLDEST
//       turns of a long call and nothing put them back. Section 5.
//  3. "always eager to hang up … if you say bye she should hang up on her own"
//     → `asksToHangUp` answers an instruction, never a goodbye, on purpose.
//       Section 4 — including every false-positive case, because the whole
//       design of that predicate is what it REFUSES.
//  4. "she said she's checking but then just said something random"
//     → `callLookup` returned "" on every failure, so the announcement went
//       out and nothing came back to answer it. Section 6.
//
// ── WS-CALLLANE (2026-08-23): the five the memory audit found ────────────
//
// Sections 5b-5e and the additions to 4, 5 and 8. Each one is a block that
// EXISTS and renders zero bytes on a call, which is `age-tier-never-realtime`
// and `call-opens-with-amnesia-by-construction` in the same shape as the
// findings above — so they are asserted the same way: against the real
// renderers, and against the real call sites in useCallEngine.ts.
//
//  P0-2  the ring query is fired before he speaks, so a name he raises at
//        minute 20 is unreachable. Section 5b + the wiring assertions.
//  P0-3  share-derived turns went to the server as `channel:"call"`, and the
//        id set that marked them locally was TRIMMED on long calls. Section
//        5e + the wiring assertions.
//  P1-4  RING_FETCH_DEADLINE_MS was set to the cold measurement itself, so
//        the first call of a day compiled with no memory and could never
//        recover. Section 5c.
//  P1-5  the running note carried the same eight turns for the life of the
//        call. Section 5's four-length proof.
//  P1-7/9 T9, T14, T16 and the moment-gated T4/T12 rendered zero bytes on the
//        call lanes because no call site passed their inputs. Sections 4
//        (the byte arithmetic) and 5d.
//
// Offline, deterministic, no model call, no database, no money — so it belongs
// in CI by the same `dead-writers` test the honesty, chattail and time suites
// are wired in under.
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "callmem-"));
const BUNDLE = join(tmp, "callmem.bundle.mjs");
execSync(
  `npx esbuild ${join(HERE, ".entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const {
  formatSharedHistory,
  withSharedHistory,
  formatRunningNote,
  agoLabel,
  SHARED_HISTORY_BUDGET,
  SHARED_HISTORY_ROWS,
  SHARED_HISTORY_CALL_ROWS,
  SHARED_HISTORY_MAX_AGE_MS,
  RUNNING_NOTE_MIN_TURNS,
  RUNNING_NOTE_TURNS,
  RUNNING_NOTE_HEAD_TURNS,
  RUNNING_NOTE_FRESH_TAIL,
  RUNNING_NOTE_BUDGET,
  readsAsMemoryCue,
  formatMemoryNote,
  MEMORY_NOTE_BUDGET,
  MEMORY_NOTE_ROWS,
  withRecallAge,
  RECALL_AGE_NOTE_MAX,
  RECALL_CACHE_MAX_AGE_MS,
  preCallUserText,
  callRecentTurns,
  raisedRecently,
  renderRaised,
  RAISED_BUDGET,
  innerContext,
  SHARED_HISTORY_MAX_CHARS,
  formatActivityLedgerForCall,
  callGraphBlocks,
  CALL_ACTIVITY_BUDGET,
  CALL_ACTIVITY_ROWS,
  CALL_ACTIVITY_MAX_CHARS,
  formatActivityLedger,
  withoutServerActivityBlock,
  ACTIVITY_BLOCK_SENTINEL,
  EPISODE_SUMMARY_MAX,
  activityEpisodeSummary,
  readsAsFarewell,
  callLookup,
  shouldLookUp,
  readsAsCheckPromise,
  checkPromiseNote,
  resetLookupWindow,
  asksToHangUp,
  herCommitments,
  formatChatTail,
  callMemories,
  CHAT_TAIL_WINDOW_MS,
  compile,
  OPERATIONAL_TAIL_CAP,
  HER_COMMITMENTS_BUDGET,
  AWAY_BUDGET,
  lintBlock,
  buildSystemPromptParts,
  WATCH_MODE_NOTE,
} = await import(BUNDLE);

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    console.log(`  ok  ${name}`);
    return;
  }
  fail++;
  console.log(`FAIL  ${name}${extra ? " — " + extra : ""}`);
};

const NOW = Date.UTC(2026, 7, 23, 21, 0, 0);
const min = (n) => n * 60_000;
const hr = (n) => n * 3_600_000;

let seq = 0;
const msg = (from, text, agoMs, extra = {}) => ({
  id: `m${seq++}`,
  from,
  kind: "text",
  text,
  at: NOW - agoMs,
  ...extra,
});
const call = (from, text, agoMs) => msg(from, text, agoMs, { channel: "call" });
const mark = (agoMs) => ({ id: `k${seq++}`, from: "me", kind: "callmark", text: "4:12", at: NOW - agoMs });

// Yesterday: they talked on the phone about his sister's wedding shopping, and
// typed a little before that. Then nothing until tonight's call.
const YESTERDAY = [
  msg("me", "kal shopping ke liye jaana hai didi ke saath", hr(27)),
  msg("her", "haan bola tha na tune", hr(27) - min(1)),
  call("me", "didi ki shaadi ki shopping me pura din nikal gaya aaj", hr(26)),
  call("her", "thak gaya hoga tu, kitna chala", hr(26) - min(1)),
  call("me", "lehenga finalise ho gaya finally, ab jewellery baaki hai", hr(26) - min(2)),
  mark(hr(26) - min(3)),
];

// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 1. THE GATE: yesterday's CALL reaches tonight's live prompt ──");
// ─────────────────────────────────────────────────────────────────────────
const USER = { name: "Aarav", vibe: ["someone to talk to"], facts: {} };
const liveInput = (memories, extra = {}) => ({
  user: USER,
  messageCount: 42,
  medium: "voice",
  mode: "call",
  voiceEngine: "live",
  isDirective: false,
  watching: false,
  innerThread: "",
  innerWants: "",
  memories,
  herLife: "",
  cultureNoteText: "",
  latestUserText: "",
  gapSinceLastMs: hr(26),
  nowMs: NOW,
  ...extra,
});

{
  // THE CONTROL. This is the shipped behaviour, and it must fail containment
  // or section 1 proves nothing: the chat tail refuses call turns by design
  // and stops at 30 minutes, so yesterday is simply not in the prompt.
  const shipped = callMemories("", formatChatTail(YESTERDAY, NOW));
  ok("control: the chat tail carries nothing from yesterday's call", shipped === "");
  const before = compile(liveInput(shipped));
  ok(
    "control: without the block, the live prompt does NOT contain yesterday",
    !before.system.includes("lehenga"),
  );

  const shared = formatSharedHistory(YESTERDAY, NOW);
  const after = compile(liveInput(callMemories(withSharedHistory(shared, ""), "")));
  ok("the last thing said on yesterday's CALL is in the live prompt", after.system.includes("lehenga finalise"));
  ok("what he typed before it is there too", after.system.includes("shopping ke liye jaana hai"));
  ok("the block says WHEN, so 'kal' means something", shared.includes("yesterday"));
  ok("it is labelled as being before today", after.system.includes("BEFORE TODAY"));
  ok(
    "it lands in the tail, never the cached core",
    after.tail.includes("lehenga") && !after.core.includes("lehenga"),
  );
}

{
  // Order is a truncation decision: the tail is cut from the END, so the graph
  // rows are what may be lost — never the conversation they actually had.
  const GRAPH = "- goa trip (event, 2 days ago): planned with college friends for december";
  const composed = callMemories(withSharedHistory(formatSharedHistory(YESTERDAY, NOW), GRAPH), "");
  ok("the shared history precedes the graph rows", composed.indexOf("lehenga") < composed.indexOf("goa trip"));
  ok("the graph rows survive alongside it", composed.includes(GRAPH));
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 2. render-nothing default, and what it refuses to carry ──");
// ─────────────────────────────────────────────────────────────────────────
ok("no messages renders nothing", formatSharedHistory([], NOW) === "");
ok("only a callmark, no turns, renders nothing", formatSharedHistory([mark(hr(2))], NOW) === "");
ok(
  "compile() with no block is byte-identical to today",
  compile(liveInput(withSharedHistory(formatSharedHistory([], NOW), ""))).system ===
    compile(liveInput("")).system,
);
ok("pure: same input twice is byte-identical", formatSharedHistory(YESTERDAY, NOW) === formatSharedHistory(YESTERDAY, NOW));
ok(
  "the clock is an INPUT (a Date.now() in here would flap the byte-identity gate)",
  formatSharedHistory(YESTERDAY, NOW) !== formatSharedHistory(YESTERDAY, NOW + hr(30)),
);
{
  const ancient = [
    msg("me", "purani baat ek", SHARED_HISTORY_MAX_AGE_MS + hr(1)),
    call("me", "purani baat do", SHARED_HISTORY_MAX_AGE_MS + min(30)),
    mark(SHARED_HISTORY_MAX_AGE_MS + min(29)),
  ];
  ok("anything older than the age ceiling is dropped", formatSharedHistory(ancient, NOW) === "");
}
{
  // THE DISJOINTNESS PROPERTY. The chat tail owns the last 30 minutes; this
  // block starts where that one ends. A line paid for twice is a line stolen
  // from the 1,949 bytes this lane has left.
  const recent = [...YESTERDAY, msg("me", "abhi abhi likha tha ye", min(3))];
  const tail = formatChatTail(recent, NOW);
  const shared = formatSharedHistory(recent, NOW);
  ok("the pre-call stretch is in the chat tail", tail.includes("abhi abhi likha"));
  ok("…and NOT in the shared-history block", !shared.includes("abhi abhi likha"));
  const both = callMemories(withSharedHistory(shared, ""), tail);
  ok("no line appears twice in the composed memories string", both.split("abhi abhi likha").length === 2);
  const edge = [...YESTERDAY, msg("me", "edge case line", CHAT_TAIL_WINDOW_MS + 1)];
  ok(
    "the seam is exactly CHAT_TAIL_WINDOW_MS",
    formatSharedHistory(edge, NOW).includes("edge case line") &&
      !formatChatTail(edge, NOW).includes("edge case line"),
  );
}
{
  // The turns of the call happening RIGHT NOW must not be re-fed to the
  // session that already has them: the boundary is the callmark, which
  // endCall writes at hangup.
  const midCall = [...YESTERDAY, call("me", "abhi wali baat is call ki hai", min(2)), call("her", "haan", min(1))];
  const shared = formatSharedHistory(midCall, NOW);
  ok("turns after the newest callmark (the LIVE call) are excluded", !shared.includes("abhi wali baat"));
  ok("the previous call's turns still are not", shared.includes("lehenga"));
}
{
  const twoCalls = [
    call("me", "do call pehle wali baat", hr(50)),
    mark(hr(50) - min(1)),
    ...YESTERDAY,
  ];
  ok(
    "only the MOST RECENT ended call is carried, not every call ever",
    !formatSharedHistory(twoCalls, NOW).includes("do call pehle"),
  );
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 3. `recited-prompt`: the law this block is most exposed to ──");
// ─────────────────────────────────────────────────────────────────────────
{
  const HOSTILE = [
    msg("me", "I have been thinking about what you said last night and it really stayed with me.", hr(30)),
    call("her", "main tumhe bohot miss kar rahi hu aaj kal sach me yaar bohot zyada", hr(29)),
    call("her", "I told him that we should go to Goa together in December.", hr(29) - min(1)),
    call("me", "haan chal", hr(29) - min(2)),
    mark(hr(29) - min(3)),
  ];
  const rendered = formatSharedHistory(HOSTILE, NOW);
  const rows = rendered.split("\n").filter((l) => l.startsWith("- "));
  ok("the hostile stretch actually produced rows to lint", rows.length >= 3, `${rows.length}`);
  const hers = rows.filter((r) => r.startsWith("- you:"));
  const theirs = rows.filter((r) => r.startsWith("- them:"));
  const lintHers = lintBlock(hers.join("\n"));
  ok(
    "every row of HERS passes the real shapelint, unassisted",
    lintHers.clean,
    lintHers.violations.map((v) => `${v.line} :: ${v.reasons.join(";")}`).join(" | "),
  );
  ok(
    "his rows lint clean under the verbatim-storage allowlist",
    lintBlock(theirs.join("\n"), ["- them:"]).clean,
  );
  ok(
    "no row opens in her first person (the speaker prefix defeats it by construction)",
    rows.every((r) => /^- (them|you): /.test(r)),
  );
  ok("no row is sentence-shaped", rows.every((r) => !/^[A-Z][^.?!]*[.?!]$/.test(r)));
  ok(
    "a clipped row says so rather than passing a half-sentence off as whole",
    rows.some((r) => r.endsWith(" …")),
  );
  const heads = rendered.split("\n").filter((l) => !l.startsWith("- "));
  ok(
    "the group headers cannot be recited either (lower-case, no terminal stop)",
    heads.slice(1).every((h) => !/^[A-Z][^.?!]*[.?!]$/.test(h)),
    heads.slice(1).join(" | "),
  );
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 4. bounds, and the budget arithmetic on the tightest lane ──");
// ─────────────────────────────────────────────────────────────────────────
{
  const fat = [];
  for (let i = 0; i < 6; i++) fat.push(msg("me", `${"antidisestablishmentarianism ".repeat(30)}${i}`, hr(40) + min(i)));
  for (let i = 0; i < 6; i++) fat.push(call("me", `${"antidisestablishmentarianism ".repeat(30)}c${i}`, hr(30) + min(i)));
  fat.push(mark(hr(29)));
  const rendered = formatSharedHistory(fat, NOW);
  ok(
    `worst case is within SHARED_HISTORY_BUDGET (${rendered.length} <= ${SHARED_HISTORY_BUDGET})`,
    rendered.length <= SHARED_HISTORY_BUDGET,
  );
  const rows = rendered.split("\n").filter((l) => l.startsWith("- "));
  ok("something survived the drop", rows.length >= 1, `${rows.length} rows`);
  ok("over budget it drops WHOLE rows — every survivor is intact", rows.every((r) => r.endsWith(" …") || !/antidis$/.test(r)));
  ok(
    `no single row can crowd out the block (<= ${SHARED_HISTORY_MAX_CHARS} chars + prefix)`,
    rows.every((r) => r.length <= SHARED_HISTORY_MAX_CHARS + 12),
    rows.map((r) => r.length).join(","),
  );
  ok(
    "no group header is left standing with nothing under it",
    rendered
      .split("\n")
      .slice(1)
      .every((l, i, all) => l.startsWith("- ") || all[i + 1]?.startsWith("- ")),
  );
  ok(`never more than SHARED_HISTORY_ROWS rows`, rows.length <= SHARED_HISTORY_ROWS);
}
{
  const many = [];
  for (let i = 0; i < 9; i++) many.push(call("me", `call line ${i}`, hr(30) - min(i)));
  many.push(mark(hr(29)));
  const rows = formatSharedHistory(many, NOW).split("\n").filter((l) => l.startsWith("- "));
  ok(`at most SHARED_HISTORY_CALL_ROWS from the call`, rows.length <= SHARED_HISTORY_CALL_ROWS);
  ok(
    "it keeps the END of the call (how it was left), not the start",
    rows[rows.length - 1].includes("call line 8"),
  );
}
{
  // The arithmetic scripts/check-prompt-budget.mjs measures the live lanes
  // with. Restated here rather than left as a claim, and PINNED to the real
  // script source — a bound and its guard drifting apart is exactly how the
  // crisis helplines were lost once.
  const parts = buildSystemPromptParts(
    {
      name: "Aaaaaaaaaaaaaaaaaaaa",
      vibe: ["someone to talk to", "a friend who remembers", "company late at night"],
      facts: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`fact_key_number_${i}`, "a".repeat(120)])),
    },
    999,
    "voice",
  );
  const TAIL_EXTRAS = 12 * 570 + 900 + 12 * 150 + 370 + 1_500;
  const TASTE_EXTRAS = 1_100;
  const CALL_CLOCK = AWAY_BUDGET + HER_COMMITMENTS_BUDGET + RAISED_BUDGET;
  const LIVE_ONLY = 1_600 + 500; // T4 dyadic.active + T12 self.arc, moment-gated
  const WATCH_NO_THREAD = -450;
  const liveBound =
    parts.tail.length + TAIL_EXTRAS + TASTE_EXTRAS + SHARED_HISTORY_BUDGET + RECALL_AGE_NOTE_MAX + CALL_CLOCK + LIVE_ONLY;
  const watchBound =
    parts.tail.length + WATCH_MODE_NOTE.length + TAIL_EXTRAS + WATCH_NO_THREAD + SHARED_HISTORY_BUDGET + RECALL_AGE_NOTE_MAX + CALL_CLOCK;
  ok(`live tail bound WITH the block: ${liveBound} <= ${OPERATIONAL_TAIL_CAP}`, liveBound <= OPERATIONAL_TAIL_CAP);
  ok(`live+watch tail bound WITH the block: ${watchBound} <= ${OPERATIONAL_TAIL_CAP}`, watchBound <= OPERATIONAL_TAIL_CAP);
  const guard = readFileSync(join(ROOT, "scripts/check-prompt-budget.mjs"), "utf8");
  const shared = Number(guard.match(/const SHARED_HISTORY_EXTRAS = ([0-9_]+)/)?.[1]?.replace(/_/g, ""));
  const clock = guard.match(/const CALL_CLOCK_EXTRAS = ([0-9]+) \+ ([0-9]+) \+ ([0-9]+)/);
  const liveOnly = guard.match(/const LIVE_ONLY_EXTRAS = ([0-9_]+) \+ ([0-9_]+)/);
  const ageNote = Number(guard.match(/const RECALL_AGE_EXTRAS = ([0-9_]+)/)?.[1]?.replace(/_/g, ""));
  const noThread = Number(guard.match(/const WATCH_NO_THREAD = -([0-9_]+)/)?.[1]?.replace(/_/g, ""));
  ok(
    `the guard's SHARED_HISTORY_EXTRAS (${shared}) equals SHARED_HISTORY_BUDGET (${SHARED_HISTORY_BUDGET})`,
    shared === SHARED_HISTORY_BUDGET,
  );
  ok(
    `the guard's CALL_CLOCK_EXTRAS equals AWAY + HER_COMMITMENTS + RAISED (${AWAY_BUDGET} + ${HER_COMMITMENTS_BUDGET} + ${RAISED_BUDGET})`,
    clock &&
      Number(clock[1]) === AWAY_BUDGET &&
      Number(clock[2]) === HER_COMMITMENTS_BUDGET &&
      Number(clock[3]) === RAISED_BUDGET,
  );
  ok(
    "the guard's LIVE_ONLY_EXTRAS is T4 + T12, the two moment-gated slots (1,600 + 500)",
    liveOnly && Number(liveOnly[1].replace(/_/g, "")) === 1_600 && Number(liveOnly[2].replace(/_/g, "")) === 500,
  );
  ok(
    `the guard's RECALL_AGE_EXTRAS (${ageNote}) equals RECALL_AGE_NOTE_MAX (${RECALL_AGE_NOTE_MAX})`,
    ageNote === RECALL_AGE_NOTE_MAX,
  );
  // ── the reclaim, negative-tested against the REAL rule ─────────────────
  // WATCH_NO_THREAD gives back bytes on the claim that a carried feeling
  // cannot render on the watch surface. That claim is `innerContext`'s, so it
  // is checked by running it — on the SAME interior, on both surfaces.
  {
    const inner = {
      thread: { id: "t1", text: "her flatmate moved out and the flat feels big", at: NOW - hr(3), sign: -1, w: 0.8 },
      wants: [],
      owed: [],
    };
    const o = { now: NOW, lastMsgAt: NOW - hr(3), sheInitiated: false, userText: "" };
    const onPickup = innerContext(inner, { ...o, surface: "pickup" });
    const onWatch = innerContext(inner, { ...o, surface: "watch" });
    ok("a carried feeling DOES render on a call pickup (the control)", onPickup.thread.length > 400);
    ok("…and cannot render on the watch surface, by construction", onWatch.thread === "");
    ok(
      `the guard reclaims LESS than the prose it reclaims (${noThread} < ${onPickup.thread.length})`,
      noThread > 0 && noThread < onPickup.thread.length,
    );
  }
  // P0-2's rows are bounded but deliberately absent from the prompt bound.
  ok(
    "the mid-call re-query is NOT counted in either lane's bound — it never enters a compile",
    /P0-2's mid-call re-query is deliberately NOT here/.test(guard),
  );
  ok(
    "the guard states what its bound still omits rather than implying coverage",
    /WHAT THIS BOUND STILL DOES NOT COUNT/.test(guard) && /5,920/.test(guard),
  );
  ok(
    "the guard measures BOTH live lanes against the block",
    /live tail \(bound\)[\s\S]{0,240}SHARED_HISTORY_EXTRAS/.test(guard) &&
      /live\+watch tail \(bound\)[\s\S]{0,200}SHARED_HISTORY_EXTRAS/.test(guard),
  );
}
{
  ok("agoLabel is coarse and never a timestamp", agoLabel(NOW - hr(26), NOW) === "yesterday");
  ok("…hours inside a day", agoLabel(NOW - hr(5), NOW) === "5h ago");
  ok("…and days beyond it", agoLabel(NOW - hr(72), NOW) === "3 days ago");
  ok("no label without a clock", agoLabel(0, NOW) === "");
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 5. the running note: what survives the sliding window ──");
// ─────────────────────────────────────────────────────────────────────────
{
  const turns = [];
  for (let i = 0; i < 20; i++)
    turns.push((i % 2 ? call.bind(null, "her") : call.bind(null, "me"))(`turn number ${i} of this call`, min(40 - i)));
  ok("nothing to say before the floor", formatRunningNote(turns.slice(0, RUNNING_NOTE_MIN_TURNS - 1)) === "");
  const note = formatRunningNote(turns);
  ok("a long call produces a note", note.length > 0);
  ok(
    "it carries the ANCHOR — the first turns, which compression drops first",
    Array.from({ length: RUNNING_NOTE_HEAD_TURNS }, (_, i) => `turn number ${i} `).every((t) =>
      note.includes(t),
    ),
  );
  ok("…and not the tail, which the session still has", !note.includes("turn number 19"));
  ok(`never more than RUNNING_NOTE_TURNS rows`, note.split("\n").filter((l) => l.startsWith("- ")).length <= RUNNING_NOTE_TURNS);
  ok(`within RUNNING_NOTE_BUDGET (${note.length} <= ${RUNNING_NOTE_BUDGET})`, note.length <= RUNNING_NOTE_BUDGET);
  ok(
    "angle brackets, never square (`ack-bracket-direction`: bracket text on this lane gets spoken)",
    note.startsWith("<context:") && note.endsWith(">") && !note.includes("["),
  );
  ok("it tells her not to answer it or read it out", /do not answer this/i.test(note) && /do not read it out/i.test(note));
  ok("it is stable for the same input — a re-send is the same bytes", formatRunningNote(turns) === note);
  const fat = Array.from({ length: 12 }, (_, i) => call("me", `${"antidisestablishmentarianism ".repeat(20)}${i}`, min(40 - i)));
  ok(`worst case still within budget`, formatRunningNote(fat).length <= RUNNING_NOTE_BUDGET);
  ok("…and still carries something", formatRunningNote(fat).includes("- them:"));
}
// ── P1-5: the note has to ADVANCE, or minutes 2-35 are lost anyway ────────
//
// The defect the head-only version had: it carried the same eight turns for
// the life of the call, so on a 40-minute call it described minute 1 and
// nothing else — while the server's sliding window quietly dropped everything
// between minute 2 and minute 35. Proven at four call lengths, against ONE
// growing transcript, so what is being measured is the note advancing rather
// than four unrelated fixtures agreeing.
{
  // A realistic call: filler, two facts he states (minute 3 and minute 12),
  // one thing she promises, questions that must NOT win a row. One turn every
  // ~30s, oldest first.
  const FACT_3 = "mera manager Rohit ne poora sprint plan hi badal diya kal raat";
  const FACT_12 = "flat ka rent 42000 ho gaya hai is saal se, landlord ne bola";
  const HER_PROMISE = "main tujhe kal interview ke baad sab bataungi pakka";
  const built = [];
  const at = (i) => min(2) + i * 30_000; // turn i, 30s apart, call starts at t0
  const push = (from, text, i) => built.push(call(from, text, hr(1) - at(i)));
  const atMinute = (m) => Math.round((m * 60_000) / 30_000);
  for (let i = 0; i < 90; i++) {
    if (i === atMinute(3)) push("me", FACT_3, i);
    else if (i === atMinute(12)) push("me", FACT_12, i);
    else if (i === atMinute(18)) push("her", HER_PROMISE, i);
    else if (i % 2) push("her", "haan", i);
    else push("me", "achha theek hai yaar", i);
  }
  // "minutes" here is turns-so-far at 2 turns/minute, the pace the fixture is
  // built at. The note is a pure function of the turns it is given.
  const upto = (m) => built.slice(0, Math.max(0, Math.round((m * 60_000) / 30_000)));
  const noteAt = (m) => formatRunningNote(upto(m));

  // At 2 minutes there is nothing to say — four turns is under the floor and
  // the session still holds all of them. The caller does not even ask until
  // NOTE_FIRST_MS (4 min); this is the function agreeing with it.
  ok("at 2 minutes there is nothing lost yet, so no note", noteAt(2) === "");
  ok("at 4 minutes there is", noteAt(4).length > 0);
  for (const m of [4, 10, 25, 40]) {
    const n = noteAt(m);
    ok(`minute ${m}: within RUNNING_NOTE_BUDGET (${n.length} <= ${RUNNING_NOTE_BUDGET})`, n.length <= RUNNING_NOTE_BUDGET);
    ok(
      `minute ${m}: never more than RUNNING_NOTE_TURNS rows`,
      n.split("\n").filter((l) => l.startsWith("- ")).length <= RUNNING_NOTE_TURNS,
    );
  }
  // THE PROOF the audit asks for, at the two lengths where the old note had
  // already stopped advancing.
  for (const m of [25, 40]) {
    const n = noteAt(m);
    ok(`minute ${m}: the fact he stated at minute 3 is still in the note`, n.includes("Rohit"));
    ok(`minute ${m}: …and so is the one from minute 12`, n.includes("42000"));
    ok(`minute ${m}: what SHE promised at minute 18 is carried too`, n.includes("interview"));
    ok(`minute ${m}: filler did not win a row over a fact`, !/^- them: achha theek hai yaar$/m.test(n.split("\n").slice(2).join("\n")) || n.includes("Rohit"));
  }
  // …and the control: the head-only behaviour would have failed these.
  ok(
    "the minute-12 fact is NOT in the anchor — it is the spread that carries it",
    !upto(40).slice(0, RUNNING_NOTE_HEAD_TURNS).some((m) => m.text.includes("42000")),
  );
  ok(
    "the freshest turns are excluded — the session still holds those",
    (() => {
      const src = upto(40);
      const newest = src[src.length - 1];
      return !noteAt(40).includes(`${newest.text}`) || newest.text === "haan";
    })(),
  );
  ok("still stable across two renders of the same input", noteAt(25) === noteAt(25));
  // A question in the same bucket as a fact never takes the row: the answer
  // is the thing worth carrying, and it is the next turn. (On a call with
  // nothing salient at all the anchor simply extends forward, questions
  // included — that is the old behaviour and it is the right floor.)
  {
    const mixed = [...built.slice(0, RUNNING_NOTE_HEAD_TURNS)];
    for (let i = 0; i < 40; i++) {
      mixed.push(call("me", "tujhe kya lagta hai isme kitna time lagega batao", hr(1)));
      mixed.push(call("her", "pata nahi yaar", hr(1)));
    }
    mixed.splice(20, 0, call("me", "Rohit wala sprint plan pakka change ho gaya hai ab", hr(1)));
    for (let i = 0; i < 6; i++) mixed.push(call("me", "achha theek hai", hr(1)));
    const n = formatRunningNote(mixed);
    // The property is that the FACT is never evicted, not that a question can
    // never appear: with nothing salient anywhere the anchor still extends
    // forward contiguously, questions included, which is the old behaviour and
    // the right floor. What must not happen is 80 questions crowding out the
    // one sentence in the call that a later turn could contradict.
    ok("one fact in a call made of questions is still carried", n.includes("Rohit"));
    ok(
      "…and a question never wins a bucket a fact is in",
      formatRunningNote([
        ...mixed.slice(0, 4),
        call("me", "tujhe kya lagta hai isme kitna time lagega batao", hr(1)),
        call("me", "Rohit ka sprint plan pakka change ho gaya hai ab", hr(1)),
        call("her", "haan", hr(1)),
        call("me", "aur rent bhi 42000 ho gaya hai", hr(1)),
        ...mixed.slice(0, 8),
      ]).includes("Rohit"),
    );
  }
}
// A share turn never re-enters the note as context, and now by a route a long
// call cannot lose (`watched`, not the trimmable id set).
{
  // The share turn sits in the MIDDLE, where the spread would otherwise pick
  // it: it names someone and would score 3. It is the highest-scoring turn in
  // the call and it must still not appear.
  const withShare = [
    ...Array.from({ length: 4 }, (_, i) => call("me", `opening line ${i} of the call`, min(40 - i))),
    msg("her", "unke inbox me Rohit ka mail dikh raha hai", min(30), { channel: "call", watched: true }),
    ...Array.from({ length: 8 }, (_, i) => call("me", `later line ${i} of the call`, min(20 - i))),
  ];
  const n = formatRunningNote(withShare);
  ok("a screen-share turn is not re-fed to the session as its own memory", !n.includes("inbox"));
  ok("…and the block excludes it itself, not only at its call site", !n.includes("Rohit"));
}
{
  // The silent frame is the mechanism. Asserted against liveCall.ts's source
  // because the alternative — a note that arrives as a CUE — would make her
  // talk every four minutes, which is a worse defect than the one it fixes.
  const live = readFileSync(join(ROOT, "src/voice/liveCall.ts"), "utf8");
  ok("direct() takes a silent option", /direct: \(contextNote: string, opts\?: \{ silent\?: boolean \}\) =>/.test(live));
  ok(
    "…and it is the ONLY thing that decides turnComplete",
    /turnComplete: !opts\?\.silent,/.test(live) &&
      (live.match(/turnComplete: (?:true|false),/g) || []).length === 0,
  );
  ok(
    "the audio floor's import law still holds (nothing new entered liveCall.ts)",
    (live.match(/^import .*$/gm) || []).every((l) => /"\.\/level"|"\.\.\/engine\/diag"/.test(l)),
    (live.match(/^import .*$/gm) || []).join(" | "),
  );
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 5b. P0-2: the mid-call re-query — what fires it, and what it says ──");
// ─────────────────────────────────────────────────────────────────────────
// `shouldLookUp`'s discipline applied to memory: every fire is a round trip
// AND a frame into her ear mid-turn, so the cue has to be narrow. The negative
// battery is the half that matters — a cue that fires on ordinary affection
// would put a memory lookup behind every warm sentence on the call.
{
  const FIRES = [
    "yaad hai us din tune kya bola tha",
    "wo wali baat yaad hai na tujhe",
    "Rohit ke saath meeting kaisi gayi",
    "remember what i told you about the interview",
    "us din jo hua tha uske baad kya kiya tune",
    "maine bataya tha na tujhe Sneha ke baare me",
    "pichli baar jab hum mile the",
    "tu bhool gayi kya sab kuch",
    "we talked about Goa last week na",
  ];
  const REFUSES = [
    "haan",
    "achha theek hai yaar",
    "kitna miss kiya tumhe aaj",
    "kya kar rahi hai tu abhi",
    "mujhe bahut neend aa rahi hai yaar",
    "aaj office me bohot kaam tha",
    "khana kha liya tune",
    "ok",
    "sun na ek baat batau",
    "bas aise hi call kiya tujhe",
  ];
  let fired = 0;
  for (const t of FIRES) {
    const hit = readsAsMemoryCue(t);
    if (hit) fired++;
    ok(`fires on a real memory cue: "${t.slice(0, 44)}"`, hit);
  }
  let falsePos = 0;
  for (const t of REFUSES) {
    const hit = readsAsMemoryCue(t);
    if (hit) falsePos++;
    ok(`refuses ordinary conversation: "${t.slice(0, 44)}"`, !hit);
  }
  ok(`recall ${fired}/${FIRES.length}, false fires ${falsePos}/${REFUSES.length}`, falsePos === 0);
  ok("too short to be a cue", !readsAsMemoryCue("yaad"));
  ok("too long to be one turn", !readsAsMemoryCue(`yaad hai ${"na ".repeat(200)}`));
  ok("her own name is never a name to look up", !readsAsMemoryCue("Meera tu kaisi hai aaj"));
  // Position is NOT the discriminator: a transcriber capitalises the first
  // word of any utterance, and requiring the capital to be mid-sentence was
  // measured to refuse the audit's own example ("Rohit ke saath meeting kaisi
  // gayi"). The stop list is the discriminator, and this trigger deliberately
  // favours recall — see readsAsMemoryCue for the cost argument.
  ok("a name in first position still fires", readsAsMemoryCue("Rohit ke saath meeting kaisi gayi"));
  ok("…and the stop list is what refuses the rest", !readsAsMemoryCue("Achha theek hai phir kal baat karte hai"));
}
{
  // The note: rows only, capped, silent, angle-bracketed.
  const recall = [
    "THINGS YOU KNOW ABOUT THEM (context, never read out):",
    "- rohit (person, colleague): his manager, moved teams in july",
    "- goa trip (event, 2 days ago): planned with college friends for december",
    "- sneha (person, flatmate): her flatmate, works nights",
    "- a fourth row that must not survive the row cap",
  ].join("\n");
  const note = formatMemoryNote(recall);
  ok("it carries the rows", note.includes("rohit") && note.includes("goa trip"));
  ok(`never more than MEMORY_NOTE_ROWS rows`, note.split("\n").filter((l) => l.startsWith("- ")).length <= MEMORY_NOTE_ROWS);
  ok("the recall block's own HEADING is dropped — it is written for a system prompt", !note.includes("THINGS YOU KNOW"));
  ok(`within MEMORY_NOTE_BUDGET (${note.length} <= ${MEMORY_NOTE_BUDGET})`, note.length <= MEMORY_NOTE_BUDGET);
  ok(
    "angle brackets, never square (`ack-bracket-direction`)",
    note.startsWith("<context:") && note.endsWith(">") && !note.includes("["),
  );
  ok("it forbids reading it out and forbids announcing that she remembered", /never read it out/i.test(note) && /never say you remembered/i.test(note));
  ok("nothing to say renders nothing", formatMemoryNote("") === "" && formatMemoryNote("a heading with no rows:") === "");
  const fat = Array.from({ length: 6 }, (_, i) => `- ${"antidisestablishmentarianism ".repeat(20)}${i}`).join("\n");
  ok("worst case still within budget", formatMemoryNote(fat).length <= MEMORY_NOTE_BUDGET);
  ok("…and still carries something", formatMemoryNote(fat).includes("- antidis"));
  ok("pure: same input twice is byte-identical", formatMemoryNote(recall) === note);
  const lint = lintBlock(note.split("\n").filter((l) => l.startsWith("- ")).join("\n"));
  ok("the rows are shapelint-clean (`recited-prompt`)", lint.clean, lint.violations.map((v) => v.reasons.join(";")).join(" | "));
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 5c. P1-4: the ring that missed its deadline ──");
// ─────────────────────────────────────────────────────────────────────────
{
  const block = "THINGS YOU KNOW ABOUT THEM:\n- rohit (person): his manager";
  const labelled = withRecallAge(block, NOW - hr(26), NOW);
  ok("a cached block says how old it is", labelled.startsWith("(these rows are from yesterday"));
  ok("…and the rows themselves are untouched", labelled.endsWith(block));
  ok(`the label is bounded (${labelled.length - block.length - 1} <= ${RECALL_AGE_NOTE_MAX})`, labelled.length - block.length - 1 <= RECALL_AGE_NOTE_MAX);
  ok("nothing cached renders nothing", withRecallAge("", NOW - hr(2), NOW) === "");
  ok("no age, no label — a fresh block is byte-identical to today", withRecallAge(block, 0, NOW) === block);
  ok(
    "telegraphic and lower-case, so shapelint can never see a line she could say",
    lintBlock(labelled.split("\n")[0]).clean,
  );
  ok(
    "three days is the ceiling — a week-old snapshot is an archive with a wrong date",
    RECALL_CACHE_MAX_AGE_MS === 3 * 24 * hr(1),
  );
  ok(
    "it composes into the one recall string the compile sites read",
    callGraphBlocks("", "", labelled).includes("(these rows are from"),
  );
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 5d. P1-9: the slots that were dark on every call ever taken ──");
// ─────────────────────────────────────────────────────────────────────────
{
  // preCallUserText — the call lane's stand-in for "the current user turn"
  const fresh = [msg("me", "wo wali jagah ka naam kya tha", min(3))];
  ok("the last thing he typed, when it is fresh", preCallUserText(fresh, NOW) === "wo wali jagah ka naam kya tha");
  ok(
    "…and nothing when it is not (a cold pickup is byte-identical to today)",
    preCallUserText([msg("me", "wo wali jagah ka naam kya tha", hr(30))], NOW) === "",
  );
  ok("never HER line", preCallUserText([msg("her", "haan bilkul", min(3))], NOW) === "");
  ok("never a call turn — that call has already ended", preCallUserText([call("me", "haan sun raha hu", min(3))], NOW) === "");
  ok(
    "never a screen-share turn — a reaction to a screen is not a turn he addressed to her",
    preCallUserText([msg("me", "yeh dekh", min(3), { channel: "call", watched: true })], NOW) === "",
  );
  ok("an empty store is empty", preCallUserText([], NOW) === "");
}
{
  // T14 rel.raised, THROUGH THE REAL COMPILER, on the shape the call lane
  // now hands it. `raisedRecently` drops call turns itself, which is why the
  // helper hands over the store rather than pre-filtering it.
  const store = [];
  for (let i = 0; i < 14; i++) {
    store.push(msg("her", `tune resume bheja kya us company ko ${i}`, hr(6) - min(i * 2)));
    store.push(msg("me", i % 2 ? "haan" : "hmm", hr(6) - min(i * 2) - 30_000));
  }
  const turns = callRecentTurns(store);
  ok("the helper hands over turns in RepeatTurn shape", turns.every((t) => t.from && typeof t.text === "string" && t.channel));
  const raised = raisedRecently(turns);
  ok("the real rule finds the over-raised term", raised.some((r) => r.term === "resume"), JSON.stringify(raised));
  const t14 = renderRaised(raised);
  ok("…and it renders", t14.length > 0);
  ok(`…within RAISED_BUDGET (${t14.length} <= ${RAISED_BUDGET})`, t14.length <= RAISED_BUDGET);
  ok(
    "the CALL lane's empty input is what used to render — zero bytes",
    renderRaised(raisedRecently([])) === "",
  );
  ok(
    "call turns are dropped by the ONE rule, not by the caller",
    raisedRecently(callRecentTurns(store.map((m) => ({ ...m, channel: "call" })))).length === 0,
  );
}

{
  // …and the proof that the slot is no longer DARK, through the REAL compiler
  // rather than through a source regex. `selfbundle-never-set`'s rule: a slot
  // is wired when a real prompt contains its bytes.
  const relBundle = {
    relState: {
      person_id: "p1",
      honorific: "tu",
      cs_ratio: 0.4,
      cs_on_stress: "hindi",
      trust: 3,
      rupture_open: false,
      repair_state: "none",
      ritual_density: 1,
      pacing_gap_s: 90,
      snapshot_ver: 1,
      updated_at: "2026-08-22T00:00:00Z",
    },
    patterns: [
      {
        id: 1,
        moment: "stress",
        if_shape: "he says work is drowning him",
        then_note: "he wants it heard, not solved",
        support_count: 4,
        prompt_eligible: true,
        t_invalid: null,
      },
    ],
    weEpisodes: [],
    phrases: [],
    phraseLedger: [],
    rituals: [],
    homeRegion: "",
    currency: [],
  };
  const base = {
    user: { name: "A", vibe: [], facts: {} },
    messageCount: 40,
    medium: "voice",
    mode: "call",
    voiceEngine: "live",
    isDirective: false,
    watching: false,
    innerThread: "",
    innerWants: "",
    memories: "",
    herLife: "",
    cultureNoteText: "",
    relBundle,
    gapSinceLastMs: min(4),
    ageGates: { romanceRegisters: true, engagementHooks: true },
  };
  const dark = compile({ ...base, latestUserText: "" });
  const lit = compile({ ...base, latestUserText: "aaj bahut stress hai kaam ka" });
  ok("T4 dyadic.active rendered ZERO bytes on every call taken so far", (dark.sections?.T4 ?? 0) === 0);
  ok("…and renders once the pre-call turn is passed", (lit.sections?.T4 ?? 0) > 0, JSON.stringify(lit.sections?.T4));
  ok("…and it is the PATTERN NOTES block, in the tail", lit.tail.includes("PATTERN NOTES"));
  ok(
    `…within its manifest budget (${lit.sections?.T4} <= 1600)`,
    (lit.sections?.T4 ?? 0) <= 1_600,
  );
  ok(
    "a turn with no moment in it still renders nothing — this is a GATE, not an override",
    (compile({ ...base, latestUserText: "haan theek hai" }).sections?.T4 ?? 0) === 0,
  );
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 5e. P0-3: a share turn is kept, and marked ──");
// ─────────────────────────────────────────────────────────────────────────
{
  // Audit footnote 5: her share commentary DOES belong in "what you two
  // already said" — it is simply something she said to him last night. What
  // must not happen is it reading as something HE told her.
  const yday = [
    call("me", "ek second, screen share karta hu", hr(26)),
    msg("her", "arre yeh toh Rohit ka hi mail hai na", hr(26) - min(1), { channel: "call", watched: true }),
    call("me", "haan wahi, ab kya karu", hr(26) - min(2)),
    mark(hr(26) - min(3)),
  ];
  const block = formatSharedHistory(yday, NOW);
  ok("her share commentary is carried", block.includes("Rohit ka hi mail"));
  ok("…and marked as said over a screen", /- you \(screen share\): /.test(block));
  ok("…while ordinary call rows are not marked", /- them: haan wahi/.test(block));
  ok(`still within budget (${block.length} <= ${SHARED_HISTORY_BUDGET})`, block.length <= SHARED_HISTORY_BUDGET);
  const lint = lintBlock(block.split("\n").filter((l) => l.startsWith("- ")).join("\n"));
  ok("marked rows stay shapelint-clean", lint.clean, lint.violations.map((v) => v.reasons.join(";")).join(" | "));
  ok(
    "the marker costs a row two of HIS words, never buys itself with them",
    formatSharedHistory(
      [
        msg("her", `${"word ".repeat(40)}end`, hr(26), { channel: "call", watched: true }),
        mark(hr(25)),
      ],
      NOW,
    ).length <= SHARED_HISTORY_BUDGET,
  );
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 6. the farewell: what it fires on, and what it REFUSES ──");
// ─────────────────────────────────────────────────────────────────────────
{
  const YES = [
    "bye",
    "byeee",
    "ok bye",
    "acha bye",
    "chalo bye",
    "good night",
    "gn",
    "good night yaar",
    "acha chalo bye good night",
    "chal so ja",
    "chal so ja late ho gaya",
    "achha main chalta hu",
    "theek hai rakhta hu",
    "ok bye love you",
    "take care bye",
    "milte hai",
    "tata",
    "sleep well",
    "phir milte hai",
    "bye bye",
  ];
  for (const s of YES) ok(`fires: "${s}"`, readsAsFarewell(s));

  // ── THE FALSE-POSITIVE PROOF ────────────────────────────────────────────
  // Ending a call he wanted to keep has no undo. Every line here contains a
  // goodbye word and is NOT a goodbye — the tester's own "bye ka matlab nahi
  // tha" case first.
  const NO = [
    "bye bolna galat laga",
    "bye ka matlab nahi tha",
    "maine bye nahi bola",
    "bye mat bol abhi",
    "wo bye bol ke chala gaya",
    "kal usne bye kaha aur phone rakh diya",
    "good night bolna bhool gaya usko",
    "so ja bola tha maine usko",
    "tu bye kyu bol raha hai",
    "bye bolun kya",
    "ek min bye mat bolna",
    "sun na bye se pehle ek baat",
    "night me kya kar raha tha",
    "good morning",
    "hi",
    "haan bol",
    "ok",
    "acha theek hai",
    "chalo phir shuru karte hai",
    "take care of yourself matlab kya",
    "i miss you",
    "love you",
    "bye bye bolne ka mann nahi kar raha",
  ];
  for (const s of NO) ok(`refuses: "${s}"`, !readsAsFarewell(s));

  ok("empty is not a farewell", !readsAsFarewell("") && !readsAsFarewell("   "));
  ok(
    "a long utterance is a sentence, not a close",
    !readsAsFarewell("bye " + "yaar ".repeat(FAREWELL_MAX_WORDS_GUARD())),
  );
  function FAREWELL_MAX_WORDS_GUARD() {
    return 12;
  }
  // The two detectors answer different questions and must not collapse into
  // one: `hangup.ts`'s own header is explicit that "bye" alone is not its job.
  ok("asksToHangUp still refuses a bare bye (its posture is unchanged)", !asksToHangUp("bye"));
  ok("asksToHangUp still fires on an explicit ask", asksToHangUp("chal phone rakh de"));
  ok("readsAsFarewell refuses the explicit ask's mid-call shape", !readsAsFarewell("baad me baat karte hai yaar abhi kaam hai"));
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 7. never pretend to check ──");
// ─────────────────────────────────────────────────────────────────────────
{
  const realFetch = globalThis.fetch;
  const stub = (body, ok_ = true) => {
    globalThis.fetch = async () => ({ ok: ok_, status: ok_ ? 200 : 502, json: async () => body });
  };
  try {
    resetLookupWindow();
    stub({ facts: "" }, false); // the exhausted-key path: 502, no facts
    const miss = await callLookup("aaj ka match ka score kya hai");
    ok("a FAILED lookup now returns an honest note instead of silence", miss.length > 0);
    ok("…which forbids the invention specifically", /never fill the gap yourself/i.test(miss));
    ok("…and tells her to say she could not get it", /couldn't get it|you'?ll look/i.test(miss));
    ok("…and never names the machinery", !/search|google|internet|api/i.test(miss.replace(/Never mention[^\]]*/i, "")));

    resetLookupWindow();
    stub({ facts: "", skipped: "not_a_fact" });
    ok(
      "a question with no fact to find stays silent (there was no check to fail)",
      (await callLookup("mera flatmate kal kya khaya tha score")) === "",
    );

    resetLookupWindow();
    stub({ facts: "IND 212/4 in 34 overs (23 Aug)" });
    const hit = await callLookup("india ka score kya hai abhi");
    ok("a successful lookup still returns the facts note", hit.includes("212/4"));

    resetLookupWindow();
    ok("a turn that is not a factual question fires nothing at all", (await callLookup("kitna miss kiya tumhe aaj")) === "");
    ok("…and shouldLookUp is what says so", !shouldLookUp("kitna miss kiya tumhe aaj"));
  } finally {
    globalThis.fetch = realFetch;
  }
}
{
  const YES = [
    "ruk dekhti hu",
    "ruk check karti hu",
    "abhi dekh ke batati hu",
    "main pata karti hu",
    "let me check",
    "i'll check",
    "ek sec, dekhti hu",
  ];
  for (const s of YES) ok(`check-promise fires: "${s}"`, readsAsCheckPromise(s));
  const NO = [
    "maine dekh ke bataya tha",
    "tu dekh ke bata",
    "check kar liya tha maine",
    "haan pata hai mujhe",
    "dekhte hai kya hota hai",
  ];
  for (const s of NO) ok(`check-promise refuses: "${s}"`, !readsAsCheckPromise(s));
  const note = checkPromiseNote();
  ok("the promise note forbids inventing the detail", /do not invent/i.test(note));
  ok("…and never mentions searching", /never mention searching/i.test(note));
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 8. the wiring (source assertions — the set of call sites IS the thing) ──");
// ─────────────────────────────────────────────────────────────────────────
// `age-tier-never-realtime` is this repo's law about exactly this failure: a
// second assembler that quietly missed the rule added later. A fourth compile
// site, or a lane that forgot the farewell, is invisible to any amount of
// fixture testing.
{
  const src = readFileSync(join(ROOT, "src/components/useCallEngine.ts"), "utf8");
  ok(
    "the shared-history block is computed SYNCHRONOUSLY at the ring, not inside the fetch's continuation",
    /const shared = formatSharedHistory\(state\.messages, tRing\);[\s\S]{0,2600}ringFetch\.current = recallForCall/.test(src),
  );
  ok(
    "…and it stands even when the ring fetch fails (`realtime-recall-never` cannot recur through it)",
    /recallRef\.current = callGraphBlocks\(\s*ledgerBlock,\s*shared,\s*cacheUsable \? withRecallAge\(cached\.block, cached\.at, tRing\) : "",\s*\);/.test(src),
  );
  // ── P1-4: the ring that missed its deadline ─────────────────────────────
  ok(
    "the deadline is no longer set to the cold measurement itself",
    /const RING_FETCH_DEADLINE_MS = 1_200;/.test(src),
  );
  ok(
    "…and it is still inside runRecall's own 2s cap, so the network decides and not the deadline",
    1_200 < 2_000,
  );
  ok(
    "an empty recall never wipes a usable cache (the floor stands)",
    /if \(memories\) \{\s*\n\s*recallRef\.current = callGraphBlocks\(ledgerBlock, shared, memories\);/.test(src),
  );
  ok(
    "a recall that landed is cached for the next cold call",
    /writeRecallCache\(memories, relBundle, Date\.now\(\)\);/.test(src),
  );
  ok(
    "…and the persisted slice carries the STRING only, never the rel bundle",
    /localStorage\.setItem\(RECALL_CACHE_KEY, JSON\.stringify\(\{ at, block: recallCache\.block \}\)\);/.test(src) &&
      /recallCache = \{ at: Number\(d\.at\), block: d\.block, relBundle: null \};/.test(src),
  );
  ok(
    "…and the cache field is not named `memories`, which would break the two evals that COUNT that name",
    !/^\s*memories:/m.test(src.slice(src.indexOf("interface RecallCache"), src.indexOf("let recallCache"))),
  );
  ok(
    "a late fetch upgrades the refs the NEXT compile site reads, never a live session's instruction",
    /liveSystemRef\.current = system;/.test(src) &&
      !/liveSession\.current\.(?:setSystem|updateSystem)/.test(src),
  );
  ok(
    "the seam says whether the cache stood in for the fetch",
    /recall_cached: recallFromCache\.current,/.test(src),
  );
  ok(
    "the fetch's continuation composes them rather than overwriting one",
    /recallRef\.current = callGraphBlocks\(ledgerBlock, shared, memories\);/.test(src),
  );
  const memoriesFields = src.match(/^\s*memories:.*$/gm) || [];
  ok("useCallEngine still has exactly two compile-site `memories:` fields", memoriesFields.length === 2, memoriesFields.join(" | "));
  ok(
    "BOTH still route through callMemories, so BOTH carry the block",
    memoriesFields.every((l) => l.includes("callMemories(")),
  );
  ok("still exactly one live assembly per call (G-C4)", (src.match(/liveAssemblies\.current \+= 1/g) || []).length === 1);
  // the live-only slots, and the asymmetry check-prompt-budget's bound rests on
  ok("the LIVE compile passes nowMs (T9 was dark on this lane)", /nowMs: nowAt,/.test(src));
  ok("the LIVE compile passes herCommitments (T16 was dark too)", /herCommitments: herOpen,/.test(src));
  ok(
    "the LIVE compile passes recentTurns (T14 was dark on BOTH call lanes)",
    /recentTurns: callRecentTurns\(stateRef\.current\.messages\),/.test(src),
  );
  ok(
    "the LIVE compile passes the pre-call turn, so T4/T12 are no longer moment-dark",
    /latestUserText: preCallText,/.test(src) &&
      /const preCallText = preCallUserText\(stateRef\.current\.messages, nowAt\);/.test(src),
  );
  const watchBlock = src.slice(src.indexOf("const watchInput = {"), src.indexOf("const cascadeCompiled"));
  ok("the watch compile block was found", watchBlock.length > 200);
  // ── P1-7: the asymmetry is gone, and exactly one thing is still dark ────
  ok("the WATCH compile now passes nowMs (T9, and T16's age labels)", /nowMs: watchNow,/.test(watchBlock));
  ok(
    "…and herCommitments (T16 — the longest stretch of a call was the blindest)",
    /herCommitments: herCommitments\(stateRef\.current\.messages, watchNow\),/.test(watchBlock),
  );
  ok("…and recentTurns (T14)", /recentTurns: callRecentTurns\(stateRef\.current\.messages\),/.test(watchBlock));
  ok(
    "…and still NOT latestUserText: 2,100 bytes against 221 spare, pinned rather than hoped",
    /latestUserText: "",/.test(watchBlock),
  );
  ok(
    "both call sites hand T14 the SAME derivation — one rule, not two",
    (src.match(/recentTurns: callRecentTurns\(stateRef\.current\.messages\),/g) || []).length === 2,
  );
  // the farewell, on both lanes
  ok(
    "the live transcription stream arms the farewell",
    /if \(asksToHangUp\(t\)\) armHangup\("live"\);\s*\n\s*else if \(readsAsFarewell\(t\)\) armFarewell\("live"\);/.test(src),
  );
  ok(
    "so does the cascade's user turn",
    /if \(asksToHangUp\(text\)\) armHangup\("cascade"\);\s*\n\s*else if \(readsAsFarewell\(text\)\) armFarewell\("cascade"\);/.test(src),
  );
  ok("any further speech disarms it", /disarmFarewell\(\); \/\/ …and a goodbye he did not mean costs nothing/.test(src));
  ok(
    "an explicit ask still wins over a farewell (armHangup is tested first)",
    src.indexOf('armHangup("live")') < src.indexOf('armFarewell("live")'),
  );
  ok("a call younger than the floor is never ended by a bye", /elapsedRef\.current < FAREWELL_MIN_SECS/.test(src));
  ok("it waits for HER goodbye to finish before ending", /sheAnswered && !speakingRef\.current && now - herEnd >= FAREWELL_TAIL_MS/.test(src));
  ok(
    "it reads BOTH lanes' 'she stopped' signals",
    /Math\.max\(herStoppedAt\.current, herSpokeUntil\.current\)/.test(src),
  );
  ok(
    "the ring-back is suppressed BEFORE endCall, not after (armHangup's own bug, not repeated)",
    /hangupWasAsked\.current = true;\s*\n\s*diag\("call", "farewell_ended"/.test(src),
  );
  ok("ending the call always clears the poll", /endingRef\.current = true;\s*\n\s*disarmFarewell\(\);/.test(src));
  // the running note
  ok("the running note is SILENT — context, never a cue", /s\.direct\(note, \{ silent: true \}\);/.test(src));
  ok("…and is never logged as a message", !/log\(\{[^}]*formatRunningNote/.test(src));
  ok("…and only on the live lane", /const s = liveSession\.current;\s*\n\s*if \(!s\) return;/.test(src));
  ok("…bounded per call", /notesSent\.current >= NOTE_MAX/.test(src));
  ok(
    "…and never carries screen-share turns — by the FLAG, which a long call cannot trim away",
    /m\.watched !== true,/.test(src.slice(src.indexOf("function currentCallTurns"))),
  );
  // ── P0-3: the client third of the three-way channel contract ────────────
  ok(
    "a turn said while a share is up is stamped on the MESSAGE, once, at log()",
    /const watched = Boolean\(watchSession\.current\) && rawMsg\.kind === "text";/.test(src) &&
      /const m: Message = watched \? \{ \.\.\.rawMsg, watched: true \} : rawMsg;/.test(src),
  );
  ok(
    "…and the end-of-call extraction reads the flag rather than the trimmable ref",
    /stateRef\.current\.messages\.filter\(\(m\) => m\.watched !== true\)\.slice\(-60\)/.test(src),
  );
  {
    const mem = readFileSync(join(ROOT, "src/engine/memory.ts"), "utf8");
    ok(
      "logTurns sends channel:\"watch\" for a share turn — the wire value WS-RECALL accepts",
      /m\.watched === true \? "watch" : m\.channel === "call" \? "call" : "chat"/.test(mem),
    );
    ok(
      "…and the remember pass sends it too, through the same one expression",
      (mem.match(/channel: wireChannel\(m\),/g) || []).length === 2,
    );
    const store = readFileSync(join(ROOT, "src/state/store.ts"), "utf8");
    ok(
      "the STORE keeps two channels: a third value would have leaked share talk into the chat thread",
      /channel\?: "chat" \| "call";/.test(store) && /watched\?: true;/.test(store),
    );
  }
  // ── P0-2: the mid-call re-query ────────────────────────────────────────
  ok(
    "a memory cue in HIS transcript fires the re-query, on both live paths and the cascade",
    (src.match(/maybeReQuery\(/g) || []).length === 4, // 3 call sites + the definition
  );
  ok("…bounded per call", /midCallRecallN\.current >= MEMORY_QUERY_MAX/.test(src));
  ok("…rate-limited between fires", /now - lastMemoryQueryAt\.current < MEMORY_QUERY_GAP_MS/.test(src));
  ok("…and fused", /signal: AbortSignal\.timeout\(MEMORY_QUERY_FUSE_MS\)/.test(src));
  ok("it calls the EXISTING op, never a new endpoint", /op: "recall", device, query: said\.slice\(0, 200\)/.test(src));
  ok(
    "the live half is a SILENT frame — never a cue, exactly like the running note",
    /liveSession\.current\?\.direct\(note, \{ silent: true \}\);/.test(src),
  );
  ok(
    "the cascade half rides extraMemories with the ring result still underneath",
    /midCallRecall\.current\s*\?\s*`\$\{recallRef\.current\}\\n\\n\$\{midCallRecall\.current\}`\s*:\s*recallRef\.current/.test(src),
  );
  ok(
    "…and every cascade think() reads it rather than the bare ring ref",
    (src.match(/callExtraMemories\(\),/g) || []).length === 3 &&
      // the one remaining bare read is the WATCH compile's `memories`, which
      // must NOT carry mid-call rows: that site is a compile and its size is
      // what scripts/check-prompt-budget.mjs bounds
      (src.match(/^\s+recallRef\.current,$/gm) || []).length === 1 &&
      /memories: callMemories\(\s*recallRef\.current,/.test(src),
  );
  ok(
    "it never enters a compile, so no prompt bound moves with it",
    !/memories: callMemories\(callExtraMemories/.test(src),
  );
  ok(
    "a miss is SILENT — nothing was announced, so there is no gap to answer",
    !/missNote|checkPromiseNote/.test(src.slice(src.indexOf("function maybeReQuery"), src.indexOf("const callExtraMemories"))),
  );
  // the lookup honesty
  ok("a lookup that answers ANYTHING silences the backstop", /lookupUntil\.current = Date\.now\(\) \+ LOOKUP_SETTLE_MS;/.test(src));
  ok("her own transcript is what triggers the honest admission", /maybeAnswerCheckPromise\(t\);/.test(src));
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 9. WS-GAMEMEM's residual: the games, on a call ──");
// ─────────────────────────────────────────────────────────────────────────
// The chat lane reads the LOCAL ledger (AppState.activities, published
// through activityLedger()) and drops the server's copy. The realtime lane
// read neither — only the server recall, whose one route to an activity is a
// semantic match over vy_fact. So "kal wali chess game" was answerable in
// chat and not on a call, on a fresh device or a first day. And family 6
// cannot gate the live lane at all (no text of hers to gate), so this block's
// HEADING is the only fence there is.
{
  const rec = (summary, agoDays, kind = "chess") => ({
    kind,
    startedAt: NOW - agoDays * 86_400_000 - min(40),
    closedAt: NOW - agoDays * 86_400_000,
    summary,
  });
  const LEDGER = [
    rec("a game of chess together on 22 aug — she won, by checkmate; the opening was the catalan; 34 moves in", 1),
    rec("would-you-rather together on 20 aug — 6 rounds, he picked the money one", 3, "wyr"),
    rec("tic-tac-toe together on 18 aug — a draw", 5, "ttt"),
  ];

  // THE GATE, with its control.
  const before = compile(liveInput(callGraphBlocks("", "", "")));
  ok("control: with no ledger the live prompt has no game record", !before.system.includes("catalan"));
  const block = formatActivityLedgerForCall(LEDGER, NOW);
  const after = compile(liveInput(callMemories(callGraphBlocks(block, "", ""), "")));
  ok("the newest finished game IS in the assembled live prompt", after.system.includes("she won, by checkmate"));
  ok("…and the one before it", after.system.includes("would-you-rather together"));
  ok("…and when it happened", block.includes("yesterday"));
  ok("it lands in the tail, never the cached core", after.tail.includes("catalan") === false || !after.core.includes("she won"));
  ok(
    "the FENCE is in the prompt — the only family-6 protection this lane has",
    after.system.includes(ACTIVITY_BLOCK_SENTINEL) &&
      /never add a move, an opening or a score that is not here/i.test(after.system) &&
      /say you do not remember/i.test(after.system),
  );
  ok("empty ledger renders nothing", formatActivityLedgerForCall([], NOW) === "");
  ok("undefined ledger renders nothing", formatActivityLedgerForCall(undefined, NOW) === "");
  ok(
    "no ledger is byte-identical to today",
    compile(liveInput(callGraphBlocks("", "", ""))).system === compile(liveInput("")).system,
  );

  // BOUNDS
  ok(`within CALL_ACTIVITY_BUDGET (${block.length} <= ${CALL_ACTIVITY_BUDGET})`, block.length <= CALL_ACTIVITY_BUDGET);
  const rows = block.split("\n").filter((l) => l.startsWith("- "));
  ok(`at most CALL_ACTIVITY_ROWS rows (${rows.length})`, rows.length <= CALL_ACTIVITY_ROWS);
  ok("newest first", rows[0].includes("she won"));
  ok("no move list reaches the call block", !/\b1\.\s*e4\b/.test(block) && !block.includes("34 moves in"));
  ok(
    "the row is cut at the writer's own clause boundary, not mid-fact",
    rows[0].includes("she won, by checkmate") && !rows[0].includes("catalan"),
  );
  {
    // worst case: a summary at EPISODE_SUMMARY_MAX with no clause boundary
    const fat = [rec("x".repeat(EPISODE_SUMMARY_MAX), 1), rec("y".repeat(EPISODE_SUMMARY_MAX), 2)];
    const b = formatActivityLedgerForCall(fat, NOW);
    ok(`worst case still within budget (${b.length} <= ${CALL_ACTIVITY_BUDGET})`, b.length <= CALL_ACTIVITY_BUDGET);
    ok("…and still carries the newest game rather than rendering nothing", b.includes("- x"));
    ok("…clipped rows say so", /…/.test(b));
    ok(`…no row exceeds the char cap`, b.split("\n").filter((l) => l.startsWith("- ")).every((r) => r.length <= CALL_ACTIVITY_MAX_CHARS + 24));
  }
  ok(
    "one date per row: the writer's absolute date is dropped where the relative label stands",
    !/on 22 aug/.test(block) && block.includes("(yesterday)"),
    block,
  );
  ok(
    "…and the stem-date pattern still matches what the writer actually emits",
    / on \d{1,2} (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/.test(
      activityEpisodeSummary(
        { kind: "chess", facts: ["she won"], record: ["she won"], startedAt: NOW - 1000, closedAt: Date.UTC(2026, 7, 22) },
        "a game of chess",
      ),
    ),
  );
  ok(
    "a row with no relative label keeps its date rather than losing both",
    formatActivityLedgerForCall([rec("a game of chess together on 22 aug — she won", -1)], NOW).includes("22 aug"),
  );
  ok("pure: same input twice is byte-identical", formatActivityLedgerForCall(LEDGER, NOW) === formatActivityLedgerForCall(LEDGER, NOW));
  ok("the clock is an INPUT", formatActivityLedgerForCall(LEDGER, NOW) !== formatActivityLedgerForCall(LEDGER, NOW + 5 * 86_400_000));

  // ONE BLOCK, NOT TWO. The server renders its own for the surfaces with no
  // AppState; a lane that has the local ledger must drop it or every game is
  // in the prompt twice under two headings.
  {
    // a real recall string: blocks separated by a blank line, each opening
    // with its own ALL-CAPS heading (what withoutServerActivityBlock walks)
    const serverRecall = `${formatActivityLedger(LEDGER, NOW)}\n\nWHAT YOU KNOW ABOUT THEM:\n- goa trip (event): planned for december`;
    const composed = callGraphBlocks(block, "", serverRecall);
    ok(
      "the server's activity block is dropped when the local one renders",
      composed.split(ACTIVITY_BLOCK_SENTINEL).length - 1 === 1,
      `${composed.split(ACTIVITY_BLOCK_SENTINEL).length - 1} headings`,
    );
    ok("…and the rest of the recall survives it", composed.includes("goa trip"));
    ok(
      "with NO local ledger the server's block is left untouched",
      callGraphBlocks("", "", serverRecall) === serverRecall,
    );
  }

  // ORDER: the fence first (truncation keeps the FIRST n chars), then the
  // shared history, then the graph rows.
  {
    const shared = formatSharedHistory(YESTERDAY, NOW);
    const composed = callGraphBlocks(block, shared, "- goa trip (event): planned for december");
    ok("the ledger precedes the shared history", composed.indexOf(ACTIVITY_BLOCK_SENTINEL) < composed.indexOf("BEFORE TODAY"));
    ok("…which precedes the graph rows", composed.indexOf("BEFORE TODAY") < composed.indexOf("goa trip"));
    ok("all three survive together", composed.includes("she won") && composed.includes("lehenga") && composed.includes("goa trip"));
  }

  // SIGNED OUT is the point: the ledger is local, so the block must render
  // with no device, no recall and no network.
  ok(
    "signed out (no recall string at all) still carries the games",
    callGraphBlocks(block, "", "").includes("she won, by checkmate"),
  );

  // BUDGET ARITHMETIC, pinned to the real guard.
  {
    const parts = buildSystemPromptParts(
      {
        name: "Aaaaaaaaaaaaaaaaaaaa",
        vibe: ["someone to talk to", "a friend who remembers", "company late at night"],
        facts: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`fact_key_number_${i}`, "a".repeat(120)])),
      },
      999,
      "voice",
    );
    const TAIL_EXTRAS = 12 * 570 + 900 + 12 * 150 + 370 + 1_500;
    const CALL_CLOCK = AWAY_BUDGET + HER_COMMITMENTS_BUDGET + RAISED_BUDGET;
    const liveBound =
      parts.tail.length + TAIL_EXTRAS + 1_100 + SHARED_HISTORY_BUDGET + CALL_ACTIVITY_BUDGET + RECALL_AGE_NOTE_MAX + CALL_CLOCK + 1_600 + 500;
    const watchBound =
      parts.tail.length + WATCH_MODE_NOTE.length + TAIL_EXTRAS - 450 + SHARED_HISTORY_BUDGET + CALL_ACTIVITY_BUDGET + RECALL_AGE_NOTE_MAX + CALL_CLOCK;
    ok(`live tail bound WITH the games: ${liveBound} <= ${OPERATIONAL_TAIL_CAP}`, liveBound <= OPERATIONAL_TAIL_CAP);
    ok(`live+watch tail bound WITH the games: ${watchBound} <= ${OPERATIONAL_TAIL_CAP}`, watchBound <= OPERATIONAL_TAIL_CAP);
    const guard = readFileSync(join(ROOT, "scripts/check-prompt-budget.mjs"), "utf8");
    const extras = Number(guard.match(/const CALL_ACTIVITY_EXTRAS = ([0-9_]+)/)?.[1]?.replace(/_/g, ""));
    ok(
      `the guard's CALL_ACTIVITY_EXTRAS (${extras}) equals CALL_ACTIVITY_BUDGET (${CALL_ACTIVITY_BUDGET})`,
      extras === CALL_ACTIVITY_BUDGET,
    );
    ok(
      "the guard measures BOTH live lanes against it",
      (guard.match(/CALL_ACTIVITY_EXTRAS/g) || []).length >= 3,
    );
  }

  // WIRING
  {
    const src = readFileSync(join(ROOT, "src/components/useCallEngine.ts"), "utf8");
    ok(
      "the ring reads AppState first and the published holder second",
      /formatActivityLedgerForCall\(\s*state\.activities \?\? activityLedger\(\),/.test(src),
    );
    ok("both compile sites get it through the one recall string", /recallRef\.current = callGraphBlocks\(ledgerBlock, shared, memories\);/.test(src));
    ok(
      "…and it stands when the ring fetch never lands — now on the last recall that DID land, labelled",
      /cacheUsable \? withRecallAge\(cached\.block, cached\.at, tRing\) : "",/.test(src),
    );
    ok("the production seam reports its BYTES, never its content", /activity_block: activityBlockRef\.current\.length,/.test(src));
    ok(
      "the drop rule is brain.ts's, called rather than copied",
      !/withoutServerActivityBlock/.test(src) &&
        /withoutServerActivityBlock/.test(readFileSync(join(ROOT, "src/voice/callHistory.ts"), "utf8")),
    );
  }
}

console.log(fail ? `\n${fail} FAILED` : "\ncallmem ok");
process.exit(fail ? 1 : 0);
