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
        // they talked over her — the server already stopped generating, kill
        // what is still in our buffer or she talks over herself
        flushPlayback();
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
    // adaptive noise gate: ambience (fan, reel bleed, traffic) must never
    // read as "still talking". The floor is the sliding-window MINIMUM of
    // chunk RMS (speech always has inter-syllable dips inside a 2.5s
    // window) so it converges on any room in ~2.5s both directions; the
    // decision threshold is clamped to soft-speech level so it can never
    // gate the talker. One-chunk pre-roll protects first syllables.
    final double[] rmsWin = new double[25]; // 25 x 100ms = 2.5s
    java.util.Arrays.fill(rmsWin, 1e9);
    int winIdx = 0;
    int gateLeft = 0;
    byte[] prevChunk = null;
    int prevLen = 0;
    boolean wasOpen = false;
    int gatedRun = 0; // consecutive wordless chunks
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
      // set after the gate is evaluated below; read by the silence heartbeat
      if (muted) {
        // do NOT learn while muted: half-duplex mute means HER voice is on
        // the speaker right now — training the floor on it would ratchet the
        // threshold up on audio we're about to discard anyway
        gateLeft = 0;
        wasOpen = false;
      } else {
        double sum = 0;
        for (int i = 0; i + 1 < n; i += 2) {
          int v = (buf[i + 1] << 8) | (buf[i] & 0xFF);
          sum += (double) v * v;
        }
        double rms = Math.sqrt(sum / Math.max(1, n / 2));
        rmsWin[winIdx] = rms;
        winIdx = (winIdx + 1) % rmsWin.length;
        double floor = 1e9;
        for (double w : rmsWin) floor = Math.min(floor, w);
        floor = Math.min(1300, Math.max(50, floor));
        double thr = Math.min(Math.max(floor * 3, 330), 820);
        if (rms > thr) gateLeft = 3; // ~300ms hangover
        else if (gateLeft > 0) gateLeft--;
        gated = gateLeft <= 0;
        opened = !gated && !wasOpen;
        wasOpen = !gated;
      }
      if (muted || gated) gatedRun++;
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
            (muted || gated)
                ? (queued > SILENCE_CAP
                    && gatedRun > SILENCE_ENDPOINT_CHUNKS // turn-ending pause always goes
                    && gatedRun % SILENCE_KEEP != 0) // and the stream never goes dark
                : (overSince != 0 && nowMs - overSince >= STALL_MS);
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
      // muted/gated writes silence rather than stopping capture: the stream
      // stays continuous (server VAD hates gaps) and reopening costs nothing
      if (muted || gated) Arrays.fill(buf, 0, n, (byte) 0);
      if (canSend && !drop) {
        try {
          s.send(
              "{\"realtimeInput\":{\"audio\":{\"data\":\""
                  + Base64.encodeToString(buf, 0, n, Base64.NO_WRAP)
                  + "\",\"mimeType\":\"audio/pcm;rate=16000\"}}}");
        } catch (Exception ignored) {
        }
      }
    }
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
