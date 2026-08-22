// ChessBoard — the board she plays you on, usually while the call is live.
//
// This component owns NO game logic. It is handed a position and the set of
// moves that are legal in it, and its whole job is to make touching them
// feel like touching wood. Everything it derives from the FEN is *reading*
// (which piece stands where, where the king is, which colour is to move) —
// it never decides what is allowed. If it is not in `legalMoves`, it cannot
// be played here, full stop.
//
// The four things that make it feel physical:
//   1. Pieces are one absolutely-positioned layer keyed by a STABLE id, not
//      by square. When the FEN changes, the id that was on `lastMove.from`
//      is carried to `lastMove.to`, so the same DOM node changes transform
//      and CSS slides it. No FLIP, no measuring, no rAF.
//   2. A piece in flight is lifted above the rest of the set for exactly as
//      long as it travels (`flying` → `data-moving`). Without that, a knight
//      slides UNDERNEATH the pawn it is jumping and the move reads as two
//      pieces glitching rather than one piece moving.
//   3. A captured piece is held on screen for one beat as a ghost and sinks
//      away under the piece that took it, instead of blinking out.
//   4. A drag is the same element, transition suspended, following the
//      finger, with a faint copy left on the square it came from (a thumb
//      covers that square completely); letting go of an illegal square just
//      restores the transform and the piece walks itself home.
//
// Tap-to-move and drag-to-move are the same state machine, not two — see
// `onDown`/`onUp`. Phone users split roughly evenly between the two and the
// ones who drag will occasionally tap, mid-game, without noticing.

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import "../styles/chess.css";
import { PieceDefs, PieceGlyph, ROLE_NAME, ROLE_VALUE, piecePaintVars } from "./chess/pieces";
import type { Color, PromotionRole, Role } from "./chess/pieces";
import { tap, ImpactStyle } from "../native/haptics";

export type { Color, PromotionRole, Role };

/** Algebraic square name, e.g. `"e4"`. */
export type Square = string;

/** How `src/engine/chess` spells a colour. Accepted anywhere `Color` is. */
export type Side = "w" | "b";

/** Both spellings in, one spelling out. Keeps the mapping in ONE place
 *  instead of at every call site, which is where it would get inverted. */
type ColorInput = Color | Side;
const toColor = (c: ColorInput): Color => (c === "w" ? "white" : c === "b" ? "black" : c);

const PROMOTABLE: readonly string[] = ["q", "r", "b", "n"];

export interface LegalMove {
  from: Square;
  to: Square;
  /**
   * Only `"q" | "r" | "b" | "n"` mean anything; `null`, `undefined` and
   * anything else are read as "not a promotion". Typed loosely on purpose so
   * `src/engine/chess`'s `promotion: PieceType | null` drops in unmapped —
   * an adapter in the middle is one more place for a queen to become a king.
   */
  promotion?: PromotionRole | string | null;
}

export interface CapturedPieces {
  /** WHITE pieces that have been captured — i.e. black's winnings. */
  white?: readonly Role[];
  /** BLACK pieces that have been captured — i.e. white's winnings. */
  black?: readonly Role[];
}

export interface ChessBoardProps {
  /** Full FEN, or just the placement field. The only source of the position. */
  fen: string;
  /**
   * Every legal move in this position, flat. A promoting move appears four
   * times (one per `promotion`); the picker is offered from exactly those
   * entries, so a board that only allows queening simply never asks.
   * Nothing outside this list can be played, whatever the FEN implies.
   */
  legalMoves?: readonly LegalMove[];
  /** Fired once per committed move. Never called when `interactive` is false. */
  onMove?: (from: Square, to: Square, promotion?: PromotionRole) => void;
  /** Which colour sits at the bottom. `"w"`/`"b"` accepted. */
  orientation?: ColorInput;
  /** False on her turn and when the game is over: the board takes no input. */
  interactive?: boolean;
  /** Tints both squares, and drives the slide animation. */
  lastMove?: { from: Square; to: Square } | null;
  /** The side in check; its king's square is flashed. `"w"`/`"b"` accepted. */
  inCheck?: ColorInput | null;
  captured?: CapturedPieces;
  /** `"dark"` when mounted over the call ground. Re-inks the set and squares. */
  tone?: "paper" | "dark";
  /** File letters and rank numbers on the edge squares. Default true. */
  coordinates?: boolean;
  /** Accessible name for the grid. */
  label?: string;
  className?: string;
}

/* ── reading the position ─────────────────────────────────────────────── */

const FILES = "abcdefgh";

interface Piece {
  role: Role;
  color: Color;
}

/** Board indices run 0 = a8 … 63 = h1, i.e. FEN order. */
function squareName(i: number): Square {
  return FILES[i % 8] + String(8 - Math.floor(i / 8));
}

function squareIndex(sq: Square): number {
  const f = FILES.indexOf(sq[0]);
  const r = Number(sq[1]);
  if (f < 0 || !r) return -1;
  return (8 - r) * 8 + f;
}

function parseFen(fen: string): { board: (Piece | null)[]; turn: Color } {
  const board: (Piece | null)[] = new Array(64).fill(null);
  const [placement, side] = fen.trim().split(/\s+/);
  let i = 0;
  for (const ch of placement ?? "") {
    if (ch === "/") continue;
    if (ch >= "1" && ch <= "9") {
      i += Number(ch);
      continue;
    }
    if (i > 63) break;
    const lower = ch.toLowerCase() as Role;
    if ("kqrbnp".includes(lower)) {
      board[i] = { role: lower, color: ch === ch.toUpperCase() ? "white" : "black" };
    }
    i++;
  }
  return { board, turn: side === "b" ? "black" : "white" };
}

/** a8 is light. */
const isLightSquare = (i: number) => (Math.floor(i / 8) + (i % 8)) % 2 === 0;

/* ── piece identity across positions ──────────────────────────────────── */

interface Placed {
  id: number;
  sq: number;
  role: Role;
  color: Color;
}

let nextId = 1;

export default function ChessBoard({
  fen,
  legalMoves = [],
  onMove,
  orientation: orientationIn = "white",
  interactive = true,
  lastMove = null,
  inCheck: inCheckIn = null,
  captured = {},
  tone = "paper",
  coordinates = true,
  label = "Chess board",
  className = "",
}: ChessBoardProps) {
  const { board } = useMemo(() => parseFen(fen), [fen]);
  const orientation = toColor(orientationIn);
  const inCheck = inCheckIn ? toColor(inCheckIn) : null;

  const boardRef = useRef<HTMLDivElement | null>(null);
  // Per-mount, so two boards on one page cannot steal each other's paint.
  // `:` is legal in an id but not in a `url(#…)` fragment without escaping.
  const paintId = useId().replace(/:/g, "");

  const [pieces, setPieces] = useState<Placed[]>([]);
  const [ghosts, setGhosts] = useState<Placed[]>([]);
  // The ids currently in flight. Only used to lift them above the rest of the
  // set for the length of the travel: a knight that slides UNDER the pawn it
  // is jumping reads as two pieces glitching, not as one piece moving.
  const [flying, setFlying] = useState<readonly number[]>([]);
  const prevRef = useRef<{ board: (Piece | null)[]; pieces: Placed[] } | null>(null);
  const ghostTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Depended on as two strings, never as the object. A parent that rebuilds
  // `{from,to}` inline on every render — which is the normal way to write a
  // parent — would otherwise rerun the diff below on every render and refire
  // the capture animation each time.
  const lmFrom = lastMove ? lastMove.from : "";
  const lmTo = lastMove ? lastMove.to : "";

  /* Rebuild the piece layer whenever the position changes, carrying ids
     across the one move we were told about. Runs in an effect on purpose:
     the node must have painted at its OLD transform for the browser to have
     anything to transition FROM. */
  useEffect(() => {
    const prev = prevRef.current;
    const byId = new Map<number, Placed>();
    const prevBySq = new Map<number, Placed>();
    if (prev) for (const p of prev.pieces) prevBySq.set(p.sq, p);

    // Which square each arriving piece came from. Populated only from
    // `lastMove` — nothing here works out what moved on its own.
    const carry = new Map<number, number>();
    let epVictim = -1;
    if (prev && lmFrom && lmTo) {
      const from = squareIndex(lmFrom);
      const to = squareIndex(lmTo);
      const mover = from >= 0 ? prev.board[from] : null;
      if (mover && to >= 0) {
        carry.set(to, from);
        // Castling: the rook travels too, and no prop tells us so. This is
        // geometry off `lastMove`, not a rule — if the guard is ever wrong
        // the rook simply appears instead of sliding.
        const dFile = (to % 8) - (from % 8);
        if (mover.role === "k" && Math.abs(dFile) === 2) {
          const row = Math.floor(from / 8) * 8;
          const rookFrom = dFile > 0 ? row + 7 : row;
          const rookTo = dFile > 0 ? row + 5 : row + 3;
          const r = prev.board[rookFrom];
          if (r && r.role === "r" && r.color === mover.color && board[rookTo]?.role === "r") {
            carry.set(rookTo, rookFrom);
          }
        }
        // En passant: the pawn that died is not on the destination square.
        if (mover.role === "p" && dFile !== 0 && !prev.board[to]) {
          const cand = Math.floor(from / 8) * 8 + (to % 8);
          if (prev.board[cand]?.role === "p" && !board[cand]) epVictim = cand;
        }
      }
    }

    const used = new Set<number>();
    const out: Placed[] = [];
    const inFlight: number[] = [];
    for (let sq = 0; sq < 64; sq++) {
      const piece = board[sq];
      if (!piece) continue;
      const src = carry.get(sq);
      const cand = prevBySq.get(src ?? sq);
      // A carried piece keeps its id even if the role changed — that is a
      // pawn promoting, and it is the same piece of wood.
      const reusable =
        cand &&
        !used.has(cand.id) &&
        cand.color === piece.color &&
        (src !== undefined || cand.role === piece.role);
      const id = reusable ? cand.id : nextId++;
      if (reusable) used.add(cand.id);
      if (reusable && src !== undefined) inFlight.push(id);
      const placed: Placed = { id, sq, role: piece.role, color: piece.color };
      out.push(placed);
      byId.set(id, placed);
    }

    // Only the pieces this move actually took get a death animation. Pieces
    // that vanish for any other reason (new game, takeback, a fresh FEN)
    // are simply gone, which is the honest rendering of those events.
    const dead: Placed[] = [];
    if (prev && lmTo) {
      const victim = prevBySq.get(squareIndex(lmTo));
      if (victim && !used.has(victim.id)) dead.push(victim);
      if (epVictim >= 0) {
        const ep = prevBySq.get(epVictim);
        if (ep && !used.has(ep.id)) dead.push(ep);
      }
    }

    // DOM ORDER MUST BE STABLE, and this line is the whole slide.
    //
    // `out` is built by walking squares 0…63, so a piece that moves changes
    // its POSITION in the list as well as its transform — e5→d4 moves it
    // seven places later. React honours that by re-inserting the node, and a
    // node removed and re-inserted in the same task has its before-change
    // style reset: Chrome fires no `transitionrun` at all and the piece
    // teleports. It was doing exactly that, silently, for every move long
    // enough to overtake another piece in square order — which is why short
    // moves appeared to glide and knights never did.
    //
    // Sorting by the stable id means the list order never changes for a
    // move, React only writes `style.transform`, and the transition runs.
    // Ids are assigned in creation order, so a promoted piece simply appends.
    out.sort((a, b) => a.id - b.id);
    prevRef.current = { board, pieces: out };
    setPieces(out);
    if (inFlight.length) {
      setFlying(inFlight);
      clearTimeout(flyTimer.current);
      // One tick past --d-tap (180ms). Held a beat longer than the travel so
      // the piece is fully down before it rejoins the rest of the set.
      flyTimer.current = setTimeout(() => setFlying([]), 240);
    }
    if (dead.length) {
      setGhosts(dead);
      clearTimeout(ghostTimer.current);
      // The death animation waits out the travel (--d-tap, 180ms) before it
      // runs its 220ms, so the ghost has to outlive both.
      ghostTimer.current = setTimeout(() => setGhosts([]), 440);
    }
  }, [board, lmFrom, lmTo]);

  useEffect(
    () => () => {
      clearTimeout(ghostTimer.current);
      clearTimeout(flyTimer.current);
    },
    [],
  );

  /* ── the legal-move index ───────────────────────────────────────────── */

  // from → to → promotable roles (empty array for an ordinary move).
  const moveMap = useMemo(() => {
    const m = new Map<number, Map<number, PromotionRole[]>>();
    for (const mv of legalMoves) {
      const from = squareIndex(mv.from);
      const to = squareIndex(mv.to);
      if (from < 0 || to < 0) continue;
      let dests = m.get(from);
      if (!dests) m.set(from, (dests = new Map()));
      let promos = dests.get(to);
      if (!promos) dests.set(to, (promos = []));
      const p = mv.promotion;
      // A `promotion` that is not one of the four promotable roles is not a
      // promotion — including the rules module's `null` and a stray "k".
      if (p && PROMOTABLE.includes(p) && !promos.includes(p as PromotionRole)) {
        promos.push(p as PromotionRole);
      }
    }
    return m;
  }, [legalMoves]);

  /* ── interaction state ──────────────────────────────────────────────── */

  const [sel, setSel] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ id: number; from: number; x: number; y: number; over: number | null } | null>(null);
  const [promo, setPromo] = useState<{ from: number; to: number; color: Color; options: PromotionRole[] } | null>(null);
  const [cursor, setCursor] = useState(0); // roving tabindex, in VISUAL order
  const gesture = useRef<{
    from: number;
    px: number;
    py: number;
    moved: boolean;
    commit: boolean;
    wasSel: boolean;
  } | null>(null);
  const refocus = useRef(false);

  const dests = sel !== null ? moveMap.get(sel) : undefined;

  // The board goes cold the instant it stops being our turn, mid-gesture or not.
  useEffect(() => {
    if (!interactive) {
      setSel(null);
      setDrag(null);
      setPromo(null);
      gesture.current = null;
    }
  }, [interactive]);

  // A position change invalidates any half-finished intent.
  useEffect(() => {
    setSel(null);
    setDrag(null);
    setPromo(null);
    gesture.current = null;
  }, [fen]);

  /* ── visual ↔ board index ───────────────────────────────────────────── */

  const flipped = orientation === "black";
  const toVisual = useCallback((i: number) => (flipped ? 63 - i : i), [flipped]);
  const fromVisual = useCallback((v: number) => (flipped ? 63 - v : v), [flipped]);

  const squareFromPoint = useCallback(
    (clientX: number, clientY: number): number | null => {
      const el = boardRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const col = Math.floor(((clientX - r.left) / r.width) * 8);
      const row = Math.floor(((clientY - r.top) / r.height) * 8);
      if (col < 0 || col > 7 || row < 0 || row > 7) return null;
      return fromVisual(row * 8 + col);
    },
    [fromVisual],
  );

  /* ── committing ─────────────────────────────────────────────────────── */

  const commit = useCallback(
    (from: number, to: number) => {
      const promos = moveMap.get(from)?.get(to);
      if (!promos) return;
      if (promos.length > 0) {
        const p = board[from];
        setPromo({ from, to, color: p ? p.color : "white", options: promos });
        setSel(null);
        return;
      }
      // Fired in the same handler that clears the selection: the haptic and
      // the visual must not drift apart. One per move — a buzz on every
      // touch would train the hand to ignore all of them.
      tap(ImpactStyle.Light);
      setSel(null);
      onMove?.(squareName(from), squareName(to));
    },
    [moveMap, board, onMove],
  );

  const choosePromotion = useCallback(
    (role: PromotionRole) => {
      if (!promo) return;
      tap(ImpactStyle.Light);
      const { from, to } = promo;
      setPromo(null);
      onMove?.(squareName(from), squareName(to), role);
    },
    [promo, onMove],
  );

  /** Tap and keyboard share this. Drag resolves through `onUp`. */
  const activate = useCallback(
    (sq: number) => {
      if (!interactive) return;
      if (sel !== null && sel !== sq && moveMap.get(sel)?.has(sq)) {
        commit(sel, sq);
        return;
      }
      if (sel === sq) {
        setSel(null);
        return;
      }
      setSel(moveMap.has(sq) ? sq : null);
    },
    [interactive, sel, moveMap, commit],
  );

  /* ── pointer: one machine for tap and drag ──────────────────────────── */

  const onDown = (e: React.PointerEvent, sq: number) => {
    setCursor(toVisual(sq));
    if (!interactive || promo) return;
    const canLift = moveMap.has(sq);
    const isDest = sel !== null && sel !== sq && Boolean(moveMap.get(sel)?.has(sq));
    if (!canLift && !isDest) {
      setSel(null);
      return;
    }
    const wasSel = sel === sq;
    // Select on DOWN, not up, so a drag starts from an already-lit square
    // and the hints are under the finger before it has travelled.
    if (canLift) setSel(sq);
    gesture.current = {
      from: sq,
      px: e.clientX,
      py: e.clientY,
      moved: false,
      commit: isDest && !canLift,
      wasSel,
    };
    boardRef.current?.setPointerCapture?.(e.pointerId);
  };

  const onMovePointer = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || g.commit) return;
    const el = boardRef.current;
    if (!el) return;
    if (!g.moved && Math.hypot(e.clientX - g.px, e.clientY - g.py) < 6) return;
    g.moved = true;
    const r = el.getBoundingClientRect();
    const half = r.width / 16;
    const piece = pieces.find((p) => p.sq === g.from);
    if (!piece) return;
    setDrag({
      id: piece.id,
      from: g.from,
      x: e.clientX - r.left - half,
      y: e.clientY - r.top - half,
      over: squareFromPoint(e.clientX, e.clientY),
    });
  };

  const onUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    boardRef.current?.releasePointerCapture?.(e.pointerId);
    if (!g) return;
    if (g.moved) {
      // Dropping outside the board, or on an illegal square, is a cancel:
      // the transform reverts and the piece walks back on its own.
      const target = squareFromPoint(e.clientX, e.clientY);
      setDrag(null);
      if (target !== null && target !== g.from && moveMap.get(g.from)?.has(target)) {
        commit(g.from, target);
      }
      return;
    }
    setDrag(null);
    // A tap on a destination of the standing selection plays the move…
    if (g.commit) {
      if (sel !== null) commit(sel, g.from);
      return;
    }
    // …and a second tap on the piece that was already lit puts it back down.
    if (g.wasSel) setSel(null);
  };

  const onCancel = () => {
    gesture.current = null;
    setDrag(null);
  };

  /* ── keyboard ───────────────────────────────────────────────────────── */

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step: Record<string, number[]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (e.key === "Escape") {
      setSel(null);
      setPromo(null);
      return;
    }
    const d = step[e.key];
    if (d) {
      e.preventDefault();
      const row = Math.min(7, Math.max(0, Math.floor(cursor / 8) + d[0]));
      const col = Math.min(7, Math.max(0, (cursor % 8) + d[1]));
      refocus.current = true;
      setCursor(row * 8 + col);
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      refocus.current = true;
      setCursor(Math.floor(cursor / 8) * 8 + (e.key === "Home" ? 0 : 7));
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate(fromVisual(cursor));
    }
  };

  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    boardRef.current?.querySelector<HTMLElement>(`[data-v="${cursor}"]`)?.focus();
  }, [cursor]);

  /* ── derived rendering data ─────────────────────────────────────────── */

  const lastFrom = lastMove ? squareIndex(lastMove.from) : -1;
  const lastTo = lastMove ? squareIndex(lastMove.to) : -1;

  const checkSquare = useMemo(() => {
    if (!inCheck) return -1;
    return board.findIndex((p) => p && p.role === "k" && p.color === inCheck);
  }, [board, inCheck]);

  /** A destination is a capture if something is standing on it — or if a
   *  pawn is stepping sideways onto an empty square, which is en passant.
   *  Pure geometry off the FEN; no legality is being decided here. */
  const isCapture = useCallback(
    (to: number) => {
      if (board[to]) return true;
      if (sel === null) return false;
      const p = board[sel];
      return Boolean(p && p.role === "p" && sel % 8 !== to % 8);
    },
    [board, sel],
  );

  const trayTop = (orientation === "white" ? captured.white : captured.black) ?? [];
  const trayBottom = (orientation === "white" ? captured.black : captured.white) ?? [];
  // Not memoised: `captured` is a prop object the parent is free to rebuild
  // every render, so a useMemo over it would recompute anyway and only cost a
  // dependency check. Summing at most fifteen small integers twice is cheaper.
  const sumValue = (xs: readonly Role[]) => xs.reduce((a, r) => a + ROLE_VALUE[r], 0);
  const material = sumValue(trayTop) - sumValue(trayBottom);

  const status =
    sel !== null && dests
      ? `${squareName(sel)} selected, ${dests.size} move${dests.size === 1 ? "" : "s"}`
      : inCheck
        ? `${inCheck} is in check`
        : "";

  /* ── render ─────────────────────────────────────────────────────────── */

  const tray = (items: readonly Role[], color: Color, side: "top" | "bottom") => {
    const sorted = [...items].sort((a, b) => ROLE_VALUE[a] - ROLE_VALUE[b]);
    const adv = side === "top" ? material : -material;
    return (
      <div className="cb-tray" data-side={side}>
        <span className="cb-tray-label" aria-hidden="true">
          taken
        </span>
        <div className="cb-tray-pieces" aria-hidden="true">
          {/* Overlapped within a role, spaced between roles. Five pawns and a
              rook then read as "five and one" instead of as one smear. */}
          {sorted.map((r, i) => (
            <span
              className="cb-tray-piece"
              data-group={i > 0 && sorted[i - 1] !== r ? "" : undefined}
              key={i}
            >
              <PieceGlyph role={r} color={color} />
            </span>
          ))}
        </div>
        {adv > 0 && <span className="cb-material">+{adv}</span>}
        <span className="sr-only">
          {sorted.length
            ? `Captured: ${sorted.map((r) => `${color} ${ROLE_NAME[r]}`).join(", ")}`
            : "Nothing captured"}
        </span>
      </div>
    );
  };

  return (
    <div
      className={`cb ${className}`}
      data-tone={tone}
      data-idle={interactive ? undefined : ""}
      /* `url(#…)` handles for the shared gradients below. An id is not a
         colour — every colour they resolve to is a stop in chess.css, off
         the same tokens as the rest of the board. */
      style={piecePaintVars(paintId)}
    >
      <PieceDefs id={paintId} />
      {tray(trayTop, orientation === "white" ? "white" : "black", "top")}

      <div className="cb-frame">
        <div
          className="cb-board"
          ref={boardRef}
          role="grid"
          aria-label={label}
          aria-disabled={interactive ? undefined : true}
          onKeyDown={onKeyDown}
          onPointerMove={onMovePointer}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
        >
          {Array.from({ length: 8 }, (_, row) => (
            <div className="cb-row" role="row" key={row}>
              {Array.from({ length: 8 }, (_, col) => {
                const v = row * 8 + col;
                const sq = fromVisual(v);
                const piece = board[sq];
                const isDest = Boolean(dests?.has(sq));
                const cap = isDest && isCapture(sq);
                const name = squareName(sq);
                let aria = piece
                  ? `${name}, ${piece.color} ${ROLE_NAME[piece.role]}`
                  : `${name}, empty`;
                if (isDest) aria += cap ? ", capture available" : ", move here";
                if (sq === checkSquare) aria += ", in check";
                return (
                  <button
                    type="button"
                    key={col}
                    role="gridcell"
                    data-v={v}
                    className="cb-sq"
                    data-light={isLightSquare(sq) ? "" : undefined}
                    data-sel={sq === sel ? "" : undefined}
                    data-dest={isDest && !cap ? "" : undefined}
                    data-cap={cap ? "" : undefined}
                    data-last={sq === lastFrom || sq === lastTo ? "" : undefined}
                    data-last-to={sq === lastTo ? "" : undefined}
                    data-check={sq === checkSquare ? "" : undefined}
                    data-over={drag?.over === sq ? "" : undefined}
                    tabIndex={v === cursor ? 0 : -1}
                    aria-label={aria}
                    aria-selected={sq === sel}
                    aria-disabled={interactive ? undefined : true}
                    onPointerDown={(e) => onDown(e, sq)}
                    onFocus={() => setCursor(v)}
                  >
                    {coordinates && col === 0 && (
                      <span className="cb-coord cb-rank" aria-hidden="true">
                        {name[1]}
                      </span>
                    )}
                    {coordinates && row === 7 && (
                      <span className="cb-coord cb-file" aria-hidden="true">
                        {name[0]}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}

          {/* One layer, above the squares, deaf to the pointer. */}
          <div className="cb-pieces" aria-hidden="true">
            {ghosts.map((g) => {
              const v = toVisual(g.sq);
              return (
                <div
                  className="cb-piece"
                  data-ghost=""
                  key={`g${g.id}`}
                  style={{ transform: `translate(${(v % 8) * 100}%, ${Math.floor(v / 8) * 100}%)` }}
                >
                  <PieceGlyph role={g.role} color={g.color} />
                </div>
              );
            })}
            {pieces.map((p) => {
              const dragging = drag?.id === p.id;
              const v = toVisual(p.sq);
              const home = `translate(${(v % 8) * 100}%, ${Math.floor(v / 8) * 100}%)`;
              return (
                <Fragment key={p.id}>
                  {/* The square you lifted FROM keeps a faint copy while the
                      real piece is under your finger. A thumb covers the
                      origin square completely; without this there is no way
                      to see what you picked up. */}
                  {dragging && (
                    <div className="cb-piece" data-source="" style={{ transform: home }}>
                      <PieceGlyph role={p.role} color={p.color} />
                    </div>
                  )}
                  <div
                    className="cb-piece"
                    data-dragging={dragging ? "" : undefined}
                    data-moving={!dragging && flying.includes(p.id) ? "" : undefined}
                    style={{
                      transform: dragging ? `translate(${drag!.x}px, ${drag!.y}px)` : home,
                    }}
                  >
                    <PieceGlyph role={p.role} color={p.color} />
                  </div>
                </Fragment>
              );
            })}
          </div>

          {promo && (
            <PromotionPicker
              promo={promo}
              toVisual={toVisual}
              onPick={choosePromotion}
              onCancel={() => setPromo(null)}
            />
          )}
        </div>
      </div>

      {tray(trayBottom, orientation === "white" ? "black" : "white", "bottom")}

      <div className="sr-only" role="status" aria-live="polite">
        {status}
      </div>
    </div>
  );
}

/* ── promotion ────────────────────────────────────────────────────────── */

// Grows out of the promotion square itself, along its own file, so the
// choice appears where the eye already is. Order is queen-first because
// that is the answer more than ninety times in a hundred.
const PROMO_ORDER: PromotionRole[] = ["q", "r", "b", "n"];

function PromotionPicker({
  promo,
  toVisual,
  onPick,
  onCancel,
}: {
  promo: { from: number; to: number; color: Color; options: PromotionRole[] };
  toVisual: (i: number) => number;
  onPick: (r: PromotionRole) => void;
  onCancel: () => void;
}) {
  const v = toVisual(promo.to);
  const col = v % 8;
  const row = Math.floor(v / 8);
  const options = PROMO_ORDER.filter((r) => promo.options.includes(r));
  // Fall out of the top edge downwards, out of the bottom edge upwards.
  const down = row < 4;
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => ref.current?.focus(), []);

  return (
    <div className="cb-promo" role="dialog" aria-modal="true" aria-label="Promote to">
      <button
        type="button"
        className="cb-promo-scrim"
        aria-label="Cancel promotion"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onCancel}
      />
      <div
        className="cb-promo-strip"
        data-dir={down ? "down" : "up"}
        style={{
          left: `${col * 12.5}%`,
          [down ? "top" : "bottom"]: `${(down ? row : 7 - row) * 12.5}%`,
        }}
      >
        {options.map((r, i) => (
          <button
            type="button"
            key={r}
            ref={i === 0 ? ref : undefined}
            className="cb-promo-opt"
            aria-label={`Promote to ${ROLE_NAME[r]}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onPick(r)}
          >
            <PieceGlyph role={r} color={promo.color} />
          </button>
        ))}
      </div>
    </div>
  );
}
