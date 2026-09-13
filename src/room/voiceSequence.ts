// WS-R156. The CLIENT half of "voice replies that start fast": the ordered,
// buffer-one-ahead loop that turns N sentence-clip fetches into one
// continuous-sounding playback. Extracted out of `RoomApp.tsx` into a plain,
// framework-free function so `evals/room-speak-plan/benchmark.mjs` can
// exercise this EXACT code, standalone, in a real browser against a fake
// synthesiser — `evals/echosim`'s own precedent (`build.mjs` transpiles the
// REAL `liveCall.ts` rather than a hand-simulated model of it) applied to
// this workstream's own client loop, so the measurement in
// `context/measurements.md` is of the code that ships, not of a description
// of it.
//
// Knows nothing about React, `fetch`, `HTMLAudioElement`, or the Room's own
// session/copy — every one of those is a HANDLER the caller supplies, so
// this file loads unmodified in a bare browser page with fakes for all four
// (the benchmark) or in `RoomApp.tsx` with the real ones (the product), and
// the two can never quietly disagree about what the LOOP itself does.
//
// `docs/gurukul/AZURE-DEPLOY-STATE.md` §8's own law — a complete, signed
// synthesis result per call, under a GPU lock, never a stream — is why this
// is a SEQUENCE OF WHOLE CALLS rather than a single subscription. The speed
// this buys comes from asking for LESS TEXT per call, never from a
// different transport this deployment does not have.

/** One clip in the sequence. `audio` is opaque to this file — the caller's
 *  own `playClip` is the only thing that ever reads it — and `count` is the
 *  real, server-computed total this reply plans to, read fresh off EVERY
 *  clip response, never cached from an earlier one. */
export interface VoiceClip {
  audio: unknown;
  count: number;
}

export interface VoiceSequenceHandlers {
  /** Fetches one clip by index. Called for index 0 first, then for each
   *  index after it while the MOST RECENT clip's own `count` says there is
   *  one — never for an index a real response already ruled out. */
  fetchClip: (index: number) => Promise<VoiceClip>;
  /** Plays one clip to completion (or until superseded). Resolves when the
   *  clip is done playing (a real `<audio>`'s `onended`, or a fake's own
   *  timer) — this loop awaits it before playing the NEXT clip, but the
   *  NEXT clip's own FETCH already started before this is even called (see
   *  `runVoiceSequence`'s own comment on where the "buffer one ahead" line
   *  actually sits). */
  playClip: (clip: VoiceClip, index: number) => Promise<void>;
  /** True while this sequence is still the active one. Checked after every
   *  `await` in the loop, so a superseded sequence (a different bubble
   *  tapped, or the whole thing stopped) never plays audio or reports a
   *  first-audio event a moment late — one supersession rule, not a
   *  scattered set of ad hoc checks at each call site. */
  isActive: () => boolean;
  /** Resolves immediately unless paused, in which case it resolves the
   *  moment a resume is requested. The ONE place BETWEEN two clips this
   *  loop can be held; pausing DURING a clip is the caller's own
   *  `playClip`'s business (a real `<audio>` element's native pause/play),
   *  never this loop's. */
  waitForResume: () => Promise<void>;
  /** Fired exactly once, the moment clip 0 is about to start playing — the
   *  event `evals/room-speak-plan/benchmark.mjs` times against, and the
   *  event `RoomApp.tsx` uses to flip its own "loading" state to
   *  "speaking". */
  onFirstAudio?: () => void;
}

/**
 * Fetches and plays an ordered sequence of clips, one sentence at a time.
 * The NEXT clip's fetch is started as soon as the CURRENT one's response
 * arrives — before that clip has even started playing — so the gap between
 * two clips is normally just whatever is left of the current one's own
 * playback, not a second fetch stacked on top of it. Resolves once every
 * clip has played, or returns early the moment `isActive()` says this
 * sequence has been superseded; never rejects on that — being superseded is
 * a normal event, not a failure, and the caller's own `try` around this call
 * is for a REAL fetch/synthesis error, not for this.
 */
export async function runVoiceSequence(handlers: VoiceSequenceHandlers): Promise<void> {
  let index = 0;
  let total = 1;
  let pending: Promise<VoiceClip> | null = null;
  while (index < total) {
    // eslint-disable-next-line no-await-in-loop
    const clip = await (pending ?? handlers.fetchClip(index));
    pending = null;
    if (!handlers.isActive()) return;
    total = clip.count;
    // Buffer one ahead: the NEXT clip's fetch starts NOW, in parallel with
    // this one's own resume-wait and playback, never after this one ends.
    if (index + 1 < total) pending = handlers.fetchClip(index + 1);
    // eslint-disable-next-line no-await-in-loop
    await handlers.waitForResume();
    if (!handlers.isActive()) return;
    if (index === 0) handlers.onFirstAudio?.();
    // eslint-disable-next-line no-await-in-loop
    await handlers.playClip(clip, index);
    if (!handlers.isActive()) return;
    index += 1;
  }
}
