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
import { herTttMove, legalCells, newTttGame, playTtt } from "../engine/ttt";
import { tap } from "../native/haptics";
import type { Cell, Game as TttGame, Mark } from "../engine/ttt";
import { useCallStatus } from "../state/callStatus";
import { resolveTheme } from "../engine/theme";

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
const THINK_MIN_MS = 800;
const THINK_SPAN_MS = 1700; // 800 + 1700 = 2500ms ceiling

function thinkDelayFor(board: readonly (Mark | null)[]): number {
  let h = 0;
  const key = board.map((c) => c ?? ".").join("");
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  const frac = (h >>> 0) % 1000 / 1000;
  return THINK_MIN_MS + Math.round(frac * THINK_SPAN_MS);
}

const boardKey = (b: readonly (Mark | null)[]): string => b.map((c) => c ?? ".").join("");

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
  // offering to throw it away. Matches ChessActivity's entry effect exactly.
  useEffect(() => {
    if (session) return;
    setState((s) =>
      s.game
        ? s
        : { ...s, game: { kind: "ttt", game: newTttGame(), herSide: "o", startedAt: Date.now() } },
    );
  }, [session, setState]);

  const g = session?.game ?? null;
  const herSide = session?.herSide ?? "o";
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
    }, thinkDelayFor(g.board));
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [hers, g, setState]);

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

  const newGame_ = useCallback(() => {
    tap();
    setState((s) => ({
      ...s,
      game: { kind: "ttt" as const, game: newTttGame(), herSide: "o" as const, startedAt: Date.now() },
    }));
  }, [setState]);
  const showNew = Boolean(over || session?.closedAt);

  return (
    <ActivityShell
      title="Tic tac toe"
      onExit={exit}
      call={call}
      note={herLine}
      footer={
        showNew ? (
          <button type="button" className="as-gbtn as-gbtn-primary" data-tel="ttt.new" onClick={newGame_}>
            New game
          </button>
        ) : undefined
      }
      her={{
        phase: hers ? "thinking" : "idle",
        line: over ? "good game" : hers ? "her move" : "your move",
      }}
      tone={tone}
    >
      {g ? (
        <TicTacToeBoard
          board={g.board}
          legalCells={cells}
          onPlay={onPlay}
          lastCell={lastCell}
          winningLine={winningLine}
          tone={tone}
          label="Tic tac toe board"
        />
      ) : null}
    </ActivityShell>
  );
}
