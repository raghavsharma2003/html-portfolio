// Voice layer, in priority order:
//
//  1. Sarvam bulbul (user key) — best native Hinglish accent.
//  2. ElevenLabs v3 (user key) — emotion champion, audio tags.
//  3. Meera voice (hosted, zero-config) — Gemini expressive TTS through our
//     serverless proxy; supports the same [laughs]/[whispers] audio tags, so
//     every fresh install gets a human voice with no key at all.
//  4. Device TTS — last resort, humanized as far as a device voice can go:
//     phrase chunking with breath pauses, "…" as real silence, pace jitter.
//
// STT: native Android SpeechRecognition (WebView has none), web SR fallback.

import { Capacitor, registerPlugin } from "@capacitor/core";
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { SpeechRecognition as NativeSR } from "@capgo/capacitor-speech-recognition";
import { attachAnalyser } from "./level";

const isNative = Capacitor.isNativePlatform();

/* ── beep-free continuous mic (Android 13+): the native CallMic plugin owns
   the microphone and pipes PCM straight into the recognizer. The system
   earcons ("tun tun") only play when Google's service opens the mic itself —
   with the pipe they never fire. One session spans the whole call: no
   restart gaps, and the mic stays hot even while she speaks. ── */
interface CallMicNative {
  available(): Promise<{ supported: boolean; micGranted: boolean }>;
  start(): Promise<void>;
  setMuted(o: { muted: boolean }): Promise<void>;
  stop(): Promise<void>;
  addListener(ev: "micpartial", cb: (d: { text: string }) => void): Promise<unknown>;
  addListener(ev: "micsegment", cb: (d: { text: string }) => void): Promise<unknown>;
  addListener(ev: "micerror", cb: (d: { fatal?: boolean }) => void): Promise<unknown>;
  /** NOT this mic — see webviewMicTrace below. */
  captureTrace(): Promise<{ reqAt: number; grantAt: number; fast: boolean; n: number }>;
}
const CallMic = registerPlugin<CallMicNative>("CallMic");

/**
 * Sub-stage timings for the WEBVIEW's microphone grab — the mic the realtime
 * call uses, which is NOT this module's piped mic. It is exposed through the
 * CallMic bridge only because that is the bridge the call path already has.
 *
 * `micMs` in the connect telemetry is one span covering three unrelated
 * costs and cannot say which is slow. `reqAt` is when the WebView's capture
 * request reached native, `grantAt` when we answered it — both epoch ms on
 * the same clock as Date.now(), so everything after grantAt is the audio
 * device actually opening. Timestamps only; no audio, no content.
 *
 * Returns null off Android, or on an APK whose native half predates this.
 */
export async function webviewMicTrace(): Promise<{
  reqAt: number;
  grantAt: number;
  fast: boolean;
  n: number;
} | null> {
  if (!isNative) return null;
  try {
    const t = await CallMic.captureTrace();
    return t?.reqAt ? t : null;
  } catch {
    return null;
  }
}

export interface VoiceOpts {
  elevenKey?: string;
  elevenVoiceId?: string;
  sarvamKey?: string; // Sarvam AI — best-in-class for Hinglish (bulbul:v3)
  deviceVoice?: string; // voiceURI (web) or voice name (native) chosen in Settings
}

// Default ElevenLabs voice: "Monika Sogam — Calm and Natural", the most
// popular Hindi female voice in their library (add it to My Voices first).
const ELEVEN_DEFAULT_VOICE = "1qEiC6qsybMkmnNdVMbK";
const SARVAM_SPEAKER = "priya";

// Hosted Meera voice (Gemini TTS behind our proxy) — same-origin on the web,
// absolute from inside the Android shell.
const PROXY_SPEECH_URL = isNative
  ? "https://meera-silk.vercel.app/api/speech"
  : "/api/speech";

const hasAudioTags = (t: string) => /\[[a-z ]+\]/i.test(t);

// can this browser transcribe speech at all? (voice notes + hands-free calls)
export function sttSupported(): boolean {
  if (isNative) return true;
  return Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export interface DeviceVoice {
  id: string;
  label: string;
}

// List selectable device voices (used by the Settings voice picker).
export async function listDeviceVoices(): Promise<DeviceVoice[]> {
  if (isNative) {
    try {
      const res: any = await TextToSpeech.getSupportedVoices();
      const voices: any[] = res?.voices ?? [];
      return voices
        .filter((v) => /^(en|hi)/i.test(v.lang ?? ""))
        .map((v) => ({ id: v.voiceURI ?? v.name, label: `${v.name} (${v.lang})` }));
    } catch {
      return [];
    }
  }
  const voices = window.speechSynthesis?.getVoices() ?? [];
  return voices
    .filter((v) => /^(en|hi)/i.test(v.lang))
    .map((v) => ({ id: v.voiceURI, label: `${v.name} (${v.lang})` }));
}

/* ─────────────────────── shared text prep ─────────────────────── */

// protocol that must NEVER be spoken aloud: [photo:/gif:/voicenote:/followup:/
// tone:] markers (colon form), stage directions ("[slightly out of breath,
// …]" — any bracket content that isn't a short simple audio tag), "---"
// bubble separators, *roleplay actions*
function stripProtocol(text: string): string {
  return text
    .replace(/\[[a-z]+\s*:[^\]]*\]?/gi, " ")
    .replace(/\[(?![a-z ]{2,16}\])[^\]]*\]?/gi, " ")
    .replace(/\*[^*\n]{1,80}\*/g, " ")
    .replace(/(^|\s)-{2,}(\s|$)/g, " ");
}

function stripForDevice(text: string): string {
  // device TTS can't laugh — turn audio tags into pauses, drop emojis
  return stripProtocol(text)
    .replace(/\[[a-z ]+\]/gi, "…")
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{2764}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Keeps short audio tags ([laughs], [sighs]) — ElevenLabs v3 actually performs
// them, and the routing above deliberately steers tagged replies to it. The
// engines that CANNOT perform them strip them at their own door instead
// (stripForDevice for Sarvam/device, stripTagsForPlainVoice for our proxy), so
// no engine is ever handed a tag it will read out loud as a word.
function stripForCloud(text: string): string {
  return stripProtocol(text)
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{2764}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// The hosted Meera voice (Gemini TTS through our proxy) is the default for a
// fresh, keyless install and there is no evidence it performs audio tags. She
// emits them constantly on the cascade lane — [excited], [laughs], [sighs],
// [softly], [giggles], [curious], measured on 10 of 10 replies — so this is the
// common case, not an edge one. The bet is asymmetric: a performed tag buys a
// small flourish, an unperformed one has her literally saying the word
// "excited" mid-sentence. Her brief already tells her to write the laugh out
// ("hahaha"), which is heard for certain, so the tag becomes the beat it stood
// for and nothing is lost.
function stripTagsForPlainVoice(text: string): string {
  return (
    text
      .replace(/\[[a-z ]{2,16}\]/gi, "…")
      .replace(/\s+/g, " ")
      .trim()
      // a tag at the head would be a pause before she has said anything, which
      // is just dead air on the front of the turn
      .replace(/^…\s*/, "")
  );
}

// Punctuation-aware prosody for device TTS: questions rise, exclamations
// quicken, plus per-phrase jitter so consecutive sentences never match.
function prosody(t: string): { rate: number; pitch: number } {
  let rate = 0.95;
  let pitch = 1.1;
  if (/\?$/.test(t.trim())) pitch += 0.06;
  else if (/!$/.test(t.trim())) rate += 0.08;
  rate *= 0.96 + Math.random() * 0.08;
  pitch += (Math.random() - 0.5) * 0.04;
  return { rate, pitch };
}

// split into phrases with a pause length after each (ms)
function phrase(text: string): Array<{ t: string; pause: number }> {
  const out: Array<{ t: string; pause: number }> = [];
  // ellipses become explicit thinking pauses
  const parts = text.split(/(\.\.\.|…)/);
  let buf = "";
  const flushSentences = (s: string, endPause: number) => {
    const sentences = s.match(/[^.!?,]+[.!?,]*/g) ?? (s.trim() ? [s] : []);
    let cur = "";
    for (const sen of sentences) {
      cur += sen;
      const trailing = sen.trim().slice(-1);
      if (/[.!?]/.test(trailing) || cur.length > 140) {
        out.push({ t: cur.trim(), pause: 280 + Math.random() * 240 });
        cur = "";
      } else if (trailing === "," && cur.length > 60) {
        out.push({ t: cur.trim(), pause: 140 + Math.random() * 140 });
        cur = "";
      }
    }
    if (cur.trim()) out.push({ t: cur.trim(), pause: endPause });
  };
  for (const p of parts) {
    if (p === "..." || p === "…") {
      if (buf.trim()) {
        flushSentences(buf, 0);
        buf = "";
      }
      if (out.length) out[out.length - 1].pause = 600 + Math.random() * 400; // the "thinking" pause
    } else {
      buf += p;
    }
  }
  if (buf.trim()) flushSentences(buf, 200);
  return out.filter((p) => p.t);
}

/* ─────────────────────────── TTS ─────────────────────────── */

let speakSession = 0;
let currentAudio: HTMLAudioElement | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let previousSpokenText = ""; // ElevenLabs request stitching — prosody continuity

// A streamed phrase is not one audio element but DOZENS of scheduled buffer
// sources plus a fetch still arriving. Barge-in has to reach all of it: killing
// only `currentSource` would leave her talking over the user, which is a worse
// failure than the latency streaming was added to fix.
let scheduled: AudioBufferSourceNode[] = [];
const streamAborts = new Set<AbortController>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Mobile browsers only allow audio started inside a user gesture. Her replies
// arrive seconds AFTER the tap, so a bare Audio().play() gets blocked and we'd
// silently fall back to robotic device TTS. Fix: unlock a shared AudioContext
// during the call-button tap, then play every clip through it.
let audioCtx: AudioContext | null = null;
let speechBus: GainNode | null = null; // her voice routes here → duckable

function speechOut(): AudioNode {
  if (!audioCtx) return null as unknown as AudioNode;
  if (!speechBus) {
    speechBus = audioCtx.createGain();
    attachAnalyser("her", audioCtx, speechBus); // presence UI reads her real voice
    speechBus.connect(audioCtx.destination);
  }
  return speechBus;
}

// two-stage barge-in: duck ("I hear you") before committing to a hard stop.
// Covers BOTH output paths — the WebAudio bus and the HTMLAudio fallback.
let duckedLevel = 1.0;
export function duckSpeech(on: boolean) {
  duckedLevel = on ? 0.27 : 1.0;
  if (currentAudio) currentAudio.volume = duckedLevel;
  if (!audioCtx || !speechBus) return;
  const t = audioCtx.currentTime;
  speechBus.gain.cancelScheduledValues(t);
  speechBus.gain.setValueAtTime(speechBus.gain.value, t);
  speechBus.gain.linearRampToValueAtTime(duckedLevel, t + (on ? 0.15 : 0.3));
}

// Chat voice-note playback: the same WebAudio path calls use (the one route
// proven to make sound on every device this app runs on); HTMLAudio only as
// a fallback. Call from INSIDE the tap gesture so the context can unlock.
export function playNote(
  blob: Blob,
  onProgress: (frac: number) => void,
  onEnd: (ok: boolean) => void,
): { stop: () => void } {
  let stopped = false;
  let src: AudioBufferSourceNode | null = null;
  let el: HTMLAudioElement | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const finish = (ok: boolean) => {
    if (timer) clearInterval(timer);
    timer = null;
    if (!stopped) onEnd(ok);
  };
  (async () => {
    if (audioCtx && audioCtx.state === "running") {
      try {
        const buf = await audioCtx.decodeAudioData(await blob.arrayBuffer());
        if (stopped) return;
        src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(audioCtx.destination);
        const t0 = audioCtx.currentTime;
        timer = setInterval(() => {
          if (audioCtx) onProgress(Math.min(1, (audioCtx.currentTime - t0) / buf.duration));
        }, 120);
        src.onended = () => finish(true);
        src.start(0);
        return;
      } catch {
        /* decode failed → HTMLAudio below */
      }
    }
    if (stopped) return;
    el = new Audio(URL.createObjectURL(blob));
    el.ontimeupdate = () => {
      if (el && el.duration) onProgress(el.currentTime / el.duration);
    };
    el.onended = () => {
      if (el) URL.revokeObjectURL(el.src);
      finish(true);
    };
    el.onerror = () => finish(false);
    el.play().catch(() => finish(false));
  })();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
      try {
        src?.stop();
      } catch {
        /* already ended */
      }
      el?.pause();
    },
  };
}

export function unlockAudio() {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") audioCtx.resume();
    // one silent tick inside the gesture seals the unlock
    const buf = audioCtx.createBuffer(1, 1, 22050);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtx.destination);
    src.start(0);
  } catch {
    /* fall back to HTMLAudio path */
  }
}

async function playBlob(
  blob: Blob,
  session: number,
  onStart?: () => void,
  onEnd?: () => void,
): Promise<boolean> {
  if (session !== speakSession) return true;
  // preferred path: unlocked Web Audio — immune to autoplay policy
  if (audioCtx && audioCtx.state === "running") {
    try {
      const data = await blob.arrayBuffer();
      const buf = await audioCtx.decodeAudioData(data);
      if (session !== speakSession) return true;
      return await new Promise<boolean>((resolve) => {
        const src = audioCtx!.createBufferSource();
        currentSource = src;
        src.buffer = buf;
        src.connect(speechOut());
        src.onended = () => {
          if (session === speakSession) onEnd?.();
          resolve(true);
        };
        onStart?.();
        src.start(0);
      });
    } catch {
      /* decode failed → try HTMLAudio below */
    }
  }
  return new Promise((resolve) => {
    const audio = new Audio(URL.createObjectURL(blob));
    currentAudio = audio;
    audio.volume = duckedLevel; // fallback path still honors barge-in duck
    audio.onplay = () => onStart?.();
    audio.onended = () => {
      URL.revokeObjectURL(audio.src);
      if (session === speakSession) onEnd?.();
      resolve(true);
    };
    audio.onerror = () => resolve(false);
    audio.play().catch(() => resolve(false));
  });
}

async function elevenFetch(text: string, opts: VoiceOpts): Promise<Blob | null> {
  try {
    const voiceId = opts.elevenVoiceId?.trim() || ELEVEN_DEFAULT_VOICE;
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": opts.elevenKey!, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: "eleven_v3",
          // v3 accepts only 0 / 0.5 / 1 for stability; expressiveness comes
          // from audio tags, so style stays 0 (nonzero adds instability).
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
          ...(previousSpokenText ? { previous_text: previousSpokenText } : {}),
          apply_text_normalization: "auto",
        }),
      },
    );
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

async function sarvamFetch(text: string, opts: VoiceOpts): Promise<Blob | null> {
  try {
    const res = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "api-subscription-key": opts.sarvamKey!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        language_code: "hi-IN",
        speaker: SARVAM_SPEAKER,
        model: "bulbul:v3",
        pace: 1.0,
        speech_sample_rate: 24000,
        enable_preprocessing: true,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const b64 = data?.audios?.[0];
    if (!b64) return null;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new Blob([bytes], { type: "audio/wav" });
  } catch {
    return null;
  }
}

/* ── room tone: real calls are never digitally silent. A whisper-quiet,
   low-passed noise bed makes the line feel alive (telephony comfort-noise
   principle). Runs only during calls. ── */

let roomTone: { src: AudioBufferSourceNode; gain: GainNode; sway: number } | null = null;

export function startRoomTone() {
  if (!audioCtx || audioCtx.state !== "running" || roomTone) return;
  try {
    const sr = audioCtx.sampleRate;
    const buf = audioCtx.createBuffer(1, sr * 4, sr);
    const d = buf.getChannelData(0);
    // brown-ish noise: integrate white noise for a warm, unobtrusive floor
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + (Math.random() * 2 - 1) * 0.02) * 0.985;
      d[i] = last;
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = audioCtx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    const gain = audioCtx.createGain();
    gain.gain.value = 0.005;
    src.connect(lp).connect(gain).connect(audioCtx.destination);
    src.start(0);
    // gentle drift so the floor never sounds like a fixed loop
    const sway = window.setInterval(() => {
      if (!roomTone || !audioCtx) return;
      gain.gain.linearRampToValueAtTime(
        0.0035 + Math.random() * 0.0035,
        audioCtx.currentTime + 1.8,
      );
    }, 2200);
    roomTone = { src, gain, sway };
  } catch {
    /* ambience is optional */
  }
}

export function stopRoomTone() {
  if (!roomTone) return;
  try {
    roomTone.src.stop();
  } catch {
    /* already stopped */
  }
  clearInterval(roomTone.sway);
  roomTone = null;
}

/* ── progressive proxy voice ──────────────────────────────────────────────
   The proxy can stream her voice as raw PCM while it is still being
   synthesised. Measured on the free lane: first frame at 579ms p50 / 722ms
   p90, against 2053ms p50 / 4177ms p90 / 20180ms worst for the complete file
   this used to wait on.

   No decodeAudioData anywhere in here — that needs a COMPLETE file, which is
   the whole problem. The wire format is known, headerless and fixed-rate
   (L16, 24kHz, mono), so a frame becomes an AudioBuffer and is scheduled the
   moment it lands. ── */

const PCM_RATE = 24000;
// Upstream never once fell behind the playhead across 10 runs (worst lead
// +40ms, generation at 1.6–2.2x realtime), so this buffer is sized for the
// CLIENT's network jitter, not the provider's.
const JITTER_MS = 150;

// Would this text route to the hosted proxy voice at all? Mirrors fetchClipFor
// exactly, because a divergence here would silently stream one engine's text
// through another engine's door.
function usesProxyVoice(text: string, opts: VoiceOpts): boolean {
  const preferEleven = Boolean(opts.elevenKey) && (hasAudioTags(text) || !opts.sarvamKey);
  return !preferEleven && !opts.sarvamKey;
}

/**
 * Fetch and play one phrase progressively. Resolves TRUE once the audio has
 * finished sounding (or barge-in cut it), FALSE if nothing was ever audible —
 * in which case the caller falls back to the complete-file path, having lost
 * nothing but the attempt.
 */
async function streamProxyClip(
  text: string,
  style: string | undefined,
  session: number,
  onFirstAudio?: () => void,
): Promise<boolean> {
  const ctx = audioCtx;
  // progressive PCM needs the unlocked WebAudio path; the HTMLAudio fallback
  // can only play a complete file, so it keeps the blob route
  if (!ctx || ctx.state !== "running") return false;
  const spoken = stripTagsForPlainVoice(text);
  if (!spoken) return false;

  const ctl = new AbortController();
  streamAborts.add(ctl);
  const mine: AudioBufferSourceNode[] = [];
  const t0 = Date.now();
  try {
    const res = await fetch(PROXY_SPEECH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: spoken, stream: true, ...(style ? { style } : {}) }),
      signal: ctl.signal,
    });
    if (!res.ok || !res.body) return false;
    const reader = res.body.getReader();

    let carry = new Uint8Array(0);
    let queued: AudioBuffer[] = [];
    let queuedMs = 0;
    let playAt = 0;
    let started = false;
    let last: AudioBufferSourceNode | null = null;

    const schedule = (b: AudioBuffer) => {
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.connect(speechOut()); // her bus, so the barge-in duck still applies
      // an underrun would otherwise schedule in the past and overlap the
      // previous frame; a short gap is the honest failure, and the measurement
      // says it should not happen at all
      if (playAt < ctx.currentTime) playAt = ctx.currentTime + 0.02;
      src.start(playAt);
      playAt += b.duration;
      mine.push(src);
      scheduled.push(src);
      last = src;
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (session !== speakSession) {
        ctl.abort();
        return true; // barge-in, not a failure — do not re-synthesise
      }
      if (!value?.length) continue;
      // samples are 16-bit: an odd byte split across two reads must be carried
      // over, or every sample after it is noise
      let bytes: Uint8Array;
      if (carry.length) {
        bytes = new Uint8Array(carry.length + value.length);
        bytes.set(carry);
        bytes.set(value, carry.length);
      } else {
        bytes = value;
      }
      const usable = bytes.length - (bytes.length % 2);
      carry = bytes.slice(usable);
      if (!usable) continue;

      const i16 = new Int16Array(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + usable),
      );
      const buf = ctx.createBuffer(1, i16.length, PCM_RATE);
      const f32 = buf.getChannelData(0);
      for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
      queuedMs += (i16.length / PCM_RATE) * 1000;
      queued.push(buf);

      if (!started && queuedMs < JITTER_MS) continue;
      if (!started) {
        started = true;
        playAt = ctx.currentTime + 0.02;
        // The hedge's median must keep describing TIME UNTIL SHE STARTS
        // TALKING. Feeding it the complete-file time instead would teach it a
        // number roughly twice as large as the thing it gates, and it would go
        // back to firing on every turn — that bug billed two generations on 9
        // of 9 utterances and won nothing.
        noteClipMs(Date.now() - t0);
        onFirstAudio?.();
      }
      for (const b of queued) schedule(b);
      queued = [];
    }

    if (!started) return false; // stream ended before the buffer ever filled
    for (const b of queued) schedule(b);
    if (!last) return false;
    // resolve only once the last frame has actually finished sounding, so the
    // pipeline's inter-phrase breath still lands where it should. A stopped
    // source fires onended too, so barge-in unblocks this as well.
    await new Promise<void>((resolve) => {
      (last as AudioBufferSourceNode).onended = () => resolve();
    });
    return true;
  } catch {
    return false;
  } finally {
    streamAborts.delete(ctl);
    for (const s of mine) {
      const i = scheduled.indexOf(s);
      if (i >= 0) scheduled.splice(i, 1);
    }
  }
}

async function meeraFetch(text: string, style?: string): Promise<Blob | null> {
  const spoken = stripTagsForPlainVoice(text);
  if (!spoken) return null;
  try {
    const res = await fetch(PROXY_SPEECH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: spoken, ...(style ? { style } : {}) }),
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.size > 1000 ? blob : null;
  } catch {
    return null;
  }
}

export async function speak(
  text: string,
  onStart?: () => void,
  onEnd?: () => void,
  opts: VoiceOpts = {},
) {
  const session = ++speakSession;

  // ── cloud tiers ──
  // Sarvam bulbul is the Hinglish champion → primary when its key exists.
  // ElevenLabs v3 is the emotion champion → takes over when the reply
  // carries audio tags ([laughs] etc.), or when it's the only cloud key.
  // The hosted Meera voice (Gemini TTS via our proxy) always backs them up —
  // and IS the voice for a fresh, keyless install.
  const cloudText = stripForCloud(text);
  if (cloudText) {
    const preferEleven = Boolean(opts.elevenKey) && (hasAudioTags(text) || !opts.sarvamKey);
    const tries: Array<() => Promise<Blob | null>> = [];
    if (preferEleven) {
      tries.push(() => elevenFetch(cloudText, opts));
      if (opts.sarvamKey) tries.push(() => sarvamFetch(stripForDevice(text), opts));
    } else if (opts.sarvamKey) {
      tries.push(() => sarvamFetch(stripForDevice(text), opts));
      if (opts.elevenKey) tries.push(() => elevenFetch(cloudText, opts));
    }
    tries.push(() => meeraFetch(cloudText));
    for (const attempt of tries) {
      const blob = await attempt();
      if (blob) {
        previousSpokenText = cloudText;
        const ok = await playBlob(blob, session, onStart, onEnd);
        if (ok) return;
      }
    }
    // all cloud attempts failed → device fallback below
  }

  // ── tier 2: device TTS, humanized ──
  const clean = stripForDevice(text);
  if (!clean) return onEnd?.();
  const phrases = phrase(clean);
  if (!phrases.length) return onEnd?.();

  onStart?.();
  if (isNative) {
    try {
      let voiceIndex: number | undefined;
      if (opts.deviceVoice) {
        try {
          const res: any = await TextToSpeech.getSupportedVoices();
          const voices: any[] = res?.voices ?? [];
          const idx = voices.findIndex(
            (v) => (v.voiceURI ?? v.name) === opts.deviceVoice,
          );
          if (idx >= 0) voiceIndex = idx;
        } catch {
          /* keep default voice */
        }
      }
      for (const p of phrases) {
        if (session !== speakSession) return;
        const { rate, pitch } = prosody(p.t);
        await TextToSpeech.speak({
          text: p.t,
          lang: /[ऀ-ॿ]/.test(p.t) ? "hi-IN" : "en-IN",
          rate,
          pitch,
          volume: 1.0,
          ...(voiceIndex !== undefined ? { voice: voiceIndex } : {}),
          category: "playback",
        });
        if (p.pause > 0) await sleep(p.pause);
      }
    } catch {
      /* no TTS engine on device */
    }
    if (session === speakSession) onEnd?.();
    return;
  }

  const synth = window.speechSynthesis;
  if (!synth) {
    await sleep(Math.min(6000, 500 + clean.length * 55));
    return onEnd?.();
  }
  synth.cancel();
  const chosenWeb = opts.deviceVoice
    ? (window.speechSynthesis?.getVoices() ?? []).find((v) => v.voiceURI === opts.deviceVoice)
    : null;
  for (const p of phrases) {
    if (session !== speakSession) return;
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(p.t);
      const v = chosenWeb ?? pickWebVoice();
      if (v) u.voice = v;
      const { rate, pitch } = prosody(p.t);
      u.rate = rate;
      u.pitch = pitch;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      synth.speak(u);
    });
    if (p.pause > 0) await sleep(p.pause);
  }
  if (session === speakSession) onEnd?.();
}

/* ── call speech: pipelined by phrase. The first short chunk generates
   fast (≈2s instead of ≈5s for a full reply), and later chunks fetch while
   earlier ones play — so she starts talking quickly and never stalls. ── */

function splitPhrases(text: string): string[] {
  const parts = text.split(/(?<=[.!?…])\s+|\n+/).filter((p) => p.trim());
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    if (!cur) cur = p;
    else if ((cur + " " + p).length <= 110) cur += " " + p;
    else {
      out.push(cur);
      cur = p;
    }
  }
  if (cur) out.push(cur);
  // first chunk should be SHORT for fast onset — if it's long, cut at a comma
  if (out.length && out[0].length > 45) {
    const cut = out[0].slice(0, 45).lastIndexOf(",");
    if (cut > 16) {
      const head = out[0].slice(0, cut + 1);
      const tail = out[0].slice(cut + 1).trim();
      out.splice(0, 1, head, tail);
    }
  }
  return out.length ? out : [text];
}

async function fetchClipFor(
  text: string,
  opts: VoiceOpts,
  style?: string,
): Promise<Blob | null> {
  const preferEleven = Boolean(opts.elevenKey) && (hasAudioTags(text) || !opts.sarvamKey);
  if (preferEleven) return elevenFetch(text, opts);
  if (opts.sarvamKey) return sarvamFetch(stripForDevice(text), opts);
  return meeraFetch(text, style);
}

// Hedged fetch for the FIRST clip of a reply — the one the user is waiting
// on in silence. If the primary request is slow (upstream variance), a
// second identical request starts and whichever finishes first wins.
// A hedge only pays when slowness is VARIANCE — one unlucky request against a
// normally-fast endpoint. It pays nothing when slowness is SYSTEMATIC, because
// the second request is drawn from the same slow distribution as the first.
//
// This fired on 9 of 9 measured utterances: the threshold was a flat 1400ms,
// tuned when the voice endpoint was fast, while first-audio was actually taking
// 4.9-12.7s. So every single turn billed two generations and won nothing —
// the retry was just as slow as the request it was racing.
//
// A fixed number cannot survive the endpoint changing speed, and it is about to
// change again (the Azure voice measured 255ms). So the trigger is now relative
// to what this endpoint is ACTUALLY doing: hedge at twice the recent median,
// which by construction fires on genuine outliers and stays quiet when
// everything is uniformly slow. The floor keeps a fast endpoint from hedging on
// noise; the ceiling keeps a broken one from never hedging at all.
const clipMs: number[] = [];
const HEDGE_FLOOR = 1_400;
const HEDGE_CEIL = 20_000;
function hedgeDelay(): number {
  if (clipMs.length < 2) return HEDGE_FLOOR; // no evidence yet — old behaviour
  const sorted = [...clipMs].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length / 2)];
  return Math.min(HEDGE_CEIL, Math.max(HEDGE_FLOOR, p50 * 2));
}
function noteClipMs(ms: number) {
  clipMs.push(ms);
  if (clipMs.length > 12) clipMs.shift();
}

function hedgedClipFor(text: string, opts: VoiceOpts, style?: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    let settled = false;
    let hedged = false;
    let pending = 1;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const launchHedge = () => {
      if (settled || hedged) return;
      hedged = true;
      pending++;
      fetchClipFor(text, opts, style).then(settle, () => settle(null));
    };
    const settle = (b: Blob | null) => {
      if (settled) return;
      if (b) {
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(b);
        return;
      }
      pending--;
      if (!hedged) {
        // primary failed FAST (429/refused) — retry immediately, don't wait
        if (timer) clearTimeout(timer);
        launchHedge();
        return;
      }
      if (pending <= 0) {
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(null);
      }
    };
    const t0 = Date.now();
    fetchClipFor(text, opts, style).then((b) => {
      // only the unhedged primary teaches us this endpoint's real speed; a
      // hedged race would measure the winner of two and bias the median down
      if (!hedged) noteClipMs(Date.now() - t0);
      settle(b);
    }, () => settle(null));
    timer = setTimeout(launchHedge, hedgeDelay()); // outlier — race a second try
  });
}

/* ── prewarm: start fetching the first clip of a KNOWN upcoming reply (the
   greeting during the ring) so speakCall finds it already in flight ── */
const prewarmed = new Map<string, Promise<Blob | null>>();

export function prewarmSpeech(text: string, opts: VoiceOpts, style?: string) {
  const clean = stripForCloud(text);
  if (!clean) return;
  const first = splitPhrases(clean)[0];
  if (!first || prewarmed.has(first)) return;
  prewarmed.set(first, hedgedClipFor(first, opts, style));
  if (prewarmed.size > 4) prewarmed.delete(prewarmed.keys().next().value!);
}

// Speak a call reply with phrase pipelining. Returns via onEnd; a bumped
// speakSession (stopSpeaking / barge-in) aborts everything mid-flight.
export async function speakCall(
  text: string,
  onStart?: () => void,
  onEnd?: () => void,
  opts: VoiceOpts = {},
  style?: string,
) {
  const session = ++speakSession;
  const clean = stripForCloud(text);
  if (!clean) return onEnd?.();
  const phrases = splitPhrases(clean);

  // pipeline: kick off fetch N+1 while N plays; the first clip is hedged —
  // or already in flight if the caller prewarmed it (greeting during ring)
  const pre = prewarmed.get(phrases[0]);
  if (pre) prewarmed.delete(phrases[0]);
  const fetches: Array<Promise<Blob | null> | undefined> = [];
  let started = false;
  const begin = () => {
    if (!started) {
      started = true;
      onStart?.();
    }
  };

  // ── the first phrase is the ONLY one waited on in silence, so it streams ──
  // Later phrases fetch while earlier ones play, so their synthesis time is
  // already hidden and they keep the simpler complete-file path (and the blob
  // cache that hangs off it). Streaming here buys the entire win.
  let from = 0;
  if (!pre && usesProxyVoice(phrases[0], opts)) {
    // phrase 2 must not wait on phrase 1 finishing SOUNDING — start it now
    if (phrases.length > 1) fetches[1] = fetchClipFor(phrases[1], opts, style);
    const ok = await streamProxyClip(phrases[0], style, session, begin);
    if (session !== speakSession) return;
    if (ok) {
      from = 1;
      if (phrases.length > 1) await sleep(120 + Math.random() * 200);
    }
  }
  if (from === 0) fetches[0] = pre ?? hedgedClipFor(phrases[0], opts, style);

  for (let i = from; i < phrases.length; i++) {
    if (session !== speakSession) return;
    if (i + 1 < phrases.length && !fetches[i + 1])
      fetches[i + 1] = fetchClipFor(phrases[i + 1], opts, style);
    const blob = await fetches[i];
    if (session !== speakSession) return;
    if (!blob) continue;
    begin();
    await playBlob(blob, session, undefined, undefined);
    if (session !== speakSession) return;
    // human inter-phrase breath: 120–320ms
    if (i + 1 < phrases.length) await sleep(120 + Math.random() * 200);
  }
  if (!started) {
    // every clip failed → humanized device fallback via the normal path
    return speak(text, onStart, onEnd, opts);
  }
  if (session === speakSession) onEnd?.();
}

/* ── streaming call speech: phrases are cut from the token stream as it
   arrives, TTS fetches start the moment each phrase is known, and clips play
   strictly in order. She starts talking after the FIRST sentence exists —
   not after the whole reply. stopSpeaking() (barge-in) aborts everything. ── */

export interface StreamSpeaker {
  push: (delta: string) => void;
  finish: () => void; // no more text coming — flush the tail
  started: () => boolean; // has any audio actually begun playing?
}

export function createStreamSpeaker(
  opts: VoiceOpts,
  style: string | undefined,
  onStart?: () => void,
  onEnd?: () => void,
): StreamSpeaker {
  const session = ++speakSession;
  let buf = "";
  let closed = false;
  let started = false;
  let firstOut = false;
  let pumping = false;
  let allText = ""; // everything asked of TTS — device-voice fallback source
  // A queued unit of speech: a complete file already being fetched, or a phrase
  // to be STREAMED. Only a phrase that would otherwise be awaited in silence is
  // ever streamed; the rest arrive under cover of the one before them.
  type Queued = Promise<Blob | null> | { streamText: string };
  const queue: Array<Queued> = [];

  const emit = (phrase: string) => {
    const clean = stripForCloud(phrase);
    if (!clean) return;
    // leaked internal monologue must never be SPOKEN either — a phrase
    // mentioning models/modes/prompts is planning bleed, not conversation
    if (/\b(base model|minimal text|text mode|system prompt|language model|as an ai|reasoning|max.?_?tokens|persona prompt|default model|output format)\b/i.test(clean))
      return;
    allText += (allText ? " " : "") + clean;
    // Work starts NOW. A phrase with nothing playing ahead of it is the one the
    // user waits on in silence: it streams if the proxy voice is serving, and
    // is hedged otherwise (the engines that cannot stream keep the old cover).
    const awaitedInSilence = queue.length === 0 && !started;
    queue.push(
      awaitedInSilence && usesProxyVoice(clean, opts)
        ? { streamText: clean }
        : awaitedInSilence
          ? hedgedClipFor(clean, opts, style)
          : fetchClipFor(clean, opts, style),
    );
    void pump();
  };

  const pump = async () => {
    if (pumping) return;
    pumping = true;
    while (session === speakSession) {
      const next = queue.shift();
      if (!next) {
        if (closed) break;
        await sleep(60); // stream still producing — wait for the next phrase
        continue;
      }
      const begin = () => {
        if (!started) {
          started = true;
          onStart?.();
        }
      };
      if ("streamText" in next) {
        const ok = await streamProxyClip(next.streamText, style, session, begin);
        if (session !== speakSession) return;
        if (ok) {
          await sleep(100 + Math.random() * 160); // inter-phrase breath
          continue;
        }
        // never became audible — fall back to the complete-file path, having
        // lost only the attempt
        const blob = await hedgedClipFor(next.streamText, opts, style);
        if (session !== speakSession) return;
        if (blob) {
          begin();
          await playBlob(blob, session, undefined, undefined);
          if (session !== speakSession) return;
          await sleep(100 + Math.random() * 160);
        }
        continue;
      }
      const blob = await next;
      if (session !== speakSession) return;
      if (blob) {
        begin();
        await playBlob(blob, session, undefined, undefined);
        if (session !== speakSession) return;
        await sleep(100 + Math.random() * 160); // inter-phrase breath
      }
    }
    pumping = false;
    if (session === speakSession && closed && !queue.length) {
      if (!started && allText) {
        // every clip fetch failed — she still speaks, via device TTS
        void speak(allText, onStart, onEnd, opts);
        return;
      }
      onEnd?.();
    }
  };

  const cut = () => {
    // complete sentences leave the buffer as soon as they exist; the first
    // phrase goes out at the first boundary for fastest onset, later ones
    // merge up to ~110 chars so we don't spray tiny TTS requests
    for (;;) {
      // fastest onset: if the FIRST sentence is running long, don't wait for
      // its period — cut at a comma/space once enough words exist
      if (!firstOut && buf.length >= 26 && !/[.!?…]/.test(buf)) {
        const head = buf.slice(0, 26);
        const at = Math.max(head.lastIndexOf(","), head.lastIndexOf(" "));
        if (at > 12) {
          emit(buf.slice(0, at + 1).trim());
          buf = buf.slice(at + 1);
          firstOut = true;
          continue;
        }
      }
      const m = buf.match(/[.!?…]+["')]*\s/);
      if (!m || m.index === undefined) return;
      const end = m.index + m[0].length;
      if (firstOut && end < 60 && buf.length < 110) {
        // short fragment — see if the next boundary merges in
        const rest = buf.slice(end);
        const m2 = rest.match(/[.!?…]+["')]*\s/);
        if (!m2 || m2.index === undefined) return;
        const end2 = end + m2.index + m2[0].length;
        if (end2 <= 130) {
          emit(buf.slice(0, end2).trim());
          buf = buf.slice(end2);
          continue;
        }
      }
      emit(buf.slice(0, end).trim());
      buf = buf.slice(end);
      firstOut = true;
    }
  };

  return {
    push: (delta) => {
      if (session !== speakSession) return;
      buf += delta;
      cut();
    },
    finish: () => {
      if (session !== speakSession) return;
      if (buf.trim()) emit(buf.trim());
      buf = "";
      closed = true;
      void pump();
    },
    started: () => started,
  };
}

/* ── persistent TTS clip cache (IndexedDB): identical text+style is never
   synthesized twice across sessions. Backchannels alone were six paid TTS
   calls at EVERY call start; now they're paid once per install. ── */

let clipDbPromise: Promise<IDBDatabase | null> | null = null;
function clipDb(): Promise<IDBDatabase | null> {
  if (clipDbPromise) return clipDbPromise;
  clipDbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open("meera-clips", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("clips");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return clipDbPromise;
}

export async function cachedClip(key: string): Promise<Blob | null> {
  const db = await clipDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction("clips").objectStore("clips").get(key);
      req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export function saveClip(key: string, blob: Blob) {
  clipDb().then((db) => {
    if (!db) return;
    try {
      db.transaction("clips", "readwrite").objectStore("clips").put(blob, key);
    } catch {
      /* cache is best-effort */
    }
  });
}

/* ── backchannels: soft listener sounds. Humans DON'T make a sound after
   every turn — these fire rarely, only after long user turns, and never
   twice in a row (the "constant humming" bug was exactly this). ── */

const backchannelClips: Blob[] = [];
const BACKCHANNELS = ["Hmm.", "Haan...", "Acha..."];
// floor-holding sounds for when her reply is still generating — pure
// paralinguistics, not conversation
const fillerClips: Blob[] = [];
const FILLERS = ["Ummm...", "Ek second...", "Hmm..."];
const SOFT_STYLE = "quiet, brief, barely-there listener sound, low energy";
let lastFillerIdx = -1;

export async function prefetchBackchannels(opts: VoiceOpts) {
  if (backchannelClips.length) return;
  const load = async (text: string, into: Blob[]) => {
    const key = `bc1:${text}:${SOFT_STYLE}`;
    const hit = await cachedClip(key);
    if (hit) {
      into.push(hit);
      return;
    }
    const blob = await fetchClipFor(text, opts, SOFT_STYLE);
    if (blob) {
      into.push(blob);
      saveClip(key, blob);
    }
  };
  // ALL in parallel — serial loading meant a first call could reach the ack
  // moment with zero clips loaded, i.e. dead silence exactly when the
  // product promises "she always acknowledges you"
  await Promise.all([
    ...BACKCHANNELS.map((b) => load(b, backchannelClips)),
    ...FILLERS.map((f) => load(f, fillerClips)),
    ...PICKUPS.map((p) => loadPickup(p, opts)),
  ]);
}

// Canned pickup lines, cached in IndexedDB after the first call — played the
// INSTANT the line goes live if the improvised greeting's audio isn't ready
// yet, so a call never starts with dead air.
const PICKUPS = ["Haan hello?", "Hello ji.", "Haan bolo?"];
const PICKUP_STYLE = "casual warm phone pickup, natural, a little curious";
const pickupClips: Blob[] = [];

async function loadPickup(text: string, opts: VoiceOpts) {
  const key = `pk1:${text}:${PICKUP_STYLE}`;
  const hit = await cachedClip(key);
  if (hit) {
    pickupClips.push(hit);
    return;
  }
  const blob = await fetchClipFor(text, opts, PICKUP_STYLE);
  if (blob) {
    pickupClips.push(blob);
    saveClip(key, blob);
  }
}

/** Play a canned pickup line NOW (cached, zero network). True if played. */
export function playPickup(): boolean {
  if (!pickupClips.length) return false;
  const blob = pickupClips[Math.floor(Math.random() * pickupClips.length)];
  if (audioCtx && audioCtx.state === "running") {
    blob
      .arrayBuffer()
      .then((d) => audioCtx!.decodeAudioData(d))
      .then((buf) => {
        const src = audioCtx!.createBufferSource();
        src.buffer = buf;
        src.connect(audioCtx!.destination);
        src.start(0);
      })
      .catch(() => {});
    return true;
  }
  const a = new Audio(URL.createObjectURL(blob));
  a.onended = () => URL.revokeObjectURL(a.src);
  a.play().catch(() => {});
  return true;
}

// Played only if she's STILL silent well after the user finished — a human
// holds the floor with a sound eventually, but not every time and never
// the same sound twice running.
export function playThinkingFiller() {
  if (!fillerClips.length || Math.random() < 0.5) return;
  let idx = Math.floor(Math.random() * fillerClips.length);
  if (idx === lastFillerIdx) idx = (idx + 1) % fillerClips.length;
  lastFillerIdx = idx;
  const blob = fillerClips[idx];
  if (audioCtx && audioCtx.state === "running") {
    blob
      .arrayBuffer()
      .then((d) => audioCtx!.decodeAudioData(d))
      .then((buf) => {
        const src = audioCtx!.createBufferSource();
        src.buffer = buf;
        src.connect(audioCtx!.destination);
        src.start(0);
      })
      .catch(() => {});
  }
}

// Deterministic acknowledgment — "I heard you" — played when her reply is
// taking a beat. ALWAYS fires (rotating clip) so the user is never left
// wondering whether she listened; this is the audio version of read-ticks.
let lastAckIdx = -1;
export function playAck() {
  if (!backchannelClips.length) return;
  lastAckIdx = (lastAckIdx + 1) % backchannelClips.length;
  const blob = backchannelClips[lastAckIdx];
  if (audioCtx && audioCtx.state === "running") {
    blob
      .arrayBuffer()
      .then((d) => audioCtx!.decodeAudioData(d))
      .then((buf) => {
        const src = audioCtx!.createBufferSource();
        src.buffer = buf;
        src.connect(audioCtx!.destination);
        src.start(0);
      })
      .catch(() => {});
    return;
  }
  const a = new Audio(URL.createObjectURL(blob));
  a.onended = () => URL.revokeObjectURL(a.src);
  a.play().catch(() => {});
}

export function playBackchannel() {
  if (!backchannelClips.length) return;
  const blob = backchannelClips[Math.floor(Math.random() * backchannelClips.length)];
  if (audioCtx && audioCtx.state === "running") {
    blob
      .arrayBuffer()
      .then((d) => audioCtx!.decodeAudioData(d))
      .then((buf) => {
        const src = audioCtx!.createBufferSource();
        src.buffer = buf;
        src.connect(audioCtx!.destination);
        src.start(0);
      })
      .catch(() => {});
    return;
  }
  const a = new Audio(URL.createObjectURL(blob));
  a.onended = () => URL.revokeObjectURL(a.src);
  a.play().catch(() => {});
}

export function stopSpeaking() {
  speakSession++;
  duckSpeech(false);
  // A streamed phrase is dozens of already-scheduled sources plus a fetch still
  // arriving. Every one of them has to go: stopping the fetch alone leaves
  // queued audio to play out over the user, and stopping the sources alone
  // leaves the rest of the stream arriving to be scheduled behind them.
  for (const c of streamAborts) c.abort();
  streamAborts.clear();
  for (const s of scheduled) {
    try {
      s.stop();
    } catch {
      /* already ended */
    }
  }
  scheduled = [];
  try {
    currentSource?.stop();
  } catch {
    /* already stopped */
  }
  currentSource = null;
  currentAudio?.pause();
  currentAudio = null;
  if (isNative) {
    TextToSpeech.stop().catch(() => {});
  } else {
    window.speechSynthesis?.cancel();
  }
}

/* ── web voice picking (browser fallback only) ── */

let cachedVoice: SpeechSynthesisVoice | null = null;

function pickWebVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice) return cachedVoice;
  const voices = window.speechSynthesis?.getVoices() ?? [];
  if (!voices.length) return null;
  const score = (v: SpeechSynthesisVoice) => {
    let s = 0;
    const n = v.name.toLowerCase();
    if (/female|woman|girl/.test(n)) s += 6;
    if (/samantha|veena|lekha|kiran|priya|zira|aria|jenny|neerja|swara|heera/.test(n)) s += 8;
    if (v.lang.startsWith("en-IN")) s += 5;
    else if (v.lang.startsWith("hi")) s += 4;
    else if (v.lang.startsWith("en")) s += 3;
    if (v.localService) s += 2;
    if (/google|natural|neural|premium|enhanced/.test(n)) s += 2;
    return s;
  };
  cachedVoice = [...voices].sort((a, b) => score(b) - score(a))[0] ?? null;
  return cachedVoice;
}

if (typeof window !== "undefined" && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoice = null;
    pickWebVoice();
  };
}

/* ─────────────────────────── STT ─────────────────────────── */

type STTResult = {
  supported: boolean;
  stop?: () => void;
  // continuous-mic sessions deliver a growing transcript; after the engine
  // commits a turn it calls consume() so already-committed words are never
  // re-delivered as fresh speech
  consume?: () => void;
};

// which STT lane is live — the engine's endpointing tick runs for "web" and
// "callmic" (both stream interims), while the legacy native loop self-endpoints
let activeSttMode: "web" | "native-loop" | "callmic" = "web";
export const getSttMode = () => activeSttMode;

type CallMicHandler = {
  onText: (text: string, final: boolean) => void;
  onEnd: (reason?: string) => void;
  done: boolean;
  segBase: number; // chars of the current segment already committed upstream
  lastFull: string;
};
let callMicSupported: boolean | null = null;
let callMicWired = false;
let callMicRunning = false;
let cmCurrent: CallMicHandler | null = null;

async function callMicUsable(): Promise<boolean> {
  if (!isNative) return false;
  if (callMicSupported === false) return false;
  try {
    const r = await CallMic.available();
    if (!r.supported) {
      callMicSupported = false;
      return false;
    }
    // permission not granted yet → legacy path owns the prompt this time;
    // don't cache, the grant may exist by the next call
    if (!r.micGranted) return false;
    callMicSupported = true;
    return true;
  } catch {
    callMicSupported = false;
    return false;
  }
}

async function wireCallMicOnce() {
  if (callMicWired) return;
  callMicWired = true;
  await CallMic.addListener("micpartial", ({ text }) => {
    const h = cmCurrent;
    if (!h || h.done || !text) return;
    if (text.length < h.segBase) h.segBase = 0; // upstream session recycled
    h.lastFull = text;
    const fresh = text.slice(h.segBase).trim();
    if (fresh) h.onText(fresh, false);
  });
  await CallMic.addListener("micsegment", ({ text }) => {
    const h = cmCurrent;
    if (!h || h.done) return;
    // the segment final is authoritative (may rewrite earlier words); clamp
    // the committed offset so a shorter correction can't slice out of range
    const full = text || h.lastFull;
    const fresh = full.slice(Math.min(h.segBase, full.length)).trim();
    h.segBase = 0;
    h.lastFull = "";
    // segment close = recognizer's own endpoint; usually the tick already
    // committed everything (fresh empty). Deliver any remainder as FINAL so
    // it lands in the accumulator's finals and survives a new segment
    // starting before the next tick commit.
    if (fresh) h.onText(fresh, true);
  });
  await CallMic.addListener("micerror", ({ fatal }) => {
    const h = cmCurrent;
    callMicRunning = false;
    if (fatal) callMicSupported = false; // downgrade: legacy lane from now on
    if (h && !h.done) {
      h.done = true;
      cmCurrent = null;
      h.onEnd("error"); // engine backoff re-arms; next listen() re-dispatches
    }
  });
}

// onEnd carries WHY the session ended: "" = normal silence timeout (re-arm),
// "not-allowed" = permission denied (stop re-arming, surface the keyboard),
// "error" = transient failure (re-arm with backoff)
// Native STT plumbing is wired ONCE per app run (permission check + event
// listeners), so each re-arm after she speaks is a single start() bridge
// call. The old per-listen setup (5 round-trips) left the mic dead for the
// whole plumbing time on every turn — the "did she even hear me?" gap.
type NativeHandler = {
  onText: (text: string, final: boolean) => void;
  onEnd: (reason?: string) => void;
  last: string;
  done: boolean;
  // events are only honored once this session's start() resolved — a stale
  // "stopped" from the PREVIOUS session crossing the bridge late must not
  // kill a session that hasn't even begun (that read as "mic randomly dies")
  started: boolean;
};
let nativeWirePromise: Promise<boolean> | null = null;
let nativeCurrent: NativeHandler | null = null;

// Promise-cached (not a boolean): two overlapping first calls — easy while
// the permission dialog is up — must both await the SAME wiring instead of
// the second seeing "wired but not ok" and permanently reporting not-allowed.
function wireNativeOnce(): Promise<boolean> {
  if (!nativeWirePromise) {
    nativeWirePromise = (async () => {
      const avail = await NativeSR.available();
      if (!avail.available) return false;
      const perm = await NativeSR.requestPermissions();
      if (perm.speechRecognition !== "granted") return false;
      await NativeSR.removeAllListeners();
      await NativeSR.addListener("partialResults", (data: any) => {
        const h = nativeCurrent;
        const t = data?.matches?.[0];
        if (h && h.started && !h.done && t) {
          h.last = t;
          h.onText(t, false);
        }
      });
      await NativeSR.addListener("listeningState", (data: any) => {
        const h = nativeCurrent;
        if (data?.status === "stopped" && h && h.started && !h.done) {
          h.done = true;
          if (h.last) h.onText(h.last, true);
          h.onEnd();
        }
      });
      return true;
    })().catch(() => {
      nativeWirePromise = null; // transient failure — re-attempt next arm
      return false;
    });
  }
  return nativeWirePromise;
}

// Legacy native lane: capgo plugin restart-loop (self-endpointing sessions).
// Still the path on Android <13, when the on-device model is missing, or
// after a piped-lane fatal downgrade.
function legacyNativeListen(
  onText: (text: string, final: boolean) => void,
  onEnd: (reason?: string) => void,
): STTResult {
  const h: NativeHandler = { onText, onEnd, last: "", done: false, started: false };
  (async () => {
    const ok = await wireNativeOnce();
    if (h.done) return; // stop() raced our async init — keep the mic off
    if (!ok) {
      h.done = true;
      onEnd("not-allowed");
      return;
    }
    nativeCurrent = h;
    try {
      await NativeSR.start({
        language: "en-IN",
        partialResults: true,
        popup: false,
      });
      h.started = true;
      if (h.done) NativeSR.stop().catch(() => {});
    } catch {
      if (!h.done) {
        h.done = true;
        onEnd("error");
      }
    }
  })();
  return {
    supported: true,
    stop: () => {
      h.done = true;
      // only touch the bridge if this session actually started — the
      // post-start done-check above handles a stop that raced start()
      if (h.started) NativeSR.stop().catch(() => {});
    },
  };
}

export function listen(
  onText: (text: string, final: boolean) => void,
  onEnd: (reason?: string) => void,
): STTResult {
  if (isNative) {
    // dispatch: beep-free continuous lane first, legacy loop otherwise. The
    // choice is async, so the returned handle routes to whichever lane won.
    const h: CallMicHandler = { onText, onEnd, done: false, segBase: 0, lastFull: "" };
    let legacy: STTResult | null = null;
    (async () => {
      if (await callMicUsable()) {
        activeSttMode = "callmic";
        await wireCallMicOnce();
        if (h.done) return; // stop() raced init
        cmCurrent = h;
        try {
          if (!callMicRunning) {
            await CallMic.start();
            // stop() may have fired during the await (mute toggle, watch
            // start) — leaving callMicRunning=true with the native side
            // stopped would silently dead-mic every later listen()
            if (h.done) {
              CallMic.stop().catch(() => {});
              return;
            }
            callMicRunning = true;
          }
        } catch {
          callMicSupported = false; // start refused — legacy from here on
          cmCurrent = null;
          if (!h.done) {
            activeSttMode = "native-loop";
            legacy = legacyNativeListen(onText, onEnd);
          }
        }
      } else if (!h.done) {
        activeSttMode = "native-loop";
        legacy = legacyNativeListen(onText, onEnd);
      }
    })();
    return {
      supported: true,
      stop: () => {
        h.done = true;
        if (cmCurrent === h) {
          cmCurrent = null;
          callMicRunning = false;
          CallMic.stop().catch(() => {});
        }
        legacy?.stop?.();
      },
      consume: () => {
        h.segBase = h.lastFull.length;
      },
    };
  }

  const SR: any =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) return { supported: false };
  activeSttMode = "web";
  const rec = new SR();
  rec.lang = "en-IN";
  rec.interimResults = true;
  rec.continuous = true;
  let endReason = "";
  rec.onresult = (e: any) => {
    let interim = "";
    let final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (final) onText(final.trim(), true);
    else if (interim) onText(interim.trim(), false);
  };
  rec.onerror = (e: any) => {
    endReason =
      e?.error === "not-allowed" || e?.error === "service-not-allowed"
        ? "not-allowed"
        : e?.error === "no-speech" || e?.error === "aborted"
          ? ""
          : "error";
  };
  rec.onend = () => onEnd(endReason);
  try {
    rec.start();
  } catch {
    // transient start collision (previous recognizer still tearing down) —
    // NOT "no STT on this device"; report an error end so the caller retries
    setTimeout(() => onEnd("error"), 50);
    return { supported: true, stop: () => {} };
  }
  return { supported: true, stop: () => rec.stop() };
}
