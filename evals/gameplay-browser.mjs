// WS-GAMEPLAY — the chat-initiated invite and the side pick, in a real browser.
//
//   npx vite build
//   npx vite preview --port 4291 --strictPort &
//   node evals/gameplay-browser.mjs            # assert (exit 1 on failure)
//   node evals/gameplay-browser.mjs --observe  # print, never fail
//
// ── why a browser ─────────────────────────────────────────────────────────
//
// `evals/game-invite.mjs` proves the DETECTOR: given a thread, does an invite
// exist. It cannot prove that a chip is on screen, that tapping it opens the
// right room, or that a board whose orientation flipped still commits the
// move the finger asked for. Those are the failures this feature can actually
// ship with, and every one of them is a property of a running page:
//
//   1. THE CHIP IS IN THE THREAD AND IS NOT A BANNER. Measured as geometry:
//      it is under her bubble, at her alignment, and narrower than the
//      scroller.
//   2. CHIT-CHAT DOES NOT PRODUCE ONE. The same scripted exchange with the
//      one word changed.
//   3. BOTH SIDES ACTUALLY PLAY. Two complete games of chess, one from each
//      colour, driven move by move against the REAL engine — plus castling
//      and promotion from the black perspective specifically, because those
//      are the two moves whose coordinates a flipped board is most likely to
//      get wrong, and neither is guaranteed to appear in a played game.
//   4. THE ROOM NEVER ASSUMES HE IS WHITE. The header line, the verdict, the
//      move-list legend and the tray are read back as text at the end of a
//      game played from each side.
//
// The model is stubbed, so it is deterministic and costs $0. Her CHESS moves
// are not stubbed and must not be: the whole point of items 3 and 4 is that
// the real opponent plays the real other side.
//
// NOT wired into evals/run.mjs, for the same by-construction reason
// evals/world-thread-browser.mjs states: it needs a built app and a server on
// a port. It is in version control because `dead-writers` does not stop being
// true for evals.
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const B = process.env.MEERA_PREVIEW || "http://localhost:4291";
const OBSERVE = process.argv.includes("--observe");
const SHOTS = process.env.GAMEPLAY_SHOTS || join(process.cwd(), "gameplay-shots");
mkdirSync(SHOTS, { recursive: true });

// The REAL rules module, bundled fresh — his moves are chosen with the same
// engine hers are, so "a legal move was made and the board agreed" is a claim
// about the shipped code rather than about a hand-written referee.
const OUT = mkdtempSync(join(tmpdir(), "gameplay-"));
const ENTRY = join(OUT, "entry.ts");
writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(join(REPO, "src/engine/chess/index"))};\n` +
    `export * from ${JSON.stringify(join(REPO, "src/engine/ttt/index"))};\n`,
);
const BUNDLE = join(OUT, "engine.mjs");
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
  { cwd: REPO, stdio: "inherit" },
);
const E = await import(pathToFileURL(BUNDLE).href);

let fails = 0;
const ok = (n, c, e = "") => {
  console.log(`${c ? "ok  " : "FAIL"} ${n}${e ? " — " + e : ""}`);
  if (!c && !OBSERVE) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const BASE_STATE = {
  onboarded: true,
  deviceId: "00000000-0000-4000-8000-0000000000g1".replace("g", "a"),
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

let seq = 0;
const msg = (from, text, dtMs = 0) => ({
  id: `m${++seq}`,
  from,
  kind: "text",
  text,
  at: Date.now() - 60_000 + dtMs,
  status: from === "me" ? "read" : undefined,
});

async function open({
  theme = "light",
  sky = null,
  state = {},
  reduced = false,
  width = 390,
  height = 844,
  script = ["haan chalo"],
  delayMs = 120,
} = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    reducedMotion: reduced ? "reduce" : "no-preference",
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  let i = 0;
  await page.route("**/api/chat", async (route) => {
    const n = i++;
    await sleep(typeof delayMs === "function" ? delayMs(n) : delayMs);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ text: script[Math.min(n, script.length - 1)] }),
    });
  });
  for (const p of [
    "**/api/memory", "**/api/telemetry", "**/api/consolidate", "**/api/account",
    "**/api/clock", "**/api/life", "**/api/search", "**/api/trace", "**/api/route",
    "**/api/gif", "**/api/speech",
  ]) {
    await page.route(p, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    );
  }
  const q = sky ? `?sky=${sky}` : "";
  await page.goto(`${B}/chat${q}`, { waitUntil: "domcontentloaded" });
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
  await sleep(500);
  return { page, ctx };
}

const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });
const readState = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("meera.state.v1") || "{}"));

/** The games sheet route, so a seeded session can be opened without a chip. */
async function openRoom(page, id) {
  await page.click('[data-tel="chat.games"]');
  await page.waitForSelector(`[data-tel="games.open.${id}"]`, { timeout: 6000 });
  await page.click(`[data-tel="games.open.${id}"]`);
  await page.waitForSelector(".as", { timeout: 6000 });
  await sleep(500);
}

/** A chess session, seeded from any FEN, with her on `herSide`. */
const chessSession = (fen, herSide) => ({
  kind: "chess",
  game: E.newGame(fen),
  herSide,
  startedAt: Date.now() - 120_000,
});

// ════ 1. THE INVITE CHIP ═══════════════════════════════════════════════════
{
  console.log("\n── 1. the invite chip ──");

  // HIS CLEAR ASK. He types it, the stubbed reply comes back, the chip lands
  // under HER line. Nothing is seeded: this is the real send path.
  {
    const { page, ctx } = await open({ script: ["haan chalo khelte hain"] });
    await page.fill(".chat-input textarea", "chalo chess khelte h");
    await page.click('[data-tel="chat.send"]');
    await page.waitForSelector(".gi-chip", { timeout: 15_000 });
    await shot(page, "01-invite-chip-light-390");

    const geo = await page.evaluate(() => {
      const chip = document.querySelector(".gi-chip");
      const scroll = document.querySelector(".chat-scroll");
      const bubbles = Array.from(document.querySelectorAll(".chat-scroll .msg.her"));
      const last = bubbles[bubbles.length - 1];
      const c = chip.getBoundingClientRect();
      const s = scroll.getBoundingClientRect();
      const b = last.getBoundingClientRect();
      return {
        text: chip.textContent,
        w: c.width,
        scrollW: s.width,
        left: c.left - s.left,
        bubbleLeft: b.left - s.left,
        below: c.top >= b.bottom - 1,
        h: c.height,
      };
    });
    ok("the chip fired on a clear ask", /chess board/i.test(geo.text), geo.text);
    ok("it is a CHIP, not a banner", geo.w < geo.scrollW * 0.8, `${geo.w.toFixed(0)}px of ${geo.scrollW.toFixed(0)}px`);
    ok("it is one row tall", geo.h <= 56, `${geo.h.toFixed(0)}px`);
    ok("it sits at HER alignment", Math.abs(geo.left - geo.bubbleLeft) < 6, `${geo.left.toFixed(0)} vs ${geo.bubbleLeft.toFixed(0)}`);
    ok("it is BELOW her bubble, in the thread", geo.below);

    // it does NOT open the room by itself
    ok("no room opened without a tap", (await page.$(".as")) === null);

    // …and the tap does
    await page.click(".gi-chip");
    await page.waitForSelector(".as", { timeout: 6000 });
    await sleep(600);
    const title = await page.textContent(".as-title");
    ok("the tap opens the chess room", /chess/i.test(title || ""), String(title));
    await shot(page, "02-invite-opened-room");

    // AND IT IS SPENT. Back in the thread the chip is gone, and it stays gone
    // when she says something else — the case that caught the first version,
    // which keyed the chip on her latest bubble and therefore reissued a
    // tapped invite the moment a new one arrived.
    await page.click('[data-tel="activity.exit"]');
    await sleep(900);
    ok("the chip is spent once used", (await page.$(".gi-chip")) === null);
    await page.fill(".chat-input textarea", "acha");
    await page.click('[data-tel="chat.send"]');
    await sleep(6000);
    ok("…and it does not come back on her next line", (await page.$(".gi-chip")) === null);
    await ctx.close();
  }

  // CHIT-CHAT. Same shape of exchange, the intent removed.
  for (const line of ["chess is fun na", "mera bhai chess khelta hai", "kal chess khela tha"]) {
    const { page, ctx } = await open({ script: ["haan yaar sahi hai"] });
    await page.fill(".chat-input textarea", line);
    await page.click('[data-tel="chat.send"]');
    // wait past the whole reply cycle rather than for an absence
    await page.waitForSelector(".chat-scroll .msg.her", { timeout: 15_000 });
    await sleep(2500);
    ok(`chit-chat does not fire a chip: "${line}"`, (await page.$(".gi-chip")) === null);
    await ctx.close();
  }

  // SHE PROPOSES, HE AGREES.
  {
    const { page, ctx } = await open({
      state: { messages: [msg("me", "bore ho raha hu"), msg("her", "chess khelein?", 5_000)] },
      script: ["yesss board khol"],
    });
    await page.fill(".chat-input textarea", "haan chalo");
    await page.click('[data-tel="chat.send"]');
    await page.waitForSelector(".gi-chip", { timeout: 15_000 });
    ok("her proposal plus his yes fires the chip", true);
    await shot(page, "03-invite-her-proposal");
    await ctx.close();
  }

  // SIGNED OUT is the default of every case above (BASE_STATE has no `auth`),
  // so this is the signed-IN half of "works either way".
  {
    const { page, ctx } = await open({
      state: {
        auth: {
          userId: "u-test",
          email: "t@example.com",
          accessToken: "x",
          refreshToken: "y",
          expiresAt: Date.now() + 864e5,
        },
      },
      script: ["chalo!"],
    });
    await page.fill(".chat-input textarea", "let's play tic tac toe");
    await page.click('[data-tel="chat.send"]');
    await page.waitForSelector(".gi-chip", { timeout: 15_000 });
    const t = await page.textContent(".gi-chip");
    ok("signed in: the chip fires, and names the right game", /tic tac toe/i.test(t || ""), String(t));
    await ctx.close();
  }

  // THE WORLD: both themes, both widths, reduced motion.
  for (const [label, opts] of [
    ["light-320", { theme: "light", sky: "morning", width: 320 }],
    ["dark-390", { theme: "dark", sky: "night", width: 390 }],
    ["dark-320", { theme: "dark", sky: "dusk", width: 320 }],
    ["reduced-390", { theme: "light", sky: "golden", width: 390, reduced: true }],
  ]) {
    const { page, ctx } = await open({ ...opts, script: ["haan chalo"] });
    await page.fill(".chat-input textarea", "chalo chess khelte h");
    await page.click('[data-tel="chat.send"]');
    await page.waitForSelector(".gi-chip", { timeout: 15_000 });
    await sleep(500);
    await shot(page, `04-invite-${label}`);
    const fit = await page.evaluate(() => {
      const c = document.querySelector(".gi-chip").getBoundingClientRect();
      return { right: c.right, vw: window.innerWidth, h: c.height };
    });
    ok(`${label}: the chip fits the viewport`, fit.right <= fit.vw, `${fit.right.toFixed(0)} of ${fit.vw}`);
    ok(`${label}: it still has a 44px touch target`, fit.h >= 44, `${fit.h.toFixed(0)}px`);
    await ctx.close();
  }
}

// ════ 2. THE SIDE PICK ═════════════════════════════════════════════════════
{
  console.log("\n── 2. the side pick ──");

  // DEFAULT = what shipped. He is white, she is black, and she does not move.
  {
    const { page, ctx } = await open({});
    await openRoom(page, "chess");
    await shot(page, "05-chess-fresh-pick-light");
    const on = await page.textContent(".as-pick-b[data-on]");
    ok("the picker offers a side on a fresh board", on !== null, String(on));
    ok("…and the default is White, which is what shipped", (on || "").trim() === "White", String(on));
    const st = await readState(page);
    ok("she is black by default", st.game?.herSide === "b", JSON.stringify(st.game?.herSide));
    await sleep(2600);
    const st2 = await readState(page);
    ok("she does not move first when he is white", (st2.game?.game.played.length ?? 0) === 0);
    const orient = await page.evaluate(() => {
      const first = document.querySelector(".cb-sq");
      return first.getAttribute("aria-label");
    });
    ok("white at the bottom: a8 is the top-left square", /^a8,/.test(orient || ""), String(orient));
    await ctx.close();
  }

  // HE PICKS BLACK. She becomes white and opens.
  {
    const { page, ctx } = await open({ theme: "dark", sky: "night" });
    await openRoom(page, "chess");
    await page.click('[data-tel="chess.side.b"]');
    await sleep(400);
    const st = await readState(page);
    ok("picking black makes HER white", st.game?.herSide === "w", String(st.game?.herSide));
    const orient = await page.evaluate(() =>
      document.querySelector(".cb-sq").getAttribute("aria-label"),
    );
    ok("the board flipped: h1 is now the top-left square", /^h1,/.test(orient || ""), String(orient));
    // she opens, within her own think-time window
    await page.waitForFunction(
      () => (JSON.parse(localStorage.getItem("meera.state.v1") || "{}").game?.game.played.length ?? 0) > 0,
      null,
      { timeout: 12_000 },
    );
    await sleep(400);
    const st2 = await readState(page);
    ok("she opens the game as white", st2.game?.game.played[0]?.by === "w", JSON.stringify(st2.game?.game.played[0]));
    await shot(page, "06-chess-black-she-opened-dark");
    const legend = await page.textContent(".cx-sides");
    ok("the move list says whose colour is whose", /you/.test(legend || "") && /her/.test(legend || ""), String(legend));
    const side = await page.getAttribute('.cx-side[data-side="b"]', "class");
    ok("the legend renders a black swatch", side !== null);
    // the picker is gone the moment a move exists
    ok("the picker leaves once the game has started", (await page.$(".as-pick")) === null);
    await ctx.close();
  }

  // TIC TAC TOE, both marks.
  for (const [pick, herMark, opensFirst] of [
    ["x", "o", false],
    ["o", "x", true],
  ]) {
    const { page, ctx } = await open({});
    await openRoom(page, "tic-tac-toe");
    await page.click(`[data-tel="ttt.mark.${pick}"]`);
    await sleep(300);
    const st = await readState(page);
    ok(`ttt: he picks ${pick.toUpperCase()}, she takes ${herMark.toUpperCase()}`, st.game?.herSide === herMark, String(st.game?.herSide));
    if (opensFirst) {
      await page.waitForFunction(
        () => (JSON.parse(localStorage.getItem("meera.state.v1") || "{}").game?.game.played.length ?? 0) > 0,
        null,
        { timeout: 8000 },
      );
      const st2 = await readState(page);
      ok("ttt: she opens when she is X", st2.game?.game.played[0]?.by === "x", JSON.stringify(st2.game?.game.played[0]));
    } else {
      await sleep(3000);
      const st2 = await readState(page);
      ok("ttt: she waits when he is X", (st2.game?.game.played.length ?? 0) === 0);
    }
    const legend = await page.textContent(".tt-info");
    ok(
      `ttt: the legend names his mark as ${pick.toUpperCase()}`,
      new RegExp(`${pick.toUpperCase()}\\s*you`, "i").test((legend || "").replace(/\s+/g, " ")),
      String(legend),
    );
    await shot(page, `07-ttt-he-plays-${pick}`);
    await ctx.close();
  }
}

// ════ 3. CASTLING AND PROMOTION, FROM THE BLACK SEAT ═══════════════════════
//
// The two moves whose coordinates a flipped board is most likely to get
// wrong, and neither is guaranteed to turn up in a played game — so both are
// seeded rather than hoped for.
{
  console.log("\n── 3. castling and promotion from black ──");

  // Black to move, kingside castling available. He is black, so she is white.
  {
    const fen = "rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R b KQkq - 5 4";
    const { page, ctx } = await open({ state: { game: chessSession(fen, "w") } });
    await openRoom(page, "chess");
    await shot(page, "08-chess-castling-before");
    await page.click('.cb-sq[aria-label^="e8,"]');
    await sleep(200);
    await page.click('.cb-sq[aria-label^="g8,"]');
    await sleep(700);
    const st = await readState(page);
    const last = st.game?.game.played.at(-1);
    ok("black castles kingside from the flipped board", last?.san === "O-O", JSON.stringify(last));
    const list = await page.textContent(".cx-movelist");
    ok("the move list shows the castle in SAN", /O-O/.test(list || ""), String(list));
    const kingSq = await page.getAttribute('.cb-sq[aria-label^="g8,"]', "aria-label");
    const rookSq = await page.getAttribute('.cb-sq[aria-label^="f8,"]', "aria-label");
    ok("the king landed on g8", /black king/.test(kingSq || ""), String(kingSq));
    ok("the rook landed on f8", /black rook/.test(rookSq || ""), String(rookSq));
    await shot(page, "09-chess-castling-after");
    await ctx.close();
  }

  // Black pawn on b2, one square from promoting. He is black.
  {
    const fen = "6k1/8/8/8/8/6K1/1p6/8 b - - 0 60";
    const { page, ctx } = await open({ state: { game: chessSession(fen, "w") } });
    await openRoom(page, "chess");
    await page.click('.cb-sq[aria-label^="b2,"]');
    await sleep(200);
    await page.click('.cb-sq[aria-label^="b1,"]');
    await page.waitForSelector(".cb-promo", { timeout: 4000 });
    await shot(page, "10-chess-promotion-picker");
    await page.click('[aria-label="Promote to queen"]');
    await sleep(700);
    const st = await readState(page);
    const last = st.game?.game.played.at(-1);
    ok("black promotes from the flipped board", /^b1=Q/.test(last?.san || ""), JSON.stringify(last));
    const list = await page.textContent(".cx-movelist");
    ok("the promotion is in the move list", /b1=Q/.test(list || ""), String(list));
    const q = await page.getAttribute('.cb-sq[aria-label^="b1,"]', "aria-label");
    ok("a black queen stands on b1", /black queen/.test(q || ""), String(q));
    await shot(page, "11-chess-promoted");
    await ctx.close();
  }

  // A capture from the black seat: the tray on HIS side of the board fills
  // with the WHITE piece he took.
  {
    const fen = "4k3/8/8/3q4/4P3/8/8/4K3 b - - 0 40";
    const { page, ctx } = await open({ state: { game: chessSession(fen, "w") } });
    await openRoom(page, "chess");
    await page.click('.cb-sq[aria-label^="d5,"]');
    await sleep(200);
    await page.click('.cb-sq[aria-label^="e4,"]');
    await sleep(700);
    const st = await readState(page);
    ok("the capture is recorded", st.game?.game.played.at(-1)?.captured === "p", JSON.stringify(st.game?.game.played.at(-1)));
    const trays = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".cb-tray")).map((t) => ({
        side: t.getAttribute("data-side"),
        sr: t.querySelector(".sr-only")?.textContent || "",
      })),
    );
    const bottom = trays.find((t) => t.side === "bottom");
    ok(
      "his own tray (bottom) holds the white pawn he took",
      /white pawn/.test(bottom?.sr || ""),
      JSON.stringify(trays),
    );
    await shot(page, "12-chess-capture-black-seat");
    await ctx.close();
  }
}

// ════ 4. TWO COMPLETE GAMES, ONE FROM EACH COLOUR ══════════════════════════
//
// Driven move by move against the REAL rules module: his move is chosen by
// the same engine hers is, played by CLICKING the two squares, and the page's
// own state is read back after every ply. A game that finishes this way has
// proved legality, notation, capture bookkeeping, the flip and the terminal
// verdict in one pass, from that colour.
const MAX_PLIES = 200;
// Her think-time is 0.8–6s per move (ChessActivity's held move), so the loop
// spends most of its iterations WAITING. Counting those against the ply budget
// was the first version's bug: a legitimate 60-ply game exhausted a 160-ply
// cap without either side making a mistake. The two budgets are separate now —
// plies bound the GAME, wall time bounds the loop.
const MAX_WALL_MS = 6 * 60_000;

async function playOut(page, hisSide) {
  let plies = 0;
  let sawCastle = false;
  let sawCapture = false;
  const t0 = Date.now();
  while (plies < MAX_PLIES && Date.now() - t0 < MAX_WALL_MS) {
    const st = await readState(page);
    const g = st.game?.game;
    if (!g) return { over: false, why: "no game" };
    if (g.status.over) return { over: true, status: g.status, plies: g.played.length, sawCastle, sawCapture };
    if (g.status.turn !== hisSide) {
      await sleep(300);
      continue;
    }
    const hm = E.chooseMove(g, { strength: 5 });
    if (!hm) return { over: false, why: "no move" };
    const uci = hm.move.uci;
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promo = uci.slice(4, 5);
    await page.click(`.cb-sq[aria-label^="${from},"]`);
    await sleep(90);
    await page.click(`.cb-sq[aria-label^="${to},"]`);
    if (promo) {
      const NAME = { q: "queen", r: "rook", b: "bishop", n: "knight" };
      await page.waitForSelector(".cb-promo", { timeout: 4000 });
      await page.click(`[aria-label="Promote to ${NAME[promo]}"]`);
    }
    await sleep(260);
    const after = await readState(page);
    const last = after.game?.game.played.at(-1);
    if (!last || last.by !== hisSide) return { over: false, why: `his move did not land: ${uci}` };
    if (/^O-O/.test(last.san)) sawCastle = true;
    if (last.captured) sawCapture = true;
    plies++;
  }
  return { over: false, why: plies >= MAX_PLIES ? "ply cap" : "wall clock", plies };
}

for (const [label, pick, hisSide] of [
  ["as white", null, "w"],
  ["as black", "b", "b"],
]) {
  console.log(`\n── 4. a complete game ${label} ──`);
  const { page, ctx } = await open({ theme: hisSide === "b" ? "dark" : "light", sky: hisSide === "b" ? "night" : "morning" });
  await openRoom(page, "chess");
  if (pick) {
    await page.click(`[data-tel="chess.side.${pick}"]`);
    await sleep(400);
  }
  const r = await playOut(page, hisSide);
  ok(`${label}: the game reached a real ending`, r.over === true, JSON.stringify(r));
  if (r.over) {
    ok(`${label}: ${r.status.result} after ${r.plies} plies`, true);
    ok(`${label}: at least one capture happened`, r.sawCapture);
  }
  await sleep(900);
  const verdict = await page.textContent(".as-result").catch(() => null);
  ok(`${label}: the result is stated on screen`, Boolean(verdict && verdict.trim()), String(verdict));
  // and it is stated from HIS seat, not from white's
  if (r.over && r.status.result === "checkmate") {
    const heWon = r.status.winner === hisSide;
    ok(
      `${label}: the verdict names the right winner`,
      heWon ? /You won/i.test(verdict || "") : /She won/i.test(verdict || ""),
      String(verdict),
    );
  }
  const head = await page.textContent(".as-state");
  ok(`${label}: the header does not claim a live move`, !/your move|her move/i.test(head || ""), String(head));
  await shot(page, `13-chess-complete-${hisSide === "w" ? "white" : "black"}`);
  // the rematch keeps the side he chose
  await page.click('[data-tel="chess.new"]');
  await sleep(600);
  const st = await readState(page);
  ok(`${label}: the rematch keeps his colour`, st.game?.herSide === (hisSide === "w" ? "b" : "w"), String(st.game?.herSide));
  ok(`${label}: the picker is back on the fresh board`, (await page.$(".as-pick")) !== null);
  await shot(page, `14-chess-rematch-${hisSide === "w" ? "white" : "black"}`);
  await ctx.close();
}

// ════ 5. TWO COMPLETE GAMES OF TIC TAC TOE, ONE FROM EACH MARK ═════════════
{
  for (const [pick, herMark] of [
    ["x", "o"],
    ["o", "x"],
  ]) {
    console.log(`\n── 5. a complete ttt game, he plays ${pick.toUpperCase()} ──`);
    const { page, ctx } = await open({});
    await openRoom(page, "tic-tac-toe");
    await page.click(`[data-tel="ttt.mark.${pick}"]`);
    await sleep(400);
    let guard = 0;
    while (guard++ < 30) {
      const st = await readState(page);
      const g = st.game?.game;
      if (!g) break;
      if (g.status.over) break;
      if (g.status.turn !== pick) {
        await sleep(400);
        continue;
      }
      // The cells live in three `.tt-row` groups, so a positional CSS
      // selector cannot address them — index the flat list instead.
      const cell = E.legalCells(g)[0];
      const cells = await page.$$(".tt-cell");
      await cells[cell].click();
      await sleep(350);
    }
    const st = await readState(page);
    ok(`ttt ${pick}: the game reached a real ending`, Boolean(st.game?.game.status.over), JSON.stringify(st.game?.game.status));
    ok(`ttt ${pick}: she played the other mark`, st.game?.herSide === herMark);
    ok(
      `ttt ${pick}: every one of her marks is ${herMark.toUpperCase()}`,
      (st.game?.game.played ?? []).filter((m) => m.by === herMark).length > 0 &&
        (st.game?.game.played ?? []).every((m) => m.by === "x" || m.by === "o"),
    );
    const head = await page.textContent(".as-state");
    ok(`ttt ${pick}: the header does not claim a live move`, !/your move|her move/i.test(head || ""), String(head));
    await shot(page, `15-ttt-complete-${pick}`);
    await ctx.close();
  }
}

// ════ 6. THE ROOM IN THE WORLD ═════════════════════════════════════════════
//
// The picker is a new piece of chrome on the wallpaper, so it gets the same
// sweep every other surface in this app takes: both widths, both themes,
// reduced motion.
{
  console.log("\n── 6. the picker across the world ──");
  for (const [label, opts] of [
    ["light-320", { theme: "light", sky: "morning", width: 320 }],
    ["light-390", { theme: "light", sky: "golden", width: 390 }],
    ["dark-320", { theme: "dark", sky: "night", width: 320 }],
    ["dark-390", { theme: "dark", sky: "dusk", width: 390 }],
    ["reduced-390", { theme: "dark", sky: "night", width: 390, reduced: true }],
  ]) {
    const { page, ctx } = await open(opts);
    await openRoom(page, "chess");
    await sleep(400);
    await shot(page, `16-pick-chess-${label}`);
    const fit = await page.evaluate(() => {
      const p = document.querySelector(".as-pick");
      if (!p) return null;
      const r = p.getBoundingClientRect();
      const bs = Array.from(p.querySelectorAll(".as-pick-b")).map((b) => {
        const q = b.getBoundingClientRect();
        const a = getComputedStyle(b, "::after");
        const grow = Math.abs(parseFloat(a.top) || 0);
        return { h: q.height + grow * 2, w: q.width };
      });
      return { left: r.left, right: r.right, vw: window.innerWidth, bs };
    });
    ok(`${label}: the picker is on screen`, fit !== null);
    ok(`${label}: it fits the viewport`, fit && fit.left >= 0 && fit.right <= fit.vw, JSON.stringify(fit && { l: fit.left, r: fit.right, vw: fit.vw }));
    ok(
      `${label}: both halves clear 44px of touch`,
      fit && fit.bs.every((b) => b.h >= 44 && b.w >= 44),
      JSON.stringify(fit && fit.bs),
    );
    await ctx.close();
  }
}

await browser.close();
console.log(fails ? `\n${fails} FAILURE(S)` : "\nall gameplay browser checks passed");
process.exit(fails ? 1 : 0);
