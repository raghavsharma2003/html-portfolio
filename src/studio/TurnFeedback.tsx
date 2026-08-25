import { useState } from "react";
import { saveTurnFeedback } from "./feedbackApi";
import { ReplicaApiError } from "./replicaApi";
import type { ReplicaTurnFeedback, TurnFeedbackRating } from "./types";

const DIMENSIONS = [
  ["wording", "Wording", "The phrases and sentence shape"],
  ["behavior", "Behavior", "How you react and make decisions"],
  ["relationship", "Relationship", "How this sounds with this person"],
  ["memory", "Memory", "Facts, callbacks, and uncertainty"],
  ["delivery", "Delivery", "Pace, emotion, and nonverbals"],
  ["voice_identity", "Voice", "The protected audio you actually heard"],
] as const;

const RATINGS: Array<{ value: TurnFeedbackRating; label: string }> = [
  { value: "exact", label: "Exact" },
  { value: "close", label: "Close" },
  { value: "off", label: "Off" },
];

const REASONS = [
  ["too_generic", "Too generic", ["overall", "wording", "behavior", "relationship"]],
  ["wrong_fact", "Wrong fact", ["overall", "memory"]],
  ["wrong_relationship", "Wrong relationship", ["overall", "relationship"]],
  ["wrong_tone", "Wrong tone", ["overall", "behavior", "delivery"]],
  ["wrong_wording", "Wrong wording", ["overall", "wording"]],
  ["too_long", "Too long", ["overall", "wording", "delivery"]],
  ["too_short", "Too short", ["overall", "wording", "delivery"]],
  ["voice_mismatch", "Voice mismatch", ["voice_identity"]],
  ["emotion_mismatch", "Emotion mismatch", ["behavior", "delivery", "voice_identity"]],
  ["unsafe_or_boundary", "Crossed a boundary", []],
  ["other", "Something else", []],
] as const;

function reasonApplies(reason: (typeof REASONS)[number], ratings: Record<string, TurnFeedbackRating>) {
  return reason[2].length === 0 || reason[2].some((dimension) => dimension in ratings);
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
      setError(cause instanceof Error ? cause.message : "This fidelity note could not be secured");
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

  return (
    <div className={`turn-feedback ${open ? "open" : ""}`}>
      {!open ? (
        <div className="turn-feedback-quick">
          {saved ? <span className="turn-feedback-saved">Revision {saved.revision} secured</span> : <span>Did this feel like you?</span>}
          <button type="button" disabled={busy} onClick={() => void persist({ overall: "exact" }, [], "")}>This is me</button>
          <button type="button" disabled={busy} onClick={() => { setOpen(true); setError(""); }}>Tune this</button>
        </div>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); void persist(ratings); }}>
          <div className="turn-feedback-title"><strong>Teach the difference</strong><button type="button" onClick={() => setOpen(false)}>Close</button></div>
          <p>Grade only what you noticed. Unrated layers remain unknown.</p>
          <div className="feedback-dimensions">
            {DIMENSIONS.map(([dimension, label, description]) => {
              const disabled = dimension === "voice_identity" && !voiceHeard;
              return (
                <fieldset key={dimension} disabled={disabled}>
                  <legend><span>{label}</span><small>{disabled ? "Play protected voice first" : description}</small></legend>
                  <div>{RATINGS.map((rating) => <button className={ratings[dimension] === rating.value ? "selected" : ""} type="button" key={rating.value} onClick={() => rate(dimension, rating.value)}>{rating.label}</button>)}</div>
                </fieldset>
              );
            })}
          </div>
          {hasMismatch ? (
            <div className="feedback-reasons">
              <span>What missed?</span>
              <div>{visibleReasons.map(([value, label]) => <button className={reasons.includes(value) ? "selected" : ""} type="button" key={value} onClick={() => toggleReason(value)}>{label}</button>)}</div>
            </div>
          ) : null}
          {correctionEligible ? (
            <label className="feedback-correction">
              <span>What would you actually say? <small>optional, encrypted before storage</small></span>
              <textarea rows={2} maxLength={2_000} value={correction} onChange={(event) => setCorrection(event.target.value)} placeholder="Write the version that sounds like you." />
            </label>
          ) : null}
          <div className="feedback-actions">
            <span>{Object.keys(ratings).length ? `${Object.keys(ratings).length} layer${Object.keys(ratings).length === 1 ? "" : "s"} rated` : "Choose at least one layer"}</span>
            <button className="button primary-button" type="submit" disabled={busy || !Object.keys(ratings).length}>{busy ? "Securing..." : "Save evidence"}</button>
          </div>
        </form>
      )}
      {error ? <p className="turn-feedback-error" role="alert">{error}</p> : null}
    </div>
  );
}
