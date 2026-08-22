// A DESIGN HARNESS, not a route and not a gate — the same thing
// `components/chess/preview.tsx` is, for the same reason.
//
// The celebration is the one surface in the app that is, by design, almost
// impossible to reach on demand: every moment fires exactly once, ever, and
// the fired-ledger makes sure of it. Looking at the buildup, the peak and the
// settle therefore cannot be done by playing. This renders the card directly
// against a fake Moment so it can be seen, screenshotted and argued about.
//
// Served by vite at `/src/components/celebrate/preview.html`. It is not
// reachable from the app and the build only follows `index.html`, so nothing
// here ships.
//
// Query params:
//   ?kind=days-known|messages|calls|first-game|first-chess-win-him|…
//   ?theme=light|dark          forces the attribute the app's theme sets
//   ?hold=99999                keeps the card up (screenshots)
//   ?bg=chat|call              which ground to judge it over

import { useState } from "react";
import ReactDOM from "react-dom/client";
import "../../styles/global.css";
import Celebration from "../Celebration";
import type { Moment, MilestoneKind } from "../../engine/milestones";

const SAMPLES: Record<string, Moment> = {
  "days-known": {
    id: "days-7",
    kind: "days-known",
    title: "7 days of you two",
    detail: "since your very first message",
  },
  messages: {
    id: "msgs-100",
    kind: "messages",
    title: "100 messages",
    detail: "and counting",
  },
  calls: { id: "calls-1", kind: "calls", title: "Your first call" },
  "first-game": {
    id: "first-game",
    kind: "first-game",
    title: "Your first game together",
  },
  "first-chess-win-him": {
    id: "chess-first-win-him",
    kind: "first-chess-win-him",
    title: "You beat her at chess",
    detail: "she will want a rematch",
  },
  "days-365": {
    id: "days-365",
    kind: "days-known",
    title: "One year of you two",
    detail: "since your very first message",
  },
};

function Harness() {
  const q = new URLSearchParams(location.search);
  const kind = q.get("kind") ?? "days-known";
  const theme = q.get("theme");
  const hold = Number(q.get("hold") ?? 99_999);
  const bg = q.get("bg") ?? "chat";

  if (theme === "light" || theme === "dark")
    document.documentElement.setAttribute("data-theme", theme);

  const [moment, setMoment] = useState<Moment | null>(SAMPLES[kind] ?? SAMPLES["days-known"]);
  const [nonce, setNonce] = useState(0);

  return (
    <div
      className="app grain"
      style={{
        position: "fixed",
        inset: 0,
        background:
          bg === "call" ? "linear-gradient(#241619, #100b0c)" : "var(--bg)",
      }}
    >
      {/* something under it, so the card is judged over a ground rather than
          over nothing — a card that only looks right on white is not done */}
      <div style={{ padding: "24px 18px", display: "grid", gap: 10 }}>
        {["haan yaar", "kal milte hain?", "ok ok wait", "sun na"].map((t, i) => (
          <div
            key={i}
            style={{
              justifySelf: i % 2 ? "end" : "start",
              maxWidth: "72%",
              padding: "9px 13px",
              borderRadius: 18,
              fontSize: "16.5px",
              background: i % 2 ? "var(--bubble-me)" : "var(--surface-2)",
              color: i % 2 ? "var(--bubble-me-ink)" : "var(--ink)",
            }}
          >
            {t}
          </div>
        ))}
        <button
          type="button"
          data-testid="refire"
          style={{
            justifySelf: "start",
            marginTop: 12,
            padding: "8px 14px",
            borderRadius: 999,
            border: "1px solid var(--hairline-strong)",
            background: "var(--surface)",
            color: "var(--ink)",
          }}
          onClick={() => {
            setMoment(null);
            setNonce((n) => n + 1);
            setTimeout(() => setMoment(SAMPLES[kind] ?? SAMPLES["days-known"]), 60);
          }}
        >
          re-fire
        </button>
      </div>

      <Celebration
        key={nonce}
        moment={moment}
        holdMs={hold}
        onDone={() => setMoment(null)}
      />
    </div>
  );
}

// referenced so the type import is load-bearing rather than decorative
const _kinds: MilestoneKind[] = ["days-known", "messages", "calls"];
void _kinds;

ReactDOM.createRoot(document.getElementById("root")!).render(<Harness />);
