type WavRecording = { file: File; url: string; durationMs: number };

function permissionMessage(cause: unknown) {
  const name = cause instanceof DOMException ? cause.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Microphone access was blocked. Allow it in this site's browser permissions, then try again.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "A working microphone was not found.";
  if (name === "NotReadableError" || name === "TrackStartError")
    return "The microphone is busy in another app. Close it there and try again.";
  return "The browser could not open a private microphone session.";
}

// Exported for `callCapture.ts` (WS-Y, Mirror Call), which needs the same 24
// kHz mono WAV bytes but emits MANY windows from ONE open microphone session
// instead of one recording per session. Re-implementing these two there would
// be two encoders that can drift, and a resampler that drifts produces audio
// the fidelity meter scores lower for reasons nobody can find.
export { encodeWav as encodeWav24kMono, resample as resampleForUpload, permissionMessage as micPermissionMessage };

function encodeWav(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function resample(samples: Float32Array, sourceRate: number, targetRate = 24_000) {
  if (sourceRate === targetRate) return samples;
  const frames = Math.max(1, Math.round(samples.length * targetRate / sourceRate));
  const context = new OfflineAudioContext(1, frames, targetRate);
  const buffer = context.createBuffer(1, samples.length, sourceRate);
  const copied = new Float32Array(samples.length);
  copied.set(samples);
  buffer.copyToChannel(copied, 0);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  return (await context.startRendering()).getChannelData(0).slice();
}

export interface PrivateWavCapture {
  start(): Promise<void>;
  stop(): Promise<WavRecording>;
  cancel(): Promise<void>;
}

interface PrivateWavCaptureOptions {
  onLevel?: (level: number, samplePeak: number) => void;
}

// Loopback-only browser-fixture seam. Keeping this graph beside the real
// capture graph preserves the sound layer's single AudioContext ownership
// rule; the production Studio never calls it.
export function installLoopbackMockMicrophone() {
  const context = new AudioContext({ sampleRate: 48_000 });
  const destination = context.createMediaStreamDestination();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 180;
  gain.gain.value = 0.08;
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start();
  // WS-R157. A `new AudioContext()` created here, at module load, starts
  // SUSPENDED under Chromium's autoplay policy — no user gesture has
  // happened yet — and nothing was resuming it, so the oscillator was
  // connected and "started" but silent: the mock stream carried zero
  // energy the whole time. That went unnoticed because nothing had ever
  // driven this seam end to end before (`?mockMic=1` was wired in
  // `layoutFixture.tsx` but no suite called it — see
  // `context/rejected.md#ws-r157-loopback-mock-microphone-context-never-resumed`).
  // Resuming HERE, inside the overridden `getUserMedia` itself, times the
  // resume to whenever a caller actually asks for the stream — in the real
  // recorder that call sits inside a click handler's own async chain
  // (`ResonanceRecorder.start`), the same gesture a REAL `getUserMedia`
  // prompt would itself have needed.
  navigator.mediaDevices.getUserMedia = async () => {
    void context.resume();
    return destination.stream.clone();
  };
}

export async function openPrivateWavCapture(options: PrivateWavCaptureOptions = {}): Promise<PrivateWavCapture> {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined")
    throw new Error("Private WAV recording is not supported in this browser.");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
  } catch (cause) {
    throw new Error(permissionMessage(cause));
  }
  let ownedContext: AudioContext | undefined;
  const nodes: AudioNode[] = [];
  let detachListener: (() => void) | undefined;
  let recording = false;
  let starting = false;
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    recording = false;
    detachListener?.();
    let failure: unknown;
    // Release the device even if disconnecting a partially built graph fails.
    for (const track of stream.getTracks()) {
      try { track.stop(); } catch (cause) { failure ??= cause; }
    }
    for (const node of nodes) {
      try { node.disconnect(); } catch (cause) { failure ??= cause; }
    }
    try { await ownedContext?.close(); } catch (cause) { failure ??= cause; }
    if (failure) throw failure;
  }
  try {
  const context = new AudioContext({ latencyHint: "interactive", sampleRate: 48_000 });
  ownedContext = context;
  const source = context.createMediaStreamSource(stream);
  nodes.push(source);
  const processor = context.createScriptProcessor(4096, 1, 1);
  nodes.push(processor);
  detachListener = () => { processor.onaudioprocess = null; };
  const silent = context.createGain();
  nodes.push(silent);
  silent.gain.value = 0;
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (event) => {
    if (!recording) return;
    const samples = event.inputBuffer.getChannelData(0);
    chunks.push(samples.slice());
    if (options.onLevel) {
      let energy = 0;
      let samplePeak = 0;
      for (const sample of samples) {
        energy += sample * sample;
        samplePeak = Math.max(samplePeak, Math.abs(sample));
      }
      options.onLevel(
        Math.min(1, Math.sqrt(energy / Math.max(1, samples.length)) * 4),
        samplePeak,
      );
    }
  };
  source.connect(processor);
  processor.connect(silent);
  silent.connect(context.destination);

  return {
    async start() {
      if (closed || recording || starting) throw new Error("Microphone session is not ready.");
      starting = true;
      chunks.length = 0;
      try {
        await context.resume();
        if (closed) throw new Error("Microphone session was closed before recording started.");
        recording = true;
      } catch (cause) {
        await close().catch(() => {});
        throw cause;
      } finally { starting = false; }
    },
    async stop() {
      if (!recording) throw new Error("No consent recording is active.");
      recording = false;
      const sourceRate = context.sampleRate;
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const merged = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
      await close();
      const samples = await resample(merged, sourceRate);
      const durationMs = Math.round(samples.length / 24_000 * 1000);
      const blob = encodeWav(samples, 24_000);
      const file = new File([blob], "private-voice-recording.wav", { type: "audio/wav" });
      return { file, url: URL.createObjectURL(blob), durationMs };
    },
    cancel: close,
  };
  } catch (cause) {
    // A setup exception owns the reported error; cleanup still releases all
    // acquired tracks/nodes and attempts to close the context.
    await close().catch(() => {});
    throw cause;
  }
}
