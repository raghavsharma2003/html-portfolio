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
  // ── MIRRORED WITH api/live-token.js's LIVE_MODEL ────────────────────────
  // Only used if /api/live-token ever answers without a model field, which is
  // a malformed response rather than a normal path — and that is exactly why
  // it was wrong for so long without anyone hearing it.
  //
  // It was "models/gemini-2.5-flash-native-audio-latest": a model this repo
  // MEASURED AND REJECTED for the live lane (`live-model-bake`, 0/24 barge-in,
  // 3-5.5s to first audio), sitting as the silent fallback on the ONE surface
  // where the triple-swap actually happens. So a malformed token response did
  // not degrade the watch lane's latency, it changed WHO SHE WAS: a different
  // model family renders the same voice name as a different woman, which is
  // the entire class scripts/verify-voice.mjs exists for. The JS twin
  // (src/voice/liveCall.ts) has no fallback at all — it uses the token's model
  // or fails — so the two twins did not merely differ, they disagreed about
  // whether a fallback should exist.
  //
  // Reconciled deliberately: the fallback is now the SAME model the token
  // endpoint serves, so a malformed response costs a round trip and nothing
  // else. verify-voice.mjs §7c fails the build if the two strings drift apart.
  private static final String DEFAULT_MODEL = "models/gemini-3.1-flash-live-preview";

  private static final int IN_RATE = 16000; // uplink mic PCM16 mono
  private static final int OUT_RATE = 24000; // downlink her voice PCM16 mono
  private static final int MIC_CHUNK = 3200; // 100ms @ 16k mono 16-bit
  private static final int MAX_RECONNECTS = 3; // then fall back to the cascade
  private static final int MAX_ROTATES = 6; // goAway storms must not spin
  // ── goAway rotation: MIRRORED WITH src/voice/liveCall.ts ────────────────
  // Every constant below has a twin of the same name in liveCall.ts, and
  // scripts/verify-voice.mjs §6 fails the build if the two disagree. Same
  // reason the voice NAME is mirrored and asserted: these two files are one
  // behaviour with two implementations, and the only failure that matters is
  // divergence. A rotation that fires at a different moment in the APK than on
  // the web is a voice that behaves differently on the two surfaces.
  //
  // WHY THE ROTATION WAITS. rotate() flushes playback, so taking it the
  // instant goAway lands cuts her off mid-word — the server, meanwhile, sends
  // goAway with its own notice period (timeLeft) precisely so a client does
  // not have to. So the rotation is held until she stops speaking, capped at
  // ROTATE_WAIT_MAX_MS and never allowed past timeLeft - ROTATE_GRACE_MS.
  private static final long ROTATE_DELAY_MS = 500; // old socket closed -> new one opened
  private static final long ROTATE_GRACE_MS = 1200; // stay clear of the server's own deadline
  private static final long ROTATE_WAIT_MAX_MS = 4000; // longest hold waiting for her to finish
  private static final long ROTATE_POLL_MS = 120; // how often "is she still speaking" is re-asked
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
  private static final double FLOOR_MIN = 49; // −56.5 dBFS (web 0.0015)
  // The floor clamp and the threshold clamp CROSSED: above floor 273 the
  // threshold froze at 820, and above floor 820 the threshold sat BELOW
  // ambience — at the old ceiling of 1300 it was 20·log10(820/1300) = −4.0 dB
  // UNDER the noise floor, so in a loud room the gate could never close, the
  // whole room was transmitted as speech, and the digital silence that ends a
  // turn was never sent. LISTEN_RATIO_MIN below is the fix for that and it
  // stays.
  //
  // What does NOT stay is the 3900 ceiling that rode along with it. RATIO_MIN
  // makes the listen bar track the floor at +5.1 dB with no absolute cap, so
  // the floor ceiling IS the listen-bar ceiling: at floor 3900 the bar is
  // 3900·1.8 = 7020 = −13.4 dBFS, against the old 820 (−32.0 dBFS) cap — an
  // 18.6 dB move. Ordinary speech at 1m is −26…−20 dBFS, so from floor ≈ 1600
  // upward the gate stops opening for a normal voice at all, and a closed gate
  // transmits a ZEROED buffer: the uplink goes silent on an idle session where
  // the hold logic never runs and nothing else can rescue it. 1311 (0.04 full
  // scale, −28 dBFS) bounds the worst case at 1311·1.8 = 2360 = −22.9 dBFS.
  private static final double FLOOR_MAX = 1311; // −28.0 dBFS (web 0.04)
  private static final double LISTEN_MIN = 328; // −40.0 dBFS (web 0.01)
  private static final double LISTEN_MAX = 819; // −32.0 dBFS (web 0.025)
  private static final double LISTEN_MULT = 3;
  private static final double LISTEN_RATIO_MIN = 1.8; // +5.1 dB — it can always close
  /** Absolute backstop on the listen bar, independent of the floor. A no-op at
   *  FLOOR_MAX (1311·1.8 = 2360 exactly), deliberately set AT the ratio-min
   *  value so it can never fight LISTEN_RATIO_MIN and re-create the clamp
   *  crossing that fix exists to close. It is here so that raising FLOOR_MAX
   *  again cannot silently re-open the deafness above. */
  private static final double LISTEN_ABS_MAX = 2360; // −22.9 dBFS (web 0.072)
  // While she is audible the cost function inverts: a false open costs her
  // being killed mid-word by a television. +16 dB over ambience is the
  // near-field argument — inverse square from a mouth at 0.2m against a TV at
  // 3m is 23.5 dB, hands-free at 0.5m against 3m is 15.6 dB; +16 dB is inside
  // what a real talker always has and outside the 0-6 dB a same-room
  // interferer can muster.
  private static final double BARGE_MULT = 6.3; // +16.0 dB over ambience
  private static final double BARGE_OVER_LISTEN = 2.5; // +8.0 dB over the listen bar
  private static final double BARGE_MAX = 11469; // −9 dBFS: nothing is unbargeable
  // The soft bar is deliberately NOT raised by the echo term. It used to be
  // min(thrB, max(…, echoTerm)), which collapses onto thrB the instant echo
  // binds thrB — so on the leaky speakerphone the valve exists for, it gave
  // zero extra LEVEL sensitivity and only a longer duration, which is a pure
  // loss. Echo may now raise the hard bar only. What stops her own leak from
  // walking through the lower soft bar is not the bar, it is claimPeak >
  // echoTerm at the claim site: a real second source puts at least one
  // sub-frame above everything her own voice can explain, and pure echo cannot.
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
  /**
   * HOW κ IS MEASURED: it only ever DECAYS, from a pessimistic seed.
   *
   * The old rule was κ <- κ + a·(micRms/herNow − κ) over the whole mic signal,
   * excluded only while something had already cleared thrB. Its fixed point is
   * κ* = micRms/herNow, so echoTerm = κ*·herNow = micRms: the barge bar
   * converges onto the TOTAL MIC LEVEL — ambience, the person and the leak
   * together. Nothing at or below what the mic currently hears can then clear
   * it, and anything a person adds that fails to clear it raises the bar by
   * exactly what they added. That is positive feedback, and on a leaky
   * speakerphone it leaves her talking-deaf for a whole turn.
   *
   * The direction is the fix, and it is forced. κ cannot be allowed to rise on
   * mic level, because NO level statistic separates her echo from a person:
   * measured over a 1s window, a person raises the 20th percentile of the
   * ratio from 0.05 to 0.51, and the dispersion of the ratio is 1.92 for a
   * person against 1.93 for pure echo. So κ starts at the worst coupling this
   * hardware plausibly has — AOSP only requires an echo canceller on a
   * VOICE_COMMUNICATION capture path and this engine records with
   * VOICE_RECOGNITION — and only ever comes DOWN, toward the observed 90th
   * percentile of r = sqrt(max(0, sub² − floor²)) / herNow, with her level
   * taken at the same 20ms resolution and the same instant, from the playback
   * head.
   *
   * What that costs: a device with real AEC spends the first second or so of
   * the session over-protected, until her first turn measures it. Barge-ins in
   * that window are late, not lost — measured at +0 to +256ms against the old
   * arbiter, all still landing. What it buys is that she stops taking the
   * floor from herself: at −12 dB and −8 dB echo return loss the old arbiter
   * self-interrupted in 6 of 6 trials and this one in 0 of 6.
   */
  //
  // ── ...AND WHY IT MAY NOW ALSO RISE, ON EVIDENCE THAT IS NOT A LEVEL ──
  //
  // Twin of the web lane; see src/voice/liveCall.ts for the full argument and
  // the measurements. In short: the seed is a GUESS about the device, and a
  // phone at loud volume or on speakerphone (≈−6 dB of coupling, κ ≈ 0.5) puts
  // the bar below her own leak with no way back up. Simulated against the real
  // arbiter, three of her turns per call, 8 seeds, nobody in the room:
  //
  //   coupling   self-duck % of her turn     her own voice sent to the server
  //     −6 dB          91  →  13                  6996ms  →  1194ms per call
  //     −9 dB          33  →   5                  4778ms  →   512ms
  //    −12 dB           2  →   0                  2474ms  →   341ms
  //   and at −1.5 dB she took the floor from herself in 6 of 8 calls → 2 of 8,
  //   with barge-in unchanged at 8/8 from −6 dB down (7/8 at −3, as before).
  //
  // κ may rise only while the ECHO LOCK holds: across a 1.0s window of mic
  // ticks, mic power must be an affine function of HER OWN output power at a
  // fixed lag. A second talker is uncorrelated with her envelope, so they move
  // the intercept and wreck the fit — which is why this is not the "level
  // statistic" the paragraph above rules out. Measured r² of that fit: 0.89
  // median on pure echo, and gating at 0.7 keeps √slope within 4% of its
  // pure-echo value even with a loud person talking across her whole turn.
  private static final double ECHO_KAPPA_SEED = 0.30; // ≈10 dB ERL: bare speakerphone
  private static final double ECHO_KAPPA_MIN = 0.02; // ≈34 dB ERL: real AEC
  /** ≈−2.4 dB ERL. Past this no bar can tell her voice from anyone else's. */
  private static final double ECHO_KAPPA_MAX = 0.76;
  private static final int ECHO_WIN_SUBS = 50; // 1.0s of ratio history
  private static final double ECHO_PCT = 0.9; // must bound the leak's PEAKS
  private static final int ECHO_MIN_SAMPLES = 16;
  private static final double ECHO_RATE = 0.4; // how fast κ comes down
  /** Faster than the decay: under-protection is the self-sustaining failure. */
  private static final double ECHO_UP_RATE = 0.55;
  private static final int ECHO_FIT_WIN = 10; // 10 mic chunks = 1.0s
  private static final double ECHO_FIT_R2 = 0.7; // pure echo sits at p10 = 0.73
  private static final int ECHO_LAG_STEP_MS = 20;
  private static final int ECHO_LAGS = 14; // 0…260ms of acoustic round trip
  /** How long the room keeps handing her last syllable back, and how far down. */
  private static final int ECHO_TAIL_MS = 200;
  private static final double ECHO_TAIL_DB = 20;
  /** How far back ring admission peak-holds the prediction: 3 chunks = 300ms. */
  private static final int ECHO_ADMIT_TICKS = 3;
  /** The bar sits a MARGIN above the leak estimate, never at it: κ is an RMS
   *  ratio and the sub-frames it must reject are the loud ones. +2.3 dB was
   *  chosen by sweeping it against BOTH failure directions at once — below 1.3
   *  she starts interrupting herself again, above 1.6 the quiet talker stops
   *  getting through. */
  // Twin of the web lane. Re-swept once κ stopped being a guess — the old note
  // ("below 1.3 she starts interrupting herself again") was true of a κ pinned
  // at a possibly-6-dB-wrong seed, so the margin was covering the ESTIMATOR's
  // error too. It STAYS at 1.3: at 1.15 one more quiet talker in eight gets
  // through, but the television goes back to stopping her 7/8 of the time,
  // which is the half of the complaint this work exists to answer.
  private static final double ECHO_MARGIN = 1.3; // +2.3 dB
  /**
   * Only sub-frames where she is within this much of her recent peak measure
   * κ. Her pauses carry no coupling information, only the prediction's error —
   * measured as κ = 0.41 on a device whose true coupling is 0.25.
   */
  private static final double ECHO_MEASURE_FRAC = 0.7;
  /*
   * The soft bar's LEVEL no longer carries the echo term (see thrS), but an
   * individual soft HIT still has to out-shout the leak at the instant it was
   * captured. That is a per-sub-frame test, not a test on the finished
   * candidate: her voice pauses, and a span statistic compared against the
   * CURRENT echo term passes during her every breath — measured, on the real
   * endpoint, as her taking the floor from herself in 3 of 3 sessions even
   * with the hard bar holding.
   *
   * What this buys, and what it does not: while echo is not the binding term
   * — a headset, any real AEC, and every moment she is quiet — the soft valve
   * is a genuinely lower bar and gives the 3.5-14 dB of extra level
   * sensitivity it is supposed to. When her leak IS the loudest thing in the
   * room the valve collapses back onto the leak, and that is not a bug to
   * fix: a bar below the echo cannot tell a quiet talker from her own voice,
   * and the soft path's remaining advantage there is its longer duration.
   */
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
  // WHEN to wake her now comes from SceneReader (a line-for-line twin of
  // src/watch/scene.ts): the old three-constant ladder — 2s for a new thing,
  // 12s while they work, 45s on a frozen screen — was one cadence trying to
  // serve a reel feed, a code file and an article being read at the same
  // time, so it was simultaneously too fast for one and too slow for another.
  // What survives here are the gates that keep a wake honest and the socket
  // safe. IDLE_QUIET_MS is the ambient "don't cut across them" window; a
  // deliberate show uses the shorter SHOW_QUIET_MS below.
  private static final long IDLE_QUIET_MS = 3_000;
  private static final int WAKE_CEILING = 12; // per WAKE_WINDOW_MS, hard
  private static final long WAKE_WINDOW_MS = 60_000;
  private static final int AMBIENT_CEILING = 5; // ambient's share of the ring
  private static final long SHOW_FLOOR_MS = 2500; // between deliberate shows
  private static final long SHOW_QUIET_MS = 1200; // after their voice, for a show

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
          + " what's happening like a person."
          + " "
          // THE ANTI-INVENTION CLAUSE. Every cascade directive in persona.ts has
          // carried this for months; this lane — the one that actually runs on
          // Android — never did, and the difference is exactly what got reported:
          // she named an app that was not on screen. Recognition was already
          // banned above ("you never call anything famous or trending"), but
          // NAMING was not, and naming is the failure mode. Last in the note by
          // position, because a rule buried mid-brief fired 0/8 and the same rule
          // appended last fired 8/8.
          + "Never a name, a brand, an app, a place, a person, a price or a number that is not "
          + "written on the screen in front of you right now. If you cannot make something out, "
          + "that is a real answer and it is always better than a guess — say you can't see it "
          + "properly, or say nothing. Guessing what an app is and being wrong is worse than "
          + "every silence you could have kept. "
          + "AND UNTIL A PICTURE ACTUALLY REACHES YOU, YOU CANNOT SEE ANYTHING. The share takes a "
          + "moment to start, and during it you have no screen at all — not a blank one, not a "
          + "boring one, NONE. If they talk to you in that gap, just talk to them normally like on "
          + "any call; you have nothing to react to yet and pretending otherwise is inventing. The "
          + "same is true any time the picture stops coming. "
          + " "
          + "Some of what crosses their screen is not for you. A password box, a code that just arrived, "
          + "a bank number, a medical line, a message from someone else — you notice it the way you'd "
          + "notice it sitting in the room, and you let it go past without a word AND without announcing "
          + "that you let it go past. Saying \"I'm not looking\" is worse than looking: it proves you did, "
          + "and it makes them feel it twice. Someone else's messages are theirs and not yours to read "
          + "over their shoulder; you don't quote them, ask who it was, or use the name. The one "
          + "exception is when something is on screen that they clearly wouldn't want out in the open — "
          + "then you say so at once, WHAT KIND of thing it is and never what it says (\"yaar OTP aa gaya "
          + "screen pe\", not the digits), and then you drop it completely: no follow-up, no coming back "
          + "to it later. A warning is a favour; a favour mentioned twice is surveillance. None of this "
          + "makes you careful or bland — you are still the friend with opinions, and this is just the "
          + "ordinary tact that comes with sitting next to someone. "
          + " "
          + "If they ever ask what you can actually see, or whether any of this is being kept, tell them "
          + "plainly — no hedging, no legal-sounding answer, it's a fair question and the truth is fine. "
          + "What's true: you get a picture of their screen every half a second or so while the call is "
          + "on, it is shrunk down so big text and headings usually read but small print and fine detail "
          + "often don't, you have nothing from before the share started and nothing after it stops, and "
          + "on Android some apps (banking ones especially) come through to you completely blank. The "
          + "pictures aren't saved anywhere. They do go out to the model that is you, so \"nothing is "
          + "stored\" is true and \"nobody else sees it\" is not — never say the second one. You don't bring "
          + "any of this up unprompted; announcing your own trustworthiness is its own kind of tell. ";

  /** The share has just begun and the first frame has actually reached her. */
  private static final String START_NUDGE =
      "<context: they just started sharing their screen and the first frame has reached you —"
          + " from here you see it live. Say something only if what's there actually strikes"
          + " you; otherwise just settle in and watch. Never announce that you can see their"
          + " screen. Never reference this note>";

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
  private volatile boolean firstConnect = true; // the model is decided once per session

  private volatile boolean running = false;
  private volatile boolean ready = false;
  private volatile boolean muted = false;
  private volatile boolean speaking = false;
  /**
   * Her own level, keyed to the PLAYBACK HEAD rather than to the wall clock.
   *
   * This used to be one {rms, writtenAt} pair stamped as the chunk was handed
   * to AudioTrack, read by the mic thread inside a 300ms freshness window. On
   * MODE_STREAM a write only ENQUEUES: the track buffer here is ~400ms, so the
   * audio being stamped is up to 400ms away from the speaker and the stamp has
   * already expired by the time it is emitted. herNow therefore read 0 at
   * exactly the moment her loudest audio reached the mic — echo protection off
   * precisely when it is needed. On a weak-AEC device her own voice could then
   * clear the bar, pass the steadiness veto, and be burst-released to the
   * server as the USER'S turn.
   *
   * So each chunk records the frame range it will occupy in the track, and the
   * mic thread looks up whatever range contains getPlaybackHeadPosition(). The
   * frame counters are the same clock: both are reset by the pause/flush/play
   * in flushPlayback(), and the generation stamp discards a ring written
   * before a flush. Single writer (play thread), single reader (mic thread) —
   * a torn read costs one stale RMS estimate, never correctness.
   */
  private static final int HER_RING = 48;
  /** ~120ms at 24kHz: the acoustic round trip plus one mic chunk of capture. */
  private static final int HER_LOOKBACK_FRAMES = OUT_RATE * 120 / 1000;
  /** ~40ms ahead: the head advances while this chunk is being measured. */
  private static final int HER_LOOKAHEAD_FRAMES = OUT_RATE * 40 / 1000;
  private final long[] herFrom = new long[HER_RING]; // first frame of the chunk
  private final long[] herTo = new long[HER_RING]; // one past its last frame
  private final double[] herLvl = new double[HER_RING]; // its RMS, Int16 units
  private final int[] herGen = new int[HER_RING]; // flushGen it belongs to
  private volatile int herWrite = 0; // next slot; only the play thread writes
  /**
   * The same audio at 20ms resolution: what she was doing at one exact moment,
   * rather than how loud she was around now. herLvl answers the second
   * question (a max over a window, so it can bound a peak without anyone
   * measuring the device's acoustic round trip); the echo fit needs the first,
   * because it correlates her envelope against the microphone's.
   *
   * Sized for the LEAD, not for the history: the downlink runs seconds ahead
   * of the speaker (a median of ~5s of unplayed audio on his own calls), so a
   * ring holding only the last N frames fills with audio nobody has heard yet
   * and the lookup falls off the front of it. 1024 blocks = 20.5s of lead.
   * Same single-writer/single-reader discipline as herLvl above.
   */
  private static final int HER_ENV_RING = 1024;
  private final long[] herEnvTo = new long[HER_ENV_RING]; // one past the block's last frame
  private final double[] herEnvP = new double[HER_ENV_RING]; // its POWER, Int16 units²
  private final int[] herEnvGen = new int[HER_ENV_RING];
  private volatile int herEnvWrite = 0;
  /** Scratch for one chunk's 20ms powers, play thread only. */
  private final double[] envScratch = new double[512];
  /** Decay applied to her tail, one entry per 20ms of age. */
  private static final double[] ECHO_TAIL_DECAY = tailDecay();

  private static double[] tailDecay() {
    final int n = ECHO_TAIL_MS / 20 + 1;
    final double[] d = new double[n];
    for (int i = 0; i < n; i++) {
      d[i] = Math.pow(10, -ECHO_TAIL_DB * (i * 20.0 / ECHO_TAIL_MS) / 10);
    }
    return d;
  }
  /** One past the last frame handed to the track, in the same frame clock. */
  private volatile long herWritten = 0;
  private volatile float trackVol = 1f; // what fraction is reaching the speaker
  /** Non-zero while a dissolve owns the volume — a duck must never fight it. */
  private volatile int fadeActive = 0;
  /** The floor is genuinely theirs for the rest of her turn: stop holding. */
  private volatile boolean floorLost = false;
  /** When the current candidate first looked like a voice — decides whether
   *  the eventual yield is a trail-off or a clean break. */
  private volatile long floorClaimSince = 0;
  /**
   * When we burst a real floor claim at the server, or 0 once the server has
   * answered. This was a micLoop LOCAL, which the WS reader thread cannot
   * reach — so unlike the web lane (which clears it in the `interrupted`
   * branch) Android had no stand-down: after a SUCCESSFUL barge-in the
   * watchdog still fired ~1.5s later and guillotined the reply she had already
   * started, with no `interrupted` and no cause anywhere in the logs.
   */
  private volatile long floorReleasedAt = 0;
  /**
   * Bytes of a deliberate release burst still draining, and the wall clock at
   * which that credit expires no matter what. A floor release hands the socket
   * the whole hold ring at once (22 chunks ≈ 93KB of base64); queueSize then
   * reads far above FRAME_GATE (8_000) until it drains, so screen share went
   * blind for ~2.2s after EVERY barge-in and the congestion trough pinned at 2
   * for ~2s — reporting a link problem that does not exist. This is the same
   * argument sampleCongestion() already makes about the frame sawtooth: our
   * own deliberate bursts are not evidence about the link. Credited out of the
   * frame gate and the trough ONLY; the stall clock still reads the raw queue,
   * because a genuinely dead socket must never be masked.
   */
  private volatile long burstBytes = 0;
  private volatile long burstUntil = 0;
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
  private volatile boolean rotatePending = false; // a goAway is being waited out
  private volatile long rotateBy = 0; // the latest moment that wait may run to
  private volatile long lastVoiceAt = 0; // last input-transcription activity
  private volatile long lastNudgeAt = 0; // last "look at the screen" wake-up
  private volatile long lastFrameAt = 0; // last frame that actually entered the socket
  /** WS-WATCHPERF part 2: device audio, or null for mic-only (the default and
   *  the behaviour of every build before this one). Read by the mic thread,
   *  written by the service's main thread — volatile, and the service always
   *  clears this reference BEFORE releasing the capture. */
  private volatile MediaAudioCapture mediaSource;
  private byte[] mediaBuf; // mic-thread confined
  private byte[] up; // mic-thread confined: the uplink chunk, mic + media
  private volatile long mediaMixedChunks = 0; // trace only
  private volatile long lastActivityAt = 0; // last frame where the screen did anything
  private final long[] wakes = new long[WAKE_CEILING]; // frame-thread confined
  private final boolean[] wakeAmbient = new boolean[WAKE_CEILING];
  private int wakeIdx = 0;
  private volatile long lastShowNudgeAt = 0;
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
    rotates.set(0);
    rotatePending = false;
    firstConnect = true; // a new session picks its model again; a rotation does not
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
    // the mic thread must not read a source the service is about to release;
    // the service also clears it explicitly, and both orders are safe
    mediaSource = null;
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

  /** Attach (or detach, with null) the device-audio source. The service owns
   *  the lifetime; this engine only reads from it, and only at the one seam
   *  in the mic loop marked THE MEDIA MIXER. */
  void setMediaSource(MediaAudioCapture m) {
    mediaSource = m;
    if (m == null) mediaMixedChunks = 0;
  }

  /** How many uplink chunks have actually carried device audio. Trace only —
   *  no decision reads it. */
  long getMediaMixedChunks() {
    return mediaMixedChunks;
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

  /**
   * motion: 0 nothing moved · 1 they're doing something · 2 a new thing.
   *
   * <p>RETURNS WHETHER THE SOCKET TOOK IT (WS-WATCHPERF). It always knew — the
   * `sent` local below has existed as long as the gate has — and it threw the
   * answer away, so {@link WatchCaptureService} credited every refusal as a
   * delivery and stalled the fast beat into the 2.5s keep-alive on exactly the
   * held screens the feature is for. See WatchPacer's header.
   */
  boolean onFrame(String b64Jpeg, int motion) {
    if (!running || !ready || b64Jpeg == null || b64Jpeg.isEmpty()) return false;
    WebSocket s = ws;
    if (s == null) return false;
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
      // The reading is credited for a deliberate release burst still draining
      // (see burstBytes): this gate's job is to keep video out of a socket
      // that is behind on HER audio, and a barge-in burst is audio we have
      // already chosen to send, not a link that cannot keep up. Without the
      // credit every barge-in blinded the screen share for ~2.2s.
      if (s.queueSize() - burstBytes > FRAME_GATE) return false;
      if (b64Jpeg.length() > FRAME_MAX_B64) return false; // pathological encode
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
    if (!sent) return false;
    long now = System.currentTimeMillis();
    lastFrameAt = now;
    if (motion > 0) lastActivityAt = now;
    return true;
  }

  /** The Live API only generates on audio activity — video frames alone never
   *  trigger a turn, so without this she watches a whole session mute. WHEN to
   *  wake her is decided upstream by SceneReader, purely from what the screen
   *  did; this method owns the gates that keep the wake HONEST and the socket
   *  safe, and nothing more. No note ever says what to think — silence answers
   *  every one of them, and her own judgement picks.
   *
   *  Returns whether the wake actually went out, so the caller's budget is
   *  spent only on wakes that happened. */
  boolean nudge(int wake) {
    if (!running || !ready || wake == SceneReader.WAKE_NONE) return false;
    WebSocket s = ws;
    if (s == null) return false;
    long now = System.currentTimeMillis();
    if (speaking) return false;
    // THE grounding invariant: no picture this new, no wake-up. She is never
    // told to look at a screen she was not actually shown — that is the
    // instruction that makes her invent.
    if (lastFrameAt == 0 || now - lastFrameAt > FRAME_FRESH_MS) return false;
    boolean show = SceneReader.isShow(wake);
    // Never cut across them. Ambient keeps the full 3s; a SHOW gets 1200ms,
    // because a show is exactly the case where they spoke and are now waiting,
    // and the old guard burnt three of the four seconds inside which a reply
    // still reads as a reply rather than as reluctance.
    if (now - lastVoiceAt < (show ? SHOW_QUIET_MS : IDLE_QUIET_MS)) return false;
    // Ambient chatter must not spend the budget a deliberate show needs: one
    // ring of 12, but ambient may take only 5 of them. Four minutes of
    // browsing used to drain the ring, and then the one moment that actually
    // mattered was silently rate-limited into nothing.
    if (show) {
      if (now - lastShowNudgeAt < SHOW_FLOOR_MS) return false;
    } else {
      int ambient = 0;
      for (int i = 0; i < WAKE_CEILING; i++) {
        if (wakeAmbient[i] && now - wakes[i] < WAKE_WINDOW_MS) ambient++;
      }
      if (ambient >= AMBIENT_CEILING) return false;
    }
    if (now - wakes[wakeIdx] < WAKE_WINDOW_MS) return false; // hard rate ceiling
    lastNudgeAt = now;
    if (show) lastShowNudgeAt = now;
    wakes[wakeIdx] = now;
    wakeAmbient[wakeIdx] = !show;
    wakeIdx = (wakeIdx + 1) % WAKE_CEILING;
    try {
      JSONObject part = new JSONObject().put("text", noteFor(wake));
      JSONObject turn = new JSONObject().put("role", "user").put("parts", new JSONArray().put(part));
      s.send(
          new JSONObject()
              .put(
                  "clientContent",
                  new JSONObject().put("turns", new JSONArray().put(turn)).put("turnComplete", true))
              .toString());
      return true;
    } catch (Exception ignored) {
      return false;
    }
  }

  /** Which note each class carries. The code says "look now" and what just
   *  happened; it never says what to make of it. settle/reshow/point/switch
   *  currently share the new-thing note — see
   *  scratchpad/screenshare-persona-patch.md for the SHOW/RESHOW/POINT wording
   *  that lands with the persona change, at which point this map is the only
   *  thing that moves. */
  private static String noteFor(int wake) {
    if (wake == SceneReader.WAKE_START) return START_NUDGE;
    if (wake == SceneReader.WAKE_ALONG) return ALONG_NUDGE;
    if (wake == SceneReader.WAKE_IDLE) return IDLE_NUDGE;
    return NEW_NUDGE;
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
    // THE MODEL IS PINNED FOR THE LIFE OF THE SESSION. A rotation mints a fresh
    // token and the token response carries a model with it — but a call that
    // started on one model must not finish on another, because the same voice
    // NAME on a different model is a different voice, which is the whole class
    // of bug scripts/verify-voice.mjs exists for. So the first connect decides
    // and every reconnect after it keeps that decision. Same rule, same reason,
    // in the reconnect() of src/voice/liveCall.ts.
    String offered = (mdl == null || mdl.isEmpty()) ? DEFAULT_MODEL : mdl;
    if (firstConnect) {
      model = offered;
      firstConnect = false;
    } else if (!offered.equals(model)) {
      Log.w(TAG, "live-token offered " + offered + " mid-session; staying on " + model);
    }
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

  /**
   * A goAway has arrived. Do not take it inside one of her sentences.
   *
   * rotate() flushes playback, so rotating the instant the message lands cuts
   * her off mid-word — and the server sends goAway with its OWN notice period
   * (`timeLeft`) precisely so a client does not have to. So the rotation is
   * held until she is not speaking, capped at ROTATE_WAIT_MAX_MS, and never
   * allowed past `timeLeft - ROTATE_GRACE_MS`: a rotation that arrives after
   * the server has already hung up gives back everything the wait bought.
   *
   * Mirrored with `scheduleRotate` in src/voice/liveCall.ts — same constants,
   * same rule, asserted by scripts/verify-voice.mjs §6.
   *
   * @param leftMs the server's own notice period in ms, or 0 when it gave none
   */
  private void scheduleRotate(long leftMs) {
    if (!running || rotatePending) return;
    if (rotates.get() >= MAX_ROTATES) {
      // Budget spent. A goAway storm must not spin the token endpoint; let the
      // close that follows land in retryOrDie() the way it did before.
      Log.w(TAG, "goAway budget spent (" + MAX_ROTATES + ") — not rotating again");
      return;
    }
    rotatePending = true;
    long budget = leftMs > 0 ? Math.max(0, leftMs - ROTATE_GRACE_MS) : ROTATE_WAIT_MAX_MS;
    rotateBy = System.currentTimeMillis() + Math.min(ROTATE_WAIT_MAX_MS, budget);
    main.post(rotateWhenQuiet);
  }

  private final Runnable rotateWhenQuiet =
      new Runnable() {
        @Override
        public void run() {
          if (!running || !rotatePending) return;
          if (speaking && System.currentTimeMillis() < rotateBy) {
            main.postDelayed(this, ROTATE_POLL_MS);
            return;
          }
          rotatePending = false;
          safeExecute(LiveWatchEngine.this::rotate);
        }
      };

  /** goAway: the server is about to hang up — get ahead of it. Budgeted and
   *  paced: an unthrottled goAway storm would burn the token endpoint's
   *  rate limit in seconds. Reached only through scheduleRotate(), which owns
   *  WHEN it happens. */
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
    main.postDelayed(() -> safeExecute(this::connect), ROTATE_DELAY_MS);
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
        new JSONObject().put("prebuiltVoiceConfig", new JSONObject().put("voiceName", "Despina")));
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
        // `timeLeft` is a protobuf Duration rendered as a string ("10s",
        // "4.5s"); strip everything that is not a number so a unit suffix
        // never turns a real notice period into "no notice given".
        long leftMs = 0;
        JSONObject ga = msg.optJSONObject("goAway");
        if (ga != null) {
          String raw = ga.optString("timeLeft", "").replaceAll("[^0-9.]", "");
          try {
            if (!raw.isEmpty()) leftMs = (long) (Double.parseDouble(raw) * 1000d);
          } catch (Exception ignored) {
          }
        }
        scheduleRotate(leftMs);
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
        floorReleasedAt = 0; // the server answered; the watchdog stands down
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
    // EVERY sub-frame while she is audible, linear RMS, indexed by subIdx mod
    // length — the steadiness test reads this, not only the above-bar
    // sub-frames. Sized to the soft window, the longer of the two.
    final double[] subLin = new double[SOFT_CLAIM_WIN_SUBS + 8];
    final double[] span = new double[SOFT_CLAIM_WIN_SUBS + 8];
    final double[] spanSort = new double[SOFT_CLAIM_WIN_SUBS + 8];
    final double[] echoRing = new double[ECHO_WIN_SUBS]; // mic÷her ratios
    final double[] echoSort = new double[ECHO_WIN_SUBS];
    // per-sub-frame prediction and the bars derived from it
    final double[] herAtSub = new double[SUBS];
    final double[] echoAtSub = new double[SUBS];
    final double[] thrBSub = new double[SUBS];
    final double[] thrSSub = new double[SUBS];
    // the echo lock: one row per mic chunk, one column per candidate lag
    final double[] fitMic = new double[ECHO_FIT_WIN];
    final double[][] fitHer = new double[ECHO_FIT_WIN][ECHO_LAGS];
    final double[] echoHold = new double[ECHO_ADMIT_TICKS];
    int echoHoldIdx = 0;
    int fitIdx = 0;
    int fitFill = 0;
    boolean echoLocked = false;
    int echoLag = -1; // -1 = never locked; the prediction falls back to herAt()
    int echoIdx = 0;
    int echoFill = 0;
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
    int ducked = 0; // 0 full volume · 1 soft duck · 2 yielding
    int sockSeen = -1; // which socket generation this arbitration state belongs to
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
      // A REPLACED socket must not inherit the old one's arbitration state:
      // the hold ring is audio for a session that no longer exists, and
      // floorLost/hardCount/κ describe a conversation that has ended. Only the
      // queue-side half of this was being reset. resetIfNewSocket() is called
      // FIRST in the tick now, so the mic-confined half is cleared before
      // anything reads it.
      resetIfNewSocket();
      if (sockSeen != wsGen.get()) {
        sockSeen = wsGen.get();
        hardCount = 0;
        hardHead = 0;
        softCount = 0;
        softHead = 0;
        holdHead = 0;
        holdCount = 0;
        claimPeak = 0;
        subIdx = 0;
        Arrays.fill(subLin, 0);
        kappa = ECHO_KAPPA_SEED;
        echoFill = 0;
        echoIdx = 0;
        fitFill = 0;
        fitIdx = 0;
        echoLocked = false;
        echoLag = -1;
        Arrays.fill(echoHold, 0);
        floorLost = false;
        floorClaimSince = 0;
        floorReleasedAt = 0;
        gatedRun = 0;
        prevChunk = null;
      }
      // WHETHER SHE IS ACTUALLY AUDIBLE, from the playback head — not from
      // `muted`.
      //
      // `muted` is the service's half-duplex switch, and it is held for
      // DRAIN_GRACE_MS (1500ms, before setSpeaking(false) is even called) plus
      // a 350ms unmute tail after her audio has genuinely stopped. Using it as
      // "she has the floor" meant the arbiter went on HOLDING for ~1850ms into
      // the silence after every one of her turns — and a held candidate that
      // then goes quiet for 4 chunks is DROPPED, so a short reply landing in
      // that window ("haan", "theek hai") was deleted and never reached the
      // server at all. The floor arbiter now does the half-duplex job itself,
      // on the real signal: audio she has been given that the speaker has not
      // yet played. `muted` remains only as the fallback for a device where
      // the head counter is unreadable.
      final long head = playHead();
      // `|| !playQueue.isEmpty()` closes the enqueue-to-write gap: audio that
      // has arrived from the server but that the play thread has not handed to
      // the track yet is still hers and still about to be audible. Without it
      // the uplink would be open for up to one poll interval (120ms) at the
      // very start of each of her turns, which `muted` used to cover.
      final boolean herAudible =
          head < 0 ? muted : (head < herWritten || !playQueue.isEmpty());
      if (!herAudible && holdCount > 0) {
        // Her turn is over: a still-live hold is RELEASED here, not dropped.
        // The most common overlap in any conversation is the turn transition —
        // someone starting on her last word — and there is nothing left to
        // protect at that point. A dead candidate was already cleared
        // mid-turn, so the ring is only non-empty here if they are still
        // talking; this saves the leading syllables of the most frequent
        // overlap in the product and costs nothing.
        WebSocket sf = ws;
        if (ready && sf != null) {
          for (int i = 0; i < holdCount; i++) {
            int k = (holdHead + i) % HOLD_RING;
            if (hold[k] == null) continue;
            try {
              sf.send(
                  "{\"realtimeInput\":{\"audio\":{\"data\":\""
                      + Base64.encodeToString(hold[k], 0, holdLen[k], Base64.NO_WRAP)
                      + "\",\"mimeType\":\"audio/pcm;rate=16000\"}}}");
            } catch (Exception ignored) {
            }
          }
        }
      }
      if (!herAudible && (floorLost || hardCount > 0 || softCount > 0 || holdCount > 0)) {
        floorLost = false;
        floorClaimSince = 0;
        floorReleasedAt = 0;
        hardCount = 0;
        hardHead = 0;
        softCount = 0;
        softHead = 0;
        holdHead = 0;
        holdCount = 0;
        claimPeak = 0;
        if (ducked != 0) restoreVol();
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
      final double thrL =
          Math.min(
              LISTEN_ABS_MAX,
              Math.max(
                  floor * LISTEN_RATIO_MIN,
                  Math.min(Math.max(floor * LISTEN_MULT, LISTEN_MIN), LISTEN_MAX)));
      // herAt() is a MAX over a window around the playback head, taken that way
      // so the bar could bound a peak without measuring the acoustic round
      // trip. Once the lock has measured it, predict the echo instead: her own
      // envelope at that lag, decayed across the reverb tail. See herTailPower.
      final double herMax = herAt(head) * trackVol;
      final long lagFrames =
          echoLag >= 0 ? (long) OUT_RATE * echoLag * ECHO_LAG_STEP_MS / 1000 : 0;
      final long subFrames = OUT_RATE * 20 / 1000;
      double herNow = 0;
      double echoTerm = 0;
      for (int s = 0; s < SUBS; s++) {
        if (echoLag < 0) {
          herAtSub[s] = herMax;
        } else {
          // this mic chunk covers the SUBS*20ms ending at `head`
          final long f = head - lagFrames - subFrames * (SUBS - 1 - s);
          herAtSub[s] = Math.sqrt(herTailPower(f)) * trackVol;
        }
        echoAtSub[s] = kappa * herAtSub[s] * ECHO_MARGIN;
        if (herAtSub[s] > herNow) herNow = herAtSub[s];
        if (echoAtSub[s] > echoTerm) echoTerm = echoAtSub[s];
        thrBSub[s] =
            Math.min(
                BARGE_MAX,
                Math.max(Math.max(thrL * BARGE_OVER_LISTEN, floor * BARGE_MULT), echoAtSub[s]));
      }
      // Whether anything at all in this chunk out-shouts her leak is a
      // different question from whether it is clearing the bar RIGHT NOW, and
      // it has a whole turn to be answered rather than one sub-frame. It gets
      // the conservative estimate — her recent PEAK leak, not the prediction —
      // because its failure mode is her own voice ending up in the hold ring
      // and being flushed at the server as the user's turn. Measured: with the
      // prediction alone that leak was 1792ms per call at −6 dB; with the peak
      // it is 938ms, and barge-in is unchanged.
      // The peak is held over the PREDICTION, never over kappa * herMax: κ is
      // measured against the prediction, so pairing it with the windowed max
      // multiplies the same headroom in twice and the bar lands ~3 dB high.
      echoHold[echoHoldIdx] = echoTerm;
      echoHoldIdx = (echoHoldIdx + 1) % ECHO_ADMIT_TICKS;
      double admitEcho = 0;
      for (int i = 0; i < ECHO_ADMIT_TICKS; i++) if (echoHold[i] > admitEcho) admitEcho = echoHold[i];
      // No echo term: with it, min(thrB, max(…, echoTerm)) is exactly thrB
      // whenever echo binds thrB, and the valve collapses onto the bar it is
      // supposed to sit below. The min() stays only as a sanity rail — with
      // SOFT_OVER_LISTEN < BARGE_OVER_LISTEN and SOFT_MULT < BARGE_MULT it can
      // bind only when BARGE_MAX clamps thrB.
      final double softBar = Math.max(thrL * SOFT_OVER_LISTEN, floor * SOFT_MULT);
      for (int s = 0; s < SUBS; s++) thrSSub[s] = Math.min(thrBSub[s], softBar);
      if (rms > thrL) gateLeft = 3; // ~300ms hangover
      else if (gateLeft > 0) gateLeft--;
      gated = gateLeft <= 0;
      opened = !gated && !wasOpen;
      wasOpen = !gated;
      // Measure the coupling from ground truth rather than trusting an AEC
      // that this capture path may not even have. Every sub-frame she is
      // audible for contributes one ratio sample; κ then decays toward the
      // 90th percentile of those, which must bound the peaks of the
      // room. κ then DECAYS toward that and never rises — see ECHO_KAPPA_SEED
      // for why the direction is forced.
      if (herAudible && herMax > 600) {
        // The ratio is taken against the SAME prediction the bar is built on,
        // so κ and the bar stay in one another's units whichever branch is live.
        for (int s2 = 0; s2 < SUBS; s2++) {
          // measure only where the PREDICTION is trustworthy: her loud moments
          if (herAtSub[s2] <= 600 || herAtSub[s2] < herMax * ECHO_MEASURE_FRAC) continue;
          // subtract ambience in POWER: the mic sums uncorrelated sources
          double excess = Math.sqrt(Math.max(0, sub[s2] * sub[s2] - floor * floor));
          echoRing[echoIdx] = excess / herAtSub[s2];
          echoIdx = (echoIdx + 1) % ECHO_WIN_SUBS;
          if (echoFill < ECHO_WIN_SUBS) echoFill++;
        }
        // THE LOCK. One (her power at lag L, mic power) pair per mic chunk;
        // a good affine fit across the window means this stretch of microphone
        // audio IS her, at that lag — the only evidence that lets κ move UP.
        {
          final long win = (long) OUT_RATE * SUBS * 20 / 1000;
          for (int L = 0; L < ECHO_LAGS; L++) {
            fitHer[fitIdx][L] =
                herMeanPower(head - (long) OUT_RATE * L * ECHO_LAG_STEP_MS / 1000, win);
          }
          fitMic[fitIdx] = Math.max(0, rms * rms - floor * floor);
          fitIdx = (fitIdx + 1) % ECHO_FIT_WIN;
          if (fitFill < ECHO_FIT_WIN) fitFill++;
          echoLocked = false;
          if (fitFill == ECHO_FIT_WIN) {
            double my = 0;
            for (int i = 0; i < ECHO_FIT_WIN; i++) my += fitMic[i];
            my /= ECHO_FIT_WIN;
            double syy = 0;
            for (int i = 0; i < ECHO_FIT_WIN; i++) syy += (fitMic[i] - my) * (fitMic[i] - my);
            if (syy > 0) {
              double bestR2 = 0;
              int bestL = -1;
              for (int L = 0; L < ECHO_LAGS; L++) {
                double mx = 0;
                for (int i = 0; i < ECHO_FIT_WIN; i++) mx += fitHer[i][L];
                mx /= ECHO_FIT_WIN;
                double sxx = 0;
                double sxy = 0;
                for (int i = 0; i < ECHO_FIT_WIN; i++) {
                  final double dx = fitHer[i][L] - mx;
                  sxx += dx * dx;
                  sxy += dx * (fitMic[i] - my);
                }
                // sxy > 0 as well as r²: a NEGATIVE slope fits just as tightly
                // and means the opposite of what we are looking for.
                if (sxx <= 0 || sxy <= 0) continue;
                final double r2 = (sxy * sxy) / (sxx * syy);
                if (r2 > bestR2) {
                  bestR2 = r2;
                  bestL = L;
                }
              }
              if (bestL >= 0 && bestR2 >= ECHO_FIT_R2) {
                echoLocked = true;
                // The round trip belongs to the device and the room, not to
                // this second: keep the last lag actually earned, so the
                // prediction survives windows where the fit is inconclusive.
                echoLag = bestL;
              }
            }
          }
        }
        if (echoFill >= ECHO_MIN_SAMPLES) {
          System.arraycopy(echoRing, 0, echoSort, 0, echoFill);
          Arrays.sort(echoSort, 0, echoFill);
          double leak = echoSort[Math.min(echoFill - 1, (int) (echoFill * ECHO_PCT))];
          // DOWN is unconditional: a ratio below κ can only mean the device
          // leaks less than we feared, whoever else is in the room.
          if (leak < kappa) kappa = Math.max(ECHO_KAPPA_MIN, kappa - ECHO_RATE * (kappa - leak));
          // UP only on a locked fit. A ratio above κ is not, on its own,
          // evidence of a leakier device — a person raises every percentile of
          // it. It becomes evidence once we can also show this window's mic
          // audio is an affine function of her own output at a fixed lag,
          // which a person cannot make true.
          else if (echoLocked) {
            kappa = Math.min(ECHO_KAPPA_MAX, kappa + ECHO_UP_RATE * (leak - kappa));
          }
        }
      } else if (!herAudible && (echoFill != 0 || fitFill != 0)) {
        echoFill = 0; // her turn is over; the next one measures itself
        echoIdx = 0;
        fitFill = 0; // and a gap in her audio is not a fit, it is a jump
        fitIdx = 0;
        echoLocked = false;
      }
      if (holding) {
        for (int s = 0; s < SUBS; s++) {
          subIdx++;
          // EVERY sub-frame goes in the deviation ring, above the bar or not.
          // Selecting on "above thrB" is a left-truncated sample: it discards
          // precisely the inter-syllable dips that MAKE speech look like
          // speech, leaving the top of the envelope, which is flat for
          // anybody. A marginal talker measured that way lands at σ ≈ 2.1-2.4
          // dB against a 2.0 dB bar and is refused as a machine.
          subLin[(int) Math.floorMod(subIdx, (long) subLin.length)] = sub[s];
          if (sub[s] > thrBSub[s]) {
            int w = (hardHead + hardCount) % hardHits.length;
            hardHits[w] = subIdx;
            if (hardCount < hardHits.length) hardCount++;
            else hardHead = (hardHead + 1) % hardHits.length;
          }
          // a soft hit must also out-shout her own leak, at this instant
          if (sub[s] > thrSSub[s] && sub[s] > echoAtSub[s]) {
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
        // THE CANDIDATE'S OWN SPAN: from its oldest surviving hit to now.
        // Sub-frames BEFORE it are room silence that is no part of the
        // candidate and would inflate the deviation into an automatic pass.
        long firstHit = 0;
        if (hardCount > 0 && softCount > 0) {
          firstHit = Math.min(hardHits[hardHead], softHits[softHead]);
        } else if (hardCount > 0) {
          firstHit = hardHits[hardHead];
        } else if (softCount > 0) {
          firstHit = softHits[softHead];
        }
        int spanN = 0;
        claimPeak = 0;
        if (firstHit > 0) {
          spanN = (int) Math.min(subIdx - firstHit + 1, subLin.length);
          for (int i = 0; i < spanN; i++) {
            double v = subLin[(int) Math.floorMod(subIdx - i, (long) subLin.length)];
            span[i] = v;
            if (v > claimPeak) claimPeak = v;
          }
        }
        if (hardCount > 0 && floorClaimSince == 0) floorClaimSince = System.currentTimeMillis();
        // THE DUCK. She softens the moment something is plainly a voice, long
        // before it has earned anything — the hitch a person produces on
        // contact, and fully reversible.
        if (ducked == 0 && hardCount >= DUCK_SUBS) {
          setVolAsync(DUCK_SOFT);
          ducked = 1;
        } else if (ducked == 1 && hardCount < DUCK_SUBS / 2) {
          restoreVol(); // it was nothing — bring her back up NOW
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
          if (spanN >= 6) {
            // Ambience for the override. The trailing 3s percentile has not
            // seen a machine that started less than 3s ago — which is the
            // entire window in which this veto matters — so the comparison is
            // made against the LOUDER of that percentile and the candidate's
            // own median, which a steady source raises on its first half
            // second. Against the stale floor alone, a fan clears +24 dB
            // trivially and switches the veto off for exactly the stimulus it
            // exists to catch.
            System.arraycopy(span, 0, spanSort, 0, spanN);
            Arrays.sort(spanSort, 0, spanN);
            double ambient = Math.max(floor, spanSort[spanN / 2]);
            if (claimPeak < ambient * STEADY_OVERRIDE_MULT) {
              double m = 0;
              for (int i = 0; i < spanN; i++) m += 20 * Math.log10(Math.max(span[i], 1));
              m /= spanN;
              double v2 = 0;
              for (int i = 0; i < spanN; i++) {
                double d = 20 * Math.log10(Math.max(span[i], 1)) - m;
                v2 += d * d;
              }
              varied = Math.sqrt(v2 / spanN) >= STEADY_DB;
            }
          }
          // Her own leak must not walk through the soft bar now that the bar
          // no longer rises with echo. The candidate's SUSTAINED level has to
          // clear the leak estimate: a second source adds power on top of the
          // leak, while pure echo sits at it. A HARD claim clears this for
          // free (thrB ≥ echoTerm), so it bites only on soft-only claims.
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
      boolean drop = true;
      if (canSend) {
        // Retire the release-burst credit as the socket actually drains it: it
        // can never exceed what is really queued, and it expires on a wall
        // clock regardless. The trough sees the credited value; the stall
        // clock below deliberately does not.
        if (burstBytes != 0) {
          if (SystemClock.elapsedRealtime() > burstUntil) burstBytes = 0;
          else if (queued < burstBytes) burstBytes = queued;
        }
        sampleCongestion(Math.max(0, queued - burstBytes));
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
          // Credit exactly what this burst added, for exactly as long as it
          // takes to drain: it is audio we chose to send, not a slow link.
          try {
            burstBytes = Math.max(0, s.queueSize() - queued);
            burstUntil = SystemClock.elapsedRealtime() + 2500;
          } catch (Exception ignored) {
          }
        }
        holdHead = 0;
        holdCount = 0;
        floorLost = true;
        floorReleasedAt = SystemClock.elapsedRealtime();
        setVolAsync(DUCK_CLAIM);
        ducked = 2;
      } else if (holding) {
        // HOLD. Real audio into the ring, digital silence onto the wire —
        // which is what the server already receives for most of every call, so
        // its VAD state and its silence clock see nothing unusual. If the
        // sound dies out before it earns anything (a "haan", a door, a car
        // going past), the ring is dropped and she never knows it happened.
        // Only audio that OUT-SHOUTS her own leak may enter the ring. The gate
        // (thrL) carries no echo term, so on a leaky device the ring fills
        // with her own voice — and the ring has two exits, the burst release
        // AND the turn-end flush. The flush is unconditional by design (the
        // turn transition is the most common overlap there is), so without
        // this test her own echo is handed to the server as the user's turn at
        // the end of every turn she speaks. Observed on the real endpoint at
        // −12 dB echo return loss in 5 of 6 sessions, no barge-in involved.
        boolean aboveEcho = false;
        for (int s2 = 0; s2 < SUBS; s2++) if (sub[s2] > admitEcho) aboveEcho = true;
        if (!gated && aboveEcho) {
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
      // ── THE MEDIA MIXER, AND THE ONLY PLACE IT IS ALLOWED TO BE ────────
      // Everything above this line has already been decided, and every one of
      // those decisions read `buf`, which is the MICROPHONE and nothing else:
      // sub[] and rms, the ambience floor, thrL/thrB/thrS, the echo estimate
      // κ and its lag lock, `gated`, `opened`, `claim`, the hold-ring
      // admission test. The mixer writes to `up`, a different array, and it
      // runs after all of them. Device audio therefore cannot raise a level,
      // cannot open the gate, cannot fill the hold ring and cannot fire a
      // barge-in — not because a threshold was tuned to ignore it, but
      // because no code that makes those decisions can see it.
      //
      // And it mixes ONLY into a chunk the gate has already opened for HIS
      // VOICE. On a gated tick the wire still carries the same digital
      // silence it carries today. That is what keeps the SERVER's automatic
      // VAD out of this: media audio can never start a turn, because it is
      // only ever present inside a turn the microphone already started.
      // This lane's own history is the evidence that the weaker version does
      // not work — `startSensitivity: HIGH made every reel sound and breath
      // cut her off mid-word` is in the setup block above, about reel audio
      // arriving ACOUSTICALLY. Streaming it digitally and continuously would
      // be that failure with the volume turned up.
      //
      // The cost of that choice, stated: she hears what is playing while he
      // is talking over it, not continuously. Making it continuous requires
      // manual activity detection (`automaticActivityDetection.disabled` plus
      // client activityStart/activityEnd) so that the turn clock stops being
      // a function of the audio — the client already computes every signal
      // that needs, but it moves the turn boundary off the server and cannot
      // be measured anywhere but on a device. Not done here on purpose.
      byte[] wire = buf;
      int wireLen = n;
      MediaAudioCapture mc = mediaSource;
      if (mc != null && !gated && !holding && canSend && !drop) {
        if (mediaBuf == null || mediaBuf.length < buf.length) mediaBuf = new byte[buf.length];
        if (up == null || up.length < buf.length) up = new byte[buf.length];
        int mn = mc.take(mediaBuf, n);
        if (mn > 0) {
          PcmMix.mix(buf, n, mediaBuf, mn, PcmMix.DUCK_GAIN, up);
          wire = up;
          mediaMixedChunks++;
        }
      }
      if (canSend && !drop) {
        try {
          s.send(
              "{\"realtimeInput\":{\"audio\":{\"data\":\""
                  + Base64.encodeToString(wire, 0, wireLen, Base64.NO_WRAP)
                  + "\",\"mimeType\":\"audio/pcm;rate=16000\"}}}");
        } catch (Exception ignored) {
        }
      }
      // The server owes us an `interrupted` once a real claim is released. On
      // this model there is an acknowledged case where it never sends one, and
      // that single message is otherwise the only thing here that can stop
      // her. The client made the floor decision, so the client enforces it.
      // floorReleasedAt is a FIELD, not a local: the WS reader thread clears it
      // the moment the server answers with `interrupted`, which is the
      // stand-down the web lane has always had. Without it a SUCCESSFUL
      // barge-in still tripped this 1.5s later and cut off the reply she had
      // already begun.
      final long rel = floorReleasedAt;
      if (rel != 0 && SystemClock.elapsedRealtime() - rel > RELEASE_WATCHDOG_MS && speaking) {
        floorReleasedAt = 0;
        yieldFloor(true);
      }
    }
  }

  /**
   * Where the speaker actually is, in the same frame clock the play thread
   * stamps chunks with. −1 when there is no usable track.
   *
   * getPlaybackHeadPosition() is a read of a native counter and is safe from
   * any thread; the mic thread never touches the track's state.
   */
  private long playHead() {
    AudioTrack t = track;
    if (t == null) return -1;
    try {
      return t.getPlaybackHeadPosition() & 0xFFFFFFFFL;
    } catch (Exception e) {
      return -1;
    }
  }

  /**
   * How loud the audio the speaker is emitting RIGHT NOW is, in Int16 units,
   * or 0 if it is emitting nothing. The mic thread's only honest reference for
   * telling her own leak apart from a person.
   *
   * A small window either side of the head absorbs the device's acoustic round
   * trip and the ~100ms mic chunk: a sub-frame captured now heard audio the
   * speaker emitted a few tens of ms ago, so the MAX across the chunk-sized
   * neighbourhood of the head is taken rather than the single chunk under it.
   */
  private double herAt(long head) {
    if (head < 0) return 0;
    final int gen = flushGen.get();
    final long lo = head - HER_LOOKBACK_FRAMES;
    final long hi = head + HER_LOOKAHEAD_FRAMES;
    double m = 0;
    for (int i = 0; i < HER_RING; i++) {
      if (herGen[i] != gen) continue;
      if (herTo[i] <= lo || herFrom[i] >= hi) continue;
      if (herLvl[i] > m) m = herLvl[i];
    }
    return m;
  }

  /**
   * What her own voice is still expected to measure at the microphone at track
   * frame {@code at}: the loudest 20ms she played before it, each one decayed
   * by how long ago it was.
   *
   * A flat peak-hold over the tail is just herAt() again — her syllables are
   * close enough together that the recent peak IS the local peak, and it was
   * measured as exactly neutral. The decay is the point: a syllable 100ms back
   * is still arriving, but 10 dB down, so the bar follows her envelope into
   * her own pauses instead of sitting at her loudest word through all of them.
   * That is where people start talking, and it is what keeps barge-in at 8/8
   * while κ is allowed to rise.
   */
  private double herTailPower(long at) {
    if (at < 0) return 0;
    final int gen = flushGen.get();
    final long span = (long) OUT_RATE * ECHO_TAIL_MS / 1000;
    final long blk = OUT_RATE * 20 / 1000;
    double m = 0;
    for (int i = 0; i < HER_ENV_RING; i++) {
      if (herEnvGen[i] != gen) continue;
      final long e = herEnvTo[i];
      final long age = at - e;
      if (age < 0 || age >= span) continue;
      final int k = (int) (age / blk);
      if (k >= ECHO_TAIL_DECAY.length) continue;
      final double d = herEnvP[i] * ECHO_TAIL_DECAY[k];
      if (d > m) m = d;
    }
    return m;
  }

  /** Her MEAN output power over {@code win} frames ending at {@code at}. */
  private double herMeanPower(long at, long win) {
    if (at < 0) return 0;
    final int gen = flushGen.get();
    double acc = 0;
    int n = 0;
    for (int i = 0; i < HER_ENV_RING; i++) {
      if (herEnvGen[i] != gen) continue;
      final long e = herEnvTo[i];
      if (e > at || e <= at - win) continue;
      acc += herEnvP[i];
      n++;
    }
    return n > 0 ? acc / n : 0;
  }

  /**
   * The mic thread's route to the volume. EVERY volume write now happens on
   * the main thread, which is also where fadeStep() runs — so a duck and a
   * dissolve are serialised by the looper instead of racing.
   *
   * They used to race through a check-then-act on a plain volatile: the mic
   * thread read fadeActive == 0, a dissolve started on the main thread, and
   * the mic thread's setVol(1f) then landed on top of it and snapped her back
   * to FULL volume in the middle of the fade — the exact "she snaps back mid
   * dissolve" symptom. The check and the write are now one main-thread action.
   */
  private void setVolAsync(float v) {
    main.post(() -> setVol(v));
  }

  /** Back to full, unless a dissolve owns the gain. Runs on main, so the
   *  fadeActive test and the write cannot be split by one starting. */
  private void restoreVol() {
    main.post(
        () -> {
          if (fadeActive == 0) setVol(1f);
        });
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
    // Called from the mic thread (the watchdog) and the WS reader. The whole
    // dissolve — including its first step — runs on main, so it is ordered
    // against every other volume write rather than racing the duck.
    main.post(
        () -> {
          final int gen = yieldGen.incrementAndGet();
          fadeActive = gen;
          fadeStep(
              gen,
              1,
              hard ? YIELD_HARD_STEPS : YIELD_STEPS,
              hard ? YIELD_HARD_STEP_MS : YIELD_STEP_MS,
              trackVol);
        });
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
        herWritten = 0; // and nothing older than the flush is still audible
      }
      if (chunk != null && chunk.length > 0) {
        quietSince = 0;
        // Publish how loud she is AGAINST THE FRAME RANGE THIS CHUNK WILL
        // OCCUPY, not against the wall clock at which it is written. A write
        // to a MODE_STREAM track only enqueues; what the speaker emits — and
        // therefore what the mic hears — is whatever the playback head is on.
        // Her level is the LOUDEST 20ms BLOCK of this chunk, not its overall
        // RMS. The echo term bounds a 20ms MIC sub-frame, and a chunk-wide
        // RMS is a different statistic: speech crest over 20ms against an
        // 80ms average is routinely 2-3x, so a bar built from the average
        // sits BELOW the echo it must reject and her own voice clears it —
        // measured, on the real endpoint, as her taking the floor from
        // herself in every session at -12 dB echo return loss. Same time
        // resolution on both sides, or the comparison means nothing.
        final int frames = chunk.length / 2;
        final int blk = OUT_RATE * 20 / 1000; // 480 frames = 20ms at 24k
        double peak20 = 0;
        double acc = 0;
        int envN = 0;
        for (int f = 0; f + blk <= frames; f += blk) {
          double a2 = 0;
          for (int i = f; i < f + blk; i++) {
            int v = (chunk[i * 2 + 1] << 8) | (chunk[i * 2] & 0xFF);
            a2 += (double) v * v;
          }
          acc += a2;
          double r20 = Math.sqrt(a2 / blk);
          if (r20 > peak20) peak20 = r20;
          // the echo fit's regressor — free, this loop is already walking them
          if (envN < envScratch.length) envScratch[envN++] = a2 / blk;
        }
        if (peak20 == 0) {
          for (int i = 0; i + 1 < chunk.length; i += 2) {
            int v = (chunk[i + 1] << 8) | (chunk[i] & 0xFF);
            acc += (double) v * v;
          }
          peak20 = Math.sqrt(acc / Math.max(1, frames)); // sub-20ms chunk
        }
        final double chunkRms = peak20;
        final long chunkFrom = queued;
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
          // Record the frame range this chunk actually occupies, so the mic
          // thread can ask "what is the speaker emitting right now?" instead
          // of "what did we hand the track ~400ms ago?".
          if (off > 0) {
            int slot = Math.floorMod(herWrite, HER_RING);
            herFrom[slot] = chunkFrom;
            herTo[slot] = queued;
            herLvl[slot] = chunkRms;
            herGen[slot] = g;
            herWrite = herWrite + 1;
            herWritten = queued;
            // ...and the same audio at 20ms, but only the blocks that really
            // made it into the track: a block published for audio the write
            // dropped would have the arbiter protecting silence.
            for (int e = 0; e < envN; e++) {
              final long to = chunkFrom + (long) (e + 1) * blk;
              if (to > queued) break;
              int es = Math.floorMod(herEnvWrite, HER_ENV_RING);
              herEnvTo[es] = to;
              herEnvP[es] = envScratch[e];
              herEnvGen[es] = g;
              herEnvWrite = herEnvWrite + 1;
            }
          }
        } else {
          lastGen = flushGen.get();
          queued = 0; // flushed mid-write; the buffer is empty again
          herWritten = 0;
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
            herWritten = 0;
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
