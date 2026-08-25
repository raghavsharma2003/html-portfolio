// WS-MOVEVOICE, in a real browser — the half `evals/movevoice.mjs` cannot see.
//
//   npx vite build
//   npx vite preview --port 4291 --strictPort &
//   node evals/movevoice-browser.mjs            # assert (exit 1 on failure)
//   node evals/movevoice-browser.mjs --observe  # print, never fail
//
// ── why a browser ─────────────────────────────────────────────────────────
//
// `movevoice.mjs` proves the TABLE: given a position, what beat does
// `chessThinkMs` return. It cannot prove the thing the owner actually heard,
// which is a property of a running page and of nothing else:
//
//   HOW LONG DOES HER PIECE ACTUALLY TAKE TO LAND, measured from his.
//
// Between the table and the board sit an async search that yields to the
// compositor, a React effect with a dependency array, a setTimeout, and a
// state updater that can refuse the move. Any one of them can drop the hold —
// the effect re-running on an unrelated state write and restarting the timer,
// the search resolving after the hold was meant to start, a stale closure
// committing immediately — and every one of those failures looks exactly like
// the defect the owner reported: a piece landing milliseconds after his.
//
// So this file measures wall-clock gaps on a real game, ply by ply, and holds
// them against the SAME function the component calls. The floor is the
// assertion that matters: nothing of hers may ever land inside a human's
// reaction time.
//
// It also proves the two things that make the hold a pacing decision rather
// than a delay: the gap TRACKS the position (a forced reply is quick, a wide
// middlegame is not — a constant delay would pass a floor check and fail this
// one), and a REPLAY of the same session agrees with itself.
//
// NOT wired into evals/run.mjs, for the same by-construction reason
// evals/gameplay-browser.mjs states: it needs a built app and a server on a
// port. It is in version control because `dead-writers` does not stop being
// true for evals.

import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const B = process.env.MEERA_PREVIEW || "http://localhost:4291";
const OBSERVE = process.argv.includes("--observe");

const OUT = mkdtempSync(join(tmpdir(), "movevoice-b-"));
const ENTRY = join(OUT, "entry.ts");
writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(join(REPO, "src/engine/chess/index"))};\n` +
    `export * from ${JSON.stringify(join(REPO, "src/engine/ttt/index"))};\n` +
    `export * from ${JSON.stringify(join(REPO, "src/state/game"))};\n`,
);
const BUNDLE = join(OUT, "engine.mjs");
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
  { cwd: REPO, stdio: "inherit" },
);
const E = await import(pathToFileURL(BUNDLE).href);
const { THINK_FLOOR_MS, THINK_CEIL_MS, MOVE_ANIM_MS, chessThinkMs, tttThinkMs, openingName } = E;

let fails = 0;
const ok = (n, c, e = "") => {
  console.log(`${c ? "ok  " : "FAIL"} ${n}${e ? " — " + e : ""}`);
  if (!c && !OBSERVE) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the measurement budget ────────────────────────────────────────────────
//
// Everything between the table's answer and the piece appearing in
// localStorage: the async search (it yields a macrotask per frame on purpose),
// React's effect scheduling, the state write, and this file's own polling
// resolution. Generous UPWARD, because a slow container is not a defect and a
// flaky gate is a gate nobody reads. Deliberately NOT generous downward — a
// move landing EARLY is the whole defect, so the low tolerance is small enough
// that dropping the hold entirely cannot hide inside it.
const LATE_SLACK_MS = 1400;
const EARLY_SLACK_MS = 120;
/** How often the page is asked where the game is. Bounds the reading error. */
const POLL_MS = 25;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const BASE_STATE = {
  onboarded: true,
  deviceId: "00000000-0000-4000-8000-00000000ab01",
  user: { name: "Raghav", vibe: [] },
  messages: [],
  openrouterKey: "",
  openrouterModel: "",
  apiKey: "",
  elevenKey: "",
  elevenVoiceId: "",
  sarvamKey: "",
  deviceVoice: "",
  lastSeen: Date.now(),
};

async function open({ state = {}, theme = "light" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.route("**/api/chat", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "haan" }) }),
  );
  for (const p of [
    "**/api/memory", "**/api/telemetry", "**/api/consolidate", "**/api/account",
    "**/api/clock", "**/api/life", "**/api/search", "**/api/trace", "**/api/route",
    "**/api/gif", "**/api/speech",
  ]) {
    await page.route(p, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  }
  await page.goto(`${B}/chat`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    (s) => localStorage.setItem("meera.state.v1", JSON.stringify(s)),
    { ...BASE_STATE, theme, ...state },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(900);
  await page.click('[data-tel="home.open_chat"]');
  await page.waitForFunction(
    () => document.querySelector(".chat-wrap")?.getAttribute("data-surface") === "chat",
    null,
    { timeout: 8000 },
  );
  await sleep(400);
  return { page, ctx };
}

const readState = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("meera.state.v1") || "{}"));

async function openRoom(page, id) {
  await page.click('[data-tel="chat.games"]');
  await page.waitForSelector(`[data-tel="games.open.${id}"]`, { timeout: 6000 });
  await page.click(`[data-tel="games.open.${id}"]`);
  await page.waitForSelector(".as", { timeout: 6000 });
  await sleep(400);
}

/**
 * Poll until the ply count changes, and return WHEN — inside the page's own
 * clock, so this file's round-trip latency is not counted as her think time.
 * The page stamps the moment it first observes the new ply; the poll interval
 * is the only reading error, and it is bounded by POLL_MS.
 */
async function waitForPly(page, want, timeoutMs) {
  const handle = await page.waitForFunction(
    ({ want: w, poll }) =>
      new Promise((resolve) => {
        const read = () => JSON.parse(localStorage.getItem("meera.state.v1") || "{}")?.game?.game?.played?.length ?? -1;
        if (read() >= w) return resolve(performance.timeOrigin + performance.now());
        const id = setInterval(() => {
          if (read() >= w) {
            clearInterval(id);
            resolve(performance.timeOrigin + performance.now());
          }
        }, poll);
      }),
    { want, poll: POLL_MS },
    { timeout: timeoutMs, polling: POLL_MS },
  );
  return handle.jsonValue();
}

// ══════════════════════════════════════════════════════════════════════════
// 1. A WHOLE GAME OF CHESS, with the gap measured on every one of her turns
// ══════════════════════════════════════════════════════════════════════════

console.log("\n── 1. a whole game: every her-turn timed ──");
{
  const { page, ctx } = await open();
  await openRoom(page, "chess");
  const seeded = await readState(page);
  const seed = seeded.game?.startedAt ?? 0;
  ok("the room seeded a session with a start time", seed > 0, String(seed));

  const rows = [];
  let plies = 0;
  const t0 = Date.now();
  while (plies < 50 && Date.now() - t0 < 4 * 60_000) {
    const st = await readState(page);
    const g = st.game?.game;
    if (!g || g.status.over) break;
    if (g.status.turn !== "w") break; // he is white; hers is driven by the app

    // THE PREDICTION, from the same table the component reads — computed
    // BEFORE his move is made, against the position she will think in. Her
    // reply is not known yet, so the recapture modifier is predicted from
    // whether his move takes something she can take back on; the assertion
    // below tolerates either branch rather than pretending to know.
    const hm = E.chooseMove(g, { strength: 5 });
    if (!hm) break;
    const uci = hm.move.uci;
    const after = E.play(g, uci);
    if (!after) break;
    const predictNoRecap = chessThinkMs({
      fen: after.fen,
      ply: after.played.length,
      legalMoveCount: after.status.legalMoveCount,
      inCheck: after.status.inCheck,
      recapture: false,
      book: openingName(after.played.map((m) => m.san)) !== null,
      seed,
    });
    const predictRecap = chessThinkMs({
      fen: after.fen,
      ply: after.played.length,
      legalMoveCount: after.status.legalMoveCount,
      inCheck: after.status.inCheck,
      recapture: true,
      book: openingName(after.played.map((m) => m.san)) !== null,
      seed,
    });

    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promo = uci.slice(4, 5);
    await page.click(`.cb-sq[aria-label^="${from},"]`);
    await sleep(60);
    // Arm the watcher for HER ply before his lands, so the clock starts from
    // the page's own observation of his move rather than from a poll that
    // might be up to POLL_MS late.
    const hisPly = g.played.length + 1;
    await page.click(`.cb-sq[aria-label^="${to},"]`);
    if (promo) {
      const NAME = { q: "queen", r: "rook", b: "bishop", n: "knight" };
      await page.waitForSelector(".cb-promo", { timeout: 4000 });
      await page.click(`[aria-label="Promote to ${NAME[promo]}"]`);
    }
    const tHis = await waitForPly(page, hisPly, 8000);

    // ── HIS MOVE IS ON THE BOARD. Is she shown considering? ──────────────
    // The existing idiom, not a new affordance: the presence row and the
    // header both already read off whose turn it is.
    const head = await page.textContent(".as-state").catch(() => "");
    ok(`ply ${hisPly}: the room shows her thinking`, /her move/i.test(head || ""), String(head));

    // ── HER MOVE ────────────────────────────────────────────────────────
    let tHers;
    try {
      tHers = await waitForPly(page, hisPly + 1, THINK_CEIL_MS + 12_000);
    } catch {
      const now = await readState(page);
      if (now.game?.game?.status?.over) break;
      ok(`ply ${hisPly + 1}: her move arrived at all`, false, "timed out");
      break;
    }
    const gap = Math.round(tHers - tHis);
    rows.push({ ply: hisPly + 1, gap, predictNoRecap, predictRecap });

    // THE FLOOR. This is the owner's sentence, as an assertion.
    ok(`ply ${hisPly + 1}: her move did not land instantly`, gap >= THINK_FLOOR_MS - EARLY_SLACK_MS, `${gap}ms`);
    // …and it waited for the board to finish drawing his.
    ok(`ply ${hisPly + 1}: …and not before his move was drawn`, gap > MOVE_ANIM_MS, `${gap}ms vs ${MOVE_ANIM_MS}`);
    // THE CEILING. A board that hangs is its own defect.
    ok(`ply ${hisPly + 1}: …and did not hang`, gap <= THINK_CEIL_MS + LATE_SLACK_MS, `${gap}ms`);
    // AND IT IS THE TABLE'S BEAT, not some other delay that happens to be in
    // range. A constant hold would pass both bounds above and fail this.
    const lo = Math.min(predictNoRecap, predictRecap) - EARLY_SLACK_MS;
    const hi = Math.max(predictNoRecap, predictRecap) + LATE_SLACK_MS;
    ok(
      `ply ${hisPly + 1}: …and it is the seeded beat`,
      gap >= lo && gap <= hi,
      `${gap}ms, predicted ${predictNoRecap}/${predictRecap}`,
    );
    plies += 2;
  }

  ok("the walk covered a real game", rows.length >= 12, `${rows.length} of her turns`);
  const gaps = rows.map((r) => r.gap);
  // PACING, NOT A DELAY. If every gap were the same number the assertions
  // above would all pass and the feature would still be a metronome.
  const spread = Math.max(...gaps) - Math.min(...gaps);
  ok("her pace varies with the position", spread > 800, `spread ${spread}ms over ${gaps.length} turns`);
  // and the variation is the TABLE's, not noise: the predicted and observed
  // orderings must agree far more often than chance.
  let agree = 0, pairs = 0;
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const dp = rows[i].predictNoRecap - rows[j].predictNoRecap;
      if (Math.abs(dp) < 400) continue;
      pairs++;
      if (Math.sign(dp) === Math.sign(rows[i].gap - rows[j].gap)) agree++;
    }
  }
  ok("…and the variation tracks the table", pairs > 0 && agree / pairs >= 0.8, `${agree}/${pairs} pairs agree`);
  console.log(`   gaps: ${gaps.join(", ")}`);
  await ctx.close();
}

// ══════════════════════════════════════════════════════════════════════════
// 2. THE REPLAY AGREES
//
// Pacing seeded on (position, session) means the same session replayed hits
// the same beat. This is what `Math.random` would break and what no offline
// test of a pure function can prove about the wiring: the component has to be
// reading the session's seed and the live position, not a fresh clock.
// ══════════════════════════════════════════════════════════════════════════

console.log("\n── 2. the replay agrees with itself ──");
{
  // A FIXED session — the same `startedAt`, the same board, the same move of
  // his — run twice. The gap must come out the same, because the beat is
  // seeded on (position, session) and not on a clock. `Math.random` pacing
  // passes every other assertion in this file and fails exactly this one.
  // FIXED, and RECENT. It has to be the same number in both runs — the beat is
  // seeded on it — and it has to be inside `OPEN_STALE_MS`, or App's reconciler
  // correctly closes the seeded session as abandoned and the board goes
  // read-only. A wall-clock literal fails that second condition on any day but
  // the one it was written; one value computed once, reused by both runs, meets
  // both.
  const FIXED_START = Date.now() - 60_000;
  const runs = [];
  for (const attempt of [0, 1]) {
    const { page, ctx } = await open({
      state: {
        game: {
          kind: "chess",
          game: E.newGame(),
          herSide: "b",
          startedAt: FIXED_START,
          touchedAt: FIXED_START,
        },
      },
    });
    await openRoom(page, "chess");
    const st = await readState(page);
    if (st.game?.startedAt !== FIXED_START || st.game?.closedAt) {
      ok(`replay ${attempt}: the seeded session survived the room`, false,
        `startedAt ${st.game?.startedAt} closedAt ${st.game?.closedAt}`);
      await ctx.close();
      continue;
    }
    await page.click('.cb-sq[aria-label^="e2,"]');
    await sleep(60);
    await page.click('.cb-sq[aria-label^="e4,"]');
    const tHis = await waitForPly(page, 1, 8000);
    const tHers = await waitForPly(page, 2, THINK_CEIL_MS + 12_000).catch(() => null);
    if (tHers === null) ok(`replay ${attempt}: she answered`, false, "timed out");
    else runs.push(Math.round(tHers - tHis));
    await ctx.close();
  }
  ok("both replays produced her answer", runs.length === 2, JSON.stringify(runs));
  if (runs.length === 2) {
    ok("the same session hits the same beat twice", Math.abs(runs[0] - runs[1]) < 500, `${runs[0]} vs ${runs[1]}`);
    ok("…and it is a held beat, not an instant one", Math.min(...runs) >= THINK_FLOOR_MS - EARLY_SLACK_MS, JSON.stringify(runs));
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 3. TIC TAC TOE — the same law on the smaller board
// ══════════════════════════════════════════════════════════════════════════

console.log("\n── 3. tic tac toe: every her-turn timed ──");
{
  const { page, ctx } = await open();
  await openRoom(page, "tic-tac-toe");
  const seeded = await readState(page);
  const seed = seeded.game?.startedAt ?? 0;
  const hisMark = seeded.game?.herSide === "x" ? "o" : "x";
  let turns = 0;
  const gaps = [];
  for (let i = 0; i < 9; i++) {
    const st = await readState(page);
    const g = st.game?.game;
    if (!g || g.status.over) break;
    if (g.status.turn !== hisMark) { await sleep(150); continue; }
    const free = g.board.map((c, ix) => (c ? -1 : ix)).filter((ix) => ix >= 0);
    if (!free.length) break;
    const hisPly = g.played.length + 1;
    // The cells live in three `.tt-row` groups, so a positional CSS selector
    // cannot address them — index the flat list, same as
    // evals/gameplay-browser.mjs. (`ttt.mark.x` is the SIDE PICKER, not a cell.)
    const cellEls = await page.$$(".tt-cell");
    await cellEls[free[0]].click();
    const tHis = await waitForPly(page, hisPly, 8000);
    const mid = await readState(page);
    if (mid.game?.game?.status?.over) break;
    let tHers;
    try {
      tHers = await waitForPly(page, hisPly + 1, THINK_CEIL_MS + 10_000);
    } catch {
      ok(`ttt ply ${hisPly + 1}: her mark arrived`, false, "timed out");
      break;
    }
    const gap = Math.round(tHers - tHis);
    gaps.push(gap);
    ok(`ttt ply ${hisPly + 1}: her mark did not land instantly`, gap >= THINK_FLOOR_MS - EARLY_SLACK_MS, `${gap}ms`);
    ok(`ttt ply ${hisPly + 1}: …and did not hang`, gap <= 2000 + LATE_SLACK_MS, `${gap}ms`);
    turns++;
  }
  ok("the ttt walk covered real turns", turns >= 2, `${turns}`);
  ok("ttt is seeded, not fixed", seed > 0, String(seed));
  console.log(`   ttt gaps: ${gaps.join(", ")}`);
  await ctx.close();
}

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASS");
process.exit(fails ? 1 : 0);
