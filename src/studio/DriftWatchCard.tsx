// DriftWatchCard — "it notices drift." Vyakti Rooms v1, WS-R9.
//
//   Still sounds like you
//   71 of your own 100, measured 2 Sep 2026
//   [sparkline]
//   The voice engine has not changed since we started watching.
//
// ── WHAT THIS CARD REFUSES TO DO ──────────────────────────────────────────
//
// Exactly ReadinessPanel's own refusal, one screen over: it computes nothing.
// `score`, `percent_of_ceiling` and `trend` arrive decided or arrive null,
// and a null renders as words, never as a zero and never as a blank chart
// axis. The sparkline draws ONLY the points the server sent — no
// interpolation between them and no padding to a fixed number of points, so
// a thin history reads as thin rather than as a smooth invented line.
//
// ── WORDS THIS CARD MUST NEVER USE ────────────────────────────────────────
//
// "clone", "replica" and "fine-tune" are banned everywhere in this product's
// user-visible copy; this card adds one more, on the brief's own instruction:
// never "model". Where the platform's own machinery changed underneath a
// creator's voice, the sentence says "the voice engine changed" — a person
// reading this screen does not need the word a provider uses for their own
// deployment, they need to know something changed and when.
//
// ── FEEL ───────────────────────────────────────────────────────────────
//
// A static card: no polling loop, no animation beyond what `details/summary`
// already gives ReadinessPanel's cards for free. It sits directly under the
// Readiness panel on the Meet step, is fetched once per mount the same way,
// and fails the same honest way readiness does: an error names whose fault
// it is rather than rendering a blank space.
import { useCallback, useEffect, useState } from "react";
import "./drift-watch.css";
import { ReplicaApiError } from "./replicaApi";
import { readDriftWatch, type DriftWatch, type DriftTrendPoint } from "./driftWatchApi";
import type { ReadinessAction } from "./readinessApi";
import type { StepId } from "./wizardModel";
import { jumpTo } from "./WizardRail";
import { useStudioLocale } from "./localeContext";
import { withLabel } from "./copy";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

function shortDate(value: string | null): string {
  if (!value) return "";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "" : DATE.format(at);
}

/** A tiny inline sparkline. Real points only: one point draws one dot and no
 *  line, two or more draw a polyline through exactly those points on a scale
 *  fit to their own min and max, never to a fixed 0 to 1 axis that would
 *  flatten a small, real movement to a hairline. */
function Sparkline({ points, tone }: { points: DriftTrendPoint[]; tone: "steady" | "moved" }) {
  const { t } = useStudioLocale();
  if (points.length === 0) return null;
  const width = 160;
  const height = 36;
  const pad = 4;
  const values = points.map((p) => p.mean);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number) => (points.length === 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (points.length - 1));
  const y = (v: number) => height - pad - ((v - lo) / span) * (height - 2 * pad);
  const first = points[0];
  const last = points[points.length - 1];
  const ariaTemplate = points.length === 1 ? t.driftWatch.trendAriaOne : t.driftWatch.trendAriaMany;
  const trendLabel = ariaTemplate
    .split("{v1}").join(first.mean.toFixed(3))
    .split("{d1}").join(shortDate(first.at))
    .split("{v2}").join(last.mean.toFixed(3))
    .split("{d2}").join(shortDate(last.at))
    .split("{n}").join(String(points.length));

  return (
    <svg
      className={`vy-drift__spark vy-drift__spark--${tone}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={trendLabel}
    >
      {points.length > 1 && (
        <polyline
          className="vy-drift__spark-line"
          fill="none"
          strokeWidth={2}
          points={points.map((p, i) => `${x(i)},${y(p.mean)}`).join(" ")}
        />
      )}
      {points.map((p, i) => (
        <circle key={p.at} className="vy-drift__spark-dot" cx={x(i)} cy={y(p.mean)} r={points.length === 1 ? 3 : 2} />
      ))}
    </svg>
  );
}

export default function DriftWatchCard({
  token,
  replicaId,
  onAuthError,
  onGoStep,
}: {
  token: string;
  replicaId: string;
  onAuthError: (cause: unknown) => void;
  onGoStep: (step: StepId) => void;
}) {
  const { t } = useStudioLocale();
  const [drift, setDrift] = useState<DriftWatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await readDriftWatch(token, replicaId);
      setDrift(next);
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : t.driftWatch.couldNotCheck);
    } finally {
      setLoading(false);
    }
  }, [onAuthError, replicaId, token, t]);

  useEffect(() => { void load(); }, [load]);

  const act = useCallback((action: ReadinessAction) => {
    onGoStep(action.step);
    requestAnimationFrame(() => jumpTo(action.anchor, action.label));
  }, [onGoStep]);

  if (loading) {
    return (
      <section className="vy-drift" aria-labelledby="drift-watch-title">
        <p className="vy-drift__eyebrow">{t.driftWatch.eyebrow}</p>
        <div className="vy-drift__skeleton" aria-hidden="true" />
      </section>
    );
  }

  if (error || !drift) {
    return (
      <section className="vy-drift" aria-labelledby="drift-watch-title">
        <p className="vy-drift__eyebrow">{t.driftWatch.eyebrow}</p>
        <h3 id="drift-watch-title" className="vy-drift__headline">{t.driftWatch.onUsHeadline}</h3>
        <p className="vy-drift__lede" role="alert">{error || t.driftWatch.couldNotCheck}</p>
        <button className="button secondary-button" type="button" onClick={() => void load()}>{t.driftWatch.tryAgain}</button>
      </section>
    );
  }

  const measuredDate = shortDate(drift.score_computed_at);
  const changeDate = shortDate(drift.last_model_change_at);

  return (
    <section className={`vy-drift vy-drift--${drift.state}`} aria-labelledby="drift-watch-title">
      <p className="vy-drift__eyebrow">{t.driftWatch.eyebrow}</p>

      {drift.state === "not_measured" ? (
        <>
          <h3 id="drift-watch-title" className="vy-drift__headline">{t.driftWatch.notMeasuredHeadline}</h3>
          <p className="vy-drift__lede">
            {t.driftWatch.notMeasuredLede}
          </p>
        </>
      ) : (
        <>
          <h3 id="drift-watch-title" className="vy-drift__headline">
            {drift.state === "moved" ? t.driftWatch.movedHeadline : t.driftWatch.steadyHeadline}
          </h3>
          <p className="vy-drift__score">
            <span className="vy-drift__score-value">{drift.percent_of_ceiling}</span>
            <span className="vy-drift__score-note">
              {measuredDate ? withLabel(t.driftWatch.ofYourOwn100, measuredDate) : t.driftWatch.ofYourOwn100Bare}
            </span>
          </p>
          {drift.trend.length > 0 && (
            <div className="vy-drift__trend">
              <Sparkline points={drift.trend} tone={drift.state === "moved" ? "moved" : "steady"} />
              <span className="vy-drift__trend-note">{t.driftWatch.last30Days}</span>
            </div>
          )}
          {drift.state === "moved" && (
            <ul className="vy-drift__reasons">
              {drift.reasons
                .filter((code) => t.driftWatch.movedReasons[code])
                .map((code) => <li key={code}>{t.driftWatch.movedReasons[code]}</li>)}
            </ul>
          )}
        </>
      )}

      <p className="vy-drift__engine">
        {changeDate
          ? withLabel(t.driftWatch.engineChanged, changeDate)
          : t.driftWatch.engineUnchanged}
      </p>

      {drift.prosody_anchor_stale && drift.prosody_anchor_reason && (
        <p className="vy-drift__anchor-note">
          {t.driftWatch.prosodyReasons[drift.prosody_anchor_reason] ?? t.driftWatch.anchorFallback}
        </p>
      )}

      {drift.action && (
        <button className="button secondary-button vy-drift__act" type="button" onClick={() => act(drift.action!)}>
          {drift.action.label}
        </button>
      )}
    </section>
  );
}
