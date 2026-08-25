package app.meera.companion;

/**
 * WS-WATCHPERF part 2 — drives the REAL {@link PcmMix} so the mixer's
 * arithmetic is measured rather than reviewed. Compiled only by
 * evals/watchaudio/mix-gate.mjs; never shipped in the APK.
 */
public final class MixProbe {

  static byte[] tone(int samples, double amp, double hz, double rate) {
    byte[] b = new byte[samples * 2];
    for (int i = 0; i < samples; i++) {
      int v = (int) Math.round(amp * 32767 * Math.sin(2 * Math.PI * hz * i / rate));
      v = Math.max(-32768, Math.min(32767, v));
      b[i * 2] = (byte) (v & 0xFF);
      b[i * 2 + 1] = (byte) ((v >> 8) & 0xFF);
    }
    return b;
  }

  static boolean sameBytes(byte[] a, byte[] b, int n) {
    for (int i = 0; i < n; i++) if (a[i] != b[i]) return false;
    return true;
  }

  /** Did any sample wrap sign, i.e. overflow instead of saturating? */
  static boolean wrapped(byte[] mic, byte[] out, int n) {
    for (int i = 0; i + 1 < n; i += 2) {
      int a = (short) ((mic[i + 1] << 8) | (mic[i] & 0xFF));
      int o = (short) ((out[i + 1] << 8) | (out[i] & 0xFF));
      // a loud positive mic sample that came out strongly negative (or the
      // reverse) is the two's-complement sign flip — the most speech-like
      // artefact there is, and the one a VAD would answer
      if (a > 24000 && o < -8000) return true;
      if (a < -24000 && o > 8000) return true;
    }
    return false;
  }

  public static void main(String[] args) {
    final int N = 1600; // 3200 bytes = one 100ms chunk at 16k mono PCM16
    byte[] out = new byte[N * 2];
    StringBuilder sb = new StringBuilder("{");

    sb.append("\"duckDb\":").append(PcmMix.DUCK_DB);
    sb.append(",\"duckGain\":").append(String.format("%.6f", PcmMix.DUCK_GAIN));

    // 1. media absent: the uplink chunk is the microphone, byte for byte
    byte[] mic = tone(N, 0.30, 220, 16000);
    PcmMix.mix(mic, N * 2, new byte[N * 2], 0, PcmMix.DUCK_GAIN, out);
    sb.append(",\"micOnlyIdentical\":").append(sameBytes(mic, out, N * 2));

    // 2. media silent: same answer. Silence is a real answer and nothing is
    //    invented to fill it.
    PcmMix.mix(mic, N * 2, new byte[N * 2], N * 2, PcmMix.DUCK_GAIN, out);
    sb.append(",\"silentMediaIdentical\":").append(sameBytes(mic, out, N * 2));

    // 3. the duck, measured: media alone at full scale should arrive ~6dB down
    byte[] silent = new byte[N * 2];
    byte[] media = tone(N, 0.50, 440, 16000);
    PcmMix.mix(silent, N * 2, media, N * 2, PcmMix.DUCK_GAIN, out);
    double mediaRms = PcmMix.rms(media, N * 2);
    double duckedRms = PcmMix.rms(out, N * 2);
    sb.append(",\"measuredDuckDb\":")
        .append(String.format("%.3f", 20 * Math.log10(duckedRms / mediaRms)));

    // 4. HOW FAR HIS VOICE SITS OVER THE MEDIA TERM, at two media levels.
    //
    //    `typical` is a phone playing a normally-mastered track: about −14
    //    dBFS RMS, which is a 0.28-amplitude sine here. `hot` is full scale —
    //    a stress case louder than anything actually mastered, included
    //    because the answer at the worst case is the one worth knowing.
    //
    //    A conversational voice is 0.30 amplitude (≈ −13.5 dBFS RMS), the
    //    same level the floor arbiter's own thresholds are written around.
    byte[] voice = tone(N, 0.30, 220, 16000);
    byte[] typical = tone(N, 0.28, 440, 16000);
    byte[] loud = tone(N, 1.00, 440, 16000);
    double vr = PcmMix.rms(voice, N * 2);
    sb.append(",\"voiceOverTypicalDb\":")
        .append(
            String.format("%.3f", 20 * Math.log10(vr / (PcmMix.rms(typical, N * 2) * PcmMix.DUCK_GAIN))));
    sb.append(",\"voiceOverHotDb\":")
        .append(
            String.format("%.3f", 20 * Math.log10(vr / (PcmMix.rms(loud, N * 2) * PcmMix.DUCK_GAIN))));

    // 5. saturation, not wraparound, at the worst case both sources can make
    byte[] hotMic = tone(N, 1.00, 220, 16000);
    PcmMix.mix(hotMic, N * 2, loud, N * 2, PcmMix.DUCK_GAIN, out);
    sb.append(",\"wrapped\":").append(wrapped(hotMic, out, N * 2));
    int clipped = 0;
    for (int i = 0; i + 1 < N * 2; i += 2) {
      int v = (short) ((out[i + 1] << 8) | (out[i] & 0xFF));
      if (v == 32767 || v == -32768) clipped++;
    }
    sb.append(",\"clippedSamples\":").append(clipped);

    // 6. a SHORT media chunk (the ring had less than a full 100ms) leaves the
    //    remainder as pure microphone rather than as a hole
    byte[] shortMedia = tone(N / 4, 0.50, 440, 16000);
    PcmMix.mix(mic, N * 2, shortMedia, N / 2, PcmMix.DUCK_GAIN, out);
    boolean tailIsMic = true;
    for (int i = N / 2; i < N * 2; i++) if (out[i] != mic[i]) tailIsMic = false;
    sb.append(",\"shortMediaTailIsMic\":").append(tailIsMic);

    // 7. the mixer NEVER writes to the microphone buffer — the thing every
    //    level, gate and barge-in decision above it reads
    byte[] micCopy = mic.clone();
    PcmMix.mix(mic, N * 2, loud, N * 2, PcmMix.DUCK_GAIN, out);
    sb.append(",\"micUnmodified\":").append(sameBytes(mic, micCopy, N * 2));

    sb.append("}");
    System.out.println(sb);
  }
}
