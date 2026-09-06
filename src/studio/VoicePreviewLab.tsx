import { useCallback, useEffect, useMemo, useState } from "react";
import { getReplicaReview } from "./processingApi";
import { ReplicaApiError } from "./replicaApi";
import type { ReplicaReview } from "./types";
import {
  buildVoiceDeliveryPolicy,
  finalizeVoiceDeliveryHoldout,
  generateVoicePreview,
  getVoiceDeliveryStatus,
  issueVoiceTrial,
  issueVoiceDeliveryHoldout,
  saveVoicePreference,
  type VoiceDeliveryStatus,
  type VoicePreferenceChoice,
  type VoicePreferenceReason,
} from "./voicePreviewApi";
import { useStudioLocale } from "./localeContext";
import type { StudioCopy } from "./copy";

type StyleKey = "faithful" | "balanced" | "expressive";
type Preview = { url: string; generationId: string; modelCommitment: string; styleKey?: StyleKey };
type VPC = StudioCopy["voicePreviewLab"];

function styleList(c: VPC): ReadonlyArray<{ key: StyleKey; label: string; copy: string }> {
  return [
    { key: "faithful", label: c.styleFaithfulLabel, copy: c.styleFaithfulCopy },
    { key: "balanced", label: c.styleBalancedLabel, copy: c.styleBalancedCopy },
    { key: "expressive", label: c.styleExpressiveLabel, copy: c.styleExpressiveCopy },
  ];
}

/** `condition`/`champion_key` server codes -> plain-Hindi delivery-style
 *  words a coach would understand, not a technical term-for-term gloss --
 *  see `context/decisions.md#ws-r71-voice-lab-vocabulary`. */
function conditionLabel(key: string, c: VPC): string {
  const table: Record<string, string> = {
    identity_anchor: c.conditionIdentityAnchor,
    faithful: c.conditionFaithful,
    steady_warm: c.conditionSteadyWarm,
    balanced: c.conditionBalanced,
    warm_expressive: c.conditionWarmExpressive,
    expressive: c.conditionExpressive,
    animated: c.conditionAnimated,
  };
  return table[key] || key;
}

function preferenceReasonList(c: VPC): ReadonlyArray<{ value: VoicePreferenceReason; label: string }> {
  return [
    { value: "identity", label: c.reasonIdentity },
    { value: "accent", label: c.reasonAccent },
    { value: "rhythm", label: c.reasonRhythm },
    { value: "emotion", label: c.reasonEmotion },
    { value: "naturalness", label: c.reasonNaturalness },
    { value: "pronunciation", label: c.reasonPronunciation },
    { value: "noise_or_artifact", label: c.reasonFewerArtifacts },
  ];
}

const STARTERS = {
  en: "I know this voice is only a first draft. Listen for my rhythm, pauses, accent, and the way I hold the last word.",
  hi: "Mujhe pata hai yeh awaaz abhi pehla draft hai. Meri rhythm, pauses, accent aur aakhri lafz bolne ka tareeka dhyan se suno.",
} as const;

export default function VoicePreviewLab({ token, replicaId, onAuthError }: {
  token: string;
  replicaId: string;
  onAuthError: (cause: unknown) => void;
}) {
  const { t } = useStudioLocale();
  const c = t.voicePreviewLab;
  const [review, setReview] = useState<ReplicaReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [language, setLanguage] = useState<"en" | "hi">("en");
  const [styleKey, setStyleKey] = useState<StyleKey>("balanced");
  const [text, setText] = useState<string>(STARTERS.en);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pair, setPair] = useState<{ trialId: string; prompt: { domain: string; text: string }; progress: { completed: number; covered: number; total: number; prompts: number; requiredPrompts: number; converged: boolean }; left: Preview; right: Preview } | null>(null);
  const [pairBusy, setPairBusy] = useState(false);
  const [heard, setHeard] = useState({ left: false, right: false });
  const [preferenceReasons, setPreferenceReasons] = useState<VoicePreferenceReason[]>([]);
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const [preferenceSaved, setPreferenceSaved] = useState<{ id: string; choice: VoicePreferenceChoice; leftStyle: string; rightStyle: string } | null>(null);
  const [pairError, setPairError] = useState("");
  const [delivery, setDelivery] = useState<VoiceDeliveryStatus | null>(null);
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [holdoutPair, setHoldoutPair] = useState<{ policyId: string; trialId: string; prompt: { domain: string; text: string }; left: Preview; right: Preview } | null>(null);
  const [holdoutBusy, setHoldoutBusy] = useState(false);
  const [holdoutHeard, setHoldoutHeard] = useState({ left: false, right: false });
  const [holdoutSaved, setHoldoutSaved] = useState(false);

  const draft = useMemo(() => review?.voice_genomes.find((item) => item.status === "draft") ?? null, [review]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setReview(await getReplicaReview(token, replicaId)); }
    catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
      setError(cause instanceof Error ? cause.message : c.errorStatusUnavailable);
    } finally { setLoading(false); }
  }, [onAuthError, replicaId, token]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => () => {
    if (pair) { URL.revokeObjectURL(pair.left.url); URL.revokeObjectURL(pair.right.url); }
  }, [pair]);
  useEffect(() => () => {
    if (holdoutPair) { URL.revokeObjectURL(holdoutPair.left.url); URL.revokeObjectURL(holdoutPair.right.url); }
  }, [holdoutPair]);

  const loadDelivery = useCallback(async () => {
    if (!draft) { setDelivery(null); return; }
    try {
      setDelivery(await getVoiceDeliveryStatus(token, { replicaId, genomeVersion: draft.version, languageId: language }));
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
      setDelivery(null);
    }
  }, [draft, language, onAuthError, replicaId, token]);

  useEffect(() => { void loadDelivery(); }, [loadDelivery]);

  function discardPair() {
    setPair(null); setPairError(""); setPreferenceSaved(null); setPreferenceReasons([]); setHeard({ left: false, right: false });
  }

  function changeLanguage(next: "en" | "hi") {
    setLanguage(next);
    if (text === STARTERS.en || text === STARTERS.hi) setText(STARTERS[next]);
    discardPair();
  }

  async function generate() {
    if (!draft) return;
    setGenerating(true); setError("");
    setPreview(null);
    try {
      const result = await generateVoicePreview(token, { replicaId, genomeVersion: draft.version, text, languageId: language, styleKey });
      setPreview({ url: URL.createObjectURL(result.audio), generationId: result.generationId, modelCommitment: result.modelCommitment, styleKey });
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
      setError(cause instanceof Error ? cause.message : c.errorPreviewNotGenerated);
    } finally { setGenerating(false); }
  }

  async function generateBlindPair() {
    if (!draft || pairBusy) return;
    setPairBusy(true); setPairError(""); setPreferenceSaved(null); setPreferenceReasons([]); setHeard({ left: false, right: false }); setPair(null);
    let left: Preview | null = null;
    try {
      const trial = await issueVoiceTrial(token, { replicaId, genomeVersion: draft.version, languageId: language });
      const leftResult = await generateVoicePreview(token, { replicaId, genomeVersion: draft.version, text: trial.prompt.text, languageId: language, trialId: trial.trial_id, trialSide: "left" });
      left = { url: URL.createObjectURL(leftResult.audio), generationId: leftResult.generationId, modelCommitment: leftResult.modelCommitment };
      const rightResult = await generateVoicePreview(token, { replicaId, genomeVersion: draft.version, text: trial.prompt.text, languageId: language, trialId: trial.trial_id, trialSide: "right" });
      setPair({
        trialId: trial.trial_id,
        prompt: { domain: trial.prompt.domain, text: trial.prompt.text },
        progress: { completed: trial.progress.completed, covered: trial.progress.covered_conditions, total: trial.progress.total_conditions, prompts: trial.progress.unique_prompts, requiredPrompts: trial.progress.required_prompts, converged: trial.progress.converged },
        left,
        right: { url: URL.createObjectURL(rightResult.audio), generationId: rightResult.generationId, modelCommitment: rightResult.modelCommitment },
      });
    } catch (cause) {
      if (left) URL.revokeObjectURL(left.url);
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
      setPairError(cause instanceof Error ? cause.message : c.errorComparisonNotGenerated);
    } finally { setPairBusy(false); }
  }

  function togglePreferenceReason(reason: VoicePreferenceReason) {
    setPreferenceReasons((current) => current.includes(reason) ? current.filter((item) => item !== reason) : [...current, reason]);
  }

  async function savePreference(choice: VoicePreferenceChoice) {
    if (!pair || preferenceBusy || !heard.left || !heard.right) return;
    setPreferenceBusy(true); setPairError("");
    try {
      const saved = await saveVoicePreference(token, {
        replicaId,
        leftGenerationId: pair.left.generationId,
        rightGenerationId: pair.right.generationId,
        trialId: pair.trialId,
        choice,
        reasonCodes: preferenceReasons,
      });
      setPreferenceSaved({ id: saved.preference_id, choice: saved.choice, leftStyle: saved.left_style_key, rightStyle: saved.right_style_key });
      await loadDelivery();
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
      setPairError(cause instanceof Error ? cause.message : c.errorPreferenceNotSecured);
    } finally { setPreferenceBusy(false); }
  }

  async function freezeDeliveryPolicy() {
    if (!draft || !delivery?.readiness.ready || deliveryBusy) return;
    setDeliveryBusy(true); setPairError("");
    try {
      await buildVoiceDeliveryPolicy(token, { replicaId, genomeVersion: draft.version, languageId: language });
      await loadDelivery();
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
      setPairError(cause instanceof Error ? cause.message : c.errorDeliveryNotFrozen);
    } finally { setDeliveryBusy(false); }
  }

  async function generateHoldoutPair() {
    const policy = delivery?.policies[0];
    if (!draft || !policy || holdoutBusy || policy.holdout.completed >= policy.holdout.required) return;
    setHoldoutBusy(true); setPairError(""); setHoldoutSaved(false); setHoldoutHeard({ left: false, right: false }); setHoldoutPair(null);
    let left: Preview | null = null;
    try {
      const trial = await issueVoiceDeliveryHoldout(token, { replicaId, genomeVersion: draft.version, languageId: language, policyId: policy.policy_id });
      const leftResult = await generateVoicePreview(token, { replicaId, genomeVersion: draft.version, text: trial.prompt.text, languageId: language, trialId: trial.trial_id, trialSide: "left" });
      left = { url: URL.createObjectURL(leftResult.audio), generationId: leftResult.generationId, modelCommitment: leftResult.modelCommitment };
      const rightResult = await generateVoicePreview(token, { replicaId, genomeVersion: draft.version, text: trial.prompt.text, languageId: language, trialId: trial.trial_id, trialSide: "right" });
      setHoldoutPair({ policyId: policy.policy_id, trialId: trial.trial_id, prompt: { domain: trial.prompt.domain, text: trial.prompt.text }, left,
        right: { url: URL.createObjectURL(rightResult.audio), generationId: rightResult.generationId, modelCommitment: rightResult.modelCommitment } });
    } catch (cause) {
      if (left) URL.revokeObjectURL(left.url);
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
      setPairError(cause instanceof Error ? cause.message : c.errorHeldOutNotGenerated);
    } finally { setHoldoutBusy(false); }
  }

  async function saveHoldoutPreference(choice: VoicePreferenceChoice) {
    if (!holdoutPair || holdoutBusy || !holdoutHeard.left || !holdoutHeard.right) return;
    setHoldoutBusy(true); setPairError("");
    try {
      await saveVoicePreference(token, { replicaId, leftGenerationId: holdoutPair.left.generationId,
        rightGenerationId: holdoutPair.right.generationId, trialId: holdoutPair.trialId, choice, reasonCodes: [] });
      setHoldoutSaved(true);
      await loadDelivery();
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
      setPairError(cause instanceof Error ? cause.message : c.errorHeldOutJudgmentNotSecured);
    } finally { setHoldoutBusy(false); }
  }

  async function finalizeHoldout() {
    const policy = delivery?.policies[0];
    if (!draft || !policy || holdoutBusy || policy.holdout.completed !== policy.holdout.required) return;
    setHoldoutBusy(true); setPairError("");
    try {
      await finalizeVoiceDeliveryHoldout(token, { replicaId, genomeVersion: draft.version, languageId: language, policyId: policy.policy_id });
      await loadDelivery();
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
      setPairError(cause instanceof Error ? cause.message : c.errorHeldOutResultNotFinalized);
    } finally { setHoldoutBusy(false); }
  }

  return (
    <section className="voice-preview-lab" aria-labelledby="voice-preview-title">
      <div className="voice-preview-heading">
        <div>
          <h2 id="voice-preview-title">{c.title}</h2>
          <p>{c.intro}</p>
        </div>
        <button className="review-refresh" type="button" disabled={loading || generating || pairBusy} onClick={() => void load()}>{loading ? c.checking : c.refreshDraft}</button>
      </div>

      <div className="voice-preview-workbench">
        <div className="voice-preview-compose">
          <div className="voice-preview-version">
            <span>{draft ? c.draftVersionLabel.split("{n}").join(String(draft.version)) : c.draftRequired}</span>
            <small>{draft ? c.identityModelsBound.split("{n}").join(String(draft.embedding_families)) : c.reviewFirst}</small>
          </div>
          <fieldset className="voice-preview-language">
            <legend>{c.languageLegend}</legend>
            <button type="button" className={language === "en" ? "active" : ""} aria-pressed={language === "en"} onClick={() => changeLanguage("en")}>{c.languageEnglish}</button>
            <button type="button" className={language === "hi" ? "active" : ""} aria-pressed={language === "hi"} onClick={() => changeLanguage("hi")}>{c.languageHindi}</button>
          </fieldset>
          <label className="voice-preview-script" htmlFor="voice-preview-text">
            <span>{c.whatShouldDraftSay}</span>
            <textarea id="voice-preview-text" value={text} maxLength={600} rows={5} onChange={(event) => { setText(event.target.value); discardPair(); }} />
            <small>{c.charactersLeft.split("{n}").join(String(Array.from(text).length))}</small>
          </label>
          <fieldset className="voice-preview-styles">
            <legend>{c.deliveryLegend}</legend>
            {styleList(c).map((style) => (
              <button type="button" key={style.key} className={styleKey === style.key ? "active" : ""} aria-pressed={styleKey === style.key} onClick={() => setStyleKey(style.key)}>
                <strong>{style.label}</strong><span>{style.copy}</span>
              </button>
            ))}
          </fieldset>
          <button className="button primary-button voice-preview-generate" type="button" disabled={!draft || generating || pairBusy || !text.trim()} onClick={() => void generate()}>{generating ? c.protectingPreview : c.generatePreview}</button>
          {generating && <p className="voice-preview-wait" role="status">{c.coldStartNotice}</p>}
          {error && <p className="inline-error" role="alert">{error}</p>}
        </div>

        <div className={`voice-preview-listen ${preview ? "has-audio" : ""}`} aria-live="polite">
          {preview ? (
            <>
              <div className="voice-preview-orbit" aria-hidden="true"><span /><span /><span /></div>
              <h3>{c.yourProtectedDraft}</h3>
              <p>{c.listenOnceNote}</p>
              <audio controls autoPlay preload="metadata" src={preview.url}>{c.audioFallback}</audio>
              <dl>
                <div><dt>{c.disclosureRowLabel}</dt><dd>{c.disclosureRowValue}</dd></div><div><dt>{c.watermarksRowLabel}</dt><dd>PerTh + AudioSeal</dd></div><div><dt>{c.provenanceRowLabel}</dt><dd>{c.provenanceRowValue}</dd></div>
              </dl>
              <small>{c.receiptLine.split("{n}").join(preview.generationId.slice(0, 8)).split("{n2}").join(preview.modelCommitment.slice(0, 10))}</small>
            </>
          ) : (
            <>
              <div className="voice-preview-empty-mark" aria-hidden="true">V</div>
              <h3>{draft ? c.roomReady : c.noDraftYet}</h3>
              <p>{draft ? c.chooseWordsNote : c.needRecordingNote}</p>
              <div className="voice-preview-proof"><span>{c.proofOwnerOnly}</span><span>{c.proofSelfOnly}</span><span>{c.proofNoRuntimeAccess}</span></div>
            </>
          )}
        </div>
      </div>

      <div className="voice-preference-lab">
        <div className="voice-preference-intro">
          <div><span>{c.preferenceLabTag}</span><h3>{c.preferenceLabHeading}</h3></div>
          <p>{c.preferenceLabIntro}</p>
          <button className="review-refresh" type="button" disabled={!draft || pairBusy || generating} onClick={() => void generateBlindPair()}>{pairBusy ? c.renderingAB : pair ? c.newBlindPair : c.startBlindAB}</button>
        </div>
        {pair ? (
          <div className="voice-preference-body">
            <div className="voice-preference-progress">
              <span>{c.adaptiveComparisonLabel.split("{n}").join(String(pair.progress.completed + 1))}</span>
              <span>{c.conditionsCoveredLabel.split("{n}").join(String(pair.progress.covered)).split("{n2}").join(String(pair.progress.total))}</span>
              <span>{c.promptFamiliesLabel.split("{n}").join(String(pair.progress.prompts)).split("{n2}").join(String(pair.progress.requiredPrompts))}</span>
              <span>{pair.progress.converged ? c.boundaryConverged : c.stillLearning}</span>
            </div>
            <div className="voice-preference-prompt"><span>{pair.prompt.domain.replaceAll("_", " ")} {c.challengeSuffix}</span><p>{pair.prompt.text}</p></div>
            <div className="voice-preference-players">
              {(["left", "right"] as const).map((side, index) => (
                <article key={side} className={heard[side] ? "heard" : ""}>
                  <span>{index === 0 ? c.candidateLetterA : c.candidateLetterB}</span>
                  <div><strong>{c.protectedCandidateLabel} {index === 0 ? c.candidateLetterA : c.candidateLetterB}</strong><small>{heard[side] ? c.completedLabel : c.listenFullyNote}</small></div>
                  <audio controls preload="metadata" src={pair[side].url} onEnded={() => setHeard((current) => ({ ...current, [side]: true }))}>{c.audioCandidateFallback}</audio>
                </article>
              ))}
            </div>
            {preferenceSaved ? (
              <div className="voice-preference-saved" role="status">
                <strong>{c.preferenceSecured}</strong>
                <span>
                  {preferenceSaved.choice === "neither" ? c.choiceNeither : preferenceSaved.choice === "tie" ? c.choiceTie : c.choiceCloser.split("{label}").join(preferenceSaved.choice === "left" ? c.candidateLetterA : c.candidateLetterB)}{" "}
                  {c.conditionSummary
                    .split("{label}").join((conditionLabel(preferenceSaved.leftStyle, c) || c.fallbackConditionA))
                    .split("{label2}").join((conditionLabel(preferenceSaved.rightStyle, c) || c.fallbackConditionB))}
                </span>
                <small>{c.evidenceLine.split("{n}").join(preferenceSaved.id.slice(0, 8))}</small>
              </div>
            ) : (
              <>
                <div className="voice-preference-reasons">
                  <span>{c.whatSeparatedThem} <small>{c.optionalLabel}</small></span>
                  <div>{preferenceReasonList(c).map((reason) => <button type="button" key={reason.value} className={preferenceReasons.includes(reason.value) ? "active" : ""} aria-pressed={preferenceReasons.includes(reason.value)} onClick={() => togglePreferenceReason(reason.value)}>{reason.label}</button>)}</div>
                </div>
                <div className="voice-preference-choice" aria-label={c.chooseCloserAriaLabel}>
                  <button type="button" disabled={!heard.left || !heard.right || preferenceBusy} onClick={() => void savePreference("left")}>{c.aIsCloser}</button>
                  <button type="button" disabled={!heard.left || !heard.right || preferenceBusy} onClick={() => void savePreference("right")}>{c.bIsCloser}</button>
                  <button type="button" disabled={!heard.left || !heard.right || preferenceBusy} onClick={() => void savePreference("tie")}>{c.both}</button>
                  <button type="button" disabled={!heard.left || !heard.right || preferenceBusy} onClick={() => void savePreference("neither")}>{c.neither}</button>
                </div>
                {!heard.left || !heard.right ? <p className="voice-preference-gate">{c.finishBothToUnlock}</p> : null}
              </>
            )}
          </div>
        ) : <div className="voice-preference-empty">{pairBusy ? c.buildingTwoTakes : c.noComparisonOpen}</div>}
        {pairError ? <p className="inline-error" role="alert">{pairError}</p> : null}
        {delivery ? (
          <div className="voice-delivery-freeze">
            <div>
              <span>{c.voiceDeliveryTag}</span>
              <h4>{delivery.policies[0] ? c.versionFrozen.split("{n}").join(String(delivery.policies[0].version)) : c.buildDeliveryCandidate}</h4>
              <p>
                {delivery.policies[0]
                  ? c.championBoundNote
                    .split("{label}").join(conditionLabel(delivery.policies[0].champion_key, c) || c.fallbackLearnedDelivery)
                    .split("{n}").join(String(delivery.policies[0].comparisons))
                  : c.candidateCreatedNote}
              </p>
            </div>
            <div className="voice-delivery-readiness">
              <span>{c.comparisonsLabel.split("{n}").join(String(delivery.readiness.completed))}</span>
              <span>{c.conditionsFractionLabel.split("{n}").join(String(delivery.readiness.covered_conditions)).split("{n2}").join(String(delivery.readiness.total_conditions))}</span>
              <span>{c.promptsFractionLabel.split("{n}").join(String(delivery.readiness.unique_prompts)).split("{n2}").join(String(delivery.readiness.required_prompts))}</span>
            </div>
            <button className="button primary-button" type="button" disabled={!delivery.readiness.ready || deliveryBusy} onClick={() => void freezeDeliveryPolicy()}>{deliveryBusy ? c.freezingEvidence : delivery.policies[0] ? c.freezeUpdatedVersion : c.freezeDeliveryCandidate}</button>
            {!delivery.readiness.ready ? <small>{c.moreEvidenceRequired}</small> : <small>{c.freezingDoesNotActivate}</small>}
          </div>
        ) : null}
        {delivery?.policies[0] ? (
          <div className="voice-holdout-lab">
            <div className="voice-holdout-heading">
              <div><span>{c.unseenSpeechTag}</span><h4>{c.unseenSpeechHeading}</h4><p>{c.unseenSpeechIntro}</p></div>
              <div><strong>{delivery.policies[0].holdout.completed}/{delivery.policies[0].holdout.required}</strong><small>{c.heldOutJudgmentsLabel}</small></div>
            </div>
            {holdoutPair ? <>
              <div className="voice-preference-prompt"><span>{holdoutPair.prompt.domain.replaceAll("_", " ")} {c.holdoutChallengeSuffix}</span><p>{holdoutPair.prompt.text}</p></div>
              <div className="voice-preference-players">
                {(["left", "right"] as const).map((side, index) => <article key={side} className={holdoutHeard[side] ? "heard" : ""}>
                  <span>{index === 0 ? c.candidateLetterA : c.candidateLetterB}</span><div><strong>{c.heldOutCandidateLabel} {index === 0 ? c.candidateLetterA : c.candidateLetterB}</strong><small>{holdoutHeard[side] ? c.completedLabel : c.listenFully}</small></div>
                  <audio controls preload="metadata" src={holdoutPair[side].url} onEnded={() => setHoldoutHeard((current) => ({ ...current, [side]: true }))}>{c.audioCandidateFallback}</audio>
                </article>)}
              </div>
              {holdoutSaved ? <div className="voice-preference-saved"><strong>{c.heldOutJudgmentSecured}</strong><span>{c.startNextCellNote}</span></div> : <div className="voice-preference-choice" aria-label={c.chooseCloserHeldOutAriaLabel}>
                <button type="button" disabled={!holdoutHeard.left || !holdoutHeard.right || holdoutBusy} onClick={() => void saveHoldoutPreference("left")}>{c.aIsCloser}</button>
                <button type="button" disabled={!holdoutHeard.left || !holdoutHeard.right || holdoutBusy} onClick={() => void saveHoldoutPreference("right")}>{c.bIsCloser}</button>
                <button type="button" disabled={!holdoutHeard.left || !holdoutHeard.right || holdoutBusy} onClick={() => void saveHoldoutPreference("tie")}>{c.both}</button>
                <button type="button" disabled={!holdoutHeard.left || !holdoutHeard.right || holdoutBusy} onClick={() => void saveHoldoutPreference("neither")}>{c.neither}</button>
              </div>}
            </> : null}
            <div className="voice-holdout-actions">
              {delivery.policies[0].holdout.verdict ? <p><strong>{delivery.policies[0].holdout.verdict === "owner_pass" ? c.ownerHoldoutPassed : c.ownerHoldoutFailed}</strong><span>{c.notProductionQualificationNote}</span></p> : null}
              <button className="button primary-button" type="button" disabled={holdoutBusy || delivery.policies[0].holdout.completed >= delivery.policies[0].holdout.required} onClick={() => void generateHoldoutPair()}>{holdoutBusy ? c.securingTrial : holdoutPair ? c.nextUnseenPair : c.startHeldOutAB}</button>
              <button className="review-refresh" type="button" disabled={holdoutBusy || delivery.policies[0].holdout.completed !== delivery.policies[0].holdout.required || delivery.policies[0].holdout.verdict !== null} onClick={() => void finalizeHoldout()}>{c.finalizeOwnerGate}</button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
