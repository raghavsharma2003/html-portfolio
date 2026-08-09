// Reply brain, in priority order:
//   1. OpenRouter (open-source models — cheap, strong; used directly when the
//      owner pastes their key in Settings; DeepSeek by default)
//   2. Claude (optional alternative, if that key is set instead)
//   3. Hosted proxy (our Vercel function holds an OpenRouter key server-side,
//      so a fresh install has a real brain with zero setup)
//   4. Offline heart engine (always available fallback)

import Anthropic from "@anthropic-ai/sdk";
import { Capacitor } from "@capacitor/core";
import {
  buildSystemPrompt,
  buildSpeechStyle,
  type UserProfile,
  type VoiceEngine,
} from "./persona";
import { heartReply, type HeartReply } from "./localHeart";
import type { Message } from "../state/store";

const CLAUDE_MODEL = "claude-opus-5";
// Default brain: Gemini 3.6 Flash — the best modern-Hinglish register we
// auditioned (vs deepseek, kimi, minimax, llama). Overridable via model slug.
export const OPENROUTER_DEFAULT_MODEL = "google/gemini-3.6-flash";
// Serverless proxy that holds an OpenRouter key server-side — the zero-config
// brain. On the website it's same-origin; the Android app crosses origins.
const PROXY_URL = Capacitor.isNativePlatform()
  ? "https://meera-silk.vercel.app/api/chat"
  : "/api/chat";

export type ThinkMode = "chat" | "call";

export interface BrainKeys {
  openrouterKey?: string;
  openrouterModel?: string;
  apiKey?: string; // Claude
}

// Make device-spoken text breathe: openers, thinking pauses. Used on the
// offline heart's replies when they're spoken on a call.
export function humanizeForSpeech(text: string): string {
  let t = text;
  if (Math.random() < 0.45) {
    const openers = ["hmm... ", "acha... ", "arrey ", "mmm, "];
    t = openers[Math.floor(Math.random() * openers.length)] + t;
  }
  t = t.replace(/\. /g, () => (Math.random() < 0.3 ? "... " : ". "));
  return t;
}

// No real girl sends a paragraph: bubbles that come back too long are split
// again at sentence-ish boundaries, as a hard guarantee.
function splitLong(bubble: string): string[] {
  if (bubble.length <= 90) return [bubble];
  const parts = bubble.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    if ((cur + " " + p).trim().length > 90 && cur) {
      out.push(cur.trim());
      cur = p;
    } else {
      cur = (cur ? cur + " " : "") + p;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.length ? out : [bubble];
}

function parseBubbles(raw: string): HeartReply {
  const out: HeartReply = { bubbles: [] };
  // models separate thoughts with "---" or plain newlines — both are bubbles
  for (const part of raw.split(/\n?---\n?|\n+/)) {
    const p = part.trim();
    if (!p) continue;
    const photo = p.match(/^\[photo:\s*(.+?)\]$/i);
    if (photo) {
      out.photo = { seed: photo[1] + Date.now(), caption: photo[1] };
    } else if (/^\*[^*]+\*$/.test(p)) {
      // "*flips through sketchbook*" roleplay actions — hard-dropped
      continue;
    } else {
      out.bubbles.push(...splitLong(p.replace(/^["']|["']$/g, "")));
    }
  }
  out.bubbles = out.bubbles.slice(0, 4);
  if (!out.bubbles.length && !out.photo) out.bubbles = [raw.trim() || "hmm? phir se bolo"];
  return out;
}

function toTurns(history: Message[], latest: string) {
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
  let lastChannel: "chat" | "call" = "chat";
  for (const m of history.slice(-30)) {
    if (m.kind === "callmark") continue; // call-record chip, not conversation
    let text = m.kind === "photo" ? `[shared a photo: ${m.text}]` : m.text;
    if (m.replyTo) {
      const who = m.replyTo.from === "her" ? "your message" : "their own message";
      text = `[replying to ${who}: "${m.replyTo.text.slice(0, 60)}"] ${text}`;
    }
    // mark medium switches so she remembers what was SAID on a call vs texted
    const ch = m.channel === "call" ? "call" : "chat";
    if (ch !== lastChannel) {
      text = (ch === "call" ? "[a voice call starts]\n" : "[the call ended, back to texting]\n") + text;
      lastChannel = ch;
    }
    const role = m.from === "me" ? ("user" as const) : ("assistant" as const);
    const prev = turns[turns.length - 1];
    if (prev && prev.role === role) prev.content = `${prev.content}\n${text}`;
    else turns.push({ role, content: text });
  }
  if (!turns.length || turns[turns.length - 1].role !== "user") {
    turns.push({ role: "user", content: latest });
  }
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
}

async function openrouterThink(
  keys: BrainKeys,
  system: string,
  turns: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<string | null> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${keys.openrouterKey}`,
        "Content-Type": "application/json",
        "X-Title": "Meera",
      },
      body: JSON.stringify({
        model: keys.openrouterModel?.trim() || OPENROUTER_DEFAULT_MODEL,
        messages: [{ role: "system", content: system }, ...turns],
        max_tokens: 700,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() ? text : null;
  } catch {
    return null;
  }
}

async function proxyThink(
  keys: BrainKeys,
  system: string,
  turns: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<string | null> {
  try {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system,
        messages: turns,
        model: keys.openrouterModel?.trim() || OPENROUTER_DEFAULT_MODEL,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.text === "string" && data.text.trim() ? data.text : null;
  } catch {
    return null;
  }
}

async function claudeThink(
  keys: BrainKeys,
  system: string,
  turns: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<string | null> {
  try {
    const client = new Anthropic({ apiKey: keys.apiKey!, dangerouslyAllowBrowser: true });
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      output_config: { effort: "low" },
      system,
      messages: turns,
    });
    if (response.stop_reason === "refusal") return null;
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

export async function think(
  user: UserProfile,
  keys: BrainKeys,
  history: Message[],
  latest: string,
  mode: ThinkMode = "chat",
  voiceEngine: VoiceEngine = "device",
  // directive turns (open/nudge context notes) carry no user text to learn
  // from, and on failure they produce silence instead of a canned reply
  isDirective = false,
): Promise<HeartReply> {
  // learn facts locally regardless of which engine answers
  const local: HeartReply = isDirective
    ? { bubbles: [] }
    : heartReply(user, latest, history.length);
  if (mode === "call" && !isDirective) {
    local.bubbles = [humanizeForSpeech(local.bubbles.join(" "))];
    local.photo = undefined;
  }

  const system =
    mode === "call"
      ? buildSystemPrompt(user, history.length) + buildSpeechStyle(voiceEngine)
      : buildSystemPrompt(user, history.length);
  const turns = toTurns(history, latest);

  let text: string | null = null;
  if (keys.openrouterKey) text = await openrouterThink(keys, system, turns);
  if (!text && keys.apiKey) text = await claudeThink(keys, system, turns);
  if (!text) text = await proxyThink(keys, system, turns);
  if (!text) {
    // every brain unreachable. crisis/honesty replies still go out; anything
    // else becomes an honest connectivity text — never fake conversation.
    if (local.critical) return local;
    if (isDirective) return { bubbles: [] };
    const oops = [
      ["yaar net kuch ajeeb kar rha", "ek min"],
      ["arre mere msg nhi ja rhe theek se 😭", "ruk"],
      ["net dikkat kar rha lagta h", "abhi aati hu"],
    ];
    return {
      bubbles: oops[Math.floor(Math.random() * oops.length)],
      learned: local.learned,
    };
  }

  const parsed = parseBubbles(text);
  parsed.learned = local.learned;
  if (mode === "call") {
    parsed.bubbles = [parsed.bubbles.join(" ")];
    parsed.photo = undefined;
  }
  return parsed;
}
