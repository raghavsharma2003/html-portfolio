import { replicaRequest, ReplicaApiError } from "./replicaApi";
import type { ReplicaTurnFeedback, TurnFeedbackRating, FeedbackDatasetReview } from "./types";

export async function saveTurnFeedback(
  token: string,
  replicaId: string,
  turnId: string,
  ratings: Record<string, TurnFeedbackRating>,
  reasonCodes: string[],
  correction: string | undefined,
  expectedRevision = 0,
  clearCorrection = false,
): Promise<ReplicaTurnFeedback> {
  const data = await replicaRequest<{ feedback: ReplicaTurnFeedback }>(token, "/api/replica-feedback", {
    method: "POST",
    body: JSON.stringify({
      replica_id: replicaId,
      turn_id: turnId,
      ratings,
      reason_codes: reasonCodes,
      expected_revision: expectedRevision,
      ...(clearCorrection ? { clear_correction: true } : correction !== undefined ? { correction: correction.trim() } : {}),
    }),
  });
  return parseTurnFeedback(data.feedback, turnId);
}

export interface CurrentTurnFeedback { replica_id: string; turn_id: string; feedback: ReplicaTurnFeedback | null; correction: string }
const dimensions = ["overall", "wording", "behavior", "relationship", "memory", "delivery", "voice_identity"];
function parseTurnFeedback(value: unknown, turnId: string): ReplicaTurnFeedback {
  const f = value as ReplicaTurnFeedback;
  if (!f || f.turn_id !== turnId || !id(f.feedback_id) || !Number.isSafeInteger(f.revision) || f.revision < 1
    || !f.ratings || typeof f.ratings !== "object" || Array.isArray(f.ratings) || !Object.keys(f.ratings).length
    || Object.entries(f.ratings).some(([key, rating]) => !dimensions.includes(key) || !["exact", "close", "off", "unsafe"].includes(rating))
    || !Array.isArray(f.reason_codes) || f.reason_codes.length > 8 || f.reason_codes.some(reason => typeof reason !== "string")
    || typeof f.has_correction !== "boolean" || typeof f.voice_generation_bound !== "boolean" || typeof f.created_at !== "string")
    throw new ReplicaApiError("The saved correction could not be verified", 502, {});
  return f;
}
export async function readTurnFeedback(token: string, replicaId: string, turnId: string, signal?: AbortSignal): Promise<CurrentTurnFeedback> {
  const data = await replicaRequest<{ current: CurrentTurnFeedback }>(token,
    `/api/replica-feedback?replica_id=${encodeURIComponent(replicaId)}&turn_id=${encodeURIComponent(turnId)}`,
    { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : undefined });
  const c = data.current;
  if (!c || c.replica_id !== replicaId || c.turn_id !== turnId || typeof c.correction !== "string" || Array.from(c.correction).length > 2000
    || (c.feedback === null ? c.correction !== "" : Boolean(c.correction) !== c.feedback?.has_correction))
    throw new ReplicaApiError("The current correction could not be verified", 502, {});
  return { ...c, feedback: c.feedback === null ? null : parseTurnFeedback(c.feedback, turnId) };
}

const hash = (value: unknown) => typeof value === "string" && value.length === 64 && /^[0-9a-f]+$/.test(value);
const id = (value: unknown) => typeof value === "string" && value.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;

export function parseFeedbackDatasetReview(value: unknown, replicaId: string): FeedbackDatasetReview {
  const review = value as FeedbackDatasetReview | null;
  const invalid = () => { throw new ReplicaApiError("Correction readiness could not be verified", 502, {}); };
  if (!review || review.replica_id !== replicaId || !["inactive", "empty", "stale", "collecting", "ready"].includes(review.state)
    || typeof review.can_build !== "boolean" || typeof review.changed_since_saved !== "boolean"
    || typeof review.checked_at !== "string" || typeof review.readiness?.ready_for_candidate_dataset !== "boolean"
    || !Array.isArray(review.readiness.blockers) || review.readiness.blockers.length > 24
    || review.readiness.blockers.some(blocker => typeof blocker !== "string" || blocker.length > 100)) return invalid();
  if (review.state === "inactive") {
    if (review.binding !== null || review.stats !== null || review.source_set_hash !== null || review.can_build || review.readiness.ready_for_candidate_dataset
      || review.dataset !== null || review.changed_since_saved || !review.readiness.blockers.length) return invalid();
  } else {
    if (!review.binding || !id(review.binding.capability_id) || !count(review.binding.profile_version) || review.binding.profile_version < 1
      || !count(review.binding.calibration_version) || review.binding.calibration_version < 1 || !hash(review.source_set_hash) || !review.stats) return invalid();
    const stats = review.stats;
    if (![stats.examples, stats.sessions, stats.train_preferences, stats.holdout_positives].every(count)) return invalid();
    for (const [record, keys] of [[stats.split_counts, ["train", "development", "test"]], [stats.session_counts, ["train", "development", "test"]],
      [stats.kind_counts, ["preference", "positive_eval", "negative_eval", "safety_holdout"]], [stats.dimension_counts, ["wording", "behavior", "relationship", "memory", "delivery"]]] as const) {
      if (!record || keys.some(key => !count((record as Record<string, number>)[key]))) return invalid();
    }
    if (review.can_build !== (stats.examples > 0) || (review.state === "empty") !== (stats.examples === 0)
      || review.readiness.ready_for_candidate_dataset !== (review.readiness.blockers.length === 0)
      || (review.state === "ready" && !review.readiness.ready_for_candidate_dataset)
      || (review.state === "collecting" && review.readiness.ready_for_candidate_dataset)
      || (review.state === "stale") !== (review.changed_since_saved && stats.examples > 0)) return invalid();
  }
  if (review.dataset && (!id(review.dataset.dataset_id) || !hash(review.dataset.source_set_hash)
    || !count(review.dataset.version) || review.dataset.version < 1
    || !count(review.dataset.profile_version) || review.dataset.profile_version < 1
    || !count(review.dataset.calibration_version) || review.dataset.calibration_version < 1
    || (review.dataset.capability_id !== null && !id(review.dataset.capability_id))
    || !["draft", "approved", "retired", "rejected"].includes(review.dataset.status) || typeof review.dataset.created_at !== "string")) return invalid();
  if (review.changed_since_saved !== Boolean(review.dataset && review.dataset.source_set_hash !== review.source_set_hash)) return invalid();
  return review;
}

export async function readFeedbackDatasetReview(token: string, replicaId: string, signal?: AbortSignal): Promise<FeedbackDatasetReview> {
  const data = await replicaRequest<{ review: unknown }>(token, `/api/replica-feedback-dataset?replica_id=${encodeURIComponent(replicaId)}`,
    { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : undefined });
  return parseFeedbackDatasetReview(data.review, replicaId);
}

export async function prepareFeedbackDataset(token: string, replicaId: string, sourceSetHash: string): Promise<FeedbackDatasetReview> {
  if (!hash(sourceSetHash)) throw new ReplicaApiError("Review the current corrections first", 400, {});
  const data = await replicaRequest<{ review: unknown }>(token, "/api/replica-feedback-dataset", {
    method: "POST", body: JSON.stringify({ replica_id: replicaId, expected_source_set_hash: sourceSetHash }),
  });
  const review = parseFeedbackDatasetReview(data.review, replicaId);
  if (!review.dataset || review.source_set_hash !== sourceSetHash || review.dataset.source_set_hash !== sourceSetHash || review.changed_since_saved)
    throw new ReplicaApiError("The saved correction set could not be verified", 502, {});
  return review;
}
