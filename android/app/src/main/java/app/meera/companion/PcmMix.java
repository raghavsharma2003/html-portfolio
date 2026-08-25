package app.meera.companion;

/**
 * WS-WATCHPERF part 2 — the mixer, alone, as arithmetic.
 *
 * <p>Pure: no Android, no clock, no state. That is what lets
 * {@code evals/watchaudio/} compile and RUN it, which matters more here than
 * almost anywhere else in this feature — a mixer that clips is a mixer that
 * turns a song into a fuzz the server ASR transcribes as words, and "it looked
 * right in the diff" is not an answer to whether a sum of two int16 streams
 * stays inside int16.
 *
 * <p><b>HIS VOICE ALWAYS WINS.</b> The media term is attenuated by a fixed
 * {@link #DUCK_DB} before it is added, and the sum saturates rather than
 * wrapping. Saturation is not a detail: two's-complement overflow turns a loud
 * moment into a full-scale sign flip, which is the single most speech-like
 * artefact there is and would be handed straight to a VAD.
 */
final class PcmMix {

  /** Media sits this far under the microphone. Voice is the reason the call
   *  exists; the song is context for it. −6 dB is the same number the audio
   *  floor uses for "a second source is present but not in charge", and it is
   *  a constant rather than an adaptive gain on purpose: a mixer that chases
   *  levels is a mixer that ducks HIS voice when the music gets loud. */
  static final double DUCK_DB = -6.0;

  static final double DUCK_GAIN = Math.pow(10.0, DUCK_DB / 20.0); // ≈0.501

  private PcmMix() {}

  /**
   * {@code out = mic + gain * media}, saturating, little-endian PCM16.
   *
   * @param mic the microphone chunk — the reference, never attenuated
   * @param media device audio; may be shorter than the mic chunk (or absent,
   *     i.e. {@code mediaLen == 0}), in which case the remainder is mic alone.
   *     Nothing is invented to fill it: silence is a real answer.
   * @param out may alias neither input; it is the uplink buffer
   * @return bytes written — always {@code micLen}
   */
  static int mix(byte[] mic, int micLen, byte[] media, int mediaLen, double gain, byte[] out) {
    int n = micLen & ~1; // whole samples only
    int m = Math.min(mediaLen & ~1, n);
    for (int i = 0; i < m; i += 2) {
      int a = (short) ((mic[i + 1] << 8) | (mic[i] & 0xFF));
      int b = (short) ((media[i + 1] << 8) | (media[i] & 0xFF));
      int v = a + (int) Math.round(b * gain);
      if (v > 32767) v = 32767;
      else if (v < -32768) v = -32768;
      out[i] = (byte) (v & 0xFF);
      out[i + 1] = (byte) ((v >> 8) & 0xFF);
    }
    if (m < n) System.arraycopy(mic, m, out, m, n - m);
    if (n < micLen) out[n] = mic[n];
    return micLen;
  }

  /** RMS of a PCM16 chunk in int16 units — the same scale
   *  {@link LiveWatchEngine}'s floor arbiter works in. Trace only. */
  static double rms(byte[] b, int len) {
    int n = len / 2;
    if (n <= 0) return 0;
    double acc = 0;
    for (int i = 0; i < n; i++) {
      int v = (short) ((b[i * 2 + 1] << 8) | (b[i * 2] & 0xFF));
      acc += (double) v * v;
    }
    return Math.sqrt(acc / n);
  }
}
