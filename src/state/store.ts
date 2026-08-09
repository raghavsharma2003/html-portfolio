// Lightweight app state persisted to localStorage — no external state library needed.

import { useEffect, useState } from "react";
import type { UserProfile } from "../engine/persona";

export interface Message {
  id: string;
  from: "her" | "me";
  kind: "text" | "photo";
  text: string; // for photos this is the caption
  photoSeed?: string; // deterministic seed for the generated photo card
  at: number;
}

export interface AppState {
  onboarded: boolean;
  user: UserProfile;
  messages: Message[];
  apiKey: string; // Claude API key — pasted later by the owner in Settings
  elevenKey: string; // ElevenLabs key — unlocks her human voice
  elevenVoiceId: string; // ElevenLabs voice id (pick an Indian female voice)
  deviceVoice: string; // preferred on-device TTS voice (fallback tier)
  lastSeen: number;
}

const KEY = "meera.state.v1";

export const defaultState: AppState = {
  onboarded: false,
  user: { name: "", vibe: [], facts: {} },
  messages: [],
  apiKey: "",
  elevenKey: "",
  elevenVoiceId: "",
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
