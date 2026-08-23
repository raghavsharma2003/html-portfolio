// Moments worth marking, detected from the record. The OS half of
// "gamify the whole experience".
//
// The owner asked for gamification at world-class level. The charter rules
// out the half of gamification that is manipulation — no streak-loss anxiety,
// no fake urgency, no guilt mechanics (NEVER MANIPULATE; `never-scheduled`) —
// which leaves the half that great games actually run on: REAL progression,
// made visible and celebrated at the moment it happens. For a companion, the
// progression system already exists and is not invented here: it is the
// relationship record. Days known, messages exchanged, games played and won,
// rituals formed. This module only notices when a line is crossed.
//
// ── the layer split, stated once ─────────────────────────────────────────
// OS (this file): WHAT counts as a moment, WHEN it fires, and that it fires
// exactly once. Pure function of the record + the fired-ledger; no DOM, no
// personality text, no visuals. Any personality on any surface inherits it.
// Surface: HOW a moment is celebrated — confetti, haptics, a card in the
// thread. A Telegram build might render a sticker; the detection is the same.
//
// ── design rules ─────────────────────────────────────────────────────────
// - IDs are deterministic and stable; the fired-ledger stores ids, so a
//   milestone can never fire twice, across devices once state syncs.
// - Detection is threshold-CROSSING, not threshold-state: "messages >= 500
//   and 'msgs-500' not fired" — so backfilled or imported histories fire at
//   most the LARGEST crossed tier per family (see `latestOnly`), not a
//   fusillade of stale confetti.
// - No milestone is time-scheduled. Every trigger is something that HAPPENED
//   (a message sent, a game closed). A days-known milestone becomes eligible
//   by time passing but FIRES only on the next real interaction — she never
//   pings because a counter ticked, which is the `never-scheduled` law.
// - Titles here are UI copy (rendered on cards), NOT prompt text. Nothing in
//   this file may reach a prompt — `recited-prompt` — with one exception:
//   `momentFact()` produces a telegraphic, shapelint-clean fact if a lane
//   wants her aware of the moment, same contract as activity facts.

import type { Message } from "../state/store";
// TYPE ONLY, and deliberately so: this file stays a pure function of the
// record (no DOM, no network, no clock), and a type import is erased at build
// time, so nothing in `engine/memory.ts` — which carries the network layer —
// enters this module's runtime graph. The shape is imported rather than
// restated because the rows below are written INTO that ledger: a restated
// shape here is the reader/writer drift `warm-count-unscoped` names.
import type { ActivityRecord } from "./memory";

export type MilestoneKind =
  | "days-known"
  | "messages"
  | "calls"
  | "first-game"
  | "first-chess-win-him"
  | "first-chess-win-her"
  | "chess-games"
  | "wyr-cards";

export interface Moment {
  /** deterministic, stable — the fired-ledger key */
  id: string;
  kind: MilestoneKind;
  /** short UI copy for the celebration card — surface text, never prompt text */
  title: string;
  detail?: string;
}

/** What the detector reads. A projection, so it stays testable and portable. */
export interface MilestoneInputs {
  /** all messages, oldest first (the store's shape) */
  messages: readonly Message[];
  /** fired-ledger: ids that already celebrated */
  fired: readonly string[];
  /** lifetime tallies the surfaces maintain at game close */
  tally?: {
    chessGames?: number;
    chessWinsHim?: number;
    chessWinsHer?: number;
    tttGames?: number;
    wyrCards?: number;
  } | null;
  nowMs: number;
}

const DAY = 24 * 60 * 60 * 1000;

// A tier crossing is an EVENT that happened, and its card should say so:
// "Your 5th chess game together", not "5 chess games together" — the audit
// caught the count phrasing contradicting the live stat block two sections
// up (tally said 9 games while the timeline said 5). An ordinal cannot age.
const nth = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][Math.min(n % 10, 4) > 3 ? 0 : n % 10] ?? "th"}`;

// Tier tables. Sparse on purpose: a milestone that fires weekly is wallpaper,
// and wallpaper is the death of celebration. Duolingo's own numbers thin out
// exactly this way as they grow.
const DAY_TIERS = [7, 30, 100, 365] as const;
const MSG_TIERS = [100, 500, 1000, 5000, 10000] as const;
const CALL_TIERS = [1, 10, 50, 100] as const;
const CHESS_TIERS = [5, 25, 100] as const;
const WYR_TIERS = [25, 100, 250] as const;

/** Largest crossed-but-unfired tier in a family, or null. This is what stops
 *  an imported 2000-message history detonating five message milestones. */
function latestOnly(
  tiers: readonly number[],
  value: number,
  firedSet: ReadonlySet<string>,
  idFor: (tier: number) => string,
): number | null {
  let best: number | null = null;
  for (const t of tiers) if (value >= t && !firedSet.has(idFor(t))) best = t;
  return best;
}

/** The dyad's own numbers, counted off the record. Every field here is a
 *  COUNTER, never an estimate: `days` and `firstAt` come from the first
 *  message's stamp, `msgCount`/`callCount` from the store, `callSecs` from the
 *  "m:ss" each callmark carries. A number this file cannot count is absent
 *  rather than approximated — see `dyadRecord`'s note on what is missing. */
export interface RecordCounts {
  /** first message's stamp, or null on an empty record */
  firstAt: number | null;
  /** whole days since the first message. FLOOR, matching DAY_TIERS: the row
   *  this feeds sits in the same block as a "100 days" milestone, and the two
   *  disagreeing by one is the reader/writer drift `warm-count-unscoped`
   *  names. (UsScreen's hero deliberately shows floor+1 — "day 47" is an
   *  ordinal, "47 days" is a duration, and they are different numbers.) */
  days: number;
  /** messages that are conversation — callmarks are records, not turns */
  msgCount: number;
  callCount: number;
  /** total seconds spent on calls, summed from the callmarks. 0 when nothing
   *  parseable is there, which is indistinguishable from "no calls" ON
   *  PURPOSE: both render nothing rather than a guess. */
  callSecs: number;
}

/** `callmark.text` is the "m:ss" `useCallEngine`'s `endCall` writes at hangup.
 *  UsScreen.tsx parses the same string for the Us timeline; `evals/milestones`
 *  pins THIS parser against the writer's own format, which is the pin that
 *  matters — a writer change is what would silently zero both readers. */
function callSecsOf(m: Message): number {
  if (m.kind !== "callmark") return 0;
  const parts = String(m.text ?? "").split(":");
  if (parts.length !== 2) return 0;
  const mins = Number(parts[0]);
  const secs = Number(parts[1]);
  return Number.isFinite(mins) && Number.isFinite(secs) && mins >= 0 && secs >= 0 ? mins * 60 + secs : 0;
}

/** The one pass over the record every counter in this file reads. */
export function recordCounts(messages: readonly Message[], nowMs: number): RecordCounts {
  let firstAt: number | null = null;
  let msgCount = 0;
  let callCount = 0;
  let callSecs = 0;
  for (const m of messages) {
    if (firstAt === null && m.at) firstAt = m.at;
    if (m.kind === "callmark") {
      callCount++;
      callSecs += callSecsOf(m);
    } else msgCount++;
  }
  return {
    firstAt,
    days: firstAt === null ? 0 : Math.floor((nowMs - firstAt) / DAY),
    msgCount,
    callCount,
    callSecs,
  };
}

/**
 * Every moment currently eligible to fire, most significant first.
 *
 * Pure. The caller celebrates what it wants and writes the ids into the
 * fired-ledger; calling again with the updated ledger returns nothing —
 * which is the property the eval leans on hardest, because a celebration
 * that repeats is worse than none.
 */
export function detectMoments(inp: MilestoneInputs): Moment[] {
  const fired = new Set(inp.fired);
  const out: Moment[] = [];

  // ONE COUNTING VOCABULARY for the whole file — the tiers below and the dyad
  // line at the bottom read the same counters, so a milestone that says "100
  // days" can never sit next to a stats line that says 101.
  const { firstAt, days, msgCount, callCount } = recordCounts(inp.messages, inp.nowMs);
  if (firstAt) {
    const t = latestOnly(DAY_TIERS, days, fired, (n) => `days-${n}`);
    if (t !== null) {
      out.push({
        id: `days-${t}`,
        kind: "days-known",
        title: t === 365 ? "One year of you two" : `${t} days of you two`,
        detail: "since your very first message",
      });
    }
  }

  {
    const t = latestOnly(MSG_TIERS, msgCount, fired, (n) => `msgs-${n}`);
    if (t !== null) {
      out.push({
        id: `msgs-${t}`,
        kind: "messages",
        title: `${t.toLocaleString("en-IN")} messages`,
        detail: "and counting",
      });
    }
  }

  {
    const t = latestOnly(CALL_TIERS, callCount, fired, (n) => `calls-${n}`);
    if (t !== null) {
      out.push({
        id: `calls-${t}`,
        kind: "calls",
        title: t === 1 ? "Your first call" : `${t} calls together`,
      });
    }
  }

  const ta = inp.tally ?? {};
  const totalGames = (ta.chessGames ?? 0) + (ta.tttGames ?? 0);
  if (totalGames >= 1 && !fired.has("first-game")) {
    out.push({ id: "first-game", kind: "first-game", title: "Your first game together" });
  }
  if ((ta.chessWinsHim ?? 0) >= 1 && !fired.has("chess-first-win-him")) {
    out.push({
      id: "chess-first-win-him",
      kind: "first-chess-win-him",
      title: "You beat her at chess",
      detail: "she will want a rematch",
    });
  }
  if ((ta.chessWinsHer ?? 0) >= 1 && !fired.has("chess-first-win-her")) {
    out.push({
      id: "chess-first-win-her",
      kind: "first-chess-win-her",
      title: "She beat you at chess",
      detail: "you will want a rematch",
    });
  }
  {
    const t = latestOnly(CHESS_TIERS, ta.chessGames ?? 0, fired, (n) => `chess-${n}`);
    if (t !== null) {
      out.push({ id: `chess-${t}`, kind: "chess-games", title: `Your ${nth(t)} chess game together` });
    }
  }
  {
    const t = latestOnly(WYR_TIERS, ta.wyrCards ?? 0, fired, (n) => `wyr-${n}`);
    if (t !== null) {
      out.push({ id: `wyr-${t}`, kind: "wyr-cards", title: `Your ${nth(t)} would-you-rather` });
    }
  }

  return out;
}

/**
 * UI title for a FIRED id, for surfaces that render the ledger (the Us
 * screen's timeline). One vocabulary with detectMoments — the tier tables
 * above are the source, so a new tier is automatically titled.
 */
export function titleFor(id: string): string | null {
  const m = /^([a-z-]+?)-(\d+)$/.exec(id);
  if (id === "first-game") return "Your first game together";
  if (id === "chess-first-win-him") return "You beat her at chess";
  if (id === "chess-first-win-her") return "She beat you at chess";
  if (!m) return null;
  const [, fam, nRaw] = m;
  const n = Number(nRaw);
  switch (fam) {
    case "days": return n === 365 ? "One year of you two" : `${n} days of you two`;
    case "msgs": return `${n.toLocaleString("en-IN")} messages`;
    case "calls": return n === 1 ? "Your first call" : `${n} calls together`;
    case "chess": return `Your ${nth(n)} chess game together`;
    case "wyr": return `Your ${nth(n)} would-you-rather`;
  }
  return null;
}

/**
 * The one prompt-facing string: a telegraphic fact, same shapelint contract
 * as activity facts (≤14 words, third person, not sentence-shaped). A lane
 * that wants her to KNOW the moment passes this; she says whatever she says.
 */
export function momentFact(m: Moment): string {
  switch (m.kind) {
    case "days-known":
      return `today crosses ${m.id.replace("days-", "")} days since their first message`;
    case "messages":
      return `their ${m.id.replace("msgs-", "")}th message just went by`;
    case "calls":
      return m.id === "calls-1" ? "that was their first ever call" : `${m.id.replace("calls-", "")} calls now`;
    case "first-game":
      return "they just played their first game together";
    case "first-chess-win-him":
      return "he just beat her at chess for the first time";
    case "first-chess-win-her":
      return "she just beat him at chess for the first time";
    case "chess-games":
      return `${m.id.replace("chess-", "")} chess games between them now`;
    case "wyr-cards":
      return `${m.id.replace("wyr-", "")} would-you-rather cards answered between them`;
  }
}

// ── THE DURABLE HALF ──────────────────────────────────────────────────────
//
// `momentsFired` and `recentMoment` are the LOCAL, PRESENT-TENSE half of this
// system and they stay that way: `moment-available-not-fired` fixes the
// crossed-milestone fact mid-tail and gives it 12 hours, on purpose, because a
// milestone she mentions every turn is the robotic tell the feature exists to
// avoid. That decision is not re-litigated here and nothing below changes it.
//
// What it leaves open is the OTHER direction. After 12 hours the fact is zero
// bytes, so "humne 100 din complete kiye the" — him referring back, weeks
// later, to something they actually celebrated — reaches a prompt with no
// record of it at all. `momentsFired` holds the ids, but ids are not text and
// nothing renders them into any lane.
//
// The fix costs no new budget and no new store: a milestone, once celebrated,
// writes ONE ROW into the ledger `AppState.activities` already carries, so the
// two readers that already exist pick it up — `formatActivityLedger` (chat,
// 1,200B, 6 rows) and `formatActivityLedgerForCall` (call, 300B, 2 rows).
// Same union merge across devices, same teardown, same everything. It is
// AVAILABLE, never fired: the block's own heading says being listed there is
// not a reason to bring it up.
//
// Two shapes to respect, both the call lane's and both already in the ledger's
// own vocabulary (`callHistory.ts`'s `callActivityRow`):
//   - the FIRST CLAUSE (up to a ";") is what the call lane renders; anything
//     after it is the chat lane's fuller business. That is the budget lever.
//   - " on 7 jul" is stripped on the call lane, which appends its own relative
//     label. So an absolute date that must SURVIVE says "since 7 jul".

/** The ledger `kind` for a celebrated milestone. `startedAt` is the key's
 *  other half and milestones have no duration, so the ID goes in the kind and
 *  `startedAt` is 0 — which makes the ledger key (`kind:startedAt`, the same
 *  key `mergeStates` unions on) DEVICE-INDEPENDENT. Two devices that both
 *  crossed 100 days before syncing write one row, not two: without that, the
 *  union of two ledgers renders the same memory twice under one heading. */
export const MILESTONE_RECORD_KIND = "milestone";
export const DYAD_RECORD_KIND = "dyad";
export const milestoneRecordKind = (id: string) => `${MILESTONE_RECORD_KIND}:${id}`;

/**
 * A celebrated milestone as a ledger row, FROM ITS ID — the id is what the
 * fired-ledger and `recentMoment` carry, so the durable row can be written by
 * whoever holds one of those without reconstructing a `Moment`. Returns null
 * for an id no tier table produces (a hand-edited blob, a build that fired a
 * family this one has never heard of), which is the same refusal `titleFor`
 * makes at the same boundary.
 *
 * Durable tense, third person, telegraphic — the register every other row in
 * the ledger is written in. `momentFact` is the PRESENT-tense twin ("today
 * crosses 100 days"); read three weeks later that sentence is false, which is
 * exactly why this is a separate string and not a reuse of that one.
 *
 * `atMs` is when it was celebrated (the ledger sorts and dates on `closedAt`);
 * `dateLabel` is that same instant already rendered by `engine/memory.ts`'s
 * `episodeDateLabel` and passed IN, so this file keeps its no-clock contract.
 * Pure in both arguments: writing the same id twice produces the same row, so
 * a reload that re-runs the writer is a no-op rather than a re-dated memory.
 */
export function momentRecord(id: string, atMs: number, dateLabel: string): ActivityRecord | null {
  const on = dateLabel ? ` on ${dateLabel}` : "";
  // exact ids before families, for the reason `titleFor` does the same:
  // "chess-first-win-him" is in the "chess-" family by prefix and in none of
  // it by meaning.
  let summary: string | null = null;
  if (id === "first-game") summary = `their first game together${on}`;
  else if (id === "chess-first-win-him") summary = `he beat her at chess for the first time${on}`;
  else if (id === "chess-first-win-her") summary = `she beat him at chess for the first time${on}`;
  else {
    const m = /^([a-z-]+?)-(\d+)$/.exec(id);
    const n = m ? Number(m[2]) : NaN;
    if (m && Number.isFinite(n)) {
      switch (m[1]) {
        case "days": summary = `they crossed ${n} days together${on}`; break;
        case "msgs": summary = `their ${nth(n)} message went by${on}`; break;
        case "calls": summary = n === 1 ? `their first ever call${on}` : `their ${nth(n)} call together${on}`; break;
        case "chess": summary = `their ${nth(n)} chess game together${on}`; break;
        case "wyr": summary = `their ${nth(n)} would-you-rather card${on}`; break;
      }
    }
  }
  if (!summary) return null;
  return { kind: milestoneRecordKind(id), startedAt: 0, closedAt: atMs, summary };
}

/** "4h 10m" / "35m". Duration, not a clock — the same reading UsScreen gives
 *  the same seconds, restated here rather than imported because this module
 *  may not depend on a React surface. */
function humanDuration(totalSecs: number): string {
  const mins = Math.round(totalSecs / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * THE DYAD'S NUMBERS — how long they have known each other, how much they have
 * said, how many calls and games, in one row of the ledger both lanes already
 * read.
 *
 * Every number is counted, never estimated. What is NOT here, and what each
 * would need:
 *   - photos/voice notes exchanged: countable from the record, left out to
 *     keep the first clause inside the call lane's 300B block.
 *   - time spent in CHAT ("how long we've talked" in the other sense): there
 *     is no session-duration counter on the device — it would need one, and a
 *     counter that does not exist is not a number this row may invent.
 *   - anything from before a reinstall on a device that never synced: the
 *     record is the record. A count is of what is here.
 *
 * Returns null on an empty record — a row that says "0 days, 0 messages" is
 * the app introducing itself to someone who just arrived.
 */
export function dyadRecord(
  counts: RecordCounts,
  tally: MilestoneInputs["tally"],
  atMs: number,
  sinceLabel: string,
): ActivityRecord | null {
  if (!counts.firstAt || counts.msgCount <= 0) return null;
  const t = tally ?? {};
  const games = (t.chessGames ?? 0) + (t.tttGames ?? 0);

  // FIRST CLAUSE = what the call lane gets. Days, calls, games: the three a
  // person asks about out loud. Kept short on purpose — measured, the call
  // block holds this row AND the newest game inside its 300 bytes only while
  // this clause stays short, and the newest game is the row "kal wali" means.
  const head = [
    // FLOOR, so this can never contradict a "100 days" milestone sitting two
    // rows above it — which also means day one is 0, and "0 days" is a number
    // no person says. On day one the start date in the second clause is the
    // whole truth there is, so the token is simply absent.
    counts.days >= 1 ? `${counts.days} ${counts.days === 1 ? "day" : "days"}` : "",
    counts.callCount ? `${counts.callCount} ${counts.callCount === 1 ? "call" : "calls"}` : "",
    games ? `${games} ${games === 1 ? "game" : "games"}` : "",
  ].filter(Boolean);

  // SECOND CLAUSE = chat only, where 1,200 bytes make the fuller answer free.
  const rest = [
    `${counts.msgCount} messages`,
    counts.callSecs ? `${humanDuration(counts.callSecs)} on calls` : "",
    (t.wyrCards ?? 0) ? `${t.wyrCards} would-you-rather cards` : "",
    sinceLabel ? `talking since ${sinceLabel}` : "",
  ].filter(Boolean);

  return {
    kind: DYAD_RECORD_KIND,
    // deterministic key, for the reason MILESTONE_RECORD_KIND gives: there is
    // exactly one of these per relationship, and two devices must write the
    // same one rather than one each.
    startedAt: 0,
    closedAt: atMs,
    // the ";" is the call lane's clause boundary, so it exists only when there
    // is a second clause to hide behind it — a row that opens with one would
    // render as an empty block on that lane
    summary: `their record: ${[head.join(", "), rest.join(", ")].filter(Boolean).join("; ")}`,
  };
}
