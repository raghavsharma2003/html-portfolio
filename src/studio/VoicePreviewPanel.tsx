// "Preview my voice" — the first place an owner meets their own clone.
//
// VoicePreviewLab (further down the studio, behind the advanced surface) is the
// calibration instrument: seven delivery conditions, blind A/B, a held-out
// gate. This is not that. This is one box, one button, and one honest answer.
//
// The honesty is the design. The GPU runtime scales to zero, so the first
// click of the day genuinely cannot produce audio for about two to eight
// minutes — and every dishonest way of showing that was available and
// rejected: a spinner that runs until the platform kills the request at 240 s,
// a fake progress bar, or an error for a service that is merely asleep. The
// server answers 202 with a warming state; this component shows it, counts
// down, and checks again while the page is open. The intent and latest state
// survive a closed page, but the UI never promises background work it cannot
// prove.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getReplicaReview } from "./processingApi";
import { listeningTestWasTie, readVoiceLikeness, readVoiceListeningHistory } from "./calibrationApi";
import { ReplicaApiError } from "./replicaApi";
import { friendlyError } from "./errorCopy";
import type { ReplicaReview, VoiceLikenessSummary, VoiceListeningHistoryEntry } from "./types";
import { requestVoicePanelPreview, type VoicePanelFailed, type VoicePanelPending } from "./voicePanelApi";
import { disabledReason, type DisabledReason } from "./blockerClass";
import { DisabledAction } from "./BlockerNotice";
import { voicePreviewBlockReason, type WizardInput } from "./wizardModel";
import { useStudioLocale } from "./localeContext";
import type { VoicePreviewPanelCopy } from "./copy";

const MAX_TEXT = 280;

// Shapes, not a phrase bank: three short greetings an owner will immediately
// rewrite. Kept under the cap so the counter never opens on a violation.
type PreviewLanguage = "hi" | "hi-latn" | "en";

// WS-R166: labels/help are studio-chrome and now come from the locale
// registry (`copy.ts#VoicePreviewPanelCopy.languageOptions`); `inputLanguage`
// is a BCP-47 tag fed to the textarea's own `lang` attribute, not prose, so
// it stays a plain constant.
function languageOptions(copy: VoicePreviewPanelCopy): ReadonlyArray<{
  id: PreviewLanguage;
  label: string;
  help: string;
  inputLanguage: string;
}> {
  return [
    { id: "hi", label: copy.languageOptions.hi.label, help: copy.languageOptions.hi.help, inputLanguage: "hi" },
    { id: "hi-latn", label: copy.languageOptions.hiLatn.label, help: copy.languageOptions.hiLatn.help, inputLanguage: "hi-Latn" },
    { id: "en", label: copy.languageOptions.en.label, help: copy.languageOptions.en.help, inputLanguage: "en" },
  ];
}

const WELCOME: Record<PreviewLanguage, string> = {
  hi: "नमस्ते। मैं आपकी आवाज़ से बना एक डिजिटल प्रतिबिंब हूँ। ज़िंदगी हर दिन बदलती है, जैसे पेड़ों के बीच सुबह की रोशनी नया रास्ता खोजती है। मैं आपकी कहानियाँ सुनने, आपके विचार सँभालने और समय के साथ आपके और करीब आने के लिए यहाँ हूँ।",
  "hi-latn": "Namaste. Main aapki voice mein bana ek digital reflection hoon. Life har din badalti hai, jaise morning light pedon ke beech naya raasta banati hai. Main aapki stories sunne, ideas sambhalne aur time ke saath aapke kareeb aane ke liye yahan hoon.",
  en: "Hello. I am a digital reflection shaped by your voice. Life keeps changing, like morning light finding a new path through the trees. I am here to hold your stories, explore your ideas, and grow closer to the way you speak and think over time.",
};

function normalizePersistedLanguage(value: unknown, text: unknown): PreviewLanguage | null {
  if (value === "en" || value === "hi-latn") return value;
  if (value !== "hi") return null;
  return typeof text === "string" && /[\u0900-\u097f]/u.test(text) ? "hi" : "hi-latn";
}

type Phase =
  | { kind: "idle" }
  | { kind: "submitting"; intent: PreviewIntent }
  | { kind: "pending"; intent: PreviewIntent; pending: VoicePanelPending; retryAt: number; joined: boolean }
  | { kind: "ready"; intent: PreviewIntent; url: string; intentId: string; reused: boolean; generationId: string; modelCommitment: string; textPlanSha256: string; transformationCount: number; spokenText: string }
  | { kind: "failed"; intent: PreviewIntent; failure: VoicePanelFailed }
  | { kind: "error"; headline: string; detail: string; canRetry: boolean };

const OBSERVED_COLD_LOW_SECONDS = 120;
const OBSERVED_COLD_HIGH_SECONDS = 480;
const INTENT_KEY_PREFIX = "vy.voicePreview.intent.";
const INTENT_CHANNEL = "vy.voicePreview.intent.v1";
const RESUMABLE_MS = 2 * 60 * 60_000;

/** The immutable browser copy of one server-owned preview intent. The server's
 * semantic identity is authoritative. localStorage and BroadcastChannel only
 * help another tab replay this exact POST sooner; neither can create identity. */
interface PreviewIntent {
  text: string;
  language: PreviewLanguage;
  genomeVersion: number;
  regenerationKey?: string;
  intentId?: string;
  startedAt: string;
}

function intentStorageKey(replicaId: string): string {
  return `${INTENT_KEY_PREFIX}${replicaId}`;
}

function intentSignature(intent: PreviewIntent): string {
  return JSON.stringify([
    intent.genomeVersion,
    intent.language,
    intent.text,
    intent.regenerationKey ?? "",
  ]);
}

function readPersistedIntent(replicaId: string): PreviewIntent | null {
  try {
    const raw = window.localStorage.getItem(intentStorageKey(replicaId));
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || typeof value.text !== "string" ||
        typeof value.genomeVersion !== "number" || typeof value.startedAt !== "string") return null;
    const startedAt = Date.parse(value.startedAt);
    if (!Number.isFinite(startedAt) || startedAt < Date.now() - RESUMABLE_MS) return null;
    const language = normalizePersistedLanguage(value.language, value.text);
    if (!language) return null;
    return {
      text: value.text,
      language,
      genomeVersion: value.genomeVersion,
      regenerationKey: typeof value.regenerationKey === "string" ? value.regenerationKey : undefined,
      intentId: typeof value.intentId === "string" ? value.intentId : undefined,
      startedAt: new Date(startedAt).toISOString(),
    };
  } catch {
    // Private browsing can block local storage. The server still deduplicates
    // every exact request; this only removes the sibling-tab convenience.
    return null;
  }
}

function writePersistedIntent(replicaId: string, value: PreviewIntent) {
  try {
    const key = intentStorageKey(replicaId);
    const next = JSON.stringify(value);
    if (window.localStorage.getItem(key) !== next) window.localStorage.setItem(key, next);
  } catch {
    // The server remains authoritative when local storage is unavailable.
  }
}

function clearPersistedIntent(replicaId: string) {
  try {
    window.localStorage.removeItem(intentStorageKey(replicaId));
  } catch {
    // Nothing to clear if storage was unavailable.
  }
}

function clock(at: string | number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(at));
}

function elapsedLabel(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// WS-R155: "Sounds like you" on this exact screen (SPEC-GURUKUL.md #8.2).
// Three honest states, never a fabricated number -- api/_replica-voice-
// preview.js's own ownedVoiceLikenessSummary names them precisely
// (pass/warn/fail, not_measured, no_voice_yet), and this card renders each
// one rather than collapsing them into a single "no score" line.
function formatLikenessDate(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
  } catch {
    return value;
  }
}

function VoiceLikenessCard({
  likeness,
  lastListeningTest,
}: {
  likeness: VoiceLikenessSummary | null;
  lastListeningTest: VoiceListeningHistoryEntry | null;
}) {
  const { t } = useStudioLocale();
  const copy = t.voicePreviewPanel.likeness;
  if (!likeness) return null;
  const { fidelity } = likeness;
  const measured = fidelity.status === "pass" || fidelity.status === "warn" || fidelity.status === "fail";
  return (
    <section className="voice-likeness" aria-label={copy.ariaLabel}>
      <h3>{copy.heading}</h3>
      {measured && fidelity.score?.mean != null ? (
        <p className="voice-likeness-score">
          <strong>{copy.scoreTemplate.replace("{n}", String(Math.round(fidelity.score.mean * 100)))}</strong>
          {fidelity.computed_at ? copy.measuredOnTemplate.replace("{date}", formatLikenessDate(fidelity.computed_at)) : "."}
          {fidelity.stale ? copy.stale : ""}
        </p>
      ) : (
        <p className="voice-likeness-score">{fidelity.trigger || copy.notMeasuredYet}</p>
      )}
      {lastListeningTest ? (
        <p className="voice-likeness-preference">
          {(listeningTestWasTie(lastListeningTest) ? copy.tieTemplate : copy.preferredTemplate)
            .replace("{date}", formatLikenessDate(lastListeningTest.created_at))}
        </p>
      ) : (
        <p className="voice-likeness-preference">{copy.noListeningTestYet}</p>
      )}
    </section>
  );
}

function stageLabel(pending: VoicePanelPending, copy: VoicePreviewPanelCopy["stage"]): string {
  if (pending.state === "processing") {
    if (/protect|watermark|seal/u.test(`${pending.phase} ${pending.stage}`)) return copy.protecting;
    return copy.generating;
  }
  if (/queue|admission/u.test(`${pending.phase} ${pending.stage}`)) return copy.waitingForRuntime;
  return copy.wakingRuntime;
}

export default function VoicePreviewPanel({ token, replicaId, wizardInput, onAuthError, onManageSources, testEnvironment = false }: {
  token: string;
  replicaId: string;
  /** So the "no draft yet" reason can be DERIVED from the same wizard state
   *  the rail reads, rather than a class hardcoded in this file. See
   *  `wizardModel.voicePreviewBlockReason` for the production defect this
   *  closes: this panel used to say "us" unconditionally, which was backwards
   *  whenever the true blocker was the owner's own identity, liveness, or an
   *  unreviewed evidence set sitting in Processing Review. */
  wizardInput: WizardInput;
  onAuthError: (cause: unknown) => void;
  onManageSources?: () => void;
  testEnvironment?: boolean;
}) {
  const { t } = useStudioLocale();
  const copy = t.voicePreviewPanel;
  const [review, setReview] = useState<ReplicaReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [likeness, setLikeness] = useState<VoiceLikenessSummary | null>(null);
  const [listeningHistory, setListeningHistory] = useState<VoiceListeningHistoryEntry[]>([]);
  const [language, setLanguage] = useState<PreviewLanguage>("hi-latn");
  const [text, setText] = useState<string>(WELCOME["hi-latn"]);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [remaining, setRemaining] = useState(0);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [syncSignal, setSyncSignal] = useState(0);
  const [composerDirty, setComposerDirty] = useState(false);
  const [remoteIntent, setRemoteIntent] = useState<PreviewIntent | null>(null);
  const urlRef = useRef<string>("");
  const requestInFlightRef = useRef(false);
  const activeIntentRef = useRef<string>("");
  const channelRef = useRef<BroadcastChannel | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  // Runs the restore check exactly once per mount, after the review fetch
  // below has had a chance to answer. Not a dependency-array guard: `draft`
  // is a fresh object every render once `review` is set, so gating on
  // `draft` alone would fire the restore attempt again on every unrelated
  // re-render.
  const restoredRef = useRef(false);

  const draft = useMemo(
    () => review?.voice_genomes.find((item) => item.status === "draft") ?? null,
    [review],
  );
  const lineage = useMemo(() => {
    if (!draft || !review) return [];
    const sourceIds = Array.isArray(draft.source_ids) ? draft.source_ids : [];
    const references = Array.isArray(draft.references) ? draft.references : [];
    return sourceIds.map((sourceId) => {
      const source = review.sources.find((item) => item.source_id === sourceId);
      const reference = references.find((item) => item.source_id === sourceId);
      return { sourceId, source, reference };
    });
  }, [draft, review]);
  const overLimit = Array.from(text).length > MAX_TEXT;

  useEffect(() => {
    let live = true;
    setLoading(true);
    getReplicaReview(token, replicaId)
      .then((value) => { if (live) setReview(value); })
      .catch((cause) => {
        if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [onAuthError, replicaId, token]);

  // WS-R155: "sounds like you" and the owner's last blind listening
  // preference. A separate effect from the review fetch above -- this reads
  // a different door (/api/replica-calibration) and a failure here must
  // never block the rest of the panel from rendering.
  useEffect(() => {
    let live = true;
    Promise.all([readVoiceLikeness(token, replicaId), readVoiceListeningHistory(token, replicaId)])
      .then(([likenessValue, historyValue]) => {
        if (!live) return;
        setLikeness(likenessValue);
        setListeningHistory(historyValue);
      })
      .catch((cause) => {
        if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
      });
    return () => { live = false; };
  }, [onAuthError, replicaId, token]);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    channelRef.current?.close();
  }, []);

  useEffect(() => {
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  // A storage event is the widest browser fallback; BroadcastChannel makes a
  // second live tab respond immediately. Both only request a status replay.
  // The SQL semantic key decides whether work is shared.
  useEffect(() => {
    const receiveStorage = (event: StorageEvent) => {
      if (event.key === intentStorageKey(replicaId) && event.newValue) setSyncSignal((value) => value + 1);
    };
    window.addEventListener("storage", receiveStorage);
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(INTENT_CHANNEL);
      channelRef.current = channel;
      channel.onmessage = (event) => {
        if (event.data?.type === "preview-intent" && event.data?.replicaId === replicaId) {
          setSyncSignal((value) => value + 1);
        }
      };
    }
    return () => {
      window.removeEventListener("storage", receiveStorage);
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, [replicaId]);

  const runIntent = useCallback(async (intent: PreviewIntent, joined = false) => {
    if (!draft || requestInFlightRef.current || !navigator.onLine) return;
    const signature = intentSignature(intent);
    activeIntentRef.current = signature;
    requestInFlightRef.current = true;
    setPhase((current) => current.kind === "pending" && intentSignature(current.intent) === signature
      ? current
      : { kind: "submitting", intent });
    try {
      const outcome = await requestVoicePanelPreview(token, {
        replicaId,
        genomeVersion: intent.genomeVersion,
        text: intent.text,
        languageId: intent.language === "en" ? "en" : "hi",
        regenerationKey: intent.regenerationKey,
      });
      if (activeIntentRef.current !== signature) return;
      if (outcome.kind === "pending") {
        const serverIntent: PreviewIntent = {
          ...intent,
          intentId: outcome.intentId || intent.intentId,
          startedAt: outcome.startedAt,
        };
        writePersistedIntent(replicaId, serverIntent);
        setPhase({
          kind: "pending",
          intent: serverIntent,
          pending: outcome,
          retryAt: Date.now() + outcome.retryAfterMs,
          joined: joined || outcome.reused,
        });
        return;
      }
      if (outcome.kind === "failed") {
        const failedIntent: PreviewIntent = {
          ...intent,
          intentId: outcome.intentId,
          startedAt: outcome.startedAt,
        };
        writePersistedIntent(replicaId, failedIntent);
        setPhase({ kind: "failed", intent: failedIntent, failure: outcome });
        return;
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(outcome.audio);
      const sealedIntent: PreviewIntent = { ...intent, intentId: outcome.intentId };
      writePersistedIntent(replicaId, sealedIntent);
      setPhase({
        kind: "ready",
        intent: sealedIntent,
        url: urlRef.current,
        intentId: outcome.intentId,
        reused: outcome.reused,
        generationId: outcome.generationId,
        modelCommitment: outcome.modelCommitment,
        textPlanSha256: outcome.textPlanSha256,
        transformationCount: outcome.transformationCount,
        spokenText: outcome.spokenText,
      });
    } catch (cause) {
      if (activeIntentRef.current !== signature) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) {
        // Keep the immutable intent. The app restores this replica and step
        // after sign-in, then this effect safely replays the same request.
        onAuthError(cause);
        return;
      }
      if (cause instanceof ReplicaApiError && /^(voice_allocation_|voice_app_)/.test(String(cause.data?.error || ''))) {
        clearPersistedIntent(replicaId);
        setPhase({ kind: 'error', headline: copy.error.voiceNotReadyHeadline,
          detail: cause.data?.error === 'voice_allocation_not_configured' ? copy.error.connectionDetail : copy.error.attemptCheckDetail, canRetry: false });
        return;
      }
      const connectionInterrupted = !navigator.onLine || cause instanceof TypeError ||
        cause instanceof DOMException && (cause.name === "TimeoutError" || cause.name === "AbortError") ||
        cause instanceof ReplicaApiError && (cause.status === 429 || cause.status >= 500);
      if (connectionInterrupted) {
        const hasServerReceipt = Boolean(intent.intentId);
        const pending: VoicePanelPending = {
          kind: "pending",
          state: "warming",
          phase: "connection_wait",
          stage: "connection_wait",
          message: hasServerReceipt
            ? copy.pending.lastCheckUnfinished
            : copy.pending.noReceiptYet,
          intentId: intent.intentId ?? "",
          generationId: null,
          attempt: 0,
          reused: joined,
          startedAt: intent.startedAt,
          updatedAt: new Date().toISOString(),
          etaSecondsLow: OBSERVED_COLD_LOW_SECONDS,
          etaSecondsHigh: OBSERVED_COLD_HIGH_SECONDS,
          retryAfterMs: 20_000,
        };
        setPhase({ kind: "pending", intent, pending, retryAt: Date.now() + pending.retryAfterMs, joined });
        return;
      }
      clearPersistedIntent(replicaId);
      const friendly = friendlyError(cause, "Preview");
      setPhase({ kind: "error", ...friendly, canRetry: false });
    } finally {
      requestInFlightRef.current = false;
    }
  }, [draft, onAuthError, replicaId, token, copy]);

  // Restore the immutable request snapshot. Replaying the same POST observes
  // the same durable server intent and can return the same sealed WAV; it does
  // not create a new generation. This is why the record lives in localStorage,
  // not the former per-tab sessionStorage countdown.
  useEffect(() => {
    if (loading || !draft || !online) return;
    const persisted = readPersistedIntent(replicaId);
    if (!persisted) {
      if (!restoredRef.current) restoredRef.current = true;
      return;
    }
    if (draft.version !== persisted.genomeVersion) {
      clearPersistedIntent(replicaId);
      return;
    }
    const signature = intentSignature(persisted);
    if (restoredRef.current && activeIntentRef.current === signature) return;
    if (restoredRef.current && composerDirty && activeIntentRef.current !== signature) {
      setRemoteIntent(persisted);
      return;
    }
    restoredRef.current = true;
    setRemoteIntent(null);
    setComposerDirty(false);
    setText(persisted.text);
    setLanguage(persisted.language);
    void runIntent(persisted, true);
  }, [loading, draft, online, replicaId, runIntent, syncSignal, composerDirty]);

  // Only one timer polls, and a poll repeats the immutable intent. Changing a
  // textbox cannot mutate an in-flight request because all composer controls
  // are disabled until the server seals or refuses it.
  useEffect(() => {
    if (phase.kind !== "pending") { setRemaining(0); return; }
    const tick = () => setRemaining(Math.max(0, Math.ceil((phase.retryAt - Date.now()) / 1000)));
    tick();
    const interval = window.setInterval(tick, 1000);
    const timeout = online
      ? window.setTimeout(() => void runIntent(phase.intent, phase.joined), Math.max(0, phase.retryAt - Date.now()))
      : 0;
    return () => {
      window.clearInterval(interval);
      if (timeout) window.clearTimeout(timeout);
    };
  }, [online, phase, runIntent]);

  useEffect(() => {
    if (!online || phase.kind !== "pending" || requestInFlightRef.current) return;
    if (phase.pending.stage === "connection_wait") void runIntent(phase.intent, phase.joined);
  }, [online, phase, runIntent]);

  function publishIntent() {
    channelRef.current?.postMessage({ type: "preview-intent", replicaId });
  }

  function startPreview(regenerate: boolean) {
    if (!draft || !online || requestInFlightRef.current) return;
    const settledPhase = phase.kind === "ready" || phase.kind === "failed" ? phase : null;
    const matchesSettled = settledPhase !== null &&
      settledPhase.intent.genomeVersion === draft.version &&
      settledPhase.intent.language === language &&
      settledPhase.intent.text === text;
    const intent: PreviewIntent = {
      text,
      language,
      genomeVersion: draft.version,
      // A new key is only minted by this explicit post-result action. Polls,
      // reloads and sibling tabs reuse the key stored in the snapshot.
      regenerationKey: regenerate && matchesSettled ? crypto.randomUUID() : undefined,
      startedAt: new Date().toISOString(),
    };
    activeIntentRef.current = intentSignature(intent);
    setRemoteIntent(null);
    setComposerDirty(false);
    writePersistedIntent(replicaId, intent);
    publishIntent();
    void runIntent(intent);
  }

  function changeLanguage(next: PreviewLanguage) {
    if (phase.kind === "pending" || phase.kind === "submitting") return;
    setComposerDirty(true);
    setLanguage(next);
    if (Object.values(WELCOME).includes(text.trim())) setText(WELCOME[next]);
  }

  function joinRemoteIntent() {
    if (!remoteIntent || !draft || remoteIntent.genomeVersion !== draft.version) return;
    setRemoteIntent(null);
    setComposerDirty(false);
    setText(remoteIntent.text);
    setLanguage(remoteIntent.language);
    void runIntent(remoteIntent, true);
  }

  const currentLanguageOptions = languageOptions(copy);
  const selectedLanguage = currentLanguageOptions.find((option) => option.id === language) ?? currentLanguageOptions[0];

  function focusComposer() {
    textRef.current?.focus();
    textRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const busy = phase.kind === "submitting" || phase.kind === "pending";
  const settledInputChanged = (phase.kind === "ready" || phase.kind === "failed") && (
    phase.intent.text !== text || phase.intent.language !== language || phase.intent.genomeVersion !== draft?.version
  );
  const pendingStartedAt = phase.kind === "pending" ? Date.parse(phase.pending.startedAt) : 0;
  const pendingReturnAt = phase.kind === "pending"
    ? pendingStartedAt + Math.max(OBSERVED_COLD_HIGH_SECONDS, phase.pending.etaSecondsHigh) * 1000
    : 0;
  const pendingElapsed = phase.kind === "pending" ? elapsedLabel(Date.now() - pendingStartedAt) : "0:00";
  const announcement = !online && busy
    ? copy.announcement.connectionLost
    : phase.kind === "pending"
      ? copy.announcement.pendingTemplate
        .replace("{stage}", stageLabel(phase.pending, copy.stage))
        .replace("{note}", phase.joined ? copy.announcement.joinedNote : copy.announcement.savedCheckingNote)
      : phase.kind === "submitting"
        ? copy.announcement.connectingExisting
        : phase.kind === "ready"
          ? copy.announcement.ready
          : phase.kind === "failed"
            ? copy.announcement.stopped
          : phase.kind === "error"
            ? copy.announcement.errorTemplate.replace("{headline}", phase.headline)
            : "";

  // ── why the button is dead, in the button's own box ─────────────────────
  //
  // THE OWNER'S REPORT, VERBATIM: "Preview my voice" rendered DISABLED with no
  // visible reason attached to it. The reason existed, in `hear-voice-note`
  // below, but only for the `!draft` case and only after `loading` had
  // finished, so during the load there was a dead primary button and nothing
  // else, and on a 390pt screen the note that eventually appeared was under
  // the fold anyway.
  //
  // Every branch that disables the button now produces a reason, and the
  // reason names its CLASS, because "we have not built your draft voice yet"
  // and "your text is too long" ask for opposite behaviour from the reader:
  // one means wait, the other means type. A disabled control that does not say
  // which is a control that gets read as a bug.
  //
  // ORDER MATTERS. It is the order a person would discover them in: our
  // problems first (there is nothing to preview, or the machine is busy), then
  // theirs (the box is empty, or too long). Reporting "your text is too long"
  // while there is no voice model at all would be true and useless.
  const reason: DisabledReason | null = loading
    ? disabledReason(
      "us",
      copy.reasons.checkingDraftHeadline,
      copy.reasons.checkingDraftDetail,
    )
    : !draft
      ? voicePreviewBlockReason(wizardInput)
      : busy
        ? disabledReason(
          "us",
          phase.kind === "pending"
            ? copy.reasons.busyPendingTemplate.replace("{stage}", stageLabel(phase.pending, copy.stage))
            : copy.reasons.busyConnecting,
          online
            ? copy.reasons.busyOnlineDetail
            : copy.reasons.busyOfflineDetail,
        )
        : !online
          ? disabledReason(
            "you",
            copy.reasons.offlineHeadline,
            copy.reasons.offlineDetail,
          )
        : !text.trim()
          ? disabledReason(
            "you",
            copy.reasons.emptyHeadline,
            copy.reasons.emptyDetail,
          )
          : overLimit
            ? disabledReason(
              "you",
              copy.reasons.overLimitTemplate.replace("{max}", String(MAX_TEXT)),
              copy.reasons.overLimitDetail,
            )
            : null;

  return (
    <section className="hear-voice" aria-labelledby="hear-voice-title">
      <div className="section-heading">
        <div>
          {!testEnvironment && <p className="eyebrow">{copy.eyebrow}</p>}
          <h2 id="hear-voice-title">{copy.heading}</h2>
        </div>
        <p>
          {testEnvironment ? copy.introTest : copy.introLive}
        </p>
      </div>

      <VoiceLikenessCard likeness={likeness} lastListeningTest={listeningHistory[0] ?? null} />

      {draft && (
        <section className="voice-lineage" aria-label={copy.lineage.ariaLabel}>
          <div className="voice-lineage-title">
            <span>{copy.lineage.versionTemplate.replace("{version}", String(draft.version))}</span>
            <strong>
              {lineage.some((item) => item.source?.voice_role === "primary")
                ? copy.lineage.primaryVoiceLabel
                : lineage.length
                  ? copy.lineage.chooseRecordingLabel
                : copy.lineage.sourceDetailsLoading}
            </strong>
          </div>
          {lineage.length > 0 && (
            <ul>
              {lineage.map(({ sourceId, source, reference }) => (
                <li key={sourceId}>
                  <span>{source?.voice_role === "primary" ? copy.lineage.rolePrimary : source?.kind === "video" ? copy.lineage.roleVideo : source?.kind === "audio" ? copy.lineage.roleAudio : copy.lineage.roleSource}</span>
                  <strong>{source?.voice_role === "primary" ? copy.lineage.kindPrimary : source?.kind === "video" ? copy.lineage.kindVideo : source?.kind === "audio" ? copy.lineage.kindAudio : copy.lineage.kindContext}</strong>
                  <small>
                    {reference?.duration_ms
                      ? copy.lineage.referenceSecondsTemplate.replace("{n}", String(Math.max(1, Math.round(reference.duration_ms / 1000))))
                      : copy.lineage.referenceSelected}
                    {source?.created_at ? copy.lineage.addedOnTemplate.replace("{date}", new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(source.created_at))) : ""}
                  </small>
                  <details className="voice-lineage-technical">
                    <summary>{copy.lineage.technicalReference}</summary>
                    <small>{copy.lineage.privateSourceTemplate.replace("{code}", sourceId.slice(0, 6).toUpperCase())}</small>
                  </details>
                </li>
              ))}
            </ul>
          )}
          {onManageSources && (
            <button className="voice-lineage-manage" type="button" onClick={onManageSources}>
              {copy.lineage.manageSources}
            </button>
          )}
        </section>
      )}

      <div className="hear-voice-body">
        <div className="hear-voice-compose">
          <fieldset className="voice-preview-language">
            <legend>{copy.languageLegend}</legend>
            {currentLanguageOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={language === option.id ? "active" : ""}
                aria-pressed={language === option.id}
                disabled={busy}
                onClick={() => changeLanguage(option.id)}
              >
                {option.label}
              </button>
            ))}
          </fieldset>
          <p className="voice-preview-language-help" id="hear-voice-language-help">{selectedLanguage.help}</p>

          <label className="voice-preview-script" htmlFor="hear-voice-text">
            <span>{copy.yourLine}</span>
            <textarea
              ref={textRef}
              id="hear-voice-text"
              value={text}
              lang={selectedLanguage.inputLanguage}
              rows={4}
              maxLength={MAX_TEXT}
              disabled={busy}
              aria-describedby="hear-voice-language-help hear-voice-counter"
              onChange={(event) => {
                setComposerDirty(true);
                setText(event.target.value);
              }}
            />
            <small id="hear-voice-counter" className={overLimit ? "hear-voice-over" : ""}>
              {copy.charactersLeftTemplate.replace("{n}", String(MAX_TEXT - Array.from(text).length))}{testEnvironment ? "." : copy.disclosureAddedSuffix}
            </small>
          </label>

          {remoteIntent && !busy && (
            <div className="hear-voice-remote">
              <span>{copy.remoteIntentNote}</span>
              <button type="button" onClick={joinRemoteIntent}>{copy.joinThatPreview}</button>
            </div>
          )}

          {/* The reason lives INSIDE the same box as the button, so it cannot
              drift below a fold in a later layout change. On a 390pt screen
              "adjacent" and "in the same element" are the same requirement. */}
          <DisabledAction reason={reason}>
            <button
              className="button primary-button hear-voice-go"
              type="button"
              disabled={Boolean(reason)}
              // One semantic click covers pointer, keyboard, assistive tech
              // and programmatic activation without parallel event paths.
              onClick={() => { if (!reason) startPreview((phase.kind === "ready" || phase.kind === "failed") && !settledInputChanged); }}
            >
              {phase.kind === "submitting"
                ? copy.button.connecting
                : phase.kind === "pending"
                  ? stageLabel(phase.pending, copy.stage)
                  : phase.kind === "ready" || phase.kind === "failed"
                    ? settledInputChanged ? copy.button.previewUpdatedLine : copy.button.regeneratePreview
                    : copy.button.previewMyVoice}
            </button>
          </DisabledAction>
        </div>

        <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
        <div className={`hear-voice-stage hear-voice-stage-${phase.kind}`} aria-busy={busy}>
          {phase.kind === "ready" ? (
            <>
              <p className="hear-voice-state ready">{copy.ready.readyLabel}</p>
              <h3>{copy.ready.listenHeading}</h3>
              <audio controls preload="metadata" src={phase.url}>{copy.ready.audioFallback}</audio>
              {phase.transformationCount > 0 && (
                <details className="hear-voice-pronunciation-plan">
                  <summary>{copy.ready.pronunciationSummaryTemplate.replace("{n}", String(phase.transformationCount))}</summary>
                  <p>{copy.ready.spokenAsPrefix}<span lang="hi">{phase.spokenText}</span></p>
                  <small>{copy.ready.planNoteTemplate.replace("{plan}", phase.textPlanSha256.slice(0, 10))}</small>
                </details>
              )}
              {!testEnvironment && <dl className="hear-voice-proof">
                <div><dt>{copy.ready.disclosureLabel}</dt><dd>{copy.ready.disclosureValue}</dd></div>
                <div><dt>{copy.ready.watermarkLabel}</dt><dd>{copy.ready.watermarkValue}</dd></div>
              </dl>}
              <div className="hear-voice-correction">
                <strong>{copy.ready.notRightYet}</strong>
                <span>{copy.ready.correctionNote}</span>
                <button className="review-refresh" type="button" onClick={focusComposer}>{copy.ready.editTheLine}</button>
              </div>
              <small>
                {copy.ready.receiptTemplate
                  .replace("{generationId}", phase.generationId.slice(0, 8))
                  .replace("{intentId}", phase.intentId.slice(0, 8))
                  .replace("{modelCommitment}", phase.modelCommitment.slice(0, 10))}
                {phase.reused ? copy.ready.reusedNote : ""}
              </small>
            </>
          ) : phase.kind === "pending" ? (
            <>
              <p className={`hear-voice-state ${phase.pending.state === "warming" ? "warming" : "working"}`}>
                {phase.pending.state === "warming" ? copy.pending.runtimeStarting : copy.pending.audioProcessing}
              </p>
              <h3>{stageLabel(phase.pending, copy.stage)}</h3>
              <p className="hear-voice-message">{phase.pending.message}</p>
              {!online && (
                <p className="hear-voice-connection">
                  {copy.pending.offlineNote}
                </p>
              )}
              {phase.joined && (
                <p className="hear-voice-observer">{copy.pending.joinedFromAnotherTab}</p>
              )}
              <div className="hear-voice-wait-metrics" aria-label={copy.pending.waitMetricsAriaLabel}>
                <div><span>{copy.pending.elapsedLabel}</span><strong>{pendingElapsed}</strong></div>
                <div><span>{copy.pending.observedRangeLabel}</span><strong>{copy.pending.observedRangeTemplate.replace("{low}", String(OBSERVED_COLD_LOW_SECONDS / 60)).replace("{high}", String(OBSERVED_COLD_HIGH_SECONDS / 60))}</strong></div>
                <div><span>{copy.pending.returnAroundLabel}</span><strong>{clock(pendingReturnAt)}</strong></div>
              </div>
              <p className="hear-voice-attempt">
                {Date.now() > pendingReturnAt
                  ? copy.pending.beyondWindowNote
                  : phase.pending.reused
                    ? copy.pending.reusedRequestNote
                    : online ? copy.pending.savedRequestOnlineTemplate.replace("{n}", String(remaining)) : copy.pending.savedRequestOfflineNote}
              </p>
              <p className="hear-voice-leave">{copy.pending.leaveNote}</p>
              <details className="hear-voice-request-details">
                <summary>{copy.pending.requestDetails}</summary>
                <small className="hear-voice-request-receipt">
                  {phase.pending.intentId
                    ? copy.pending.savedRequestReceiptTemplate
                      .replace("{id}", phase.pending.intentId.slice(0, 8))
                      .replace("{started}", clock(phase.pending.startedAt))
                      .replace("{attempt}", String(Math.max(1, phase.pending.attempt)))
                    : copy.pending.requestSnapshotTemplate.replace("{started}", clock(phase.pending.startedAt))}
                </small>
                <small>
                  {phase.pending.intentId
                    ? copy.pending.closingPausesNote
                    : copy.pending.keepOpenNote}
                </small>
              </details>
            </>
          ) : phase.kind === "submitting" ? (
            <>
              <p className="hear-voice-state working">{copy.submitting.stateLabel}</p>
              <h3>{copy.submitting.heading}</h3>
              <p className="hear-voice-message">{testEnvironment ? copy.submitting.messageTest : copy.submitting.messageLive}</p>
              <small>{copy.submitting.note}</small>
            </>
          ) : phase.kind === "failed" ? (
            <>
              <p className="hear-voice-state failed">{copy.failed.stateLabel}</p>
              <h3>{copy.failed.heading}</h3>
              <p className="hear-voice-message">{copy.failed.body}</p>
              <small>{copy.failed.note}</small>
              <small className="hear-voice-request-receipt">
                {copy.failed.receiptTemplate
                  .replace("{intentId}", phase.failure.intentId.slice(0, 8))
                  .replace("{updatedAt}", clock(phase.failure.updatedAt))
                  .replace("{attempt}", String(Math.max(1, phase.failure.attempt)))
                  .replace("{errorCode}", phase.failure.errorCode)}
              </small>
            </>
          ) : phase.kind === "error" ? (
            <>
              <p className="hear-voice-state failed">{copy.error.stateLabel}</p>
              <h3>{copy.error.heading}</h3>
              <p className="hear-voice-message">{phase.headline}</p>
              <small>{phase.detail}</small>
              {phase.canRetry && onManageSources && (
                <button className="review-refresh" type="button" onClick={onManageSources}>{copy.error.checkVoiceSources}</button>
              )}
            </>
          ) : (
            <>
              <p className="hear-voice-state idle">{copy.idle.stateLabel}</p>
              <h3>{copy.idle.heading}</h3>
              <p className="hear-voice-message">{copy.idle.body}</p>
              <p className="hear-voice-first-wait">{copy.idle.firstWaitNote}</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
