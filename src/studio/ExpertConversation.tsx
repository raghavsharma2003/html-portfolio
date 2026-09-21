import PrivateConversationSources from "./PrivateConversationSources";
import PrivateSelectionRecovery from './PrivateSelectionRecovery';
import { useCallback, useEffect, useRef, useState } from "react";
import { createDialogueTurn, fetchProtectedTurnVoice, readDialogueHistory, openDialogueSession,
  readMeetMemoryStatus, setMeetMemoryOn, readMeetMemoryFacts, correctMeetMemoryFact, forgetMeetMemoryFact,
  readMeetRelState, resetMeetRelState, requestMeetMemoryDrain } from "./dialogueApi";
import type { MeetMemoryFact, MeetRelState } from "./dialogueApi";
import { readRuntimeStatus } from "./runtimeApi";
import { ReplicaApiError } from "./replicaApi";
import TurnFeedback from "./TurnFeedback";
import ExpertAnswer from "./ExpertAnswer";
import FeedbackDatasetPanel from "./FeedbackDatasetPanel";
import { conversationSetupUrl } from "./conversationSetupNavigation";
import type { ReplicaDialogueTurn, ReplicaLifecycle, ReplicaRuntimeStatus } from "./types";
import { useStudioLocale } from "./localeContext";
import "./expert-experience.css";
import "./conversation-setup.css";

type Exchange = { question: string; answer: ReplicaDialogueTurn };
type Continuity = { sessionId?: string; openingId?: string; uncertainTrace?: string; runtimeChanged?: boolean; pendingWork?: boolean };
// Identifiers only, scoped to this authenticated page lifetime. Navigation
// keeps uncertainty; reload restores the last actual server session. Never
// put private messages or bearer credentials into browser storage.
const continuity = new Map<string, Continuity>();
function remember(scope: string, value: Continuity) {
  continuity.delete(scope); continuity.set(scope, value);
  if (continuity.size > 20) continuity.delete(continuity.keys().next().value!);
}
type Props = {
  token: string; replicaId: string; runtimeStatus?: ReplicaRuntimeStatus | null;
  stopped: boolean; onAuthError: (cause: unknown) => void; onReview?: () => void;
  lifecycle?: ReplicaLifecycle;
};

export default function ExpertConversation({ token, replicaId, runtimeStatus, stopped, lifecycle, onAuthError }: Props) {
  const { locale, t } = useStudioLocale();
  const copy = t.expertConversation;
  const continuityAudioLocale = locale;
  const continuityAudioNote = copy.continuityAudioNote;
  const [runtime, setRuntime] = useState(runtimeStatus?.replica_id === replicaId ? runtimeStatus : null);
  const [checking, setChecking] = useState(true);
  const [readUnavailable, setReadUnavailable] = useState(false);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [draft, setDraft] = useState("");
  const [recallPrevious,setRecallPrevious]=useState(false);
  useEffect(()=>setRecallPrevious(false),[token,replicaId]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [speaking, setSpeaking] = useState("");
  const [heard, setHeard] = useState<Set<string>>(new Set());
  const [feedbackTurn, setFeedbackTurn] = useState("");
  const [feedbackRevision, setFeedbackRevision] = useState(0);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyScope, setHistoryScope] = useState("");
  const [historyPending, setHistoryPending] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [opening, setOpening] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [needsNewSession, setNeedsNewSession] = useState(false);
  const [canReplaceMissingHistory,setCanReplaceMissingHistory]=useState(false);
  // WS-R167: "It remembers" — the owner's own continuity controls.
  const memoryCopy = t.meetMemory;
  const [memoryOn, setMemoryOn] = useState<boolean | null>(null);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryFacts, setMemoryFacts] = useState<MeetMemoryFact[]>([]);
  const [memoryError, setMemoryError] = useState("");
  const [correctingFactId, setCorrectingFactId] = useState("");
  const [correctionDraft, setCorrectionDraft] = useState("");
  const [relState, setRelState] = useState<MeetRelState | null>(null);
  const [startingFresh, setStartingFresh] = useState(false);
  const [startFreshNotice, setStartFreshNotice] = useState("");
  const scope = `${token}:${replicaId}`;
  const latestScope = useRef(scope); latestScope.current = scope;
  const epoch = useRef(0);
  const readinessRequest = useRef(0);
  const historyRequest = useRef(0);
  const historyAbort = useRef<AbortController | null>(null);
  const sendLock = useRef(false);
  const voiceEpoch = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const blobUrl = useRef("");
  const input = useRef<HTMLTextAreaElement>(null);
  const latest = useRef<HTMLDivElement>(null);
  const stopAudio = useCallback(() => {
    voiceEpoch.current++;
    audio.current?.pause();
    audio.current = null;
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    blobUrl.current = "";
    setSpeaking("");
  }, []);
  const restoreHistory = useCallback(async (currentScope: () => boolean) => {
    const request = ++historyRequest.current;
    const saved = continuity.get(scope) || {};
    const chosen = saved.openingId || saved.sessionId;
    historyAbort.current?.abort();
    const aborter = new AbortController(); historyAbort.current = aborter;
    setHistoryReady(false); setHistoryError(""); setCanReplaceMissingHistory(false);
    try {
      const restored = await readDialogueHistory(token, replicaId, chosen, aborter.signal);
      if (!currentScope() || request !== historyRequest.current) return;
      const recovered = saved.uncertainTrace && restored.exchanges.some(item => item.trace_id === saved.uncertainTrace);
      const observed = recovered || (saved.uncertainTrace && restored.latest_request?.trace_id === saved.uncertainTrace
        && restored.latest_request.state !== "generating");
      const next = { sessionId: restored.session_id || undefined, uncertainTrace: observed ? undefined : saved.uncertainTrace,
        runtimeChanged: saved.runtimeChanged, pendingWork: restored.pending || restored.billing_pending };
      remember(scope, next);
      setExchanges(restored.exchanges); setHistoryScope(scope); setHistoryPending(restored.pending || restored.billing_pending);
      setUncertain(Boolean(next.uncertainTrace)); setHistoryReady(true);
      if (recovered) {
        setDraft(""); setError(copy.errorRecovered);
      }
      return true;
    } catch (cause) {
      if (!currentScope() || request !== historyRequest.current) return;
      setHistoryReady(false);
      const missingPrior = saved.runtimeChanged && chosen && !saved.uncertainTrace && !saved.openingId && !saved.pendingWork
        && cause instanceof ReplicaApiError && cause.status === 409
        && ['dialogue_session_not_authorized','dialogue_runtime_not_active'].includes(cause.data?.error);
      setCanReplaceMissingHistory(Boolean(missingPrior));
      setHistoryError(missingPrior ? copy.errorConversationUnavailable
        : copy.errorRestoreFailed);
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
      return false;
    }
  }, [token, replicaId, scope, onAuthError, copy]);
  const checkReadiness = useCallback(async () => {
    const requestEpoch = epoch.current;
    const request = ++readinessRequest.current;
    const current = () => requestEpoch === epoch.current && request === readinessRequest.current;
    setChecking(true);
    setReadUnavailable(false);
    try {
      const result = await readRuntimeStatus(token, replicaId);
      if (!current()) return;
      if (result?.replica_id !== replicaId || typeof result.active !== "boolean") throw new Error("conversation_readiness_unavailable");
      setRuntime(result);
      if (result.active) await restoreHistory(current);
    } catch (cause) {
      if (!current()) return;
      setRuntime(null);
      setReadUnavailable(true);
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
    } finally { if (current()) setChecking(false); }
  }, [token, replicaId, onAuthError, restoreHistory]);

  useEffect(() => {
    epoch.current++;
    setRuntime(null); setExchanges([]); setDraft(""); setError(""); setHeard(new Set());
    setHistoryReady(false); setHistoryScope(""); setHistoryPending(false); setHistoryError(""); setOpening(false);
    setFeedbackTurn(""); setUncertain(Boolean(continuity.get(scope)?.uncertainTrace));
    setNeedsNewSession(Boolean(continuity.get(scope)?.runtimeChanged));
    setCanReplaceMissingHistory(false);
    setSending(false); sendLock.current = false;
    void checkReadiness();
    return () => { epoch.current++; historyAbort.current?.abort(); stopAudio(); };
  }, [checkReadiness, stopAudio, scope]);
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail as {replica_id?: unknown; capability_id?: unknown} | null;
      if (latestScope.current !== scope || !detail || detail.replica_id !== replicaId
        || typeof detail.capability_id !== 'string'
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(detail.capability_id)) return;
      // The event is an invalidation hint, never authority. Re-read using this owner's token.
      // Preserve old request IDs until history confirms both completion and usage settlement.
      remember(scope, {...continuity.get(scope), runtimeChanged: true});
      epoch.current++; historyRequest.current++; readinessRequest.current++;
      historyAbort.current?.abort(); stopAudio();
      setNeedsNewSession(true); setHistoryReady(false); setHistoryScope(''); setExchanges([]);
      setCanReplaceMissingHistory(false);
      setFeedbackTurn(''); setHeard(new Set()); setRuntime(null); setOpening(false);
      setSending(false); sendLock.current = false;
      setUncertain(Boolean(continuity.get(scope)?.uncertainTrace));
      void checkReadiness();
    };
    window.addEventListener('vyakti:private-runtime-changed', changed);
    return () => window.removeEventListener('vyakti:private-runtime-changed', changed);
  }, [scope, replicaId, checkReadiness, stopAudio]);
  useEffect(() => { if (runtimeStatus?.replica_id === replicaId) setRuntime(runtimeStatus); }, [runtimeStatus, replicaId]);
  useEffect(() => { if (stopped) stopAudio(); }, [stopped, stopAudio]);
  useEffect(() => { latest.current?.scrollIntoView({ block: "nearest", behavior: "instant" }); }, [exchanges.length, sending]);

  const scopedExchanges = historyScope === scope ? exchanges : [];
  const unsettled = scopedExchanges.at(-1)?.answer.billing_state === "reconcile_required";
  // WS-R161 (wave twenty-two). `runtime.text_ready` is a PEER of
  // `runtime.active`, never a replacement (`api/_replica-runtime.js#
  // textBlockers`'s own header) — Meet opens on EITHER. `voiceReady` stays
  // the narrower, ORIGINAL flag: only it gates session opening below, since
  // `vy_replica_runtime_session`/history are FK-bound to the voice
  // capability a text-ready-only replica has none of
  // (`api/_replica-dialogue.js#generateOwnedTextDialogue`'s own header).
  const voiceReady = runtime?.replica_id === replicaId && runtime.active === true;
  const textOnlyReady = runtime?.replica_id === replicaId && !voiceReady && runtime.text_ready === true;
  const runtimeActive = runtime?.replica_id === replicaId && (runtime.active === true || runtime.text_ready === true) && !stopped && !checking && !readUnavailable;

  // WS-R167: load the owner's own memory status/facts/relationship state
  // once the conversation is reachable at all - never before, since these
  // doors require an active self-mode runtime the same way every other
  // door on this screen already does.
  const loadMemory = useCallback(async (currentScope: () => boolean) => {
    if (!latestScope.current || latestScope.current !== scope) return;
    try {
      const on = await readMeetMemoryStatus(token, replicaId);
      if (!currentScope()) return;
      setMemoryOn(on);
      setMemoryError("");
      if (on) {
        const [facts, state] = await Promise.all([readMeetMemoryFacts(token, replicaId), readMeetRelState(token, replicaId)]);
        if (!currentScope()) return;
        setMemoryFacts(facts);
        setRelState(state);
      } else {
        setMemoryFacts([]);
        setRelState(null);
      }
    } catch (cause) {
      if (!currentScope()) return;
      setMemoryError(memoryCopy.errorStatusUnavailable);
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
    }
  }, [token, replicaId, scope, memoryCopy, onAuthError]);
  useEffect(() => {
    const requestEpoch = epoch.current;
    if (runtimeActive) void loadMemory(() => requestEpoch === epoch.current && latestScope.current === scope);
  }, [runtimeActive, loadMemory, scope]);

  async function toggleMemory() {
    if (memoryOn === null || memoryBusy) return;
    setMemoryBusy(true); setMemoryError("");
    try {
      const next = await setMeetMemoryOn(token, replicaId, !memoryOn);
      setMemoryOn(next);
      if (!next) { setMemoryFacts([]); setRelState(null); }
      else { const [facts, state] = await Promise.all([readMeetMemoryFacts(token, replicaId), readMeetRelState(token, replicaId)]); setMemoryFacts(facts); setRelState(state); }
    } catch (cause) {
      setMemoryError(memoryCopy.errorToggleFailed);
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
    } finally { setMemoryBusy(false); }
  }
  function beginCorrection(fact: MeetMemoryFact) { setCorrectingFactId(fact.id); setCorrectionDraft(fact.body); }
  async function saveCorrection() {
    if (!correctingFactId || !correctionDraft.trim() || memoryBusy) return;
    setMemoryBusy(true); setMemoryError("");
    try {
      const updated = await correctMeetMemoryFact(token, replicaId, correctingFactId, correctionDraft.trim());
      setMemoryFacts((current) => current.map((f) => (f.id === correctingFactId ? { ...f, body: updated.body, communication_classification: updated.communication_classification } : f)));
      setCorrectingFactId(""); setCorrectionDraft("");
    } catch (cause) {
      setMemoryError(memoryCopy.errorCorrectFailed);
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
    } finally { setMemoryBusy(false); }
  }
  async function forgetFact(factId: string) {
    if (memoryBusy) return;
    setMemoryBusy(true); setMemoryError("");
    try {
      await forgetMeetMemoryFact(token, replicaId, factId);
      setMemoryFacts((current) => current.filter((f) => f.id !== factId));
    } catch (cause) {
      setMemoryError(memoryCopy.errorForgetFailed);
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
    } finally { setMemoryBusy(false); }
  }
  async function startFresh() {
    if (startingFresh) return;
    setStartingFresh(true); setStartFreshNotice("");
    try {
      const result = await resetMeetRelState(token, replicaId);
      setStartFreshNotice(result.reset ? memoryCopy.startFreshDone : memoryCopy.startFreshNothingOpen);
      if (result.reset) { const state = await readMeetRelState(token, replicaId); setRelState(state); }
    } catch (cause) {
      setStartFreshNotice(memoryCopy.errorToggleFailed);
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
    } finally { setStartingFresh(false); }
  }
  const active = runtimeActive && historyReady && historyScope === scope && !historyPending && !unsettled && !uncertain && !opening && !needsNewSession;
  const lifecycleStopped = lifecycle === undefined ? stopped : ["paused", "revoked", "purging"].includes(lifecycle);
  const privateSelectionUnavailable = runtime?.private_selection === true && runtime.blockers?.includes('private_selection_unavailable');
  const privateTextOnly = runtime?.private_selection === true;
  const readiness = lifecycleStopped ? "stopped" : unsettled ? "reconciling" : checking ? "checking"
    : privateSelectionUnavailable ? "private_unavailable" : readUnavailable || runtime?.replica_id !== replicaId ? "unavailable" : "setup";
  async function openSession() {
    const requestEpoch = epoch.current;
    const saved = continuity.get(scope) || {};
    const id = saved.openingId || crypto.randomUUID();
    remember(scope, { ...saved, openingId: id });
    await openDialogueSession(token, replicaId, id);
    if (requestEpoch === epoch.current && continuity.get(scope)?.openingId === id) remember(scope, { sessionId: id, runtimeChanged: saved.runtimeChanged });
    return id;
  }
  async function startConversation() {
    if (!runtimeActive || sending || opening || historyPending || unsettled || (needsNewSession && (uncertain || (!historyReady&&!canReplaceMissingHistory)))) return;
    const requestEpoch = epoch.current;
    const current = () => requestEpoch === epoch.current;
    setOpening(true); setError(""); setHistoryReady(false); stopAudio();
    try {
      // WS-R161: a text-ready-only conversation is stateless, no session to
      // open (see this file's own `voiceReady` comment above).
      if (voiceReady) await openSession();
      if (!current()) return;
      setDraft(""); setFeedbackTurn(""); setHeard(new Set());
      if (await restoreHistory(current) && current()) {
        remember(scope, {...continuity.get(scope), runtimeChanged: false}); setNeedsNewSession(false);
      }
    } catch (cause) {
      if (!current()) return;
      setHistoryError(copy.errorOpenFailed);
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
    } finally { if (current()) setOpening(false); }
  }
  async function send() {
    const question = draft.trim();
    if (!question || sendLock.current || !active) return;
    sendLock.current = true; setSending(true); setError("");
    const requestEpoch = epoch.current;
    try {
      // WS-R161: a text-ready-only turn carries no session at all — the
      // real door (`generateOwnedTextDialogue`) never reads `session_id`
      // and always answers `session_id: null`.
      const sessionId = voiceReady ? (continuity.get(scope)?.sessionId || await openSession()) : undefined;
      if (requestEpoch !== epoch.current) return;
      const traceId = `dialogue_${crypto.randomUUID().replaceAll("-", "")}`;
      remember(scope, { sessionId, uncertainTrace: traceId });
      const answer = await createDialogueTurn(token, replicaId, question, sessionId, traceId, recallPrevious);
      if ((answer.session_id ?? null) !== (sessionId ?? null)) throw new Error("conversation_response_changed");
      if (continuity.get(scope)?.uncertainTrace === traceId) remember(scope, { ...continuity.get(scope), sessionId, uncertainTrace: undefined,
        pendingWork: answer.billing_state === 'reconcile_required' });
      if (requestEpoch !== epoch.current) return;
      setExchanges(current => [...current, { question, answer }]); setDraft("");
      setUncertain(false);
      if (answer.billing_state === "reconcile_required") setError(copy.errorReplySavedNeedsReconcile);
      // The reply is visible before this bounded request starts. Its own HTTP
      // request awaits the exact owner-only consolidator, then refreshes once;
      // a memory outage never retracts an answer that already completed.
      if (memoryOn) void requestMeetMemoryDrain(token, replicaId, traceId).then(
        () => loadMemory(() => requestEpoch === epoch.current && latestScope.current === scope),
        (cause) => {
          if (requestEpoch !== epoch.current || latestScope.current !== scope) return;
          setMemoryError(memoryCopy.errorStatusUnavailable);
          if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
        },
      );
      input.current?.focus();
    } catch (cause) {
      if (requestEpoch !== epoch.current) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
      else {
        setError(copy.errorReplyFailed);
        setUncertain(Boolean(continuity.get(scope)?.uncertainTrace));
        await restoreHistory(() => requestEpoch === epoch.current);
      }
    } finally {
      if (requestEpoch === epoch.current) { sendLock.current = false; setSending(false); }
    }
  }
  async function speak(answer: ReplicaDialogueTurn) {
    if (speaking === answer.turn_id) { stopAudio(); return; }
    stopAudio();
    if (!answer.can_voice || stopped || privateTextOnly) return;
    const requestEpoch = epoch.current;
    const requestVoice = voiceEpoch.current;
    setSpeaking(answer.turn_id); setError("");
    try {
      const blob = await fetchProtectedTurnVoice(token, replicaId, answer.turn_id);
      if (requestEpoch !== epoch.current || requestVoice !== voiceEpoch.current) return;
      const url = URL.createObjectURL(blob); blobUrl.current = url;
      const player = new Audio(url); audio.current = player;
      player.onended = () => stopAudio();
      player.onerror = () => { stopAudio(); setError(copy.errorAudioPlaybackFailed); };
      await player.play();
      if (requestEpoch === epoch.current && requestVoice === voiceEpoch.current) setHeard(current => new Set(current).add(answer.turn_id));
    } catch {
      if (requestEpoch !== epoch.current || requestVoice !== voiceEpoch.current) return;
      stopAudio(); setError(copy.errorVoiceUnavailable);
    }
  }
  return <section className="expert-conversation" aria-label={copy.ariaLabel}>
    <div className="expert-conversation__status"><span>{active ? copy.statusActive : copy.statusInactive}</span><span>{copy.aiReviewedByYou}</span></div>
    {textOnlyReady && <p role="status" className="expert-conversation__apprentice-notice">{copy.apprenticeVoiceNotice}</p>}
    {(!runtimeActive || unsettled) && <div className="expert-conversation__readiness" role="status">
      <h2>{readiness === "stopped" ? copy.readinessTitle.stopped : readiness === "reconciling" ? copy.readinessTitle.reconciling : readiness === "checking" ? copy.readinessTitle.checking : readiness === 'private_unavailable' ? copy.readinessTitle.privateUnavailable : readiness === "unavailable" ? copy.readinessTitle.unavailable : copy.readinessTitle.setup}</h2>
      <p>{readiness === "stopped" ? copy.readinessBody.stopped
        : readiness === "reconciling" ? copy.readinessBody.reconciling
          : readiness === "checking" ? copy.readinessBody.checking
            : readiness === 'private_unavailable' ? copy.readinessBody.privateUnavailable
            : readiness === "unavailable" ? copy.readinessBody.unavailable
              : copy.readinessBody.setup}</p>
      {(readiness === "setup" || readiness === "unavailable" || readiness === 'private_unavailable') && <div className="expert-conversation__actions">
        {readiness === "setup" && <a className="expert-conversation__setup" href={conversationSetupUrl(replicaId, window.location.search)}>{copy.openConversationSetup}</a>}
        <button type="button" onClick={() => { setError(""); void checkReadiness(); }}>{copy.checkAgain}</button>
      </div>}
      {readiness === 'private_unavailable' && <PrivateSelectionRecovery key={scope} token={token} replicaId={replicaId} onAuthError={onAuthError}/>}
    </div>}
    {runtimeActive && <div className="expert-conversation__actions">
      <button type="button" disabled={sending || opening || historyPending || unsettled || (needsNewSession && (uncertain || (!historyReady&&!canReplaceMissingHistory)))} onClick={() => void startConversation()}>
        {opening ? copy.openingConversation : continuity.get(scope)?.openingId ? copy.retryOpeningConversation : copy.newConversation}
      </button>
      <button type="button" disabled={sending || opening || checking} onClick={() => void checkReadiness()}>{copy.checkConversation}</button>
      <span>{copy.recentCompletedReplies}</span>
    </div>}
    {needsNewSession && <p role="status">{copy.runtimeChangedNotice}</p>}
    {(historyError || (runtimeActive && (historyPending || unsettled || uncertain))) && <p role="status">
      {historyError || (historyPending || unsettled ? copy.historyPendingNotice
        : copy.historyUnconfirmedNotice)}
    </p>}
    {runtimeActive && memoryOn !== null && <section className="expert-conversation__memory" aria-label={memoryCopy.heading}>
      <h2>{memoryCopy.heading}</h2>
      <p>{memoryOn ? memoryCopy.onDescription : memoryCopy.offDescription}</p>
      <button type="button" disabled={memoryBusy} onClick={() => void toggleMemory()}>{memoryOn ? memoryCopy.toggleOff : memoryCopy.toggleOn}</button>
      {memoryError && <p role="alert">{memoryError}</p>}
      {memoryOn && <>
        <h3>{memoryCopy.factsHeading}</h3>
        {!memoryFacts.length && <p>{memoryCopy.factsEmpty}</p>}
        {memoryFacts.length > 0 && <ul className="expert-conversation__memory-facts">
          {memoryFacts.map((fact) => <li key={fact.id}>
            {correctingFactId === fact.id ? <div>
              <label htmlFor={`meet-memory-correct-${fact.id}`}>{memoryCopy.correctPromptLabel}</label>
              <textarea id={`meet-memory-correct-${fact.id}`} rows={2} maxLength={400} value={correctionDraft}
                placeholder={memoryCopy.correctPlaceholder} onChange={(event) => setCorrectionDraft(event.target.value)} />
              <button type="button" disabled={memoryBusy || !correctionDraft.trim()} onClick={() => void saveCorrection()}>{memoryCopy.correctSave}</button>
              <button type="button" onClick={() => { setCorrectingFactId(""); setCorrectionDraft(""); }}>{memoryCopy.correctCancel}</button>
            </div> : <>
              <p>{fact.body}</p>
              <div className="expert-conversation__actions">
                <button type="button" disabled={memoryBusy} onClick={() => beginCorrection(fact)}>{memoryCopy.correctAction}</button>
                <button type="button" disabled={memoryBusy} onClick={() => void forgetFact(fact.id)}>{memoryCopy.forgetAction}</button>
              </div>
            </>}
          </li>)}
        </ul>}
        <h3>{memoryCopy.howWeAreHeading}</h3>
        <button type="button" disabled={startingFresh} onClick={() => void startFresh()}>{memoryCopy.startFreshAction}</button>
        {startFreshNotice && <p role="status">{startFreshNotice}</p>}
        {relState?.has_state === false && <p>{memoryCopy.startFreshNothingOpen}</p>}
      </>}
    </section>}
    <div className="expert-conversation__thread" aria-label="Conversation">
      {!scopedExchanges.length && active && <div className="expert-conversation__empty"><h2>{copy.emptyHeading}</h2><p>{copy.emptyBody}</p><button type="button" onClick={() => { setDraft(copy.emptyStarterQuestion); input.current?.focus(); }}>{copy.emptyStarterButton}</button></div>}
      {scopedExchanges.map(({ question, answer }) => <div className="expert-exchange" key={answer.turn_id}>
        <div className="expert-exchange__question"><span>{copy.youLabel}</span><p>{question}</p></div>
        <article className="expert-exchange__answer"><span>{copy.yourAiLabel}</span><ExpertAnswer text={answer.reply} />
          {answer.has_continuity&&<PrivateConversationSources key={`${scope}:${answer.turn_id}`} token={token} replicaId={replicaId} turnId={answer.turn_id}/>}
          <div className="expert-conversation__actions"><button type="button" disabled={!answer.can_voice || stopped || privateTextOnly} aria-describedby={answer.has_continuity === true && answer.can_voice === false ? `continuity-audio-${answer.turn_id}` : undefined} onClick={() => void speak(answer)}>{speaking === answer.turn_id ? copy.stopAudio : copy.listen}</button><button type="button" aria-expanded={feedbackTurn === answer.turn_id} onClick={() => setFeedbackTurn(feedbackTurn === answer.turn_id ? "" : answer.turn_id)}>{copy.teachCorrection}</button></div>
          {answer.has_continuity === true && answer.can_voice === false && <p id={`continuity-audio-${answer.turn_id}`} lang={continuityAudioLocale} className="expert-conversation__audio-note">{continuityAudioNote}</p>}
          {feedbackTurn === answer.turn_id && <TurnFeedback token={token} replicaId={replicaId} turnId={answer.turn_id} voiceHeard={heard.has(answer.turn_id)} onAuthError={onAuthError} onSaved={() => setFeedbackRevision(current => current + 1)} initialOpen focusedCorrection />}
        </article>
      </div>)}
      {sending && <p className="expert-conversation__working" role="status">{copy.workingStatus}</p>}<div ref={latest} />
    </div>
    <FeedbackDatasetPanel key={replicaId} token={token} replicaId={replicaId} feedbackRevision={feedbackRevision} onAuthError={onAuthError} />
    {error && <p className="expert-conversation__error" role="alert">{error}</p>}
    <form className="expert-conversation__composer" onSubmit={event => { event.preventDefault(); void send(); }}>
      <label className="private-continuity-choice"><input type="checkbox" checked={recallPrevious} disabled={!active||sending} onChange={event=>setRecallPrevious(event.target.checked)}/>{copy.recallPreviousLabel}</label>
      <label htmlFor="expert-question">{copy.askYourAi}</label>
      <textarea ref={input} id="expert-question" rows={2} maxLength={4000} value={historyScope === scope ? draft : ""} disabled={!active} onChange={event => setDraft(event.target.value)} placeholder={copy.questionPlaceholder} />
      <div><span>{copy.privateToThisRelationship}</span><button type="submit" disabled={!active || sending || !draft.trim()}>{sending ? copy.answering : copy.send}</button></div>
    </form>
  </section>;
}
