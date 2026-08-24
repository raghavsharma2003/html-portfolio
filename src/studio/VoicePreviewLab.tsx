import { useCallback, useEffect, useMemo, useState } from "react";
import { getReplicaReview } from "./processingApi";
import { ReplicaApiError } from "./replicaApi";
import type { ReplicaReview } from "./types";
import { generateVoicePreview } from "./voicePreviewApi";

const STYLES = {
  faithful: { label: "Faithful", copy: "Tighter identity and steadier pacing", exaggeration: 0.35, cfgWeight: 0.65, temperature: 0.65 },
  balanced: { label: "Balanced", copy: "Natural delivery for everyday speech", exaggeration: 0.5, cfgWeight: 0.5, temperature: 0.8 },
  expressive: { label: "Expressive", copy: "More emotional movement and risk", exaggeration: 0.8, cfgWeight: 0.3, temperature: 0.9 },
} as const;
type StyleKey = keyof typeof STYLES;

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
  const [preview, setPreview] = useState<{ url: string; generationId: string; modelCommitment: string } | null>(null);

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

  function changeLanguage(next: "en" | "hi") {
    setLanguage(next);
    if (text === STARTERS.en || text === STARTERS.hi) setText(STARTERS[next]);
  }

  async function generate() {
    if (!draft) return;
    setGenerating(true); setError("");
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
    const style = STYLES[styleKey];
    try {
      const result = await generateVoicePreview(token, {
        replicaId,
        genomeVersion: draft.version,
        text,
        languageId: language,
        style: { exaggeration: style.exaggeration, cfgWeight: style.cfgWeight, temperature: style.temperature },
      });
      setPreview({
        url: URL.createObjectURL(result.audio),
        generationId: result.generationId,
        modelCommitment: result.modelCommitment,
      });
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
      setError(cause instanceof Error ? cause.message : "The protected preview could not be generated");
    } finally { setGenerating(false); }
  }

  return (
    <section className="voice-preview-lab" aria-labelledby="voice-preview-title">
      <div className="voice-preview-heading">
        <div>
          <h2 id="voice-preview-title">Hear the evidence become a voice.</h2>
          <p>This private draft is for your ears and judgment. It cannot join calls or activate a replica.</p>
        </div>
        <button className="review-refresh" type="button" disabled={loading || generating} onClick={() => void load()}>
          {loading ? "Checking" : "Refresh draft"}
        </button>
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
            <textarea id="voice-preview-text" value={text} maxLength={600} rows={5} onChange={(event) => setText(event.target.value)} />
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

          <button className="button primary-button voice-preview-generate" type="button" disabled={!draft || generating || !text.trim()} onClick={() => void generate()}>
            {generating ? "Protecting your preview" : "Generate private preview"}
          </button>
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
                <div><dt>Disclosure</dt><dd>Audible</dd></div>
                <div><dt>Watermarks</dt><dd>PerTh + AudioSeal</dd></div>
                <div><dt>Provenance</dt><dd>C2PA signed</dd></div>
              </dl>
              <small>Receipt {preview.generationId.slice(0, 8)}. Model {preview.modelCommitment.slice(0, 10)}.</small>
            </>
          ) : (
            <>
              <div className="voice-preview-empty-mark" aria-hidden="true">V</div>
              <h3>{draft ? "The room is ready" : "No draft can speak yet"}</h3>
              <p>{draft ? "Choose the words and delivery. No audio leaves the protection boundary unmarked." : "Select a processed voice candidate, accept its evidence, and build a draft VoiceGenome."}</p>
              <div className="voice-preview-proof">
                <span>Owner-only</span><span>Self-replica</span><span>No runtime access</span>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
