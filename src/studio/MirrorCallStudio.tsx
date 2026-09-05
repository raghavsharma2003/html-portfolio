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
//
// ── WS-R82: the studio's last four files ───────────────────────────────────
// Every creator-visible string now reads through `t.mirrorCallStudio` (a
// `useStudioLocale()` copy table); "A voice fine-tune is queued." became "A
// voice build is queued." in the process — the same substitution
// `noticeDraftQueued`/`draftVersionLabel` already make elsewhere in this
// table — because `fine-tune` is a banned Rooms-vocabulary word the instant
// this string moved into `copy.ts` (a whole-file copy scan, unlike this
// component's own bare JSX ternary, which the scanner never reached). See
// context/rejected.md#ws-r82-mirror-call-fine-tune-word-surfaced-by-the-move-to-copy-ts.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import {
  actionMirrorCallDelta,
  createMirrorCall,
  endMirrorCall,
  fetchInterviewGaps,
  fetchMirrorCallTurnVoice,
  getMirrorCallStatus,
  ingestAudioWindow,
  listMirrorCallDeltas,
  MirrorCallBackendAbsent,
  probeMirrorCallBackend,
  saveMirrorCallTurnFeedback,
  type InterviewPreview,
  type MirrorCallDelta,
  type MirrorCallMode,
} from "./mirrorCallApi";
import {
  callReducer,
  canCapture,
  canEnd,
  chipIsApplied,
  deferredChips,
  fidelityStatusLine,
  gapEvidenceLine,
  GAP_KIND_LABEL,
  INITIAL_CALL_STATE,
  interviewRemainingMs,
  interviewShouldStop,
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
import { useStudioLocale } from "./localeContext";
import { withCount, withLabel, withPluralCount, type StudioCopy } from "./copy";

type TabKey = "call" | "review";

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function Caption({ line, c, children }: { line: CaptionLine; c: StudioCopy["mirrorCallStudio"]; children?: ReactNode }) {
  return (
    <article className={`mirror-caption mirror-caption-${line.kind}`}>
      <span className="mirror-caption-who">
        {line.kind === "owner" ? c.captionWhoYou : line.kind === "clone" ? c.captionWhoClone : line.kind === "dropped" ? c.captionWhoDropped : c.captionWhoCall}
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
  onInterviewPreview,
}: {
  token: string;
  replicaId: string;
  stopped: boolean;
  onAuthError: (cause: unknown) => void;
  /** WS-R31. Fed up so `StudioShell`'s Meet tab can name the interview's next
   *  topic without a second fetch of the same preview. Additive: `undefined`
   *  means "not looked yet" and `null` means "not offered on this
   *  deployment", the same two-absence rule `preview`'s own state carries. */
  onInterviewPreview?: (preview: InterviewPreview | null | undefined) => void;
}) {
  const { t } = useStudioLocale();
  const c = t.mirrorCallStudio;
  const KIND_LABEL: Record<MirrorCallDelta["kind"], string> = {
    phrase_habit: c.kindPhraseHabit,
    register: c.kindRegister,
    boundary: c.kindBoundary,
    fact: c.kindFact,
    delivery: c.kindDelivery,
  };

  const [state, dispatch] = useReducer(callReducer, INITIAL_CALL_STATE);
  const [tab, setTab] = useState<TabKey>("call");
  const [micLevel, setMicLevel] = useState(0);
  const [autoCutNotice, setAutoCutNotice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState<{ turnId: string } | null>(null);
  // WS-R5. `undefined` is "we have not looked yet", `null` is "this deployment
  // does not serve it". Two absences with different copy, because a missing
  // button and a button we have not decided about yet look the same on screen
  // and are not the same thing.
  const [preview, setPreview] = useState<InterviewPreview | null | undefined>(undefined);
  const [tick, setTick] = useState(0);
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
        const friendly = friendlyError(cause, c.errorMirrorCallBackendUnreachable);
        dispatch({ type: "FAIL", message: `${friendly.headline}. ${friendly.detail}` });
      }
    })();
    return () => { live = false; };
  }, [onAuthError, token, c.errorMirrorCallBackendUnreachable]);

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

  // What the interview would ask, fetched once the handshake says the route is
  // there. It is a preview, so a failure here is never a blocker: the tab keeps
  // working as a calibration call and the interview entry says why it is not
  // offered.
  useEffect(() => {
    if (state.phase !== "idle" || preview !== undefined) return;
    let live = true;
    (async () => {
      try {
        const result = await fetchInterviewGaps(token, replicaId);
        if (live) setPreview(result);
      } catch {
        if (live) setPreview(null);
      }
    })();
    return () => { live = false; };
  }, [preview, replicaId, state.phase, token]);

  // WS-R31. Fire and forget, same rule as every other fed-up callback in this
  // file: a host that does not pass one is unaffected, and a call here never
  // blocks the panel it reports on.
  useEffect(() => { onInterviewPreview?.(preview); }, [onInterviewPreview, preview]);

  // The interview's own clock. One tick a second while an interview is live,
  // and nothing at all otherwise, so a calibration call does not re-render for
  // a timer it does not have.
  useEffect(() => {
    if (state.phase !== "live" || !state.interview) return;
    const timer = setInterval(() => setTick((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, [state.interview, state.phase]);

  // Twenty minutes, then it stops itself. `interviewShouldStop` also fires when
  // every gap has an answer, and it never fires mid-turn: an interview that cut
  // the owner off in the middle of an answer would lose the answer AND the
  // twenty minutes.
  useEffect(() => {
    if (busy || !interviewShouldStop(state)) return;
    void end();
    // `tick` is in the deps on purpose. The stop condition is a function of the
    // clock, and without a dependency that changes with the clock this effect
    // would only re-run when a window arrived, which is exactly the case an
    // abandoned interview does not produce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, state, tick]);

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

  async function connect(mode: MirrorCallMode = "calibrate") {
    if (busy) return;
    setBusy(true);
    dispatch({ type: "CONNECT", mode });
    try {
      const session = await createMirrorCall(token, replicaId, mode);
      seqRef.current = 0;
      captureRef.current = await openCallCapture({
        maxWindowMs: session.window_ms_max,
        onAutoCut: () => setAutoCutNotice(true),
      });
      dispatch({ type: "SESSION_OPEN", session });
    } catch (cause) {
      await captureRef.current?.close();
      captureRef.current = null;
      fail(cause, c.errorMirrorCallCouldNotStart);
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
      fail(cause, c.errorCallCouldNotEndCleanly);
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
      fail(cause, c.errorMicCouldNotOpen);
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
      fail(cause, c.errorWindowCouldNotBeSent);
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
      dispatch({ type: "SPEAK_END" });
    }
  }

  async function refreshChips() {
    if (!state.session) return;
    try {
      dispatch({ type: "DELTAS_SYNCED", deltas: await listMirrorCallDeltas(token, state.session.session_id) });
    } catch (cause) {
      fail(cause, c.errorChangesCouldNotBeRefreshed);
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
      const friendly = friendlyError(cause, action === "accept" ? c.errorChangeCouldNotBeApplied : c.errorChangeCouldNotBeDismissed);
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
      fail(cause, c.errorRatingCouldNotBeSaved);
    }
  }

  async function startCorrection(turnId: string) {
    try {
      correctionRef.current = await openCallCapture({ maxWindowMs: 30_000 });
      correctionRef.current.begin();
      setRecording({ turnId });
    } catch (cause) {
      fail(cause, c.errorMicCouldNotOpenForRerecord);
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
      fail(cause, c.errorRerecordCouldNotBeSaved);
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
    // `id` added by WS-R3: the readiness action table sends a creator here
    // ("Run one Mirror Call"), and `jumpTo` returns silently on a missing
    // target, so an action pointing at nothing would look exactly like a
    // working button. Every anchor in that table is asserted to exist.
    <section id="mirror-call" className="mirror-call" aria-labelledby="mirror-call-title">
      <div className="mirror-call-head">
        <div>
          <p className="eyebrow">{c.eyebrow}</p>
          <h2 id="mirror-call-title">{c.title}</h2>
          <p>{c.pitch}</p>
        </div>
        <span className={`mirror-state mirror-state-${state.phase}`}>
          {state.phase === "checking" && c.stateChecking}
          {state.phase === "backend_absent" && c.stateNotDeployed}
          {state.phase === "idle" && c.stateReady}
          {state.phase === "connecting" && c.stateConnecting}
          {state.phase === "warming" && c.stateGpuWarming}
          {state.phase === "live" && c.stateLive}
          {state.phase === "ending" && c.stateEnding}
          {state.phase === "ended" && c.stateEnded}
          {state.phase === "failed" && c.stateStopped}
        </span>
      </div>

      <div className="mirror-tabs" role="tablist" aria-label={c.tabsAriaLabel}>
        <button
          type="button" role="tab" id="mirror-tab-call" aria-controls="mirror-panel-call"
          aria-selected={tab === "call"} className={tab === "call" ? "active" : ""}
          onClick={() => setTab("call")}
        >{c.callTab}</button>
        <button
          type="button" role="tab" id="mirror-tab-review" aria-controls="mirror-panel-review"
          aria-selected={tab === "review"} className={tab === "review" ? "active" : ""}
          onClick={() => setTab("review")}
        >{withLabel(c.reviewLaterTab, deferred.length ? ` · ${deferred.length}` : "")}</button>
      </div>

      {state.phase === "backend_absent" ? (
        <div className="mirror-absent" role="status">
          <strong>{c.backendAbsentHeadline}</strong>
          <p>{withLabel(c.backendAbsentBodyTemplate, String(state.absentDetail))}</p>
          <small>{withLabel(c.backendAbsentMissing, ["create", "end", "ingest_window", "deltas", "delta_action", "turn_feedback"].join(", "))}</small>
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
                <span className="mirror-note">{c.checkingBackend}</span>
              ) : state.phase === "idle" || state.phase === "ended" || state.phase === "failed" ? (
                <button className="button primary-button" type="button" disabled={busy} onClick={() => void connect("calibrate")}>
                  {state.phase === "ended" ? c.startAnotherCallButton : c.startCallButton}
                </button>
              ) : (
                <button className="button danger-button" type="button" disabled={!canEnd(state) || busy} onClick={() => void end()}>
                  {state.phase === "ending" ? c.endingButton : c.endCallButton}
                </button>
              )}
            </div>

            {/* THE INTERVIEW ENTRY. Offered only before a call, and only when
                the deployment actually serves it: a button that 400s when it is
                pressed is worse than no button. Every gap is rendered with its
                evidence count, because "we have nothing on this" and "we have
                one thing" are different asks and a flat list would hide it. */}
            {(state.phase === "idle" || state.phase === "ended" || state.phase === "failed") ? (
              <div className="mirror-interview-entry">
                <span className="metric-label">{c.interviewLabel}</span>
                <p className="mirror-interview-pitch">{c.interviewPitch}</p>
                {preview === undefined ? (
                  <span className="mirror-note">{c.interviewPreviewWorking}</span>
                ) : preview === null ? (
                  <span className="mirror-note">{c.interviewNotAvailable}</span>
                ) : preview.gaps.length === 0 ? (
                  <span className="mirror-note">{c.interviewNothingOnList}</span>
                ) : (
                  <>
                    <ol className="mirror-gap-list">
                      {preview.gaps.map((gap) => (
                        <li key={gap.gap_id} className={`mirror-gap mirror-gap-${gap.kind}`}>
                          <span className="mirror-gap-kind">{GAP_KIND_LABEL[gap.kind]}</span>
                          <strong>{gap.topic}</strong>
                          <p>{gap.why}</p>
                          <small>{gapEvidenceLine(gap)}</small>
                        </li>
                      ))}
                    </ol>
                    {/* Which detectors could run, beside the list, always. A
                        short list because the material is complete and a short
                        list because a detector could not run are different
                        facts, and only one of them is good news. */}
                    {preview.detectors && !preview.detectors.contradiction ? (
                      <p className="mirror-note">{c.interviewCannotCheckContradiction}</p>
                    ) : null}
                    {preview.detectors && !preview.detectors.readiness ? (
                      <p className="mirror-note">{c.interviewNoReadinessSnapshot}</p>
                    ) : null}
                    {preview.skipped_answered ? (
                      <p className="mirror-note">{withCount(c.interviewSkippedAnsweredTemplate, preview.skipped_answered).split("{isare}").join(preview.skipped_answered === 1 ? "is" : "are")}</p>
                    ) : null}
                    <button
                      className="button primary-button" type="button" disabled={busy}
                      onClick={() => void connect("interview")}
                    >{c.startInterviewButton}</button>
                  </>
                )}
              </div>
            ) : null}

            {/* THE INTERVIEW, WHILE IT IS RUNNING. Counts and time left, and
                nothing that grades an answer: the interview collects material,
                it does not score the person giving it. */}
            {state.interview && (state.phase === "live" || state.phase === "warming") ? (
              <div className="mirror-interview-live" role="status">
                <span className="metric-label">{c.interviewSummaryLabel}</span>
                <p>
                  {c.interviewAnsweredTemplate.split("{n}").join(String(state.interview.answers_captured)).split("{n2}").join(String(state.interview.gaps.length))}
                  {state.interview.questions_asked > state.interview.answers_captured
                    ? c.interviewOneQuestionWaiting
                    : ""}
                  {interviewRemainingMs(state) !== null
                    ? withPluralCount(c.interviewMinutesLeftTemplate, Math.ceil((interviewRemainingMs(state) ?? 0) / 60_000))
                    : ""}.
                </p>
                <small>{c.interviewStopsItselfNote}</small>
              </div>
            ) : null}

            {state.phase === "warming" ? (
              <div className="mirror-warming" role="status">
                <span className="mirror-warm-dot" aria-hidden="true" />
                <div>
                  <strong>{c.gpuColdHeadline}</strong>
                  <p>
                    {withLabel(
                      c.gpuColdBodyTemplate,
                      state.session?.gpu.estimated_ready_seconds !== null && state.session?.gpu.estimated_ready_seconds !== undefined
                        ? withCount(c.gpuColdEstimateTemplate, Math.round(state.session.gpu.estimated_ready_seconds / 60))
                        : "",
                    )}
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
                    <button className="button primary-button" type="button" onClick={() => void sendWindow()}>{c.sendWindowButton}</button>
                    <button className="text-button" type="button" onClick={cancelWindow}>{c.discardButton}</button>
                  </div>
                ) : (
                  <button
                    className="button primary-button" type="button"
                    disabled={!canCapture(state)}
                    onClick={startTalking}
                  >
                    {state.turnPhase === "uploading" ? c.transcribingButton : state.turnPhase === "thinking" ? c.yourAiAnsweringButton : state.turnPhase === "speaking" ? c.yourAiSpeakingButton : c.talkButton}
                  </button>
                )}
                <small>
                  {state.turnPhase === "capturing"
                    ? c.recordingNote
                    : c.oneWindowNote}
                </small>
                {autoCutNotice ? (
                  <p className="mirror-autocut" role="status">{c.autoCutNotice}</p>
                ) : null}
                {!state.voiceAvailable ? (
                  <p className="mirror-note">{c.captionsOnlyNote}</p>
                ) : null}
              </div>
            ) : null}

            <div className="mirror-thread" ref={threadRef} aria-live="polite">
              {state.captions.length ? state.captions.map((line) => (
                <Caption key={line.id} line={line} c={c}>
                  {line.kind === "clone" && line.turnId ? (
                    <div className="mirror-turn-feedback">
                      <button
                        type="button" aria-label={c.soundedLikeMeLabel}
                        className={state.ratedTurns[line.turnId] === "up" ? "rated" : ""}
                        onClick={() => void rate(line.turnId!, "up")}
                      >👍</button>
                      <button
                        type="button" aria-label={c.didNotSoundLikeMeLabel}
                        className={state.ratedTurns[line.turnId] === "down" ? "rated" : ""}
                        onClick={() => void rate(line.turnId!, "down")}
                      >👎</button>
                      {recording?.turnId === line.turnId ? (
                        <button className="text-button" type="button" onClick={() => void finishCorrection()}>{c.stopAndSendButton}</button>
                      ) : (
                        <button className="text-button" type="button" disabled={!!recording} onClick={() => void startCorrection(line.turnId!)}>
                          {c.iWouldSayItLikeThis}
                        </button>
                      )}
                    </div>
                  ) : null}
                </Caption>
              )) : (
                <div className="mirror-empty">
                  <strong>{c.emptyThreadHeadline}</strong>
                  <p>{c.emptyThreadBody}</p>
                </div>
              )}
            </div>

            {state.error ? (
              <div className="runtime-error" role="alert">
                <span>{state.error}</span>
                <button type="button" onClick={() => dispatch({ type: "RESET" })}>{c.dismissButton}</button>
              </div>
            ) : null}
          </div>

          <aside className="mirror-side">
            <div className="mirror-fidelity">
              <span className="metric-label">{c.voiceFidelityLabel}</span>
              {/* TWO meters. They move for different reasons and the note
                  between them says which — a single climbing number beside a
                  clone that mechanically cannot have changed is the honesty
                  defect `mirror-learning.md` §1.1 names (adoption delta A2). */}
              {[measurement, conditioning].map((meter) => (
                <div className="mirror-meter" key={meter.kind}>
                  <div className="mirror-fidelity-head">
                    <span>{meter.label}</span>
                    <strong>{meter.score === null ? "\u2014" : meter.score.toFixed(4)}</strong>
                  </div>
                  <div className="mirror-fidelity-track" aria-hidden="true">
                    <span style={{ transform: `scaleX(${meter.ofCeiling ?? 0})` }} />
                  </div>
                  <div className="mirror-fidelity-legend">
                    <span>{meter.ceiling === null ? c.noCeilingPrinted : withLabel(c.ceilingTemplate, meter.ceiling.toFixed(4))}</span>
                    <span>{meter.ofCeiling === null ? "\u2014" : withLabel(c.ofCeilingTemplate, percent(meter.ofCeiling))}</span>
                    {meter.kind === "measurement" ? (
                      <>
                        <span>{withPluralCount(c.windowsCountTemplate, meter.windows)}</span>
                        <span>{withCount(c.secondsPooledTemplate, Math.round(meter.seconds))}</span>
                        {meter.confidence !== null ? <span>{withLabel(c.confidenceTemplate, percent(meter.confidence))}</span> : null}
                      </>
                    ) : (
                      <>
                        <span>{meter.seconds ? withCount(c.windowOrNoWindowYet, Math.round(meter.seconds)) : c.noWindowYet}</span>
                        <span>{withPluralCount(c.reselectionsTemplate, meter.selections)}</span>
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
                  {c.referenceSetTemplate
                    .split("{n}").join(String(state.reference.consented_windows))
                    .split("{s}").join(state.reference.consented_windows === 1 ? "" : "s")
                    .split("{n2}").join(String(Math.round(state.reference.total_seconds)))}
                </small>
              ) : null}
              {state.droppedWindows ? (
                <small className="mirror-dropped-count">{withPluralCount(c.droppedWindowsTemplate, state.droppedWindows)}</small>
              ) : null}
            </div>

            <div className="mirror-rail">
              <div className="mirror-rail-head">
                <span className="metric-label">{c.proposedChangesLabel}</span>
                <small>
                  {withCount(c.proposedWaitingTemplate, proposed.length)}
                  {pending.length ? withCount(c.willRollIntoReviewTemplate, pending.length) : ""}
                  {state.chipBudget.overflowed ? c.heldBackByCapTemplate.split("{n}").join(String(state.chipBudget.overflowed)).split("{n2}").join(String(CHIPS_PER_MINUTE)) : ""}
                </small>
                {/* The rail is pushed by window results, so this is a repair
                    control, not the main path: a chip mined from a window
                    whose response was lost would otherwise be invisible until
                    the end-of-call sweep. */}
                {live ? <button className="text-button" type="button" onClick={() => void refreshChips()}>{c.refreshButton}</button> : null}
              </div>
              {proposed.length ? proposed.map((chip) => (
                <article key={chip.delta.delta_id} className={`mirror-chip mirror-chip-${chip.status} mirror-chip-ev-${evidenceStrength(chip.delta)}`}>
                  <span className="mirror-chip-kind">
                    {KIND_LABEL[chip.delta.kind] || chip.delta.kind}
                    {/* The evidence count, on every chip. One call is ~1,800-2,300
                        owner words, under every stylometric floor, so an n=1 chip
                        has to LOOK weaker than an n=9 one (adoption delta A4). */}
                    <em>{withCount(c.heardTimesTemplate, chip.delta.evidence.occurrences_this_call)}</em>
                  </span>
                  <p className="mirror-chip-proposal">{chip.delta.proposal}</p>
                  <p className="mirror-chip-citation">{withLabel(c.becauseYouSaidTemplate, chip.delta.citation.quote)}</p>
                  <p className="mirror-chip-evidence">{evidenceLine(chip.delta)}</p>
                  <div className="mirror-chip-actions">
                    <button type="button" disabled={chip.status !== "proposed"} onClick={() => void actionChip(chip, "accept")}>
                      {chip.status === "accepting" ? c.applyingButton : c.acceptButton}
                    </button>
                    <button type="button" disabled={chip.status !== "proposed"} onClick={() => void actionChip(chip, "reject")}>
                      {chip.status === "rejecting" ? c.dismissingButton : c.rejectButton}
                    </button>
                  </div>
                  {chip.error ? <p className="mirror-chip-error" role="alert">{chip.error}</p> : null}
                </article>
              )) : (
                <p className="mirror-rail-empty">
                  {live ? c.nothingMinedLive : c.chipsAppearDuringCall}
                </p>
              )}
              {actioned.length ? (
                <div className="mirror-rail-actioned">
                  <span className="metric-label">{c.actionedThisCallLabel}</span>
                  {actioned.map((chip) => (
                    <p key={chip.delta.delta_id} className={chipIsApplied(chip) ? "applied" : "dismissed"}>
                      {chipIsApplied(chip) ? c.appliedLabel : chip.status === "accepted" ? c.acceptedNotOnSheetLabel : c.rejectedLabel} · {chip.delta.proposal}
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
          {/* WHAT THE INTERVIEW LEARNED, AND WHAT THE NEXT ONE WOULD ASK.
              `effect` is the load-bearing half: an owner who has just answered
              five questions will assume something moved, and nothing did. The
              answers became new material and that is all. */}
          {state.ended?.interview ? (
            <div className="mirror-interview-summary">
              <span className="metric-label">{c.interviewSummaryLabel}</span>
              <p>{c.interviewAskedAnsweredTemplate.split("{n}").join(String(state.ended.interview.questions_asked)).split("{n2}").join(String(state.ended.interview.answers_captured))}</p>
              {state.ended.interview.learned.length ? (
                <>
                  <span className="metric-label">{c.whatItGotLabel}</span>
                  <ul>
                    {state.ended.interview.learned.map((row) => (
                      <li key={`${row.kind}:${row.topic}`}>{row.topic}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mirror-note">{c.interviewNothingBackNote}</p>
              )}
              {state.ended.interview.next_would_ask.length ? (
                <>
                  <span className="metric-label">{c.nextAskLabel}</span>
                  <ul>
                    {state.ended.interview.next_would_ask.map((row) => (
                      <li key={`${row.kind}:${row.topic}`}>
                        <strong>{row.topic}</strong>
                        <small>{row.why}</small>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mirror-note">{c.interviewNothingLeftNote}</p>
              )}
              <p className="mirror-interview-effect">
                {state.ended.interview.effect
                  && !state.ended.interview.effect.voice_changed
                  && !state.ended.interview.effect.persona_changed
                  ? withPluralCount(c.interviewEffectUnchangedTemplate, state.ended.interview.effect.sources_added)
                  : c.interviewEffectUnknownNote}
              </p>
            </div>
          ) : null}
          <p>{withCount(c.reviewNothingApplied, CHIPS_PER_MINUTE)}</p>
          {deferred.length ? deferred.map((chip) => (
            <article key={chip.delta.delta_id} className="mirror-chip mirror-chip-deferred">
              <span className="mirror-chip-kind">{KIND_LABEL[chip.delta.kind] || chip.delta.kind}</span>
              <p className="mirror-chip-proposal">{chip.delta.proposal}</p>
              <p className="mirror-chip-citation">{withLabel(c.becauseYouSaidTemplate, chip.delta.citation.quote)}</p>
              <p className="mirror-chip-evidence">{evidenceLine(chip.delta)}</p>
              <span className="mirror-chip-state">
                {chip.overflow ? c.neverShownHeldBack : c.notAppliedReviewLater}
              </span>
            </article>
          )) : <p className="mirror-rail-empty">{c.reviewEmpty}</p>}
          {state.ended ? (
            <div className="mirror-end-summary">
              <span>
                {c.acceptedRejectedDeferredTemplate
                  .split("{n}").join(String(state.ended.accepted_count))
                  .split("{n2}").join(String(state.ended.rejected_count))
                  .split("{n3}").join(String(state.ended.deferred.length))}
              </span>
              <small>
                {state.ended.finetune.queued
                  ? c.voiceBuildQueuedNote
                  : withLabel(c.noVoiceBuildQueuedTemplate, state.ended.finetune.reason ? ` (${state.ended.finetune.reason.replaceAll("_", " ")})` : "")}
              </small>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
