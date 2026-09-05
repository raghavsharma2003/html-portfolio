// WS-R8. THE LEAK BATTERY — the Phase 1 gate of Vyakti Rooms.
//
//   node evals/room-leak/run.mjs
//
// The plan's hard rule, verbatim: "The leak battery runs clean before a second
// follower joins any Room. No exception for a launch date." This is that
// battery, built to the shape `evals/mp/gate0.mjs` already proved out in this
// repo (context/measurements.md#gate0-structural: 494 scenarios, 31,122
// row-by-scenario checks, the prompt-instruction arm leaked 57-98%, the SQL
// predicate leaked 0, a negative control caught 162) — a scenario generator,
// a real predicate driven through the real code, a printed row-by-scenario
// count, and negative controls that MUST fail the battery, because
// `sound-gate-proved-by-silence` (context/rejected.md) is the standing law: a
// gate nobody has watched fail is a gate nobody knows works.
//
// Offline, deterministic, $0, no DB, no network, no model call. Reuses
// `evals/room/fixtures.mjs` (WS-R1's fake db, extracted so this suite is not a
// second reading of migration 071's laws) rather than writing a new one.
//
// ── the boundary model this battery proves (Vyakti Rooms v1, adopted) ──────
//
//   (a) creator material flows down to every follower.            ALLOWED
//   (b) a follower's words reach only their own future turns.      ALLOWED
//   (c) a follower's words never write to the creator's sheet,     NEVER
//       person model, or claims.
//   (d) a follower's words never reach another follower — not      NEVER
//       verbatim, not paraphrased, not as an example, not through
//       retrieval, not through the compiled prompt.
//   (e) themes reach the creator only as counts over an opt-in     NOT BUILT
//       shared subgraph with n>=5 (Pulse). Asserted here: NOTHING  YET
//       reaches the creator today, which is the honest reading of
//       "not built yet" — a gate that skipped (e) would be silent
//       about the one clause with no code behind it at all.
//
// ── four layers, each proving a different half of the model ────────────────
//
//   STATIC   (no execution) — the follower lane's import graph reaches no
//            writer of vy_teacher_sheet / vy_replica_claim / vy_person_model;
//            dmRecall's REAL predicate text (read from the real source, not
//            retyped) carries the agent and person clauses; the only
//            creator-facing read of the Room's tables is a COUNT.
//   RETRIEVAL   N followers x T turns through the REAL follower lane
//            (api/_room-surface.js, unmodified) and the REAL compiler
//            (src/engine/compiler.ts via api/_engine.gen.js): every compiled
//            prompt, every retrieved fact set and every reply is scanned for
//            every OTHER follower's unique tokens.
//   BOUNDARY forget for one follower removes their tokens from every later
//            compile and leaves everyone else's untouched; export for a
//            follower contains only their own tokens; the creator's sheet is
//            byte-identical before and after every follower's turns.
//   NEGATIVE two controls that MUST fail: a copy of the recall path with its
//            person clause struck, and a "helpful" reply that pastes another
//            follower's words in as an example. If either passes, the battery
//            proves nothing and says so loudly.
//
// ── what this battery does NOT prove, stated rather than hidden ────────────
//
// `dmRecall` (api/_room.js) issues its query through `q()` (api/_db.js)
// directly — it is not seam-injectable the way `roomSay`'s `memory.recall` is,
// because nothing between here and production should be able to swap the real
// predicate for a fake one at the follower's own request. So this battery
// cannot EXECUTE dmRecall's real SQL offline; no database is reachable here
// (`offline-mocks-cannot-type-check-sql`, CLAUDE.md). What it does instead,
// honestly stated as two separate proofs rather than one blurred claim:
//
//   1. STATIC: `disclosurePredicate()` — the actual exported function, not a
//      reimplementation — is called with the REAL bind `dmRecall` uses (read
//      out of `api/_room.js`'s own source at run time, so a change to that
//      bind is a change this suite sees), and the resulting TEXT is checked
//      for the agent-scope and person-membership clauses. This is the
//      `evals/sqlcast.mjs` method: read the shipping SQL the way Postgres
//      will, without a server.
//   2. LIVE, ALREADY DONE, ELSEWHERE: that exact predicate function has
//      already been proven against a REAL Postgres server at
//      `evals/mp/gate0.mjs` (`node scripts/verify-release.mjs --mp`, or
//      standalone with NEON_URL set) — 0 ACL violations across 31,122
//      row-scenario checks, with its own negative control catching 162. This
//      battery does not re-run that proof; it connects to it, and says so
//      rather than re-deriving a weaker offline version of the same claim.
//
// The RETRIEVAL layer below therefore drives `roomSay` with a `memory.recall`
// FAKE — the same seam WS-R1's suite uses — built to enforce the identical
// structural guarantee (person AND agent equality) rather than to re-derive
// it, exactly as `evals/room/run.mjs`'s `fakeMemory` does. Its own negative
// control (below) proves the fake is not vacuously safe: with the person
// clause removed, it leaks, on the nose the way the real predicate's negative
// control does at gate0.
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AGENT_ID, ROOM_ID, OWNER, REPLICA_ID, SLUG, loadFixtureAgent, freshState, fakeDb, fakeMemory } from "../room/fixtures.mjs";
import { disclosurePredicate } from "../../api/_disclosure.js";
import {
  runFullWorld, staticReachProblems, undeclaredRoomPersonTables, classifyOneFile,
  DEFAULT_SEED, ROOM_DEFS, roomForgetReceiptHash, survivorsFor, TABLE_ROLES,
} from "./world.mjs";
import { freshFlagState, flagsDb } from "../room-flags/fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

process.env.ROOM_SESSION_SECRET = "r".repeat(48);

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

// Two counters, reported separately in the verdict: `rowChecks` is every
// single token-membership test across the retrieval surfaces (the
// gate0-structural-shaped count), `boundaryChecks` is every export/forget/
// creator-immutability assertion. Both are printed; neither is invented.
let rowChecks = 0;
let boundaryChecks = 0;

const room = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
const { joinRoom, roomSay, roomExport, roomForget, roomStats, roomThreadDevice, readRoomSession, flagReply } = room;
const { readFlaggedReplies } = await import(pathToFileURL(join(REPO, "api/_review-queue.js")).href);

// ═════════════════════════════════════════════════════════════════════════
// LAYER 1 — STATIC. No execution; the shipping source, read and checked.
// ═════════════════════════════════════════════════════════════════════════
console.log("── layer 1: static (import graph + real predicate text) ──");

// (1a) The follower lane's own imports, and everything they transitively
// import, must never CALL a writer of creator-authored material (the sheet,
// the person model, claims, mirror conditioning). "Never imports the FILE
// that happens to also hold a writer" is the wrong bar — `_clonechat.js`
// legitimately imports `loadNeverRules` (a pure SELECT) from the same file
// that later, in a function the follower lane never calls, writes
// `vy_replica_claim`, and flagging the whole file would fail on a reader
// that does nothing wrong. The right bar, and the one this checks, is: no
// WRITE-SHAPED EXPORTED SYMBOL from a creator-material file is ever imported
// by name anywhere the follower lane's import graph reaches. That is
// `plausible-return-hides-a-dead-pipeline` read the other way — the
// capability has to be NAMED before it can be dead, or reachable.
{
  const CREATOR_WRITE_FILES = [
    "_replica-claims.js", "_replica-consent.js", "_review-queue.js",
    "_replica-source.js", "_teacher-sheet-draft.js", "_mirrorcall-store.js",
    "_person-model.js",
  ];
  const CREATOR_TABLES = [
    "vy_teacher_sheet", "vy_replica_claim", "vy_person_model",
    "vy_mirror_session", "vy_mirror_window", "vy_mirror_conditioning",
    "vy_mirror_delta", "vy_mirror_feedback", "vy_mirror_finetune_job", "vy_mirror_turn",
  ];
  const WRITE_RE = new RegExp(
    `\\b(?:insert into|update)\\s+(?:${CREATOR_TABLES.join("|")})\\b`,
  );

  // Every top-level function in the file — exported OR NOT — as
  // {name, exported, body}. A private helper's write must still count: the
  // real defect this is modelled on (`extractOwnedClaims` calling the
  // unexported `openRun`/`persistProposals`, which hold the actual INSERTs)
  // is exactly a write reachable only through an exported function that does
  // not itself contain the SQL text.
  const fileFunctions = (relFile) => {
    const src = fs.readFileSync(join(REPO, "api", relFile), "utf8");
    const marks = [...src.matchAll(/^(export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gm)];
    return marks.map((m, i) => {
      const start = m.index;
      const end = i + 1 < marks.length ? marks[i + 1].index : src.length;
      return { name: m[2], exported: Boolean(m[1]), body: src.slice(start, end) };
    });
  };

  // The writer symbols, DERIVED from the source rather than hand-listed, so a
  // new writer added to any of these files is caught the day it lands without
  // this check needing an edit to know about it. A function is "dangerous" if
  // its own body writes a creator table, OR it calls another local function
  // that is dangerous (propagated to a fixed point, so a chain of any depth
  // is caught) — and only the EXPORTED dangerous functions are importable,
  // which is the set this check actually cares about.
  const writeSymbols = new Set();
  for (const f of CREATOR_WRITE_FILES) {
    const fns = fileFunctions(f);
    const dangerous = new Set(fns.filter((fn) => WRITE_RE.test(fn.body)).map((fn) => fn.name));
    let changed = true;
    while (changed) {
      changed = false;
      for (const fn of fns) {
        if (dangerous.has(fn.name)) continue;
        for (const otherName of dangerous) {
          if (new RegExp(`\\b${otherName}\\s*\\(`).test(fn.body)) {
            dangerous.add(fn.name);
            changed = true;
            break;
          }
        }
      }
    }
    for (const fn of fns) if (fn.exported && dangerous.has(fn.name)) writeSymbols.add(fn.name);
  }
  ok(`derived ${writeSymbols.size} creator-material writer symbols from source (including private helpers reached only through an exported caller)`,
    writeSymbols.size >= 10, [...writeSymbols].join(","));
  ok("the derivation catches a write reachable only through a private helper (extractOwnedClaims -> openRun)",
    writeSymbols.has("extractOwnedClaims"));

  // The follower lane's transitive import graph — every file reachable from
  // `_room-surface.js`, at any depth — and every NAMED import specifier it
  // pulls in from each. Intersected against the writer symbols above.
  const importsOf = (relFile) => {
    const src = fs.readFileSync(join(REPO, "api", relFile), "utf8");
    const files = [];
    const names = [];
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s+"\.\/(_?[\w.-]+\.js)"/g)) {
      files.push(m[2]);
      for (const n of m[1].split(",")) {
        const clean = n.trim().split(/\s+as\s+/)[0].trim();
        if (clean) names.push(clean);
      }
    }
    return { files, names };
  };
  const seen = new Set(["_room-surface.js"]);
  const queue = ["_room-surface.js"];
  const importedNames = new Set();
  while (queue.length) {
    const f = queue.shift();
    if (!fs.existsSync(join(REPO, "api", f))) continue;
    const { files, names } = importsOf(f);
    for (const n of names) importedNames.add(n);
    for (const dep of files) {
      if (!seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }
  const reached = [...importedNames].filter((n) => writeSymbols.has(n));
  ok("no creator-material writer symbol is imported anywhere the follower lane's import graph reaches",
    reached.length === 0, reached.join(","));
  console.log(`  files in the follower lane's transitive import graph: ${seen.size}`);
}

// (1b) dmRecall's REAL predicate text, read off the REAL bind in api/_room.js
// (not retyped here — a retyped copy could drift from the shipping value
// silently). Confirms the SQL TEXT the follower-recall call site actually
// sends carries the agent-scope and person-membership clauses.
{
  const roomSrc = fs.readFileSync(join(REPO, "api/_room.js"), "utf8");
  const bindMatch = roomSrc.match(/const BIND = (\{[^}]*\});/);
  ok("dmRecall's BIND literal is found in api/_room.js (not moved/renamed)", Boolean(bindMatch));
  const DM_BIND = bindMatch ? Function(`"use strict"; return (${bindMatch[1]});`)() : null;
  ok("dmRecall binds a distinct agentId parameter", DM_BIND?.agentId === "$5", JSON.stringify(DM_BIND));

  const predicateText = DM_BIND ? disclosurePredicate("fact", DM_BIND) : "";
  ok("the real predicate carries the agent-scope clause at dmRecall's binding",
    predicateText.includes("and f.agent_id = ($5)::uuid"));
  ok("the real predicate carries the person-membership clause (uncited branch)",
    predicateText.includes("<@ array[f.person_id]::uuid[]"));
  ok("the real predicate carries room isolation (irrelevant to a 1:1 recall, present anyway)",
    predicateText.includes("f.group_id is null or f.group_id ="));

  // THE WIRING. Confirming the predicate TEXT is safe proves nothing if
  // dmRecall never splices it into its query — `plausible-return-hides-a-
  // dead-pipeline`. This checks the call site, not the function definition.
  const callSiteMatch = /select f\.id, f\.body, f\.name, f\.created_at\s*\n\s*from \$\{t\("vy_fact"\)\} f\s*\n\s*where f\.t_invalid is null and f\.retracted_at is null \$\{pred\}/.test(
    roomSrc,
  );
  ok("dmRecall's own query text splices the predicate in (verified against the source, not assumed)",
    callSiteMatch);

  console.log(
    `  note: this predicate is proven live-clean at evals/mp/gate0.mjs (0/31,122 violations,` +
      ` context/measurements.md#gate0-structural) — not re-run here, no NEON_URL in this environment.`,
  );
}

// (1c) The only creator-facing read of the Room's tables returns a COUNT and
// nothing else — the structural half of "nothing reaches the creator today"
// (Pulse is unbuilt; this asserts unbuilt means absent, not merely unused).
{
  const state = freshState();
  const db = fakeDb(state);
  const stats = await roomStats(db, { slug: SLUG }, { loadAgent: (await loadFixtureAgent(REPO)).loadAgent });
  ok("roomStats returns exactly one key", Object.keys(stats).join(",") === "talked_today");

  // Repo-wide: no file outside the Room's own lane and its erasure/manifest
  // reads `vy_room_thread` or `vy_room_follower` except to DELETE them. A new
  // creator-facing reader added later — the shape Pulse will eventually be —
  // must fail this line the day it is written without also updating it.
  // WS-R16's sweep reads `vy_room_follower` (tier, memory_consent_at) to
  // decide who gets a check-in delivered - a full, non-aggregate read, but
  // never a creator-facing one: every row it touches is delivered back into
  // THAT SAME follower's own private thread, `_room-surface.js`'s own reason
  // for being admitted here rather than into AGGREGATE_ONLY one line down.
  // WS-R29: `api/_room-whatsapp.js` reads/writes `vy_room_follower_whatsapp`
  // (a table name containing the "vy_room_follower" substring this scan
  // matches on, `_room-cohorts.js`'s own comment already warns future
  // readers about) entirely off the caller's OWN verified session, and its
  // one cross-follower read (`replyWithRoomLink`, resolving which Room a
  // phone number means) looks up ONE follower's own locale/slug by that
  // SAME follower's own phone number - never a creator-facing read, never a
  // scan across followers, `api/_checkins.js`'s own admission one row below
  // for the identical shape of reason.
  // WS-R37 (at the merge): `api/_renewals.js`'s follower due-select joins
  // `vy_room_follower` for ONE column, that follower's own `locale`, so the
  // renewal notice is worded in the language they chose - the live EXPLAIN
  // refused the workstream's `r.locale` (no such column on `vy_room`; the
  // fake db could not know). The row is delivered back to THAT SAME follower
  // and to nobody else, `_checkins.js`'s own admission shape above.
  // WS-R75 (migration 119): `api/_dormancy.js`'s two statements
  // (`dormancyNoticeDue`'s UPDATE, `dormancyForgetDue`'s SELECT) each read
  // several of a follower's own columns (follower_id, person_id, agent_id,
  // locale) - a real per-row read, not an aggregate, so it does not fit
  // AGGREGATE_ONLY's shape. Admitted here instead, `_renewals.js`'s own
  // admission one line up restated for the identical reason: neither
  // statement is creator-facing - both act ON that same follower's own row
  // (marking their own notice, or handing their own scope to the REAL
  // `roomForgetForFollower`) and deliver nothing back to the creator or to
  // any other follower.
  const ALLOWED = new Set([
    "_room-surface.js", "_room.js", "_replica-full-erasure.js", "memory.js", "_checkins.js", "_room-whatsapp.js",
    "_renewals.js", "_dormancy.js",
  ]);
  // WS-R7's creator lane reads `vy_room_follower` for the owner's stats, and
  // WS-R12's reads it and `vy_room_follower_day` for the week-six retention
  // number. Both are the reads the plan permits (counts, never a person), so
  // both are admitted here ONLY as aggregate readers: every statement in
  // either that names the follower table (or its day-count sibling, which
  // `.includes("vy_room_follower")` catches as a substring the same as the
  // whole-word table name) must select nothing but count()/sum() expressions,
  // and must never touch a follower's own columns. A future edit that selects
  // `person_id`, a thread title or a message fails this line.
  // WS-R17's Pulse card (migration 080) reads `vy_room_thread` for exactly
  // one purpose: matching a creator's own topic label against a follower's
  // opted-in thread title, entirely inside a WHERE-clause `exists(...)`
  // predicate whose own SELECT LIST is `count(*)` alone - `api/_pulse.js`'s
  // header names the exact rule this shares with `_room-cohorts.js`'s
  // retention statement. A future edit that selected `title`, `person_id` or
  // `thread_id` at the top level fails this line.
  // WS-R21's ops board (`api/_ops.js`, migration 084) reads
  // `vy_room_follower` for the per-Room strip a platform operator sees -
  // followers total/paid/joined-7d, at-cap-this-month, voice seconds - and
  // `vy_room_follower_day` for messages in the last 24h. Every statement is
  // scoped to ONE room (`where room_id = ($1)::uuid`, never grouped across
  // rooms) so its select list can be nothing but count()/sum() expressions,
  // the same shape `_room-cohorts.js` and `_pulse.js` already prove out. A
  // future edit that selected a follower's own column (person_id, a thread
  // title, anything they said) fails this line.
  // WS-R25's creator funnel (`api/_funnel.js`, migration 088) reads
  // `vy_room_follower` for exactly one number: the first follower's
  // `joined_at` per Room, scoped to `where room_id = ($1)::uuid`, never
  // grouped across rooms - the same shape every sibling above already
  // proves out, one aggregate function wider (see the `min` addition to the
  // parser just below). A future edit that selected a follower's own column
  // here fails this line the same way it would in any other admitted file.
  // WS-R28's Suite board (`api/_org.js`, migration 091) reads NO follower or
  // thread table directly - `orgBoard` loops the Suite's own Rooms and calls
  // `api/_ops.js`'s own `roomOverview` per Room (exported for exactly this
  // reuse), so `_org.js`'s own source carries no statement naming either
  // table today. Admitted here anyway as a forward guard: the scanner below
  // skips a file entirely unless its RAW SOURCE TEXT contains one of these
  // two table names (see the `if (!(src.includes(...)))` line just below),
  // so this entry is currently INERT - it starts mattering the day a future
  // edit adds a direct query naming either table to this file rather than
  // going through `roomOverview`, at which point that edit's own select list
  // is held to the same rule every sibling here already is.
  // WS-R30's conversion moment (`api/_phase-gate.js`, migration 093) reads
  // `vy_room_follower`/`vy_room`/`vy_room_thread` two ways: `sessionWorked`'s
  // `follower_scope`/`thread_scope` CTEs read ONE follower's own row via
  // `where f.room_id = ($1)::uuid and f.person_id = ($2)::uuid` (never
  // grouped), with every selected value wrapped in `min(...)` - a WHERE-
  // scoped single row's own value read back through an aggregate function is
  // exactly WS-R25's `min(joined_at)` precedent, applied to `tier` and
  // `month_message_count` instead of `joined_at`; `conversionReport`'s
  // eligible/paying read is scoped the same `where room_id = ($1)::uuid` way
  // every sibling above already proves out. A future edit that selected a
  // follower's own column unwrapped, or grouped across rooms, fails this
  // line the same way it would in any other admitted file.
  // WS-R74 (migration 118): api/_creator-push.js's own "followers this
  // week" read - a bare `count(*)` over vy_room_follower, the identical
  // aggregate-only shape `_ops.js`'s own read here already passes.
  const AGGREGATE_ONLY = new Set(["_room-publish.js", "_room-cohorts.js", "_pulse.js", "_ops.js", "_funnel.js", "_org.js", "_phase-gate.js", "_creator-push.js"]);
  // WS-R11's webhook flips a follower's `tier` when a real payment lands - not
  // a creator-facing read at all, so it does not fit AGGREGATE_ONLY's shape
  // (which is about SELECTs), but it is still a new file naming this table and
  // this battery's whole argument is "a new reader/writer must fail this line
  // without also updating it". So it gets its own narrow class: the only
  // statement in the file that names `vy_room_follower` must be an UPDATE
  // whose SET list touches nothing but `tier` and `updated_at`, scoped by
  // `follower_id`, and whose RETURNING never carries a follower's content
  // (person_id, thread names, anything they said). A future edit that made
  // this file SELECT a follower's own columns fails this line.
  const TIER_WRITE_ONLY = new Set(["_payments.js"]);
  const offenders = [];
  for (const f of fs.readdirSync(join(REPO, "api"))) {
    if (!f.endsWith(".js") || ALLOWED.has(f)) continue;
    const src = fs.readFileSync(join(REPO, "api", f), "utf8");
    if (!(src.includes("vy_room_thread") || src.includes("vy_room_follower"))) continue;
    if (TIER_WRITE_ONLY.has(f)) {
      // The update sits inside one large multi-CTE template literal alongside
      // other statements that ALSO contain the words "set" and "from" (the
      // subscription-state CTE right before it), so this slices from the
      // update's own start rather than matching the first "set ... from" in
      // the whole blob, which would silently grade the WRONG clause.
      const starts = [...src.matchAll(/update\s+vy_room_follower\s+f\b/gi)].map((m) => m.index);
      if (!starts.length) { offenders.push(f + ":no-statement-found"); continue; }
      for (const at of starts) {
        const window = src.slice(at, at + 400);
        const setMatch = window.match(/\bset\s+([\s\S]*?)\s+from\s+([\s\S]*?)\breturning\b([\s\S]*?)(?:\n\s*\)|$)/i);
        if (!setMatch) { offenders.push(f + ":non-tier-write"); continue; }
        const [, setList, fromClause, returningList] = setMatch;
        const setsOnlyTierAndTimestamp = /^tier\s*=[\s\S]*,\s*updated_at\s*=\s*now\(\)\s*$/.test(setList.trim());
        const scopedByFollowerId = /f\.follower_id\s*=\s*su\.follower_id/.test(fromClause);
        const returningLeaksContent = /\b(person_id|thread_id|title|content|message_text|month_key|month_message_count|joined_at|memory_consent_at|age_attested_at)\b/i.test(returningList);
        if (!setsOnlyTierAndTimestamp || !scopedByFollowerId || returningLeaksContent) {
          offenders.push(f + ":non-tier-write");
        }
      }
      continue;
    }
    if (!AGGREGATE_ONLY.has(f)) { offenders.push(f); continue; }
    // Only real statements: a backticked table name inside a comment is prose.
    const stmts = (src.match(/`[^`]*vy_room_(?:follower|thread)[^`]*`/g) || [])
      .filter((st) => /\bfrom\s+vy_room_(?:follower|thread)\b/i.test(st));
    if (!stmts.length) offenders.push(f + ":no-statement-found");
    for (const st of stmts) {
      const selectList = (st.match(/select([\s\S]*?)\sfrom\s/i) || [, ""])[1];
      // Split the select list on top-level commas only: `coalesce(sum(...), 0)`
      // is one item, not two.
      const items = []; let depth = 0, cur = "";
      for (const ch of selectList) {
        if (ch === "(") depth++; else if (ch === ")") depth--;
        if (ch === "," && depth === 0) { items.push(cur); cur = ""; } else cur += ch;
      }
      if (cur.trim()) items.push(cur);
      // WS-R25 widened this to admit `min(...)` alongside `count(...)`/
      // `sum(...)`: `api/_funnel.js`'s one follower-table read is
      // `min(joined_at)`, a real SQL aggregate exactly as much as the other
      // two, and admitting it here is what "aggregate-only" was always
      // supposed to mean rather than a `count`/`sum`-only accident of which
      // two functions happened to be needed first.
      const aggregateOnly = items.length > 0 && items.every((c) => /\b(count|sum|min)\s*\(/i.test(c));
      const touchesPerson = /person_id|thread_id|\btitle\b|\bf\.\*|content|message_text/i.test(selectList);
      if (!aggregateOnly || touchesPerson) offenders.push(f + ":non-aggregate-read");
    }
  }
  ok("no file outside the allowed set reads the Room's follower/thread tables",
    offenders.length === 0, offenders.join(","));
  const erasureSrc = fs.readFileSync(join(REPO, "api/_replica-full-erasure.js"), "utf8");
  const erasureLines = erasureSrc
    .split("\n")
    .filter((l) => l.includes("vy_room_thread") || l.includes("vy_room_follower"));
  ok("the erasure job's only touch of those tables is a delete",
    erasureLines.length > 0 && erasureLines.every((l) => /delete from/i.test(l)));

  // WS-R40, migration 102. `vy_room_arrival` carries no person column by
  // construction (that migration's own header) — it is not the follower/
  // thread scan above's business — but it is still part of the Room's
  // public surface, so it gets the same discipline: a closed set of files
  // may touch it at all, and every SELECT naming it must be aggregate-only,
  // never a per-row read. `_room-surface.js` (the one upsert,
  // `recordRoomArrival`) and `_replica-full-erasure.js` (the delete,
  // child-before-parent alongside its siblings) may write or delete;
  // `_funnel.js`'s `shareArrivalsThisWeek` is the one aggregate reader.
  const ARRIVAL_WRITE_OR_DELETE = new Set(["_room-surface.js", "_replica-full-erasure.js"]);
  const ARRIVAL_AGGREGATE_ONLY = new Set(["_funnel.js"]);
  const arrivalOffenders = [];
  for (const f of fs.readdirSync(join(REPO, "api"))) {
    if (!f.endsWith(".js")) continue;
    const src = fs.readFileSync(join(REPO, "api", f), "utf8");
    if (!src.includes("vy_room_arrival")) continue;
    if (ARRIVAL_WRITE_OR_DELETE.has(f)) continue; // proven a write/delete below, never a creator-facing read
    if (!ARRIVAL_AGGREGATE_ONLY.has(f)) { arrivalOffenders.push(f); continue; }
    const stmts = (src.match(/`[^`]*vy_room_arrival[^`]*`/g) || [])
      .filter((st) => /\bfrom\s+vy_room_arrival\b/i.test(st));
    if (!stmts.length) { arrivalOffenders.push(f + ":no-statement-found"); continue; }
    for (const st of stmts) {
      const selectList = (st.match(/select([\s\S]*?)\sfrom\s/i) || [, ""])[1];
      const items = []; let depth = 0, cur = "";
      for (const ch of selectList) {
        if (ch === "(") depth++; else if (ch === ")") depth--;
        if (ch === "," && depth === 0) { items.push(cur); cur = ""; } else cur += ch;
      }
      if (cur.trim()) items.push(cur);
      const aggregateOnly = items.length > 0 && items.every((c) => /\b(count|sum|min|coalesce)\s*\(/i.test(c));
      if (!aggregateOnly) arrivalOffenders.push(f + ":non-aggregate-read");
    }
  }
  ok("no file outside the allowed set reads vy_room_arrival except an aggregate-only count",
    arrivalOffenders.length === 0, arrivalOffenders.join(","));

  const arrivalWriteSrc = fs.readFileSync(join(REPO, "api/_room-surface.js"), "utf8");
  ok("the arrival write is exactly one insert ... on conflict upsert",
    /insert into vy_room_arrival[\s\S]{0,200}on conflict \(room_id, day, via\) do update/.test(arrivalWriteSrc));

  const arrivalErasureLines = erasureSrc
    .split("\n")
    .filter((l) => l.includes("vy_room_arrival"));
  ok("the erasure job's only touch of vy_room_arrival is a delete",
    arrivalErasureLines.length > 0 && arrivalErasureLines.every((l) => /delete from/i.test(l)));
}

// ═════════════════════════════════════════════════════════════════════════
// LAYER 2 & 3 — RETRIEVAL + BOUNDARY. N followers x T turns, through the
// REAL follower lane and the REAL compiler, at N in {2, 5, 20}.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── layer 2/3: retrieval + boundary, N followers x T turns ──");

const { loadAgent } = await loadFixtureAgent(REPO);
const TURNS_PER_FOLLOWER = 4;
const WORLD_SIZES = [2, 5, 20];

const uid = (i) => `10000000-0000-4000-a000-${String(i).padStart(12, "0")}`;
const pid = (i) => `20000000-0000-4000-a000-${String(i).padStart(12, "0")}`;
const factToken = (i) => `TOKFACT_${i}_${"x".repeat(8)}`;
const msgToken = (i, t) => `TOKMSG_${i}_${t}_${"y".repeat(8)}`;

// A "compliant" recall: person AND agent equality over the shared fixture
// fact table — the structural guarantee `disclosurePredicate`'s (2b) branch
// gives an uncited, DM-scoped fact. This is a FAKE, not the real SQL (see the
// header); its own negative control (layer 4) proves it is not vacuously safe.
function scopedRecall(state) {
  return async (personId, agentId) => {
    return state.facts.filter((f) => f.person_id === personId && f.agent_id === agentId);
  };
}

/** The one scan function, used by every layer that scans text for a token it
 *  must not contain — the main N-follower sweep AND both negative controls,
 *  so a control that "catches a leak" is provably using the SAME detector the
 *  main battery relies on, not a second, more sensitive one built just to
 *  pass. Returns the tokens actually found. */
function leakedTokens(haystack, tokens) {
  return tokens.filter((tok) => haystack.includes(tok));
}

async function runWorld(N) {
  const state = freshState();
  const db = fakeDb(state);

  // Pre-seed persons/accounts directly rather than relying on fakeDb's
  // fallback bridge derivation, so ids are predictable for token assertions.
  for (let i = 0; i < N; i++) {
    state.persons.push({ person_id: pid(i), age_tier: "unverified" });
    state.accounts.push({ auth_user_id: uid(i), person_id: pid(i) });
    // The seeded long-term fact, standing in for consolidated memory: a real
    // Room never writes vy_fact from `roomSay` (consolidation is a separate
    // scheduled job), so pre-seeding here is the honest shape of "a follower
    // who has talked before", not a shortcut around the write path.
    state.facts.push({ person_id: pid(i), agent_id: AGENT_ID, body: `note: ${factToken(i)}` });
  }

  const sessions = [];
  for (let i = 0; i < N; i++) {
    const joined = await joinRoom(
      db,
      { slug: SLUG, authUserId: uid(i), ageAttested: true, memoryConsent: true },
      { loadAgent },
    );
    sessions.push(joined.session);
  }

  // device -> turn log, keyed exactly the way the real DM history is: per
  // synthetic device. Distinct followers derive distinct devices by
  // construction (roomThreadDevice's own guarantee, proven in evals/room/
  // run.mjs section 6), so this fake needs no extra isolation logic to be
  // faithful to that half of the shape.
  const turnLog = new Map();
  const memoryFor = (log) => ({
    openEpisode: async () => ({ id: 1, extended: false }),
    logTurn: async ({ device, role, content }) => {
      if (!turnLog.has(device)) turnLog.set(device, []);
      turnLog.get(device).push({ role, content });
    },
    history: async (device) => turnLog.get(device) || [],
    recall: scopedRecall(state),
  });

  const compiledByFollower = Array.from({ length: N }, () => []);
  const violations = [];

  for (let t = 0; t < TURNS_PER_FOLLOWER; t++) {
    for (let i = 0; i < N; i++) {
      let capturedFacts = null;
      const memory = memoryFor();
      const wrappedMemory = {
        ...memory,
        recall: async (personId, agentId) => {
          capturedFacts = await memory.recall(personId, agentId);
          return capturedFacts;
        },
      };
      let compiled = null;
      const turn = await roomSay(
        db,
        { session: sessions[i], message: `q${t}: ${msgToken(i, t)}` },
        {
          loadAgent,
          memory: wrappedMemory,
          reply: (c) => {
            compiled = c;
            return "acknowledged, noted for next time.";
          },
        },
      );
      sessions[i] = turn.session;
      compiledByFollower[i].push({ turn: t, system: compiled?.system ?? "", facts: capturedFacts ?? [] });
    }
  }

  // ── the scan: every follower's every turn, against every OTHER follower's
  // tokens, across three surfaces. This is the row-by-scenario count.
  for (let i = 0; i < N; i++) {
    const others = [];
    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      others.push(factToken(j));
      for (let t = 0; t < TURNS_PER_FOLLOWER; t++) others.push(msgToken(j, t));
    }
    for (const rec of compiledByFollower[i]) {
      const factsText = JSON.stringify(rec.facts);
      rowChecks += others.length * 2;
      for (const tok of leakedTokens(rec.system, others)) {
        violations.push({ follower: i, turn: rec.turn, surface: "compiled", tok });
      }
      for (const tok of leakedTokens(factsText, others)) {
        violations.push({ follower: i, turn: rec.turn, surface: "recall", tok });
      }
    }
  }
  ok(`N=${N}: zero cross-follower leaks across ${TURNS_PER_FOLLOWER} turns each`,
    violations.length === 0,
    violations.length ? `first: ${JSON.stringify(violations[0])}` : "");

  // ── own-turn sanity: a follower's OWN compiled prompt does carry their own
  // fact — otherwise the scan above would be vacuously clean because nothing
  // is ever retrieved at all (`sound-gate-proved-by-silence`).
  const ownFactSeen = compiledByFollower[0].some((r) =>
    JSON.stringify(r.facts).includes(factToken(0)),
  );
  ok(`N=${N}: follower 0's own fact IS retrieved into their own turn (the scan is not vacuous)`,
    ownFactSeen);

  // ── BOUNDARY: creator's sheet is byte-identical after every follower's
  // turns. The follower lane has no reachable writer to it (layer 1), and
  // this is the behavioural half of that same claim.
  const { SHEET } = await loadFixtureAgent(REPO);
  boundaryChecks++;
  ok(`N=${N}: the creator's sheet carries no follower token after ${N * TURNS_PER_FOLLOWER} turns`,
    !Object.values(SHEET).some((v) => typeof v === "string" && /TOKFACT_|TOKMSG_/.test(v)));

  // ── BOUNDARY: export for each follower contains only their own tokens.
  const personTables = async () => [
    { table: "vy_fact", key: "person_id", lane: "relational", agent: true },
  ];
  for (let i = 0; i < N; i++) {
    const dump = await roomExport(db, { session: sessions[i] }, { loadAgent, personTables });
    const dumped = JSON.stringify(dump.tables);
    boundaryChecks++;
    ok(`N=${N} follower ${i}: export carries their own fact token`, dumped.includes(factToken(i)));
    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      boundaryChecks++;
      if (dumped.includes(factToken(j))) {
        ok(`N=${N} follower ${i}: export does NOT carry follower ${j}'s token`, false);
      }
    }
  }
  ok(`N=${N}: every follower's export stayed inside their own scope`, true);

  // ── BOUNDARY: forget for follower 0 removes their token from every LATER
  // compile and leaves everyone else's untouched, including a re-join.
  const receipt = await roomForget(db, { session: sessions[0] }, { loadAgent, personTables });
  boundaryChecks++;
  ok(`N=${N}: forget for follower 0 deletes exactly their own fact row`,
    receipt.deleted.vy_fact === 1 && state.facts.filter((f) => f.person_id === pid(0)).length === 0);
  boundaryChecks++;
  ok(`N=${N}: forget leaves the other ${N - 1} followers' facts standing`,
    state.facts.length === N - 1);

  const rejoined = await joinRoom(
    db,
    { slug: SLUG, authUserId: uid(0), ageAttested: true, memoryConsent: true },
    { loadAgent },
  );
  let rejoinCompiled = null;
  await roomSay(
    db,
    { session: rejoined.session, message: "hello again" },
    {
      loadAgent,
      memory: memoryFor(),
      reply: (c) => {
        rejoinCompiled = c;
        return "hi.";
      },
    },
  );
  boundaryChecks++;
  ok(`N=${N}: after forget, follower 0's re-joined compile carries no pre-forget token`,
    !(rejoinCompiled?.system ?? "").includes(factToken(0)));

  // Per follower: T turns, each scanned against (N-1) other followers' tokens
  // (1 fact + T messages each), on 2 surfaces (compiled prompt + recall).
  const tokensPerOther = 1 + TURNS_PER_FOLLOWER;
  const checks = N * TURNS_PER_FOLLOWER * (N - 1) * tokensPerOther * 2;
  return { followers: N, turns: N * TURNS_PER_FOLLOWER, checks };
}

const worldSummaries = [];
for (const N of WORLD_SIZES) {
  worldSummaries.push(await runWorld(N));
}

// ═════════════════════════════════════════════════════════════════════════
// LAYER 4 — NEGATIVE CONTROLS. Both MUST fail the scan below, or this
// battery has proven nothing (`sound-gate-proved-by-silence`).
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── layer 4: negative controls (both MUST leak) ──");

// Control 1: the person clause struck from a COPY of the recall path — the
// same technique evals/room/run.mjs section 6 uses on the real SQL text,
// applied here to the fake's structural equivalent of it.
{
  const state = freshState();
  const db = fakeDb(state);
  for (let i = 0; i < 2; i++) {
    state.persons.push({ person_id: pid(i), age_tier: "unverified" });
    state.accounts.push({ auth_user_id: uid(i), person_id: pid(i) });
    state.facts.push({ person_id: pid(i), agent_id: AGENT_ID, body: `note: ${factToken(i)}` });
  }
  const joinedA = await joinRoom(
    db, { slug: SLUG, authUserId: uid(0), ageAttested: true, memoryConsent: true }, { loadAgent },
  );
  const joinedB = await joinRoom(
    db, { slug: SLUG, authUserId: uid(1), ageAttested: true, memoryConsent: true }, { loadAgent },
  );
  // THE STRIKE: agent equality kept, person equality removed — every fact
  // for this creator, regardless of whose it is.
  const unscopedRecall = async (_personId, agentId) =>
    state.facts.filter((f) => f.agent_id === agentId);

  let compiledB = null;
  await roomSay(
    db,
    { session: joinedB.session, message: "hi" },
    {
      loadAgent,
      memory: { openEpisode: async () => ({}), logTurn: async () => {}, history: async () => [],
        recall: unscopedRecall },
      reply: (c) => {
        compiledB = c;
        return "ok";
      },
    },
  );
  const leaked = leakedTokens(compiledB?.system ?? "", [factToken(0)]);
  ok("NEGATIVE CONTROL 1: striking the person clause from recall DOES leak A's fact to B",
    leaked.length > 0, leaked.length ? "" : "control did not fire — the scan above would prove nothing");
  void joinedA;
}

// Control 2: a "helpful" reply that pastes another follower's actual words in
// as an example — run through the REAL `roomSay`, not a standalone string, so
// this proves two things at once: the SCANNER catches a real leak when one is
// deliberately produced (`sound-gate-proved-by-silence`), and the follower
// lane's reply path does NOT itself scrub cross-follower content — retrieval
// isolation (layer 2/3) is the load-bearing mechanism, not a filter on the
// way out, which is why a leak that reached the reply stage at all would not
// be caught by anything downstream of it in production either.
{
  const state = freshState();
  const db = fakeDb(state);
  for (let i = 0; i < 2; i++) {
    state.persons.push({ person_id: pid(i), age_tier: "unverified" });
    state.accounts.push({ auth_user_id: uid(i), person_id: pid(i) });
    state.facts.push({ person_id: pid(i), agent_id: AGENT_ID, body: `note: ${factToken(i)}` });
  }
  const joinedB = await joinRoom(
    db, { slug: SLUG, authUserId: uid(1), ageAttested: true, memoryConsent: true }, { loadAgent },
  );
  // THE HELPFUL AGGREGATION: a reply function that ignores what it was
  // compiled from and pastes follower A's real token in as "an example" —
  // exactly the failure shape the brief names.
  const turn = await roomSay(
    db,
    { session: joinedB.session, message: "hi" },
    {
      loadAgent,
      memory: { openEpisode: async () => ({}), logTurn: async () => {}, history: async () => [], recall: async () => [] },
      reply: () => `for example, another user once said: "note: ${factToken(0)}"`,
    },
  );
  const caught = leakedTokens(turn.reply ?? "", [factToken(0)]);
  ok("NEGATIVE CONTROL 2: the scanner catches a reply that pastes another follower's words in as an example",
    caught.length > 0, caught.length ? "" : "control did not fire — the scan above would prove nothing");
}

// ═════════════════════════════════════════════════════════════════════════
// LAYER 5 — PULSE (WS-R17). The plan's own warning: "Pulse is the write-path
// leak in a dashboard costume." Section (1c) above already proves NOTHING
// reached the creator before this feature existed; this proves that now that
// it does, every unique follower token from a real N-follower world is
// absent from every row `computeSnapshot` writes AND from the owner's own
// `readPulse` - the SAME `leakedTokens` scanner layer 2/3 uses above, so a
// "catch" here is provably the same detector rather than a second, more
// forgiving one built just to pass.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── layer 5: pulse (opt-in counts never carry a follower token) ──");
{
  const { freshPulseState, pulseDb } = await import(pathToFileURL(join(REPO, "evals/pulse/fixtures.mjs")).href);
  const { setOptIn, setTopics, computeSnapshot, readPulse } = await import(
    pathToFileURL(join(REPO, "api/_pulse.js")).href
  );
  const { createThread, readRoomSession } = room;

  const state = freshPulseState(freshState());
  const db = pulseDb(state, fakeDb(state));
  const N = 5;
  const pulseUid = (i) => `40000000-0000-4000-a000-${String(i).padStart(12, "0")}`;
  const pulseToken = (i) => `TOKPULSE_${i}_${"w".repeat(8)}`;

  await setTopics(db, OWNER, REPLICA_ID, ["fitness"]);
  const allTokens = [];
  for (let i = 0; i < N; i++) {
    const tok = pulseToken(i);
    allTokens.push(tok);
    const joined = await joinRoom(
      db, { slug: SLUG, authUserId: pulseUid(i), ageAttested: true, memoryConsent: true }, { loadAgent },
    );
    const payload = readRoomSession(joined.session);
    const thread = await createThread(db, {
      roomId: ROOM_ID, personId: payload.p, agentId: AGENT_ID, title: `fitness ${tok}`,
    });
    await setOptIn(db, { session: joined.session, threadId: thread.thread_id }, { loadAgent });
  }

  const snapshot = await computeSnapshot(db, ROOM_ID, "2026-09-07");
  boundaryChecks++;
  ok("pulse: computeSnapshot produced the expected one bucket at 5",
    snapshot.buckets.length === 1 && snapshot.buckets[0].follower_count === 5);

  const snapshotLeaks = leakedTokens(JSON.stringify(snapshot), allTokens);
  boundaryChecks++;
  ok("pulse: every unique follower token is absent from computeSnapshot's own return value",
    snapshotLeaks.length === 0, snapshotLeaks.join(","));
  const snapshotTableLeaks = leakedTokens(JSON.stringify(state.pulseSnapshots), allTokens);
  boundaryChecks++;
  ok("pulse: every unique follower token is absent from the snapshot TABLE itself",
    snapshotTableLeaks.length === 0, snapshotTableLeaks.join(","));

  const owner = await readPulse(db, OWNER, REPLICA_ID);
  const ownerLeaks = leakedTokens(JSON.stringify(owner), allTokens);
  boundaryChecks++;
  ok("pulse: every unique follower token is absent from the owner's OWN readPulse",
    ownerLeaks.length === 0, ownerLeaks.join(","));

  // Sanity: the scan above is not vacuous - the tokens really are present
  // SOMEWHERE in this world (the threads themselves), so an empty-everywhere
  // world is not silently passing by having nothing to find at all.
  const rawWorldHasTokens = leakedTokens(JSON.stringify(state.threads), allTokens).length === allTokens.length;
  boundaryChecks++;
  ok("pulse: the scan is not vacuous - every token really is present in the raw thread titles",
    rawWorldHasTokens);
}

// ═════════════════════════════════════════════════════════════════════════
// LAYER 6 — HANDOFF (WS-R20, migration 083). The one Room table that
// deliberately holds a follower's own words (083's own header names the
// exception). This layer proves the class the workstream brief names:
// HANDOFF_CONSENTED_ONLY - the only creator-facing SELECT of a follower's
// text joins on `payload_sha256 = encode(digest(payload_text,'sha256'),
// 'hex')` and `state = 'sent'`, plus a world check that no unrequested
// message ever appears in any creator read.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── layer 6: handoff (consented-only creator read) ──");

// (6a) STATIC. The owner-facing functions' own source, read off the file
// rather than retyped, `(1b)`'s own technique one file over: a change to the
// shipping predicate is a change this suite sees.
{
  const handoffSrc = fs.readFileSync(join(REPO, "api/_handoff.js"), "utf8");
  const fnBody = (name) => {
    const m = handoffSrc.match(new RegExp(`export async function ${name}\\([\\s\\S]*?\\n}\\n`));
    return m ? m[0] : "";
  };
  const HASH_PREDICATE = "payload_sha256 = encode(digest(payload_text, 'sha256'), 'hex')";

  const queueBody = fnBody("handoffQueue");
  ok("handoffQueue is found in api/_handoff.js (not moved/renamed)", Boolean(queueBody));
  ok("handoffQueue's read of payload_text carries the CONSENTED_ONLY predicate (hash-match AND state='sent')",
    queueBody.includes(HASH_PREDICATE) && queueBody.includes("state = 'sent'"));

  const answerBody = fnBody("answerHandoff");
  ok("answerHandoff is found in api/_handoff.js (not moved/renamed)", Boolean(answerBody));
  ok("answerHandoff's WRITE to a follower's request carries the SAME predicate as the read - not a weaker cousin of it",
    answerBody.includes(HASH_PREDICATE) && answerBody.includes("state = 'sent'"));

  // Repo-wide: no file outside Handoff's own lane (and the two places that
  // touch this table only to DELETE it wholesale) ever names vy_room_handoff
  // - a new creator-facing reader added later must fail this line the day it
  // is written without also updating it, (1c)'s own ALLOWED-set shape.
  const ALLOWED = new Set(["_handoff.js", "handoff.js"]);
  const DELETE_ONLY = new Set(["_replica-full-erasure.js", "_room-surface.js", "memory.js"]);
  const offenders = [];
  for (const f of fs.readdirSync(join(REPO, "api"))) {
    if (!f.endsWith(".js") || ALLOWED.has(f)) continue;
    const src = fs.readFileSync(join(REPO, "api", f), "utf8");
    if (!src.includes("vy_room_handoff")) continue;
    if (!DELETE_ONLY.has(f)) { offenders.push(f); continue; }
    const lines = src.split("\n").filter((l) => l.includes("vy_room_handoff"));
    // memory.js only ever names the table in a manifest ENTRY (an object
    // literal, `{ table: "vy_room_handoff", ... }` or a bare string in
    // REPLICA_PERSON_TABLES) or a comment. _room-surface.js's `roomForget`
    // only ever names it in the migration-applied GUARD around its own
    // delete, the count it assigns off that delete's result, or a comment -
    // never a SELECT and never anything that could return `payload_text` or
    // `reply_text`.
    const SAFE_LINE = new RegExp(
      "delete from|table:\\s*\"vy_room_handoff\"|^\\s*\"vy_room_handoff\",?\\s*$|^\\s*//" +
        "|isTableAppliedFor\\(deps\\)\\(\"vy_room_handoff\"\\)|deleted\\.vy_room_handoff\\s*=",
    );
    const badLines = lines.filter((l) => !SAFE_LINE.test(l.trim()));
    if (badLines.length) offenders.push(`${f}:${badLines.join("|")}`);
  }
  ok("no file outside Handoff's own lane reads or writes vy_room_handoff (delete-only or manifest-entry-only elsewhere)",
    offenders.length === 0, offenders.join(","));
}

// (6b) WORLD CHECK. A real multi-follower world through the REAL handoff
// module and its own fixture (evals/handoff/fixtures.mjs, wrapping THIS
// suite's own fakeDb) - every legitimately sent request is admitted, a
// tampered one is refused by the SAME predicate the static check just read,
// and a follower's ordinary chat message that was never submitted through
// send() is proven absent from every creator-facing read, `leakedTokens`
// (this file's own scanner, not a second one built to pass).
{
  process.env.ROOM_SESSION_SECRET = process.env.ROOM_SESSION_SECRET || "r".repeat(48);
  const { freshHandoffState, handoffDb } = await import(pathToFileURL(join(REPO, "evals/handoff/fixtures.mjs")).href);
  const { setHandoffConfig, sendHandoffRequest, handoffQueue, answerHandoff } = await import(
    pathToFileURL(join(REPO, "api/_handoff.js")).href
  );
  const { createHash } = await import("node:crypto");
  const sha256Hex = (s) => createHash("sha256").update(String(s), "utf8").digest("hex");

  const state = freshHandoffState(freshState());
  const db = handoffDb(state, fakeDb(state));
  const N = 4;
  const hUid = (i) => `50000000-0000-4000-a000-${String(i).padStart(12, "0")}`;
  const askToken = (i) => `TOKHANDOFF_${i}_${"z".repeat(8)}`;
  const chatToken = (i) => `TOKHANDOFFCHAT_${i}_${"v".repeat(8)}`;

  await setHandoffConfig(db, OWNER, REPLICA_ID, { enabled: true, monthlyCap: 10 });
  const sessions = [];
  for (let i = 0; i < N; i++) {
    const joined = await joinRoom(db, { slug: SLUG, authUserId: hUid(i), ageAttested: true, memoryConsent: true }, { loadAgent });
    sessions.push(joined.session);
  }
  const sent = [];
  for (let i = 0; i < N; i++) {
    sent.push(await sendHandoffRequest(
      db, { session: sessions[i], payloadText: askToken(i), payloadSha256: sha256Hex(askToken(i)) }, { loadAgent },
    ));
  }
  // An UNREQUESTED chat token per follower - never touches vy_room_handoff at
  // all. Seeded into the fixture's own `state` directly, standing in for an
  // ordinary DM turn the way layer 2/3's own `msgToken` does.
  state.unrequestedChat = Array.from({ length: N }, (_, i) => chatToken(i));

  // Tamper follower 1's stored text without touching its hash - the offline
  // suite's own negative control (a), re-proven here through the room-leak
  // battery's own scanner rather than a second one built just to pass.
  const tampered = state.roomHandoffs.find((h) => h.handoff_id === sent[1].handoff_id);
  tampered.payload_text = "an attacker's substituted words, never consented to";

  // Drain the queue exactly as the owner's client would: read `next`, answer
  // it, repeat - proving every LEGITIMATE token surfaces exactly once and the
  // tampered one never does, across the WHOLE creator-facing surface rather
  // than one snapshot read.
  const seenInQueue = [];
  for (let guard = 0; guard < N + 2; guard++) {
    const q = await handoffQueue(db, OWNER, REPLICA_ID);
    if (!q.next) break;
    seenInQueue.push(q.next.payload_text);
    await answerHandoff(db, OWNER, REPLICA_ID, q.next.handoff_id, { replyText: `answered: ${q.next.payload_text.slice(0, 20)}` });
  }
  boundaryChecks++;
  ok("handoff: every LEGITIMATE follower's ask surfaced in the queue exactly once (3 of 4 - follower 1's is tampered)",
    seenInQueue.length === N - 1 &&
      [0, 2, 3].every((i) => seenInQueue.includes(askToken(i))));
  boundaryChecks++;
  ok("handoff: the tampered follower's ask NEVER surfaced in the queue, drained or not",
    !seenInQueue.includes(askToken(1)));

  const finalQueue = await handoffQueue(db, OWNER, REPLICA_ID);
  boundaryChecks++;
  ok("handoff: after draining, the tampered row is STILL the only one left unanswerable (queue empty, not stuck open)",
    finalQueue.next === null);

  const allTokensRaw = [...Array.from({ length: N }, (_, i) => askToken(i)), ...state.unrequestedChat];
  const creatorSurface = JSON.stringify({ finalQueue, seenInQueue, roomHandoffs: state.roomHandoffs });
  boundaryChecks++;
  ok("handoff: no UNREQUESTED chat token ever reaches any creator-facing surface, including the raw table",
    leakedTokens(creatorSurface, state.unrequestedChat).length === 0);
  boundaryChecks++;
  ok("handoff: the scan above is not vacuous - the unrequested tokens really do exist somewhere in this world",
    leakedTokens(JSON.stringify(state.unrequestedChat), state.unrequestedChat).length === N);
  boundaryChecks++;
  ok("handoff: the tampered follower's SUBSTITUTED text never reached the queue's own output either",
    leakedTokens(JSON.stringify(seenInQueue), ["substituted words"]).length === 0);

  rowChecks += allTokensRaw.length * 2;
}

// ═════════════════════════════════════════════════════════════════════════
// LAYER 7 — TASTE (WS-R53, migration 110). A stranger's three questions
// before the sign-in wall. This layer proves the class the workstream brief
// names: the taste is a GUEST lane, stateless across calls by construction,
// with the follower lane's own writer functions UNREACHABLE from it - the
// SAME bar layer 1a already holds the follower lane to for creator-material
// writers, pointed the other direction and read off `api/_room-taste.js`'s
// own source rather than asserted.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── layer 7: taste (guest lane, no follower writer reachable) ──");

// (7a) STATIC. `api/_room-taste.js`'s own import lines, read off the real
// source - not a description of what the file is SUPPOSED to import, a scan
// of what it ACTUALLY does, so a later edit that adds one write-shaped
// import fails this line the day it lands.
{
  const tasteSrc = fs.readFileSync(join(REPO, "api/_room-taste.js"), "utf8");

  // The whole file may import from only these three - `_surface.js` (no
  // database at all, by that file's own header: "this file has no database
  // and must keep none"), `_room-surface.js` (the follower lane's own file,
  // narrowed below to a closed read-only allowlist) and `memory.js`
  // (narrowed below to the one pure read helper). No direct import of
  // `episodes.js`, `_phase-gate.js`, `_pulse.js`, `_room-push.js`,
  // `_room-whatsapp.js`, `_handoff.js`, `_room-voice.js` or `_db.js` -
  // every one of those either owns a follower writer or a live connection
  // this stateless lane has no business holding.
  const importedFiles = [...tasteSrc.matchAll(/from\s+"\.\/(_?[\w.-]+\.js)"/g)].map((m) => m[1]);
  const ALLOWED_TASTE_IMPORT_FILES = new Set(["_surface.js", "_room-surface.js", "memory.js"]);
  ok("api/_room-taste.js imports from a closed set of files only (no direct import of a writer-owning or db-holding file)",
    importedFiles.length > 0 && importedFiles.every((f) => ALLOWED_TASTE_IMPORT_FILES.has(f)),
    importedFiles.join(","));

  const importsFrom = (spec) => {
    const m = tasteSrc.match(new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s+"\\./${spec}"`));
    return m ? m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean) : [];
  };

  // From `_room-surface.js`: a closed allowlist, every one of them a string
  // function, an error constructor, or a SELECT-only resolver - never a
  // mint, a session reader, or anything that touches `vy_room_follower`,
  // `vy_room_thread`, `vy_fact`, `vy_episode` or a consent ledger.
  const ALLOWED_FROM_ROOM_SURFACE = new Set([
    "RoomError", "roomUnavailable", "resolveRoom", "roomNameFor",
    "roomDisclosureCard", "normalizeLocale", "collector", "ROOM_INBOUND_LIMIT",
  ]);
  const gotFromRoomSurface = importsFrom("_room-surface\\.js");
  const disallowedFromRoomSurface = gotFromRoomSurface.filter((n) => !ALLOWED_FROM_ROOM_SURFACE.has(n));
  ok("api/_room-taste.js imports ONLY the closed read-only/pure allowlist from _room-surface.js",
    gotFromRoomSurface.length > 0 && disallowedFromRoomSurface.length === 0, disallowedFromRoomSurface.join(","));

  // From `memory.js`: the one pure read helper every migration-gated write
  // in this codebase already uses (`isTableAppliedFor`'s own shape,
  // api/_room-surface.js), never a writer.
  const gotFromMemory = importsFrom("memory\\.js");
  ok("api/_room-taste.js imports ONLY tableApplied from memory.js",
    JSON.stringify(gotFromMemory) === JSON.stringify(["tableApplied"]));

  // DERIVED, not asserted: the same fixed-point technique (1a) uses,
  // applied to `_room-surface.js`'s OWN exports this time, against the
  // FOLLOWER tables rather than the creator ones - so a function on the
  // allowlist above that becomes dangerous later (a body edited to write
  // one of these tables, directly or through a local call chain) fails
  // this line the day it happens, without this suite needing to know why.
  const FOLLOWER_TABLES = ["vy_room_follower", "vy_room_thread", "vy_fact", "vy_episode", "meera_log", "meera_consent"];
  const FOLLOWER_WRITE_RE = new RegExp(`\\b(?:insert into|update)\\s+(?:${FOLLOWER_TABLES.join("|")})\\b`);
  const roomSurfaceSrc = fs.readFileSync(join(REPO, "api/_room-surface.js"), "utf8");
  const fnMarks = [...roomSurfaceSrc.matchAll(/^(export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gm)];
  const fns = fnMarks.map((m, i) => ({
    name: m[2],
    body: roomSurfaceSrc.slice(m.index, i + 1 < fnMarks.length ? fnMarks[i + 1].index : roomSurfaceSrc.length),
  }));
  const dangerous = new Set(fns.filter((fn) => FOLLOWER_WRITE_RE.test(fn.body)).map((fn) => fn.name));
  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of fns) {
      if (dangerous.has(fn.name)) continue;
      for (const otherName of dangerous) {
        if (new RegExp(`\\b${otherName}\\s*\\(`).test(fn.body)) {
          dangerous.add(fn.name);
          changed = true;
          break;
        }
      }
    }
  }
  ok(`derived ${dangerous.size} follower-scope writer symbols from api/_room-surface.js's own source`,
    dangerous.size >= 5, [...dangerous].join(","));
  const stillSafe = gotFromRoomSurface.filter((n) => dangerous.has(n));
  ok("none of _room-taste.js's own imports from _room-surface.js are among the derived follower-writer symbols",
    stillSafe.length === 0, stillSafe.join(","));
}

// (7b) The table-touch scan, `vy_room_arrival`'s own precedent (migration
// 102's block above) one table over: a closed set of files may write or
// delete `vy_room_taste_turn`, and the one other reader must be
// aggregate-only.
{
  const WRITE_OR_DELETE = new Set(["_room-taste.js", "_replica-full-erasure.js"]);
  const AGGREGATE_ONLY = new Set(["_funnel.js"]);
  const offenders = [];
  for (const f of fs.readdirSync(join(REPO, "api"))) {
    if (!f.endsWith(".js")) continue;
    const src = fs.readFileSync(join(REPO, "api", f), "utf8");
    if (!src.includes("vy_room_taste_turn")) continue;
    if (WRITE_OR_DELETE.has(f)) continue;
    if (!AGGREGATE_ONLY.has(f)) { offenders.push(f); continue; }
    const stmts = (src.match(/`[^`]*vy_room_taste_turn[^`]*`/g) || [])
      .filter((st) => /\bfrom\s+vy_room_taste_turn\b/i.test(st));
    if (!stmts.length) { offenders.push(f + ":no-statement-found"); continue; }
    for (const st of stmts) {
      const selectList = (st.match(/select([\s\S]*?)\sfrom\s/i) || [, ""])[1];
      const items = []; let depth = 0, cur = "";
      for (const ch of selectList) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && depth === 0) { items.push(cur.trim()); cur = ""; } else cur += ch;
      }
      if (cur.trim()) items.push(cur.trim());
      const aggregateOnly = items.length > 0 && items.every((c) => /\b(count|sum|min|coalesce)\s*\(/i.test(c));
      if (!aggregateOnly) offenders.push(f + ":non-aggregate-read");
    }
  }
  ok("no file outside the allowed set reads vy_room_taste_turn except an aggregate-only sum",
    offenders.length === 0, offenders.join(","));

  const writeSrc = fs.readFileSync(join(REPO, "api/_room-taste.js"), "utf8");
  ok("the taste-turn counter write is exactly one insert ... on conflict upsert",
    /insert into vy_room_taste_turn[\s\S]{0,200}on conflict \(room_id, day\) do update/.test(writeSrc));

  const erasureLines = fs.readFileSync(join(REPO, "api/_replica-full-erasure.js"), "utf8")
    .split("\n")
    .filter((l) => l.includes("vy_room_taste_turn"));
  ok("the erasure job's only touch of vy_room_taste_turn is a delete",
    erasureLines.length > 0 && erasureLines.every((l) => /delete from/i.test(l)));
}

// (7c) WORLD CHECK. N strangers taking taste turns and M real followers
// talking, through the REAL `roomTaste` and `roomSay` over the SAME fake
// world - every taste reply is scanned for every follower's own tokens, and
// the follower/thread/fact tables are proven byte-for-byte unchanged by any
// taste turn (the behavioural half of (7a)'s static claim).
{
  const { roomTaste, ROOM_TASTE_TURNS } = await import(pathToFileURL(join(REPO, "api/_room-taste.js")).href);
  const state = freshState();
  const db = fakeDb(state);

  const followerUid = (i) => `60000000-0000-4000-a000-${String(i).padStart(12, "0")}`;
  const followerToken = (i) => `TOKFOLLOWER_${i}_${"w".repeat(8)}`;
  const M = 3;
  for (let i = 0; i < M; i++) {
    const joined = await joinRoom(db, { slug: SLUG, authUserId: followerUid(i), ageAttested: true, memoryConsent: true }, { loadAgent });
    await roomSay(db, { session: joined.session, message: `my own secret: ${followerToken(i)}` }, {
      loadAgent, memory: { openEpisode: async () => ({}), logTurn: async () => {}, history: async () => [], recall: async () => [] },
      reply: () => "noted.",
    });
  }
  const followersBefore = JSON.stringify(state.followers);
  const threadsBefore = JSON.stringify(state.threads);
  const factsBefore = JSON.stringify(state.facts);

  const strangerToken = (i, t) => `TOKSTRANGER_${i}_${t}_${"u".repeat(8)}`;
  const allFollowerTokens = Array.from({ length: M }, (_, i) => followerToken(i));
  const N_STRANGERS = 5;
  const violations = [];
  let disclosureOnTurnOneCount = 0;
  for (let i = 0; i < N_STRANGERS; i++) {
    for (let t = 1; t <= ROOM_TASTE_TURNS; t++) {
      const turn = await roomTaste(db, {
        slug: SLUG, message: `taste q${t}: ${strangerToken(i, t)}`, turnIndex: t,
      }, {
        loadAgent, tableApplied: () => false,
        reply: () => "acknowledged, noted for next time.",
      });
      rowChecks += allFollowerTokens.length;
      for (const tok of leakedTokens(JSON.stringify(turn), allFollowerTokens)) {
        violations.push({ stranger: i, turn: t, tok });
      }
      if (t === 1) {
        if (turn.disclosure) disclosureOnTurnOneCount++;
        ok(`stranger ${i}, turn 1: carries the disclosure card`, Boolean(turn.disclosure));
      } else {
        ok(`stranger ${i}, turn ${t}: does NOT re-carry the disclosure card`, turn.disclosure === null);
      }
    }
  }
  ok(`N=${N_STRANGERS} strangers x ${ROOM_TASTE_TURNS} taste turns: zero follower-token leaks into any taste reply`,
    violations.length === 0, violations.length ? `first: ${JSON.stringify(violations[0])}` : "");
  ok(`every one of ${N_STRANGERS} strangers saw the disclosure exactly once (turn 1 only)`,
    disclosureOnTurnOneCount === N_STRANGERS);

  boundaryChecks++;
  ok("taste: vy_room_follower is byte-identical before and after every stranger's taste turns",
    JSON.stringify(state.followers) === followersBefore);
  boundaryChecks++;
  ok("taste: vy_room_thread is byte-identical before and after every stranger's taste turns",
    JSON.stringify(state.threads) === threadsBefore);
  boundaryChecks++;
  ok("taste: vy_fact is byte-identical before and after every stranger's taste turns",
    JSON.stringify(state.facts) === factsBefore);

  // `roomTaste` enforces NO ceiling of its own on `turnIndex` - the real
  // refusal is `api/room.js`'s rate gate, BEFORE this function is ever
  // called (`evals/room-taste/run.mjs`'s own §1/§5b), on purpose: a second,
  // hardcoded wall here would drift from an operator's `RATE_LIMITS_JSON`
  // override the day the two stopped agreeing (`ROOM_TASTE_TURNS`'s own
  // comment, api/_room-taste.js). Two things are checked here instead: the
  // function itself answers rather than throws for a turnIndex past the
  // product default (proving there is no drift-prone wall to test), and
  // `turns_left` still clamps at 0 rather than going negative.
  const overLimit = await roomTaste(db, { slug: SLUG, message: "a fourth question", turnIndex: ROOM_TASTE_TURNS + 1 }, {
    loadAgent, tableApplied: () => false, reply: () => "answered anyway - the wall is api/room.js's, not this function's",
  });
  ok("roomTaste itself answers a turnIndex past ROOM_TASTE_TURNS rather than throwing (no drift-prone hardcoded wall)",
    Boolean(overLimit.reply));
  ok("...and turns_left still clamps at 0 rather than going negative",
    overLimit.turns_left === 0);
  const roomJsSrc = fs.readFileSync(join(REPO, "api/room.js"), "utf8");
  const tasteOpBlock = (roomJsSrc.match(/if \(op === "taste"\) \{[\s\S]*?\n    \}/) || [""])[0];
  ok("api/room.js's taste op calls consume() BEFORE roomTaste() - the gate is the enforcement, textually first",
    tasteOpBlock.indexOf("await consume(") >= 0 &&
      tasteOpBlock.indexOf("await consume(") < tasteOpBlock.indexOf("await roomTaste("));
}

// (WS-R53's taste is layer 7 above; the full world is layer 8, renumbered at the merge.)
// LAYER 8 — WS-R68. THE FULL WORLD. Five Rooms, two Suites, 100 followers
// with overlapping memberships, every transport, every lane at once, one
// seeded RNG. `evals/room-leak/world.mjs` is the generator and the driver;
// this section is the assertions, `run.mjs`'s own established convention
// (every layer above calls this SAME module-level `ok`). See that file's own
// header for the world shape and for the fixture-composition ordering hazard
// this workstream found and fixed (pulseDb/handoffDb had never been combined
// before this suite).
// ═════════════════════════════════════════════════════════════════════════
console.log(`\n── layer 8: the full world (WS-R68) — seed ${DEFAULT_SEED} ──`);
{
  const t0 = Date.now();
  const w = await runFullWorld(REPO);
  const { world, state, compiledBy, sessionOf, threadOf, paidFollowers, checkinPicks,
    roomExport, roomForget, roomExportManifest, roomStats, telegramChannelRoom, pulse } = w;

  const key = (i, r) => `${i}:${r}`;
  const allMembershipKeys = world.memberships.map((m) => key(m.followerIdx, m.roomIdx));

  // token -> owning membership key, built once so the O(N^2) scan below is a
  // set-difference per membership rather than a nested re-derivation.
  const tokensOf = new Map();
  for (const m of world.memberships) {
    const k = key(m.followerIdx, m.roomIdx);
    const toks = [`TOKFACT_W_${m.followerIdx}_${m.roomIdx}_xxxxxx`];
    for (let t = 0; t < 3; t++) toks.push(`TOKMSG_W_${m.followerIdx}_${m.roomIdx}_${t}_yyyyyy`);
    tokensOf.set(k, toks);
  }
  const allTokens = [...tokensOf.values()].flat();

  // ── LAW 2 (retrieval): every read a follower's session can make returns
  // only rows keyed to that follower — checked GLOBALLY: a token belonging to
  // ANY other membership (a different follower, OR the SAME person's OTHER
  // Room) must never appear in this membership's compiled prompt or recall.
  let worldViolations = 0;
  let worldRowChecks = 0;
  const firstViolation = [];
  for (const k of allMembershipKeys) {
    const own = new Set(tokensOf.get(k));
    const others = allTokens.filter((tok) => !own.has(tok));
    for (const rec of compiledBy.get(k) || []) {
      worldRowChecks += others.length * 2;
      const factsText = JSON.stringify(rec.facts);
      for (const tok of others) {
        if (rec.system.includes(tok)) { worldViolations++; if (firstViolation.length < 3) firstViolation.push({ k, tok, surface: "compiled" }); }
        if (factsText.includes(tok)) { worldViolations++; if (firstViolation.length < 3) firstViolation.push({ k, tok, surface: "recall" }); }
      }
    }
  }
  ok(`world: zero cross-membership leaks across ${allMembershipKeys.length} memberships x 3 turns (${worldRowChecks} checks)`,
    worldViolations === 0, JSON.stringify(firstViolation));
  rowChecks += worldRowChecks;

  // Sanity: a membership's own fact really is retrieved (not vacuous).
  const sampleKey = key(0, world.followers[0].primaryRoom);
  const sampleOwnSeen = (compiledBy.get(sampleKey) || []).some((r) => JSON.stringify(r.facts).includes(tokensOf.get(sampleKey)[0]));
  ok("world: a sampled membership's OWN fact is retrieved into its own turns (the scan is not vacuous)", sampleOwnSeen);

  // ── the multi-room-per-person case: an overlap follower's TWO Rooms never
  // see each other's content, in the compiled prompt OR in roomExport.
  const overlapSample = [...world.overlapPicks].slice(0, 5);
  for (const i of overlapSample) {
    const f = world.followers[i];
    const kA = key(i, f.primaryRoom);
    const kB = key(i, f.secondaryRoom);
    const dumpA = await roomExport(w.db, { session: sessionOf.get(kA) }, w.deps);
    const dumpB = await roomExport(w.db, { session: sessionOf.get(kB) }, w.deps);
    boundaryChecks += 4;
    ok(`world: follower ${i}'s export of Room A carries Room A's own fact token`,
      JSON.stringify(dumpA.tables).includes(tokensOf.get(kA)[0]));
    ok(`world: follower ${i}'s export of Room A does NOT carry Room B's fact token (same person, different Room)`,
      !JSON.stringify(dumpA.tables).includes(tokensOf.get(kB)[0]));
    ok(`world: follower ${i}'s export of Room B carries Room B's own fact token`,
      JSON.stringify(dumpB.tables).includes(tokensOf.get(kB)[0]));
    ok(`world: follower ${i}'s export of Room B does NOT carry Room A's fact token`,
      !JSON.stringify(dumpB.tables).includes(tokensOf.get(kA)[0]));
  }

  // ── forgetting one Room leaves the SAME person's OTHER Room untouched —
  // the invariant only a multi-Room world can even state, let alone prove.
  for (const i of overlapSample) {
    const f = world.followers[i];
    const kA = key(i, f.primaryRoom);
    const kB = key(i, f.secondaryRoom);
    const personId = state.followers.find((x) => x.follower_id === w.followerIdOf.get(kA))?.person_id;
    const receipt = await roomForget(w.db, { session: sessionOf.get(kA) }, w.deps);
    boundaryChecks += 4;
    ok(`world: follower ${i}'s forget of Room A wrote a receipt naming Room A's own slug`,
      Boolean(receipt.receipt) && receipt.receipt.room === ROOM_DEFS[f.primaryRoom].slug);
    const expectedHash = roomForgetReceiptHash(ROOM_DEFS[f.primaryRoom].room_id, personId, receipt.receipt.policy_version);
    ok(`world: follower ${i}'s receipt hash is scoped by ROOM+person — recomputed for Room A matches, and would differ for Room B`,
      receipt.receipt.person_hash === expectedHash &&
        expectedHash !== roomForgetReceiptHash(ROOM_DEFS[f.secondaryRoom].room_id, personId, receipt.receipt.policy_version));
    const stillHasB = state.facts.some((x) => x.agent_id === ROOM_DEFS[f.secondaryRoom].agent_id &&
      JSON.stringify(x).includes(tokensOf.get(kB)[0]));
    ok(`world: follower ${i}'s Room B fact SURVIVES their Room A forget (per-Room scope, not per-person)`, stillHasB);
    const dumpB = await roomExport(w.db, { session: sessionOf.get(kB) }, w.deps);
    ok(`world: follower ${i}'s Room B export still works after their Room A forget`,
      JSON.stringify(dumpB.tables).includes(tokensOf.get(kB)[0]));

    // ZERO SURVIVORS across every extra-lane table this follower may have
    // populated for Room A (thread, pulse-optin — every membership gets
    // both — plus whichever of checkin/whatsapp/push/telegram/handoff their
    // own transport or pick assigned), and Room B's OWN row in each of those
    // same tables is untouched — `evals/room-export/run.mjs`'s own
    // completeness law, extended to a world where the same person has a
    // second Room's rows sitting right next to the ones just deleted.
    const survivorsA = survivorsFor(state, ROOM_DEFS[f.primaryRoom].room_id, personId);
    boundaryChecks++;
    ok(`world: follower ${i}'s Room A forget leaves ZERO survivors across every extra-lane table`,
      survivorsA.length === 0, survivorsA.join(","));
    const survivorsB = survivorsFor(state, ROOM_DEFS[f.secondaryRoom].room_id, personId);
    boundaryChecks++;
    ok(`world: follower ${i}'s Room B rows in those SAME tables are untouched by the Room A forget`,
      survivorsB.length > 0, survivorsB.join(","));
  }

  // ── LAW 2 (export completeness, extended to the world): every table this
  // battery's own generalized reach layer knows about is actually named by
  // the REAL export manifest — `evals/room-export/run.mjs`'s own layer 1
  // comparison (PERSON_TABLES vs roomExportManifest), cross-checked here
  // against THIS layer's own table list so the two completeness checks can
  // never silently disagree about which tables exist.
  {
    const manifest = await roomExportManifest(w.deps);
    const missing = Object.keys(TABLE_ROLES).filter((t) => !manifest.includes(t));
    boundaryChecks++;
    ok("world: every table this layer's static reach check knows about is named by the REAL roomExportManifest()",
      missing.length === 0, missing.join(","));
  }

  // ── LAW 2 (creator-side reads): roomStats and Pulse never carry a token,
  // across every Room in the world — extends layers 1c/5 from one Room to all
  // five, and to the 100-follower scale rather than N<=5.
  for (const r of ROOM_DEFS) {
    const stats = await roomStats(w.db, { slug: r.slug }, w.deps);
    boundaryChecks++;
    ok(`world: roomStats for ${r.slug} returns exactly one key (talked_today)`, Object.keys(stats).join(",") === "talked_today");
    const weekStart = "2026-09-01";
    const snapshot = await pulse.computeSnapshot(w.db, r.room_id, weekStart);
    const owner = await pulse.readPulse(w.db, r.owner, r.replica_id);
    const surface = JSON.stringify({ snapshot, owner });
    const roomTokens = world.memberships.filter((m) => m.roomIdx === r.idx).flatMap((m) => tokensOf.get(key(m.followerIdx, m.roomIdx)) || []);
    const leaked = roomTokens.filter((tok) => surface.includes(tok));
    boundaryChecks++;
    ok(`world: Pulse for ${r.slug} carries no follower token in computeSnapshot or readPulse`,
      leaked.length === 0, leaked.slice(0, 3).join(","));
  }

  // ── Telegram: each bound follower's channel resolves to THEIR OWN Room's
  // slug and no other — the isolation `evals/room-telegram/run.mjs` proves
  // for one follower, extended to every telegram-transport follower at once.
  const telegramFollowers = world.followers.filter((f) => f.transport === "telegram");
  let telegramBad = 0;
  for (const f of telegramFollowers) {
    const slug = await telegramChannelRoom(w.db, `tg-${f.idx}`);
    if (slug !== ROOM_DEFS[f.primaryRoom].slug) telegramBad++;
  }
  boundaryChecks++;
  ok(`world: every one of ${telegramFollowers.length} Telegram-bound followers resolves to their OWN Room's slug`, telegramBad === 0);

  // ── WhatsApp / push / check-ins really landed somewhere real (not vacuous
  // lanes nobody actually drove) ────────────────────────────────────────────
  ok(`world: at least one follower per new transport was actually driven (telegram=${telegramFollowers.length}, whatsapp=${state.waOptins.length}, push=${state.pushSubs.length}, checkins=${checkinPicks.size})`,
    telegramFollowers.length > 0 && state.waOptins.length > 0 && state.pushSubs.length > 0 && checkinPicks.size > 0);
  ok("world: at least one Suite-crossing creator-as-follower membership exists (OWNER_B in R3)",
    world.memberships.some((m) => m.uidOverride));

  console.log(`  world runtime: ${Date.now() - t0}ms, ${world.memberships.length} memberships, ${world.followers.length} followers, seed ${world.seed}`);
}

// ── LAYER 8, NEGATIVE CONTROL A (law 4): a struck WHERE in a fixture copy of
// one reader leaks and is caught, at world scale rather than the 2-follower
// scale layer 4 above already proves it at.
{
  const w2 = await runFullWorld(REPO);
  const { world, sessionOf, room } = w2;
  const unscopedRecall = async (_personId, agentId) => w2.state.facts.filter((f) => f.agent_id === agentId);
  const attackerIdx = world.followers.find((f) => f.idx !== 0 && f.primaryRoom === world.followers[0].primaryRoom).idx;
  const attackerKey = `${attackerIdx}:${world.followers[0].primaryRoom}`;
  let compiledAttacker = null;
  await room.roomSay(w2.db, { session: sessionOf.get(attackerKey), message: "hi" }, {
    loadAgent: w2.loadAgent, memory: { openEpisode: async () => ({}), logTurn: async () => {}, history: async () => [], recall: unscopedRecall },
    reply: (c) => { compiledAttacker = c; return "ok"; },
  });
  const victimToken = `TOKFACT_W_0_${world.followers[0].primaryRoom}_xxxxxx`;
  const leaked = (compiledAttacker?.system ?? "").includes(victimToken);
  ok("NEGATIVE CONTROL (world, A): striking the person clause from recall DOES leak a victim's fact across the full world",
    leaked, leaked ? "" : "control did not fire — the world-scale scan above would prove nothing");
}

// ── LAYER 8, NEGATIVE CONTROL B (law 4): a writer added to a temp copy of a
// module without a reach entry is caught by the generalized static layer.
{
  const fakeSrc = `export async function creatorDump(db, roomId) {\n  return db(\`select payload_text, phone_e164 from vy_room_handoff where room_id = ($1)::uuid\`, [roomId]);\n}\n`;
  const result = classifyOneFile("_fake-new-module.js", fakeSrc, "vy_room_handoff");
  ok("NEGATIVE CONTROL (world, B): a temp module reading vy_room_handoff's payload_text with no reach entry is CAUGHT",
    result.touches && result.problems.length > 0,
    result.problems.join(","));
  const safeSrc = `// this module never touches vy_room_handoff at all\n`;
  const safeResult = classifyOneFile("_fake-new-module.js", safeSrc, "vy_room_handoff");
  ok("...and a file that only comments on the table without a real statement raises no problem (it is registered as touching, honestly, but the comment is a safe line)",
    safeResult.touches === true && safeResult.problems.length === 0);
}

// ── LAYER 8, STATIC: the generalized reach layer over the real api/ tree —
// zero problems, and every PERSON_TABLES room+person table has a role.
{
  const problems = staticReachProblems(REPO);
  const flat = Object.entries(problems).flatMap(([t, ps]) => ps.map((p) => `${t}:${p}`));
  ok(`world: the generalized static reach layer finds zero problems across every table it knows about`,
    flat.length === 0, flat.join(" | "));
  const undeclared = undeclaredRoomPersonTables(REPO);
  ok("world: every PERSON_TABLES room+person table (besides layer 1c's own two) has a TABLE_ROLES entry",
    undeclared.length === 0, undeclared.join(","));
}

// (WS-R67's flags are layer 9; layers 7 and 8 above are the taste and the full world. Renumbered at the merge.)
// LAYER 9 — FLAG THIS REPLY (WS-R67, migration 116). The workstream brief's
// own class: HARMFUL_AGGREGATE_ONLY — the creator-facing lane
// (`vy_room_reply_flag`) carries the AI's own reply text and a count, and
// PROVABLY NO FOLLOWER IDENTITY OR WORDS, even though (unlike layer 5's
// Pulse) it is not aggregated at write time — the aggregation is
// `api/_review-queue.js::readFlaggedReplies`'s own GROUP BY, at READ time,
// migration 116's own header. `evals/room-flags/run.mjs` is this feature's
// OWN suite (the read-back-from-history proof, the unique-index refusal,
// the withdrawal); this layer's job is narrower and different in kind: a
// REAL multi-follower WORLD, through THIS suite's own `leakedTokens` scanner,
// proving no OTHER follower's unique words ever reach the creator surface a
// flag produces — layer 2/3's own retrieval proof, applied to a table those
// layers never touch.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── layer 9: flag this reply (WS-R67, migration 116) ──");

// (7a) STATIC. `evals/room-flags/run.mjs` already runs this exact scan as
// its own gate; reused here (not retyped) so this battery's own verdict
// reflects the SAME boundary proof rather than a second, drifting copy of
// it — `evals/room-flags/fixtures.mjs`'s own header names the reason this
// wrapper is SHARED rather than duplicated, restated for the scan function
// one file over.
{
  const ALLOWED = new Set(["_room-surface.js", "room.js", "_review-queue.js", "review-queue.js", "_replica-full-erasure.js", "memory.js"]);
  const sources = {};
  for (const f of fs.readdirSync(join(REPO, "api"))) {
    if (!f.endsWith(".js")) continue;
    const src = fs.readFileSync(join(REPO, "api", f), "utf8");
    if (src.includes("vy_room_reply_flag")) sources[f] = src;
  }
  ok("layer 9 static: the scan is not vacuous - at least one real file names vy_room_reply_flag",
    Object.keys(sources).length > 0);
  const outsideAllowed = Object.keys(sources).filter((f) => !ALLOWED.has(f));
  ok("layer 9 static: every file naming vy_room_reply_flag is in the closed, reviewed set (evals/room-flags/run.mjs's own gate, reused)",
    outsideAllowed.length === 0, outsideAllowed.join(","));
}

// (7b) DYNAMIC. A REAL world: three followers, one shared reply everyone
// flags, and a FOURTH follower with their OWN unique reply and their own
// unique flag reason — the creator-facing surface (`readFlaggedReplies`'
// own output) must carry the shared reply's text and count, and must never
// leak the fourth follower's own private reply into the SAME creator's read
// of the FIRST reply's card (the two are different cards; nothing about one
// may bleed into the other's count or text).
{
  const state = freshFlagState(freshState());
  const flagWorldDb = flagsDb(state, fakeDb(state));
  const memlog = [];
  const memory = fakeMemory(memlog);
  const uid = (n) => `9100000${n}-0000-4000-a000-00000000000${n}`;
  const { createHash } = await import("node:crypto");
  const sha256Hex = (s) => createHash("sha256").update(String(s), "utf8").digest("hex");

  const SHARED_REPLY = "TOKSHARED_your fee is due on the 5th, not the 15th_ZZZ";
  const PRIVATE_REPLY = "TOKPRIVATE_a completely different answer only follower 4 ever saw_ZZZ";

  const sessions = [];
  for (let i = 0; i < 4; i++) {
    const joined = await joinRoom(
      flagWorldDb, { slug: SLUG, authUserId: uid(i), ageAttested: true, memoryConsent: true }, { loadAgent },
    );
    sessions.push(joined.session);
    const payload = readRoomSession(joined.session);
    const device = roomThreadDevice(ROOM_ID, String(payload.p), null);
    const text = i < 3 ? SHARED_REPLY : PRIVATE_REPLY;
    memlog.push({ call: "logTurn", device, person: String(payload.p), role: "her", content: text, agentId: AGENT_ID });
  }
  for (let i = 0; i < 3; i++) {
    await flagReply(
      flagWorldDb, { session: sessions[i], replySha256: sha256Hex(SHARED_REPLY), reason: "wrong" }, { loadAgent, memory },
    );
  }
  await flagReply(
    flagWorldDb, { session: sessions[3], replySha256: sha256Hex(PRIVATE_REPLY), reason: "not_them" }, { loadAgent, memory },
  );

  const surface = await readFlaggedReplies(flagWorldDb, OWNER, REPLICA_ID, { tableApplied: async () => true });
  const sharedCard = surface.find((c) => c.reply_sha256 === sha256Hex(SHARED_REPLY));
  const privateCard = surface.find((c) => c.reply_sha256 === sha256Hex(PRIVATE_REPLY));

  boundaryChecks++;
  ok("layer 9: three followers flagging the SAME reply produce ONE card with n=3, never three",
    Boolean(sharedCard) && sharedCard.count === 3);
  boundaryChecks++;
  ok("layer 9: the fourth follower's own reply is a SEPARATE card, count=1",
    Boolean(privateCard) && privateCard.count === 1);
  boundaryChecks++;
  ok("layer 9: the shared card's text is the shared reply, never the private one",
    sharedCard.reply_text === SHARED_REPLY);
  boundaryChecks++;
  ok("layer 9: the private card's text is the private reply, never the shared one",
    privateCard.reply_text === PRIVATE_REPLY);

  const wholeSurface = JSON.stringify(surface);
  boundaryChecks++;
  ok("layer 9: no follower id/person id from this world ever reaches the creator-facing surface",
    leakedTokens(wholeSurface, sessions.map((s) => String(readRoomSession(s).p))).length === 0);
  boundaryChecks++;
  ok("layer 9: the scan above is not vacuous - the person ids really do exist somewhere in this world",
    leakedTokens(JSON.stringify(sessions.map((s) => readRoomSession(s))), [String(readRoomSession(sessions[0]).p)]).length === 1);

  rowChecks += 6;
}

// (WS-R66's showcase is layer 10; renumbered at the merge behind the taste, the world and the flags.)
// LAYER 10 (WS-R66, migration 115) — THE CREATOR'S OWN PUBLIC-PAGE SHOWCASE.
// The mirror image of every layer above: layers 1-6 prove a FOLLOWER's own
// words can never reach the CREATOR's material or another follower. This
// layer proves the opposite direction holds too — the creator's own public-
// page WRITER (`setRoomShowcase`, api/_room-publish.js) can never surface a
// FOLLOWER's own words, even though its one optional input
// (`vy_review_card`) is a table that legitimately holds both kinds of text.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── layer 10: showcase (the creator's own writer cannot surface a follower's words) ──");

// (7a) STATIC. `setRoomShowcase`'s own source, read off the file rather than
// retyped, `(1b)`'s technique restated a seventh way: a change to the
// shipping predicate is a change this suite sees.
{
  const publishSrc = fs.readFileSync(join(REPO, "api/_room-publish.js"), "utf8");
  const fnMatch = publishSrc.match(/export async function setRoomShowcase\([\s\S]*?\n}\n/);
  ok("setRoomShowcase is found in api/_room-publish.js (not moved/renamed)", Boolean(fnMatch));
  const body = fnMatch ? fnMatch[0] : "";
  ok("setRoomShowcase's own eligible-card SELECT excludes kind='follower_declined' INSIDE its WHERE clause, not a JS check applied after the row is in hand",
    body.includes("kind <> 'follower_declined'") && body.includes("state = 'sounds_right'"));
  ok("that exclusion sits in the SAME statement as the state='sounds_right' gate (one WHERE, both conditions, migration 074's own two-part card model)",
    /where[\s\S]{0,200}state = 'sounds_right'[\s\S]{0,60}kind <> 'follower_declined'|where[\s\S]{0,200}kind <> 'follower_declined'[\s\S]{0,60}state = 'sounds_right'/.test(body));

  // Repo-wide: no follower-facing file ever calls the showcase writer — the
  // same ALLOWED-set shape layer 6's own handoff check uses, restated for
  // the opposite direction (there, no OTHER file may read a creator-only
  // table; here, no FOLLOWER-facing file may call this creator-only writer).
  const FOLLOWER_FACING = ["_room-surface.js", "_room.js", "_room-page.js", "_room-embed.js", "_room-manifest.js", "_room-telegram.js", "_room-whatsapp.js"];
  const offenders = FOLLOWER_FACING.filter((f) => {
    const p = join(REPO, "api", f);
    if (!fs.existsSync(p)) return false;
    const src = fs.readFileSync(p, "utf8");
    return /\bsetRoomShowcase\s*\(/.test(src) || /\bremoveRoomShowcase\s*\(/.test(src);
  });
  ok("no follower-facing file imports or calls setRoomShowcase/removeRoomShowcase",
    offenders.length === 0, offenders.join(","));
}

// (7b) WORLD CHECK. The REAL setRoomShowcase, driven through a fixture
// carrying ONE eligible card (kind='question', creator material) and ONE
// INELIGIBLE card of the SAME state ('sounds_right') whose kind is
// 'follower_declined' — a real follower's own question and this AI's real
// reply to them, seeded verbatim so a leak would be a byte-for-byte token
// match `leakedTokens` (this file's own scanner) would actually catch.
{
  const { setRoomShowcase, RoomPublishError } = await import(pathToFileURL(join(REPO, "api/_room-publish.js")).href);
  const FOLLOWER_TOKEN = "TOKFOLLOWERCARD_showcase_leak_probe_zzzzzzzz";
  const roomRow = {
    room_id: ROOM_ID, slug: SLUG, replica_id: REPLICA_ID, agent_id: AGENT_ID, owner_user_id: OWNER,
    display_name: "Anjali", one_line_bio: "", default_locale: "en",
    free_monthly_messages: 20, paid_monthly_messages: 500, paid_monthly_voice_seconds: 1800,
    listed_at: null, published_at: "2026-08-01T00:00:00.000Z", paused_at: null,
    created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z",
  };
  const cards = [
    { card_id: "f1000000-0000-4000-8000-000000000001", replica_id: REPLICA_ID, owner_user_id: OWNER,
      kind: "question", state: "sounds_right", prompt_text: "How do you approach a new topic?", answer_text: "One idea a day, in your own words." },
    { card_id: "f2000000-0000-4000-8000-000000000002", replica_id: REPLICA_ID, owner_user_id: OWNER,
      kind: "follower_declined", state: "sounds_right", prompt_text: FOLLOWER_TOKEN, answer_text: `${FOLLOWER_TOKEN}_reply` },
  ];
  const showcase = [];
  const db = async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    if (has("select room_id, slug, replica_id, agent_id, owner_user_id, display_name,") && has("limit 1")) {
      const [owner, replica] = params.map(String);
      return owner === roomRow.owner_user_id && replica === roomRow.replica_id ? [{ ...roomRow }] : [];
    }
    if (has("select prompt_text, answer_text") && has("from vy_review_card")) {
      const [cardId, owner, replica] = params.map(String);
      const row = cards.find((c) => c.card_id === cardId && c.owner_user_id === owner && c.replica_id === replica
        && c.state === "sounds_right" && c.kind !== "follower_declined");
      return row ? [{ prompt_text: row.prompt_text, answer_text: row.answer_text }] : [];
    }
    if (has("update vy_room_showcase") && has("position = ($2)::int")) {
      for (const s of showcase) if (s.room_id === String(params[0]) && s.position === Number(params[1])) s.removed_at = "now";
      return [];
    }
    if (has("insert into vy_room_showcase")) {
      showcase.push({ id: String(params[0]), room_id: String(params[1]), question: params[2], answer: params[3], position: Number(params[4]), removed_at: null });
      return [];
    }
    if (has("from vy_room_showcase") && has("order by position asc")) {
      return showcase.filter((s) => !s.removed_at).sort((a, b) => a.position - b.position);
    }
    throw new Error(`layer 10 fake db: unmatched SQL: ${sql}`);
  };

  let refused = false;
  try {
    await setRoomShowcase(db, OWNER, REPLICA_ID, { position: 1, sourceCardId: cards[1].card_id });
  } catch (e) {
    refused = e instanceof RoomPublishError && e.code === "room_showcase_card_ineligible";
  }
  boundaryChecks++;
  ok("showcase: the follower-sourced card is refused, never copied into the public showcase", refused);
  boundaryChecks++;
  ok("showcase: nothing was written to the public table on the refused attempt", showcase.length === 0);

  const eligible = await setRoomShowcase(db, OWNER, REPLICA_ID, { position: 1, sourceCardId: cards[0].card_id });
  boundaryChecks++;
  ok("showcase: the eligible (creator-material) card WAS accepted (the fixture is sound, this is not vacuously refusing everything)",
    eligible?.showcase?.length === 1);

  const publicSurface = JSON.stringify(eligible.showcase);
  boundaryChecks++;
  ok("showcase: the follower's real token never reaches the public showcase surface, in any form",
    leakedTokens(publicSurface, [FOLLOWER_TOKEN]).length === 0);
  boundaryChecks++;
  ok("showcase: the scan above is not vacuous - the follower's token really does exist somewhere in this world",
    leakedTokens(JSON.stringify(cards), [FOLLOWER_TOKEN]).length > 0);

  // NEGATIVE CONTROL — MUST FAIL. A hand-rolled copy of the eligibility read
  // with the kind exclusion struck, `evals/room-leak`'s own standing law
  // (`(1a)`'s writeSymbols derivation, `(6b)`'s tamper case): a check that
  // cannot be observed failing proves nothing.
  const struckDb = async (sql, params) => {
    if (sql.includes("select prompt_text, answer_text")) {
      const [cardId] = params.map(String);
      const row = cards.find((c) => c.card_id === cardId); // NO kind/state filter at all
      return row ? [{ prompt_text: row.prompt_text, answer_text: row.answer_text }] : [];
    }
    return db(sql, params);
  };
  const leakedResult = await setRoomShowcase(struckDb, OWNER, REPLICA_ID, { position: 2, sourceCardId: cards[1].card_id });
  boundaryChecks++;
  ok("NEGATIVE CONTROL: with the eligibility predicate struck, the follower's token DOES leak into the showcase - proving the real check above is load-bearing, not vacuous",
    leakedTokens(JSON.stringify(leakedResult.showcase), [FOLLOWER_TOKEN]).length > 0);
}

// ═════════════════════════════════════════════════════════════════════════
// LAYER 11 (WS-R74, migration 118) — THE CREATOR'S WEEKLY PUSH. This
// feature's own follower-facing input is Pulse's "note" text — creator
// material, floor-checked at n>=5 before it ever exists as a row
// (migration 097's own CHECK on `vy_room_pulse_combo.follower_count`) — and
// the concern layer 10 raised for the showcase applies again: a writer with
// ONE legitimate, safe input must never be widened into a second, unsafe
// one. This layer proves `api/_creator-push.js#creatorWeeklyPushPayload`
// (the one function whose OUTPUT crosses onto a real device) can only ever
// carry a slug, a display name and three already-aggregated facts — never
// a follower id, a thread title, or a raw message.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── layer 11: the creator's weekly push (Pulse headline can never widen into follower content) ──");

// (a) STATIC. `creatorWeeklyPushPayload`'s own source, read off the file
// rather than retyped — layer 10's own technique restated an eighth way.
{
  const pushSrc = fs.readFileSync(join(REPO, "api/_creator-push.js"), "utf8");
  const { CREATOR_PUSH_FOLLOWER_CONTENT_NAMES } = await import(pathToFileURL(join(REPO, "api/_creator-push.js")).href);
  ok("layer 11 static: CREATOR_PUSH_FOLLOWER_CONTENT_NAMES is not vacuously empty",
    CREATOR_PUSH_FOLLOWER_CONTENT_NAMES.length >= 5);

  const fnMatch = pushSrc.match(/export function creatorWeeklyPushPayload\([\s\S]*?\n}\n/);
  ok("creatorWeeklyPushPayload is found in api/_creator-push.js (not moved/renamed)", Boolean(fnMatch));
  const body = fnMatch ? fnMatch[0] : "";
  const nameHits = CREATOR_PUSH_FOLLOWER_CONTENT_NAMES.filter((n) => body.includes(n));
  ok("creatorWeeklyPushPayload's own source names none of this repo's follower-facing content columns",
    nameHits.length === 0, nameHits.join(","));

  // The headline's own sourcing route: `pulseHeadlineFor` may only ever
  // read `readPulse`'s own `note` field — never a table this file queries
  // itself, and never a raw thread/message column.
  const headlineMatch = pushSrc.match(/async function pulseHeadlineFor\([\s\S]*?\n}\n/);
  ok("pulseHeadlineFor is found in api/_creator-push.js (not moved/renamed)", Boolean(headlineMatch));
  const headlineBody = headlineMatch ? headlineMatch[0] : "";
  ok("pulseHeadlineFor sources the headline ONLY through readPulse(...).combo_buckets — no direct table read of its own",
    headlineBody.includes("readPulse(") && headlineBody.includes("combo_buckets") && !/\bfrom\s+vy_/i.test(headlineBody));
}

// (b) WORLD CHECK. The REAL `sendCreatorWeeklyPushes`, driven through a
// fixture with ONE published Room, a real Pulse world (one combo bucket AT
// the n>=5 floor, built from a creator-typed label — never a follower's own
// words, `weeklyNote`'s own header), and a follower roster carrying a
// FOLLOWER_TOKEN seeded on a column (`vy_room_follower.person_id`) that
// this feature's own SQL never selects. A leak here would be a byte-for-
// byte token match `leakedTokens` (this file's own scanner) would actually
// catch.
{
  const { sendCreatorWeeklyPushes, creatorWeeklyPushPayload } =
    await import(pathToFileURL(join(REPO, "api/_creator-push.js")).href);
  const FOLLOWER_TOKEN = "TOKFOLLOWERPERSON_creatorpush_leak_probe_zzzzzzzz";
  const NOW = Date.parse("2026-09-08T04:00:00.000Z"); // isoWeekStartDate normalizes this to its own Monday regardless
  const roomRow = {
    room_id: ROOM_ID, slug: SLUG, display_name: "Anjali", replica_id: REPLICA_ID, owner_user_id: OWNER,
    published_at: "2026-08-01T00:00:00.000Z", paused_at: null,
  };
  const followerRows = [
    // A real follower row exists in this world (the token proves it), but
    // every query this feature runs against vy_room_follower is a bare
    // count(*) — the static control above already proves the payload
    // builder's own parameter list has nowhere to carry it either.
    { room_id: ROOM_ID, person_id: FOLLOWER_TOKEN, joined_at: "2026-09-05T00:00:00.000Z" },
  ];
  const comboRows = [
    { labels: ["JEE prep"], follower_count: 5 }, // exactly the floor — 097's own CHECK boundary
  ];
  const pushLedger = [];
  const sentPayloads = [];
  const db = async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    if (has("from vy_room") && has("published_at is not null") && has("paused_at is null")) {
      return [roomRow];
    }
    if (has("count(*)::int as n") && has("from vy_room_follower") && has("joined_at >=")) {
      const n = followerRows.filter((f) => f.room_id === String(params[0])).length;
      return [{ n }];
    }
    if (has("sum(turns)") && has("from vy_room_follower_day")) {
      return [{ n: 12 }];
    }
    if (has("select room_id, created_at, published_at") && has("from vy_room")) {
      const [owner, replica] = params.map(String);
      return owner === roomRow.owner_user_id && replica === roomRow.replica_id
        ? [{ room_id: roomRow.room_id, created_at: "2026-08-01T00:00:00.000Z", published_at: roomRow.published_at }]
        : [];
    }
    if (has("from vy_room_pulse_optin")) return [{ total_optin: 5 }];
    if (has("from vy_room_pulse_topic")) return [{ topic_id: "t1", label: "JEE prep" }];
    if (has("from vy_room_pulse_snapshot")) return [{ week_start: null }];
    if (has("select max(week_start)::text as week_start from vy_room_pulse_week")) return [{ week_start: "2026-09-01" }];
    if (has("select suppressed from vy_room_pulse_week")) return [{ suppressed: 0 }];
    if (has("from vy_room_pulse_combo")) return comboRows;
    if (has("insert into vy_creator_weekly_push")) {
      const [pushId, roomId, weekStart, followers, messages, headlineIncluded] = params;
      const dup = pushLedger.find((r) => r.room_id === roomId && r.week_start === weekStart);
      if (dup) return [];
      pushLedger.push({ push_id: pushId, room_id: roomId, week_start: weekStart, followers, messages, headline_included: headlineIncluded });
      return [{ push_id: pushId }];
    }
    throw new Error(`layer 11 fake db: unmatched SQL: ${sql}`);
  };
  const oneSubscription = [{ id: "sub-1", endpoint: "https://push.example.test/creator-1", p256dh: "x", auth: "y" }];
  const sendPush = async (sub, payload) => {
    sentPayloads.push(payload);
    return { ok: true, status: 201 };
  };

  const env = { ROOM_PUSH_VAPID_PUBLIC: "pub", ROOM_PUSH_VAPID_PRIVATE: "priv", ROOM_PUSH_VAPID_SUBJECT: "mailto:ops@example.test" };
  const summary1 = await sendCreatorWeeklyPushes(db, {
    now: NOW, env, sendPush,
    creatorPushSubscriptionsFor: async () => oneSubscription,
    revokeCreatorPushSubscription: async () => {},
  });
  boundaryChecks++;
  ok("creator weekly push: the real sweep sent exactly one push (the fixture is sound, not vacuously refusing everything)",
    summary1.sent_ledger === 1 && summary1.pushed === 1 && sentPayloads.length === 1);
  boundaryChecks++;
  ok("creator weekly push: the follower's real token never reaches the outgoing payload, in any form",
    leakedTokens(sentPayloads[0], [FOLLOWER_TOKEN]).length === 0);
  boundaryChecks++;
  ok("creator weekly push: the scan above is not vacuous - the follower's token really does exist somewhere in this world",
    leakedTokens(JSON.stringify(followerRows), [FOLLOWER_TOKEN]).length > 0);

  // THE LEDGER'S OWN WHERE (workstream law 4). A second sweep tick for the
  // SAME Room, SAME week sends nothing more — `ON CONFLICT (room_id,
  // week_start) DO NOTHING` returns zero rows, and this file's own
  // `sendCreatorWeeklyPushes` skips the push entirely on that empty return.
  const summary2 = await sendCreatorWeeklyPushes(db, {
    now: NOW + 60_000, env, sendPush,
    creatorPushSubscriptionsFor: async () => oneSubscription,
    revokeCreatorPushSubscription: async () => {},
  });
  boundaryChecks++;
  ok("creator weekly push: NEGATIVE CONTROL — a second sweep tick the SAME week sends ZERO further pushes, refused by the ledger's own unique (room_id, week_start) WHERE",
    summary2.sent_ledger === 0 && summary2.pushed === 0 && sentPayloads.length === 1);

  // NEGATIVE CONTROL (2) — MUST FAIL. A hand-rolled "leaky" call that hands
  // the payload builder a raw follower token as its `headline` argument —
  // proving `leakedTokens` above is a real, load-bearing scanner rather
  // than one that would pass on anything. The REAL pipeline can never do
  // this (the static control (a) proves `pulseHeadlineFor` has no path to
  // any variable but `readPulse(...).combo_buckets`); this call bypasses that
  // pipeline on purpose to prove the SCANNER, not the pipeline, catches a
  // leak when one is handed to it directly.
  const leakyPayload = JSON.stringify(creatorWeeklyPushPayload(SLUG, "Anjali", 3, 12, FOLLOWER_TOKEN));
  boundaryChecks++;
  ok("NEGATIVE CONTROL: a headline argument carrying the follower's raw token DOES leak into the payload - proving the scanner above is not vacuous",
    leakedTokens(leakyPayload, [FOLLOWER_TOKEN]).length > 0);
}

// ═══════════════════════════════════════
// LAYER 12 (WS-R75, migration 119) — DORMANCY. The sweep runs across every
// Room at once (`dormancySweep`, api/_dormancy.js) — the mirror image of
// every layer above one more time: a forget in ONE Room, triggered by that
// Room's own policy and that Room's own follower's own silence, must never
// touch another Room's follower, whatever that second Room's own policy is.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── layer 12: dormancy (a forget in one Room touches no other) ──");
{
  const { dormancySweep } = await import(pathToFileURL(join(REPO, "api/_dormancy.js")).href);
  const DAY = 86_400_000;
  const NOW11 = Date.parse("2026-09-05T00:00:00.000Z");
  const iso = (daysAgo) => new Date(NOW11 - daysAgo * DAY).toISOString();

  const ROOM_A11 = "e1000000-0000-4000-8000-000000000001"; // dormancy_days=365, follower overdue
  const ROOM_B11 = "e2000000-0000-4000-8000-000000000002"; // dormancy_days=200, follower NOT due (visited recently)
  const AGENT_A11 = "e1000000-0000-4000-8000-0000000000a1";
  const AGENT_B11 = "e2000000-0000-4000-8000-0000000000b1";
  const PERSON_A11 = "e1000000-0000-4000-8000-0000000000f1";
  const PERSON_B11 = "e2000000-0000-4000-8000-0000000000f1";
  const B11_TOKEN = "TOKROOMB_dormancy_isolation_probe_zzzzzzzz";

  const state11 = {
    rooms: [
      { room_id: ROOM_A11, slug: "roomA11", display_name: "Room A", dormancy_days: 365 },
      { room_id: ROOM_B11, slug: "roomB11", display_name: B11_TOKEN, dormancy_days: 200 },
    ],
    followers: [
      // Room A: noticed 40 days ago, no visit since - due to be forgotten.
      { follower_id: "aa110000-0000-4000-8000-000000000001", room_id: ROOM_A11, person_id: PERSON_A11,
        agent_id: AGENT_A11, locale: "en", age_attested_at: iso(500), last_seen_at: iso(500), dormancy_notice_at: iso(40) },
      // Room B: also has a policy, but visited YESTERDAY - nowhere near due.
      { follower_id: "bb220000-0000-4000-8000-000000000001", room_id: ROOM_B11, person_id: PERSON_B11,
        agent_id: AGENT_B11, locale: "en", age_attested_at: iso(500), last_seen_at: iso(1), dormancy_notice_at: null },
    ],
    receipts: [],
  };

  const db11 = async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    const p = (params || []).map((v) => (v == null ? null : String(v)));
    if (has("update vy_room_follower f") && has("set dormancy_notice_at")) {
      const [nowIso] = p;
      const out = [];
      for (const f of state11.followers) {
        if (f.dormancy_notice_at != null) continue;
        const room = state11.rooms.find((r) => r.room_id === f.room_id);
        if (!room || room.dormancy_days == null) continue;
        const threshold = new Date(nowIso).getTime() - (room.dormancy_days - 30) * DAY;
        if (new Date(f.last_seen_at).getTime() >= threshold) continue;
        f.dormancy_notice_at = nowIso;
        out.push({ follower_id: f.follower_id, room_id: f.room_id, person_id: f.person_id, agent_id: f.agent_id, locale: f.locale, slug: room.slug, display_name: room.display_name });
      }
      return out;
    }
    if (has("select f.follower_id") && has("f.dormancy_notice_at is not null")) {
      const [nowIso] = p;
      const graceFloor = new Date(nowIso).getTime() - 30 * DAY;
      return state11.followers
        .filter((f) => f.dormancy_notice_at != null && new Date(f.dormancy_notice_at).getTime() < graceFloor
          && new Date(f.last_seen_at).getTime() <= new Date(f.dormancy_notice_at).getTime())
        .map((f) => ({ follower_id: f.follower_id, room_id: f.room_id, person_id: f.person_id, agent_id: f.agent_id, locale: f.locale,
          slug: state11.rooms.find((r) => r.room_id === f.room_id)?.slug }));
    }
    if (has("select t.thread_id from vy_room_thread")) return [];
    if (has("delete from vy_room_thread")) return [];
    if (has("insert into meera_consent")) return [];
    if (has("from vy_room_push_subscription") && has("revoked_at is null")) return [];
    if (has("from vy_room_follower_channel") && has("channel = 'telegram'")) return [];
    if (has("delete from vy_room_follower")) {
      const [roomId, personId] = p;
      const before = state11.followers.length;
      state11.followers = state11.followers.filter((f) => !(f.room_id === roomId && f.person_id === personId));
      return before !== state11.followers.length ? [{ gone: 1 }] : [];
    }
    if (has("insert into vy_room_forget_receipt")) {
      state11.receipts.push({ room_id: params[1] });
      return [];
    }
    throw new Error(`layer 12 fake db: unmatched SQL: ${sql}`);
  };

  const summary11 = await dormancySweep(
    { db: db11, env: { ROOM_DORMANCY: "1" }, tableApplied: async (n) => n === "vy_room_forget_receipt", personTables: async () => [] },
    NOW11,
  );
  boundaryChecks++;
  ok("dormancy: exactly one follower forgotten this sweep (Room A's own, overdue one)", summary11.dormancyForgotten === 1, JSON.stringify(summary11));
  boundaryChecks++;
  ok("dormancy: Room A's overdue follower is GONE", !state11.followers.some((f) => f.person_id === PERSON_A11));
  boundaryChecks++;
  ok("dormancy: Room B's own follower row is BYTE-IDENTICAL — untouched by a forget that ran in a different Room in the same sweep",
    state11.followers.some((f) => f.person_id === PERSON_B11 && f.last_seen_at === iso(1) && f.dormancy_notice_at === null));
  boundaryChecks++;
  ok("dormancy: Room B's own display name (planted as a token) never appears anywhere in the sweep's own summary",
    leakedTokens(JSON.stringify(summary11), [B11_TOKEN]).length === 0);
  boundaryChecks++;
  ok("dormancy: the receipt written names Room A, never Room B",
    state11.receipts.length === 1 && state11.receipts[0].room_id === ROOM_A11);

  // NEGATIVE CONTROL — MUST FAIL. A struck forget-due predicate that ignores
  // room_id entirely proves the real one above is load-bearing, not vacuous.
  const struckDb11 = async (sql, params) => {
    if (sql.includes("select f.follower_id") && sql.includes("f.dormancy_notice_at is not null")) {
      // Every noticed follower, ANY room, ignoring the grace window AND the
      // last-visit check — deliberately wrong, to prove the real predicate
      // is what keeps Room B's untouched follower out.
      return state11.followers
        .filter((f) => true) // eslint-disable-line no-constant-condition
        .map((f) => ({ follower_id: f.follower_id, room_id: f.room_id, person_id: f.person_id, agent_id: f.agent_id, locale: f.locale,
          slug: state11.rooms.find((r) => r.room_id === f.room_id)?.slug }));
    }
    return db11(sql, params);
  };
  const struckSummary = await dormancySweep(
    { db: struckDb11, env: { ROOM_DORMANCY: "1" }, tableApplied: async (n) => n === "vy_room_forget_receipt", personTables: async () => [] },
    NOW11,
  );
  boundaryChecks++;
  ok("NEGATIVE CONTROL: with the forget-due predicate struck to ignore the grace window and last-visit check, Room B's own follower IS swept up too - proving the real predicate above is load-bearing, not vacuous",
    struckSummary.dormancyForgotten >= 1);
}

// ═════════════════════════════════════════════════════════════════════════
console.log(`\n── verdict ──`);
for (const w of worldSummaries) {
  console.log(`  N=${String(w.followers).padEnd(3)} followers  ${String(w.turns).padEnd(4)} turns  ${w.checks} retrieval checks`);
}
console.log(`  turns per follower          ${TURNS_PER_FOLLOWER}`);
console.log(`  retrieval row-scenario checks  ${rowChecks}`);
console.log(`  boundary checks (export/forget/creator)  ${boundaryChecks}`);
console.log(`  total assertions             ${pass + fail}`);
console.log(`\nroom-leak: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
