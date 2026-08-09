// Voice layer. On Android (Capacitor) we use native TTS + native speech
// recognition — WebView's speechSynthesis is flaky past ~15s and
// webkitSpeechRecognition simply doesn't exist there. In a desktop browser
// we fall back to the Web Speech API, chunked to dodge the 15-second bug.

import { Capacitor } from "@capacitor/core";
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { SpeechRecognition as NativeSR } from "@capgo/capacitor-speech-recognition";

const isNative = Capacitor.isNativePlatform();

/* ─────────────────────────── TTS ─────────────────────────── */

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

function cleanForSpeech(text: string): string {
  return text
    .replace(/\[photo:[^\]]*\]/gi, "")
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{2764}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// split into ≤180-char sentence chunks (Chrome/WebView kills long utterances)
function chunk(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > 180 && cur) {
      out.push(cur.trim());
      cur = s;
    } else {
      cur += s;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

let speakSession = 0;

export async function speak(text: string, onStart?: () => void, onEnd?: () => void) {
  const session = ++speakSession;
  const clean = cleanForSpeech(text);
  if (!clean) {
    onEnd?.();
    return;
  }

  if (isNative) {
    try {
      onStart?.();
      await TextToSpeech.speak({
        text: clean,
        lang: "en-IN",
        rate: 0.98,
        pitch: 1.1,
        volume: 1.0,
        category: "playback",
      });
    } catch {
      /* device without TTS engine */
    }
    if (session === speakSession) onEnd?.();
    return;
  }

  const synth = window.speechSynthesis;
  if (!synth) {
    onStart?.();
    setTimeout(() => onEnd?.(), Math.min(6000, 500 + clean.length * 55));
    return;
  }
  synth.cancel();
  const parts = chunk(clean);
  let started = false;
  const speakPart = (i: number) => {
    if (session !== speakSession) return;
    if (i >= parts.length) {
      onEnd?.();
      return;
    }
    const u = new SpeechSynthesisUtterance(parts[i]);
    const v = pickWebVoice();
    if (v) u.voice = v;
    u.rate = 0.98;
    u.pitch = 1.1;
    u.onstart = () => {
      if (!started) {
        started = true;
        onStart?.();
      }
    };
    u.onend = () => speakPart(i + 1);
    u.onerror = () => speakPart(i + 1);
    synth.speak(u);
  };
  speakPart(0);
}

export function stopSpeaking() {
  speakSession++;
  if (isNative) {
    TextToSpeech.stop().catch(() => {});
  } else {
    window.speechSynthesis?.cancel();
  }
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
