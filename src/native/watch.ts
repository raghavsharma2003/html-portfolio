// Watch-together native bridge (Android only). The web build exposes the
// same API surface but reports unavailable — the call UI hides the button.

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

interface WatchNative {
  start(options?: { config?: string }): Promise<void>;
  stop(): Promise<void>;
  /** Is a capture session running right now? (survives a WebView reload) */
  state(): Promise<{ active: boolean }>;
  ensureOverlay(options?: { prompt?: boolean }): Promise<{ granted: boolean }>;
  /** Look away without ending the share (see setWatchPrivate below). */
  setPrivate(options: { on: boolean }): Promise<void>;
  /** "Let her hear it" — device audio into the uplink. Default OFF, reset OFF
   *  at the end of every share (see setWatchMediaAudio below). */
  setMediaAudio(options: { on: boolean }): Promise<{ on: boolean }>;
  addListener(
    event: "frame",
    cb: (data: { data: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "watchturn",
    cb: (data: { who: string; text: string }) => void,
  ): Promise<PluginListenerHandle>;
  /** A SHOW-class wake that ACTUALLY went out on the native side, after every
   *  native suppressor passed (WatchCaptureService.emitShowWake). Liveness
   *  only — it carries no picture, no claim and no text, just which class of
   *  "they just showed you something" fired. The web layer uses it to arm the
   *  same shared-moment window the web watch lane arms. */
  addListener(
    event: "watchwake",
    cb: (data: { class: string }) => void,
  ): Promise<PluginListenerHandle>;
  /** WS-WATCHPERF: the frame lifecycle out of the service process. Content-
   *  free by the same contract every diag record obeys — timings, counts,
   *  sizes, class names, refusal reasons. Never a picture and never a word. */
  addListener(
    event: "watchdiag",
    cb: (data: Record<string, unknown>) => void,
  ): Promise<PluginListenerHandle>;
  addListener(event: "stopped", cb: () => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

const Watch = registerPlugin<WatchNative>("Watch");

export const watchAvailable = () => Capacitor.isNativePlatform();

// "Display over other apps" is a settings toggle, not a runtime dialog.
// prompt=false just checks; prompt=true also opens the toggle screen when
// the grant is missing (the caller decides when nagging is acceptable).
export async function ensureOverlay(prompt: boolean): Promise<boolean> {
  try {
    const { granted } = await Watch.ensureOverlay({ prompt });
    return granted;
  } catch {
    return false;
  }
}

/**
 * THE LOOK-AWAY. Stop sending frames without ending the session, so someone
 * who needs a few seconds of privacy does not have to kill the share and
 * re-run the consent dialog — which in practice means never sharing again.
 * Nothing is encoded and nothing enters the socket while this is on, and
 * because every wake-up already requires a frame that actually arrived, she
 * goes blind politely and cannot invent a word about what she missed.
 *
 * USER-INITIATED ONLY. Nothing may ever set this from a heuristic about what
 * is on the screen: that would be the content-scoring this product does not
 * do, and she would go mysteriously blind for reasons she could not explain.
 */
export async function setWatchPrivate(on: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Watch.setPrivate({ on });
  } catch {
    /* older shell without setPrivate — the web-side gate still holds */
  }
}

/**
 * "LET HER HEAR IT" — the phone's own audio into the uplink, alongside the
 * microphone.
 *
 * DEFAULT OFF, and the native side turns it off again at the end of every
 * share. Device audio is consented to per share exactly as the picture is, so
 * a preference that survived a session would be a consent nobody gave for the
 * next one — the same rule the look-away follows.
 *
 * The capture is scoped to the SAME MediaProjection as the screen share: it
 * cannot start without a live share and cannot outlive one. Nothing is stored,
 * and the watch-content contract applies unchanged — what she hears on the
 * stream is like what she sees on it, present tense only, never a durable fact
 * source.
 */
export async function setWatchMediaAudio(on: boolean): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const r = await Watch.setMediaAudio({ on });
    return Boolean(r?.on);
  } catch {
    return false; // older shell without setMediaAudio — mic-only, as before
  }
}

export interface WatchSession {
  stop: () => void;
}

interface Handlers {
  onFrame: (dataUrl: string) => void;
  onTurn: (who: "me" | "her", text: string) => void;
  onStopped: () => void;
  /** Optional: older callers (and the web-only build) simply do not listen. */
  onWake?: (cls: string) => void;
  /** WS-WATCHPERF: one frame-lifecycle record from the capture service. */
  onDiag?: (detail: Record<string, unknown>) => void;
}

// ONE set of native listeners for the whole app lifetime, dispatching to the
// session that currently owns them. Registering per session (and removing
// them per session) let two racing starts double every handler — duplicated
// turns, and a duplicated "stopped" that looked like two engines.
let wiring: Promise<void> | null = null;
let handlers: Handlers | null = null;
let starting = false;

function wireOnce(): Promise<void> {
  if (!wiring) {
    wiring = (async () => {
      await Watch.addListener("frame", ({ data }) => {
        if (data) handlers?.onFrame(`data:image/jpeg;base64,${data}`);
      });
      await Watch.addListener("watchturn", ({ who, text }) => {
        if (text) handlers?.onTurn(who === "her" ? "her" : "me", text);
      });
      await Watch.addListener("watchwake", ({ class: cls }) => {
        // dispatched to the session that owns the listeners right now; a wake
        // from a share that has already been stopped finds handlers === null
        // and dies here, exactly like a late turn does
        if (cls) handlers?.onWake?.(cls);
      });
      await Watch.addListener("watchdiag", (detail) => {
        // dispatched exactly like a wake: a record from a share that has
        // already stopped finds handlers === null and dies here
        if (detail) handlers?.onDiag?.(detail);
      });
      await Watch.addListener("stopped", () => {
        // exactly one stop per session, however many the native side emits
        const h = handlers;
        handlers = null;
        h?.onStopped();
      });
    })().catch((e) => {
      wiring = null;
      throw e;
    });
  }
  return wiring;
}

/** Is a native watch session currently owned by this web layer? */
export const watchOwned = () => handlers !== null;

// Start a screen-watch session: runs the system consent dialog, then the
// NATIVE engine (service process — immune to WebView freezing) sees frames,
// thinks, speaks, and listens. JS only receives liveness + transcript turns.
export async function startWatch(
  config: {
    base: string;
    system: string;
    systemLive?: string; // live speech-to-speech engine variant (no TTS machinery)
    systemTail: string;
    /** Appended by the native side ONLY on turns that carry a real frame. */
    watchNote?: string;
    directive: string;
  },
  onFrame: (dataUrl: string) => void,
  onTurn: (who: "me" | "her", text: string) => void,
  onStopped: () => void,
  /** A SHOW-class wake that actually fired natively — see the listener above.
   *  Optional so the signature stays backwards-compatible. */
  onWake?: (cls: string) => void,
  /** WS-WATCHPERF: the native frame lifecycle, for the diag stream. */
  onDiag?: (detail: Record<string, unknown>) => void,
): Promise<WatchSession> {
  // a second start while one is live/starting would run a second consent
  // dialog and a second engine — two of her, offset by a second
  if (starting || handlers) throw new Error("watch already running");
  starting = true;
  try {
    await wireOnce();
    handlers = { onFrame, onTurn, onStopped, onWake, onDiag };
    try {
      await Watch.start({ config: JSON.stringify(config) }); // throws on denial
    } catch (e) {
      handlers = null;
      throw e;
    }
  } finally {
    starting = false;
  }
  return {
    stop: () => {
      handlers = null; // late native events must not reach a dead session
      Watch.stop().catch(() => {});
    },
  };
}

/**
 * Kill a capture session this web layer does NOT own. The service outlives
 * the WebView (renderer kill, reload, app restart), so a fresh call could
 * otherwise start its own engine on top of a native one still talking.
 */
export async function stopStrayWatch(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || handlers || starting) return false;
  try {
    const r = await Watch.state();
    // a session we started while the query was in flight is ours, not a stray
    if (!r?.active || handlers || starting) return false;
    await Watch.stop();
    return true;
  } catch {
    return false; // older shell without state() — nothing we can do
  }
}
