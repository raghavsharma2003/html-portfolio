// The milestones engine — the OS half of "gamify the whole experience".
//
// The assertions guard the three properties that make celebration trustworthy
// rather than manipulative: a moment fires ONCE ever; an imported history
// fires only the largest crossed tier per family (no stale confetti
// fusillade); and nothing here is time-scheduled — eligibility comes from the
// record alone, so a detector run at two different times with the same record
// agrees except where real time crossed a day tier.
import {
  detectMoments,
  momentFact,
  momentRecord,
  dyadRecord,
  recordCounts,
  milestoneRecordKind,
  DYAD_RECORD_KIND,
  formatActivityLedger,
  formatActivityLedgerForCall,
  withActivityRecord,
  episodeDateLabel,
  mergeStates,
} from "./.bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) { fail++; console.log(`FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const NOW = Date.UTC(2026, 7, 22, 12, 0);
const DAY = 86_400_000;
const msg = (at) => ({ id: String(at), from: "me", kind: "text", text: "hi", at });
const msgs = (n, firstAt) => Array.from({ length: n }, (_, i) => msg(firstAt + i * 60_000));

// ── fire-once is the whole contract ───────────────────────────────────────
{
  const inp = { messages: msgs(120, NOW - 8 * DAY), fired: [], tally: null, nowMs: NOW };
  const first = detectMoments(inp);
  ok("a week + 100 messages fires", first.length >= 2, JSON.stringify(first.map((m) => m.id)));
  const after = detectMoments({ ...inp, fired: first.map((m) => m.id) });
  ok("nothing fires twice", after.length === 0, JSON.stringify(after.map((m) => m.id)));
}

// ── imported history: largest tier only, per family ───────────────────────
{
  const inp = { messages: msgs(1200, NOW - 120 * DAY), fired: [], tally: null, nowMs: NOW };
  const got = detectMoments(inp);
  const dayIds = got.filter((m) => m.kind === "days-known").map((m) => m.id);
  const msgIds = got.filter((m) => m.kind === "messages").map((m) => m.id);
  ok("one day-tier only, the largest", dayIds.length === 1 && dayIds[0] === "days-100", dayIds.join(","));
  ok("one msg-tier only, the largest", msgIds.length === 1 && msgIds[0] === "msgs-1000", msgIds.join(","));
}

// ── game moments come from the tally, written at close ────────────────────
{
  const inp = {
    messages: msgs(5, NOW - DAY), fired: [],
    tally: { chessGames: 1, chessWinsHer: 1 }, nowMs: NOW,
  };
  const ids = detectMoments(inp).map((m) => m.id);
  ok("first game fires", ids.includes("first-game"), ids.join(","));
  ok("her first win fires", ids.includes("chess-first-win-her"), ids.join(","));
  ok("his first win does NOT (he hasn't won)", !ids.includes("chess-first-win-him"));
}

// ── empty record, empty result — the common case costs nothing ────────────
ok("empty record fires nothing",
  detectMoments({ messages: [], fired: [], tally: null, nowMs: NOW }).length === 0);

// ── determinism ───────────────────────────────────────────────────────────
{
  const inp = { messages: msgs(600, NOW - 40 * DAY), fired: [], tally: { wyrCards: 30 }, nowMs: NOW };
  ok("same input, same moments",
    JSON.stringify(detectMoments(inp)) === JSON.stringify(detectMoments(inp)));
}

// ── momentFact obeys the activity-facts shapelint ─────────────────────────
{
  const all = detectMoments({
    messages: msgs(1200, NOW - 400 * DAY), fired: [],
    tally: { chessGames: 30, chessWinsHim: 1, chessWinsHer: 1, tttGames: 2, wyrCards: 120 },
    nowMs: NOW,
  });
  ok("a rich record yields several", all.length >= 5, String(all.length));
  for (const m of all) {
    const f = momentFact(m);
    ok(`fact <=14 words: ${m.id}`, f.trim().split(/\s+/).length <= 14, f);
    ok(`fact not sentence-shaped: ${m.id}`, !/^[A-Z][^.?!]*[.?!]$/.test(f), f);
    ok(`fact not first-person: ${m.id}`, !/^(i|main|mai)\b/i.test(f), f);
  }
}

// ── the charter: no anxiety mechanics can even be expressed ───────────────
// Structural, on the real source: the module must contain no streak language,
// no loss framing, no urgency vocabulary. If a future edit adds "don't lose
// your streak", this is what catches it.
import { readFileSync } from "node:fs";
const srcRaw = readFileSync(new URL("../src/engine/milestones.ts", import.meta.url), "utf8");
// Comment-blind: the module's header NAMES the banned mechanics in order to
// ban them, and a check that flags the ban's own wording teaches people to
// write vaguer comments. The check is about CODE — ids, titles, facts.
const src = srcRaw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
for (const banned of ["streak", "expire", "lose your", "hurry", "last chance", "don't break"]) {
  ok(`charter: no "${banned}" in the code`, !src.toLowerCase().includes(banned));
}
ok("charter: detection is never time-scheduled",
  /FIRES only on the next real interaction/.test(srcRaw));

// ── the human/game boundary (owner, 2026-08-22) ──────────────────────────
// "If the chat is gamified much then the whole intent of her being human is
// lost." Celebration cards may exist ONLY in game mode; relationship moments
// (days/messages/calls) are always silent — Us-timeline only.
{
  const hook = readFileSync(new URL("../src/components/useMoments.ts", import.meta.url), "utf8");
  ok("game kinds are enumerated", /GAME_KINDS = new Set/.test(hook));
  ok("relationship moments are silent by construction",
    /filter\(\(m\) => !GAME_KINDS\.has\(m\.kind\)\)/.test(hook));
  ok("celebration requires game mode", /gameOpen \? all\.find/.test(hook));
  // SUPERSEDED PIN (audit finding #18): the first behaviour BURNED a game
  // moment detected outside game mode into the ledger — combined with the
  // 900ms detection debounce, leaving the board fast consumed the first-win
  // celebration forever. The moment is now left ELIGIBLE (silentIds carries
  // only the relationship moments), so the next board open celebrates it;
  // the boundary holds because the card gate above is still gameOpen-only.
  ok("a game moment caught outside game mode stays eligible, never burned",
    /const silentIds = silent\.map\(\(m\) => m\.id\);/.test(hook));
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  ok("App renders Celebration only in game mode",
    /activity !== null && \(\s*<Celebration/.test(app));
  ok("App passes gameOpen", /useMoments\(state, setState, inCall, activity !== null\)/.test(app));
}

// ── #117: she gets to mention a crossed milestone herself ─────────────────
// The seam is three writes and one render, all structural, all pinnable:
// the detector stamps state.recentMoment with momentFact() at fire time,
// the chat lane hands it to the brain, and the brain renders it ONLY while
// fresh AND joins it to the honesty gate's support set — without that last
// part, "100 din ho gaye humein" would be flagged as an invented shared
// past by the very gate built to catch invented shared pasts.
{
  const { readFileSync } = await import("node:fs");
  const store = readFileSync(new URL("../src/state/store.ts", import.meta.url), "utf8");
  ok("state carries recentMoment", /recentMoment\?: \{ id: string; fact: string; at: number \} \| null;/.test(store));
  const hook = readFileSync(new URL("../src/components/useMoments.ts", import.meta.url), "utf8");
  ok("detector stamps recentMoment with momentFact", (hook.match(/recentMoment: \{ id: [^}]*fact: momentFact\(/g) || []).length >= 2);
  const brain = readFileSync(new URL("../src/engine/brain.ts", import.meta.url), "utf8");
  ok("brain renders the moment only while fresh", /MOMENT_FRESH_MS/.test(brain) && /keys\.moment && Date\.now\(\) - keys\.moment\.at < MOMENT_FRESH_MS/.test(brain));
  ok("the moment joins the family-4 support set", /sharedVocab: sharedVocabulary\(\[[\s\S]*?momentLine[\s\S]*?\]\)/.test(brain));
  ok("the moment joins trustedText", /trustedText: \[[\s\S]*?momentLine[\s\S]*?\]/.test(brain));
  const chat = readFileSync(new URL("../src/components/Chat.tsx", import.meta.url), "utf8");
  ok("chat lane hands it over", /moment: state\.recentMoment \?\? null/.test(chat));
  // 2026-08-22 audit, finding #9: the CASCADE call lane's brainKeys() carried
  // neither field, so a milestone that had just crossed never reached a
  // mid-call fallback turn — #117 landed in chat and never in a call. Same
  // pin, same shape, the other lane's source — scoped to the `brainKeys`
  // function body specifically, because `activityOf(stateRef.current.game)`
  // already appears elsewhere in this file (the frozen-at-connect LIVE
  // prompt's own compile() call) and a bare file-wide regex would have
  // passed before the fix as easily as after it.
  const callEngine = readFileSync(new URL("../src/components/useCallEngine.ts", import.meta.url), "utf8");
  const brainKeysMatch = callEngine.match(/const brainKeys = \(\) => \(\{[\s\S]*?\n  \}\);/);
  ok("useCallEngine's brainKeys function is found (source shape changed?)", Boolean(brainKeysMatch));
  const brainKeysSrc = brainKeysMatch ? brainKeysMatch[0] : "";
  ok("call lane hands the moment over too", /moment: stateRef\.current\.recentMoment \?\? null/.test(brainKeysSrc));
  ok("call lane's brainKeys also carries the live board (T15)", /activity: activityOf\(stateRef\.current\.game\)/.test(brainKeysSrc));

  // every kind's fact is telegraphic: <=14 words, no first person, no "I"
  const inpAll = {
    messages: msgs(1200, NOW - 400 * DAY),
    fired: [],
    tally: { chessGames: 5, chessWinsHim: 1, chessWinsHer: 1, tttGames: 1, wyrCards: 25 },
    nowMs: NOW,
  };
  for (const m of detectMoments(inpAll)) {
    const f = momentFact(m);
    ok(`fact for ${m.id} is telegraphic`, f.split(/\s+/).length <= 14 && !/\bI\b/.test(f), f);
  }
}

// ── THE DURABLE HALF (WS-SYNC+MEMEVAL, audit #6) ──────────────────────────
//
// `momentsFired` is ids and `recentMoment` is 12 hours by decision
// (`moment-available-not-fired`, deliberately unchanged). Neither of them can
// answer "humne 100 din complete kiye the" three weeks later. The fix is one
// row in the ledger both lanes already read, so what is asserted here is that
// the row exists, that it is durable-tense, that it survives to BOTH lanes
// inside their EXISTING budgets, and that two devices write one of it.
{
  const AT = Date.UTC(2026, 6, 7, 9, 30); // 7 jul
  const label = episodeDateLabel(AT);
  ok("the date label is the ledger's own", label === "7 jul", label);

  const r = momentRecord("days-100", AT, label);
  ok("a celebrated milestone becomes a ledger row", Boolean(r));
  ok("keyed by the milestone, not the clock", r.kind === milestoneRecordKind("days-100") && r.startedAt === 0,
    `${r.kind}:${r.startedAt}`);
  ok("the row is durable tense, not 'today'", !/\btoday\b/.test(r.summary), r.summary);
  ok("the row says what was crossed", /100 days/.test(r.summary), r.summary);
  // pure in its arguments: a reload re-deriving it must be byte-identical, or
  // the row would re-date itself every time the app started
  ok("re-deriving the row is a no-op", JSON.stringify(momentRecord("days-100", AT, label)) === JSON.stringify(r));
  ok("an unknown id makes no row", momentRecord("not-a-milestone", AT, label) === null);

  // every id the detector can produce has a row, and none of them is
  // sentence-shaped (`recited-prompt`: a line she could say is a line she says)
  const all = detectMoments({
    messages: msgs(12000, NOW - 400 * DAY),
    fired: [],
    tally: { chessGames: 100, chessWinsHim: 1, chessWinsHer: 1, tttGames: 4, wyrCards: 250 },
    nowMs: NOW,
  });
  // detectMoments returns one tier per family; walk the tables directly for
  // the rest, so a new tier cannot ship without a row
  const ids = [...new Set([
    ...all.map((m) => m.id),
    "days-7", "days-30", "days-100", "days-365",
    "msgs-100", "msgs-500", "msgs-1000", "msgs-5000", "msgs-10000",
    "calls-1", "calls-10", "calls-50", "calls-100",
    "chess-5", "chess-25", "chess-100", "wyr-25", "wyr-100", "wyr-250",
    "first-game", "chess-first-win-him", "chess-first-win-her",
  ])];
  for (const id of ids) {
    const row = momentRecord(id, AT, label);
    ok(`every milestone id has a durable row (${id})`, Boolean(row));
    if (!row) continue;
    ok(`${id} row is telegraphic`, row.summary.length <= 80 && !/^[A-Z]/.test(row.summary) && !/[.!?]$/.test(row.summary), row.summary);
  }

  // TWO DEVICES, ONE MEMORY. Both cross 100 days before syncing; the union of
  // their ledgers must render the milestone once, not twice.
  const a = withActivityRecord([], momentRecord("days-100", AT, label));
  const b = withActivityRecord([], momentRecord("days-100", AT + 40_000, episodeDateLabel(AT + 40_000)));
  const merged = mergeStates(
    { messages: [], activities: a, lastSeen: 0 },
    { activities: b },
  );
  ok("two devices write ONE milestone row", merged.activities.length === 1, JSON.stringify(merged.activities));
}

// ── THE DYAD'S NUMBERS ────────────────────────────────────────────────────
//
// She should know the shape of the relationship in numbers, and every one of
// them must be COUNTED. The row rides the same ledger, which is what puts it
// on every lane inside budgets that already exist.
{
  const FIRST = Date.UTC(2026, 6, 7, 9, 0);
  const NOW2 = FIRST + 47 * DAY + 3 * 3600_000;
  const history = [
    ...msgs(300, FIRST),
    { id: "c1", from: "me", kind: "callmark", text: "12:30", at: FIRST + DAY },
    { id: "c2", from: "me", kind: "callmark", text: "4:12", at: FIRST + 2 * DAY },
    { id: "c3", from: "me", kind: "callmark", text: "", at: FIRST + 3 * DAY }, // unparseable
  ];
  const counts = recordCounts(history, NOW2);
  ok("days is floor, the same number the tiers use", counts.days === 47, String(counts.days));
  ok("callmarks are counted as calls, not messages", counts.callCount === 3 && counts.msgCount === 300,
    `${counts.callCount}/${counts.msgCount}`);
  ok("call seconds come off the callmarks", counts.callSecs === 12 * 60 + 30 + 4 * 60 + 12, String(counts.callSecs));
  ok("an unparseable callmark counts 0 seconds rather than guessing",
    recordCounts([{ id: "x", from: "me", kind: "callmark", text: "banana", at: FIRST }], NOW2).callSecs === 0);

  const row = dyadRecord(counts, { chessGames: 5, tttGames: 1, wyrCards: 41 }, NOW2, episodeDateLabel(FIRST));
  ok("the dyad row exists", Boolean(row));
  ok("keyed once per relationship", row.kind === DYAD_RECORD_KIND && row.startedAt === 0);
  const [head, rest] = row.summary.split(";");
  // FIRST CLAUSE is what the call lane renders (callHistory's callActivityRow
  // cuts there) — days, calls, games, and nothing that would push it over.
  ok("the call clause carries days", /47 days/.test(head), head);
  ok("the call clause carries calls", /3 calls/.test(head), head);
  ok("the call clause carries games", /6 games/.test(head), head);
  ok("the call clause is short enough for the 80-char row cap", head.length <= 60, `${head.length}: ${head}`);
  ok("the chat clause carries the message count", /300 messages/.test(rest), rest);
  ok("the chat clause carries time on calls", /17m on calls/.test(rest), rest);
  ok("the chat clause carries the start date", /talking since 7 jul/.test(rest), rest);
  // "since", never " on 7 jul": the call lane STRIPS an absolute date in that
  // exact shape (STEM_DATE_RE) because it appends its own relative one
  ok("the start date is in a shape the call lane will not eat", !/ on \d{1,2} [a-z]{3}\b/.test(row.summary), row.summary);
  ok("no number is invented when nothing was counted",
    dyadRecord(recordCounts([], NOW2), null, NOW2, "") === null);
  {
    const noCalls = dyadRecord(recordCounts(msgs(10, FIRST), NOW2), null, NOW2, "7 jul");
    ok("a dyad with no calls says nothing about calls", !/call/.test(noCalls.summary), noCalls.summary);
    ok("…and nothing about games", !/game/.test(noCalls.summary), noCalls.summary);
  }

  // ── BOTH LANES, EXISTING BUDGETS ────────────────────────────────────────
  // The point of using the ledger rather than a new block: no lane pays for
  // this. Chat (1,200B, 6 rows) and call (300B, 2 rows) both render it, and
  // the call lane must STILL have room for the newest game beside it — that
  // row is the one "kal wali game" means.
  const game = {
    kind: "chess", startedAt: NOW2 - DAY, closedAt: NOW2 - DAY + 1800_000,
    summary: "a game of chess together on 21 aug — she won, by checkmate; the opening was the italian",
  };
  const ledger = withActivityRecord(
    withActivityRecord([game], momentRecord("days-30", NOW2 - 17 * DAY, episodeDateLabel(NOW2 - 17 * DAY))),
    row,
  );
  const chat = formatActivityLedger(ledger, NOW2);
  const call = formatActivityLedgerForCall(ledger, NOW2);
  ok("chat lane renders the dyad numbers", /their record: 47 days/.test(chat), chat.slice(0, 200));
  ok("chat lane still renders the game", /chess/.test(chat));
  ok("chat lane renders the celebrated milestone", /30 days/.test(chat));
  ok("chat lane stays inside its existing 1200B budget", chat.length <= 1200, String(chat.length));
  ok("call lane renders the dyad numbers", /their record: 47 days/.test(call), call);
  ok("call lane still renders the newest game beside them", /chess/.test(call), call);
  ok("call lane stays inside its existing 300B budget", call.length <= 300, String(call.length));
  console.log(`   ledger bytes — chat ${chat.length}/1200, call ${call.length}/300`);

  // THE COST, STATED. The call block is two rows. The dyad row is always the
  // newest, so it takes one of them — and the game it displaces is the
  // SECOND-newest, never the newest, which is the row "kal wali game" means.
  // That is the trade, and it is pinned here so it stays a decision.
  {
    const older = {
      kind: "ttt", startedAt: NOW - 3 * DAY, closedAt: NOW - 3 * DAY + 600_000,
      summary: "a game of tic tac toe together on 19 aug — it was a draw",
    };
    const two = withActivityRecord(withActivityRecord([older], game), row);
    const c = formatActivityLedgerForCall(two, NOW2);
    ok("the call lane keeps the dyad row AND the newest game",
      /their record/.test(c) && /chess/.test(c), c);
    ok("…and it is the OLDER game that the two-row window drops",
      !/tic tac toe/.test(c), c);
    ok("the chat lane, with six rows, keeps all three", /tic tac toe/.test(formatActivityLedger(two, NOW2)));
  }
}

// ── the writers, read off the source ──────────────────────────────────────
{
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const call = readFileSync(new URL("../src/components/useCallEngine.ts", import.meta.url), "utf8");
  ok("App writes the derived rows into the ledger it already syncs",
    /activities: next/.test(app) && /momentRecord\(/.test(app) && /dyadRecord\(/.test(app));
  ok("a byte-identical row is not rewritten (no rerender per keystroke)",
    /had\.summary === rec\.summary/.test(app));
  ok("the rows are refreshed when the app comes to the front (the midnight roll)",
    /\[dyadSig, frontTick, state\.onboarded\]/.test(app));
  // the "m:ss" this file's parser reads is the string endCall writes — the pin
  // that matters, because a writer change is what would silently zero it
  ok("the callmark format the parser expects is the one endCall writes",
    /String\(secs % 60\)\.padStart\(2, "0"\)/.test(call) && /kind: "callmark", text: mmssStr/.test(call));
}

console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);
