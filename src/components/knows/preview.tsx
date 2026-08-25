// A DESIGN HARNESS for KnowsScreen, not a route and not a gate.
//
// Same shape and same reasoning as src/components/us/preview.tsx: it exists so
// the screen can be looked at in states that are expensive to reach by living
// them — a relationship with four months of story, kin, rituals, a coined
// phrase and a derived pattern behind it, and a two-day-old one with almost
// nothing — on both grounds and under any sky. Served by `vite` at
// `/src/components/knows/preview.html`. It is not reachable from the app, and
// vite's build only follows `index.html`, so nothing here ships.
//
//   ?state=rich | sparse | empty   which record
//   ?theme=light | dark            forces the theme (default: follow the OS)
//   ?sky=night | morning | 04:45   moves the ONE clock, exactly as App does
//
// `now` is frozen and every timestamp derives from it, so two screenshots
// taken on different days are the same screenshot.

import ReactDOM from "react-dom/client";
import "../../styles/global.css";
import KnowsScreen from "../KnowsScreen";
import type { AppState } from "../../state/store";
import { defaultState } from "../../state/store";
import type { KnowsBundle } from "../../state/knows";
import { configureSky, parseSkySeed } from "../../engine/sky";
import { applyTheme } from "../../engine/theme";

const NOW = Date.parse("2026-08-22T21:40:00+05:30");
const DAY = 24 * 60 * 60 * 1000;

const q = new URLSearchParams(location.search);

// the ONE clock, moved — never a second one. Same three lines App.tsx runs,
// and they run before the first render for the same reason they do there.
try {
  const at = parseSkySeed(q.get("sky"), NOW);
  if (at !== null) configureSky({ now: () => at });
} catch {
  /* no location — the real clock stands */
}
const theme = q.get("theme");
if (theme === "light" || theme === "dark") {
  document.documentElement.dataset.theme = theme;
  applyTheme(theme);
}

const msg = (id: string, from: "her" | "me", at: number, extra: Record<string, unknown> = {}) =>
  ({ id, from, kind: "text", text: "…", at, ...extra }) as AppState["messages"][number];

// 118 days: a first message, calls and pictures spread over four months, a
// finished game, and the milestones a record that shape would really have
// fired. A fixture that fires a milestone the record cannot reach is a fixture
// testing a state the product cannot be in (us/preview.tsx's own rule).
const start = NOW - 118 * DAY;
const messages: AppState["messages"] = [
  msg("m0", "her", start),
  msg("m1", "me", start + 3600e3),
  msg("c1", "me", start + 9 * DAY, { kind: "callmark", text: "24:11" }),
  msg("p1", "me", start + 26 * DAY, { kind: "photo", photoUrl: "x" }),
  msg("c2", "her", start + 44 * DAY, { kind: "callmark", text: "8:02" }),
  msg("p2", "her", start + 61 * DAY, { kind: "photo", photoUrl: "y" }),
  msg("c3", "me", start + 90 * DAY, { kind: "callmark", text: "51:30" }),
  msg("m9", "me", NOW - 2 * DAY),
];

const RICH: AppState = {
  ...defaultState,
  onboarded: true,
  deviceId: "preview",
  user: { name: "Arjun", vibe: ["late-night company", "deep conversations"], facts: {} },
  messages,
  momentsFired: ["days-7", "calls-1", "days-30", "days-100"],
  activities: [
    {
      kind: "chess",
      startedAt: NOW - 9 * DAY,
      closedAt: NOW - 9 * DAY + 2400e3,
      summary: "chess: you won in 41, she called the endgame cursed",
    },
    {
      kind: "would-you-rather",
      startedAt: NOW - 34 * DAY,
      closedAt: NOW - 34 * DAY + 900e3,
      summary: "would-you-rather: nine cards, you both picked the ghost one",
    },
  ],
  herLife: [
    { text: "her flatmate sneha moved out in july", at: NOW - 40 * DAY, kind: "fact" },
    { text: "she hates karela and will say so every time", at: NOW - 71 * DAY, kind: "fact" },
    { text: "khana bana rahi hu", at: NOW - 3600e3, kind: "activity" },
    { text: "her cousin's wedding is in november", at: NOW - 12 * DAY, kind: "fact" },
  ],
  tally: { chessGames: 6, chessWinsHim: 4, chessWinsHer: 2, tttGames: 3, wyrCards: 9 },
};

const SPARSE: AppState = {
  ...defaultState,
  onboarded: true,
  deviceId: "preview",
  user: { name: "Arjun", vibe: [], facts: {} },
  messages: [msg("s0", "me", NOW - DAY), msg("s1", "her", NOW - DAY + 600e3)],
  momentsFired: [],
  herLife: [],
  tally: null,
};

const EMPTY: AppState = {
  ...defaultState,
  onboarded: true,
  deviceId: "preview",
  user: { name: "", vibe: [], facts: {} },
  messages: [],
};

const BUNDLE: KnowsBundle = {
  homeRegion: "Indore",
  kin: [
    { name: "Priya", relation: "sister", address_term: "didi", provisional: false },
    { name: "Ramesh", relation: "chacha", provisional: true },
  ],
  rituals: [{ key: "khana_khaya", count: 31 }, { key: "good_night", count: 12 }],
  currency: [{ topic: "test cricket", kind: "cricket" }, { topic: "old hindi film songs", kind: "film" }],
  phrases: [{ phrase: "bandar mode", gloss: "when you go quiet then send nine memes at once" }],
  patterns: [
    { then_note: "you go quiet the week before a deadline and come back loud after", prompt_eligible: true },
  ],
  weEpisodes: [
    { id: 41, summary: "us raat wali baat, the one about your dad", at: new Date(NOW - 6 * DAY).toISOString() },
    { id: 22, summary: "the power cut, and the ninety minutes on the phone", at: new Date(NOW - 47 * DAY).toISOString() },
  ],
};

const which = q.get("state");
const state = which === "sparse" ? SPARSE : which === "empty" ? EMPTY : RICH;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <div className="app">
    <KnowsScreen
      state={state}
      bundle={which === "empty" || which === "sparse" ? null : BUNDLE}
      now={NOW}
      onExit={() => console.log("exit")}
      onCorrect={(prefill) => {
        console.log("correct:", prefill);
        // the harness has no composer; it reports what the app would be handed,
        // which is what the battery reads back
        (window as unknown as { __correct?: string }).__correct = prefill;
      }}
    />
  </div>,
);
