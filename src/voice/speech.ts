// Voice layer with two tiers:
//
//  1. ElevenLabs (when a key is set in Settings) — genuinely human, emotional
//     speech. Uses the expressive v3 model, which supports Hindi/Hinglish and
//     audio tags like [laughs], [sighs], [whispers] that the brain writes
//     into her call speech.
//  2. Device TTS fallback (native Android TTS / Web Speech) — humanized as
//     far as a device voice can go: phrase-level chunking with breath pauses,
//     "…" rendered as real silence, per-phrase pace jitter so it never reads
//     like one flat sentence.
//
// STT: native Android SpeechRecognition (WebView has none), web SR fallback.

import { Capacitor } from "@capacitor/core";
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { SpeechRecognition as NativeSR } from "@capgo/capacitor-speech-recognition";

const isNative = Capacitor.isNativePlatform();

export interface VoiceOpts {
  elevenKey?: string;
  elevenVoiceId?: string;
  deviceVoice?: string; // voiceURI (web) or voice name (native) chosen in Settings
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

function stripForDevice(text: string): string {
  // device TTS can't laugh — turn audio tags into pauses, drop emojis
  return text
    .replace(/\[(laughs?|giggles?|sighs?|whispers?|hums?|exhales?)\]/gi, "…")
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function speak(
  text: string,
  onStart?: () => void,
  onEnd?: () => void,
  opts: VoiceOpts = {},
) {
  const session = ++speakSession;

  // ── tier 1: ElevenLabs expressive voice ──
  if (opts.elevenKey) {
    const clean = stripForCloud(text);
    if (!clean) return onEnd?.();
    try {
      const voiceId = opts.elevenVoiceId?.trim() || "21m00Tcm4TlvDq8ikWAM";
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "xi-api-key": opts.elevenKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            text: clean,
            model_id: "eleven_v3",
            voice_settings: { stability: 0.35, similarity_boost: 0.8, style: 0.55 },
          }),
        },
      );
      if (res.ok) {
        const blob = await res.blob();
        if (session !== speakSession) return;
        const audio = new Audio(URL.createObjectURL(blob));
        currentAudio = audio;
        audio.onplay = () => onStart?.();
        audio.onended = () => {
          URL.revokeObjectURL(audio.src);
          if (session === speakSession) onEnd?.();
        };
        audio.onerror = () => onEnd?.();
        await audio.play();
        return;
      }
      // fall through to device TTS on API error (bad key, quota…)
    } catch {
      /* network issue → device fallback */
    }
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
        await TextToSpeech.speak({
          text: p.t,
          lang: "en-IN",
          rate: 0.93 + Math.random() * 0.09,
          pitch: 1.08 + Math.random() * 0.05,
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
      u.rate = 0.93 + Math.random() * 0.09;
      u.pitch = 1.08 + Math.random() * 0.05;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      synth.speak(u);
    });
    if (p.pause > 0) await sleep(p.pause);
  }
  if (session === speakSession) onEnd?.();
}

export function stopSpeaking() {
  speakSession++;
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
