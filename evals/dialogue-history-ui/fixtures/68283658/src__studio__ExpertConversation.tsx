import { useCallback, useEffect, useRef, useState } from "react";
import { createDialogueTurn, fetchProtectedTurnVoice } from "./dialogueApi";
import { readRuntimeStatus } from "./runtimeApi";
import { ReplicaApiError } from "./replicaApi";
import TurnFeedback from "./TurnFeedback";
import FeedbackDatasetPanel from "./FeedbackDatasetPanel";
import { conversationSetupUrl } from "./conversationSetupNavigation";
import type { ReplicaDialogueTurn, ReplicaLifecycle, ReplicaRuntimeStatus } from "./types";
import "./expert-experience.css";
import "./conversation-setup.css";

type Exchange = { question: string; answer: ReplicaDialogueTurn };
type Props = {
  token: string; replicaId: string; runtimeStatus?: ReplicaRuntimeStatus | null;
  stopped: boolean; onAuthError: (cause: unknown) => void; onReview?: () => void;
  lifecycle?: ReplicaLifecycle;
};

export default function ExpertConversation({ token, replicaId, runtimeStatus, stopped, lifecycle, onAuthError }: Props) {
  const [runtime, setRuntime] = useState(runtimeStatus?.replica_id === replicaId ? runtimeStatus : null);
  const [checking, setChecking] = useState(true);
  const [readUnavailable, setReadUnavailable] = useState(false);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [speaking, setSpeaking] = useState("");
  const [heard, setHeard] = useState<Set<string>>(new Set());
  const [feedbackTurn, setFeedbackTurn] = useState("");
  const [feedbackRevision, setFeedbackRevision] = useState(0);
  const epoch = useRef(0);
  const readinessRequest = useRef(0);
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
    } catch (cause) {
      if (!current()) return;
      setRuntime(null);
      setReadUnavailable(true);
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
    } finally { if (current()) setChecking(false); }
  }, [token, replicaId, onAuthError]);

  useEffect(() => {
    epoch.current++;
    setRuntime(null); setExchanges([]); setDraft(""); setError(""); setHeard(new Set());
    setSending(false); sendLock.current = false;
    void checkReadiness();
    return () => { epoch.current++; stopAudio(); };
  }, [checkReadiness, stopAudio]);
  useEffect(() => { if (runtimeStatus?.replica_id === replicaId) setRuntime(runtimeStatus); }, [runtimeStatus, replicaId]);
  useEffect(() => { if (stopped) stopAudio(); }, [stopped, stopAudio]);
  useEffect(() => { latest.current?.scrollIntoView({ block: "nearest", behavior: "instant" }); }, [exchanges.length, sending]);

  const unsettled = exchanges.at(-1)?.answer.billing_state === "reconcile_required";
  const active = runtime?.replica_id === replicaId && runtime.active === true && !stopped && !checking && !readUnavailable && !unsettled;
  const lifecycleStopped = lifecycle === undefined ? stopped : ["paused", "revoked", "purging"].includes(lifecycle);
  const readiness = lifecycleStopped ? "stopped" : unsettled ? "reconciling" : checking ? "checking"
    : readUnavailable || runtime?.replica_id !== replicaId ? "unavailable" : "setup";
  async function send() {
    const question = draft.trim();
    if (!question || sendLock.current || !active) return;
    sendLock.current = true; setSending(true); setError("");
    const requestEpoch = epoch.current;
    try {
      const answer = await createDialogueTurn(token, replicaId, question, exchanges.at(-1)?.answer.session_id);
      if (requestEpoch !== epoch.current) return;
      setExchanges(current => [...current, { question, answer }]); setDraft("");
      if (answer.billing_state === "reconcile_required") setError("Your reply is saved. We need to reconcile its usage before another reply.");
      input.current?.focus();
    } catch (cause) {
      if (requestEpoch !== epoch.current) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
      else setError("Your AI could not complete this reply. Your message is still here. We have not retried it automatically.");
    } finally {
      if (requestEpoch === epoch.current) { sendLock.current = false; setSending(false); }
    }
  }
  async function speak(answer: ReplicaDialogueTurn) {
    if (speaking === answer.turn_id) { stopAudio(); return; }
    stopAudio();
    if (!answer.can_voice || stopped) return;
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
    {!active && <div className="expert-conversation__readiness" role="status">
      <h2>{readiness === "stopped" ? "This AI is stopped" : readiness === "reconciling" ? "Reply saved" : readiness === "checking" ? "Checking your AI" : readiness === "unavailable" ? "Readiness is unavailable" : "Set up your first conversation"}</h2>
      <p>{readiness === "stopped" ? "Private replies are unavailable for this AI."
        : readiness === "reconciling" ? "We are checking usage before another reply can begin."
          : readiness === "checking" ? "Checking the current server state."
            : readiness === "unavailable" ? "We could not check conversation readiness. Try again."
              : "Check what is still needed before private replies can begin."}</p>
      {(readiness === "setup" || readiness === "unavailable") && <div className="expert-conversation__actions">
        {readiness === "setup" && <a className="expert-conversation__setup" href={conversationSetupUrl(replicaId, window.location.search)}>Open conversation setup</a>}
        <button type="button" onClick={() => { setError(""); void checkReadiness(); }}>Check again</button>
      </div>}
    </div>}
    <div className="expert-conversation__thread" aria-label="Conversation">
      {!exchanges.length && active && <div className="expert-conversation__empty"><h2>Try a real question.</h2><p>Ask something a client would ask you. Listen, then show your AI what you would change.</p><button type="button" onClick={() => { setDraft("What is the first step you would recommend to someone new to my work?"); input.current?.focus(); }}>Help someone get started</button></div>}
      {exchanges.map(({ question, answer }) => <div className="expert-exchange" key={answer.turn_id}>
        <div className="expert-exchange__question"><span>You</span><p>{question}</p></div>
        <article className="expert-exchange__answer"><span>Your AI</span><p>{answer.reply}</p>
          <div className="expert-conversation__actions"><button type="button" disabled={!answer.can_voice || stopped} onClick={() => void speak(answer)}>{speaking === answer.turn_id ? "Stop audio" : "Listen"}</button><button type="button" aria-expanded={feedbackTurn === answer.turn_id} onClick={() => setFeedbackTurn(feedbackTurn === answer.turn_id ? "" : answer.turn_id)}>Teach a correction</button></div>
          {feedbackTurn === answer.turn_id && <TurnFeedback token={token} replicaId={replicaId} turnId={answer.turn_id} voiceHeard={heard.has(answer.turn_id)} onAuthError={onAuthError} onSaved={() => setFeedbackRevision(current => current + 1)} />}
        </article>
      </div>)}
      {sending && <p className="expert-conversation__working" role="status">Your AI is preparing a reply</p>}<div ref={latest} />
    </div>
    <FeedbackDatasetPanel key={replicaId} token={token} replicaId={replicaId} feedbackRevision={feedbackRevision} onAuthError={onAuthError} />
    {error && <p className="expert-conversation__error" role="alert">{error}</p>}
    <form className="expert-conversation__composer" onSubmit={event => { event.preventDefault(); void send(); }}>
      <label htmlFor="expert-question">Ask your AI</label>
      <textarea ref={input} id="expert-question" rows={2} maxLength={4000} value={draft} disabled={!active} onChange={event => setDraft(event.target.value)} placeholder="Bring a question from your work" />
      <div><span>Private to this relationship</span><button type="submit" disabled={!active || sending || !draft.trim()}>{sending ? "Answering" : "Send"}</button></div>
    </form>
  </section>;
}
