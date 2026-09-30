import { useEffect, useRef, useState } from "react";
import { loadContextProposal, type ContextProposalView } from "./contextLockerApi";
import { ReplicaApiError } from "./replicaApi";
import "./context-proposal-review.css";

export default function ContextProposalReview({ token, replicaId, itemId, regionId, onClose, onAuthError }: {
  token: string; replicaId: string; itemId: string; regionId: string;
  onClose: () => void; onAuthError?: (error: ReplicaApiError) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<ContextProposalView | null>(null);
  const [error, setError] = useState("");
  const authError = useRef(onAuthError);
  authError.current = onAuthError;
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setView(null); setError("");
    void loadContextProposal(token, replicaId, itemId, controller.signal).then(next => {
      if (!controller.signal.aborted) setView(next);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof ReplicaApiError && [401, 403].includes(cause.status)) {
        setError("Sign in again to view these phrases."); authError.current?.(cause); return;
      }
      setError(cause instanceof ReplicaApiError && cause.status === 404
        ? "These suggestions are no longer available. Your file may have been removed."
        : "We could not load these suggestions. Try again.");
    });
    return () => controller.abort();
  }, [token, replicaId, itemId, attempt]);

  return <section id={regionId} className="context-proposal-review" aria-labelledby={`${regionId}-title`}>
    <h3 ref={heading} id={`${regionId}-title`} tabIndex={-1}>Suggested phrases</h3>
    {view ? <>
      <p className="context-proposal-source">{view.source_name}</p>
      <p role="status">{view.proposal.state === "pending" ? "Private. Not applied to your AI yet."
        : view.proposal.state === "rejected" ? "These suggestions were rejected."
          : "We cannot confirm whether these suggestions were saved to a draft."}</p>
      <ul className="context-proposal-list">{view.proposal.candidates.map(candidate => <li key={candidate.candidate_id}>
        <p className="context-proposal-kind">{candidate.field === "boardVerbalisms" ? "Teaching phrase" : "Repeated expression"}</p>
        <p className="context-proposal-fragment">{candidate.fragment}</p>
        <p>{candidate.occurrences} {candidate.occurrences === 1 ? "occurrence" : "occurrences"} in this source</p>
        {candidate.citations.map((citation, index) => <blockquote key={index}>
          <p>{citation.excerpt}</p>{citation.clipped && <span>Excerpt shortened</span>}
        </blockquote>)}
      </li>)}</ul>
    </> : error ? <p role="alert">{error}</p> : <p role="status">Loading phrases</p>}
    <div className="context-proposal-actions">
      {error && <button className="button" type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button>}
      <button className="button" type="button" onClick={onClose}>Back to files</button>
    </div>
  </section>;
}
