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

import type { Message } from "../state/store";
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

/** Hard ceiling on the rendered block, heading included.
 *
 *  Sized against real headroom, not against what would be nice: measured
 *  2026-08-23, the tightest lane in the repo (`live+watch tail (bound)` in
 *  scripts/check-prompt-budget.mjs) stands at 22,051 of an operational
 *  24,000, so there are 1,949 bytes to spend across every block anyone adds.
 *  700 of them is this. `evals/callmem/run.mjs` asserts that arithmetic
 *  against the real bound rather than leaving it as a claim here. */
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

/** A row is also capped in CHARACTERS, not only in words.
 *
 *  A word cap alone bounds how much a row can be RECITED; it does not bound
 *  how many bytes it can take, and one pathological turn (a pasted URL, a
 *  transcription that ran twenty words together) could then eat the whole
 *  block and leave nothing — measured in this suite's own worst case, where
 *  a word-capped row came to 590 characters and the drop loop emptied the
 *  block entirely. A block that renders NOTHING under load is the failure
 *  this workstream exists to fix, arriving through the guard against it. */
export const SHARED_HISTORY_MAX_CHARS = 120;

/** One row: `- them: …` / `- you: …`, word- and char-capped so no row can
 *  read as a line written for her or crowd out every other row. Clipping is
 *  at a word boundary with a visible ellipsis — a clipped row says so rather
 *  than passing a half-sentence off as whole. */
function row(who: "them" | "you", text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const cap = who === "them" ? SHARED_HISTORY_MAX_WORDS_THEM : CHAT_TAIL_MAX_WORDS;
  const body = cap - 2; // the two tokens of "- who:"
  const words = flat.split(" ");
  const clippedWords = words.length > body;
  let out = clippedWords ? words.slice(0, body - 1).join(" ") : flat;
  if (out.length > SHARED_HISTORY_MAX_CHARS) {
    // word boundary first; a single unbroken token that is already too long
    // has no boundary to find, so it is cut where it is — a row that says it
    // was clipped is honest either way.
    const kept: string[] = [];
    let n = 0;
    for (const w of out.split(" ")) {
      if (n + w.length + (kept.length ? 1 : 0) > SHARED_HISTORY_MAX_CHARS - 2) break;
      n += w.length + (kept.length ? 1 : 0);
      kept.push(w);
    }
    out = kept.length ? kept.join(" ") : out.slice(0, SHARED_HISTORY_MAX_CHARS - 2);
    return `- ${who}: ${out} …`;
  }
  return clippedWords ? `- ${who}: ${out} …` : `- ${who}: ${out}`;
}

const speakable = (m: Message | undefined): m is Message =>
  Boolean(m && m.kind === "text" && m.text && m.text.trim());

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
      callRows.unshift(row(m.from === "me" ? "them" : "you", m.text));
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
    chatRows.unshift(row(m.from === "me" ? "them" : "you", m.text));
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

/** Turns of the head of the call the note carries. Eight is roughly the first
 *  two minutes of real conversation — where the name of the thing he called
 *  about lives. */
export const RUNNING_NOTE_TURNS = 8;
/** Below this there is no head to lose yet, and a note would be a duplicate
 *  of context the session still has in full. */
export const RUNNING_NOTE_MIN_TURNS = 6;
/** Hard ceiling. This is not prompt budget — it never enters the system
 *  instruction — but it IS uplink on a live socket, where `liveCall.ts` sheds
 *  video to protect her audio. A note that could grow with the call would be
 *  the one client-side write on this lane that is not bounded. */
export const RUNNING_NOTE_BUDGET = 900;

const NOTE_HEAD =
  "not spoken by them — this is YOUR OWN memory of how this call started, kept because a long call " +
  "loses its beginning. Do not answer this, do not read it out, do not raise it on its own. Just do not contradict it.";

/**
 * The head of the current call as a silent context note, or "" when there is
 * not enough call yet to have lost anything.
 *
 * Pure and total: the caller decides WHEN (a period, a live session, a turn
 * floor) and this decides WHAT. Angle brackets, never square — bracket-shaped
 * text on this lane is speakable (`ack-bracket-direction`: "[laughs softly]"
 * came back as laughter plus the spoken word "Softly"), and every note this
 * file's callers send rides the same frame her own tokens do.
 */
export function formatRunningNote(turns: readonly Message[]): string {
  const usable = turns.filter(speakable);
  if (usable.length < RUNNING_NOTE_MIN_TURNS) return "";
  const rows = usable
    .slice(0, RUNNING_NOTE_TURNS)
    .map((m) => row(m.from === "me" ? "them" : "you", m.text));
  let kept = rows;
  const size = (rs: string[]) => NOTE_HEAD.length + rs.join("\n").length + 20;
  while (kept.length > RUNNING_NOTE_MIN_TURNS && size(kept) > RUNNING_NOTE_BUDGET)
    kept = kept.slice(0, -1); // drop from the END: the earliest turns are the point
  while (kept.length && size(kept) > RUNNING_NOTE_BUDGET) kept = kept.slice(0, -1);
  if (!kept.length) return "";
  return `<context: ${NOTE_HEAD}\n${kept.join("\n")}\nend of note — say nothing about it>`;
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
 *  after the shared-history block took its 700. `evals/callmem/run.mjs`
 *  asserts that arithmetic against the real guard. */
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
  activityLedgerBlock: string,
  sharedHistory: string,
  graphRecall: string,
): string {
  const graph = activityLedgerBlock ? withoutServerActivityBlock(graphRecall) : graphRecall;
  return withSharedHistory(activityLedgerBlock, withSharedHistory(sharedHistory, graph));
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
