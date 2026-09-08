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

function ClaimCard({ claim, busy, decide }: { claim: ReplicaClaim; busy: boolean; decide: (claim: ReplicaClaim, decision: "accepted" | "rejected" | "superseded", reason: string) => void }) {
  return (
    <article className={`person-claim decision-${claim.decision ?? "pending"}`}>
      <div className="claim-meta">
        <span>{claim.domain}</span><span>·</span><span>{claim.key.replaceAll("_", " ")}</span>
        <span className="claim-confidence">{confidence(claim.confidence)} confidence</span>
      </div>
      <p>{claim.body}</p>
      {claim.citation_previews.length > 0 && (
        <div className="claim-citations" aria-label="Exact evidence for this claim">
          {claim.citation_previews.map((citation, index) => (
            <p key={`${claim.claim_id}-${index}`}><strong>From your source:</strong> {citation.excerpt}</p>
          ))}
        </div>
      )}
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

type PersonModelProps = { token: string; replicaId: string; onAuthError: (cause: unknown) => void };

export default function PersonModelStudio(props: PersonModelProps) {
  return <ScopedPersonModelStudio key={`${props.replicaId}:${props.token}`} {...props} />;
}

function ScopedPersonModelStudio({ token, replicaId, onAuthError }: PersonModelProps) {
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
  }, [onAuthError, replicaId, token]);

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
        if (current?.replica_id !== replicaId) throw new Error("Extraction scope changed");
        setExtraction(current);
        setExtractionError("");
      } catch (cause) {
        if (!live || !mounted.current || revision !== extractionRevision.current) return;
        if (cause instanceof ReplicaApiError && cause.status === 401) {
          live = false;
          return onAuthError(cause);
        }
        setExtractionError("The latest durable extraction status could not be checked. Server work may still be continuing; this page will try again after it reconnects or reloads.");
      } finally {
        if (live) timer = window.setTimeout(() => void poll(), EXTRACTION_STATUS_POLL_MS);
      }
    };
    timer = window.setTimeout(() => void poll(), EXTRACTION_STATUS_POLL_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [extractionTiming.shouldPoll, online, onAuthError, replicaId, token]);

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
      setError(cause instanceof Error ? cause.message : "Claim review was not saved");
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
      setError(cause instanceof Error ? cause.message : "Person Model build was refused");
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
      setError(cause instanceof Error ? cause.message : "Profile changed and could not be approved");
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
      setExtractionError(cause instanceof Error ? cause.message : "Cited claims could not be extracted");
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
      if (current?.replica_id !== replicaId) throw new Error("The extraction status could not be confirmed. Retry.");
      setExtraction(current);
    } catch (cause) {
      if (!mounted.current || revision !== extractionRevision.current) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setExtractionError(cause instanceof Error ? cause.message : "The durable extraction status could not be checked");
    }
  }

  const actionBusy = building || extracting || !!busyClaim;

  return (
    <section id="person-model-studio" className="person-model" aria-labelledby="person-model-title">
      <div className="person-model-head">
        <div>
          <p className="eyebrow">What we learned about you</p>
          <h2 id="person-model-title">Everything we think we learned about you, one claim at a time</h2>
          <p>
            Confirm identity, language, behavior, values, boundaries, and autobiography as separate evidence-backed claims.
            Conflicts stay visible instead of being averaged into a confident fiction.
          </p>
        </div>
        <div className="model-version"><strong>{approved ? `v${approved.version}` : "\u2014"}</strong><span>approved version</span></div>
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
              <p className="eyebrow">Cited extraction</p>
              <h3 id="claim-extraction-title">Turn your reviewed recordings into claims you control</h3>
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
          {status.claims.length ? (
            <div className="person-claims">
              {status.claims.map((claim) => <ClaimCard key={claim.claim_id} claim={claim} busy={actionBusy} decide={(item, decision, reason) => void review(item, decision, reason)} />)}
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
