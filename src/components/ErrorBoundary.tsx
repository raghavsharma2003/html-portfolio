// The net under the activity overlay — and ONLY under the activity overlay.
//
// The audit found that a game session with malformed move records took the
// WHOLE app down: ChessBoard reads `lastMove.from` and does `sq[0]` on it, so
// a row without `from` throws during render, above every setState, and React
// unmounts the entire tree (rootKids=0). Because the session is persisted
// locally, the white screen came back on every reload — the app was gone, not
// glitching. `isGameSession` now rejects those rows at the boundary, which is
// the real fix; this is the answer to the next shape nobody predicted.
//
// Two deliberate limits:
//
// 1. IT WRAPS THE OVERLAY, NOT THE APP. A boundary around the root would turn
//    every future render bug into the same apologetic card sitting where she
//    used to be — a companion replaced by an error message is worse than a
//    companion that crashed, because it looks intentional. Scoped here, the
//    chat, the call and the whole relationship keep running; a board is what
//    is lost, and a board is replaceable.
// 2. IT OFFERS EXACTLY ONE ACTION, AND THAT ACTION CHANGES THE STATE. A
//    "try again" that re-renders the same malformed session is a loop the user
//    cannot leave. Putting the game away NULLS it, so the thing that threw is
//    gone before the retry — which is why the button says what it does to the
//    game rather than "dismiss".
//
// React error boundaries have no hook form: `getDerivedStateFromError` and
// `componentDidCatch` are class-only, which is the sole reason this file
// contains a class.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { tel } from "../engine/telemetry";

interface Props {
  children: ReactNode;
  /** Put the game away: nulls the session AND closes the overlay. */
  onPutAway: () => void;
  /** What blew up, for the telemetry record ("activity"). */
  where: string;
}

interface State {
  failed: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // A crash that nobody records is a crash nobody fixes, and this one is
    // invisible by construction: it happens on ONE device, to a persisted
    // blob, and the person it happens to sees a game that will not open.
    // Message + the first frames only — never the component tree dump, which
    // on this surface can carry what they were saying.
    try {
      tel("ui.crash", {
        where: this.props.where,
        message: String(error?.message ?? error).slice(0, 200),
        stack: String(error?.stack ?? "").split("\n").slice(0, 3).join(" | ").slice(0, 300),
        component: String(info?.componentStack ?? "").trim().split("\n")[0]?.trim().slice(0, 80),
      });
    } catch {
      /* telemetry must never be the second crash */
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alertdialog"
        aria-label="This game could not be opened"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 70,
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background: "var(--scrim, rgba(32,22,20,0.38))",
          backdropFilter: "blur(4px)",
        }}
      >
        {/* The app's own tokens, inline: a boundary that depends on a
            stylesheet having loaded is a boundary that fails exactly when the
            page is already failing. Every var carries a literal fallback. */}
        <div
          style={{
            maxWidth: "20rem",
            width: "100%",
            padding: "20px",
            borderRadius: "var(--r-md, 18px)",
            background: "var(--surface, #ffffff)",
            color: "var(--ink, #201b19)",
            boxShadow: "var(--shadow-float, 0 12px 40px -12px rgba(60,40,34,0.28))",
            textAlign: "center",
            fontFamily: "var(--font-ui, system-ui, sans-serif)",
          }}
        >
          {/* App chrome, never a line she says — same discipline as the rest
              of the UI copy. She did not break; a board did. */}
          <p style={{ margin: "0 0 6px", fontWeight: 600 }}>This board won't open</p>
          <p
            style={{
              margin: "0 0 16px",
              color: "var(--ink-dim, #6d635e)",
              fontSize: "0.92em",
              lineHeight: 1.45,
            }}
          >
            Something went wrong with this game. Putting it away keeps
            everything else. Your chat is untouched.
          </p>
          <button
            data-tel="activity.put_away"
            onClick={() => {
              this.setState({ failed: false });
              this.props.onPutAway();
            }}
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: "999px",
              border: "none",
              cursor: "pointer",
              font: "inherit",
              fontWeight: 600,
              background: "var(--accent-solid, #c23f56)",
              color: "var(--on-solid, #ffffff)",
            }}
          >
            Put the game away
          </button>
        </div>
      </div>
    );
  }
}
