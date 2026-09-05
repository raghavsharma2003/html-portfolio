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
 *
 * ── WS-R43: FOUR MORE SCREENS, AND A FETCH STUB ────────────────────────────
 *
 * "Hindi glyphs unverified" was open since WS-R24 for a mechanical reason:
 * three of the Room's seven screens had no fixture path AT ALL and the layout
 * gate can only measure what it can reach. `?screen=capped` forces the
 * cap-reached state (WS-R30's own offer card riding under it, exactly as a
 * real refusal leaves it); `?screen=receipt` forces the "gone" phase with a
 * real-shaped `RoomForgetReceipt` (WS-R27 law 3's own point restated: there
 * is nothing to look this up by later, so a fixture is the ONLY way this
 * screen is ever measured again).
 *
 * `?screen=checkins` and `?screen=handoff` render the talk screen CLOSED,
 * with `FIXTURE_TURNS_LONG` below rather than the ordinary conversation —
 * `scripts/check-layout.mjs` (WS-R63) clicks the real header opener itself
 * (`[data-dialog-open="checkins"]`/`"handoff"`, `RoomApp.tsx`'s own hook for
 * exactly this) rather than a fixture prop pre-opening the panel, which is
 * the whole point: `#ws-r43-room-dialogs-render-in-flow-not-scrolled-into-view`
 * found that a real tap on this exact button, on a conversation this tall,
 * left the panel entirely off screen, and a fixture that opens the dialog
 * for the gate rather than making it click could never have caught that.
 * Both dialogs `load()` themselves on mount over `/api/checkins` and
 * `/api/handoff` — `AccountPage.tsx`'s own `fixtureSettings` seam does not
 * reach either component, so rather than adding a third fixture-prop path
 * two components deep, `installFetchStub` below answers the exact three POST
 * endpoints every Room screen ever calls (`/api/room`, `/api/checkins`,
 * `/api/handoff`), dispatched by the `op` field every one of them already
 * sends. Never reaches a network; nothing here is a credential.
 */
import ReactDOM from "react-dom/client";
import RoomApp from "./RoomApp";
import "../studio/design/tokens.css";
import "../studio/studio.css";
import "./room.css";
import { ROOM_COPY_TABLE } from "./copy";
import type { RoomOpen, RoomSettings, RoomForgetReceipt, RoomOffer } from "./roomApi";
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
  room: {
    slug: "anjali",
    display_name: "Anjali",
    name: "Anjali",
    handoff_enabled: true,
    taste_enabled: true,
    bio: "JEE physics, eleven years at the board, mechanics and electrodynamics.",
  },
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

/* WS-R63. `FIXTURE_TURNS` above already measured tall enough to push a
 * dialog appended after `.room-composer` below a 390x844 fold
 * (`#ws-r43-viewport-only-screenshot-missed-in-flow-dialogs`'s own
 * measurement) — this extends it further anyway, so the `checkins`/
 * `handoff` click-and-scroll assertion below stays true regardless of
 * whether a later edit ever shortens `FIXTURE_TURNS` for some other reason.
 * Real, distinct prose (continuing the same physics conversation), never
 * `FIXTURE_TURNS` repeated - a screenshot of three identical exchanges would
 * be confusing evidence for a human reading `evals/room-browser/shots`. */
const FIXTURE_TURNS_LONG = [
  ...FIXTURE_TURNS,
  {
    role: "user" as const,
    content: "ok but why does the ceiling itself depend on the normal force and nothing else?",
  },
  {
    role: "assistant" as const,
    content:
      "Because the two surfaces are only ever pressed together as hard as the normal force says, and how interlocked two rough surfaces are scales with how hard they are pressed together, not with anything about the force trying to slide them apart. Push two rough blocks together twice as hard and there is roughly twice as much microscopic interlocking to overcome, which is exactly what the coefficient times the normal force is counting.",
  },
  { role: "user" as const, content: "does the coefficient change if I flip the block onto a different face?" },
  {
    role: "assistant" as const,
    content:
      "Only if flipping it changes which two surfaces are actually touching, since the coefficient belongs to the PAIR of surfaces, not to the block. Flip it onto a face made of the same material and the number is unchanged; flip it onto a genuinely different surface (a rubber foot instead of a wooden edge, say) and you are measuring a different pair entirely, so of course the number moves.",
  },
  { role: "user" as const, content: "last one - is kinetic friction always less than static?" },
  {
    role: "assistant" as const,
    content:
      "Almost always, and it is worth knowing the one common exception: a few surface pairs measure the two coefficients as equal, and vanishingly few measure kinetic above static. Treat 'kinetic is less than or equal to static' as the safe default for an exam, and if a question hands you numbers where kinetic comes out larger, check you have not swapped the two labels before trusting the arithmetic.",
  },
];

/* WS-R39. `roomSettings`'s own composed shape, at real values — a masked
 * WhatsApp number and a connected Telegram pointer, both true, so the account
 * screen's channel section renders every one of its blocks rather than the
 * shortest possible one. Byte-similar to what `api/_room-surface.js`'s
 * `roomSettings` actually returns; not imported, for the same standalone
 * reason `CARD`/`CARD_HI` above are written out rather than imported. */
const FIXTURE_SETTINGS: RoomSettings = {
  // WS-R75 (migration 119): a real value (not null) so the layout gate's
  // own signed-in walk actually renders the retention sentence at least
  // once, rather than only exercising the "off, render nothing" branch.
  room: { slug: "anjali", name: "Anjali", display_name: "Anjali", dormancy_days: 365 },
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
  // WS-R129: a real value (not null) so the layout gate's own signed-in
  // walk actually renders the quiet-hours summary block at least once.
  quiet_hours: { quiet_from: "22:00", quiet_to: "07:00", timezone: "Asia/Kolkata" },
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

/** WS-R30's cap-reached offer, at a real price — `RoomApp.tsx`'s own
 *  `capped && capOffer` law: the card renders only once BOTH the refusal and
 *  a recorded offer are true, so `?screen=capped` supplies both together
 *  rather than the capped screen alone, which no follower who actually hit
 *  the cap and got the offer would ever see on its own. */
const FIXTURE_CAP_OFFER: RoomOffer = { reason: "cap_reached", price_inr: 299, currency: "INR" };

/** Byte-shaped like `RoomForgetReceipt` (`roomApi.ts`) — `receipt_id` and
 *  `person_hash` are both content-free by construction (never a person id,
 *  api/memory.js's own `roomForgetReceiptHash`), so a fixture value here
 *  measures the same thing the receipt itself is designed to be safe to
 *  show: a proof of counts, not a record of who. */
const FIXTURE_RECEIPT: RoomForgetReceipt = {
  receipt_id: "layout-fixture-receipt-0001",
  room: "anjali",
  person_hash: "f3a1c9de-fixture-hash-not-a-real-person",
  policy_version: 3,
  counts: { messages: 42, threads: 2, checkins: 1 },
  issued_at: "2026-08-30T09:15:00.000Z",
};

/** WS-R43: every string `CheckinsPanel.tsx`/`HandoffPanel.tsx`/`AccountPage.tsx`
 *  can render, dispatched by `(pathname, op)` exactly as the real handlers
 *  read it — `api/_checkins.js`/`api/_handoff.js`/`api/_room-surface.js`'s
 *  own op vocabulary, not reinvented here. One design with a `cadence_hint`
 *  and one already-active check-in with a "Stop" control, one answered
 *  handoff with a reply, so the panels render every block they own rather
 *  than the emptiest possible screen — `layoutFixture.tsx`'s own
 *  `FIXTURE_TURNS` precedent: a fixture of the shortest possible state tells
 *  the gate nothing about the state a follower actually sees. `push_public_key`
 *  stays `null` deliberately: the push control needs `Notification`/
 *  `PushManager`/a service worker this harness does not register, and an
 *  absent key is what makes that control render nothing rather than
 *  something this fixture cannot honestly drive.
 */
function installFetchStub() {
  const CHECKIN_DESIGNS = [
    { design_id: "d1", title: "How is the exam prep going?", cadence_hint: "weekly" },
    { design_id: "d2", title: "Quick check on the assignment", cadence_hint: "" },
  ];
  const MY_CHECKINS = [
    {
      checkin_id: "c1",
      design_id: "d1",
      title: "How is the exam prep going?",
      days_of_week: [1, 3, 5],
      local_time: "09:00",
      timezone: "Asia/Kolkata",
      quiet_from: null,
      quiet_to: null,
      next_due_at: null,
      state: "active" as const,
    },
  ];
  const MY_HANDOFFS = [
    {
      handoff_id: "h1",
      thread_id: null,
      state: "answered" as const,
      payload_text: "Could you look at question 4 from today's set? I keep getting a negative area.",
      sent_at: "2026-08-20T10:00:00.000Z",
      answered_at: "2026-08-21T07:00:00.000Z",
      reply_text: "You dropped a sign taking the square root on the second line. Check that step again.",
      created_at: "2026-08-20T10:00:00.000Z",
    },
  ];
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(raw, window.location.origin).pathname;
    let op = "";
    try {
      op = JSON.parse(String(init?.body ?? "{}"))?.op ?? "";
    } catch {
      op = "";
    }
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (path === "/api/checkins") {
      if (op === "designs") return json({ designs: CHECKIN_DESIGNS, push_public_key: null });
      if (op === "list_mine") return json({ checkins: MY_CHECKINS });
      if (op === "telegram_status") return json({ connected: false, checkins_enabled: false, stopped: false });
      return json({});
    }
    if (path === "/api/handoff") {
      if (op === "mine") return json({ handoffs: MY_HANDOFFS });
      return json({});
    }
    if (path === "/api/room") {
      if (op === "push_status") return json({ subscribed: false });
      if (op === "whatsapp_status") return json({ available: false, subscribed: false, phone_masked: null });
      // WS-R53: a real-shaped answer in case an interaction driver (the
      // accessibility gate's keyboard walk, a future click-through) submits
      // the taste input for real - never reachable from the STATIC layout
      // screenshot, which never sends anything.
      if (op === "taste") {
        const isHindi = new URLSearchParams(window.location.search).get("lang") === "hi";
        return json({
          room: { slug: "anjali", display_name: "Anjali", name: "Anjali" },
          disclosure: isHindi ? CARD_HI : CARD,
          locale: isHindi ? "hi" : "en",
          reply: isHindi
            ? "घर्षण वही जवाब देता है जो आप लगाते हैं, एक सीमा तक।"
            : "Friction answers exactly what you push with, up to a ceiling.",
          turn_index: 1,
          turns_left: 2,
        });
      }
      // WS-R84. `?live=1` is the ONE screen that exercises a REAL
      // `switchLocale` call (`RoomApp.tsx`'s own `fixtureLiveLocaleSwitch`
      // prop) — answered here exactly the way `api/_room-surface.js`'s real
      // `roomSetLocale` answers it, `locale` + a fresh `session` string +
      // the fresh CARD, so `scripts/check-accessibility.mjs` can click the
      // real language button and assert the real resulting DOM.
      if (op === "locale") {
        const body = JSON.parse(String(init?.body ?? "{}"));
        const want = body?.locale === "hi" ? "hi" : "en";
        return json({ locale: want, session: `r1.fixture-switched-${want}.fixture`, disclosure: want === "hi" ? CARD_HI : CARD });
      }
      return json({});
    }
    return json({});
  };
}

/** WS-R43. Every Hindi string this Room's chrome can show, flattened from
 *  the REAL `ROOM_COPY_TABLE.hi` export (never a hand-copied list, so this
 *  cannot drift the moment a key is added) into `[key, value]` pairs — the
 *  key so a failing glyph measurement can name exactly which string broke,
 *  `scripts/check-layout.mjs`'s own law. Exposed on `window` rather than
 *  computed in Node, because the measurement itself (`document.fonts.check`,
 *  a canvas `measureText`) can only mean anything run against a REAL browser
 *  font stack — this just gets the real, live copy table to that browser. */
function flattenHiStrings(node: unknown, prefix: string, out: [string, string][]): void {
  if (typeof node === "string") {
    out.push([prefix, node]);
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => flattenHiStrings(v, `${prefix}[${i}]`, out));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) flattenHiStrings(v, prefix ? `${prefix}.${k}` : k, out);
  }
}

declare global {
  interface Window {
    __ROOM_HI_STRINGS__?: [string, string][];
  }
}

function render() {
  const params = new URLSearchParams(window.location.search);
  const screen = params.get("screen") || "talk";
  // WS-R24: ?lang=hi swaps the chrome locale AND the disclosure card's own
  // bytes together, so this fixture can never show a "hi" room whose card is
  // still in English - the one shape a real Room may never be in.
  const hindi = params.get("lang") === "hi";
  const base = hindi ? { ...FIXTURE_OPEN, locale: "hi" as const, disclosure: CARD_HI } : FIXTURE_OPEN;
  // WS-R63: `screen=checkins` needs the header's own "Check-ins" button to
  // actually render (`canCheckin` in `RoomApp.tsx`: paid tier AND a
  // remembered thread), which `FIXTURE_OPEN`'s ordinary free-tier follower
  // never satisfies - the old `fixtureCheckinsOpen` prop bypassed the
  // button entirely, which is exactly the gap this workstream closes. No
  // change needed for `handoff`: `canHandoff` reads only
  // `room.handoff_enabled`, already `true` on `FIXTURE_OPEN`.
  const withFollowerTier =
    screen === "checkins" && base.follower
      ? { ...base, follower: { ...base.follower, tier: "paid" as const } }
      : base;
  const open = screen === "join" || screen === "taste" ? { ...withFollowerTier, joined: false, session: null } : withFollowerTier;
  // WS-R59: `?screen=install` forces the install card visible over the
  // ordinary talking screen (`fixtureInstallPrompt`, `RoomApp.tsx`'s own
  // prop for exactly this — the real gate that decides visibility needs a
  // `beforeinstallprompt` event, a visit count, and a real sign-in this
  // fixture has none of); `&ios=1` alongside it renders the iOS hint variant
  // instead of the working button. `?screen=offline` forces the shell's own
  // offline card (`fixturePhase: "offline"`, the same seam `receipt` below
  // already uses for a phase no real session can be driven into on demand).
  const ios = params.get("ios") === "1";
  // WS-R84: see `installFetchStub`'s own `op === "locale"` handler and
  // `RoomApp.tsx`'s `fixtureLiveLocaleSwitch` header — narrowly scoped to
  // this one query flag so every other screen's `switchLocale` stays
  // exactly as blocked as it always was.
  const liveLocaleSwitch = params.get("live") === "1";
  // WS-R63: `checkins`/`handoff` render the talk screen CLOSED, with the
  // long conversation, so `scripts/check-layout.mjs` clicks the real opener
  // itself — `layoutFixture.tsx`'s own header explains why a fixture that
  // pre-opens the dialog could never have caught the bug this closes.
  const longConvo = screen === "checkins" || screen === "handoff";
  ReactDOM.createRoot(document.getElementById("room-root")!).render(
    <RoomApp
      fixtureOpen={open}
      fixtureTurns={screen === "join" || screen === "taste" ? [] : longConvo ? FIXTURE_TURNS_LONG : FIXTURE_TURNS}
      // WS-R39: the account page overlay, forced open with its own composed
      // read supplied — no network reachable from this fixture.
      fixtureAccountOpen={screen === "account"}
      fixtureSettings={hindi ? FIXTURE_SETTINGS_HI : FIXTURE_SETTINGS}
      fixturePayment={FIXTURE_PAYMENT}
      // WS-R86 (migration 123): "Bring a friend" has no network to mint a
      // real hash from under this fixture - a fixed, valid-shaped sample
      // so the account screen's own glyph pass actually renders the card
      // (`AccountPage.tsx`'s own header on why an unrendered card would
      // otherwise hide its real Hindi string from the layout gate).
      fixtureReferralUrl={`/r/anjali?via=friend&ref=${"a".repeat(64)}`}
      // WS-R43: the three screens no fixture reached before.
      fixtureCapped={screen === "capped"}
      fixtureCapOffer={screen === "capped" ? FIXTURE_CAP_OFFER : null}
      fixturePhase={screen === "receipt" ? "gone" : screen === "offline" ? "offline" : undefined}
      // WS-R53: `?screen=join` still measures the JOIN sheet on its own -
      // the taste screen that now sits in front of it for a real, signed-out
      // visitor is dismissed here so this target keeps measuring what it
      // always has. `?screen=taste` leaves it false, its own new target.
      fixtureTasteDismissed={screen === "join"}
      fixtureForgetReceipt={screen === "receipt" ? FIXTURE_RECEIPT : null}
      // WS-R63: both start CLOSED now, even on `?screen=checkins`/`handoff`
      // — the gate opens them with a real click (`data-dialog-open`,
      // `RoomApp.tsx`) rather than a URL flag pre-opening them.
      fixtureCheckinsOpen={false}
      fixtureHandoffOpen={false}
      // WS-R59: the install card, both variants.
      fixtureInstallPrompt={screen === "install"}
      fixtureInstallPromptIOS={screen === "install" && ios}
      fixtureLiveLocaleSwitch={liveLocaleSwitch}
    />,
  );
  window.__ROOM_HI_STRINGS__ = (() => {
    const out: [string, string][] = [];
    flattenHiStrings(ROOM_COPY_TABLE.hi, "", out);
    return out;
  })();
}

if (LOOPBACK.has(window.location.hostname)) {
  installFetchStub();
  render();
} else {
  // Not an error page and not a redirect: a blank, honest refusal. This file is
  // in the build output and must do nothing at all anywhere it is not the gate.
  document.getElementById("room-root")!.textContent = "";
}
