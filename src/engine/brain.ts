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
  buildSystemPromptParts,
  buildSpeechStyle,
  WATCH_MODE_NOTE,
  type UserProfile,
  type VoiceEngine,
} from "./persona";
import { heartReply, type HeartReply } from "./localHeart";
import { recallMemories } from "./memory";
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
  deviceId?: string; // enables graph-memory recall via /api/memory
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

// Internal vocabulary that must NEVER reach the user. A real friend never
// says "base model", "text mode" or "system prompt" — these phrases only
// exist when the model's internal planning bleeds into the reply channel.
// Any bubble containing one is dropped whole: losing a bubble is invisible,
// leaking internals kills the product.
const META_LEAK =
  /\b(base model|minimal text|text mode|chat mode|call mode|system prompt|language model|as an ai\b|ai model|reasoning effort|max.?_?tokens|token (limit|budget)|persona (prompt|instruction)|instruction(s)? (say|state|require)|default model|llm|assistant mode|output format)\b/i;

export function parseBubbles(raw: string): HeartReply {
  const out: HeartReply = { bubbles: [] };
  // ── protocol extraction, GLOBAL and lenient: markers are honored wherever
  // they appear (own line, inline, sloppy spacing, dropped closing bracket) —
  // anything that looks like protocol must never reach the user as text ──
  raw = raw.replace(/\[\s*tone\s*:\s*([^\]\n]*)\]?/gi, (_m, mood) => {
    if (!out.tone && mood.trim()) out.tone = mood.trim().slice(0, 120);
    return "";
  });
  raw = raw.replace(/\[\s*photo\s*:\s*([^\]\n]+?)\s*\]/gi, (_m, body: string) => {
    if (!out.photo) {
      const [tagPart, ...capParts] = body.split("|");
      const caption = capParts.join("|").trim() || tagPart.trim();
      out.photo = { seed: body, caption };
    }
    return "";
  });
  raw = raw.replace(/\[\s*voicenote\s*:\s*([^\]]+?)\s*\]/gi, (_m, body: string) => {
    if (!out.voice) out.voice = { text: body.replace(/\s+/g, " ").trim() };
    return "";
  });
  raw = raw.replace(/\[\s*gif\s*:\s*([^\]\n]+?)\s*\]/gi, (_m, q: string) => {
    if (!out.gif) out.gif = { query: q.trim() };
    return "";
  });
  // the model sometimes imitates the HISTORY annotation format instead of
  // the live protocol ("[sent a meme gif: x]" is how we describe her past
  // gifs to her) — honor the intent: actually send the gif/photo
  raw = raw.replace(/\[\s*sent a meme gif\s*:\s*([^\]\n]+)\s*\]?/gi, (_m, q: string) => {
    if (!out.gif && q.trim()) out.gif = { query: q.trim() };
    return "";
  });
  raw = raw.replace(/\[\s*shared a photo\s*:\s*([^\]\n]+)\s*\]?/gi, (_m, body: string) => {
    if (!out.photo && body.trim()) {
      const [tagPart, ...capParts] = body.split("|");
      out.photo = { seed: body, caption: capParts.join("|").trim() || tagPart.trim() };
    }
    return "";
  });
  raw = raw.replace(/\[\s*followup\s*:\s*(\d+)\s*(?:\|\s*([^\]\n]*))?\]?/gi, (_m, mins, why) => {
    const minutes = Math.min(360, Math.max(2, parseInt(mins, 10) || 0));
    if (minutes && !out.followup) out.followup = { minutes, why: (why || "").trim().slice(0, 120) };
    return "";
  });
  // catch-all: any residual protocol-shaped marker (unclosed, non-numeric
  // followup, unknown variant), imitated history annotations, and any
  // imitated clock stamp, ANYWHERE
  raw = raw
    .replace(/\[\s*(?:tone|followup|photo|voicenote|gif)\s*:[^\]]*\]?/gi, "")
    .replace(/\[\s*(?:voice note|they sent a photo|replying to|a voice call starts|the call ended)[^\]]*\]?/gi, "")
    .replace(/\[\d{1,2}:\d{2}\s*(?:am|pm)?\]/gi, "");

  // models separate thoughts with "---" or plain newlines — both are bubbles
  for (const part of raw.split(/\n?---\n?|\n+/)) {
    let p = part.trim();
    if (!p) continue;
    // meta-text leakage guard: the model occasionally narrates its own
    // formatting ("Bubble 1:", "separators.", instruction bullets). None of
    // that is conversation — strip labels, drop pure scaffolding.
    p = p.replace(/^bubble\s*\d+\s*:\s*/i, "").trim();
    // she must never echo the system's own history metadata: gap markers
    // ("[2 hours later, …]"), medium markers
    p = p
      .replace(/^\[\d+\s*(?:minutes?|hours?|days?)\s+later[^\]]*\]\s*/i, "")
      .replace(/^\[(?:a voice call starts|the call ended[^\]]*)\]\s*/i, "")
      .trim();
    if (!p) continue;
    if (/^(bubble\s*\d*\s*[:.]?|separators?\.?|styling with.*|formats?[:.]?|protocols?[:.]?|\(.*protocol.*\)|response[:.]?|reply[:.]?)$/i.test(p)) continue;
    if (/^-\s+/.test(p)) {
      // dash bullet: leaked instruction text is dropped, but a real message
      // that happens to start with a dash keeps its words
      if (p.length > 40 || /short|sharp|charming|bubble|separator|style|format|reply|tone/i.test(p)) continue;
      p = p.replace(/^-\s+/, "");
      if (!p) continue;
    }
    if (/^\*[^*]+\*$/.test(p)) {
      // "*flips through sketchbook*" roleplay actions — hard-dropped
      continue;
    }
    if (META_LEAK.test(p)) continue; // leaked internal monologue — never shown
    // tail of a mangled marker ("ide eye cat]"): a short line ending with a
    // bracket it never opened is protocol shrapnel, not conversation
    if (/\]\s*$/.test(p) && !p.includes("[") && p.length < 60) continue;
    // brackets simply do not exist in real texting. Anything bracketed that
    // survived marker extraction is a stage direction ("[slightly out of
    // breath...]") or shrapnel — remove the content and the stray brackets.
    p = p
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\[[^\]]*$/, " ")
      .replace(/[\[\]]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!p) continue;
    out.bubbles.push(...splitLong(p.replace(/^["']|["']$/g, "")));
  }
  out.bubbles = out.bubbles.slice(0, 4);
  // leaks can hide inside media payloads too (a spoken voicenote, a caption)
  if (out.voice && META_LEAK.test(out.voice.text)) out.voice = undefined;
  if (out.gif && META_LEAK.test(out.gif.query)) out.gif = undefined;
  if (out.photo && META_LEAK.test(out.photo.caption)) out.photo.caption = "";
  // fallback ONLY when the reply carried nothing at all — a gif/voicenote/
  // photo-only reply is complete without text (and raw is already cleaned).
  // The fallback itself must pass the leak filter too.
  if (!out.bubbles.length && !out.photo && !out.voice && !out.gif) {
    const rawTrim = raw.replace(/\s+/g, " ").trim();
    const wasShrapnel = /\]\s*$/.test(rawTrim) && !rawTrim.includes("[") && rawTrim.length < 60;
    const residual = rawTrim
      .replace(/\[[^\]]*\]?/g, " ") // stage directions / unclosed brackets
      .replace(/[\[\]]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);
    out.bubbles = [residual && !META_LEAK.test(residual) && !wasShrapnel ? residual : "hmm?"];
  }
  return out;
}

// humanized gap label so she feels elapsed time the way a person does
function gapLabel(ms: number, at: number): string {
  const when = new Date(at).toLocaleString("en-IN", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  const mins = Math.round(ms / 60000);
  if (mins < 90) return `${mins} minutes later`;
  const hrs = Math.round(mins / 60);
  if (hrs < 20) return `${hrs} hours later, now ${when}`;
  const days = Math.round(hrs / 24);
  return `${days} day${days > 1 ? "s" : ""} later, ${when}`;
}

const GAP_MIN = 30 * 60_000;

type TurnContent = string | Array<Record<string, unknown>>;

function toTurns(history: Message[], latest: string) {
  const turns: Array<{ role: "user" | "assistant"; content: TurnContent }> = [];
  let lastChannel: "chat" | "call" = "chat";
  let prevAt = 0;
  // callmark chips are records, not conversation — filter BEFORE windowing
  // so they don't shrink the 30-turn context or the 6-turn vision window
  const recent = history.filter((m) => m.kind !== "callmark").slice(-30);
  // she SEES actual images for photos in the last few turns; older ones
  // survive as their stored one-line descriptions
  const visionCutoff = recent.length - 6;
  for (let mi = 0; mi < recent.length; mi++) {
    const m = recent[mi];
    const userImage = m.from === "me" && m.kind === "photo" && m.photoUrl;
    const photoNote = m.from === "me" ? m.text || m.desc || "" : "";
    let text =
      m.kind === "photo"
        ? m.from === "me"
          ? `[they sent a photo${photoNote && photoNote !== "[photo]" ? `: ${photoNote}` : ""}]`
          : `[shared a photo: ${m.text}]`
        : m.kind === "voice"
          ? m.text.startsWith("[voice")
            ? m.text
            : `[voice note] ${m.text}`
          : m.kind === "gif"
            ? `[sent a meme gif: ${m.text}]`
            : m.text;
    if (m.replyTo) {
      const who = m.replyTo.from === "her" ? "your message" : "their own message";
      text = `[replying to ${who}: "${m.replyTo.text.slice(0, 60)}"] ${text}`;
    }
    // real time passing between messages becomes visible to her
    if (prevAt && m.at - prevAt > GAP_MIN) {
      text = `[${gapLabel(m.at - prevAt, m.at)}]\n` + text;
    }
    if (m.at) prevAt = m.at;
    // mark medium switches so she remembers what was SAID on a call vs texted
    const ch = m.channel === "call" ? "call" : "chat";
    if (ch !== lastChannel) {
      text = (ch === "call" ? "[a voice call starts]\n" : "[the call ended, back to texting]\n") + text;
      lastChannel = ch;
    }
    const role = m.from === "me" ? ("user" as const) : ("assistant" as const);
    const stamp = m.at
      ? new Date(m.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })
      : "";
    const stamped = stamp ? `[${stamp}] ${text}` : text;
    const prev = turns[turns.length - 1];
    if (userImage && mi >= visionCutoff) {
      // multimodal parts: the model looks at the real image. Merged into an
      // adjacent same-role turn — consecutive same-role messages 400 on
      // strict-alternation chat templates.
      const parts: Array<Record<string, unknown>> = [
        { type: "text", text: stamped },
        { type: "image_url", image_url: { url: m.photoUrl } },
      ];
      if (prev && prev.role === role) {
        if (typeof prev.content === "string") {
          prev.content = [{ type: "text", text: prev.content }, ...parts];
        } else {
          prev.content.push(...parts);
        }
      } else {
        turns.push({ role, content: parts });
      }
      continue;
    }
    if (prev && prev.role === role) {
      // bursts merge into one turn, KEEPING each message's clock stamp
      if (typeof prev.content === "string") {
        prev.content = `${prev.content}\n${stamped}`;
      } else {
        prev.content.push({ type: "text", text: stamped });
      }
    } else {
      turns.push({ role, content: stamped });
    }
  }
  if (!turns.length || turns[turns.length - 1].role !== "user") {
    // directive/nudge turns happen "now" — surface the gap since the last
    // real message so she knows how much time has passed
    const gap = prevAt && Date.now() - prevAt > GAP_MIN ? `[${gapLabel(Date.now() - prevAt, Date.now())}]\n` : "";
    turns.push({ role: "user", content: gap + latest });
  }
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
}

type Turn = { role: "user" | "assistant"; content: TurnContent };

async function openrouterThink(
  keys: BrainKeys,
  system: string,
  turns: Turn[],
  maxTokens = 700,
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
        max_tokens: maxTokens,
      }),
      // a hung request must never brick the chat (busy) or the call (silence)
      signal: AbortSignal.timeout(30_000),
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
  // volatile suffix sent separately: the proxy pins a cache breakpoint on
  // `system` (byte-stable) so ~85% of input tokens bill at the cached rate
  systemTail: string,
  turns: Turn[],
  maxTokens = 700,
  // calls stream tokens so speech can start on the first sentence
  onDelta?: (delta: string) => void,
  noThink = false,
): Promise<string | null> {
  try {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system,
        system_tail: systemTail || undefined,
        messages: turns,
        model: keys.openrouterModel?.trim() || OPENROUTER_DEFAULT_MODEL,
        max_tokens: maxTokens,
        ...(onDelta ? { stream: true } : {}),
        ...(noThink ? { no_think: true } : {}),
      }),
      // streams get longer to finish, but can still never hang forever
      signal: AbortSignal.timeout(onDelta ? 90_000 : 30_000),
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "";
    if (onDelta && type.includes("text/event-stream") && res.body) {
      // SSE: accumulate deltas, surface each as it lands
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let full = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;
          try {
            const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta) {
              full += delta;
              onDelta(delta);
            }
          } catch {
            /* keep-alive / partial frame */
          }
        }
      }
      return full.trim() ? full : null;
    }
    const data = await res.json();
    return typeof data?.text === "string" && data.text.trim() ? data.text : null;
  } catch {
    return null;
  }
}

async function claudeThink(
  keys: BrainKeys,
  system: string,
  turns: Turn[],
): Promise<string | null> {
  // flatten multimodal parts — this path is text-only
  const flat = turns.map((t) => ({
    role: t.role,
    content:
      typeof t.content === "string"
        ? t.content
        : t.content.map((p: any) => (p.type === "text" ? p.text : "[photo]")).join(" "),
  }));
  try {
    const client = new Anthropic({ apiKey: keys.apiKey!, dangerouslyAllowBrowser: true });
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      output_config: { effort: "low" },
      system,
      messages: flat,
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
  // call mode: raw model tokens as they stream (proxy path only) — lets the
  // call engine start speaking the first sentence while the rest generates
  onDelta?: (delta: string) => void,
  // call mode: graph memories prefetched at pickup (per-turn recall would
  // put a lookup in front of every spoken reply)
  extraMemories?: string,
  // watch-together: the current screen frame (data URL) — she SEES it
  watchFrame?: string,
): Promise<HeartReply> {
  // learn facts locally regardless of which engine answers
  const local: HeartReply = isDirective
    ? { bubbles: [] }
    : heartReply(user, latest, history.length);
  if (mode === "call" && !isDirective) {
    local.bubbles = [humanizeForSpeech(local.bubbles.join(" "))];
    local.photo = undefined;
  }

  // on a call the core itself is voice-native: no texting register, no
  // photo/gif protocols, and an explicit "they are SPEAKING, not typing"
  // framing — she must never ask about typos on a phone call
  const parts = buildSystemPromptParts(user, history.length, mode === "call" ? "voice" : "text");
  // everything static rides in the cacheable core (call style rules are
  // static too); everything per-turn rides in the tail after the breakpoint
  const sysCore = parts.core + (mode === "call" ? buildSpeechStyle(voiceEngine) : "");
  let sysTail = parts.tail;

  // graph-memory recall: what she knows about their world, woven into
  // context. On live calls the lookup is done ONCE at pickup and passed in
  // as extraMemories — never in front of a spoken reply. Chat looks it up.
  const memories =
    mode === "call"
      ? extraMemories || ""
      : keys.deviceId
        ? await recallMemories(keys.deviceId, latest)
        : "";
  if (memories) {
    sysTail += `\n\nWHAT YOU KNOW ABOUT THEM — true facts from your earlier conversations. You genuinely remember these. When they ask about or touch on anything here, you KNOW it — answer confidently with the specific detail ("priya ki shaadi h na december me"), never play dumb, never guess, never ask them to remind you. Weave one in naturally when relevant; don't dump several at once, and never mention any list or "memory":\n${memories}`;
  }

  const turns = toTurns(history, latest);

  // watch-together: attach what's on their screen to the current turn
  if (watchFrame && mode === "call") {
    sysTail += WATCH_MODE_NOTE;
    const last = turns[turns.length - 1];
    if (last && last.role === "user") {
      const part = { type: "image_url", image_url: { url: watchFrame } };
      if (typeof last.content === "string") {
        last.content = [{ type: "text", text: last.content }, part];
      } else {
        last.content.push(part);
      }
    }
  }

  // calls: hard token cap (spoken replies are short) + streaming. The call
  // brain is the same gemini-3.6-flash as chat — the lite model kept
  // misreading Hinglish; streaming pays for the smarter model's latency.
  const maxTokens = mode === "call" ? 190 : 700;
  let text: string | null = null;
  const fullSystem = sysCore + sysTail;
  if (keys.openrouterKey) text = await openrouterThink(keys, fullSystem, turns, maxTokens);
  if (!text && keys.apiKey) text = await claudeThink(keys, fullSystem, turns);
  if (!text)
    text = await proxyThink(
      keys,
      sysCore,
      sysTail,
      turns,
      maxTokens,
      mode === "call" ? onDelta : undefined,
      mode === "call",
    );
  if (!text) {
    // every brain unreachable. crisis/honesty replies still go out; anything
    // else becomes an honest connectivity text — never fake conversation.
    if (local.critical) return local;
    if (isDirective) return { bubbles: [] };
    // honest connectivity trouble, phrased for the medium: on a call she's
    // SPEAKING, so "my messages aren't sending" would be absurd
    const oops =
      mode === "call"
        ? [
            ["awaaz kat rahi h lagta h... phir se bolna?"],
            ["hello? ek second, network thoda ajeeb kar raha h"],
            ["ruk, kuch sunai nahi diya — line kharab h shayad"],
          ]
        : [
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
    // a call turn must produce SPOKEN WORDS — if the model answered only
    // with a photo/voicenote/gif marker, speak its content instead of
    // yielding a silent turn of dead air
    let spoken = parsed.bubbles.join(" ").trim();
    if (!spoken) spoken = parsed.voice?.text || parsed.photo?.caption || "";
    // stage directions must never be SPOKEN: strip every bracket segment
    // except short simple audio tags ([laughs], [sighs]) the TTS understands
    spoken = spoken
      .replace(/\[(?![a-z ]{2,16}\])[^\]]*\]?/gi, " ")
      .replace(/\[[a-z ]{2,16}$/i, " ") // unclosed tag at end
      .replace(/\s+/g, " ")
      .trim();
    parsed.bubbles = [spoken || "haan? bolo"];
    parsed.photo = undefined;
    parsed.voice = undefined;
    parsed.gif = undefined;
  }
  return parsed;
}
