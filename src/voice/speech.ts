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

function stripForCloud(text: string): string {
  return stripProtocol(text)
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
let speechBus: GainNode | null = null; // her voice routes here → duckable

function speechOut(): AudioNode {
  if (!audioCtx) return null as unknown as AudioNode;
  if (!speechBus) {
    speechBus = audioCtx.createGain();
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

async function meeraFetch(text: string, style?: string): Promise<Blob | null> {
  try {
    const res = await fetch(PROXY_SPEECH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, ...(style ? { style } : {}) }),
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
    fetchClipFor(text, opts, style).then(settle, () => settle(null));
    timer = setTimeout(launchHedge, 2400); // primary slow — race a second try
  });
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

  // pipeline: kick off fetch N+1 while N plays; the first clip is hedged
  const fetches: Array<Promise<Blob | null>> = [hedgedClipFor(phrases[0], opts, style)];
  let started = false;
  for (let i = 0; i < phrases.length; i++) {
    if (session !== speakSession) return;
    if (i + 1 < phrases.length) fetches[i + 1] = fetchClipFor(phrases[i + 1], opts, style);
    const blob = await fetches[i];
    if (session !== speakSession) return;
    if (!blob) continue;
    if (!started) {
      started = true;
      onStart?.();
    }
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
  const queue: Array<Promise<Blob | null>> = [];

  const emit = (phrase: string) => {
    const clean = stripForCloud(phrase);
    if (!clean) return;
    // leaked internal monologue must never be SPOKEN either — a phrase
    // mentioning models/modes/prompts is planning bleed, not conversation
    if (/\b(base model|minimal text|text mode|system prompt|language model|as an ai|reasoning|max.?_?tokens|persona prompt|default model|output format)\b/i.test(clean))
      return;
    allText += (allText ? " " : "") + clean;
    // fetch starts NOW; the first clip (the one awaited in silence) is hedged
    queue.push(
      queue.length === 0 && !started
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
      const blob = await next;
      if (session !== speakSession) return;
      if (blob) {
        if (!started) {
          started = true;
          onStart?.();
        }
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
      if (!firstOut && buf.length >= 38 && !/[.!?…]/.test(buf)) {
        const head = buf.slice(0, 38);
        const at = Math.max(head.lastIndexOf(","), head.lastIndexOf(" "));
        if (at > 18) {
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
  for (const b of BACKCHANNELS) await load(b, backchannelClips);
  for (const f of FILLERS) await load(f, fillerClips);
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

// onEnd carries WHY the session ended: "" = normal silence timeout (re-arm),
// "not-allowed" = permission denied (stop re-arming, surface the keyboard),
// "error" = transient failure (re-arm with backoff)
export function listen(
  onText: (text: string, final: boolean) => void,
  onEnd: (reason?: string) => void,
): STTResult {
  if (isNative) {
    let stopped = false;
    let last = "";
    (async () => {
      try {
        const avail = await NativeSR.available();
        if (!avail.available) {
          onEnd("not-allowed");
          return;
        }
        if (stopped) return; // stop() raced our async init — don't start
        const perm = await NativeSR.requestPermissions();
        if (perm.speechRecognition !== "granted") {
          onEnd("not-allowed");
          return;
        }
        if (stopped) return;
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
        if (stopped) return; // teardown happened mid-init — keep the mic off
        await NativeSR.start({
          language: "en-IN",
          partialResults: true,
          popup: false,
        });
        if (stopped) NativeSR.stop().catch(() => {});
      } catch {
        onEnd("error");
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
