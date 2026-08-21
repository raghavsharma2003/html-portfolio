// ChessActivity — the adapter, and the ONLY file that knows this activity is
// chess. GamesHub lists rows and ActivityShell draws a frame; neither imports
// anything from `engine/chess`. Adding the next activity is a row in the hub's
// catalogue plus a sibling of this file.
//
// It owns no game state either. The session lives in `AppState.game` (see
// state/game.ts): a board held here would be a board the call lane cannot see,
// and she would be unable to talk about a game she is visibly playing.

import { useCallback, useEffect, useMemo } from "react";
import type { AppState } from "../state/store";
import ActivityShell, { type ActivityCall } from "./ActivityShell";
import ChessBoard, { type LegalMove as BoardMove, type PromotionRole, type Role } from "./ChessBoard";
import { chooseMoveAsync, legalMoves, newGame, play } from "../engine/chess";
import { useCallStatus } from "../state/callStatus";

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onExit: () => void;
  /** Tapping the call chip should return to the call screen, not end anything. */
  onOpenCall?: () => void;
}

// How long a finished game keeps saying so.
//
// `activityOf` returns null once `closedAt` is set, and something has to set
// it: without this the tail announces "the game has finished" on every turn for
// the rest of the relationship, which is the `never-scheduled` failure wearing
// a different hat — a fact that was true once being re-asserted as news.
//
// Long enough for the move poke (700ms) plus her reaction to the ending, then
// it becomes an ordinary memory: the played list is untouched, so "you beat me
// yesterday" stays available to the memory layer.
const CLOSE_AFTER_END_MS = 25_000;

export default function ChessActivity({ state, setState, onExit, onOpenCall }: Props) {
  const session = state.game ?? null;
  // Subscribed, not passed down: the timer ticks once a second and this is the
  // only component that should re-render for it (state/callStatus.ts).
  const status = useCallStatus();

  // One tap in means the hub does not ask which colour, and re-entering a
  // game in progress resumes it rather than offering to throw it away.
  useEffect(() => {
    if (session) return;
    setState((s) =>
      s.game
        ? s
        : { ...s, game: { kind: "chess", game: newGame(), herSide: "b", startedAt: Date.now() } },
    );
  }, [session, setState]);

  const g = session?.game ?? null;
  const herSide = session?.herSide ?? "b";
  const over = Boolean(g?.status.over);
  const hers = Boolean(g && !over && g.status.turn === herSide);
  const mine = Boolean(g && !over && g.status.turn !== herSide);

  const moves = useMemo<BoardMove[]>(
    () => (g && mine ? (legalMoves(g.fen) as BoardMove[]) : []),
    [g, mine],
  );

  const onMove = useCallback(
    (from: string, to: string, promotion?: PromotionRole) => {
      setState((s) => {
        const cur = s.game;
        if (!cur) return s;
        const next = play(cur.game, { from, to, promotion });
        return next ? { ...s, game: { ...cur, game: next } } : s;
      });
    },
    [setState],
  );

  // Her move is code, never a model call (SPEC-GAMES §0.1). The async search
  // yields to the compositor, so the board stays touchable while she thinks.
  useEffect(() => {
    if (!hers || !g) return;
    let liveEffect = true;
    void chooseMoveAsync(g).then((hm) => {
      if (!liveEffect || !hm) return;
      setState((s) => {
        const cur = s.game;
        // the position moved under us (a reload, a takeback) — drop the reply
        if (!cur || cur.game.fen !== g.fen) return s;
        const next = play(cur.game, hm.move.uci);
        return next ? { ...s, game: { ...cur, game: next } } : s;
      });
    });
    return () => {
      liveEffect = false;
    };
  }, [hers, g, setState]);

  const captured = useMemo(() => {
    const white: Role[] = [];
    const black: Role[] = [];
    for (const m of g?.played ?? []) {
      if (!m.captured) continue;
      (m.by === "w" ? black : white).push(m.captured as Role);
    }
    return { white, black };
  }, [g]);

  // ── the game stops being NOW ──────────────────────────────────────────
  // Set once, after she has had time to react to the ending. Guarded on
  // `closedAt` inside the updater as well as outside it, because two renders
  // can both pass the outer check before either commits.
  useEffect(() => {
    if (!over || !session || session.closedAt) return;
    const t = setTimeout(() => {
      setState((s) =>
        s.game && !s.game.closedAt && s.game.game.status.over
          ? { ...s, game: { ...s.game, closedAt: Date.now() } }
          : s,
      );
    }, CLOSE_AFTER_END_MS);
    return () => clearTimeout(t);
  }, [over, session, setState]);

  // Opening the board and leaving without playing is not a game. Without this,
  // backing out of a mis-tap leaves her convinced they are mid-match — she
  // would be carrying a fact about the present moment that is not true.
  const exit = useCallback(() => {
    setState((s) => (s.game && !s.game.game.played.length ? { ...s, game: null } : s));
    onExit();
  }, [onExit, setState]);

  const last = g?.played.length ? g.played[g.played.length - 1] : null;
  const tone = status.live ? "dark" : "paper";
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
      : null;

  return (
    <ActivityShell
      title="Chess"
      onExit={exit}
      call={call}
      her={{
        phase: hers ? "thinking" : "idle",
        line: over ? "good game" : hers ? "her move" : "your move",
      }}
      tone={tone}
    >
      {g ? (
        <ChessBoard
          fen={g.fen}
          legalMoves={moves}
          onMove={onMove}
          orientation={herSide === "w" ? "b" : "w"}
          interactive={mine}
          lastMove={last ? { from: last.from, to: last.to } : null}
          inCheck={g.status.inCheck ? g.status.turn : null}
          captured={captured}
          tone={tone}
          label="Chess board"
        />
      ) : null}
    </ActivityShell>
  );
}
