// THE STATE BOUNDARIES — what crosses into AppState, and what has to leave it.
//
// Four of the 2026-08-22 audit's findings were one shape: a field crosses a
// boundary (a sync payload, a second tab, a stored blob, an account switch)
// and nobody decided what happens to it there. The failures are not cosmetic —
// a malformed game unmounted the whole app permanently, a user without `facts`
// stopped her replying forever, a second tab erased a chess game, and
// `recentMoment` walked through "make her forget you" so her first sentences
// to a stranger were about their hundred days together.
//
// The last one is why this file exists at all rather than three more one-off
// assertions. `recentMoment` was the THIRD field to slip through the teardown
// (game and callback were the first two, tally and momentsFired the second
// pair), each caught by a person noticing. So the check below is not "is
// recentMoment wiped" — it is: EVERY optional AppState field is either wiped by
// the teardown or exempted in writing, right here, with a reason. A new field
// added to AppState next month fails this suite until someone decides. That is
// the only version of this check that ends the class.
//
// Offline, source-parsing + a fresh esbuild bundle of the real state modules.
// No network, no DB, no model, $0, ~1s.
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const src = (p) => readFileSync(join(ROOT, p), "utf8");

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    fail++;
    console.log(`FAIL  ${name}${extra ? "\n      " + extra : ""}`);
  }
};

// ── the real modules, bundled fresh (never a frozen copy) ─────────────────
const tmp = mkdtempSync(join(tmpdir(), "teardown-"));
const ENTRY = join(tmp, "entry.ts");
const BUNDLE = join(tmp, "bundle.mjs");
writeFileSync(
  ENTRY,
  `export { isGameSession } from "${join(ROOT, "src/state/game")}";
export { safeUser, mergeStates } from "${join(ROOT, "src/state/merge")}";
export { newGame, play } from "${join(ROOT, "src/engine/chess")}";
`,
);
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
  { stdio: "inherit", cwd: ROOT },
);
const { isGameSession, safeUser, mergeStates, newGame, play } = await import(BUNDLE);

// ══ #2 — a malformed session costs the GAME, never the app ════════════════
//
// The audit's walk3: a session whose `played` rows carry only `san`. It passed
// the old guard (played is an array, status is an object), reached
// ChessBoard's `lastMove={{ from: last.from, to: last.to }}`, and `squareIndex`
// did `sq[0]` on undefined — a throw during render, above every setState,
// which unmounts the entire tree. Persisted, so every reload did it again.
{
  const walk3 = {
    kind: "chess",
    startedAt: 1_700_000_000_000,
    herSide: "b",
    game: {
      fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
      played: [{ san: "e4" }, { san: "e5" }],
      positions: [],
      status: { over: false, turn: "w" },
    },
  };
  ok("walk3 (shallow chess rows) is rejected", isGameSession(walk3) === false);

  // and a REAL game, built by the real engine, still passes — this is the half
  // that matters: over-validating drops live sessions, and a dropped game is a
  // game she then denies having played
  let g = newGame();
  for (const m of ["e4", "e5", "Nf3", "Nc6", "Bb5"]) g = play(g, m);
  const real = { kind: "chess", startedAt: Date.now(), herSide: "b", game: g };
  ok("a real 5-ply chess session passes", isGameSession(real) === true);
  ok("a fresh (0-move) chess session passes", isGameSession({ ...real, game: newGame() }) === true);
  ok(
    "a closed real session passes",
    isGameSession({ ...real, closedAt: Date.now(), tallied: true }) === true,
  );

  // the fields the guard must NOT require: `lastAssessment` catches around the
  // deeper reads, so a row missing them is survivable and must not cost the game
  const noFens = {
    ...real,
    game: { ...g, played: g.played.map(({ fenBefore, fenAfter, moveNumber, ...rest }) => rest) },
  };
  ok("rows without fenBefore/fenAfter/moveNumber still pass", isGameSession(noFens) === true);

  // the ones it must require, one at a time
  for (const drop of ["san", "from", "to"]) {
    const maimed = {
      ...real,
      game: { ...g, played: g.played.map((m, i) => (i === 2 ? { ...m, [drop]: undefined } : m)) },
    };
    ok(`a chess row missing ${drop} is rejected`, isGameSession(maimed) === false);
  }
  ok(
    "a null row is rejected",
    isGameSession({ ...real, game: { ...g, played: [...g.played, null] } }) === false,
  );

  // ttt: `cell` is what the board and CELL_NAME dereference
  const ttt = {
    kind: "ttt",
    startedAt: Date.now(),
    herSide: "o",
    game: {
      board: [null, null, null, null, "x", null, null, null, null],
      played: [{ cell: 4, by: "x" }],
      status: { over: false, turn: "o", result: "in_progress", winner: null, line: null },
    },
  };
  ok("a real ttt session passes", isGameSession(ttt) === true);
  ok(
    "a ttt row without cell is rejected",
    isGameSession({ ...ttt, game: { ...ttt.game, played: [{ by: "x" }] } }) === false,
  );

  // wyr is unchanged — the guard must not have become stricter for it
  ok(
    "wyr is untouched by the deepening",
    isGameSession({ kind: "wyr", startedAt: 1, salt: "s", seen: [], rounds: [] }) === true,
  );
}

// ── #2b: the account-switch branch guards the same way merge.ts does ──────
{
  const app = src("src/App.tsx");
  const branch = app.slice(app.indexOf("lastAccountId && s.lastAccountId !== fresh.userId"));
  const upto = branch.slice(0, branch.indexOf("};"));
  ok(
    "account switch shape-guards the adopted game",
    /game:\s*isGameSession\(/.test(upto),
    "App.tsx's account-switch branch casts r?.game straight into state",
  );
  ok("account switch coerces the adopted user", /user:\s*safeUser\(/.test(upto));
}

// ── #2c: the boundary exists, wraps the OVERLAY, and is not at the root ───
{
  const app = src("src/App.tsx");
  ok("an ErrorBoundary is mounted", /<ErrorBoundary/.test(app));
  const at = app.indexOf("<ErrorBoundary");
  const closes = app.indexOf("</ErrorBoundary>");
  const wrapped = app.slice(at, closes);
  for (const a of ["would-you-rather", "tic-tac-toe", "chess"]) {
    ok(`the boundary wraps the ${a} overlay`, wrapped.includes(`activity === "${a}"`));
  }
  // scope is the whole point: a boundary around Chat/CallVoice would replace
  // HER with an apology, which is worse than a crash because it looks intended
  ok("the boundary does NOT wrap the chat", !wrapped.includes("<Chat"));
  ok("the boundary does NOT wrap the call", !wrapped.includes("<CallVoice"));
  const eb = src("src/components/ErrorBoundary.tsx");
  ok("it reports the crash", /tel\(\s*"ui\.crash"/.test(eb));
  // the one action it offers must CHANGE THE STATE — a retry that re-renders
  // the same malformed session is a loop the user cannot leave
  ok("its one action nulls the game", /onPutAway=\{[\s\S]{0,200}game:\s*null/.test(app.slice(at)));
  ok("and closes the overlay", /onPutAway=\{[\s\S]{0,240}setActivity\(null\)/.test(app.slice(at)));
}

// ══ #8 — user coerced at every boundary ═══════════════════════════════════
//
// walk4 §1: `user: { name: "Rohan" }` with no facts. `buildSystemPromptParts`
// opens with `Object.entries(user.facts)`, which throws — on the reply path,
// on every send, on that device, forever. She types and never answers.
{
  const walk4 = safeUser({ name: "Rohan" });
  ok("walk4 user gains facts", walk4.facts && typeof walk4.facts === "object");
  ok("walk4 user gains vibe", Array.isArray(walk4.vibe));
  ok("walk4 keeps the name", walk4.name === "Rohan");
  ok("Object.entries survives it", Object.entries(walk4.facts).length === 0);

  for (const [what, u] of [
    ["undefined", undefined],
    ["null", null],
    ["a string", "Rohan"],
    ["an array", ["a"]],
    ["facts as an array", { name: "R", facts: ["a"] }],
    ["facts as null", { name: "R", facts: null }],
    ["vibe as a string", { name: "R", vibe: "flirty", facts: {} }],
    ["name as a number", { name: 7, facts: {} }],
  ]) {
    const s = safeUser(u);
    ok(
      `safeUser(${what}) is prompt-safe`,
      typeof s.name === "string" && Array.isArray(s.vibe) && s.facts && !Array.isArray(s.facts),
      JSON.stringify(s),
    );
  }
  // real facts survive — a coercion that quietly emptied the fact table would
  // be the same amnesia wearing a different hat
  ok("real facts pass through", safeUser({ name: "R", vibe: ["a"], facts: { city: "Pune" } }).facts.city === "Pune");

  const NOW = 1_800_000_000_000;
  const local = {
    onboarded: true, deviceId: "d1", user: { name: "R", vibe: [], facts: {} },
    messages: [], lastSeen: NOW,
  };
  const m = mergeStates(local, { messages: [{ id: "x", from: "her", kind: "text", text: "hi", at: NOW }], user: { name: "Rohan" } });
  ok("mergeStates never adopts a factless user", m.user.facts && typeof m.user.facts === "object", JSON.stringify(m.user));

  ok("loadState coerces its shallow spread", /parsed\.user\s*=\s*safeUser\(/.test(src("src/state/store.ts")));
  ok("persona defends the deref itself", /Object\.entries\(user\.facts \?\? \{\}\)/.test(src("src/engine/persona.ts")));
}

// ══ #7 — two tabs are two devices that share a disk ═══════════════════════
//
// The old listener adopted the other tab's blob WHOLESALE when its last
// message was newer, and ignored it otherwise. Both halves were wrong: one
// field's recency cannot decide the fate of all the others (a game, a tally
// and a ledger all advance with no message sent), and wholesale adoption
// discards the loser's half. The audit's walk5 §C: tab2's next write erased
// tab1's game, its tally and its fired-ledger.
{
  const store = src("src/state/store.ts");
  const at = store.indexOf("const onStorage");
  const listener = store.slice(at, store.indexOf("window.addEventListener(\"storage\"", at));
  ok("the cross-tab listener merges", /mergeStates\(/.test(listener));
  ok(
    "it no longer adopts wholesale on message recency",
    !/inLast > curLast/.test(listener),
    "the last-message-wins rule is still deciding every field",
  );
  ok("it re-guards the adopted game", /isGameSession\(/.test(listener));
  ok(
    "it writes the union back to the disk it just lost it to",
    /saveState\(merged\)/.test(listener),
    "without the write-back, the rescued game dies on the next reload",
  );

  // the merge property the fix rests on, asserted directly
  const NOW = 1_800_000_000_000;
  const g1 = { kind: "wyr", salt: "s", startedAt: NOW, seen: ["a"], rounds: [{ cardId: "a" }] };
  const tab1 = {
    onboarded: true, deviceId: "d1", user: { name: "R", vibe: [], facts: {} },
    messages: [{ id: "a", from: "me", kind: "text", text: "hi", at: NOW - 1000 }],
    lastSeen: NOW, game: g1, tally: { wyrCards: 3 }, momentsFired: ["days-7"],
  };
  // tab2's blob: NEWER message, and no idea the game happened
  const tab2 = {
    ...tab1,
    messages: [...tab1.messages, { id: "b", from: "me", kind: "text", text: "yo", at: NOW }],
    game: null, tally: null, momentsFired: [],
  };
  const merged = mergeStates(tab1, tab2);
  ok("walk5 §C: tab1's game survives tab2's newer write", merged.game === g1);
  ok("walk5 §C: the tally survives", merged.tally?.wyrCards === 3, JSON.stringify(merged.tally));
  ok("walk5 §C: the fired-ledger survives", merged.momentsFired?.includes("days-7"));
  ok("walk5 §C: and tab2's message still arrives", merged.messages.length === 2);
}

// ══ #5 — THE CLASS: every optional AppState field decides its teardown fate ═
//
// Not "is recentMoment wiped". A field added to AppState next month fails this
// until someone writes down what happens to it when the relationship is
// deleted. Exemptions are allowed and are the point — each one is a decision
// on the record, not an omission nobody noticed.
const TEARDOWN_EXEMPT = {
  auth:
    "the account, not the relationship. A forget that signed you out would " +
    "also cut the only route back to the server copy — and signing out is " +
    "already its own button, with its own wipe.",
  theme:
    "a device preference and nothing else (decisions: theme does not even " +
    "sync between a person's own devices). Wiping it would flash a " +
    "dark-mode user white as a side effect of forgetting.",
  lastAccountId:
    "the ownership guard itself. Clearing it is how the NEXT account on this " +
    "browser inherits this one's state — the exact bleed the field exists " +
    "to prevent.",
};
{
  const store = src("src/state/store.ts");
  const body = store.slice(store.indexOf("export interface AppState {"));
  const iface = body.slice(0, body.indexOf("\n}"));
  const optional = [...iface.matchAll(/^ {2}([A-Za-z0-9_]+)\?:/gm)].map((m) => m[1]);
  ok("AppState's optional keys were parsed", optional.length >= 10, optional.join(", "));

  const chat = src("src/components/Chat.tsx");
  const fn = chat.slice(chat.indexOf("function tearDownLocally"));
  const updater = fn.slice(fn.indexOf("setState((s) => ({"), fn.indexOf("}));"));
  const wiped = new Set([...updater.matchAll(/^\s+([A-Za-z0-9_]+):/gm)].map((m) => m[1]));
  ok("the teardown updater was parsed", wiped.size >= 8, [...wiped].join(", "));

  for (const key of optional) {
    ok(
      `optional field '${key}' has a teardown fate`,
      wiped.has(key) || key in TEARDOWN_EXEMPT,
      `AppState.${key} is neither wiped by tearDownLocally nor exempted in ` +
        `evals/teardown.mjs. Decide: does it belong to the relationship that ` +
        `is being deleted? If yes, wipe it (and restore it in undoClear and ` +
        `carry it in Snapshot). If no, add it to TEARDOWN_EXEMPT with the reason.`,
    );
  }
  // an exemption for a field that no longer exists is a stale decision
  for (const key of Object.keys(TEARDOWN_EXEMPT)) {
    ok(`exemption '${key}' still names a real field`, optional.includes(key));
  }
  // the field that started this
  ok("recentMoment is wiped by the teardown", wiped.has("recentMoment"));

  // ── the round trip: whatever the teardown wipes, undo must put back ──────
  const snapType = chat.slice(chat.indexOf("type Snapshot ="), chat.indexOf("type Snapshot =") + 400);
  const undo = chat.slice(chat.indexOf("function undoClear"));
  const restored = undo.slice(undo.indexOf("setState((s) => ({"), undo.indexOf("}));"));
  for (const key of wiped) {
    if (key === "clearedAt" || key === "messages") continue; // tombstone + list: same names, checked below
    ok(`undo restores '${key}'`, restored.includes(`${key}: snap.${key}`));
    ok(`Snapshot carries '${key}'`, snapType.includes(`"${key}"`));
  }
  ok("undo restores the transcript", restored.includes("messages: snap.messages"));
  ok("undo restores the tombstone", restored.includes("clearedAt: snap.clearedAt"));

  // ── the sibling boundary: an account switch is a teardown too ────────────
  // Same class, different door. Everything the teardown treats as relational
  // must be reset when the browser changes hands, or it bleeds across accounts.
  const app = src("src/App.tsx");
  const branch = app.slice(app.indexOf("lastAccountId && s.lastAccountId !== fresh.userId"));
  const reset = branch.slice(0, branch.indexOf("};"));
  for (const key of wiped) {
    if (key === "messages") continue;
    ok(`account switch also resets '${key}'`, new RegExp(`\\b${key}:`).test(reset), key);
  }
}

console.log(fail ? `\n${fail} FAILURES` : "\nALL PASS");
process.exit(fail ? 1 : 0);
