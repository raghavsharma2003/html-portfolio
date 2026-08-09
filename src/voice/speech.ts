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

import { Capacitor } from "@capacitor/core";
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { SpeechRecognition as NativeSR } from "@capgo/capacitor-speech-recognition";

const isNative = Capacitor.isNativePlatform();

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

function stripForDevice(text: string): string {
  // device TTS can't laugh — turn audio tags into pauses, drop emojis
  return text
    .replace(/\[[a-z ]+\]/gi, "…")
    .replace(/\[photo:[^\]]*\]/gi, "")
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{2764}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripForCloud(text: string): string {
  return text
    .replace(/\[photo:[^\]]*\]/gi, "")
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{2764}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Mobile browsers only allow audio started inside a user gesture. Her replies
// arrive seconds AFTER the tap, so a bare Audio().play() gets blocked and we'd
// silently fall back to robotic device TTS. Fix: unlock a shared AudioContext
// during the call-button tap, then play every clip through it.
let audioCtx: AudioContext | null = null;

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
        src.connect(audioCtx!.destination);
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

async function meeraFetch(text: string): Promise<Blob | null> {
  try {
    const res = await fetch(PROXY_SPEECH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
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

/* ── backchannels: humans respond within ~200ms; while her real reply
   renders, an instant "Hmm?" / "Haan…" keeps the rhythm alive ── */

const backchannelClips: Blob[] = [];
const BACKCHANNELS = ["Hmm?", "Haan...", "Acha...", "Mmm."];

export async function prefetchBackchannels(opts: VoiceOpts) {
  if (backchannelClips.length) return;
  for (const b of BACKCHANNELS) {
    const blob = opts.sarvamKey
      ? await sarvamFetch(b, opts)
      : opts.elevenKey
        ? await elevenFetch(b, opts)
        : await meeraFetch(b);
    if (blob) backchannelClips.push(blob);
  }
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

type STTResult = { supported: boolean; stop?: () => void };

export function listen(
  onText: (text: string, final: boolean) => void,
  onEnd: () => void,
): STTResult {
  if (isNative) {
    let stopped = false;
    let last = "";
    (async () => {
      try {
        const avail = await NativeSR.available();
        if (!avail.available) {
          onEnd();
          return;
        }
        const perm = await NativeSR.requestPermissions();
        if (perm.speechRecognition !== "granted") {
          onEnd();
          return;
        }
        await NativeSR.removeAllListeners();
        await NativeSR.addListener("partialResults", (data: any) => {
          const t = data?.matches?.[0];
          if (t) {
            last = t;
            onText(t, false);
          }
        });
        await NativeSR.addListener("listeningState", (data: any) => {
          if (data?.status === "stopped" && !stopped) {
            stopped = true;
            if (last) onText(last, true);
            onEnd();
          }
        });
        await NativeSR.start({
          language: "en-IN",
          partialResults: true,
          popup: false,
        });
      } catch {
        onEnd();
      }
    })();
    return {
      supported: true,
      stop: () => {
        stopped = true;
        NativeSR.stop().catch(() => {});
      },
    };
  }

  const SR: any =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) return { supported: false };
  const rec = new SR();
  rec.lang = "en-IN";
  rec.interimResults = true;
  rec.continuous = false;
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
  rec.onend = () => onEnd();
  rec.onerror = () => onEnd();
  try {
    rec.start();
  } catch {
    return { supported: false };
  }
  return { supported: true, stop: () => rec.stop() };
}
