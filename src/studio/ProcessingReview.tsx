import { useCallback, useEffect, useMemo, useState } from "react";
import { disabledReason } from "./blockerClass";
import { decideReplicaEvidence, getArtifactAudition, getReplicaReview, queueVoiceGenome, selectVoiceArtifact } from "./processingApi";
import type { EvidenceDecision, ReplicaReview, ReviewEvidence } from "./types";
import { useStudioLocale } from "./localeContext";
import { withCount, type StudioCopy } from "./copy";

// The owner's directive said three times: no identity or liveness check for
// internal, self-only testing. REPLICA_SELF_TEST_MODE (default off) grants
// them automatically instead of blocking on them -- but the studio must never
// let the owner wonder later whether a clone was actually verified. This
// reuses blockerClass.ts's own vocabulary ("us"-class: ours, not the owner's
// job, never phrased as a task for them) rather than inventing a second one.
//
// WS-R61: `headline`/`next` here stay English -- see
// context/decisions.md#ws-r52-class-labels-split-from-blockerclass-ts-own-copy
// (its reversal condition names `disabledReason` calls exactly like this one).
// Only the two-word class badge is localized, read from `t.classLabels`
// instead of `SELF_TEST_NOTICE.classLabel` below, the same substitution
// BlockerNotice.tsx/WizardRail.tsx already make.
const SELF_TEST_NOTICE = disabledReason(
  "us",
  "Identity and liveness checks are turned off for your AI.",
  "REPLICA_SELF_TEST_MODE is on (self-only, internal testing). Nothing below was identity- or liveness-verified by a human.",
);

const DECISION_VALUES: EvidenceDecision[] = ["accepted", "rejected", "superseded"];

function words(value: string) { return value.replaceAll("_", " "); }

function EvidenceRow({ evidence, busy, onDecide, c }: { evidence: ReviewEvidence; busy: boolean; onDecide: (decision: EvidenceDecision, reason: string) => void; c: StudioCopy["processingReview"] }) {
  const [decision, setDecision] = useState<EvidenceDecision>(evidence.decision || "accepted");
  const reasonKeys = Object.keys(c.reasonLabel[evidence.decision || "accepted"]);
  const [reason, setReason] = useState(reasonKeys[0]);
  const decisionReasonKeys = Object.keys(c.reasonLabel[decision]);
  function summary() {
    const entries = Object.entries(evidence.summary);
    if (!entries.length) return c.contentWithheld;
    return entries.map(([key, value]) => `${words(key)}: ${value}`).join(" · ");
  }
  return (
    <article className="review-evidence-row">
      <div className="review-evidence-main">
        <div className="review-evidence-title">
          <strong>{words(evidence.evidence_type)}</strong>
          <span className={`review-decision decision-${evidence.decision || "pending"}`}>{evidence.decision ? words(evidence.decision) : c.needsReview}</span>
        </div>
        <p>{summary()}</p>
        <small>
          {evidence.confidence == null ? c.confidenceNotReported : withCount(c.confidencePct, Math.round(evidence.confidence * 100))}
          {evidence.span_end_ms != null ? ` · ${c.endpointSuffix.split("{n}").join((Number(evidence.span_end_ms) / 1000).toFixed(1))}` : ""}
          {` · ${evidence.provenance.family || c.unreportedFamily} / ${evidence.provenance.name || c.unreportedAdapter} ${evidence.provenance.version || ""}`}
        </small>
      </div>
      {evidence.reviewable ? <div className="review-controls" aria-label={withLabel(c.reviewAriaLabel, words(evidence.evidence_type))}>
        <label><span>{c.decisionSelectLabel}</span><select value={decision} disabled={busy} onChange={(event) => { const next = event.target.value as EvidenceDecision; setDecision(next); setReason(Object.keys(c.reasonLabel[next])[0]); }}>
          {DECISION_VALUES.map((value) => <option value={value} key={value}>{value === "accepted" ? c.optionAccept : value === "rejected" ? c.optionReject : c.optionSupersede}</option>)}
        </select></label>
        <label><span>{c.reasonSelectLabel}</span><select value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)}>{decisionReasonKeys.map((value) => <option value={value} key={value}>{(c.reasonLabel[decision] as Record<string, string>)[value]}</option>)}</select></label>
        <button className="review-save" type="button" disabled={busy} onClick={() => onDecide(decision, reason)}>{busy ? c.saving : c.recordReview}</button>
      </div> : <p className="review-withheld">{c.decisionWithheldNote}</p>}
    </article>
  );
}

function withLabel(template: string, label: string) {
  return template.split("{label}").join(label);
}

export default function ProcessingReview({ token, replicaId, sourceCount, onAuthError }: { token: string; replicaId: string; sourceCount: number; onAuthError: (cause: unknown) => void }) {
  const { t } = useStudioLocale();
  const c = t.processingReview;
  const [review, setReview] = useState<ReplicaReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [audition, setAudition] = useState<{ artifactId: string; url: string; expiresAt: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setReview(await getReplicaReview(token, replicaId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : c.errorProcessingUnavailable); onAuthError(cause); }
    finally { setLoading(false); }
  }, [onAuthError, replicaId, token, c.errorProcessingUnavailable]);

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

  function when(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? c.recently : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
  }

  async function decide(evidence: ReviewEvidence, decision: EvidenceDecision, reasonCode: string) {
    setBusyId(evidence.evidence_id); setError(""); setNotice("");
    try {
      await decideReplicaEvidence(token, { replicaId, evidenceId: evidence.evidence_id, decision, reasonCode });
      setNotice(c.noticeReviewRecorded);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : c.errorDecisionNotRecorded); onAuthError(cause); }
    finally { setBusyId(""); }
  }

  async function queueBuild() {
    setBusyId("build"); setError(""); setNotice("");
    try { await queueVoiceGenome(token, replicaId); setNotice(c.noticeDraftQueued); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : c.errorDraftNotQueued); onAuthError(cause); }
    finally { setBusyId(""); }
  }

  async function auditionArtifact(artifactId: string) {
    setBusyId(`audition:${artifactId}`); setError(""); setNotice(""); setAudition(null);
    try {
      const value = await getArtifactAudition(token, { replicaId, artifactId });
      setAudition({ artifactId: value.artifact_id, url: value.url, expiresAt: value.expires_at });
    } catch (cause) { setError(cause instanceof Error ? cause.message : c.errorAuditionNotOpened); onAuthError(cause); }
    finally { setBusyId(""); }
  }

  async function selectArtifact(artifactId: string) {
    setBusyId(`select:${artifactId}`); setError(""); setNotice("");
    try {
      await selectVoiceArtifact(token, { replicaId, artifactId });
      setNotice(c.noticeCandidateSelected);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : c.errorCandidateNotSelected); onAuthError(cause); }
    finally { setBusyId(""); }
  }

  return (
    <section id="processing-review" className="processing-review" aria-labelledby="processing-review-title">
      <div className="processing-review-content">
        <div className="panel-title-row">
          <div><p className="eyebrow">{c.eyebrow}</p><h2 id="processing-review-title">{c.title}</h2></div>
          <button className="review-refresh" type="button" disabled={loading} onClick={() => void load()}>{loading ? c.refreshing : c.refresh}</button>
        </div>
        <p className="review-intro">{c.intro}</p>
        {notice && <p className="review-notice" role="status">{notice}</p>}
        {error && <p className="inline-error" role="alert">{error}</p>}
        {loading && !review ? <div className="review-loading" role="status"><span className="spinner" />{c.loadingReceipts}</div> : null}
        {!loading && review && bySource.length === 0 ? <div className="review-empty"><strong>{c.emptyHeadline}</strong><p>{c.emptyNote}</p></div> : null}

        <div className="review-source-list">
          {bySource.map(({ source, jobs, artifacts, evidence }) => (
            <details className="review-source" key={source.source_id} open={evidence.some((item) => !item.decision)}>
              <summary>
                <span className="source-kind">{source.kind.slice(0, 2).toUpperCase()}</span>
                <span>
                  <strong>{withLabel(c.sourceTitle, words(source.kind))}</strong>
                  <small>
                    {withCount(jobs.length === 1 ? c.pipelineStepOne : c.pipelineStepMany, jobs.length)}
                    {" · "}
                    {withCount(artifacts.length === 1 ? c.derivedVariantOne : c.derivedVariantMany, artifacts.length)}
                    {" · "}
                    {withCount(evidence.length === 1 ? c.evidenceRecordOne : c.evidenceRecordMany, evidence.length)}
                  </small>
                </span>
                <span className={`source-state source-${source.state}`}><i />{words(source.state)}</span>
              </summary>
              <div className="review-source-body">
                <div className="pipeline-strip" aria-label={c.pipelineStepsAriaLabel}>{jobs.length ? jobs.map((job) => {
                  const attempts = review?.attempts.filter((attempt) => attempt.job_id === job.job_id) || [];
                  return <div className={`pipeline-step pipeline-${job.state}`} key={job.job_id}><strong>{words(job.step)}</strong><span>{words(job.state)} · {withCount(c.attemptLabel, job.attempt)}</span>{attempts[0] && <small>{attempts[0].provenance.family} / {attempts[0].provenance.name} {attempts[0].provenance.version}</small>}</div>;
                }) : <p className="muted-copy">{c.noPipelineAttempt}</p>}</div>
                {artifacts.length > 0 && <div className="artifact-grid">{artifacts.map((artifact) => <div className={artifact.selection_decision === "selected" ? "artifact-selected" : ""} key={artifact.artifact_id}>
                  <div className="artifact-title"><strong>{words(artifact.variant_key)}</strong>{artifact.selection_decision === "selected" && <span>{c.selectedVoiceBadge}</span>}</div>
                  <span>{words(artifact.stage)} · {artifact.transform.name} {artifact.transform.version}</span>
                  <small>{artifact.provenance.family} / {artifact.provenance.name} {artifact.provenance.version}</small>
                  <div className="artifact-actions">
                    <button type="button" disabled={busyId === `audition:${artifact.artifact_id}`} onClick={() => void auditionArtifact(artifact.artifact_id)}>{busyId === `audition:${artifact.artifact_id}` ? c.opening : c.listenPrivately}</button>
                    {artifact.stage === "enhance" && <button className="artifact-select" type="button" disabled={artifact.selection_decision === "selected" || busyId === `select:${artifact.artifact_id}`} onClick={() => void selectArtifact(artifact.artifact_id)}>{busyId === `select:${artifact.artifact_id}` ? c.selecting : artifact.selection_decision === "selected" ? c.selected : c.useThisVoice}</button>}
                  </div>
                  {audition?.artifactId === artifact.artifact_id && <div className="artifact-player"><audio controls preload="metadata" src={audition.url}>{c.cannotPlayAudio}</audio><small>{c.linkExpiresNote}</small></div>}
                </div>)}</div>}
                <div className="review-evidence-list">{evidence.length ? evidence.map((item) => <EvidenceRow key={item.evidence_id} evidence={item} busy={busyId === item.evidence_id} onDecide={(decision, reason) => void decide(item, decision, reason)} c={c} />) : <p className="muted-copy">{c.noReviewableEvidence}</p>}</div>
              </div>
            </details>
          ))}
        </div>

        {review?.self_test_mode && <div className="self-test-banner" role="status">
          <span className={`self-test-badge blocker-${SELF_TEST_NOTICE.kind}`}>{t.classLabels[SELF_TEST_NOTICE.kind]}</span>
          <strong>{SELF_TEST_NOTICE.headline}</strong>
          <p>{SELF_TEST_NOTICE.next}</p>
        </div>}

        {review && <article className="build-readiness">
          <div><p className="eyebrow">{c.draftOnlyEyebrow}</p><h3>{c.voiceBuildGateTitle}</h3><p>{c.voiceBuildGateIntro}</p></div>
          <div className="readiness-counts"><span><strong>{review.voice_genome_readiness.embedding_families}/2</strong> {c.acousticFamilies}</span><span><strong>{review.voice_genome_readiness.voice_measurements}</strong> {c.voiceMeasurements}</span><span><strong>{review.voice_genome_readiness.quality_measurements}</strong> {c.qualityMeasurements}</span><span><strong>{review.voice_genome_readiness.speaker_segments}</strong> {c.speakerSegments}</span></div>
          {review.voice_genome_readiness.blockers.length > 0 && <ul>{review.voice_genome_readiness.blockers.map((blocker) => <li key={blocker}>{words(blocker)}</li>)}</ul>}
          <button className="button primary-button" type="button" disabled={!review.voice_genome_readiness.ready || busyId === "build"} onClick={() => void queueBuild()}>{busyId === "build" ? c.queueingDraft : c.queueDraftVoice}</button>
          {review.builds.length > 0 && <div className="build-ledger"><strong>{c.buildLedger}</strong>{review.builds.map((build) => <span key={build.build_id}>v{build.target_version} · {words(build.state)} · {when(build.created_at)}</span>)}</div>}
          {review.voice_genomes.length > 0 && <div className="genome-draft-ledger">
            <strong>{c.immutableDraftLedger}</strong>
            {review.voice_genomes.map((genome) => <div key={genome.version}>
              <span>{c.voiceVersionStatus.split("{n}").join(String(genome.version)).split("{label}").join(words(genome.status))}</span>
              <small>
                {c.voicePrintFamiliesDetail.split("{n}").join(String(genome.embedding_families))}
                {" · "}
                {c.targetSegmentsDetail.split("{n}").join(String(genome.target_segments))}
                {" · "}
                {c.enrollmentArtifactsDetail.split("{n}").join(String(genome.enrollment_artifacts))}
              </small>
              <code>{genome.manifest_hash.slice(0, 16)}…</code>
            </div>)}
            <p>{c.draftsCannotSynthesize}</p>
          </div>}
        </article>}
      </div>
    </section>
  );
}
