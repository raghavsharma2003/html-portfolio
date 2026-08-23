// Would-you-rather: the deck, her deterministic pick, and the activity
// adapter (src/engine/wyr/*, src/engine/wyrTalk.ts). Standalone:
//
//   node evals/wyr.mjs
//
// Bundles the REAL TypeScript on every run rather than importing a frozen
// copy, for the reason CLAUDE.md gives about parsetest.v2: a bundle that
// does not rebuild passes forever while the source rots. Not wired into
// `evals/run.mjs` — this workstream does not own that file (file ownership;
// see `evals/chess.mjs`'s identical note) — so it is standalone until the
// coordinator adds one line to that suite map.
//
// ── the weighting ─────────────────────────────────────────────────────────
// Two things matter more than the rest put together, for the same reason
// `evals/activity.mjs` weights them heaviest for chess:
//   1. NO LINE SHE COULD SAY reaches a fact. `recited-prompt` is the most
//      expensive law in this repo, and this is the one deck in it that is
//      hand-written prose shipping verbatim to a screen with no generation
//      step — so a banned-topic screen has to run over the prose itself, not
//      over model output, which is why section 1 is a grep over 80 cards.
//   2. HER PICK IS DETERMINISTIC. It is never a model call and never
//      `Math.random` — section 2 proves the same (card, salt) always yields
//      the same letter, forever, which is what makes "she picked coffee on
//      this one" safe to become a fact he remembers about her.

import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const OUT = mkdtempSync(join(tmpdir(), "wyreval-"));
const ENTRY = join(OUT, "entry.ts");
writeFileSync(
  ENTRY,
  [
    `export * from ${JSON.stringify(join(REPO, "src/engine/wyr/deck"))};`,
    `export * from ${JSON.stringify(join(REPO, "src/engine/wyr/pick"))};`,
    `export * from ${JSON.stringify(join(REPO, "src/engine/wyr/session"))};`,
    `export * from ${JSON.stringify(join(REPO, "src/engine/wyrTalk"))};`,
    "",
  ].join("\n"),
);
const BUNDLE = join(OUT, "wyr.bundle.mjs");
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
  { cwd: REPO, stdio: "inherit" },
);
const M = await import(pathToFileURL(BUNDLE).href);
const {
  DECK,
  MAX_OPTION_LEN,
  MAX_SHORT_LEN,
  MAX_SHORT_WORDS,
  cardById,
  herPick,
  herPickDelayMs,
  nextCardId,
  freshSession,
  currentCardId,
  isAnswered,
  answerCurrent,
  advance,
  tally,
  isEmpty,
  wyrActivity,
  wyrPickFact,
  wyrRecord,
  RECORD_ROUNDS,
} = M;

let fail = 0;
let count = 0;
const ok = (name, cond, extra = "") => {
  count++;
  if (!cond) {
    fail++;
    console.log(`FAIL ${name}${extra ? " — " + extra : ""}`);
  }
};

const words = (s) => s.trim().split(/\s+/).filter(Boolean);
const sentenceShaped = (s) => /^[A-Z][^.?!]*[.?!]$/.test(s);
const firstPerson = /^(i\b|i'm\b|i've\b|main\b|mai\b|mujhe\b|meri\b|mera\b|maine\b)/i;

// ═══ 1. deck lint ═══════════════════════════════════════════════════════

ok("deck has a real number of cards", DECK.length >= 60, String(DECK.length));

const seenIds = new Set();
for (const c of DECK) {
  ok(`id nonempty: ${c.id}`, typeof c.id === "string" && c.id.trim().length > 0);
  ok(`id unique: ${c.id}`, !seenIds.has(c.id));
  seenIds.add(c.id);

  ok(`a nonempty [${c.id}]`, typeof c.a === "string" && c.a.trim().length > 0);
  ok(`b nonempty [${c.id}]`, typeof c.b === "string" && c.b.trim().length > 0);
  ok(`aShort nonempty [${c.id}]`, typeof c.aShort === "string" && c.aShort.trim().length > 0);
  ok(`bShort nonempty [${c.id}]`, typeof c.bShort === "string" && c.bShort.trim().length > 0);
  ok(`a !== b [${c.id}]`, c.a !== c.b);
  ok(`aShort !== bShort [${c.id}]`, c.aShort !== c.bShort);

  ok(`a within length cap [${c.id}]`, c.a.length <= MAX_OPTION_LEN, String(c.a.length));
  ok(`b within length cap [${c.id}]`, c.b.length <= MAX_OPTION_LEN, String(c.b.length));
  ok(`aShort within length cap [${c.id}]`, c.aShort.length <= MAX_SHORT_LEN, c.aShort);
  ok(`bShort within length cap [${c.id}]`, c.bShort.length <= MAX_SHORT_LEN, c.bShort);
  ok(`aShort word count [${c.id}]`, words(c.aShort).length <= MAX_SHORT_WORDS, c.aShort);
  ok(`bShort word count [${c.id}]`, words(c.bShort).length <= MAX_SHORT_WORDS, c.bShort);

  ok(
    `tier is valid [${c.id}]`,
    ["everyday", "absurd", "food", "relationships", "deep"].includes(c.tier),
    String(c.tier),
  );
  ok(
    `spice is valid or absent [${c.id}]`,
    c.spice === undefined || c.spice === "mild" || c.spice === "bold",
    String(c.spice),
  );
}

// Every tier the spec asked for is actually represented, not just declared
// as a type. A deck that only ever wrote "everyday" cards would still type-
// check.
for (const t of ["everyday", "absurd", "food", "relationships", "deep"]) {
  ok(`tier "${t}" has cards`, DECK.some((c) => c.tier === t));
}

// Banned-topic grep, over every string a card exposes. This repo guards
// crisis content seriously (CLAUDE.md) and this feature has no business
// anywhere near it — no sexual content, no self-harm adjacency, nothing that
// would cross an age gate.
const BANNED = [
  "sex",
  "sexual",
  "nude",
  "naked",
  "porn",
  "orgasm",
  "masturbat",
  "genital",
  "rape",
  "molest",
  "incest",
  "pedo",
  "suicide",
  "self-harm",
  "self harm",
  "kill yourself",
  "kys",
  "cutting",
  "overdose",
  "self mutilat",
  "hang myself",
  "end my life",
  "want to die",
];
for (const c of DECK) {
  const hay = `${c.a} ${c.b} ${c.aShort} ${c.bShort}`.toLowerCase();
  for (const term of BANNED) {
    ok(`no banned term "${term}" in ${c.id}`, !hay.includes(term));
  }
}

// ═══ 2. her pick — deterministic, never a model call, never Math.random ═══

const SALT_A = "relationship-salt-a";
const SALT_B = "relationship-salt-b";
const sample = DECK[7];

ok(
  "same (card, salt) → same pick, called twice",
  herPick(sample.id, SALT_A) === herPick(sample.id, SALT_A),
);
ok(
  "same (card, salt) → same pick, a fresh call later",
  herPick(sample.id, SALT_A) === herPick(sample.id, SALT_A),
);

// Different salts vary — not a constant disguised as a function. Checked
// across every card rather than one, so a single lucky coincidence can't
// pass this.
let differed = 0;
for (const c of DECK) if (herPick(c.id, SALT_A) !== herPick(c.id, SALT_B)) differed++;
ok(
  "different salts vary the pick across the deck",
  differed > DECK.length * 0.2 && differed < DECK.length * 0.8,
  `${differed}/${DECK.length}`,
);

// Roughly a coin flip, not a biased hash — a pick that always landed "a"
// would be deterministic and useless.
let aCount = 0;
for (const c of DECK) if (herPick(c.id, SALT_A) === "a") aCount++;
ok(
  "her pick is not lopsided across the deck",
  aCount > DECK.length * 0.25 && aCount < DECK.length * 0.75,
  `${aCount}/${DECK.length} picked "a"`,
);

// The delay: deterministic, in the spec's 300–800ms band.
for (const c of DECK.slice(0, 10)) {
  const d1 = herPickDelayMs(c.id, SALT_A);
  const d2 = herPickDelayMs(c.id, SALT_A);
  ok(`delay deterministic [${c.id}]`, d1 === d2, `${d1} vs ${d2}`);
  ok(`delay in band [${c.id}]`, d1 >= 300 && d1 <= 800, String(d1));
}

// nextCardId: pure, stable for a fixed (seen, salt), and does not repeat
// within one full lap of the deck.
const deckIds = DECK.map((c) => c.id);
{
  const seen = [deckIds[0], deckIds[1]];
  ok(
    "nextCardId is pure — same (seen, salt) twice",
    nextCardId(deckIds, seen, SALT_A) === nextCardId(deckIds, seen, SALT_A),
  );
  let lap = [];
  for (let i = 0; i < deckIds.length; i++) {
    const id = nextCardId(deckIds, lap, SALT_A);
    ok(`nextCardId does not repeat within a lap (${i})`, !lap.includes(id), id);
    lap.push(id);
  }
  // Exhausted deck resets rather than throwing or returning undefined — a
  // long relationship WILL exhaust an 80-card deck.
  const afterFullLap = nextCardId(deckIds, lap, SALT_A);
  ok("deck reset after exhaustion returns a real id", deckIds.includes(afterFullLap));
}

// ═══ 3. session — the pure reducer, and the honesty allowlist ═════════════

let s = freshSession(SALT_A, 1_000);
ok("fresh session deals a card", currentCardId(s) !== null);
ok("fresh session is empty (no rounds)", isEmpty(s));
ok("fresh session is not answered", !isAnswered(s));

const firstCard = cardById(currentCardId(s));
const firstHerPick = herPick(firstCard.id, SALT_A);
s = answerCurrent(s, "a");
ok("answerCurrent records a round", isAnswered(s));
ok("answerCurrent uses the same herPick as the pure function", s.rounds[0].her === firstHerPick);
ok("answerCurrent is a no-op once already answered", answerCurrent(s, "b").rounds.length === 1);

const beforeAdvance = currentCardId(s);
s = advance(s);
ok("advance deals a new current card", currentCardId(s) !== beforeAdvance);
ok("advance keeps the answered round", s.rounds.length === 1);
ok("advance is a no-op on an unanswered card", advance(s).seen.length === s.seen.length);

// Play a few more rounds so the activity block below has real content.
for (let i = 0; i < 4; i++) {
  s = answerCurrent(s, i % 2 === 0 ? "a" : "b");
  s = advance(s);
}
ok("tally derives from rounds, not stored separately", tally(s).agreed + tally(s).clashed === s.rounds.length);

// ═══ 4. facts — shapelint, and the negative control against dialogue ═════

const act = wyrActivity(s);

ok('activity kind is "wyr"', String(act.kind) === "wyr");
ok("activity carries the session's startedAt", act.startedAt === s.startedAt);
ok("activity has facts", act.facts.length > 0);

for (const f of act.facts) {
  ok(`fact ≤14 words: "${f}"`, words(f).length <= 14, String(words(f).length));
  ok(`fact not sentence-shaped: "${f}"`, !sentenceShaped(f));
  ok(`fact not first-person: "${f}"`, !firstPerson.test(f));
}

// A card's FULL option sentence must never appear verbatim inside a fact —
// only the compressed short label may. This is the deck's own version of
// `recited-prompt`: the UI copy is allowed to be a full sentence because he
// reads it, but it must never leak into what SHE is handed to talk about.
for (const c of DECK) {
  for (const f of act.facts) {
    ok(`fact does not quote card a verbatim [${c.id}]`, !f.includes(c.a));
    ok(`fact does not quote card b verbatim [${c.id}]`, !f.includes(c.b));
  }
}

// Dialogue must never appear — the exact shape a lazy implementation would
// reach for, and exactly what she would then recite every single round.
for (const w of ["arre", "yaar", "😭", "nice one", "good pick", "same here"]) {
  const hay = act.facts.join(" ").toLowerCase();
  ok(`no dialogue in facts: "${w}"`, !hay.includes(w.toLowerCase()), hay);
}

// The honesty allowlist feed: every short label from every round played has
// to be nameable, or `honesty-provenance-allowlist` flags a round that
// really happened as invented.
for (const r of s.rounds) {
  const c = cardById(r.cardId);
  ok(`nameable carries ${c.id}'s labels`, act.nameable.includes(c.aShort) && act.nameable.includes(c.bShort));
}
ok("nameable is not empty mid-session", act.nameable.length > 0);

// Determinism — the tail block must be a pure function of the session.
ok(
  "same session twice is byte-identical",
  JSON.stringify(wyrActivity(s)) === JSON.stringify(wyrActivity(s)),
);

// Absence costs nothing — a session with no rounds still renders SOMETHING
// (the current question), but never a line of dialogue, and a closed session
// is the caller's job to filter (mirrors `state/game.ts`'s `activityOf`
// returning null on `closedAt`, which this suite cannot exercise without
// importing that file — noted, not worked around).
const emptyAct = wyrActivity(freshSession(SALT_B, 2_000));
ok("a fresh session still names its first question", emptyAct.facts.some((f) => f.startsWith("the question:")));
ok('a fresh session says "just started"', emptyAct.facts.includes("just started"));

// ═══ 5. the per-pick poke — ≤3 clauses, hard ═══════════════════════════

for (const c of DECK.slice(0, 12)) {
  for (const his of ["a", "b"]) {
    for (const her of ["a", "b"]) {
      const fact = wyrPickFact(c, his, her);
      const clauses = fact.split(", ");
      ok(`poke is ≤3 clauses [${c.id} ${his}/${her}]`, clauses.length <= 3, fact);
      ok(`poke ≤14 words [${c.id} ${his}/${her}]`, words(fact).length <= 14, fact);
      ok(`poke not sentence-shaped [${c.id} ${his}/${her}]`, !sentenceShaped(fact), fact);
      ok(`poke not first-person [${c.id} ${his}/${her}]`, !firstPerson.test(fact), fact);
      ok(
        `poke names agree/clash correctly [${c.id} ${his}/${her}]`,
        his === her ? fact.endsWith("they agree") : fact.endsWith("that's a clash"),
        fact,
      );
    }
  }
}

// ── sessions must not repeat themselves (owner: "same questions are coming") ──
{
  const s1 = freshSession("salty", 1_000_000);
  const s2 = freshSession("salty", 2_000_000);
  ok("two sessions deal different first cards (same salt, different start)",
    s1.seen[0] !== s2.seen[0], `${s1.seen[0]} vs ${s2.seen[0]}`);
  // carry-forward: a new session avoids everything the last one asked
  let a = freshSession("salty", 1_000_000);
  for (let i = 0; i < 10; i++) a = advance({ ...a, rounds: [...a.rounds, { cardId: a.seen[a.seen.length - 1], his: "a", her: "a" }] });
  const asked = [...(a.avoid ?? []), ...a.seen];
  const b = freshSession("salty", 3_000_000, asked);
  ok("fresh session avoids every asked card", !asked.includes(b.seen[0]), b.seen[0]);
  // and the pairing invariant survives the carry — the current card is answerable
  const answered = answerCurrent(b, "a");
  ok("carried avoid-list does not freeze answering", answered.rounds.length === 1);
  // her PICKS stay salt-stable across sessions — taste is a property of her
  ok("her pick for a card is session-independent",
    herPick("ev-chai-coffee", "salty") === herPick("ev-chai-coffee", "salty"));
}

// ═══ 8. the DURABLE record — which questions came up, and who chose what ══
//
// `facts` carries the card on screen and a running tally, which is right for
// the present moment and was ALL that reached her memory. So a finished
// session was remembered as "6 rounds so far; 4 agreed, 2 clashed so far" —
// two numbers with nothing under them. Asked afterwards which choices they had
// disagreed on, the first external tester got two cards that were never dealt
// ("Ye questions to aye hi nahi. Made up questions", 2026-08-23). A tally is
// not a memory of a game; the rounds are.
{
  let r = freshSession("record-salt", 1_700_000_000_000);
  for (let i = 0; i < 8; i++) {
    r = answerCurrent(r, i % 3 === 0 ? "a" : "b");
    r = advance(r);
  }
  const rec = wyrRecord(r);
  ok("the record exists once rounds have been played", rec.length > 0);
  ok("the tally is FIRST, so the budget can never cost it", /^8 rounds, \d+ agreed, \d+ clashed$/.test(rec[0]), rec[0]);
  ok("the tally agrees with the fold over rounds", rec[0] === `8 rounds, ${tally(r).agreed} agreed, ${tally(r).clashed} clashed`, rec[0]);
  const rounds = rec.slice(1);
  ok("it is bounded — a record, never a transcript", rounds.length <= RECORD_ROUNDS, `${rounds.length}`);
  ok("…and it keeps the LATEST rounds", rounds.length === Math.min(RECORD_ROUNDS, r.rounds.length));

  // every row is a QUESTION plus both picks — the thing that was missing
  for (const row of rounds) {
    ok(`a round row names its question: "${row}"`, /^on .+ or .+, /.test(row));
    ok(`…and what was chosen: "${row}"`, /(both picked .+|he picked .+, she picked .+)$/.test(row));
  }

  // the picks are the REAL ones, not a re-derivation — a record that recomputes
  // what it is recording can agree with itself while disagreeing with the game
  for (const [i, round] of r.rounds.slice(-RECORD_ROUNDS).entries()) {
    const c = cardById(round.cardId);
    const row = rounds[i];
    const label = (p) => (p === "a" ? c.aShort : c.bShort);
    ok(
      `round ${i} records the real picks [${c.id}]`,
      round.his === round.her
        ? row === `on ${c.aShort} or ${c.bShort}, both picked ${label(round.his)}`
        : row === `on ${c.aShort} or ${c.bShort}, he picked ${label(round.his)}, she picked ${label(round.her)}`,
      row,
    );
  }

  // the same shape laws the facts obey. A row here is not a line she could
  // say, and it never quotes a card's full sentence — the UI copy is a full
  // sentence because HE reads it; leaking it in here is `recited-prompt`.
  for (const row of rec) {
    ok(`record row ≤14 words: "${row}"`, words(row).length <= 14, String(words(row).length));
    ok(`record row not sentence-shaped: "${row}"`, !sentenceShaped(row));
    ok(`record row not first-person: "${row}"`, !firstPerson.test(row));
  }
  for (const c of DECK) {
    for (const row of rec) {
      ok(`record does not quote card a verbatim [${c.id}]`, !row.includes(c.a));
      ok(`record does not quote card b verbatim [${c.id}]`, !row.includes(c.b));
    }
  }

  // an untouched session has nothing durable to say, and says nothing
  ok("a session with no answered round records nothing", wyrRecord(freshSession("x", 1)).length === 0);

  // and the LIVE block is untouched: the record rides ActivityState so the
  // episode writer stays kind-agnostic, and it must cost the live prompt zero
  const a2 = wyrActivity(r);
  ok("the activity carries the record", Array.isArray(a2.record) && a2.record.length === rec.length);
  ok("…and the facts are still just the moment", a2.facts.every((f) => !rec.includes(f)), JSON.stringify(a2.facts));

  // determinism: same session, same record
  ok("same session twice is byte-identical", JSON.stringify(wyrRecord(r)) === JSON.stringify(wyrRecord(r)));
}

console.log(`\n${count} checks, ${fail} failure(s)`);
console.log(fail ? "FAIL" : "ALL PASS");
process.exit(fail ? 1 : 0);
