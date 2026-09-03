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
  encodeCorrectionText,
  fillReviewQueue,
  readReviewQueue,
  uploadCorrection,
} from "./reviewQueueApi";
import type { ReviewCard, ReviewQueue as ReviewQueueShape } from "./types";

const KIND_LABEL: Record<ReviewCard["kind"], string> = {
  question: "A question people will ask",
  claim: "Something we think we learned",
  delta: "A habit we heard on a call",
  follower_declined: "A question your AI would not answer",
};

/** The three buttons, in the order the keys and the DOM agree on. The copy is
 *  the product's own vocabulary and is fixed by the common brief. */
const BUTTONS = [
  { decision: "sounds_right", label: "Sounds right", hint: "1" },
  { decision: "fixed", label: "Close, fix it", hint: "2" },
  { decision: "never", label: "Never say this", hint: "3" },
] as const;

type Decision = (typeof BUTTONS)[number]["decision"];

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
  const [queue, setQueue] = useState<ReviewQueueShape | null>(null);
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
      setQueue(await readReviewQueue(token, replicaId));
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : "The review queue could not be read");
    }
  }, [onAuthError, replicaId, token]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { mediaRef.current?.stream?.getTracks?.().forEach((track) => track.stop()); }, []);

  const cards = queue?.cards ?? [];
  const card = cards[Math.min(index, Math.max(0, cards.length - 1))] ?? null;
  const total = (queue?.open_count ?? 0) + (queue?.decided_count ?? 0);
  const position = (queue?.decided_count ?? 0) + 1;

  async function submit(decision: Decision, correctionSourceId?: string) {
    if (!card || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await decideReviewCard(token, replicaId, card.card_id, decision, {
        correctionSourceId,
        // "Never say this" forbids the SHAPE of the answer that was on the card.
        // The pattern is stored as a matcher and enforced on the reply path; it
        // never enters a prompt.
        ...(decision === "never" ? { pattern: card.answer_text || card.prompt_text } : {}),
      });
      setQueue(result.queue);
      setComposing(false);
      setDraft("");
      setIndex(0);
      setNotice(decision === "fixed"
        ? "Saved. Anything built from the old answer will be rebuilt, not patched."
        : decision === "never"
          ? "Saved. Your AI is now blocked from saying this, on every surface."
          : "Saved.");
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : "That decision could not be saved");
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
      setError(cause instanceof Error ? cause.message : "That correction could not be saved");
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
      setError("Your browser did not give us the microphone. Type the fix instead.");
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
      if (!bytes.byteLength) throw new Error("Nothing was recorded. Hold the button while you speak.");
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
      setError(cause instanceof Error ? cause.message : "That recording could not be saved");
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
        ? `Added ${result.written}. The question generator is not available on this deployment yet, so only your own material was used.`
        : `Added ${result.written}.`);
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : "The queue could not be filled");
    } finally {
      setBusy(false);
    }
  }

  // 1 / 2 / 3. Bound on the section rather than on window so a keystroke typed
  // into the fix composer is not also a decision.
  function onKey(event: React.KeyboardEvent<HTMLElement>) {
    if (composing || busy || !card) return;
    const target = event.target as HTMLElement;
    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;
    const button = BUTTONS.find((row) => row.hint === event.key);
    if (!button) return;
    event.preventDefault();
    if (button.decision === "fixed") { setComposing(true); return; }
    void submit(button.decision);
  }

  return (
    <section className="review-queue" aria-labelledby="review-queue-title" onKeyDown={onKey} tabIndex={-1}>
      <div className="review-queue-head">
        <div>
          <p className="eyebrow">Review</p>
          <h3 id="review-queue-title">Check what your AI says</h3>
          <p className="review-queue-lede">
            One answer at a time. Say whether it sounds like you, fix it in your own words, or block it outright.
          </p>
        </div>
        {total > 0 && (
          <p className="review-queue-count" aria-live="polite">
            Card {Math.min(position, total)} of {total}
          </p>
        )}
      </div>

      {notice ? <p className="review-queue-notice" role="status">{notice}</p> : null}
      {error ? (
        <div className="review-queue-error" role="alert">
          <span>{error}</span>
          <button type="button" onPointerDown={() => setError("")}>Dismiss</button>
        </div>
      ) : null}

      {!card ? (
        <div className="review-queue-empty">
          <strong>Nothing to review yet.</strong>
          <p>It fills itself from real conversations once your Room is open.</p>
          <button className="button" type="button" disabled={busy} onPointerDown={() => void fill()}>
            {busy ? "Looking..." : "Look for something to review"}
          </button>
        </div>
      ) : (
        <article className="review-card">
          <p className="review-card-kind">{KIND_LABEL[card.kind]}</p>
          <p className="review-card-prompt">{card.prompt_text}</p>
          {card.answer_text ? (
            <p className="review-card-answer">{card.answer_text}</p>
          ) : (
            <p className="review-card-answer review-card-answer-absent">
              Your AI has not answered this one yet. Write what you would say and it becomes the answer.
            </p>
          )}

          {!composing ? (
            <div className="review-card-actions">
              {BUTTONS.map((button) => (
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
                  <span>{button.label}</span>
                  <small aria-hidden="true">{button.hint}</small>
                </button>
              ))}
            </div>
          ) : (
            <div className="review-fix">
              <label htmlFor="review-fix-text">What would you actually say?</label>
              <textarea
                id="review-fix-text"
                rows={4}
                maxLength={2_000}
                value={draft}
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Answer it the way you would answer it."
              />
              <p className="review-fix-note">
                This is stored as your own source and cited. It is never pasted into your AI as a script.
              </p>
              <div className="review-fix-actions">
                <button
                  className="button primary-button"
                  type="button"
                  disabled={busy || !draft.trim()}
                  onPointerDown={() => void saveTypedFix()}
                >
                  {busy ? "Saving..." : "Save this answer"}
                </button>
                <button
                  className={`review-hold ${recorder === "recording" ? "recording" : ""}`}
                  type="button"
                  disabled={busy || recorder === "encoding"}
                  onPointerDown={() => void startRecording()}
                  onPointerUp={() => stopRecording()}
                  onPointerLeave={() => stopRecording()}
                >
                  {recorder === "recording" ? "Listening, let go when done" : recorder === "encoding" ? "Saving..." : "Hold to say it"}
                </button>
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onPointerDown={() => { setComposing(false); setDraft(""); }}
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </article>
      )}

      {queue && queue.active_never_rules > 0 ? (
        <p className="review-queue-rules">
          {queue.active_never_rules} blocked {queue.active_never_rules === 1 ? "answer" : "answers"} in force on every surface.
        </p>
      ) : null}
    </section>
  );
}
