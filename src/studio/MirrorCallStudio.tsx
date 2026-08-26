// MirrorCallStudio.tsx — the Call tab (WS-Y).
//
// `docs/gurukul/MIRROR-CALL-SPEC.md`: the owner talks to their own clone and
// watches it learn. Three loops run at once and this screen is where all three
// are visible — the fidelity meter (voice), the delta-chip rail (personality),
// and per-turn 👍/👎 with "I'd say it like this" (feedback).
//
// Every decision this file makes that is not obvious:
//
//  - IT NEVER PRETENDS. No mock, no simulated transcript, no local delta
//    generator. When `api/mirror-call.js` is not deployed the tab renders
//    "backend not deployed yet" and the connect button is not offered. A demo
//    mode here would be indistinguishable from the product working.
//  - THE TAP IS THE APPROVAL. A chip renders as APPLIED only when
//    `chipIsApplied()` says the server acknowledged an accept. Tapping accept
//    shows "applying" — not "applied" — and a failed accept goes back to
//    actionable. `MIRROR-CALL-SPEC.md` §laws.
//  - UN-ACTIONED CHIPS ROLL VISIBLY. At call end the rail sweeps them into
//    Review later, on screen, with a count. The spec's requirement is that
//    they go to the ordinary review queue rather than the sheet; the owner
//    seeing it happen is what makes that credible.
//  - THE FIDELITY NUMBER IS LABELLED. Speaker-embedding similarity against
//    this speaker's own printed ceiling, with the caveat always rendered
//    beside it, and there are TWO of them — "how well we can measure you"
//    (grows with pooled audio) and "what the next reply is built from" (the
//    selected ~10s conditioning window). One number would climb beside a
//    clone that mechanically cannot have changed. `readMeasurementFidelity` /
//    `readConditioningFidelity` / `fidelityStatusLine` in the machine file own
//    that copy so it can be tested, not just reviewed.
//  - THE CLONE NEVER OPENS ITS MOUTH FIRST
//    (`clone-initiative-record-has-no-absence`). There is no timer, no idle
//    prompt, no "still there?" — a clone caption exists only as the result of
//    an owner window.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import {
  actionMirrorCallDelta,
  createMirrorCall,
  endMirrorCall,
  fetchMirrorCallTurnVoice,
  getMirrorCallStatus,
  ingestAudioWindow,
  listMirrorCallDeltas,
  MirrorCallBackendAbsent,
  MirrorCallVoiceWarming,
  probeMirrorCallBackend,
  saveMirrorCallTurnFeedback,
  type MirrorCallDelta,
} from "./mirrorCallApi";
import {
  callReducer,
  canCapture,
  canEnd,
  chipIsApplied,
  deferredChips,
  fidelityStatusLine,
  INITIAL_CALL_STATE,
  pendingChips,
  readMeasurementFidelity,
  readConditioningFidelity,
  evidenceLine,
  evidenceStrength,
  FIDELITY_CAVEAT,
  METER_PAIR_NOTE,
  CHIPS_PER_MINUTE,
  type CaptionLine,
  type ChipState,
} from "./mirrorCallMachine";
import { openCallCapture, type CallCapture } from "./callCapture";
import { friendlyError } from "./errorCopy";
import { ReplicaApiError } from "./replicaApi";

type TabKey = "call" | "review";

const KIND_LABEL: Record<MirrorCallDelta["kind"], string> = {
  phrase_habit: "Phrase habit",
  register: "Register",
  boundary: "Boundary",
  fact: "Fact",
  delivery: "Delivery",
};

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function Caption({ line, children }: { line: CaptionLine; children?: ReactNode }) {
  return (
    <article className={`mirror-caption mirror-caption-${line.kind}`}>
      <span className="mirror-caption-who">
        {line.kind === "owner" ? "You" : line.kind === "clone" ? "Your clone" : line.kind === "dropped" ? "Missed" : "Call"}
      </span>
      <p>{line.text}</p>
      {children}
    </article>
  );
}

export default function MirrorCallStudio({
  token,
  replicaId,
  stopped,
  onAuthError,
}: {
  token: string;
  replicaId: string;
  stopped: boolean;
  onAuthError: (cause: unknown) => void;
}) {
  const [state, dispatch] = useReducer(callReducer, INITIAL_CALL_STATE);
  const [tab, setTab] = useState<TabKey>("call");
  const [micLevel, setMicLevel] = useState(0);
  const [autoCutNotice, setAutoCutNotice] = useState(false);
  /** The 202-warming copy, verbatim from the server. Cleared on the next
   *  successful clip, because a stale "starting up" beside a clone that is
   *  already talking is its own small lie. */
  const [voiceWarming, setVoiceWarming] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState<{ turnId: string } | null>(null);
  const captureRef = useRef<CallCapture | null>(null);
  const correctionRef = useRef<CallCapture | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef("");
  const seqRef = useRef(0);
  const threadRef = useRef<HTMLDivElement | null>(null);

  // ── the deployment handshake ────────────────────────────────────────────
  useEffect(() => {
    let live = true;
    dispatch({ type: "PROBE_START" });
    (async () => {
      try {
        const { ops } = await probeMirrorCallBackend(token);
        if (live) dispatch({ type: "PROBE_OK", voiceAvailable: ops.includes("turn_voice") });
      } catch (cause) {
        if (!live) return;
        if (cause instanceof MirrorCallBackendAbsent) {
          dispatch({ type: "PROBE_ABSENT", detail: cause.detail });
          return;
        }
        if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
        const friendly = friendlyError(cause, "The Mirror Call backend could not be reached");
        dispatch({ type: "FAIL", message: `${friendly.headline}. ${friendly.detail}` });
      }
    })();
    return () => { live = false; };
  }, [onAuthError, token]);

  // Mic level poll. rAF rather than an interval so it stops with the tab.
  useEffect(() => {
    if (state.turnPhase !== "capturing") { setMicLevel(0); return; }
    let frame = 0;
    const tick = () => {
      setMicLevel(captureRef.current?.level() ?? 0);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state.turnPhase]);

  // Warming poll. Only runs while warming, and only if the deployment serves
  // `status` — otherwise the copy says the wait is an estimate and the owner
  // is told to try talking when they like.
  useEffect(() => {
    if (state.phase !== "warming" || !state.session) return;
    let live = true;
    const sessionId = state.session.session_id;
    const timer = setInterval(async () => {
      try {
        const status = await getMirrorCallStatus(token, sessionId);
        if (live && status.state === "live") dispatch({ type: "WARM" });
      } catch {
        // A failing status poll is not worth interrupting a call for; the
        // copy already tells the owner the wait is an estimate.
      }
    }, 6_000);
    return () => { live = false; clearInterval(timer); };
  }, [state.phase, state.session, token]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [state.captions.length]);

  useEffect(() => () => {
    void captureRef.current?.close();
    void correctionRef.current?.close();
    audioRef.current?.pause();
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  const fail = useCallback((cause: unknown, context: string) => {
    if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
    if (cause instanceof MirrorCallBackendAbsent) {
      dispatch({ type: "PROBE_ABSENT", detail: cause.detail });
      return;
    }
    const friendly = friendlyError(cause, context);
    dispatch({ type: "FAIL", message: `${friendly.headline}. ${friendly.detail}` });
  }, [onAuthError]);

  async function connect() {
    if (busy) return;
    setBusy(true);
    dispatch({ type: "CONNECT" });
    try {
      const session = await createMirrorCall(token, replicaId);
      seqRef.current = 0;
      captureRef.current = await openCallCapture({
        maxWindowMs: session.window_ms_max,
        onAutoCut: () => setAutoCutNotice(true),
      });
      dispatch({ type: "SESSION_OPEN", session });
    } catch (cause) {
      await captureRef.current?.close();
      captureRef.current = null;
      fail(cause, "The Mirror Call could not start");
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    if (!state.session || busy) return;
    setBusy(true);
    captureRef.current?.discard();
    dispatch({ type: "END" });
    try {
      const result = await endMirrorCall(token, state.session.session_id);
      dispatch({ type: "ENDED", end: result });
      if (result.deferred.length) setTab("review");
    } catch (cause) {
      fail(cause, "The call could not be ended cleanly");
    } finally {
      await captureRef.current?.close();
      captureRef.current = null;
      setBusy(false);
    }
  }

  function startTalking() {
    if (!canCapture(state) || !captureRef.current) return;
    setAutoCutNotice(false);
    try {
      captureRef.current.begin();
      dispatch({ type: "CAPTURE_START" });
    } catch (cause) {
      fail(cause, "The microphone could not open");
    }
  }

  async function sendWindow() {
    const capture = captureRef.current;
    if (!capture || state.turnPhase !== "capturing" || !state.session) return;
    dispatch({ type: "WINDOW_SENDING" });
    try {
      const window = await capture.finish();
      seqRef.current += 1;
      const result = await ingestAudioWindow(token, {
        sessionId: state.session.session_id,
        seq: seqRef.current,
        audio: window.blob,
        durationMs: window.durationMs,
      });
      dispatch({ type: "WINDOW_RESULT", result });
      if (result.turn && result.turn.can_voice && state.voiceAvailable) {
        await speak(result.turn.turn_id);
      } else {
        dispatch({ type: "SPEAK_END" });
      }
    } catch (cause) {
      dispatch({ type: "SPEAK_END" });
      fail(cause, "That window could not be sent");
    }
  }

  function cancelWindow() {
    captureRef.current?.discard();
    setAutoCutNotice(false);
    dispatch({ type: "CAPTURE_CANCEL" });
  }

  async function speak(turnId: string) {
    if (!state.session) return;
    dispatch({ type: "SPEAK_START", turnId });
    try {
      const blob = await fetchMirrorCallTurnVoice(token, { sessionId: state.session.session_id, turnId });
      setVoiceWarming("");
      audioRef.current?.pause();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => dispatch({ type: "SPEAK_END" });
      audio.onerror = () => dispatch({ type: "SPEAK_END" });
      await audio.play();
    } catch (cause) {
      if (cause instanceof MirrorCallBackendAbsent) {
        // The synthesis seam is not wired. Captions only, said out loud —
        // never a substitute voice.
        dispatch({ type: "VOICE_UNAVAILABLE", detail: cause.detail });
        return;
      }
      if (cause instanceof MirrorCallVoiceWarming) {
        // NOT the same state. The seam IS wired and the GPU is booting, so the
        // notice is temporary and the caption still stands. Held in local state
        // rather than flipping `voiceAvailable`, because that flag is
        // permanent-for-this-call by design and a cold start is not.
        setVoiceWarming(cause.message);
        dispatch({ type: "SPEAK_END" });
        return;
      }
      dispatch({ type: "SPEAK_END" });
    }
  }

  async function refreshChips() {
    if (!state.session) return;
    try {
      dispatch({ type: "DELTAS_SYNCED", deltas: await listMirrorCallDeltas(token, state.session.session_id) });
    } catch (cause) {
      fail(cause, "The proposed changes could not be refreshed");
    }
  }

  async function actionChip(chip: ChipState, action: "accept" | "reject") {
    if (!state.session || chip.status !== "proposed") return;
    dispatch({ type: "CHIP_ACTION", deltaId: chip.delta.delta_id, action });
    try {
      const delta = await actionMirrorCallDelta(token, {
        sessionId: state.session.session_id,
        deltaId: chip.delta.delta_id,
        action,
      });
      dispatch({ type: "CHIP_RESULT", delta });
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      const friendly = friendlyError(cause, `This change could not be ${action === "accept" ? "applied" : "dismissed"}`);
      dispatch({ type: "CHIP_FAILED", deltaId: chip.delta.delta_id, message: friendly.detail });
    }
  }

  async function rate(turnId: string, rating: "up" | "down") {
    if (!state.session) return;
    try {
      const saved = await saveMirrorCallTurnFeedback(token, {
        sessionId: state.session.session_id,
        turnId,
        rating,
      });
      dispatch({ type: "RATE_TURN", turnId, rating, deltas: saved.deltas });
    } catch (cause) {
      fail(cause, "That rating could not be saved");
    }
  }

  async function startCorrection(turnId: string) {
    try {
      correctionRef.current = await openCallCapture({ maxWindowMs: 30_000 });
      correctionRef.current.begin();
      setRecording({ turnId });
    } catch (cause) {
      fail(cause, "The microphone could not open for a re-record");
    }
  }

  async function finishCorrection() {
    const capture = correctionRef.current;
    if (!capture || !recording || !state.session) return;
    const turnId = recording.turnId;
    setRecording(null);
    try {
      const window = await capture.finish();
      const saved = await saveMirrorCallTurnFeedback(token, {
        sessionId: state.session.session_id,
        turnId,
        rating: "down",
        correctionAudio: window.blob,
        correctionMs: window.durationMs,
      });
      dispatch({ type: "RATE_TURN", turnId, rating: "down", deltas: saved.deltas });
    } catch (cause) {
      fail(cause, "That re-record could not be saved");
    } finally {
      await capture.close();
      correctionRef.current = null;
    }
  }

  const measurement = useMemo(() => readMeasurementFidelity(state.fidelity), [state.fidelity]);
  const conditioning = useMemo(() => readConditioningFidelity(state.fidelity), [state.fidelity]);
  const proposed = state.chips.filter((chip) => chip.status === "proposed" || chip.status === "accepting" || chip.status === "rejecting");
  const actioned = state.chips.filter((chip) => chip.status === "accepted" || chip.status === "rejected");
  const deferred = deferredChips(state);
  const pending = pendingChips(state);
  const live = state.phase === "live";

  if (stopped) return null;

  return (
    <section className="mirror-call" aria-labelledby="mirror-call-title">
      <div className="mirror-call-head">
        <div>
          <p className="eyebrow">Mirror Call</p>
          <h2 id="mirror-call-title">Talk to your clone and correct it while it listens.</h2>
          <p>
            Your side goes up in windows of up to 30 seconds: speak, send, hear the reply. Nothing it learns
            reaches your sheet until you tap it.
          </p>
        </div>
        <span className={`mirror-state mirror-state-${state.phase}`}>
          {state.phase === "checking" && "CHECKING"}
          {state.phase === "backend_absent" && "NOT DEPLOYED"}
          {state.phase === "idle" && "READY"}
          {state.phase === "connecting" && "CONNECTING"}
          {state.phase === "warming" && "GPU WARMING"}
          {state.phase === "live" && "LIVE"}
          {state.phase === "ending" && "ENDING"}
          {state.phase === "ended" && "ENDED"}
          {state.phase === "failed" && "STOPPED"}
        </span>
      </div>

      <div className="mirror-tabs" role="tablist" aria-label="Mirror Call">
        <button
          type="button" role="tab" id="mirror-tab-call" aria-controls="mirror-panel-call"
          aria-selected={tab === "call"} className={tab === "call" ? "active" : ""}
          onClick={() => setTab("call")}
        >Call</button>
        <button
          type="button" role="tab" id="mirror-tab-review" aria-controls="mirror-panel-review"
          aria-selected={tab === "review"} className={tab === "review" ? "active" : ""}
          onClick={() => setTab("review")}
        >Review later{deferred.length ? ` · ${deferred.length}` : ""}</button>
      </div>

      {state.phase === "backend_absent" ? (
        <div className="mirror-absent" role="status">
          <strong>The Mirror Call backend is not deployed on this environment.</strong>
          <p>
            This tab talks to <code>/api/mirror-call</code>, which answered nothing here ({state.absentDetail}).
            There is no offline demo of a Mirror Call on purpose: a simulated call would look exactly like a
            working one.
          </p>
          <small>What is missing: {["create", "end", "ingest_window", "deltas", "delta_action", "turn_feedback"].join(", ")}.</small>
        </div>
      ) : null}

      {tab === "call" && state.phase !== "backend_absent" ? (
        <div className="mirror-body" id="mirror-panel-call" role="tabpanel" aria-labelledby="mirror-tab-call">
          <div className="mirror-stage">
            <div className="mirror-controls">
              {/* No button at all while the handshake is in flight: an enabled
                  "Start the call" before we know the route exists is a promise
                  the screen cannot keep, and a disabled one is a dead control
                  with no explanation next to it. */}
              {state.phase === "checking" ? (
                <span className="mirror-note">Checking whether this environment has the call backend.</span>
              ) : state.phase === "idle" || state.phase === "ended" || state.phase === "failed" ? (
                <button className="button primary-button" type="button" disabled={busy} onClick={() => void connect()}>
                  {state.phase === "ended" ? "Start another call" : "Start the call"}
                </button>
              ) : (
                <button className="button danger-button" type="button" disabled={!canEnd(state) || busy} onClick={() => void end()}>
                  {state.phase === "ending" ? "Ending..." : "End call"}
                </button>
              )}
            </div>

            {state.phase === "warming" ? (
              <div className="mirror-warming" role="status">
                <span className="mirror-warm-dot" aria-hidden="true" />
                <div>
                  <strong>The voice GPU is cold.</strong>
                  <p>
                    A cold start usually takes two to three minutes. That is an estimate from past starts, not a
                    countdown of anything being measured
                    {state.session?.gpu.estimated_ready_seconds !== null && state.session?.gpu.estimated_ready_seconds !== undefined
                      ? `, and the server's own estimate is about ${Math.round(state.session.gpu.estimated_ready_seconds / 60)} minute(s)`
                      : ""}.
                  </p>
                </div>
              </div>
            ) : null}

            {live ? (
              <div className="mirror-mic">
                <div className="mirror-level" aria-hidden="true">
                  <span style={{ transform: `scaleX(${state.turnPhase === "capturing" ? Math.max(0.04, micLevel) : 0})` }} />
                </div>
                {state.turnPhase === "capturing" ? (
                  <div className="mirror-mic-actions">
                    <button className="button primary-button" type="button" onClick={() => void sendWindow()}>Send this window</button>
                    <button className="text-button" type="button" onClick={cancelWindow}>Discard</button>
                  </div>
                ) : (
                  <button
                    className="button primary-button" type="button"
                    disabled={!canCapture(state)}
                    onClick={startTalking}
                  >
                    {state.turnPhase === "uploading" ? "Transcribing..." : state.turnPhase === "thinking" ? "Your clone is answering..." : state.turnPhase === "speaking" ? "Your clone is speaking..." : "Talk"}
                  </button>
                )}
                <small>
                  {state.turnPhase === "capturing"
                    ? "Recording. The window is capped at 30 seconds. It is sent when you say so, or cut at the cap."
                    : "One window at a time: your side, then its side. This is the cascade lane, not a duplex call."}
                </small>
                {autoCutNotice ? (
                  <p className="mirror-autocut" role="status">
                    The 30-second cap cut this window. Send it and say the rest in the next one. Nothing was quietly dropped.
                  </p>
                ) : null}
                {!state.voiceAvailable ? (
                  <p className="mirror-note">Captions only on this environment. The clone's voice route is not deployed.</p>
                ) : null}
                {state.voiceAvailable && voiceWarming ? (
                  <p className="mirror-note" role="status">{voiceWarming}</p>
                ) : null}
              </div>
            ) : null}

            <div className="mirror-thread" ref={threadRef} aria-live="polite">
              {state.captions.length ? state.captions.map((line) => (
                <Caption key={line.id} line={line}>
                  {line.kind === "clone" && line.turnId ? (
                    <div className="mirror-turn-feedback">
                      <button
                        type="button" aria-label="This sounded like me"
                        className={state.ratedTurns[line.turnId] === "up" ? "rated" : ""}
                        onClick={() => void rate(line.turnId!, "up")}
                      >👍</button>
                      <button
                        type="button" aria-label="This did not sound like me"
                        className={state.ratedTurns[line.turnId] === "down" ? "rated" : ""}
                        onClick={() => void rate(line.turnId!, "down")}
                      >👎</button>
                      {recording?.turnId === line.turnId ? (
                        <button className="text-button" type="button" onClick={() => void finishCorrection()}>Stop and send</button>
                      ) : (
                        <button className="text-button" type="button" disabled={!!recording} onClick={() => void startCorrection(line.turnId!)}>
                          I'd say it like this
                        </button>
                      )}
                    </div>
                  ) : null}
                </Caption>
              )) : (
                <div className="mirror-empty">
                  <strong>Nothing has been said yet.</strong>
                  <p>Your clone answers what you say and never opens a call on its own.</p>
                </div>
              )}
            </div>

            {state.error ? (
              <div className="runtime-error" role="alert">
                <span>{state.error}</span>
                <button type="button" onClick={() => dispatch({ type: "RESET" })}>Dismiss</button>
              </div>
            ) : null}
          </div>

          <aside className="mirror-side">
            <div className="mirror-fidelity">
              <span className="metric-label">Voice fidelity</span>
              {/* TWO meters. They move for different reasons and the note
                  between them says which — a single climbing number beside a
                  clone that mechanically cannot have changed is the honesty
                  defect `mirror-learning.md` §1.1 names (adoption delta A2). */}
              {[measurement, conditioning].map((meter) => (
                <div className="mirror-meter" key={meter.kind}>
                  <div className="mirror-fidelity-head">
                    <span>{meter.label}</span>
                    <strong>{meter.score === null ? "not yet" : meter.score.toFixed(4)}</strong>
                  </div>
                  <div className="mirror-fidelity-track" aria-hidden="true">
                    <span style={{ transform: `scaleX(${meter.ofCeiling ?? 0})` }} />
                  </div>
                  <div className="mirror-fidelity-legend">
                    <span>{meter.ceiling === null ? "no printed ceiling" : `ceiling ${meter.ceiling.toFixed(4)}`}</span>
                    <span>{meter.ofCeiling === null ? "not yet" : `${percent(meter.ofCeiling)} of ceiling`}</span>
                    {meter.kind === "measurement" ? (
                      <>
                        <span>{meter.windows} window{meter.windows === 1 ? "" : "s"}</span>
                        <span>{Math.round(meter.seconds)}s pooled</span>
                        {meter.confidence !== null ? <span>{percent(meter.confidence)} confidence</span> : null}
                      </>
                    ) : (
                      <>
                        <span>{meter.seconds ? `${Math.round(meter.seconds)}s window` : "no window yet"}</span>
                        <span>{meter.selections} re-selection{meter.selections === 1 ? "" : "s"}</span>
                      </>
                    )}
                  </div>
                  <p className="mirror-fidelity-caveat">{meter.caveat}</p>
                  <small>{fidelityStatusLine(meter)}</small>
                </div>
              ))}
              <p className="mirror-fidelity-honesty">{measurement.honesty}</p>
              <p className="mirror-fidelity-honesty">{METER_PAIR_NOTE}</p>
              <p className="mirror-fidelity-caveat">{FIDELITY_CAVEAT}</p>
              {state.reference ? (
                <small>
                  Reference set: {state.reference.consented_windows} consented window
                  {state.reference.consented_windows === 1 ? "" : "s"}, {Math.round(state.reference.total_seconds)}s.
                </small>
              ) : null}
              {state.droppedWindows ? (
                <small className="mirror-dropped-count">
                  {state.droppedWindows} window{state.droppedWindows === 1 ? "" : "s"} did not make it through transcription.
                </small>
              ) : null}
            </div>

            <div className="mirror-rail">
              <div className="mirror-rail-head">
                <span className="metric-label">Proposed changes</span>
                <small>
                  {proposed.length} waiting{pending.length ? ` · ${pending.length} will roll into Review later if you end now` : ""}
                  {state.chipBudget.overflowed ? ` · ${state.chipBudget.overflowed} held back by the ${CHIPS_PER_MINUTE}-per-minute cap` : ""}
                </small>
                {/* The rail is pushed by window results, so this is a repair
                    control, not the main path: a chip mined from a window
                    whose response was lost would otherwise be invisible until
                    the end-of-call sweep. */}
                {live ? <button className="text-button" type="button" onClick={() => void refreshChips()}>Refresh</button> : null}
              </div>
              {proposed.length ? proposed.map((chip) => (
                <article key={chip.delta.delta_id} className={`mirror-chip mirror-chip-${chip.status} mirror-chip-ev-${evidenceStrength(chip.delta)}`}>
                  <span className="mirror-chip-kind">
                    {KIND_LABEL[chip.delta.kind] || chip.delta.kind}
                    {/* The evidence count, on every chip. One call is ~1,800-2,300
                        owner words, under every stylometric floor, so an n=1 chip
                        has to LOOK weaker than an n=9 one (adoption delta A4). */}
                    <em>heard {chip.delta.evidence.occurrences_this_call}x</em>
                  </span>
                  <p className="mirror-chip-proposal">{chip.delta.proposal}</p>
                  <p className="mirror-chip-citation">Because you said “{chip.delta.citation.quote}”</p>
                  <p className="mirror-chip-evidence">{evidenceLine(chip.delta)}</p>
                  <div className="mirror-chip-actions">
                    <button type="button" disabled={chip.status !== "proposed"} onClick={() => void actionChip(chip, "accept")}>
                      {chip.status === "accepting" ? "Applying..." : "Accept"}
                    </button>
                    <button type="button" disabled={chip.status !== "proposed"} onClick={() => void actionChip(chip, "reject")}>
                      {chip.status === "rejecting" ? "Dismissing..." : "Reject"}
                    </button>
                  </div>
                  {chip.error ? <p className="mirror-chip-error" role="alert">{chip.error}</p> : null}
                </article>
              )) : (
                <p className="mirror-rail-empty">
                  {live ? "Nothing mined from this call yet. Chips appear as you talk, each quoting what produced it." : "Chips appear during a call."}
                </p>
              )}
              {actioned.length ? (
                <div className="mirror-rail-actioned">
                  <span className="metric-label">Actioned this call</span>
                  {actioned.map((chip) => (
                    <p key={chip.delta.delta_id} className={chipIsApplied(chip) ? "applied" : "dismissed"}>
                      {chipIsApplied(chip) ? "Applied" : chip.status === "accepted" ? "Accepted, not yet on the sheet" : "Rejected"} · {chip.delta.proposal}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}

      {tab === "review" && state.phase !== "backend_absent" ? (
        <div className="mirror-review" id="mirror-panel-review" role="tabpanel" aria-labelledby="mirror-tab-review">
          <p>
            Nothing here was applied. These are the chips you did not action before the call ended, plus any the
            {" "}{CHIPS_PER_MINUTE}-per-minute rail cap held back so the call did not turn into a stream of questions.
            They went to the ordinary review queue, exactly like a delta mined from an upload.
          </p>
          {deferred.length ? deferred.map((chip) => (
            <article key={chip.delta.delta_id} className="mirror-chip mirror-chip-deferred">
              <span className="mirror-chip-kind">{KIND_LABEL[chip.delta.kind] || chip.delta.kind}</span>
              <p className="mirror-chip-proposal">{chip.delta.proposal}</p>
              <p className="mirror-chip-citation">Because you said “{chip.delta.citation.quote}”</p>
              <p className="mirror-chip-evidence">{evidenceLine(chip.delta)}</p>
              <span className="mirror-chip-state">
                {chip.overflow ? "Never shown · held back by the rail cap · not applied" : "Not applied · review later"}
              </span>
            </article>
          )) : <p className="mirror-rail-empty">Nothing is waiting for review.</p>}
          {state.ended ? (
            <div className="mirror-end-summary">
              <span>{state.ended.accepted_count} accepted · {state.ended.rejected_count} rejected · {state.ended.deferred.length} deferred</span>
              <small>
                {state.ended.finetune.queued
                  ? "A voice fine-tune is queued. It runs on GPU time after the call. This screen will not show it finishing."
                  : `No fine-tune was queued${state.ended.finetune.reason ? ` (${state.ended.finetune.reason.replaceAll("_", " ")})` : ""}.`}
              </small>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
