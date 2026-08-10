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
  photoUrl?: string; // photos the USER sent (public storage url)
  desc?: string; // user photos: one-line vision description (context + memory)
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
  // clear-chat tombstone: synced so a wiped chat can never be resurrected
  // by another device's stale copy
  clearedAt?: number;
  // the account this local state last belonged to — guards against a second
  // account on the same browser inheriting the first account's conversation
  lastAccountId?: string;
}

const KEY = "meera.state.v1";
const DEVICE_KEY = "meera.device.v1";

// every install gets its own valid v4 UUID — memory/log/state are all keyed
// by it server-side, so no two users can ever share or mix data
function freshDeviceId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) =>
    c === "x" ? hex() : ((Math.floor(Math.random() * 4) + 8).toString(16)),
  );
}

// deviceId lives under its OWN key: a corrupt/overflowing state blob must
// never orphan the server-side memory graph it keys
function stableDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const fresh = freshDeviceId();
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return freshDeviceId();
  }
}

export function rotateDeviceId(): string {
  const fresh = freshDeviceId();
  try {
    localStorage.setItem(DEVICE_KEY, fresh);
  } catch {
    /* in-memory only */
  }
  return fresh;
}

export const defaultState: AppState = {
  onboarded: false,
  deviceId: stableDeviceId(),
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

// repair messages stored by older builds: annotation text that should have
// been a real gif, and leaked clock stamps — they live in localStorage
// forever unless fixed here
function migrateMessages(messages: Message[]): Message[] {
  // internal-vocabulary leak (mirror of brain.ts META_LEAK): her stored
  // bubbles that slipped through older builds get erased from history
  const leak =
    /\b(base model|minimal text|text mode|chat mode|call mode|system prompt|language model|ai model|reasoning effort|max.?_?tokens|persona (prompt|instruction)|default model|llm|assistant mode|output format)\b/i;
  return messages
    .map((m) => {
      if (m.kind !== "text" || m.from !== "her") return m;
      if (leak.test(m.text)) return { ...m, text: "" }; // filtered out below
      const gm = m.text.match(/^\[sent a meme gif:\s*([^\]]+)\]$/i);
      if (gm) return { ...m, kind: "gif" as const, text: gm[1].trim(), gifUrl: undefined };
      const stripped = m.text
        .replace(/\[\d{1,2}:\d{2}\s*(?:am|pm)?\]/gi, "")
        .replace(/\[\s*(?:tone|followup|sent a meme gif|shared a photo)\s*:[^\]]*\]?/gi, "")
        .trim();
      return stripped !== m.text ? { ...m, text: stripped } : m;
    })
    .filter((m) => m.kind !== "text" || m.text);
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultState };
    const parsed = { ...defaultState, ...JSON.parse(raw) };
    parsed.messages = migrateMessages(parsed.messages);
    return parsed;
  } catch {
    return { ...defaultState };
  }
}

// data: URLs (photos whose upload failed) are huge — never let them brick
// persistence. Strip them from the stored copy; the desc/caption survives.
function persistable(s: AppState, keep: number): string {
  return JSON.stringify({
    ...s,
    messages: s.messages.slice(-keep).map((m) =>
      m.photoUrl && m.photoUrl.startsWith("data:") && m.photoUrl.length > 60_000
        ? { ...m, photoUrl: undefined }
        : m,
    ),
  });
}

export function saveState(s: AppState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return;
  } catch {
    /* storage full — strip heavy photo data, then halve until it fits */
  }
  for (const keep of [400, 200, 100, 50]) {
    try {
      localStorage.setItem(KEY, persistable(s, keep));
      return;
    } catch {
      /* still too big — halve again */
    }
  }
}

export function useAppState() {
  const [state, setState] = useState<AppState>(loadState);
  useEffect(() => saveState(state), [state]);
  // multi-tab: when another tab writes state, adopt whichever copy has more
  // recent life in it — otherwise two open tabs ping-pong stale writes (and
  // both fire her follow-up timer)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY || !e.newValue) return;
      try {
        const incoming = JSON.parse(e.newValue) as AppState;
        setState((cur) => {
          const inLast = incoming.messages?.[incoming.messages.length - 1]?.at ?? 0;
          const curLast = cur.messages[cur.messages.length - 1]?.at ?? 0;
          const inCleared = incoming.clearedAt ?? 0;
          const curCleared = cur.clearedAt ?? 0;
          if (inLast > curLast || inCleared > curCleared) {
            return { ...defaultState, ...incoming };
          }
          return cur;
        });
      } catch {
        /* corrupt cross-tab write — ignore */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return [state, setState] as const;
}

export const uid = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
