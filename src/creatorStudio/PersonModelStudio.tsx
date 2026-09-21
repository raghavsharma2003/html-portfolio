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
import { useStudioLocale } from "./localeContext";
import { withCount, type StudioCopy } from "./copy";

function confidencePct(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

function ClaimCard({ claim, busy, decide, c }: { claim: ReplicaClaim; busy: boolean; decide: (claim: ReplicaClaim, decision: "accepted" | "rejected" | "superseded", reason: string) => void; c: StudioCopy["personModelStudio"] }) {
  return (
    <article className={`person-claim decision-${claim.decision ?? "pending"}`}>
      <div className="claim-meta">
        <span>{claim.domain}</span><span>·</span><span>{claim.key.replaceAll("_", " ")}</span>
        <span className="claim-confidence">{withCount(c.confidencePct, confidencePct(claim.confidence))}</span>
      </div>
      <p>{claim.body}</p>
      <div className="claim-foot">
        <span>{claim.origin.replaceAll("_", " ")} · {withCount(claim.source_count === 1 ? c.citedSourceOne : c.citedSourceMany, claim.source_count)}</span>
        {claim.decision && <strong>{claim.decision}{claim.reason_code ? ` · ${claim.reason_code.replaceAll("_", " ")}` : ""}</strong>}
        <div className="claim-actions" aria-label={c.reviewClaimAriaLabel}>
          <button type="button" aria-pressed={claim.reason_code === "private_exclude"} disabled={busy || claim.reason_code === "private_exclude"} onClick={() => decide(claim, "rejected", "private_exclude")}>{c.keepOut}</button>
          <button type="button" aria-pressed={claim.reason_code === "inaccurate"} disabled={busy || claim.reason_code === "inaccurate"} onClick={() => decide(claim, "rejected", "inaccurate")}>{c.notAccurate}</button>
          <button type="button" aria-pressed={claim.decision === "superseded"} disabled={busy || claim.decision === "superseded"} onClick={() => decide(claim, "superseded", "outdated")}>{c.outdated}</button>
          <button className="claim-accept" type="button" aria-pressed={claim.decision === "accepted"} disabled={busy || claim.decision === "accepted"} onClick={() => decide(claim, "accepted", "representative")}>{c.thisIsMe}</button>
        </div>
      </div>
    </article>
  );
}

export default function PersonModelStudio({ token, replicaId, onAuthError }: { token: string; replicaId: string; onAuthError: (cause: unknown) => void }) {
  const { t } = useStudioLocale();
  const c = t.personModelStudio;
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
        setExtractionError(claimExtraction.reason instanceof Error ? claimExtraction.reason.message : c.errorExtractionUnavailable);
      }
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : c.errorProfileUnavailable);
    } finally {
      setLoading(false);
    }
  }, [onAuthError, replicaId, token, c.errorExtractionUnavailable, c.errorProfileUnavailable]);

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
      setError(cause instanceof Error ? cause.message : c.errorClaimNotSaved);
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
      setError(cause instanceof Error ? cause.message : c.errorBuildRefused);
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
      setError(cause instanceof Error ? cause.message : c.errorApproveChanged);
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
      setExtractionError(cause instanceof Error ? cause.message : c.errorExtractionFailed);
    } finally {
      setExtracting(false);
    }
  }

  return (
    <section id="person-model-studio" className="person-model" aria-labelledby="person-model-title">
      <div className="person-model-head">
        <div>
          <p className="eyebrow">{c.eyebrow}</p>
          <h2 id="person-model-title">{c.title}</h2>
          <p>{c.intro}</p>
        </div>
        <div className="model-version"><strong>{approved ? `v${approved.version}` : "\u2014"}</strong><span>{c.approvedVersionLabel}</span></div>
      </div>

      {loading ? <div className="runtime-loading" role="status">{c.loadingClaims}</div> : error ? (
        <div className="runtime-error" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>{c.retry}</button></div>
      ) : status ? (
        <>
          <div className="person-model-summary">
            <span><strong>{status.claims.length}</strong> {c.proposedClaims}</span>
            <span><strong>{status.readiness.accepted_claims}</strong> {c.accepted}</span>
            <span><strong>{status.readiness.conflicts.length}</strong> {c.criticalConflicts}</span>
          </div>
          <section className="claim-extraction" aria-labelledby="claim-extraction-title">
            <div className="claim-extraction-copy">
              <p className="eyebrow">{c.citedExtractionEyebrow}</p>
              <h3 id="claim-extraction-title">{c.citedExtractionTitle}</h3>
              <p>{c.citedExtractionIntro}</p>
              {extraction ? (
                <div className="extraction-facts">
                  <span><strong>{extraction.readiness.eligible_spans}</strong> {c.eligibleSpans}</span>
                  {extraction.runs[0] ? (
                    <span><strong>{extraction.runs[0].proposed_count}</strong> {c.lastProposed}</span>
                  ) : <span>{c.noExtractionRunYet}</span>}
                </div>
              ) : null}
            </div>
            <div className="claim-extraction-action">
              {extraction?.readiness.blockers.length ? (
                <ul>
                  {extraction.readiness.blockers.map((blocker) => <li key={blocker}>{c.extractionBlockers[blocker as keyof typeof c.extractionBlockers] ?? blocker.replaceAll("_", " ")}</li>)}
                </ul>
              ) : null}
              {extractionError ? <p className="extraction-error" role="alert">{extractionError}</p> : null}
              <button className="button secondary-button" type="button" disabled={extracting || !extraction?.readiness.ready} onClick={() => void extract()}>
                {extracting ? c.extractingPrivately : extraction?.runs.length ? c.extractNewEvidence : c.extractCitedClaims}
              </button>
            </div>
          </section>
          {status.claims.length ? (
            <div className="person-claims">
              {status.claims.map((claim) => <ClaimCard key={claim.claim_id} claim={claim} busy={busyClaim === claim.claim_id} decide={(item, decision, reason) => void review(item, decision, reason)} c={c} />)}
            </div>
          ) : (
            <div className="person-empty">
              <strong>{c.noClaimsHeadline}</strong>
              <p>{c.noClaimsNote}</p>
            </div>
          )}
          {status.readiness.blockers.length > 0 && (
            <ul className="model-blockers">
              {status.readiness.blockers.map((blocker) => <li key={blocker}><span />{c.blockers[blocker as keyof typeof c.blockers] ?? blocker.replaceAll("_", " ")}</li>)}
            </ul>
          )}
          <div className="person-model-action">
            <p>{c.buildIsDeterministicNote}</p>
            {draft ? (
              <button className="button primary-button" type="button" disabled={building || !status.readiness.ready} onClick={() => void approve(draft.version)}>
                {building ? c.checkingEvidence : c.approveProfileVersion.split("{n}").join(String(draft.version))}
              </button>
            ) : (
              <button className="button primary-button" type="button" disabled={building || !status.readiness.ready} onClick={() => void build()}>
                {building ? c.building : c.buildReviewDraft}
              </button>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
