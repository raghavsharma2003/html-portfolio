import { useCallback, useEffect, useMemo, useState } from "react";
import { ReplicaApiError } from "./replicaApi";
import { extractClaims, readClaimExtraction } from "./claimExtractionApi";
import {
  approvePersonProfile,
  buildPersonProfile,
  decideClaim,
  readPersonModel,
} from "./personModelApi";
import type { ClaimExtractionStatus, PersonModelStatus, ReplicaClaim } from "./types";

const BLOCKERS: Record<string, string> = {
  self_name_required: "Confirm the name this replica uses for itself",
  language_identity_required: "Confirm its language and code-switching identity",
  behavior_evidence_required: "Review at least one behavior or repair pattern",
  boundary_evidence_required: "Confirm at least one personal boundary",
  critical_identity_conflict: "Resolve conflicting identity claims",
};

const EXTRACTION_BLOCKERS: Record<string, string> = {
  transcription_consent_required: "Grant transcription consent",
  training_consent_required: "Grant training consent for model-assisted claim extraction",
  reviewed_subject_transcript_required: "Accept at least one verified speaker transcript",
};

function confidence(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function ClaimCard({ claim, busy, decide }: { claim: ReplicaClaim; busy: boolean; decide: (claim: ReplicaClaim, decision: "accepted" | "rejected" | "superseded", reason: string) => void }) {
  return (
    <article className={`person-claim decision-${claim.decision ?? "pending"}`}>
      <div className="claim-meta">
        <span>{claim.domain}</span><span>·</span><span>{claim.key.replaceAll("_", " ")}</span>
        <span className="claim-confidence">{confidence(claim.confidence)} confidence</span>
      </div>
      <p>{claim.body}</p>
      <div className="claim-foot">
        <span>{claim.origin.replaceAll("_", " ")} · {claim.source_count} cited source{claim.source_count === 1 ? "" : "s"}</span>
        {claim.decision && <strong>{claim.decision}{claim.reason_code ? ` · ${claim.reason_code.replaceAll("_", " ")}` : ""}</strong>}
        <div className="claim-actions" aria-label="Review this claim">
          <button type="button" aria-pressed={claim.reason_code === "private_exclude"} disabled={busy || claim.reason_code === "private_exclude"} onClick={() => decide(claim, "rejected", "private_exclude")}>Keep out</button>
          <button type="button" aria-pressed={claim.reason_code === "inaccurate"} disabled={busy || claim.reason_code === "inaccurate"} onClick={() => decide(claim, "rejected", "inaccurate")}>Not accurate</button>
          <button type="button" aria-pressed={claim.decision === "superseded"} disabled={busy || claim.decision === "superseded"} onClick={() => decide(claim, "superseded", "outdated")}>Outdated</button>
          <button className="claim-accept" type="button" aria-pressed={claim.decision === "accepted"} disabled={busy || claim.decision === "accepted"} onClick={() => decide(claim, "accepted", "representative")}>This is me</button>
        </div>
      </div>
    </article>
  );
}

export default function PersonModelStudio({ token, replicaId, onAuthError }: { token: string; replicaId: string; onAuthError: (cause: unknown) => void }) {
  const [status, setStatus] = useState<PersonModelStatus | null>(null);
  const [extraction, setExtraction] = useState<ClaimExtractionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyClaim, setBusyClaim] = useState("");
  const [building, setBuilding] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState("");
  const [extractionError, setExtractionError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setExtractionError("");
    try {
      const [personModel, claimExtraction] = await Promise.allSettled([
        readPersonModel(token, replicaId),
        readClaimExtraction(token, replicaId),
      ]);
      if (personModel.status === "rejected") throw personModel.reason;
      setStatus(personModel.value);
      if (claimExtraction.status === "fulfilled") setExtraction(claimExtraction.value);
      else {
        if (claimExtraction.reason instanceof ReplicaApiError && claimExtraction.reason.status === 401) return onAuthError(claimExtraction.reason);
        setExtraction(null);
        setExtractionError(claimExtraction.reason instanceof Error ? claimExtraction.reason.message : "Cited extraction status could not be loaded");
      }
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : "Person Model could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [onAuthError, replicaId, token]);

  useEffect(() => { void load(); }, [load]);

  const draft = useMemo(() => status?.profiles.find((profile) => profile.status === "draft") ?? null, [status]);
  const approved = useMemo(() => status?.profiles.find((profile) => profile.status === "approved") ?? null, [status]);

  async function review(claim: ReplicaClaim, decision: "accepted" | "rejected" | "superseded", reason: string) {
    setBusyClaim(claim.claim_id);
    setError("");
    try {
      await decideClaim(token, replicaId, claim.claim_id, decision, reason);
      await load();
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : "Claim review was not saved");
    } finally {
      setBusyClaim("");
    }
  }

  async function build() {
    setBuilding(true);
    setError("");
    try {
      await buildPersonProfile(token, replicaId);
      await load();
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : "Person Model build was refused");
    } finally {
      setBuilding(false);
    }
  }

  async function approve(version: number) {
    setBuilding(true);
    setError("");
    try {
      await approvePersonProfile(token, replicaId, version);
      await load();
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : "Profile changed and could not be approved");
    } finally {
      setBuilding(false);
    }
  }

  async function extract() {
    setExtracting(true);
    setExtractionError("");
    try {
      await extractClaims(token, replicaId);
      await load();
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setExtractionError(cause instanceof Error ? cause.message : "Cited claims could not be extracted");
    } finally {
      setExtracting(false);
    }
  }

  return (
    <section className="person-model" aria-labelledby="person-model-title">
      <div className="person-model-head">
        <div>
          <p className="eyebrow">05 · Person Model</p>
          <h2 id="person-model-title">Not a persona prompt. A model you can inspect.</h2>
          <p>
            Confirm identity, language, behavior, values, boundaries, and autobiography as separate evidence-backed claims.
            Conflicts stay visible instead of being averaged into a confident fiction.
          </p>
        </div>
        <div className="model-version"><strong>{approved ? `v${approved.version}` : "—"}</strong><span>approved version</span></div>
      </div>

      {loading ? <div className="runtime-loading" role="status">Loading reviewed claims…</div> : error ? (
        <div className="runtime-error" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>Retry</button></div>
      ) : status ? (
        <>
          <div className="person-model-summary">
            <span><strong>{status.claims.length}</strong> proposed claims</span>
            <span><strong>{status.readiness.accepted_claims}</strong> accepted</span>
            <span><strong>{status.readiness.conflicts.length}</strong> critical conflicts</span>
          </div>
          <section className="claim-extraction" aria-labelledby="claim-extraction-title">
            <div className="claim-extraction-copy">
              <p className="eyebrow">Private cited extraction</p>
              <h3 id="claim-extraction-title">Turn your reviewed voice evidence into claims you control.</h3>
              <p>
                Only accepted target-speaker transcript spans qualify. Raw transcripts stay server-side, direct identifiers are
                masked before the model call, and every result remains a proposal until you review it below.
              </p>
              {extraction ? (
                <div className="extraction-facts">
                  <span><strong>{extraction.readiness.eligible_spans}</strong> eligible spans</span>
                  {extraction.runs[0] ? (
                    <span><strong>{extraction.runs[0].proposed_count}</strong> last proposed</span>
                  ) : <span>No extraction run yet</span>}
                </div>
              ) : null}
            </div>
            <div className="claim-extraction-action">
              {extraction?.readiness.blockers.length ? (
                <ul>
                  {extraction.readiness.blockers.map((blocker) => <li key={blocker}>{EXTRACTION_BLOCKERS[blocker] ?? blocker.replaceAll("_", " ")}</li>)}
                </ul>
              ) : null}
              {extractionError ? <p className="extraction-error" role="alert">{extractionError}</p> : null}
              <button className="button secondary-button" type="button" disabled={extracting || !extraction?.readiness.ready} onClick={() => void extract()}>
                {extracting ? "Extracting privately..." : extraction?.runs.length ? "Extract new evidence" : "Extract cited claims"}
              </button>
            </div>
          </section>
          {status.claims.length ? (
            <div className="person-claims">
              {status.claims.map((claim) => <ClaimCard key={claim.claim_id} claim={claim} busy={busyClaim === claim.claim_id} decide={(item, decision, reason) => void review(item, decision, reason)} />)}
            </div>
          ) : (
            <div className="person-empty">
              <strong>No behavior or memory claims yet.</strong>
              <p>Processed evidence will appear here for review. Raw transcripts, vectors, and storage paths remain withheld.</p>
            </div>
          )}
          {status.readiness.blockers.length > 0 && (
            <ul className="model-blockers">
              {status.readiness.blockers.map((blocker) => <li key={blocker}><span />{BLOCKERS[blocker] ?? blocker.replaceAll("_", " ")}</li>)}
            </ul>
          )}
          <div className="person-model-action">
            <p>A build is deterministic and versioned. Approving it never grants inference or voice generation permission.</p>
            {draft ? (
              <button className="button primary-button" type="button" disabled={building || !status.readiness.ready} onClick={() => void approve(draft.version)}>
                {building ? "Checking evidence…" : `Approve profile v${draft.version}`}
              </button>
            ) : (
              <button className="button primary-button" type="button" disabled={building || !status.readiness.ready} onClick={() => void build()}>
                {building ? "Building model…" : "Build review draft"}
              </button>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
