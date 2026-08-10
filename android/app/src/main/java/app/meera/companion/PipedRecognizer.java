package app.meera.companion;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Log;

import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Arrays;

/**
 * Beep-free, always-hot speech recognition (API 33+): WE own the microphone
 * (one AudioRecord that never stops) and pipe PCM into SpeechRecognizer via
 * EXTRA_AUDIO_SOURCE with a segmented session. Because the recognition
 * service never opens the mic itself, the system earcons ("tun tun") are
 * never played, there are no dead-mic restart windows, and the mic stays
 * live even while our own TTS speaks (full duplex — echo is filtered by the
 * text layer). setMuted(true) writes silence instead of stopping capture,
 * so half-duplex consumers (watch mode) can gate cheaply.
 *
 * On-device recognizer only: the cloud recognizer may silently ignore the
 * pipe and open the real microphone — which both beeps AND fights our
 * AudioRecord for the hardware. Callers must check supported() and keep
 * their legacy restart-loop as the fallback rung.
 */
class PipedRecognizer {
  private static final String TAG = "MeeraPipedSR";
  private static final int RATE = 16000;

  interface Callbacks {
    void onPartial(String cumulativeText);

    void onSegment(String text);

    /** fatal=true → this device/session can't run the piped path; fall back. */
    void onDown(boolean fatal);
  }

  private final Context ctx;
  private final Callbacks cb;
  private final Handler main = new Handler(Looper.getMainLooper());

  private volatile boolean running = false;
  private volatile boolean muted = false;
  private volatile OutputStream sink; // pump target — swapped per session
  private AudioRecord record;
  private Thread pump;
  private SpeechRecognizer recognizer;
  private ParcelFileDescriptor[] pipe;
  private int restartStreak = 0;

  PipedRecognizer(Context ctx, Callbacks cb) {
    this.ctx = ctx;
    this.cb = cb;
  }

  static boolean supported(Context ctx) {
    return Build.VERSION.SDK_INT >= 33
        && SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx);
  }

  @SuppressLint("MissingPermission")
  void start() {
    if (running || Build.VERSION.SDK_INT < 33) return;
    running = true;
    int minBuf =
        AudioRecord.getMinBufferSize(
            RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
    try {
      record =
          new AudioRecord(
              MediaRecorder.AudioSource.VOICE_RECOGNITION,
              RATE,
              AudioFormat.CHANNEL_IN_MONO,
              AudioFormat.ENCODING_PCM_16BIT,
              Math.max(minBuf * 2, 8192));
      record.startRecording();
    } catch (Exception e) {
      Log.w(TAG, "AudioRecord failed", e);
      running = false;
      cb.onDown(true);
      return;
    }
    pump =
        new Thread(
            () -> {
              byte[] buf = new byte[3200]; // 100ms @ 16k mono 16-bit
              while (running) {
                int n = record.read(buf, 0, buf.length);
                if (n <= 0) continue;
                if (muted) Arrays.fill(buf, 0, n, (byte) 0);
                OutputStream out = sink;
                if (out != null) {
                  try {
                    out.write(buf, 0, n);
                  } catch (Exception ignored) {
                    // pipe swapped or closed mid-write — next loop uses the new one
                  }
                }
              }
            },
            "meera-mic-pump");
    pump.setPriority(Thread.MAX_PRIORITY);
    pump.start();
    main.post(this::startSession);
  }

  void stop() {
    running = false;
    main.post(
        () -> {
          if (recognizer != null) {
            try {
              recognizer.destroy();
            } catch (Exception ignored) {}
            recognizer = null;
          }
        });
    closeSink();
    if (record != null) {
      try {
        record.stop();
        record.release();
      } catch (Exception ignored) {}
      record = null;
    }
  }

  void setMuted(boolean m) {
    muted = m;
  }

  private void closeSink() {
    OutputStream out = sink;
    sink = null;
    if (out != null) {
      try {
        out.close(); // EOF → recognizer finalizes cleanly
      } catch (Exception ignored) {}
    }
    if (pipe != null) {
      try {
        pipe[0].close();
      } catch (Exception ignored) {}
      pipe = null;
    }
  }

  /** One recognizer session over a fresh pipe. Main thread only. */
  @SuppressLint("NewApi")
  private void startSession() {
    if (!running) return;
    try {
      closeSink();
      pipe = ParcelFileDescriptor.createPipe();
      sink = new ParcelFileDescriptor.AutoCloseOutputStream(pipe[1]);
      if (recognizer != null) recognizer.destroy();
      recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(ctx);
      Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
      intent.putExtra(
          RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
      intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN");
      intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
      intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, pipe[0]);
      intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1);
      intent.putExtra(
          RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT);
      intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, RATE);
      intent.putExtra(
          RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE);
      recognizer.setRecognitionListener(
          new RecognitionListener() {
            @Override
            public void onPartialResults(Bundle b) {
              String t = first(b);
              if (t != null && !t.isEmpty()) {
                restartStreak = 0;
                cb.onPartial(t);
              }
            }

            @Override
            public void onSegmentResults(Bundle b) {
              String t = first(b);
              if (t != null && !t.isEmpty()) {
                restartStreak = 0;
                cb.onSegment(t);
              }
            }

            @Override
            public void onEndOfSegmentedSession() {
              restartSoon(150); // watchdog: session over — fresh pipe, no beep
            }

            @Override
            public void onResults(Bundle b) {
              // segmented+piped mode delivers via onSegmentResults; a final
              // here means the session closed — treat like end-of-session
              String t = first(b);
              if (t != null && !t.isEmpty()) cb.onSegment(t);
              restartSoon(150);
            }

            @Override
            public void onError(int error) {
              if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS
                  || error == 12 // ERROR_LANGUAGE_NOT_SUPPORTED
                  || error == 13 /* ERROR_LANGUAGE_UNAVAILABLE */) {
                running = false;
                cb.onDown(true); // caller falls back to the legacy mic path
                return;
              }
              restartStreak++;
              if (restartStreak > 10) {
                running = false;
                cb.onDown(true);
                return;
              }
              // NO_MATCH etc are normal on silence-heavy piped audio
              restartSoon(error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ? 800 : 200);
            }

            @Override public void onReadyForSpeech(Bundle params) {}
            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float rmsdB) {}
            @Override public void onBufferReceived(byte[] buffer) {}
            @Override public void onEndOfSpeech() {}
            @Override public void onEvent(int eventType, Bundle params) {}
          });
      recognizer.startListening(intent);
      // fire-and-forget: make sure the en-IN on-device pack stays installed
      maybeTriggerDownload(intent);
    } catch (Exception e) {
      Log.w(TAG, "piped session failed", e);
      restartStreak++;
      if (restartStreak > 6) {
        running = false;
        cb.onDown(true);
        return;
      }
      restartSoon(1000);
    }
  }

  private void restartSoon(long delayMs) {
    if (!running) return;
    main.postDelayed(this::startSession, delayMs);
  }

  @SuppressLint("NewApi")
  private void maybeTriggerDownload(Intent intent) {
    try {
      if (Build.VERSION.SDK_INT >= 33 && recognizer != null) {
        recognizer.triggerModelDownload(intent);
      }
    } catch (Exception ignored) {}
  }

  private static String first(Bundle b) {
    if (b == null) return null;
    ArrayList<String> l = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
    return l != null && !l.isEmpty() ? l.get(0) : null;
  }
}
