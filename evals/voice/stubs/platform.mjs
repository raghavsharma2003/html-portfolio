// Node stubs for the three Capacitor packages src/voice/speech.ts imports, so
// the REAL module can be bundled and RUN outside the app.
//
// These are not simulations of a phone. They are recorders: every one of them
// exists to capture the exact string that would have been handed to a platform
// speech engine, because that string — not a source grep, not a comment — is
// the thing the gate has to assert on. `context/rejected.md#selfbundle-never-set`
// is the reason: a manifest that says "wired" is checked by nothing.

const cap = () => (globalThis.__VOICE_CAPTURE ||= { device: [], eleven: [], sarvam: [], proxy: [] });

/** `Capacitor.isNativePlatform()` decides which device engine speech.ts uses,
 *  and it is read ONCE at module load — so the harness sets the flag before
 *  importing the bundle, and gets one lane per bundle load. */
export const Capacitor = {
  isNativePlatform: () => Boolean(globalThis.__MEERA_NATIVE),
};

export const registerPlugin = () => ({
  available: async () => ({ supported: false, micGranted: false }),
  start: async () => {},
  stop: async () => {},
  setMuted: async () => {},
  addListener: async () => ({ remove() {} }),
  captureTrace: async () => ({ reqAt: 0, grantAt: 0, fast: false, n: 0 }),
});

/** @capacitor-community/text-to-speech — the Android device voice. */
export const TextToSpeech = {
  speak: async (o) => {
    cap().device.push(String(o?.text ?? ""));
  },
  stop: async () => {},
  getSupportedVoices: async () => ({ voices: [] }),
};

/** @capgo/capacitor-speech-recognition — never exercised here; present so the
 *  import resolves. */
export const SpeechRecognition = {
  available: async () => ({ available: false }),
  requestPermissions: async () => ({ speechRecognition: "denied" }),
  removeAllListeners: async () => {},
  addListener: async () => ({ remove() {} }),
  start: async () => {},
  stop: async () => {},
};
