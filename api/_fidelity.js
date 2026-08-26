// Voice fidelity — the numeric half of "a measured guarantee that it still
// sounds like them" (SPEC-GURUKUL.md §8.2, owner reweight 2026-08-26:
// *"'Still sounds like them' = a numeric fidelity score per clone
// (speaker-embedding similarity from the voice-evidence stack + the blind
// owner-calibration pass), recomputed on every voice/model update, surfaced to
// the expert, gating activation."*).
//
// ── What this module is, exactly ──────────────────────────────────────────
// Pure math over vectors. It never touches audio, never calls a GPU, never
// loads a model. `services/voice-evidence` owns every step that has a model in
// it: it decodes the audio and emits L2-normalised speaker embeddings. This
// module consumes those numbers and nothing else. That seam is why the score is
// testable offline with fixtures and why a fidelity number can be recomputed
// from stored evidence without re-synthesising anything.
//
// ── The embedding shape, documented because we depend on it ───────────────
// `services/voice-evidence/app.py::_measure` returns:
//
//   { "embeddings": [ { "input_key": "<safe id>",
//                       "family": "speechbrain-ecapa-voxceleb" | "speechbrain-xvector-voxceleb",
//                       "vector": number[],      // L2-normalised, 8dp rounded
//                       "confidence": number },  // usable speech ms / 10000, capped at 1
//                     ... ],
//     "confidence": number, "measurements": {...}, "quality": {...},
//     "model_revisions": {...} }
//
// Two architecturally distinct families are emitted per input and the service
// deliberately does not pick one. We score on ECAPA-TDNN
// (`speechbrain-ecapa-voxceleb`) because it is the family the service already
// uses for its own speaker clustering (`_diarize` clusters on `_embedding(
// app.state.ecapa, ...)`), so a fidelity number and a diarisation decision
// cannot disagree about what "same speaker" means. `x-vector` is kept in the
// evidence and is available as a second opinion; scoring both and requiring
// agreement is a strictly better bench and is NOT done here because nobody has
// measured what the agreement rate is on real clones — see the policy note.
//
// Because the service returns unit vectors, cosine similarity is a dot product.
// We normalise anyway: an input that is not unit-norm is a bug we would rather
// score correctly than silently mis-score, and the cost is one sqrt per vector.
//
// ── Composition, not replacement ──────────────────────────────────────────
// This does NOT replace the existing blind machinery. `docs/CANDIDATE-
// QUALIFICATION.md` gates a candidate MODEL against a baseline via owner
// comparisons; `docs/VOICE-DELIVERY-HOLDOUT.md` gates a delivery policy via a
// 12-cell blind deck and says so in its own words: *"Production remains locked
// until real automated gates measure speaker identity, intelligibility,
// audible artifacts, latency, watermark survival, provenance and privacy over
// separate test data."* This module is the FIRST of those automated gates —
// speaker identity — and it is a peer of the 7-suite qualification pass at the
// activation gate, not a substitute for either blind protocol. Where the two
// can disagree is written down in the workstream notes; a disagreement is a
// finding, never something for this file to average away.

export const FIDELITY_POLICY_VERSION = "voice-fidelity/v1";
export const FIDELITY_EMBEDDING_FAMILY = "speechbrain-ecapa-voxceleb";

// The single blocker code the runtime gate reports. ONE code for "no fidelity
// row", "a failing row", "a superseded row" and "a row under a different
// policy version" — the WS-B loader precedent (`gurukul-ws2-landed`: one error
// code for missing/unpublished/revoked so revocations cannot be enumerated).
// A caller must not be able to tell a clone that was never benched from a
// clone that was benched and failed.
export const FIDELITY_BLOCKER = "voice_fidelity_not_qualified";

// ── Thresholds are DATA, and they are PROVISIONAL ─────────────────────────
// Every number below is a placeholder awaiting the bench, and saying so is the
// point: a threshold nobody measured is dogma with a decimal point on it. They
// are shaped from the ordinary published range for ECAPA-TDNN VoxCeleb
// same-speaker cosine similarity and NOT from any measurement of our own
// clones, our own recording conditions, or Hinglish code-switched speech —
// three things that all move this distribution and none of which are in any
// number here.
//
// What replaces them: the fidelity bench named in `platform-north-star`, run
// over (a) genuine same-speaker held-out evidence, which fixes the ceiling the
// scale actually reaches, and (b) a different-speaker control set, which fixes
// where the floor has to sit for the score to mean anything. Until both exist,
// `policy_version` on every stored row is what lets an old number be
// recognised as scored under old thresholds rather than compared to a new one.
// Bumping the version is how a re-bench lands; editing these constants without
// bumping it is how a bench gets silently rewritten.
export const DEFAULT_FIDELITY_POLICY = Object.freeze({
  version: FIDELITY_POLICY_VERSION,
  family: FIDELITY_EMBEDDING_FAMILY,
  // Activation floor: below this the clone cannot go live at all.
  activationFloor: 0.7,
  // Warn band: above the floor but below this is "live, and the expert is told
  // it is drifting". A warn row activates; that is deliberate, because a
  // warning nobody can act on before being blocked is just a block.
  warnBelow: 0.78,
  // Target: what a good clone looks like. Not a gate — a number to show the
  // expert so the score has a top as well as a bottom.
  target: 0.85,
  // Per-window rails. Mean alone hides a clone that is excellent for eight
  // windows and unrecognisable for two, which is exactly the failure a
  // listener notices first.
  p10Floor: 0.62,
  worstWindowFloor: 0.55,
  // Sample-count rails. A "score" over one window is an anecdote.
  minReference: 2,
  minCandidate: 3,
});

function fail(code, status = 409) {
  throw Object.assign(new Error(code), { code, status });
}

function unitVector(value, code) {
  if (!Array.isArray(value) || !value.length) fail(code);
  let sum = 0;
  const out = new Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    const n = Number(value[i]);
    if (!Number.isFinite(n)) fail(code);
    out[i] = n;
    sum += n * n;
  }
  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm < 1e-8) fail(code);
  for (let i = 0; i < out.length; i += 1) out[i] /= norm;
  return out;
}

function vectorSet(value, code) {
  if (!Array.isArray(value) || !value.length) fail(code);
  const set = value.map((entry) => unitVector(entry, code));
  const dimension = set[0].length;
  if (set.some((vector) => vector.length !== dimension)) fail(code);
  return { set, dimension };
}

function dot(left, right) {
  let sum = 0;
  for (let i = 0; i < left.length; i += 1) sum += left[i] * right[i];
  return sum;
}

function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

// Nearest-rank percentile on a sorted ascending array. Deliberately NOT
// interpolated: with the handful of windows a real bench produces, an
// interpolated p10 invents a value between two measurements and reads as more
// precision than we have.
function percentile(sorted, fraction) {
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[rank - 1];
}

/**
 * Pull the scoreable vectors out of a voice-evidence `embeddings` array.
 * Accepts either the service's tagged entries or a bare number[][] (which is
 * what fixtures and the pure-math tests use).
 */
export function embeddingVectors(embeddings, family = FIDELITY_EMBEDDING_FAMILY) {
  if (!Array.isArray(embeddings) || !embeddings.length) fail("fidelity_vectors_invalid");
  if (Array.isArray(embeddings[0])) return embeddings;
  const matched = embeddings
    .filter((entry) => entry && (family === null || entry.family === family))
    .map((entry) => entry.vector);
  if (!matched.length) fail("fidelity_embedding_family_missing");
  return matched;
}

/**
 * fidelityScore(reference, candidate) — cosine-similarity statistics.
 *
 * reference = embeddings of APPROVED VoiceGenome evidence (the real person).
 * candidate = embeddings of synthesized samples from the active voice profile,
 *             computed by services/voice-evidence over the synthesized audio.
 *
 * Each candidate embedding is one WINDOW. A window's score is its mean cosine
 * against every reference vector — averaging over references rather than
 * taking the best match, because "sounds like them" has to hold against the
 * whole of their recorded voice and not against whichever reference clip
 * happens to be nearest.
 *
 * Returns { mean, p10, worst, windows, references, dimension }. Pure. No I/O.
 */
export function fidelityScore(referenceEmbeddings, candidateEmbeddings) {
  const reference = vectorSet(embeddingVectors(referenceEmbeddings), "fidelity_reference_invalid");
  const candidate = vectorSet(embeddingVectors(candidateEmbeddings), "fidelity_candidate_invalid");
  if (reference.dimension !== candidate.dimension) fail("fidelity_dimension_mismatch");

  const windowScores = candidate.set.map((vector) => {
    let sum = 0;
    for (const ref of reference.set) sum += dot(vector, ref);
    return sum / reference.set.length;
  });
  const sorted = [...windowScores].sort((a, b) => a - b);
  const mean = windowScores.reduce((a, b) => a + b, 0) / windowScores.length;

  return Object.freeze({
    mean: round(mean),
    p10: round(percentile(sorted, 0.1)),
    worst: round(sorted[0]),
    windows: windowScores.length,
    references: reference.set.length,
    dimension: reference.dimension,
  });
}

/**
 * fidelityVerdict(score, policy) — thresholds applied as data.
 *
 * Every threshold read here comes off the policy object, so a re-bench that
 * moves the floor is a config change and not a code change. The eval proves
 * that: it flips one number and watches the verdict move with no edit here.
 */
export function fidelityVerdict(score, policy = DEFAULT_FIDELITY_POLICY) {
  const p = { ...DEFAULT_FIDELITY_POLICY, ...(policy || {}) };
  if (!score || !Number.isFinite(Number(score.mean))) fail("fidelity_score_invalid");
  const reasons = [];
  if (Number(score.references || 0) < p.minReference) reasons.push("insufficient_reference_evidence");
  if (Number(score.windows || 0) < p.minCandidate) reasons.push("insufficient_candidate_windows");
  if (Number(score.mean) < p.activationFloor) reasons.push("below_activation_floor");
  if (Number(score.p10) < p.p10Floor) reasons.push("p10_below_floor");
  if (Number(score.worst) < p.worstWindowFloor) reasons.push("worst_window_below_floor");

  let status = "pass";
  if (reasons.length) status = "fail";
  else if (Number(score.mean) < p.warnBelow) {
    status = "warn";
    reasons.push("below_warn_band");
  }
  return Object.freeze({
    status,
    reasons: Object.freeze(reasons),
    policy_version: p.version,
    // Surfaced to the expert: where this number sits between the floor and the
    // target, so the guarantee reads as a position and not as a naked decimal.
    headroom: round(Number(score.mean) - p.activationFloor),
    target: p.target,
  });
}

// ── Recompute-on-update law ───────────────────────────────────────────────
// `cache-outlives-the-voice` (context/rejected.md, 2026-08-24): four lanes
// moved to a new voice and the cache keys named text, style and id — never the
// VOICE — so every install kept replaying the old one out of a cache that was
// still, by its own key, valid. The gate was green and correct and the product
// was wrong. A fidelity row is exactly the same shape of hazard: a stored
// "still sounds like them" pass whose key does not name the voice it was
// measured on will keep covering a voice it never heard.
//
// So the row's key names the voice completely: `voice_profile_ref` AND
// `genome_version` AND `voice_model_ref` (the exact model/fine-tune the
// candidate audio came from). A new voice-profile version is a new
// `voice_profile_id` row, which has no fidelity row at all, so the gate fails
// closed with no invalidation step needed. A same-row model change — a
// per-expert fine-tune landing under the same profile — is what
// `voice_model_ref` catches, and `supersedeStandingFidelity` is what marks the
// old row superseded so `superseded_at is null` can never resolve to two rows.
const FIDELITY_INSERT_SQL = `with superseded as (
  update vy_voice_fidelity f
     set superseded_at=now()
   where f.replica_id=$1 and f.owner_user_id=$2 and f.voice_profile_ref=$3
     and f.superseded_at is null
     and (f.voice_model_ref is distinct from $4 or f.policy_version is distinct from $7
          or f.genome_version is distinct from $5)
   returning f.fidelity_id
)
insert into vy_voice_fidelity
  (replica_id,owner_user_id,voice_profile_ref,voice_model_ref,genome_version,score,policy_version,status)
select $1,$2,$3,$4,$5,$6::jsonb,$7,$8
 where not exists (
   select 1 from vy_voice_fidelity f
    where f.replica_id=$1 and f.owner_user_id=$2 and f.voice_profile_ref=$3
      and f.superseded_at is null and f.voice_model_ref=$4
      and f.genome_version=$5 and f.policy_version=$7
 )
returning fidelity_id,replica_id,voice_profile_ref,voice_model_ref,genome_version,score,policy_version,status,computed_at`;

/**
 * Record a fidelity measurement, superseding any standing row measured on a
 * different voice/model/policy. One statement — 009's law (Neon's SQL-over-HTTP
 * endpoint takes exactly one statement per body), so this cannot half-apply and
 * leave two standing rows.
 */
export async function recordOwnedFidelity(db, ownerUserId, input) {
  const score = input?.score;
  const verdict = input?.verdict || fidelityVerdict(score, input?.policy);
  const rows = await db(FIDELITY_INSERT_SQL, [
    input?.replica_id,
    ownerUserId,
    input?.voice_profile_id,
    String(input?.voice_model_ref || ""),
    Number(input?.genome_version),
    JSON.stringify({ mean: score.mean, p10: score.p10, worst: score.worst, windows: score.windows, references: score.references }),
    verdict.policy_version,
    verdict.status,
  ]);
  return rows[0] || null;
}

/**
 * Explicit invalidation for the case a caller knows the voice moved but has no
 * new measurement yet — a fine-tuned model ref landing on an existing profile.
 * After this the gate fails closed until a new row is recorded, which is the
 * correct state: an unmeasured voice is not a passing voice.
 */
export async function supersedeStandingFidelity(db, ownerUserId, replicaId, voiceProfileId) {
  const rows = await db(
    `update vy_voice_fidelity set superseded_at=now()
      where replica_id=$1 and owner_user_id=$2 and voice_profile_ref=$3 and superseded_at is null
      returning fidelity_id`,
    [replicaId, ownerUserId, voiceProfileId],
  );
  return rows.length;
}

/**
 * The expert-facing shape. Whitelist by construction, same law as
 * `clientVoiceProfile`: no owner id, no profile ref, no model ref. The expert
 * gets the number, the verdict and where it sits — never the plumbing.
 */
export function clientFidelity(row, policy = DEFAULT_FIDELITY_POLICY) {
  if (!row) return null;
  const score = typeof row.score === "string" ? JSON.parse(row.score) : row.score || {};
  return {
    status: row.status,
    score: {
      mean: score.mean ?? null,
      p10: score.p10 ?? null,
      worst: score.worst ?? null,
      windows: score.windows ?? null,
    },
    policy_version: row.policy_version,
    activation_floor: policy.activationFloor,
    target: policy.target,
    computed_at: row.computed_at,
    stale: Boolean(row.superseded_at),
  };
}
