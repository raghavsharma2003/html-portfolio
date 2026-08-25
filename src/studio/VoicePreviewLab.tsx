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

const STYLES = {
  faithful: { label: "Faithful", copy: "Tighter identity and steadier pacing" },
  balanced: { label: "Balanced", copy: "Natural delivery for everyday speech" },
  expressive: { label: "Expressive", copy: "More emotional movement and risk" },
} as const;
type StyleKey = keyof typeof STYLES;
type Preview = { url: string; generationId: string; modelCommitment: string; styleKey?: StyleKey };
const CONDITION_LABELS: Record<string, string> = {
  identity_anchor: "Identity anchor",
  faithful: "Faithful",
  steady_warm: "Steady warmth",
  balanced: "Balanced",
  warm_expressive: "Warm expression",
  expressive: "Expressive",
  animated: "Animated",
};

const PREFERENCE_REASONS: ReadonlyArray<{ value: VoicePreferenceReason; label: string }> = [
  { value: "identity", label: "Voice identity" },
  { value: "accent", label: "Accent" },
  { value: "rhythm", label: "Rhythm" },
  { value: "emotion", label: "Emotion" },
  { value: "naturalness", label: "Naturalness" },
  { value: "pronunciation", label: "Pronunciation" },
  { value: "noise_or_artifact", label: "Fewer artifacts" },
];

const STARTERS = {
  en: "I know this voice is only a first draft. Listen for my rhythm, pauses, accent, and the way I hold the last word.",
  hi: "Mujhe pata hai yeh awaaz abhi pehla draft hai. Meri rhythm, pauses, accent aur aakhri lafz bolne ka tareeka dhyan se suno.",
} as const;

export default function VoicePreviewLab({ token, replicaId, onAuthError }: {
  token: string;
  replicaId: string;
  onAuthError: (cause: unknown) => void;
}) {
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
      setError(cause instanceof Error ? cause.message : "Voice preview status is unavailable");
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
      setError(cause instanceof Error ? cause.message : "The protected preview could not be generated");
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
      setPairError(cause instanceof Error ? cause.message : "The blind comparison could not be generated");
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
      setPairError(cause instanceof Error ? cause.message : "The voice preference could not be secured");
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
      setPairError(cause instanceof Error ? cause.message : "The Voice Delivery Genome could not be frozen");
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
      setPairError(cause instanceof Error ? cause.message : "The held-out comparison could not be generated");
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
      setPairError(cause instanceof Error ? cause.message : "The held-out judgment could not be secured");
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
      setPairError(cause instanceof Error ? cause.message : "The held-out result could not be finalized");
    } finally { setHoldoutBusy(false); }
  }

  return (
    <section className="voice-preview-lab" aria-labelledby="voice-preview-title">
      <div className="voice-preview-heading">
        <div>
          <h2 id="voice-preview-title">Hear the evidence become a voice.</h2>
          <p>This private draft is for your ears and judgment. It cannot join calls or activate a replica.</p>
        </div>
        <button className="review-refresh" type="button" disabled={loading || generating || pairBusy} onClick={() => void load()}>{loading ? "Checking" : "Refresh draft"}</button>
      </div>

      <div className="voice-preview-workbench">
        <div className="voice-preview-compose">
          <div className="voice-preview-version">
            <span>{draft ? `VoiceGenome v${draft.version}` : "Draft required"}</span>
            <small>{draft ? `${draft.embedding_families} identity models bound` : "Review and build your selected voice first"}</small>
          </div>
          <fieldset className="voice-preview-language">
            <legend>Language</legend>
            <button type="button" className={language === "en" ? "active" : ""} aria-pressed={language === "en"} onClick={() => changeLanguage("en")}>English</button>
            <button type="button" className={language === "hi" ? "active" : ""} aria-pressed={language === "hi"} onClick={() => changeLanguage("hi")}>Hindi and Hinglish</button>
          </fieldset>
          <label className="voice-preview-script" htmlFor="voice-preview-text">
            <span>What should the draft say?</span>
            <textarea id="voice-preview-text" value={text} maxLength={600} rows={5} onChange={(event) => { setText(event.target.value); discardPair(); }} />
            <small>{Array.from(text).length}/600 characters. The audible AI disclosure is added automatically.</small>
          </label>
          <fieldset className="voice-preview-styles">
            <legend>Delivery</legend>
            {Object.entries(STYLES).map(([key, value]) => (
              <button type="button" key={key} className={styleKey === key ? "active" : ""} aria-pressed={styleKey === key} onClick={() => setStyleKey(key as StyleKey)}>
                <strong>{value.label}</strong><span>{value.copy}</span>
              </button>
            ))}
          </fieldset>
          <button className="button primary-button voice-preview-generate" type="button" disabled={!draft || generating || pairBusy || !text.trim()} onClick={() => void generate()}>{generating ? "Protecting your preview" : "Generate private preview"}</button>
          {generating && <p className="voice-preview-wait" role="status">The scale-to-zero voice lab may take a few minutes on its first run.</p>}
          {error && <p className="inline-error" role="alert">{error}</p>}
        </div>

        <div className={`voice-preview-listen ${preview ? "has-audio" : ""}`} aria-live="polite">
          {preview ? (
            <>
              <div className="voice-preview-orbit" aria-hidden="true"><span /><span /><span /></div>
              <h3>Your protected draft</h3>
              <p>Listen once for identity, once for delivery, then change one control at a time.</p>
              <audio controls autoPlay preload="metadata" src={preview.url}>Your browser cannot play this protected WAV.</audio>
              <dl>
                <div><dt>Disclosure</dt><dd>Audible</dd></div><div><dt>Watermarks</dt><dd>PerTh + AudioSeal</dd></div><div><dt>Provenance</dt><dd>C2PA signed</dd></div>
              </dl>
              <small>Receipt {preview.generationId.slice(0, 8)}. Model {preview.modelCommitment.slice(0, 10)}.</small>
            </>
          ) : (
            <>
              <div className="voice-preview-empty-mark" aria-hidden="true">V</div>
              <h3>{draft ? "The room is ready" : "No draft can speak yet"}</h3>
              <p>{draft ? "Choose the words and delivery. No audio leaves the protection boundary unmarked." : "Select a processed voice candidate, accept its evidence, and build a draft VoiceGenome."}</p>
              <div className="voice-preview-proof"><span>Owner-only</span><span>Self-replica</span><span>No runtime access</span></div>
            </>
          )}
        </div>
      </div>

      <div className="voice-preference-lab">
        <div className="voice-preference-intro">
          <div><span>Blind preference lab</span><h3>Teach the model with your ears.</h3></div>
          <p>The server balances a multilingual challenge deck and chooses the next most informative hidden contrast. Both sides keep the assigned words, identity evidence, model, language, and sampling seed fixed.</p>
          <button className="review-refresh" type="button" disabled={!draft || pairBusy || generating} onClick={() => void generateBlindPair()}>{pairBusy ? "Rendering A, then B" : pair ? "New blind pair" : "Start blind A/B"}</button>
        </div>
        {pair ? (
          <div className="voice-preference-body">
            <div className="voice-preference-progress"><span>Adaptive comparison {pair.progress.completed + 1}</span><span>{pair.progress.covered}/{pair.progress.total} conditions covered</span><span>{pair.progress.prompts}/{pair.progress.requiredPrompts} prompt families</span><span>{pair.progress.converged ? "Boundary converged" : "Still learning"}</span></div>
            <div className="voice-preference-prompt"><span>{pair.prompt.domain.replaceAll("_", " ")} challenge</span><p>{pair.prompt.text}</p></div>
            <div className="voice-preference-players">
              {(["left", "right"] as const).map((side, index) => (
                <article key={side} className={heard[side] ? "heard" : ""}>
                  <span>{index === 0 ? "A" : "B"}</span>
                  <div><strong>Protected candidate {index === 0 ? "A" : "B"}</strong><small>{heard[side] ? "Completed" : "Listen fully before deciding"}</small></div>
                  <audio controls preload="metadata" src={pair[side].url} onEnded={() => setHeard((current) => ({ ...current, [side]: true }))}>Protected voice candidate.</audio>
                </article>
              ))}
            </div>
            {preferenceSaved ? (
              <div className="voice-preference-saved" role="status">
                <strong>Preference secured</strong>
                <span>{preferenceSaved.choice === "neither" ? "Neither candidate qualified." : preferenceSaved.choice === "tie" ? "The candidates were equivalent." : `${preferenceSaved.choice === "left" ? "A" : "B"} was closer.`} A was {(CONDITION_LABELS[preferenceSaved.leftStyle] || "condition A").toLowerCase()}; B was {(CONDITION_LABELS[preferenceSaved.rightStyle] || "condition B").toLowerCase()}.</span>
                <small>Evidence {preferenceSaved.id.slice(0, 8)} is exact-generation bound.</small>
              </div>
            ) : (
              <>
                <div className="voice-preference-reasons">
                  <span>What separated them? <small>optional</small></span>
                  <div>{PREFERENCE_REASONS.map((reason) => <button type="button" key={reason.value} className={preferenceReasons.includes(reason.value) ? "active" : ""} aria-pressed={preferenceReasons.includes(reason.value)} onClick={() => togglePreferenceReason(reason.value)}>{reason.label}</button>)}</div>
                </div>
                <div className="voice-preference-choice" aria-label="Choose the closer protected voice">
                  <button type="button" disabled={!heard.left || !heard.right || preferenceBusy} onClick={() => void savePreference("left")}>A is closer</button>
                  <button type="button" disabled={!heard.left || !heard.right || preferenceBusy} onClick={() => void savePreference("right")}>B is closer</button>
                  <button type="button" disabled={!heard.left || !heard.right || preferenceBusy} onClick={() => void savePreference("tie")}>Both</button>
                  <button type="button" disabled={!heard.left || !heard.right || preferenceBusy} onClick={() => void savePreference("neither")}>Neither</button>
                </div>
                {!heard.left || !heard.right ? <p className="voice-preference-gate">Finish both candidates to unlock the judgment.</p> : null}
              </>
            )}
          </div>
        ) : <div className="voice-preference-empty">{pairBusy ? "Two fully protected generations are being built. Cold starts can take a few minutes." : "No comparison is open. The lab will assign a new challenge sentence and hold it constant across both sides."}</div>}
        {pairError ? <p className="inline-error" role="alert">{pairError}</p> : null}
        {delivery ? (
          <div className="voice-delivery-freeze">
            <div>
              <span>Voice Delivery Genome</span>
              <h4>{delivery.policies[0] ? `Version ${delivery.policies[0].version} is frozen` : "Build an immutable delivery candidate"}</h4>
              <p>{delivery.policies[0] ? `${CONDITION_LABELS[delivery.policies[0].champion_key] || "Learned delivery"} is bound to ${delivery.policies[0].comparisons} exact judgments. It remains draft-only until held-out qualification.` : "The candidate is created only after the multilingual comparison boundary is deep and diverse enough."}</p>
            </div>
            <div className="voice-delivery-readiness">
              <span>{delivery.readiness.completed} comparisons</span>
              <span>{delivery.readiness.covered_conditions}/{delivery.readiness.total_conditions} conditions</span>
              <span>{delivery.readiness.unique_prompts}/{delivery.readiness.required_prompts} prompts</span>
            </div>
            <button className="button primary-button" type="button" disabled={!delivery.readiness.ready || deliveryBusy} onClick={() => void freezeDeliveryPolicy()}>{deliveryBusy ? "Freezing evidence" : delivery.policies[0] ? "Freeze updated version" : "Freeze delivery candidate"}</button>
            {!delivery.readiness.ready ? <small>More blind evidence is required. Repeating one familiar sentence cannot unlock this gate.</small> : <small>Freezing does not activate the voice. A separate held-out ABX gate is next.</small>}
          </div>
        ) : null}
        {delivery?.policies[0] ? (
          <div className="voice-holdout-lab">
            <div className="voice-holdout-heading">
              <div><span>Unseen speech gate</span><h4>Does the frozen delivery generalize?</h4><p>Six prompts excluded from calibration, each tested with two deterministic seeds. The candidate stays hidden against its strongest runner-up.</p></div>
              <div><strong>{delivery.policies[0].holdout.completed}/{delivery.policies[0].holdout.required}</strong><small>held-out judgments</small></div>
            </div>
            {holdoutPair ? <>
              <div className="voice-preference-prompt"><span>{holdoutPair.prompt.domain.replaceAll("_", " ")} holdout</span><p>{holdoutPair.prompt.text}</p></div>
              <div className="voice-preference-players">
                {(["left", "right"] as const).map((side, index) => <article key={side} className={holdoutHeard[side] ? "heard" : ""}>
                  <span>{index === 0 ? "A" : "B"}</span><div><strong>Held-out candidate {index === 0 ? "A" : "B"}</strong><small>{holdoutHeard[side] ? "Completed" : "Listen fully"}</small></div>
                  <audio controls preload="metadata" src={holdoutPair[side].url} onEnded={() => setHoldoutHeard((current) => ({ ...current, [side]: true }))}>Protected held-out voice candidate.</audio>
                </article>)}
              </div>
              {holdoutSaved ? <div className="voice-preference-saved"><strong>Held-out judgment secured</strong><span>Start the next unseen cell when you are ready.</span></div> : <div className="voice-preference-choice" aria-label="Choose the closer held-out voice">
                <button type="button" disabled={!holdoutHeard.left || !holdoutHeard.right || holdoutBusy} onClick={() => void saveHoldoutPreference("left")}>A is closer</button>
                <button type="button" disabled={!holdoutHeard.left || !holdoutHeard.right || holdoutBusy} onClick={() => void saveHoldoutPreference("right")}>B is closer</button>
                <button type="button" disabled={!holdoutHeard.left || !holdoutHeard.right || holdoutBusy} onClick={() => void saveHoldoutPreference("tie")}>Both</button>
                <button type="button" disabled={!holdoutHeard.left || !holdoutHeard.right || holdoutBusy} onClick={() => void saveHoldoutPreference("neither")}>Neither</button>
              </div>}
            </> : null}
            <div className="voice-holdout-actions">
              {delivery.policies[0].holdout.verdict ? <p><strong>{delivery.policies[0].holdout.verdict === "owner_pass" ? "Owner holdout passed" : "Owner holdout failed"}</strong><span>This is not production qualification. Automated identity, intelligibility, artifact, watermark, privacy, and latency gates remain locked.</span></p> : null}
              <button className="button primary-button" type="button" disabled={holdoutBusy || delivery.policies[0].holdout.completed >= delivery.policies[0].holdout.required} onClick={() => void generateHoldoutPair()}>{holdoutBusy ? "Securing trial" : holdoutPair ? "Next unseen pair" : "Start held-out A/B"}</button>
              <button className="review-refresh" type="button" disabled={holdoutBusy || delivery.policies[0].holdout.completed !== delivery.policies[0].holdout.required || delivery.policies[0].holdout.verdict !== null} onClick={() => void finalizeHoldout()}>Finalize owner gate</button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
