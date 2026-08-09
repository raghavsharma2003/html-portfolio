// Reply brain: prefers Claude (when an API key is set in Settings),
// falls back to the offline heart engine on any failure.

import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, buildSpeechStyle, type UserProfile } from "./persona";
import { heartReply, type HeartReply } from "./localHeart";
import type { Message } from "../state/store";

const MODEL = "claude-opus-5";

export type ThinkMode = "chat" | "call";

// Make device-spoken text breathe: openers, thinking pauses. Used on the
// offline heart's replies when they're spoken on a call.
export function humanizeForSpeech(text: string): string {
  let t = text;
  if (Math.random() < 0.45) {
    const openers = ["hmm... ", "acha... ", "arrey ", "mmm, "];
    t = openers[Math.floor(Math.random() * openers.length)] + t;
  }
  // let some sentence breaks become soft trailing pauses
  t = t.replace(/\. /g, () => (Math.random() < 0.3 ? "... " : ". "));
  return t;
}

function parseBubbles(raw: string): HeartReply {
  const out: HeartReply = { bubbles: [] };
  for (const part of raw.split(/\n?---\n?/)) {
    const p = part.trim();
    if (!p) continue;
    const photo = p.match(/^\[photo:\s*(.+?)\]$/i);
    if (photo) {
      out.photo = { seed: photo[1] + Date.now(), caption: photo[1] };
    } else {
      out.bubbles.push(p.replace(/^["']|["']$/g, ""));
    }
  }
  if (!out.bubbles.length && !out.photo) out.bubbles = [raw.trim() || "mm say that again? 🥺"];
  return out;
}

export async function think(
  user: UserProfile,
  apiKey: string,
  history: Message[],
  latest: string,
  mode: ThinkMode = "chat",
  expressiveVoice = false,
): Promise<HeartReply> {
  // learn facts locally regardless of which engine answers
  const local = heartReply(user, latest, history.length);
  if (mode === "call") {
    local.bubbles = [humanizeForSpeech(local.bubbles.join(" "))];
    local.photo = undefined;
  }

  if (!apiKey) return local;

  try {
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

    const turns: Anthropic.MessageParam[] = [];
    for (const m of history.slice(-30)) {
      const text = m.kind === "photo" ? `[shared a photo: ${m.text}]` : m.text;
      const role = m.from === "me" ? "user" : "assistant";
      const prev = turns[turns.length - 1];
      if (prev && prev.role === role) {
        prev.content = `${prev.content}\n${text}`;
      } else {
        turns.push({ role, content: text });
      }
    }
    if (!turns.length || turns[turns.length - 1].role !== "user") {
      turns.push({ role: "user", content: latest });
    }
    if (turns[0]?.role !== "user") turns.shift();

    const system =
      mode === "call"
        ? buildSystemPrompt(user) + buildSpeechStyle(expressiveVoice)
        : buildSystemPrompt(user);

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      output_config: { effort: "low" },
      system,
      messages: turns,
    });

    if (response.stop_reason === "refusal") return local;

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    if (!text.trim()) return local;

    const parsed = parseBubbles(text);
    parsed.learned = local.learned;
    if (mode === "call") {
      parsed.bubbles = [parsed.bubbles.join(" ")];
      parsed.photo = undefined;
    }
    return parsed;
  } catch {
    return local; // network/auth failure → she still answers, seamlessly
  }
}
