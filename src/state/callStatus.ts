// A live call, visible from anywhere in the app, without lifting the call.
//
// The problem this solves is narrow and specific. When a game is on screen, the
// board's header should show that a call is running — its timer, a mute
// control, and a way back — because a call that becomes invisible the moment
// you open a board is exactly the discreteness the activity layer exists to
// remove. But that state lives in `useCallEngine`, which is mounted inside
// `CallVoice`.
//
// THE OBVIOUS FIX IS THE WRONG ONE. Lifting `useCallEngine` into App, or
// publishing its status upward through an `onStatus` prop, puts a value that
// ticks EVERY SECOND into App's state — and App renders `Chat`, which owns the
// message list, the burst window, the reply cycle and every animation in the
// product. A call would then re-render the entire chat sixty times a minute for
// the sake of a clock in a header nobody may be looking at. That is not a
// theoretical cost: this is the file tree where `cache-9x` and the connect-cost
// budget are measured numbers.
//
// So the status is published to a module-level store and read by SUBSCRIPTION.
// The per-second tick re-renders only the component that asked for it. App does
// not re-render, Chat does not re-render, and the call engine stays exactly
// where it is.
//
// Module-level mutable state is otherwise avoided in this codebase (the time
// module has an eval asserting it has none, because accumulated state there
// silently makes two tabs share a counter). It is correct here and only here:
// there is exactly one call at a time by construction — the engine is mounted
// once, under `{inCall && <CallVoice/>}` — and this is a projection of that
// single mount, never an accumulator. `clearCallStatus` on unmount is what
// keeps it a projection.

import { useEffect, useState } from "react";

export interface CallStatus {
  /** true once the call is up. False while ringing, and after it ends. */
  live: boolean;
  connecting: boolean;
  muted: boolean;
  /** "3:07" — formatted by the engine, so there is one clock, not two. */
  mmss: string;
  toggleMute?: () => void;
  /** A screen share is live right now — either lane. Every surface that
   *  shows call state must show this too: she can see the screen, and the
   *  UI has to say so wherever the call is represented, not only on the
   *  call screen itself (audit: `watch-invisible-off-call-screen`). */
  watching: boolean;
  /** The look-away is engaged — she is not receiving anything while this
   *  is true, even though `watching` stays true (the share itself is not
   *  paused, only what leaves the device). */
  watchPaused: boolean;
  /** Toggles the look-away. Omitted, no control is drawn. Stable identity —
   *  see `useCallEngine.ts`'s `onLookAway`. */
  onLookAway?: () => void;
  /** The live lane silently dropped to the cascade fallback moments ago.
   *  True for a short, bounded beat — long enough for a quiet "voice
   *  quality reduced" pill to be readable, never a permanent state (audit:
   *  `live-lane-silent-drop`). */
  laneDegraded: boolean;
}

const IDLE: CallStatus = {
  live: false,
  connecting: false,
  muted: false,
  mmss: "",
  watching: false,
  watchPaused: false,
  laneDegraded: false,
};

let current: CallStatus = IDLE;
const listeners = new Set<(s: CallStatus) => void>();

function emit() {
  for (const fn of listeners) fn(current);
}

/**
 * Publish. Called by useCallEngine on each render; cheap, and a no-op unless
 * something a subscriber can see actually changed.
 *
 * The equality check is the point. Without it every engine render notifies
 * every subscriber, which reintroduces the cost this file exists to avoid —
 * just one component further down.
 */
export function publishCallStatus(next: CallStatus): void {
  if (
    current.live === next.live &&
    current.connecting === next.connecting &&
    current.muted === next.muted &&
    current.mmss === next.mmss &&
    current.toggleMute === next.toggleMute &&
    current.watching === next.watching &&
    current.watchPaused === next.watchPaused &&
    current.onLookAway === next.onLookAway &&
    current.laneDegraded === next.laneDegraded
  ) {
    return;
  }
  current = next;
  emit();
}

/** The call is gone. Called on the engine's unmount, so nothing outlives it. */
export function clearCallStatus(): void {
  if (current === IDLE) return;
  current = IDLE;
  emit();
}

export function getCallStatus(): CallStatus {
  return current;
}

/** Subscribe. Only the component that calls this re-renders on a tick. */
export function useCallStatus(): CallStatus {
  const [s, setS] = useState<CallStatus>(current);
  useEffect(() => {
    // Re-read on subscribe: the call may have started between this component's
    // render and its effect, and a header that says "no call" during a call is
    // worse than one that is a frame late.
    setS(current);
    listeners.add(setS);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}
