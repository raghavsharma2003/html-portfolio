import MirrorTextCorrection from "./MirrorTextCorrection";
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
  attestMirrorCallOwnerSpeaker,
  createMirrorCall,
  endMirrorCall,
  fetchMirrorCallTurnVoice,
  getMirrorCallStatus,
  ingestAudioWindow,
  listMirrorCallDeltas,
  MAX_WINDOW_MS,
  MIRROR_CALL_CONTRACT,
  MirrorCallBackendAbsent,
  MirrorCallCapabilityUnavailable,
  probeMirrorCallBackend,
  saveMirrorCallTurnFeedback,
  MIRROR_AUDIO_CORRECTIONS_SUPPORTED,
  type MirrorCallDelta,
  type MirrorCallSession,
  type MirrorOwnerSpeakerAttestation,
} from "./mirrorCallApi";
import {
  callReducer,
  canCapture,
  canConnect,
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
import {
  clearMirrorCallRecovery,
  createMirrorCallOperationFence,
  readMirrorCallRecovery,
  rememberMirrorCall,
  rememberMirrorCallEnd,
  type MirrorCallRecoveryIntent,
} from "./mirrorCallRecovery";
import { useStudioLocale } from "./localeContext";
import type { MirrorCallStudioCopy } from "./copy";

type TabKey = "call" | "review";

// WS-R166: kind labels moved to the copy registry
// (`src/studio/copy.ts#MirrorCallStudioCopy.kindLabel`); this map is the
// SERVER key (`MirrorCallDelta["kind"]`) to the copy object's own field name,
// never re-typed prose.
const KIND_FIELD: Record<MirrorCallDelta["kind"], keyof MirrorCallStudioCopy["kindLabel"]> = {
  phrase_habit: "phraseHabit",
  register: "register",
  boundary: "boundary",
  fact: "fact",
  delivery: "delivery",
};
function kindLabel(kind: MirrorCallDelta["kind"], copy: MirrorCallStudioCopy): string {
  const field = KIND_FIELD[kind];
  return (field && copy.kindLabel[field]) || kind;
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function clock(at: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(at));
}

function attestationIsTerminal(value: MirrorOwnerSpeakerAttestation | null) {
  return value !== null && value.state !== "needs_owner_choice";
}

function sessionForMirrorCallRecovery(value: MirrorCallRecoveryIntent): MirrorCallSession {
  return {
    session_id: value.sessionId,
    replica_id: value.replicaId,
    contract: MIRROR_CALL_CONTRACT,
    state: "live",
    gpu: { warm: false, estimated_ready_seconds: null },
    window_ms_max: MAX_WINDOW_MS,
    fidelity: null,
    ops: ["end"],
    reply_engine: { available: true, state: "ready", reason: null },
  };
}

function Caption({ line, children }: { line: CaptionLine; children?: ReactNode }) {
  const { t } = useStudioLocale();
  const copy = t.mirrorCallStudio.caption;
  return (
    <article className={`mirror-caption mirror-caption-${line.kind}`}>
      <span className="mirror-caption-who">
        {line.kind === "owner" ? copy.you : line.kind === "clone" ? copy.yourClone : line.kind === "dropped" ? copy.missed : copy.call}
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
  const { t } = useStudioLocale();
  const copy = t.mirrorCallStudio;
  const [state, dispatch] = useReducer(callReducer, INITIAL_CALL_STATE);
  const [tab, setTab] = useState<TabKey>("call");
  const [micLevel, setMicLevel] = useState(0);
  const [autoCutNotice, setAutoCutNotice] = useState(false);
  const [micOpening, setMicOpening] = useState(false);
  const [micError, setMicError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState<{ turnId: string } | null>(null);
  const [speakerAttestation, setSpeakerAttestation] = useState<MirrorOwnerSpeakerAttestation | null>(null);
  const [speakerAttestationBusy, setSpeakerAttestationBusy] = useState<"only_me" | "not_sure_or_other_people" | null>(null);
  const [speakerAttestationError, setSpeakerAttestationError] = useState("");
  const [warmStartedAt, setWarmStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [recoveryIntent, setRecoveryIntent] = useState<MirrorCallRecoveryIntent | null>(() => readMirrorCallRecovery(replicaId));
  const [recoveryNotice, setRecoveryNotice] = useState("");
  const captureRef = useRef<CallCapture | null>(null);
  const correctionRef = useRef<CallCapture | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef("");
  const seqRef = useRef(0);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const recoveryAttemptRef = useRef("");
  // React's `busy` state explains the wait to the screen. These synchronous
  // fences own correctness before that state has had time to render.
  const endFenceRef = useRef(createMirrorCallOperationFence());
  const micFenceRef = useRef(createMirrorCallOperationFence());
  const turnFenceRef = useRef(createMirrorCallOperationFence());

  // ── the deployment handshake ────────────────────────────────────────────
  useEffect(() => {
    let live = true;
    dispatch({ type: "PROBE_START" });
    (async () => {
      try {
        const { ops, replyEngine } = await probeMirrorCallBackend(token);
        if (live) dispatch({
          type: "PROBE_OK",
          voiceAvailable: ops.includes("turn_voice"),
          replyEngineAvailable: replyEngine.available,
        });
      } catch (cause) {
        if (!live) return;
        if (cause instanceof MirrorCallBackendAbsent) {
          dispatch({ type: "PROBE_ABSENT", detail: cause.detail });
          return;
        }
        if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
        const friendly = friendlyError(cause, copy.contexts.backendUnreachable);
        dispatch({ type: "FAIL", message: `${friendly.headline}. ${friendly.detail}` });
      }
    })();
    return () => { live = false; };
  }, [onAuthError, token]);

  useEffect(() => {
    recoveryAttemptRef.current = "";
    setRecoveryIntent(readMirrorCallRecovery(replicaId));
    setRecoveryNotice("");
  }, [replicaId]);

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
        if (live && !status.reply_engine.available) {
          dispatch({ type: "REPLY_ENGINE_UNAVAILABLE" });
          return;
        }
        if (live && status.state === "live") dispatch({ type: "WARM" });
      } catch {
        // A failing status poll is not worth interrupting a call for; the
        // copy already tells the owner the wait is an estimate.
      }
    }, 6_000);
    return () => { live = false; clearInterval(timer); };
  }, [state.phase, state.session, token]);

  useEffect(() => {
    if (state.phase !== "warming") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.phase]);

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
    if (cause instanceof MirrorCallCapabilityUnavailable) {
      dispatch({ type: "REPLY_ENGINE_UNAVAILABLE" });
      return;
    }
    const friendly = friendlyError(cause, context);
    dispatch({ type: "FAIL", message: `${friendly.headline}. ${friendly.detail}` });
  }, [onAuthError]);

  const failEnd = useCallback((cause: unknown, context: string) => {
    if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
    const friendly = friendlyError(cause, context);
    dispatch({ type: "END_FAILED", message: `${friendly.headline}. ${friendly.detail}` });
  }, [onAuthError]);

  function settleEndResult(result: Awaited<ReturnType<typeof endMirrorCall>>, recovered: boolean) {
    dispatch({ type: "ENDED", end: result });
    setSpeakerAttestation(result.speaker_attestation);
    setWarmStartedAt(null);
    if (result.deferred.length) setTab("review");
    if (attestationIsTerminal(result.speaker_attestation)) {
      clearMirrorCallRecovery(replicaId);
      setRecoveryIntent(null);
    } else {
      const current = recoveryIntent
        ?? rememberMirrorCall(replicaId, result.session_id);
      setRecoveryIntent(rememberMirrorCallEnd(current, result.ended_at));
    }
    setRecoveryNotice(recovered
      ? copy.recovery.recoveredEndReceipt
      : "");
  }

  async function connect() {
    if (busy || !canConnect(state)) return;
    setBusy(true);
    setSpeakerAttestation(null);
    setSpeakerAttestationError("");
    const requestedAt = Date.now();
    setWarmStartedAt(requestedAt);
    dispatch({ type: "CONNECT" });
    try {
      const session = await createMirrorCall(token, replicaId);
      seqRef.current = 0;
      setRecoveryIntent(rememberMirrorCall(replicaId, session.session_id, requestedAt));
      setRecoveryNotice("");
      dispatch({ type: "SESSION_OPEN", session });
      if (session.state === "live") setWarmStartedAt(null);
    } catch (cause) {
      await captureRef.current?.close();
      captureRef.current = null;
      setWarmStartedAt(null);
      fail(cause, copy.contexts.couldNotStart);
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    const fence = endFenceRef.current;
    if (!state.session || busy || micFenceRef.current.active || turnFenceRef.current.active || !canEnd(state) || !fence.tryEnter()) return;
    setBusy(true);
    captureRef.current?.discard();
    const current = recoveryIntent
      ?? rememberMirrorCall(replicaId, state.session.session_id);
    setRecoveryIntent(rememberMirrorCallEnd(current));
    dispatch({ type: "END" });
    try {
      const result = await endMirrorCall(token, state.session.session_id);
      settleEndResult(result, false);
    } catch (cause) {
      failEnd(cause, copy.contexts.couldNotEndCleanly);
    } finally {
      await captureRef.current?.close();
      captureRef.current = null;
      fence.leave();
      setBusy(false);
    }
  }

  async function recoverEndReceipt(intent: MirrorCallRecoveryIntent) {
    const fence = endFenceRef.current;
    if (busy || micFenceRef.current.active || turnFenceRef.current.active || !fence.tryEnter()) return;
    setBusy(true);
    setRecoveryNotice(copy.recovery.recovering);
    const session = sessionForMirrorCallRecovery(intent);
    dispatch({ type: "CONNECT" });
    dispatch({ type: "SESSION_OPEN", session });
    dispatch({ type: "END" });
    setRecoveryIntent(rememberMirrorCallEnd(intent));
    try {
      const result = await endMirrorCall(token, intent.sessionId);
      settleEndResult(result, true);
    } catch (cause) {
      setRecoveryNotice(copy.recovery.recoverFailed);
      failEnd(cause, copy.contexts.couldNotRecoverEndReceipt);
    } finally {
      fence.leave();
      setBusy(false);
    }
  }

  useEffect(() => {
    if (state.phase !== "idle" || !recoveryIntent || busy) return;
    if (recoveryAttemptRef.current === recoveryIntent.sessionId) return;
    recoveryAttemptRef.current = recoveryIntent.sessionId;
    void recoverEndReceipt(recoveryIntent);
  }, [busy, recoveryIntent, state.phase]);

  async function startTalking() {
    const fence = micFenceRef.current;
    if (!canCapture(state) || micOpening || endFenceRef.current.active || turnFenceRef.current.active || !fence.tryEnter()) return;
    try {
      setMicError("");
      setMicOpening(true);
      let capture = captureRef.current;
      if (!capture) {
        const pending = openCallCapture({
          maxWindowMs: state.session?.window_ms_max,
          onAutoCut: () => setAutoCutNotice(true),
        });
        let timer = 0;
        try {
          capture = await Promise.race([
            pending,
            new Promise<never>((_, reject) => {
              timer = window.setTimeout(
                () => reject(new Error(copy.mic.permissionTimeout)),
                30_000,
              );
            }),
          ]);
          captureRef.current = capture;
        } catch (cause) {
          // getUserMedia itself cannot be aborted. If the browser resolves its
          // permission prompt after our bound, close that late stream rather
          // than retaining a microphone the owner is no longer using.
          void pending.then((late) => late.close()).catch(() => {});
          const friendly = friendlyError(cause, copy.mic.micCouldNotOpen);
          setMicError(`${friendly.headline}. ${friendly.detail}`);
          return;
        } finally {
          window.clearTimeout(timer);
          setMicOpening(false);
        }
      } else {
        setMicOpening(false);
      }
      setAutoCutNotice(false);
      try {
        capture.begin();
        dispatch({ type: "CAPTURE_START" });
      } catch (cause) {
        const friendly = friendlyError(cause, copy.mic.micCouldNotOpen);
        setMicError(`${friendly.headline}. ${friendly.detail}`);
      }
    } finally {
      fence.leave();
    }
  }

  async function answerSpeakerAttestation(choice: "only_me" | "not_sure_or_other_people") {
    if (!state.session || state.phase !== "ended" || speakerAttestationBusy) return;
    setSpeakerAttestationBusy(choice);
    setSpeakerAttestationError("");
    try {
      const result = await attestMirrorCallOwnerSpeaker(token, state.session.session_id, choice);
      setSpeakerAttestation(result);
      if (attestationIsTerminal(result)) {
        clearMirrorCallRecovery(replicaId);
        setRecoveryIntent(null);
        setRecoveryNotice("Speaker check saved. This tab no longer needs the call recovery record.");
      }
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      const friendly = friendlyError(cause, copy.contexts.speakerCheckCouldNotBeSaved);
      setSpeakerAttestationError(`${friendly.headline}. ${friendly.detail}`);
    } finally {
      setSpeakerAttestationBusy(null);
    }
  }

  async function sendWindow() {
    const capture = captureRef.current;
    const fence = turnFenceRef.current;
    if (!capture || state.turnPhase !== "capturing" || !state.session || endFenceRef.current.active || !fence.tryEnter()) return;
    dispatch({ type: "WINDOW_SENDING" });
    try {
      const window = await capture.finish();
      seqRef.current += 1;
      const result = await ingestAudioWindow(token, {
        replicaId,
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
      fail(cause, copy.contexts.windowCouldNotBeSent);
    } finally {
      fence.leave();
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
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.onpause = () => resolve();
        void audio.play().catch(reject);
      });
      dispatch({ type: "SPEAK_END" });
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
      fail(cause, copy.contexts.proposedChangesCouldNotBeRefreshed);
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
      const friendly = friendlyError(cause, copy.contexts.changeCouldNotBeTemplate.replace("{action}", action === "accept" ? copy.changeApplied : copy.changeDismissed));
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
      fail(cause, copy.contexts.ratingCouldNotBeSaved);
    }
  }

  async function startCorrection(turnId: string) {
    if (!MIRROR_AUDIO_CORRECTIONS_SUPPORTED) return;
    try {
      correctionRef.current = await openCallCapture({ maxWindowMs: 30_000 });
      correctionRef.current.begin();
      setRecording({ turnId });
    } catch (cause) {
      fail(cause, copy.contexts.micCouldNotOpenForRerecord);
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
      fail(cause, copy.contexts.reRecordCouldNotBeSaved);
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
  const speakerChoicePending = state.phase === "ended" && speakerAttestation?.state === "needs_owner_choice";
  const serverReadySeconds = state.session?.gpu.estimated_ready_seconds;
  const observedHighAt = warmStartedAt == null
    ? null
    : warmStartedAt + 8 * 60_000;

  const availability = useMemo(() => {
    const a = copy.availability;
    if (state.phase === "checking") return a.checking;
    if (state.phase === "reply_unavailable") return a.replyUnavailable;
    if (state.phase === "idle" && recoveryIntent) return a.recovering;
    if (state.phase === "idle") return a.idle;
    if (state.phase === "connecting") return a.connecting;
    if (state.phase === "warming") return {
      title: observedHighAt !== null && now > observedHighAt ? a.warming.titleBeyondRange : a.warming.titleNormal,
      phase: a.warming.phase,
      range: serverReadySeconds == null
        ? a.warming.rangeNoEstimate
        : a.warming.rangeWithEstimateTemplate
          .replace("{n}", String(Math.max(1, Math.ceil(serverReadySeconds / 60))))
          .replace("{unit}", Math.ceil(serverReadySeconds / 60) === 1 ? a.warming.minuteSingular : a.warming.minutePlural),
      next: a.warming.next,
      leave: (observedHighAt == null
        ? a.warming.leaveNoObservedHigh
        : (now > observedHighAt ? a.warming.leaveBeyondWindow : a.warming.leaveWithinWindowTemplate.replace("{time}", clock(observedHighAt)))
      ) + (observedHighAt == null ? "" : a.warming.leaveSuffix),
    };
    if (state.phase === "live") return {
      title: a.live.title,
      phase: state.turnPhase === "capturing"
        ? a.live.phaseCapturing
        : state.turnPhase === "uploading"
          ? a.live.phaseUploading
          : state.turnPhase === "thinking"
            ? a.live.phaseThinking
            : state.turnPhase === "speaking"
              ? a.live.phaseSpeaking
              : a.live.phaseIdle,
      range: a.live.range,
      next: state.turnPhase === "idle" ? a.live.nextIdle : a.live.nextTurn,
      leave: state.turnPhase === "idle" ? a.live.leaveIdle : a.live.leaveTurn,
    };
    if (state.phase === "ending") return a.ending;
    if (state.phase === "ended") return {
      title: a.ended.title,
      phase: a.ended.phase,
      range: a.ended.range,
      next: state.ended?.finetune.queued ? a.ended.nextQueued : a.ended.nextNotQueued,
      leave: speakerChoicePending ? a.ended.leaveChoosePending : a.ended.leaveMayLeave,
    };
    if (recoveryIntent) return {
      title: a.recoveryPaused.title,
      phase: state.error || copy.recoveryPausedPhaseFallback,
      range: a.recoveryPaused.range,
      next: a.recoveryPaused.next,
      leave: a.recoveryPaused.leave,
    };
    return {
      title: a.stopped.title,
      phase: state.error || copy.stoppedPhaseFallback,
      range: a.stopped.range,
      next: a.stopped.next,
      leave: a.stopped.leave,
    };
  }, [now, observedHighAt, recoveryIntent, serverReadySeconds, speakerChoicePending, state.ended?.finetune.queued, state.error, state.phase, state.turnPhase, copy]);

  const speakerAttestationCard = state.phase === "ended" && speakerAttestation &&
    speakerAttestation.state !== "not_available" ? (
      <aside className="mirror-speaker-attestation" aria-busy={speakerAttestationBusy !== null}>
        {speakerAttestation.state === "attested" ? (
          <div role="status" aria-live="polite">
            <strong>{copy.speaker.savedHeading}</strong>
            <p>
              {copy.speaker.savedBodyTemplate
                .replace("{n}", String(speakerAttestation.attested_windows))
                .replace("{plural}", speakerAttestation.attested_windows === 1 ? "" : "s")}
            </p>
          </div>
        ) : speakerAttestation.state === "excluded" ? (
          <div role="status" aria-live="polite">
            <strong>{copy.speaker.excludedHeading}</strong>
            <p>{copy.speaker.excludedBody}</p>
          </div>
        ) : speakerAttestation.state === "consent_required" ? (
          <div role="status">
            <strong>{copy.speaker.consentRequiredHeading}</strong>
            <p>
              {copy.speaker.consentRequiredBody}
            </p>
          </div>
        ) : (
          <fieldset>
            <legend>{copy.speaker.questionLegend}</legend>
            <p>
              {copy.speaker.questionBody}
            </p>
            <div className="mirror-speaker-actions">
              <button
                className="button primary-button" type="button"
                disabled={speakerAttestationBusy !== null}
                onClick={() => void answerSpeakerAttestation("only_me")}
              >
                {speakerAttestationBusy === "only_me" ? copy.speaker.saving : copy.speaker.yesOnlyMe}
              </button>
              <button
                className="button" type="button"
                disabled={speakerAttestationBusy !== null}
                onClick={() => void answerSpeakerAttestation("not_sure_or_other_people")}
              >
                {speakerAttestationBusy === "not_sure_or_other_people" ? copy.speaker.saving : copy.speaker.noOrNotSure}
              </button>
            </div>
          </fieldset>
        )}
        {speakerAttestationError ? <p className="mirror-speaker-error" role="alert">{speakerAttestationError}</p> : null}
      </aside>
    ) : null;

  if (stopped) return null;

  return (
    <section className="mirror-call" aria-labelledby="mirror-call-title">
      <div className="mirror-call-head">
        <div>
          <p className="eyebrow">{copy.header.eyebrow}</p>
          <h2 id="mirror-call-title">{copy.header.heading}</h2>
          <p>
            {copy.header.body}
          </p>
        </div>
        <span className={`mirror-state mirror-state-${state.phase}`}>
          {state.phase === "checking" && copy.stateBadge.checking}
          {state.phase === "backend_absent" && copy.stateBadge.notDeployed}
          {state.phase === "reply_unavailable" && copy.stateBadge.waitingOnUs}
          {state.phase === "idle" && copy.stateBadge.ready}
          {state.phase === "connecting" && copy.stateBadge.connecting}
          {state.phase === "warming" && copy.stateBadge.gpuWarming}
          {state.phase === "live" && copy.stateBadge.live}
          {state.phase === "ending" && copy.stateBadge.ending}
          {state.phase === "ended" && copy.stateBadge.ended}
          {state.phase === "failed" && copy.stateBadge.stopped}
        </span>
      </div>

      <div className="mirror-tabs" role="tablist" aria-label={copy.tabs.ariaLabel}>
        <button
          type="button" role="tab" id="mirror-tab-call" aria-controls="mirror-panel-call"
          aria-selected={tab === "call"} className={tab === "call" ? "active" : ""}
          onClick={() => setTab("call")}
        >{copy.tabs.call}</button>
        <button
          type="button" role="tab" id="mirror-tab-review" aria-controls="mirror-panel-review"
          aria-selected={tab === "review"} className={tab === "review" ? "active" : ""}
          onClick={() => setTab("review")}
        >{copy.tabs.reviewLater}{deferred.length ? copy.tabs.countSuffixTemplate.replace("{n}", String(deferred.length)) : ""}</button>
      </div>

      {state.phase !== "backend_absent" ? (
        <aside className="mirror-availability" role="status" aria-live="polite">
          <strong>{availability.title}</strong>
          <p>{availability.phase}</p>
          <dl>
            <div><dt>{copy.availabilityLabels.observedRange}</dt><dd>{availability.range}</dd></div>
            <div><dt>{copy.availabilityLabels.nextCheck}</dt><dd>{availability.next}</dd></div>
            <div><dt>{copy.availabilityLabels.leaveOrReturn}</dt><dd>{availability.leave}</dd></div>
          </dl>
        </aside>
      ) : null}

      {recoveryNotice ? <p className="mirror-recovery-note" role="status">{recoveryNotice}</p> : null}

      {speakerAttestationCard}

      {state.phase === "backend_absent" ? (
        <div className="mirror-absent" role="status">
          <strong>{copy.backendAbsent.heading}</strong>
          <p>
            {copy.backendAbsent.bodyBefore}<code>/api/mirror-call</code>{copy.backendAbsent.bodyAfterTemplate.replace("{detail}", state.absentDetail || "")}
          </p>
          <small>{copy.backendAbsent.missingTemplate.replace("{list}", ["create", "end", "ingest_window", "deltas", "delta_action", "turn_feedback"].join(", "))}</small>
        </div>
      ) : null}

      {state.phase === "reply_unavailable" ? (
        <div className="mirror-capability-unavailable" role="status" aria-live="polite">
          <strong>{copy.replyUnavailable.heading}</strong>
          <p>
            {copy.replyUnavailable.body}
          </p>
          <small>{copy.replyUnavailable.note}</small>
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
                <span className="mirror-note">{copy.controls.checkingNote}</span>
              ) : state.phase === "reply_unavailable" ? (
                state.session ? (
                  <button className="button danger-button" type="button" disabled={busy} onClick={() => void end()}>
                    {busy ? copy.controls.endingCallSetup : copy.controls.endCallSetup}
                  </button>
                ) : null
              ) : state.phase === "failed" && recoveryIntent ? (
                <button className="button primary-button" type="button" disabled={busy} onClick={() => void recoverEndReceipt(recoveryIntent)}>
                  {busy ? copy.controls.recoveringReceipt : copy.controls.recoverEndReceipt}
                </button>
              ) : canConnect(state) ? (
                <button className="button primary-button" type="button" disabled={busy || speakerChoicePending} onClick={() => void connect()}>
                  {speakerChoicePending ? copy.controls.finishSpeakerCheck : state.phase === "ended" ? copy.controls.startAnotherCall : copy.controls.startTheCall}
                </button>
              ) : (
                <button className="button danger-button" type="button" disabled={!canEnd(state) || busy || micOpening} onClick={() => void end()}>
                  {state.phase === "ending"
                    ? copy.controls.ending
                    : state.turnPhase === "uploading" || state.turnPhase === "thinking" || state.turnPhase === "speaking"
                      ? copy.controls.finishReplyBeforeEnding
                      : copy.controls.endCall}
                </button>
              )}
            </div>

            {live ? (
              <div className="mirror-mic">
                <div className="mirror-level" aria-hidden="true">
                  <span style={{ transform: `scaleX(${state.turnPhase === "capturing" ? Math.max(0.04, micLevel) : 0})` }} />
                </div>
                {state.turnPhase === "capturing" ? (
                  <div className="mirror-mic-actions">
                    <button className="button primary-button" type="button" onClick={() => void sendWindow()}>{copy.mic2.sendThisWindow}</button>
                    <button className="text-button" type="button" onClick={cancelWindow}>{copy.mic2.discard}</button>
                  </div>
                ) : (
                  <button
                    className="button primary-button" type="button"
                    disabled={!canCapture(state) || micOpening}
                    onClick={() => void startTalking()}
                  >
                    {micOpening ? copy.mic2.openingMicrophone : state.turnPhase === "uploading" ? copy.mic2.transcribing : state.turnPhase === "thinking" ? copy.mic2.cloneAnswering : state.turnPhase === "speaking" ? copy.mic2.cloneSpeaking : copy.mic2.talk}
                  </button>
                )}
                <small>
                  {state.turnPhase === "capturing"
                    ? copy.mic2.capturingNote
                    : copy.mic2.turnTakingNote}
                </small>
                {autoCutNotice ? (
                  <p className="mirror-autocut" role="status">
                    {copy.mic2.autoCutNote}
                  </p>
                ) : null}
                {micError ? <p className="mirror-autocut" role="alert">{micError}{copy.mic2.micErrorSuffix}</p> : null}
                {!state.voiceAvailable ? (
                  <p className="mirror-note">{copy.mic2.voiceUnavailableNote}</p>
                ) : null}
              </div>
            ) : null}

            <div className="mirror-thread" ref={threadRef} aria-live="polite">
              {state.captions.length ? state.captions.map((line) => (
                <Caption key={line.id} line={line}>
                  {line.kind === "clone" && line.turnId ? (
                    <div className="mirror-turn-feedback">
                      <button
                        type="button" aria-label={copy.thread.soundedLikeMe}
                        className={state.ratedTurns[line.turnId] === "up" ? "rated" : ""}
                        onClick={() => void rate(line.turnId!, "up")}
                      >👍</button>
                      <button
                        type="button" aria-label={copy.thread.didNotSoundLikeMe}
                        className={state.ratedTurns[line.turnId] === "down" ? "rated" : ""}
                        onClick={() => void rate(line.turnId!, "down")}
                      >👎</button>
                      {MIRROR_AUDIO_CORRECTIONS_SUPPORTED && (recording?.turnId === line.turnId ? (
                        <button className="text-button" type="button" onClick={() => void finishCorrection()}>{copy.thread.stopAndSend}</button>
                      ) : (
                        <button className="text-button" type="button" disabled={!!recording} onClick={() => void startCorrection(line.turnId!)}>
                          {copy.thread.idSayItLikeThis}
                        </button>
                      ))}
                      <MirrorTextCorrection onSave={async (note) => {
                        if (!state.session) throw new Error(copy.callNoLongerOpen);
                        const saved = await saveMirrorCallTurnFeedback(token, { sessionId: state.session.session_id, turnId: line.turnId!, rating: "down", note });
                        dispatch({ type: "RATE_TURN", turnId: line.turnId!, rating: "down", deltas: saved.deltas });
                      }} />
                    </div>
                  ) : null}
                </Caption>
              )) : (
                <div className="mirror-empty">
                  <strong>{copy.thread.emptyHeading}</strong>
                  <p>{copy.thread.emptyBody}</p>
                </div>
              )}
            </div>

            {state.error ? (
              <div className="runtime-error" role="alert">
                <span>{state.error}</span>
                <button type="button" onClick={() => dispatch({ type: "RESET" })}>{copy.dismiss}</button>
              </div>
            ) : null}
          </div>

          <aside className="mirror-side">
            <div className="mirror-fidelity">
              <span className="metric-label">{copy.fidelity.heading}</span>
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
                    <span>{meter.ceiling === null ? copy.fidelity.noPrintedCeiling : copy.fidelity.ceilingTemplate.replace("{n}", meter.ceiling.toFixed(4))}</span>
                    <span>{meter.ofCeiling === null ? "\u2014" : copy.fidelity.ofCeilingTemplate.replace("{pct}", percent(meter.ofCeiling))}</span>
                    {meter.kind === "measurement" ? (
                      <>
                        <span>{(meter.windows === 1 ? copy.fidelity.windowSingularTemplate : copy.fidelity.windowPluralTemplate).replace("{n}", String(meter.windows))}</span>
                        <span>{copy.fidelity.secondsPooledTemplate.replace("{n}", String(Math.round(meter.seconds)))}</span>
                        {meter.confidence !== null ? <span>{copy.fidelity.confidenceTemplate.replace("{pct}", percent(meter.confidence))}</span> : null}
                      </>
                    ) : (
                      <>
                        <span>{meter.seconds ? copy.fidelity.windowSecondsTemplate.replace("{n}", String(Math.round(meter.seconds))) : copy.fidelity.noWindowYet}</span>
                        <span>{(meter.selections === 1 ? copy.fidelity.reselectionSingularTemplate : copy.fidelity.reselectionPluralTemplate).replace("{n}", String(meter.selections))}</span>
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
                  {(state.reference.consented_windows === 1 ? copy.fidelity.referenceSetSingularTemplate : copy.fidelity.referenceSetPluralTemplate)
                    .replace("{n}", String(state.reference.consented_windows))
                    .replace("{sec}", String(Math.round(state.reference.total_seconds)))}
                </small>
              ) : null}
              {state.droppedWindows ? (
                <small className="mirror-dropped-count">
                  {(state.droppedWindows === 1 ? copy.fidelity.droppedSingularTemplate : copy.fidelity.droppedPluralTemplate).replace("{n}", String(state.droppedWindows))}
                </small>
              ) : null}
            </div>

            <div className="mirror-rail">
              <div className="mirror-rail-head">
                <span className="metric-label">{copy.rail.heading}</span>
                <small>
                  {copy.rail.waitingTemplate.replace("{n}", String(proposed.length))}{pending.length ? copy.rail.rollIntoReviewTemplate.replace("{n}", String(pending.length)) : ""}
                  {state.chipBudget.overflowed ? copy.rail.heldBackTemplate.replace("{n}", String(state.chipBudget.overflowed)).replace("{cap}", String(CHIPS_PER_MINUTE)) : ""}
                </small>
                {/* The rail is pushed by window results, so this is a repair
                    control, not the main path: a chip mined from a window
                    whose response was lost would otherwise be invisible until
                    the end-of-call sweep. */}
                {live ? <button className="text-button" type="button" onClick={() => void refreshChips()}>{copy.rail.refresh}</button> : null}
              </div>
              {proposed.length ? proposed.map((chip) => (
                <article key={chip.delta.delta_id} className={`mirror-chip mirror-chip-${chip.status} mirror-chip-ev-${evidenceStrength(chip.delta)}`}>
                  <span className="mirror-chip-kind">
                    {kindLabel(chip.delta.kind, copy)}
                    {/* The evidence count, on every chip. One call is ~1,800-2,300
                        owner words, under every stylometric floor, so an n=1 chip
                        has to LOOK weaker than an n=9 one (adoption delta A4). */}
                    <em>{copy.rail.heardTemplate.replace("{n}", String(chip.delta.evidence.occurrences_this_call))}</em>
                  </span>
                  <p className="mirror-chip-proposal">{chip.delta.proposal}</p>
                  <p className="mirror-chip-citation">{copy.rail.becauseYouSaidTemplate.replace("{quote}", chip.delta.citation.quote)}</p>
                  <p className="mirror-chip-evidence">{evidenceLine(chip.delta)}</p>
                  <div className="mirror-chip-actions">
                    <button type="button" disabled={chip.status !== "proposed"} onClick={() => void actionChip(chip, "accept")}>
                      {chip.status === "accepting" ? copy.rail.applying : copy.rail.accept}
                    </button>
                    <button type="button" disabled={chip.status !== "proposed"} onClick={() => void actionChip(chip, "reject")}>
                      {chip.status === "rejecting" ? copy.rail.dismissing : copy.rail.reject}
                    </button>
                  </div>
                  {chip.error ? <p className="mirror-chip-error" role="alert">{chip.error}</p> : null}
                </article>
              )) : (
                <p className="mirror-rail-empty">
                  {live ? copy.rail.emptyLive : copy.rail.emptyIdle}
                </p>
              )}
              {actioned.length ? (
                <div className="mirror-rail-actioned">
                  <span className="metric-label">{copy.rail.actionedThisCall}</span>
                  {actioned.map((chip) => (
                    <p key={chip.delta.delta_id} className={chipIsApplied(chip) ? "applied" : "dismissed"}>
                      {chipIsApplied(chip) ? copy.rail.applied : chip.status === "accepted" ? copy.rail.acceptedNotOnSheet : copy.rail.rejected} · {chip.delta.proposal}
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
            {copy.review.intro.replace("{cap}", String(CHIPS_PER_MINUTE))}
          </p>
          {deferred.length ? deferred.map((chip) => (
            <article key={chip.delta.delta_id} className="mirror-chip mirror-chip-deferred">
              <span className="mirror-chip-kind">{kindLabel(chip.delta.kind, copy)}</span>
              <p className="mirror-chip-proposal">{chip.delta.proposal}</p>
              <p className="mirror-chip-citation">{copy.rail.becauseYouSaidTemplate.replace("{quote}", chip.delta.citation.quote)}</p>
              <p className="mirror-chip-evidence">{evidenceLine(chip.delta)}</p>
              <span className="mirror-chip-state">
                {chip.overflow ? copy.review.neverShown : copy.review.notAppliedReviewLater}
              </span>
            </article>
          )) : <p className="mirror-rail-empty">{copy.review.emptyWaiting}</p>}
          {state.ended ? (
            <div className="mirror-end-summary">
              <span>
                {copy.review.summaryTemplate
                  .replace("{accepted}", String(state.ended.accepted_count))
                  .replace("{rejected}", String(state.ended.rejected_count))
                  .replace("{deferred}", String(state.ended.deferred.length))}
              </span>
              <small>
                {state.ended.finetune.queued
                  ? copy.review.finetuneQueued
                  : copy.review.finetuneNotQueuedTemplate.replace("{reason}", state.ended.finetune.reason ? ` (${state.ended.finetune.reason.replaceAll("_", " ")})` : "")}
              </small>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
