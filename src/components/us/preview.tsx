// A DESIGN HARNESS for UsScreen, not a route and not a gate.
//
// Same shape and same reasoning as src/components/chess/preview.tsx: it
// exists so the screen can be looked at in states that are expensive to
// reach by living them — a 147-day record with nine milestones fired, and a
// two-day-old one with thirty messages and nothing else — on both grounds.
// Served by `vite` at `/src/components/us/preview.html`. It is not reachable
// from the app and vite's build only follows `index.html`, so nothing here
// ships.
//
//   ?state=rich | sparse      which record
//   ?theme=light | dark       forces the theme (default: follow the OS)
//
// `now` is frozen and every timestamp is derived from it, so two screenshots
// taken on different days are the same screenshot.

import ReactDOM from "react-dom/client";
import "../../styles/global.css";
import UsScreen from "../UsScreen";
import type { AppState, Message } from "../../state/store";
import { defaultState } from "../../state/store";
import type { RelBundleInput } from "../../engine/compiler";

const NOW = Date.parse("2026-08-22T21:40:00+05:30");
const DAY = 24 * 60 * 60 * 1000;

// deterministic, so the grid's texture is the same texture every run
let seed = 20260822;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

function thread(days: number, perDay: (d: number) => number, calls: number[]): Message[] {
  const out: Message[] = [];
  // anchored to LOCAL MIDNIGHT of the first day, so "days" here means the
  // same thing the screen's own day buckets mean. Anchoring to `NOW - n*DAY`
  // instead put a two-day fixture entirely inside one calendar day.
  const d0 = new Date(NOW);
  d0.setHours(0, 0, 0, 0);
  const start = d0.getTime() - (days - 1) * DAY;
  for (let d = 0; d < days; d++) {
    const n = perDay(d);
    for (let k = 0; k < n; k++) {
      const at = start + d * DAY + 9 * 3600e3 + k * 90e3;
      if (at > NOW) break;
      out.push({
        id: `m${d}-${k}`,
        from: k % 2 ? "her" : "me",
        kind: rnd() < 0.02 ? "photo" : "text",
        text: "…",
        at,
      });
    }
  }
  for (const [i, d] of calls.entries()) {
    const mins = 3 + Math.floor(rnd() * 40);
    out.push({
      id: `c${i}`,
      from: "me",
      kind: "callmark",
      text: `${mins}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}`,
      at: start + d * DAY + 21 * 3600e3,
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

const RICH: AppState = {
  ...defaultState,
  onboarded: true,
  deviceId: "preview",
  user: { name: "Arjun", vibe: ["late-night company"], facts: {} },
  // 147 days, busy but not uniform — some quiet stretches, some heavy weeks
  messages: thread(
    147,
    (d) => (d % 23 === 0 ? 0 : d % 7 === 3 ? 2 : Math.floor(4 + rnd() * 22)),
    // twelve calls, because the ledger below claims a `calls-10` moment and a
    // fixture that fires a milestone the record cannot reach is a fixture
    // testing a state the product cannot be in
    [4, 19, 33, 34, 61, 74, 88, 95, 102, 118, 130, 141],
  ),
  momentsFired: [
    "days-7",
    "msgs-100",
    "calls-1",
    "first-game",
    "days-30",
    "msgs-500",
    "chess-first-win-her",
    "chess-5",
    "days-100",
    "msgs-1000",
    "chess-first-win-him",
    "calls-10",
  ],
  tally: { chessGames: 12, chessWinsHim: 5, chessWinsHer: 7, tttGames: 23, wyrCards: 48 },
};

const SPARSE: AppState = {
  ...defaultState,
  onboarded: true,
  deviceId: "preview",
  user: { name: "Arjun", vibe: [], facts: {} },
  // day 2, thirty messages, nothing else — the state the brief says has to
  // feel as good as day 300
  messages: thread(2, (d) => (d === 0 ? 13 : 17), []),
  momentsFired: [],
  tally: null,
};

// only the two fields this screen reads; the rest of the bundle is irrelevant
// here and a harness that filled it in would be asserting a shape it does not
// use
const REL = {
  relState: {},
  lastHonorificMoveAt: null,
  patterns: [],
  rituals: [{}, {}, {}, {}],
  homeRegion: null,
  currency: [],
  weEpisodes: [{}, {}, {}, {}, {}, {}, {}],
  phrases: [],
  phraseLedger: [],
} as unknown as RelBundleInput;

const q = new URLSearchParams(location.search);
const theme = q.get("theme");
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
const sparse = q.get("state") === "sparse";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <div className="app">
    <UsScreen
      state={sparse ? SPARSE : RICH}
      relBundle={sparse ? null : REL}
      now={NOW}
      onExit={() => console.log("exit")}
    />
  </div>,
);
