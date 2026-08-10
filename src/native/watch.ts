// Watch-together native bridge (Android only). The web build exposes the
// same API surface but reports unavailable — the call UI hides the button.

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

interface WatchNative {
  start(): Promise<void>;
  stop(): Promise<void>;
  addListener(
    event: "frame",
    cb: (data: { data: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(event: "stopped", cb: () => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

const Watch = registerPlugin<WatchNative>("Watch");

export const watchAvailable = () => Capacitor.isNativePlatform();

export interface WatchSession {
  stop: () => void;
}

// Start a screen-watch session: runs the system consent dialog, then feeds
// downscaled JPEG frames (data URLs) to onFrame every ~3s until stopped.
export async function startWatch(
  onFrame: (dataUrl: string) => void,
  onStopped: () => void,
): Promise<WatchSession> {
  await Watch.removeAllListeners();
  await Watch.addListener("frame", ({ data }) => {
    if (data) onFrame(`data:image/jpeg;base64,${data}`);
  });
  await Watch.addListener("stopped", () => onStopped());
  await Watch.start(); // throws if the user denies the consent dialog
  return {
    stop: () => {
      Watch.stop().catch(() => {});
      Watch.removeAllListeners().catch(() => {});
    },
  };
}
