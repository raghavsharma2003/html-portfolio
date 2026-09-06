import { useCallback, useEffect, useRef, useState } from "react";
import { createDialogueTurn, fetchProtectedTurnVoice } from "./dialogueApi";
import { ReplicaApiError } from "./replicaApi";
import { readRuntimeStatus } from "./runtimeApi";
import type { ReplicaDialogueTurn, ReplicaRuntimeStatus } from "./types";
import TurnFeedback from "./TurnFeedback";

interface VisibleTurn {
  user: string;
  replica: ReplicaDialogueTurn;
}

export default function ReplicaDialogueLab({
  token,
  replicaId,
  stopped,
  onAuthError,
  runtimeStatus,
}: {
  token: string;
  replicaId: string;
  stopped: boolean;
  onAuthError: (cause: unknown) => void;
  runtimeStatus?: ReplicaRuntimeStatus | null;
}) {
  const [runtime, setRuntime] = useState<ReplicaRuntimeStatus | null>(runtimeStatus ?? null);
  const [turns, setTurns] = useState<VisibleTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [speaking, setSpeaking] = useState("");
  const [heardTurns, setHeardTurns] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef("");

  const load = useCallback(async () => {
    try {
      setRuntime(await readRuntimeStatus(token, replicaId));
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : "Private dialogue readiness is unavailable");
    }
  }, [onAuthError, replicaId, token]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (runtimeStatus) setRuntime(runtimeStatus); }, [runtimeStatus]);
  useEffect(() => () => {
    audioRef.current?.pause();
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  async function send() {
    const message = draft.trim();
    if (!message || sending || !runtime?.active) return;
    setSending(true);
    setError("");
    try {
      const turn = await createDialogueTurn(token, replicaId, message, turns.at(-1)?.replica.session_id);
      setTurns((current) => [...current, { user: message, replica: turn }]);
      setDraft("");
      if (turn.billing_state === "reconcile_required") {
        setError("This reply completed, but Azure usage needs operator reconciliation before another paid turn.");
      }
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : "The replica could not answer");
      await load();
    } finally {
      setSending(false);
    }
  }

  async function speak(turn: ReplicaDialogueTurn) {
    if (speaking === turn.turn_id) {
      audioRef.current?.pause();
      setSpeaking("");
      return;
    }
    setError("");
    setSpeaking(turn.turn_id);
    try {
      audioRef.current?.pause();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const blob = await fetchProtectedTurnVoice(token, replicaId, turn.turn_id);
      setHeardTurns((current) => new Set(current).add(turn.turn_id));
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setSpeaking("");
      audio.onerror = () => setSpeaking("");
      await audio.play();
    } catch (cause) {
      setSpeaking("");
      setError(cause instanceof Error ? cause.message : "Protected voice could not be played");
    }
  }

  const active = runtime?.active === true && !stopped;
  return (
    <section className={`dialogue-lab ${active ? "active" : "sealed"}`} aria-labelledby="dialogue-lab-title">
      <div className="dialogue-lab-head">
        <div>
          <p className="eyebrow">Private conversation</p>
          <h2 id="dialogue-lab-title">Talk to your clone privately, in text</h2>
          <p>
            Every answer is generated from the frozen Person Model, owner calibration, this relationship's private state,
            and recent turns. Voice playback can speak only the exact server-issued reply.
          </p>
        </div>
        <span className={`dialogue-state ${active ? "active" : ""}`}>{active ? "PRIVATE · LIVE" : "SEALED"}</span>
      </div>

      {!active ? (
        <div className="dialogue-locked">
          <strong>Conversation stays unavailable until the private runtime passes every gate.</strong>
          <p>No fallback model, generic voice, or partial activation is used.</p>
        </div>
      ) : (
        <>
          <div className="dialogue-thread" aria-live="polite">
            {turns.length ? turns.map(({ user, replica }) => (
              <div className="dialogue-pair" key={replica.turn_id}>
                <p className="dialogue-user">{user}</p>
                <article className="dialogue-replica">
                  <p>{replica.reply}</p>
                  <footer>
                    <span>{replica.delivery.mode} · {replica.delivery.pace} · {Math.round(replica.delivery.intensity * 100)}%</span>
                    <button type="button" disabled={!replica.can_voice} onClick={() => void speak(replica)}>
                      {speaking === replica.turn_id ? "Stop voice" : "Play protected voice"}
                    </button>
                  </footer>
                  <TurnFeedback token={token} replicaId={replicaId} turnId={replica.turn_id} voiceHeard={heardTurns.has(replica.turn_id)} onAuthError={onAuthError} />
                </article>
              </div>
            )) : (
              <div className="dialogue-empty"><strong>Start with something only you would notice.</strong><p>The first turn opens a private, version-bound session.</p></div>
            )}
            {sending ? <div className="dialogue-thinking" role="status">Building an evidence-bound answer...</div> : null}
          </div>
          <form className="dialogue-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <label htmlFor="replica-dialogue-message">Message your replica</label>
            <div>
              <textarea id="replica-dialogue-message" value={draft} maxLength={4_000} rows={2} placeholder="What would I say here?" onChange={(event) => setDraft(event.target.value)} />
              <button className="button primary-button" type="submit" disabled={sending || !draft.trim()}>Send privately</button>
            </div>
          </form>
        </>
      )}
      {error ? <div className="runtime-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")}>Dismiss</button></div> : null}
      <p className="dialogue-trust">Synthetic disclosure and watermarking remain mandatory for audio. Conversation logs are private and erasable; this screen never exposes model, agent, person, storage, or provider identifiers.</p>
    </section>
  );
}
