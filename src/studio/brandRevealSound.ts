/*
 * The first-run sonic mark has one narrow job: confirm the successful handoff
 * from agreement to Vyakti. It owns a short-lived AudioContext created inside
 * that exact tap. Nothing here retries autoplay, fetches an asset, or survives
 * the reveal.
 */

export const BRAND_REVEAL_MUTE_KEY = "vyakti:experience:reveal-muted:v1";
export const BRAND_REVEAL_DURATION_MS = 420;

export const BRAND_REVEAL_SCORE = Object.freeze([
  Object.freeze({ frequency: 293.66, offsetMs: 0, durationMs: 330, gain: 0.34, type: "sine" as OscillatorType }),
  Object.freeze({ frequency: 440, offsetMs: 92, durationMs: 286, gain: 0.25, type: "triangle" as OscillatorType }),
  Object.freeze({ frequency: 587.33, offsetMs: 184, durationMs: 236, gain: 0.2, type: "sine" as OscillatorType }),
]);

type RevealPreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export type BrandRevealSoundSession = {
  play: () => boolean;
  stop: () => void;
};

export type BrandRevealSoundOptions = {
  muted: boolean;
  reduceMotion: boolean;
  contextFactory?: () => AudioContext | null;
};

export function shouldPlayBrandRevealSound({ muted, reduceMotion }: Pick<BrandRevealSoundOptions, "muted" | "reduceMotion">) {
  return !muted && !reduceMotion;
}

function browserStorage(): RevealPreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readBrandRevealMuted(storage: RevealPreferenceStorage | null = browserStorage()) {
  try {
    return storage?.getItem(BRAND_REVEAL_MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistBrandRevealMuted(muted: boolean, storage: RevealPreferenceStorage | null = browserStorage()) {
  try {
    storage?.setItem(BRAND_REVEAL_MUTE_KEY, muted ? "1" : "0");
  } catch {
    // The in-memory preference still works when private browsing denies storage.
  }
}

function createBrowserAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const AudioContextConstructor = window.AudioContext
      || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    return AudioContextConstructor ? new AudioContextConstructor({ latencyHint: "interactive" }) : null;
  } catch {
    return null;
  }
}

/**
 * Must be called directly inside the Agree handler. Creating and resuming the
 * dedicated context there gives mobile browsers a real user gesture. Playback
 * happens once when the visual reveal mounts; if the browser still refuses it,
 * the visual mark remains the complete equivalent and the journey continues.
 */
export function createBrandRevealSoundSession(options: BrandRevealSoundOptions): BrandRevealSoundSession | null {
  if (!shouldPlayBrandRevealSound(options)) return null;
  const context = (options.contextFactory ?? createBrowserAudioContext)();
  if (!context) return null;

  let played = false;
  let stopped = false;
  let master: GainNode | null = null;
  const oscillators: OscillatorNode[] = [];

  try {
    if (context.state === "suspended") void context.resume().catch(() => undefined);
  } catch {
    // Playback will fail closed without delaying the next screen.
  }

  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      if (master && context.state !== "closed") {
        master.gain.cancelScheduledValues(context.currentTime);
        master.gain.setValueAtTime(0, context.currentTime);
      }
    } catch {
      // Continue closing every node even when one browser rejects automation.
    }
    for (const oscillator of oscillators) {
      try { oscillator.stop(); } catch { /* It may already have ended. */ }
      try { oscillator.disconnect(); } catch { /* It may never have connected. */ }
    }
    try { master?.disconnect(); } catch { /* It may never have connected. */ }
    try { void context.close().catch(() => undefined); } catch { /* Silence is safe. */ }
  };

  const play = () => {
    if (played || stopped || context.state === "closed") return false;
    played = true;
    try {
      const startAt = context.currentTime + 0.008;
      const endAt = startAt + BRAND_REVEAL_DURATION_MS / 1000;
      master = context.createGain();
      master.gain.setValueAtTime(0.0001, startAt);
      master.gain.exponentialRampToValueAtTime(0.27, startAt + 0.018);
      master.gain.setValueAtTime(0.27, endAt - 0.09);
      master.gain.exponentialRampToValueAtTime(0.0001, endAt);
      master.connect(context.destination);

      for (const note of BRAND_REVEAL_SCORE) {
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        const noteAt = startAt + note.offsetMs / 1000;
        const noteEnd = noteAt + note.durationMs / 1000;
        oscillator.type = note.type;
        oscillator.frequency.setValueAtTime(note.frequency, noteAt);
        envelope.gain.setValueAtTime(0.0001, noteAt);
        envelope.gain.exponentialRampToValueAtTime(note.gain, noteAt + 0.016);
        envelope.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
        oscillator.connect(envelope).connect(master);
        oscillator.start(noteAt);
        oscillator.stop(Math.min(endAt, noteEnd + 0.006));
        oscillators.push(oscillator);
      }
      return true;
    } catch {
      stop();
      return false;
    }
  };

  return { play, stop };
}
