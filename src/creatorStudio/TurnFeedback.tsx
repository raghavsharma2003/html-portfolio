import { useState } from "react";
import { saveTurnFeedback } from "./feedbackApi";
import { ReplicaApiError } from "./replicaApi";
import type { ReplicaTurnFeedback, TurnFeedbackRating } from "./types";
import { useStudioLocale } from "./localeContext";
import { withCount } from "./copy";

const DIMENSIONS = ["wording", "behavior", "relationship", "memory", "delivery", "voice_identity"] as const;

const RATING_VALUES: Array<"exact" | "close" | "off"> = ["exact", "close", "off"];

const REASONS = [
  ["too_generic", ["overall", "wording", "behavior", "relationship"]],
  ["wrong_fact", ["overall", "memory"]],
  ["wrong_relationship", ["overall", "relationship"]],
  ["wrong_tone", ["overall", "behavior", "delivery"]],
  ["wrong_wording", ["overall", "wording"]],
  ["too_long", ["overall", "wording", "delivery"]],
  ["too_short", ["overall", "wording", "delivery"]],
  ["voice_mismatch", ["voice_identity"]],
  ["emotion_mismatch", ["behavior", "delivery", "voice_identity"]],
  ["unsafe_or_boundary", []],
  ["other", []],
] as const;

function reasonApplies(reason: (typeof REASONS)[number], ratings: Record<string, TurnFeedbackRating>) {
  return reason[1].length === 0 || reason[1].some((dimension) => dimension in ratings);
}

export default function TurnFeedback({
  token,
  replicaId,
  turnId,
  voiceHeard,
  onAuthError,
}: {
  token: string;
  replicaId: string;
  turnId: string;
  voiceHeard: boolean;
  onAuthError: (cause: unknown) => void;
}) {
  const { t } = useStudioLocale();
  const c = t.turnFeedback;
  const [open, setOpen] = useState(false);
  const [ratings, setRatings] = useState<Record<string, TurnFeedbackRating>>({});
  const [reasons, setReasons] = useState<string[]>([]);
  const [correction, setCorrection] = useState("");
  const [saved, setSaved] = useState<ReplicaTurnFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function persist(nextRatings: Record<string, TurnFeedbackRating>, nextReasons = reasons, nextCorrection = correction) {
    if (!Object.keys(nextRatings).length || busy) return;
    const mismatch = Object.values(nextRatings).some((rating) => rating === "close" || rating === "off" || rating === "unsafe");
    const allowsCorrection = ["overall", "wording", "behavior", "relationship", "memory"].some((dimension) => {
      const rating = nextRatings[dimension];
      return rating === "close" || rating === "off" || rating === "unsafe";
    });
    setBusy(true);
    setError("");
    try {
      const applicableReasons = mismatch ? nextReasons.filter((reason) => {
        const definition = REASONS.find(([value]) => value === reason);
        return definition ? reasonApplies(definition, nextRatings) : false;
      }) : [];
      const result = await saveTurnFeedback(token, replicaId, turnId, nextRatings, applicableReasons, allowsCorrection ? nextCorrection : "");
      setSaved(result);
      setOpen(false);
      setRatings(nextRatings);
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : c.errorFallback);
    } finally {
      setBusy(false);
    }
  }

  function rate(dimension: string, rating: TurnFeedbackRating) {
    setRatings((current) => {
      if (current[dimension] !== rating) return { ...current, [dimension]: rating };
      const next = { ...current };
      delete next[dimension];
      return next;
    });
  }

  function toggleReason(reason: string) {
    setReasons((current) => current.includes(reason) ? current.filter((item) => item !== reason) : [...current, reason]);
  }

  const hasMismatch = Object.values(ratings).some((rating) => rating === "close" || rating === "off" || rating === "unsafe");
  const correctionEligible = ["wording", "behavior", "relationship", "memory"].some((dimension) => ratings[dimension] === "close" || ratings[dimension] === "off" || ratings[dimension] === "unsafe");
  const visibleReasons = REASONS.filter((reason) => reasonApplies(reason, ratings));
  const ratedCount = Object.keys(ratings).length;

  return (
    <div className={`turn-feedback ${open ? "open" : ""}`}>
      {!open ? (
        <div className="turn-feedback-quick">
          {saved ? <span className="turn-feedback-saved">{withCount(c.savedRevision, saved.revision)}</span> : <span>{c.didThisFeelLikeYou}</span>}
          <button type="button" disabled={busy} onClick={() => void persist({ overall: "exact" }, [], "")}>{c.thisIsMe}</button>
          <button type="button" disabled={busy} onClick={() => { setOpen(true); setError(""); }}>{c.tuneThis}</button>
        </div>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); void persist(ratings); }}>
          <div className="turn-feedback-title"><strong>{c.teachDifference}</strong><button type="button" onClick={() => setOpen(false)}>{c.close}</button></div>
          <p>{c.gradeOnlyNote}</p>
          <div className="feedback-dimensions">
            {DIMENSIONS.map((dimension) => {
              const disabled = dimension === "voice_identity" && !voiceHeard;
              return (
                <fieldset key={dimension} disabled={disabled}>
                  <legend><span>{c.dimensionLabel[dimension]}</span><small>{disabled ? c.playVoiceFirst : c.dimensionDescription[dimension]}</small></legend>
                  <div>{RATING_VALUES.map((rating) => <button className={ratings[dimension] === rating ? "selected" : ""} type="button" key={rating} onClick={() => rate(dimension, rating)}>{c.ratingLabel[rating]}</button>)}</div>
                </fieldset>
              );
            })}
          </div>
          {hasMismatch ? (
            <div className="feedback-reasons">
              <span>{c.whatMissed}</span>
              <div>{visibleReasons.map(([value]) => <button className={reasons.includes(value) ? "selected" : ""} type="button" key={value} onClick={() => toggleReason(value)}>{c.reasonLabel[value]}</button>)}</div>
            </div>
          ) : null}
          {correctionEligible ? (
            <label className="feedback-correction">
              <span>{c.correctionLabel} <small>{c.correctionOptionalNote}</small></span>
              <textarea rows={2} maxLength={2_000} value={correction} onChange={(event) => setCorrection(event.target.value)} placeholder={c.correctionPlaceholder} />
            </label>
          ) : null}
          <div className="feedback-actions">
            <span>{ratedCount ? withCount(ratedCount === 1 ? c.layersRatedOne : c.layersRatedMany, ratedCount) : c.chooseAtLeastOne}</span>
            <button className="button primary-button" type="submit" disabled={busy || !ratedCount}>{busy ? c.securing : c.saveEvidence}</button>
          </div>
        </form>
      )}
      {error ? <p className="turn-feedback-error" role="alert">{error}</p> : null}
    </div>
  );
}
