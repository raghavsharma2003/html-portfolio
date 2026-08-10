package app.meera.companion;

import android.annotation.SuppressLint;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.NoiseSuppressor;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

/**
 * REALTIME watch-together brain: a native Gemini Live session that lives in
 * the capture service process. Where {@link WatchEngine} runs a
 * snapshot -> think -> TTS loop (seconds of latency, half duplex), this
 * streams the mic (16kHz PCM16) and the screen (JPEG frames) up one
 * WebSocket and plays her 24kHz PCM back as it arrives — barge-in is
 * server-side, so she stops mid-word when the user talks over her.
 *
 * Protocol mirrors the verified web client (src/voice/liveCall.ts):
 *   POST {base}/api/live-token -> {token, model}   (single use, 30 min)
 *   wss://…BidiGenerateContentConstrained?access_token=<token>
 *   -> {setup:{…}} … <- {setupComplete}
 *   -> {realtimeInput:{audio|video:{data,mimeType}}}
 *   <- {serverContent:{modelTurn.parts[].inlineData.data | interrupted |
 *       inputTranscription.text | outputTranscription.text | turnComplete}}
 *
 * API level: the whole watch feature is gated to 29+ in WatchPlugin.start();
 * this class needs nothing newer (AudioTrack.Builder 23+, AudioFocusRequest
 * 26+, ALLOW_CAPTURE_BY_NONE 29+), so 29 stays the gate — see supported().
 *
 * Threading contract:
 *   - OkHttp delivers WS callbacks on its own reader thread: JSON parsing
 *     happens there, PCM goes into a queue for the playback thread, and
 *     every Callbacks invocation is marshalled to the main looper.
 *   - the mic pump owns AudioRecord and never touches AudioTrack;
 *   - the playback thread owns the AudioTrack writes. Barge-in (pause+flush)
 *     is the one cross-thread AudioTrack touch, and it is generation-guarded
 *     so a write racing the flush cannot resurrect stale audio.
 */
@SuppressLint("NewApi")
class LiveWatchEngine {
  private static final String TAG = "MeeraLiveWatch";
  private static final String WS_BASE =
      "wss://generativelanguage.googleapis.com/ws/"
          + "google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";
  // only used if /api/live-token ever answers without a model field
  private static final String DEFAULT_MODEL = "models/gemini-2.5-flash-native-audio-latest";

  private static final int IN_RATE = 16000; // uplink mic PCM16 mono
  private static final int OUT_RATE = 24000; // downlink her voice PCM16 mono
  private static final int MIC_CHUNK = 3200; // 100ms @ 16k mono 16-bit
  private static final int MAX_RECONNECTS = 3; // then fall back to the cascade
  private static final int MAX_ROTATES = 6; // goAway storms must not spin
  private static final long DRAIN_GRACE_MS = 1500; // hold focus between quick turns
  // REALTIME means a backed-up uplink must DROP, not buffer — but VIDEO and
  // AUDIO share okhttp's ONE queueSize counter, so every threshold below is
  // stated in "seconds of mic audio": a 3200-byte 100ms chunk becomes ~4267
  // base64 chars + ~60 bytes of JSON ≈ 4.3KB per 100ms ≈ 43KB/s.
  //
  // 40_000 / 43_000 ≈ 0.93s of mic audio already waiting. Being over it for
  // an INSTANT is not a stall, though: one ~50KB frame exceeds this cap all
  // by itself, and on any link that can carry the call it drains in
  // 100-300ms — a delay the receiver absorbs, where a dropped chunk is a
  // hole in what she hears. So SPEECH is shed only after the counter has sat
  // above the cap CONTINUOUSLY for STALL_MS (a dead socket, not a busy one),
  // which only a genuine stall can do.
  private static final long MAX_QUEUE_AUDIO = 40_000L;
  // Not a quality knob — a last-resort backstop. Speech is shed ONLY when the
  // queue has sat above the cap this long with no drainage at all, i.e. the
  // socket is effectively dead. At 43KB/s, 6s over a 40KB cap means a quarter
  // megabyte of speech queued that would otherwise be delivered as a wall of
  // stale audio long after the moment passed.
  private static final long STALL_MS = 6_000L;
  // Silence is not speech: a gated chunk carries no words, only VAD
  // continuity, so it sheds at the first real backlog. 8_000 / 43_000 ≈
  // 185ms of audio backlog (~2 mic chunks). ~60-70% of a call is gated, so
  // this alone recovers most of the uplink before a syllable is at risk.
  private static final long SILENCE_CAP = 8_000L;
  // ...but silence is never shed to NOTHING. The server ends their turn by
  // HEARING the pause: if a congested link suppressed every gated chunk the
  // stream would go dark the instant they stop talking, the VAD clock would
  // stop advancing and she would listen forever without answering. So the
  // pause right after words is untouchable, and past it at least one chunk
  // in SILENCE_KEEP always goes. (7 chunks = 700ms > the 300ms the server
  // needs to call the turn over.)
  private static final int SILENCE_ENDPOINT_CHUNKS = 7;
  private static final int SILENCE_KEEP = 3;
  /** Pathological encode (~90KB of JPEG): ~2.8s of uplink in one message. */
  private static final int FRAME_MAX_B64 = 120_000;
  /** A frame may only enter a socket that has drained to ~185ms of audio
   *  backlog. Deliberately well BELOW MAX_QUEUE_AUDIO (40_000): video must
   *  give way long before her hearing is ever at risk. */
  private static final long FRAME_GATE = 8_000L;
  // Congestion read from the queue's TROUGHS — the SAME numbers as the web
  // client (src/voice/liveCall.ts CONGEST_*). The counter's average is
  // mostly our own frame sawtooth and says nothing about the link; its
  // MINIMUM over the last 8 mic ticks is what the socket drains back down to
  // between frames. > 6_000 (≈140ms of audio) at the emptiest moment means
  // the link never fully caught up; > 20_000 (≈465ms) means it is badly
  // behind. Hysteresis down at 3_000 (≈70ms) / 12_000 (≈280ms).
  private static final long CONGEST_UP_1 = 6_000L;
  private static final long CONGEST_UP_2 = 20_000L;
  private static final long CONGEST_DOWN_1 = 3_000L;
  private static final long CONGEST_DOWN_2 = 12_000L;
  private static final int TROUGH_RING = 8; // 8 mic chunks = 800ms of history
  // ── THE FLOOR MODEL — the same one as src/voice/liveCall.ts, in Int16
  // units (full scale 32768), so the two lanes can be argued about together.
  //
  // A 100ms chunk is far too coarse to express "550ms of speech" as anything
  // better than "either 500 or 600ms", so every chunk is sub-framed into 5
  // blocks of 320 samples (20ms) and every duration below counts in those.
  private static final int SUBS = 5;
  private static final int SUB_MS = 20;
  private static final int FLOOR_WIN_SUBS = 150; // 3.0s of ambience
  private static final double FLOOR_PCT = 0.10; // 10th percentile, not the MIN
  private static final double FLOOR_MIN = 50; // −56 dBFS
  // was 1300 (−28 dBFS). The floor clamp and the threshold clamp CROSSED:
  // above floor 273 the threshold froze at 820, and above floor 820 the
  // threshold sat BELOW ambience — at the old ceiling of 1300 it was
  // 20·log10(820/1300) = −4.0 dB UNDER the noise floor, so in a loud room the
  // gate could never close, the whole room was transmitted as speech, and the
  // digital silence that ends a turn was never sent. Both halves of "she
  // stops for the TV" and "she waits for the room to go quiet", from one
  // arithmetic error. 3900 ≈ −18.5 dBFS is a genuinely loud café.
  private static final double FLOOR_MAX = 3900;
  private static final double LISTEN_MIN = 330; // −40 dBFS, unchanged
  private static final double LISTEN_MAX = 820; // −32 dBFS, unchanged
  private static final double LISTEN_MULT = 3;
  private static final double LISTEN_RATIO_MIN = 1.8; // +5.1 dB — it can always close
  // While she is audible the cost function inverts: a false open costs her
  // being killed mid-word by a television. +16 dB over ambience is the
  // near-field argument — inverse square from a mouth at 0.2m against a TV at
  // 3m is 23.5 dB, hands-free at 0.5m against 3m is 15.6 dB; +16 dB is inside
  // what a real talker always has and outside the 0-6 dB a same-room
  // interferer can muster.
  private static final double BARGE_MULT = 6.3; // +16.0 dB over ambience
  private static final double BARGE_OVER_LISTEN = 2.5; // +8.0 dB over the listen bar
  private static final double BARGE_MAX = 11469; // −9 dBFS: nothing is unbargeable
  private static final double SOFT_MULT = 4.0; // +12.0 dB — the quiet-talker valve
  private static final double SOFT_OVER_LISTEN = 1.6;
  // 550ms of speech inside 850ms (28 of 43 sub-frames, so ~300ms of plosive
  // gaps cost nothing) is above every backchannel in this language — "haan",
  // "hmm", "achha" are 300-500ms and mean KEEP GOING — and below any real
  // sentence. The soft valve is a longer run at a lower bar, for a quiet
  // talker in a loud room: being uninterruptible is worse than being
  // over-interruptible.
  private static final int CLAIM_SUBS = 28; // 550ms
  private static final int CLAIM_WIN_SUBS = 43; // within 850ms
  private static final int SOFT_CLAIM_SUBS = 55; // 1100ms
  private static final int SOFT_CLAIM_WIN_SUBS = 100; // within 2000ms
  private static final int DUCK_SUBS = 8; // 160ms — she notices, she does not stop
  private static final double STEADY_DB = 2.0; // speech runs 5-9 dB; a fan runs 1-2
  private static final double STEADY_OVERRIDE_MULT = 16.0; // +24 dB skips the check
  /** Held audio: must span the whole soft window plus pre-roll, or the burst
   *  back-fills a truncated sentence. ceil(2000/100) + 2 = 22 chunks = 70KB. */
  private static final int HOLD_RING = 22;
  // Her own voice is a first-class interrupter on THIS lane above all others:
  // AOSP only requires an echo canceller on a VOICE_COMMUNICATION capture
  // path, this engine records with VOICE_RECOGNITION, and the comment at the
  // AEC attach point already concedes most devices ignore it there. We do not
  // have to guess at the coupling — we know exactly what we are playing. κ is
  // seeded PESSIMISTICALLY and learns downward: under-protection is a
  // self-sustaining loop (she interrupts herself, the new turn leaks too),
  // over-protection costs one late barge-in.
  private static final double ECHO_KAPPA_SEED = 0.12; // ≈18 dB echo return loss
  private static final double ECHO_KAPPA_MIN = 0.02;
  private static final double ECHO_KAPPA_MAX = 0.6;
  private static final double ECHO_ATTACK = 0.35;
  private static final double ECHO_RELEASE = 0.002;
  /** −4.2 dB: "haan bolo" — she softens and keeps talking. Ported from the
   *  cascade lane's duckSpeech(), which has production miles on it. */
  private static final float DUCK_SOFT = 0.62f;
  private static final float DUCK_CLAIM = 0.30f; // −10.5 dB: she is on her way out
  // Humans do not gate off mid-syllable when talked over, they trail off. The
  // track keeps playing while the volume walks down, so what the room hears is
  // a voice fading out of an overlap instead of a switch being thrown.
  private static final int YIELD_STEPS = 6;
  private static final int YIELD_STEP_MS = 42; // ~250ms total
  private static final int YIELD_HARD_STEPS = 3;
  private static final int YIELD_HARD_STEP_MS = 40; // ~120ms — they plainly have the floor
  private static final long YIELD_HARD_AFTER_MS = 700;
  /** The server owes us an `interrupted` once we release a real floor claim.
   *  On the pinned model there is an acknowledged case where it never sends
   *  one, and that single message is otherwise the ONLY thing here that can
   *  stop her. The client made the decision, so the client enforces it. */
  private static final long RELEASE_WATCHDOG_MS = 1500;
  // Wake-up pacing. These exist to protect the socket and the API, never to
  // ration what she says: a floor between wake-ups and a ceiling per minute.
  // Whether she actually speaks on any of them is entirely her call.
  private static final long FRAME_FRESH_MS = 3_000; // no picture this new = no nudge
  private static final long WAKE_FLOOR_MS = 2_000; // between "new thing" wake-ups
  private static final long ALONG_WAKE_MS = 12_000; // while they work on one screen
  private static final long IDLE_WAKE_MS = 45_000; // frozen screen: rare and optional
  private static final long ACTIVE_WINDOW_MS = 3_000; // "still doing something" memory
  private static final long NEW_QUIET_MS = 3_000; // don't cut across them talking
  private static final long IDLE_QUIET_MS = 6_000;
  private static final int WAKE_CEILING = 12; // per WAKE_WINDOW_MS, hard
  private static final long WAKE_WINDOW_MS = 60_000;

  /** Live mode replaces the per-frame NO_COMMENT gate — she decides herself. */
  private static final String LIVE_NOTE =
      "\n\nREALTIME CO-WATCHING: you can see their screen as live video and hear them"
          + " continuously. It can be ANYTHING they do on a phone or a laptop — scrolling,"
          + " shopping, reading, coding, texting someone, ordering food, picking photos,"
          + " gaming, homework. You're the friend sitting next to them while they do it:"
          + " watching, reacting, involved. You have opinions about what they're doing and"
          + " you give them, you tease, you ask, you get curious, and when you happen to"
          + " notice something useful you just say it like a friend would, never like a"
          + " helper announcing help. When you speak it's short (under 10 words), present"
          + " tense, about what is in front of you this second. When nothing actually"
          + " strikes you, saying nothing is a normal, comfortable choice. You are seeing"
          + " every single thing here for the FIRST time: you do not recognise it, you"
          + " never say you've seen it before, you never call anything famous or trending,"
          + " and you never compare it to something you supposedly saw earlier —"
          + " pretending otherwise is the one thing that would wreck this. Much of the"
          + " audio you hear may be the SCREEN's own sound (dialogue, music, a video), not"
          + " them talking to you — tell the difference by content; react to it like"
          + " someone watching along, never answer it as if they asked you. When THEY"
          + " talk, respond normally. NEVER narrate or read the screen back to them, never"
          + " announce that you can see it, never ask what app they're using — react to"
          + " what's happening like a person.";

  /** Something new is on screen and a frame of it has actually reached her. */
  private static final String NEW_NUDGE =
      "<context: what's on their screen just changed — new thing in front of you, you're"
          + " looking at it now. If it makes you want to say something, say it: quick,"
          + " short, present tense, your normal voice. If it doesn't, stay completely"
          + " silent; that's a normal thing to do. You're seeing this for the first time"
          + " and you don't recognise it. Never reference this note>";

  /** They are working away on one screen — slow, real, ongoing activity. */
  private static final String ALONG_NUDGE =
      "<context: they're in the middle of doing something on their screen — it keeps"
          + " changing a little as they go — and you've been watching for a bit. Say"
          + " something if you actually have something: a reaction, an opinion about what"
          + " they're doing, a tease, something you noticed, a question. Otherwise stay"
          + " quiet and keep watching. Never reference this note>";

  /** Nothing has moved for a long while — speaking is genuinely optional. */
  private static final String IDLE_NUDGE =
      "<context: the screen hasn't moved at all in a while. Speak only if something on it"
          + " genuinely pulls a word out of you, or you actually want to ask them about"
          + " it. Otherwise stay completely silent — that's the expected answer here."
          + " Never reference this note>";

  interface Callbacks {
    /** setupComplete arrived: the live session is carrying the watch. */
    void onReady();

    /** A finished turn — who is "me" or "her", matching WatchEngine.emitTurn. */
    void onTurn(String who, String text);

    /** True while her audio is queued/playing (bubble state SPEAKING). */
    void onSpeaking(boolean speaking);

    /**
     * Live watch cannot continue — tear this engine down and fall back to the
     * cascade WatchEngine. fatal=true means the microphone itself is
     * unavailable (no RECORD_AUDIO grant / stolen device); fatal=false means
     * the session/network gave up after {@link #MAX_RECONNECTS} retries.
     */
    void onDown(boolean fatal);
  }

  private final Context ctx;
  private final Callbacks cb;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final ExecutorService net = Executors.newSingleThreadExecutor();
  private final LinkedBlockingQueue<byte[]> playQueue = new LinkedBlockingQueue<>();
  private final AtomicInteger wsGen = new AtomicInteger(); // stale-callback guard
  private final AtomicInteger flushGen = new AtomicInteger(); // barge-in guard
  private final AtomicInteger yieldGen = new AtomicInteger(); // one dissolve at a time
  private final AtomicInteger attempts = new AtomicInteger();
  private final Object stateLock = new Object();
  private final Object bufLock = new Object();
  private final StringBuilder myBuf = new StringBuilder();
  private final StringBuilder herBuf = new StringBuilder();

  private volatile String base = "https://meera-silk.vercel.app";
  private volatile String system = "";
  private volatile String model = DEFAULT_MODEL;

  private volatile boolean running = false;
  private volatile boolean ready = false;
  private volatile boolean muted = false;
  private volatile boolean speaking = false;
  /** RMS (Int16 units) of the audio the play thread is writing RIGHT NOW,
   *  with the wall clock it was written at. Ground truth for the echo term:
   *  taking a MAX over a short lag window means we never have to measure the
   *  device's acoustic round trip. */
  private volatile double herRms = 0;
  private volatile long herRmsAt = 0;
  private volatile float trackVol = 1f; // what fraction is reaching the speaker
  /** Non-zero while a dissolve owns the volume — a duck must never fight it. */
  private volatile int fadeActive = 0;
  /** The floor is genuinely theirs for the rest of her turn: stop holding. */
  private volatile boolean floorLost = false;
  /** When the current candidate first looked like a voice — decides whether
   *  the eventual yield is a trail-off or a clean break. */
  private volatile long floorClaimSince = 0;
  private boolean torn = false; // guarded by this — stop() is one-way

  private volatile OkHttpClient client;
  private volatile WebSocket ws;

  private volatile AudioRecord record;
  private volatile Thread micPump;
  // built on the WS thread (startMic), released on whichever thread stops us
  private volatile AcousticEchoCanceler aec;
  private volatile NoiseSuppressor ns;

  private volatile AudioTrack track;
  private volatile Thread playThread;
  private final AtomicInteger rotates = new AtomicInteger();
  private volatile long lastVoiceAt = 0; // last input-transcription activity
  private volatile long lastNudgeAt = 0; // last "look at the screen" wake-up
  private volatile long lastFrameAt = 0; // last frame that actually entered the socket
  private volatile long lastActivityAt = 0; // last frame where the screen did anything
  private final long[] wakes = new long[WAKE_CEILING]; // frame-thread confined
  private int wakeIdx = 0;
  private volatile int congestion = 0; // 0 clear / 1 moderate / 2 heavy uplink
  // ── mic-thread confined, every one of them: the mic pump is the only
  // thread that samples the socket queue, so none of this needs a lock. The
  // sole cross-thread hop is the volatile `congestion` int it publishes.
  private final long[] troughRing = new long[TROUGH_RING];
  private int troughIdx = 0;
  private long overSince = 0; // elapsedRealtime the queue first went over the cap
  private int troughGen = -1; // wsGen this ring belongs to (see resetIfNewSocket)
  // lazily built from whichever thread speaks first; volatile so the abandon
  // path (any thread, no lock) never sees a half-published request
  private volatile AudioAttributes attrs;
  private volatile AudioFocusRequest focus;

  LiveWatchEngine(Context ctx, Callbacks cb) {
    this.ctx = ctx;
    this.cb = cb;
  }

  /** Same floor as WatchPlugin.start(): AudioFocusRequest + capture policy. */
  static boolean supported() {
    return Build.VERSION.SDK_INT >= 29;
  }

  /** Reuses the watch config JSON ({base, system, systemTail, directive}). */
  void configure(String json) {
    try {
      JSONObject cfg = new JSONObject(json);
      base = cfg.optString("base", base);
      // systemLive: persona + live speech style (no tone markers / TTS
      // machinery — those made the speech-native model stilted and quiet).
      // "system" (the cascade prompt) is only the fallback if absent.
      String core = cfg.optString("systemLive", cfg.optString("system", ""));
      String tail = cfg.optString("systemTail", "");
      // "directive" is the cascade's per-frame NO_COMMENT gate — feeding it
      // to a live model would make her SAY "NO_COMMENT" out loud. Dropped.
      StringBuilder sb = new StringBuilder(core);
      if (!tail.isEmpty()) sb.append("\n").append(tail);
      sb.append(LIVE_NOTE);
      system = sb.toString();
    } catch (Exception e) {
      Log.w(TAG, "bad config", e);
    }
  }

  /* ── lifecycle ─────────────────────────────────────────────────────── */

  void start() {
    synchronized (this) {
      if (running || torn) return;
      running = true;
    }
    attempts.set(0);
    client =
        new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS) // a live socket is idle by design
            .writeTimeout(20, TimeUnit.SECONDS)
            .pingInterval(20, TimeUnit.SECONDS) // keeps NAT/proxy paths open
            .build();
    if (!startPlayback()) {
      // no output device = no point in a voice session
      down(false);
      return;
    }
    safeExecute(this::connect);
  }

  /** Idempotent, thread-safe: a crash here would kill the whole FGS. */
  synchronized void stop() {
    if (torn) return;
    torn = true;
    running = false;
    ready = false;
    lastFrameAt = 0; // no session, no picture — nothing may nudge off this one
    lastActivityAt = 0;
    wsGen.incrementAndGet(); // every in-flight WS callback is now stale
    congestion = 0; // nothing may read this session's backlog after teardown
    // a turn cut off mid-stream must still reach the chat log — emit
    // synchronously; the queued main posts are about to be removed
    final String meLeft;
    final String herLeft;
    synchronized (bufLock) {
      meLeft = myBuf.toString().trim();
      herLeft = herBuf.toString().trim();
      myBuf.setLength(0);
      herBuf.setLength(0);
    }
    try {
      if (!meLeft.isEmpty()) cb.onTurn("me", meLeft);
      if (!herLeft.isEmpty()) cb.onTurn("her", herLeft);
    } catch (Exception ignored) {
    }
    main.removeCallbacksAndMessages(null); // only our own posts

    WebSocket s = ws;
    ws = null;
    if (s != null) {
      try {
        s.close(1000, "bye");
      } catch (Exception ignored) {
      }
    }

    // mic: stop first (unblocks read), let the pump exit, then release —
    // releasing under an in-flight read() is a native-side race, and the
    // cascade fallback cannot open the mic until this one is fully gone
    Thread mp = micPump;
    micPump = null;
    AudioRecord r = record;
    record = null;
    if (r != null) {
      try {
        r.stop();
      } catch (Exception ignored) {
      }
    }
    if (mp != null && mp != Thread.currentThread()) {
      try {
        mp.join(250);
      } catch (InterruptedException ignored) {
        Thread.currentThread().interrupt();
      }
    }
    releaseEffects();
    if (r != null) {
      try {
        r.release();
      } catch (Exception ignored) {
      }
    }

    // playback
    Thread pt = playThread;
    playThread = null;
    playQueue.clear();
    if (pt != null && pt != Thread.currentThread()) {
      pt.interrupt();
      try {
        pt.join(250);
      } catch (InterruptedException ignored) {
        Thread.currentThread().interrupt();
      }
    }
    AudioTrack t = track;
    track = null;
    if (t != null) {
      try {
        t.pause();
        t.flush();
        t.stop();
        t.release();
      } catch (Exception ignored) {
      }
    }
    setSpeaking(false);
    abandonFocus(); // belt and braces: never leave YouTube ducked

    try {
      net.shutdownNow();
    } catch (Exception ignored) {
    }
    OkHttpClient c = client;
    if (c != null) {
      try {
        // graceful: already-queued work (our close frame) still runs
        c.dispatcher().executorService().shutdown();
        c.connectionPool().evictAll();
      } catch (Exception ignored) {
      }
    }
  }

  boolean isReady() {
    return running && ready;
  }

  /**
   * Uplink pressure from the socket queue's TROUGHS: 0 clear, 1 moderate,
   * 2 heavy. The capture service sheds frame RATE and JPEG quality against
   * this — never audio.
   */
  int getCongestion() {
    return congestion;
  }

  /** Half-duplex gate for callers: capture never stops, we send silence. */
  void setMuted(boolean m) {
    muted = m;
  }

  /** execute() after shutdownNow() throws — a stop() race must not crash. */
  private void safeExecute(Runnable r) {
    try {
      net.execute(r);
    } catch (Exception ignored) {
    }
  }

  /** Full teardown FIRST (frees the mic), then tell the service to fall back. */
  private void down(boolean fatal) {
    if (!running && torn) return;
    stop();
    main.post(() -> cb.onDown(fatal));
  }

  /* ── screen frames: straight through, the service sets the rate ────── */

  /** motion: 0 nothing moved · 1 they're doing something · 2 a new thing. */
  void onFrame(String b64Jpeg, int motion) {
    if (!running || !ready || b64Jpeg == null || b64Jpeg.isEmpty()) return;
    WebSocket s = ws;
    if (s == null) return;
    boolean sent = false;
    try {
      // VIDEO YIELDS TO HER EARS. This is priority, not degradation: frames
      // are never shrunk, slowed or cheapened — they simply do not enter a
      // socket that still owes her the words being spoken into it. Removing
      // this gate entirely inverted the whole point: video and audio share
      // ONE queue, a single frame (33-53KB base64) is larger than the entire
      // audio cap (40_000 ≈ 0.9s of speech), so on any uplink under ~1Mbit
      // the queue never drained, and the only thing that shed was her
      // HEARING. Going momentarily blind is recoverable — the next tick
      // retries 600ms later and an unsent frame can never wake her. Going
      // deaf makes her answer the wrong question, which is unrecoverable.
      if (s.queueSize() > FRAME_GATE) return;
      if (b64Jpeg.length() > FRAME_MAX_B64) return; // pathological encode
      // base64 (NO_WRAP) and the fixed mime are JSON-safe by construction —
      // hand-rolled so a ~60KB frame isn't copied through JSONObject twice
      sent =
          s.send(
              "{\"realtimeInput\":{\"video\":{\"data\":\""
                  + b64Jpeg
                  + "\",\"mimeType\":\"image/jpeg\"}}}");
    } catch (Exception ignored) {
    }
    // nothing reached her eyes: she is never told to look at a screen she
    // hasn't been shown — that is the instruction that makes her invent
    if (!sent) return;
    long now = System.currentTimeMillis();
    lastFrameAt = now;
    if (motion > 0) lastActivityAt = now;
    maybeNudge(s, motion);
  }

  /** The Live API only generates on audio activity — video frames alone never
   *  trigger a turn, so without this she watches a whole session mute. What
   *  wakes her is what the screen is DOING, with the frame already delivered,
   *  so there is always something true in front of her: a new thing to look
   *  at, or steady activity while they work through one screen. The old
   *  fire-on-a-clock beat survives only for a screen that has genuinely
   *  stopped. No note ever says what to think — silence answers all of them,
   *  and her own judgement picks. */
  private void maybeNudge(WebSocket s, int motion) {
    long now = System.currentTimeMillis();
    if (speaking) return;
    if (lastFrameAt == 0 || now - lastFrameAt > FRAME_FRESH_MS) return; // no current picture
    boolean busy = now - lastActivityAt <= ACTIVE_WINDOW_MS;
    // a new thing to look at gets the short floor; steady work on one screen
    // gets a slower beat; a screen that has genuinely stopped gets the rare
    // one. None of them says what to think — silence answers all three.
    long gap = motion >= 2 ? WAKE_FLOOR_MS : busy ? ALONG_WAKE_MS : IDLE_WAKE_MS;
    String note = motion >= 2 ? NEW_NUDGE : busy ? ALONG_NUDGE : IDLE_NUDGE;
    if (now - lastVoiceAt < (motion >= 2 ? NEW_QUIET_MS : IDLE_QUIET_MS)) return;
    if (now - lastNudgeAt < gap) return;
    if (now - wakes[wakeIdx] < WAKE_WINDOW_MS) return; // hard rate ceiling
    lastNudgeAt = now;
    wakes[wakeIdx] = now;
    wakeIdx = (wakeIdx + 1) % WAKE_CEILING;
    try {
      JSONObject part = new JSONObject().put("text", note);
      JSONObject turn = new JSONObject().put("role", "user").put("parts", new JSONArray().put(part));
      s.send(
          new JSONObject()
              .put(
                  "clientContent",
                  new JSONObject().put("turns", new JSONArray().put(turn)).put("turnComplete", true))
              .toString());
    } catch (Exception ignored) {
    }
  }

  /* ── connection ────────────────────────────────────────────────────── */

  /** Runs on the net executor. Each attempt mints a FRESH single-use token. */
  private void connect() {
    if (!running) return;
    String token = null;
    String mdl = null;
    try {
      String resp = post(base + "/api/live-token", "{}");
      if (resp != null) {
        JSONObject r = new JSONObject(resp);
        token = r.optString("token", null);
        mdl = r.optString("model", null);
      }
    } catch (Exception e) {
      Log.w(TAG, "live token failed", e);
    }
    if (!running) return;
    if (token == null || token.isEmpty()) {
      retryOrDie();
      return;
    }
    model = (mdl == null || mdl.isEmpty()) ? DEFAULT_MODEL : mdl;
    OkHttpClient c = client;
    if (c == null) return;
    ready = false;
    int gen = wsGen.incrementAndGet();
    try {
      Request req = new Request.Builder().url(WS_BASE + "?access_token=" + token).build();
      WebSocket s = c.newWebSocket(req, new Sock(gen));
      if (gen != wsGen.get()) {
        // a failure elsewhere invalidated this attempt while the token POST
        // was in flight — cancel instead of orphaning a live server session
        try {
          s.cancel();
        } catch (Exception ignored) {
        }
        return;
      }
      ws = s;
    } catch (Exception e) {
      Log.w(TAG, "ws open failed", e);
      retryOrDie();
    }
  }

  /** 1s / 2s / 4s, then hand the session back to the cascade engine. */
  private void retryOrDie() {
    if (!running) return;
    // OkHttp can report a dying socket twice (onClosing/onClosed then
    // onFailure) — invalidating the generation here makes the second report
    // stale, so we never schedule two reconnects and end up with two sockets
    wsGen.incrementAndGet();
    ready = false;
    lastFrameAt = 0; // frames delivered to the dead socket are not hers to react to
    // the dead socket's backlog says nothing about the next one's link — the
    // mic thread clears its ring off the same wsGen bump (resetIfNewSocket)
    congestion = 0;
    flushPlayback();
    WebSocket s = ws;
    ws = null;
    if (s != null) {
      try {
        s.cancel();
      } catch (Exception ignored) {
      }
    }
    int n = attempts.incrementAndGet();
    if (n > MAX_RECONNECTS) {
      Log.w(TAG, "live watch unavailable after " + MAX_RECONNECTS + " retries");
      down(false);
      return;
    }
    long delay = 1000L << (n - 1);
    main.postDelayed(() -> safeExecute(this::connect), delay);
  }

  /** goAway: the server is about to hang up — get ahead of it. Budgeted and
   *  paced: an unthrottled goAway storm would burn the token endpoint's
   *  rate limit in seconds. */
  private void rotate() {
    if (!running) return;
    if (rotates.incrementAndGet() > MAX_ROTATES) {
      retryOrDie(); // too many rotations this session — treat as a failure
      return;
    }
    WebSocket old = ws;
    ws = null;
    ready = false;
    lastFrameAt = 0; // the new session has been shown nothing yet
    wsGen.incrementAndGet();
    congestion = 0; // fresh socket, fresh reading (ring clears on the mic thread)
    // the old session's audio is still draining the AudioTrack — without
    // this the new session starts talking over the tail of the old one
    flushPlayback();
    if (old != null) {
      try {
        old.close(1000, "rotate");
      } catch (Exception ignored) {
      }
    }
    main.postDelayed(() -> safeExecute(this::connect), 500);
  }

  private final class Sock extends WebSocketListener {
    private final int gen;

    Sock(int gen) {
      this.gen = gen;
    }

    private boolean stale() {
      return !running || gen != wsGen.get();
    }

    @Override
    public void onOpen(WebSocket s, Response r) {
      if (stale()) {
        try {
          s.close(1000, "stale");
        } catch (Exception ignored) {
        }
        return;
      }
      try {
        s.send(setupMessage());
      } catch (Exception e) {
        Log.w(TAG, "setup send failed", e);
      }
    }

    @Override
    public void onMessage(WebSocket s, String text) {
      if (!stale()) handle(text);
    }

    @Override
    public void onMessage(WebSocket s, ByteString bytes) {
      // the service sends text frames, but the web client sees Blobs too
      if (!stale()) handle(bytes.utf8());
    }

    @Override
    public void onClosing(WebSocket s, int code, String reason) {
      try {
        s.close(1000, null); // complete the handshake so onClosed fires
      } catch (Exception ignored) {
      }
    }

    @Override
    public void onClosed(WebSocket s, int code, String reason) {
      if (stale()) return;
      Log.w(TAG, "ws closed " + code + " " + reason);
      retryOrDie();
    }

    @Override
    public void onFailure(WebSocket s, Throwable t, Response r) {
      if (stale()) return;
      Log.w(TAG, "ws failure", t);
      retryOrDie();
    }
  }

  private String setupMessage() throws Exception {
    JSONObject gen = new JSONObject();
    gen.put("responseModalities", new JSONArray().put("AUDIO"));
    // thinking before speaking = seconds of dead air (measured 3-5.5s vs
    // ~0.9s without) — a co-watcher reacts, she doesn't deliberate
    gen.put("thinkingConfig", new JSONObject().put("thinkingBudget", 0));
    JSONObject speech = new JSONObject();
    speech.put(
        "voiceConfig",
        new JSONObject().put("prebuiltVoiceConfig", new JSONObject().put("voiceName", "Aoede")));
    speech.put("languageCode", "hi-IN");
    gen.put("speechConfig", speech);

    JSONObject vad = new JSONObject();
    // default start sensitivity: HIGH made every reel sound and breath cut
    // her off mid-word. Sustained real speech still takes the floor; the
    // 450ms tail keeps turn commits fast. End HIGH: commit the turn from the
    // speech completing, not from the room going quiet — reel audio in the
    // background must never make her hold a reply forever.
    vad.put("endOfSpeechSensitivity", "END_SENSITIVITY_HIGH");
    // the client gate spends ~300ms of hangover after words stop — the
    // server silence budget comes down to keep total commit ~600ms
    vad.put("silenceDurationMs", 300);
    vad.put("prefixPaddingMs", 60);

    JSONObject setup = new JSONObject();
    setup.put("model", model);
    setup.put("generationConfig", gen);
    setup.put(
        "systemInstruction",
        new JSONObject().put("parts", new JSONArray().put(new JSONObject().put("text", system))));
    setup.put("inputAudioTranscription", new JSONObject());
    setup.put("outputAudioTranscription", new JSONObject());
    setup.put("realtimeInputConfig", new JSONObject().put("automaticActivityDetection", vad));
    // a watch session runs for tens of minutes of continuous video — without
    // compression the context window ends the session mid-reel
    setup.put("contextWindowCompression", new JSONObject().put("slidingWindow", new JSONObject()));
    return new JSONObject().put("setup", setup).toString();
  }

  /** Parses one server message. Runs on the OkHttp reader thread. */
  private void handle(String text) {
    if (text == null || text.isEmpty()) return;
    JSONObject msg;
    try {
      msg = new JSONObject(text);
    } catch (Exception e) {
      return; // not JSON — nothing we can act on
    }
    try {
      if (msg.has("setupComplete")) {
        ready = true;
        attempts.set(0);
        if (!startMic()) {
          down(true); // no mic grant: the cascade can still watch and comment
          return;
        }
        main.post(cb::onReady);
        return;
      }
      if (msg.has("goAway")) {
        rotate();
        return;
      }
      JSONObject sc = msg.optJSONObject("serverContent");
      if (sc == null) return;
      if (sc.optBoolean("interrupted", false)) {
        // The server has already stopped generating and everything it will
        // ever send for this turn is in our buffer. Whether that ends as a
        // trail-off or a clean break depends on how long the overlap has been
        // running: a hesitation gets the longer dissolve, someone who has
        // plainly been talking for most of a second gets out of the way.
        long overlap = floorClaimSince == 0 ? 0 : System.currentTimeMillis() - floorClaimSince;
        yieldFloor(overlap > YIELD_HARD_AFTER_MS);
      }
      JSONObject turn = sc.optJSONObject("modelTurn");
      if (turn != null) {
        JSONArray parts = turn.optJSONArray("parts");
        if (parts != null) {
          for (int i = 0; i < parts.length(); i++) {
            JSONObject p = parts.optJSONObject(i);
            if (p == null) continue;
            JSONObject inline = p.optJSONObject("inlineData");
            if (inline == null) continue;
            String data = inline.optString("data", "");
            if (data.isEmpty()) continue;
            try {
              enqueueAudio(Base64.decode(data, Base64.DEFAULT));
            } catch (Exception ignored) {
            }
          }
        }
      }
      JSONObject in = sc.optJSONObject("inputTranscription");
      if (in != null) {
        String t = in.optString("text", "");
        if (!t.isEmpty()) {
          lastVoiceAt = System.currentTimeMillis(); // audible activity — no nudge needed
          synchronized (bufLock) {
            myBuf.append(t);
          }
        }
      }
      JSONObject out = sc.optJSONObject("outputTranscription");
      if (out != null) {
        String t = out.optString("text", "");
        if (!t.isEmpty()) {
          synchronized (bufLock) {
            herBuf.append(t);
          }
        }
      }
      if (sc.optBoolean("turnComplete", false)) flushTexts();
    } catch (Exception e) {
      Log.w(TAG, "message handling failed", e);
    }
  }

  private void flushTexts() {
    final String me;
    final String her;
    synchronized (bufLock) {
      me = myBuf.toString().trim();
      her = herBuf.toString().trim();
      myBuf.setLength(0);
      herBuf.setLength(0);
    }
    if (!me.isEmpty()) main.post(() -> cb.onTurn("me", me));
    if (!her.isEmpty()) main.post(() -> cb.onTurn("her", her));
  }

  /* ── uplink: AudioRecord -> base64 PCM16 frames ────────────────────── */

  @SuppressLint("MissingPermission")
  private boolean startMic() {
    if (record != null) return true; // survived a reconnect — keep capturing
    int minBuf =
        AudioRecord.getMinBufferSize(
            IN_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
    if (minBuf <= 0) minBuf = 4096;
    AudioRecord r;
    try {
      r =
          new AudioRecord(
              MediaRecorder.AudioSource.VOICE_RECOGNITION,
              IN_RATE,
              AudioFormat.CHANNEL_IN_MONO,
              AudioFormat.ENCODING_PCM_16BIT,
              Math.max(minBuf * 2, 8192));
      if (r.getState() != AudioRecord.STATE_INITIALIZED) {
        try {
          r.release();
        } catch (Exception ignored) {
        }
        throw new IllegalStateException("AudioRecord uninitialized");
      }
      r.startRecording();
    } catch (SecurityException se) {
      Log.w(TAG, "no RECORD_AUDIO grant", se); // fatal for the live path
      return false;
    } catch (Exception e) {
      Log.w(TAG, "AudioRecord failed", e);
      return false;
    }
    record = r;
    attachEffects(r);
    Thread t = new Thread(this::micLoop, "meera-live-mic");
    t.setPriority(Thread.MAX_PRIORITY);
    micPump = t;
    t.start();
    return true;
  }

  /** Best effort only: most devices ignore AEC on a VOICE_RECOGNITION path,
   *  and Gemini's own VAD is what actually saves us from the speaker leak. */
  private void attachEffects(AudioRecord r) {
    try {
      int session = r.getAudioSessionId();
      if (AcousticEchoCanceler.isAvailable()) {
        aec = AcousticEchoCanceler.create(session);
        if (aec != null) aec.setEnabled(true);
      }
      if (NoiseSuppressor.isAvailable()) {
        ns = NoiseSuppressor.create(session);
        if (ns != null) ns.setEnabled(true);
      }
    } catch (Exception ignored) {
    }
  }

  private void releaseEffects() {
    try {
      if (aec != null) aec.release();
    } catch (Exception ignored) {
    }
    try {
      if (ns != null) ns.release();
    } catch (Exception ignored) {
    }
    aec = null;
    ns = null;
  }

  private void micLoop() {
    byte[] buf = new byte[MIC_CHUNK];
    int errs = 0;
    // ── adaptive noise gate + floor arbiter ──
    // Two questions with opposite cost functions used to share one threshold.
    // "Is anyone talking?" (she is silent) wants to be sensitive — a false
    // open costs nothing, a false close clips a first syllable. "Is this a
    // PERSON taking the floor from her?" (she is talking) wants to be strict,
    // because a false open costs her being killed mid-word by a television.
    //
    // And the second question used not to be asked at all on this lane: while
    // she spoke the uplink was BLANKET-MUTED, which made her completely deaf
    // for the whole of every turn. That is safe against her own speaker leak
    // and hopeless for a conversation. Now the audio is HELD instead — kept in
    // a ring, with digital silence on the wire — and released in one burst the
    // moment something clears a real bar, so nothing the person said is lost
    // and nothing that isn't a person is ever heard.
    //
    // Ambience is the 10th PERCENTILE of sub-frame RMS over 3s, not the
    // minimum of 25 chunk RMS values. A minimum is a 1-in-25 order statistic —
    // noisy, biased low, and one freak-quiet chunk pins it for 2.5s — and,
    // worse, it tracks the DIPS of the interferer rather than its level, so it
    // converges correctly on a fan (no dips) and falls straight through a
    // television (inter-syllable dips, just like a person).
    final double[] floorRing = new double[FLOOR_WIN_SUBS];
    java.util.Arrays.fill(floorRing, 0);
    final double[] floorSort = new double[FLOOR_WIN_SUBS];
    int floorIdx = 0;
    int floorFill = 0;
    double floor = 200;
    int tickNo = 0;
    int gateLeft = 0;
    byte[] prevChunk = null;
    int prevLen = 0;
    boolean wasOpen = false;
    int gatedRun = 0; // consecutive wordless chunks
    // ── floor-arbitration state, mic-thread confined ──
    long subIdx = 0; // monotonic sub-frame counter — the claim windows' clock
    final long[] hardHits = new long[CLAIM_WIN_SUBS + 8];
    final double[] hardDb = new double[CLAIM_WIN_SUBS + 8];
    int hardHead = 0;
    int hardCount = 0;
    final long[] softHits = new long[SOFT_CLAIM_WIN_SUBS + 8];
    int softHead = 0;
    int softCount = 0;
    double claimPeak = 0;
    double kappa = ECHO_KAPPA_SEED;
    final byte[][] hold = new byte[HOLD_RING][];
    final int[] holdLen = new int[HOLD_RING];
    int holdHead = 0;
    int holdCount = 0;
    long releasedAt = 0;
    int ducked = 0; // 0 full volume · 1 soft duck · 2 yielding
    final double[] sub = new double[SUBS];
    while (running) {
      AudioRecord r = record; // stop() nulls the field from another thread
      if (r == null) break;
      int n;
      try {
        n = r.read(buf, 0, buf.length);
      } catch (Exception e) {
        n = -1;
      }
      if (n <= 0) {
        // dead object / stolen mic: back off, then give up loudly instead of
        // spinning a MAX_PRIORITY thread forever
        if (++errs > 150) { // ~3s of persistent failure
          down(true);
          return;
        }
        try {
          Thread.sleep(20);
        } catch (InterruptedException ie) {
          return;
        }
        continue;
      }
      errs = 0;
      boolean gated = true;
      boolean opened = false;
      boolean claim = false;
      // The service mutes this engine for exactly as long as she is audible,
      // so `muted` IS "she has the floor" on this lane.
      final boolean herAudible = muted;
      if (!herAudible && (floorLost || hardCount > 0 || softCount > 0 || holdCount > 0)) {
        floorLost = false;
        floorClaimSince = 0;
        releasedAt = 0;
        hardCount = 0;
        hardHead = 0;
        softCount = 0;
        softHead = 0;
        holdHead = 0;
        holdCount = 0;
        claimPeak = 0;
        if (ducked != 0 && fadeActive == 0) setVol(1f);
        ducked = 0;
      }
      final boolean holding = herAudible && !floorLost;
      // Sub-frame RMS: 5 blocks of 320 samples = 20ms each. 100ms granularity
      // cannot express any of the durations this decision is made of.
      double sum = 0;
      final int samples = Math.max(1, n / 2);
      for (int s = 0; s < SUBS; s++) {
        final int a = (s * samples) / SUBS;
        final int b = ((s + 1) * samples) / SUBS;
        double acc = 0;
        for (int i = a; i < b; i++) {
          int v = (buf[i * 2 + 1] << 8) | (buf[i * 2] & 0xFF);
          acc += (double) v * v;
        }
        sum += acc;
        sub[s] = Math.sqrt(acc / Math.max(1, b - a));
      }
      final double rms = Math.sqrt(sum / samples);
      // do NOT learn the floor while she is audible: her own leak would
      // ratchet the ambience estimate up on audio that is not the room
      if (!herAudible) {
        for (int s = 0; s < SUBS; s++) {
          floorRing[floorIdx] = sub[s];
          floorIdx = (floorIdx + 1) % FLOOR_WIN_SUBS;
          if (floorFill < FLOOR_WIN_SUBS) floorFill++;
        }
      }
      // the percentile is a sort of 150 doubles; once every 4 chunks (400ms)
      // is plenty for a statistic with a 3s window
      if ((tickNo++ & 3) == 0 && floorFill > 8) {
        System.arraycopy(floorRing, 0, floorSort, 0, floorFill);
        java.util.Arrays.sort(floorSort, 0, floorFill);
        floor = Math.min(FLOOR_MAX, Math.max(FLOOR_MIN, floorSort[(int) (floorFill * FLOOR_PCT)]));
      }
      // ── the two bars ──
      final double herNow =
          (SystemClock.elapsedRealtime() - herRmsAt < 300) ? herRms * trackVol : 0;
      final double echoTerm = kappa * herNow;
      final double thrL =
          Math.max(floor * LISTEN_RATIO_MIN, Math.min(Math.max(floor * LISTEN_MULT, LISTEN_MIN), LISTEN_MAX));
      final double thrB =
          Math.min(BARGE_MAX, Math.max(Math.max(thrL * BARGE_OVER_LISTEN, floor * BARGE_MULT), echoTerm));
      final double thrS =
          Math.min(thrB, Math.max(Math.max(thrL * SOFT_OVER_LISTEN, floor * SOFT_MULT), echoTerm));
      if (rms > thrL) gateLeft = 3; // ~300ms hangover
      else if (gateLeft > 0) gateLeft--;
      gated = gateLeft <= 0;
      opened = !gated && !wasOpen;
      wasOpen = !gated;
      // Learn the coupling from ground truth rather than trusting an AEC that
      // this capture path may not even have: while she is audible and nothing
      // is claiming the floor, whatever the mic hears IS her leakage.
      if (herAudible && herNow > 600 && hardCount == 0) {
        double r = rms / herNow;
        kappa += (r > kappa ? ECHO_ATTACK : ECHO_RELEASE) * (r - kappa);
        kappa = Math.min(ECHO_KAPPA_MAX, Math.max(ECHO_KAPPA_MIN, kappa));
      }
      if (holding) {
        for (int s = 0; s < SUBS; s++) {
          subIdx++;
          if (sub[s] > thrB) {
            int w = (hardHead + hardCount) % hardHits.length;
            hardHits[w] = subIdx;
            hardDb[w] = 20 * Math.log10(Math.max(sub[s], 1));
            if (hardCount < hardHits.length) hardCount++;
            else hardHead = (hardHead + 1) % hardHits.length;
            if (sub[s] > claimPeak) claimPeak = sub[s];
          }
          if (sub[s] > thrS) {
            int w = (softHead + softCount) % softHits.length;
            softHits[w] = subIdx;
            if (softCount < softHits.length) softCount++;
            else softHead = (softHead + 1) % softHits.length;
          }
          while (hardCount > 0 && subIdx - hardHits[hardHead] > CLAIM_WIN_SUBS) {
            hardHead = (hardHead + 1) % hardHits.length;
            hardCount--;
          }
          while (softCount > 0 && subIdx - softHits[softHead] > SOFT_CLAIM_WIN_SUBS) {
            softHead = (softHead + 1) % softHits.length;
            softCount--;
          }
        }
        if (hardCount == 0) claimPeak = 0;
        if (hardCount > 0 && floorClaimSince == 0) floorClaimSince = System.currentTimeMillis();
        // THE DUCK. She softens the moment something is plainly a voice, long
        // before it has earned anything — the hitch a person produces on
        // contact, and fully reversible.
        if (ducked == 0 && hardCount >= DUCK_SUBS) {
          setVol(DUCK_SOFT);
          ducked = 1;
        } else if (ducked == 1 && hardCount < DUCK_SUBS / 2 && fadeActive == 0) {
          setVol(1f); // it was nothing — bring her back up NOW
          ducked = 0;
          floorClaimSince = 0;
        }
        // THE CLAIM. Long enough to be a sentence and not a continuer, loud
        // enough to be in this room and not on a screen across it, and varied
        // enough to be a mouth and not a motor: between a fan switching on and
        // the 3s the floor needs to learn it, a machine can clear the level
        // bar, but speech runs 5-9 dB of log-RMS deviation and a motor runs 1-2.
        if (hardCount >= CLAIM_SUBS || softCount >= SOFT_CLAIM_SUBS) {
          boolean varied = true;
          if (hardCount >= 6 && claimPeak < floor * STEADY_OVERRIDE_MULT) {
            double m = 0;
            for (int i = 0; i < hardCount; i++) m += hardDb[(hardHead + i) % hardDb.length];
            m /= hardCount;
            double v2 = 0;
            for (int i = 0; i < hardCount; i++) {
              double d = hardDb[(hardHead + i) % hardDb.length] - m;
              v2 += d * d;
            }
            varied = Math.sqrt(v2 / hardCount) >= STEADY_DB;
          }
          claim = varied;
        }
      }
      if (gated) gatedRun++;
      else gatedRun = 0;
      // ── the ONE queue sample of this mic tick ──
      // Congestion, the over-cap stopwatch and the drop decision all read
      // this single value, so the signal is evenly spaced on the mic clock
      // and a tick that sends twice (the gate-open pre-roll below) cannot
      // double-weight it.
      WebSocket s = ws;
      boolean canSend = ready && s != null;
      long queued = 0;
      if (canSend) {
        try {
          queued = s.queueSize();
        } catch (Exception e) {
          canSend = false;
        }
      }
      resetIfNewSocket();
      boolean drop = true;
      if (canSend) {
        sampleCongestion(queued);
        long nowMs = SystemClock.elapsedRealtime();
        if (queued > MAX_QUEUE_AUDIO) {
          if (overSince == 0) overSince = nowMs;
        } else {
          overSince = 0; // drained back under the cap — the stall clock restarts
        }
        // HER HEARING EVERY WORD IS THE PRODUCT. A chunk carrying speech is
        // never dropped to protect a link: words she never receives are words
        // she answers by guessing. Only wordless chunks shed, and even those
        // keep the turn-ending pause and a heartbeat so the server's VAD can
        // still hear them stop talking. The one exception is a catastrophic
        // stall (STALL_MS with no drainage at all), where the queue is dead
        // and everything in it would arrive as tens of seconds of stale
        // speech — there, dropping is the kinder failure.
        drop =
            (holding || gated)
                ? (queued > SILENCE_CAP
                    && gatedRun > SILENCE_ENDPOINT_CHUNKS // turn-ending pause always goes
                    && gatedRun % SILENCE_KEEP != 0) // and the stream never goes dark
                : (overSince != 0 && nowMs - overSince >= STALL_MS);
      }
      if (claim && canSend) {
        // RELEASE. The whole ring goes out in one burst, oldest first, ahead
        // of the mic clock, so the server hears the sentence from its first
        // syllable and not from the moment we made up our mind. The queue is
        // checked ONCE before the loop: a partial burst would splice the
        // middle out of the person's word and scramble the turn's transcript,
        // which is worse than not releasing at all.
        // If the socket is already a second behind, skip the prefix rather
        // than pile another two seconds on top — but release ANYWAY, because
        // losing the first words is recoverable and losing the whole barge-in
        // is not.
        if (queued <= MAX_QUEUE_AUDIO * 2) {
          for (int i = 0; i < holdCount; i++) {
            int k = (holdHead + i) % HOLD_RING;
            if (hold[k] == null) continue;
            try {
              s.send(
                  "{\"realtimeInput\":{\"audio\":{\"data\":\""
                      + Base64.encodeToString(hold[k], 0, holdLen[k], Base64.NO_WRAP)
                      + "\",\"mimeType\":\"audio/pcm;rate=16000\"}}}");
            } catch (Exception ignored) {
            }
          }
        }
        holdHead = 0;
        holdCount = 0;
        floorLost = true;
        releasedAt = SystemClock.elapsedRealtime();
        setVol(DUCK_CLAIM);
        ducked = 2;
      } else if (holding) {
        // HOLD. Real audio into the ring, digital silence onto the wire —
        // which is what the server already receives for most of every call, so
        // its VAD state and its silence clock see nothing unusual. If the
        // sound dies out before it earns anything (a "haan", a door, a car
        // going past), the ring is dropped and she never knows it happened.
        if (!gated) {
          int k = (holdHead + holdCount) % HOLD_RING;
          if (hold[k] == null || hold[k].length < n) hold[k] = new byte[buf.length];
          System.arraycopy(buf, 0, hold[k], 0, n);
          holdLen[k] = n;
          if (holdCount < HOLD_RING) holdCount++;
          else holdHead = (holdHead + 1) % HOLD_RING;
        } else if (gatedRun > 3 && holdCount > 0) {
          holdHead = 0;
          holdCount = 0;
          floorClaimSince = 0;
        }
        prevChunk = null;
        Arrays.fill(buf, 0, n, (byte) 0);
        if (canSend && !drop) {
          try {
            s.send(
                "{\"realtimeInput\":{\"audio\":{\"data\":\""
                    + Base64.encodeToString(buf, 0, n, Base64.NO_WRAP)
                    + "\",\"mimeType\":\"audio/pcm;rate=16000\"}}}");
          } catch (Exception ignored) {
          }
        }
        continue;
      }
      if (!gated && opened && prevChunk != null && canSend && !drop) {
        // closed->open: replay the previous chunk so the syllable that
        // OPENED the gate arrives whole (server prefixPadding can't help —
        // it pads from received audio, which pre-gate was our silence)
        try {
          s.send(
              "{\"realtimeInput\":{\"audio\":{\"data\":\""
                  + Base64.encodeToString(prevChunk, 0, prevLen, Base64.NO_WRAP)
                  + "\",\"mimeType\":\"audio/pcm;rate=16000\"}}}");
        } catch (Exception ignored) {
        }
      }
      if (gated) {
        // stash real audio as the next pre-roll BEFORE zeroing
        if (prevChunk == null || prevChunk.length < n) prevChunk = new byte[buf.length];
        System.arraycopy(buf, 0, prevChunk, 0, n);
        prevLen = n;
      } else {
        prevChunk = null;
      }
      // gated writes silence rather than stopping capture: the stream stays
      // continuous (server VAD hates gaps) and reopening costs nothing
      if (gated) Arrays.fill(buf, 0, n, (byte) 0);
      if (canSend && !drop) {
        try {
          s.send(
              "{\"realtimeInput\":{\"audio\":{\"data\":\""
                  + Base64.encodeToString(buf, 0, n, Base64.NO_WRAP)
                  + "\",\"mimeType\":\"audio/pcm;rate=16000\"}}}");
        } catch (Exception ignored) {
        }
      }
      // The server owes us an `interrupted` once a real claim is released. On
      // this model there is an acknowledged case where it never sends one, and
      // that single message is otherwise the only thing here that can stop
      // her. The client made the floor decision, so the client enforces it.
      if (releasedAt != 0
          && SystemClock.elapsedRealtime() - releasedAt > RELEASE_WATCHDOG_MS
          && speaking) {
        releasedAt = 0;
        yieldFloor(true);
      }
    }
  }

  /** What fraction of her voice is reaching the speaker. One writer, so a duck
   *  and a dissolve can never fight over the same AudioTrack. */
  private void setVol(float v) {
    trackVol = v;
    AudioTrack t = track;
    if (t != null) {
      try {
        t.setVolume(v);
      } catch (Exception ignored) {
      }
    }
  }

  /**
   * Give up the floor — the human way, not the switch way. A person who is
   * talked over finishes the word they are on and fades; they do not gate off
   * mid-syllable. The track keeps playing what is already in it while the
   * volume walks down, and only then is the queue dropped.
   */
  private void yieldFloor(boolean hard) {
    final int gen = yieldGen.incrementAndGet();
    fadeActive = gen;
    fadeStep(gen, 1, hard ? YIELD_HARD_STEPS : YIELD_STEPS,
        hard ? YIELD_HARD_STEP_MS : YIELD_STEP_MS, trackVol);
  }

  private void fadeStep(int gen, int i, int steps, int stepMs, float from) {
    if (!running || gen != yieldGen.get()) return;
    if (i > steps) {
      flushPlayback();
      fadeActive = 0;
      setVol(1f);
      return;
    }
    setVol(Math.max(0.02f, from * (1f - (float) i / steps)));
    main.postDelayed(() -> fadeStep(gen, i + 1, steps, stepMs, from), stepMs);
  }

  /**
   * okhttp's queueSize is the bytes we handed the socket that have not
   * reached the network — but VIDEO shares that counter, so its average is
   * mostly our own frame sawtooth (a ~50KB frame every tier period), which
   * reads "congested" on a link that is carrying the call perfectly well and
   * then oscillates the capture tier for the rest of the session. The TROUGH
   * cannot lie that way: the MINIMUM across the last TROUGH_RING mic ticks
   * (~800ms) is what the socket drains back down to BETWEEN frames. It sits
   * near zero whenever the link can still swallow a frame inside a frame
   * period; it only climbs when the link genuinely cannot drain one before
   * the next arrives — which is the definition of congestion.
   *
   * Mic-thread confined (one 100ms chunk per call), so the ring needs no
   * lock; only {@link #congestion} crosses threads, and it is volatile.
   */
  private void sampleCongestion(long queued) {
    troughRing[troughIdx] = queued;
    troughIdx = (troughIdx + 1) % troughRing.length;
    long trough = Long.MAX_VALUE;
    for (long v : troughRing) trough = Math.min(trough, v);
    int c = congestion;
    if (c < 2 && trough > CONGEST_UP_2) c = 2;
    else if (c < 1 && trough > CONGEST_UP_1) c = 1;
    else if (c == 2 && trough < CONGEST_DOWN_2) c = 1;
    else if (c == 1 && trough < CONGEST_DOWN_1) c = 0;
    congestion = c;
  }

  /**
   * A REPLACED socket must not inherit the old one's backlog reading: the
   * reconnect, rotate() and stop() paths all bump wsGen, and each of them
   * also zeroes the volatile level directly. This clears the mic-thread-
   * confined half (ring + stall clock) from the mic thread itself, on the
   * first tick after the swap, so that state stays confined to one thread.
   */
  private void resetIfNewSocket() {
    int gen = wsGen.get();
    if (gen == troughGen) return;
    troughGen = gen;
    Arrays.fill(troughRing, 0L);
    troughIdx = 0;
    overSince = 0;
    congestion = 0;
  }

  /* ── downlink: queued 24k PCM -> streaming AudioTrack ──────────────── */

  private AudioAttributes attrs() {
    AudioAttributes a = attrs;
    if (a == null) {
      AudioAttributes.Builder ab =
          new AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_ASSISTANT)
              .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH);
      if (Build.VERSION.SDK_INT >= 29) {
        // her voice must never loop back into any playback capture
        ab.setAllowedCapturePolicy(AudioAttributes.ALLOW_CAPTURE_BY_NONE);
      }
      a = ab.build();
      attrs = a;
    }
    return a;
  }

  private boolean startPlayback() {
    try {
      int minBuf =
          AudioTrack.getMinBufferSize(
              OUT_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
      if (minBuf <= 0) minBuf = 4096;
      // ~400ms of slack: enough to ride out jitter, short enough that a
      // barge-in flush drops almost nothing already committed to hardware
      int bufBytes = Math.max(minBuf * 2, OUT_RATE * 2 * 400 / 1000);
      AudioTrack t =
          new AudioTrack.Builder()
              .setAudioAttributes(attrs())
              .setAudioFormat(
                  new AudioFormat.Builder()
                      .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                      .setSampleRate(OUT_RATE)
                      .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                      .build())
              .setBufferSizeInBytes(bufBytes)
              .setTransferMode(AudioTrack.MODE_STREAM)
              .build();
      if (t.getState() != AudioTrack.STATE_INITIALIZED) {
        t.release();
        return false;
      }
      t.play(); // an empty stream track just underruns silently until she talks
      track = t;
    } catch (Exception e) {
      Log.w(TAG, "AudioTrack failed", e);
      return false;
    }
    Thread p = new Thread(this::playLoop, "meera-live-play");
    p.setPriority(Thread.MAX_PRIORITY);
    playThread = p;
    p.start();
    return true;
  }

  private void enqueueAudio(byte[] pcm) {
    if (!running || pcm == null || pcm.length == 0) return;
    setSpeaking(true);
    playQueue.offer(pcm);
  }

  private void playLoop() {
    long quietSince = 0;
    // thread-confined frame counter: flushPlayback() only bumps flushGen —
    // this loop zeroes its own counter when it OBSERVES the generation
    // change. A shared counter had a lost-update race (reset from the WS
    // reader thread vs += here) that latched speaking=true forever and left
    // the user's video permanently ducked.
    long queued = 0;
    int lastGen = flushGen.get();
    while (running) {
      byte[] chunk;
      try {
        chunk = playQueue.poll(120, TimeUnit.MILLISECONDS);
      } catch (InterruptedException ie) {
        return; // stop() interrupted us
      }
      AudioTrack t = track;
      if (t == null) return;
      int g = flushGen.get();
      if (g != lastGen) {
        lastGen = g;
        queued = 0; // the track was flushed (head reset) — resync
        quietSince = 0;
      }
      if (chunk != null && chunk.length > 0) {
        quietSince = 0;
        // Publish how loud she is AS IT IS WRITTEN — the closest point to what
        // the speaker is about to emit, and the only honest reference the
        // mic thread has for telling her own leak apart from a person.
        double acc = 0;
        int frames = chunk.length / 2;
        for (int i = 0; i + 1 < chunk.length; i += 2) {
          int v = (chunk[i + 1] << 8) | (chunk[i] & 0xFF);
          acc += (double) v * v;
        }
        herRms = Math.sqrt(acc / Math.max(1, frames));
        herRmsAt = SystemClock.elapsedRealtime();
        int off = 0;
        // NON_BLOCKING so a barge-in never has to wait for a full buffer
        while (off < chunk.length && running && g == flushGen.get()) {
          int n;
          try {
            n = t.write(chunk, off, chunk.length - off, AudioTrack.WRITE_NON_BLOCKING);
          } catch (Exception e) {
            n = -1;
          }
          if (n < 0) break; // dead/invalid track
          if (n == 0) {
            try {
              Thread.sleep(8); // hardware buffer full — let it drain
            } catch (InterruptedException ie) {
              return;
            }
            continue;
          }
          off += n;
        }
        if (g == flushGen.get()) {
          queued += off / 2; // 16-bit mono: 2 bytes per frame
        } else {
          lastGen = flushGen.get();
          queued = 0; // flushed mid-write; the buffer is empty again
        }
        continue;
      }
      // nothing queued: has everything we wrote actually been heard?
      if (speaking && queued > 0) {
        long head;
        try {
          head = t.getPlaybackHeadPosition() & 0xFFFFFFFFL;
        } catch (Exception e) {
          head = 0;
        }
        if (head >= queued) {
          long now = System.currentTimeMillis();
          if (quietSince == 0) {
            quietSince = now;
          } else if (now - quietSince >= DRAIN_GRACE_MS) {
            quietSince = 0;
            // pause+flush+play resets the head counter, so the counters stay
            // small and comparable all session
            try {
              t.pause();
              t.flush();
              t.play();
            } catch (Exception ignored) {
            }
            queued = 0;
            lastGen = flushGen.get();
            setSpeaking(false);
          }
        } else {
          quietSince = 0;
        }
      } else if (speaking && queued == 0) {
        // enqueueAudio set speaking but nothing ever reached the track (dead
        // track / write errors) — a wall-clock watchdog instead of a latch
        long now = System.currentTimeMillis();
        if (quietSince == 0) {
          quietSince = now;
        } else if (now - quietSince >= 1500) {
          quietSince = 0;
          setSpeaking(false);
        }
      }
    }
  }

  /** Barge-in / disconnect: silence her NOW. Safe from any thread. */
  private void flushPlayback() {
    flushGen.incrementAndGet(); // playLoop observes this and resyncs itself
    playQueue.clear();
    AudioTrack t = track;
    if (t != null) {
      try {
        t.pause();
        t.flush();
        t.play(); // re-arm immediately for the next turn
      } catch (Exception ignored) {
      }
    }
    setSpeaking(false);
  }

  private void setSpeaking(boolean s) {
    synchronized (stateLock) {
      if (speaking == s) return;
      speaking = s;
      if (s) {
        requestFocus();
      } else {
        abandonFocus();
      }
      main.post(() -> cb.onSpeaking(s));
    }
  }

  private void requestFocus() {
    try {
      AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
      if (am == null) return;
      AudioFocusRequest f = focus;
      if (f == null) {
        f =
            new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(attrs())
                .build();
        focus = f;
      }
      am.requestAudioFocus(f); // whatever they're watching ducks under her
    } catch (Exception e) {
      Log.w(TAG, "focus request failed", e);
    }
  }

  private void abandonFocus() {
    try {
      AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
      AudioFocusRequest f = focus;
      if (am != null && f != null) am.abandonAudioFocusRequest(f);
    } catch (Exception ignored) {
    }
  }

  /* ── tiny HTTP helper (token mint only; the FGS process is never frozen) ── */

  private static String post(String url, String body) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
    c.setRequestMethod("POST");
    c.setConnectTimeout(10_000);
    c.setReadTimeout(15_000);
    c.setDoOutput(true);
    c.setRequestProperty("Content-Type", "application/json");
    try (OutputStream os = c.getOutputStream()) {
      os.write(body.getBytes(StandardCharsets.UTF_8));
    }
    if (c.getResponseCode() != 200) return null;
    try (InputStream is = c.getInputStream()) {
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] buf = new byte[4096];
      int n;
      while ((n = is.read(buf)) > 0) out.write(buf, 0, n);
      return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }
  }
}
