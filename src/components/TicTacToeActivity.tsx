// TicTacToeActivity — the adapter, and the ONLY file that knows this
// activity is tic-tac-toe. Mirrors `ChessActivity.tsx` structurally, on
// purpose: GamesHub lists rows and ActivityShell draws a frame, neither
// imports anything from `engine/ttt`, and a THIRD activity should be able to
// copy this file's shape as confidently as this one copied chess's.
//
// It owns no game state either. The session belongs in `AppState.game`
// (state/game.ts's `GameSession` union) for the identical reason chess's
// board does: a board held in local state is a board the call lane cannot
// see, and she would be unable to talk about a game she is visibly playing.
//
// ── why this file defines its own types instead of importing them ─────────
//
// `state/game.ts`'s `GameSession` is `{ kind: "chess"; ... }` today and is
// owned by another workstream. This file is written against the session
// shape ttt NEEDS — `TttGameSession` below — as a local, structural stand-in.
// Once the coordinator lands the one-line union diff this file's report
// asks for, `AppState.game` really can hold a `TttGameSession` and the cast
// this file uses becomes unnecessary — but nothing here needs to change when
// that happens, because the shape was written to match the target exactly.

import { useCallback, useEffect, useMemo } from "react";
import type { AppState } from "../state/store";
import ActivityShell, { type ActivityCall } from "./ActivityShell";
import TicTacToeBoard from "./TicTacToeBoard";
import SidePick from "./SidePick";
import { herTttMove, legalCells, newTttGame, playTtt, winningCells } from "../engine/ttt";
import { seriesOf, tttThinkMs } from "../state/game";
import { HER_NAME } from "../engine/persona";
import { tap } from "../native/haptics";
import type { Cell, Game as TttGame, Mark } from "../engine/ttt";
import { useCallStatus } from "../state/callStatus";
import { resolveTheme } from "../engine/theme";
import { replaceOccupant } from "./activityClose";

// COORDINATOR: state/game.ts's `GameSession` needs a second member:
//
//   export interface TttGameSession {
//     kind: "ttt";
//     game: TttGame;               // from "../engine/ttt"
//     herSide: Mark;               // from "../engine/ttt"
//     startedAt: number;
//     closedAt?: number;
//   }
//   export type GameSession = ChessGameSession | TttGameSession;
//
// (`ChessGameSession` names the existing interface, currently exported bare
// as `GameSession`.) `activityOf` needs one branch added:
//
//   export function activityOf(s: GameSession | null | undefined): ActivityState | null {
//     if (!s || s.closedAt) return null;
//     return s.kind === "ttt"
//       ? tttActivity(s.game, s.herSide, s.startedAt)
//       : chessActivity(s.game, s.herSide, s.startedAt, lastAssessment(s));
//   }
//
// `lastAssessment` stays chess-only; ttt has no assessment step to recompute.
export interface TttGameSession {
  kind: "ttt";
  game: TttGame;
  herSide: Mark;
  startedAt: number;
  closedAt?: number;
}

/** `AppState` with `game` widened to ALSO admit a ttt session. Everything
 *  else is the real `AppState` — this component reads `messages` and `theme`
 *  off it exactly as `ChessActivity` does off the genuine type. */
// The GameSession union now carries "ttt" for real (state/game.ts), so the
// host is plain AppState and every read narrows by kind — the stand-ins this
// file shipped with are gone, exactly as their comments promised.
type HostState = AppState;
type HostSetState = React.Dispatch<React.SetStateAction<AppState>>;

interface Props {
  state: HostState;
  setState: HostSetState;
  onExit: () => void;
  /** Tapping the call chip should return to the call screen, not end anything. */
  onOpenCall?: () => void;
  /** Start a call FROM the board — same reasoning as ChessActivity's prop:
   *  without it, playing while she talks is exit, call, re-enter. */
  onStartCall?: () => void;
}

// How recent one of her lines has to be to sit above the board. Identical
// constant and identical reasoning to ChessActivity.
const HER_LINE_FRESH_MS = 120_000;



// Her think-time before playing, seeded from the board so a given position
// always waits the same beat — deterministic, not random, same contract as
// the engine's own seeding, but this knob is PACING and belongs to the
// component, not to `engine/ttt`, which decides WHAT she plays and nothing
// about when she appears to play it.
// WS-MOVEVOICE moved this onto `state/game.ts`'s shared table. The local
// constant was a flat 800–2500ms band over the board key: correct in spirit,
// blind in one specific way that reads as a program rather than a person — she
// took the same two seconds over a square she HAD to take (block or lose next
// move) as over an open board. A person sees a forced block instantly. The
// table's `ttt_obvious` band is that, and the seed is now the session as well
// as the board, so two sittings are not metronomes of each other.
const boardKey = (b: readonly (Mark | null)[]): string => b.map((c) => c ?? ".").join("");

/** She can win right now, or she must block right now — the two squares nobody
 *  has to think about. Read off the real `winningCells`, never a stored flag. */
function obviousFor(game: TttGame, herMark: Mark): boolean {
  const opp: Mark = herMark === "x" ? "o" : "x";
  const empties = game.board.reduce<number>((n, c) => n + (c ? 0 : 1), 0);
  if (empties <= 1) return true;
  return winningCells(game.board, herMark).length > 0 || winningCells(game.board, opp).length > 0;
}

export default function TicTacToeActivity({
  state,
  setState,
  onExit,
  onOpenCall,
  onStartCall,
}: Props) {
  const session = state.game?.kind === "ttt" ? state.game : null;
  const status = useCallStatus();

  // One tap in means the hub does not ask which mark — she takes O, he opens
  // as X — and re-entering a game in progress resumes it rather than
  // offering to throw it away.
  //
  // A foreign-kind session in the slot: replace it when it is CLOSED or has
  // no progress; otherwise this board is blocked and says so with a way out.
  // This is ChessActivity's shipped pattern, ported whole. The guard it
  // replaces (`s.game ? s`) refused to create the board after ANY other game
  // had ever been played — one finished chess game and tic tac toe opened an
  // empty stage under a header confidently saying "your move", forever, and
  // it survived a reload because the closed session survived one too
  // (audit #1).
  //
  // BOTH halves are load-bearing, and the wyr fix needed both too: the
  // derivation below decides what this render draws, and the re-check inside
  // the updater decides what the write does. Either one alone leaves half the
  // bug alive.
  const foreign = state.game && state.game.kind !== "ttt" ? state.game : null;
  const foreignLive = Boolean(
    foreign &&
      !foreign.closedAt &&
      (foreign.kind === "wyr" ? foreign.rounds.length > 0 : foreign.game.played.length > 0),
  );
  useEffect(() => {
    if (session || foreignLive) return;
    setState((s) => {
      const cur = s.game;
      const curLive =
        cur &&
        cur.kind !== "ttt" &&
        !cur.closedAt &&
        (cur.kind === "wyr" ? cur.rounds.length > 0 : cur.game.played.length > 0);
      if (cur?.kind === "ttt" || curLive) return s;
      return { ...s, game: { kind: "ttt" as const, game: newTttGame(), herSide: "o" as const, startedAt: Date.now() } };
    });
  }, [session, foreignLive, setState]);

  // The way out of the blocked panel. Same contract as chess's takeover: the
  // outgoing game is CLOSED and TALLIED in the same updater that hands the
  // slot over, and its episode is emitted by hand, because App's effect
  // cannot observe a session that is replaced in the tick it was closed
  // (audit #3). See `activityClose.ts`.
  const setAsideAndStart = useCallback(() => {
    tap();
    replaceOccupant(
      state,
      setState,
      { kind: "ttt" as const, game: newTttGame(), herSide: "o" as const, startedAt: Date.now() },
      (s) => Boolean(s.game) && s.game?.kind !== "ttt",
    );
  }, [state, setState]);

  const g = session?.game ?? null;
  const herSide: Mark = session?.herSide ?? "o";
  // HIS mark, which is what every label on this surface speaks in. X opens in
  // tic tac toe, so the default gives him X for the same reason chess gives
  // him white: an empty board should be waiting for him, not already moving.
  const hisSide: Mark = herSide === "x" ? "o" : "x";
  const over = Boolean(g?.status.over);
  const done = over || Boolean(session?.closedAt);
  const hers = Boolean(g && !done && g.status.turn === herSide);
  const mine = Boolean(g && !done && g.status.turn !== herSide);

  const cells = useMemo<Cell[]>(() => (g && mine ? legalCells(g) : []), [g, mine]);

  const onPlay = useCallback(
    (cell: Cell) => {
      setState((s) => {
        const cur = s.game;
        if (cur?.kind !== "ttt") return s;
        const next = playTtt(cur.game, cell);
        return next ? { ...s, game: { ...cur, game: next, touchedAt: Date.now() } } : s;
      });
    },
    [setState],
  );

  // Her move is code, never a model call (SPEC-GAMES.md §0.1 — the same law
  // applies to every activity this seam holds, not only chess). The delay is
  // this component's own pacing, not the engine's: a mark that appears the
  // instant it becomes her turn reads as a program, not a person deciding.
  useEffect(() => {
    if (!hers || !g) return;
    let live = true;
    const atCell = boardKey(g.board);
    const atPly = g.played.length;
    const t = setTimeout(() => {
      if (!live) return;
      const cell = herTttMove(g);
      if (cell === null) return;
      setState((s) => {
        const cur = s.game;
        // the board moved under us (a reload, a race) — drop the reply
        if (
          cur?.kind !== "ttt" ||
          boardKey(cur.game.board) !== atCell ||
          cur.game.played.length !== atPly
        )
          return s;
        const next = playTtt(cur.game, cell);
        return next ? { ...s, game: { ...cur, game: next, touchedAt: Date.now() } } : s;
      });
    }, tttThinkMs({ key: atCell, ply: atPly, obvious: obviousFor(g, herSide), seed: session?.startedAt ?? 0 }));
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [hers, g, herSide, setState, session?.startedAt]);

  // Close + tally live in App's reconciler — see ChessActivity/App.tsx.

  // Opening the board and leaving without playing is not a game — same rule
  // and same wording as chess's exit.
  // Teardown on UNMOUNT — see ChessActivity's identical block for why the
  // route must not matter.
  useEffect(
    () => () => {
      setState((s) => (s.game?.kind === "ttt" && !s.game.game.played.length ? { ...s, game: null } : s));
    },
    [setState],
  );
  const exit = useCallback(() => {
    onExit();
  }, [onExit]);

  const lastCell = g?.played.length ? g.played[g.played.length - 1].cell : null;
  const winningLine = g?.status.result === "win" ? g.status.line : null;

  // The board follows the APP THEME, not the call — see ChessActivity's
  // identical comment for why that repaint belongs to the shell alone.
  const tone = resolveTheme(state.theme) === "dark" ? "dark" : "paper";
  const call: ActivityCall | null =
    status.live || status.connecting
      ? {
          live: status.live,
          connecting: status.connecting,
          muted: status.muted,
          mmss: status.mmss,
          onToggleMute: status.toggleMute,
          onOpen: onOpenCall,
        }
      : { onStart: onStartCall };

  // Her last line, above the board, off-call only — identical reasoning to
  // ChessActivity: on a call she is audible, and captioning her while she
  // speaks is the transcript-with-a-voice failure this product removed.
  const herLine = useMemo(() => {
    if (status.live || status.connecting) return null;
    const msgs = state.messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.from !== "her") continue;
      if (m.kind !== "text" || !m.text) return null;
      return Date.now() - m.at < HER_LINE_FRESH_MS ? m.text : null;
    }
    return null;
  }, [state.messages, status.live, status.connecting]);

  // The rematch, with chess's audit-#4 fix: a tap inside the reconciler's 3s
  // close delay used to delete the game it was a rematch for, so the finished
  // session is settled synchronously here before the fresh board takes the
  // slot. The reconciler's `tallied`/`closedAt` guards make its later run a
  // no-op rather than a second count.
  const newGame_ = useCallback(() => {
    tap();
    // The rematch keeps the marks, for the reason ChessActivity's identical
    // block states: a person who chose O chose it, and the picker is on the
    // fresh board anyway.
    replaceOccupant(state, setState, {
      kind: "ttt" as const,
      game: newTttGame(),
      herSide,
      startedAt: Date.now(),
    });
  }, [state, setState, herSide]);
  const showNew = Boolean(over || session?.closedAt);

  // ── which mark he is playing ──────────────────────────────────────────
  //
  // Same contract as chess's, same reasoning (SidePick.tsx): offered only on
  // an empty board, and taking X flips `herSide` to O... or the other way
  // round, which is the whole point. Picking O makes it HER move on an empty
  // board and the think-and-play effect above opens for her, with nothing
  // here knowing that it did.
  const showPick = Boolean(g && !done && g.played.length === 0);
  const chooseMark = useCallback(
    (his: Mark) => {
      setState((s) => {
        const cur = s.game;
        if (cur?.kind !== "ttt" || cur.closedAt || cur.game.played.length) return s;
        const her: Mark = his === "x" ? "o" : "x";
        if (her === cur.herSide) return s;
        return { ...s, game: { ...cur, herSide: her, startedAt: Date.now() } };
      });
    },
    [setState],
  );

  // Whose mark is whose, and the room's fill for the rest of the dead space
  // (audit #11) — a legend plus a score. `hisSide` is derived once, at the top
  // of this component, and read here: it used to be computed a second time in
  // this spot, which was free while it was a constant and is a place for two
  // answers to disagree now that a person chooses it.
  //
  // THE SCORE IS NOW A SCORE. It read "3 rounds played", which is the one
  // number nobody in a rivalry cares about: chess's room shows a move list, a
  // capture tray and a verdict, and ttt's showed a count of games whose
  // outcomes it did not mention. `seriesOf` reads the head-to-head off the
  // activity ledger — the SAME rows her memory reads, so the number on screen
  // and the number she can talk about cannot disagree — and falls back to the
  // lifetime tally when the ledger has not caught up (a fresh device, a
  // ledger trimmed at twenty).
  const series = useMemo(() => seriesOf(state.activities, "ttt"), [state.activities]);
  const lifetimeRounds = Math.max(series.games, state.tally?.tttGames ?? 0);

  // THE RESULT, STATED ON SCREEN. Chess's room carries this and its own
  // comment says why: the payoff moment of the whole activity is "did I win?",
  // and the entire on-screen answer here was the subtitle "good game" —
  // identical for a win, a loss, a draw and a board he put away. ttt was left
  // behind by that correction exactly as it was left behind by the rest.
  const verdict = useMemo(() => {
    if (!g) return null;
    if (session?.endedEarly && !g.status.over) return "Game ended. No result";
    if (!g.status.over) return null;
    if (g.status.result === "draw") return "A draw. The board filled up";
    return g.status.winner === herSide ? "She won that one" : "You won that one";
  }, [g, session?.endedEarly, herSide]);

  // "End game" mid-game: he stands up. Chess has had this since its first
  // wave; ttt had no way out of a board except leaving the room, which closes
  // the session with no `endedEarly` and therefore no honest record of who
  // stopped playing. `closedAt` lands NOW with the flag, so the tail says "he
  // ended the game early, no result" instead of naming a winner nobody was.
  const showEnd = Boolean(g && !done && g.played.length > 0);
  const endGame = useCallback(() => {
    tap();
    setState((s) =>
      s.game?.kind === "ttt" && !s.game.closedAt
        ? {
            ...s,
            game: {
              ...s.game,
              closedAt: Date.now(),
              ...(s.game.game.status.over ? {} : { endedEarly: true as const }),
            },
          }
        : s,
    );
  }, [setState]);

  return (
    <ActivityShell
      title="Tic tac toe"
      onExit={exit}
      call={call}
      note={herLine}
      presence={!foreignLive}
      footer={
        showPick || showEnd || showNew ? (
          <>
            {showPick && (
              <SidePick
                legend="you play"
                options={[
                  { value: "x", label: "X", aria: "You play X, and you go first" },
                  { value: "o", label: "O", aria: "You play O, and she goes first" },
                ]}
                value={hisSide}
                onChange={chooseMark}
                tel="ttt.mark"
              />
            )}
            {showEnd && (
              <button type="button" className="as-gbtn" data-tel="ttt.end" onClick={endGame}>
                End game
              </button>
            )}
            {showNew && (
              <button type="button" className="as-gbtn as-gbtn-primary" data-tel="ttt.new" onClick={newGame_}>
                New game
              </button>
            )}
          </>
        ) : undefined
      }
      her={{
        phase: hers ? "thinking" : "idle",
        // The `!g` branch is not cosmetic: with no board on the stage the
        // header used to say "your move" over nothing at all, which is the
        // most confident possible way to describe a room that is empty.
        line: foreignLive
          ? "another game is on"
          : !g
            ? ""
            : over
              ? "good game"
              : hers
                ? "her move"
                : "your move",
      }}
      tone={tone}
    >
      {foreignLive ? (
        <div className="as-blocked">
          <p>You two are mid-way through another game.</p>
          <button type="button" className="as-gbtn as-gbtn-primary" data-tel="ttt.takeover" onClick={setAsideAndStart}>
            Put it away and play this
          </button>
        </div>
      ) : g ? (
        <>
          <TicTacToeBoard
            board={g.board}
            legalCells={cells}
            onPlay={onPlay}
            lastCell={lastCell}
            winningLine={winningLine}
            tone={tone}
            label="Tic tac toe board"
          />
          <div className="tt-info">
            <span className="tt-legend">
              <b className="tt-legend-mark" data-mark={hisSide}>
                {hisSide.toUpperCase()}
              </b>
              you
            </span>
            <span className="tt-legend">
              <b className="tt-legend-mark" data-mark={herSide}>
                {herSide.toUpperCase()}
              </b>
              her
            </span>
            {series.her || series.his ? (
              <span className="tt-score">
                {/* The score reads as a score, tabular and symmetrical. The
                    long form is for a screen reader only: "You 2 · Her 1" is
                    the right density on a 9-square board and the wrong thing
                    to hear read out. */}
                <span aria-hidden="true">
                  {`You ${series.his} · Her ${series.her}`}
                  {series.draws ? ` · ${series.draws} drawn` : ""}
                </span>
                <span className="sr-only">
                  {`You have won ${series.his}, ${HER_NAME} has won ${series.her}`}
                  {series.draws ? `, ${series.draws} drawn` : ""}.
                </span>
              </span>
            ) : lifetimeRounds > 0 ? (
              <span className="tt-score">
                {lifetimeRounds} {lifetimeRounds === 1 ? "round" : "rounds"} played
              </span>
            ) : null}
          </div>
          {verdict ? (
            <div className="as-result" role="status">
              {verdict}
            </div>
          ) : null}
        </>
      ) : null}
    </ActivityShell>
  );
}
