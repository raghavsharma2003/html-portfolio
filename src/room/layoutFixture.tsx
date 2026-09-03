/* THE LAYOUT GATE'S EYES, FOR THE ROOM.
 *
 * `src/studio/layoutFixture.tsx`'s reason, one surface over, and it is the
 * reason the brief allowed for: the Room's screens are all SIGNED IN. Pointing
 * `scripts/check-layout.mjs` at `/r/anjali` would render the "this room is not
 * open" card at three widths and report OK, which is the exact defect class the
 * layout gate was written to catch (a check that cannot see the thing it
 * checks). Signing in for real needs a Supabase user and a service key, and a
 * gate that needs a secret is a gate CI skips.
 *
 * So this page renders the REAL `RoomApp`, imported from source, with a joined
 * follower and a conversation already in it, and no network at all. The
 * components are the shipping components; only the data is fixture.
 *
 * It is inert in production by construction: it refuses to render anywhere but
 * loopback, and nothing links to it.
 *
 * ?screen=join renders the join sheet (the longest prose in the product: the
 * disclosure card, the age line and the whole memory question). ?screen=talk
 * renders the conversation. Both are measured, because the two have completely
 * different layouts and the collapsed-column bug the gate exists for lives in
 * whichever one nobody looked at.
 */
import ReactDOM from "react-dom/client";
import RoomApp from "./RoomApp";
import "../studio/design/tokens.css";
import "../studio/studio.css";
import "./room.css";
import type { RoomOpen } from "./roomApi";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", ""]);

/* The card is byte-identical to `roomDisclosureCard("Anjali")` in
 * api/_room-surface.js. It is written out rather than imported because that
 * module is a serverless function under the zero-imports-from-src rule read in
 * the other direction; what stops the two drifting is that the real one is
 * asserted in evals/room/run.mjs against the real function. */
const CARD = [
  "You are talking with Anjali AI. It is not Anjali.",
  "Anjali built it from their own material and published it here. Anjali does not read these conversations.",
  "What you say stays in your own thread. Nobody else who talks to Anjali AI can see any of it.",
].join("\n");

const FIXTURE_OPEN: RoomOpen = {
  room: { slug: "anjali", display_name: "Anjali", name: "Anjali" },
  disclosure: CARD,
  joined: true,
  follower: {
    joined_at: "2026-08-14T09:00:00.000Z",
    tier: "free",
    remembers: true,
    messages_used: 6,
    messages_included: 20,
    messages_left: 14,
  },
  threads: [
    { thread_id: "11111111-1111-4111-8111-111111111111", title: "fitness", last_message_at: null },
    { thread_id: "22222222-2222-4222-8222-222222222222", title: "nutrition", last_message_at: null },
  ],
  session: "r1.fixture.fixture",
};

/* Real prose, at real lengths. A fixture of three-word replies would pass every
 * readability check while telling nobody whether a real answer wraps, and the
 * measured catastrophes were all long paragraphs in collapsed columns. */
const FIXTURE_TURNS = [
  { role: "user" as const, content: "why does the block not slide when I push harder?" },
  {
    role: "assistant" as const,
    content:
      "Because friction is answering you, not resisting you. Static friction is whatever it needs to be, up to a ceiling, so every extra newton you push with is matched exactly until you cross that ceiling. Find the ceiling first and the rest of the problem stops being mysterious: it is the coefficient times the normal force, and nothing about how hard you happen to be pushing.",
  },
  { role: "user" as const, content: "so the number in the answer key is the maximum, not the actual?" },
  {
    role: "assistant" as const,
    content:
      "That is exactly it, and it is the single most common place this goes wrong in an exam. Write the maximum down as a separate line, compare it with the applied force, and only then decide which regime you are in. Two lines of working, and the whole family of questions collapses into one method you already know.",
  },
];

function render() {
  const screen = new URLSearchParams(window.location.search).get("screen") || "talk";
  const open = screen === "join" ? { ...FIXTURE_OPEN, joined: false, session: null } : FIXTURE_OPEN;
  ReactDOM.createRoot(document.getElementById("room-root")!).render(
    <RoomApp fixtureOpen={open} fixtureTurns={screen === "join" ? [] : FIXTURE_TURNS} />,
  );
}

if (LOOPBACK.has(window.location.hostname)) {
  render();
} else {
  // Not an error page and not a redirect: a blank, honest refusal. This file is
  // in the build output and must do nothing at all anywhere it is not the gate.
  document.getElementById("room-root")!.textContent = "";
}
