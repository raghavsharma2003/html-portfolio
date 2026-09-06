// The review queue — WS-R4, the Meet step.
//
// One card. Three buttons. Thirty seconds. This is the screen where fidelity is
// actually made, so everything about it is subordinate to how fast a decision
// can be taken:
//
//   - Feedback fires on pointerdown, never on release (DESIGN-LAW §2). A button
//     that waits for mouseup on a screen somebody taps thirty times in a row
//     feels broken by the fourth tap.
//   - Keys 1 / 2 / 3 map to the three buttons, because the fastest hand on a
//     laptop never reaches the trackpad.
//   - The progress line is a REAL count from the server, which is the only
//     reason it is allowed to exist at all (DESIGN-LAW: no fake numbers).
//   - The empty state says what will fill it and why it is empty, and does not
//     pretend the queue is finished.
//
// WHAT IS NOT HERE, ON PURPOSE
//
// No streak, no score, no "3 more to unlock". The number this screen moves is
// Readiness, it is computed elsewhere from evidence, and a second invented
// number beside it would be exactly the fake-progress-bar failure this repo has
// already paid for. The count of decided cards is the only number rendered and
// it is a count of rows.
import { useCallback, useEffect, useRef, useState } from "react";
import { ReplicaApiError } from "./replicaApi";
import {
  decideReviewCard,
  dismissFlaggedReply,
  encodeCorrectionText,
  fillReviewQueue,
  neverRuleFromFlag,
  readReviewQueue,
  uploadCorrection,
} from "./reviewQueueApi";
import type { FlagReason, FlaggedReply, ReviewQueue as ReviewQueueShape } from "./types";
import { useStudioLocale } from "./localeContext";
import { withCount, withLabel, type StudioCopy } from "./copy";

// WS-R72. The reason breakdown, in the order the brief's own "Never say
// this" pre-selection reads them (harmful first) - `readFlaggedReplies`'s
// own header, restated for display order rather than for the predicate.
const REASON_ORDER: FlagReason[] = ["harmful", "wrong", "not_them", "other"];

function reasonLabel(t: StudioCopy, reason: FlagReason): string {
  if (reason === "wrong") return t.reviewQueueFlags.reasonWrong;
  if (reason === "harmful") return t.reviewQueueFlags.reasonHarmful;
  if (reason === "not_them") return t.reviewQueueFlags.reasonNotThem;
  return t.reviewQueueFlags.reasonOther;
}

/** "harmful 2, wrong 1" - every reason that was actually used, in order,
 *  never a zero. `flag.reasons` is a real count from `readFlaggedReplies`'s
 *  own SQL, so this renders exactly what it says and nothing it does not. */
function reasonBreakdown(t: StudioCopy, reasons: FlaggedReply["reasons"]): string {
  return REASON_ORDER
    .filter((reason) => reasons[reason] > 0)
    .map((reason) => `${reasons[reason]} ${reasonLabel(t, reason)}`)
    .join(", ");
}

/** The three buttons, in the order the keys and the DOM agree on. The
 *  DECISION and the HINT key are the product's own vocabulary, fixed by the
 *  common brief; the LABEL is read from `t.reviewQueue` below so it renders
 *  in the creator's own chrome language. */
const BUTTON_ORDER = [
  { decision: "sounds_right", hint: "1" },
  { decision: "fixed", hint: "2" },
  { decision: "never", hint: "3" },
] as const;

// WS-R112. An 'instruction_shaped' card has no answer to fix, only a source
// to keep or remove - key 2 becomes "Remove this source" rather than
// "Close, fix it" for this ONE kind, everything else about the row (order,
// hints, pointerdown feedback) unchanged.
const INSTRUCTION_SHAPED_BUTTON_ORDER = [
  { decision: "sounds_right", hint: "1" },
  { decision: "remove_source", hint: "2" },
  { decision: "never", hint: "3" },
] as const;

type Decision =
  | (typeof BUTTON_ORDER)[number]["decision"]
  | (typeof INSTRUCTION_SHAPED_BUTTON_ORDER)[number]["decision"];

function buttonLabel(t: StudioCopy, decision: Decision): string {
  if (decision === "sounds_right") return t.reviewQueue.buttonSoundsRight;
  if (decision === "fixed") return t.reviewQueue.buttonFixed;
  if (decision === "remove_source") return t.reviewQueue.buttonRemoveSource;
  return t.reviewQueue.buttonNever;
}

/** Recording state, kept as a discriminated string rather than three booleans:
 *  three booleans admit "recording and idle at the same time", which is how a
 *  hold-to-record control ends up with a stuck red dot. */
type Recorder = "idle" | "recording" | "encoding";

export default function ReviewQueue({
  token,
  replicaId,
  onAuthError,
}: {
  token: string;
  replicaId: string;
  onAuthError: (cause: unknown) => void;
}) {
  const { t } = useStudioLocale();
  const [queue, setQueue] = useState<ReviewQueueShape | null>(null);
  // WS-R67 (migration 116). Just the count, the workstream's own scope for
  // this screen: each entry is already one reply with its own `count`
  // (ten followers flagging the same reply is one entry, never ten -
  // `api/_review-queue.js`'s own header), so the number rendered below is a
  // count of rows, `active_never_rules` two lines down's own rule restated.
  const [flags, setFlags] = useState<FlaggedReply[]>([]);
  // WS-R72. The one flagged reply's action currently in flight, by hash -
  // `null` means none, `busy`'s own single-flight shape restated per row
  // rather than per screen, since these live below the decision card and
  // must never block or be blocked by it.
  const [flagBusy, setFlagBusy] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [recorder, setRecorder] = useState<Recorder>("idle");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const load = useCallback(async () => {
    try {
      const result = await readReviewQueue(token, replicaId);
      setQueue(result.queue);
      setFlags(result.flags);
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : t.reviewQueue.errorLoad);
    }
  }, [onAuthError, replicaId, token, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { mediaRef.current?.stream?.getTracks?.().forEach((track) => track.stop()); }, []);

  const cards = queue?.cards ?? [];
  const card = cards[Math.min(index, Math.max(0, cards.length - 1))] ?? null;
  const total = (queue?.open_count ?? 0) + (queue?.decided_count ?? 0);
  const position = (queue?.decided_count ?? 0) + 1;
  // WS-R112. One card kind, one different middle button - everything else
  // about the row (order, hints, feedback timing) is the SAME component.
  const buttonOrder = card?.kind === "instruction_shaped" ? INSTRUCTION_SHAPED_BUTTON_ORDER : BUTTON_ORDER;

  async function submit(decision: Decision, correctionSourceId?: string) {
    if (!card || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await decideReviewCard(token, replicaId, card.card_id, decision, {
        correctionSourceId,
        // "Never say this" forbids the SHAPE of the answer that was on the
        // card. The pattern is stored as a matcher and enforced on the reply
        // path; it never enters a prompt. On an 'instruction_shaped' card
        // there IS no answer worth blocking - `answer_text` there is a
        // class-name reason, never a sentence the AI could say - so the
        // pattern is the flagged passage's own first sentence instead
        // (`card.prompt_text`, WS-R105's own detector output).
        ...(decision === "never" ? {
          pattern: card.kind === "instruction_shaped"
            ? card.prompt_text
            : (card.answer_text || card.prompt_text),
        } : {}),
      });
      setQueue(result.queue);
      setComposing(false);
      setDraft("");
      setIndex(0);
      setNotice(decision === "fixed"
        ? t.reviewQueue.noticeFixed
        : decision === "never"
          ? t.reviewQueue.noticeNever
          : decision === "remove_source"
            ? t.reviewQueue.noticeRemoved
            : t.reviewQueue.noticeSaved);
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : t.reviewQueue.errorSave);
    } finally {
      setBusy(false);
    }
  }

  async function saveTypedFix() {
    if (!card || busy || !draft.trim()) return;
    setBusy(true);
    setError("");
    try {
      const sourceId = await uploadCorrection(token, replicaId, card.card_id, {
        bytes: encodeCorrectionText(draft.trim()),
        mime: "text/plain",
        correctionKind: "text",
      });
      setBusy(false);
      await submit("fixed", sourceId);
    } catch (cause) {
      setBusy(false);
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : t.reviewQueue.errorCorrection);
    }
  }

  async function startRecording() {
    if (!card || recorder !== "idle") return;
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream);
      chunksRef.current = [];
      media.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      media.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        void finishRecording(new Blob(chunksRef.current, { type: media.mimeType || "audio/webm" }));
      };
      mediaRef.current = media;
      media.start();
      setRecorder("recording");
    } catch {
      // The honest split: this is waiting on YOU, not on us.
      setError(t.reviewQueue.micDenied);
    }
  }

  function stopRecording() {
    if (recorder !== "recording") return;
    setRecorder("encoding");
    mediaRef.current?.stop();
  }

  async function finishRecording(blob: Blob) {
    if (!card) { setRecorder("idle"); return; }
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (!bytes.byteLength) throw new Error(t.reviewQueue.nothingRecorded);
      const sourceId = await uploadCorrection(token, replicaId, card.card_id, {
        bytes,
        mime: (blob.type || "audio/webm").split(";", 1)[0],
        correctionKind: "audio",
      });
      setRecorder("idle");
      await submit("fixed", sourceId);
    } catch (cause) {
      setRecorder("idle");
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : t.reviewQueue.errorRecording);
    }
  }

  async function fill() {
    setBusy(true);
    setError("");
    try {
      const result = await fillReviewQueue(token, replicaId);
      setQueue(result.queue);
      setIndex(0);
      setNotice(result.questions_unavailable
        // "Waiting on us", named, never a shorter list wearing a green tick.
        ? withCount(t.reviewQueue.addedWithGenerator, result.written)
        : withCount(t.reviewQueue.addedPlain, result.written));
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : t.reviewQueue.errorFill);
    } finally {
      setBusy(false);
    }
  }

  // WS-R72. "Never say this" (reusing WS-R67's own `neverRuleFromFlag`
  // client wrapper, tested but never wired until now) and "Sounds right
  // anyway" on a flagged-reply card. `flagBusy` names the ONE reply hash in
  // flight, `busy`'s own single-flight shape, one section down.
  async function neverThisFlag(hash: string) {
    if (flagBusy) return;
    setFlagBusy(hash);
    setError("");
    try {
      const result = await neverRuleFromFlag(token, replicaId, hash);
      setFlags(result.flags);
      setNotice(t.reviewQueue.noticeNever);
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : t.reviewQueueFlags.errorAction);
    } finally {
      setFlagBusy(null);
    }
  }

  async function dismissThisFlag(hash: string) {
    if (flagBusy) return;
    setFlagBusy(hash);
    setError("");
    try {
      const result = await dismissFlaggedReply(token, replicaId, hash);
      setFlags(result.flags);
      setNotice(t.reviewQueueFlags.dismissed);
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : t.reviewQueueFlags.errorAction);
    } finally {
      setFlagBusy(null);
    }
  }

  // 1 / 2 / 3. Bound on the section rather than on window so a keystroke typed
  // into the fix composer is not also a decision.
  function onKey(event: React.KeyboardEvent<HTMLElement>) {
    if (composing || busy || !card) return;
    const target = event.target as HTMLElement;
    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;
    const button = buttonOrder.find((row) => row.hint === event.key);
    if (!button) return;
    event.preventDefault();
    if (button.decision === "fixed") { setComposing(true); return; }
    void submit(button.decision);
  }

  return (
    <section className="review-queue" aria-labelledby="review-queue-title" onKeyDown={onKey} tabIndex={-1}>
      <div className="review-queue-head">
        <div>
          <p className="eyebrow">{t.reviewQueue.eyebrow}</p>
          <h3 id="review-queue-title">{t.reviewQueue.title}</h3>
          <p className="review-queue-lede">
            {t.reviewQueue.lede}
          </p>
        </div>
        {total > 0 && (
          <p className="review-queue-count" aria-live="polite">
            {t.reviewQueue.cardOf.split("{n}").join(String(Math.min(position, total))).split("{n2}").join(String(total))}
          </p>
        )}
      </div>

      {notice ? <p className="review-queue-notice" role="status">{notice}</p> : null}
      {error ? (
        <div className="review-queue-error" role="alert">
          <span>{error}</span>
          <button type="button" onPointerDown={() => setError("")}>{t.reviewQueue.dismiss}</button>
        </div>
      ) : null}

      {!card ? (
        <div className="review-queue-empty">
          <strong>{t.reviewQueue.emptyTitle}</strong>
          <p>{t.reviewQueue.emptyBody}</p>
          <button className="button" type="button" disabled={busy} onPointerDown={() => void fill()}>
            {busy ? t.reviewQueue.looking : t.reviewQueue.lookForSomething}
          </button>
        </div>
      ) : (
        <article className="review-card">
          <p className="review-card-kind">{t.reviewQueue.kindLabel[card.kind]}</p>
          {/* card.prompt_text/card.answer_text are the AI's own material
              (a question people asked, an answer it gave) -- never chrome,
              never moved here. copy.ts's own header names this exception. */}
          <p className="review-card-prompt">{card.prompt_text}</p>
          {card.answer_text ? (
            <p className="review-card-answer">{card.answer_text}</p>
          ) : (
            <p className="review-card-answer review-card-answer-absent">
              {t.reviewQueue.noAnswerYet}
            </p>
          )}

          {!composing ? (
            <div className="review-card-actions">
              {buttonOrder.map((button) => (
                <button
                  key={button.decision}
                  className={`review-choice review-choice-${button.decision}`}
                  type="button"
                  disabled={busy}
                  onPointerDown={() => {
                    if (busy) return;
                    if (button.decision === "fixed") { setComposing(true); return; }
                    void submit(button.decision);
                  }}
                >
                  <span>{buttonLabel(t, button.decision)}</span>
                  <small aria-hidden="true">{button.hint}</small>
                </button>
              ))}
            </div>
          ) : (
            <div className="review-fix">
              <label htmlFor="review-fix-text">{t.reviewQueue.fixQuestionLabel}</label>
              <textarea
                id="review-fix-text"
                rows={4}
                maxLength={2_000}
                value={draft}
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t.reviewQueue.fixPlaceholder}
              />
              <p className="review-fix-note">
                {t.reviewQueue.fixNote}
              </p>
              <div className="review-fix-actions">
                <button
                  className="button primary-button"
                  type="button"
                  disabled={busy || !draft.trim()}
                  onPointerDown={() => void saveTypedFix()}
                >
                  {busy ? t.reviewQueue.saving : t.reviewQueue.saveThisAnswer}
                </button>
                <button
                  className={`review-hold ${recorder === "recording" ? "recording" : ""}`}
                  type="button"
                  disabled={busy || recorder === "encoding"}
                  onPointerDown={() => void startRecording()}
                  onPointerUp={() => stopRecording()}
                  onPointerLeave={() => stopRecording()}
                >
                  {recorder === "recording" ? t.reviewQueue.listening : recorder === "encoding" ? t.reviewQueue.savingHold : t.reviewQueue.holdToSayIt}
                </button>
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onPointerDown={() => { setComposing(false); setDraft(""); }}
                >
                  {t.reviewQueue.back}
                </button>
              </div>
            </div>
          )}
        </article>
      )}

      {queue && queue.active_never_rules > 0 ? (
        <p className="review-queue-rules">
          {withCount(
            queue.active_never_rules === 1 ? t.reviewQueue.blockedAnswerOne : t.reviewQueue.blockedAnswerMany,
            queue.active_never_rules,
          )}
        </p>
      ) : null}

      {flags.length > 0 ? (
        <section className="review-queue-flags" aria-labelledby="review-queue-flags-title">
          <p id="review-queue-flags-title" className="review-queue-flags-summary" aria-live="polite">
            {withCount(
              flags.length === 1 ? t.reviewQueue.flaggedRepliesOne : t.reviewQueue.flaggedRepliesMany,
              flags.length,
            )}
          </p>
          <ul className="review-queue-flag-list">
            {flags.map((flag) => (
              <li key={flag.reply_sha256} className="review-queue-flag-card">
                {/* flag.reply_text is the AI's own words, read back from the
                    flagging follower's history by hash - never a follower's
                    own text (`api/_review-queue.js::readFlaggedReplies`'s
                    own header). copy.ts's exception for rendered material
                    applies here exactly as it does to a review card. */}
                <p className="review-queue-flag-text">{flag.reply_text}</p>
                <p className="review-queue-flag-meta">
                  {withCount(flag.count === 1 ? t.reviewQueueFlags.timesOne : t.reviewQueueFlags.timesMany, flag.count)}
                  {" "}
                  {withLabel(t.reviewQueueFlags.reasonsLabel, reasonBreakdown(t, flag.reasons))}
                </p>
                <div className="review-queue-flag-actions">
                  <button
                    className="button secondary-button review-choice-never"
                    type="button"
                    disabled={flagBusy === flag.reply_sha256}
                    onPointerDown={() => void neverThisFlag(flag.reply_sha256)}
                  >
                    {flagBusy === flag.reply_sha256 ? t.reviewQueueFlags.dismissing : t.reviewQueue.buttonNever}
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    disabled={flagBusy === flag.reply_sha256}
                    onPointerDown={() => void dismissThisFlag(flag.reply_sha256)}
                  >
                    {flagBusy === flag.reply_sha256 ? t.reviewQueueFlags.dismissing : t.reviewQueueFlags.soundsRightAnyway}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
