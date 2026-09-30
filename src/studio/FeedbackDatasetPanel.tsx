import { useCallback, useEffect, useRef, useState } from "react";
import { prepareFeedbackDataset, readFeedbackDatasetReview } from "./feedbackApi";
import { ReplicaApiError } from "./replicaApi";
import type { FeedbackDatasetReview } from "./types";
import "./feedback-dataset.css";
import CorrectionCandidateAction from "./CorrectionCandidateAction";

const BLOCKERS: Record<string, string> = {
  twelve_independent_sessions_required: "Feedback from 12 separate conversations",
  thirty_train_owner_preference_pairs_required: "30 written correction pairs in the preparation group",
  ten_positive_holdout_judgments_required: "10 positive judgments in the evaluation groups",
  six_train_sessions_required: "6 conversations in the preparation group",
  two_development_sessions_required: "2 conversations in the development group",
  two_test_sessions_required: "2 conversations in the test group",
  twenty_development_examples_required: "20 examples in the development group",
  thirty_test_examples_required: "30 examples in the test group",
  wording_coverage_required: "3 judgments about wording",
  behavior_coverage_required: "3 judgments about behavior",
  relationship_coverage_required: "3 judgments about relationship",
  memory_coverage_required: "3 judgments about memory",
  delivery_coverage_required: "3 judgments about delivery",
  unsafe_session_was_previously_frozen_outside_test: "A safety review of an earlier conversation split",
};
const STATUS = { draft: "Draft", approved: "Approved", retired: "Retired", rejected: "Rejected" };

export default function FeedbackDatasetPanel({ token, replicaId, feedbackRevision, onAuthError }: {
  token: string; replicaId: string; feedbackRevision: number; onAuthError: (cause: unknown) => void;
}) {
  const [review, setReview] = useState<FeedbackDatasetReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const epoch = useRef(0);
  const buildLock = useRef(false);
  const pendingRead = useRef<AbortController | null>(null);
  const prepareButton = useRef<HTMLButtonElement>(null);
  const checkButton = useRef<HTMLButtonElement>(null);
  const restoreActionFocus = useRef<{ epoch: number; replicaId: string } | null>(null);
  useEffect(() => {
    if (building || !restoreActionFocus.current) return;
    const pending = restoreActionFocus.current;
    restoreActionFocus.current = null;
    const target = prepareButton.current || checkButton.current;
    if (pending.epoch === epoch.current && pending.replicaId === replicaId && target?.isConnected
      && document.activeElement === document.body) target.focus();
  }, [building, replicaId]);
  const load = useCallback(async (keepError = false) => {
    const requestEpoch = ++epoch.current;
    pendingRead.current?.abort();
    const controller = new AbortController(); pendingRead.current = controller;
    // Keep the last snapshot visible, with preparation disabled, while the
    // next read runs. The focused action must survive a stale-response refresh.
    setLoading(true); setNotice("");
    if (!keepError) setError("");
    try {
      const result = await readFeedbackDatasetReview(token, replicaId, controller.signal);
      if (requestEpoch === epoch.current) setReview(result);
    } catch (cause) {
      if (requestEpoch !== epoch.current || controller.signal.aborted) return;
      setReview(null);
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
      else setError("We could not check your saved corrections. Check again before preparing a set.");
    } finally { if (requestEpoch === epoch.current) setLoading(false); }
    return requestEpoch === epoch.current ? requestEpoch : null;
  }, [token, replicaId, onAuthError]);
  useEffect(() => {
    void load();
    return () => { epoch.current++; pendingRead.current?.abort(); };
  }, [load, feedbackRevision]);

  async function prepare() {
    if (buildLock.current || loading || !review?.can_build || !review.source_set_hash) return;
    restoreActionFocus.current = document.activeElement === prepareButton.current ? { epoch: epoch.current, replicaId } : null;
    buildLock.current = true; setBuilding(true); setError(""); setNotice("");
    const requestEpoch = epoch.current;
    try {
      const result = await prepareFeedbackDataset(token, replicaId, review.source_set_hash);
      if (requestEpoch !== epoch.current) return;
      setReview(result); setNotice(`Set ${result.dataset!.version} saved for evaluation.`);
    } catch (cause) {
      if (requestEpoch !== epoch.current) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) { onAuthError(cause); return; }
      setError(cause instanceof ReplicaApiError && cause.status === 409
        ? "The current corrections or AI version changed. Review the updated counts before preparing again."
        : "The save response could not be verified. Check the current saved status before preparing again.");
      // A timed-out POST may have committed. Read its receipt; never repeat
      // the write automatically or report a local success.
      const refreshedEpoch = await load(true);
      if (restoreActionFocus.current && refreshedEpoch === epoch.current) restoreActionFocus.current.epoch = refreshedEpoch;
    } finally { buildLock.current = false; setBuilding(false); }
  }

  const description = loading ? "Checking current corrections"
    : !review ? "Status unavailable"
      : review.state === "inactive" ? "This AI is inactive"
        : review.state === "empty" ? "No eligible feedback for this AI version"
          : review.changed_since_saved ? "Saved feedback has changed"
            : review.readiness.ready_for_candidate_dataset ? "Evidence requirements met" : "More evidence needed";
  return <details className="feedback-dataset">
    <summary><span>Saved corrections</span><small>{description}</small></summary>
    <div className="feedback-dataset__body">
      <p>Prepare the saved feedback from your private conversations for a separate evaluation. Preparing a set does not change your AI.</p>
      <p role="status" aria-live="polite">{notice || description}</p>
      {review?.stats && <p className="feedback-dataset__counts">{review.stats.examples} saved {review.stats.examples === 1 ? "example" : "examples"} across {review.stats.sessions} {review.stats.sessions === 1 ? "conversation" : "conversations"}.</p>}
      {review?.dataset && <p>Set {review.dataset.version}: {STATUS[review.dataset.status]}.{review.changed_since_saved ? " It needs an updated snapshot." : ""}</p>}
      {review?.dataset && <CorrectionCandidateAction token={token} replicaId={replicaId}
        datasetId={review.dataset.dataset_id} sourceSetHash={review.dataset.source_set_hash}
        eligible={!loading && !building && !review.changed_since_saved && review.state === "ready" && review.dataset.status === "draft"}
        onAuthError={onAuthError} />}
      {review?.can_build && <div className="feedback-dataset__actions">
        <button ref={prepareButton} type="button" disabled={loading || building} onClick={() => void prepare()}>{building ? "Preparing corrections" : "Prepare correction set"}</button>
        <button ref={checkButton} type="button" disabled={loading || building} onClick={() => void load()}>Check again</button>
      </div>}
      {!review?.can_build && <button ref={checkButton} type="button" disabled={loading || building} onClick={() => void load()}>Check again</button>}
      {review && review.state !== "inactive" && review.readiness.blockers.length > 0 && <details className="feedback-dataset__requirements">
        <summary>What is still needed</summary>
        <ul>{review.readiness.blockers.map(blocker => <li key={blocker}>{BLOCKERS[blocker] || "An additional evidence check before evaluation"}</li>)}</ul>
        <p className="feedback-dataset__counts">Current AI profile {review.binding?.profile_version}, calibration {review.binding?.calibration_version}.</p>
        <p>Conversations stay in the same group across sets, so evaluation examples cannot leak into preparation.</p>
      </details>}
      {error && <p className="feedback-dataset__error" role="alert">{error}</p>}
    </div>
  </details>;
}
