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
 *
 * ?lang=hi (WS-R24) renders the SAME two screens with the Room's chrome in
 * Hindi (`ROOM_COPY_TABLE.hi`) instead of English - `scripts/check-layout.mjs`'s
 * `room:hi` target points here. The disclosure card below has its own Hindi
 * text for exactly the same reason `RoomApp.tsx`'s real one does: the card's
 * bytes are locale-bound, so a fixture claiming `locale: "hi"` while still
 * showing the English card would measure a screen no follower ever sees.
 */
import ReactDOM from "react-dom/client";
import RoomApp from "./RoomApp";
import "../studio/design/tokens.css";
import "../studio/studio.css";
import "./room.css";
import type { RoomOpen, RoomSettings } from "./roomApi";
import type { RoomPaymentStatus } from "./roomPayApi";

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

/** Byte-identical in shape to `roomDisclosureCard("Anjali", "hi")` in
 *  api/_room-surface.js - same reason `CARD` above is written out rather than
 *  imported. */
const CARD_HI = [
  "आप Anjali AI से बात कर रहे हैं। यह Anjali नहीं है।",
  "Anjali ने इसे अपनी सामग्री से बनाया और यहां प्रकाशित किया। Anjali यह बातचीत नहीं पढ़ते।",
  "आप जो कहते हैं वह सिर्फ आपकी अपनी थ्रेड में रहता है। Anjali AI से बात करने वाला कोई और इसमें से कुछ भी नहीं देख सकता।",
].join("\n");

const FIXTURE_OPEN: RoomOpen = {
  room: { slug: "anjali", display_name: "Anjali", name: "Anjali", handoff_enabled: true },
  disclosure: CARD,
  locale: "en",
  joined: true,
  follower: {
    joined_at: "2026-08-14T09:00:00.000Z",
    tier: "free",
    remembers: true,
    messages_used: 6,
    messages_included: 20,
    messages_left: 14,
    voice_seconds_used: 0,
    voice_seconds_included: 0,
    voice_seconds_left: 0,
    // WS-R39: a follower who has never opened the account screen yet, so
    // ?screen=account below has a real reminder line to measure.
    settings_reviewed_at: null,
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

/* WS-R39. `roomSettings`'s own composed shape, at real values — a masked
 * WhatsApp number and a connected Telegram pointer, both true, so the account
 * screen's channel section renders every one of its blocks rather than the
 * shortest possible one. Byte-similar to what `api/_room-surface.js`'s
 * `roomSettings` actually returns; not imported, for the same standalone
 * reason `CARD`/`CARD_HI` above are written out rather than imported. */
const FIXTURE_SETTINGS: RoomSettings = {
  room: { slug: "anjali", name: "Anjali", display_name: "Anjali" },
  disclosure: CARD,
  locale: "en",
  follower: FIXTURE_OPEN.follower!,
  settings_reviewed_at: null,
  channels: {
    push: { subscribed: false },
    whatsapp: { available: true, subscribed: true, state: "active", phone_masked: "+91 ••••••78" },
    telegram: { connected: true, checkins_enabled: true, stopped: false },
  },
  price: { price_inr: 299, currency: "INR" },
  offer: null,
};

const FIXTURE_SETTINGS_HI: RoomSettings = {
  ...FIXTURE_SETTINGS,
  disclosure: CARD_HI,
  locale: "hi",
};

const FIXTURE_PAYMENT: RoomPaymentStatus = {
  tier: "free",
  // WS-R37 widened the status with the Room's current price (null until the
  // creator sets one); the fixture states the same honest null.
  price_inr: null,
  currency: null,
  subscription: null,
};

function render() {
  const params = new URLSearchParams(window.location.search);
  const screen = params.get("screen") || "talk";
  // WS-R24: ?lang=hi swaps the chrome locale AND the disclosure card's own
  // bytes together, so this fixture can never show a "hi" room whose card is
  // still in English - the one shape a real Room may never be in.
  const hindi = params.get("lang") === "hi";
  const base = hindi ? { ...FIXTURE_OPEN, locale: "hi" as const, disclosure: CARD_HI } : FIXTURE_OPEN;
  const open = screen === "join" ? { ...base, joined: false, session: null } : base;
  ReactDOM.createRoot(document.getElementById("room-root")!).render(
    <RoomApp
      fixtureOpen={open}
      fixtureTurns={screen === "join" ? [] : FIXTURE_TURNS}
      // WS-R39: the account page overlay, forced open with its own composed
      // read supplied — no network reachable from this fixture.
      fixtureAccountOpen={screen === "account"}
      fixtureSettings={hindi ? FIXTURE_SETTINGS_HI : FIXTURE_SETTINGS}
      fixturePayment={FIXTURE_PAYMENT}
    />,
  );
}

if (LOOPBACK.has(window.location.hostname)) {
  render();
} else {
  // Not an error page and not a redirect: a blank, honest refusal. This file is
  // in the build output and must do nothing at all anywhere it is not the gate.
  document.getElementById("room-root")!.textContent = "";
}
