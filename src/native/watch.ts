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
  addListener(
    event: "frame",
    cb: (data: { data: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "watchturn",
    cb: (data: { who: string; text: string }) => void,
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

export interface WatchSession {
  stop: () => void;
}

interface Handlers {
  onFrame: (dataUrl: string) => void;
  onTurn: (who: "me" | "her", text: string) => void;
  onStopped: () => void;
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
): Promise<WatchSession> {
  // a second start while one is live/starting would run a second consent
  // dialog and a second engine — two of her, offset by a second
  if (starting || handlers) throw new Error("watch already running");
  starting = true;
  try {
    await wireOnce();
    handlers = { onFrame, onTurn, onStopped };
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
