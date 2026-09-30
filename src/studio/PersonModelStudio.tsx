import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ReplicaApiError } from "./replicaApi";
import { extractClaims, readClaimExtraction } from "./claimExtractionApi";
import {
  approvePersonProfile,
  buildPersonProfile,
  decideClaim,
  readPersonModel,
} from "./personModelApi";
import type { ClaimExtractionStatus, PersonModelStatus, ReplicaClaim, SourceAwareClaimCitation } from "./types";
import { EXTRACTION_STATUS_POLL_MS, presentClaimExtractionTiming } from "./claimExtractionPresentation";
import { citationSourceLabel, claimMatchesReviewSource, isSourceAwareCitation, reviewCitation, reviewSourceLabel } from "./sourceAwareReview";
import type { ReviewSourceSelection } from "./sourceAwareReview";
import "./source-aware-review.css";

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
  reviewed_confident_subject_transcript_required: "Accept at least one confident, verified speaker transcript",
  reviewed_confident_subject_evidence_required: "Accept a confident verified speaker transcript, or mark an uploaded document as your own writing",
};

function confidence(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function SourceCitation({ citation, selected }: { citation: SourceAwareClaimCitation; selected: boolean }) {
  const locator = citation.source_locator;
  return (
    <div className="claim-source-evidence">
      <p className="claim-source-label"><strong>{citationSourceLabel(citation)}</strong>{selected ? <span>Selected source</span> : null}</p>
      <p className="claim-source-kind">{citation.interpretation === "machine_transcription" ? "Machine transcription. The wording may be incorrect." : "Text you supplied."}</p>
      <blockquote dir="auto">{citation.excerpt}</blockquote>
      <details className="claim-source-location">
        <summary>Source location and limits</summary>
        <p>Quote offsets: {citation.citation.start_char} to {citation.citation.end_char} within the evidence text, in UTF-16 code units. The end offset is excluded.</p>
        {locator.unit === "utf16_code_units" ? (
          <>
            <p>Canonical text offsets: {locator.start_char} to {locator.end_char}, in UTF-16 code units. The end offset is excluded.</p>
            {citation.modality === "document" ? <p>Page mapping is unavailable.</p> : null}
          </>
        ) : (
          <>
            <p>Transcription input window: {locator.start_ms} to {locator.end_ms} milliseconds. This covers the evidence span, not the exact words.</p>
            <p>Word timing and mapping to the original recording are unavailable.</p>
          </>
        )}
        {citation.modality === "video" ? <p>Visual content was not interpreted.</p> : null}
        <p>These coordinates do not establish who wrote or spoke the words.</p>
      </details>
    </div>
  );
}

function ClaimCard({ claim, busy, decide, selectedSource }: { claim: ReplicaClaim; busy: boolean; selectedSource?: ReviewSourceSelection | null; decide: (claim: ReplicaClaim, decision: "accepted" | "rejected" | "superseded", reason: string) => void }) {
  const previews = Array.isArray(claim.citation_previews) ? claim.citation_previews.map(reviewCitation).filter(citation => citation !== null) : [];
  return (
    <article className={`person-claim decision-${claim.decision ?? "pending"}`}>
      <div className="claim-meta">
        <span>{claim.domain}</span><span>·</span><span>{claim.key.replaceAll("_", " ")}</span>
        <span className="claim-confidence">{confidence(claim.confidence)} confidence</span>
      </div>
      <p className="claim-proposal-label">{claim.origin === "inferred" ? "Proposed interpretation" : "Claim for your review"}</p>
      <p dir="auto">{claim.body}</p>
      {previews.length > 0 ? (
        <div className="claim-citations" aria-label="Exact evidence for this claim">
          {previews.map((citation, index) => isSourceAwareCitation(citation) ? (
            <SourceCitation key={`${claim.claim_id}-${index}`} citation={citation} selected={Boolean(selectedSource && citation.context_item_id?.toLowerCase() === selectedSource.itemId.toLowerCase())} />
          ) : (
            <div className="claim-source-evidence" key={`${claim.claim_id}-${index}`}>
              <p><strong>Saved excerpt</strong></p>
              <blockquote dir="auto">{citation.excerpt}</blockquote>
              <p className="claim-source-kind">Source type and location are unavailable for this older evidence.</p>
            </div>
          ))}
        </div>
      ) : <p className="claim-source-kind">No source preview is available for this claim.</p>}
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

type PersonModelProps = { token: string; replicaId: string; ownerScope?: string; selectedSource?: ReviewSourceSelection | null; onClearSource?: () => void; onAuthError: (cause: unknown) => void };

export default function PersonModelStudio(props: PersonModelProps) {
  const scope = useRef({ token: props.token, replicaId: props.replicaId, owner: props.ownerScope, generation: 0 });
  if (scope.current.token !== props.token || scope.current.replicaId !== props.replicaId || scope.current.owner !== props.ownerScope) {
    scope.current = { token: props.token, replicaId: props.replicaId, owner: props.ownerScope, generation: scope.current.generation + 1 };
  }
  const activeScope = scope.current;
  const scopeIsCurrent = useCallback(() => scope.current === activeScope, [activeScope]);
  return <ScopedPersonModelStudio key={activeScope.generation} {...props} scopeIsCurrent={scopeIsCurrent} />;
}

function ScopedPersonModelStudio({ token, replicaId, onAuthError, selectedSource, onClearSource, scopeIsCurrent }: PersonModelProps & { scopeIsCurrent: () => boolean }) {
  const mounted = useRef(false), readRevision = useRef(0), extractionRevision = useRef(0), mutation = useRef(false);
  const title = useRef<HTMLHeadingElement | null>(null);
  useLayoutEffect(() => {
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
    if (!mounted.current || !scopeIsCurrent()) return;
    const revision = ++readRevision.current, extractionRead = ++extractionRevision.current;
    const current = () => mounted.current && scopeIsCurrent() && revision === readRevision.current;
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
      if (personModel.value?.replica_id !== replicaId) throw new Error("The reviewed model could not be confirmed. Retry.");
      setStatus(personModel.value);
      if (extractionRead !== extractionRevision.current) return;
      if (claimExtraction.status === "fulfilled") {
        if (claimExtraction.value?.replica_id !== replicaId) throw new Error("The extraction status could not be confirmed. Retry.");
        setExtraction(claimExtraction.value);
      }
      else {
        if (claimExtraction.reason instanceof ReplicaApiError && claimExtraction.reason.status === 401) return onAuthError(claimExtraction.reason);
        setExtraction(null);
        setExtractionError(claimExtraction.reason instanceof Error ? claimExtraction.reason.message : "Cited extraction status could not be loaded");
      }
    } catch (cause) {
      if (!current()) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : "Person Model could not be loaded");
    } finally {
      if (current()) setLoading(false);
    }
  }, [onAuthError, replicaId, token, scopeIsCurrent]);

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
      if (!live || !mounted.current || !scopeIsCurrent()) return;
      const revision = ++extractionRevision.current;
      try {
        const current = await readClaimExtraction(token, replicaId);
        if (!live || !mounted.current || !scopeIsCurrent() || revision !== extractionRevision.current) return;
        if (current?.replica_id !== replicaId) throw new Error("Extraction scope changed");
        setExtraction(current);
        setExtractionError("");
      } catch (cause) {
        if (!live || !mounted.current || !scopeIsCurrent() || revision !== extractionRevision.current) return;
        if (cause instanceof ReplicaApiError && cause.status === 401) {
          live = false;
          return onAuthError(cause);
        }
        setExtractionError("The latest durable extraction status could not be checked. Server work may still be continuing; this page will try again after it reconnects or reloads.");
      } finally {
        if (live && scopeIsCurrent()) timer = window.setTimeout(() => void poll(), EXTRACTION_STATUS_POLL_MS);
      }
    };
    timer = window.setTimeout(() => void poll(), EXTRACTION_STATUS_POLL_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [extractionTiming.shouldPoll, online, onAuthError, replicaId, token, scopeIsCurrent]);

  async function review(claim: ReplicaClaim, decision: "accepted" | "rejected" | "superseded", reason: string) {
    if (!mounted.current || !scopeIsCurrent() || mutation.current || status?.replica_id !== replicaId || !status.claims.includes(claim)) return;
    mutation.current = true; readRevision.current++;
    setBusyClaim(claim.claim_id);
    setError("");
    try {
      await decideClaim(token, replicaId, claim.claim_id, decision, reason);
      if (!mounted.current || !scopeIsCurrent()) return;
      await load();
    } catch (cause) {
      if (!mounted.current || !scopeIsCurrent()) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : "Claim review was not saved");
    } finally {
      if (mounted.current && scopeIsCurrent()) { mutation.current = false; setBusyClaim(""); }
    }
  }

  async function build() {
    if (!mounted.current || !scopeIsCurrent() || mutation.current || status?.replica_id !== replicaId || !status.readiness.ready) return;
    mutation.current = true; readRevision.current++;
    setBuilding(true);
    setError("");
    try {
      await buildPersonProfile(token, replicaId);
      if (!mounted.current || !scopeIsCurrent()) return;
      await load();
    } catch (cause) {
      if (!mounted.current || !scopeIsCurrent()) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : "Person Model build was refused");
    } finally {
      if (mounted.current && scopeIsCurrent()) { mutation.current = false; setBuilding(false); }
    }
  }

  async function approve(version: number) {
    if (!mounted.current || !scopeIsCurrent() || mutation.current || status?.replica_id !== replicaId || draft?.version !== version || !status.readiness.ready) return;
    mutation.current = true; readRevision.current++;
    setBuilding(true);
    setError("");
    try {
      await approvePersonProfile(token, replicaId, version);
      if (!mounted.current || !scopeIsCurrent()) return;
      await load();
    } catch (cause) {
      if (!mounted.current || !scopeIsCurrent()) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : "Profile changed and could not be approved");
    } finally {
      if (mounted.current && scopeIsCurrent()) { mutation.current = false; setBuilding(false); }
    }
  }

  async function extract() {
    if (!mounted.current || !scopeIsCurrent() || mutation.current || extraction?.replica_id !== replicaId || !extraction.readiness.ready) return;
    mutation.current = true; readRevision.current++; extractionRevision.current++;
    setExtracting(true);
    setExtractionError("");
    try {
      await extractClaims(token, replicaId);
      if (!mounted.current || !scopeIsCurrent()) return;
      await load();
    } catch (cause) {
      if (!mounted.current || !scopeIsCurrent()) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setExtractionError(cause instanceof Error ? cause.message : "Cited claims could not be extracted");
    } finally {
      if (mounted.current && scopeIsCurrent()) { mutation.current = false; setExtracting(false); }
    }
  }

  async function checkExtractionNow() {
    if (!mounted.current || !scopeIsCurrent()) return;
    const revision = ++extractionRevision.current;
    setExtractionError("");
    try {
      const current = await readClaimExtraction(token, replicaId);
      if (!mounted.current || !scopeIsCurrent() || revision !== extractionRevision.current) return;
      if (current?.replica_id !== replicaId) throw new Error("The extraction status could not be confirmed. Retry.");
      setExtraction(current);
    } catch (cause) {
      if (!mounted.current || !scopeIsCurrent() || revision !== extractionRevision.current) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setExtractionError(cause instanceof Error ? cause.message : "The durable extraction status could not be checked");
    }
  }

  const actionBusy = building || extracting || !!busyClaim;
  const visibleClaims = selectedSource ? status?.claims.filter(claim => claimMatchesReviewSource(claim, selectedSource.itemId)) ?? [] : status?.claims ?? [];

  return (
    <section id="person-model-studio" className="person-model" aria-labelledby="person-model-title">
      <div className="person-model-head">
        <div>
          <h2 id="person-model-title" ref={title} tabIndex={-1}>Review what your sources say about you</h2>
          <p>
            Compare each proposal with its quoted evidence. An interpretation is not a fact, and accepting a claim does not publish it.
          </p>
        </div>
        <div className="model-version"><strong>{approved ? `v${approved.version}` : "\u2014"}</strong><span>approved version</span></div>
      </div>

      {loading ? <div className="runtime-loading" role="status">Loading reviewed claims…</div> : error ? (
        <div className="runtime-error" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>Retry</button></div>
      ) : status ? (
        <>
          {selectedSource ? (
            <section className="claim-review-scope" aria-label="Selected source review">
              <div>
                <h3>Reviewing this source</h3>
                <p dir="auto" className="claim-review-source-name">{reviewSourceLabel(selectedSource.label)}</p>
                <p role="status">{visibleClaims.length} linked claim{visibleClaims.length === 1 ? "" : "s"} available in this review.</p>
                <p>Review totals below cover all sources.</p>
              </div>
              {onClearSource ? <button type="button" className="button secondary-button" onClick={() => { if (mounted.current && scopeIsCurrent()) { title.current?.focus(); onClearSource(); } }}>All sources</button> : null}
            </section>
          ) : null}
          <div className="person-model-summary" aria-label="Review totals across all sources">
            <span><strong>{status.claims.length}</strong> proposed claims</span>
            <span><strong>{status.readiness.accepted_claims}</strong> accepted</span>
            <span><strong>{status.readiness.conflicts.length}</strong> critical conflicts</span>
          </div>
          <section className="claim-extraction" aria-labelledby="claim-extraction-title">
            <div className="claim-extraction-copy">
              <h3 id="claim-extraction-title">Find claims in your reviewed sources</h3>
              <p>
                Eligible material includes accepted speaker transcripts and uploaded writing marked as your own.
                Extraction checks all eligible sources, even when this review is filtered to one source. Every result remains a proposal for your review.
              </p>
              {extraction ? (
                <div className="extraction-facts">
                  <span><strong>{extraction.readiness.eligible_spans}</strong> eligible spans</span>
                  {extraction.runs[0] ? (
                    <span><strong>{extraction.runs[0].proposed_count}</strong> last proposed</span>
                  ) : <span>No extraction run yet</span>}
                </div>
              ) : null}
              <aside className={`claim-extraction-status tone-${extractionTiming.tone}`} role="status" aria-live="polite">
                <strong>{extractionTiming.title}</strong>
                <p>{extractionTiming.phase}</p>
                <dl>
                  <div><dt>Observed range</dt><dd>{extractionTiming.observedRange}</dd></div>
                  <div><dt>Next check</dt><dd>{extractionTiming.nextCheck}</dd></div>
                  <div><dt>Leave or return</dt><dd>{extractionTiming.returnGuidance}</dd></div>
                </dl>
              </aside>
            </div>
            <div className="claim-extraction-action">
              {extraction?.readiness.blockers.length ? (
                <ul>
                  {extraction.readiness.blockers.map((blocker) => <li key={blocker}>{EXTRACTION_BLOCKERS[blocker] ?? blocker.replaceAll("_", " ")}</li>)}
                </ul>
              ) : null}
              {extractionError ? <p className="extraction-error" role="alert">{extractionError}</p> : null}
              {extractionError || extractionTiming.tone === "unknown" ? (
                <button className="text-button" type="button" disabled={!online} onClick={() => void checkExtractionNow()}>
                  Check status now
                </button>
              ) : null}
              <button className="button secondary-button" type="button" disabled={actionBusy || nearlineBusy || !extraction?.readiness.ready} onClick={() => void extract()}>
                {extracting
                  ? "Submitting extraction..."
                  : extraction?.nearline?.state === "running"
                    ? "Extraction running"
                    : extraction?.nearline?.state === "waiting"
                      ? "Waiting to retry"
                      : extraction?.nearline?.state === "queued"
                        ? "Extraction queued"
                        : extraction?.runs.length ? "Extract new evidence" : "Extract cited claims"}
              </button>
            </div>
          </section>
          {visibleClaims.length ? (
            <div className="person-claims">
              {visibleClaims.map((claim) => <ClaimCard key={claim.claim_id} claim={claim} selectedSource={selectedSource} busy={actionBusy} decide={(item, decision, reason) => void review(item, decision, reason)} />)}
            </div>
          ) : (
            <div className="person-empty">
              <strong>{selectedSource ? "No linked claims available for this source." : "No behavior or memory claims yet."}</strong>
              <p>{selectedSource ? "Processing may still be pending, or older evidence may have no source link. Choose All sources to review other available claims." : "Processed evidence will appear here for review. Full transcripts and storage paths stay private."}</p>
            </div>
          )}
          {status.readiness.blockers.length > 0 && (
            <ul className="model-blockers">
              {status.readiness.blockers.map((blocker) => <li key={blocker}><span />{BLOCKERS[blocker] ?? blocker.replaceAll("_", " ")}</li>)}
            </ul>
          )}
          <div className="person-model-action">
            <p>Build and approval use accepted claims across all sources, not just this view. Approval never grants conversation or voice permission.</p>
            {draft ? (
              <button className="button primary-button" type="button" disabled={actionBusy || !status.readiness.ready} onClick={() => void approve(draft.version)}>
                {building ? "Checking evidence…" : `Approve profile v${draft.version}`}
              </button>
            ) : (
              <button className="button primary-button" type="button" disabled={actionBusy || !status.readiness.ready} onClick={() => void build()}>
                {building ? "Building model…" : "Build review draft"}
              </button>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
