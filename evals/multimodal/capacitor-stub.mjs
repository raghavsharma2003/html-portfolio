// A stand-in for @capacitor/core, so src/native/watch.ts can be driven off
// device. It fakes ONLY the two things that file imports: the platform test
// and the plugin proxy. Every listener registration is recorded so a test can
// deliver a native event the way the Android bridge does.
export const Capacitor = { isNativePlatform: () => true };

export const __bridge = {
  listeners: new Map(), // event -> [cb]
  calls: [], // { method, args }
  startShouldReject: false,
  /** Deliver a native event exactly as WatchPlugin.notifyListeners does. */
  emit(event, data) {
    for (const cb of __bridge.listeners.get(event) ?? []) cb(data);
  },
  reset() {
    __bridge.listeners = new Map();
    __bridge.calls = [];
    __bridge.startShouldReject = false;
  },
};

export function registerPlugin(name) {
  return {
    async addListener(event, cb) {
      const list = __bridge.listeners.get(event) ?? [];
      list.push(cb);
      __bridge.listeners.set(event, list);
      return { remove: async () => {} };
    },
    async start(opts) {
      __bridge.calls.push({ plugin: name, method: "start", args: opts });
      if (__bridge.startShouldReject) throw new Error("consent denied");
    },
    async stop() {
      __bridge.calls.push({ plugin: name, method: "stop" });
    },
    async state() {
      return { active: false };
    },
    async ensureOverlay() {
      return { granted: true };
    },
    async setPrivate(o) {
      __bridge.calls.push({ plugin: name, method: "setPrivate", args: o });
    },
    async removeAllListeners() {},
  };
}
