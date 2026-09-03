import { useCallback, useEffect, useState } from "react";
import { getCandidateEvaluation, judgeCandidateAssignment } from "./candidateEvalApi";
import { ReplicaApiError } from "./replicaApi";
import type {
  CandidateEvalChoice,
  CandidateEvalDimension,
  CandidateEvaluation,
} from "./types";

const DIMENSION_COPY: Record<CandidateEvalDimension, { label: string; hint: string }> = {
  overall: { label: "Overall", hint: "Which one feels more like you?" },
  wording: { label: "Wording", hint: "Phrases, sentence shape, and length" },
  behavior: { label: "Behavior", hint: "Reaction, judgment, and way of responding" },
  relationship: { label: "Relationship", hint: "How you would speak in this exact bond" },
  memory: { label: "Memory", hint: "Facts, callbacks, and honest uncertainty" },
  delivery: { label: "Delivery", hint: "Implied pace, energy, and emotional shape" },
};

const CHOICES: Array<{ value: CandidateEvalChoice; label: string }> = [
  { value: "a", label: "A is closer" },
  { value: "tie", label: "No difference" },
  { value: "b", label: "B is closer" },
];

function loadError(cause: unknown) {
  return cause instanceof Error ? cause.message.replaceAll("_", " ") : "The comparison could not be loaded";
}

export default function CandidateEvaluationLab({
  token,
  replicaId,
  stopped,
  onAuthError,
}: {
  token: string;
  replicaId: string;
  stopped: boolean;
  onAuthError: (cause: unknown) => void;
}) {
  const [evaluation, setEvaluation] = useState<CandidateEvaluation | null>(null);
  const [ratings, setRatings] = useState<Partial<Record<CandidateEvalDimension, CandidateEvalChoice>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (stopped) return;
    setLoading(true);
    setError("");
    try {
      const next = await getCandidateEvaluation(token, replicaId);
      setEvaluation(next);
      setRatings({});
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(loadError(cause));
    } finally {
      setLoading(false);
    }
  }, [onAuthError, replicaId, stopped, token]);

  useEffect(() => { void load(); }, [load]);

  async function submit() {
    const assignment = evaluation?.assignment;
    const dimensions = evaluation?.dimensions || [];
    if (!assignment || dimensions.some((dimension) => !ratings[dimension]) || busy) return;
    setBusy(true);
    setError("");
    try {
      await judgeCandidateAssignment(
        token,
        replicaId,
        assignment.assignment_id,
        assignment.assignment_hash,
        Object.fromEntries(dimensions.map((dimension) => [dimension, ratings[dimension]])) as Record<CandidateEvalDimension, CandidateEvalChoice>,
      );
      await load();
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(loadError(cause));
    } finally {
      setBusy(false);
    }
  }

  const dimensions = evaluation?.dimensions || [];
  const answered = dimensions.filter((dimension) => ratings[dimension]).length;
  const progress = evaluation?.progress || { completed: 0, total: 0 };

  return (
    <section className="candidate-eval-lab" aria-labelledby="candidate-eval-title">
      <div className="candidate-eval-head">
        <div>
          <p className="eyebrow">Blind comparison</p>
          <h2 id="candidate-eval-title">Pick the closer voice, without being told which is which</h2>
          <p>Compare two hidden outputs layer by layer. Their identity stays sealed until the full evaluation is complete.</p>
        </div>
        <div className="candidate-eval-seal" aria-label="Evaluation blinding status">
          <strong>BLINDED</strong>
          <span>A/B mapping stays server-side</span>
        </div>
      </div>

      {loading ? (
        <div className="candidate-eval-loading" role="status" aria-label="Loading blind evaluation">
          <span /><span /><span />
        </div>
      ) : error ? (
        <div className="candidate-eval-error" role="alert">
          <div><strong>Comparison unavailable</strong><p>{error}</p></div>
          <button type="button" onClick={() => void load()}>Try again</button>
        </div>
      ) : !evaluation?.available ? (
        <div className="candidate-eval-empty">
          <div className="candidate-eval-empty-mark" aria-hidden="true">A/B</div>
          <div>
            <strong>No qualified candidate is waiting for review.</strong>
            <p>This opens only after a frozen test set and two encrypted candidate outputs exist for at least 30 comparisons.</p>
          </div>
        </div>
      ) : evaluation.state === "complete" || !evaluation.assignment ? (
        <div className="candidate-eval-complete" role="status">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>Blind review complete</strong>
            <p>{progress.completed} comparisons are sealed. Safety, privacy, and statistical gates decide whether this candidate can advance.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="candidate-eval-progress">
            <span>Comparison {evaluation.assignment.sequence} of {progress.total}</span>
            <strong>{progress.completed} sealed</strong>
          </div>

          <article className="candidate-eval-context">
            <span>Situation</span>
            <p>{evaluation.assignment.context}</p>
          </article>

          <div className="candidate-eval-options" aria-label="Anonymous response options">
            <article>
              <header><span>A</span><small>Anonymous output</small></header>
              <p>{evaluation.assignment.option_a}</p>
            </article>
            <div className="candidate-eval-versus" aria-hidden="true">OR</div>
            <article>
              <header><span>B</span><small>Anonymous output</small></header>
              <p>{evaluation.assignment.option_b}</p>
            </article>
          </div>

          <form className="candidate-eval-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <div className="candidate-eval-instruction">
              <strong>Judge every layer</strong>
              <span>Choose based on this situation only. A tie is useful evidence.</span>
            </div>
            <div className="candidate-eval-dimensions">
              {dimensions.map((dimension) => {
                const copy = DIMENSION_COPY[dimension];
                return (
                  <fieldset key={dimension}>
                    <legend><strong>{copy.label}</strong><span>{copy.hint}</span></legend>
                    <div>
                      {CHOICES.map((choice) => (
                        <button
                          key={choice.value}
                          className={ratings[dimension] === choice.value ? "selected" : ""}
                          type="button"
                          aria-pressed={ratings[dimension] === choice.value}
                          onClick={() => setRatings((current) => ({ ...current, [dimension]: choice.value }))}
                        >
                          {choice.label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                );
              })}
            </div>
            <div className="candidate-eval-submit">
              <span>{answered} of {dimensions.length} layers judged</span>
              <button className="button primary-button" type="submit" disabled={busy || answered !== dimensions.length}>
                {busy ? "Sealing comparison..." : "Seal and continue"}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
