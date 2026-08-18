// The WE-store: rel-event writers, dimension hysteresis, snapshot replay,
// and the T2/T4/T6 tail renderers — SPEC §6, §3.2. WS-RELSTATE, M4.
// Ownership (SPEC §13): this file belongs to WS-RELSTATE exclusively.
//
// ARCHITECTURE NOTE (read before editing): src/engine/*.ts is the CLIENT
// bundle — compiler.ts's own header says as much ("imported by brain.ts,
// which runs in the browser/Capacitor app"). This file follows the same
// rule and therefore never imports api/_db.js or api/_config.js statically
// — that would drag server secrets into the Vite build. Instead every
// DB-facing function here takes a `QueryFn` as its first argument (the
// exact call shape of api/_db.js's `q`, duck-typed, not imported) so a
// server caller passes the real thing and a test passes a fake one. The
// pure functions (hysteresis math, render functions, replay fold) take no
// I/O at all — SPEC's own words for the one proven portability mechanism:
// "authored/structural state + deterministic retrieval... beats generated
// text + prompt instructions."
//
// CALL-SITE WIRING IS NOT THIS FILE'S JOB. Every exported function here is
// meant to be called by something outside WS-RELSTATE's file ownership:
// the nightly derivation by a WS-CONSOLIDATE cron step, the render
// functions by WS-COMPILER's compiler.ts TAIL assembly, stageForDims by
// whoever owns persona.ts's call site. Each is logged as an interface
// ticket in the M4 report rather than wired here, per the collision
// contract (SPEC §13: "cross-workstream needs go through declared
// interfaces, never edits to another workstream's files").
import { lintLine } from "./shapelint";

// ─────────────────────────────────────────────────────────────────────────
// Types — mirror db/schema.sql migration 003 exactly (WS-SCHEMA, already
// live; see db/schema.sql lines ~384-465).
// ─────────────────────────────────────────────────────────────────────────

export type Honorific = "tu" | "tum" | "aap";
export type RepairState = "none" | "open" | "repairing" | "repaired";
export type CsOnStress = "retreat_l2" | "intensify_l1" | "unknown";
export type RelDim = "honorific" | "trust" | "rupture" | "repair" | "code_switch";
export type Direction = "advance" | "regress" | "reset" | "init";

/** `dim` values NOT written by this file's event writer, though they appear
 *  in vy_rel_event.dim's documentation comment ("honorific|trust|rupture|
 *  repair|ritual|code_switch|pacing"): `ritual` and `pacing`. SPEC §6.2's
 *  own table classifies ritual_density and pacing as "derived | pure SQL
 *  from ground truth", explicitly NOT cited-event-sourced state — the
 *  schema comment's vocabulary is broader than what §6.2 says should ever
 *  be written. Treated here as the schema comment being aspirational/
 *  inclusive rather than a second source of truth; §6.2 wins. Logged as a
 *  found deviation in the M4 report rather than silently resolved either
 *  way. */
export const RESERVED_UNUSED_DIMS = ["ritual", "pacing"] as const;

export interface RelEvent {
  id: number;
  person_id: string;
  dim: RelDim;
  from_v: string | null;
  to_v: string;
  direction: Direction;
  note: string;
  citations: number[];
  at: string; // ISO timestamp, as returned by Postgres over SQL-HTTP
}

export interface RelState {
  person_id: string;
  honorific: Honorific;
  cs_ratio: number | null;
  cs_on_stress: CsOnStress;
  trust: number;
  rupture_open: boolean;
  repair_state: RepairState;
  ritual_density: number;
  pacing_gap_s: number | null;
  snapshot_ver: number;
  updated_at: string;
}

export interface PatternRow {
  id: number;
  person_id: string;
  moment: string;
  if_shape: string;
  then_note: string;
  self_in_relation: string;
  citations: number[];
  support_count: number;
  distinct_days: number;
  prompt_eligible: boolean;
  times_contradicted: number;
  t_invalid: string | null;
  last_used: string | null;
}

/** Duck-typed against api/_db.js's `q(query, params, timeoutMs)` — never
 *  imported, only accepted as a parameter (see file header). */
export type QueryFn = (query: string, params?: unknown[], timeoutMs?: number) => Promise<any[]>;

// ─────────────────────────────────────────────────────────────────────────
// Defaults — must match db/schema.sql's column defaults exactly, since the
// replay fold (below) starts from this and vy_rel_state's own DDL defaults
// must never drift from what a from-scratch replay produces.
// ─────────────────────────────────────────────────────────────────────────

export function initialRelState(personId: string): RelState {
  return {
    person_id: personId,
    honorific: "tum",
    cs_ratio: null,
    cs_on_stress: "unknown",
    trust: 0.3,
    rupture_open: false,
    repair_state: "none",
    ritual_density: 0,
    pacing_gap_s: null,
    snapshot_ver: 0,
    updated_at: new Date(0).toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Hysteresis — SPEC §6.2's table, one function per row that has a "moves
// how" cell. Every one of these is pure: no I/O, no clock reads beyond an
// explicit `now` parameter, so they are unit-testable without a database
// and re-derivable byte-for-byte from the same inputs (§0.1 law 3).
// ─────────────────────────────────────────────────────────────────────────

const HONORIFIC_ORDER: Record<Honorific, number> = { aap: 0, tum: 1, tu: 2 };
// warmth direction: aap(0) -> tum(1) -> tu(2) is "advance" (more familiar,
// earned slowly); the reverse is "regress" (offense, instant).

export interface AddressEvidence {
  term: Honorific;
  episodeId: number;
  at: string; // ISO
}

export interface HonorificMoveResult {
  next: Honorific;
  direction: Direction;
  citations: number[];
  note: string;
}

const HONORIFIC_MIN_EPISODES = 3;
const HONORIFIC_MIN_SPAN_DAYS = 7;
const MS_PER_DAY = 86_400_000;

/**
 * SPEC §6.2 honorific row, applied. `evidence` is address-term observations
 * ALREADY gathered by the caller (this function does no text scanning —
 * see `detectAddressTerm` below for that half); `explicitInvite`, if
 * present, is a single cited episode where the user explicitly invited a
 * register (e.g. "bas tu bol"). Returns `null` when nothing should move —
 * the common case, and the ONLY output that leaves vy_rel_state untouched.
 *
 * Hysteresis is asymmetric BY CONSTRUCTION, not by a tunable knob: advance
 * requires the ≥3-episodes/≥7-days evidence bar (or an explicit invite);
 * regress requires only `ruptureOpen` becoming true, checked first and
 * short-circuiting everything else, so "offense is instant" cannot be
 * starved by a slow-accumulating advance in flight.
 */
export function honorificShift(
  current: Honorific,
  evidence: readonly AddressEvidence[],
  ruptureOpen: boolean,
  explicitInvite: { term: Honorific; episodeId: number } | null,
  now: Date = new Date(),
): HonorificMoveResult | null {
  // Regress first, unconditionally: "one rupture episode regresses
  // immediately" — this branch must never be reachable only after the
  // advance checks below, or a rupture arriving mid-accumulation would be
  // shadowed by evidence that predates it.
  if (ruptureOpen && HONORIFIC_ORDER[current] > HONORIFIC_ORDER.aap) {
    const next: Honorific = current === "tu" ? "tum" : "aap";
    return {
      next,
      direction: "regress",
      citations: [],
      note: `rupture: regress ${current}->${next}`,
    };
  }

  if (explicitInvite && HONORIFIC_ORDER[explicitInvite.term] !== HONORIFIC_ORDER[current]) {
    const direction: Direction =
      HONORIFIC_ORDER[explicitInvite.term] > HONORIFIC_ORDER[current] ? "advance" : "regress";
    return {
      next: explicitInvite.term,
      direction,
      citations: [explicitInvite.episodeId],
      note: `explicit invite: ${current}->${explicitInvite.term}`,
    };
  }

  // Advance: target term must be MORE familiar than current, observed
  // across >=3 distinct episodes spanning >=7 days, no rupture open (the
  // ruptureOpen branch above already returned if true, but a target LESS
  // familiar than current under an evidence trail is never an "advance" —
  // guarded explicitly rather than relying on the early return above).
  const byTerm = new Map<Honorific, AddressEvidence[]>();
  for (const e of evidence) {
    if (new Date(e.at).getTime() > now.getTime()) continue; // never count evidence from the future
    if (HONORIFIC_ORDER[e.term] <= HONORIFIC_ORDER[current]) continue; // not an advance target
    const arr = byTerm.get(e.term) ?? [];
    arr.push(e);
    byTerm.set(e.term, arr);
  }

  let best: { term: Honorific; rows: AddressEvidence[] } | null = null;
  for (const [term, rows] of byTerm) {
    const distinctEpisodes = new Set(rows.map((r) => r.episodeId));
    if (distinctEpisodes.size < HONORIFIC_MIN_EPISODES) continue;
    const times = rows.map((r) => new Date(r.at).getTime()).sort((a, b) => a - b);
    const spanDays = (times[times.length - 1] - times[0]) / MS_PER_DAY;
    if (spanDays < HONORIFIC_MIN_SPAN_DAYS) continue;
    // most-familiar qualifying target wins if evidence somehow supports two
    if (!best || HONORIFIC_ORDER[term] > HONORIFIC_ORDER[best.term]) best = { term, rows };
  }
  if (!best) return null;

  const citations = [...new Set(best.rows.map((r) => r.episodeId))].sort((a, b) => a - b);
  const spanDays = (
    (new Date(best.rows[best.rows.length - 1].at).getTime() - new Date(best.rows[0].at).getTime()) /
    MS_PER_DAY
  ).toFixed(1);
  return {
    next: best.term,
    direction: "advance",
    citations,
    note: `${citations.length} episodes over ${spanDays}d: ${current}->${best.term}`,
  };
}

/** SPEC's own rendered example: "honorific: tum (his choice, 3w)" — the
 *  "3w" is elapsed time since the LAST honorific event, floored to whole
 *  weeks, never the raw day count (coarse band, §12 failure-mode 5). */
export function honorificAgeLabel(lastMoveAt: string | null, now: Date = new Date()): string {
  if (!lastMoveAt) return "unset";
  const days = (now.getTime() - new Date(lastMoveAt).getTime()) / MS_PER_DAY;
  const weeks = Math.floor(days / 7);
  if (weeks < 1) return "<1w";
  return `${weeks}w`;
}

// ── trust: slow scalar, ±0.05/day rate limit IN CODE (§10-Q10) ──

export const TRUST_MAX_DELTA_PER_DAY = 0.05;

/**
 * Clamps a proposed trust delta by elapsed time since the LAST trust-dim
 * event, not by a fixed per-call step — a rate limit measured any other
 * way could be defeated by calling this function more often. `lastMoveAt
 * === null` (no trust event yet) is capped at one day's worth rather than
 * left unbounded, so the very first write cannot swing the dyad either.
 */
export function clampTrustDelta(rawDelta: number, lastMoveAt: string | null, now: Date = new Date()): number {
  if (rawDelta === 0) return 0;
  const days = lastMoveAt ? Math.max(0, (now.getTime() - new Date(lastMoveAt).getTime()) / MS_PER_DAY) : 1;
  const maxAbs = TRUST_MAX_DELTA_PER_DAY * days;
  const sign = Math.sign(rawDelta);
  return sign * Math.min(Math.abs(rawDelta), maxAbs);
}

export interface TrustMoveResult {
  next: number;
  direction: Direction;
  delta: number;
}

/** Applies a rate-limited trust move and clamps the RESULT to [0,1] (the
 *  column has no CHECK enforcing this, so the guarantee lives here). */
export function moveTrust(
  current: number,
  rawDelta: number,
  lastMoveAt: string | null,
  now: Date = new Date(),
): TrustMoveResult {
  const clamped = clampTrustDelta(rawDelta, lastMoveAt, now);
  const next = Math.max(0, Math.min(1, current + clamped));
  const direction: Direction = clamped > 0 ? "advance" : clamped < 0 ? "regress" : "init";
  return { next, direction, delta: next - current };
}

/** SPEC's own trust band vocabulary is not given verbatim; these five
 *  bands are the coarse-rendering mechanism the state-leak guard (§12.5)
 *  requires — "numeric values rendered as coarse bands only." Boundaries
 *  chosen so the schema default (0.3) reads as "building", never "new"
 *  (a brand-new relationship should not render as colder than its own
 *  starting point) and never "steady" (0.3 has not earned that yet). */
export function bandTrust(trust: number): string {
  if (trust < 0.2) return "new";
  if (trust < 0.45) return "building";
  if (trust < 0.7) return "steady";
  if (trust < 0.88) return "strong";
  return "deep";
}

// ── rupture/repair: state machine, "repair requires THEIR signal, never
//    her assumption" (§6.2) ──

export interface RuptureRepairInput {
  ruptureOpen: boolean;
  repairState: RepairState;
}

export interface RuptureRepairMove {
  ruptureOpen: boolean;
  repairState: RepairState;
  dim: "rupture" | "repair";
  direction: Direction;
  note: string;
}

/** `conflictSignal` = this episode's moment-shape resolved to "conflict"
 *  (moment.ts's classifier, already run by the caller — kept out of this
 *  file so relstate.ts never re-implements moment.ts's job). `theirRepairSignal`
 *  must be an explicit affirmative FROM THE USER's own turn (e.g. an
 *  extractor-tagged "sorry"/reconciliation moment) — passing anything her
 *  own output produced here would violate "never her assumption". */
export function ruptureRepairShift(
  state: RuptureRepairInput,
  conflictSignal: boolean,
  theirRepairSignal: boolean,
): RuptureRepairMove | null {
  if (conflictSignal && !state.ruptureOpen) {
    return {
      ruptureOpen: true,
      repairState: "open",
      dim: "rupture",
      direction: "advance", // "advance" = the rupture state machine moved, not a value judgement
      note: "conflict-shaped episode: rupture opens",
    };
  }
  if (conflictSignal && state.ruptureOpen && state.repairState !== "open") {
    // re-rupture during repair: regress per SPEC's dims table ("regress on
    // re-rupture")
    return {
      ruptureOpen: true,
      repairState: "open",
      dim: "repair",
      direction: "regress",
      note: "re-rupture during repair: repair regresses to open",
    };
  }
  if (state.ruptureOpen && state.repairState === "open" && theirRepairSignal) {
    return {
      ruptureOpen: state.ruptureOpen,
      repairState: "repairing",
      dim: "repair",
      direction: "advance",
      note: "their signal: repair begins",
    };
  }
  if (state.ruptureOpen && state.repairState === "repairing" && theirRepairSignal) {
    return {
      ruptureOpen: false,
      repairState: "repaired",
      dim: "repair",
      direction: "advance",
      note: "their signal sustained: repaired, rupture closes",
    };
  }
  return null;
}

// ── code-switch direction: "direction set only after >=3 high-affect
//    episodes agree, else 'unknown' — and while unknown the engine must
//    NOT infer closeness or stress from switching" (§6.2) ──

const CS_MIN_AGREEING = 3;

export interface CsDirectionSignal {
  episodeId: number;
  direction: "retreat_l2" | "intensify_l1";
}

/** Majority-agreement gate. Returns 'unknown' unless >=3 signals agree on
 *  the SAME direction — a 2-1 split stays 'unknown' by design, not
 *  resolved by majority-of-available, because a resolved-but-wrong
 *  direction is exactly what §6.2 forbids inferring from. */
export function csDirectionFromSignals(signals: readonly CsDirectionSignal[]): CsOnStress {
  const counts: Record<"retreat_l2" | "intensify_l1", Set<number>> = {
    retreat_l2: new Set(),
    intensify_l1: new Set(),
  };
  for (const s of signals) counts[s.direction].add(s.episodeId);
  if (counts.retreat_l2.size >= CS_MIN_AGREEING && counts.retreat_l2.size > counts.intensify_l1.size) {
    return "retreat_l2";
  }
  if (counts.intensify_l1.size >= CS_MIN_AGREEING && counts.intensify_l1.size > counts.retreat_l2.size) {
    return "intensify_l1";
  }
  return "unknown";
}

// ─────────────────────────────────────────────────────────────────────────
// Address-term detection — the text-scanning half honorificShift consumes.
// Deterministic, whole-word, authored markers (same shape as inner.ts's
// TASTE table / culture.ts's COMMON set / moment.ts's MOMENT_KEYS).
// ─────────────────────────────────────────────────────────────────────────

const padT = (s: string) =>
  " " +
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim() +
  " ";

const TU_MARKERS = [" tu ", " tera ", " teri ", " tere ", " tujhe ", " tujhko "].map((s) => s);
const AAP_MARKERS = [" aap ", " aapka ", " aapki ", " aapke ", " aapko ", " aapse "].map((s) => s);
// "tum" markers deliberately absent from AAP/TU disambiguation below: tum is
// the default/middle register (schema default), so it is inferred by
// ABSENCE of tu/aap markers when a second-person address is present at all,
// never by its own marker list — "tumhara" etc. would just double-count
// against a message that also contains "tera", which is not how anyone
// actually mixes registers.
const TUM_MARKERS = [" tum ", " tumhe ", " tumhara ", " tumhari ", " tumhare ", " tumko "];

/** Returns the address term used TOWARD the addressee in one message, or
 *  null if none of the authored markers fire — never a guess. A message
 *  using more than one register (rare, e.g. correcting themselves
 *  mid-sentence) reports the LAST marker found, matching how a reader
 *  would take the sentence's actual register to be its final word choice. */
export function detectAddressTerm(text: string): Honorific | null {
  const hay = padT(String(text || ""));
  const candidates: Array<[readonly string[], Honorific]> = [
    [AAP_MARKERS, "aap"],
    [TU_MARKERS, "tu"],
    [TUM_MARKERS, "tum"],
  ];
  let bestTerm: Honorific | null = null;
  let bestIdx = -1;
  for (const [markers, term] of candidates) {
    for (const m of markers) {
      const idx = hay.lastIndexOf(m);
      if (idx >= 0 && idx > bestIdx) {
        bestIdx = idx;
        bestTerm = term;
      }
    }
  }
  return bestTerm;
}

// ─────────────────────────────────────────────────────────────────────────
// Snapshot replay — SPEC §6.2 "the snapshot is a cache rebuilt by replay";
// §9.1 step 5 (forget rebuilds it); this file's own gate requirement
// ("same inputs, same snapshot, byte-equal"). PURE: takes an already-
// fetched, already-ordered event list and folds it. Determinism therefore
// reduces to "is the fold pure and is the input order stable" — both true
// by construction here.
// ─────────────────────────────────────────────────────────────────────────

/** Stable order: `at` ascending, `id` ascending as the tie-break (identity
 *  column is monotonic, so this is a total order even when two events
 *  share a timestamp from the same batched write). */
export function orderEvents(events: readonly RelEvent[]): RelEvent[] {
  return [...events].sort((a, b) => {
    const t = new Date(a.at).getTime() - new Date(b.at).getTime();
    return t !== 0 ? t : a.id - b.id;
  });
}

/**
 * The replay fold itself. `bumpVersion`: SPEC §6.2 — "snapshot_ver bumps
 * ONLY at consolidation", so a mid-turn recompute (e.g. after a single new
 * event) must call this with `bumpVersion: false` and a post-consolidation
 * rebuild calls it with `true`. Everything else about the fold is a pure
 * function of `events`, so calling it twice on the identical array produces
 * byte-identical JSON — the replay-determinism gate is exactly this
 * property, asserted directly rather than inferred.
 */
export function replaySnapshot(
  personId: string,
  events: readonly RelEvent[],
  opts: { bumpVersion?: boolean; baseVer?: number } = {},
): RelState {
  const state = initialRelState(personId);
  state.snapshot_ver = opts.baseVer ?? 0;
  let latestAt = new Date(0).toISOString();

  for (const ev of orderEvents(events)) {
    switch (ev.dim) {
      case "honorific":
        if (ev.to_v === "tu" || ev.to_v === "tum" || ev.to_v === "aap") state.honorific = ev.to_v;
        break;
      case "trust": {
        const v = Number(ev.to_v);
        if (Number.isFinite(v)) state.trust = Math.max(0, Math.min(1, v));
        break;
      }
      case "rupture":
        state.rupture_open = ev.to_v === "open";
        break;
      case "repair":
        if (ev.to_v === "none" || ev.to_v === "open" || ev.to_v === "repairing" || ev.to_v === "repaired") {
          state.repair_state = ev.to_v;
          state.rupture_open = ev.to_v === "open" || ev.to_v === "repairing";
        }
        break;
      case "code_switch":
        if (ev.to_v === "retreat_l2" || ev.to_v === "intensify_l1" || ev.to_v === "unknown") {
          state.cs_on_stress = ev.to_v;
        }
        break;
      default:
        // RESERVED_UNUSED_DIMS or anything unrecognized — ignored, not
        // thrown: a rebuild must never fail on a row an older/newer writer
        // version produced, per §0.1 law 3 ("re-derivable... must pass the
        // invariant suite", not "must have written identical dims").
        break;
    }
    latestAt = ev.at;
  }

  if (opts.bumpVersion) state.snapshot_ver = (opts.baseVer ?? 0) + 1;
  state.updated_at = events.length ? latestAt : state.updated_at;
  return state;
}

// ─────────────────────────────────────────────────────────────────────────
// DB-facing writers — QueryFn-injected, see file header.
// ─────────────────────────────────────────────────────────────────────────

export interface WriteRelEventInput {
  person_id: string;
  dim: RelDim;
  from_v: string | null;
  to_v: string;
  direction: Direction;
  note: string;
  citations: number[];
}

/** Citation law (§0.2.3, §2.4 CHECK): `citations.length >= 1` is enforced
 *  by the DB CHECK too, but failing here is cheaper than a round trip and
 *  gives a caller a specific reason instead of a generic constraint-
 *  violation error. Also runs the note through shapelint's `lintLine` —
 *  belt-and-braces per SPEC §3.3 ("at write... and at compile"); a
 *  violation is logged and the write proceeds with the reasons attached
 *  to the return value rather than silently swallowed, so a write-time
 *  regression is visible without being ship-blocking on its own (compile-
 *  time lint is the actual gate, per shapelint.ts's own comment: "Compile-
 *  time hit rate is the metric that write-time lint works"). */
export interface WriteRelEventResult {
  id: number;
  lintClean: boolean;
  lintReasons: string[];
}

export async function writeRelEvent(q: QueryFn, input: WriteRelEventInput): Promise<WriteRelEventResult> {
  if (!input.citations || input.citations.length < 1) {
    throw new Error(`vy_rel_event requires >=1 citation (dim=${input.dim}, person=${input.person_id})`);
  }
  const lint = lintLine(input.note);
  const rows = await q(
    `insert into vy_rel_event (person_id, dim, from_v, to_v, direction, note, citations)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [input.person_id, input.dim, input.from_v, input.to_v, input.direction, input.note, input.citations],
  );
  return { id: Number(rows[0]?.id), lintClean: lint.reasons.length === 0, lintReasons: lint.reasons };
}

/** Fetches every surviving vy_rel_event for a person (forget's citation-
 *  join cascade, §9.1.3, is what makes "surviving" the correct word — a
 *  forgotten citation's event is already gone by the time this runs) and
 *  replays it. This is the literal function forget's cascade and any
 *  scheduled rebuild both call — one mechanism, both call sites. */
export async function rebuildSnapshotFromDb(
  q: QueryFn,
  personId: string,
  opts: { bumpVersion?: boolean } = {},
): Promise<RelState> {
  const rows = await q(
    `select id, person_id, dim, from_v, to_v, direction, note, citations, at
       from vy_rel_event where person_id = $1 order by at asc, id asc`,
    [personId],
  );
  const events: RelEvent[] = rows.map((r: any) => ({
    id: Number(r.id),
    person_id: r.person_id,
    dim: r.dim,
    from_v: r.from_v,
    to_v: r.to_v,
    direction: r.direction,
    note: r.note,
    citations: r.citations,
    at: r.at,
  }));
  const existing = await q(`select snapshot_ver from vy_rel_state where person_id = $1`, [personId]);
  const baseVer = existing.length ? Number(existing[0].snapshot_ver) : 0;
  const state = replaySnapshot(personId, events, { bumpVersion: opts.bumpVersion, baseVer });

  await q(
    `insert into vy_rel_state
       (person_id, honorific, cs_ratio, cs_on_stress, trust, rupture_open, repair_state,
        ritual_density, pacing_gap_s, snapshot_ver, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     on conflict (person_id) do update set
       honorific = excluded.honorific, cs_ratio = excluded.cs_ratio,
       cs_on_stress = excluded.cs_on_stress, trust = excluded.trust,
       rupture_open = excluded.rupture_open, repair_state = excluded.repair_state,
       ritual_density = excluded.ritual_density, pacing_gap_s = excluded.pacing_gap_s,
       snapshot_ver = excluded.snapshot_ver, updated_at = now()`,
    [
      personId,
      state.honorific,
      state.cs_ratio,
      state.cs_on_stress,
      state.trust,
      state.rupture_open,
      state.repair_state,
      state.ritual_density,
      state.pacing_gap_s,
      state.snapshot_ver,
    ],
  );
  return state;
}

// ── derived dims: ritual_density, pacing_gap_s — "derived | pure SQL from
//    ground truth" (§6.2), never event-sourced. cs_ratio also lives here
//    (§8 table: "code_switch_baseline... rel state | deterministic ratio
//    from THEIR tokens"), computed the same way — pure SQL, no LLM. ──

// Authored Hinglish/Romanized-Hindi marker set for the token-ratio SQL
// below — small and deliberately conservative (function words only, the
// same category as culture.ts's COMMON list) so the ratio measures
// register, not vocabulary richness.
const HINDI_MARKER_WORDS = [
  "hai", "hain", "tha", "thi", "the", "kya", "kyun", "kyu", "nahi", "nhi",
  "haan", "haa", "mera", "meri", "mere", "tera", "teri", "tere", "tum",
  "tumhara", "tumhari", "aap", "aapka", "hum", "humara", "yaar", "bhai",
  "kar", "karo", "karna", "raha", "rahi", "rahe", "gaya", "gayi", "gaye",
  "acha", "accha", "theek", "matlab", "bas", "abhi", "kal", "aaj",
];

/** Pure SQL, deterministic: fraction of the person's last 200 user-role
 *  meera_log rows whose content contains at least one Hindi marker word,
 *  joined through vy_person_device (meera_log is device-keyed, WS-SCHEMA's
 *  legacy table, kept per §0.3's substrate ruling). Read-only against a
 *  table this file does not own — reading across an ownership boundary is
 *  fine; only edits are restricted (§13). */
export async function computeCsRatio(q: QueryFn, personId: string): Promise<number | null> {
  const pattern = HINDI_MARKER_WORDS.map((w) => `\\m${w}\\M`).join("|");
  const rows = await q(
    `with recent as (
       select l.content from meera_log l
       join vy_person_device d on d.device_id = l.device_id
       where d.person_id = $1 and l.role = 'me'
       order by l.at desc limit 200
     )
     select count(*)::int as total,
            count(*) filter (where content ~* $2)::int as hindi_hits
       from recent`,
    [personId, pattern],
  );
  const total = Number(rows[0]?.total ?? 0);
  if (total < 10) return null; // too little signal to be worth rendering
  const hits = Number(rows[0]?.hindi_hits ?? 0);
  return Math.round((hits / total) * 1000) / 1000;
}

/** Ritual density: fraction of tracked vy_ritual rows with an occurrence
 *  in the trailing 30 days. Pure SQL, no LLM. */
export async function computeRitualDensity(q: QueryFn, personId: string): Promise<number> {
  const rows = await q(
    `select count(*) filter (where last_at > now() - interval '30 days')::real
              / greatest(count(*), 1)::real as density
       from vy_ritual where person_id = $1`,
    [personId],
  );
  return Math.round((Number(rows[0]?.density ?? 0)) * 1000) / 1000;
}

/** Pacing: median gap in seconds between consecutive episode starts over
 *  the trailing 30 days. Pure SQL, no LLM. Explicitly NOT depth — SPEC
 *  §6.2's own caution: "90 messages in one evening != 90 across a month" —
 *  which is exactly why this is a GAP measure, not a count. */
export async function computePacingGapS(q: QueryFn, personId: string): Promise<number | null> {
  const rows = await q(
    `select percentile_cont(0.5) within group (order by gap_s) as pacing_gap_s
       from (
         select extract(epoch from started_at - lag(started_at) over (order by started_at)) as gap_s
           from vy_episode where person_id = $1 and started_at > now() - interval '30 days'
       ) s where gap_s is not null`,
    [personId],
  );
  const v = rows[0]?.pacing_gap_s;
  return v === null || v === undefined ? null : Math.round(Number(v));
}

/** Recomputes and writes the three derived columns in one round trip —
 *  called independently of rebuildSnapshotFromDb (derived dims are not
 *  event-sourced, so they do not participate in replay and must not bump
 *  snapshot_ver, which "bumps ONLY at consolidation" per event writes). */
export async function refreshDerivedDims(q: QueryFn, personId: string): Promise<void> {
  const [csRatio, ritualDensity, pacingGapS] = await Promise.all([
    computeCsRatio(q, personId),
    computeRitualDensity(q, personId),
    computePacingGapS(q, personId),
  ]);
  await q(
    `update vy_rel_state set cs_ratio = $2, ritual_density = $3, pacing_gap_s = $4
       where person_id = $1`,
    [personId, csRatio, ritualDensity, pacingGapS],
  );
}

// ── patterns: dyadic if-then rows (Baldwin), promotion is the stored
//    generated column (support_count>=3 AND distinct_days>=2), never an
//    LLM score. Writing them is WS-RELSTATE's job per consolidate.js's
//    own "OUT OF SCOPE" comment. ──

export interface WritePatternInput {
  person_id: string;
  moment: string;
  if_shape: string;
  then_note: string;
  self_in_relation?: string;
  citations: number[];
}

export async function writePattern(q: QueryFn, input: WritePatternInput): Promise<number> {
  if (!input.citations || input.citations.length < 2) {
    throw new Error(
      `vy_pattern requires >=2 citations (one instance is an anecdote) — got ${input.citations?.length ?? 0}`,
    );
  }
  const rows = await q(
    `insert into vy_pattern (person_id, moment, if_shape, then_note, self_in_relation, citations)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [input.person_id, input.moment, input.if_shape, input.then_note, input.self_in_relation ?? "", input.citations],
  );
  return Number(rows[0]?.id);
}

/** Support/distinct-day increments for an EXISTING pattern that a new
 * episode re-confirms — `prompt_eligible` is the stored generated column,
 * recomputed by Postgres itself, never assigned here. */
export async function reinforcePattern(
  q: QueryFn,
  patternId: number,
  newCitation: number,
  episodeDay: string,
): Promise<void> {
  await q(
    `update vy_pattern
        set citations = array_append(citations, $2),
            support_count = support_count + 1,
            distinct_days = (
              select count(distinct date_trunc('day', e.started_at))
                from vy_episode e where e.id = any(array_append(citations, $2))
            ),
            last_used = now()
      where id = $1`,
    [patternId, newCitation],
  ).catch(() => {
    // fallback for a Postgres build without date_trunc-over-subquery support
    // in this exact shape — never silently drop the reinforcement signal
    return q(
      `update vy_pattern set citations = array_append(citations, $2),
              support_count = support_count + 1, last_used = now() where id = $1`,
      [patternId, newCitation],
    );
  });
  void episodeDay; // kept in the signature for callers that already have it cheaply available
}

// ─────────────────────────────────────────────────────────────────────────
// RENDER FUNCTIONS — T2, T4, T6, and the stage projection. Pure, no I/O.
// These are the WS-COMPILER interface tickets (exact contracts repeated in
// the M4 report). NEVER sentence-shaped: every line is `label: value (note)`
// telegraphic k:v, checked at the end of each function with shapelint's
// lintBlock so a violation is caught here rather than discovered at
// compile time in a fixture nobody is looking at that day.
// ─────────────────────────────────────────────────────────────────────────

import { lintBlock } from "./shapelint";

export interface RenderResult {
  text: string;
  lint: { clean: boolean; violations: number };
}

function finish(lines: string[], header: string): RenderResult {
  const text = lines.length ? `${header}\n${lines.map((l) => `- ${l}`).join("\n")}` : "";
  const lint = lintBlock(lines.join("\n"));
  return { text, lint: { clean: lint.clean, violations: lint.violations.length } };
}

/**
 * T2 `rel.snapshot` — budget 1,200 chars (SPEC §3.2). Content EXACTLY per
 * the spec row: honorific, trust band, repair_state, cs baseline+
 * direction, pacing. Numeric values (trust, cs_ratio, pacing_gap_s) never
 * render raw — coarse bands only (§12 failure mode 5, the state-leak
 * guard). Signature: `renderRelSnapshot(state: RelState, meta) => RenderResult`.
 */
export function renderRelSnapshot(
  state: RelState,
  meta: { lastHonorificMoveAt: string | null } = { lastHonorificMoveAt: null },
): RenderResult {
  const lines: string[] = [];
  lines.push(`honorific: ${state.honorific} (${honorificAgeLabel(meta.lastHonorificMoveAt)})`);
  lines.push(`trust: ${bandTrust(state.trust)}`);
  lines.push(`repair: ${state.repair_state}${state.rupture_open ? " (open)" : ""}`);
  const csLabel =
    state.cs_on_stress === "retreat_l2"
      ? "retreats toward english under stress"
      : state.cs_on_stress === "intensify_l1"
        ? "leans more hindi under stress"
        : "direction unclear";
  const csBase = state.cs_ratio === null ? "baseline unknown" : `baseline ${bandCsRatio(state.cs_ratio)}`;
  lines.push(`code-switch: ${csBase}, ${csLabel}`);
  lines.push(`pacing: ${bandPacing(state.pacing_gap_s)}`);
  const result = finish(lines, "RELATIONSHIP STATE (context only, never raise unprompted):");
  return capToRenderResult(result, 1200);
}

// GAP 4 (WS-FELT): exported so the closeness card (src/components/
// MoreSheet.tsx) can render the exact same coarse bands the model itself
// sees (renderRelSnapshot above) rather than reinventing thresholds — one
// set of numbers, one place, never drifting between what she "knows" and
// what the UI shows. No behavior change: these were already the module's
// state-leak guard (§12.5), just not reachable outside it.
export function bandCsRatio(ratio: number): string {
  if (ratio < 0.2) return "mostly english";
  if (ratio < 0.5) return "mixed, english-leaning";
  if (ratio < 0.8) return "mixed, hindi-leaning";
  return "mostly hindi";
}

export function bandPacing(gapS: number | null): string {
  if (gapS === null) return "not enough data";
  const hours = gapS / 3600;
  if (hours < 6) return "frequent";
  if (hours < 24) return "regular";
  if (hours < 72) return "sparse";
  return "occasional";
}

/**
 * T4 `dyadic.active` — budget 1,600 chars, ≤3 patterns, moment-gated
 * (moment.ts's `detectMomentShape`, called by the caller and passed in as
 * `moment` — this function does not import moment.ts to keep the gate
 * boundary explicit at the call site rather than hidden inside a render
 * function). Signature: `renderDyadicActive(patterns, moment) => RenderResult`.
 */
export function renderDyadicActive(patterns: readonly PatternRow[], moment: string): RenderResult {
  if (moment === "none") return finish([], "");
  const eligible = patterns
    .filter((p) => p.prompt_eligible && !p.t_invalid && p.moment === moment)
    .sort((a, b) => b.support_count - a.support_count)
    .slice(0, 3);
  const lines = eligible.map((p) => `${p.if_shape} -> ${p.then_note}`);
  const result = finish(lines, "PATTERN NOTES (this moment only, context — do not narrate that you noticed a pattern):");
  return capToRenderResult(result, 1600);
}

/** SPEC §6.3's shape-lint rule for WE-summaries: "a we-summary with no
 *  dono/saath/we/together token pair is rejected." Applied here as a
 *  belt-and-braces content filter before a row is even considered for T6,
 *  matching shapelint.ts's own two-job split (content lints vs structural
 *  checks) — this is the content half, kept local to the one render
 *  function that needs it rather than added to shapelint.ts (not this
 *  file's job to edit). */
const WE_TOKEN_RE = /\b(dono|dono[nm]e|saath|sath|we|together|hum(dono)?|humne)\b/i;

export interface WeEpisodeRow {
  id: number;
  summary: string;
  at: string;
}
export interface PhraseRow {
  phrase: string;
  gloss: string;
}

/**
 * T6 `we.callbacks` — budget 2,000 chars, ≤2 episodes + ≤2 phrases. `pulled`
 * comes from moment.ts's `hasDeixis` (the caller's job, per this file's
 * "no moment.ts import" convention above) — it changes ONLY the label,
 * never which rows are selected or how many: this is the literal mechanism
 * of "0 unprompted raises". Absent a pull signal, output still exists
 * (§6.3: "WE ranks like everything else under STANDING-BACKGROUND labels")
 * but never carries an active-callback framing. Signature:
 * `renderWeCallbacks(episodes, phrases, pulled) => RenderResult`.
 */
export function renderWeCallbacks(
  episodes: readonly WeEpisodeRow[],
  phrases: readonly PhraseRow[],
  pulled: boolean,
): RenderResult {
  const validEpisodes = episodes.filter((e) => WE_TOKEN_RE.test(e.summary)).slice(0, 2);
  const validPhrases = phrases.slice(0, 2);
  const lines = [
    ...validEpisodes.map((e) => `we: ${e.summary}`),
    ...validPhrases.map((p) => `phrase: "${p.phrase}" — ${p.gloss}`),
  ];
  const header = pulled
    ? "SHARED HISTORY — ACTIVE (they just referenced this; context only, still never announce that you remember):"
    : "SHARED HISTORY — STANDING BACKGROUND (context only; do not raise any of this yourself):";
  const result = finish(lines, header);
  return capToRenderResult(result, 2000);
}

/** SPEC §3.2: "The compiler NEVER slices — it drops whole blocks." A render
 *  function producing MORE than its budget is a manifest bug the CALLER's
 *  drop-order machinery (compiler.ts, not owned here) handles by dropping
 *  the whole block — this helper only ANNOTATES an overflow so it is
 *  visible rather than silently exceeding budget; it never truncates. */
function capToRenderResult(result: RenderResult, budget: number): RenderResult {
  if (result.text.length <= budget) return result;
  return { ...result, lint: { ...result.lint, violations: result.lint.violations + 1 } };
}

// ── stage: render-time projection ONLY (§6.2's stageFor replacement,
//    §10-Q10). Never stored, never branched on by any other code path —
//    a pure function of the dims, called at render time by whoever wires
//    the T2/T4/T6 call sites (interface ticket, see file header). ──

export type Stage = "new" | "warming" | "settled" | "close" | "deep";

/**
 * Replaces persona.ts's `stageFor(messageCount)` (SPEC §10-Q10: "'stage' as
 * render-time projection only... stageFor DELETED from the prompt path and
 * logged in rejected.md with its replacement"). This is that replacement —
 * a pure function of the DIMENSIONS, never message count, and never
 * written back to storage. The actual deletion of `stageFor` from
 * persona.ts is a file this workstream does not own (see M4 report,
 * "deviations" — persona.ts has no declared owner in §13's table at all,
 * so it is left untouched here rather than edited on an assumption).
 */
export function stageForDims(state: RelState): Stage {
  if (state.rupture_open) return state.trust < 0.45 ? "new" : "warming"; // an open rupture never reads as "close"
  if (state.trust < 0.2) return "new";
  if (state.trust < 0.45) return "warming";
  if (state.trust < 0.7) return "settled";
  if (state.trust < 0.88) return "close";
  return "deep";
}

// ─────────────────────────────────────────────────────────────────────────
// Taste nomination predicate — pure half of api/taste-queue.js's job
// (SPEC §4.1.5: "stances expressed consistently (>=3 citations across >=2
// weeks) go to an owner review queue"). The DB orchestration lives in
// api/taste-queue.js (this file's sibling, also WS-RELSTATE-owned); this
// function is the shared, testable predicate so the threshold logic is
// defined exactly once.
// ─────────────────────────────────────────────────────────────────────────

const TASTE_MIN_CITATIONS = 3;
const TASTE_MIN_SPAN_DAYS = 14;

export interface TasteNominationCheck {
  eligible: boolean;
  reason: string;
}

/** `citationDates` = the started_at of every episode the pattern (or fact)
 *  cites, already resolved by the caller. Pure — no DB access. */
export function checkTasteEligibility(citations: number[], citationDates: readonly string[]): TasteNominationCheck {
  if (citations.length < TASTE_MIN_CITATIONS) {
    return { eligible: false, reason: `${citations.length} citations, need >=${TASTE_MIN_CITATIONS}` };
  }
  if (citationDates.length < 2) return { eligible: false, reason: "fewer than 2 dated citations" };
  const times = citationDates.map((d) => new Date(d).getTime()).sort((a, b) => a - b);
  const spanDays = (times[times.length - 1] - times[0]) / MS_PER_DAY;
  if (spanDays < TASTE_MIN_SPAN_DAYS) {
    return { eligible: false, reason: `span ${spanDays.toFixed(1)}d, need >=${TASTE_MIN_SPAN_DAYS}d` };
  }
  return { eligible: true, reason: `${citations.length} citations over ${spanDays.toFixed(1)}d` };
}
