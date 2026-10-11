// Bi-temporal fact edges — ROADMAP-100X item 4. WS-O.
//
// Ownership: this file belongs to WS-O. It is a PURE derivation layer over
// `src/engine/timeline.ts` and owns no store of its own.
//
// ── THE DEFECT THIS EXISTS TO KILL ───────────────────────────────────────
// `api/memory.js`'s `staleNote` hedges a recalled row with "whatever was ahead
// in this has already happened" when THE ROW is older than 45 days and its
// kind is plan/event (or its summary matches `TIME_BOUND`). It keys on the age
// of the ROW, never on the date INSIDE the fact. WS-K's recall benchmark
// caught the consequence on its first run and filed it as
// `stale-note-keys-on-row-age`: dyad-b's `neet pg` — a NOVEMBER exam recorded
// in JUNE — is handed to her in August pre-hedged as already-past, so she asks
// how an exam went that has not happened.
//
// Row age is a proxy for "the world has moved on". The fact's own validity
// interval is the thing the proxy was standing in for. This module derives it.
//
// ── WHAT BI-TEMPORAL MEANS *HERE*, PRECISELY ─────────────────────────────
// `vy_fact` already carries a belief pair and it is NOT this one:
//
//   t_valid / t_invalid  — BELIEF time. `t_invalid is not null` means "we
//                          stopped believing this" (superseded by a newer
//                          contradicting row). Every recall query in the repo
//                          reads `t_invalid is null` and means exactly that.
//   valid_from / valid_to — EVENT time (migration 056, added by this
//                          workstream). When the CLAIM is true of the world,
//                          independent of when anybody wrote it down or
//                          stopped believing it.
//
// Those are the two axes bi-temporality is named for. Keeping them as two
// column pairs rather than overloading one is not tidiness: `t_invalid` is
// read as a hard exclusion in ~a dozen WHERE clauses across api/, and making
// a November exam set `t_invalid` in November would DELETE it from recall
// instead of re-tensing it. A passed plan is still a fact about a person; it
// is just no longer ahead of them.
//
// ── `valid_to` IS A HORIZON, NOT AN END-OF-LIFE ──────────────────────────
// For the fact class this actually fires on — forward-looking, dated ones —
// `valid_to` is THE MOMENT AFTER WHICH THE FORWARD-LOOKING READING STOPS
// BEING TRUE. "shaadi december me hai" is a true statement from the day it is
// said until December; after December the same words are a wrong statement
// about a wedding that already happened. That is exactly the transition
// `staleNote` was trying to detect by counting days since the row was written.
//
// `valid_from` is when the claim entered the world as far as we can tell —
// `saidAt`. We do not have, and do not invent, an earlier one.
//
// ── ONE PARSER, NOT TWO ──────────────────────────────────────────────────
// The date extraction is `timeline.ts`'s `resolveWhen`, imported, not
// reimplemented. That function is already the repo's authored, deterministic,
// no-model-call date table (Hinglish included: kal / parso / agle hafte /
// agle mahine, plus the deliberate `may`-the-modal carve-out), it is already
// gated by `evals/time/his.mjs`, and a second parser would be a second
// definition of what "november" means — the exact shape
// `scripts/build-engine-bundle.mjs`'s header refuses for the persona and
// `serverEntry.ts` refuses for the derivers.
//
// ── DERIVATION IS CLOCK-FREE, ON PURPOSE ─────────────────────────────────
// `deriveFactValidity` passes `saidAt` as `resolveWhen`'s `now`. That is not a
// convenience: `resolveWhen`'s only use of `now` is its `stale` branch ("time
// shaped, undated, and the ROW is old"), which is the very heuristic this
// module replaces. Anchoring on `saidAt` makes the stale branch structurally
// unreachable here AND makes the derivation a pure function of the row — the
// same fact consolidated today and re-consolidated next year produces the same
// two timestamps, which is the only way a stored validity interval can be
// compared against a future one at all. There is no `Date.now()` in this file.
//
// ── ABSENCE IS THE DEFAULT AND MUST STAY BYTE-IDENTICAL ──────────────────
// `deriveFactValidity` returns `null` for every fact whose text carries no
// resolvable date, which is most facts. A null validity means callers write
// NULL columns, and every consumer here is written so that NULL reproduces
// today's behaviour exactly: `factStaleness` returns "unknown" (the caller
// falls back to the row-age rule, unchanged), and `validityOverlaps` returns
// true (the caller supersedes by name, unchanged). Existing fixtures move zero
// bytes because every row in them has no validity.
import { resolveWhen, type TimeBoundFact, type Basis } from "./timeline";

// ─────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────

/** An event-time interval for one fact. Both fields are epoch ms.
 *
 *  `validTo === null` means "open" — true from `validFrom` onwards, with no
 *  horizon we can name. It is NOT the same as no validity at all: a row with
 *  {validFrom, validTo: null} has been examined and found dateless-but-anchored;
 *  a row with no validity has not been examined or produced nothing. Today
 *  `deriveFactValidity` never returns the open form (it returns null instead),
 *  and the type admits it so a future deriver that CAN anchor a start without a
 *  horizon does not need a schema change. */
export interface FactValidity {
  validFrom: number;
  validTo: number | null;
  /** how the horizon was reached — `resolveWhen`'s own basis, minus "stale",
   *  which is unreachable here (see the header). Stored so a later reader can
   *  tell a date the person actually gave ("november") from one this repo's
   *  table inferred ("agle hafte" + an anchor). */
  basis: Exclude<Basis, "stale">;
}

/** What the interval says about NOW.
 *
 *  "unknown" is load-bearing and is not an error state: it is the answer for
 *  every fact without a derivable date, and it is the signal that tells a
 *  caller to fall back to whatever it did before this module existed. */
export type Staleness = "ahead" | "past" | "unknown";

/** The row shape this needs, so nothing here imports a store's type. It is
 *  `TimeBoundFact` exactly — the same interface `hisClock` consumes — because
 *  a second, differently-shaped view of "a fact with a time in it" is how the
 *  two drift. `meera_nodes` and `vy_fact` both already map onto it (see
 *  `TimeBoundFact`'s own doc comment for the two adapters). */
export type ValidityInput = TimeBoundFact;

// ─────────────────────────────────────────────────────────────────────────
// DERIVATION (write side — consolidation and the node writer)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Derive one fact's event-time interval, or null when the text carries no
 * date this repo's authored table can resolve.
 *
 * Pure. Deterministic. No clock, no model call, no store.
 *
 * WHY THE RESULT CAN BE IN THE PAST AT WRITE TIME AND THAT IS FINE: a fact
 * consolidated a week late about "kal ka interview" resolves to a horizon
 * already behind us. That is CORRECT and is the whole point — the row is born
 * knowing it is past, and `staleNote` hedges it on the first recall instead of
 * waiting 45 days for the row to age into a guess.
 */
export function deriveFactValidity(f: ValidityInput): FactValidity | null {
  if (!f || !Number.isFinite(f.saidAt)) return null;
  const saidAt = Number(f.saidAt);
  // `now = saidAt` — see the header. This is what makes the function a pure
  // function of the row and makes resolveWhen's `stale` branch unreachable.
  const r = resolveWhen(f, saidAt);
  if (!r || r.at === null || r.basis === "stale") return null;
  if (!Number.isFinite(r.at)) return null;
  return { validFrom: saidAt, validTo: r.at, basis: r.basis };
}

// ─────────────────────────────────────────────────────────────────────────
// STALENESS (read side — api/memory.js's staleNote)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Is this fact's horizon behind us?
 *
 * A QUERY OVER VALIDITY, which is the sentence ROADMAP-100X item 4 is written
 * in: no LLM call and no row-age guess. Three lines, no parser — deliberately,
 * so the read path (`api/memory.js`, the latency-critical one) needs no import
 * of the engine bundle at all. Only the WRITE path needs the parser.
 *
 * `validTo` absent → "unknown" → the caller keeps the rule it already had.
 */
export function factStaleness(
  v: { validFrom?: number | null; validTo?: number | null } | null | undefined,
  now: number,
): Staleness {
  const to = v && typeof v.validTo === "number" && Number.isFinite(v.validTo) ? v.validTo : null;
  if (to === null) return "unknown";
  return now > to ? "past" : "ahead";
}

// ─────────────────────────────────────────────────────────────────────────
// CONTRADICTION (write side — api/consolidate.js)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Do two facts' event-time intervals overlap?
 *
 * WHAT THIS CHANGES. Consolidation's contradiction rule is "same lowercased
 * name + different body ⇒ the older row is superseded". That is right for a
 * belief that changed ("lives in lucknow" → "lives in delhi") and WRONG for a
 * sequence of same-named, differently-dated things: two rows named `exam`, one
 * for November 2026 and one for May 2027, are not a contradiction — they are
 * two exams, and superseding the first deletes a real fact from recall the
 * moment the second is mentioned.
 *
 * Half-open intervals [from, to). A null `from` is -infinity, a null `to` is
 * +infinity, so a row with NO validity overlaps everything and the caller's
 * behaviour is byte-identical to today. That default is chosen in the safe
 * direction on purpose: absent validity keeps the existing supersession, which
 * is a rule this repo has shipped and measured; only a row that positively
 * knows its own disjoint horizon opts out of it.
 */
export function validityOverlaps(
  a: { validFrom?: number | null; validTo?: number | null } | null | undefined,
  b: { validFrom?: number | null; validTo?: number | null } | null | undefined,
): boolean {
  const num = (x: unknown): number | null =>
    typeof x === "number" && Number.isFinite(x) ? x : null;
  const aFrom = num(a?.validFrom) ?? -Infinity;
  const aTo = num(a?.validTo) ?? Infinity;
  const bFrom = num(b?.validFrom) ?? -Infinity;
  const bTo = num(b?.validTo) ?? Infinity;
  return aFrom < bTo && bFrom < aTo;
}

/** Parse a Postgres timestamptz (or anything `Date` accepts) to epoch ms, or
 *  null. The one adapter the SQL callers need, kept here so three call sites
 *  do not each grow their own `new Date(x).getTime()` with a different NaN
 *  story. */
export function validityMs(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = new Date(v as string).getTime();
  return Number.isFinite(t) ? t : null;
}

/** ISO string for a derived bound, or null — the shape the `timestamptz`
 *  columns are bound with. Same reason as `validityMs`: one adapter. */
export function validityIso(ms: number | null | undefined): string | null {
  return typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
