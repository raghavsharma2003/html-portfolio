// Watch-together native bridge (Android only). The web build exposes the
// same API surface but reports unavailable — the call UI hides the button.

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

interface WatchNative {
  start(options?: { config?: string }): Promise<void>;
  stop(): Promise<void>;
  ensureOverlay(options?: { prompt?: boolean }): Promise<{ granted: boolean }>;
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

export interface WatchSession {
  stop: () => void;
}

// Start a screen-watch session: runs the system consent dialog, then the
// NATIVE engine (service process — immune to WebView freezing) sees frames,
// thinks, speaks, and listens. JS only receives liveness + transcript turns.
export async function startWatch(
  config: {
    base: string;
    system: string;
    systemTail: string;
    directive: string;
  },
  onFrame: (dataUrl: string) => void,
  onTurn: (who: "me" | "her", text: string) => void,
  onStopped: () => void,
): Promise<WatchSession> {
  await Watch.removeAllListeners();
  await Watch.addListener("frame", ({ data }) => {
    if (data) onFrame(`data:image/jpeg;base64,${data}`);
  });
  await Watch.addListener("watchturn", ({ who, text }) => {
    if (text) onTurn(who === "her" ? "her" : "me", text);
  });
  await Watch.addListener("stopped", () => onStopped());
  await Watch.start({ config: JSON.stringify(config) }); // throws on denial
  return {
    stop: () => {
      Watch.stop().catch(() => {});
      Watch.removeAllListeners().catch(() => {});
    },
  };
}
