// WS-KNOWS — "what she remembers", the surface, as assertions.
//
// Two halves, and the second is the one that matters.
//
// The FIRST half is ordinary: the three selectors in src/state/knows.ts are
// pure functions of state, so their months, rows, caps and orderings are
// checkable offline at $0. That is why the derivation lives in state/ and not
// inside the component.
//
// The SECOND half is the part that could not be tested any other way. This
// surface has exactly two ways to fail that no amount of layout review would
// catch on a mostly-empty test account:
//
//   1. It renders a DELETE IT CANNOT PERFORM. api/memory.js's item-scope
//      cascade reaches vy_kin by `name`, vy_currency by `topic`, vy_phrase by
//      `phrase`/`gloss` and vy_pattern by `if_shape`/`then_note` — and reaches
//      vy_ritual by CITATION ONLY, and the India profile only through a whole
//      wipe. A forget button on a ritual row would confirm in words, call the
//      op, get `ok`, and delete nothing. So `forgetTerm` is asserted against
//      the real SQL in api/memory.js rather than against a belief about it: if
//      someone later teaches the cascade to match `key`, this test fails and
//      says the button may now exist.
//   2. It becomes a surveillance dashboard. docs/MEMORY-FELT.md law 4 is a
//      behavioural law about her, and the visual form of breaking it is a count
//      at the top of a section and a clock stamp on every row. Both are
//      decidable from the bytes of the component, so they are decided on the
//      bytes (`gate0-structural`, the repo's own lesson about deciding
//      structurally what a review would otherwise decide by eye).
//
// Offline, deterministic, no network, no database, $0.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CORRECT_OPENER,
  FORGET_TERM_MAX,
  KNOWS_MONTHS_MAX,
  KNOWS_MONTH_MAX,
  dayLabel,
  factsFrom,
  herSideFrom,
  knowsIsEmpty,
  monthLabel,
  ritualLabel,
  timelineFrom,
} from "./.bundle.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) {
    fail++;
    console.log(`FAIL ${name}${extra ? " — " + extra : ""}`);
  }
};

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 23, 12, 0); // 23 aug 2026
const at = (d, h = 12) => Date.UTC(2026, 7, d, h, 0);

const msg = (id, from, atMs, extra = {}) => ({ id, from, text: "hi", at: atMs, ...extra });

const STATE = {
  deviceId: "00000000-0000-4000-8000-00000000000a",
  user: { name: "Raghav", vibe: ["late-night company"], facts: {} },
  messages: [
    msg("m1", "her", at(1)),
    msg("m2", "me", at(1, 13)),
    msg("m3", "me", at(9), { kind: "photo", photoUrl: "https://x/y.jpg" }),
    msg("m4", "her", at(12), { kind: "callmark", text: "12:30" }),
    msg("m5", "me", at(21)),
  ],
  momentsFired: ["days-7", "msgs-3"],
  activities: [
    { kind: "chess", startedAt: at(20, 9), closedAt: at(20, 10), summary: "chess: she resigned on move 31" },
  ],
  herLife: [
    { text: "her flatmate is sneha", at: at(4), kind: "fact" },
    { text: "khana bana rahi hu", at: at(19), kind: "activity" },
    { text: "she hates karela", at: at(18) }, // no kind: legacy row, reads as fact
  ],
  tally: null,
};

const BUNDLE = {
  homeRegion: "Indore",
  kin: [{ name: "Priya", relation: "sister", address_term: "didi", provisional: false }],
  rituals: [{ key: "khana_khaya", count: 9 }],
  currency: [{ topic: "test cricket", kind: "cricket" }],
  phrases: [{ phrase: "bandar mode", gloss: "when you go quiet and then send nine memes" }],
  patterns: [
    { then_note: "you go quiet before a deadline and come back after it", prompt_eligible: true },
    { then_note: "this one was never eligible", prompt_eligible: false },
  ],
  weEpisodes: [{ id: 41, summary: "us raat wali baat", at: new Date(at(21, 2)).toISOString() }],
};

const titleFor = (id) => (id === "days-7" ? "A week of you two" : id === "msgs-3" ? "Third message" : null);

// ── 1. THE TIMELINE ───────────────────────────────────────────────────────
{
  const months = timelineFrom(STATE, { titleFor, weEpisodes: BUNDLE.weEpisodes, nowMs: NOW });
  ok("timeline: one month here", months.length === 1, JSON.stringify(months.map((m) => m.key)));
  const m = months[0];
  ok("timeline: month is labelled in words, no year this year", m.label === "august", m.label);
  const kinds = m.entries.map((e) => e.kind);
  for (const k of ["met", "moment", "call", "photo", "game", "us"]) {
    ok(`timeline: carries a ${k} entry`, kinds.includes(k), kinds.join(","));
  }
  ok(
    "timeline: newest first",
    m.entries.every((e, i) => i === 0 || m.entries[i - 1].at >= e.at),
    m.entries.map((e) => e.day).join(" "),
  );
  ok(
    "timeline: the first row is the day it started, and it says who spoke first",
    m.entries[m.entries.length - 1].kind === "met" &&
      /she texted you first/.test(m.entries[m.entries.length - 1].text),
    m.entries[m.entries.length - 1].text,
  );
  ok(
    "timeline: a days- milestone is dated from the first message",
    m.entries.some((e) => e.kind === "moment" && e.day === "8 aug"),
    m.entries.filter((e) => e.kind === "moment").map((e) => e.day).join(","),
  );
  ok(
    "timeline: a call carries its length in minutes, never a clock time",
    m.entries.some((e) => e.kind === "call" && e.text === "a call, 13 min"),
    m.entries.filter((e) => e.kind === "call").map((e) => e.text).join(","),
  );

  // LAW 4, MECHANISED. Every date on this page is a human date. A row whose
  // date carried an hour would be the visual form of "as you said at 3:42pm",
  // which is the exact sentence her own brief bans.
  const HUMAN_DAY = /^\d{1,2} (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/;
  ok(
    "timeline: every row date is a human date",
    m.entries.every((e) => HUMAN_DAY.test(e.day)),
    m.entries.map((e) => e.day).join(","),
  );
  ok(
    "timeline: no row text carries a clock stamp",
    m.entries.every((e) => !/\d{1,2}:\d{2}\s*(am|pm)?/i.test(e.text)),
    m.entries.map((e) => e.text).join(" | "),
  );
}

// caps and month-year labelling
{
  const many = {
    ...STATE,
    messages: [
      msg("a0", "me", Date.UTC(2024, 0, 3)),
      ...Array.from({ length: 30 }, (_, i) => msg(`c${i}`, "her", at(2 + (i % 20), 9 + (i % 8)), { kind: "callmark", text: "1:00" })),
    ],
    momentsFired: [],
    activities: [],
  };
  const months = timelineFrom(many, { titleFor, nowMs: NOW });
  ok(
    "timeline: a month is capped, and the cap is the VIEW not the record",
    months[0].entries.length === KNOWS_MONTH_MAX,
    String(months[0].entries.length),
  );
  ok(
    "timeline: an older year carries its year in the heading",
    months.some((mm) => mm.label === "january 2024"),
    months.map((mm) => mm.label).join(","),
  );
  ok("timeline: months are capped too", months.length <= KNOWS_MONTHS_MAX, String(months.length));
}

// a fresh install: no messages, nothing to place. Absence, never a zero.
{
  const months = timelineFrom({ ...STATE, messages: [], momentsFired: [], activities: [], herLife: [] }, { titleFor, nowMs: NOW });
  ok("timeline: an empty record renders no months at all", months.length === 0);
  ok(
    "empty: the whole surface knows it is empty",
    knowsIsEmpty(months, factsFrom({ user: {} }, null), herSideFrom({ herLife: [] })),
  );
}

ok("dates: dayLabel is lowercase and hand-rolled", dayLabel(at(21)) === "21 aug", dayLabel(at(21)));
ok("dates: monthLabel drops this year", monthLabel(at(3), NOW) === "august", monthLabel(at(3), NOW));

// ── 2. THE FACTS ──────────────────────────────────────────────────────────
{
  const facts = factsFrom(STATE, BUNDLE);
  const byKind = Object.fromEntries(facts.map((f) => [f.kind, f]));

  ok("facts: the two he told her come first", facts[0].kind === "name" && facts[1].kind === "looking",
    facts.map((f) => f.kind).join(","));
  ok(
    "facts: the machine-derived observation is LAST",
    facts[facts.length - 1].kind === "pattern",
    facts.map((f) => f.kind).join(","),
  );
  ok("facts: a not-eligible pattern never renders", facts.filter((f) => f.kind === "pattern").length === 1);
  ok(
    "facts: a confirmed kin row does not hedge",
    byKind.kin.text === "Priya is your sister, you call them didi",
    byKind.kin.text,
  );
  ok(
    "facts: an unconfirmed kin row hedges, the way renderKin does",
    /she thinks$/.test(factsFrom(STATE, { kin: [{ name: "Amit", relation: "cousin" }] })[2].text),
  );
  ok("facts: a ritual key is never shown as a key", byKind.ritual.text === "she asks if you've eaten", byKind.ritual.text);
  ok("facts: an unknown ritual key degrades to its own words", ritualLabel("chai_shaam") === "chai shaam");

  // every row offers the correction, and it opens the way the brief says
  ok(
    "facts: every row can be corrected, in his register",
    facts.every((f) => f.correct.startsWith(CORRECT_OPENER.trimEnd())),
    facts.map((f) => f.correct).join(" | "),
  );
  ok(
    "facts: a correction is a message, never a write",
    facts.every((f) => typeof f.correct === "string" && f.correct.length > CORRECT_OPENER.length - 2),
  );

  // ── THE DELETE IT CAN ACTUALLY PERFORM ─────────────────────────────────
  ok("forget: kin is reachable by name", byKind.kin.forgetTerm === "priya", String(byKind.kin.forgetTerm));
  ok("forget: currency is reachable by topic", byKind.currency.forgetTerm === "test cricket");
  ok("forget: a coined phrase is reachable", byKind.phrase.forgetTerm === "bandar mode");
  ok("forget: an eligible pattern is reachable by its note", typeof byKind.pattern.forgetTerm === "string");
  ok("forget: a ritual offers NO delete (citation-only in the cascade)", byKind.ritual.forgetTerm === null);
  ok("forget: home region offers no delete (whole-wipe only)", byKind.region.forgetTerm === null);
  ok("forget: his own name offers no delete", byKind.name.forgetTerm === null);

  // the op's own limits, mirrored
  const tiny = factsFrom({ user: {} }, { currency: [{ topic: "IT" }] });
  ok("forget: a two-letter term is refused, as opForget refuses it", tiny[0].forgetTerm === null, String(tiny[0].forgetTerm));
  const huge = factsFrom({ user: {} }, { patterns: [{ then_note: "x".repeat(FORGET_TERM_MAX + 1) }] });
  ok("forget: an over-long term is refused rather than sliced mid-word", huge[0].forgetTerm === null);

  ok("facts: an absent bundle renders only what the device itself holds", factsFrom(STATE, null).length === 2);
  ok("facts: an empty state renders nothing at all", factsFrom({ user: {} }, null).length === 0);
}

// THE CASCADE ITSELF, read from api/memory.js. This is the assertion that
// keeps `forgetTerm` honest as the server changes underneath it.
{
  const api = readFileSync(join(ROOT, "api/memory.js"), "utf8");
  const purge = api.slice(api.indexOf("async function purgeRelational"), api.indexOf("async function rebuildRelState"));
  const del = (table) => {
    const i = purge.indexOf(`delete from ${table}`);
    return i < 0 ? "" : purge.slice(i, i + 320);
  };
  ok("cascade: vy_kin still matches a term on name", /name ~\* \$3/.test(del("vy_kin")));
  ok("cascade: vy_currency still matches a term on topic", /topic ~\* \$3/.test(del("vy_currency")));
  ok("cascade: vy_phrase still matches a term on phrase", /phrase ~\* \$3/.test(del("vy_phrase")));
  ok("cascade: vy_pattern still matches a term on then_note", /then_note ~\* \$3/.test(del("vy_pattern")));
  // the negative one: the moment this stops being true, a ritual row may offer
  // a delete, and this line is where somebody finds that out.
  ok(
    "cascade: vy_ritual is STILL citation-only, so a ritual still offers no delete",
    del("vy_ritual").includes("citations &&") && !/~\*/.test(del("vy_ritual")),
    del("vy_ritual").split("\n")[0],
  );
}

// ── 3. HER SIDE ───────────────────────────────────────────────────────────
{
  const her = herSideFrom(STATE);
  ok("her side: two durable rows", her.length === 2, JSON.stringify(her.map((h) => h.text)));
  ok("her side: a momentary activity is never kept as a fact", !her.some((h) => /khana bana/.test(h.text)));
  ok("her side: a legacy row with no kind still reads as a fact", her.some((h) => /karela/.test(h.text)));
  ok("her side: newest first", her[0].at >= her[1].at);
  ok("her side: human dates only", her.every((h) => /^\d{1,2} [a-z]{3}$/.test(h.day)), her.map((h) => h.day).join(","));
}

// ── 4. THE SURFACE, DECIDED ON ITS BYTES ──────────────────────────────────
{
  const tsx = readFileSync(join(ROOT, "src/components/KnowsScreen.tsx"), "utf8");
  const code = tsx
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");

  ok(
    "surface: no count is ever rendered (law 4: not a dashboard)",
    !/\{\s*[\w.?[\]]+\.length\s*\}/.test(code),
    (code.match(/\{\s*[\w.?[\]]+\.length\s*\}/) || [""])[0],
  );
  ok(
    "surface: no locale clock stamp anywhere",
    !/toLocaleTimeString|toLocaleString|toTimeString/.test(code),
  );
  ok(
    "surface: dates come from the hand-rolled labels, not from the platform",
    !/toLocaleDateString/.test(code),
  );
  ok("surface: it forgets through the EXISTING op, and owns no delete of its own",
    /forgetMemories\(/.test(code) && !/api\/memory/.test(code));
  ok("surface: the forget it offers is the item scope", /scope:\s*"item"/.test(code));
  ok(
    "surface: the correction goes out as a message, and the screen writes nothing",
    /onCorrect\(/.test(code) && !/setState\(/.test(code),
  );
  ok("surface: it reads the same relstate bundle Settings and Us read", /fetchRelState\(/.test(code));
  ok(
    "surface: the destructive act is confirmed in words first",
    /confirm-body/.test(code) && /btn-danger/.test(code) && /Keep it/.test(code),
  );

  const css = readFileSync(join(ROOT, "src/styles/knows.css"), "utf8");
  ok(
    "style: no second palette (every colour derives from the app tokens)",
    !/\[data-theme/.test(css) && !/prefers-color-scheme/.test(css),
  );
  ok("style: reduced motion is answered", /prefers-reduced-motion/.test(css));
  ok(
    "style: the ground is the world's, never a painted colour of its own",
    /--k-ground:\s*transparent/.test(css),
  );
}

console.log(fail ? `\n${fail} FAILED` : "\nknows: all checks passed");
process.exit(fail ? 1 : 0);
