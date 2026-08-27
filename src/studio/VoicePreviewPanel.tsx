// "Preview my voice" — the first place an owner meets their own clone.
//
// VoicePreviewLab (further down the studio, behind the advanced surface) is the
// calibration instrument: seven delivery conditions, blind A/B, a held-out
// gate. This is not that. This is one box, one button, and one honest answer.
//
// The honesty is the design. The GPU runtime scales to zero, so the first
// click of the day genuinely cannot produce audio for about two to five
// minutes — and every dishonest way of showing that was available and
// rejected: a spinner that runs until the platform kills the request at 240 s,
// a fake progress bar, or an error for a service that is merely asleep. The
// server answers 202 with a warming state; this component shows it, counts
// down, and retries by itself.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getReplicaReview } from "./processingApi";
import { ReplicaApiError } from "./replicaApi";
import { friendlyError } from "./errorCopy";
import type { ReplicaReview } from "./types";
import { requestVoicePanelPreview, type VoicePanelWarming } from "./voicePanelApi";
import { disabledReason, type DisabledReason } from "./blockerClass";
import { DisabledAction } from "./BlockerNotice";
import { voicePreviewBlockReason, type WizardInput } from "./wizardModel";

const MAX_TEXT = 280;

// Shapes, not a phrase bank: two short greetings an owner will immediately
// rewrite. Kept under the cap so the counter never opens on a violation.
const WELCOME = {
  hi: "Namaste! Main aapka apna AI version hoon. Aaj kya padhna hai, physics, chemistry ya maths?",
  en: "Hello, this is my AI version. Tell me what you are stuck on today and we will work through it together.",
} as const;

type Phase =
  | { kind: "idle" }
  | { kind: "synthesizing" }
  | { kind: "warming"; warming: VoicePanelWarming; retryAt: number; attempt: number }
  | { kind: "ready"; url: string; generationId: string; modelCommitment: string }
  | { kind: "error"; headline: string; detail: string; canRetry: boolean };

// A cold start can require two syntheses: the first wakes the GPU, then the
// first poll after the server's 200 s wake window dispatches a fresh synthesis
// against that warm runtime. Ten polls keep the client attached for 300 s, so
// that second request can finish and a later poll can protect and return audio.
// Seven polls crossed the wake window but stopped on the same response that
// dispatched the necessary second synthesis.
const MAX_AUTO_RETRIES = 10;

// ── THE WAIT SURVIVES A TAB SWITCH (WS-AP, from the owner's own report) ────
//
// The owner waited ten minutes on "Waking the voice lab", switched browser
// tabs, came back, and had to start over. This panel's own copy already
// promised "You can leave this open or go and do something else on this
// step", which was true for a background TAB (the JS keeps running) and false
// for anything that actually reloads the page — a phone OS discarding a
// backgrounded tab under memory pressure, or a person genuinely refreshing.
// Either way `phase` is in-memory React state and a reload erases it, so the
// person came back to "idle" and pressed the button again, and every one of
// those extra presses is a fresh two-to-three-minute cold start stacked on
// the last one. Ten minutes of nothing was four button presses, not one long
// wait.
//
// `sessionStorage` is the fix: it survives a reload in the SAME tab (unlike
// plain React state) without surviving a genuinely new tab or a different
// device (unlike `localStorage`, which would be the wrong scope for a wait
// that is honestly tied to one browser tab's in-flight request). What is
// persisted is enough to resume the SAME countdown on remount: the retry
// clock, the attempt count, and the exact text/language that was being
// synthesised, so the retry that fires next is the next tick of the same
// wait rather than a new one.
const WARMUP_KEY_PREFIX = "vy.voicePreview.warmup.";
// Generous on purpose. The real cold start can take 2-5 minutes; this is the ceiling
// past which a persisted wait is treated as abandoned rather than resumable,
// covering a slow admission queue plus however long a person's tab genuinely
// stayed backgrounded. Past it, starting fresh is more honest than pretending
// to resume something that has likely already finished or died unseen.
const RESUMABLE_MS = 8 * 60_000;

interface PersistedWarmup {
  text: string;
  language: "hi" | "en";
  genomeVersion: number;
  attempt: number;
  retryAt: number;
  warming: VoicePanelWarming;
}

function warmupKey(replicaId: string): string {
  return `${WARMUP_KEY_PREFIX}${replicaId}`;
}

function readPersistedWarmup(replicaId: string): PersistedWarmup | null {
  try {
    const raw = window.sessionStorage.getItem(warmupKey(replicaId));
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || typeof value.retryAt !== "number") return null;
    // Stale rather than resumable: a wait this old has almost certainly
    // already resolved (or failed) without anyone watching, and resuming it
    // would be a countdown with nothing real behind it.
    if (value.retryAt < Date.now() - RESUMABLE_MS) return null;
    return value as PersistedWarmup;
  } catch {
    // Private browsing can throw on read as well as write. A wait that
    // cannot be persisted still works; it just cannot survive a reload,
    // which is the pre-fix behaviour, not a new failure.
    return null;
  }
}

function writePersistedWarmup(replicaId: string, value: PersistedWarmup) {
  try {
    window.sessionStorage.setItem(warmupKey(replicaId), JSON.stringify(value));
  } catch {
    // Quota or private browsing. See `readPersistedWarmup`.
  }
}

function clearPersistedWarmup(replicaId: string) {
  try {
    window.sessionStorage.removeItem(warmupKey(replicaId));
  } catch {
    // Nothing to clean up if the write never landed in the first place.
  }
}

export default function VoicePreviewPanel({ token, replicaId, wizardInput, onAuthError, testEnvironment = false }: {
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
  testEnvironment?: boolean;
}) {
  const [review, setReview] = useState<ReplicaReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState<"hi" | "en">("hi");
  const [text, setText] = useState<string>(WELCOME.hi);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [remaining, setRemaining] = useState(0);
  const urlRef = useRef<string>("");
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

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const run = useCallback(async (attempt: number) => {
    if (!draft) return;
    setPhase({ kind: "synthesizing" });
    try {
      const outcome = await requestVoicePanelPreview(token, {
        replicaId,
        genomeVersion: draft.version,
        text,
        languageId: language,
      });
      if (outcome.kind === "warming") {
        if (attempt >= MAX_AUTO_RETRIES) {
          setPhase({
            kind: "error",
            headline: "The voice runtime did not finish waking up",
            detail: `It has been asked ${attempt} times over about ${Math.round((attempt * outcome.retryAfterMs) / 1000)} seconds and is still starting. Try again in a few minutes, or tell support the runtime is not coming up.`,
            canRetry: true,
          });
          return;
        }
        setPhase({ kind: "warming", warming: outcome, retryAt: Date.now() + outcome.retryAfterMs, attempt });
        return;
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(outcome.audio);
      setPhase({
        kind: "ready",
        url: urlRef.current,
        generationId: outcome.generationId,
        modelCommitment: outcome.modelCommitment,
      });
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
      const friendly = friendlyError(cause, "Preview");
      setPhase({ kind: "error", ...friendly });
    }
  }, [draft, language, onAuthError, replicaId, text, token]);

  // RE-ATTACH rather than restart. Once the review fetch has answered (so
  // `draft` is either a real genome or confirmed absent), check for a
  // still-live warmup left by an earlier mount of this same panel. Restoring
  // `text`/`language` alongside `phase` matters: without it the countdown
  // would resume correctly but then synthesise whatever the (now-default)
  // textbox holds, which is a request for a different line than the one that
  // was actually waited on.
  useEffect(() => {
    if (loading || restoredRef.current) return;
    restoredRef.current = true;
    const persisted = readPersistedWarmup(replicaId);
    if (!persisted) return;
    // The draft the persisted wait was for may no longer be the current one
    // (a new recording replaced it while the tab was away). Resuming against
    // the wrong genome version would synthesise a stale voice silently, so
    // this refuses rather than guesses.
    if (!draft || draft.version !== persisted.genomeVersion) {
      clearPersistedWarmup(replicaId);
      return;
    }
    setText(persisted.text);
    setLanguage(persisted.language);
    setPhase({ kind: "warming", warming: persisted.warming, retryAt: persisted.retryAt, attempt: persisted.attempt });
  }, [loading, draft, replicaId]);

  // PERSIST while warming, CLEAR once the wait resolves either way. Written
  // as its own effect off `phase` rather than inline in `run`, so a restored
  // phase (set by the effect above, not by `run`) is persisted too — the
  // record has to survive a SECOND reload just as well as the first.
  useEffect(() => {
    if (phase.kind === "warming") {
      if (!draft) return; // `run` cannot fire without a draft; nothing to persist yet.
      writePersistedWarmup(replicaId, {
        text, language, genomeVersion: draft.version,
        attempt: phase.attempt, retryAt: phase.retryAt, warming: phase.warming,
      });
    } else if (phase.kind === "ready" || phase.kind === "error") {
      clearPersistedWarmup(replicaId);
    }
  }, [phase, draft, replicaId, text, language]);

  // The countdown and the automatic retry. One interval owns both, so the
  // number on screen and the moment the request fires cannot drift apart.
  useEffect(() => {
    if (phase.kind !== "warming") { setRemaining(0); return; }
    const tick = () => {
      const left = phase.retryAt - Date.now();
      setRemaining(Math.max(0, Math.ceil(left / 1000)));
      if (left <= 0) void run(phase.attempt + 1);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [phase, run]);

  function changeLanguage(next: "hi" | "en") {
    setLanguage(next);
    if (text.trim() === WELCOME.hi || text.trim() === WELCOME.en) setText(WELCOME[next]);
  }

  const busy = phase.kind === "synthesizing" || phase.kind === "warming";

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
      "We are still checking whether you have a draft voice.",
      "This takes a moment. The button turns on by itself when the check comes back.",
    )
    : !draft
      ? voicePreviewBlockReason(wizardInput)
      : busy
        ? disabledReason(
          "us",
          phase.kind === "warming"
            ? "The voice runtime is starting up, which takes two to five minutes after a quiet period."
            : "Your line is being generated right now.",
          "It retries by itself. You can leave this open or go and do something else on this step.",
        )
        : !text.trim()
          ? disabledReason(
            "you",
            "The box is empty, so there is nothing to say.",
            "Type a line for your clone to read aloud.",
          )
          : overLimit
            ? disabledReason(
              "you",
              `That is longer than the ${MAX_TEXT} characters a preview can take.`,
              "Shorten it and the button turns on.",
            )
            : null;

  return (
    <section className="hear-voice" aria-labelledby="hear-voice-title">
      <div className="section-heading">
        <div>
          {!testEnvironment && <p className="eyebrow">Your voice</p>}
          <h2 id="hear-voice-title">Preview my voice</h2>
        </div>
        <p>
          {testEnvironment
            ? "Type a line and hear the current draft in Hindi, Hinglish, or English."
            : "A private draft, generated from your own consented recording. Every clip opens with the spoken AI disclosure and carries an inaudible watermark. Previewing does not activate anything and does not let anyone else hear it."}
        </p>
      </div>

      <div className="hear-voice-body">
        <div className="hear-voice-compose">
          <fieldset className="voice-preview-language">
            <legend>Language</legend>
            <button type="button" className={language === "hi" ? "active" : ""} aria-pressed={language === "hi"}
              onClick={() => changeLanguage("hi")}>Hindi and Hinglish</button>
            <button type="button" className={language === "en" ? "active" : ""} aria-pressed={language === "en"}
              onClick={() => changeLanguage("en")}>English</button>
          </fieldset>

          <label className="voice-preview-script" htmlFor="hear-voice-text">
            <span>What should it say?</span>
            <textarea
              id="hear-voice-text"
              value={text}
              rows={4}
              maxLength={MAX_TEXT}
              onChange={(event) => setText(event.target.value)}
            />
            <small className={overLimit ? "hear-voice-over" : ""}>
              {Array.from(text).length}/{MAX_TEXT} characters{testEnvironment ? "." : ". The spoken AI disclosure is added for you."}
            </small>
          </label>

          {/* The reason lives INSIDE the same box as the button, so it cannot
              drift below a fold in a later layout change. On a 390pt screen
              "adjacent" and "in the same element" are the same requirement. */}
          <DisabledAction reason={reason}>
            <button
              className="button primary-button hear-voice-go"
              type="button"
              disabled={Boolean(reason)}
              // Press feedback fires on pointerdown, and so does the work: a
              // cold voice runtime takes two to five minutes, and spending
              // the click duration on top of that for nothing is the exact
              // latency DESIGN-LAW §2 calls the enemy. The keyboard path is
              // separate because pointerdown never fires for it.
              onPointerDown={() => { if (!reason) void run(0); }}
              onKeyDown={(event) => {
                if ((event.key === "Enter" || event.key === " ") && !reason) {
                  event.preventDefault();
                  void run(0);
                }
              }}
            >
              {phase.kind === "synthesizing" ? "Generating" : phase.kind === "warming" ? "Waking the voice lab" : "Preview my voice"}
            </button>
          </DisabledAction>
        </div>

        <div className="hear-voice-stage" aria-live="polite">
          {phase.kind === "ready" ? (
            <>
              <p className="hear-voice-state ready">Ready</p>
              <audio controls preload="metadata" src={phase.url}>Your browser cannot play this protected WAV.</audio>
              {!testEnvironment && <dl className="hear-voice-proof">
                <div><dt>Disclosure</dt><dd>Spoken, on every clip</dd></div>
                <div><dt>Watermark</dt><dd>PerTh, verified before release</dd></div>
              </dl>}
              <small>Receipt {phase.generationId.slice(0, 8)} · model {phase.modelCommitment.slice(0, 10)}</small>
            </>
          ) : phase.kind === "warming" ? (
            <>
              <p className="hear-voice-state warming">Warming up</p>
              <p className="hear-voice-message">{phase.warming.message}</p>
              <p className="hear-voice-countdown">
                <strong>{remaining}s</strong>
                <span>until the next attempt. You can leave this open, it retries itself.</span>
              </p>
              <small>
                The voice runtime sleeps when nobody is using it, which is why the first preview of the
                day is slow and the ones after it take a few seconds.
              </small>
            </>
          ) : phase.kind === "synthesizing" ? (
            <>
              <p className="hear-voice-state working">Generating</p>
              <p className="hear-voice-message">{testEnvironment ? "Rendering your words in the current draft voice." : "Rendering your words, adding the disclosure and the watermark."}</p>
            </>
          ) : phase.kind === "error" ? (
            <>
              <p className="hear-voice-state failed">Did not work</p>
              <p className="hear-voice-message">{phase.headline}</p>
              <small>{phase.detail}</small>
              {phase.canRetry && (
                <button className="review-refresh" type="button" onClick={() => void run(0)}>Try again</button>
              )}
            </>
          ) : (
            <>
              <p className="hear-voice-state idle">Nothing generated yet</p>
              <p className="hear-voice-message">
                Write a line and press the button. The first preview after a quiet period takes two to
                five minutes while the runtime starts; after that it is usually much faster.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
