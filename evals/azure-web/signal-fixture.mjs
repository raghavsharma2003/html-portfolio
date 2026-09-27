// Deterministically inject Node v24.18.1's historical message-close behavior
// while retaining the real native signal on newer runtimes. Node v24.21.0
// leaves its native signal live after successful body consumption, so native
// availability cannot decide whether this historical regression runs.
export function createHistoricalMessageSignalFixture(readNativeSignal) {
  const states = new WeakMap();
  return req => {
    let state = states.get(req);
    if (!state) {
      const legacyCloseController = new AbortController();
      const nativeSignal = readNativeSignal(req);
      if (req.destroyed) legacyCloseController.abort();
      else req.once('close', () => legacyCloseController.abort());
      state = {
        legacyCloseController,
        nativeSignal,
        signal: nativeSignal
          ? AbortSignal.any([nativeSignal, legacyCloseController.signal])
          : legacyCloseController.signal,
      };
      states.set(req, state);
    }
    return state;
  };
}
