// callCapture.ts — the microphone half of a Mirror Call.
//
// The cascade lane, not full-duplex. `docs/gurukul/research/ROADMAP-100X.md`
// §Voice pinned that decision and `MIRROR-CALL-SPEC.md` restates it, so this
// file deliberately cannot do anything else: one window at a time, the mic
// closed while the clone speaks, ASR → engine → TTS in sequence. Building
// duplex here would also mean building barge-in, and barge-in belongs to
// `src/voice/liveCall.ts`, which this may not touch and does not import.
//
// The pattern is `wavCapture.ts`'s (AudioContext → ScriptProcessor → 24 kHz
// mono WAV) with one difference that matters: `wavCapture` opens and CLOSES a
// microphone session per recording, because a consent clip is one recording.
// A call is many. Re-prompting the browser for the mic on every turn is both
// a permission dialog per sentence and a ~300ms dead gap where the owner is
// already talking, so the stream stays open for the whole call and each turn
// is a WINDOW cut out of it.
//
// The 30-second cap is enforced HERE as well as in `mirrorCallApi.ts`. Two
// checks for one rule is deliberate: the timer is what makes a long window
// impossible, and the API check is what makes a long window loud if the timer
// ever fails.
import { encodeWav24kMono, micPermissionMessage, resampleForUpload } from "./wavCapture";

export const DEFAULT_MAX_WINDOW_MS = 30_000;

export interface CapturedWindow {
  blob: Blob;
  durationMs: number;
  /** True when the 30s cap ended the window rather than the owner. The UI says
   *  so — a sentence silently cut in half is the `silent-truncation` shape. */
  autoCut: boolean;
}

export interface CallCapture {
  /** Open a new window. Throws if one is already open. */
  begin(): void;
  /** Close the open window and encode it. */
  finish(): Promise<CapturedWindow>;
  /** Throw the open window away without encoding (owner cancelled). */
  discard(): void;
  isCapturing(): boolean;
  /** Instantaneous input level, 0..1, for the mic meter. */
  level(): number;
  close(): Promise<void>;
}

export async function openCallCapture(options: {
  maxWindowMs?: number;
  /** Called when the cap cut the window. The caller sends it and tells the owner. */
  onAutoCut?: () => void;
} = {}): Promise<CallCapture> {
  const maxWindowMs = Math.min(options.maxWindowMs || DEFAULT_MAX_WINDOW_MS, DEFAULT_MAX_WINDOW_MS);
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
    throw new Error("This browser cannot open a microphone for a Mirror Call.");
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // echoCancellation ON here, unlike the enrollment capture: the clone's
      // voice is coming out of the same speakers, and its energy landing in
      // the reference set would grow the reference set with the clone's own
      // output. That is a feedback loop with a fidelity meter attached to it.
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch (cause) {
    throw new Error(micPermissionMessage(cause));
  }
  const context = new AudioContext({ latencyHint: "interactive", sampleRate: 48_000 });
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const silent = context.createGain();
  silent.gain.value = 0;

  let chunks: Float32Array[] = [];
  let capturing = false;
  let closed = false;
  let peak = 0;
  let capTimer: ReturnType<typeof setTimeout> | null = null;
  let autoCut = false;

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    let localPeak = 0;
    for (let i = 0; i < input.length; i += 8) {
      const value = Math.abs(input[i]);
      if (value > localPeak) localPeak = value;
    }
    // Decay, so the meter falls back rather than sticking at the loudest
    // moment of the call.
    peak = Math.max(localPeak, peak * 0.86);
    if (capturing) chunks.push(input.slice());
  };
  source.connect(processor);
  processor.connect(silent);
  silent.connect(context.destination);

  function clearCap() {
    if (capTimer !== null) { clearTimeout(capTimer); capTimer = null; }
  }

  async function close() {
    if (closed) return;
    closed = true;
    capturing = false;
    clearCap();
    processor.disconnect();
    source.disconnect();
    silent.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    await context.close();
  }

  return {
    begin() {
      if (closed) throw new Error("The microphone session is closed.");
      if (capturing) throw new Error("A window is already open.");
      chunks = [];
      capturing = true;
      autoCut = false;
      void context.resume();
      capTimer = setTimeout(() => {
        // The cap does not close the window itself — it flags it and tells the
        // caller, who owns the send. A capture that finishes itself behind the
        // UI's back is a turn the UI never knew it sent.
        autoCut = true;
        options.onAutoCut?.();
      }, maxWindowMs);
    },
    async finish() {
      if (!capturing) throw new Error("No window is open.");
      capturing = false;
      clearCap();
      const sourceRate = context.sampleRate;
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const merged = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
      chunks = [];
      // Hard clamp to the cap in SAMPLES, not just by timer: a stalled tab can
      // let the timer fire late, and a 45-second window would be rejected by
      // the server after the owner already spoke it.
      const maxSamples = Math.floor(sourceRate * (maxWindowMs / 1000));
      const bounded = merged.length > maxSamples ? merged.subarray(0, maxSamples) : merged;
      const samples = await resampleForUpload(bounded, sourceRate);
      const durationMs = Math.min(Math.round(samples.length / 24_000 * 1000), maxWindowMs);
      return { blob: encodeWav24kMono(samples, 24_000), durationMs, autoCut };
    },
    discard() {
      capturing = false;
      chunks = [];
      clearCap();
    },
    isCapturing: () => capturing,
    level: () => Math.min(1, peak),
    close,
  };
}
