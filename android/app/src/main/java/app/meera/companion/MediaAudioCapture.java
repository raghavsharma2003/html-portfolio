package app.meera.companion;

import android.annotation.TargetApi;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.projection.MediaProjection;
import android.os.Build;
import android.os.Process;
import android.util.Log;

/**
 * WS-WATCHPERF part 2 — LETTING HER HEAR IT.
 *
 * <p>The owner's report: "I think she can't listen to the screen/phone audio."
 * He was right. The uplink has only ever carried the microphone, so what she
 * "heard" of a reel was whatever survived the speaker→room→mic round trip
 * after the AEC, the noise suppressor and the client's own gate had finished
 * with it — which is to say: enough to fire a VAD, not enough to know what the
 * song was.
 *
 * <p>This is Android's {@code AudioPlaybackCapture} (API 29+), which taps what
 * the device is PLAYING. Three properties of it are load-bearing rather than
 * incidental:
 *
 * <ul>
 *   <li><b>It is scoped to a MediaProjection.</b> The very same projection the
 *       screen share holds — passed in, never created here. It cannot be
 *       started without a live share, it cannot outlive one, and revoking the
 *       share from the system UI kills it in the same instant. There is no
 *       second consent surface to get out of step with the first.</li>
 *   <li><b>Apps opt out and we honour it by construction.</b> Playback carrying
 *       {@code ALLOW_CAPTURE_BY_NONE} is simply not delivered by the platform —
 *       that is the platform's guarantee, not ours. Which is also why
 *       {@link LiveWatchEngine#attrs()} has always set exactly that on HER
 *       AudioTrack ("her voice must never loop back into any playback
 *       capture"): the one feedback path that would matter was closed before
 *       this class existed. {@code excludeUid} below closes it a second time,
 *       for the whole process, because a digital echo loop is not a thing to
 *       be safe from by one flag.</li>
 *   <li><b>Nothing is stored.</b> There is no file, no buffer that outlives the
 *       ring, and no path out of this class except the mixer. The watch-content
 *       contract applies unchanged: what she hears on the stream is like what
 *       she sees on it — present tense only, never a durable fact source. The
 *       consolidation spine's watch negative test already enforces that for the
 *       screen and it enforces it for this by the same construction, because
 *       this produces no turn, no episode and no assertion of its own.</li>
 * </ul>
 *
 * <p>USAGE MATCHING. Only {@code USAGE_MEDIA}, {@code USAGE_GAME} and
 * {@code USAGE_UNKNOWN} are requested — the three the platform allows anyway.
 * Notifications, alarms, ringtones and voice calls are NOT matched: a
 * WhatsApp call ringing through while someone shares their screen is not
 * something to put on a wire, and neither is the notification tone of a
 * message she is not being shown.
 *
 * <p>Threading: one reader thread owns the AudioRecord and writes into a ring;
 * the mic thread of {@link LiveWatchEngine} drains it. The only shared state is
 * the ring and two ints, and every access is synchronized on {@code this} — the
 * ring is 4 chunks deep, so a drain and a fill contend for microseconds.
 */
@TargetApi(29)
final class MediaAudioCapture {
  private static final String TAG = "MeeraMediaAudio";

  /** The uplink rate. Capturing directly at 16k mono lets the platform's own
   *  resampler do the downmix and the rate conversion, which is both cheaper
   *  and better than anything worth hand-rolling here. */
  static final int RATE = 16000;
  /** 100ms at 16k mono PCM16 — the mic chunk size, so a drain is 1:1. */
  static final int CHUNK = 3200;
  /** 400ms of slack. Deeper is worse, not better: stale media audio mixed
   *  under a live voice is an echo of the past, and the ring dropping its
   *  oldest chunk is the correct failure. */
  private static final int RING = 4;

  private final AudioRecord record;
  private volatile boolean running = true;
  private Thread thread;

  private final byte[][] ring = new byte[RING][CHUNK];
  private final int[] len = new int[RING];
  private int head = 0; // oldest unread
  private int count = 0;
  private long dropped = 0;

  private MediaAudioCapture(AudioRecord r) {
    this.record = r;
  }

  /** Returns null on any device or build that cannot do this — the caller
   *  simply carries on with mic-only audio, which is today's behaviour. */
  static MediaAudioCapture start(MediaProjection projection) {
    if (Build.VERSION.SDK_INT < 29 || projection == null) return null;
    try {
      AudioPlaybackCaptureConfiguration cfg =
          new AudioPlaybackCaptureConfiguration.Builder(projection)
              .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
              .addMatchingUsage(AudioAttributes.USAGE_GAME)
              .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
              // BELT AND BRACES on the one loop that would be unrecoverable:
              // her own voice is already ALLOW_CAPTURE_BY_NONE, and this
              // additionally excludes every stream this process plays.
              .excludeUid(Process.myUid())
              .build();
      AudioFormat fmt =
          new AudioFormat.Builder()
              .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
              .setSampleRate(RATE)
              .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
              .build();
      int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
      if (min <= 0) min = CHUNK * 4;
      AudioRecord r =
          new AudioRecord.Builder()
              .setAudioFormat(fmt)
              .setBufferSizeInBytes(Math.max(min, CHUNK * 4))
              .setAudioPlaybackCaptureConfig(cfg)
              .build();
      if (r.getState() != AudioRecord.STATE_INITIALIZED) {
        r.release();
        return null;
      }
      r.startRecording();
      MediaAudioCapture m = new MediaAudioCapture(r);
      Thread t = new Thread(m::loop, "meera-media-audio");
      t.setPriority(Thread.NORM_PRIORITY + 2);
      m.thread = t;
      t.start();
      return m;
    } catch (Exception e) {
      Log.w(TAG, "playback capture unavailable", e);
      return null;
    }
  }

  private void loop() {
    byte[] buf = new byte[CHUNK];
    while (running) {
      int n;
      try {
        n = record.read(buf, 0, buf.length);
      } catch (Exception e) {
        n = -1;
      }
      if (n <= 0) {
        try {
          Thread.sleep(20);
        } catch (InterruptedException ie) {
          return;
        }
        continue;
      }
      synchronized (this) {
        int k = (head + count) % RING;
        System.arraycopy(buf, 0, ring[k], 0, n);
        len[k] = n;
        if (count < RING) count++;
        else {
          head = (head + 1) % RING; // oldest goes; stale media is worse than none
          dropped++;
        }
      }
    }
  }

  /**
   * Drain one chunk of device audio into {@code out}, or return 0 if there is
   * none. Returns the number of BYTES written, never more than {@code max}.
   *
   * <p>Silence is a real answer: nothing playing means nothing to mix, and the
   * caller must not invent any.
   */
  synchronized int take(byte[] out, int max) {
    if (count == 0) return 0;
    int k = head;
    int n = Math.min(len[k], Math.min(max, CHUNK));
    System.arraycopy(ring[k], 0, out, 0, n);
    head = (head + 1) % RING;
    count--;
    return n;
  }

  /** How many chunks the ring has thrown away — a trace field, never a
   *  decision. A rising number means the mixer is draining slower than the
   *  device is playing, which is the one thing that would put her audio a
   *  moment behind the picture. */
  synchronized long droppedChunks() {
    return dropped;
  }

  void stop() {
    running = false;
    Thread t = thread;
    thread = null;
    if (t != null) t.interrupt();
    try {
      record.stop();
    } catch (Exception ignored) {
    }
    try {
      record.release();
    } catch (Exception ignored) {
    }
  }
}
