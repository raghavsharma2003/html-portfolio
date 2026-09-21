import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReplicaApiError } from "./replicaApi";
import { extractClaims, readClaimExtraction } from "./claimExtractionApi";
import {
  approvePersonProfile,
  buildPersonProfile,
  decideClaim,
  readPersonModel,
} from "./personModelApi";
import type { ClaimExtractionStatus, PersonModelStatus, ReplicaClaim } from "./types";
import { EXTRACTION_STATUS_POLL_MS, presentClaimExtractionTiming } from "./claimExtractionPresentation";
import { useStudioLocale } from "./localeContext";
import type { PersonModelStudioCopy } from "./copy";

function ClaimCard({ claim, busy, decide, copy }: { claim: ReplicaClaim; busy: boolean; decide: (claim: ReplicaClaim, decision: "accepted" | "rejected" | "superseded", reason: string) => void; copy: PersonModelStudioCopy }) {
  return (
    <article className={`person-claim decision-${claim.decision ?? "pending"}`}>
      <div className="claim-meta">
        <span>{claim.domain}</span><span>·</span><span>{claim.key.replaceAll("_", " ")}</span>
        <span className="claim-confidence">{copy.confidencePctTemplate.replace("{n}", String(Math.round(Math.max(0, Math.min(1, claim.confidence)) * 100)))}</span>
      </div>
      <p>{claim.body}</p>
      {claim.citation_previews.length > 0 && (
        <div className="claim-citations" aria-label="Exact evidence for this claim">
          {claim.citation_previews.map((citation, index) => (
            <p key={`${claim.claim_id}-${index}`}><strong>{copy.fromYourSource}</strong> {citation.excerpt}</p>
          ))}
        </div>
      )}
      <div className="claim-foot">
        <span>{claim.origin.replaceAll("_", " ")} · {(claim.source_count === 1 ? copy.citedSourceOne : copy.citedSourceMany).replace("{n}", String(claim.source_count))}</span>
        {claim.decision && <strong>{claim.decision}{claim.reason_code ? ` · ${claim.reason_code.replaceAll("_", " ")}` : ""}</strong>}
        <div className="claim-actions" aria-label={copy.reviewClaimAriaLabel}>
          <button type="button" aria-pressed={claim.reason_code === "private_exclude"} disabled={busy || claim.reason_code === "private_exclude"} onClick={() => decide(claim, "rejected", "private_exclude")}>{copy.keepOut}</button>
          <button type="button" aria-pressed={claim.reason_code === "inaccurate"} disabled={busy || claim.reason_code === "inaccurate"} onClick={() => decide(claim, "rejected", "inaccurate")}>{copy.notAccurate}</button>
          <button type="button" aria-pressed={claim.decision === "superseded"} disabled={busy || claim.decision === "superseded"} onClick={() => decide(claim, "superseded", "outdated")}>{copy.outdated}</button>
          <button className="claim-accept" type="button" aria-pressed={claim.decision === "accepted"} disabled={busy || claim.decision === "accepted"} onClick={() => decide(claim, "accepted", "representative")}>{copy.thisIsMe}</button>
        </div>
      </div>
    </article>
  );
}

type PersonModelProps = { token: string; replicaId: string; onAuthError: (cause: unknown) => void };

export default function PersonModelStudio(props: PersonModelProps) {
  return <ScopedPersonModelStudio key={`${props.replicaId}:${props.token}`} {...props} />;
}

function ScopedPersonModelStudio({ token, replicaId, onAuthError }: PersonModelProps) {
  const { t } = useStudioLocale();
  const copy = t.personModelStudio;
  const mounted = useRef(false), readRevision = useRef(0), extractionRevision = useRef(0), mutation = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; readRevision.current++; extractionRevision.current++; };
  }, []);
  const [status, setStatus] = useState<PersonModelStatus | null>(null);
  const [extraction, setExtraction] = useState<ClaimExtractionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyClaim, setBusyClaim] = useState("");
  const [building, setBuilding] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState("");
  const [extractionError, setExtractionError] = useState("");
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);

  const load = useCallback(async () => {
    const revision = ++readRevision.current, extractionRead = ++extractionRevision.current;
    const current = () => mounted.current && revision === readRevision.current;
    setLoading(true);
    setError("");
    setExtractionError("");
    try {
      const [personModel, claimExtraction] = await Promise.allSettled([
        readPersonModel(token, replicaId),
        readClaimExtraction(token, replicaId),
      ]);
      if (!current()) return;
      if (personModel.status === "rejected") throw personModel.reason;
      if (personModel.value?.replica_id !== replicaId) throw new Error(copy.errorProfileUnavailable);
      setStatus(personModel.value);
      if (extractionRead !== extractionRevision.current) return;
      if (claimExtraction.status === "fulfilled") {
        if (claimExtraction.value?.replica_id !== replicaId) throw new Error(copy.errorExtractionCheckFailed);
        setExtraction(claimExtraction.value);
      }
      else {
        if (claimExtraction.reason instanceof ReplicaApiError && claimExtraction.reason.status === 401) return onAuthError(claimExtraction.reason);
        setExtraction(null);
        setExtractionError(claimExtraction.reason instanceof Error ? claimExtraction.reason.message : copy.errorExtractionUnavailable);
      }
    } catch (cause) {
      if (!current()) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : copy.errorLoadFailed);
    } finally {
      if (current()) setLoading(false);
    }
  }, [onAuthError, replicaId, token, copy]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const connected = () => setOnline(true);
    const disconnected = () => setOnline(false);
    window.addEventListener("online", connected);
    window.addEventListener("offline", disconnected);
    return () => {
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", disconnected);
    };
  }, []);

  const draft = useMemo(() => status?.profiles.find((profile) => profile.status === "draft") ?? null, [status]);
  const approved = useMemo(() => status?.profiles.find((profile) => profile.status === "approved") ?? null, [status]);
  const extractionTiming = useMemo(
    () => presentClaimExtractionTiming(extraction, Date.now(), online),
    [extraction, online],
  );
  const nearlineBusy = extraction?.nearline?.queued === true
    || extraction?.nearline?.state === "queued"
    || extraction?.nearline?.state === "running"
    || extraction?.nearline?.state === "waiting";

  useEffect(() => {
    if (!extractionTiming.shouldPoll || !online) return;
    let live = true;
    let timer = 0;
    const poll = async () => {
      const revision = ++extractionRevision.current;
      try {
        const current = await readClaimExtraction(token, replicaId);
        if (!live || !mounted.current || revision !== extractionRevision.current) return;
        if (current?.replica_id !== replicaId) throw new Error(copy.errorExtractionScopeChanged);
        setExtraction(current);
        setExtractionError("");
      } catch (cause) {
        if (!live || !mounted.current || revision !== extractionRevision.current) return;
        if (cause instanceof ReplicaApiError && cause.status === 401) {
          live = false;
          return onAuthError(cause);
        }
        setExtractionError(copy.errorExtractionCheckFailedRetryable);
      } finally {
        if (live) timer = window.setTimeout(() => void poll(), EXTRACTION_STATUS_POLL_MS);
      }
    };
    timer = window.setTimeout(() => void poll(), EXTRACTION_STATUS_POLL_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [extractionTiming.shouldPoll, online, onAuthError, replicaId, token, copy]);

  async function review(claim: ReplicaClaim, decision: "accepted" | "rejected" | "superseded", reason: string) {
    if (!mounted.current || mutation.current || status?.replica_id !== replicaId || !status.claims.includes(claim)) return;
    mutation.current = true; readRevision.current++;
    setBusyClaim(claim.claim_id);
    setError("");
    try {
      await decideClaim(token, replicaId, claim.claim_id, decision, reason);
      if (!mounted.current) return;
      await load();
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : copy.errorClaimNotSaved);
    } finally {
      if (mounted.current) { mutation.current = false; setBusyClaim(""); }
    }
  }

  async function build() {
    if (!mounted.current || mutation.current || status?.replica_id !== replicaId || !status.readiness.ready) return;
    mutation.current = true; readRevision.current++;
    setBuilding(true);
    setError("");
    try {
      await buildPersonProfile(token, replicaId);
      if (!mounted.current) return;
      await load();
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : copy.errorBuildRefused);
    } finally {
      if (mounted.current) { mutation.current = false; setBuilding(false); }
    }
  }

  async function approve(version: number) {
    if (!mounted.current || mutation.current || status?.replica_id !== replicaId || draft?.version !== version || !status.readiness.ready) return;
    mutation.current = true; readRevision.current++;
    setBuilding(true);
    setError("");
    try {
      await approvePersonProfile(token, replicaId, version);
      if (!mounted.current) return;
      await load();
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : copy.errorApproveChanged);
    } finally {
      if (mounted.current) { mutation.current = false; setBuilding(false); }
    }
  }

  async function extract() {
    if (!mounted.current || mutation.current || extraction?.replica_id !== replicaId || !extraction.readiness.ready) return;
    mutation.current = true; readRevision.current++; extractionRevision.current++;
    setExtracting(true);
    setExtractionError("");
    try {
      await extractClaims(token, replicaId);
      if (!mounted.current) return;
      await load();
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setExtractionError(cause instanceof Error ? cause.message : copy.errorExtractionFailed);
    } finally {
      if (mounted.current) { mutation.current = false; setExtracting(false); }
    }
  }

  async function checkExtractionNow() {
    const revision = ++extractionRevision.current;
    setExtractionError("");
    try {
      const current = await readClaimExtraction(token, replicaId);
      if (!mounted.current || revision !== extractionRevision.current) return;
      if (current?.replica_id !== replicaId) throw new Error(copy.errorExtractionCheckFailed);
      setExtraction(current);
    } catch (cause) {
      if (!mounted.current || revision !== extractionRevision.current) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setExtractionError(cause instanceof Error ? cause.message : copy.errorExtractionCheckFailedRetryable);
    }
  }

  const actionBusy = building || extracting || !!busyClaim;

  return (
    <section id="person-model-studio" className="person-model" aria-labelledby="person-model-title">
      <div className="person-model-head">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h2 id="person-model-title">{copy.title}</h2>
          <p>{copy.intro}</p>
        </div>
        <div className="model-version"><strong>{approved ? `v${approved.version}` : copy.noApprovedVersion}</strong><span>{copy.approvedVersionLabel}</span></div>
      </div>

      {loading ? <div className="runtime-loading" role="status">{copy.loadingClaims}</div> : error ? (
        <div className="runtime-error" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>{copy.retry}</button></div>
      ) : status ? (
        <>
          <div className="person-model-summary">
            <span><strong>{status.claims.length}</strong> {copy.proposedClaims}</span>
            <span><strong>{status.readiness.accepted_claims}</strong> {copy.accepted}</span>
            <span><strong>{status.readiness.conflicts.length}</strong> {copy.criticalConflicts}</span>
          </div>
          <section className="claim-extraction" aria-labelledby="claim-extraction-title">
            <div className="claim-extraction-copy">
              <p className="eyebrow">{copy.citedExtractionEyebrow}</p>
              <h3 id="claim-extraction-title">{copy.citedExtractionTitle}</h3>
              <p>{copy.citedExtractionIntro}</p>
              {extraction ? (
                <div className="extraction-facts">
                  <span><strong>{extraction.readiness.eligible_spans}</strong> {copy.eligibleSpans}</span>
                  {extraction.runs[0] ? (
                    <span><strong>{extraction.runs[0].proposed_count}</strong> {copy.lastProposed}</span>
                  ) : <span>{copy.noExtractionRunYet}</span>}
                </div>
              ) : null}
              <aside className={`claim-extraction-status tone-${extractionTiming.tone}`} role="status" aria-live="polite">
                <strong>{extractionTiming.title}</strong>
                <p>{extractionTiming.phase}</p>
                <dl>
                  <div><dt>{copy.observedRangeLabel}</dt><dd>{extractionTiming.observedRange}</dd></div>
                  <div><dt>{copy.nextCheckLabel}</dt><dd>{extractionTiming.nextCheck}</dd></div>
                  <div><dt>{copy.leaveOrReturnLabel}</dt><dd>{extractionTiming.returnGuidance}</dd></div>
                </dl>
              </aside>
            </div>
            <div className="claim-extraction-action">
              {extraction?.readiness.blockers.length ? (
                <ul>
                  {extraction.readiness.blockers.map((blocker) => <li key={blocker}>{copy.extractionBlockers[blocker as keyof PersonModelStudioCopy["extractionBlockers"]] ?? blocker.replaceAll("_", " ")}</li>)}
                </ul>
              ) : null}
              {extractionError ? <p className="extraction-error" role="alert">{extractionError}</p> : null}
              {extractionError || extractionTiming.tone === "unknown" ? (
                <button className="text-button" type="button" disabled={!online} onClick={() => void checkExtractionNow()}>
                  {copy.checkStatusNow}
                </button>
              ) : null}
              <button className="button secondary-button" type="button" disabled={actionBusy || nearlineBusy || !extraction?.readiness.ready} onClick={() => void extract()}>
                {extracting
                  ? copy.submittingExtraction
                  : extraction?.nearline?.state === "running"
                    ? copy.extractionRunning
                    : extraction?.nearline?.state === "waiting"
                      ? copy.waitingToRetry
                      : extraction?.nearline?.state === "queued"
                        ? copy.extractionQueued
                        : extraction?.runs.length ? copy.extractNewEvidence : copy.extractCitedClaims}
              </button>
            </div>
          </section>
          {status.claims.length ? (
            <div className="person-claims">
              {status.claims.map((claim) => <ClaimCard key={claim.claim_id} claim={claim} busy={actionBusy} decide={(item, decision, reason) => void review(item, decision, reason)} copy={copy} />)}
            </div>
          ) : (
            <div className="person-empty">
              <strong>{copy.noClaimsHeadline}</strong>
              <p>{copy.noClaimsNote}</p>
            </div>
          )}
          {status.readiness.blockers.length > 0 && (
            <ul className="model-blockers">
              {status.readiness.blockers.map((blocker) => <li key={blocker}><span />{copy.blockers[blocker as keyof PersonModelStudioCopy["blockers"]] ?? blocker.replaceAll("_", " ")}</li>)}
            </ul>
          )}
          <div className="person-model-action">
            <p>{copy.buildIsDeterministicNote}</p>
            {draft ? (
              <button className="button primary-button" type="button" disabled={actionBusy || !status.readiness.ready} onClick={() => void approve(draft.version)}>
                {building ? copy.checkingEvidence : copy.approveProfileVersionTemplate.replace("{n}", String(draft.version))}
              </button>
            ) : (
              <button className="button primary-button" type="button" disabled={actionBusy || !status.readiness.ready} onClick={() => void build()}>
                {building ? copy.building : copy.buildReviewDraft}
              </button>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
