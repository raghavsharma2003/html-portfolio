// WS-SHARENOW — the share he had one minute before he called back.
//
// ── the owner's report, and it is the whole of this file ──────────────────
//
//   He screen-shared with her. He hung up. He called again ONE MINUTE later
//   and asked what they had just watched. She did not know, and (his words)
//   probably made something up.
//
// The memory wave had just made YESTERDAY's call reachable on the phone. The
// share that ended sixty seconds ago was not, and the reason is worth writing
// down because every part of it looked correct on its own:
//
//   1. `formatSharedHistory` DOES carry share commentary, marked, and
//      `evals/callmem` §5e proves it. But its call group is the LAST
//      `SHARED_HISTORY_CALL_ROWS` (3) turns before the callmark — a
//      how-it-was-left window, not a what-we-did record. In the owner's shape
//      the share ends, they talk for another minute, and then he hangs up, so
//      those three rows go to the small talk AFTER the share. §1 below
//      reproduces exactly that: three commentary lines in, one out.
//   2. The one row that survives sits under a heading that opens "BEFORE
//      TODAY" — for something sixty seconds old — and then says, correctly for
//      its own purpose, that it "is not news, it never gets read back to them,
//      and being listed here is not a reason to raise it". That is the wrong
//      instruction in front of a direct question about it.
//   3. Nothing else local carries it. `formatChatTail` excludes call turns by
//      construction, so it renders zero bytes here. The server route
//      (`vy_shared_moment` via api/episodes.js) is written fire-and-forget,
//      gated to the FIRST line she speaks inside a 12-second SHOW-wake window,
//      and read back by a leg that matches her reaction text against words
//      taken from the last four things HE typed — and then only if the ring
//      fetch beats RING_FETCH_DEADLINE_MS (1,200ms).
//
// So the freshest and most vivid thing that ever happens between them was the
// one thing the brief could not say.
//
// ── what this file drives ────────────────────────────────────────────────
//
// The whole flow, from the REAL source, with nothing re-modelled:
//
//   her lines logged with `watched: true`
//     -> the share-end derivation (asserted against useCallEngine.ts's source,
//        then run through the REAL `withShareRecord`)
//     -> the REAL `formatJustHappened`
//     -> the REAL `callGraphBlocks` / `callMemories` composition
//     -> the REAL `compile()`, live lane
//     -> an assertion about the bytes of the actual system prompt.
//
// Offline, deterministic, no model call, no database, no money — so it belongs
// in CI by the same `dead-writers` test the honesty, chattail and callmem
// suites are wired in under.
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "sharenow-"));
const BUNDLE = join(tmp, "sharenow.bundle.mjs");
execSync(
  `npx esbuild ${join(HERE, ".entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const E = await import(pathToFileURL(BUNDLE).href);

let fail = 0;
let checks = 0;
const ok = (name, cond, extra = "") => {
  checks++;
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
// A share turn is `channel:"call"` PLUS `watched:true` — never a third channel
// value. store.ts's own comment is why: nine local readers switch on
// `channel !== "call"`, and a third value would leak screen-derived speech into
// the thread, the chat tail, the repeat window and the burst grouper at once.
const share = (from, text, agoMs) => msg(from, text, agoMs, { channel: "call", watched: true });
const mark = (agoMs) => ({ id: `k${seq++}`, from: "me", kind: "callmark", text: "6:20", at: NOW - agoMs });

// ── THE OWNER'S SCENARIO, AS A PERMANENT FIXTURE ──────────────────────────
// He starts a share twelve minutes ago, she says three things over it, the
// share ends at minute 8, they talk for a moment, he hangs up at minute 1.
// Sixty seconds later he calls back and asks "kya dekha humne".
const SHARE_FROM = NOW - min(12);
const SHARE_TO = NOW - min(8);
const HER_LINES = [
  "arre ye toh pura dashboard red hai",
  "us graph me dusra spike bada weird hai",
  "haha wo popup band kar pehle",
];
const STORE = [
  msg("me", "kal milte hai phir", hr(30)),
  call("me", "ruk main screen share karta hu", min(12)),
  share("her", HER_LINES[0], min(11)),
  share("her", HER_LINES[1], min(10)),
  share("her", HER_LINES[2], min(9)),
  call("me", "haan theek hai", min(8)),
  call("her", "haan", min(7)),
  mark(min(1)),
];
// THE ASK, in his words. Not used to drive a model (nothing here spends money);
// it is here so the fixture carries the question it exists to answer.
const THE_QUESTION = "kya dekha humne";

// ── the share-end derivation, run rather than described ───────────────────
// This is what `recordShareEnd` in useCallEngine.ts does, and §5 below asserts
// that the source really does it this way rather than trusting this line.
const derivedSaid = (msgs, from, to) =>
  msgs
    .filter(
      (m) =>
        m.watched === true &&
        m.from === "her" &&
        m.kind === "text" &&
        Boolean(m.text?.trim()) &&
        Number.isFinite(m.at) &&
        m.at >= from &&
        m.at <= to,
    )
    .map((m) => m.text);

const mirror = E.withShareRecord([], {
  startedAt: SHARE_FROM,
  endedAt: SHARE_TO,
  lane: "web",
  said: derivedSaid(STORE, SHARE_FROM, SHARE_TO),
});

// The live compile site's inputs, mirroring useCallEngine.ts's tryStartLive.
const USER = { name: "Aarav", vibe: ["someone to talk to"], facts: {} };
const liveInput = (memories, extra = {}) => ({
  user: USER,
  messageCount: STORE.length,
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
  ...extra,
});

// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 1. THE CONTROL: what the shipped blocks did with this ──");
// ─────────────────────────────────────────────────────────────────────────
// A gate that cannot fail is a green light with no wiring behind it, and this
// repo has shipped one of those. So the defect is reproduced FIRST, on the
// same fixture, through the same real renderers.
{
  const tail = E.formatChatTail(STORE, NOW);
  ok("the chat tail carries nothing at all (call turns are excluded by design)", tail === "");

  const shared = E.formatSharedHistory(STORE, NOW);
  const carried = HER_LINES.filter((l) => shared.includes(l.slice(0, 18)));
  ok(
    `PRE-FIX: the shared-history block carries ${carried.length} of ${HER_LINES.length} commentary lines`,
    carried.length < HER_LINES.length,
    "if this ever passes 3/3 the defect is gone by another route and this control is decorative",
  );
  ok(
    "…because its call group is the LAST 3 turns before the callmark, and the small talk after the share took two of them",
    shared.includes("haan theek hai") && !shared.includes("dashboard"),
  );
  ok(
    "…and what it does carry sits under a heading that calls it BEFORE TODAY and forbids reading it back",
    shared.includes("BEFORE TODAY") && shared.includes("never gets read back"),
  );
  const before = E.compile(liveInput(E.callMemories(E.callGraphBlocks("", "", shared, ""), tail)));
  ok(
    "PRE-FIX: the live prompt cannot answer the question he actually asked",
    // Probe with fixture-specific PHRASES, not single words: the single-word
    // "spike" probe false-failed on 2026-08-24 when a persona register bullet
    // legitimately used the word ("excitement is a spike, not a setting").
    // The check's subject is share CONTENT leaking, so the probe must be a
    // string only the share lines could carry.
    !before.system.includes("dashboard") && !before.system.includes("dusra spike"),
    `he asked "${THE_QUESTION}"`,
  );
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 2. THE FIXTURE: share → 60s → call → \"kya dekha humne\" ──");
// ─────────────────────────────────────────────────────────────────────────
{
  ok("the share mirror caught every line she said over the screen", mirror[0].said.length === 3);
  ok("…verbatim, exactly the strings postWatchMoment sends", mirror[0].said.join("|") === HER_LINES.join("|"));

  const block = E.formatJustHappened(mirror, [], STORE, NOW);
  ok("the just-happened block renders", block.length > 0);
  for (const line of HER_LINES) ok(`it carries: "${line.slice(0, 34)}"`, block.includes(line));
  ok("it says they were watching his screen TOGETHER", /watching their screen together/.test(block));
  ok("…and how long ago it stopped, in minutes", /till 8 min ago/.test(block));

  // …and now the thing the owner actually experienced: the LIVE prompt.
  const memories = E.callMemories(
    E.callGraphBlocks(block, "", E.formatSharedHistory(STORE, NOW), ""),
    E.formatChatTail(STORE, NOW),
  );
  const after = E.compile(liveInput(memories));
  ok("THE FIX, through the real compiler: the live prompt carries what they watched", after.system.includes("dashboard"));
  ok("…all three lines of it", HER_LINES.every((l) => after.system.includes(l)));
  ok(
    "it lands in the tail, never the cached core",
    after.tail.includes("dashboard") && !after.core.includes("dashboard"),
  );
  ok(
    "the just-happened block precedes the shared-history block in the composed string",
    memories.indexOf("JUST NOW") >= 0 && memories.indexOf("JUST NOW") < memories.indexOf("BEFORE TODAY"),
  );
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 3. THE WATCH-CONTENT CONTRACT: what it may NEVER carry ──");
// ─────────────────────────────────────────────────────────────────────────
// `Message.watched`'s rule is that screen-derived talk is CONVERSATION and
// never durable memory about his life — one glance at a thread and "Rohit na?"
// becomes a permanent, confidently wrong claim. Her own reactions are the half
// that survives it, because she said them and they are true regardless of
// whether the reading behind them was, which is exactly why
// `vy_shared_moment.assertion_id` is nullable. This section is the other half:
// nothing about the SCREEN is re-derived, here or anywhere.
{
  const block = E.formatJustHappened(mirror, [], STORE, NOW);
  ok(
    "not one of HIS turns is in the block — a share row is hers or it is nothing",
    !block.includes("ruk main screen share karta hu") && !block.includes("haan theek hai"),
  );
  ok("every content row is hers", block.split("\n").filter((l) => l.startsWith("- ")).every((l) => l.startsWith("- you: ")));
  ok("the heading fences against adding to it", /add nothing to it/.test(block));
  // The mirror is fed ONLY from messages already stamped `watched` — there is
  // no path from a frame, a caption or a vision extraction into it. Asserted on
  // the store's own writer: a record whose `said` is not her text cannot be
  // constructed by handing it something else.
  const hostile = E.withShareRecord([], {
    startedAt: SHARE_FROM,
    endedAt: SHARE_TO,
    lane: "web",
    said: derivedSaid(
      [...STORE, msg("her", "his manager Rohit looked annoyed in that thread", min(10), { channel: "call" })],
      SHARE_FROM,
      SHARE_TO,
    ),
  });
  ok(
    "a turn NOT stamped `watched` never enters the mirror, even said mid-share",
    !hostile[0].said.some((t) => t.includes("looked annoyed")),
  );
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 4. THE HONEST HALF: a share she was quiet through ──");
// ─────────────────────────────────────────────────────────────────────────
// The owner's scenario with the commentary taken out. She must be able to say
// "haan dekha, par maine kuch bola nahi tha" and must have nothing to invent
// from — an empty record is a real answer, not a gap to fill.
{
  const quietStore = [
    msg("me", "kal milte hai phir", hr(30)),
    call("me", "ruk main screen share karta hu", min(12)),
    call("me", "haan theek hai", min(8)),
    mark(min(1)),
  ];
  const quiet = E.withShareRecord([], {
    startedAt: SHARE_FROM,
    endedAt: SHARE_TO,
    lane: "web",
    said: derivedSaid(quietStore, SHARE_FROM, SHARE_TO),
  });
  ok("the mirror records the share itself, with no lines", quiet.length === 1 && quiet[0].said.length === 0);

  const block = E.formatJustHappened(quiet, [], quietStore, NOW);
  ok("the block still renders — the SHARE happened, and that is a fact she has", block.length > 0);
  ok("it still says they were watching together, and until when", /watching their screen together till 8 min ago/.test(block));
  ok("…and says plainly that she said nothing about it", /you said nothing about it/.test(block));
  ok(
    "…and that the screen itself is not hers to describe",
    /what was on it is not yours to describe/.test(block),
  );
  ok("there is not one content row to read out", !block.includes("\n- "));
  const after = E.compile(liveInput(E.callMemories(E.callGraphBlocks(block, "", "", ""), "")));
  ok("the honest line reaches the live prompt", after.system.includes("you said nothing about it"));
  ok(
    `within budget (${block.length} <= ${E.JUST_HAPPENED_BUDGET})`,
    block.length <= E.JUST_HAPPENED_BUDGET,
  );
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 5. THE WIRING: every path that ends a share writes the mirror ──");
// ─────────────────────────────────────────────────────────────────────────
// `dead-writers`: a correct writer with no caller is indistinguishable from an
// absent one, and this repo found three in a single audit. So the call sites
// are read out of the source rather than assumed.
{
  const src = readFileSync(join(ROOT, "src/components/useCallEngine.ts"), "utf8");
  ok("the mirror writer exists", /function recordShareEnd\(/.test(src));
  ok(
    "…and is written SYNCHRONOUSLY, off state already in memory (no await, no fetch)",
    /function recordShareEnd\([\s\S]{0,2400}?\n  }/.test(src) &&
      !/function recordShareEnd\([\s\S]{0,2400}?(await|fetch\()/.test(src),
  );
  ok(
    "it derives `said` from `watched === true` AND `from === \"her\"` — her lines, never his and never the screen",
    /recordShareEnd\([\s\S]{0,1200}?m\.watched === true[\s\S]{0,200}?m\.from === "her"/.test(src),
  );
  ok(
    "the WEB lane records it in cleanup(), the one place a web share ends",
    /const cleanup = \(reason = "user"\) => \{[\s\S]{0,900}?recordShareEnd\("web"/.test(src),
  );
  ok(
    "…before the tracks are stopped and before the session ref is nulled",
    /recordShareEnd\("web", watchStartedAt\);[\s\S]{0,300}?watchSession\.current = null/.test(src),
  );
  ok(
    "the NATIVE lane records it on an external stop (notification, system revoke)",
    /capture ended outside our UI[\s\S]{0,600}?recordShareEnd\("native"/.test(src),
  );
  ok("…and in stopWatchMode, which is what endCall funnels through", /function stopWatchMode\(\)[\s\S]{0,900}?recordShareEnd\("native"/.test(src));
  ok(
    "the hangup path reaches stopWatchMode BEFORE it posts the episode close",
    src.indexOf("stopWatchMode(); // screen sharing dies with the call") <
      src.indexOf("postEpisodeCallEnd(stateRef.current.deviceId)"),
  );
  ok(
    "the server row is STILL written — this is a mirror, not a replacement",
    /postWatchMoment\(stateRef\.current\.deviceId, text\)/.test(src) &&
      /op: "watch_moment"/.test(src),
  );
  // …and the READ side: the ring composes the block, synchronously, from local
  // state, before the network call it must never wait on.
  const ring = src.slice(src.indexOf("const tRing = Date.now();"), src.indexOf("ringFetch.current = recallForCall"));
  ok("the ring site was found", ring.length > 400);
  ok("the ring composes the just-happened block", /formatJustHappened\(/.test(ring));
  ok(
    "…from `state.shares` first and the published holder second (one store, one pointer)",
    /formatJustHappened\(\s*\n?\s*state\.shares \?\? shareLedger\(\)/.test(ring),
  );
  ok("…and hands it to callGraphBlocks as the FIRST block", /callGraphBlocks\(\s*\n?\s*justBlock,/.test(ring));
  ok(
    "the fetch continuation keeps it (an upgraded recall must not drop the local half)",
    /callGraphBlocks\(justBlock, ledgerBlock, shared, memories\)/.test(src),
  );
  ok("its bytes are on the diag record, so a dark block is visible at connect", /just_happened: justHappenedRef\.current\.length/.test(src));
  // The chat lane carries it too — `call-opens-with-amnesia-by-construction`'s
  // rule runs in both directions.
  const brain = readFileSync(join(ROOT, "src/engine/brain.ts"), "utf8");
  ok("the CHAT lane carries the same block, from the same function", /formatJustHappened\(shareLedger\(\), ledger, history, Date\.now\(\)\)/.test(brain));
  ok("…in front of the ledger and the graph rows, same truncation argument", /justBlock \? \(withLedger \? /.test(brain));
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 6. BOUNDS, and the arithmetic against the real guard ──");
// ─────────────────────────────────────────────────────────────────────────
{
  const fat = E.withShareRecord([], {
    startedAt: SHARE_FROM,
    endedAt: SHARE_TO,
    lane: "web",
    said: Array.from({ length: 6 }, (_, i) => `${"antidisestablishmentarianism ".repeat(20)}${i}`),
  });
  const ledger = [{ kind: "chess", startedAt: NOW - min(40), closedAt: NOW - min(20), summary: `${"x".repeat(400)}` }];
  const worst = E.formatJustHappened(fat, ledger, STORE, NOW);
  ok(`worst case is within JUST_HAPPENED_BUDGET (${worst.length} <= ${E.JUST_HAPPENED_BUDGET})`, worst.length <= E.JUST_HAPPENED_BUDGET);
  ok("something survived the drop", worst.includes("- you: "));
  const rows = worst.split("\n").filter((l) => l.startsWith("- "));
  ok(`never more than JUST_HAPPENED_ROWS rows`, rows.length <= E.JUST_HAPPENED_ROWS);
  ok(
    `no single row can crowd out the block (<= ${E.JUST_HAPPENED_MAX_CHARS} + prefix)`,
    rows.every((r) => r.length <= E.JUST_HAPPENED_MAX_CHARS + 12),
    rows.map((r) => r.length).join(","),
  );
  ok("over budget it drops WHOLE rows — every survivor ends intact or says it was clipped", rows.every((r) => r.endsWith(" …") || !/antidis$/.test(r)));
  ok(
    "a heading is never left promising rows it no longer has",
    !(worst.includes("you said this about it:") && !rows.length),
  );
  ok("the store clips at write time too, so localStorage cannot grow with it", fat[0].said.every((t) => t.length <= E.SHARE_SAID_MAX_CHARS));
  ok(`…and keeps at most SHARE_SAID_MAX lines`, fat[0].said.length <= E.SHARE_SAID_MAX);

  // ── THE PIN. A budget and its guard drifting apart is exactly how the
  // crisis helplines were lost once, so the subtraction is asserted against
  // the guard's own source rather than restated as a claim here.
  const guard = readFileSync(join(ROOT, "scripts/check-prompt-budget.mjs"), "utf8");
  const extras = Number(guard.match(/const JUST_HAPPENED_EXTRAS = ([0-9_]+)/)?.[1]?.replace(/_/g, ""));
  ok(
    `the guard's JUST_HAPPENED_EXTRAS (${extras}) equals JUST_HAPPENED_BUDGET (${E.JUST_HAPPENED_BUDGET})`,
    extras === E.JUST_HAPPENED_BUDGET,
  );
  ok(
    "the guard counts it on BOTH call lanes — a block on one lane only is the defect class this fixes",
    /live tail \(bound\)[\s\S]{0,320}JUST_HAPPENED_EXTRAS/.test(guard) &&
      /live\+watch tail \(bound\)[\s\S]{0,320}JUST_HAPPENED_EXTRAS/.test(guard),
  );
  ok(
    "the guard states the arithmetic that made room for it, rather than implying headroom",
    /29,684 of 30,000/.test(guard) && /leaving 16 and 318/.test(guard),
  );
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 7. THE WINDOW, and the render-nothing default ──");
// ─────────────────────────────────────────────────────────────────────────
{
  ok("nothing at all renders nothing", E.formatJustHappened([], [], [], NOW) === "");
  ok(
    "compile() with no block is byte-identical to today",
    E.compile(liveInput(E.callGraphBlocks(E.formatJustHappened([], [], [], NOW), "", "", ""))).system ===
      E.compile(liveInput("")).system,
  );
  const old = E.withShareRecord([], {
    startedAt: NOW - E.JUST_HAPPENED_WINDOW_MS - min(10),
    endedAt: NOW - E.JUST_HAPPENED_WINDOW_MS - min(1),
    lane: "web",
    said: HER_LINES,
  });
  ok("a share older than the window is not 'just now' any more", E.formatJustHappened(old, [], [], NOW) === "");
  ok(
    "the window is api/episodes.js's own GAP_MS, so both halves of the product agree on when a thing stops being present",
    E.JUST_HAPPENED_WINDOW_MS === Number(readFileSync(join(ROOT, "api/episodes.js"), "utf8").match(/export const GAP_MS = (\d+) \* 60_000/)?.[1]) * 60_000,
  );
  ok("a share in the FUTURE (a clock skew, a bad merge) renders nothing", E.formatJustHappened(
    E.withShareRecord([], { startedAt: NOW + min(1), endedAt: NOW + min(5), lane: "web", said: HER_LINES }),
    [], [], NOW,
  ) === "");
  ok("pure: same input twice is byte-identical", E.formatJustHappened(mirror, [], STORE, NOW) === E.formatJustHappened(mirror, [], STORE, NOW));
  ok(
    "the clock is an INPUT (a Date.now() in here would flap the byte-identity gate)",
    E.formatJustHappened(mirror, [], STORE, NOW) !== E.formatJustHappened(mirror, [], STORE, NOW + hr(2)),
  );
  ok("minsAgoLabel is minutes, never a timestamp", E.minsAgoLabel(NOW - min(3), NOW) === "3 min ago");
  ok("…and 'just now' under a minute", E.minsAgoLabel(NOW - 20_000, NOW) === "just now");
  ok("…and nothing without a clock", E.minsAgoLabel(0, NOW) === "");
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 8. the other two things that JUST happened ──");
// ─────────────────────────────────────────────────────────────────────────
{
  // A game that just closed: a POINTER, never a second rendering of the record.
  // `warm-count-unscoped` — when a reader and a writer each derive the same
  // record they eventually disagree, invisibly.
  const ledger = [{ kind: "chess", startedAt: NOW - min(40), closedAt: NOW - min(12), summary: "a game of chess together on 23 aug — she won, by checkmate" }];
  const block = E.formatJustHappened([], ledger, [], NOW);
  ok("a game finished minutes ago renders", /you finished a game together 12 min ago/.test(block));
  ok("…as a pointer at the record below, not as a second copy of it", !block.includes("by checkmate"));
  ok(
    "…and the record it points at really is below it in the composed string",
    E.callGraphBlocks(block, E.formatActivityLedgerForCall(ledger, NOW), "", "").includes("by checkmate"),
  );
  // A call that just ended, and ONLY when the share line has not said it better.
  const callOnly = E.formatJustHappened([], [], [mark(min(4))], NOW);
  ok("a call that ended four minutes ago renders", /you were on a call together till 4 min ago/.test(callOnly));
  ok(
    "…and is suppressed when a share line already says it",
    !E.formatJustHappened(mirror, [], STORE, NOW).includes("you were on a call together"),
  );
  ok("the priority order is fixed, not recency: the share rows outrank the callmark that is newer than they are",
    E.formatJustHappened(mirror, [], STORE, NOW).includes("dashboard"));
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 9. `recited-prompt`: the law this block is most exposed to ──");
// ─────────────────────────────────────────────────────────────────────────
// This block is made of things she actually SAID, minutes ago, at the very
// front of the brief. That is the highest-risk position in the prompt for the
// failure `recited-prompt` records, so it is linted with the REAL linter over
// the REAL output.
{
  const block = E.formatJustHappened(mirror, [], STORE, NOW);
  const rows = block.split("\n").filter((l) => l.startsWith("- "));
  ok("there are rows to lint", rows.length >= 3, `${rows.length}`);
  const lint = E.lintBlock(rows.join("\n"));
  ok("every row passes the real shapelint, unassisted", lint.clean, lint.violations.map((v) => v.reasons.join(";")).join(" | "));
  ok("no row opens in her first person (the speaker prefix defeats it by construction)", rows.every((r) => r.startsWith("- you: ")));
  const heads = block.split("\n").filter((l) => !l.startsWith("- "));
  ok(
    "the headings cannot be recited either — none is sentence-shaped",
    heads.every((h) => !/^[A-Z][^.?!]*[.?!]$/.test(h)),
    heads.join(" | "),
  );
  ok("…and the honest-half heading is not either", !/^[A-Z][^.?!]*[.?!]$/.test(
    E.formatJustHappened(E.withShareRecord([], { startedAt: SHARE_FROM, endedAt: SHARE_TO, lane: "web", said: [] }), [], [], NOW).split("\n")[1],
  ));
}

console.log(fail ? `\n${fail} of ${checks} FAILED` : `\nALL PASS (${checks} assertions)`);
process.exit(fail ? 1 : 0);
