// The observation store — noticing, at one citation. SPEC-SELF-LAYER.md §7,
// db/migrations/011_self_layer.sql's vy_observation. WS-OBSERVE.
// Ownership: this file belongs to WS-OBSERVE exclusively.
//
// THE DISTINCTION THIS FILE EXISTS TO PROTECT (§7, relstate.ts's writePattern):
//
//              vy_pattern                          vy_observation
//   claim      "when X, he does Y"                 "he said X"
//   needs      >=2 citations to write,              1 citation
//              >=3 support / >=2 days to USE
//   risk       assigns a trait he doesn't have      misremembers a detail
//   decay      contradiction count                  unrefreshed -> fades
//
// A pattern GENERALIZES; measured through the actual gates its own minimum
// latency is three calendar days and three nightly passes (support_count>=3
// AND distinct_days>=2 is a Postgres GENERATED column, db/schema.sql:434-435
// — the bump only happens in the nightly pass, so day 1 write + day-2 + day-3
// recurrence is the earliest `prompt_eligible` can ever go true). An
// OBSERVATION RECALLS: one citation is proportionate because the downside of
// being wrong is a misremembered detail, not an invented trait. Building this
// as a looser vy_pattern (lowering its >=2 bar) would blur that distinction
// for BOTH tables; this is a second, deliberately thin table instead — see
// §11's reversal condition, threaded through this file below.
//
// ARCHITECTURE (mirrors relstate.ts's own header, read that first): this file
// ships in the CLIENT bundle (src/engine/*.ts), so it never imports
// api/_db.js or api/_config.js. Every DB-facing export takes a `QueryFn` as
// its first argument — the exact duck-typed shape of api/_db.js's `q` — so a
// server caller (the coordinator, wiring this into api/memory.js's T5 path)
// passes the real thing and an eval passes the real thing too (evals run
// server-side and import api/_db.js directly; only THIS file is barred from
// doing so statically). `QueryFn` is imported as a TYPE ONLY from
// relstate.ts — erased at compile time, zero bytes in any bundle — rather
// than redefined a second time, matching india.ts's existing precedent for
// the identical need (india.ts:14).
//
// CALL-SITE WIRING IS NOT THIS FILE'S JOB (relstate.ts's own rule, restated):
// the coordinator wires writeObservation/promoteObservation into whatever
// extracts an observation-shaped utterance, wires matchObservations into
// api/memory.js's T5 `recall.facts` path, and wires decayObservations into
// the nightly consolidation pass. Every one of those is logged as an
// interface note at its point of use below, not wired here.
import type { QueryFn } from "./relstate";
import { lintLine, lintBlock } from "./shapelint";

// ─────────────────────────────────────────────────────────────────────────
// Types — mirror db/migrations/011_self_layer.sql's vy_observation exactly.
// ─────────────────────────────────────────────────────────────────────────

export interface ObservationRow {
  id: number;
  agent_id: string;
  person_id: string;
  note: string;
  citations: number[];
  salience: number;
  times_seen: number;
  last_seen: string; // ISO timestamp, as returned by Postgres over SQL-HTTP
  promoted_to: number | null;
  t_invalid: string | null;
  created_at: string;
}

/** What matchObservations returns — a strict subset of ObservationRow: no
 *  `promoted_to`/`t_invalid` because the query never returns a promoted or
 *  invalidated row in the first place (see matchObservations), so a caller
 *  cannot accidentally branch on a field that is always going to read null
 *  here and mistake that for "never promoted" in general. */
export interface ObservationMatch {
  id: number;
  note: string;
  citations: number[];
  salience: number;
  times_seen: number;
  last_seen: string;
}

// ─────────────────────────────────────────────────────────────────────────
// 1. writeObservation — one citation minimum, shape-linted, telegraphic.
// ─────────────────────────────────────────────────────────────────────────

export interface WriteObservationInput {
  personId: string;
  agentId: string;
  note: string;
  citations: number[];
  salience?: number; // defaults to the column default, 0.5
}

/** The `recited-prompt` guard, at write time: `note` is a telegraphic row
 *  destined for T5's tail the same way a vy_fact row or a vy_pattern
 *  then_note is, so it goes through the SAME lint (`shapelint.lintLine`)
 *  those do, not a bespoke check — one mechanism, so a future rule change
 *  to the lint automatically covers this table too. Word-count cap,
 *  sentence-shape and first-person-line-initial are the three signals
 *  lintLine checks; a violation of ANY of them throws rather than writing a
 *  bad row, because unlike a pattern's then_note (guidance, read by nobody
 *  but her judgment) an observation's note is closer to a fact row: it
 *  gets recalled close to verbatim, so it must never itself already read
 *  like a line she could say. */
export async function writeObservation(q: QueryFn, input: WriteObservationInput): Promise<number> {
  if (!input.citations || input.citations.length < 1) {
    throw new Error(
      `vy_observation requires >=1 citation (an observation recalls, it does not generalize — ` +
        `got ${input.citations?.length ?? 0} for ${input.personId})`,
    );
  }
  const trimmedNote = input.note.trim();
  if (!trimmedNote) {
    throw new Error(`vy_observation note must not be empty (${input.personId})`);
  }
  const lint = lintLine(trimmedNote);
  if (lint.reasons.length) {
    throw new Error(
      `vy_observation note failed shape-lint (recited-prompt guard): ${lint.reasons.join("; ")} — "${trimmedNote}"`,
    );
  }
  const salience = input.salience ?? 0.5;
  const rows = await q(
    `insert into vy_observation (agent_id, person_id, note, citations, salience)
     values ($1,$2,$3,$4,$5)
     returning id`,
    [input.agentId, input.personId, trimmedNote, input.citations, salience],
  );
  return Number(rows[0]?.id);
}

// ─────────────────────────────────────────────────────────────────────────
// 2. matchObservations — PULL-ONLY retrieval. Read moment.ts's code law
//    before touching this function: "every exported function... answers
//    'does THIS turn ask for it' — none of them may be called speculatively
//    to decide what to volunteer." This function is the one place in this
//    file that could violate it, so the enforcement is structural, not a
//    comment: see the STRUCTURAL ENFORCEMENT note below the function.
// ─────────────────────────────────────────────────────────────────────────

/** Empty on purpose. §7/CLAUDE.md's rule for this file is "reuse
 *  api/memory.js's RECALL_STOP... rather than defining a second one" — but
 *  api/memory.js is a SERVER file (imports api/_db.js, api/_config.js,
 *  api/_ratelimit.js transitively) and this file ships in the CLIENT
 *  bundle, so a static `import { RECALL_STOP } from "../../api/memory.js"`
 *  here would drag server secrets into the Vite build, exactly the failure
 *  mode relstate.ts's own header warns about for api/_db.js. The resolution
 *  is the same one already used for `q` itself: dependency injection, not
 *  import. `stopwords` below is REQUIRED reuse surface, not a second
 *  stoplist — this constant is deliberately empty (matches everything,
 *  filters nothing) so a caller that forgets to inject RECALL_STOP degrades
 *  to "no stoplist" rather than to a silently-drifting duplicate of one.
 *  INTERFACE NOTE for the coordinator: the T5 call site in api/memory.js
 *  already has RECALL_STOP in scope (it's exported from that very file) —
 *  pass it as the 6th argument: `matchObservations(q, personId, agentId,
 *  query, limit, RECALL_STOP)`. */
const NO_STOPWORDS: ReadonlySet<string> = new Set();

/** Same word-extraction shape as api/memory.js's opRecall (mirrored, not
 *  imported, for the same client/server split reason as above): 4+ Latin
 *  letters or 3+ Devanagari, lowercased, deduped, capped at 6 signal words.
 *  Kept as its own function so the "no words -> no query -> no rows" gate
 *  in matchObservations is one visibly small `if`, not buried in a longer
 *  expression. */
function signalWords(queryText: string, stopwords: ReadonlySet<string>): string[] {
  const lowered = String(queryText || "").toLowerCase();
  const all = lowered.match(/[a-z]{4,}|[ऀ-ॿ]{3,}/g) || [];
  const deduped = [...new Set(all)].filter((w) => !stopwords.has(w));
  return deduped.slice(0, 6);
}

/**
 * T5's observation half of `recall.facts`. Matches the CURRENT turn's query
 * text against stored notes, word-boundary, the same mechanism opRecall
 * already uses for vy_fact/meera_nodes keyword recall — one retrieval
 * shape across the tail, not a second one invented for this table.
 *
 * STRUCTURAL ENFORCEMENT of pull-only (moment.ts's code law): there is no
 * code path in this function that returns rows without `queryText`
 * supplying at least one signal word. When `signalWords` comes back empty —
 * an empty query, or a query built entirely of stopwords — this function
 * returns `[]` before any SQL is issued; it never falls back to "just show
 * me what's salient for this person" (that fallback is exactly what would
 * turn this into a speculative volunteer-decider, which moment.ts's header
 * forbids by name). Contrast this with a hypothetical `topObservations(q,
 * personId, agentId, limit)` — this file deliberately does not expose that
 * function; the ONLY read export is this one, and it is unreachable without
 * a live query.
 *
 * Excludes `promoted_to is not null` rows: once an observation has been
 * promoted into a pattern (see promoteObservation below), the generalized
 * form is what T5's pattern path should surface — rendering both would show
 * the same evidence twice under two different claims ("he said X" AND "when
 * X, he does Y"), which is exactly the "two stores disagreeing" §7 was
 * written to prevent. Excludes `t_invalid is not null` for the same reason
 * every other tail-eligible table does (vy_fact, vy_pattern): an
 * invalidated row is data, not a candidate for recall.
 */
export async function matchObservations(
  q: QueryFn,
  personId: string,
  agentId: string,
  queryText: string,
  limit: number = 3,
  stopwords: ReadonlySet<string> = NO_STOPWORDS,
): Promise<ObservationMatch[]> {
  const words = signalWords(queryText, stopwords);
  if (!words.length) return []; // the pull-only gate: no signal, no query, no rows

  const clauses: string[] = [];
  const params: unknown[] = [personId, agentId];
  let p = 3;
  for (const w of words) {
    // word-boundary, not substring — `ilike '%rate%'` would hit "corporate"
    // and hand her a note the turn never referred to (same reasoning as
    // opRecall's identical guard for meera_nodes/vy_fact).
    clauses.push(`note ~* $${p}`);
    params.push(`\\m${w}\\M`);
    p++;
  }
  params.push(Math.max(0, Math.floor(limit)));

  const rows = await q(
    `select id, note, citations, salience, times_seen, last_seen
       from vy_observation
      where person_id = $1 and agent_id = $2
        and t_invalid is null and promoted_to is null
        and (${clauses.join(" or ")})
      order by salience desc, times_seen desc, last_seen desc
      limit $${p}`,
    params,
  );
  return rows.map((r: any) => ({
    id: Number(r.id),
    note: r.note,
    citations: (r.citations || []).map((c: unknown) => Number(c)),
    salience: Number(r.salience),
    times_seen: Number(r.times_seen),
    last_seen: r.last_seen,
  }));
}

/** Pure, no I/O — the telegraphic line shape T5's other rows already use
 *  ("- label: note (note2)"), offered so a coordinator doesn't have to
 *  re-derive the format. OPTIONAL: api/memory.js's own T5 rendering
 *  (opRecall's `line()`) is bespoke per block already (it isn't built from
 *  a shared render helper for facts either), so the coordinator may choose
 *  to inline an equivalent instead — this is a convenience export, not a
 *  required call site. Belt-and-braces re-lint before render (the note was
 *  already linted at write time; this catches drift if a row was ever
 *  written by a path other than writeObservation, e.g. a manual DB fix).
 */
export function formatObservationLine(o: ObservationMatch): string {
  const line = `- ${o.note}`;
  const check = lintBlock(line);
  if (!check.clean) {
    throw new Error(`observation row failed re-lint at render time (recited-prompt guard): "${o.note}"`);
  }
  return line;
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Promotion — ONE path into vy_pattern, so the two stores cannot
//    disagree. This file does NOT write vy_pattern (that is relstate.ts's
//    writePattern, owned by WS-RELSTATE, untouched here); it only marks an
//    observation as superseded once the coordinator has called writePattern
//    itself with that observation's evidence.
// ─────────────────────────────────────────────────────────────────────────

/** Pure eligibility check, no I/O — mirrors relstate.ts's own style of
 *  separating "is this true" from "go write it". `>=2` on BOTH times_seen
 *  and citations.length matches vy_pattern's own `vy_pattern_needs_two`
 *  CHECK ("one instance is an anecdote") — this function does not lower or
 *  raise that bar, it only tells the coordinator when an observation has
 *  crossed it, so writePattern's own enforcement is never the first place
 *  a caller discovers a >=2-citation observation was one citation short. */
export function observationEligibleForPromotion(o: Pick<ObservationRow, "times_seen" | "citations">): boolean {
  return o.times_seen >= 2 && o.citations.length >= 2;
}

/**
 * Marks `obsId` as promoted into the ALREADY-WRITTEN pattern `patternId`.
 * Call order, for the coordinator: (1) confirm
 * `observationEligibleForPromotion`, (2) call relstate.ts's `writePattern`
 * with the observation's own citations/note reshaped into a
 * WritePatternInput, capture the returned pattern id, (3) call this
 * function with that id. This function never inserts into vy_pattern
 * itself and never fabricates a patternId — a caller passing an id that
 * does not exist is a caller bug, not something this function can catch
 * without a round trip vy_pattern's own FK-less-by-convention citation
 * style (see vy_phrase.origin_episode, "edge, no FK") says this codebase
 * does not pay for elsewhere either.
 */
export async function promoteObservation(q: QueryFn, obsId: number, patternId: number): Promise<void> {
  await q(`update vy_observation set promoted_to = $2 where id = $1`, [obsId, patternId]);
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Reinforcement + decay. "An observation that is never refreshed fades" —
//    reinforcement (touchObservation) is what "refreshed" means; decay
//    (decayObservations) is what happens when it isn't.
//
//    config/decay.json's own law, verbatim, governs this section:
//    "decay moves ACT-R retrieval priority, never t_invalid, never a
//    delete... Decay and honest-forget must never collide by construction."
//    This file has NO delete export and NO function that sets t_invalid —
//    the guarantee is structural (the capability doesn't exist here), not a
//    promise kept by convention. vy_observation is not a vy_fact `kind`, so
//    it has no entry in config/decay.json's half_life_days map (that file's
//    own comment: "Keys are exactly vy_fact.kind's CHECK enum... a key that
//    isn't a real kind is a silent no-op") — decay.json is out of this
//    workstream's file ownership, so rather than add a key to a file this
//    phase does not own, DEFAULT_OBSERVATION_HALF_LIFE_DAYS lives here as
//    this file's own signed default, overridable per call.
// ─────────────────────────────────────────────────────────────────────────

/** Bumps an observation that has recurred: appends the new citing episode,
 *  increments times_seen, and moves last_seen forward — the three fields
 *  decay reads to decide freshness. Mirrors relstate.ts's reinforcePattern
 *  in shape (append citation, bump counters) for the closest existing
 *  analog to "this same claim came up again". */
export async function touchObservation(
  q: QueryFn,
  obsId: number,
  newCitation: number,
  seenAt: Date = new Date(),
): Promise<void> {
  await q(
    `update vy_observation
        set citations = array_append(citations, $2),
            times_seen = times_seen + 1,
            last_seen = $3
      where id = $1`,
    [obsId, newCitation, seenAt.toISOString()],
  );
}

/** This file's own default — NOT config/decay.json (see section header).
 *  21 days: long enough that a detail mentioned once does not evaporate
 *  before the relationship's next relevant turn, short enough that a
 *  stale, never-repeated note stops outranking fresher ones within a
 *  season. Overridable per call; not asserted anywhere as tuned against
 *  measurement, which is why it is a named, greppable constant rather than
 *  a bare literal in the query below. */
export const DEFAULT_OBSERVATION_HALF_LIFE_DAYS = 21;

/**
 * Pure exponential decay of one salience value — no I/O, unit-testable
 * without a database (same reasoning as relstate.ts's hysteresis
 * functions). `decayObservations` below is this function's SQL-side
 * equivalent, kept in sync by hand (documented here, checked by the eval's
 * parity assertion) because a batch UPDATE cannot call back into JS.
 *
 * DELIBERATELY NOT `current * factor`. vy_observation has one mutable
 * `salience` column and no separate "value at write time" column to decay
 * FROM — a formula that multiplies the CURRENT (possibly already-decayed)
 * value by a fresh factor computed from the FULL elapsed-since-last_seen
 * span double-counts every re-application: called twice with an unchanged
 * `last_seen` (two nightly passes before any refresh, or simply two calls
 * in the same run) it would decay twice as hard as calling it once, with
 * no bound. Found live in this file's own gate suite (evals/self/observation.mjs,
 * 5 consecutive decay passes over an unrefreshed row: naive multiplication
 * produced 0.0005 where a single correct pass produces 0.25).
 *
 * The fix mirrors api/consolidate.js's proven pattern for vy_fact.need_p
 * (`need_p = f(now - created_at)`, always OVERWRITTEN fresh from an
 * immutable anchor, never multiplied against its own prior output): the
 * decay CURVE here is a pure function of elapsed time since `last_seen`
 * alone (curve(0 days) = 1.0, i.e. "no decay yet"), and the result is
 * `min(current, curve)` — a monotonically non-increasing CEILING, not a
 * running product. Two consequences, both intended: (1) repeated calls
 * with the same `last_seen` and roughly the same `now` are idempotent —
 * the curve barely moves, so the min barely moves; (2) a custom low
 * write-time salience (writeObservation's `salience` input) is preserved
 * as a floor until the curve itself decays below it, then the curve takes
 * over — write-time salience is never erased by the first decay pass, only
 * ever bounded from above by it.
 */
export function decayedSalience(
  current: number,
  daysSinceLastSeen: number,
  halfLifeDays: number = DEFAULT_OBSERVATION_HALF_LIFE_DAYS,
): number {
  const clampedCurrent = Math.max(0, Math.min(1, current));
  if (!(daysSinceLastSeen > 0) || !(halfLifeDays > 0)) return clampedCurrent;
  const curve = Math.max(0, Math.min(1, Math.pow(0.5, daysSinceLastSeen / halfLifeDays)));
  return Math.min(clampedCurrent, curve);
}

/**
 * The nightly-pass step: lowers `salience` for every non-invalidated
 * observation under `agentId` by elapsed time since `last_seen`, using
 * exactly `decayedSalience`'s formula run in SQL (LEAST of the current
 * value and the fresh curve — see that function's own comment for why this
 * is not a running product) so the two never drift and repeated calls are
 * idempotent. NEVER touches `t_invalid`, NEVER deletes a row — see the
 * section header's quoted law. Returns the number of rows touched (0 is a
 * valid, quiet result, not a failure). Called by the coordinator's nightly
 * cron, not by anything in this file — same "call-site wiring is not this
 * file's job" rule as relstate.ts's hysteresis functions.
 */
export async function decayObservations(
  q: QueryFn,
  agentId: string,
  now: Date = new Date(),
  halfLifeDays: number = DEFAULT_OBSERVATION_HALF_LIFE_DAYS,
): Promise<number> {
  const rows = await q(
    `update vy_observation
        set salience = least(
              greatest(0, least(1, salience)),
              greatest(0, least(1, power(0.5::real,
                (extract(epoch from ($2::timestamptz - last_seen)) / 86400.0) / $3::real)))
            )
      where agent_id = $1 and t_invalid is null
      returning id`,
    [agentId, now.toISOString(), halfLifeDays],
  );
  return rows.length;
}
