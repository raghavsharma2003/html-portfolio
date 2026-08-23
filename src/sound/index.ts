// The sound layer — one context, one bus, one gate, one door.
//
// Meera has been silent everywhere except a phone call. This is the channel
// that closes, and the entire risk of building it is that a companion app that
// makes noises at you is worse than one that does not. So the design rule is
// stated before the code and every line below is downstream of it:
//
//   SOUND HERE IS FURNITURE, NOT NOTIFICATION. It confirms what he just did,
//   or the reply that came back because of it. It never announces, never
//   summons, never fires while he is looking somewhere else, and it is mixed
//   low enough that the first thing most people will notice is how it feels
//   when they turn it OFF.
//
// ── THE FOUR GATES, AND WHY EACH ONE IS NOT OPTIONAL ──────────────────────
//
//   1. GESTURE. No AudioContext exists until the user's first pointer or key
//      event, and `play()` is a no-op until then. This is browser law rather
//      than taste (an unlocked context is the only reliable way to make sound
//      on mobile), but it is also the strongest possible guarantee that this
//      layer cannot make a noise at somebody who has not touched the app.
//
//   2. THE TOGGLE. One switch in Settings, default on, and `soundOn === false`
//      is the only value that means off — an install that predates the field
//      carries `undefined` and gets the default, which is the same rule every
//      other optional field in AppState follows (`age-tier-never-realtime`:
//      a stored shape is not rewritten under a running install).
//
//   3. THE CALL. Nothing in this file may make a sound while a call is up,
//      connecting, or sharing a screen. This is the one gate that is not about
//      taste at all: whatever we emit goes out of the speaker, into the mic,
//      and into the echo coefficient that the entire audio floor at
//      evals/echosim/ is measured against. It is checked from TWO independent
//      sources — `state/callStatus.ts`, which the call engine publishes, and a
//      flag the chat publishes from its own `inCall` prop — because the window
//      where a call exists is wider than the window where the engine is
//      mounted, and a gate with one source is a gate with one way to be stale.
//
//   4. VISIBILITY. A backgrounded tab makes no sound. A sound from an app that
//      is not on screen is a notification by definition, and notifications are
//      the thing this layer is not.
//
// ── OS SILENT MODE, HONESTLY ──────────────────────────────────────────────
//
// The brief asks for the ringer switch to be respected where it is detectable.
// Where it stands, stated plainly rather than implied:
//
//   iOS / iPadOS   respected FOR FREE, and this is a real argument for Web
//                  Audio over an <audio> element rather than a coincidence:
//                  WebKit runs Web Audio in the ambient audio session, which
//                  the hardware mute switch silences. `[unmeasured, platform
//                  documentation]` — nobody here has held a muted iPhone
//                  against this build, and this note is not a test result.
//   Android         NOT detectable from a WebView. There is no web API for the
//                  ringer mode and no Capacitor plugin in this project's
//                  dependency list that exposes one. Claiming otherwise would
//                  be a field that reads as verification and is checked by
//                  nothing, which this repo already has a name for
//                  (`manifest-sourcestatus`).
//
// So: the seam exists (`registerSilenceProbe`), it is wired to nothing, and
// that is written down here instead of being described as coverage. Adding
// @capacitor-community/volume-buttons or an equivalent is a one-line change at
// the seam and a real gate the day someone measures it.

import { tap, land, moment as momentHaptic } from "../native/haptics";
import { getCallStatus } from "../state/callStatus";
import { CUES, isCue, type Cue } from "./vocabulary";
import { RECIPES } from "./synth";

export { SOUND_CUES, CUES, REFUSED, isCue } from "./vocabulary";
export type { Cue, CueSpec, HapticLevel } from "./vocabulary";

/**
 * The master. Every cue's `gain` in the vocabulary table is RELATIVE to this,
 * so the whole palette gets quieter or louder by one number and the ranking
 * between cues survives the change.
 *
 * 0.34 is low on purpose. The loudest cue in the palette peaks at 0.75 x 0.34
 * = 0.255 of full scale, on a transient tens of milliseconds long. On a phone
 * at a normal media volume that is a sound you notice in a quiet room and do
 * not notice in a loud one, which is what furniture does.
 */
const MASTER = 0.34;

/** The ceiling the gate pins. No cue may exceed this once multiplied out. */
export const MAX_ABS_PEAK = 0.28;

/** The longest any cue may ring. The palette's longest is `moment` at 720ms. */
export const MAX_CUE_MS = 800;

/**
 * Two cues cannot land closer together than this. Not a taste rule: two
 * transients inside a few milliseconds sum, and a summed transient is both
 * louder than either cue's declared peak and a different sound from the one
 * in the table. Board play can produce a burst (a piece placed, hers answering
 * immediately), so the throttle is what keeps the mix honest under one.
 */
const MIN_GAP_MS = 70;

type Ctx = AudioContext;

let ctx: Ctx | null = null;
let bus: GainNode | null = null;
let armed = false;
let enabled = true;
let callActive = false;
let lastAt = 0;

/** The silent-mode seam. Returns true if the device says do not make noise.
 *  Wired to nothing today — see the header. */
let silenceProbe: (() => boolean) | null = null;

/**
 * Install a platform probe for OS silent mode. Called by native glue if and
 * when a plugin that can answer the question is added; until then the
 * function this replaces does not exist and `play()` does not pretend it does.
 */
export function registerSilenceProbe(fn: () => boolean): void {
  silenceProbe = fn;
}

/**
 * The toggle, published from React.
 *
 * `Chat.tsx` mirrors `state.soundOn` here on every change, and the Settings
 * row calls it directly at the instant of the tap so that switching sound ON
 * can be confirmed by a sound — a preview that arrived a render later would
 * be a preview of the previous state. Both callers pass the same derived
 * value and the call is idempotent, so the second one is a confirmation of
 * the first rather than a competing writer.
 */
export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

/**
 * Gate 3's second source. `Chat.tsx` publishes its `inCall` prop here, which
 * opens earlier than the call engine's own status does (the engine is mounted
 * once App has already decided a call is happening).
 */
export function setCallActive(on: boolean): void {
  callActive = on;
  // A call starting mid-cue would put our tail into the mic. Nothing here is
  // longer than 720ms so this is a small window, but it is the one window the
  // echo floor cannot absorb, and cutting the bus is one line.
  if (on && bus && ctx) {
    try {
      bus.gain.cancelScheduledValues(ctx.currentTime);
      bus.gain.setValueAtTime(0, ctx.currentTime);
    } catch {
      /* a bus we cannot silence is a bus that will be silent again in 720ms */
    }
  } else if (!on && bus && ctx) {
    try {
      bus.gain.setValueAtTime(MASTER, ctx.currentTime);
    } catch {
      /* next unlock rebuilds it */
    }
  }
}

/**
 * Arm the layer: listen for the first user gesture, and build the audio graph
 * inside it. Called once, from `Chat.tsx`'s mount.
 *
 * This installs listeners; it does NOT create an AudioContext. That
 * distinction is the whole of gate 1: a context built at import time is a
 * context that exists before consent, and on Safari it is also a context stuck
 * in `suspended` forever because the resume never happened inside a gesture.
 *
 * Capture phase, so the unlock has already happened by the time React's own
 * handler for the same gesture runs `play("send")`.
 */
export function armSound(): () => void {
  if (armed || typeof window === "undefined") return () => {};
  armed = true;
  const events: Array<keyof WindowEventMap> = ["pointerdown", "touchend", "keydown"];
  const onGesture = () => {
    unlock();
    for (const e of events) window.removeEventListener(e, onGesture, true);
  };
  for (const e of events) window.addEventListener(e, onGesture, true);
  return () => {
    armed = false;
    for (const e of events) window.removeEventListener(e, onGesture, true);
  };
}

function unlock(): void {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return;
  }
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    // `latencyHint: "interactive"` is the correct hint for cues that answer a
    // finger, and it is also how this context is told apart from the voice
    // lane's in a browser probe: src/voice/speech.ts and src/voice/liveCall.ts
    // build theirs bare, and NOTHING in this file may touch either of them.
    ctx = new AC({ latencyHint: "interactive" });
    bus = ctx.createGain();
    bus.gain.setValueAtTime(callActive ? 0 : MASTER, ctx.currentTime);
    bus.connect(ctx.destination);
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    // No Web Audio: the app is exactly as it was before this file existed.
    ctx = null;
    bus = null;
  }
}

/** Every reason `play()` can decline, in the order it checks them. Exported
 *  so the gate can drive each one individually instead of asserting silence
 *  and guessing which gate produced it. */
export type Block = "unknown-cue" | "locked" | "off" | "in-call" | "hidden" | "silenced" | "throttled" | null;

/**
 * Would this cue sound right now, and if not, which gate stopped it?
 *
 * Split out from `play` so that the gate battery can assert the REASON and not
 * merely the silence. A test that only checks "nothing happened" passes just
 * as happily when the audio graph is broken as when the gate is working, which
 * is a test that cannot tell a working gate from a dead feature.
 */
export function blockedBy(cue: Cue, now = Date.now()): Block {
  if (!isCue(cue)) return "unknown-cue";
  if (!ctx || !bus || ctx.state !== "running") return "locked";
  if (!enabled) return "off";
  // Gate 3, both sources. `watching` is a screen share, which is a live call
  // with a second stream on it, and it is listed explicitly rather than left
  // to `live` because the share can outlive a lane swap.
  const call = getCallStatus();
  if (callActive || call.live || call.connecting || call.watching) return "in-call";
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return "hidden";
  if (silenceProbe?.()) return "silenced";
  if (now - lastAt < MIN_GAP_MS) return "throttled";
  return null;
}

/**
 * THE ONLY PATH TO THE SPEAKER.
 *
 * There is exactly one call to `RECIPES[...]` in this codebase and it is the
 * line below, downstream of every gate. That is a structural property the gate
 * asserts on the source, not a convention: a second call site is how a sound
 * layer acquires a path that skips the toggle, and the person who adds it will
 * be adding one small sound in a hurry.
 */
export function play(cue: Cue): void {
  const now = Date.now();
  if (blockedBy(cue, now) !== null) return;
  lastAt = now;
  try {
    // A hair into the future: scheduling at `currentTime` exactly means the
    // first few milliseconds of the envelope land in a block the graph has
    // already rendered, which clips the transient — and the transient is the
    // half of every cue in this palette that makes it sound physical.
    RECIPES[cue](ctx!, bus!, ctx!.currentTime + 0.005);
  } catch {
    /* a cue that fails to schedule is silence, which is the safe direction */
  }
}

/**
 * THE DOOR COMPONENTS USE. One call, both senses.
 *
 * The haptic level comes out of the vocabulary table, so a call site cannot
 * pick an intensity — the reason haptics.ts gives for having exactly three
 * levels does not survive a second file where anyone can choose. `receive`
 * deliberately carries no haptic; see the note on it in vocabulary.ts.
 *
 * The haptic fires whether or not the sound does: the sound toggle is a sound
 * toggle. Someone who turns sound off in a meeting has not asked their phone
 * to stop confirming their taps.
 */
export function feel(cue: Cue): void {
  play(cue);
  switch (CUES[cue].haptic) {
    case "tap":
      tap();
      break;
    case "land":
      land();
      break;
    case "moment":
      momentHaptic();
      break;
    default:
      break;
  }
}

/** Test seam for the offline gate: reset module state between cases. Not
 *  reachable from the app, and asserted to have no caller in src/. */
export function _resetSound(): void {
  ctx = null;
  bus = null;
  armed = false;
  enabled = true;
  callActive = false;
  lastAt = 0;
  silenceProbe = null;
}
