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
  SEARCH_DECISION,
  type UserProfile,
  type VoiceEngine,
} from "./persona";
import { tagFromSeed } from "./photoCatalog";
import { heartReply, type HeartReply } from "./localHeart";
import { cultureNote } from "./culture";
import { recallMemories } from "./memory";
import { innerContext, overlaps, type Inner } from "./inner";
import { diag } from "./diag";
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
  // what she has already told them about her OWN life (pre-formatted lines).
  // Her day is improvised, but it stops being improvisable once it's been said.
  herLife?: string;
  // her carried interior — one feeling in her own words, and what she wants.
  // Rendered into the VOLATILE tail only; it must never touch the cached core.
  inner?: Inner;
}

// how long ago she said it, in the shape a person would think it
function agoLabel(at: number): string {
  const mins = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (mins < 90) return "earlier in this conversation";
  const hrs = Math.round(mins / 60);
  if (hrs < 20) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

// Her self-ledger arrives newest-first and is deduped upstream on EXACT
// string, which means "flatmate is named sneha" and "flatmate is named priya"
// both survive — and both then render under a heading that says "never say
// anything that contradicts a line here". The ledger was actively serving the
// contradiction it exists to prevent.
//
// Resolution is newest-wins on subject overlap, at render time only: the store
// keeps everything (an extraction slip must never be able to erase her
// history), and only what reaches the prompt is made consistent. Two content
// words in common is the same test `inner.ts` uses to decide a want is the
// same want — "flatmate is named X" collides with "flatmate is named Y", while
// "flatmate had a fight" shares one word and survives beside it.
export function formatHerLife(facts?: Array<{ text: string; at: number }>): string {
  if (!facts?.length) return "";
  const kept: Array<{ text: string; at: number }> = [];
  for (const f of facts) {
    if (!f?.text) continue;
    if (kept.some((k) => overlaps(k.text, f.text))) continue; // superseded
    kept.push(f);
    if (kept.length >= 12) break;
  }
  return kept.map((f) => `- ${f.text} (${agoLabel(f.at)})`).join("\n");
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

// A malformed [search: …] marker is a promise she cannot keep: the holding
// bubble still reaches them and nothing ever checks. `searchBroken` carries
// that fact out of the parser so the lookup block can still run the honest
// "couldn't check" pass. It rides a widened type instead of HeartReply itself
// because it is brain-internal — nothing downstream of think() reads it.
export type ParsedReply = HeartReply & { searchBroken?: boolean; searchSalvaged?: boolean };

export function parseBubbles(raw: string): ParsedReply {
  const out: ParsedReply = { bubbles: [] };
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
  let searchBroken = false;
  raw = raw.replace(/\[\s*search\s*:\s*([^\]\n]+?)\s*\]/gi, (_m, q: string) => {
    const t = q.trim();
    if (!t) searchBroken = true; // "[search: ]" — promised, but nothing to check
    else if (!out.search) out.search = t.slice(0, 200);
    return "";
  });
  // SALVAGE: a marker the strict form missed — dropped "]", a newline inside
  // the query, an empty query. Lazy and bounded by "]", "\n---", a following
  // "[" or end-of-string, so unlike the greedy catch-all below it can never
  // swallow the rest of the reply.
  raw = raw.replace(/\[\s*search\s*:([^\]]*?)(?:\]|\n---|(?=\[)|$)/gi, (_m, q: string) => {
    searchBroken = true;
    const cleaned = q.replace(/\s+/g, " ").trim();
    if (!out.search && cleaned) {
      out.search = cleaned.slice(0, 200);
      out.searchSalvaged = true; // telemetry only — the query itself is never logged
    }
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
    .replace(/\[\s*(?:tone|followup|photo|voicenote|gif|search)\s*:[^\]]*\]?/gi, "")
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
    // A bare catalog tag emitted as its own bubble ("mirror_selfie_room") is
    // her reaching for a photo and dropping the [photo: …] wrapper. Observed
    // 1/84 in an audit run. Showing the raw tag is the worst outcome — it is
    // visibly internal — so honor the intent and send the photo instead.
    if (!out.photo && tagFromSeed(p) && p === p.trim().toLowerCase() && !/\s/.test(p)) {
      out.photo = { seed: p, caption: "" };
      continue;
    }
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
  if (searchBroken && !out.search) out.searchBroken = true;
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
  // so they don't shrink the context or the 6-turn vision window.
  // 30 messages was ~8 exchanges: in a fast chat her own opening scrolled out
  // of context within a couple of minutes and she started contradicting it.
  // Her bubbles are tiny (2–8 words), so 90 costs ~1k uncached tokens a turn.
  const recent = history.filter((m) => m.kind !== "callmark").slice(-90);
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
  // chat: her pre-lookup holding bubble ("ruk dekh ke batati hu") is handed
  // over the moment it exists, so the [search:] round trip is spent with a
  // message already on screen instead of in silence. Resolve when delivered.
  onHolding?: (r: HeartReply) => Promise<void> | void,
): Promise<HeartReply> {
  // when this turn started — the web lookup below spends what is LEFT of a
  // whole-turn budget rather than adding its own leg on top of pass 1
  const t0 = Date.now();
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

  // ── her carried interior ──
  // Goes FIRST in the tail, right after parts.tail: api/chat.js keeps the
  // FIRST n chars and cuts the END, so if anything is ever lost it must
  // be the recall list (re-derivable next turn), never where she actually is.
  // A carried feeling reaches her only on the first turn back after a real
  // gap, and never on a message SHE initiated — see the charter in inner.ts.
  const lastMsgAt = history.length ? history[history.length - 1].at || 0 : 0;
  const inner = innerContext(keys.inner, {
    now: Date.now(),
    lastMsgAt,
    surface: watchFrame ? "watch" : mode === "call" ? "pickup" : "chat",
    // only CHAT directives are her opening the conversation. A call pickup is
    // THEM calling HER, and it is the single moment this feature pays for.
    sheInitiated: isDirective && mode === "chat",
  });
  sysTail += inner.thread;

  // Watch mode goes in EARLY, not at the point of use. api/chat.js keeps the
  // FIRST n chars of the tail and drops the rest, and this block carries the
  // discretion rules (what she looks away from on their screen) and the honest
  // answer about what is retained. It grew past 3.4k with those, so appending
  // it after recall + herLife + wants made it the first casualty of a long
  // tail — a silent truncation that removes a privacy rule is the same failure
  // that once removed the crisis helplines.
  const watching = Boolean(watchFrame) && mode === "call";
  if (watching) sysTail += WATCH_MODE_NOTE;

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
    sysTail += `\n\nWHAT YOU REMEMBER ABOUT THEM — from your earlier conversations, each tagged with when it last came up. These are real: when they touch on one, you KNOW it and you say the specific detail rather than making them repeat themselves. Two things keep it honest:
- Something being listed here is not a reason to say it. It comes out only where it actually fits, one at a time, woven into normal talk — never several at once, never as a list, never with any mention of remembering.
- A memory is not a live update. Anything with a date, a plan or a situation in it may already have happened or changed, so an old one gets talked about as old ("us december wali shaadi ho gayi na?") instead of announced as if it's still ahead — and then you let them tell you where it stands.
${memories}`;
  }
  if (keys.herLife) {
    sysTail += `\n\nWHAT YOU'VE ALREADY TOLD THEM ABOUT YOUR OWN LIFE — you said these, so they are now fixed between you two, not open to reinvention. Same job, same people, same flat, same plans, same things you did. Add new texture freely; never say anything that contradicts a line here, and never re-tell one as if it's news:\n${keys.herLife}`;
  }
  // her forward-facing life goes right after her past-facing one: herLife is
  // what she HAS said and is recency-evicted; a want is the same object next
  // week that it was this week, which is what makes her week 4 differ from day 1
  sysTail += inner.wants;
  diag("chat", "inner_tail", {
    tail: sysTail.length,
    thread: inner.thread.length,
    wants: inner.wants.length,
    // api/chat.js keeps the first 14000 chars of the tail — if this ever
    // trips, the interior is not the thing that should be dropped
    over: sysTail.length > 14000,
  });

  // Cultural currency, pulled not pushed. This is "" unless THEY just said
  // something in today's recognition index — she can never raise any of it
  // first, which is the whole design (see src/engine/culture.ts). Chat only:
  // on a call there is no room for a paragraph about a meme.
  if (mode === "chat" && !isDirective) sysTail += cultureNote(latest);
  // dead last, and chat only — see SEARCH_DECISION in persona.ts for why
  // position is the entire mechanism here
  if (mode === "chat") sysTail += SEARCH_DECISION;
  // api/chat.js keeps the first 14000 chars of the tail, and the decision rule
  // is the last thing in it — so if this ever trips, the rule is the first
  // casualty and the trim has to happen in recall instead
  if (mode === "chat")
    diag("chat", "tail_built", { tail: sysTail.length, over: sysTail.length > 14000 });

  const turns = toTurns(history, latest);

  // watch-together: attach what's on their screen to the current turn
  if (watching) {
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

  let parsed = parseBubbles(text);
  parsed.learned = local.learned;

  // ── live web lookup: she asked for fresh facts ([search: …]) before
  // finishing this reply. One extra fast pass, only in chat, only once —
  // the second pass is told the facts and forbidden from searching again.
  // A MALFORMED marker enters here too: she already promised to check, so a
  // broken marker skips the network and goes straight to the honest
  // "couldn't check" pass instead of leaving the promise hanging.
  if ((parsed.search || parsed.searchBroken) && mode === "chat") {
    diag("chat", "search_fire", {
      q_len: parsed.search?.length || 0,
      salvaged: !!parsed.searchSalvaged,
      broken: !!parsed.searchBroken,
    });
    // her holding bubble goes out NOW, in parallel with the lookup — the two
    // round trips used to stack into ~10s of dead air before anything appeared
    const holding = parsed.bubbles.slice(0, 1);
    const handoff = onHolding && holding.length ? onHolding({ bubbles: holding }) : null;
    // A DEADLINE, not a per-leg budget. The old 7s sat on top of whatever
    // pass 1 had already spent, so a slow turn could reach ~16.6s of model
    // time just to deliver an apology. Whatever is left of the turn is what
    // the lookup gets; below the floor it does not start at all.
    const TURN_BUDGET_MS = 11_000;
    const left = TURN_BUDGET_MS - (Date.now() - t0);
    let facts = "";
    let soft = false;
    let ok = false;
    const tSearch = Date.now();
    if (parsed.search && left > 1_500) {
      try {
        const res = await fetch(PROXY_URL.replace("/api/chat", "/api/search"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q: parsed.search }),
          // measured p50 ~3.2s / p90 ~3.5s / max ~4.0s (n=12, datacenter);
          // the server's own fuse is 6.5s so it dies just before we give up
          signal: AbortSignal.timeout(Math.min(7_000, left)),
        });
        if (res.ok) {
          const body = await res.json();
          facts = String(body?.facts || "");
          soft = body?.confidence === "soft";
          ok = !!facts;
        }
      } catch {
        /* offline / timed out — the second pass says so in her own words */
      }
    }
    diag("chat", "search_done", {
      ms: Date.now() - tSearch,
      ok,
      chars: facts.length,
      soft,
      budget_left: Math.max(0, left),
    });
    const tPass2 = Date.now();
    let pass2ok = false;
    let pass2bubbles = 0;
    try {
      // Truth framing that matches what actually came back. "CURRENT and true"
      // used to be asserted over any string at all, including a listicle
      // summary, in a persona carrying an absolute truthfulness rule.
      const tailWithFacts =
        sysTail +
        `\n\nWHAT THE LOOKUP CAME BACK WITH for "${parsed.search || ""}" — you glanced at your phone just now:\n${
          facts || "(nothing came back — say you couldn't check right now, casually, and don't fill the gap yourself)"
        }\n${
          soft
            ? "This is what the internet says rather than a source worth trusting — keep it loose, hedge it, never assert it."
            : "If it doesn't state a city, a date or a unit, don't invent one; say the number loosely rather than precisely."
        }\nThese came from LOOKING IT UP, not from your own experience — never restate them as something you personally saw, used or checked on your own phone. Weave in only the part that answers what they asked; if it doesn't actually answer it, say you couldn't find it properly. Never mention "searching" or "results", and do NOT output another [search: …] marker.`;
      const second = await proxyThink(keys, sysCore, tailWithFacts, turns, maxTokens);
      if (second) {
        const p2 = parseBubbles(second);
        p2.learned = local.learned;
        p2.search = undefined;
        p2.searchBroken = undefined;
        pass2ok = true;
        pass2bubbles = p2.bubbles.length;
        if (p2.bubbles.length) {
          // the holding bubble is already on screen when it was handed off;
          // otherwise it still leads the informed reply
          p2.bubbles = handoff ? p2.bubbles.slice(0, 4) : [...holding, ...p2.bubbles].slice(0, 4);
          parsed = p2;
        }
      }
    } catch {
      /* informed pass unreachable — the guard below still answers them */
    }
    diag("chat", "search_pass2", { ms: Date.now() - tPass2, ok: pass2ok, bubbles: pass2bubbles });
    if (handoff) {
      await handoff;
      // delivered already — never send it twice, but only strip it when
      // something else actually arrived to take its place
      if (parsed.bubbles.length > 1 && parsed.bubbles[0] === holding[0]) {
        parsed.bubbles = parsed.bubbles.slice(1);
      } else if (parsed.bubbles.length <= 1 && parsed.bubbles[0] === holding[0]) {
        // pass 2 produced nothing. Silence after "ruk dekh ke batati hu" is
        // the worst outcome on this path — worse than a stale fact, because
        // the unanswered promise sits on their screen. One canned line is
        // acceptable here and only here: it asserts nothing about the world,
        // so it cannot be false.
        parsed.bubbles = ["yaar abhi check nhi kar paa rhi, net ajeeb h 😭"];
        diag("chat", "search_silence_saved", {});
      }
    }
    parsed.search = undefined;
    parsed.searchBroken = undefined;
  }

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
