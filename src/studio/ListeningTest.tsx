// ListeningTest.tsx — WS-R155, "Sounds like you" and the listening test.
//
// A blind, paired comparison of two saved voice samples of the owner's own
// voice. The order the two samples are shown in is decided once, in the
// browser, when this component mounts, and nothing on screen names which
// sample is which until the owner has rated BOTH on the same sealed
// four-axis form the listening harness already uses
// (evals/voice-listening-benchmark/lib.mjs#AXES: owner likeness,
// naturalness, accent fit, pronunciation) -- this file's own axis list
// mirrors those ids exactly, asserted by evals/listening-test/run.mjs.
//
// IT NEVER PRETENDS (MirrorCallStudio.tsx's own law, restated here). Each
// sample fetches its own sealed generation's bytes from
// GET /api/replica-generation-audio (WS-R163) the moment it mounts, and
// shows one of three honest states while it does: loading, a real player
// once the bytes arrive, or a plain refusal note if the fetch fails --
// never a silent player with nothing behind it.
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchGenerationAudio, submitListeningVerdict } from "./calibrationApi";
import type { ListeningAxis, ListeningRating, VoiceListeningCandidate, VoiceListeningVerdict } from "./types";

const AXES: ReadonlyArray<{ id: ListeningAxis; label: string; low: string; high: string }> = [
  { id: "owner_likeness", label: "Sounds like you", low: "not at all", high: "exactly like you" },
  { id: "naturalness", label: "Sounds natural", low: "robotic", high: "ordinary speech" },
  { id: "indian_accent", label: "Accent fits the language", low: "does not fit", high: "fits completely" },
  { id: "pronunciation", label: "Clear and correctly said", low: "hard to follow", high: "every word is clear" },
];

const SCORES = [1, 2, 3, 4, 5] as const;

type SlotKey = "one" | "two";

function emptyRating(): Partial<ListeningRating> {
  return {};
}

function isComplete(rating: Partial<ListeningRating>): rating is ListeningRating {
  return AXES.every((axis) => typeof rating[axis.id] === "number");
}

function randomOrderIsSwapped(): boolean {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return (buffer[0] & 1) === 1;
  }
  return Math.random() < 0.5;
}

export default function ListeningTest({
  token,
  replicaId,
  left,
  right,
  referenceSha256,
  onClose,
  onAuthError,
}: {
  token: string;
  replicaId: string;
  left: VoiceListeningCandidate;
  right: VoiceListeningCandidate;
  referenceSha256: string;
  onClose: () => void;
  onAuthError: (cause: unknown) => void;
}) {
  // Decided once, on mount, and never recomputed: recomputing on a re-render
  // would let a slow rating pass silently reassign which sample "one" and
  // "two" point at, mid-test.
  const swapped = useState(randomOrderIsSwapped)[0];
  const candidateOne = swapped ? right : left;
  const candidateTwo = swapped ? left : right;

  const [ratings, setRatings] = useState<Record<SlotKey, Partial<ListeningRating>>>({
    one: emptyRating(),
    two: emptyRating(),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verdict, setVerdict] = useState<VoiceListeningVerdict | null>(null);

  const ready = useMemo(() => isComplete(ratings.one) && isComplete(ratings.two), [ratings]);

  function setScore(slot: SlotKey, axis: ListeningAxis, score: number) {
    setRatings((current) => ({ ...current, [slot]: { ...current[slot], [axis]: score } }));
  }

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const oneRating = ratings.one as ListeningRating;
      const twoRating = ratings.two as ListeningRating;
      const leftRatings = swapped ? twoRating : oneRating;
      const rightRatings = swapped ? oneRating : twoRating;
      const result = await submitListeningVerdict(token, {
        replicaId,
        order: swapped ? "ba" : "ab",
        referenceSha256,
        left: { generationId: left.generation_id, audioSha256: left.audio_sha256, ratings: leftRatings },
        right: { generationId: right.generation_id, audioSha256: right.audio_sha256, ratings: rightRatings },
      });
      setVerdict(result);
    } catch (cause) {
      if (cause && typeof cause === "object" && "status" in cause && (cause as { status?: number }).status === 401) {
        onAuthError(cause);
        return;
      }
      setError(cause instanceof Error ? cause.message : "We could not save your listening test. Nothing was recorded.");
    } finally {
      setBusy(false);
    }
  }

  if (verdict) {
    const winnerSlot: SlotKey | null = verdict.winner === "tie" ? null
      : verdict.winner === "left" ? (swapped ? "two" : "one")
      : (swapped ? "one" : "two");
    return (
      <section className="lt-panel lt-panel--done" aria-labelledby="lt-title">
        <h2 id="lt-title">Listening test complete</h2>
        {winnerSlot ? (
          <p>Sample {winnerSlot === "one" ? "1" : "2"} sounds more like you, by your own ratings.</p>
        ) : (
          <p>You rated both samples the same. This counts as a tie, not a winner.</p>
        )}
        <dl className="lt-summary">
          <div><dt>Sample 1 average</dt><dd>{(swapped ? verdict.right_mean : verdict.left_mean).toFixed(1)} out of 5</dd></div>
          <div><dt>Sample 2 average</dt><dd>{(swapped ? verdict.left_mean : verdict.right_mean).toFixed(1)} out of 5</dd></div>
        </dl>
        <button type="button" className="lt-close" onClick={onClose}>Close</button>
      </section>
    );
  }

  return (
    <section className="lt-panel" aria-labelledby="lt-title">
      <h2 id="lt-title">Listening test</h2>
      <p className="lt-intro">
        Compare two saved voice samples of you and rate each one on its own. The order is mixed
        each time, so you will not know which is which until you finish.
      </p>
      <div className="lt-samples">
        <ListeningSample slotLabel="Sample 1" slotKey="one" candidate={candidateOne} rating={ratings.one} onScore={setScore}
          token={token} replicaId={replicaId} onAuthError={onAuthError} />
        <ListeningSample slotLabel="Sample 2" slotKey="two" candidate={candidateTwo} rating={ratings.two} onScore={setScore}
          token={token} replicaId={replicaId} onAuthError={onAuthError} />
      </div>
      {error ? <p role="alert" className="lt-error">{error}</p> : null}
      <div className="lt-actions">
        <button type="button" className="lt-cancel" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="lt-submit" onClick={submit} disabled={!ready || busy}>
          {busy ? "Saving your ratings" : "Submit your ratings"}
        </button>
      </div>
    </section>
  );
}

type SampleAudioState = "loading" | "ready" | "unavailable";

// Fetches once per (generationId) and revokes its own object URL on
// unmount or when a different generation replaces it -- an <audio> element
// holding a live blob: URL after the component that made it is gone is a
// leak, not a convenience.
function useSampleAudio(
  token: string,
  replicaId: string,
  generationId: string,
  onAuthError: (cause: unknown) => void,
): { state: SampleAudioState; url: string | null } {
  const [state, setState] = useState<SampleAudioState>("loading");
  const [url, setUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setState("loading");
    setUrl(null);
    fetchGenerationAudio(token, replicaId, generationId, controller.signal)
      .then((blob) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        urlRef.current = objectUrl;
        setUrl(objectUrl);
        setState("ready");
      })
      .catch((cause) => {
        if (cancelled) return;
        if (cause && typeof cause === "object" && "status" in cause && (cause as { status?: number }).status === 401) {
          onAuthError(cause);
          return;
        }
        setState("unavailable");
      });
    return () => {
      cancelled = true;
      controller.abort();
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, replicaId, generationId]);

  return { state, url };
}

function ListeningSample({
  slotLabel,
  slotKey,
  candidate,
  rating,
  onScore,
  token,
  replicaId,
  onAuthError,
}: {
  slotLabel: string;
  slotKey: SlotKey;
  candidate: VoiceListeningCandidate;
  rating: Partial<ListeningRating>;
  onScore: (slot: SlotKey, axis: ListeningAxis, score: number) => void;
  token: string;
  replicaId: string;
  onAuthError: (cause: unknown) => void;
}) {
  const { state, url } = useSampleAudio(token, replicaId, candidate.generation_id, onAuthError);
  return (
    <article className="lt-sample" aria-label={slotLabel}>
      <h3>{slotLabel}</h3>
      {state === "loading" ? (
        <p className="lt-playback-note">Loading this sample.</p>
      ) : state === "ready" && url ? (
        // Not autoplaying and no aria-label naming which candidate this is:
        // the blinding this screen exists for is the order, not merely the
        // rating form -- a labelled player would leak exactly what the
        // rating form itself withholds.
        <audio controls preload="none" src={url} className="lt-player">
          Your browser does not support audio playback. You can still rate this sample.
        </audio>
      ) : (
        <p className="lt-playback-note">
          This sample could not be loaded right now. You can still rate it from memory, or cancel
          and start a new listening test once it is available.
        </p>
      )}
      {AXES.map((axis) => (
        <fieldset key={axis.id} className="lt-axis">
          <legend>{axis.label}</legend>
          <div className="lt-axis-scale" role="radiogroup" aria-label={`${axis.label}, 1 ${axis.low} to 5 ${axis.high}`}>
            {SCORES.map((score) => {
              const id = `lt-${slotKey}-${axis.id}-${score}`;
              return (
                <label key={score} className="lt-score" htmlFor={id}>
                  <input
                    id={id}
                    type="radio"
                    name={`lt-${slotKey}-${axis.id}`}
                    value={score}
                    checked={rating[axis.id] === score}
                    onChange={() => onScore(slotKey, axis.id, score)}
                  />
                  <span>{score}</span>
                </label>
              );
            })}
          </div>
          <p className="lt-axis-help">{axis.low} to {axis.high}</p>
        </fieldset>
      ))}
    </article>
  );
}
