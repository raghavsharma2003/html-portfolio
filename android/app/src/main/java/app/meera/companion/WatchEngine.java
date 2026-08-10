package app.meera.companion;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The native watch-together brain loop. Runs entirely inside the foreground
 * service process because Android freezes the WebView (timers AND fetch) the
 * moment another app is foreground — the on-device test proved the web loop
 * cannot drive this. Flow: screen frame → /api/chat (vision) → if she has
 * something to say → /api/speech → AudioTrack (ducks YouTube), plus a native
 * SpeechRecognizer lane so the user can TALK to her while another app is up.
 * Half-duplex: the mic pauses while she speaks (simple, echo-proof).
 */
class WatchEngine {
  private static final String TAG = "MeeraWatch";
  private static final long COMMENT_COOLDOWN_MS = 20_000;

  interface Emitter {
    void emit(String event, JSONObject data);
  }

  private final Context ctx;
  private final Emitter emitter;
  private final ExecutorService net = Executors.newSingleThreadExecutor();
  private final Handler main = new Handler(Looper.getMainLooper());
  private final ArrayDeque<String[]> turns = new ArrayDeque<>(); // [role, text]

  private volatile String base = "https://meera-silk.vercel.app";
  private volatile String system = "";
  private volatile String systemTail = "";
  private volatile String directive = "";
  private volatile boolean running = false;
  private volatile boolean speaking = false;
  private volatile boolean thinking = false;
  private volatile long lastCommentAt = 0;
  private volatile long lastUserSpokeAt = 0;
  private volatile String latestFrame = null;
  private volatile String lastAnalyzed = null;
  private SpeechRecognizer recognizer;
  private PipedRecognizer piped; // beep-free continuous lane (API 33+)
  private AudioTrack player;
  private AudioFocusRequest focus;
  private volatile boolean micDead = false;
  private int errStreak = 0;

  WatchEngine(Context ctx, Emitter emitter) {
    this.ctx = ctx;
    this.emitter = emitter;
  }

  void configure(String json) {
    try {
      JSONObject cfg = new JSONObject(json);
      base = cfg.optString("base", base);
      system = cfg.optString("system", "");
      systemTail = cfg.optString("systemTail", "");
      directive = cfg.optString("directive", "");
    } catch (Exception e) {
      Log.w(TAG, "bad config", e);
    }
  }

  void start() {
    running = true;
    lastCommentAt = System.currentTimeMillis(); // no instant commentary
    if (PipedRecognizer.supported(ctx)) {
      // we own the mic and pipe PCM to the recognizer: no system earcons
      // ("tun tun") every few seconds, no dead-mic restart windows
      piped =
          new PipedRecognizer(
              ctx,
              new PipedRecognizer.Callbacks() {
                @Override
                public void onPartial(String cumulativeText) {
                  lastUserSpokeAt = System.currentTimeMillis();
                }

                @Override
                public void onSegment(String text) {
                  if (running && text != null && !text.trim().isEmpty()) {
                    lastUserSpokeAt = System.currentTimeMillis();
                    onUserSpoke(text.trim());
                  }
                }

                @Override
                public void onDown(boolean fatal) {
                  piped = null;
                  if (running) main.post(WatchEngine.this::startRecognizer); // legacy rung
                }
              });
      piped.start();
    } else {
      main.post(this::startRecognizer);
    }
  }

  void stop() {
    running = false;
    if (piped != null) {
      piped.stop();
      piped = null;
    }
    main.post(() -> {
      if (recognizer != null) {
        try {
          recognizer.destroy();
        } catch (Exception ignored) {}
        recognizer = null;
      }
    });
    stopPlayback();
    net.shutdownNow();
  }

  /** execute() after shutdownNow() throws REE from inside running tasks —
   *  a stop() racing an in-flight think/speak must never crash the process. */
  private void safeExecute(Runnable r) {
    try {
      net.execute(r);
    } catch (Exception ignored) {}
  }

  /** New screen frame from the capture pipeline (JPEG base64, ~768px). */
  void onFrame(String b64) {
    latestFrame = b64;
    if (!running || speaking || thinking) return;
    long now = System.currentTimeMillis();
    if (now - lastCommentAt < COMMENT_COOLDOWN_MS) return;
    if (now - lastUserSpokeAt < 4000) return; // they're mid-thought
    if (b64.equals(lastAnalyzed)) return; // static screen costs zero
    lastAnalyzed = b64;
    think(directive, b64, true);
  }

  /* ── user speech lane: restart-loop SpeechRecognizer with partials ── */

  private void startRecognizer() {
    if (!running || speaking || micDead) return;
    try {
      if (recognizer != null) recognizer.destroy();
      recognizer = SpeechRecognizer.createSpeechRecognizer(ctx);
      android.content.Intent intent =
          new android.content.Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
      intent.putExtra(
          RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
      intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN");
      intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
      recognizer.setRecognitionListener(
          new RecognitionListener() {
            @Override
            public void onResults(Bundle results) {
              ArrayList<String> list =
                  results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
              String text = list != null && !list.isEmpty() ? list.get(0) : "";
              if (running && text != null && !text.trim().isEmpty()) {
                lastUserSpokeAt = System.currentTimeMillis();
                onUserSpoke(text.trim());
              }
              errStreak = 0;
              restartSoon(150);
            }

            @Override
            public void onError(int error) {
              if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                micDead = true; // no mic grant: she still watches + comments
                return;
              }
              // NO_MATCH / timeouts are normal silence — re-arm fast.
              // BUSY/CLIENT need destroy+recreate with a beat; NETWORK/SERVER/
              // TOO_MANY_REQUESTS are rate-limited by Google — real backoff.
              boolean slow =
                  error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY
                      || error == SpeechRecognizer.ERROR_CLIENT;
              boolean throttled =
                  error == SpeechRecognizer.ERROR_NETWORK
                      || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT
                      || error == SpeechRecognizer.ERROR_SERVER
                      || error == 10; // ERROR_TOO_MANY_REQUESTS (API 31+)
              errStreak = (slow || throttled) ? errStreak + 1 : 0;
              if (errStreak > 8 && !throttled) {
                micDead = true; // recognizer is broken here — stop churning
                return;
              }
              // throttling is transient (network/rate limit) — keep backing
              // off instead of latching the mic dead for the whole session
              restartSoon(throttled ? Math.min(2000L * errStreak, 10_000) : slow ? 900 : 250);
            }

            @Override
            public void onPartialResults(Bundle partial) {
              lastUserSpokeAt = System.currentTimeMillis();
            }

            @Override public void onReadyForSpeech(Bundle params) {}
            @Override public void onBeginningOfSpeech() {
              lastUserSpokeAt = System.currentTimeMillis();
            }
            @Override public void onRmsChanged(float rmsdB) {}
            @Override public void onBufferReceived(byte[] buffer) {}
            @Override public void onEndOfSpeech() {}
            @Override public void onEvent(int eventType, Bundle params) {}
          });
      recognizer.startListening(intent);
    } catch (Exception e) {
      Log.w(TAG, "recognizer start failed", e);
      restartSoon(2000); // transient create/start failure — don't go silent
    }
  }

  private void restartSoon(long delayMs) {
    if (!running) return;
    main.postDelayed(this::startRecognizer, delayMs);
  }

  private void onUserSpoke(String text) {
    remember("user", text);
    emitTurn("me", text);
    think(text, latestFrame, false);
  }

  /* ── brain: POST /api/chat with rolling native context + current frame ── */

  private volatile String pendingUser = null;

  private void think(String latest, String frameB64, boolean isComment) {
    if (latest == null || latest.isEmpty()) return;
    if (thinking) {
      // never drop what the USER said because she was mid-think — hold the
      // latest utterance and answer it as soon as this pass finishes
      if (!isComment) pendingUser = latest;
      return;
    }
    thinking = true;
    safeExecute(() -> {
      try {
        JSONArray messages = new JSONArray();
        synchronized (turns) {
          for (String[] t : turns) {
            messages.put(new JSONObject().put("role", t[0]).put("content", t[1]));
          }
        }
        Object content;
        if (frameB64 != null) {
          JSONArray parts = new JSONArray();
          parts.put(new JSONObject().put("type", "text").put("text", latest));
          parts.put(
              new JSONObject()
                  .put("type", "image_url")
                  .put(
                      "image_url",
                      new JSONObject().put("url", "data:image/jpeg;base64," + frameB64)));
          content = parts;
        } else {
          content = latest;
        }
        messages.put(new JSONObject().put("role", "user").put("content", content));

        JSONObject body = new JSONObject();
        body.put("system", system);
        body.put("system_tail", systemTail);
        body.put("messages", messages);
        body.put("max_tokens", 190);
        body.put("no_think", true);
        // ambient comments can drop on a bad network; the user's actual
        // question must not — one retry so "she just never answered" is rare
        String resp = null;
        int attempts = isComment ? 1 : 2;
        for (int i = 0; i < attempts && resp == null; i++) {
          try {
            resp = post(base + "/api/chat", body.toString(), "application/json");
          } catch (Exception e) {
            if (i + 1 >= attempts) throw e;
          }
        }
        String text = resp == null ? null : new JSONObject(resp).optString("text", "");
        if (!running || text == null || text.trim().isEmpty()) {
          thinking = false;
          drainPending();
          return;
        }

        String tone = extractTone(text);
        String spoken = sanitize(text);
        String up = spoken.toUpperCase();
        if (spoken.isEmpty() || up.contains("NO_COMMENT") || up.contains("NO COMMENT")) {
          thinking = false;
          drainPending();
          return;
        }
        if (isComment) lastCommentAt = System.currentTimeMillis();
        remember("assistant", spoken);
        emitTurn("her", spoken);
        speak(spoken, tone); // sets speaking=true before returning …
        thinking = false; // … so onFrame stays gated with no window between
        drainPending();
      } catch (Exception e) {
        thinking = false;
        Log.w(TAG, "think failed", e);
        drainPending();
      }
    });
  }

  private void drainPending() {
    String p = pendingUser;
    pendingUser = null;
    if (p != null && running) think(p, latestFrame, false);
  }

  private void remember(String role, String text) {
    synchronized (turns) {
      turns.addLast(new String[] {role.equals("user") ? "user" : "assistant", text});
      while (turns.size() > 12) turns.removeFirst();
    }
  }

  private void emitTurn(String who, String text) {
    try {
      emitter.emit("watchturn", new JSONObject().put("who", who).put("text", text));
    } catch (Exception ignored) {}
  }

  private static String extractTone(String raw) {
    java.util.regex.Matcher m =
        java.util.regex.Pattern.compile("\\[\\s*tone\\s*:\\s*([^\\]]*)\\]", 2).matcher(raw);
    return m.find() ? m.group(1).trim() : "";
  }

  /** Same leak rules as the web parser: nothing bracketed is ever spoken. */
  private static String sanitize(String raw) {
    return raw
        .replaceAll("\\[[^\\]]*\\]?", " ")
        .replaceAll("(^|\\s)-{2,}(\\s|$)", " ")
        .replaceAll("\\*[^*\\n]{1,80}\\*", " ")
        .replaceAll("\\s+", " ")
        .trim();
  }

  /* ── voice out: /api/speech → WAV → AudioTrack, ducking whatever plays ── */

  private void speak(String text, String tone) {
    speaking = true;
    BubbleService.setState(ctx, BubbleService.STATE_SPEAKING);
    // half-duplex: never hear our own voice. Piped lane just writes silence
    // (capture continues, zero restart cost); legacy lane cancels + re-arms.
    if (piped != null) piped.setMuted(true);
    main.post(() -> {
      if (recognizer != null) {
        try {
          recognizer.cancel();
        } catch (Exception ignored) {}
      }
    });
    safeExecute(() -> {
      try {
        JSONObject body = new JSONObject().put("text", text);
        if (tone != null && !tone.isEmpty()) body.put("style", tone);
        byte[] wav = postBytes(base + "/api/speech", body.toString());
        if (wav != null && wav.length > 1000 && running) playWav(wav);
      } catch (Exception e) {
        Log.w(TAG, "speak failed", e);
      } finally {
        speaking = false;
        BubbleService.setState(ctx, BubbleService.STATE_WATCHING);
        if (piped != null) {
          piped.setMuted(false); // mic never stopped — just unmute
        } else {
          main.post(() -> restartSoon(200));
        }
      }
    });
  }

  private void playWav(byte[] wav) {
    AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
    AudioAttributes.Builder ab =
        new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH);
    if (android.os.Build.VERSION.SDK_INT >= 29) {
      // her voice must never loop back into any playback capture
      ab.setAllowedCapturePolicy(AudioAttributes.ALLOW_CAPTURE_BY_NONE);
    }
    AudioAttributes attrs = ab.build();
    focus =
        new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(attrs)
            .build();
    am.requestAudioFocus(focus); // YouTube ducks under her voice
    try {
      // find the real data chunk — WAVs may carry LIST/fact chunks, and a
      // fixed 44-byte skip would play header bytes as an audible click
      int dataAt = 44;
      for (int i = 12; i < Math.min(wav.length - 8, 200); i++) {
        if (wav[i] == 'd' && wav[i + 1] == 'a' && wav[i + 2] == 't' && wav[i + 3] == 'a') {
          dataAt = i + 8;
          break;
        }
      }
      int pcmLen = wav.length - dataAt;
      player =
          new AudioTrack.Builder()
              .setAudioAttributes(attrs)
              .setAudioFormat(
                  new AudioFormat.Builder()
                      .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                      .setSampleRate(24000)
                      .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                      .build())
              .setBufferSizeInBytes(pcmLen)
              .setTransferMode(AudioTrack.MODE_STATIC)
              .build();
      player.write(wav, dataAt, pcmLen);
      player.play();
      // block this worker until playback ends (rough: samples / rate)
      long ms = (long) (pcmLen / 2 / 24.0) + 150;
      Thread.sleep(Math.min(ms, 120_000));
    } catch (Exception e) {
      Log.w(TAG, "playback failed", e);
    } finally {
      stopPlayback();
      am.abandonAudioFocusRequest(focus);
    }
  }

  private void stopPlayback() {
    if (player != null) {
      try {
        player.stop();
        player.release();
      } catch (Exception ignored) {}
      player = null;
    }
  }

  /* ── tiny HTTP helpers (no deps; FGS process is never frozen) ── */

  private static String post(String url, String body, String accept) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
    c.setRequestMethod("POST");
    c.setConnectTimeout(15_000);
    c.setReadTimeout(60_000);
    c.setDoOutput(true);
    c.setRequestProperty("Content-Type", "application/json");
    try (OutputStream os = c.getOutputStream()) {
      os.write(body.getBytes(StandardCharsets.UTF_8));
    }
    if (c.getResponseCode() != 200) return null;
    try (InputStream is = c.getInputStream()) {
      return new String(readAll(is), StandardCharsets.UTF_8);
    }
  }

  private static byte[] postBytes(String url, String body) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
    c.setRequestMethod("POST");
    c.setConnectTimeout(15_000);
    c.setReadTimeout(90_000);
    c.setDoOutput(true);
    c.setRequestProperty("Content-Type", "application/json");
    try (OutputStream os = c.getOutputStream()) {
      os.write(body.getBytes(StandardCharsets.UTF_8));
    }
    if (c.getResponseCode() != 200) return null;
    try (InputStream is = c.getInputStream()) {
      return readAll(is);
    }
  }

  private static byte[] readAll(InputStream is) throws Exception {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buf = new byte[16384];
    int n;
    while ((n = is.read(buf)) > 0) out.write(buf, 0, n);
    return out.toByteArray();
  }
}
