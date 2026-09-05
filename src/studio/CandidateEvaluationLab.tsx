import { useCallback, useEffect, useState } from "react";
import { getCandidateEvaluation, judgeCandidateAssignment } from "./candidateEvalApi";
import { ReplicaApiError } from "./replicaApi";
import type {
  CandidateEvalChoice,
  CandidateEvalDimension,
  CandidateEvaluation,
} from "./types";
import { useStudioLocale } from "./localeContext";
import { withCount, type StudioCopy } from "./copy";

const CHOICE_VALUES: CandidateEvalChoice[] = ["a", "tie", "b"];

function loadError(t: StudioCopy, cause: unknown) {
  return cause instanceof Error ? cause.message.replaceAll("_", " ") : t.candidateEvaluationLab.loadErrorFallback;
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
  const { t } = useStudioLocale();
  const c = t.candidateEvaluationLab;
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
      setError(loadError(t, cause));
    } finally {
      setLoading(false);
    }
  }, [onAuthError, replicaId, stopped, token, t]);

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
      setError(loadError(t, cause));
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
          <p className="eyebrow">{c.eyebrow}</p>
          <h2 id="candidate-eval-title">{c.title}</h2>
          <p>{c.intro}</p>
        </div>
        <div className="candidate-eval-seal" aria-label={c.sealAriaLabel}>
          <strong>{c.blindedLabel}</strong>
          <span>{c.mappingNote}</span>
        </div>
      </div>

      {loading ? (
        <div className="candidate-eval-loading" role="status" aria-label={c.loadingAriaLabel}>
          <span /><span /><span />
        </div>
      ) : error ? (
        <div className="candidate-eval-error" role="alert">
          <div><strong>{c.comparisonUnavailable}</strong><p>{error}</p></div>
          <button type="button" onClick={() => void load()}>{c.tryAgain}</button>
        </div>
      ) : !evaluation?.available ? (
        <div className="candidate-eval-empty">
          <div className="candidate-eval-empty-mark" aria-hidden="true">A/B</div>
          <div>
            <strong>{c.emptyHeadline}</strong>
            <p>{c.emptyNote}</p>
          </div>
        </div>
      ) : evaluation.state === "complete" || !evaluation.assignment ? (
        <div className="candidate-eval-complete" role="status">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>{c.completeHeadline}</strong>
            <p>{withCount(c.completeNote, progress.completed)}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="candidate-eval-progress">
            <span>{c.comparisonOfLabel.split("{n}").join(String(evaluation.assignment.sequence)).split("{n2}").join(String(progress.total))}</span>
            <strong>{withCount(c.sealedCountLabel, progress.completed)}</strong>
          </div>

          <article className="candidate-eval-context">
            <span>{c.situationLabel}</span>
            <p>{evaluation.assignment.context}</p>
          </article>

          <div className="candidate-eval-options" aria-label={c.optionsAriaLabel}>
            <article>
              <header><span>A</span><small>{c.anonymousOutput}</small></header>
              <p>{evaluation.assignment.option_a}</p>
            </article>
            <div className="candidate-eval-versus" aria-hidden="true">{c.orWord}</div>
            <article>
              <header><span>B</span><small>{c.anonymousOutput}</small></header>
              <p>{evaluation.assignment.option_b}</p>
            </article>
          </div>

          <form className="candidate-eval-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <div className="candidate-eval-instruction">
              <strong>{c.judgeEveryLayer}</strong>
              <span>{c.judgeInstruction}</span>
            </div>
            <div className="candidate-eval-dimensions">
              {dimensions.map((dimension) => {
                const copy = c.dimensionCopy[dimension];
                return (
                  <fieldset key={dimension}>
                    <legend><strong>{copy.label}</strong><span>{copy.hint}</span></legend>
                    <div>
                      {CHOICE_VALUES.map((choice) => (
                        <button
                          key={choice}
                          className={ratings[dimension] === choice ? "selected" : ""}
                          type="button"
                          aria-pressed={ratings[dimension] === choice}
                          onClick={() => setRatings((current) => ({ ...current, [dimension]: choice }))}
                        >
                          {c.choiceLabel[choice]}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                );
              })}
            </div>
            <div className="candidate-eval-submit">
              <span>{c.layersJudged.split("{n}").join(String(answered)).split("{n2}").join(String(dimensions.length))}</span>
              <button className="button primary-button" type="submit" disabled={busy || answered !== dimensions.length}>
                {busy ? c.sealingComparison : c.sealAndContinue}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
