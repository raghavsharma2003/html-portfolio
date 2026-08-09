// Lightweight app state persisted to localStorage — no external state library needed.

import { useEffect, useState } from "react";
import type { UserProfile } from "../engine/persona";

export interface Message {
  id: string;
  from: "her" | "me";
  // "callmark" renders as a centered "📞 Voice call · m:ss" record;
  // "voice" is a voice-note bubble; "gif" is a meme gif bubble
  kind: "text" | "photo" | "callmark" | "voice" | "gif";
  text: string; // for photos this is the caption
  photoSeed?: string; // deterministic seed for the generated photo card
  at: number;
  // my messages only: ✓ sent → ✓✓ delivered → blue ✓✓ read (when she reads).
  // absent on old messages = read.
  status?: "sent" | "delivered" | "read";
  // WhatsApp-style quote: set when this message replies to a specific one
  replyTo?: { from: "her" | "me"; text: string };
  // "call" turns are spoken words: hidden from the chat UI, but fed to the
  // brain so she remembers call conversations perfectly
  channel?: "chat" | "call";
  dur?: number; // voice notes: length in seconds
  spoken?: string; // her voice notes: raw expressive text (with audio tags)
  gifUrl?: string; // gif bubbles: resolved CDN url (cached after first fetch)
}

export interface AuthInfo {
  userId: string;
  email?: string;
  phone?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface AppState {
  onboarded: boolean;
  auth?: AuthInfo | null; // signed-in account (null/undefined = anonymous)
  deviceId: string; // anonymous identity for the memory backend
  user: UserProfile;
  messages: Message[];
  openrouterKey: string; // OpenRouter key — her primary brain (open models)
  openrouterModel: string; // OpenRouter model slug; sensible default provided
  apiKey: string; // Claude API key — optional alternative brain
  elevenKey: string; // ElevenLabs key — expressive voice (laughs, whispers)
  elevenVoiceId: string; // ElevenLabs voice id (default: Monika Sogam, Hindi)
  sarvamKey: string; // Sarvam AI key — best Hinglish voice (bulbul:v3)
  deviceVoice: string; // preferred on-device TTS voice (fallback tier)
  lastSeen: number;
  // her self-scheduled follow-up ("back in 20 min" → she texts first)
  followup?: { at: number; why: string } | null;
}

const KEY = "meera.state.v1";

export const defaultState: AppState = {
  onboarded: false,
  deviceId:
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-0000-4000-8000-000000000000`,
  user: { name: "", vibe: [], facts: {} },
  messages: [],
  openrouterKey: "",
  openrouterModel: "",
  apiKey: "",
  elevenKey: "",
  elevenVoiceId: "",
  sarvamKey: "",
  deviceVoice: "",
  lastSeen: Date.now(),
};

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultState };
    return { ...defaultState, ...JSON.parse(raw) };
  } catch {
    return { ...defaultState };
  }
}

export function saveState(s: AppState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full — drop oldest half of messages and retry */
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ ...s, messages: s.messages.slice(-200) }),
      );
    } catch {
      /* give up quietly */
    }
  }
}

export function useAppState() {
  const [state, setState] = useState<AppState>(loadState);
  useEffect(() => saveState(state), [state]);
  return [state, setState] as const;
}

export const uid = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
