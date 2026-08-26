import { useCallback, useEffect, useMemo, useState } from "react";
import { decideReplicaEvidence, getArtifactAudition, getReplicaReview, queueVoiceGenome, selectVoiceArtifact } from "./processingApi";
import type { EvidenceDecision, ReplicaReview, ReviewEvidence } from "./types";

const REASONS: Record<EvidenceDecision, Array<[string, string]>> = {
  accepted: [["matches_subject", "Matches me"], ["clean_identity_signal", "Clean identity signal"], ["measurement_verified", "Measurement verified"], ["segment_verified", "Speaker segment verified"]],
  rejected: [["wrong_speaker", "Wrong speaker"], ["third_party_present", "Another person appears"], ["poor_quality", "Quality is too poor"], ["corrupt_or_incomplete", "Corrupt or incomplete"], ["synthetic_or_replayed", "Synthetic or replayed"], ["privacy_risk", "Privacy risk"]],
  superseded: [["better_variant_selected", "Better variant selected"], ["newer_measurement", "Newer measurement"], ["corrected_segmentation", "Segmentation corrected"], ["source_replaced", "Source replaced"]],
};

function words(value: string) { return value.replaceAll("_", " "); }
function when(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Recently" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
function summary(evidence: ReviewEvidence) {
  const entries = Object.entries(evidence.summary);
  if (!entries.length) return "Content withheld. Review only the timing, confidence, and provenance shown here.";
  return entries.map(([key, value]) => `${words(key)}: ${value}`).join(" · ");
}

function EvidenceRow({ evidence, busy, onDecide }: { evidence: ReviewEvidence; busy: boolean; onDecide: (decision: EvidenceDecision, reason: string) => void }) {
  const [decision, setDecision] = useState<EvidenceDecision>(evidence.decision || "accepted");
  const [reason, setReason] = useState(REASONS[evidence.decision || "accepted"][0][0]);
  return (
    <article className="review-evidence-row">
      <div className="review-evidence-main">
        <div className="review-evidence-title">
          <strong>{words(evidence.evidence_type)}</strong>
          <span className={`review-decision decision-${evidence.decision || "pending"}`}>{evidence.decision ? words(evidence.decision) : "needs review"}</span>
        </div>
        <p>{summary(evidence)}</p>
        <small>
          {evidence.confidence == null ? "Confidence not reported" : `${Math.round(evidence.confidence * 100)}% confidence`}
          {evidence.span_end_ms != null ? ` · ${(Number(evidence.span_end_ms) / 1000).toFixed(1)}s endpoint` : ""}
          {` · ${evidence.provenance.family || "unreported family"} / ${evidence.provenance.name || "unreported adapter"} ${evidence.provenance.version || ""}`}
        </small>
      </div>
      {evidence.reviewable ? <div className="review-controls" aria-label={`Review ${words(evidence.evidence_type)}`}>
        <label><span>Decision</span><select value={decision} disabled={busy} onChange={(event) => { const next = event.target.value as EvidenceDecision; setDecision(next); setReason(REASONS[next][0][0]); }}>
          <option value="accepted">Accept</option><option value="rejected">Reject</option><option value="superseded">Supersede</option>
        </select></label>
        <label><span>Reason</span><select value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)}>{REASONS[decision].map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <button className="review-save" type="button" disabled={busy} onClick={() => onDecide(decision, reason)}>{busy ? "Saving" : "Record review"}</button>
      </div> : <p className="review-withheld">A decision is unavailable here because the evidence content is intentionally withheld.</p>}
    </article>
  );
}

export default function ProcessingReview({ token, replicaId, sourceCount, onAuthError }: { token: string; replicaId: string; sourceCount: number; onAuthError: (cause: unknown) => void }) {
  const [review, setReview] = useState<ReplicaReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [audition, setAudition] = useState<{ artifactId: string; url: string; expiresAt: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setReview(await getReplicaReview(token, replicaId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Processing review is unavailable"); onAuthError(cause); }
    finally { setLoading(false); }
  }, [onAuthError, replicaId, token]);

  useEffect(() => { void load(); }, [load, sourceCount]);
  useEffect(() => {
    if (!audition) return;
    const remaining = Math.max(0, new Date(audition.expiresAt).getTime() - Date.now());
    const timer = window.setTimeout(() => setAudition((current) => current?.artifactId === audition.artifactId ? null : current), remaining);
    return () => window.clearTimeout(timer);
  }, [audition]);
  const bySource = useMemo(() => review?.sources.map((source) => ({
    source,
    jobs: review.jobs.filter((job) => job.source_id === source.source_id),
    artifacts: review.artifacts.filter((artifact) => artifact.source_id === source.source_id),
    evidence: review.evidence.filter((item) => item.source_id === source.source_id),
  })) || [], [review]);

  async function decide(evidence: ReviewEvidence, decision: EvidenceDecision, reasonCode: string) {
    setBusyId(evidence.evidence_id); setError(""); setNotice("");
    try {
      await decideReplicaEvidence(token, { replicaId, evidenceId: evidence.evidence_id, decision, reasonCode });
      setNotice("Review decision recorded as an append-only receipt.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Decision could not be recorded"); onAuthError(cause); }
    finally { setBusyId(""); }
  }

  async function queueBuild() {
    setBusyId("build"); setError(""); setNotice("");
    try { await queueVoiceGenome(token, replicaId); setNotice("Draft VoiceGenome build queued. It still requires human approval before use."); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Draft build could not be queued"); onAuthError(cause); }
    finally { setBusyId(""); }
  }

  async function auditionArtifact(artifactId: string) {
    setBusyId(`audition:${artifactId}`); setError(""); setNotice(""); setAudition(null);
    try {
      const value = await getArtifactAudition(token, { replicaId, artifactId });
      setAudition({ artifactId: value.artifact_id, url: value.url, expiresAt: value.expires_at });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Private audition could not be opened"); onAuthError(cause); }
    finally { setBusyId(""); }
  }

  async function selectArtifact(artifactId: string) {
    setBusyId(`select:${artifactId}`); setError(""); setNotice("");
    try {
      await selectVoiceArtifact(token, { replicaId, artifactId });
      setNotice("Voice candidate selected. Existing drafts were retired so the next VoiceGenome can bind this exact audio.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Voice candidate could not be selected"); onAuthError(cause); }
    finally { setBusyId(""); }
  }

  return (
    <section id="processing-review" className="processing-review" aria-labelledby="processing-review-title">
      <div className="panel-index">04</div>
      <div className="processing-review-content">
        <div className="panel-title-row">
          <div><p className="eyebrow">Owner review boundary</p><h2 id="processing-review-title">Inspect processing, then decide</h2></div>
          <button className="review-refresh" type="button" disabled={loading} onClick={() => void load()}>{loading ? "Refreshing" : "Refresh"}</button>
        </div>
        <p className="review-intro">Only review-safe measurements are shown. Raw transcripts, voice vectors, storage locations, provider references, and durable download links never enter this page. A private audition link is minted only after you press Listen and expires within 60 seconds.</p>
        {notice && <p className="review-notice" role="status">{notice}</p>}
        {error && <p className="inline-error" role="alert">{error}</p>}
        {loading && !review ? <div className="review-loading" role="status"><span className="spinner" />Loading private processing receipts</div> : null}
        {!loading && review && bySource.length === 0 ? <div className="review-empty"><strong>No processing receipts yet</strong><p>Add a source above. It will appear here only after the private processing pipeline begins.</p></div> : null}

        <div className="review-source-list">
          {bySource.map(({ source, jobs, artifacts, evidence }) => (
            <details className="review-source" key={source.source_id} open={evidence.some((item) => !item.decision)}>
              <summary>
                <span className="source-kind">{source.kind.slice(0, 2).toUpperCase()}</span>
                <span><strong>{words(source.kind)} source</strong><small>{jobs.length} pipeline step{jobs.length === 1 ? "" : "s"} · {artifacts.length} derived variant{artifacts.length === 1 ? "" : "s"} · {evidence.length} evidence record{evidence.length === 1 ? "" : "s"}</small></span>
                <span className={`source-state source-${source.state}`}><i />{words(source.state)}</span>
              </summary>
              <div className="review-source-body">
                <div className="pipeline-strip" aria-label="Pipeline steps">{jobs.length ? jobs.map((job) => {
                  const attempts = review?.attempts.filter((attempt) => attempt.job_id === job.job_id) || [];
                  return <div className={`pipeline-step pipeline-${job.state}`} key={job.job_id}><strong>{words(job.step)}</strong><span>{words(job.state)} · attempt {job.attempt}</span>{attempts[0] && <small>{attempts[0].provenance.family} / {attempts[0].provenance.name} {attempts[0].provenance.version}</small>}</div>;
                }) : <p className="muted-copy">No pipeline attempt has been recorded.</p>}</div>
                {artifacts.length > 0 && <div className="artifact-grid">{artifacts.map((artifact) => <div className={artifact.selection_decision === "selected" ? "artifact-selected" : ""} key={artifact.artifact_id}>
                  <div className="artifact-title"><strong>{words(artifact.variant_key)}</strong>{artifact.selection_decision === "selected" && <span>Selected voice</span>}</div>
                  <span>{words(artifact.stage)} · {artifact.transform.name} {artifact.transform.version}</span>
                  <small>{artifact.provenance.family} / {artifact.provenance.name} {artifact.provenance.version}</small>
                  <div className="artifact-actions">
                    <button type="button" disabled={busyId === `audition:${artifact.artifact_id}`} onClick={() => void auditionArtifact(artifact.artifact_id)}>{busyId === `audition:${artifact.artifact_id}` ? "Opening" : "Listen privately"}</button>
                    {artifact.stage === "enhance" && <button className="artifact-select" type="button" disabled={artifact.selection_decision === "selected" || busyId === `select:${artifact.artifact_id}`} onClick={() => void selectArtifact(artifact.artifact_id)}>{busyId === `select:${artifact.artifact_id}` ? "Selecting" : artifact.selection_decision === "selected" ? "Selected" : "Use this voice"}</button>}
                  </div>
                  {audition?.artifactId === artifact.artifact_id && <div className="artifact-player"><audio controls preload="metadata" src={audition.url}>Your browser cannot play this private audio.</audio><small>The signed link expires automatically in under one minute.</small></div>}
                </div>)}</div>}
                <div className="review-evidence-list">{evidence.length ? evidence.map((item) => <EvidenceRow key={item.evidence_id} evidence={item} busy={busyId === item.evidence_id} onDecide={(decision, reason) => void decide(item, decision, reason)} />) : <p className="muted-copy">No reviewable evidence has been emitted for this source.</p>}</div>
              </div>
            </details>
          ))}
        </div>

        {review && <article className="build-readiness">
          <div><p className="eyebrow">Draft only</p><h3>VoiceGenome build gate</h3><p>A queued build cannot be used for synthesis. A separate approval and held-out real-world evaluation are still required.</p></div>
          <div className="readiness-counts"><span><strong>{review.voice_genome_readiness.embedding_families}/2</strong> embedding families</span><span><strong>{review.voice_genome_readiness.voice_measurements}</strong> voice measurements</span><span><strong>{review.voice_genome_readiness.quality_measurements}</strong> quality measurements</span><span><strong>{review.voice_genome_readiness.speaker_segments}</strong> speaker segments</span></div>
          {review.voice_genome_readiness.blockers.length > 0 && <ul>{review.voice_genome_readiness.blockers.map((blocker) => <li key={blocker}>{words(blocker)}</li>)}</ul>}
          <button className="button primary-button" type="button" disabled={!review.voice_genome_readiness.ready || busyId === "build"} onClick={() => void queueBuild()}>{busyId === "build" ? "Queueing draft" : "Queue draft VoiceGenome"}</button>
          {review.builds.length > 0 && <div className="build-ledger"><strong>Build ledger</strong>{review.builds.map((build) => <span key={build.build_id}>v{build.target_version} · {words(build.state)} · {when(build.created_at)}</span>)}</div>}
          {review.voice_genomes.length > 0 && <div className="genome-draft-ledger">
            <strong>Immutable draft ledger</strong>
            {review.voice_genomes.map((genome) => <div key={genome.version}>
              <span>VoiceGenome v{genome.version} · {words(genome.status)}</span>
              <small>{genome.embedding_families} independent embeddings · {genome.target_segments} target segments · {genome.enrollment_artifacts} private enrollment artifacts</small>
              <code>{genome.manifest_hash.slice(0, 16)}…</code>
            </div>)}
            <p>Drafts cannot synthesize audio. Approval still requires owner calibration and a real held-out identity evaluation.</p>
          </div>}
        </article>}
      </div>
    </section>
  );
}
