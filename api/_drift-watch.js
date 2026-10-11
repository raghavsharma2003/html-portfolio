// Drift watch — "it notices drift." Vyakti Rooms v1, WS-R9.
//
// ═════════════════════════════════════════════════════════════════════════
// WHAT THIS FILE IS
// ═════════════════════════════════════════════════════════════════════════
//
// The Rooms plan names two things a creator's weekly loop needs: "It notices
// drift. We have already caught a provider silently swapping a model within
// four days under the same name" and "Drift: a monthly fidelity report, and
// an alert the day the score moves." This module is the pure computation
// behind both — a report over ROWS, never touching a network, a model, or a
// clock of its own (`now` is an argument, `readiness.js`'s own rule for the
// same reason: a fixture that cannot pin the clock cannot assert on an age).
//
// Three state words, never a fourth and never a fake number:
//   steady        both halves of the scale are measured and nothing moved.
//   moved         a swap or a score drop was found, RECENTLY (see the lookback
//                 window below) — this is the state the alert fires on.
//   not_measured  there is nothing to compare yet, and the report carries the
//                 ONE action that would measure it (DESIGN-LAW §1, the same
//                 law api/_readiness.js is built around).
//
// ═════════════════════════════════════════════════════════════════════════
// WHY THE SCALE IS THE SAME SCALE READINESS USES
// ═════════════════════════════════════════════════════════════════════════
//
// `context/decisions.md` `fidelity-needs-its-ceiling-printed`: a similarity
// score without a self-vs-self ceiling is a decimal with no top. api/_readiness
// .js's `soundsLikeYou` already expresses "sounds like you" as a percent of
// the OWNER'S OWN ceiling, never a shared constant — importing a shared
// constant would import one person's ceiling into everybody else's score
// (`ground-truth-ceiling`). This module reads the identical two queries
// (CEILING_SQL, FIDELITY_SQL) in the identical shape, on purpose, so a
// creator can never see "71 of your own 100" on the Meet step and a different
// number on the drift card for the same clone on the same day.
//
// ═════════════════════════════════════════════════════════════════════════
// WHY 0.02, CITED RATHER THAN CHOSEN
// ═════════════════════════════════════════════════════════════════════════
//
// Three measured numbers on THIS stack, all ECAPA-TDNN cosine, all in
// `context/measurements.md`:
//
//   run-to-run reproducibility   6e-6   (`lora-vs-zero-shot-71s`: spread
//                                        across two runs per arm was 3e-6 to
//                                        6e-6; a third independent run
//                                        reproduced the control to 5e-6)
//   reference-WINDOW choice      0.0625 (`reference-window-beats-the-finetune`:
//                                        five 10 s windows of the SAME 71 s
//                                        recording, scored against the SAME
//                                        fixed reference set, spanned 0.0625 —
//                                        three times the next number down)
//   a genuine trained change     0.0206 (`lora-vs-zero-shot-71s`: 60 epochs of
//                                        LoRA on 62.1 s of speaker audio moved
//                                        the mean by +0.0206)
//
// 0.02 sits five orders of magnitude above the run-to-run noise floor and
// just under the smallest genuine TRAINED delta this stack has measured, so
// it will not fire on ordinary synthesis noise and it will just barely miss
// a real 60-epoch fine-tune landing quietly. It sits roughly a third of the
// window-choice spread, which is exactly why this module refuses to compare
// two fidelity rows unless they share a `genome_version` — "against the same
// reference set" is not a nicety here, it is the only thing that keeps 0.02
// from firing on nothing more than somebody picking a different ten seconds
// of the same recording.
//
// **Reversal condition, stated rather than implied**: this threshold is
// n=1-speaker evidence (`lora-vs-zero-shot-71s` itself says so). The day a
// same-reference-set repeatability bench exists across more than one voice —
// or the day a real swap is caught below 0.02, or a real re-bench crosses it
// with nothing behind it — this constant moves, and `DRIFT_POLICY_VERSION`
// bumps with it so an old report is never silently re-read under a new bar.
//
// ═════════════════════════════════════════════════════════════════════════
// THE SWAP SIGNAL IS THE GENERATION LEDGER, NOT THE FIDELITY TABLE
// ═════════════════════════════════════════════════════════════════════════
//
// `vy_voice_fidelity` is real and its recompute-on-update law is sound
// (api/_fidelity.js), but as of this workstream NOTHING in api/ calls
// `recordOwnedFidelity` outside its own offline eval — grep for a CALLER, not
// a definition (`AGENTS.md`'s own law). So a report that only watched fidelity
// rows for a swap would watch a table nothing writes yet.
//
// `vy_replica_generation.preview_model_commitment` is written on every real
// preview synthesis (migration 019/044), which makes it the one lane that is
// actually live. This is `vision-drift-4day`'s exact shape restated: a
// provider changed a deployment under an unchanged name and the only thing
// that caught it was watching the ARTIFACT the deployment actually produces,
// not a config string. So the swap check here walks
// `preview_model_commitment` across one fixed LANE (purpose='voice_preview',
// channel='studio_preview') and calls any change of hash a swap, independent
// of whether a fidelity score exists at all. The score-drop check is a SECOND,
// independent signal layered on top when fidelity evidence does exist.
//
// ═════════════════════════════════════════════════════════════════════════
// THE PROSODY ANCHOR: REUSED, NEVER RE-DERIVED
// ═════════════════════════════════════════════════════════════════════════
//
// `scripts/prosody-baseline.mjs` already decides whether HER voice moved
// under an unchanged model string (SPEC §9.5's unconsented-vendor-swap
// detector) and it already writes that verdict — f0/duration drift, a model-
// string change, a VOICE change — into `log.lastAlarm`. `context/decisions.md`
// `voice-despina` records that this anchor has been stuck since 2026-08-15
// because re-establishing it needs a funded paid key, so it is safe to assume
// STALE until proven otherwise rather than the reverse. This module does NOT
// re-derive "which voice is current" — that would be a THIRD independent copy
// of a mirror `cache-outlives-the-voice` already found broken once at TWO
// copies (`api/speech.js`'s DEFAULT_VOICE, `prosody-baseline.mjs`'s TTS_VOICE,
// the second kept in sync with the first only by `verify-voice.mjs --set`). It
// reads the job's OWN verdict (`lastAlarm`) plus how long ago it last ran.
import { canonicalJson, sha256Hex } from "./_provenance/contracts.js";
import { replicaId } from "./_replica.js";
import { FIDELITY_POLICY_VERSION } from "./_fidelity.js";
import { READINESS_ACTIONS } from "./_readiness.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DRIFT_POLICY_VERSION = "voice-drift-watch/v1";

// See "WHY 0.02, CITED RATHER THAN CHOSEN" above.
export const DRIFT_SCORE_DROP_THRESHOLD = 0.02;

// The trend the card draws. 30 days per the Rooms plan's own cadence
// ("a monthly fidelity report").
export const DRIFT_TREND_WINDOW_DAYS = 30;

// How recent a swap or a score drop has to be to hold the CURRENT state at
// "moved" rather than merely appearing in the historical fields. Matches the
// trend window: a swap the trend can no longer show is not "the day the
// score moved" any more, it is history — still reported, never dropped, just
// not what today's state word is answering.
export const DRIFT_LOOKBACK_DAYS = 30;

// `scripts/prosody-baseline.mjs`'s own header calls itself "the nightly
// voice-drift job." Two full missed weeks of a job meant to run nightly is
// unambiguous staleness under its own stated cadence, not a guess of ours.
export const PROSODY_ANCHOR_STALE_DAYS = 14;

export const DRIFT_STATES = Object.freeze(["steady", "moved", "not_measured"]);

export class DriftWatchError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;

function requireUuid(value, code) {
  const text = String(value || "").toLowerCase();
  if (!UUID.test(text)) throw new DriftWatchError(code, 400);
  return text;
}

function iso(value) {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

function ageDays(value, now) {
  const at = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(at) ? (now - at) / DAY_MS : null;
}

function withinDays(value, now, days) {
  const age = ageDays(value, now);
  return age !== null && age >= 0 && age <= days;
}

// ─────────────────────────────────────────────────────────────────────────
// THE TWO INDEPENDENT SIGNALS
// ─────────────────────────────────────────────────────────────────────────

/** Walk the generation ledger in time order and return the MOST RECENT
 *  transition between two distinct commitment hashes, or null if the lane
 *  never changed hash. `commitments` is ascending by `at`. */
function detectSwap(commitments) {
  let last = null;
  let swap = null;
  for (const row of commitments) {
    const commitment = String(row.commitment || "");
    if (!commitment) continue;
    if (last && last.commitment !== commitment) {
      swap = { at: row.at, from_commitment: last.commitment, to_commitment: commitment };
    }
    last = { at: row.at, commitment };
  }
  return swap;
}

/** Find the nearest OLDER fidelity row that shares the standing row's
 *  `genome_version` — "against the same reference set" — and report a drop
 *  only when the comparison is apples to apples. `history` is descending by
 *  `computed_at`, so index 0 is the standing row. A genome bump (a real
 *  reference-set change, e.g. more owner material approved) is walked PAST
 *  rather than compared against, because scoring across two reference sets is
 *  exactly the hazard `fidelity-needs-its-ceiling-printed` and the window
 *  spread above both warn about. */
function detectScoreDrop(history) {
  if (!history.length) return null;
  const current = history[0];
  if (!Number.isFinite(current.mean)) return null;
  for (let i = 1; i < history.length; i += 1) {
    const prior = history[i];
    if (prior.genome_version !== current.genome_version) continue;
    if (!Number.isFinite(prior.mean)) return null;
    const delta = round(prior.mean - current.mean);
    if (delta > DRIFT_SCORE_DROP_THRESHOLD) {
      return {
        at: current.computed_at,
        from_mean: prior.mean,
        to_mean: current.mean,
        delta,
        genome_version: current.genome_version,
      };
    }
    return null; // found the comparable pair; the drop did not clear the bar
  }
  return null; // no earlier row shares this reference set yet
}

function normalizeProsody(raw, now) {
  if (!raw) {
    return { stale: true, established_at: null, last_run_at: null, reason: "prosody_baseline_unavailable" };
  }
  const established = raw.established_at || null;
  const lastRun = raw.last_run_at || established;
  const alarmed = raw.last_alarm === true;
  const tooOld = !withinDays(lastRun, now, PROSODY_ANCHOR_STALE_DAYS);
  const stale = !established || tooOld || alarmed;
  const reason = !established
    ? "prosody_baseline_never_established"
    : alarmed
      ? "prosody_baseline_last_run_alarmed"
      : tooOld
        ? "prosody_baseline_overdue"
        : null;
  return { stale, established_at: iso(established), last_run_at: iso(lastRun), reason };
}

// ─────────────────────────────────────────────────────────────────────────
// THE REPORT — PURE
// ─────────────────────────────────────────────────────────────────────────

/**
 * driftWatchReport(inputs) — rows in, report out. PURE, no I/O, no clock of
 * its own. Every eval in evals/drift-watch/ drives this directly.
 *
 * inputs:
 *   now                 ms epoch (defaults to Date.now(), a fixture always
 *                        pins it)
 *   fidelityHistory      [{ mean, computed_at, genome_version,
 *                           voice_model_ref }], DESCENDING by computed_at —
 *                        index 0, if present, is the standing measurement.
 *   ownerCeiling          { value, measured_at } | null
 *   generationCommitments [{ at, commitment }], ASCENDING by `at`, one fixed
 *                        lane's history of `preview_model_commitment`.
 *   prosodyBaseline       { established_at, last_run_at, last_alarm } | null
 */
export function driftWatchReport(inputs = {}) {
  const now = Number.isFinite(Number(inputs.now)) ? Number(inputs.now) : Date.now();
  const fidelityHistory = (Array.isArray(inputs.fidelityHistory) ? inputs.fidelityHistory : [])
    .map((row) => ({
      mean: Number(row.mean),
      computed_at: row.computed_at,
      genome_version: row.genome_version === null || row.genome_version === undefined
        ? null : Number(row.genome_version),
      voice_model_ref: row.voice_model_ref ?? null,
    }))
    .filter((row) => Number.isFinite(row.mean));

  const ceiling = inputs.ownerCeiling && Number.isFinite(Number(inputs.ownerCeiling.value))
    && Number(inputs.ownerCeiling.value) > 0
    ? { value: Number(inputs.ownerCeiling.value), measured_at: inputs.ownerCeiling.measured_at || null }
    : null;

  const current = fidelityHistory[0] || null;
  const hasScore = Boolean(current);

  const trend = fidelityHistory
    .filter((row) => withinDays(row.computed_at, now, DRIFT_TREND_WINDOW_DAYS))
    .map((row) => ({ at: iso(row.computed_at), mean: round(row.mean) }))
    .filter((row) => row.at)
    .sort((a, b) => new Date(a.at) - new Date(b.at));

  const commitments = (Array.isArray(inputs.generationCommitments) ? inputs.generationCommitments : [])
    .map((row) => ({ at: row.at, commitment: row.commitment }))
    .filter((row) => row.at && row.commitment);

  const swap = detectSwap(commitments);
  const scoreDrop = detectScoreDrop(fidelityHistory);
  const swapRecent = Boolean(swap) && withinDays(swap.at, now, DRIFT_LOOKBACK_DAYS);
  const dropRecent = Boolean(scoreDrop) && withinDays(scoreDrop.at, now, DRIFT_LOOKBACK_DAYS);

  const prosody = normalizeProsody(inputs.prosodyBaseline, now);

  let state;
  const reasons = [];
  let action = null;

  if (!hasScore || !ceiling) {
    state = "not_measured";
    reasons.push(!hasScore ? "no_fidelity_row" : "no_owner_ceiling");
    action = READINESS_ACTIONS.record_reference;
  } else if (swapRecent || dropRecent) {
    state = "moved";
    if (swapRecent) reasons.push("model_commitment_changed");
    if (dropRecent) reasons.push("score_dropped");
  } else {
    state = "steady";
  }

  const percentOfCeiling = hasScore && ceiling
    ? Math.max(0, Math.min(100, Math.round((100 * current.mean) / ceiling.value)))
    : null;

  return Object.freeze({
    policy_version: DRIFT_POLICY_VERSION,
    computed_at: new Date(now).toISOString(),
    state,
    reasons: Object.freeze(reasons),
    score: hasScore ? round(current.mean) : null,
    score_computed_at: hasScore ? iso(current.computed_at) : null,
    ceiling: ceiling ? ceiling.value : null,
    ceiling_measured_at: ceiling ? iso(ceiling.measured_at) : null,
    percent_of_ceiling: percentOfCeiling,
    trend: Object.freeze(trend),
    last_model_change_at: swap ? iso(swap.at) : null,
    last_model_commitment: swap ? swap.to_commitment : null,
    swap_recent: swapRecent,
    score_drop: scoreDrop ? Object.freeze(scoreDrop) : null,
    prosody_anchor_stale: prosody.stale,
    prosody_anchor_reason: prosody.reason,
    prosody_anchor_established_at: prosody.established_at,
    prosody_anchor_last_run_at: prosody.last_run_at,
    action,
  });
}

/** Every number the report was computed from, hashed, INCLUDING the policy
 *  version — so a threshold bump (0.02 moving, the stale-day window moving)
 *  is itself a hash change and a re-bench cannot silently keep writing under
 *  an old bar. Same law as `readinessInputsHash`. */
export function driftWatchInputsHash(inputs = {}) {
  return sha256Hex(canonicalJson({
    policy: DRIFT_POLICY_VERSION,
    fidelityHistory: inputs.fidelityHistory || null,
    ownerCeiling: inputs.ownerCeiling || null,
    generationCommitments: inputs.generationCommitments || null,
    prosodyBaseline: inputs.prosodyBaseline || null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────
// THE PROSODY LOG READ — BEST EFFORT, FAILS TOWARD "STALE"
// ─────────────────────────────────────────────────────────────────────────
//
// `evals/dbattery/prosody-baseline-log.json` is a committed repo file, read
// by `scripts/prosody-baseline.mjs` and `scripts/verify-voice.mjs` — both
// Node CLI scripts, never a Vercel serverless function. Nothing in `api/`
// reads a local file today (checked, not assumed: no `readFileSync` call
// exists anywhere under `api/` before this one), so whether Vercel's function
// bundler traces and includes this path is UNPROVEN by this workstream — it
// is not reachable from any live deploy in this environment. That is exactly
// why every failure mode here — missing file, bad JSON, a bundler that never
// included it — resolves to `null`, which `normalizeProsody` above turns into
// `stale: true` with a named reason. A monitoring signal that cannot prove it
// read the real state must fail toward "assume drift", never toward "assume
// steady": failing the other way would be `plausible-return-hides-a-dead-
// pipeline` wearing this feature's name.
const PROSODY_LOG_PATH = (() => {
  try {
    return join(dirname(fileURLToPath(import.meta.url)), "..", "evals", "dbattery", "prosody-baseline-log.json");
  } catch {
    return null;
  }
})();

export function readProsodyBaselineState() {
  if (!PROSODY_LOG_PATH) return null;
  try {
    const raw = JSON.parse(readFileSync(PROSODY_LOG_PATH, "utf8"));
    if (!raw || !raw.baseline || !raw.baseline.date) return null;
    const runs = Array.isArray(raw.runs) ? raw.runs : [];
    const lastRun = runs.length ? runs[runs.length - 1] : raw.baseline;
    return {
      established_at: raw.baseline.date,
      last_run_at: lastRun?.date || raw.baseline.date,
      last_alarm: raw.lastAlarm === true,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// THE READS
// ─────────────────────────────────────────────────────────────────────────
//
// Reused verbatim in SHAPE from `api/_readiness.js`'s CEILING_SQL and
// FIDELITY_SQL — same tables, same predicates, same policy-version binding —
// so the two screens can never disagree about what "your own ceiling" or
// "your standing score" means for the same replica on the same day.

const FIDELITY_HISTORY_SQL = `select f.score,f.computed_at,f.genome_version,f.voice_model_ref
  from vy_voice_fidelity f
 where f.replica_id=$1::uuid and f.owner_user_id=$2::uuid and f.policy_version=$3
 order by f.computed_at desc limit 30`;

const CEILING_SQL = `select
    (g.definition->'evidence'->>'self_similarity_ceiling') as ceiling,
    g.created_at as measured_at
  from vy_replica_voice_genome g
 where g.replica_id=$1::uuid and g.status='approved'
 order by g.version desc limit 1`;

// One fixed lane: studio preview synthesis, the only lane a creator's own
// browser triggers directly and the one the Meet step's Hear It panel plays
// back. `preview_model_commitment` is populated (migration 044) on every real
// preview; an empty string is the pre-044 default and carries no evidence.
const GENERATION_COMMITMENTS_SQL = `select gen.authorized_at as at, gen.preview_model_commitment as commitment
  from vy_replica_generation gen
 where gen.replica_id=$1::uuid and gen.owner_user_id=$2::uuid
   and gen.purpose='voice_preview' and gen.channel='studio_preview'
   and gen.preview_model_commitment <> ''
 order by gen.authorized_at asc limit 200`;

function toFidelityHistoryRows(rows) {
  return rows.map((row) => {
    const score = typeof row.score === "string" ? JSON.parse(row.score) : row.score || {};
    return {
      mean: score.mean,
      computed_at: row.computed_at,
      genome_version: row.genome_version,
      voice_model_ref: row.voice_model_ref,
    };
  });
}

/** Gather every input for one replica. Three small reads plus the (optional,
 *  best-effort) prosody log — each one separately EXPLAIN-able against the
 *  live database, `offline-mocks-cannot-type-check-sql`'s reason. */
export async function gatherDriftWatchInputs(db, rid, ownerUserId, options = {}) {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const [fidelity, ceiling, commitments] = await Promise.all([
    db(FIDELITY_HISTORY_SQL, [rid, ownerUserId, FIDELITY_POLICY_VERSION]),
    db(CEILING_SQL, [rid]),
    db(GENERATION_COMMITMENTS_SQL, [rid, ownerUserId]),
  ]);
  const ceilingRow = ceiling[0] || null;
  const ceilingValue = ceilingRow ? Number(ceilingRow.ceiling) : NaN;
  const prosodyBaseline = options.prosodyBaseline !== undefined
    ? options.prosodyBaseline
    : readProsodyBaselineState();

  return {
    now,
    replica_id: rid,
    fidelityHistory: toFidelityHistoryRows(fidelity),
    ownerCeiling: Number.isFinite(ceilingValue) && ceilingValue > 0
      ? { value: ceilingValue, measured_at: ceilingRow.measured_at }
      : null,
    generationCommitments: commitments.map((row) => ({ at: row.at, commitment: row.commitment })),
    prosodyBaseline,
  };
}

/**
 * The owner-facing read. READ ONLY — deliberately, and differently from
 * `api/_readiness.js`'s "a read that writes":  readiness's write exists
 * because the publish lock is a SQL predicate that joins the LATEST snapshot,
 * so an unsaved fresh compute would show a passing screen while the gate
 * still read a stale failing row. Drift watch gates nothing — it is a
 * monitor, not a lock — so there is no predicate that needs this exact
 * compute captured, and a browser GET should never surprise the database
 * with a write. The durable, alertable history is `api/drift-watch-sweep.js`'s
 * job, on its own cadence, independent of whether any creator ever opens this
 * screen — which matters precisely because "an alert the day the score moves"
 * must not depend on a creator opening the studio that day.
 */
export async function readOwnedDriftWatch(db, ownerUserId, id, options = {}) {
  const owner = requireUuid(ownerUserId, "owner_required");
  const rid = requireUuid(replicaId(id), "replica_id_required");
  const owned = await db(
    `select r.replica_id from vy_replica r
      where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.lifecycle <> 'purging'
      limit 1`,
    [rid, owner],
  );
  if (!owned[0]) return null;
  const inputs = await gatherDriftWatchInputs(db, rid, owner, options);
  const report = driftWatchReport(inputs);
  return { ...report, inputs_hash: driftWatchInputsHash(inputs) };
}

// ─────────────────────────────────────────────────────────────────────────
// THE SWEEP'S WRITE
// ─────────────────────────────────────────────────────────────────────────

const DRIFT_INSERT_SQL = `insert into vy_replica_drift_report
   (replica_id,owner_user_id,state,score,ceiling,trend,last_model_change_at,
    last_model_commitment,prosody_anchor_stale,inputs_hash,alerted_at)
 select $1::uuid,$2::uuid,$3,$4::float8,$5::float8,$6::jsonb,$7::timestamptz,
    $8,$9::boolean,$10,case when $3='moved' then now() else null end
 where not exists (
   select 1 from vy_replica_drift_report x
    where x.replica_id=$1::uuid and x.owner_user_id=$2::uuid
      and x.computed_at=(select max(y.computed_at) from vy_replica_drift_report y
                          where y.replica_id=$1::uuid and y.owner_user_id=$2::uuid)
      and x.inputs_hash=$10
 )
 returning report_id,computed_at,state,alerted_at`;

/** Write the report unless the newest stored row already describes the same
 *  inputs (the guard is INSIDE the statement — 009's one-statement law, and
 *  the same reason `snapshotReadiness` guards this way rather than
 *  read-then-write: two sweep ticks racing would otherwise both see no match
 *  and both insert). Because `state` is a pure function of the hashed inputs,
 *  "the state changed" and "the inputs hash changed" can never disagree —
 *  checking the hash alone is checking both, which is what the brief's "state
 *  or inputs_hash changed" describes as an outcome and this implements as one
 *  guard. Returns null when nothing was written (no change), or the written
 *  row (with `alerted` set) when something was. */
export async function writeDriftReport(db, ownerUserId, rid, report, inputsHash) {
  const rows = await db(DRIFT_INSERT_SQL, [
    rid, ownerUserId, report.state, report.score, report.ceiling,
    JSON.stringify(report.trend), report.last_model_change_at, report.last_model_commitment,
    report.prosody_anchor_stale, inputsHash,
  ]);
  const row = rows[0];
  if (!row) return null;
  return { ...row, alerted: Boolean(row.alerted_at) };
}

const ACTIVE_REPLICAS_SQL = `select distinct c.replica_id, c.owner_user_id
  from vy_replica_runtime_capability c
  join vy_replica r on r.replica_id=c.replica_id and r.owner_user_id=c.owner_user_id
 where c.state='active' and r.lifecycle <> 'purging'
 order by c.replica_id
 limit $1`;

/** The sweep: every replica with an active runtime capability, recomputed and
 *  written only when it changed. `services/*`-free, `network`-free beyond the
 *  three SQL reads and the one guarded write — the prosody log read is a
 *  single local file read, done once per invocation and threaded to every
 *  replica rather than re-read per replica. */
export async function runDriftWatchSweep(options = {}) {
  const db = options.db;
  if (typeof db !== "function") throw new DriftWatchError("drift_watch_sweep_database_required", 500);
  const limit = Math.max(1, Math.min(200, Number(options.limit || 50)));
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const prosodyBaseline = options.prosodyBaseline !== undefined
    ? options.prosodyBaseline
    : readProsodyBaselineState();

  const list = options.listActiveReplicas || ((database, lim) => database(ACTIVE_REPLICAS_SQL, [lim]));
  const active = await list(db, limit);

  const summary = { checked: 0, written: 0, alerted: 0, errors: 0, error_details: [] };
  for (const row of active) {
    summary.checked += 1;
    try {
      const inputs = await gatherDriftWatchInputs(db, row.replica_id, row.owner_user_id, { now, prosodyBaseline });
      const report = driftWatchReport(inputs);
      const hash = driftWatchInputsHash(inputs);
      const written = await writeDriftReport(db, row.owner_user_id, row.replica_id, report, hash);
      if (written) {
        summary.written += 1;
        if (written.alerted) summary.alerted += 1;
      }
    } catch (error) {
      summary.errors += 1;
      summary.error_details.push({ replica_id: row.replica_id, message: error?.message || String(error) });
    }
  }
  return summary;
}

/** The owner-facing shape. Whitelist by construction, same law as
 *  `clientFidelity` / `clientVoiceProfile`: no owner id, no model hash beyond
 *  what a creator can already act on, and never the words this product bans.
 *  `last_model_commitment` is kept — it is a content-free hash, never a
 *  provider or model NAME, so surfacing it costs nothing and lets a creator
 *  who wants to escalate quote the exact value the platform saw change. */
export function clientDriftWatch(report) {
  if (!report) return null;
  return {
    policy_version: report.policy_version,
    computed_at: report.computed_at,
    state: report.state,
    reasons: report.reasons,
    score: report.score,
    score_computed_at: report.score_computed_at,
    ceiling: report.ceiling,
    percent_of_ceiling: report.percent_of_ceiling,
    trend: report.trend,
    last_model_change_at: report.last_model_change_at,
    last_model_commitment: report.last_model_commitment,
    prosody_anchor_stale: report.prosody_anchor_stale,
    prosody_anchor_reason: report.prosody_anchor_reason,
    action: report.action,
  };
}
