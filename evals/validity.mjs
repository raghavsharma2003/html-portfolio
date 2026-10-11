// WS-O — bi-temporal fact edges (src/engine/validity.ts, migration 056).
// ROADMAP-100X item 4, and the fix for `stale-note-keys-on-row-age`.
//
//   node evals/validity.mjs        (needs evals/.bundle.mjs — run.mjs builds it)
//   node evals/run.mjs validity
//
// Offline, deterministic, $0, no DB, no model call, no ambient clock. Every
// timestamp in this file is a literal; the module under test has no `Date.now`
// in it, and §5 asserts that over the source text rather than trusting it.
//
// ── WHAT THIS SUITE IS ACTUALLY GUARDING ─────────────────────────────────
//
// 1. THE DEFECT, AS A FIXTURE. dyad-b's `neet pg` — a November exam recorded
//    in June, recalled in August — is reproduced here with the real deriver
//    and the real staleness predicate, and it must come back "ahead". That
//    exact row is what WS-K's benchmark filed the defect against; if this
//    suite ever passes while that row hedges as past, the fix is gone.
//
// 2. THE PRECISION SIDE, WHICH IS THE DANGEROUS ONE. A deriver that guesses a
//    horizon for a fact that has none is strictly WORSE than the row-age rule
//    it replaces: row age at least degrades toward "old things are probably
//    done", while a wrong horizon asserts a specific future or past with
//    confidence. So the negatives outnumber the positives here, and every one
//    of them must come back null.
//
// 3. ONE PARSER, NOT TWO. §2 asserts the deriver's horizon IS `resolveWhen`'s
//    answer, over the real function, for every dated case. The instruction
//    this workstream was given was to reuse timeline.ts rather than write a
//    second date parser; this is that instruction as a test, and it fails the
//    moment somebody "simplifies" validity.ts by inlining a regex.
//
// 4. ABSENCE IS BYTE-IDENTICAL. Null validity must reproduce the pre-056
//    behaviour EXACTLY in both consumers: `factStaleness` returns "unknown"
//    (so `staleNote` keeps its 45-day rule) and `validityOverlaps` returns
//    true (so consolidation supersedes by name). Both are asserted directly,
//    including the both-null case, because those two defaults are the whole
//    reason this migration can land without a backfill.
//
// 5. DETERMINISM. The same fact derived twice, and derived from a different
//    wall clock, must produce identical intervals — the property that lets a
//    stored interval be compared against a future one at all.
import { deriveFactValidity, factStaleness, validityOverlaps, validityMs, validityIso, resolveWhen } from "./.bundle.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { splitSql } from "../db/migrations/apply.mjs";

let fail = 0;
let pass = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${extra ? " — " + extra : ""}`);
  }
};

const D = (s) => Date.parse(s);
// The three clocks this suite reasons about, all literals.
const JUNE = D("2026-06-20T09:00:00Z"); // when dyad-b's `neet pg` row was written
const AUG = D("2026-08-26T12:00:00Z"); // dyad-b's `now` — 67 days later
const DEC = D("2026-12-20T09:00:00Z"); // after the November horizon

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§1 THE DEFECT, as a fixture — a november exam recorded in june");
// ═════════════════════════════════════════════════════════════════════════
//
// Verbatim from evals/recallbench/fixtures/dyad-b.mjs node 126. If that
// fixture's summary is ever edited, this assertion is the thing that notices.
const NEET = {
  id: "126",
  name: "neet pg",
  kind: "plan",
  summary: "pg entrance exam in november, studying after duty hours",
  saidAt: JUNE,
};

const neetV = deriveFactValidity(NEET);
ok("[D-1] the november exam gets a validity interval at all", neetV !== null, String(neetV));
ok("[D-2] valid_from is when they SAID it, not when the deriver ran", neetV?.validFrom === JUNE);
ok(
  "[D-3] the horizon lands in november of the year it was said",
  neetV != null && new Date(neetV.validTo).getUTCFullYear() === 2026 && new Date(neetV.validTo).getUTCMonth() === 10,
  neetV ? new Date(neetV.validTo).toISOString() : "null",
);
// THE DEFECT ITSELF. Under the old rule this row is 67 days old, kind=plan,
// and therefore hedged as already-past in August.
ok("[D-4] in AUGUST the exam is still AHEAD (the defect, closed)", factStaleness(neetV, AUG) === "ahead", factStaleness(neetV, AUG));
ok("[D-5] in DECEMBER the same row reads as PAST", factStaleness(neetV, DEC) === "past", factStaleness(neetV, DEC));
// The negative control for the fix: row age no longer decides, but it must
// still be capable of deciding when there is no horizon. That is §4.
ok(
  "[D-6] the row-age rule would have got this WRONG (the defect was real)",
  (AUG - JUNE) / 86_400_000 > 45 && NEET.kind === "plan",
  `${Math.round((AUG - JUNE) / 86_400_000)} days`,
);

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§2 ONE PARSER — the horizon IS resolveWhen's answer, not a second table's");
// ═════════════════════════════════════════════════════════════════════════
const DATED = [
  { name: "shaadi", kind: "plan", summary: "meghna ki shaadi december me hai", saidAt: JUNE },
  { name: "interview", kind: "event", summary: "interview kal hai", saidAt: JUNE },
  { name: "trip", kind: "plan", summary: "goa trip agle mahine", saidAt: JUNE },
  { name: "viva", kind: "event", summary: "viva parso", saidAt: JUNE },
  { name: "presentation", kind: "plan", summary: "presentation on thursday", saidAt: JUNE },
  { name: "result", kind: "event", summary: "result in 3 weeks", saidAt: JUNE },
  { name: "exam", kind: "plan", summary: "pg entrance exam in november", saidAt: JUNE },
  { name: "review", kind: "plan", summary: "review agle hafte", saidAt: JUNE },
];
for (const f of DATED) {
  const v = deriveFactValidity({ id: f.name, ...f });
  const r = resolveWhen({ id: f.name, ...f }, f.saidAt);
  ok(
    `[P-${f.name}] derived horizon === resolveWhen's own answer`,
    v !== null && r !== null && v.validTo === r.at && v.basis === r.basis,
    `derived=${v ? new Date(v.validTo).toISOString() : "null"} resolveWhen=${r && r.at != null ? new Date(r.at).toISOString() : "null"}`,
  );
  ok(`[P-${f.name}] the horizon is after they said it`, v !== null && v.validTo > v.validFrom);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§3 THE PRECISION SIDE — a fact with no date must get NO horizon");
// ═════════════════════════════════════════════════════════════════════════
//
// Each of these is a real fixture row shape (dyad-a/b/c) and each must derive
// null. A guessed horizon is worse than no horizon: it asserts a specific
// future where the row-age rule merely shrugged.
const UNDATED = [
  { name: "amma", kind: "person", summary: "her mother, in chennai, knee trouble, refuses to move to delhi" },
  { name: "night shift", kind: "event", summary: "twelve hour night shifts, 8pm to 8am, emergency crowded" },
  { name: "mess khana", kind: "preference", summary: "hostel mess food is bad, cannot afford to order out daily" },
  { name: "delhi", kind: "place", summary: "where she lives and works now, moved two months ago" },
  { name: "chai", kind: "preference", summary: "four or five cups a day, knows it is too many" },
  { name: "dr malhotra", kind: "person", summary: "her ward consultant, strict, remembers everything, teaches well" },
  { name: "shreya", kind: "person", summary: "batchmate, studies with her every day, the one who steadies her" },
  { name: "neend", kind: "fact", summary: "not sleeping enough, said so plainly" },
  { name: "hostel", kind: "place", summary: "ten minutes walk from the hospital, she walks it" },
  // The `may`-the-modal carve-out timeline.ts documents. "may" here is a verb.
  { name: "transfer", kind: "plan", summary: "she may get transferred, nothing decided" },
  // Time-SHAPED but not time-RESOLVABLE: `TIME_BOUND` fires on "exam", and the
  // old rule would eventually hedge this. There is no date to extract, so the
  // deriver must decline and leave the fallback in charge.
  { name: "exam", kind: "plan", summary: "pg entrance exam, studying after duty hours" },
];
for (const f of UNDATED) {
  const v = deriveFactValidity({ id: f.name, ...f, saidAt: JUNE });
  ok(`[N-${f.name}] no date in the text ⇒ no horizon`, v === null, v ? new Date(v.validTo).toISOString() : "");
  ok(`[N-${f.name}] and staleness is "unknown", never a verdict`, factStaleness(v, AUG) === "unknown");
}

// Malformed inputs must decline, not throw and not invent.
ok("[N-0] a fact with no saidAt derives null", deriveFactValidity({ id: "x", name: "x", summary: "kal", saidAt: NaN }) === null);
ok("[N-0] null input derives null", deriveFactValidity(null) === null);
ok("[N-0] undefined input derives null", deriveFactValidity(undefined) === null);

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§4 ABSENCE IS BYTE-IDENTICAL — null validity reproduces the pre-056 rules");
// ═════════════════════════════════════════════════════════════════════════
ok("[A-1] factStaleness(null) is unknown", factStaleness(null, AUG) === "unknown");
ok("[A-2] factStaleness(undefined) is unknown", factStaleness(undefined, AUG) === "unknown");
ok("[A-3] factStaleness({}) is unknown", factStaleness({}, AUG) === "unknown");
ok("[A-4] a validFrom with no validTo is still unknown", factStaleness({ validFrom: JUNE, validTo: null }, AUG) === "unknown");
ok("[A-5] a non-numeric validTo is unknown, never a verdict", factStaleness({ validTo: "november" }, AUG) === "unknown");

// The contradiction default. BOTH-NULL is the case that covers every row
// written before this migration, and it must supersede exactly as today.
ok("[A-6] two rows with no validity overlap (supersede as today)", validityOverlaps(null, null) === true);
ok("[A-7] a dated row vs an undated one overlaps (supersede as today)", validityOverlaps(neetV, null) === true);
ok("[A-8] an undated row vs a dated one overlaps (supersede as today)", validityOverlaps(null, neetV) === true);
ok("[A-9] {} vs {} overlaps", validityOverlaps({}, {}) === true);

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§4b CONTRADICTION AS A QUERY — two exams are not a contradiction");
// ═════════════════════════════════════════════════════════════════════════
//
// The case api/consolidate.js's new predicate exists for: same `name`,
// different `body`, DISJOINT horizons. Superseding here would set `t_invalid`
// on the November row, and every recall query in the repo reads `t_invalid is
// null` as a hard exclusion — so the November exam would vanish from her memory
// the moment the May one was mentioned.
const NOV = deriveFactValidity({ id: "e1", name: "exam", kind: "plan", summary: "pg entrance exam in november", saidAt: JUNE });
const MAY = deriveFactValidity({ id: "e2", name: "exam", kind: "plan", summary: "next exam in may 14", saidAt: DEC });
ok("[C-1] both exams derived a horizon", NOV !== null && MAY !== null);
ok("[C-2] the two horizons are disjoint ⇒ NOT a contradiction", validityOverlaps(NOV, MAY) === false, `${validityIso(NOV?.validTo)} vs ${validityIso(MAY?.validFrom)}`);
// The belief-change case that MUST still supersede: same name, overlapping
// (indeed identical-anchored) intervals.
const CITY_A = { validFrom: JUNE, validTo: DEC };
const CITY_B = { validFrom: AUG, validTo: null };
ok("[C-3] a belief that changed mid-interval still overlaps ⇒ supersede", validityOverlaps(CITY_A, CITY_B) === true);
// Touching endpoints do NOT overlap: half-open [from, to).
ok("[C-4] half-open intervals — a horizon that is the next one's start does not overlap", validityOverlaps({ validFrom: JUNE, validTo: AUG }, { validFrom: AUG, validTo: DEC }) === false);

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§5 DETERMINISM AND THE NO-CLOCK PROPERTY");
// ═════════════════════════════════════════════════════════════════════════
const a1 = deriveFactValidity(NEET);
const a2 = deriveFactValidity(NEET);
ok("[T-1] the same fact derives the same interval twice", a1?.validFrom === a2?.validFrom && a1?.validTo === a2?.validTo);
// The real property: derivation must not depend on when it runs. The module
// takes no clock, so the only way this could break is a Date.now() creeping in
// — which §5b asserts over the source.
ok("[T-2] the interval does not depend on the ambient clock", a1?.validTo === neetV?.validTo);

const SRC = readFileSync(fileURLToPath(new URL("../src/engine/validity.ts", import.meta.url)), "utf8");
const CODE = SRC.split("\n")
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join("\n");
ok("[T-3] validity.ts contains no Date.now()", !/Date\.now\s*\(/.test(CODE));
ok("[T-4] validity.ts contains no second date table (no month-name regex)", !/\bjan\b\s*\|/i.test(CODE));
ok("[T-5] validity.ts imports resolveWhen from timeline", /import\s*\{[^}]*resolveWhen[^}]*\}\s*from\s*"\.\/timeline"/.test(SRC));
ok("[T-6] validity.ts has no store: no q(, no fetch, no insert", !/\bq\(|\bfetch\(|insert into/i.test(CODE));

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§6 THE SQL ADAPTERS — one parse story, not three");
// ═════════════════════════════════════════════════════════════════════════
ok("[S-1] validityMs parses a postgres timestamptz", validityMs("2026-11-15T12:00:00Z") === D("2026-11-15T12:00:00Z"));
ok("[S-2] validityMs(null) is null", validityMs(null) === null);
ok("[S-3] validityMs('') is null", validityMs("") === null);
ok("[S-4] validityMs of garbage is null, never NaN", validityMs("not a date") === null);
ok("[S-5] validityMs passes a number through", validityMs(JUNE) === JUNE);
ok("[S-6] validityIso round-trips", validityMs(validityIso(JUNE)) === JUNE);
ok("[S-7] validityIso(null) is null", validityIso(null) === null);

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§7 THE READ PATH IS WIRED — api/memory.js really asks the horizon");
// ═════════════════════════════════════════════════════════════════════════
//
// `dead-writers`, in its read-side form: a column with a writer and no reader
// is indistinguishable from a column that does not exist, and the whole point
// of this workstream is what `staleNote` does. Asserted over the source text
// because api/memory.js is a Vercel function this bundle cannot import.
const MEM = readFileSync(fileURLToPath(new URL("../api/memory.js", import.meta.url)), "utf8");
ok("[W-1] COLS selects valid_from/valid_to", /const COLS =[\s\S]{0,300}valid_from, valid_to/.test(MEM));
ok("[W-2] staleNote reads valid_to before it reads updated_at", (() => {
  const s = MEM.indexOf("const staleNote = (n) =>");
  if (s < 0) return false;
  const body = MEM.slice(s, s + 700);
  const vt = body.indexOf("valid_to");
  const ua = body.indexOf("updated_at");
  return vt >= 0 && ua >= 0 && vt < ua;
})());
ok("[W-3] the 45-day fallback is still there (absence must not change)", /days > 45/.test(MEM));
ok("[W-4] the node writer writes valid_from/valid_to", /insert into meera_nodes[\s\S]{0,200}valid_from, valid_to/.test(MEM));
ok("[W-5] memory.js does NOT statically import the engine bundle", !/^import[^\n]*_engine\.gen\.js/m.test(MEM));

const CON = readFileSync(fileURLToPath(new URL("../api/consolidate.js", import.meta.url)), "utf8");
ok("[W-6] consolidation writes valid_from/valid_to on vy_fact", /insert into vy_fact[\s\S]{0,300}valid_from, valid_to/.test(CON));
ok("[W-7] contradiction resolution consults validityOverlaps", /validityOverlaps/.test(CON));
ok("[W-8] consolidation derives through the bundle, not a local parser", /deriveFactValidity/.test(CON) && !/\bjan\b\|feb\b/i.test(CON));

const MIG = readFileSync(fileURLToPath(new URL("../db/migrations/056_fact_validity.sql", import.meta.url)), "utf8");
ok("[W-9] migration 056 adds the columns to BOTH stores", /alter table vy_fact add column if not exists valid_to/.test(MIG) && /alter table meera_nodes add column if not exists valid_to/.test(MIG));
// Split with the REAL runner's splitter, not a `.split(";")` that would
// disagree with it about comments — the property under test is "every
// statement db/migrations/apply.mjs will send is independently recoverable",
// and only apply.mjs knows what a statement is.
const STMTS = splitSql(MIG).filter((s) => s.trim());
ok("[W-10] 056 splits into the statements it looks like", STMTS.length === 10, String(STMTS.length));
ok(
  "[W-10] every statement in 056 is independently idempotent",
  STMTS.every((s) => /if not exists|drop constraint if exists|add constraint/i.test(s)),
  STMTS.filter((s) => !/if not exists|drop constraint if exists|add constraint/i.test(s))
    .map((s) => s.trim().replace(/--[^\n]*\n/g, "").trim().slice(0, 60))
    .join(" || "),
);
ok("[W-11] 056 has no DO block (apply.mjs's splitter does not handle them)", !/\bdo\s*\$\$/i.test(MIG));

console.log(`\n${fail ? "FAILED" : "PASS"} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
