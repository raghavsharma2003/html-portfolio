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

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

function shortDate(value: string | null): string {
  if (!value) return "";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "" : DATE.format(at);
}

/** Plain sentences for the codes `reasons` can carry, kept here rather than
 *  on the wire (copy belongs where scripts/check-copy.mjs scopes it). */
const MOVED_REASON_TEXT: Record<string, string> = {
  model_commitment_changed: "The voice engine underneath your AI changed recently.",
  score_dropped: "Your voice score dropped more than a normal day to day change.",
};

const PROSODY_REASON_TEXT: Record<string, string> = {
  prosody_baseline_unavailable: "We could not check whether our own alarm for this is up to date.",
  prosody_baseline_never_established: "Our own alarm for this has never been set up.",
  prosody_baseline_last_run_alarmed: "Our own alarm for this rang on its last check and has not been cleared.",
  prosody_baseline_overdue: "Our own alarm for this has not run in a while.",
};

/** A tiny inline sparkline. Real points only: one point draws one dot and no
 *  line, two or more draw a polyline through exactly those points on a scale
 *  fit to their own min and max, never to a fixed 0 to 1 axis that would
 *  flatten a small, real movement to a hairline. */
function Sparkline({ points, tone }: { points: DriftTrendPoint[]; tone: "steady" | "moved" }) {
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

  return (
    <svg
      className={`vy-drift__spark vy-drift__spark--${tone}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Trend from ${first.mean.toFixed(3)} on ${shortDate(first.at)} to ${last.mean.toFixed(3)} on ${shortDate(last.at)}, over ${points.length} measured point${points.length === 1 ? "" : "s"}.`}
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
      setError(cause instanceof Error ? cause.message : "We could not check for drift just now");
    } finally {
      setLoading(false);
    }
  }, [onAuthError, replicaId, token]);

  useEffect(() => { void load(); }, [load]);

  const act = useCallback((action: ReadinessAction) => {
    onGoStep(action.step);
    requestAnimationFrame(() => jumpTo(action.anchor, action.label));
  }, [onGoStep]);

  if (loading) {
    return (
      <section className="vy-drift" aria-labelledby="drift-watch-title">
        <p className="vy-drift__eyebrow">Drift watch</p>
        <div className="vy-drift__skeleton" aria-hidden="true" />
      </section>
    );
  }

  if (error || !drift) {
    return (
      <section className="vy-drift" aria-labelledby="drift-watch-title">
        <p className="vy-drift__eyebrow">Drift watch</p>
        <h3 id="drift-watch-title" className="vy-drift__headline">This one is on us.</h3>
        <p className="vy-drift__lede" role="alert">{error || "We could not check for drift just now"}</p>
        <button className="button secondary-button" type="button" onClick={() => void load()}>Try again</button>
      </section>
    );
  }

  const measuredDate = shortDate(drift.score_computed_at);
  const changeDate = shortDate(drift.last_model_change_at);

  return (
    <section className={`vy-drift vy-drift--${drift.state}`} aria-labelledby="drift-watch-title">
      <p className="vy-drift__eyebrow">Drift watch</p>

      {drift.state === "not_measured" ? (
        <>
          <h3 id="drift-watch-title" className="vy-drift__headline">Not measured yet.</h3>
          <p className="vy-drift__lede">
            We have not compared your voice to your own recordings recently enough to say whether it still sounds
            like you.
          </p>
        </>
      ) : (
        <>
          <h3 id="drift-watch-title" className="vy-drift__headline">
            {drift.state === "moved" ? "Something moved." : "Still sounds like you."}
          </h3>
          <p className="vy-drift__score">
            <span className="vy-drift__score-value">{drift.percent_of_ceiling}</span>
            <span className="vy-drift__score-note">
              {" "}of your own 100{measuredDate ? `, measured ${measuredDate}` : ""}
            </span>
          </p>
          {drift.trend.length > 0 && (
            <div className="vy-drift__trend">
              <Sparkline points={drift.trend} tone={drift.state === "moved" ? "moved" : "steady"} />
              <span className="vy-drift__trend-note">last 30 days</span>
            </div>
          )}
          {drift.state === "moved" && (
            <ul className="vy-drift__reasons">
              {drift.reasons
                .filter((code) => MOVED_REASON_TEXT[code])
                .map((code) => <li key={code}>{MOVED_REASON_TEXT[code]}</li>)}
            </ul>
          )}
        </>
      )}

      <p className="vy-drift__engine">
        {changeDate
          ? `The voice engine underneath it last changed on ${changeDate}.`
          : "The voice engine underneath it has not changed since we started watching."}
      </p>

      {drift.prosody_anchor_stale && drift.prosody_anchor_reason && (
        <p className="vy-drift__anchor-note">
          {PROSODY_REASON_TEXT[drift.prosody_anchor_reason] ?? "Our own alarm for this is not up to date."}
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
