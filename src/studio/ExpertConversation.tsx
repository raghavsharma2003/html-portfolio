import PrivateConversationSources from "./PrivateConversationSources";
import PrivateSelectionRecovery from './PrivateSelectionRecovery';
import { useCallback, useEffect, useRef, useState } from "react";
import { createDialogueTurn, fetchProtectedTurnVoice, readDialogueHistory, openDialogueSession } from "./dialogueApi";
import { readRuntimeStatus } from "./runtimeApi";
import { ReplicaApiError } from "./replicaApi";
import TurnFeedback from "./TurnFeedback";
import ExpertAnswer from "./ExpertAnswer";
import FeedbackDatasetPanel from "./FeedbackDatasetPanel";
import { conversationSetupUrl } from "./conversationSetupNavigation";
import type { ReplicaDialogueTurn, ReplicaLifecycle, ReplicaRuntimeStatus } from "./types";
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
  const continuityAudioLocale = new URLSearchParams(window.location.search).get("lang") === "hi" ? "hi" : "en";
  const continuityAudioNote = continuityAudioLocale === "hi"
    ? "पुरानी बातचीत वाले जवाबों में ऑडियो उपलब्ध नहीं है।"
    : "Audio is unavailable for replies using earlier conversations.";
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
        setDraft(""); setError("Your saved reply has been recovered.");
      }
      return true;
    } catch (cause) {
      if (!currentScope() || request !== historyRequest.current) return;
      setHistoryReady(false);
      const missingPrior = saved.runtimeChanged && chosen && !saved.uncertainTrace && !saved.openingId && !saved.pendingWork
        && cause instanceof ReplicaApiError && cause.status === 409
        && ['dialogue_session_not_authorized','dialogue_runtime_not_active'].includes(cause.data?.error);
      setCanReplaceMissingHistory(Boolean(missingPrior));
      setHistoryError(missingPrior ? 'The previous conversation is unavailable. You can explicitly start a new conversation.'
        : "We could not restore this conversation. Check again before sending another message.");
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
      return false;
    }
  }, [token, replicaId, scope, onAuthError]);
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
  const runtimeActive = runtime?.replica_id === replicaId && runtime.active === true && !stopped && !checking && !readUnavailable;
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
      await openSession();
      if (!current()) return;
      setDraft(""); setFeedbackTurn(""); setHeard(new Set());
      if (await restoreHistory(current) && current()) {
        remember(scope, {...continuity.get(scope), runtimeChanged: false}); setNeedsNewSession(false);
      }
    } catch (cause) {
      if (!current()) return;
      setHistoryError("Opening the conversation could not be confirmed. Retry opening to check the same conversation.");
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
    } finally { if (current()) setOpening(false); }
  }
  async function send() {
    const question = draft.trim();
    if (!question || sendLock.current || !active) return;
    sendLock.current = true; setSending(true); setError("");
    const requestEpoch = epoch.current;
    try {
      const sessionId = continuity.get(scope)?.sessionId || await openSession();
      if (requestEpoch !== epoch.current) return;
      const traceId = `dialogue_${crypto.randomUUID().replaceAll("-", "")}`;
      remember(scope, { sessionId, uncertainTrace: traceId });
      const answer = await createDialogueTurn(token, replicaId, question, sessionId, traceId, recallPrevious);
      if (answer.session_id !== sessionId) throw new Error("conversation_response_changed");
      if (continuity.get(scope)?.uncertainTrace === traceId) remember(scope, { ...continuity.get(scope), sessionId, uncertainTrace: undefined,
        pendingWork: answer.billing_state === 'reconcile_required' });
      if (requestEpoch !== epoch.current) return;
      setExchanges(current => [...current, { question, answer }]); setDraft("");
      setUncertain(false);
      if (answer.billing_state === "reconcile_required") setError("Your reply is saved. We need to reconcile its usage before another reply.");
      input.current?.focus();
    } catch (cause) {
      if (requestEpoch !== epoch.current) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
      else {
        setError("Your AI could not complete this reply. Your message is still here. We have not retried it automatically.");
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
      player.onerror = () => { stopAudio(); setError("This audio could not play. Try listening again."); };
      await player.play();
      if (requestEpoch === epoch.current && requestVoice === voiceEpoch.current) setHeard(current => new Set(current).add(answer.turn_id));
    } catch {
      if (requestEpoch !== epoch.current || requestVoice !== voiceEpoch.current) return;
      stopAudio(); setError("Voice playback is unavailable. The text reply is still here.");
    }
  }
  return <section className="expert-conversation" aria-label="Private expert conversation">
    <div className="expert-conversation__status"><span>{active ? "Private conversation" : "Private workspace"}</span><span>AI, reviewed by you</span></div>
    {(!runtimeActive || unsettled) && <div className="expert-conversation__readiness" role="status">
      <h2>{readiness === "stopped" ? "This AI is stopped" : readiness === "reconciling" ? "Reply saved" : readiness === "checking" ? "Checking your AI" : readiness === 'private_unavailable' ? 'Your private version is unavailable' : readiness === "unavailable" ? "Readiness is unavailable" : "Set up your first conversation"}</h2>
      <p>{readiness === "stopped" ? "Private replies are unavailable for this AI."
        : readiness === "reconciling" ? "We are checking usage before another reply can begin."
          : readiness === "checking" ? "Checking the current server state."
            : readiness === 'private_unavailable' ? 'We could not load the selected private version. Check again while we resolve this.'
            : readiness === "unavailable" ? "We could not check conversation readiness. Try again."
              : "Check what is still needed before private replies can begin."}</p>
      {(readiness === "setup" || readiness === "unavailable" || readiness === 'private_unavailable') && <div className="expert-conversation__actions">
        {readiness === "setup" && <a className="expert-conversation__setup" href={conversationSetupUrl(replicaId, window.location.search)}>Open conversation setup</a>}
        <button type="button" onClick={() => { setError(""); void checkReadiness(); }}>Check again</button>
      </div>}
      {readiness === 'private_unavailable' && <PrivateSelectionRecovery key={scope} token={token} replicaId={replicaId} onAuthError={onAuthError}/>}
    </div>}
    {runtimeActive && <div className="expert-conversation__actions">
      <button type="button" disabled={sending || opening || historyPending || unsettled || (needsNewSession && (uncertain || (!historyReady&&!canReplaceMissingHistory)))} onClick={() => void startConversation()}>
        {opening ? "Opening conversation" : continuity.get(scope)?.openingId ? "Retry opening conversation" : "New conversation"}
      </button>
      <button type="button" disabled={sending || opening || checking} onClick={() => void checkReadiness()}>Check conversation</button>
      <span>Recent completed replies</span>
    </div>}
    {needsNewSession && <p role="status">Your private version changed. Start a new conversation after the previous reply is checked.</p>}
    {(historyError || (runtimeActive && (historyPending || unsettled || uncertain))) && <p role="status">
      {historyError || (historyPending || unsettled ? "We are checking the previous reply and its usage. Check the conversation before sending again."
        : "The previous reply could not be confirmed. Check this conversation, or explicitly start a new one. We have not sent your message again.")}
    </p>}
    <div className="expert-conversation__thread" aria-label="Conversation">
      {!scopedExchanges.length && active && <div className="expert-conversation__empty"><h2>Try a real question.</h2><p>Ask something a client would ask you. Listen, then show your AI what you would change.</p><button type="button" onClick={() => { setDraft("What is the first step you would recommend to someone new to my work?"); input.current?.focus(); }}>Help someone get started</button></div>}
      {scopedExchanges.map(({ question, answer }) => <div className="expert-exchange" key={answer.turn_id}>
        <div className="expert-exchange__question"><span>You</span><p>{question}</p></div>
        <article className="expert-exchange__answer"><span>Your AI</span><ExpertAnswer text={answer.reply} />
          {answer.has_continuity&&<PrivateConversationSources key={`${scope}:${answer.turn_id}`} token={token} replicaId={replicaId} turnId={answer.turn_id}/>}
          <div className="expert-conversation__actions"><button type="button" disabled={!answer.can_voice || stopped || privateTextOnly} aria-describedby={answer.has_continuity === true && answer.can_voice === false ? `continuity-audio-${answer.turn_id}` : undefined} onClick={() => void speak(answer)}>{speaking === answer.turn_id ? "Stop audio" : "Listen"}</button><button type="button" aria-expanded={feedbackTurn === answer.turn_id} onClick={() => setFeedbackTurn(feedbackTurn === answer.turn_id ? "" : answer.turn_id)}>Teach a correction</button></div>
          {answer.has_continuity === true && answer.can_voice === false && <p id={`continuity-audio-${answer.turn_id}`} lang={continuityAudioLocale} className="expert-conversation__audio-note">{continuityAudioNote}</p>}
          {feedbackTurn === answer.turn_id && <TurnFeedback token={token} replicaId={replicaId} turnId={answer.turn_id} voiceHeard={heard.has(answer.turn_id)} onAuthError={onAuthError} onSaved={() => setFeedbackRevision(current => current + 1)} />}
        </article>
      </div>)}
      {sending && <p className="expert-conversation__working" role="status">Your AI is preparing a reply</p>}<div ref={latest} />
    </div>
    <FeedbackDatasetPanel key={replicaId} token={token} replicaId={replicaId} feedbackRevision={feedbackRevision} onAuthError={onAuthError} />
    {error && <p className="expert-conversation__error" role="alert">{error}</p>}
    <form className="expert-conversation__composer" onSubmit={event => { event.preventDefault(); void send(); }}>
      <label className="private-continuity-choice"><input type="checkbox" checked={recallPrevious} disabled={!active||sending} onChange={event=>setRecallPrevious(event.target.checked)}/>Use earlier private conversations</label>
      <label htmlFor="expert-question">Ask your AI</label>
      <textarea ref={input} id="expert-question" rows={2} maxLength={4000} value={historyScope === scope ? draft : ""} disabled={!active} onChange={event => setDraft(event.target.value)} placeholder="Bring a question from your work" />
      <div><span>Private to this relationship</span><button type="submit" disabled={!active || sending || !draft.trim()}>{sending ? "Answering" : "Send"}</button></div>
    </form>
  </section>;
}
