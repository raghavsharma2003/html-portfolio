import { useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_VOICE_STUDIO_ANSWER_BYTES,
  MAX_VOICE_STUDIO_BUNDLE_BYTES,
  answerComplete,
  buildVoiceExperimentSheet,
  completedTrialCount,
  deleteVoiceExperimentBundle,
  loadVoiceExperimentBundle,
  parseVoiceExperimentBundle,
  parseVoiceExperimentResult,
  parseVoiceExperimentSheet,
  saveVoiceExperimentBundle,
  stimulusBlob,
  type VoiceExperimentAnswer,
  type VoiceExperimentAnswers,
  type VoiceExperimentBundle,
  type VoiceExperimentDisclosure,
  type VoiceExperimentRatingAnswer,
  type VoiceExperimentResult,
} from "./voiceExperiment";
import { useStudioLocale } from "./localeContext";
import type { StudioCopy } from "./copy";

type VEC = StudioCopy["voiceExperimentPanel"];

const POINTER_PREFIX = "vy.voiceExperiment.latest.";
const PROGRESS_PREFIX = "vy.voiceExperiment.progress.";
const RESULT_PREFIX = "vy.voiceExperiment.result.";

function pointerKey(replicaId: string) { return `${POINTER_PREFIX}${replicaId}`; }
function progressKey(replicaId: string, runId: string) { return `${PROGRESS_PREFIX}${replicaId}.${runId}`; }
function resultKey(replicaId: string, runId: string) { return `${RESULT_PREFIX}${replicaId}.${runId}`; }

function clearStoredRun(replicaId: string, runId: string) {
  localStorage.removeItem(progressKey(replicaId, runId));
  localStorage.removeItem(resultKey(replicaId, runId));
  if (localStorage.getItem(pointerKey(replicaId)) === runId) localStorage.removeItem(pointerKey(replicaId));
}

function restoreStoredValue(key: string, value: string | null) {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
}

/** `kind` names which import this is; the word spliced into `{kind}` below
 *  is locale-aware (`c.kindPack`/`c.kindRatings`/`c.kindResult`), not the
 *  English internal code itself. */
function kindWord(kind: "pack" | "ratings" | "result", c: VEC): string {
  return kind === "pack" ? c.kindPack : kind === "ratings" ? c.kindRatings : c.kindResult;
}

function friendlyImportError(cause: unknown, kind: "pack" | "ratings" | "result", c: VEC) {
  const code = cause instanceof Error ? cause.message : "";
  if (code.includes("cleanup_failed")) return c.errorCleanupFailed;
  if (code.includes("mapping_leak")) return c.errorMappingLeak;
  if (code.includes("binding") || code.includes("seal")) return c.errorBindingMismatch.split("{kind}").join(kindWord(kind, c));
  if (code.includes("size")) return c.errorSizeLimit.split("{kind}").join(kindWord(kind, c));
  if (code.includes("hash") || code.includes("geometry") || code.includes("wav")) return c.errorIntegrityCheck;
  if (code.includes("signature") || code.includes("attestation") || code.includes("public_key")) return c.errorNoSignature;
  return c.errorNotValidExport.split("{kind}").join(kindWord(kind, c));
}

function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function readStoredSheet(replicaId: string, bundle: VoiceExperimentBundle) {
  try {
    const raw = localStorage.getItem(progressKey(replicaId, bundle.runId));
    return raw ? parseVoiceExperimentSheet(raw, bundle) : null;
  } catch { return null; }
}

function firstIncomplete(bundle: VoiceExperimentBundle, answers: VoiceExperimentAnswers) {
  const index = bundle.trials.sequence.findIndex((trial) => !answerComplete(trial, answers[trial.trialId]));
  return index < 0 ? 0 : index;
}

export default function VoiceExperimentPanel({ replicaId }: { replicaId: string }) {
  const { t } = useStudioLocale();
  const c = t.voiceExperimentPanel;
  const [expanded, setExpanded] = useState(false);
  const [bundle, setBundle] = useState<VoiceExperimentBundle | null>(null);
  const [answers, setAnswers] = useState<VoiceExperimentAnswers>({});
  const [startedAt, setStartedAt] = useState("");
  const [lockedAt, setLockedAt] = useState("");
  const [index, setIndex] = useState(0);
  const [playedTrialId, setPlayedTrialId] = useState("");
  const [referencePlayed, setReferencePlayed] = useState(false);
  const [result, setResult] = useState<VoiceExperimentResult | null>(null);
  const [storageState, setStorageState] = useState<"saved" | "memory" | "saving">("saved");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef("");

  function stopAudio() {
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.pause();
    }
    audioRef.current = null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = "";
  }

  useEffect(() => () => stopAudio(), []);

  useEffect(() => {
    let live = true;
    const runId = (() => { try { return localStorage.getItem(pointerKey(replicaId)) || ""; } catch { return ""; } })();
    if (!runId) return () => { live = false; };
    loadVoiceExperimentBundle(replicaId, runId).then((stored) => {
      if (!live || !stored) return;
      const sheet = readStoredSheet(replicaId, stored);
      setBundle(stored);
      setAnswers(sheet?.answers || {});
      setStartedAt(sheet?.startedAt || "");
      setLockedAt(sheet?.complete ? sheet.finishedAt || "" : "");
      setIndex(firstIncomplete(stored, sheet?.answers || {}));
      if (sheet?.complete && sheet.finishedAt) {
        try {
          const savedResult = localStorage.getItem(resultKey(replicaId, stored.runId));
          if (savedResult) void parseVoiceExperimentResult(savedResult, stored)
            .then((verified) => { if (live) setResult(verified); })
            .catch(() => { /* a stale or unauthenticated result stays hidden */ });
        } catch { /* a stale result stays hidden */ }
      }
      setExpanded(true);
    }).catch(() => { if (live) setStorageState("memory"); });
    return () => { live = false; };
  }, [replicaId]);

  useEffect(() => {
    if (!bundle || !startedAt) return;
    try {
      localStorage.setItem(progressKey(replicaId, bundle.runId), JSON.stringify(buildVoiceExperimentSheet(bundle, answers, startedAt, lockedAt)));
      setStorageState((current) => current === "memory" ? current : "saved");
    } catch { setStorageState("memory"); }
  }, [answers, bundle, lockedAt, replicaId, startedAt]);

  async function purgeRun(runId: string, fallbackBundle: VoiceExperimentBundle) {
    let snapshot: { progress: string | null; result: string | null; pointer: string | null };
    try {
      snapshot = {
        progress: localStorage.getItem(progressKey(replicaId, runId)),
        result: localStorage.getItem(resultKey(replicaId, runId)),
        pointer: localStorage.getItem(pointerKey(replicaId)),
      };
    } catch { throw new Error("voice_experiment_cleanup_failed"); }
    try { await deleteVoiceExperimentBundle(replicaId, runId); }
    catch { throw new Error("voice_experiment_cleanup_failed"); }
    try { clearStoredRun(replicaId, runId); }
    catch {
      try {
        await saveVoiceExperimentBundle(replicaId, fallbackBundle);
        restoreStoredValue(progressKey(replicaId, runId), snapshot.progress);
        restoreStoredValue(resultKey(replicaId, runId), snapshot.result);
        restoreStoredValue(pointerKey(replicaId), snapshot.pointer);
      } catch { /* the current in-memory experiment still remains active */ }
      throw new Error("voice_experiment_cleanup_failed");
    }
  }

  function resetExperiment() {
    stopAudio();
    setBundle(null);
    setAnswers({});
    setStartedAt("");
    setLockedAt("");
    setIndex(0);
    setPlayedTrialId("");
    setReferencePlayed(false);
    setResult(null);
    setStorageState("saved");
  }

  async function importPack(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > MAX_VOICE_STUDIO_BUNDLE_BYTES) throw new Error("voice_experiment_bundle_size_invalid");
      const next = await parseVoiceExperimentBundle(await file.text());
      const prior = bundle;
      if (prior) await purgeRun(prior.runId, prior);
      setStorageState("saving");
      try {
        await saveVoiceExperimentBundle(replicaId, next);
        localStorage.setItem(pointerKey(replicaId), next.runId);
        setStorageState("saved");
      } catch { setStorageState("memory"); }
      const sheet = prior ? null : readStoredSheet(replicaId, next);
      setBundle(next);
      setAnswers(sheet?.answers || {});
      setStartedAt(sheet?.startedAt || "");
      setLockedAt(sheet?.complete ? sheet.finishedAt || "" : "");
      setIndex(firstIncomplete(next, sheet?.answers || {}));
      setPlayedTrialId("");
      setReferencePlayed(false);
      setResult(null);
      setExpanded(true);
    } catch (cause) { setError(friendlyImportError(cause, "pack", c)); }
    finally { setBusy(false); }
  }

  async function removePrivateExperiment() {
    if (!bundle || !window.confirm(c.removeConfirm)) return;
    setBusy(true);
    setError("");
    try {
      await purgeRun(bundle.runId, bundle);
      resetExperiment();
      setExpanded(true);
    } catch {
      setError(c.errorStorageFailedRemoving);
    } finally { setBusy(false); }
  }

  async function importRatings(file: File | undefined) {
    if (!file || !bundle) return;
    setError("");
    try {
      if (file.size > MAX_VOICE_STUDIO_ANSWER_BYTES) throw new Error("voice_experiment_answers_size_invalid");
      const sheet = parseVoiceExperimentSheet(await file.text(), bundle);
      setAnswers(sheet.answers);
      setStartedAt(sheet.startedAt);
      setLockedAt(sheet.complete ? sheet.finishedAt || "" : "");
      setIndex(firstIncomplete(bundle, sheet.answers));
      setPlayedTrialId("");
    } catch (cause) { setError(friendlyImportError(cause, "ratings", c)); }
  }

  async function importResult(file: File | undefined) {
    if (!file || !bundle || !lockedAt) return;
    setError("");
    try {
      if (file.size > MAX_VOICE_STUDIO_ANSWER_BYTES) throw new Error("voice_experiment_result_size_invalid");
      const next = await parseVoiceExperimentResult(await file.text(), bundle);
      setResult(next);
      try { localStorage.setItem(resultKey(replicaId, bundle.runId), JSON.stringify(next)); } catch { /* result remains in memory */ }
    } catch (cause) { setError(friendlyImportError(cause, "result", c)); }
  }

  async function play(stimulusId: string, reference = false) {
    if (!bundle) return;
    stopAudio();
    const url = URL.createObjectURL(stimulusBlob(bundle, stimulusId));
    audioUrlRef.current = url;
    const audio = new Audio(url);
    audioRef.current = audio;
    const playedTrial = bundle.trials.sequence[index]?.trialId || "";
    audio.onended = () => {
      if (reference) setReferencePlayed(true);
      else setPlayedTrialId(playedTrial);
      stopAudio();
    };
    try {
      await audio.play();
    } catch {
      stopAudio();
      setError(c.errorAudioCouldNotStart);
    }
  }

  function updateAnswer(trialId: string, patch: VoiceExperimentAnswer) {
    setAnswers((current) => ({ ...current, [trialId]: { ...(current[trialId] || {}), ...patch } }));
  }

  const total = bundle?.trials.sequence.length || 0;
  const completed = bundle ? completedTrialCount(bundle, answers) : 0;
  const allAnswered = Boolean(bundle && completed === total);
  const locked = Boolean(bundle && lockedAt);
  const trial = bundle?.trials.sequence[index];
  const answer = trial ? answers[trial.trialId] : undefined;
  const heard = Boolean(trial && playedTrialId === trial.trialId);
  const canAdvance = Boolean(trial && heard && answerComplete(trial, answer));
  const progress = total ? Math.round((completed / total) * 100) : 0;
  const status = result ? c.statusIdentitiesUnlocked : locked ? c.statusRatingsLocked : allAnswered ? c.statusReadyToLock
    : bundle ? c.statusRatedCount.split("{n}").join(String(completed)).split("{n2}").join(String(total)) : c.statusNoExperiment;
  const sheet = useMemo(
    () => bundle && startedAt ? buildVoiceExperimentSheet(bundle, answers, startedAt, lockedAt) : null,
    [answers, bundle, lockedAt, startedAt],
  );

  function next() {
    if (!bundle || !canAdvance) return;
    stopAudio();
    setPlayedTrialId("");
    if (index >= bundle.trials.sequence.length - 1) setLockedAt(new Date().toISOString());
    else setIndex((current) => current + 1);
  }

  return (
    <details className="voice-experiment" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>
        <span><strong>{c.summaryTitle}</strong><small>{c.summarySubtitle}</small></span>
        <span className={result ? "unlocked" : bundle ? "active" : ""}>{status}</span>
      </summary>

      <div className="voice-experiment-body">
        {error && <div className="voice-experiment-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")}>{c.dismiss}</button></div>}

        {!bundle ? (
          <div className="voice-experiment-import">
            <div>
              <h3>{c.openSealedPackTitle}</h3>
              <p>{c.openSealedPackBody}</p>
            </div>
            <label className={`button secondary-button ${busy ? "disabled" : ""}`}>
              {busy ? c.checkingPack : c.chooseSealedPack}
              <input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => { void importPack(event.target.files?.[0]); event.currentTarget.value = ""; }} />
            </label>
          </div>
        ) : result ? (
          <div className="voice-experiment-results">
            <header>
              <div><h3>{c.identitiesUnlockedTitle}</h3><p>{c.acceptedListenerNote.split("{n}").join(String(result.acceptedListeners))}</p></div>
              <span>{c.signatureVerified}</span>
            </header>
            {result.cells.map((cell) => (
              <section key={cell.languageId} aria-labelledby={`voice-result-${cell.languageId}`}>
                <h4 id={`voice-result-${cell.languageId}`}>{cell.languageId === "hi" ? c.languageHindi : cell.languageId === "en" ? c.languageEnglish : cell.languageId}</h4>
                <div className="voice-experiment-result-grid">
                  {cell.candidates.map((candidate) => (
                    <article key={`${cell.languageId}-${candidate.armLabel}-${candidate.model}`}>
                      <header><strong>{candidate.armLabel}</strong><span>{candidate.descriptiveOverallMean?.toFixed(2) ?? c.noMean}</span></header>
                      <small>{candidate.model} · n={candidate.n}</small>
                      <dl>
                        {bundle.trials.axes.map((axis) => <div key={axis.id}><dt>{axis.label}</dt><dd>{candidate.means[axis.id]?.toFixed(2) ?? c.noneLabel}</dd></div>)}
                      </dl>
                    </article>
                  ))}
                </div>
              </section>
            ))}
            <p className="voice-experiment-truth">{c.noPromotionNote}</p>
          </div>
        ) : !startedAt ? (
          <div className="voice-experiment-start">
            <div>
              <span className="voice-experiment-seal">SEALED</span>
              <h3>{c.learnOwnerVoiceTitle}</h3>
              <p>{c.headphonesNote}</p>
            </div>
            <div className="voice-experiment-start-actions">
              <button className="button secondary-button" type="button" onClick={() => void play(bundle.trials.referenceId, true)}>{referencePlayed ? c.playOwnerAgain : c.playRealOwner}</button>
              <button className="button primary-button" type="button" disabled={!referencePlayed} onClick={() => { setStartedAt(new Date().toISOString()); setIndex(firstIncomplete(bundle, answers)); }}>{c.startBlindRating}</button>
            </div>
          </div>
        ) : locked ? (
          <div className="voice-experiment-locked">
            <header><div><h3>{c.ratingsLockedTitle}</h3><p>{c.ratingsLockedBody}</p></div><span>{storageState === "saved" ? c.savedLocally : c.exportBeforeLeaving}</span></header>
            <div className="voice-experiment-lock-actions">
              <button className="button primary-button" type="button" onClick={() => sheet && downloadJson(`${bundle.runId}-owner-studio-ratings.json`, sheet)}>{c.exportLockedRatings}</button>
              <label className="button secondary-button">{c.importUnsealedReport}<input type="file" accept=".json,application/json" onChange={(event) => { void importResult(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
            </div>
            <details className="voice-experiment-command">
              <summary>{c.privateGateCommandsSummary}</summary>
              <code>node scripts/voice-matched-pack.mjs import-studio-answers --file &lt;ratings.json&gt; --home &lt;pack-folder&gt;</code>
              <code>node scripts/voice-matched-pack.mjs unseal --confirm-ratings-locked --home &lt;pack-folder&gt;</code>
              <small>{c.privateGateCommandsNote}</small>
            </details>
          </div>
        ) : trial ? (
          <div className="voice-experiment-rating">
            <div
              className="voice-experiment-progress"
              role="progressbar"
              aria-label={c.progressBarAriaLabel}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={completed}
              aria-valuetext={c.progressAriaValueText.split("{n}").join(String(completed)).split("{n2}").join(String(total))}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
            <header><span>{trial.kind === "rating" ? trial.language : c.listeningCheck}</span><strong>{c.positionLabel.split("{n}").join(String(index + 1)).split("{n2}").join(String(total))}</strong></header>

            {trial.kind === "rating" ? (
              <>
                <p className="voice-experiment-prompt" lang={trial.langTag}>{trial.promptText}</p>
                <div className="voice-experiment-play">
                  <button className="button primary-button" type="button" onClick={() => void play(trial.stimulusId)}>{heard ? c.playHiddenClipAgain : c.playHiddenClip}</button>
                  <button className="button secondary-button" type="button" onClick={() => void play(bundle.trials.referenceId, true)}>{c.playRealOwner}</button>
                  <span>{heard ? c.clipHeard : c.playBeforeRating}</span>
                </div>
                <div className="voice-experiment-axes">
                  {bundle.trials.axes.map((axis) => (
                    <fieldset key={axis.id}>
                      <legend><strong>{axis.label}</strong><span>{c.axisScaleLabel.split("{n}").join(axis.low).split("{n2}").join(axis.high)}</span></legend>
                      <div>{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" aria-label={c.axisButtonAriaLabel.split("{label}").join(axis.label).split("{n}").join(String(value))} aria-pressed={(answer as VoiceExperimentRatingAnswer | undefined)?.[axis.id] === value} onClick={() => updateAnswer(trial.trialId, { [axis.id]: value })}>{value}</button>)}</div>
                    </fieldset>
                  ))}
                </div>
                <fieldset className="voice-experiment-disclosure">
                  <legend>{c.disclosureLegend}</legend>
                  <div>{bundle.trials.disclosureOptions.map((option) => <button key={option.id} type="button" aria-pressed={(answer as VoiceExperimentRatingAnswer | undefined)?.disclosure === option.id} onClick={() => updateAnswer(trial.trialId, { disclosure: option.id as VoiceExperimentDisclosure })}>{option.label}</button>)}</div>
                </fieldset>
                <label className="voice-experiment-note">{c.noteQuestion}<textarea maxLength={400} rows={2} value={(answer as VoiceExperimentRatingAnswer | undefined)?.note || ""} onChange={(event) => updateAnswer(trial.trialId, { note: event.target.value })} /></label>
              </>
            ) : (
              <div className="voice-experiment-attention">
                <p>{c.attentionPrompt}</p>
                <button className="button primary-button" type="button" onClick={() => void play(trial.stimulusId)}>{heard ? c.playCheckAgain : c.playCheck}</button>
                <div>{trial.options.map((option) => <button key={option.id} type="button" disabled={!heard} aria-pressed={(answer as { choice?: string } | undefined)?.choice === option.id} onClick={() => updateAnswer(trial.trialId, { choice: option.id })}>{option.label}</button>)}</div>
              </div>
            )}

            <footer>
              <button className="text-button" type="button" disabled={index === 0} onClick={() => { stopAudio(); setPlayedTrialId(""); setIndex((current) => Math.max(0, current - 1)); }}>{c.back}</button>
              <span>{storageState === "saving" ? c.savingPack : storageState === "saved" ? c.progressSavedLocally : c.exportProgressBeforeLeaving}</span>
              <button className="button primary-button" type="button" disabled={!canAdvance} onClick={next}>{index === total - 1 ? c.lockRatings : c.saveAndContinue}</button>
            </footer>
            {index === total - 1 && <p className="voice-experiment-lock-warning" role="note">{c.lockIrreversibleNote}</p>}
            <div className="voice-experiment-portability">
              <button type="button" onClick={() => sheet && downloadJson(`${bundle.runId}-owner-studio-progress.json`, sheet)}>{c.exportProgress}</button>
              <label>{c.importProgress}<input type="file" accept=".json,application/json" onChange={(event) => { void importRatings(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
            </div>
          </div>
        ) : null}

        {bundle && (
          <div className="voice-experiment-lifecycle" aria-label="Private experiment storage">
            <small>{c.replaceClearsNote}</small>
            <div>
              <label className={`text-button ${busy ? "disabled" : ""}`}>
                {busy ? c.working : c.replacePack}
                <input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => { void importPack(event.target.files?.[0]); event.currentTarget.value = ""; }} />
              </label>
              <button className="text-button danger" type="button" disabled={busy} onClick={() => void removePrivateExperiment()}>{c.removePrivateExperiment}</button>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
