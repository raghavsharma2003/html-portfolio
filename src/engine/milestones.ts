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

  const firstAt = inp.messages.find((m) => m.at)?.at ?? null;
  if (firstAt) {
    const days = Math.floor((inp.nowMs - firstAt) / DAY);
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

  const msgCount = inp.messages.filter((m) => m.kind !== "callmark").length;
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

  const callCount = inp.messages.filter((m) => m.kind === "callmark").length;
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
      out.push({ id: `chess-${t}`, kind: "chess-games", title: `${t} chess games together` });
    }
  }
  {
    const t = latestOnly(WYR_TIERS, ta.wyrCards ?? 0, fired, (n) => `wyr-${n}`);
    if (t !== null) {
      out.push({ id: `wyr-${t}`, kind: "wyr-cards", title: `${t} would-you-rathers answered` });
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
    case "chess": return `${n} chess games together`;
    case "wyr": return `${n} would-you-rathers answered`;
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
