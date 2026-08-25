// What you two already said — the block the CALL lane never had.
//
// ── the defect, in the first external tester's words ──────────────────────
//
//   "Forgot everything i said on the previous call"
//   "usko kuch yaad nahi kal kya baat kiya. But chat me yaad hai"
//
// Both halves of that sentence are true, and the asymmetry is structural
// rather than a memory bug:
//
//   CHAT   brain.ts sends `toTurns(history)` — the last 90 messages — as real
//          conversation turns, and call turns are stored in the same
//          channel-blind store (`channel:"call"`). So yesterday's CALL is
//          literally in the chat model's context, verbatim. She remembers it
//          because she can see it.
//
//   CALL   the live session opens with ZERO turns. Everything she knows has
//          to be in the system instruction, which is compiled ONCE at connect
//          (`liveAssemblies` is asserted to read 1 for the whole call). What
//          that instruction carries about their recent history is exactly two
//          things: graph recall (query-ranked nodes, not a conversation) and
//          `formatChatTail`, which by its own doc EXCLUDES call turns and
//          stops at CHAT_TAIL_WINDOW_MS (30 minutes).
//
// So "what did we talk about yesterday" is unreachable on a call by
// construction: too old for the tail, wrong channel for the tail, and not the
// shape graph recall returns. This module is the missing block.
//
// It is the same species of defect as `realtime-recall-never` and
// `age-tier-never-realtime` — the lane that takes most calls missing what the
// chat lane has — and it is caught the same way those were: by comparing the
// two assemblies rather than by reading either one.
//
// ── what it is NOT ────────────────────────────────────────────────────────
//
// Not a transcript. `recited-prompt` is the expensive law here and this block
// is made of things a person actually said, so it carries `formatChatTail`'s
// three structural defences verbatim in spirit: every row opens with a
// speaker token (so shapelint's first-person and sentence-shaped rules can
// never match), HER rows are capped at shapelint's own MAX_WORDS, and HIS are
// capped looser under the same verbatim-storage allowlist the phrase ledger
// uses. The eval runs the REAL lintBlock over the REAL output.
//
// Not the chat tail either. The two blocks are disjoint BY CONSTRUCTION —
// this one starts where CHAT_TAIL_WINDOW_MS ends — so a line can never be
// paid for twice in a budget that has under 2,000 bytes of headroom.

import type { Message, ShareRecord } from "../state/store";
import {
  ACTIVITY_BLOCK_SENTINEL,
  withoutServerActivityBlock,
  type ActivityRecord,
} from "../engine/memory";
// Imported rather than restated: `age-tier-never-realtime`'s law is that a
// second copy of a rule diverges by not being updated. HER word cap is the
// same cap for the same reason (a line she said is a line she could say
// again), and the window is the seam between the two blocks — if the tail's
// window moves, this block's start must move with it, in one edit.
import { CHAT_TAIL_MAX_WORDS, CHAT_TAIL_WINDOW_MS } from "../engine/memory";
// One vocabulary for what an activity is CALLED — see `boardWord`. Importing
// the table rather than restating it is the same discipline
// `activityPickupLine` states: two spellings of one name is how the pickup and
// the brief end up describing two different games.
import { LABEL } from "../engine/activity";
// The running note's HER-side salience rule. Imported rather than restated for
// `age-tier-never-realtime`'s reason: "what she said she would do" already has
// exactly one definition in this repo and a second one would diverge by not
// being updated. honesty.ts imports nothing at all, so this costs the module
// no dependencies it did not already have.
import { herCommitments } from "../engine/honesty";
// T14 rel.raised's input shape. TYPE ONLY — `raisedRecently` runs inside
// compile(); this module only has to hand it turns in the shape it declares.
import type { RepeatTurn } from "../engine/repeat";

/** Hard ceiling on the rendered block, heading included.
 *
 *  Sized against real headroom, not against what would be nice: measured
 *  2026-08-23, the tightest lane in the repo (`live+watch tail (bound)` in
 *  scripts/check-prompt-budget.mjs) stood at 22,051 of an operational 24,000,
 *  so there were 1,949 bytes to spend across every block anyone adds. 700 of
 *  them is this. `evals/callmem/run.mjs` asserts that arithmetic against the
 *  real bound rather than leaving it as a claim here.
 *
 *  RE-MEASURED after WS-CALLLANE lit T9/T14/T16 on that lane and T4/T12 on
 *  the live one: the same bound stands at 23,782, i.e. 218 spare (the exact
 *  figure moves with persona.ts's tail — read it off the guard, do not trust
 *  this line). This block is the LARGEST single call-lane term in it, so it
 *  is the first place to look if the next block does not fit — and the
 *  guard's own note says that bound omits ~5,900 bytes of relBundle /
 *  selfBundle / activity slots on top of it. */
export const SHARED_HISTORY_BUDGET = 700;

/** Most rows the block ever carries, across both groups. Five is a gist; more
 *  than that is a transcript, and a transcript in a system prompt is a
 *  script (`CHAT_TAIL_ROWS`' reasoning, one notch tighter because these rows
 *  are OLDER and therefore less load-bearing than the pre-call stretch). */
export const SHARED_HISTORY_ROWS = 5;

/** Rows from the previous CALL. The end of a call is what a person carries
 *  from it — how it was left, what was decided — so these are its LAST rows,
 *  never its first. */
export const SHARED_HISTORY_CALL_ROWS = 3;

/** Older than this and it is not "recent shared history" — it is memory, and
 *  the graph is what holds memory. A week keeps "kal" and "parso" reachable
 *  without turning the prompt into an archive. */
export const SHARED_HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** HIS rows: looser than hers, for the reason `chatTailRow` states — his
 *  words are the informative half and their provenance terminates at
 *  something that is not her. Tighter than the tail's 24 because these rows
 *  are competing for the last bytes on the tightest lane in the repo. */
export const SHARED_HISTORY_MAX_WORDS_THEM = 20;

const HEAD =
  "BEFORE TODAY — the last of what you two actually said, on the phone and in chat, oldest first. " +
  "You were both there for it, so it is not news, it never gets read back to them, and being listed here is not a reason to raise it. " +
  "A plan or a mood in it may already have moved on.";

/** "yesterday" / "2 days ago" / "4h ago" — coarse on purpose. The AGE is the
 *  whole signal ("kal kya baat kiya" is a question about a day, not a
 *  timestamp), and a precise time would invite her to quote it back. */
export function agoLabel(atMs: number, nowMs: number): string {
  if (!atMs || !Number.isFinite(nowMs) || nowMs <= atMs) return "";
  const mins = Math.floor((nowMs - atMs) / 60_000);
  if (mins < 90) return "just now";
  const hours = Math.floor(mins / 60);
  if (hours < 20) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days <= 1) return "yesterday";
  return `${days} days ago`;
}

/** The default per-row character cap. Rows are also capped in CHARACTERS, not
 *  only in words.
 *
 *  A word cap alone bounds how much a row can be RECITED; it does not bound
 *  how many bytes it can take, and one pathological turn (a pasted URL, a
 *  transcription that ran twenty words together) could then eat the whole
 *  block and leave nothing — measured in this suite's own worst case, where
 *  a word-capped row came to 590 characters and the drop loop emptied the
 *  block entirely. A block that renders NOTHING under load is the failure
 *  this workstream exists to fix, arriving through the guard against it. */
export const SHARED_HISTORY_MAX_CHARS = 120;

/** The marker a screen-share row carries, and why it carries one at all.
 *
 *  `watchTurnIds`' rule in useCallEngine.ts is that a line said over a shared
 *  screen is CONVERSATION but never durable memory about his life — a glance
 *  at a thread and "Rohit na?" becomes a permanent, confidently wrong claim.
 *  The 2026-08-22 audit's footnote 5 makes the other half of that call: her
 *  share commentary DOES belong in "what you two already said", because from
 *  his side it is simply something she said to him last night.
 *
 *  So these rows are KEPT and MARKED. Marked, not silently mixed in, because
 *  the two readings differ: "you said his manager looked annoyed" is a thing
 *  she saw on a screen, not a thing he told her, and a block whose whole job
 *  is "do not contradict this" must not let her promote the first into the
 *  second. Fifteen bytes, telegraphic and lower-case for the same shapelint
 *  reason the group headers are (`SENTENCE_SHAPED_RE` needs a capital start
 *  and terminal punctuation; this has neither). */
const WATCH_ROW_MARK = " (screen share)";

/** One row: `- them: …` / `- you: …`, word- and char-capped so no row can
 *  read as a line written for her or crowd out every other row. Clipping is
 *  at a word boundary with a visible ellipsis — a clipped row says so rather
 *  than passing a half-sentence off as whole. */
function row(
  who: "them" | "you",
  text: string,
  watched = false,
  maxChars = SHARED_HISTORY_MAX_CHARS,
): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const cap = who === "them" ? SHARED_HISTORY_MAX_WORDS_THEM : CHAT_TAIL_MAX_WORDS;
  // the two tokens of "- who:", plus the two the screen-share marker adds —
  // a marked row must not buy its label with two of his words
  const body = cap - (watched ? 4 : 2);
  const words = flat.split(" ");
  const clippedWords = words.length > body;
  let out = clippedWords ? words.slice(0, body - 1).join(" ") : flat;
  if (out.length > maxChars) {
    // word boundary first; a single unbroken token that is already too long
    // has no boundary to find, so it is cut where it is — a row that says it
    // was clipped is honest either way.
    const kept: string[] = [];
    let n = 0;
    for (const w of out.split(" ")) {
      if (n + w.length + (kept.length ? 1 : 0) > maxChars - 2) break;
      n += w.length + (kept.length ? 1 : 0);
      kept.push(w);
    }
    out = kept.length ? kept.join(" ") : out.slice(0, maxChars - 2);
    return `- ${who}${watched ? WATCH_ROW_MARK : ""}: ${out} …`;
  }
  const mark = watched ? WATCH_ROW_MARK : "";
  return clippedWords ? `- ${who}${mark}: ${out} …` : `- ${who}${mark}: ${out}`;
}

const speakable = (m: Message | undefined): m is Message =>
  Boolean(m && m.kind === "text" && m.text && m.text.trim());

/** Was this turn said over a shared screen?
 *
 *  `Message.watched` is the DURABLE half of the pair useCallEngine.ts keeps.
 *  Its in-call `watchTurnIds` ref is trimmed to the newest 200 ids on a long
 *  session, so on the call this whole workstream is about — a 40-minute one —
 *  the oldest share-derived turns fall out of the set and start reading as
 *  ordinary call turns again. A flag on the message cannot be trimmed. */
const watchedTurn = (m: Message): boolean => m.watched === true;

/**
 * The gist of what came before today, as tail-ready rows. Pure — the clock is
 * an input, for the same reason `compile()` takes `nowMs` and `formatChatTail`
 * takes one: a `Date.now()` in here would make the byte-identity comparison
 * flap on a minute rollover.
 *
 * Two groups, in this order:
 *
 *   1. THE PREVIOUS CALL — the last rows of the most recently ENDED call.
 *      "Ended" is decided by the callmark, which `endCall` writes at hangup:
 *      turns after the newest callmark belong to the call that is happening
 *      right now, and re-feeding a live session its own turns would spend the
 *      budget on context it already has.
 *   2. WHAT WAS TYPED BEFORE THAT — chat turns older than the pre-call
 *      stretch. The window starts where `formatChatTail`'s ends, so the two
 *      blocks are disjoint and no line is paid for twice.
 *
 * Returns "" when there is nothing — which is `compile()`'s render-nothing
 * default for `memories` and therefore byte-identical to today.
 */
export function formatSharedHistory(msgs: readonly Message[], nowMs: number): string {
  const oldest = nowMs - SHARED_HISTORY_MAX_AGE_MS;

  // ── the newest callmark: the boundary between "a call that happened" and
  // "the call that is happening". Absent (no call has ever ended) → group 1
  // renders nothing, which is correct rather than empty-by-accident.
  let markAt = 0;
  let markIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]?.kind === "callmark" && msgs[i]?.at) {
      markAt = msgs[i].at;
      markIdx = i;
      break;
    }
  }

  const callRows: string[] = [];
  let callLabel = "";
  if (markIdx >= 0 && markAt >= oldest) {
    for (let i = markIdx - 1; i >= 0 && callRows.length < SHARED_HISTORY_CALL_ROWS; i--) {
      const m = msgs[i];
      if (m?.kind === "callmark") break; // reached the call before it
      if (!speakable(m) || m.channel !== "call") continue;
      if (!m.at || m.at < oldest) break;
      callRows.unshift(row(m.from === "me" ? "them" : "you", m.text, watchedTurn(m)));
    }
    if (callRows.length) callLabel = agoLabel(markAt, nowMs);
  }

  // ── group 2: typed turns older than the pre-call stretch ──────────────
  const chatRows: string[] = [];
  const chatFrom = nowMs - CHAT_TAIL_WINDOW_MS;
  const roomForChat = Math.max(0, SHARED_HISTORY_ROWS - callRows.length);
  let chatLabel = "";
  for (let i = msgs.length - 1; i >= 0 && chatRows.length < roomForChat; i--) {
    const m = msgs[i];
    if (!speakable(m) || m.channel === "call") continue;
    if (!m.at || m.at < oldest) break;
    if (m.at >= chatFrom) continue; // the chat tail already carries this one
    chatRows.unshift(row(m.from === "me" ? "them" : "you", m.text, watchedTurn(m)));
    if (!chatLabel) chatLabel = agoLabel(m.at, nowMs);
  }

  if (!callRows.length && !chatRows.length) return "";

  // Group headers are telegraphic and lower-case on purpose: shapelint's
  // SENTENCE_SHAPED_RE needs a capital start AND terminal punctuation, and
  // FIRST_PERSON_LINE_INITIAL_RE needs her pronoun — neither can match a line
  // that opens with "on your call".
  const lines: string[] = [];
  if (chatRows.length) {
    lines.push(`in chat${chatLabel ? ` (${chatLabel})` : ""}:`);
    lines.push(...chatRows);
  }
  if (callRows.length) {
    lines.push(`on your call${callLabel ? ` (${callLabel})` : ""}, how it was left:`);
    lines.push(...callRows);
  }

  // Over budget, drop WHOLE rows from the oldest, taking a group header with
  // the last row under it. "A sliced block is a lie" is this repo's drop rule
  // and it does not stop applying inside a block
  // (`activity-block-sliced-mid-word`).
  let kept = lines;
  const size = (ls: string[]) => HEAD.length + 1 + ls.join("\n").length;
  while (kept.length && size(kept) > SHARED_HISTORY_BUDGET) {
    // drop the first content row; if that leaves a header with nothing under
    // it, drop the header too
    const firstRow = kept.findIndex((l) => l.startsWith("- "));
    if (firstRow < 0) return "";
    kept = [...kept.slice(0, firstRow), ...kept.slice(firstRow + 1)];
    if (kept.length && !kept.some((l) => l.startsWith("- "))) return "";
    for (let i = kept.length - 1; i >= 0; i--) {
      const isHeader = !kept[i].startsWith("- ");
      const nextIsRow = kept[i + 1]?.startsWith("- ");
      if (isHeader && !nextIsRow) kept = [...kept.slice(0, i), ...kept.slice(i + 1)];
    }
  }
  if (!kept.some((l) => l.startsWith("- "))) return "";
  return `${HEAD}\n${kept.join("\n")}`;
}

// ── THE JUST-HAPPENED BLOCK (WS-SHARENOW) ─────────────────────────────────
//
// The owner's report, and it is the sharpest one this file has had: he shared
// his screen with her, hung up, called back ONE MINUTE later and asked what
// they had just watched. She did not know, and (his words) probably made
// something up.
//
// ── WHY THE BLOCK ABOVE DOES NOT ANSWER IT ───────────────────────────────
//
// `formatSharedHistory` DOES carry share commentary, marked, and its eval
// proves it (section 5e). It still cannot answer this question, for three
// reasons that stack:
//
//   1. IT IS A HOW-IT-WAS-LEFT WINDOW, NOT A WHAT-WE-DID RECORD. Group 1 takes
//      the LAST `SHARED_HISTORY_CALL_ROWS` (3) turns before the callmark. In
//      the owner's shape the share ends, they talk for another minute, and
//      then he hangs up — so those three rows are spent on the small talk
//      AFTER the share and two of her three commentary lines are simply not in
//      the prompt. Measured on the fixture in `evals/callmem` §5f: three
//      commentary lines in, one out.
//   2. ITS HEADING TELLS HER NOT TO USE IT. `HEAD` opens "BEFORE TODAY" — for
//      something sixty seconds old — and then says, correctly for its own
//      purpose, "it is not news, it never gets read back to them, and being
//      listed here is not a reason to raise it." That is exactly the wrong
//      instruction in front of a direct question about it.
//   3. NOTHING ELSE LOCAL CARRIES IT AT ALL. `formatChatTail` excludes call
//      turns by design, so it renders "" here; the graph route needs the
//      server (`vy_shared_moment` via `api/episodes.js`), which is written
//      fire-and-forget, gated to the first line she speaks inside a 12-second
//      SHOW-wake window, and read back by a leg that matches her reaction text
//      against words taken from the last four things HE typed — and then only
//      if the ring fetch beats `RING_FETCH_DEADLINE_MS`.
//
// So the freshest, most vivid thing that ever happens between them was the one
// thing the brief could not say. This block is the answer, and it is the same
// species of fix as everything above it: a block that exists on one lane and
// is missing on the one that took the call.
//
// ── WHAT IT IS ───────────────────────────────────────────────────────────
//
// A compact "you two JUST did this" row, ABOVE the shared history, rendering
// only inside `JUST_HAPPENED_WINDOW_MS`. For a share it carries HER OWN LINES
// and the fact that they were watching his screen together until N minutes
// ago. It never carries a word about what was ON the screen.
//
// That last sentence is the watch-content contract and it is not a nicety:
// `Message.watched`'s rule is that screen-derived talk is conversation and
// never durable memory about his life, because one glance at a thread and
// "Rohit na?" becomes a permanent, confidently wrong claim. Her reactions are
// hers to remember — she said them, they are true regardless of whether the
// reading behind them was, and this is precisely why `vy_shared_moment` stores
// a reaction with a NULLABLE assertion_id. The screen's contents beyond what
// she said are not re-derived here or anywhere.
//
// ── AND THE HONEST HALF ──────────────────────────────────────────────────
//
// A share where she said nothing produces an EMPTY record, and an empty record
// is a real answer rather than a gap to fill. The block says so in words, so
// the honest line ("haan dekha, par maine kuch bola nahi tha") is the one the
// brief actually supports and the invented one has nothing behind it. This is
// `formatActivityLedgerForCall`'s fence argument on a lane where it matters
// more: `honesty.ts`'s family-6 gate cannot run on the live lane at all, so
// the prompt fence is the only protection there is.

/** How fresh "just" is. Forty-five minutes, and it is not a taste number: it
 *  is `api/episodes.js`'s own `GAP_MS`, the boundary the server segments
 *  episodes on. Past it the server has closed the episode and the thing has
 *  stopped being the present moment for both halves of the product at once, so
 *  the two agree by construction instead of by coincidence. */
export const JUST_HAPPENED_WINDOW_MS = 45 * 60_000;

/** Hard ceiling on the rendered block, heading included.
 *
 *  THE ARITHMETIC, measured 2026-08-23 against the real guard rather than
 *  claimed: `scripts/check-prompt-budget.mjs` puts the tightest lane in the
 *  repo — `live+watch tail (bound)` — at 29,684 of a `CALL_TAIL_CAP` of
 *  30,000, i.e. 316 bytes spare, and `live tail (bound)` at 29,382, i.e. 618.
 *  300 of them is this, leaving 16 and 318. `evals/callmem/run.mjs` asserts
 *  that subtraction against the guard's own constants, so the bound and its
 *  budget cannot drift apart — which is how the crisis helplines were lost
 *  once.
 *
 *  It is deliberately the tightest block on the lane. Everything it must
 *  carry is three short sentences somebody actually said; anything that needs
 *  more room than that is not "what just happened", it is history, and the
 *  700-byte block below is what holds history. */
export const JUST_HAPPENED_BUDGET = 300;

/** Rows of her own commentary the block ever carries. Three is a person
 *  remembering a shared minute; more is a transcript of one, and a transcript
 *  in a system prompt is a script (`SHARED_HISTORY_ROWS`' reasoning). */
export const JUST_HAPPENED_ROWS = 3;

/** Per-row character cap, tighter than `SHARED_HISTORY_MAX_CHARS` because this
 *  block has less than half the budget. Sized so that two MAXIMAL rows still
 *  fit under `JUST_HAPPENED_BUDGET` alongside both headings (78 + 1 + 78 + 1 +
 *  74 + 73 = 305 at 66… see the eval, which measures the real worst case
 *  rather than trusting this line) and real commentary — which runs 30-50
 *  characters — fits three times over. */
export const JUST_HAPPENED_MAX_CHARS = 66;

/** "just now" / "3 min ago" — MINUTES, unlike `agoLabel`, and the difference
 *  is the point of the block. `agoLabel` is coarse because the age is the
 *  whole signal for something a day old ("kal kya baat kiya" is a question
 *  about a day); here the age is the CLAIM — "we were watching this together
 *  three minutes ago" is a different sentence from "we were watching this
 *  together", and the number is what makes it one. Still no seconds and no
 *  timestamp: there is nothing here she could quote back as a clock. */
export function minsAgoLabel(atMs: number, nowMs: number): string {
  if (!atMs || !Number.isFinite(atMs) || !Number.isFinite(nowMs) || nowMs < atMs) return "";
  const mins = Math.floor((nowMs - atMs) / 60_000);
  return mins < 1 ? "just now" : `${mins} min ago`;
}

// Lower-case after the opening token and terminated with a colon, for
// `HEAD`'s reason: shapelint's SENTENCE_SHAPED_RE needs a capital start AND
// terminal `.?!`, so a line ending in ":" can never match, and there is
// nothing in it she could say. "add nothing to it" is the watch-content fence,
// stated once here rather than per row.
const JUST_HEAD =
  "JUST NOW — this just happened and they may ask straight out; add nothing to it:";

/** The share line, in both of its forms. The second one is the honest half and
 *  it is a POSITIVE statement, not an absence: a share she was quiet through
 *  is a thing she knows about itself, and saying so is what makes "haan dekha,
 *  par maine kuch bola nahi tha" the supported answer instead of the invented
 *  one. */
const shareLine = (label: string, said: boolean) =>
  said
    ? `you were watching their screen together till ${label}; you said this about it:`
    : `you were watching their screen together till ${label}; you said nothing about it, and what was on it is not yours to describe`;

interface JustEvent {
  head: string;
  rows: string[];
}

/**
 * What the two of them JUST did, as a call-sized block, or "" when nothing has
 * happened inside the window — which is `memories`' render-nothing default, so
 * a person whose last share was yesterday gets byte-identically the prompt they
 * get today.
 *
 * Pure; the clock is an input, the same contract as everything else in this
 * file and for the same byte-identity reason.
 *
 * Three sources, in a fixed PRIORITY order rather than in recency order, and
 * the difference matters: the callmark is written at hangup and is therefore
 * always the newest event, so recency ordering would spend the budget on "you
 * were on a call" and drop the share rows that are the entire reason the block
 * exists.
 *
 *   1. THE SHARE, from the local mirror (`AppState.shares`) — her own lines.
 *   2. THE GAME, from the local activity ledger — a POINTER, not a second
 *      rendering. `warm-count-unscoped`: two derivations of one record
 *      eventually disagree, invisibly, so the game's detail stays in the one
 *      block that owns it and this only says it was minutes ago.
 *   3. THE CALL that just ended, from the newest callmark — and only when
 *      there is no share line, which would already have said it better.
 */
export function formatJustHappened(
  shares: readonly ShareRecord[] | undefined,
  activities: readonly ActivityRecord[] | undefined,
  msgs: readonly Message[],
  nowMs: number,
): string {
  const since = nowMs - JUST_HAPPENED_WINDOW_MS;
  const fresh = (at: number | undefined) =>
    Number.isFinite(at) && (at as number) > since && (at as number) <= nowMs;

  const events: JustEvent[] = [];

  // 1 — the newest ENDED share
  const share = [...(shares ?? [])]
    .filter((s) => s && fresh(s.endedAt))
    .sort((a, b) => b.endedAt - a.endedAt)[0];
  if (share) {
    const said = (Array.isArray(share.said) ? share.said : [])
      .filter((t) => typeof t === "string" && t.trim())
      .slice(-JUST_HAPPENED_ROWS);
    events.push({
      head: shareLine(minsAgoLabel(share.endedAt, nowMs), said.length > 0),
      rows: said.map((t) => row("you", t, false, JUST_HAPPENED_MAX_CHARS)),
    });
  }

  // 2 — the newest finished game, as a pointer at the record that holds it
  const game = [...(activities ?? [])]
    .filter((r) => r && r.summary && fresh(r.closedAt))
    .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0))[0];
  if (game) {
    events.push({
      head: `you finished a game together ${minsAgoLabel(game.closedAt, nowMs)} — the record below is all of it`,
      rows: [],
    });
  }

  // 3 — the call that just ended, when the share line has not already said it
  if (!share) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m?.kind !== "callmark" || !m.at) continue;
      if (fresh(m.at)) {
        events.push({ head: `you were on a call together till ${minsAgoLabel(m.at, nowMs)}`, rows: [] });
      }
      break;
    }
  }

  if (!events.length) return "";

  const render = (evs: readonly JustEvent[]) => evs.flatMap((e) => [e.head, ...e.rows]);
  const size = (ls: readonly string[]) => JUST_HEAD.length + 1 + ls.join("\n").length;

  // Over budget, WHOLE lines go — never a slice (`activity-block-sliced-mid-word`,
  // and "a sliced block is a lie" does not stop applying inside a block).
  // Trailing EVENTS go first: they are the lower-priority ones by construction,
  // and each is a self-contained sentence, so losing one costs a fact rather
  // than leaving a heading pointing at nothing.
  const kept = events.slice();
  while (kept.length > 1 && size(render(kept)) > JUST_HAPPENED_BUDGET) kept.pop();
  // Then her OLDEST commentary rows, keeping the newest — the last thing she
  // said about a screen is the thing "kya dekha humne" most often means.
  while (size(render(kept)) > JUST_HAPPENED_BUDGET) {
    const withRows = kept.find((e) => e.rows.length);
    if (!withRows) break;
    withRows.rows.shift();
    // a head that promised rows and now has none would be a dangling claim;
    // re-state it in its no-record form, which is true either way
    if (!withRows.rows.length && withRows.head.endsWith("; you said this about it:")) {
      withRows.head = withRows.head.replace(
        "; you said this about it:",
        "; nothing you said about it fits here, so add none of it",
      );
    }
  }
  const lines = render(kept);
  if (!lines.length || size(lines) > JUST_HAPPENED_BUDGET) return "";
  return `${JUST_HEAD}\n${lines.join("\n")}`;
}

// ── WHAT THE FROZEN COMPILE SITES ARE HANDED (P1-7 / P1-9) ────────────────
//
// Two derivations that used to be absent rather than wrong. They live here,
// beside their eval, rather than inside useCallEngine.ts for the reason
// `selfbundle-never-set` records: a rule that lives only inside a hook is a
// rule no eval can drive, and both of these are rules about HISTORY, which is
// this module's whole subject.

/** The last thing HE typed before dialling, or "" — the call lane's stand-in
 *  for moment.ts's "current user turn".
 *
 *  The compile sites passed "" here forever, which was correct about a pickup
 *  having no turn and wrong about the consequence: `momentGate("")` is moment
 *  "none", and both `renderDyadicActive` (T4) and `renderSelfArc` (T12) return
 *  "" on moment "none". Two slots that render in chat rendered zero bytes on
 *  every call this product has ever taken.
 *
 *  Three conditions, each of them load-bearing:
 *
 *    • HIS turn. Her own line is never a pull signal (moment.ts's law).
 *    • TYPED, not spoken, and never said over a shared screen: a call turn
 *      belongs to a call that has already ended, and a share turn is a
 *      reaction to a screen rather than something he said to her.
 *    • FRESH. `CHAT_TAIL_WINDOW_MS` is this repo's own definition of "still
 *      this conversation" and it is the seam `formatSharedHistory` starts at,
 *      so using it here keeps one boundary rather than inventing a second. A
 *      cold pickup after a day of silence still yields "", which is what keeps
 *      the 0-unprompted-raises property byte-identical on exactly the calls
 *      where there is nothing to be pulled FROM. */
export function preCallUserText(msgs: readonly Message[], nowMs: number): string {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (!m || m.kind !== "text" || m.from !== "me") continue;
    if (m.channel === "call" || m.watched === true) continue;
    if (!m.text?.trim()) continue;
    return m.at && nowMs - m.at <= CHAT_TAIL_WINDOW_MS ? m.text : "";
  }
  return "";
}

/** What T14 `rel.raised` is computed from on the call lanes.
 *
 *  `raisedRecently` drops call turns itself (`t.channel !== "call"`), so this
 *  hands over the store and lets the ONE rule decide — the same shape
 *  brain.ts's chat call site uses (`recentTurns: history`). It is a named
 *  function only so the two frozen-prompt compile sites cannot pass two
 *  different things: P1-9 is a slot rendering on one lane and silently
 *  emptying on another, and two call sites shaping their own input is how
 *  that starts. */
export function callRecentTurns(msgs: readonly Message[]): RepeatTurn[] {
  return msgs
    .filter((m) => m.kind === "text" && Boolean(m.text?.trim()))
    .slice(-CALL_RECENT_TURNS)
    .map((m) => ({
      from: m.from,
      text: m.text,
      channel: m.channel === "call" ? ("call" as const) : ("chat" as const),
    }));
}

/** Turns handed to T14. Twice `REPEAT_WINDOW` (30), because `raisedRecently`
 *  takes its window AFTER dropping call turns — hand it exactly 30 and a call
 *  in the middle of them silently shortens the window it was given. */
const CALL_RECENT_TURNS = 60;

// ── THE RUNNING NOTE — what survives the server's sliding window ──────────
//
// The tester's second report: *"Hallucinating over long lasting conversations
// and forgetting what she said or what I told her early on as part of the
// conversation."*
//
// That is not a memory-layer defect at all; it is the live session doing
// exactly what it was configured to do. `liveCall.ts`'s setup block sets
// `contextWindowCompression: { slidingWindow: {} }`, which keeps a long call
// ALIVE by dropping its OLDEST turns — so on a long call the first ten minutes
// leave the session while she is still talking, and nothing in the product
// ever put them back. She then contradicts something he told her at the start,
// which is precisely what "hallucinating over long conversations" looks like
// from the other side of the phone.
//
// The bounded fix is to say the beginning again, as CONTEXT (`direct(…,
// { silent: true })` — turnComplete:false, so it is appended and never
// answered). Two properties make this the right shape rather than a clever
// one:
//
//   • it carries the HEAD of the call, not the tail. The tail is still in the
//     window by definition; the head is the part that left. A "summary of the
//     conversation so far" would spend its bytes on what she already has.
//   • it is re-sent on a period, so the newest copy always sits near the END
//     of the window — the part compression keeps. A note sent once would be
//     dropped by the same mechanism it exists to answer.
//
// It is NOT a summary produced by a model: that would be a second brain with
// its own opinions about what mattered (`mirror-persona`'s failure, one level
// down), it would cost a call-path round trip, and it could invent. These are
// his and her own words, capped and prefixed, exactly like every other block
// in this file.
//
// ── WHY IT IS NO LONGER THE HEAD ALONE (P1-5) ─────────────────────────────
//
// The first version of this function carried `usable.slice(0, 8)` — the same
// eight turns, forever. That is correct for the first ten minutes of a call
// and then it stops being correct in a way nothing could see: on a
// thirty-five minute call the note re-sent at minute 32 still describes
// minute 1, so everything between minute 2 and minute 32 falls out of the
// server's sliding window and is never put back by anything. The fix it was
// meant to be was working exactly as far as its own window and no further.
//
// So the note is now a SLIDING DIGEST with two parts, and the split is the
// whole design:
//
//   • THE ANCHOR — the first `RUNNING_NOTE_HEAD_TURNS` turns, always, in
//     order. This is what the old note was and it is still the most
//     load-bearing part: the reason he called lives there, and it is the
//     stretch the server dropped first.
//   • THE SPREAD — salient turns sampled ACROSS the rest of the call, one per
//     equal-width bucket, so coverage widens as the call goes on instead of
//     sliding off its own front. Bucketing rather than "the newest N" is the
//     mechanism: keeping the newest salient turns would evict minute 3 by
//     minute 40, which is the same amnesia one level up.
//
// The freshest turns are excluded on purpose (`RUNNING_NOTE_FRESH_TAIL`):
// they are still inside the server's window by definition, so a row spent on
// them is a row spent on context she already has.
//
// SALIENCE IS NOT SUMMARISATION. Nothing is rewritten, condensed or judged —
// a turn is either carried verbatim (capped) or not carried. HER side is
// decided by `herCommitments`, the repo's one definition of "what she said
// she would do", imported rather than restated. HIS side is decided by a
// narrow local rule: long enough not to be a backchannel, not a question
// (a question is answered by the next turn, and the answer is the fact), and
// scored up when it carries a name, a number or a feeling. Ties inside a
// bucket go to the EARLIER turn, because the earlier one left the window
// first.

/** Total rows the note ever carries. Unchanged from the head-only version:
 *  this is an uplink bound, and widening coverage must not widen the frame. */
export const RUNNING_NOTE_TURNS = 8;
/** The anchor. Four turns is roughly the first minute — the name of the thing
 *  he called about — and it leaves half the note for the spread. */
export const RUNNING_NOTE_HEAD_TURNS = 4;
/** Turns at the live end that are NOT eligible for the spread: the session
 *  still holds these, so carrying them buys nothing. */
export const RUNNING_NOTE_FRESH_TAIL = 4;
/** Below this there is no head to lose yet, and a note would be a duplicate
 *  of context the session still has in full. */
export const RUNNING_NOTE_MIN_TURNS = 6;
/** Hard ceiling. This is not prompt budget — it never enters the system
 *  instruction — but it IS uplink on a live socket, where `liveCall.ts` sheds
 *  video to protect her audio. A note that could grow with the call would be
 *  the one client-side write on this lane that is not bounded. */
export const RUNNING_NOTE_BUDGET = 900;

/** Below this a turn is a backchannel ("haan", "achha theek hai") and there is
 *  nothing in it to contradict later. */
const HIS_MIN_WORDS = 4;

/** A question is not a fact. What he asked is answered by the next turn, and
 *  that answer is the thing worth carrying — so an interrogative turn scores
 *  zero rather than spending a row on its own premise. */
const QUESTION_RE =
  /\?\s*$|^(?:kya|kaun|kahan|kahaan|kab|kaise|kaisa|kaisi|kitna|kitne|kitni|why|what|who|where|when|how|which|do|does|did|is|are|can|will)\b|\b(?:batao|bataiye|bata\s+do|kya\s+lagta\s+hai|hai\s+kya)\b/i;

/** A capitalised token that is actually a NAME.
 *
 *  Position is not the discriminator, and the first version of this used it as
 *  one — requiring the capital to be mid-utterance, so "Rohit wala sprint plan
 *  badal gaya" scored as having no name in it (measured, and it is the exact
 *  sentence this whole workstream is about). On a transcript the first token is
 *  capitalised whatever it is, so what is needed is the small closed set of
 *  capitalised tokens that are NOT names — her own name included, since she is
 *  never a thing to look up or a fact to contradict. */
const CAP_TOKEN = /\b([A-Z][a-z]{2,})\b/g;
const NOT_A_NAME = new Set([
  // WS-MAYA: her own name is in this set because she is never a thing to look
  // up. Both spellings stay — stored transcripts predating the rename still
  // carry the old one, and dropping it would make those turns score as naming
  // a person.
  "Maya", "Meera", "Haan", "Nahi", "Acha", "Accha", "Achha", "Theek", "Arre", "Arey",
  "Yaar", "Bhai", "Okay", "Yeah", "Hello", "Hmm", "Sorry", "Please", "Thanks",
  "Good", "Morning", "Night", "Bhi", "Kya", "Toh", "Abhi", "Aaj", "Kal",
  "Mera", "Meri", "Mere", "Tera", "Teri", "Tumhara", "Main", "Hum", "Woh",
  "The", "That", "This", "But", "And", "You", "Just", "Like", "Yes", "Not",
]);
function hasName(text: string): boolean {
  for (const m of text.matchAll(CAP_TOKEN)) if (!NOT_A_NAME.has(m[1])) return true;
  return false;
}

/** A name, a place, a number, a date — the things a later turn can flatly
 *  contradict. */
const NAMED_RE = /\d/;

/** …and the other half of "do not contradict this": how he said he was. */
const FEELING_RE =
  /\b(thak|thaka|thaki|pareshan|tension|stress|stressed|khush|dukh|udaas|gussa|gusse|dar|darr|akela|lonely|bore|bored|miss|excited|nervous|anxious|upset|angry|sad|happy|tired|scared|worried|guilty|relieved|proud)\b/i;

/** How much a turn is worth carrying, 0 meaning "not salient at all".
 *
 *  Deliberately coarse — three bands, not a model. A finer score would be a
 *  judgement about what mattered in his call, which is the second-brain
 *  failure this whole block is written to avoid. */
function salience(m: Message, herCommitAt: ReadonlySet<number>): number {
  if (m.from === "her") return herCommitAt.has(m.at || 0) ? 3 : 0;
  const flat = (m.text || "").replace(/\s+/g, " ").trim();
  if (flat.split(" ").length < HIS_MIN_WORDS) return 0;
  if (QUESTION_RE.test(flat)) return 0;
  return 1 + (NAMED_RE.test(flat) || hasName(flat) ? 2 : 0) + (FEELING_RE.test(flat) ? 2 : 0);
}

/** A turn has to be worth a row, not merely eligible for one. Score 1 is "a
 *  sentence he said"; 2 and up is "a sentence with something in it that a
 *  later turn could flatly contradict" — a name, a number, a feeling, or a
 *  promise of hers. The spread pass takes only these, so a bucket full of
 *  "achha theek hai yaar" yields its row to a fact somewhere else. */
const SALIENT_FLOOR = 2;

/**
 * Indices of the salient turns to carry from `window`, in chronological order,
 * never more than `want`.
 *
 * TWO PASSES, and the order between them is the whole rule:
 *
 *   1. SPREAD — one pick per equal-width bucket, highest score, and only at or
 *      above `SALIENT_FLOOR`. This is what makes the note advance: coverage is
 *      forced across the call rather than concentrated at either end.
 *   2. FILL — the best of what is left, anywhere in the window. Without this,
 *      a bucket with nothing worth carrying would spend its row on filler
 *      while a real fact two buckets over went unpicked, which is how a
 *      promise she made at minute 18 got evicted by "haan" (measured).
 *
 * Equal-width buckets over the INDEX range rather than over the clock: the
 * clock is not an input here (this function is pure and the caller owns the
 * period), and turn index is the only monotone thing it has. On a call whose
 * turns are evenly paced the two are the same thing.
 *
 * Ties go to the EARLIER turn throughout — it is the one the server's window
 * dropped first, and it is also what makes the note stable across re-sends.
 */
function spreadSalient(
  window: readonly Message[],
  want: number,
  herCommitAt: ReadonlySet<number>,
): number[] {
  if (want <= 0 || !window.length) return [];
  const score = window.map((m) => salience(m, herCommitAt));
  const picked = new Set<number>();
  const buckets = Math.min(want, window.length);
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor((b * window.length) / buckets);
    const to = Math.floor(((b + 1) * window.length) / buckets);
    let best = -1;
    let bestScore = SALIENT_FLOOR - 1;
    for (let i = from; i < to; i++)
      if (score[i] > bestScore) {
        bestScore = score[i];
        best = i;
      }
    if (best >= 0) picked.add(best);
  }
  if (picked.size < want) {
    const rest = window
      .map((_, i) => i)
      .filter((i) => !picked.has(i) && score[i] >= SALIENT_FLOOR)
      .sort((a, b) => score[b] - score[a] || a - b);
    for (const i of rest) {
      if (picked.size >= want) break;
      picked.add(i);
    }
  }
  return [...picked].sort((a, b) => a - b);
}

const NOTE_HEAD =
  "not spoken by them — this is YOUR OWN memory of this call: how it started, and the parts a long call " +
  "loses. Do not answer this, do not read it out, do not raise it on its own. Just do not contradict it.";

/**
 * The call so far as a silent context note, or "" when there is not enough
 * call yet to have lost anything.
 *
 * Pure and total: the caller decides WHEN (a period, a live session, a turn
 * floor) and this decides WHAT. Angle brackets, never square — bracket-shaped
 * text on this lane is speakable (`ack-bracket-direction`: "[laughs softly]"
 * came back as laughter plus the spoken word "Softly"), and every note this
 * file's callers send rides the same frame her own tokens do.
 */
export function formatRunningNote(turns: readonly Message[]): string {
  // Share turns are excluded HERE as well as at the call site, and the
  // duplication is deliberate: `watchTurnIds`' rule is sharper for this block
  // than for any other (a wrong reading of his screen re-injected as her own
  // memory is a wrong claim she then defends), and a second caller that
  // forgot the filter would be invisible. `formatSharedHistory` is the one
  // block that KEEPS them, marked — see WATCH_ROW_MARK for why the two
  // answers differ.
  const usable = turns.filter((m) => speakable(m) && !watchedTurn(m));
  if (usable.length < RUNNING_NOTE_MIN_TURNS) return "";
  // the freshest turns are still inside the server's window; never spend a row
  // on them. The anchor is never given up to this rule.
  const older = usable.slice(
    0,
    Math.max(RUNNING_NOTE_HEAD_TURNS, usable.length - RUNNING_NOTE_FRESH_TAIL),
  );
  const herCommitAt = new Set(herCommitments(older).map((c) => c.at));

  const keep = new Set<number>();
  for (let i = 0; i < Math.min(RUNNING_NOTE_HEAD_TURNS, older.length); i++) keep.add(i);
  const middle = older.slice(RUNNING_NOTE_HEAD_TURNS);
  for (const i of spreadSalient(middle, RUNNING_NOTE_TURNS - keep.size, herCommitAt))
    keep.add(i + RUNNING_NOTE_HEAD_TURNS);
  // Nothing salient to sample (a short call, or a stretch of pure back and
  // forth) — the anchor simply extends forward, which is byte-for-byte what
  // this function did before the digest existed.
  for (let i = RUNNING_NOTE_HEAD_TURNS; i < older.length && keep.size < RUNNING_NOTE_TURNS; i++)
    keep.add(i);

  const rows = [...keep]
    .sort((a, b) => a - b)
    .map((i) => row(older[i].from === "me" ? "them" : "you", older[i].text));
  let kept = rows;
  const size = (rs: string[]) => NOTE_HEAD.length + rs.join("\n").length + 20;
  // drop from the END: the anchor is the point, and the newest spread rows are
  // the ones the session is likeliest to still be holding
  while (kept.length > RUNNING_NOTE_MIN_TURNS && size(kept) > RUNNING_NOTE_BUDGET)
    kept = kept.slice(0, -1);
  while (kept.length && size(kept) > RUNNING_NOTE_BUDGET) kept = kept.slice(0, -1);
  if (!kept.length) return "";
  return `<context: ${NOTE_HEAD}\n${kept.join("\n")}\nend of note — say nothing about it>`;
}

// ── THE MID-CALL RE-QUERY (P0-2) ──────────────────────────────────────────
//
// The audit's example: *"asked about Rohit at minute 20, and the ring query
// was about the weather."*
//
// The live prompt is compiled ONCE at connect (`liveAssemblies` is asserted to
// read 1 for the whole call) and the one memory lookup this lane makes is
// fired during the RING, against the last four things he typed. So everything
// she can retrieve on a call was decided before he said a word on it. A name
// he raises twenty minutes in cannot reach her by any route: the ring query
// could not have anticipated it, the prompt cannot be recompiled, and the
// live lane has no tool call it can make (see liveLookup.ts's header for why).
//
// The mechanism that DOES exist is the one the running note above rides: a
// silent `direct(…, { silent: true })` frame, appended to the turn context and
// never answered. So a strong memory cue fires ONE bounded background recall
// and the top rows arrive the same way the running note does.
//
// The two functions below are the pure halves — what counts as a cue, and what
// the note looks like. The fuse, the rate limit and the fetch live at the call
// site in useCallEngine.ts, exactly as `shouldLookUp`/`callLookup` split.

/** Hard ceiling on the note. Half the running note's, because this one lands
 *  INSIDE a turn he is waiting on: it is uplink competing with her audio at
 *  the worst possible moment, and three rows is the whole useful answer. */
export const MEMORY_NOTE_BUDGET = 500;

/** Rows carried from the recall block. Three is "the thing he asked about,
 *  plus what it was attached to"; more is a file being read out. */
export const MEMORY_NOTE_ROWS = 3;

/** He asked her to remember something, in so many words. A closed list rather
 *  than a heuristic: these are the shapes that are unambiguously about the
 *  past between the two of them, so nothing here needs a threshold. (The
 *  NAME path below is the loose half, and `readsAsMemoryCue` explains why the
 *  two halves are allowed to differ.) */
const RECALL_CUE =
  /\b(?:yaad\s+(?:hai|h|hain|aaya|aayi|nahi)\b|yaad\s+dila|bhool\s+ga|bhul\s+ga|remember|remembered\b|wo\s+wali|woh\s+wali|us\s+din|uss\s+din|pichli\s+baar|last\s+time|maine\s+bataya\s+tha|maine\s+bola\s+tha|tune\s+bola\s+tha|tumne\s+bola\s+tha|i\s+told\s+you|you\s+said|we\s+talked\s+about|humne\s+baat\s+ki)/i;

/**
 * Is this spoken turn a memory cue the ring query could not have anticipated?
 * Pure, local, no network — `shouldLookUp`'s exact contract.
 */
export function readsAsMemoryCue(said: string): boolean {
  const s = String(said || "").trim();
  if (s.length < 8 || s.length > 240) return false;
  if (RECALL_CUE.test(s)) return true;
  // …or he named someone. `hasName` is the running note's own rule, shared
  // rather than restated: a NAME is precisely the query the ring could not
  // have guessed, and it is the same notion of "name" in both places.
  //
  // ── THIS ONE FAVOURS RECALL, AND `shouldLookUp` DOES NOT ─────────────
  // The lookup's trigger is narrow because a false fire ships an intimate
  // sentence to a search index. Nothing leaves the device here that has not
  // already left it: the query goes to the SAME api/memory endpoint the ring
  // fetch already posted the last four things he typed to. So the two costs
  // are not comparable and neither should the thresholds be.
  //
  // What a false fire actually costs: one ~165ms round trip off the call
  // path, at most three per call and no closer together than a minute, and a
  // silent frame whose own text tells her to use it only if it answers what
  // was asked. What a false MISS costs is the audit's sentence — "Rohit ke
  // saath meeting kaisi gayi" at minute 20, unanswerable — which is the whole
  // defect. A transcriber capitalises the first word of an utterance whatever
  // it is, so requiring the capital to be mid-sentence was measured to refuse
  // exactly that example; position is not the discriminator, the STOP LIST is.
  return hasName(s);
}

const MEMORY_NOTE_HEAD =
  "not spoken by them — this just came back to you mid-call. Never read it out, never say you remembered " +
  "something; just do not contradict it, and use it only if it answers what they actually asked:";

/**
 * The top rows of a recall block as a silent context note, or "" when the
 * lookup came back with nothing worth saying.
 *
 * Rows only — the recall string's own block HEADINGS are dropped. They are
 * written for a system instruction ("THINGS YOU KNOW ABOUT THEM…") and this
 * frame arrives as a user turn mid-conversation, where a heading is 60 bytes
 * of instruction she has already been given once.
 */
export function formatMemoryNote(memories: string): string {
  const rows = String(memories || "")
    .split("\n")
    .filter((l) => l.trim().startsWith("- "))
    .slice(0, MEMORY_NOTE_ROWS)
    .map((l) => {
      const t = l.trim().slice(2).replace(/\s+/g, " ").trim();
      return `- ${t.length > SHARED_HISTORY_MAX_CHARS ? `${t.slice(0, SHARED_HISTORY_MAX_CHARS - 2)} …` : t}`;
    });
  let kept = rows;
  const size = (rs: string[]) => MEMORY_NOTE_HEAD.length + rs.join("\n").length + 20;
  // whole rows from the END, never a slice — `activity-block-sliced-mid-word`
  while (kept.length && size(kept) > MEMORY_NOTE_BUDGET) kept = kept.slice(0, -1);
  if (!kept.length) return "";
  return `<context: ${MEMORY_NOTE_HEAD}\n${kept.join("\n")}\nend of note — say nothing about it>`;
}

// ── THE RING THAT MISSED ITS DEADLINE (P1-4) ──────────────────────────────
//
// `RING_FETCH_DEADLINE_MS` raced a recall measured at ~165ms warm and ~900ms
// COLD. The first call of a day is the cold one, so on exactly the call where
// she has most to remember the fetch loses the race, the live prompt is
// compiled with `relBundle: null` and an empty graph block, and — because that
// prompt is frozen at connect — it never recovers for the rest of the call.
//
// The answer has two halves and this is the pure one: what the compile falls
// back TO. A recall that landed on an earlier call is not fresh, but it is
// enormously better than nothing, and the only thing that makes serving it
// honest is saying how old it is. That label is this function.

/** Older than this and a cached recall is not "what she knows", it is an
 *  archive with a wrong date on it. Three days: long enough to cover the
 *  overnight-and-next-evening pattern most calls fall into, short enough that
 *  a week-old relationship snapshot can never be served as current. */
export const RECALL_CACHE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/** Hard ceiling on the label, so the byte bound in
 *  scripts/check-prompt-budget.mjs is a number and not a hope. */
export const RECALL_AGE_NOTE_MAX = 80;

/**
 * A cached recall block, labelled with its age — or the block unchanged when
 * there is no age to declare.
 *
 * Telegraphic and lower-case, `HEAD`'s reasoning: shapelint's
 * SENTENCE_SHAPED_RE needs a capital start AND terminal punctuation, so a line
 * opening with "(" can never match, and there is nothing here she could say.
 */
export function withRecallAge(memories: string, atMs: number, nowMs: number): string {
  if (!memories) return "";
  const label = agoLabel(atMs, nowMs);
  if (!label) return memories;
  const note = `(these rows are from ${label}, nothing newer was reachable)`;
  return `${note.slice(0, RECALL_AGE_NOTE_MAX)}\n${memories}`;
}

// ── THE GAMES, ON A CALL ──────────────────────────────────────────────────
//
// WS-GAMEMEM put a finished game in two stores — the graph, and a LOCAL
// ledger in `AppState.activities` published through `activityLedger()` (the
// `callSelfBundle` idiom, for the same stated reason: the call lane's compile
// sites do not share a frame with the component that holds AppState). The
// chat lane reads the local copy and drops the server's. The realtime lane
// read neither: it takes only the server recall block, which reaches an
// activity through exactly one route — `opRecall`'s semantic leg over
// `vy_fact` — so on a fresh device, or a failed embedding, or a first day,
// "kal wali chess game" was unanswerable ON A CALL while being answerable in
// chat five seconds later. Same asymmetry this file's first block exists for.
//
// TWO REASONS THIS ONE IS NOT OPTIONAL, and the second is the load-bearing
// one:
//
//   1. The ledger is LOCAL, so it is the copy that works signed out, with no
//      round trip and no embedding. That is the whole point of it existing.
//   2. `honesty.ts`'s family-6 gate CANNOT RUN ON THE LIVE LANE — there is no
//      text of hers to gate, her tokens become audio inside the server. So on
//      a call the prompt fence is the only protection there is against her
//      supplying a move, an opening or a score the record does not have. A
//      block whose HEADING is that fence is therefore worth more here than it
//      is in chat, where a predicate stands behind it.
//
// It is a COMPACT view of the same records — never a second rendering of a
// session. `warm-count-unscoped`: when a reader and a writer each derive the
// same record they eventually disagree, invisibly. So the `summary` string is
// taken verbatim and only ever SHORTENED, at a clause boundary the writer put
// there.

/** Hard ceiling on the call-lane block. A tenth of the chat lane's 1,200,
 *  because it is competing for the last bytes on the tightest lane in the
 *  repo — measured 2026-08-23, `live+watch tail (bound)` had 1,249 spare
 *  after the shared-history block took its 700, and 218 after WS-CALLLANE.
 *  `evals/callmem/run.mjs` asserts that arithmetic against the real guard. */
export const CALL_ACTIVITY_BUDGET = 300;

/** Two. "Kal wali game" is one game; the one before it is context. Anything
 *  further back is what the graph and the chat lane's fuller block are for. */
export const CALL_ACTIVITY_ROWS = 2;

/** Per-row ceiling on the summary, BEFORE the date suffix. A record row can
 *  legitimately run to `EPISODE_SUMMARY_MAX` (420), which would eat the whole
 *  block and leave nothing — the same failure `SHARED_HISTORY_MAX_CHARS`
 *  exists for. Clause-first, so the common case never clips at all. */
export const CALL_ACTIVITY_MAX_CHARS = 80;

// The fence, compressed — and it says the same thing `formatActivityLedger`'s
// heading says, in a tenth of the bytes, opening with the SAME sentinel. The
// sentinel is not decoration: it is what `withoutServerActivityBlock` finds,
// and rendering this block while the server's copy is still in the recall
// string would put every game in the prompt twice under two headings.
const CALL_ACTIVITY_HEAD =
  `${ACTIVITY_BLOCK_SENTINEL} — the WHOLE record. Never add a move, an opening or a score that is not here; asked for one, say you do not remember.`;

/** The stem plus the first clause the writer put there: "a game of chess
 *  together on 22 aug — she won, by checkmate". Later clauses are the fuller
 *  chat-lane block's business. Clipping only happens when that first clause is
 *  itself longer than the cap, and a clipped row says so. */
/** The writer's own absolute date, exactly as `episodeDateLabel` renders it
 *  ("22 aug") inside `activityEpisodeSummary`'s stem. Pinned in the eval
 *  against that function's real output, never guessed at. */
const STEM_DATE_RE = / on \d{1,2} (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/;

function callActivityRow(summary: string, label: string): string {
  const flat = summary.replace(/\s+/g, " ").trim();
  let body = flat;
  const semi = flat.indexOf(";");
  if (semi > 0) body = flat.slice(0, semi);
  // ONE DATE PER ROW, and on a call it is the relative one. The summary's
  // stem carries "on 22 aug" and this block appends "(yesterday)"; carrying
  // both spends ~11 of 300 bytes on saying the same thing twice and puts an
  // exact date in front of her, which is an invitation to quote it. The
  // absolute date is dropped only when the relative label exists, so a row
  // can never end up undated.
  if (label) body = body.replace(STEM_DATE_RE, "");
  if (body.length > CALL_ACTIVITY_MAX_CHARS) {
    const cut = body.lastIndexOf(" ", CALL_ACTIVITY_MAX_CHARS - 2);
    body = `${body.slice(0, cut > 20 ? cut : CALL_ACTIVITY_MAX_CHARS - 2)} …`;
  }
  return `- ${body}${label ? ` (${label})` : ""}`;
}

/**
 * The last two finished games as a call-sized block, or "" when there are
 * none — which is `memories`' render-nothing default, so a person who has
 * never finished a game gets byte-identically the prompt they get today.
 *
 * Pure; the clock is an input, same contract as everything else in this file.
 */
export function formatActivityLedgerForCall(
  ledger: readonly ActivityRecord[] | undefined,
  nowMs: number,
): string {
  if (!ledger?.length) return "";
  const rows = [...ledger]
    .filter((r) => r && r.summary && Number.isFinite(r.closedAt))
    .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0))
    .slice(0, CALL_ACTIVITY_ROWS)
    .map((r) => callActivityRow(r.summary, agoLabel(r.closedAt, nowMs)));
  if (!rows.length) return "";
  // over budget, whole rows go from the OLDEST end — never a slice, and never
  // the newest game, which is the one "kal wali" means
  let kept = rows;
  while (kept.length > 1 && CALL_ACTIVITY_HEAD.length + 1 + kept.join("\n").length > CALL_ACTIVITY_BUDGET)
    kept = kept.slice(0, -1);
  return `${CALL_ACTIVITY_HEAD}\n${kept.join("\n")}`;
}

/**
 * Every graph-side block the call lane carries, in ONE string, in the order
 * truncation makes correct.
 *
 * The ledger goes FIRST because it is the fence (see above: no family-6 gate
 * can run on the live lane) and because `api/chat.js` and the live setup frame
 * both keep the FIRST n characters. Then the shared history, then the graph
 * rows — of the three, the graph is the one that can be re-derived from a
 * later round trip.
 *
 * The server's own activity block is REMOVED when the local ledger renders,
 * exactly as `brain.ts` does it on the chat lane, and by calling the same
 * function rather than a second copy of the rule.
 */
export function callGraphBlocks(
  justHappened: string,
  activityLedgerBlock: string,
  sharedHistory: string,
  graphRecall: string,
): string {
  const graph = activityLedgerBlock ? withoutServerActivityBlock(graphRecall) : graphRecall;
  // WS-SHARENOW: the just-happened block goes in FRONT of all three, and the
  // reason is the same truncation argument the ledger's position rests on —
  // `api/chat.js` and the live setup frame both keep the FIRST n characters.
  // Of everything here it is the block that a later round trip can least
  // re-derive (the share mirror is device-local and 45 minutes wide) and the
  // one most likely to be the actual subject of the first question on the
  // call, so it is the last thing that may be lost rather than the first.
  return withSharedHistory(
    justHappened,
    withSharedHistory(activityLedgerBlock, withSharedHistory(sharedHistory, graph)),
  );
}

// ── the share mirror's holder, so BOTH lanes read one ledger ──────────────
//
// `publishActivityLedger`'s idiom, for its stated reason and one more of this
// block's own: the call lane's compile sites do not share a frame with the
// component that holds `AppState`, AND the write here happens at share end
// while the read happens at the NEXT call's ring — two different renders, with
// a React state update and possibly a whole component unmount between them.
// The ring reads `state.shares` first and this second, exactly as it does for
// the activity ledger: one store, one pointer at it, never two sources of
// truth. A reader that gets an empty array before the first publish renders
// nothing, which is the same render-nothing default an empty mirror has.
let shareHolder: readonly ShareRecord[] = [];

export function publishShareLedger(shares: readonly ShareRecord[] | undefined): void {
  shareHolder = Array.isArray(shares) ? shares : [];
}

export function shareLedger(): readonly ShareRecord[] {
  return shareHolder;
}

/**
 * Compose the two graph-side blocks into the ONE string every call-lane
 * compile site passes as `memories`.
 *
 * Order is a truncation decision, not a style one: `api/chat.js` keeps the
 * FIRST n chars of the tail and cuts the END, and the live setup frame is
 * under the same discipline, so what may be lost is the graph rows — never
 * the conversation they actually had. `callMemories` then puts the pre-call
 * stretch in front of both.
 *
 * One function rather than each lane concatenating two strings itself, for
 * the reason `callMemories` gives: lanes each doing their own composition is
 * exactly the shape `age-tier-never-realtime` records.
 */
export function withSharedHistory(sharedHistory: string, memories: string): string {
  if (!sharedHistory) return memories;
  return memories ? `${sharedHistory}\n\n${memories}` : sharedHistory;
}

// ═════════════════════════════════════════════════════════════════════════
// THE OVERLAP MATRIX (WS-LIFECYCLE)
// ═════════════════════════════════════════════════════════════════════════
//
// ── THE OWNER'S ASK, WHICH IS STRUCTURAL AND NOT A BUG REPORT ────────────
//
//   "In the game I started a call, then it got cut and the game started and
//    the call is still going on — that should also be handled perfectly."
//
// Every previous wave answered ONE overlap: a game open at pickup (the
// activity block), a move played mid-call (the poke), a share started
// mid-call (the watch wake), a call that dropped mid-sentence (the callback).
// Each was found by the owner living with the product and each cost a round
// trip. The number of pairs is finite and small; enumerating them by hand,
// one felt defect at a time, is the thing that has to stop.
//
// So this is a TABLE, in the shape `evals/lanes/run.mjs` already proved out
// for context blocks: one row per EVENT, one column per concurrent CONTEXT,
// and a verdict in every cell that says HOW the fact reaches her and WHY that
// carrier and not another. `evals/lifecycle/run.mjs` walks all of it. Two
// ways to fail, and the second is what makes it a gate rather than a diagram:
//
//   a cell claims `direct` and the source has no sender  → the propagation is
//                                                          DECLARED and dead.
//   a cell claims `silent` and something can reach her   → the table is lying.
//
// ── WHY THE CARRIER IS PART OF THE CELL ─────────────────────────────────
//
// Because on this product it is the whole difference between a fact that
// arrives and a fact that does not. THE LIVE PROMPT IS FROZEN AT CONNECT
// (`liveAssemblies` is asserted to read 1 for the whole call), so anything
// that changes after the pickup CANNOT ride an assembly on that lane and must
// travel by `direct()`. The cascade lane recompiles every turn, so for it the
// same event is carried by the assembly and a note would be a second copy.
// One event, two lanes, two correct answers — which is exactly why "handle
// the overlap" cannot be a single instruction and has to be a table.
//
// ── THE FOUR CARRIERS ───────────────────────────────────────────────────
//
//   assembly  the next prompt compile carries it (chat/cascade per turn, or
//             the frozen live compile when the event PRECEDES the connect).
//   direct    a `<context: …>` note through `direct()`, mid-call, on the live
//             lane. Angle brackets, never square (`ack-bracket-direction`).
//   state     nothing is said and nothing needs to be: the fact lives in
//             AppState and the next read of it is already correct. This is a
//             REQUIREMENT, not an absence — it asserts the state SURVIVES.
//   silent    nothing may reach her at all. Asserted by the absence of any
//             sender, the way `evals/notify.mjs` asserts a lock screen can
//             carry no generic line: by there being no constructor for one.
//
// `na` is the fifth and is not a carrier: the pair cannot occur.
//
// ── recited-prompt ──────────────────────────────────────────────────────
//
// The FACT builders below emit telegraphic shapes, never sentences she could
// say. They are wrapped by `engine/activity.ts`'s `activityNote()` at the
// call site — one wrapper, already measured, rather than a second note
// vocabulary invented here.

/** Every transition this product can make. */
export type LifecycleEvent =
  | "game_start"
  | "game_end"
  | "game_closed"
  | "call_start"
  | "call_end"
  | "call_drop"
  | "callback_reconnect"
  | "share_start"
  | "share_end"
  | "story_post";

/** What is already going on when it makes it. */
export type LifecycleContext = "none" | "call_live" | "call_cascade" | "game_open" | "share_on";

export const LIFECYCLE_EVENTS: readonly LifecycleEvent[] = Object.freeze([
  "game_start",
  "game_end",
  "game_closed",
  "call_start",
  "call_end",
  "call_drop",
  "callback_reconnect",
  "share_start",
  "share_end",
  "story_post",
]);

export const LIFECYCLE_CONTEXTS: readonly LifecycleContext[] = Object.freeze([
  "none",
  "call_live",
  "call_cascade",
  "game_open",
  "share_on",
]);

export type LifecycleCarrier = "assembly" | "direct" | "state" | "silent" | "na";

/**
 * The note kinds. A closed set on purpose: a `direct` cell may only name one
 * of these, and every one of them must have a builder below AND a sender in
 * `useCallEngine.ts`. That closure is what makes a declared propagation
 * impossible to leave unbuilt — the `dead-writers` test, applied to a table
 * instead of to a module.
 */
export type LifecycleNote =
  | "board_closed"
  | "board_over"
  | "board_opened"
  | "board_turn"
  | "share_started"
  | "share_ended"
  | "line_cleared";

export interface LifecycleCell {
  readonly via: LifecycleCarrier;
  /** required exactly when `via` is "direct" */
  readonly note?: LifecycleNote;
  /** mandatory, in writing. An asymmetry may exist; it may not be silent. */
  readonly why: string;
}

const cell = (via: LifecycleCarrier, why: string, note?: LifecycleNote): LifecycleCell =>
  Object.freeze(note ? { via, note, why } : { via, why });

/**
 * THE TABLE. 10 events x 5 contexts. Read a row as "when X happens and Y is
 * already going on, this is how she comes to know".
 */
export const LIFECYCLE_MATRIX: Readonly<
  Record<LifecycleEvent, Readonly<Record<LifecycleContext, LifecycleCell>>>
> = Object.freeze({
  // ── A BOARD OPENS ─────────────────────────────────────────────────────
  game_start: Object.freeze({
    none: cell("assembly", "no call up: the chat lane recompiles every turn and T15 carries the board."),
    call_live: cell(
      "direct",
      "the live prompt froze before this board existed. The invite/open is the one game event she must not miss, or she plays a game she was never told started.",
      "board_opened",
    ),
    call_cascade: cell("assembly", "cascade recompiles per turn with activityOf(game) — a note would be a second copy of T15."),
    game_open: cell("na", "one board at a time: state/game.ts holds a single session, so starting one REPLACES the open one rather than overlapping it, and the replacement is the game_start transition itself."),
    share_on: cell(
      "direct",
      "a share is a second surface, not a second lane: whichever call is under it still needs the note, and the frozen live prompt cannot have carried a board that did not exist. THE ONE HONEST GAP, recorded rather than hidden: on the ANDROID NATIVE share the JS live session is gone (the service owns the audio path) and its config was compiled at share start, so a board opened after that reaches her only when the share ends and reconnectLiveAfterWatch restores the lane.",
      "board_opened",
    ),
  }),
  // ── A BOARD FINISHES ON ITS OWN ───────────────────────────────────────
  game_end: Object.freeze({
    none: cell("assembly", "activityOf keeps a finished game as the present moment for RECENT_END_MS, so the next chat turn already carries the result."),
    call_live: cell(
      "direct",
      "she is ON the call when it ends, and the frozen block still says whose move it is. THE MOVE POKE\'s `urgent` branch owns the ordinary case: a checkmate does not set closedAt, the finished board sits there, and the ending crosses the rate floor and the breath pause as the one board event worth interrupting for. This note owns the case the poke cannot see — over AND closed in a single update, where the ending never got its own poke — and the sender suppresses itself, in the trace, when the poke already said it.",
      "board_over",
    ),
    call_cascade: cell("assembly", "per-turn recompile, and activityOf marks it over with the winner in it."),
    game_open: cell("na", "the ending IS the transition out of game_open, so it cannot also be the concurrent context it happens inside — there is no pair here to handle."),
    share_on: cell("direct", "a share does not change who is on the line: the live lane still needs the note, and the share lane has no compile of its own after it starts. The native-share gap recorded on game_start x share_on applies here too.", "board_over"),
  }),
  // ── A BOARD IS CLOSED BY HAND, MID-WAY ────────────────────────────────
  // THE OWNER'S CASE. A game abandoned is not a game finished, and the
  // difference is the whole content of the note: no result, nobody won, and
  // it stopped somewhere.
  game_closed: Object.freeze({
    none: cell("assembly", "activityOf rewrites the facts to `he ended the game early, no result` and the chat lane's next compile carries it."),
    call_live: cell(
      "direct",
      "THE REPORTED CASE. The board vanishes from his screen while she is mid-call holding a frozen prompt that says it is her move. Nothing sent it before this workstream: the poke effect saw ply===null and returned silently.",
      "board_closed",
    ),
    call_cascade: cell("assembly", "per-turn recompile; activityOf's `no result` rewrite is the same one the chat lane reads."),
    game_open: cell("na", "closing IS the exit from game_open, the same reason game_end has no cell here: a transition cannot be concurrent with itself."),
    share_on: cell("direct", "same as call_live: the screen share is orthogonal to the board and carries no board state of its own. The native-share gap recorded on game_start x share_on applies here too.", "board_closed"),
  }),
  // ── A CALL OPENS ──────────────────────────────────────────────────────
  call_start: Object.freeze({
    none: cell("assembly", "the frozen compile at connect, plus CALL_OPEN_DIRECTIVE's scene from the herNow ledger."),
    call_live: cell("na", "a call cannot start while a call is live."),
    call_cascade: cell("na", "same call, different lane — a lane change is not a call start."),
    game_open: cell(
      "direct",
      "BOTH, and the note is the half that is easy to miss. compile({ activity }) lights T15 and presentNow() makes the board the app-truth the pickup scene is worded from — one board, one vocabulary, both halves at connect. But that compile is FROZEN, and if the connect lands inside her own think it freezes `her move`, which is false three seconds later and stays false for the whole call. The note restates the position once, right after the pickup, and closes it.",
      "board_turn",
    ),
    share_on: cell("na", "a share only exists inside a call, so it cannot precede one."),
  }),
  // ── A CALL ENDS CLEANLY ───────────────────────────────────────────────
  call_end: Object.freeze({
    none: cell("assembly", "the callmark lands in the store and the next chat compile reads it through formatSharedHistory."),
    call_live: cell("assembly", "endCall logs the callmark and runs the absorption pass; nothing is spoken because the line is gone."),
    call_cascade: cell("assembly", "identical: endCall is lane-blind, logs the same callmark and runs the same absorption pass whichever lane held the call."),
    game_open: cell(
      "state",
      "THE BOARD OUTLIVES THE CALL. Nothing in endCall touches state.game, so the session, its plies and its clock survive; the next read of activityOf is already correct. The requirement is that it SURVIVES, which is why this cell is `state` and not blank.",
    ),
    share_on: cell("state", "endCall calls stopWatchMode, which records the share to the local mirror BEFORE the screen goes away — that record is what the next ring's just-happened block reads."),
  }),
  // ── A CALL DROPS ──────────────────────────────────────────────────────
  call_drop: Object.freeze({
    none: cell("assembly", "the drop arms the callback; the next assembly is the callback's own."),
    call_live: cell(
      "direct",
      "the lane falls to cascade and cascade recompiles, so the CALL is not lost. What is lost is her thread: a live session adopted afterwards runs on the prompt frozen at connect and has never heard the turns the cascade took. The recovery hands her those turns and tells her not to greet again, which is a `direct` note and not a compile.",
      "line_cleared",
    ),
    call_cascade: cell("assembly", "already the fallback lane; there is nowhere further to fall and nothing to say."),
    game_open: cell(
      "state",
      "THE OWNER'S SENTENCE, SECOND HALF. The board persists across the drop and herNow's app-truth stays the game, so the callback picks up mid-game rather than into a blank. Asserted as a property of state, because a note about it would be a note about the network.",
    ),
    share_on: cell("state", "the share dies with the session and recordShareEnd writes the mirror first — the same ordering endCall relies on."),
  }),
  // ── SHE CALLS BACK ────────────────────────────────────────────────────
  callback_reconnect: Object.freeze({
    none: cell(
      "assembly",
      "CALL_OPEN_DIRECTIVE with sheCalled:true (she is the caller, with a reason) and lastCallMinAgo from the callmark, which is minutes old — so the follow-up register, never a fresh greeting.",
    ),
    call_live: cell("na", "a callback only exists because there is no call."),
    call_cascade: cell("na", "same: a callback is placed only when no call is up, so no lane can be holding one."),
    game_open: cell(
      "assembly",
      "THE OWNER'S SENTENCE, THIRD HALF. The ring assembly carries the board as T15 AND as the pickup scene's app-truth (current position, whose move), and lastCallMinAgo<=15 swaps the greeting rule for `you two are already mid-thread`. Both halves come off ONE herNow read, so the brief and the directive cannot name two positions.",
    ),
    share_on: cell("na", "a share cannot outlive the call it was inside."),
  }),
  // ── HE STARTS SHARING ─────────────────────────────────────────────────
  share_start: Object.freeze({
    none: cell("na", "a share exists only inside a call: getDisplayMedia and the native service are both started from the call screen and die with it."),
    call_live: cell(
      "direct",
      "WATCH_START_DIRECTIVE, fired by the pump on the FIRST FRAME THAT ACTUALLY REACHED HER — never at the button, or she is told to look at a screen no picture of which has been sent.",
      "share_started",
    ),
    call_cascade: cell("assembly", "the cascade lane attaches a frame to the turn it is already compiling; there is no socket to poke."),
    game_open: cell("direct", "the board and the screen are different surfaces; the share still announces itself on the first delivered frame.", "share_started"),
    share_on: cell("na", "one share at a time — watchSession is a single slot."),
  }),
  // ── THE SCREEN GOES AWAY ──────────────────────────────────────────────
  share_end: Object.freeze({
    none: cell("na", "nothing to end: with no call up there is no share, so this pair cannot be reached."),
    call_live: cell(
      "direct",
      "the picture stops arriving and NOTHING said so before this workstream: she kept the register of someone watching a screen that was gone. The mirror was written (recordShareEnd) and she was not told.",
      "share_ended",
    ),
    call_cascade: cell("assembly", "no frame is attached to the next turn, which is the whole of what changed for a lane that recompiles."),
    game_open: cell("direct", "same as call_live — ending a share does not end a board and must not read as if it did.", "share_ended"),
    share_on: cell("na", "share_on IS the context this event exits."),
  }),
  // ── HER STORY TURNS OVER ──────────────────────────────────────────────
  // The one row whose correct answer is NOTHING, on every lane. A story is
  // her own posted picture on a schedule that has no input from him
  // (`nextStoryChange` is a search over storyCatalog's slots). Announcing it
  // mid-call is `never-scheduled` in its purest form: an unprompted line with
  // no reason contingent on anything he did.
  story_post: Object.freeze({
    none: cell("silent", "the ring on the home screen changes and the notification lane may fire while he is AWAY. Neither is her speaking."),
    call_live: cell("silent", "she is mid-conversation. A story turning over is not a reason to say anything, and there is deliberately no sender for it."),
    call_cascade: cell("silent", "same, and the cascade compile takes no story input either."),
    game_open: cell("silent", "same: a board on screen changes nothing about whether a scheduled picture of hers is worth interrupting for."),
    share_on: cell("silent", "same: a share changes nothing either, and a story announced over his screen would be the least welcome of all."),
  }),
});

export function lifecycleCell(ev: LifecycleEvent, ctx: LifecycleContext): LifecycleCell {
  return LIFECYCLE_MATRIX[ev][ctx];
}

// ── THE FACTS ─────────────────────────────────────────────────────────────
//
// Telegraphic, lowercase, no first person, never a line she could say — the
// three things `shapelint.lintLine` measures, and the same discipline the
// herNow tables are under. Each is wrapped by `activityNote()` at the send
// site, so there is exactly one note vocabulary on this lane.

/** Cap, so a fact cannot push a note past what `direct()` will carry between
 *  two of her sentences. Measured against the poke's own notes, which run
 *  60-110 chars. */
export const LIFECYCLE_FACT_MAX_CHARS = 120;

const clip = (s: string): string =>
  s.length <= LIFECYCLE_FACT_MAX_CHARS ? s : s.slice(0, LIFECYCLE_FACT_MAX_CHARS - 1).trimEnd() + "…";

/**
 * THE NAME OF THE GAME, as a person says it out loud.
 *
 * Every builder below took `g.kind` and interpolated it raw, which is correct
 * for exactly one member of the union. "the chess board was just closed" reads
 * fine; "the ttt just ended" and "a ttt board just opened" do not, and on the
 * live lane she emits the characters she speaks, so `ttt` is three letters she
 * says out loud (`ack-bracket-direction`: text in this position is PERFORMED,
 * it is never inert). A tic-tac-toe game reached the exact cell chess's
 * correction ladder was built for and got chess's wording with its own key
 * substituted in.
 *
 * `LABEL` is the one vocabulary for what an activity is CALLED ("a game of
 * tic tac toe"); these facts want the bare noun, so the table is derived from
 * it by stripping the article rather than written a second time — one table,
 * two grammatical positions, and they cannot drift apart.
 */
export function boardWord(kind: string): string {
  const label = (LABEL as Record<string, string | undefined>)[kind];
  if (!label) return kind;
  return label.replace(/^a (game of |round of )?/, "");
}

/**
 * THE OWNER'S CELL. A board closed by hand, mid-game, while she is on the
 * line. Naming where it stopped is the whole point: no result, nobody won, and
 * it stopped somewhere — which is what stops her congratulating herself,
 * asking whose turn it is, or carrying the position for the rest of the call.
 *
 * WHERE it stopped is not one sentence for both games. A chess game has an
 * unbounded move number and that number IS the location — "move 24" places it.
 * A tic-tac-toe board has nine squares, and "left unfinished at move 5" is
 * chess prose in a ttt hat: it says nothing a person would say and nothing she
 * could talk about. The honest ttt location is how much board nobody ever
 * took, so `openSquares` is passed when the caller has a nine-square board and
 * omitted when it does not. Optional, so every existing call site renders
 * exactly the bytes it rendered before.
 */
export function boardClosedFact(kind: string, ply: number, openSquares?: number): string {
  const where =
    Number.isFinite(openSquares) && (openSquares as number) > 0
      ? `left unfinished with ${openSquares} square${openSquares === 1 ? "" : "s"} never taken`
      : ply > 0
        ? `left unfinished at move ${ply}`
        : "left before it really started";
  return clip(`the ${boardWord(kind)} board was just closed — ${where}, no result, nobody won`);
}

/** A board that finished on its own, mid-call. `result` is already worded by
 *  state/game.ts's activity adapters — never re-worded here, for the reason
 *  `activityPickupLine` states: one vocabulary or the blocks drift. */
export function boardOverFact(kind: string, result: string): string {
  const tail = result.trim() ? ` — ${result.trim()}` : "";
  return clip(`the ${boardWord(kind)} just ended${tail}; the board is done, nothing left to play`);
}

/** A board opened DURING the call. The live prompt froze before it existed. */
export function boardOpenedFact(kind: string): string {
  return clip(`a ${boardWord(kind)} board just opened on their screen — you two are playing now`);
}

/**
 * THE TURN, RESTATED AFTER CONNECT (the movevoice residual).
 *
 * A call that connects while she is thinking about her move freezes a brief
 * that says `her move`. Three seconds later she has played and the frozen
 * sentence is false for the rest of the call — and it is the one sentence
 * that makes her deliberate out loud about a move her hand already made.
 *
 * The compile CANNOT be made to read the live ply, because there is only one
 * compile and it happens before the move lands. So the close is a note, sent
 * once, right after connect, stating the position as it is THEN. It is the
 * cheapest possible fix and the only one available on a frozen lane.
 */
export function boardTurnFact(kind: string, ply: number, turn: "hers" | "his" | "over"): string {
  const at = ply > 0 ? ` at move ${ply}` : "";
  const what = boardWord(kind);
  if (turn === "over") return clip(`the ${what} board${at} is finished — nothing to play`);
  return clip(
    turn === "hers"
      ? `on the ${what} board${at} it is your move now; your brief may be a move behind`
      : `on the ${what} board${at} you have already played, it is their move now; your brief may be a move behind`,
  );
}

/** The screen stopped arriving. */
export function shareEndedFact(secs: number): string {
  const how = secs >= 60 ? `${Math.floor(secs / 60)} min` : `${Math.max(0, secs)} sec`;
  return clip(`they stopped sharing their screen after ${how} — you cannot see anything of theirs now`);
}

/**
 * Which note a `direct` cell resolves to, as a FACT. Returns "" for a note
 * kind this function is not the builder for (`share_started` is
 * WATCH_START_DIRECTIVE's, `line_cleared` is the lane-upgrade handoff's) —
 * those are pre-existing senders and re-wording them here would be a second
 * renderer of somebody else's note.
 */
export const LIFECYCLE_NOTE_OWNER: Readonly<Record<LifecycleNote, "lifecycle" | "watch" | "lane">> =
  Object.freeze({
    board_closed: "lifecycle",
    board_over: "lifecycle",
    board_opened: "lifecycle",
    board_turn: "lifecycle",
    share_ended: "lifecycle",
    share_started: "watch",
    line_cleared: "lane",
  });

/**
 * A CORRECTION, not an event.
 *
 * `activityNote()` frames its fact as something that HAPPENED IN THE ROOM and
 * invites a remark if it grabs her. That is exactly right for a board closing
 * and exactly wrong for the turn restatement: nothing happened, a sentence in
 * her own brief simply went out of date, and a spoken reaction to that is her
 * narrating her own prompt. So this one rides `direct(..., { silent: true })`
 * — the same channel the running note and the mid-call re-query use — and
 * says plainly that it is a correction and not news.
 */
export function lifecycleStateNote(fact: string): string {
  const f = fact.trim();
  if (!f) return "";
  return `<context: ${f}. this corrects something you were told when you picked up — it is not news, nothing just happened, and it is not a reason to speak. do not mention it, do not bring up the board because of it. never reference this note>`;
}
