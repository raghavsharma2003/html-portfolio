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
  start(): void;
  stop(): Promise<WavRecording>;
  cancel(): Promise<void>;
}

export async function openPrivateWavCapture(): Promise<PrivateWavCapture> {
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
  const context = new AudioContext({ latencyHint: "interactive", sampleRate: 48_000 });
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const silent = context.createGain();
  silent.gain.value = 0;
  const chunks: Float32Array[] = [];
  let recording = false;
  let closed = false;
  processor.onaudioprocess = (event) => {
    if (recording) chunks.push(event.inputBuffer.getChannelData(0).slice());
  };
  source.connect(processor);
  processor.connect(silent);
  silent.connect(context.destination);

  async function close() {
    if (closed) return;
    closed = true;
    recording = false;
    processor.disconnect();
    source.disconnect();
    silent.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    await context.close();
  }

  return {
    start() {
      if (closed || recording) throw new Error("Microphone session is not ready.");
      chunks.length = 0;
      recording = true;
      void context.resume();
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
      const file = new File([blob], "provider-consent.wav", { type: "audio/wav" });
      return { file, url: URL.createObjectURL(blob), durationMs };
    },
    cancel: close,
  };
}
