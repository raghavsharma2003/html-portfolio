// A DESIGN HARNESS, not a route and not a gate.
//
// It exists so the board can be looked at in states that are expensive to
// reach by playing — a promotion picker, a capture mid-flight, a king in
// check on both grounds — and it is served by `vite` at
// `/src/components/chess/preview.html`. It is not reachable from the app and
// vite's build only follows `index.html`, so nothing here ships.
import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "../../styles/global.css";
import ChessBoard from "../ChessBoard";
import type { LegalMove } from "../ChessBoard";

const OPENING = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
// After 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.d3 Nf6 — a real middlegame shape.
const MID = "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2BPP3/3P1N2/PPP2PPP/RNBQK2R b KQkq - 0 5";
// Black king on e8 in check from a bishop on b5.
const CHECK = "rnb1kbnr/pppp1ppp/8/1B2p3/4P1q1/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 1";
// White pawn on b7, one step from queening.
const PROMO = "1n2k3/1P6/8/8/8/8/6K1/8 w - - 0 1";

const promoMoves: LegalMove[] = [
  { from: "b7", to: "b8", promotion: "q" },
  { from: "b7", to: "b8", promotion: "r" },
  { from: "b7", to: "b8", promotion: "b" },
  { from: "b7", to: "b8", promotion: "n" },
  { from: "b7", to: "c8", promotion: "q" },
  { from: "b7", to: "c8", promotion: "r" },
  { from: "b7", to: "c8", promotion: "b" },
  { from: "b7", to: "c8", promotion: "n" },
];

const midMoves: LegalMove[] = [
  { from: "c6", to: "d4" },
  { from: "c6", to: "b4" },
  { from: "c6", to: "a5" },
  { from: "c6", to: "e7" },
  { from: "c6", to: "b8" },
];

type Scene = "open" | "mid" | "check" | "promo" | "capture";

function Harness() {
  const q = new URLSearchParams(location.search);
  const scene = (q.get("scene") ?? "open") as Scene;
  const tone = (q.get("tone") ?? "paper") as "paper" | "dark";

  // The capture scene plays the move for real, one tick after mount, so the
  // slide and the ghost are the same code path the game uses.
  const [fen, setFen] = useState(scene === "capture" ? MID : sceneFen(scene));
  const [last, setLast] = useState<{ from: string; to: string } | null>(
    scene === "mid" ? { from: "f1", to: "c4" } : null,
  );
  useEffect(() => {
    if (scene !== "capture") return;
    const t = setTimeout(() => {
      setFen("r1bqk2r/pppp1ppp/2n2n2/2b5/2BpP3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 6");
      setLast({ from: "e5", to: "d4" });
    }, 400);
    return () => clearTimeout(t);
  }, [scene]);

  return (
    <div style={{ padding: 16, background: "var(--bg)", minHeight: "100vh" }}>
      <ChessBoard
        fen={fen}
        legalMoves={scene === "promo" ? promoMoves : scene === "mid" ? midMoves : []}
        orientation="w"
        interactive={scene === "promo" || scene === "mid"}
        lastMove={last}
        inCheck={scene === "check" ? "b" : null}
        captured={
          scene === "open" ? {} : { white: ["p", "p", "n"], black: ["p", "p", "p", "b", "r"] }
        }
        tone={tone}
        label="Chess board"
      />
    </div>
  );
}

function sceneFen(s: Scene) {
  if (s === "mid") return MID;
  if (s === "check") return CHECK;
  if (s === "promo") return PROMO;
  return OPENING;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Harness />);
