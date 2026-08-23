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
  RUNNING_NOTE_BUDGET,
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
  const LIVE_ONLY = AWAY_BUDGET + HER_COMMITMENTS_BUDGET;
  const liveBound = parts.tail.length + TAIL_EXTRAS + TASTE_EXTRAS + SHARED_HISTORY_BUDGET + LIVE_ONLY;
  const watchBound = parts.tail.length + WATCH_MODE_NOTE.length + TAIL_EXTRAS + SHARED_HISTORY_BUDGET;
  ok(`live tail bound WITH the block: ${liveBound} <= ${OPERATIONAL_TAIL_CAP}`, liveBound <= OPERATIONAL_TAIL_CAP);
  ok(`live+watch tail bound WITH the block: ${watchBound} <= ${OPERATIONAL_TAIL_CAP}`, watchBound <= OPERATIONAL_TAIL_CAP);
  const guard = readFileSync(join(ROOT, "scripts/check-prompt-budget.mjs"), "utf8");
  const shared = Number(guard.match(/const SHARED_HISTORY_EXTRAS = ([0-9_]+)/)?.[1]?.replace(/_/g, ""));
  const liveOnly = guard.match(/const LIVE_ONLY_EXTRAS = ([0-9]+) \+ ([0-9]+)/);
  ok(
    `the guard's SHARED_HISTORY_EXTRAS (${shared}) equals SHARED_HISTORY_BUDGET (${SHARED_HISTORY_BUDGET})`,
    shared === SHARED_HISTORY_BUDGET,
  );
  ok(
    `the guard's LIVE_ONLY_EXTRAS equals AWAY_BUDGET + HER_COMMITMENTS_BUDGET (${AWAY_BUDGET} + ${HER_COMMITMENTS_BUDGET})`,
    liveOnly && Number(liveOnly[1]) === AWAY_BUDGET && Number(liveOnly[2]) === HER_COMMITMENTS_BUDGET,
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
    "it carries the HEAD of the call — the part compression drops",
    note.includes("turn number 0") && note.includes(`turn number ${RUNNING_NOTE_TURNS - 1}`),
  );
  ok("…and not the tail, which the session still has", !note.includes("turn number 19"));
  ok(`never more than RUNNING_NOTE_TURNS rows`, note.split("\n").filter((l) => l.startsWith("- ")).length <= RUNNING_NOTE_TURNS);
  ok(`within RUNNING_NOTE_BUDGET (${note.length} <= ${RUNNING_NOTE_BUDGET})`, note.length <= RUNNING_NOTE_BUDGET);
  ok(
    "angle brackets, never square (`ack-bracket-direction`: bracket text on this lane gets spoken)",
    note.startsWith("<context:") && note.endsWith(">") && !note.includes("["),
  );
  ok("it tells her not to answer it or read it out", /do not answer this/i.test(note) && /do not read it out/i.test(note));
  ok("it is stable for the same head — a re-send is the same bytes", formatRunningNote(turns) === note);
  const fat = Array.from({ length: 12 }, (_, i) => call("me", `${"antidisestablishmentarianism ".repeat(20)}${i}`, min(40 - i)));
  ok(`worst case still within budget`, formatRunningNote(fat).length <= RUNNING_NOTE_BUDGET);
  ok("…and still carries something", formatRunningNote(fat).includes("- them:"));
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
    /const shared = formatSharedHistory\(state\.messages, tRing\);[\s\S]{0,1400}ringFetch\.current = recallForCall/.test(src),
  );
  ok(
    "…and it stands even when the ring fetch fails (`realtime-recall-never` cannot recur through it)",
    /recallRef\.current = callGraphBlocks\(ledgerBlock, shared, ""\);\s*\n\s*ringFetch\.current/.test(src),
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
  const watchBlock = src.slice(src.indexOf("const watchInput = {"), src.indexOf("const cascadeCompiled"));
  ok("the watch compile block was found", watchBlock.length > 200);
  ok(
    "the WATCH compile passes neither — the budget bound depends on it",
    !/nowMs:/.test(watchBlock) && !/herCommitments:/.test(watchBlock),
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
    "…and never carries screen-share turns",
    /!watchTurnIds\.current\.has\(m\.id\)/.test(src.slice(src.indexOf("function currentCallTurns"))),
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
    const liveBound =
      parts.tail.length + TAIL_EXTRAS + 1_100 + SHARED_HISTORY_BUDGET + CALL_ACTIVITY_BUDGET + AWAY_BUDGET + HER_COMMITMENTS_BUDGET;
    const watchBound =
      parts.tail.length + WATCH_MODE_NOTE.length + TAIL_EXTRAS + SHARED_HISTORY_BUDGET + CALL_ACTIVITY_BUDGET;
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
    ok("…and it stands when the ring fetch never lands", /recallRef\.current = callGraphBlocks\(ledgerBlock, shared, ""\);/.test(src));
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
