// Synthetic tone for file decoding/layout only. No speech or likeness evidence.
export function syntheticPcmWav() {
  const sampleRate = 24000, channels = 1, seconds = 13;
  const frames = sampleRate * seconds;
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) {
    wav.writeInt16LE(Math.round(4000 * Math.sin(2 * Math.PI * 440 * frame / sampleRate)), 44 + frame * 2);
  }
  return wav;
}
