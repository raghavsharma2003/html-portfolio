// ChessActivity — the adapter, and the ONLY file that knows this activity is
// chess. GamesHub lists rows and ActivityShell draws a frame; neither imports
// anything from `engine/chess`. Adding the next activity is a row in the hub's
// catalogue plus a sibling of this file.
//
// It owns no game state either. The session lives in `AppState.game` (see
// state/game.ts): a board held here would be a board the call lane cannot see,
// and she would be unable to talk about a game she is visibly playing.

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { AppState } from "../state/store";
import ActivityShell, { type ActivityCall } from "./ActivityShell";
import ChessBoard, { type LegalMove as BoardMove, type PromotionRole, type Role } from "./ChessBoard";
import { chooseMoveAsync, legalMoves, newGame, openingName, play } from "../engine/chess";
import { useCallStatus } from "../state/callStatus";
import { tap } from "../native/haptics";
import { resolveTheme } from "../engine/theme";
import { replaceOccupant } from "./activityClose";

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onExit: () => void;
  /** Tapping the call chip should return to the call screen, not end anything. */
  onOpenCall?: () => void;
  /** Start a call FROM the board. Without this the only route to the thing
   *  this feature exists for — playing while she talks — is exit, call,
   *  re-enter, which is three taps and a torn session. */
  onStartCall?: () => void;
}

// How recent one of her lines has to be to sit above the board.
//
// This is a glance at what she just said, not a second chat log: past a couple
// of minutes it stops being "she just said this" and becomes a stale banner
// hanging over the game.
const HER_LINE_FRESH_MS = 120_000;



export default function ChessActivity({
  state,
  setState,
  onExit,
  onOpenCall,
  onStartCall,
}: Props) {
  // Narrow the shared slot to THIS activity's kind — the union gained a
  // second member (wyr) and each activity component reads only its own.
  const session = state.game?.kind === "chess" ? state.game : null;
  // Subscribed, not passed down: the timer ticks once a second and this is the
  // only component that should re-render for it (state/callStatus.ts).
  const status = useCallStatus();

  // One tap in means the hub does not ask which colour, and re-entering a
  // game in progress resumes it rather than offering to throw it away.
  // A foreign-kind session in the slot: replace it when it is CLOSED or has
  // no progress; otherwise this board is blocked and says so with a way out.
  // The first version's guard (`s.game ? s`) refused to create the board and
  // rendered an empty stage under a header confidently saying "your move".
  const foreign = state.game && state.game.kind !== "chess" ? state.game : null;
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
        cur.kind !== "chess" &&
        !cur.closedAt &&
        (cur.kind === "wyr" ? cur.rounds.length > 0 : cur.game.played.length > 0);
      if (cur?.kind === "chess" || curLive) return s;
      return { ...s, game: { kind: "chess" as const, game: newGame(), herSide: "b", startedAt: Date.now() } };
    });
  }, [session, foreignLive, setState]);
  const setAsideAndStart = useCallback(() => {
    tap();
    // This used to say it closed the other game and did not: it replaced the
    // slot in one updater, so the reconciler - which observes `state.game` -
    // never saw the outgoing session at all and it was simply deleted, with
    // no closedAt, no tally and no episode (audit #3). The close, the tally
    // and the swap now happen in the SAME updater, and the episode is emitted
    // by hand because App's effect cannot watch a session that lives for less
    // than a tick. See `activityClose.ts`.
    replaceOccupant(
      state,
      setState,
      { kind: "chess" as const, game: newGame(), herSide: "b", startedAt: Date.now() },
      (s) => Boolean(s.game) && s.game?.kind !== "chess",
    );
  }, [state, setState]);

  const g = session?.game ?? null;
  const herSide = session?.herSide ?? "b";
  const over = Boolean(g?.status.over);
  // closedAt is part of "over" for INTERACTION: after End-game the board
  // stayed fully playable (both sides!) while she told callers the game had
  // ended with no result — a board contradicting her out loud.
  const done = over || Boolean(session?.closedAt);
  const hers = Boolean(g && !done && g.status.turn === herSide);
  const mine = Boolean(g && !done && g.status.turn !== herSide);

  const moves = useMemo<BoardMove[]>(
    () => (g && mine ? (legalMoves(g.fen) as BoardMove[]) : []),
    [g, mine],
  );

  const onMove = useCallback(
    (from: string, to: string, promotion?: PromotionRole) => {
      setState((s) => {
        const cur = s.game;
        if (cur?.kind !== "chess") return s;
        const next = play(cur.game, { from, to, promotion });
        return next ? { ...s, game: { ...cur, game: next, touchedAt: Date.now() } } : s;
      });
    },
    [setState],
  );

  // Her move is code, never a model call (SPEC-GAMES §0.1). The async search
  // yields to the compositor, so the board stays touchable while she thinks.
  //
  // Two changes from live testing, both the owner's words:
  //
  // "Her move was also extremely fast, like point second gap... don't move
  // like that." The search takes ~45ms, and a move that lands 45ms after
  // yours is the single loudest tell that there is no one across the board.
  // So the move is HELD for a human think-time before it lands: quick in the
  // opening (people know their openings), longer in the middlegame, seeded
  // from the position so the same spot always takes her the same moment —
  // pacing, not randomness (`Math.random` in her behaviour is exactly the
  // causeless variation the engine is built to avoid).
  //
  // "She was too strong I think." Level 3's own comment says it already
  // beats most casual players. She plays level 2: misses two-move tactics
  // sometimes, takes a worse line for flavour more often — beatable, which
  // for a companion is the point. The engine default stays 3; this is the
  // surface choosing, which is where a per-person difficulty would live.
  useEffect(() => {
    if (!hers || !g) return;
    let liveEffect = true;
    let hold: ReturnType<typeof setTimeout> | null = null;
    void chooseMoveAsync(g, { strength: 2 }).then((hm) => {
      if (!liveEffect || !hm) return;
      // seed from the fen so the pace is a property of the moment, replayable
      let h = 0;
      for (let i = 0; i < g.fen.length; i++) h = (h * 31 + g.fen.charCodeAt(i)) | 0;
      const u = (Math.abs(h) % 1000) / 1000;
      const ply = g.played.length;
      const [lo, hi] = ply < 8 ? [800, 2200] : ply < 30 ? [1800, 6000] : [1200, 4000];
      const thinkMs = Math.round(lo + u * (hi - lo));
      hold = setTimeout(() => {
        if (!liveEffect) return;
        setState((s) => {
          const cur = s.game;
          // the position moved under us (a reload, a takeback) — drop the reply
          if (cur?.kind !== "chess" || cur.game.fen !== g.fen) return s;
          const next = play(cur.game, hm.move.uci);
          return next ? { ...s, game: { ...cur, game: next, touchedAt: Date.now() } } : s;
        });
      }, thinkMs);
    });
    return () => {
      liveEffect = false;
      if (hold) clearTimeout(hold);
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

  // The move list — the dead space below the board (audit #11). SAN only,
  // paired by move number, off `g.played` directly: no new state, no second
  // opinion about a position that already lives in AppState.
  const moveRows = useMemo(() => {
    const played = g?.played ?? [];
    const rows: { n: number; w?: string; b?: string }[] = [];
    for (let i = 0; i < played.length; i += 2) {
      rows.push({ n: Math.floor(i / 2) + 1, w: played[i]?.san, b: played[i + 1]?.san });
    }
    return rows;
  }, [g]);

  // Scrolled to the newest row on every move — "latest visible" per the
  // brief, without a second scroll control fighting the one the stage owns.
  const movesRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = movesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [moveRows.length]);

  // The opening's name, while it still is one. Same window chessTalk.ts's
  // tail-block fact uses (OPENING_FACT_PLY there) — past move 16 the name is
  // no longer news, and a game that never matched the book stays silent
  // rather than guessing.
  const OPENING_UI_PLY = 16;
  const opening = useMemo(() => {
    const ply = g?.played.length ?? 0;
    if (!g || ply === 0 || ply > OPENING_UI_PLY || g.status.over) return null;
    return openingName(g.played.map((m) => m.san));
  }, [g]);

  // Close + tally live in App's always-mounted reconciler now — a component
  // effect with a 25s timer lost the close (and the whole tally) whenever
  // the board unmounted inside the window, which is the natural reaction to
  // being checkmated. See App.tsx's reconciler comment for the four failures
  // that shared this one cause.

  // Opening the board and leaving without playing is not a game. Without this,
  // backing out of a mis-tap leaves her convinced they are mid-match — she
  // would be carrying a fact about the present moment that is not true.
  // Teardown on UNMOUNT, not on one particular button: the call chip (and
  // any future route out) bypassed exit() and stranded a zero-move session
  // she then believed was a live game. The updater re-checks everything, so
  // running on any route is safe.
  useEffect(
    () => () => {
      setState((s) => (s.game?.kind === "chess" && !s.game.game.played.length ? { ...s, game: null } : s));
    },
    [setState],
  );
  const exit = useCallback(() => {
    onExit();
  }, [onExit]);

  const last = g?.played.length ? g.played[g.played.length - 1] : null;
  // The board follows the APP THEME, not the call.
  //
  // It used to force itself dark whenever a call was live, so the board read as
  // the same room continuing. That was a nice touch and it is now wrong: once
  // someone has explicitly chosen Light, a surface that overrides them because
  // a call happens to be up is the app arguing with a setting. The live call
  // chip in the header carries the continuity instead, and it does it without
  // repainting the room.
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
      : // not on a call: the header offers to start one, because the whole
        // point of this is playing while she talks
        { onStart: onStartCall };

  // Her last line, above the board — but ONLY off-call.
  //
  // On a call she is audible, and putting her words on screen while she speaks
  // them is captions, which this product removed on purpose in v1.8: reading
  // her while hearing her is what makes a voice feel like a transcript with a
  // voice attached. Off-call it is the opposite — without it the board is a
  // room she is not in.
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

  // The presence row this file used to draw itself now belongs to
  // ActivityShell, which renders it for every activity off the `her.phase`
  // this component already passes (audit #12: ttt and wyr inherited nothing
  // and their rooms still read unoccupied off-call). The one thing left here
  // is the opt-out: with a foreign game holding the slot the stage is already
  // explaining itself, which is exactly what the local version excluded.

  // ── the two controls a real table has ─────────────────────────────────
  // "End game" mid-game: he stands up. closedAt lands NOW with endedEarly, so
  // the tail says "he ended the game early, no result" — never a fabricated
  // win. "New game" appears once the game is over (or ended): the finished
  // session is REPLACED, which is the moment its afterglow ends — a person
  // starting a rematch stops narrating the last game.
  const endGame = useCallback(() => {
    tap();
    setState((s) =>
      s.game?.kind === "chess" && !s.game.closedAt
        ? { ...s, game: { ...s.game, closedAt: Date.now(), ...(s.game.game.status.over ? {} : { endedEarly: true as const }) } }
        : s,
    );
  }, [setState]);
  const newGame_ = useCallback(() => {
    tap();
    // A rematch tapped inside the reconciler's 3s close delay used to lose the
    // game it was a rematch FOR: replacing the slot re-ran the reconciler's
    // effect, cleanup cleared the pending timer, and a checkmate 200ms old
    // left no closedAt, no tally and no episode (audit #4). The finished
    // session is therefore settled synchronously here, before the fresh board
    // takes the slot; the reconciler's own `tallied`/`closedAt` guards make
    // its later run a no-op rather than a second count.
    replaceOccupant(state, setState, {
      kind: "chess" as const,
      game: newGame(),
      herSide: "b",
      startedAt: Date.now(),
    });
  }, [state, setState]);
  const showEnd = Boolean(g && !over && !session?.closedAt && g.played.length > 0);
  const showNew = Boolean(over || session?.closedAt);

  // The RESULT, stated on screen. The payoff moment of the whole activity is
  // "did I win?", and the audit found the entire on-screen answer was the
  // subtitle "good game" — identical for a checkmate either way, every draw,
  // and an early end. status.result and status.winner existed and were
  // rendered nowhere. "good game" stays as her VOICE line; this is the record.
  const verdict = useMemo(() => {
    if (!g) return null;
    if (session?.endedEarly && !g.status.over) return "Game ended. No result";
    if (!g.status.over) return null;
    switch (g.status.result) {
      case "checkmate":
        return g.status.winner === herSide ? "Checkmate. She won" : "Checkmate. You won";
      case "stalemate":
        return "Stalemate. A draw";
      case "insufficient_material":
        return "A draw: not enough pieces left to mate";
      case "threefold_repetition":
        return "A draw: same position three times";
      case "fifty_move":
        return "A draw: fifty moves with no progress";
      default:
        return null;
    }
  }, [g, session?.endedEarly, herSide]);

  return (
    <ActivityShell
      title="Chess"
      onExit={exit}
      call={call}
      note={herLine}
      presence={!foreignLive}
      footer={
        showEnd || showNew ? (
          <>
            {showEnd && (
              <button type="button" className="as-gbtn" data-tel="chess.end" onClick={endGame}>
                End game
              </button>
            )}
            {showNew && (
              <button type="button" className="as-gbtn as-gbtn-primary" data-tel="chess.new" onClick={newGame_}>
                New game
              </button>
            )}
          </>
        ) : null
      }
      her={{
        phase: hers ? "thinking" : "idle",
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
          <button type="button" className="as-gbtn as-gbtn-primary" data-tel="chess.takeover" onClick={setAsideAndStart}>
            Put it away and play chess
          </button>
        </div>
      ) : g ? (
        <>
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
          <div className="cx-moves">
            {opening ? (
              <p className="cx-opening">
                opening: <b>{opening}</b>
              </p>
            ) : null}
            <div className="cx-movelist" ref={movesRef} role="list" aria-label="Moves played">
              {moveRows.length ? (
                moveRows.map((r) => (
                  <div
                    className="cx-move"
                    role="listitem"
                    key={r.n}
                    data-latest={r.n === moveRows.length ? "" : undefined}
                  >
                    <span className="cx-mv-n">{r.n}.</span>
                    <span className="cx-mv-w">{r.w ?? ""}</span>
                    <span className="cx-mv-b">{r.b ?? ""}</span>
                  </div>
                ))
              ) : (
                <p className="cx-mv-empty">no moves yet</p>
              )}
            </div>
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
