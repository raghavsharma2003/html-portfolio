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

function friendlyImportError(cause: unknown, kind: "pack" | "ratings" | "result") {
  const code = cause instanceof Error ? cause.message : "";
  if (code.includes("cleanup_failed")) return "The new pack was not loaded because browser storage could not fully remove the old private experiment. The current experiment remains open.";
  if (code.includes("mapping_leak")) return "This file reveals a candidate before ratings are locked, so it was refused.";
  if (code.includes("binding") || code.includes("seal")) return `This ${kind} file belongs to a different sealed experiment.`;
  if (code.includes("size")) return `This ${kind} file is outside the safe size limit.`;
  if (code.includes("hash") || code.includes("geometry") || code.includes("wav")) return "One audio file failed its integrity check. Export the sealed pack again.";
  if (code.includes("signature") || code.includes("attestation") || code.includes("public_key")) return "This report has no valid private-pack signature, so model identities remain hidden.";
  return `This ${kind} file is not a valid Vyakti voice experiment export.`;
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
    } catch (cause) { setError(friendlyImportError(cause, "pack")); }
    finally { setBusy(false); }
  }

  async function removePrivateExperiment() {
    if (!bundle || !window.confirm("Remove this private experiment from this browser? Exported files on your computer are not deleted.")) return;
    setBusy(true);
    setError("");
    try {
      await purgeRun(bundle.runId, bundle);
      resetExperiment();
      setExpanded(true);
    } catch {
      setError("Browser storage failed while removing this private experiment. The current experiment remains open. Try again before leaving this device.");
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
    } catch (cause) { setError(friendlyImportError(cause, "ratings")); }
  }

  async function importResult(file: File | undefined) {
    if (!file || !bundle || !lockedAt) return;
    setError("");
    try {
      if (file.size > MAX_VOICE_STUDIO_ANSWER_BYTES) throw new Error("voice_experiment_result_size_invalid");
      const next = await parseVoiceExperimentResult(await file.text(), bundle);
      setResult(next);
      try { localStorage.setItem(resultKey(replicaId, bundle.runId), JSON.stringify(next)); } catch { /* result remains in memory */ }
    } catch (cause) { setError(friendlyImportError(cause, "result")); }
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
      setError("Audio could not start. Check this browser's sound permission, then try again.");
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
  const status = result ? "Identities unlocked" : locked ? "Ratings locked" : allAnswered ? "Ready to lock" : bundle ? `${completed} of ${total} rated` : "No experiment loaded";
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
        <span><strong>Blind voice experiment</strong><small>Compare real outputs before seeing which model made them.</small></span>
        <span className={result ? "unlocked" : bundle ? "active" : ""}>{status}</span>
      </summary>

      <div className="voice-experiment-body">
        {error && <div className="voice-experiment-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")}>Dismiss</button></div>}

        {!bundle ? (
          <div className="voice-experiment-import">
            <div>
              <h3>Open a sealed listening pack</h3>
              <p>Import the one-file Studio bundle. It contains opaque clips and score controls, never model names or the private answer key.</p>
            </div>
            <label className={`button secondary-button ${busy ? "disabled" : ""}`}>
              {busy ? "Checking pack..." : "Choose sealed pack"}
              <input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => { void importPack(event.target.files?.[0]); event.currentTarget.value = ""; }} />
            </label>
          </div>
        ) : result ? (
          <div className="voice-experiment-results">
            <header>
              <div><h3>Experiment identities unlocked</h3><p>{result.acceptedListeners} accepted listener sheet. These are descriptive means, not an automatic model choice.</p></div>
              <span>Signature verified</span>
            </header>
            {result.cells.map((cell) => (
              <section key={cell.languageId} aria-labelledby={`voice-result-${cell.languageId}`}>
                <h4 id={`voice-result-${cell.languageId}`}>{cell.languageId === "hi" ? "Hindi" : cell.languageId === "en" ? "English" : cell.languageId}</h4>
                <div className="voice-experiment-result-grid">
                  {cell.candidates.map((candidate) => (
                    <article key={`${cell.languageId}-${candidate.armLabel}-${candidate.model}`}>
                      <header><strong>{candidate.armLabel}</strong><span>{candidate.descriptiveOverallMean?.toFixed(2) ?? "No mean"}</span></header>
                      <small>{candidate.model} · n={candidate.n}</small>
                      <dl>
                        {bundle.trials.axes.map((axis) => <div key={axis.id}><dt>{axis.label}</dt><dd>{candidate.means[axis.id]?.toFixed(2) ?? "None"}</dd></div>)}
                      </dl>
                    </article>
                  ))}
                </div>
              </section>
            ))}
            <p className="voice-experiment-truth">No model is promoted here. Use the ratings as evidence alongside pronunciation checks, speaker similarity, latency, and cost.</p>
          </div>
        ) : !startedAt ? (
          <div className="voice-experiment-start">
            <div>
              <span className="voice-experiment-seal">SEALED</span>
              <h3>First, learn the owner's real voice</h3>
              <p>Use headphones and keep one volume. Candidate identities remain outside this browser pack.</p>
            </div>
            <div className="voice-experiment-start-actions">
              <button className="button secondary-button" type="button" onClick={() => void play(bundle.trials.referenceId, true)}>{referencePlayed ? "Play owner again" : "Play real owner"}</button>
              <button className="button primary-button" type="button" disabled={!referencePlayed} onClick={() => { setStartedAt(new Date().toISOString()); setIndex(firstIncomplete(bundle, answers)); }}>Start blind rating</button>
            </div>
          </div>
        ) : locked ? (
          <div className="voice-experiment-locked">
            <header><div><h3>Ratings locked on this browser</h3><p>The model mapping is still sealed. Export this sheet, admit it through the private listening gate, then import the unsealed report.</p></div><span>{storageState === "saved" ? "Saved locally" : "Export before leaving"}</span></header>
            <div className="voice-experiment-lock-actions">
              <button className="button primary-button" type="button" onClick={() => sheet && downloadJson(`${bundle.runId}-owner-studio-ratings.json`, sheet)}>Export locked ratings</button>
              <label className="button secondary-button">Import unsealed report<input type="file" accept=".json,application/json" onChange={(event) => { void importResult(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
            </div>
            <details className="voice-experiment-command">
              <summary>Private gate commands</summary>
              <code>node scripts/voice-matched-pack.mjs import-studio-answers --file &lt;ratings.json&gt; --home &lt;pack-folder&gt;</code>
              <code>node scripts/voice-matched-pack.mjs unseal --confirm-ratings-locked --home &lt;pack-folder&gt;</code>
              <small>Then import reports/unsealed-report.json above. A failed listening check does not unlock identities.</small>
            </details>
          </div>
        ) : trial ? (
          <div className="voice-experiment-rating">
            <div
              className="voice-experiment-progress"
              role="progressbar"
              aria-label="Blind experiment progress"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={completed}
              aria-valuetext={`${completed} of ${total} ratings complete`}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
            <header><span>{trial.kind === "rating" ? trial.language : "Listening check"}</span><strong>{index + 1} of {total}</strong></header>

            {trial.kind === "rating" ? (
              <>
                <p className="voice-experiment-prompt" lang={trial.langTag}>{trial.promptText}</p>
                <div className="voice-experiment-play">
                  <button className="button primary-button" type="button" onClick={() => void play(trial.stimulusId)}>{heard ? "Play hidden clip again" : "Play hidden clip"}</button>
                  <button className="button secondary-button" type="button" onClick={() => void play(bundle.trials.referenceId, true)}>Play real owner</button>
                  <span>{heard ? "Clip heard" : "Play before rating"}</span>
                </div>
                <div className="voice-experiment-axes">
                  {bundle.trials.axes.map((axis) => (
                    <fieldset key={axis.id}>
                      <legend><strong>{axis.label}</strong><span>1 {axis.low} · 5 {axis.high}</span></legend>
                      <div>{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" aria-label={`${axis.label}: ${value} of 5`} aria-pressed={(answer as VoiceExperimentRatingAnswer | undefined)?.[axis.id] === value} onClick={() => updateAnswer(trial.trialId, { [axis.id]: value })}>{value}</button>)}</div>
                    </fieldset>
                  ))}
                </div>
                <fieldset className="voice-experiment-disclosure">
                  <legend>Was the spoken AI disclosure clear and complete?</legend>
                  <div>{bundle.trials.disclosureOptions.map((option) => <button key={option.id} type="button" aria-pressed={(answer as VoiceExperimentRatingAnswer | undefined)?.disclosure === option.id} onClick={() => updateAnswer(trial.trialId, { disclosure: option.id as VoiceExperimentDisclosure })}>{option.label}</button>)}</div>
                </fieldset>
                <label className="voice-experiment-note">What sounded wrong, if anything?<textarea maxLength={400} rows={2} value={(answer as VoiceExperimentRatingAnswer | undefined)?.note || ""} onChange={(event) => updateAnswer(trial.trialId, { note: event.target.value })} /></label>
              </>
            ) : (
              <div className="voice-experiment-attention">
                <p>Play the short check, then choose what you heard.</p>
                <button className="button primary-button" type="button" onClick={() => void play(trial.stimulusId)}>{heard ? "Play check again" : "Play check"}</button>
                <div>{trial.options.map((option) => <button key={option.id} type="button" disabled={!heard} aria-pressed={(answer as { choice?: string } | undefined)?.choice === option.id} onClick={() => updateAnswer(trial.trialId, { choice: option.id })}>{option.label}</button>)}</div>
              </div>
            )}

            <footer>
              <button className="text-button" type="button" disabled={index === 0} onClick={() => { stopAudio(); setPlayedTrialId(""); setIndex((current) => Math.max(0, current - 1)); }}>Back</button>
              <span>{storageState === "saving" ? "Saving pack..." : storageState === "saved" ? "Progress saved locally" : "Export progress before leaving"}</span>
              <button className="button primary-button" type="button" disabled={!canAdvance} onClick={next}>{index === total - 1 ? "Lock ratings" : "Save and continue"}</button>
            </footer>
            {index === total - 1 && <p className="voice-experiment-lock-warning" role="note">Locking is irreversible in Studio. Export remains available afterward.</p>}
            <div className="voice-experiment-portability">
              <button type="button" onClick={() => sheet && downloadJson(`${bundle.runId}-owner-studio-progress.json`, sheet)}>Export progress</button>
              <label>Import progress<input type="file" accept=".json,application/json" onChange={(event) => { void importRatings(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
            </div>
          </div>
        ) : null}

        {bundle && (
          <div className="voice-experiment-lifecycle" aria-label="Private experiment storage">
            <small>Replacing clears this pack, its local ratings, and any imported result from this browser.</small>
            <div>
              <label className={`text-button ${busy ? "disabled" : ""}`}>
                {busy ? "Working..." : "Replace pack"}
                <input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => { void importPack(event.target.files?.[0]); event.currentTarget.value = ""; }} />
              </label>
              <button className="text-button danger" type="button" disabled={busy} onClick={() => void removePrivateExperiment()}>Remove private experiment</button>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
