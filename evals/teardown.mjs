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
import { fileURLToPath, pathToFileURL } from "node:url";
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
const esbuildImport = (path) => JSON.stringify(path.replaceAll("\\", "/"));
writeFileSync(
  ENTRY,
  `export { isGameSession } from ${esbuildImport(join(ROOT, "src/state/game"))};
export { safeUser, mergeStates } from ${esbuildImport(join(ROOT, "src/state/merge"))};
export { newGame, play } from ${esbuildImport(join(ROOT, "src/engine/chess"))};
`,
);
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
  { stdio: "inherit", cwd: ROOT },
);
const { isGameSession, safeUser, mergeStates, newGame, play } = await import(
  pathToFileURL(BUNDLE).href
);

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

// ══ #5 — THE CLASS: EVERY AppState field decides its teardown fate ════════
//
// Not "is recentMoment wiped". A field added to AppState next month fails this
// until someone writes down what happens to it when the relationship is
// deleted. Exemptions are allowed and are the point — each one is a decision
// on the record, not an omission nobody noticed.
//
// ── WHY THIS WALKER WAS REWRITTEN (the final audit's C1) ─────────────────
//
// The first version enumerated `^ {2}(\w+)\?:` — AppState's OPTIONAL keys. It
// caught the four fields that had slipped, and then it structurally could not
// see the fifth, because the fifth was not optional:
//
//   user: UserProfile;
//
// `user` is the fact table — name, city, job, what she has worked out about
// him — and "make her forget you" left it standing. She started over "not
// knowing you" with `lives in: pune` still in her prompt. The check that
// existed to end this class had a hole shaped exactly like the worst instance
// of it, and the hole was one character wide: the `?`.
//
// So the walker enumerates EVERY key of AppState now, required and optional
// together, and every one of them must appear in FATE below with a verdict.
// The generalisable rule, and it is the same one `dead-writers` states from
// the other side: a coverage check is only as wide as the thing it ENUMERATES,
// and enumerating a subset is how a gate reports full coverage of a part.
//
// ── the three verdicts ───────────────────────────────────────────────────
//
//   "clear+forget"  the conversation's own state. Both doors wipe it.
//   "forget-only"   relational memory that clear-chat's own dialog PROMISES
//                   not to touch ("her memory of you is not touched"), so
//                   only the stronger door may take it.
//   "exempt: …"     a device or account fact that is not the relationship.
//                   The reason is the check.
const FATE = {
  // ── the conversation. Both doors. ──
  messages: "clear+forget",
  followup: "clear+forget", // an armed "back in 20 min" belongs to a chat that no longer exists
  herLife: "clear+forget", // her improvised life was improvised AT him
  // WS-HERNOW, and `activity-forgot-the-teardown` for the fourth time: her
  // present moment is one row with a started-at in it, and a survivor would
  // open the conversation that begins by not knowing him with "twenty minutes
  // into a book" — a duration she started living in a relationship that has
  // just been deleted. It is deterministic (engine/herNow.ts), so wiping it
  // costs nothing: the next read rebuilds one from the clock.
  herNow: "clear+forget",
  inner: "clear+forget", // a feeling whose cause was deleted is a causeless mood
  clearedAt: "clear+forget", // written, not cleared: the synced tombstone IS the teardown
  game: "clear+forget", // `activity-forgot-the-teardown`: resuming a match you were forgotten over
  // the same rule one level up: the LEDGER of finished games is "we played
  // chess on 22 aug, you left it on move 6" said to someone she has just been
  // told she has never met — and it feeds activityVocab, so a surviving ledger
  // would make her invented shared history SUPPORTED by the gate built to
  // catch it, exactly as `recentMoment` did
  activities: "clear+forget",
  callback: "clear+forget", // "she calls you back" out of a wiped relationship is causeless
  tally: "clear+forget", // "12 games, she's ahead 7-5" over a record that starts today
  momentsFired: "clear+forget", // a dead ledger means a new relationship can never fire its first game
  recentMoment: "clear+forget", // her first sentences to a stranger, about their hundred days
  declinedRing: "clear+forget", // the moment a her-ring was declined; a moment, not memory, but a fresh one must not survive either door and re-fire a line at a stranger
  // WS-SHARENOW's local share mirror. Same rule, fifth instance: "you were
  // watching their screen together till 3 min ago, and here is what you said
  // about it" is a shared minute recited to somebody she has just been told she
  // has never met — and it is the block that sits FIRST in the brief, ahead of
  // everything else, so a surviving mirror would be the first thing she says.
  shares: "clear+forget",

  // ── relational memory, forget only ──
  // C1, the final audit's one ship-blocker. Clear-chat leaves the profile
  // standing BY PROMISE; forget-everything cannot, because everything she has
  // worked out about your life includes who you are.
  user: "forget-only",

  // ── not the relationship ──
  onboarded:
    "exempt: whether this device has ever been set up. Forgetting is not " +
    "uninstalling, and re-running onboarding would ask his name back in the " +
    "same second she was told to lose it.",
  deviceId:
    "exempt: the anonymous identity the forget REQUEST is addressed to. " +
    "Rotating it here would orphan the very server rows the parked commit is " +
    "about to delete. Sign-out is the door that rotates it, and does.",
  auth:
    "exempt: the account, not the relationship. A forget that signed you out " +
    "would also cut the only route back to the server copy — and signing out " +
    "is already its own button, with its own wipe.",
  lastAccountId:
    "exempt: the ownership guard itself. Clearing it is how the NEXT account " +
    "on this browser inherits this one's state — the exact bleed the field " +
    "exists to prevent.",
  theme:
    "exempt: a device preference and nothing else (decisions: theme does not " +
    "even sync between a person's own devices). Wiping it would flash a " +
    "dark-mode user white as a side effect of forgetting.",
  soundOn:
    "exempt: a device preference and nothing else, exactly like `theme` " +
    "above and for the same reason. Wiping it would turn the sound layer " +
    "back ON for someone who had switched it off, as an invisible side " +
    "effect of asking her to forget them, in whatever room they happened to " +
    "be standing in. A forget is about what she knows, never about what the " +
    "phone does.",
  notifyPrefs:
    "exempt: the OS permission's memory, not the relationship — and the " +
    "exemption is the PROMISE rather than a convenience. The sheet that asks " +
    "for notifications says 'We will not ask again', and `declined` is the " +
    "only thing that makes that true; a teardown that wiped it would re-arm " +
    "the ask, so 'make her forget you' would be answered by the app asking " +
    "him for something. `asked` is worse to lose: Android 13+ grants exactly " +
    "one runtime prompt per install, so a wiped record is a product that " +
    "believes it still has an ask it has already spent. THE TOKEN IS NOT " +
    "HERE — reachability is torn down by src/notify/index.ts's " +
    "clearReachability, asserted in the REACHABILITY block below, because a " +
    "push token in synced AppState would be another device's reachability.",
  memoryConsent:
    "exempt: the answer to the DPDP memory question (task #148), and the " +
    "exemption is the PROMISE rather than a convenience — the same shape as " +
    "`notifyPrefs` above and for a sharper reason. `memoryWritesAllowed` " +
    "treats an ABSENT record as permission (an install that predates the " +
    "question was never asked, and the answer to never-asked is to ask), so " +
    "a teardown that wiped this field would silently switch memory back ON " +
    "for the one person who had just switched it off — and the door that " +
    "withdraws consent is the forget door itself, so the wipe would undo the " +
    "withdrawal it was carrying out. It is also not the relationship: it is " +
    "a standing instruction about what may be stored NEXT, which outlives " +
    "the conversation being deleted by design. The server half of the record " +
    "is deleted by the whole wipe (meera_consent, evals/recall/run.mjs's " +
    "FATE table), because that half is a record OF a person; this half is an " +
    "instruction FROM one.",
  lastSeen:
    "exempt: HER presence clock, restamped on every mount and rendered as " +
    "'last seen 2m ago'. A fact about this app session, not a memory of him.",
  openrouterKey: "exempt: his own API credential — configuration, not memory.",
  openrouterModel: "exempt: which brain he pays for. Wiping it silences her.",
  apiKey: "exempt: his own API credential — configuration, not memory.",
  elevenKey: "exempt: his own API credential — configuration, not memory.",
  elevenVoiceId: "exempt: which voice is hers. Forgetting him is not becoming someone else.",
  sarvamKey: "exempt: his own API credential — configuration, not memory.",
  deviceVoice: "exempt: the on-device TTS fallback this phone offers. A device capability.",
};
{
  // ── every key of AppState, required and optional ────────────────────────
  const store = src("src/state/store.ts");
  const body = store.slice(store.indexOf("export interface AppState {"));
  const iface = body.slice(0, body.indexOf("\n}"));
  // `\??:` is the whole point — the old walker's `\?:` is what made `user`
  // invisible. Two-space indent keeps it to the interface's own members and
  // out of the inline object types nested inside them (tally's counters).
  const fields = [...iface.matchAll(/^ {2}([A-Za-z0-9_]+)\??:/gm)].map((m) => m[1]);
  const optional = new Set([...iface.matchAll(/^ {2}([A-Za-z0-9_]+)\?:/gm)].map((m) => m[1]));
  ok("AppState's keys were parsed", fields.length >= 20, `${fields.length}: ${fields.join(", ")}`);
  ok(
    "and BOTH required and optional keys came back",
    fields.some((f) => !optional.has(f)) && optional.size > 0,
    `${fields.length - optional.size} required, ${optional.size} optional`,
  );
  ok(
    "the required half includes `user` — the key the old walker could not see",
    fields.includes("user") && !optional.has("user"),
  );

  // ── the teardown, parsed as two branches rather than one blob ───────────
  //
  // A line-anchored `^\s+key:` cannot tell an always-applied assignment from
  // one inside `...(mode === "forget" ? { … } : {})`, and the difference is
  // the entire clear-vs-forget contract. This walks braces instead.
  const chat = src("src/components/Chat.tsx");
  /** the body between the first `{` at/after `from` and its matching `}` */
  const objectAfter = (text, from) => {
    const open = text.indexOf("{", from);
    if (open < 0) return "";
    let depth = 0;
    let str = null;
    for (let i = open; i < text.length; i++) {
      const c = text[i];
      if (str) {
        if (c === "\\") i++;
        else if (c === str) str = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { str = c; continue; }
      if (c === "/" && text[i + 1] === "/") { i = text.indexOf("\n", i); continue; }
      if (c === "/" && text[i + 1] === "*") { i = text.indexOf("*/", i) + 1; continue; }
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) return text.slice(open + 1, i); }
    }
    return "";
  };
  /** the keys assigned at the TOP level of an object body — nested objects,
   *  ternaries inside parens and string contents are all invisible to it */
  const topLevelKeys = (obj) => {
    const keys = new Set();
    let depth = 0;
    let str = null;
    for (let i = 0; i < obj.length; i++) {
      const c = obj[i];
      if (str) {
        if (c === "\\") i++;
        else if (c === str) str = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { str = c; continue; }
      if (c === "/" && obj[i + 1] === "/") { i = obj.indexOf("\n", i); continue; }
      if (c === "/" && obj[i + 1] === "*") { i = obj.indexOf("*/", i) + 1; continue; }
      if (c === "{" || c === "[" || c === "(") { depth++; continue; }
      if (c === "}" || c === "]" || c === ")") { depth--; continue; }
      if (depth === 0 && c === ":") {
        let j = i - 1;
        while (j >= 0 && /\s/.test(obj[j])) j--;
        const end = j;
        while (j >= 0 && /[A-Za-z0-9_$]/.test(obj[j])) j--;
        const id = obj.slice(j + 1, end + 1);
        if (id) keys.add(id);
      }
    }
    return keys;
  };

  const fnAt = chat.indexOf("function tearDownLocally");
  ok("tearDownLocally was found", fnAt > 0);
  const fn = chat.slice(fnAt);
  const updater = objectAfter(fn, fn.indexOf("setState((s) => ({"));
  const always = topLevelKeys(updater);
  // the forget-only object: `...(mode === "forget" ? { … } : {})`
  const modeAt = updater.indexOf('mode === "forget"');
  ok(
    "the teardown branches on the forget mode at all",
    modeAt > 0,
    "tearDownLocally applies one identical wipe to both doors — then either " +
      "clear-chat is breaking its own promise, or forget-me is not a superset " +
      "of it. C1 was the second of those.",
  );
  const forgetOnly = modeAt > 0 ? topLevelKeys(objectAfter(updater, updater.indexOf("?", modeAt))) : new Set();
  const wiped = new Set([...always, ...forgetOnly]);
  ok("the teardown updater was parsed", always.size >= 8, [...always].join(", "));
  ok("the forget-only branch was parsed", forgetOnly.size >= 1, [...forgetOnly].join(", "));

  // ── C1, asserted by name and not only by table ──────────────────────────
  // This one line is what fails on the pre-fix tree: `user` was absent from
  // the forget branch (there was no forget branch), so she "forgot" him with
  // his name, his city and his job still in her prompt.
  ok(
    "FORGET wipes `user` — the profile goes with the memory (C1)",
    forgetOnly.has("user"),
    "tearDownLocally's forget branch does not assign `user`. 'Make her forget " +
      "you' leaves AppState.user standing, so the fresh conversation opens " +
      "with her knowing his name, his city and every fact she extracted.",
  );
  ok(
    "…and CLEAR does not, because its own dialog promises it will not",
    !always.has("user"),
    "clear-chat is wiping the profile too. Its dialog says 'her memory of you " +
      "is not touched'; either the copy or the code is lying.",
  );
  ok("the snapshot carries the profile on the forget path", /mode === "forget" \? \{ user: state\.user \}/.test(fn.slice(0, fn.indexOf("setState"))));

  // ── every key, against the table ────────────────────────────────────────
  for (const key of fields) {
    const verdict = FATE[key];
    ok(
      `AppState.${key} has a written teardown fate`,
      typeof verdict === "string",
      `AppState.${key} is not in evals/teardown.mjs's FATE table. Decide, in ` +
        `writing: does it belong to the relationship being deleted? ` +
        `"clear+forget" if both doors take it, "forget-only" if clear-chat's ` +
        `dialog promises to keep it, or "exempt: <reason>" if it is a device ` +
        `or account fact. A field with no verdict is a field nobody decided.`,
    );
    if (typeof verdict !== "string") continue;
    if (verdict === "clear+forget") {
      ok(`AppState.${key} is wiped by BOTH doors, as declared`, always.has(key));
    } else if (verdict === "forget-only") {
      ok(`AppState.${key} is wiped by forget only, as declared`, forgetOnly.has(key) && !always.has(key),
        `always=${always.has(key)} forget=${forgetOnly.has(key)}`);
    } else {
      ok(
        `AppState.${key} is exempt and the teardown leaves it alone`,
        !wiped.has(key),
        `${key} is exempted in writing ("${verdict.slice(0, 60)}…") and wiped anyway — ` +
          `one of the two is wrong.`,
      );
    }
  }
  // a verdict for a field that no longer exists is a stale decision
  for (const key of Object.keys(FATE)) {
    ok(`the verdict for '${key}' still names a real AppState field`, fields.includes(key));
  }
  // and nothing the teardown wipes may be absent from the table entirely
  for (const key of wiped) {
    ok(`the teardown wipes nothing undeclared ('${key}')`, key in FATE);
  }
  // the fields that each started a round of this
  ok("recentMoment is wiped by the teardown", always.has("recentMoment"));
  ok("game is wiped by the teardown", always.has("game"));

  // ── the round trip: whatever the teardown wipes, undo must put back ──────
  const snapType = chat.slice(chat.indexOf("type Snapshot ="), chat.indexOf("type Snapshot =") + 700);
  const undo = chat.slice(chat.indexOf("function undoClear"));
  const restored = objectAfter(undo, undo.indexOf("setState((s) => ({"));
  for (const key of always) {
    if (key === "clearedAt" || key === "messages") continue; // tombstone + list: same names, checked below
    ok(`undo restores '${key}'`, restored.includes(`${key}: snap.${key}`));
    ok(`Snapshot carries '${key}'`, snapType.includes(`"${key}"`));
  }
  ok("undo restores the transcript", restored.includes("messages: snap.messages"));
  ok("undo restores the tombstone", restored.includes("clearedAt: snap.clearedAt"));
  // the forget-only fields come back CONDITIONALLY, or undoing a clear-chat
  // would hand back a profile that clear-chat never took
  for (const key of forgetOnly) {
    ok(`undo restores '${key}' only when the snapshot holds it`,
      new RegExp(`snap\\.${key} \\? \\{ ${key}: snap\\.${key} \\}`).test(restored), restored.slice(-200));
    ok(`Snapshot carries '${key}' as optional`,
      new RegExp(`Partial<Pick<AppState, ("|')${key}\\1>>`).test(snapType), snapType);
  }

  // ── the sibling boundary: an account switch is a teardown too ────────────
  // Same class, different door. Everything either door treats as relational
  // must be reset when the browser changes hands, or it bleeds across accounts.
  const app = src("src/App.tsx");
  const branch = app.slice(app.indexOf("lastAccountId && s.lastAccountId !== fresh.userId"));
  const reset = branch.slice(0, branch.indexOf("};"));
  for (const key of wiped) {
    if (key === "messages") continue;
    ok(`account switch also resets '${key}'`, new RegExp(`\\b${key}:`).test(reset), key);
  }
}

// ══ #6 — REACHABILITY: the state the FATE table structurally cannot see ═══
//
// The FATE walker above enumerates `AppState`'s keys, so it is exactly as wide
// as `AppState` — which is the rewrite note's own rule ("a coverage check is
// only as wide as the thing it ENUMERATES") pointed at itself. A push token and
// a pending notification are relationship state that deliberately does NOT live
// in `AppState`:
//
//   * a token is per-device and `AppState` merges across devices, so a token in
//     it would arrive on the OTHER phone and the wrong device would be the one
//     told to stop being reachable;
//   * a pending notification lives in the OS, which `AppState` cannot describe
//     at all. A field mirroring it would read as coverage and be checked by
//     nothing (`manifest-sourcestatus`).
//
// So they get their own verdicts here, in the same written-decision form, and
// the checks below are what make those verdicts binding. WHY THEY MATTER: a
// notification still on a lock screen quoting a conversation he has just
// erased is that conversation surviving its own deletion in the most visible
// place it could, and a push token that outlives "make her forget you" is her
// able to contact someone she has been told she never met.
const REACHABILITY_FATE = {
  "local notifications (pending + delivered)":
    "clear+forget: `cancelAll()` in src/notify/index.ts's clearReachability. " +
    "Both doors, clear-chat included — a lock screen quoting a chat he just " +
    "erased is the erased chat, still on screen.",
  "push token (server row)":
    "clear+forget: `revokePushToken` DELETES the row, never flags it. A " +
    "flagged-inactive token is still a token.",
  "push token (browser subscription)":
    "clear+forget: the local unsubscribe runs even when the server call " +
    "fails, because a browser with no subscription cannot receive a push no " +
    "matter what row survives.",
  "the permission's memory (AppState.notifyPrefs)":
    "exempt: see the FATE table. Wiping it would break the 'we will not ask " +
    "again' promise and burn an Android 13+ prompt the app has already spent.",
};
{
  const notify = src("src/notify/index.ts");
  const app = src("src/App.tsx");
  const store = src("src/state/store.ts");

  ok(
    "every reachability artefact has a written verdict",
    Object.keys(REACHABILITY_FATE).length === 4,
    Object.keys(REACHABILITY_FATE).join(", "),
  );

  // ── the hand exists, and takes both halves ──
  ok("clearReachability exists", /export async function clearReachability/.test(notify));
  const fn = notify.slice(notify.indexOf("export async function clearReachability"));
  ok("…and cancels every local notification", /cancelAll\(\)/.test(fn));
  ok("…and revokes the push token", /revokePushToken\(/.test(fn));
  const push = src("src/notify/push.ts");
  const revoke = push.slice(push.indexOf("export async function revokePushToken"));
  ok("the revoke DELETES the server row", /revoke: true/.test(revoke));
  ok("…and unsubscribes locally even if that call fails", /unsubscribe\(\)/.test(revoke));
  ok(
    "…with the local unsubscribe OUTSIDE the network try",
    revoke.indexOf("unsubscribe()") > revoke.indexOf("the half that always works"),
    "a network failure must not be able to leave a live subscription behind.",
  );

  // ── and it is CALLED on every door ──
  //
  // Both doors stamp `clearedAt` (Chat.tsx's tearDownLocally), so one observer
  // in App.tsx covers clear-chat and forget-me without this workstream
  // becoming a second writer for another's state.
  ok(
    "App.tsx tears down reachability when the teardown stamp advances",
    /clearedSeen/.test(app) && /clearReachability\(NOTIFY_API_BASE, state\.deviceId\)/.test(app),
    "neither door clears reachability; a lock screen outlives the wipe.",
  );
  const clearedEffect = app.slice(app.indexOf("const clearedSeen"));
  ok(
    "…on the ADVANCE, not on every render",
    /at <= clearedSeen\.current/.test(clearedEffect.slice(0, 800)),
  );
  ok(
    "account switch tears down reachability too",
    /state\.lastAccountId !== fresh\.userId[\s\S]{0,200}clearReachability/.test(app),
    "the sibling boundary above says everything relational resets on a switch; " +
      "reachability is relational and a token is per-device.",
  );
  ok(
    "…and does it OUTSIDE the setState updater",
    app.indexOf("clearReachability(NOTIFY_API_BASE, state.deviceId);\n      }\n      setState") > 0 ||
      /if \(state\.lastAccountId && state\.lastAccountId !== fresh\.userId\) \{\s*void clearReachability[^}]*\}\s*setState/.test(app),
    "an updater must stay pure (React may call one twice); a second revoke is " +
      "a second network call for a token that is already gone.",
  );
  ok(
    "sign-out revokes BEFORE the device id rotates",
    app.indexOf("clearReachability(NOTIFY_API_BASE, state.deviceId)") <
      app.indexOf("deviceId: rotateDeviceId()"),
    "a rotation first orphans this device's registration under the old id — a " +
      "live token nothing can ever revoke again.",
  );

  // ── the token must NEVER become AppState ──
  const iface = store.slice(store.indexOf("export interface AppState {"));
  const body = iface.slice(0, iface.indexOf("\n}"));
  ok(
    "no token-shaped field entered AppState",
    !/\b(pushToken|fcmToken|notifyToken|pushSubscription)\b/.test(body),
    "AppState merges across devices. A token in it is the other phone's " +
      "reachability, and the wrong device would be the one revoked.",
  );
  ok(
    "notifyPrefs does not sync",
    !/notifyPrefs/.test(src("src/state/merge.ts")),
    "a permission is a property of a phone; 'he said no on the laptop' " +
      "arriving on a phone that never asked is the app answering for him.",
  );
}

// ══ #6b — THE COMPOSER'S DRAFT: state the FATE table cannot see either ════
//
// Same reachability gap as the block above, arrived at from the other side.
// WS-COMPOSER's four pieces of attachment state live in `Chat.tsx` as component
// state and one ref — deliberately, because a half-written message is not
// something to sync to another device and a 2 MB PDF is not something to put in
// `saveState`'s ladder (see `Message.docs` in store.ts for that argument). The
// cost of keeping them out of `AppState` is that the walker at §5 enumerates
// `AppState` and therefore cannot see any of them, so a teardown that missed
// one would pass every check in this file.
//
// It is the same class the rewrite note describes: a coverage check is only as
// wide as the thing it ENUMERATES. So the four get written verdicts here, and
// the assertions below are what make the verdicts binding.
//
// WHY EACH ONE MATTERS, since "a draft is only a draft" is the reasoning that
// would skip this:
//
//   * `docHold` is the worst of the four and the reason the block exists. It
//     holds the TEXT of a document, it is a ref so no re-render disturbs it,
//     and nothing reads the epoch when taking it — so a survivor would be
//     handed to the very first reply of the conversation that begins by not
//     knowing him. The epoch bump stops the in-flight PASS; it does not empty
//     the box.
//   * staged pictures and documents are attached to a conversation. Surviving
//     into the next one means the first thing he sees after erasing everything
//     is the photo he had picked to send to the person who is gone.
//   * the viewer is a full-screen surface over the thread. Left open across a
//     wipe it is the wiped thread, still on screen, which is exactly what §6
//     says about a notification.
//
// BOTH DOORS, and the asymmetry at §5 does not apply here. Clear-chat's promise
// is narrow and specific — "her memory of you is not touched" — and it is about
// what SHE knows. It says nothing about his own half-written message, and there
// is no reading of it under which a draft is her memory. So the verdict is
// `clear+forget` for all four, with no `forget-only` among them.
//
// NOT RESTORED BY UNDO, and that is the deliberate half. `tearDownLocally`
// returns a Snapshot the undo toast puts back, and the four are absent from it
// — like `replyTo` and `replySel`, which are the draft state that was already
// there and already worked this way. Undo restores the CONVERSATION; it does
// not reconstruct what he happened to be composing at the moment he erased it.
// A dropped `docHold` cannot be restored anyway (the bytes are gone), and an
// undo that put back three of four pieces would be worse than one that puts
// back none.
const COMPOSER_DRAFT_FATE = {
  "staged photos (attachments)":
    "clear+forget: a picture staged for a conversation belongs to that " +
    "conversation. Both doors, because clear-chat's promise is about her " +
    "memory of him and never about his own draft.",
  "staged documents (docs)":
    "clear+forget: same rule, and the tray is the only thing holding them — " +
    "nothing has uploaded them, so a wipe is the whole of their disposal.",
  "parked document payload (docHold)":
    "clear+forget: holds document TEXT for the next reply pass. A survivor " +
    "is handed to the first reply of the conversation that has just been told " +
    "it never met him. The epoch bump stops the in-flight pass, not the box.",
  "the open photo viewer":
    "clear+forget: a full-screen surface over the thread. Left open across a " +
    "wipe it is the wiped thread, still on screen.",
};
{
  const chat = src("src/components/Chat.tsx");

  ok(
    "every composer draft artefact has a written verdict",
    Object.keys(COMPOSER_DRAFT_FATE).length === 4,
    Object.keys(COMPOSER_DRAFT_FATE).join(", "),
  );
  ok(
    "…and all four are clear+forget (a draft is never relational memory)",
    Object.values(COMPOSER_DRAFT_FATE).every((v) => v.startsWith("clear+forget:")),
  );

  // ── the teardown is ONE function and both doors go through it ──
  ok("tearDownLocally exists", /function tearDownLocally\(/.test(chat));
  const td = chat.slice(chat.indexOf("function tearDownLocally("));
  const bodyEnd = td.indexOf("\n  }\n");
  const teardown = td.slice(0, bodyEnd > 0 ? bodyEnd : 6000);

  // ── each of the four is actually wiped, in that function ──
  ok(
    "teardown clears the staged photos",
    /setAttachments\(\[\]\)/.test(teardown),
    "a photo picked for a deleted conversation survives into the next one.",
  );
  ok(
    "teardown clears the staged documents",
    /setDocs\(\[\]\)/.test(teardown),
    "nothing else holds them; the tray is their whole existence.",
  );
  ok(
    "teardown empties the parked document payload",
    /docHold\.current = null/.test(teardown),
    "THE ONE THAT CARRIES TEXT. A survivor reaches the first reply of the " +
      "conversation that begins by not knowing him.",
  );
  ok(
    "teardown closes the photo viewer",
    /setViewer\(null\)/.test(teardown),
    "a full-screen surface over a thread that no longer exists.",
  );
  ok(
    "teardown closes the source sheet",
    /setSourceOpen\(false\)/.test(teardown),
    "a sheet asking where to attach something, over a wiped conversation.",
  );

  // ── both doors, not just one ──
  ok(
    "clear-chat goes through tearDownLocally",
    /park\("Chat cleared", tearDownLocally\(\)\)/.test(chat),
  );
  ok(
    "forget-everything goes through the same function",
    /tearDownLocally\("forget"\)/.test(chat),
    "a second teardown path is a second place for a field to be missed — the " +
      "exact shape of every finding at §5.",
  );

  // ── and the draft is NOT in the Snapshot undo restores ──
  const snap = teardown.slice(teardown.indexOf("const snapshot = {"));
  const snapBody = snap.slice(0, snap.indexOf("\n    };"));
  ok(
    "the undo Snapshot carries no composer draft",
    !/attachments|docHold|\bdocs\b|viewer/.test(snapBody),
    "undo restores the conversation, not what he was composing. Half a " +
      "restored draft (the bytes in docHold are gone) is worse than none.",
  );

  // ── the bytes must NEVER become AppState ──
  const iface2 = src("src/state/store.ts").slice(
    src("src/state/store.ts").indexOf("export interface AppState {"),
  );
  ok(
    "no attachment-shaped field entered AppState",
    !/\b(attachments|docHold|stagedDocs|draftPhotos)\b/.test(
      iface2.slice(0, iface2.indexOf("\n}")),
    ),
    "AppState syncs and persists. A staged 2 MB PDF in it is saveState's " +
      "degradation ladder fired by one attachment, with no upload to replace it.",
  );
  ok(
    "Message.docs is metadata only, never bytes",
    !/docs\?: Array<\{[^}]*\b(data|text|b64|dataUrl)\b/.test(src("src/state/store.ts")),
    "the stored row is name/mime/size. Bytes there would sit in localStorage " +
      "for the life of the install.",
  );
}

console.log(fail ? `\n${fail} FAILURES` : "\nALL PASS");
process.exit(fail ? 1 : 0);
