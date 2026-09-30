// T-H3 — "flush the ledger before the call connects" (docs/HONESTY.md §T-H3).
//
// THE DEFECT THIS SUITE EXISTS FOR, as the owner stated it: chat, then call
// ninety seconds later, and she picks up not knowing what you two just typed.
// The cause is two clocks that never meet — `herLife` is written by an
// extraction Chat.tsx runs on every THIRD send, and the live call's system
// prompt is compiled ONCE, at connect, from whatever `herLife` holds at that
// instant. The fix is §T-H3's option (b): the last stretch of typing rides the
// ONE assembly as tail content, so the frozen prompt carries it verbatim.
//
// The gate §T-H3 itself names is section 1 below: "a fixture where a stated
// activity in the last chat turn is present in the assembled live system
// prompt", with the negative control beside it, because a positive assertion
// on a prompt that would have contained the string anyway proves nothing.
//
// Offline, deterministic, no model call, no database, no money — so it belongs
// in CI by the same `dead-writers` test the honesty and time suites are wired
// in under.
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "chattail-"));
const BUNDLE = join(tmp, "chattail.bundle.mjs");
execSync(
  `npx esbuild ${join(HERE, ".entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const {
  formatChatTail,
  callMemories,
  CHAT_TAIL_ROWS,
  CHAT_TAIL_WINDOW_MS,
  CHAT_TAIL_BUDGET,
  CHAT_TAIL_MAX_WORDS,
  CHAT_TAIL_MAX_WORDS_THEM,
  compile,
  OPERATIONAL_TAIL_CAP,
  lintBlock,
  buildSystemPromptParts,
  buildSpeechStyle,
  WATCH_MODE_NOTE,
} = await import(pathToFileURL(BUNDLE).href);

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    console.log(`  ok  ${name}`);
    return;
  }
  fail++;
  console.log(`FAIL  ${name}${extra ? " — " + extra : ""}`);
};

const NOW = Date.UTC(2026, 7, 22, 9, 0, 0);
const min = (n) => n * 60_000;

const msg = (from, text, agoMin, extra = {}) => ({
  id: `m${agoMin}-${from}-${text.slice(0, 6)}`,
  from,
  kind: "text",
  text,
  at: NOW - min(agoMin),
  ...extra,
});

// The stated activity is HIS, in the last typed turn before the call — the
// exact shape §T-H3's gate names, and the one `rememberFrom` would not have
// caught yet because Chat.tsx had not hit its third send.
const STRETCH = [
  msg("her", "haan bata na kya scene hai", 4),
  msg("me", "bas nikal raha hu, cousin ke ghar ja raha hu dinner ke liye", 1),
];

// ─────────────────────────────────────────────────────────────────────────
// 1. THE GATE — the last typed turn reaches the frozen live prompt
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 1. §T-H3's own gate: the last chat turn, in the live system prompt ──");

const USER = { name: "Aarav", vibe: ["someone to talk to"], facts: {} };
const liveInput = (memories) => ({
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
  gapSinceLastMs: min(1),
  nowMs: NOW,
});

// TODAY'S BEHAVIOUR: the ring fetch found nothing to recall, so the prompt is
// compiled with "" and the stretch is simply absent. This is the control, and
// it must fail the containment test or section 1 proves nothing.
const before = compile(liveInput(""));
ok(
  "control: without the tail the stretch is NOT in the prompt",
  !before.system.includes("cousin ke ghar"),
);

const after = compile(liveInput(callMemories("", formatChatTail(STRETCH, NOW))));
ok(
  "his last typed turn (60s before connect) IS in the assembled live prompt",
  after.system.includes("cousin ke ghar ja raha hu dinner ke liye"),
);
ok("her own last typed turn is there too", after.system.includes("kya scene hai"));
ok("the block is labelled as the pre-call stretch", after.system.includes("JUST BEFORE THIS CALL"));
ok(
  "it lands in the tail (T5), never the cached core",
  after.tail.includes("cousin ke ghar") && !after.core.includes("cousin ke ghar"),
);
// Measured against a baseline that ALREADY has a recall block, so the delta is
// the tail alone and not T5's ~900-char heading appearing for the first time.
{
  const GRAPH = "- goa trip (event, 2 days ago): planned with college friends for december";
  const base = compile(liveInput(GRAPH));
  const withTail = compile(liveInput(callMemories(GRAPH, formatChatTail(STRETCH, NOW))));
  ok(
    "T5 is the section that grew, and it grew by the tail plus its one separator",
    withTail.sections.T5 - base.sections.T5 === formatChatTail(STRETCH, NOW).length + 2,
    `${withTail.sections.T5 - base.sections.T5} vs ${formatChatTail(STRETCH, NOW).length + 2}`,
  );
  ok(
    "every other tail section is byte-identical (the tail adds, it never moves anything)",
    Object.keys(withTail.sections)
      .filter((k) => k !== "T5")
      .every((k) => withTail.sections[k] === base.sections[k]),
  );
}

// The freshest thing first: api/chat.js keeps the FIRST n chars of the tail and
// cuts the END, so of the two, graph rows are what may be lost — never the
// stretch that happened ninety seconds ago.
{
  const GRAPH = "- goa trip (event, 2 days ago): planned with college friends for december";
  const composed = callMemories(GRAPH, formatChatTail(STRETCH, NOW));
  ok(
    "the just-typed stretch precedes the graph rows inside T5",
    composed.indexOf("cousin ke ghar") < composed.indexOf("goa trip"),
  );
  ok("the graph rows survive alongside it", composed.includes(GRAPH));
}

// ─────────────────────────────────────────────────────────────────────────
// 2. THE DEFAULT IS SILENCE — absent input is byte-identical to today
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 2. render-nothing default (byte-identity for every existing caller) ──");
ok("no messages renders nothing", formatChatTail([], NOW) === "");
ok("a single message renders a single row", formatChatTail([STRETCH[1]], NOW).includes("- them:"));
ok(
  "callMemories with no stretch returns the recall string UNCHANGED",
  callMemories("- goa trip (event): x", formatChatTail([], NOW)) === "- goa trip (event): x",
);
ok(
  "an empty recall and no stretch is still the empty string",
  callMemories("", formatChatTail([], NOW)) === "",
);
ok(
  "compile() with no stretch is byte-identical to today",
  compile(liveInput(callMemories("", formatChatTail([], NOW)))).system === compile(liveInput("")).system,
);
ok(
  "pure: same input twice is byte-identical",
  formatChatTail(STRETCH, NOW) === formatChatTail(STRETCH, NOW),
);
ok(
  "the clock is an INPUT (a Date.now() in here would flap the byte-identity gate)",
  formatChatTail(STRETCH, NOW) !== formatChatTail(STRETCH, NOW + min(45)),
);

// ─────────────────────────────────────────────────────────────────────────
// 3. WHAT IT REFUSES TO CARRY
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 3. the window, the channel, and the kinds it drops ──");
{
  const stale = [msg("me", "kal wali baat yaad hai", 31), msg("her", "haan", 29)];
  const tail = formatChatTail(stale, NOW);
  ok("a turn older than the window is dropped", !tail.includes("kal wali baat"));
  ok("a turn inside the window is kept", tail.includes("haan"));
  const atEdge = { id: "e", from: "me", kind: "text", text: "edge", at: NOW - CHAT_TAIL_WINDOW_MS };
  ok(
    "the boundary is exactly CHAT_TAIL_WINDOW_MS, inclusive",
    formatChatTail([atEdge], NOW) !== "" &&
      formatChatTail([{ ...atEdge, at: atEdge.at - 1 }], NOW) === "",
  );
}
{
  const mixed = [
    msg("me", "typed line here", 3),
    msg("her", "spoken line here", 2, { channel: "call" }),
    { id: "cm", from: "me", kind: "callmark", text: "2:14", at: NOW - min(2) },
    { id: "ph", from: "her", kind: "photo", text: "", at: NOW - min(1) },
  ];
  const tail = formatChatTail(mixed, NOW);
  ok("a CALL turn never enters the tail (repeat.ts's filter, same reason)", !tail.includes("spoken line"));
  ok("a callmark never enters the tail", !tail.includes("2:14"));
  ok("the typed turn survives all of it", tail.includes("typed line here"));
}
ok(
  "a whitespace-only message renders no row",
  formatChatTail([msg("me", "   ", 1), msg("her", "ok", 1)], NOW).split("\n").length === 2,
);
ok(
  "a message with no timestamp ends the stretch rather than being dated to now",
  formatChatTail([{ id: "x", from: "me", kind: "text", text: "undated", at: 0 }], NOW) === "",
);

// ─────────────────────────────────────────────────────────────────────────
// 4. `recited-prompt` — the law this block is most exposed to
// ─────────────────────────────────────────────────────────────────────────
// This is the only tail content made of things a person actually said, so the
// phrase-bank risk (`rejected.md#recited-prompt`: example quotes recited 4/5,
// authored English sentences recited twice eight turns apart) is real here in a
// way it is not for a fact row. The defences are structural, and this section
// runs the REAL lintBlock over the REAL output — including over a deliberately
// hostile stretch, because a linter shown only clean input proves nothing.
console.log("\n── 4. shape-lint over the real rendered block ──");
{
  const HOSTILE = [
    // sentence-shaped English, capital start and terminal punctuation
    msg("me", "I have been thinking about what you said last night and it really stayed with me.", 5),
    // first-person-Meera voice, line-initial — the exact phrase-bank shape
    msg("her", "main tumhe bohot miss kar rahi hu aaj kal sach me yaar bohot zyada", 4),
    msg("her", "I told him that we should go to Goa together in December.", 3),
    msg("me", "haan chal", 2),
  ];
  const rendered = formatChatTail(HOSTILE, NOW);
  const rows = rendered.split("\n").filter((l) => l.startsWith("- "));
  const hers = rows.filter((r) => r.startsWith("- you:"));
  const theirs = rows.filter((r) => r.startsWith("- them:"));
  // HER rows under the FULL rule set — a line she said is a line she could say
  // again, which is the literal definition of a phrase bank.
  const lintHers = lintBlock(hers.join("\n"));
  ok(
    "every row of HERS passes the real shapelint, unassisted",
    lintHers.clean,
    lintHers.violations.map((v) => `${v.line} :: ${v.reasons.join(";")}`).join(" | "),
  );
  // HIS rows under lintBlock's own allowlist mechanism — the doc names this
  // exact class ("THEIR line, not a line written for her ... verbatim storage
  // is the point"). The allowlist waives the word count; it does NOT waive the
  // two shape rules, asserted separately below, which is the whole point of
  // going through lintBlock rather than skipping the lint.
  const lintTheirs = lintBlock(theirs.join("\n"), ["- them:"]);
  ok(
    "his rows lint clean under the phrase-ledger allowlist",
    lintTheirs.clean && lintTheirs.linesChecked === 0,
  );
  ok(
    "his rows are still shape-clean on the two rules the allowlist does not cover",
    theirs.every((r) => !/^[A-Z][^.?!]*[.?!]$/.test(r) && !/^(i\b|main\b|mai\b|mujhe\b|meri\b|mera\b|maine\b)/i.test(r)),
  );
  ok(
    `his cap is the looser one (${CHAT_TAIL_MAX_WORDS_THEM} > ${CHAT_TAIL_MAX_WORDS}), so an ordinary text arrives whole`,
    CHAT_TAIL_MAX_WORDS_THEM > CHAT_TAIL_MAX_WORDS &&
      theirs.every((r) => r.split(" ").length <= CHAT_TAIL_MAX_WORDS_THEM),
  );
  ok(
    `hers are capped at exactly ${CHAT_TAIL_MAX_WORDS}`,
    hers.every((r) => r.split(" ").length <= CHAT_TAIL_MAX_WORDS),
  );
  ok("the hostile stretch actually produced rows to lint", rows.length === 4);
  ok(
    "no row opens in her first person (the speaker prefix defeats it by construction)",
    rows.every((r) => /^- (them|you): /.test(r)),
  );
  ok(
    "no row is sentence-shaped",
    rows.every((r) => !/^[A-Z][^.?!]*[.?!]$/.test(r)),
  );
  ok(
    "a clipped row says so rather than passing a half-sentence off as the whole thing",
    rows.some((r) => r.endsWith(" …")),
  );
  ok(
    "the head is present and the rows are the only content lines",
    rendered.split("\n").length === rows.length + 1,
  );
}
// The word cap is shapelint's own MAX_WORDS, restated in memory.ts because
// shapelint imports persona.ts and memory.ts is on the call path. Pinned here
// so the restatement cannot drift — that is the whole reason this check exists.
{
  const src = readFileSync(join(ROOT, "src/engine/shapelint.ts"), "utf8");
  const m = src.match(/const MAX_WORDS = (\d+)/);
  ok("shapelint still declares MAX_WORDS", Boolean(m));
  ok(
    `CHAT_TAIL_MAX_WORDS (${CHAT_TAIL_MAX_WORDS}) still equals shapelint's MAX_WORDS (${m?.[1]})`,
    m && Number(m[1]) === CHAT_TAIL_MAX_WORDS,
  );
  const lintSrc = readFileSync(join(ROOT, "src/engine/shapelint.ts"), "utf8");
  ok(
    "lintBlock still offers the verbatim-storage allowlist his rows lean on",
    /allowlist/.test(lintSrc) && /verbatim storage is the point/.test(lintSrc),
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 5. BOUNDS — rows, budget, and whole-row dropping
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 5. bounds: never a transcript, never a sliced block ──");
{
  const many = Array.from({ length: 20 }, (_, i) =>
    msg(i % 2 ? "me" : "her", `line number ${i} with some ordinary hinglish words in it`, 20 - i),
  );
  const rows = formatChatTail(many, NOW).split("\n").filter((l) => l.startsWith("- "));
  ok(`at most CHAT_TAIL_ROWS (${CHAT_TAIL_ROWS}) rows`, rows.length <= CHAT_TAIL_ROWS);
  ok("it keeps the NEWEST rows, not the oldest", rows[rows.length - 1].includes("line number 19"));
  ok("oldest-first ordering inside the block", rows[0].includes("line number 14"));
}
{
  // every row at the word cap, so the block is at its true worst case
  const fat = Array.from({ length: CHAT_TAIL_ROWS }, (_, i) =>
    msg("me", `${"antidisestablishmentarianism ".repeat(30)}${i}`, CHAT_TAIL_ROWS - i),
  );
  const rendered = formatChatTail(fat, NOW);
  ok(
    `worst-case block is within CHAT_TAIL_BUDGET (${rendered.length} <= ${CHAT_TAIL_BUDGET})`,
    rendered.length <= CHAT_TAIL_BUDGET,
  );
  const rows = rendered.split("\n").filter((l) => l.startsWith("- "));
  ok(
    "over budget it drops WHOLE rows — every surviving row is intact",
    rows.every((r) => /^- them: (\S+ )+…$|^- them: [^…]*$/.test(r)),
    rows.join(" | "),
  );
  ok("something survived the drop", rows.length >= 1);
}

// The arithmetic scripts/check-prompt-budget.mjs measures the live lanes with.
// Restated here rather than left as a claim in a comment, because the tail is
// new bytes on the tightest lane in the repo (live+watch measured 22,243 of
// 24,000 before this change) and "it fits" is exactly the kind of statement
// that is true until someone adds one more block.
console.log("\n── 6. prompt budget: the tightest lane still fits ──");
{
  const LIVE_USER = {
    name: "Aaaaaaaaaaaaaaaaaaaa",
    vibe: ["someone to talk to", "a friend who remembers", "company late at night"],
    facts: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`fact_key_number_${i}`, "a".repeat(120)])),
  };
  const parts = buildSystemPromptParts(LIVE_USER, 999, "voice");
  // identical to check-prompt-budget.mjs's bound for this lane
  const TAIL_EXTRAS = 12 * 570 + 900 + 12 * 150 + 370 + 1_500;
  const watchBound = parts.tail.length + WATCH_MODE_NOTE.length + TAIL_EXTRAS;
  ok(
    `live+watch bound WITH the chat tail: ${watchBound + CHAT_TAIL_BUDGET} <= ${OPERATIONAL_TAIL_CAP}`,
    watchBound + CHAT_TAIL_BUDGET <= OPERATIONAL_TAIL_CAP,
  );
  const TASTE_EXTRAS = 1_100;
  ok(
    `live bound WITH the chat tail: ${parts.tail.length + TAIL_EXTRAS + TASTE_EXTRAS + CHAT_TAIL_BUDGET} <= ${OPERATIONAL_TAIL_CAP}`,
    parts.tail.length + TAIL_EXTRAS + TASTE_EXTRAS + CHAT_TAIL_BUDGET <= OPERATIONAL_TAIL_CAP,
  );
  ok("the live core is unaffected (cache-9x: core must not gain per-turn bytes)", buildSpeechStyle("live").length > 0);
}

// ─────────────────────────────────────────────────────────────────────────
// 7. EVERY CALL-LANE ASSEMBLY SITE, TREATED THE SAME
// ─────────────────────────────────────────────────────────────────────────
// `age-tier-never-realtime` is this repo's law about exactly this failure: a
// second assembler that quietly missed the rule added later. These are source
// assertions rather than behavioural ones because the thing being protected IS
// the set of call sites — a fourth compile appearing without the tail is
// invisible to any amount of fixture testing.
console.log("\n── 7. all call-lane compile sites carry it; the cascade lane still does not need it ──");
{
  const src = readFileSync(join(ROOT, "src/components/useCallEngine.ts"), "utf8");
  const memoriesFields = src.match(/^\s*memories:.*$/gm) || [];
  ok("useCallEngine has exactly two compile-site `memories:` fields", memoriesFields.length === 2, memoriesFields.join(" | "));
  ok(
    "BOTH route through callMemories (live connect + native watch start)",
    memoriesFields.every((l) => l.includes("callMemories(")),
    memoriesFields.join(" | "),
  );
  ok(
    "the cascade lane's brainKeys still carries no memories field of its own",
    !/const brainKeys[\s\S]{0,1200}?memories:/.test(src),
  );
  // the frozen-at-connect invariant: enriching the ONE assembly, never adding
  // a second (G-C4 asserts liveAssemblies reads 1 for the whole call)
  ok(
    "still exactly one live assembly per call",
    (src.match(/liveAssemblies\.current \+= 1/g) || []).length === 1,
  );
  ok(
    "the production seam records BYTES, never content",
    /chat_tail: chatTail\.length/.test(src) && !/chat_tail:[^\n]*chatTail[^.]\s*,/.test(src),
  );
  ok(
    "the live lane renders the tail ONCE and both the compile and the diag read it",
    /const chatTail = formatChatTail\(stateRef\.current\.messages, nowAt\)/.test(src) &&
      /memories: callMemories\(recallRef\.current, chatTail\)/.test(src),
  );
  ok(
    "the ring starts the extraction pass fire-and-forget (the NEXT call is fresher)",
    /absorbRemembered\(\s*\n?\s*rememberFrom\(state\.deviceId/.test(src),
  );
  ok(
    "the pass is never awaited on the connect path",
    !/await\s+rememberFrom\(/.test(src),
  );
}
{
  // The cascade lane needs no tail because brain.ts sends the transcript as
  // real turns. If that ever stops being true, this fix stops covering that
  // lane and this assertion is where it gets caught.
  const brain = readFileSync(join(ROOT, "src/engine/brain.ts"), "utf8");
  ok(
    "brain.ts still sends recent history to the model as turns",
    /history\.filter\(\(m\) => m\.kind !== "callmark"\)\.slice\(-\d+\)/.test(brain),
  );
  const src = readFileSync(join(ROOT, "src/components/useCallEngine.ts"), "utf8");
  // every `think(` on this lane, and what its first 300 chars of arguments
  // say. Line comments are stripped first — this file explains itself at
  // length, and a prose mention of `think()` is not a call site.
  const code = src
    .split("\n")
    .map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? "" : l))
    .join("\n");
  const sites = [...code.matchAll(/\bthink\(/g)].map((m) => code.slice(m.index, m.index + 300));
  ok("this lane still has cascade think() call sites to check", sites.length >= 3, `${sites.length}`);
  ok(
    "every cascade think() on this lane is handed the full message store",
    sites.every((s) => /state(?:Ref\.current)?\.messages,/.test(s)),
    `${sites.filter((s) => !/state(?:Ref\.current)?\.messages,/.test(s)).length} without it`,
  );
}

console.log(fail ? `\n${fail} FAILED` : "\nchattail ok");
process.exit(fail ? 1 : 0);
