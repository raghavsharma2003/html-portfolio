// The would-you-rather session as SESSION STATE — the wyr analogue of
// `src/state/game.ts`. This file is mine to own; the SLOT it lives in is not.
//
// ── COORDINATOR: the GameSession union extension ──────────────────────────
//
// `src/state/game.ts` currently declares:
//
//   export interface GameSession {
//     kind: "chess";
//     game: Game;
//     herSide: Side;
//     startedAt: number;
//     closedAt?: number;
//   }
//
// The wiring diff this feature needs there is:
//
//   import type { WyrSession } from "../engine/wyr/session";
//   export type ChessSession = { kind: "chess"; game: Game; herSide: Side;
//     startedAt: number; closedAt?: number };
//   export type GameSession = ChessSession | WyrSession;
//
// and `activityOf` becomes:
//
//   import { wyrActivity } from "../engine/wyrTalk";
//   export function activityOf(s: GameSession | null | undefined): ActivityState | null {
//     if (!s || s.closedAt) return null;
//     if (s.kind === "wyr") return wyrActivity(s);
//     return chessActivity(s.game, s.herSide, s.startedAt, lastAssessment(s));
//   }
//
// Until that lands, `WouldYouRatherActivity.tsx` reads and writes `state.game`
// through a local cast (`readWyr`/`asGameSession` in that file) rather than
// touching this repo's real union — see that file's header for why, and for
// the cross-activity hazard this raises: `AppState.game` is ONE slot, so a
// wyr session and a chess session cannot both be "current" at once. This
// file does not decide what happens when they collide; that is a routing
// question for whichever file owns `GamesHub`/`App.tsx`'s wiring.
//
// ── why her pick is not a field here ───────────────────────────────────────
//
// It doesn't need to be. `pick.ts`'s `herPick(cardId, salt)` is a pure
// function of two things this session already carries (a card id in `seen`,
// and `salt`), so storing her pick as well would be exactly the shape
// `state/game.ts` warns against for `lastAssessment`: "a cached copy is a
// second source of truth that can disagree with the board it describes."
// Recomputing it is free and it is the reason a card that resurfaces months
// from now still gets the same answer out of her.

import { DECK_IDS } from "./deck";
import { herPick, nextCardId } from "./pick";

export interface WyrRound {
  readonly cardId: string;
  readonly his: "a" | "b";
  readonly her: "a" | "b";
}

export interface WyrSession {
  /**
   * Card ids carried over from PREVIOUS sessions, excluded from dealing but
   * never part of this session's seen/rounds pairing — isAnswered() compares
   * rounds.length to seen.length, and stuffing carried ids into `seen` would
   * make the current card permanently "unanswered" and freeze the UI.
   */
  readonly avoid?: readonly string[];
  readonly kind: "wyr";
  /** The stable per-relationship seed this session was started with. Carried
   *  on the session itself, not re-passed at every call site, so `activityOf`
   *  stays a pure function of the session alone — the same shape chess's
   *  derivation has. */
  readonly salt: string;
  readonly startedAt: number;
  /** Set on exit once ≥1 card has been answered — see the component. */
  readonly closedAt?: number;
  /**
   * Card ids shown this session, oldest first. The LAST entry is the current
   * card: still awaiting his tap if `rounds.length < seen.length`, answered
   * and awaiting "next" if `rounds.length === seen.length`. Empty only for
   * the instant between session creation and the first card being dealt,
   * which `freshSession` never actually produces (it deals card one itself).
   */
  readonly seen: readonly string[];
  /** Completed rounds, oldest first — parallel to the answered prefix of `seen`. */
  readonly rounds: readonly WyrRound[];
}

/** A brand new session, already holding its first card. */
/**
 * `carrySeen` is the previous session's seen list, so a NEW session keeps
 * avoiding cards the last one asked. Without it — and this shipped without
 * it — the deal was a pure function of the salt, so every fresh session dealt
 * the IDENTICAL card order to the same person ("same questions are coming").
 * Her PICKS stay seeded by the bare salt on purpose: her taste is stable, the
 * deck order is not. The carried list is capped below the deck size so the
 * exhaustion-reset in nextCardId still works.
 */
export function freshSession(
  salt: string,
  startedAt: number,
  carrySeen: readonly string[] = [],
): WyrSession {
  const avoid = carrySeen.slice(-(DECK_IDS.length - 8));
  return {
    kind: "wyr",
    salt,
    startedAt,
    avoid,
    seen: [nextCardId(DECK_IDS, avoid, `${salt}:${startedAt}`)],
    rounds: [],
  };
}

export function currentCardId(s: WyrSession): string | null {
  return s.seen.length ? s.seen[s.seen.length - 1] : null;
}

/** True once the current card has a round recorded for it. */
export function isAnswered(s: WyrSession): boolean {
  return s.rounds.length >= s.seen.length && s.seen.length > 0;
}

/**
 * Record his pick for the current card. Her pick is derived right here, at
 * the moment it enters the record — not before (there is nothing to derive
 * until there is a card and a salt) and not stored separately afterwards.
 * No-ops if the current card already has a round, so a doubled tap (a second
 * pointer event, a retry after a slow re-render) cannot record two answers
 * for one question.
 */
export function answerCurrent(s: WyrSession, his: "a" | "b"): WyrSession {
  if (isAnswered(s)) return s;
  const cardId = currentCardId(s);
  if (!cardId) return s;
  return { ...s, rounds: [...s.rounds, { cardId, his, her: herPick(cardId, s.salt) }] };
}

/** Deal the next card. No-ops if the current one is still unanswered — advancing
 *  is his to do only once there is something to advance FROM, same as chess's
 *  rule that undo is his and never silent. */
export function advance(s: WyrSession): WyrSession {
  if (!isAnswered(s)) return s;
  // the deal seed includes startedAt (see freshSession) — session-unique
  // order, person-stable picks
  return {
    ...s,
    seen: [
      ...s.seen,
      nextCardId(DECK_IDS, [...(s.avoid ?? []), ...s.seen], `${s.salt}:${s.startedAt}`),
    ],
  };
}

/** Derived, never stored — the whole running tally is a fold over `rounds`. */
export function tally(s: WyrSession): { agreed: number; clashed: number } {
  let agreed = 0;
  for (const r of s.rounds) if (r.his === r.her) agreed++;
  return { agreed, clashed: s.rounds.length - agreed };
}

/** A board opened and left without a move is discarded on exit (SPEC-GAMES
 *  §5) — the wyr analogue is a session with zero answered rounds. */
export function isEmpty(s: WyrSession): boolean {
  return s.rounds.length === 0;
}
