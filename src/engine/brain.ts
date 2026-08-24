// Reply brain, in priority order:
//   1. OpenRouter (open-source models — cheap, strong; used directly when the
//      owner pastes their key in Settings; DeepSeek by default)
//   2. Claude (optional alternative, if that key is set instead)
//   3. Hosted proxy (our Vercel function holds an OpenRouter key server-side,
//      so a fresh install has a real brain with zero setup)
//   4. Offline heart engine (always available fallback)

// TYPE ONLY. The SDK is 151.6 kB of the bundle and is reachable on exactly one
// path — the owner pasting their own Claude key into Settings — so it is
// loaded with `await import()` at the moment that path is taken (see
// `claudeThink`) rather than shipped to every first paint. A `import type`
// here costs nothing at runtime and keeps `Anthropic.TextBlock` spelled the
// same as before.
import type AnthropicSDK from "@anthropic-ai/sdk";
import { Capacitor } from "@capacitor/core";
import { type UserProfile, type VoiceEngine } from "./persona";
import { tagFromSeed } from "./photoCatalog";
import { heartReply, type HeartReply } from "./localHeart";
import { cultureNote } from "./culture";
import {
  recallMemories,
  forgetMemories,
  resolveForget,
  takeRelBundle,
  takeSelfBundle,
  callSelfBundle,
  activityLedger,
  formatActivityLedger,
  withoutServerActivityBlock,
  type ActivityRecord,
} from "./memory";
import { innerContext, overlaps, type Inner } from "./inner";
import { diag } from "./diag";
import {
  compile,
  hashCore,
  hashManifest,
  type RelBundleInput,
  type SelfBundleInput,
} from "./compiler";
import type { ActivityState } from "./activity";
// T-H2 (formatHerLife, below) reuses T9's overnight predicate rather than
// re-deriving one. away.ts imports only ./timeline, so this adds no cycle.
import { crossedNight } from "./away";
// WS-HERNOW. Her present moment as a ledger rather than a per-pickup roll.
// herNow.ts imports only storyCatalog.ts (a leaf), so this adds no cycle —
// the same check the away.ts line above documents for itself.
import { formatHerNow, type HerNowEntry } from "./herNow";
import { greetOnce, type GreetTurn } from "./greeting";
// WS-MANIFEST Phase D prep (docs/SPEC.md §7.3 "chat lane call-site
// adoption"): router.ts stays WS-ROUTER's exclusively (§13) — this is a
// read of its exported pure functions, not an edit, same discipline as the
// clock.ts import just below. `Lane` deliberately has no "live" member
// (router.ts's own header) — the realtime call lane never reaches this
// file at all (compiler.fixtures.ts's own note), so nothing here routes it.
import { route, toTelemetryDetail, type ModelRow, type LaneConfig, type RoutedCandidate } from "./router";
// WS-INTEGRATE seam 2 (age-tier hard-refusal, WS-SAFETY's ticket, verbatim):
// gatesFor(getAgeTier()) is called FRESH per compile below — never
// memoized — so a tier that tightens mid-session takes effect on the very
// next turn. clock.ts stays WS-SAFETY's exclusively (§13); this is a read
// of its exported gate function, not an edit.
import { gatesFor, getAgeTier } from "./clock";
// The honesty gate. Pure, no I/O, no telemetry of its own — the diag() call
// that records a block lives here, so honesty.ts stays a predicate an eval can
// drive with plain objects.
import {
  guardReply,
  openCommitments,
  herCommitments,
  allowedFrom,
  createStreamGuard,
  hisVocabulary,
  sharedVocabulary,
  activityVocabulary,
} from "./honesty";
import type { Message } from "../state/store";
// WS-SHARENOW. The just-happened block and the share mirror's holder, imported
// rather than restated: there is exactly one definition in this repo of "what
// the two of them just did" and a second one would diverge by not being
// updated (`age-tier-never-realtime`'s law). The module reaches nothing this
// file did not already reach — ./memory, ./honesty and ../state/store types.
import { formatJustHappened, shareLedger } from "../voice/callHistory";

const CLAUDE_MODEL = "claude-opus-5";
// Default brain: Gemini 3.6 Flash — the best modern-Hinglish register we
// auditioned (vs deepseek, kimi, minimax, llama). Overridable via model slug.
export const OPENROUTER_DEFAULT_MODEL = "google/gemini-3.6-flash";

// ── WS-MANIFEST Phase D prep: chat-lane router call-site adoption ──────────
// Hand-kept MIRROR of config/models.json's `models["google/gemini-3.6-flash"]`
// + `lanes.chat` rows — NOT an import of that JSON file, for the same reason
// api/chat.js mirrors compiler.ts's OPERATIONAL_CORE_CAP instead of importing
// it (see that file's own comment): this module ships in the browser/
// Capacitor bundle, and config/models.json's `with { type: "json" }` import
// assertion is a Node/Vercel-function pattern (api/route.js,
// scripts/derive-adapter.mjs) this tsconfig does not enable for src/. Keep
// the two in sync by hand — scripts/verify-chat-lane-route.mjs asserts they
// agree AND that both agree with today's hardcoded OPENROUTER_DEFAULT_MODEL,
// so a drift fails loudly instead of silently routing the wrong model.
const CHAT_LANE_MODELS: Record<string, ModelRow> = {
  [OPENROUTER_DEFAULT_MODEL]: {
    model: OPENROUTER_DEFAULT_MODEL,
    provider: "google",
    billing: "cash",
    card_risk: false,
    prefix_cache: true,
    residency: "us",
    max_tokens_mode: "total",
    adapter_derived_at: null,
    gate: "passed",
  },
};
const CHAT_LANE_CONFIG: LaneConfig = { incumbent: OPENROUTER_DEFAULT_MODEL, candidates: [], fallback: null };

/**
 * Consults router.ts's route() for Lane "chat" — SPEC §7.3's "chat lane
 * call-site adoption". Today CHAT_LANE_CONFIG has zero candidates, so this
 * can only ever return the incumbent: BEHAVIOR IS UNCHANGED, this is
 * observability wired in ahead of the first real candidate, not a live
 * routing decision yet (§7.1: "the already-recommended vision-lane grok move
 * ... proving the router on a low-stakes lane before it touches a brain
 * lane" — chat is a brain lane, so it waits its turn deliberately).
 * `route()` only omits a row when `eligibility()` rejects it; the one row
 * above is `gate:"passed"`, `card_risk:false`, and no health/quota state is
 * threaded in here, so the empty-candidates branch below is unreachable
 * under today's mirror and exists only so a future drift in the mirror
 * degrades to "silently keep working" rather than "the chat lane goes dark".
 */
export function routeChatLane(): RoutedCandidate {
  const decision = route("chat", CHAT_LANE_CONFIG, CHAT_LANE_MODELS)[0];
  return (
    decision ?? {
      model: OPENROUTER_DEFAULT_MODEL,
      role: "incumbent",
      adapter_version: "baseline",
      gate: "passed",
    }
  );
}
export { CHAT_LANE_MODELS, CHAT_LANE_CONFIG };

// Serverless proxy that holds an OpenRouter key server-side — the zero-config
// brain. On the website it's same-origin; the Android app crosses origins.
const PROXY_URL = Capacitor.isNativePlatform()
  ? "https://meera-silk.vercel.app/api/chat"
  : "/api/chat";

// SPEC §3.3/§7.3 compile.manifest throttle: "core_hash changes rarely — emit
// full record on change, per-turn record small." Module-level so it survives
// across turns within one app run (a fresh install/reload naturally treats
// its first turn as a change, which is correct — there is nothing to diff
// against yet). Not persisted; a cold start re-emitting one full record is
// the honest behavior, not a bug to work around.
let lastCoreHash: string | null = null;

// ── how often she may actually look something up ────────────────────────
// The owner widened the search trigger deliberately: "if the idea or Convo is
// unique and out of scope then AI think it should be worth searching ...
// searching could eventually give insight which can make the whole Convo more
// engaging". That is the right instinct and it moves the trigger from DOUBT to
// CURIOSITY — which also means it can fire on turns the old rule never touched.
//
// So the frequency is capped HERE rather than in the brief. `gate0-structural`
// is the reason: a sentence asking her to be sparing is a preference, and this
// one has teeth — every search costs a holding bubble, ~3-4s of the turn, and
// real money on a lane that has already run dry twice this week.
//
// A bucket rather than a fixed gap, so two genuinely factual questions in a row
// still both get answered — that is the case the old fact-check trigger served
// and it must not regress — while a run of curious turns settles down.
export const SEARCH_BUCKET = 3;
export const SEARCH_WINDOW_MS = 5 * 60_000;
const searchFires: number[] = [];

// ── the explicit ask (owner report, 2026-08-22) ─────────────────────────
// He told her about Westside, told her to SEARCH it — twice — and she
// insisted he explain instead. Two failures: the decision rule never named
// a direct instruction (fixed in SEARCH_DECISION), and the curiosity cap
// treated his ask like her own impulse. A person TOLD to look something up
// does not get to be over budget: that reads as refusal. So an explicit ask
// bypasses the curiosity bucket and draws from its own, much larger one —
// still a bucket, because "search X" pasted twenty times in a loop is a
// cost bug, not a conversation.
export const EXPLICIT_SEARCH_BUCKET = 12;
const explicitFires: number[] = [];

/** Did HIS message tell her to look it up? Pure, testable, both languages.
 *  The verb must be IMPERATIVE-SHAPED: bare "google"/"search" as a noun
 *  ("kal google office ke paas tha") must never fire, so every branch binds
 *  the word to a command frame: an English object/particle, a Hindi
 *  kar-verb, or the pe-dekh/check word orders in both directions. */
export const RE_EXPLICIT_SEARCH =
  /\b(?:go\s+(?:and\s+)?)?(?:search|google)\s+(?:it|this|that|about|for|up)\b|\blook\s+(?:it|this|that)?\s*up\b|\b(?:search|google)\s+(?:kar|karo|karke|karle|kar\s*(?:na|le|ke|de))\b|\b(?:google|net|internet)\s*pe\s*(?:dekh|check|search)|\b(?:dekh|check)\s+(?:na\s+)?(?:google|net|internet)\s*pe\b|\bcheck\s+(?:online|google)\b/i;

/** Test seam: drains the bucket so a suite starts from a known state. */
export function _resetSearchBucket(): void {
  searchFires.length = 0;
}

/** True when a lookup is within budget; records the fire when it is. */
export function takeSearchSlot(): boolean {
  const now = Date.now();
  while (searchFires.length && now - searchFires[0] > SEARCH_WINDOW_MS) searchFires.shift();
  if (searchFires.length >= SEARCH_BUCKET) return false;
  searchFires.push(now);
  return true;
}

/** The explicit-ask lane's slot — separate bucket, same window discipline. */
export function takeExplicitSearchSlot(): boolean {
  const now = Date.now();
  while (explicitFires.length && now - explicitFires[0] > SEARCH_WINDOW_MS) explicitFires.shift();
  if (explicitFires.length >= EXPLICIT_SEARCH_BUCKET) return false;
  explicitFires.push(now);
  return true;
}

/** Test seam for the explicit bucket, mirroring _resetSearchBucket. */
export function _resetExplicitSearchBucket(): void {
  explicitFires.length = 0;
}

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
  // ── WS-CONTINUITY seam 1 (docs/SPEC-CONTINUITY.md §1) ──────────────────
  // The call lane's relational bundle, fetched ONCE during the ring (see
  // useCallEngine.ts's `recallForCall`) and handed in here rather than pulled
  // from `takeRelBundle`'s consume-once cache. The chat lane leaves this
  // undefined and keeps pulling the cache exactly as before — one bundle per
  // lane, from whichever source that lane's timing makes correct.
  //
  // Why it rides BrainKeys rather than a 12th positional parameter to
  // think(): the call lane already assembles this object per turn
  // (useCallEngine.ts's brainKeys()), so a lane that has a bundle ships it
  // with everything else it knows, and think()'s signature stays readable.
  relBundle?: RelBundleInput | null;
  // What they are doing together right now (a game, a share). Rides BrainKeys
  // for the same reason relBundle does: the lane that HAS one ships it with
  // everything else it knows, and think()'s signature stays readable.
  activity?: ActivityState | null;
  // What they have ALREADY done — the finished-activity ledger (AppState's
  // `activities`). `activity` above is the one live session and is null the
  // moment it is replaced; this is every game behind it.
  //
  // OPTIONAL AND USUALLY UNSET, deliberately, and this is the `selfBundle`
  // idiom rather than an oversight: the ledger lives in App.tsx's state, the
  // cascade call lane compiles from a frame that cannot reach it, and the
  // realtime lane does not call this function at all — so App.tsx publishes it
  // into memory.ts's holder and every lane reads the same one. A caller that
  // already holds the ledger passes it here and the holder is not consulted;
  // `!== undefined` rather than `??`, so a caller that means "no ledger this
  // turn" is obeyed instead of silently overruled.
  activities?: readonly ActivityRecord[];
  // #117 — a milestone that just crossed (state.recentMoment): ONE telegraphic
  // fact, rendered while fresh so she can bring it up herself. Optional on
  // both lanes like everything above; absent renders zero bytes.
  moment?: { id: string; fact: string; at: number } | null;
  // Cascade callback signal: SHE placed this call (after a drop). Mirrors
  // the live lane's sheCalled so G2 holds on both lanes — a line she opened
  // must not carry the thread that implies she suffered without them.
  sheCalled?: boolean;
  // ── T-H1 (`selfbundle-never-set`) ──────────────────────────────────────
  // The self layer's three tail slots (T11 rel.texture, T12 self.arc, T13
  // life.untold). Optional on BOTH lanes and for the same reason relBundle is:
  // absent means compile() renders nothing, which is the state every one of
  // the 83 byte-identity fixtures is in.
  //
  // Unset by every caller today, and that is deliberate rather than an
  // oversight to fix: the call lane's bundle comes from memory.ts's
  // `callSelfBundle(device)` holder, filled by the ring fetch, because the
  // three call-lane compile sites do not share one call frame (see that
  // function). This field is the override — a caller that already holds a
  // bundle hands it in and the holder is not consulted.
  selfBundle?: SelfBundleInput | null;
}

// how long ago she said it, in the shape a person would think it.
// `nowMs` is threaded from formatHerLife (defaulting to the clock, so every
// existing caller is byte-identical) for the reason away.ts states: a renderer
// that reads the clock inside itself cannot be asserted against a literal.
function agoLabel(at: number, nowMs: number = Date.now()): string {
  const mins = Math.max(0, Math.round((nowMs - at) / 60_000));
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
//
// ── T-H2: an activity is a fact with an expiry (docs/HONESTY.md) ───────────
//
// The defect, in the owner's shape: she says "khana bana rahi hu" on Tuesday,
// and on Friday the ledger still hands her that line under a heading reading
// "you said these, so they are now fixed between you two". She is cooking. She
// has been cooking for three days.
//
// An expired activity is DROPPED, never relabelled. "(2 days ago)" appended to
// "cooking rn" is still the claim that she is cooking, now with a timestamp
// arguing against it — and a brief that contradicts itself is resolved by the
// model, not by us. Her having finished something looks like the line not
// being there. Nothing new is rendered, so there is no new sentence-shaped
// text for `recited-prompt` to bite on: this change can only remove rows.
//
// THE WINDOW is `min(3h, the next night)`:
//
//   3h  — the longest ordinary thing in `evals/honesty/detect.mjs`'s MIN_MINUTES
//         table is 60 minutes (sleeping); cooking is 20, a film 20, the gym 30.
//         Three hours is generous by a factor of three against the longest of
//         them, which is the right direction to be wrong in: a dropped line
//         costs her a small continuity, a stale one costs her being a person.
//   night — an activity claimed at 23:40 must not survive to 02:40 just because
//         three hours had not elapsed. `crossedNight` is T9's own predicate
//         (src/engine/away.ts, IST 01:00–06:00) and is reused rather than
//         re-derived, so "what counts as overnight" has exactly one answer in
//         this codebase. It is a statement about the clock, not about either of
//         them.
//
// The 6h conversational gap that also kills an activity needs no code: a gap
// that long puts the fact past the 3h cap by construction. Stated here so the
// next reader does not add a redundant second test for it.
//
// Only `kind: "activity"` expires. Absent kind is the legacy default ("fact")
// and renders exactly as it did before this existed — see SelfFact in store.ts.

/** How long a claimed activity can still plausibly be running. */
export const ACTIVITY_TTL_MS = 3 * 60 * 60 * 1000;

/** Could she still be doing it? Total, and conservative at both edges. */
export function activityStillRunning(at: number, nowMs: number): boolean {
  const age = nowMs - at;
  if (!Number.isFinite(age)) return true; // an unreadable stamp is not evidence
  if (age <= 0) return true; // a future stamp is another device's clock, not a lie
  if (age >= ACTIVITY_TTL_MS) return false;
  return !crossedNight(nowMs, age);
}

/**
 * T7's string: what she has TOLD them, and — appended — where she actually is
 * this minute.
 *
 * ── THE SEAM, BECAUSE THE TWO HALVES LOOK ALIKE AND ARE NOT ──────────────
 *
 *   the TOLD ledger (these rows)  is THE DAY AND BEFORE IT. She said these,
 *     so they are fixed between the two of them and do not expire by the
 *     clock; the compiler's own T7 header is written in exactly those words.
 *   `present` (the appended block) is THE MINUTE. One activity, going on
 *     right now, with an elapsed time computable from its `startedAt`, and
 *     NOT something she has said. See src/engine/herNow.ts's header.
 *
 * The two never claim the same thing, and the block appended below opens by
 * saying so — because T7's header says "you said these", and nothing in the
 * present-moment block has been said to anybody.
 *
 * It rides T7 rather than earning a compiler slot for a structural reason:
 * T7 is claimed by every lane in the parity table, so a present moment
 * carried here cannot render in chat and go dark on the phone
 * (`rejected.md#call-opens-with-amnesia-by-construction`). `present` is
 * optional and defaults to nothing, so every existing caller is byte-
 * identical — the watch lane deliberately stays one of them (see the herNow
 * rows in `evals/lanes/run.mjs`).
 */
export function formatHerLife(
  facts?: Array<{ text: string; at: number; kind?: "activity" | "fact" }>,
  nowMs: number = Date.now(),
  present?: HerNowEntry | null,
): string {
  const told: Array<{ text: string; at: number }> = [];
  for (const f of facts ?? []) {
    if (!f?.text) continue;
    // Before the supersede check, not after: an activity that is over must not
    // go on shadowing an older durable fact it happens to share words with.
    if (f.kind === "activity" && !activityStillRunning(f.at, nowMs)) continue;
    if (told.some((k) => overlaps(k.text, f.text))) continue; // superseded
    told.push(f);
    if (told.length >= 12) break;
  }
  const ledger = told.map((f) => `- ${f.text} (${agoLabel(f.at, nowMs)})`).join("\n");
  const now = formatHerNow(present, nowMs);
  if (!ledger) return now;
  return now ? `${ledger}\n\n${now}` : ledger;
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
export type ParsedReply = HeartReply & {
  /** a single emoji she is putting ON his last message, WhatsApp-style —
   *  `[react: X]`. Not a bubble: a reaction is a glance, and rendering it as
   *  text would make her "say" an emoji she meant to stick on something. */
  react?: string;
  searchBroken?: boolean;
  searchSalvaged?: boolean;
  // index in `bubbles` where she actually wrote the photo, so delivery can put
  // it back where she meant it instead of always at the end of the burst
  photoAt?: number;
};

/**
 * The em-dash is the single clearest "this was written by an AI" tell in a
 * chat bubble, and the owner reported it directly. `persona.ts:148` already
 * bans it when texting — well written, and broken anyway, which is the exact
 * shape `honesty-by-instruction` records: a mid-brief sentence is a
 * preference, and `gate0-structural` measured prompt instructions leaking
 * 57–98% where a predicate on the bytes leaked 0 of 31,122. So this is a
 * predicate, and `persona.ts` stays byte-unchanged.
 *
 * TEXT LANE ONLY. Three reasons the spoken lanes must not be touched:
 * `persona.ts:148` itself says spoken style overrides this; three persona
 * rules REQUIRE dashing on a call; and `device-says-arrow-not-dash` measured
 * espeak reading `—` as a PAUSE rather than a word, so it is prosody there,
 * not a tell. The speech path has its own sanitiser already.
 *
 * The ASCII hyphen is deliberately untouched. `device-seam-closed` negative-
 * tested exactly this: a greedy `/-+/` rule DELETED her own
 * "1800-599-0019" — the crisis helpline. Only the em-dash, the en-dash and a
 * doubled ASCII hyphen are register tells; a single hyphen is inside words
 * and numbers she must be able to say.
 *
 * It replaces rather than splits: a bubble split would change bubble counts
 * the parser cap and the delivery path both reason about, to fix a problem
 * that is only about the character.
 */
export function stripTextingDashes(text: string): string {
  return text
    .replace(/\s*(?:[—–]|--)\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function parseBubbles(raw: string): ParsedReply {
  const out: ParsedReply = { bubbles: [] };
  // ── protocol extraction, GLOBAL and lenient: markers are honored wherever
  // they appear (own line, inline, sloppy spacing, dropped closing bracket) —
  // anything that looks like protocol must never reach the user as text ──
  raw = raw.replace(/\[\s*tone\s*:\s*([^\]\n]*)\]?/gi, (_m, mood) => {
    if (!out.tone && mood.trim()) out.tone = mood.trim().slice(0, 120);
    return "";
  });
  // [react: X] — she puts ONE emoji on his last message. Extracted before the
  // photo marker for no reason other than reading order; all of these are
  // order-independent. Only the first is honoured and only if it is actually
  // an emoji: a model that writes "[react: laughing]" must not stick the word
  // "laughing" on his message, and the catch-all stripper below removes the
  // marker either way so nothing leaks as text.
  // GREEDY capture, and that is the whole bug this line already had once.
  // Non-greedy (`{1,16}?`) against an OPTIONAL closing bracket lets the match
  // stop after ONE code unit, which for an emoji is half a surrogate pair — so
  // `[react: X]` stored a lone `\ud83d` and the closing bracket leaked into the
  // bubbles. That is the `[giggles` incident this same function is already
  // commented about, in a second place: a lazy quantifier plus an optional
  // terminator truncates, every time. Caught by the eval, not by review.
  raw = raw.replace(/\[\s*react\s*:\s*([^\]\n]{1,16})\]?/gi, (_m, e: string) => {
    const t = e.trim();
    // One emoji, never a word: a model writing "[react: laughing]" must stick
    // nothing rather than the string "laughing". `[...t][0]` takes the first
    // CODE POINT, so a multi-emoji payload keeps only the first and never
    // splits one in half.
    if (!out.react && t && !/[a-z0-9]/i.test(t)) out.react = [...t][0];
    return "";
  });
  raw = raw.replace(/\[\s*photo\s*:\s*([^\]\n]+?)\s*\]/gi, (_m, body: string) => {
    if (!out.photo) {
      const [tagPart, ...capParts] = body.split("|");
      const caption = capParts.join("|").trim() || tagPart.trim();
      out.photo = { seed: body, caption };
      // Keep the SLOT the marker occupied. Deleting it outright threw away
      // where in the burst she meant the photo to land, and delivery then
      // always put it last — so a photo she wrote FIRST arrived after two
      // messages of text, which in testing meant a picture of her desk
      // dropping in underneath "my friend is upset with me". The sentinel is
      // -wrapped rather than bracketed because the catch-all stripper
      // below eats anything in square brackets.
      return "\n---\nPHOTO\n---\n";
    }
    return "";
  });
  // The payload may legitimately CONTAIN brackets: persona.ts invites audio
  // tags inside a voice note ("audio tags like [giggles] [softly] allowed"),
  // so the capture has to survive them. It did not — `[^\]]+?` stopped at the
  // first "]", which is the TAG's closing bracket, so
  // "[voicenote: [giggles] arre haan yaar maine kha liya]" became a voice note
  // whose entire content was the string "[giggles" and her actual sentence was
  // dropped on the floor. Shipped, and caught in a real conversation: she sent
  // a clip that was nothing but a laugh, then invented an explanation for it
  // when asked. The protocol and the parser disagreed, and the parser was
  // wrong — she was following her instructions exactly.
  raw = raw.replace(/\[\s*voicenote\s*:\s*((?:[^\][]|\[[^\][]*\])*?)\s*\]/gi, (_m, body: string) => {
    const said = body.replace(/\s+/g, " ").trim();
    // What she actually SAYS, with the performance tags taken out. Tags are
    // kept in the payload — ElevenLabs performs them and the proxy voice
    // strips them — but they are not words, and a payload that is only tags is
    // a recording of her laughing at nothing.
    const words = said
      .replace(/\[[^\][]*\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    // A voicenote payload is WORDS SHE SPEAKS. Models routinely write a stage
    // direction there instead — "[voicenote: softly]", "[voicenote: giggles]" —
    // and the old code took it literally, so the app sent her a voice note
    // whose entire content was the spoken word "softly". Measured on a crisis
    // conversation: 4 of 4 voice notes malformed on one model, and 2 of 5 on
    // the model we ship TODAY. This is live in production, not hypothetical,
    // and a voice note reading "giggles" during someone's worst night is about
    // the most damaging thing this app could send.
    //
    // A direction is short and has no sentence in it. Real spoken content has
    // several words, or punctuation, or is plainly not a lone adverb. Dropping
    // a doubtful one is free — the reply's text bubbles still send — while
    // sending one is unrecoverable.
    const wordCount = words ? words.split(" ").length : 0;
    const looksLikeDirection =
      wordCount <= 2 &&
      !/[.!?…,]/.test(words) &&
      /^[a-z ]+$/i.test(words) &&
      /\b(softly|gently|quietly|warmly|sadly|happily|excited|laughing|laughs|giggles|giggling|sighs|sighing|whispers|whispering|crying|smiling|serious|calm|tired|sleepy|cheerful|teasing|playful|concerned|worried)\b/i.test(
        words,
      );
    // `words` rather than `said`, so "[voicenote: [giggles]]" — tags and
    // nothing else — is dropped instead of sent. Her text bubbles still go.
    if (!out.voice && words && !looksLikeDirection) out.voice = { text: said };
    return "";
  });
  raw = raw.replace(/\[\s*gif\s*:\s*([^\]\n]+?)\s*\]/gi, (_m, q: string) => {
    if (!out.gif) out.gif = { query: q.trim() };
    return "";
  });
  // [forget: …] — the only marker that DELETES. Strict form only: no salvage
  // pass and no catch-all rescue, unlike [search:]. A mangled search marker
  // costs a wasted lookup; guessing at a mangled forget costs rows that do
  // not come back, so a marker that did not arrive cleanly is dropped and she
  // simply hasn't done it.
  raw = raw.replace(/\[\s*forget\s*:\s*([^\]\n]+?)\s*\]/gi, (_m, body: string) => {
    const t = body.replace(/\s+/g, " ").trim();
    if (t && !out.forget) out.forget = t.slice(0, 80);
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
    .replace(/\[\s*(?:tone|followup|photo|voicenote|gif|search|forget)\s*:[^\]]*\]?/gi, "")
    .replace(/\[\s*(?:voice note|they sent a photo|replying to|a voice call starts|the call ended)[^\]]*\]?/gi, "")
    .replace(/\[\d{1,2}:\d{2}\s*(?:am|pm)?\]/gi, "");

  // models separate thoughts with "---" or plain newlines — both are bubbles
  for (const part of raw.split(/\n?---\n?|\n+/)) {
    let p = part.trim();
    if (!p) continue;
    // the photo's own slot: record how many bubbles preceded it and drop it,
    // so delivery can emit the picture at the moment she reached for it
    if (p === "PHOTO") {
      out.photoAt = out.bubbles.length;
      continue;
    }
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

// Exported for evals/continuity/seam3.mjs only (WS-CONTINUITY seam 3: the
// spec asks the build to CHECK whether any reader treats a channel boundary
// as "a new conversation" rather than taking its word for it — this is that
// reader, and checking it requires being able to call it). Pure; no call site
// changed.
export function toTurns(history: Message[], latest: string) {
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
  // HOW MANY REAL IMAGES THE WINDOW MAY CARRY, decided newest-first.
  //
  // The window is six messages. It used to be six messages carrying at most one
  // picture each; a message can now carry five, so the same window is a
  // thirty-image prompt — real money per turn, and vision tokens are the part
  // of a turn that is not prompt-cached. So the budget is on IMAGES, not on
  // messages, and it is spent from the newest backwards: the set he just sent
  // is the one she is being asked about, and an older set degrades to its
  // stored one-line description exactly as a pre-window photo already does.
  const VISION_IMAGE_BUDGET = 8;
  const visionAllowed = new Set<number>();
  {
    let left = VISION_IMAGE_BUDGET;
    for (let i = recent.length - 1; i >= Math.max(0, visionCutoff); i--) {
      const m = recent[i];
      if (m.from !== "me" || m.kind !== "photo") continue;
      const n = Array.isArray(m.photoUrls) && m.photoUrls.length
        ? m.photoUrls.filter(Boolean).length
        : m.photoUrl
          ? 1
          : 0;
      if (!n) continue;
      // All or nothing per message: half a set is worse than none, because she
      // would be told there are five and shown three and would talk about all
      // five. The newest set always fits — the budget is above the cap.
      if (n > left) break;
      left -= n;
      visionAllowed.add(i);
    }
  }
  for (let mi = 0; mi < recent.length; mi++) {
    const m = recent[mi];
    // THE PICTURES ON THIS MESSAGE, not the picture. `photoUrls` is
    // WS-COMPOSER's multi-select field and `photoUrl` always holds the first of
    // the set, so a reader that knows only the old field degrades to showing
    // one of five rather than none — but degrading is not the same as working:
    // he selects five, she comments on the first, and that reads as her not
    // looking at the others. The precedence rule is `imagesOf`'s, restated here
    // rather than imported, because this file is engine and that one is
    // components (and `api/_engine.gen.js` must keep building without the
    // component tree). If the two ever disagree, THIS is the one the model
    // sees, which is why the eval asserts the rule on both sides.
    const userImages =
      m.from === "me" && m.kind === "photo"
        ? (Array.isArray(m.photoUrls) && m.photoUrls.length
            ? m.photoUrls
            : m.photoUrl
              ? [m.photoUrl]
              : []
          ).filter(Boolean)
        : [];
    const photoNote = m.from === "me" ? m.text || m.desc || "" : "";
    // The transcript head the composer writes ("[photo]" / "[3 photos]") is a
    // COUNT, not a caption — `transcriptLine` in components/attachments.ts
    // produces `"[3 photos] ye dekh"` — so the head is stripped and only what
    // he actually typed survives. The old code compared the whole note against
    // the literal `"[photo]"`, which was exactly right for one picture and
    // would have handed her "[3 photos] ye dekh" as a caption for three.
    const caption = photoNote.replace(/^\[(?:photo|\d+ photos)\]\s*/i, "").trim();
    const nPhotos = Math.max(userImages.length, 1);
    let text =
      m.kind === "photo"
        ? m.from === "me"
          ? `[they sent ${nPhotos > 1 ? `${nPhotos} photos` : "a photo"}${
              caption ? `: ${caption}` : ""
            }]`
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
    // Mark medium switches so she remembers what was SAID on a call vs typed.
    // The wording carries the attribution rule itself, because the bare
    // "[a voice call starts]" marker measurably wasn't enough: the owner
    // reported her asking why he'd said something "in text" when he had said
    // it on the call — the boundary was in the window and she still
    // misattributed. A person KNOWS whether something was said or typed;
    // getting it wrong reads as her not having been there.
    const ch = m.channel === "call" ? "call" : "chat";
    if (ch !== lastChannel) {
      text =
        (ch === "call"
          ? "[a voice call starts — everything until it ends was SPOKEN aloud, not typed]\n"
          : "[the call ended — back to typed texting]\n") + text;
      lastChannel = ch;
    }
    const role = m.from === "me" ? ("user" as const) : ("assistant" as const);
    const stamp = m.at
      ? new Date(m.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })
      : "";
    const stamped = stamp ? `[${stamp}] ${text}` : text;
    const prev = turns[turns.length - 1];
    if (userImages.length && mi >= visionCutoff && visionAllowed.has(mi)) {
      // Multimodal parts: the model looks at the real images. Merged into an
      // adjacent same-role turn — consecutive same-role messages 400 on
      // strict-alternation chat templates.
      //
      // ALL of them, in ONE turn. A person shown five photos at once reacts to
      // the SET; five separate image turns produce five separate reactions,
      // which is the tell. Same rule the server applies to a live send in
      // api/_lanes.js's `attachToLastTurn` — stated in both places because the
      // two paths (a fresh send, and re-reading history on the next turn) reach
      // the model through different code and must not disagree about it.
      const parts: Array<Record<string, unknown>> = [
        { type: "text", text: stamped },
        ...userImages.map((url) => ({ type: "image_url", image_url: { url } })),
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
  // SPEC §7.3 chat-lane adoption: the caller's routed decision for Lane
  // "chat" (routeChatLane().model — today always OPENROUTER_DEFAULT_MODEL,
  // see that function's doc). A user's own openrouterModel override still
  // wins, exactly as before this seam landed.
  defaultModel = OPENROUTER_DEFAULT_MODEL,
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
        model: keys.openrouterModel?.trim() || defaultModel,
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

/**
 * What he attached to one message (WS-COMPOSER → api/chat.js).
 *
 * Deliberately dumb: the client says what it has, the SERVER decides what is
 * allowed. Count, per-image bytes, total bytes and document extraction are all
 * enforced in `api/_lanes.js` / `api/_docs.js`, because a client is a phone the
 * owner can reinstall and a cap that only exists in the composer is a cap that
 * does not exist (`gate0-structural`, generalised: if a property is decidable
 * from the bytes, decide it on the bytes).
 */
export type TurnAttachments = {
  /** Up to five. Data URLs, https URLs, or `{ data, mime }`. */
  images?: Array<string | { data: string; mime?: string }>;
  /** What he typed alongside them. */
  caption?: string;
  /** Documents. `text` when the client already extracted it (preferred),
   *  `data` (base64 / data URL) when it did not — the server extracts. */
  docs?: Array<{ name?: string; mime?: string; text?: string; data?: string }>;
};

// ── the connectivity lines, and the rule that they never repeat ────────────
//
// Reached only when EVERY brain is unreachable (see the `!text` branch in
// `think`). Phrased for the medium: on a call she is SPEAKING, so "my messages
// aren't sending" would be absurd.
//
// Six of each, up from three, because the no-repeat draw below is only as good
// as the pool it draws from: with three variants a user who trips this twice
// still sees half the vocabulary. They are written as SHAPES in the same voice
// — a noticing, a small apology, a promise to come back — not as polished
// sentences, which is the `recited-prompt` discipline applied to the one place
// in the product where literal lines are legitimate.
export const OOPS_CALL: string[][] = [
  ["awaaz kat rahi h lagta h... phir se bolna?"],
  ["hello? ek second, network thoda ajeeb kar raha h"],
  ["ruk, kuch sunai nahi diya — line kharab h shayad"],
  ["ek sec ruk, awaaz aa jaa rahi h beech beech me"],
  ["sun raha h tu? mujhe kuch clear nahi aa raha"],
  ["arre yaar signal gir gaya lagta h, thoda ruk"],
];
export const OOPS_CHAT: string[][] = [
  ["yaar net kuch ajeeb kar rha", "ek min"],
  ["arre mere msg nhi ja rhe theek se 😭", "ruk"],
  ["net dikkat kar rha lagta h", "abhi aati hu"],
  ["ek sec, sab atak gya h idhar", "abhi try krti hu"],
  ["ugh phone hi hang ho rha h", "2 min"],
  ["kuch send hi nhi ho rha 🙄", "wapas aati hu"],
];

// The last index drawn, per mode. Module state is the server's answer (one
// process serves many turns, and `api/_engine.gen.js` runs this same code on
// the room path); localStorage is the client's, because a browser tab is
// recreated on reload and a per-tab memory would forget the repeat it exists
// to prevent. Both are best-effort by design — the cost of losing the memory is
// one possible repeat, and the cost of THROWING here is that she says nothing
// at all on the one path that exists because everything else already failed.
const lastOops: Record<string, number> = {};
const OOPS_KEY = "meera.oops.last";

function readLastOops(mode: string): number {
  if (mode in lastOops) return lastOops[mode];
  try {
    const raw = globalThis.localStorage?.getItem(`${OOPS_KEY}.${mode}`);
    const n = raw === null || raw === undefined ? -1 : Number(raw);
    return Number.isInteger(n) ? n : -1;
  } catch {
    return -1;
  }
}

function writeLastOops(mode: string, i: number): void {
  lastOops[mode] = i;
  try {
    globalThis.localStorage?.setItem(`${OOPS_KEY}.${mode}`, String(i));
  } catch {
    /* private mode, a server, a browser with site data blocked — see above */
  }
}

/**
 * Draw a variant that is NOT the one drawn last.
 *
 * Exported for `evals/resilience/run.mjs`, which asserts over a long run that
 * consecutive draws are never identical and that every variant is still
 * reachable — a no-repeat rule implemented as "always advance by one" would
 * pass the first assertion and turn the pool into a fixed cycle, which is a
 * different way of being predictable.
 */
export function drawNoRepeat<T>(pool: T[], mode: string): T {
  if (pool.length <= 1) return pool[0];
  const last = readLastOops(mode);
  const excluded = last >= 0 && last < pool.length;
  // Draw from the pool MINUS the last index, so every remaining variant stays
  // equally likely. Rejection sampling would do the same thing with an
  // unbounded loop; this cannot spin. With no remembered last draw the whole
  // pool is in play — an off-by-one here would silently make the final variant
  // unreachable forever, which is why the eval asserts coverage and not only
  // non-repetition.
  const span = excluded ? pool.length - 1 : pool.length;
  const j = Math.floor(Math.random() * span);
  const i = excluded && j >= last ? j + 1 : j;
  writeLastOops(mode, i);
  return pool[i];
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
  // SPEC §7.3 chat-lane adoption — see openrouterThink's identical parameter.
  defaultModel = OPENROUTER_DEFAULT_MODEL,
  attachments?: TurnAttachments,
): Promise<string | null> {
  try {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system,
        system_tail: systemTail || undefined,
        messages: turns,
        model: keys.openrouterModel?.trim() || defaultModel,
        max_tokens: maxTokens,
        ...(onDelta ? { stream: true } : {}),
        ...(noThink ? { no_think: true } : {}),
        // The set rides as its OWN field rather than being folded into `turns`
        // here, so the server can cap it before a single byte reaches a model
        // and can pick the attachment lane order (Azure first, by the owner's
        // directive). Absent fields are absent, not empty arrays — a reader
        // that does not know about them is unaffected.
        ...(attachments?.images?.length ? { images: attachments.images } : {}),
        ...(attachments?.caption ? { caption: attachments.caption } : {}),
        ...(attachments?.docs?.length ? { docs: attachments.docs } : {}),
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
    // Loaded here, not at module scope: this is the only call site, and the
    // network fetch for the chunk is dwarfed by the model call it precedes.
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
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
      .filter((b): b is AnthropicSDK.TextBlock => b.type === "text")
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
  // WS-COMPOSER seam: what he attached to THIS message. Up to five images and
  // one caption, plus documents. Passed straight through to /api/chat, which
  // validates the count and the byte caps server-side and folds the whole set
  // into ONE turn — see api/_lanes.js. The legacy single-photo path (a
  // `photoUrl` on a Message, turned into an image_url part by `toTurns`) is
  // untouched and still works; this is the shape for a SET.
  attachments?: TurnAttachments,
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

  // her carried interior — I/O (Date.now/history) stays here; the compiler
  // is a pure function over the resolved strings (SPEC §3, compiler.ts).
  // A carried feeling reaches her only on the first turn back after a real
  // gap, and never on a message SHE initiated — see the charter in inner.ts.
  const lastMsgAt = history.length ? history[history.length - 1].at || 0 : 0;
  // only CHAT directives are her opening the conversation. A call pickup is
  // THEM calling HER, and it is the single moment this feature pays for.
  //
  // Hoisted out of the innerContext call below because T13 `life.untold` is
  // gated on the SAME fact (G2: a list of things she has not told them,
  // present on a message she chose to send, is a reason to send it) and
  // compiler.ts's SelfBundleInput doc is explicit that it must be threaded
  // rather than recomputed — "two independent notions of 'she started this
  // turn' is exactly how one of them drifts".
  // `keys.sheCalled` is the cascade lane's callback signal — the same
  // sheCalled the live lane threads into its self bundle. Without it, a
  // callback SHE placed after a drop rode out with her carried thread on
  // the cascade lane: G2's own sentence, delivered by phone (the live-lane
  // half of this defect was fixed in useCallEngine; this is its twin).
  const sheInitiated = (isDirective && mode === "chat") || keys.sheCalled === true;
  const inner = innerContext(keys.inner, {
    now: Date.now(),
    lastMsgAt,
    surface: watchFrame ? "watch" : mode === "call" ? "pickup" : "chat",
    sheInitiated,
    // Her taste is PULLED from what they just said, exactly like cultureNote:
    // no match, nothing enters the prompt. Never on a directive — a message
    // she is opening is the one place an opinion would be volunteered, and a
    // companion who arrives with a take she was not asked for is exhausting.
    userText: isDirective ? "" : latest,
  });

  // Watch mode goes in EARLY in the tail, not at the point of use — see
  // compiler.compile()'s comment: api/chat.js keeps the FIRST n chars and
  // drops the rest, so the watch discretion rules must outlive a long tail's
  // truncation before recall/herLife do.
  const watching = Boolean(watchFrame) && mode === "call";

  // graph-memory recall: what she knows about their world, woven into
  // context. On live calls the lookup is done ONCE at pickup and passed in
  // as extraMemories — never in front of a spoken reply. Chat looks it up.
  const recalled =
    mode === "call"
      ? extraMemories || ""
      : keys.deviceId
        ? await recallMemories(keys.deviceId, latest)
        : "";
  // ── THE ACTIVITY LEDGER, in front of the graph ────────────────────────
  //
  // #113 wrote a finished game into the graph and nothing read it back
  // reliably: `opRecall`'s keyword leg queries `meera_nodes`, which activities
  // are never written to; the we-episode leg needs a `vy_rel_state` row, which
  // does not exist until a consolidation pass has run; so the only route left
  // was the semantic leg, which needs an embedding call to have succeeded at
  // write time. On the first external tester's device, on his first day, that
  // was the whole retrieval story for two games of chess — and when he asked
  // about them she said they had not happened, and then invented them.
  //
  // So the ledger goes FIRST, ahead of the graph rows. `api/chat.js` keeps the
  // FIRST n characters of the tail and cuts the END, which makes ordering the
  // drop policy: of the two, the graph rows are the ones that may be lost,
  // never the record of what they actually played. Same arithmetic and same
  // reason as `callMemories`' chat tail.
  //
  // It rides `memories` (T5) rather than taking a compiler slot of its own for
  // the reason stated at `formatChatTail`: compile() is pure and db-free and
  // the CALLER resolves strings, and a second heading is a second place for
  // T5's recall law to drift.
  //
  // TWO PRODUCERS, ONE BLOCK. `api/memory.js` renders its own activity block
  // for the surfaces that have no AppState to read a ledger from (the realtime
  // call lane, Telegram, WhatsApp, Discord). This lane has the better copy of
  // the same games — complete, no round trip, no embedding, correct signed out
  // — so it takes the server's out rather than rendering both and putting
  // every game in the prompt twice under two headings.
  const ledger = keys.activities !== undefined ? keys.activities : activityLedger();
  const ledgerBlock = formatActivityLedger(ledger, Date.now());
  const graph = ledgerBlock ? withoutServerActivityBlock(recalled) : recalled;
  const withLedger = ledgerBlock ? (graph ? `${ledgerBlock}\n\n${graph}` : ledgerBlock) : graph;
  // ── WS-SHARENOW: what they JUST did, in front of all of it ─────────────
  // The owner's defect was a CALL one (share, hang up, call back a minute
  // later, "kya dekha humne"), but the block belongs on this lane for the
  // reason `call-opens-with-amnesia-by-construction` ends with: a block that
  // renders on one lane and silently empties on another is how the same person
  // remembers on the phone and forgets in text. The 45-minute window means a
  // share that ended before this message is still the present moment here too.
  //
  // Same composition rule as the ledger above and for the same truncation
  // argument — `api/chat.js` keeps the FIRST n characters of the tail — except
  // one notch stronger: of everything in this string it is the block a later
  // round trip can least re-derive, since the share mirror is device-local.
  // Bounded by `JUST_HAPPENED_BUDGET` (300), and it is "" for anyone whose
  // last share, game or call is older than the window, which is this string's
  // render-nothing default.
  const justBlock = formatJustHappened(shareLedger(), ledger, history, Date.now());
  const memories = justBlock ? (withLedger ? `${justBlock}\n\n${withLedger}` : justBlock) : withLedger;
  // WS-INTEGRATE seam 1 (T2/T3/T4/T6): the relstate bundle rode the SAME
  // op:"recall" response `memories` just resolved from (memory.ts's
  // takeRelBundle — see that file's header for why this isn't its own
  // network call). Absent deviceId, absent bundle, or a directive turn (no
  // live user text to gate on — moment.ts's pull-only law reads ONLY the real
  // turn) all fall through to `null`, and compile() renders nothing for any of
  // them — the byte-identity default.
  //
  // ── WS-CONTINUITY seam 1 (docs/SPEC-CONTINUITY.md §1) ──────────────────
  // The `mode === "call"` arm used to be part of that null: "the call lane's
  // memory lookup happens once at pickup in useCallEngine.ts, outside this
  // function, and is out of scope for this seam (useCallEngine.ts is a
  // different ticket)". That ticket is this one. The deferral was never a
  // decision — its own comment says so — and its cost was T2/T3/T4/T6 going
  // dark on every call, i.e. a structurally shallower person on the phone.
  //
  // The lanes differ ONLY in where the bundle comes from, never in what is
  // rendered from it:
  //   chat — pulled from takeRelBundle's consume-once cache, which brain.ts
  //          has just refreshed by awaiting recallMemories two lines up.
  //   call — handed in on `keys.relBundle`, fetched once during the RING
  //          (rejected.md#murmur-timbre: the ring is already-idle time with
  //          no call-path cost) and reused for every turn of the call, since
  //          a spoken turn may not sit behind a network lookup (`live-floor`).
  // Everything downstream — the moment gate, the render calls, the drop
  // order, the age-tier drop — is the same code on both lanes, because there
  // is now only one assembler.
  // A call PICKUP is a directive, and it was the one compile in the repo
  // where the rupture stance went dark: if the live lane won the connect
  // race she knew about the fight, if cascade won she didn't. selfBundle
  // two lines down already makes exactly this distinction ("a directive
  // turn does NOT null this"); relBundle now makes the same one — only a
  // CHAT directive (openers, follow-ups) skips the bundle.
  const relBundle =
    (isDirective && mode === "chat") || !keys.deviceId
      ? null
      : mode === "call"
        ? keys.relBundle ?? null
        : takeRelBundle(keys.deviceId);

  // ── T-H1 (`selfbundle-never-set`): the self layer's three tail slots ────
  // Same two sources as relBundle, for the same reason — chat pulls the
  // consume-once cache the awaited recall two lines up just refreshed; the
  // call lane reads what the RING fetch put in memory.ts's call-lane holder,
  // since a spoken turn may not sit behind a network lookup (`live-floor`).
  //
  // ONE DIFFERENCE FROM relBundle, and it is deliberate: a directive turn does
  // NOT null this. relBundle is nulled on a directive because its slots are
  // moment-gated and a directive has no user turn to gate on; the self layer
  // handles the same fact differently and more precisely —
  //   T13 is suppressed by `sheInitiated` INSIDE renderUntold, which is G2's
  //       stated mechanism and the only thing that flag exists for. Nulling
  //       the bundle here would make it a field that can never be true, i.e.
  //       `dead-writers` in the very ticket that exists to close a
  //       `dead-writers` instance.
  //   T12 is already dark on a directive without any help: compile() computes
  //       its moment gate only when relBundle is present, so an absent
  //       relBundle gives renderSelfArc an empty moment and it renders "".
  //   T11 is not turn-shaped at all. It is how the two of them talk, and a
  //       message she opens is still a message in that rapport.
  //
  // An explicitly-passed `keys.selfBundle` wins on BOTH lanes, and the test is
  // `!== undefined` rather than `??`: a caller that passes `null` means "no
  // self layer on this turn", and `??` would silently overrule it with the
  // holder's contents. Absent (undefined) is the only state that falls
  // through to a lookup.
  const selfSource =
    keys.selfBundle !== undefined
      ? keys.selfBundle
      : !keys.deviceId
        ? null
        : mode === "call"
          ? callSelfBundle(keys.deviceId)
          : takeSelfBundle(keys.deviceId);
  const selfBundle: SelfBundleInput | null = selfSource ? { ...selfSource, sheInitiated } : null;

  const compiled = compile({
    user,
    messageCount: history.length,
    medium: mode === "call" ? "voice" : "text",
    mode,
    voiceEngine,
    isDirective,
    watching,
    innerThread: inner.thread,
    innerWants: inner.wants,
    memories,
    herLife: keys.herLife || "",
    cultureNoteText: mode === "chat" && !isDirective ? cultureNote(latest) : "",
    relBundle,
    selfBundle,
    latestUserText: isDirective ? "" : latest,
    gapSinceLastMs: lastMsgAt ? Math.max(0, Date.now() - lastMsgAt) : 0,
    // T9 reads the clock from here rather than calling Date.now() itself, so
    // compile() stays a pure function of its input and the double-compile
    // byte-identity gate cannot flap on a minute rollover.
    nowMs: Date.now(),
    // T14 rel.raised — the repetition signal is derived from the transcript
    // itself, so the transcript is the only input it needs.
    recentTurns: history,
    // T16 her.commitments — the promises SHE made, visible instead of
    // silently forgotten (task #119; the slot renders zero bytes when empty)
    herCommitments: herCommitments(history, Date.now()),
    // T15 — the same activity object the allowlist above was built from, so
    // what she is told and what she is permitted to name cannot drift apart.
    activity: keys.activity ?? null,
    // fresh every call — see the import comment above; getAgeTier() reads
    // clock.ts's live module state, never a value carried across turns here
    ageGates: gatesFor(getAgeTier()),
  });
  const sysCore = compiled.core;
  let sysTail = compiled.tail;
  // ── #117: a milestone she gets to mention herself ───────────────────────
  // A FACT, never a script (recited-prompt): momentFact() is telegraphic and
  // third-person, so there is no sentence here she could read out. Fresh for
  // twelve hours, then it renders nothing — a fact that stayed for days would
  // become a recurring line, which is the opposite of a moment. Deliberately
  // NOT appended last: the decision rules keep the last word (prompt-position
  // law), and a moment should be AVAILABLE, not fired 8-in-8 — mentioning it
  // every turn is exactly the robotic tell this feature exists to avoid.
  const MOMENT_FRESH_MS = 12 * 60 * 60 * 1000;
  const momentLine =
    keys.moment && Date.now() - keys.moment.at < MOMENT_FRESH_MS ? keys.moment.fact.trim() : "";
  if (momentLine)
    sysTail += `\n\nNEW, true, from your shared record: ${momentLine}. Yours to bring up in your own words if it fits; never as an announcement, never more than once.`;
  diag("chat", "inner_tail", {
    tail: sysTail.length,
    thread: inner.thread.length,
    wants: inner.wants.length,
    // api/chat.js keeps the first 14000 chars of the tail — if this ever
    // trips, the interior is not the thing that should be dropped
    over: sysTail.length > 14000,
  });
  // api/chat.js keeps the first 14000 chars of the tail, and the decision rule
  // is the last thing in it — so if this ever trips, the rule is the first
  // casualty and the trim has to happen in recall instead
  if (mode === "chat")
    diag("chat", "tail_built", { tail: sysTail.length, over: sysTail.length > 14000 });

  // ── WS-MANIFEST Phase D prep (docs/SPEC.md §3.3/§7.3): compile.manifest
  // telemetry + chat-lane router call-site adoption. Both computed once,
  // here, so the diag record below and the model actually handed to
  // openrouterThink/proxyThink further down can never disagree with each
  // other — the same "compute once, reuse" discipline moment.ts's gate
  // already uses for T4/T6.
  const chatRoute = routeChatLane();
  diag("chat", "route.decision", toTelemetryDetail("chat", chatRoute));

  const coreHash = hashCore(sysCore);
  const manifestHash = hashManifest(compiled.sections ?? {});
  // "core_hash changes rarely — emit full record on change, per-turn record
  // small" (ticket text, SPEC §3.3/§7.3). `lastCoreHash` is module state so
  // this compares against the PREVIOUS turn in this app run, not this turn
  // against itself.
  const coreChanged = coreHash !== lastCoreHash;
  lastCoreHash = coreHash;
  diag("chat", "compile.manifest", {
    // small, every turn — SPEC §7.3's required field set. Hashes and counts
    // only: diag.ts's content-free contract, never a character of the
    // actual prompt.
    core_hash: coreHash,
    manifest_hash: manifestHash,
    adapter_version: chatRoute.adapter_version,
    model: chatRoute.model,
    medium: mode === "call" ? "voice" : "text",
    tail_bytes: sysTail.length,
    core_changed: coreChanged,
    // full record ONLY on a core_hash change (a deploy or persona edit,
    // not an ordinary turn) — per-block byte sizes and the raw core length,
    // still structural, never prompt text.
    ...(coreChanged
      ? {
          core_bytes: sysCore.length,
          sections: compiled.sections ?? {},
        }
      : {}),
  });

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

  // calls: token cap (spoken replies are short) + streaming. The call brain is
  // the same gemini-3.6-flash as chat — the lite model kept misreading
  // Hinglish; streaming pays for the smarter model's latency.
  //
  // 190 -> 400. The old cap was sized for a model that emits only reply text,
  // and it silently became a correctness bug on any model that thinks first:
  // measured, reasoning tokens ate the budget and cut her off MID-WORD on 3-5%
  // of spoken turns, once answering a question about a grandmother's death
  // anniversary with two words and stopping. Raising it takes that to 0%.
  //
  // The reason to fear a bigger cap was that she would ramble, and that was
  // measured too: 27.7 words vs 28.7 at the old cap, and latency 1549ms vs
  // 1636ms. Her length is governed by the FINAL two-count block in the brief,
  // not by the ceiling — so the cap was never holding her short, it was only
  // truncating the unlucky turns. A ceiling should be a safety net, not a
  // silent editor.
  const maxTokens = mode === "call" ? 400 : 700;
  let text: string | null = null;
  const fullSystem = sysCore + sysTail;

  // ── the honesty gate's context, assembled once per turn ────────────────
  // Hoisted ABOVE the model call because the call lane has a second door out
  // of this function — `onDelta` streams raw tokens into the TTS speaker while
  // the rest is still generating — and that door opens before any reply
  // exists to gate. See honesty.ts's "THE STREAMING DOOR".
  //
  // `trustedText` is provenance: her assembled brief (which carries
  // CRISIS_LINES, so the helplines survive) and HIS own words. Never her own
  // past output — see allowedFrom's note on why the chain must terminate at
  // something that is not her.
  const honestyCtx = {
    // `keys.activity?.nameable` is here for a reason the seam review caught
    // before production did: `honesty-provenance-allowlist` treats an
    // identifier she emits that was not in her input as INVENTED, and a chess
    // move like "Nf3" is identifier-shaped. Without the nameable set the gate
    // would correctly flag moves that really WERE played. She may name what she
    // was given — the moves in the record — and nothing else.
    trustedText: [
      fullSystem,
      latest,
      ...(momentLine ? [momentLine] : []),
      ...(keys.activity?.nameable ?? []),
      ...history.filter((m) => m.from === "me").map((m) => m.text || ""),
    ],
    openItems: openCommitments(history),
    // family 5 (channel promises) is channel-aware: the call lane refuses ANY
    // future send-promise (a call delivers nothing), chat only out-of-band.
    channel: mode,
    // Family 3 (false attribution). HIS words only — not `fullSystem`, which
    // mentions half the world and would make the check vacuous, and never her
    // own output, for the same reason allowedFrom refuses it. `latest` is his
    // message this turn and belongs in the vocabulary he is quotable from.
    hisVocab: hisVocabulary([...history, { from: "me" as const, text: latest }]),
    // Family 4 (shared past). The graph's memory text and the live activity
    // are the parts of the shared record this conversation hasn't said out
    // loud: an episode in `memories` or a we-episode in the rel bundle really
    // happened (provenance-clean by construction), so a moment she was HANDED
    // is a moment she may retell. NOT fullSystem — the brief mentions beaches
    // and photos in its own instructions, which would make "our beach photos"
    // vacuously supported. The union with his words happens inside inspect().
    sharedVocab: sharedVocabulary([
      memories,
      ...(relBundle?.weEpisodes ?? []).map((e) => JSON.stringify(e)),
      ...(relBundle?.rituals ?? []).map((r) => JSON.stringify(r)),
      ...(keys.activity?.facts ?? []),
      ...(keys.activity?.nameable ?? []),
      // the durable half of the live activity, and the ledger of finished
      // ones. Both are records she was HANDED — same provenance class as an
      // episode — so a game she really played is a game she may retell.
      ...(keys.activity?.record ?? []),
      ...ledger.map((r) => r.summary),
      // #117 — a crossed milestone is shared past SHE WAS HANDED, same
      // provenance class as an activity fact: without this, "100 din ho
      // gaye humein" would be flagged as an invented shared memory by the
      // very gate that exists to catch invented shared memories.
      ...(momentLine ? [momentLine] : []),
    ]),
    // Family 6 (invented specifics of a real activity). Its own set, because
    // `sharedVocabulary`'s tokenizer drops digits and every chess move is a
    // letter and a digit — see `activityVocabulary`. Same sources as family
    // 4's, plus HIS words, which are ground truth on every channel and are
    // what make "d4 tak sahi tha" checkable when he is the one who said d4.
    //
    // FAIL-CLOSED, and the condition is the record rather than the context:
    // the field is set ONLY when this person has actually done an activity —
    // one live, or one in the ledger. Two reasons, and the second is the one
    // that matters. (1) `honesty-provenance-allowlist`: with no record to
    // check against, every real detail is unsupported, so the gate would flag
    // truths. (2) The named seam this family accepts, stated rather than
    // hidden: the predicate reads "a claim about a game", and a sentence about
    // a cricket match — "kal ka match draw hua tha" — has that shape. Someone
    // who has never opened a board should never meet this family at all, and
    // for someone who has, the cost of the residual is one soft canned line
    // that hands the question back to him. Same trade families 3 and 4 make.
    activityVocab:
      keys.activity || ledger.length
        ? activityVocabulary([
            ...(keys.activity?.facts ?? []),
            ...(keys.activity?.nameable ?? []),
            ...(keys.activity?.record ?? []),
            ...ledger.map((r) => r.summary),
            memories,
            ...(relBundle?.weEpisodes ?? []).map((e) => JSON.stringify(e)),
            latest,
            ...history.filter((m) => m.from === "me").map((m) => m.text || ""),
          ])
        : undefined,
  };
  const honestyAllowed = allowedFrom(honestyCtx.trustedText);
  // The streaming door. Only class (A) — an identifier is a self-contained
  // token and can be decided as it goes; a receipt claim needs a clause, and
  // by the time a clause closes its first half has already been spoken. That
  // limit is real and is stated rather than papered over: the spoken stream
  // carries the (A) guarantee and not the (B) one, while the reply that is
  // logged, remembered and spoken on every non-streaming path carries both.
  const streamGuard = onDelta && mode === "call" ? createStreamGuard(onDelta, honestyAllowed) : null;

  // A message carrying an attachment SET goes to the proxy and nowhere else.
  // The user's own OpenRouter/Claude keys are direct client-side lanes: they
  // never see the `images`/`docs` fields, so a photo turn on those lanes would
  // reach the model with the pictures silently missing — she would answer "kya
  // bheja?" to five photos, which reads as her not looking. The proxy is also
  // the only place the caps, the document extraction and the Azure-first
  // attachment order exist. One place, on purpose.
  const hasAttachments = Boolean(attachments?.images?.length || attachments?.docs?.length);
  if (keys.openrouterKey && !hasAttachments)
    text = await openrouterThink(keys, fullSystem, turns, maxTokens, chatRoute.model);
  if (!text && keys.apiKey && !hasAttachments) text = await claudeThink(keys, fullSystem, turns);
  if (!text)
    text = await proxyThink(
      keys,
      sysCore,
      sysTail,
      turns,
      maxTokens,
      streamGuard ? (d: string) => streamGuard.push(d) : undefined,
      mode === "call",
      chatRoute.model,
      attachments,
    );
  if (streamGuard) {
    streamGuard.flush();
    if (streamGuard.blocked) diag("call", "honesty_stream_block", { n: streamGuard.blocked });
  }
  if (!text) {
    // every brain unreachable. crisis/honesty replies still go out; anything
    // else becomes an honest connectivity text — never fake conversation.
    if (local.critical) return local;
    if (isDirective) return { bubbles: [] };
    // honest connectivity trouble, phrased for the medium: on a call she's
    // SPEAKING, so "my messages aren't sending" would be absurd
    //
    // THESE ARE ALLOWED TO BE LITERAL LINES, and that is the exception rather
    // than the rule. `recited-prompt` bans sentence-shaped text in her BRIEF,
    // because anything she is shown becomes a phrase bank. These are not in her
    // brief — no model ever sees them; they are what the code says when no
    // model could be reached at all. What the law still binds is the outcome it
    // was written about: she must not repeat herself verbatim. On 2026-08-24 she
    // sent the SAME pair three times in ninety minutes, and the reason was a
    // plain uniform draw with nothing forbidding a repeat.
    const oops = mode === "call" ? OOPS_CALL : OOPS_CHAT;
    return {
      bubbles: drawNoRepeat(oops, mode),
      learned: local.learned,
    };
  }

  // ── the honesty gate (src/engine/honesty.ts) ───────────────────────────
  // Structural, on the OUTPUT path, because the prompt rule at persona.ts:255
  // is mid-brief (38.6% through the file) and `prompt-position` measured an
  // identical rule firing 0/8 there. `gate0-structural` is the law this
  // follows: the prompt arm leaked 57–98%, the predicate leaked 0 of 31,122.
  //
  // Applied at EVERY parseBubbles site rather than once before `return`,
  // because the holding bubble on the [search:] path is handed to the UI from
  // inside that branch and would otherwise leave ungated. `dead-writers`
  // sharpened: a gate the bytes can walk around is an absent gate.
  const gate = (r: ParsedReply): ParsedReply => {
    // Register first, then provenance. The dash strip is text-lane only and
    // rides this same choke point for the reason the comment above gives:
    // both parseBubbles sites pass through here, so a bubble cannot reach the
    // UI around it. See `stripTextingDashes`.
    if (mode !== "call" && r.bubbles?.length) {
      r.bubbles = r.bubbles.map(stripTextingDashes).filter(Boolean);
      // GREET ONCE PER SITTING (src/engine/greeting.ts). Reported as three
      // hellos inside one unbroken conversation — she opened "heyyy", he said
      // "Hello", she said "hey …", he said "Esse hi timepass", she said
      // "heyy …". Mirroring his greeting beats any brief line that says not
      // to, which is `gate0-structural` again: the prompt arm of a rule leaks,
      // the predicate on the bytes does not. So the brief stays byte-unchanged
      // and the second hello is taken off here, at the same choke point and
      // for the same reason as the dash strip — text lane only, because a
      // spoken hello on a call is a different act with its own timing.
      //
      // `history` is the record as it stands BEFORE this reply lands, which is
      // exactly the question the predicate asks: has she already said hello in
      // this sitting? Her first message of a sitting is untouched.
      const g = greetOnce(r.bubbles, history as unknown as GreetTurn[], Date.now());
      if (g.stripped || g.dropped || g.degraded) {
        // Counts and flags only — diag.ts never logs what she said.
        diag("chat", "greet_once", {
          stripped: g.stripped,
          dropped: g.dropped,
          degraded: g.degraded,
          bubbles: g.bubbles.length,
        });
      }
      r.bubbles = g.bubbles;
    }
    const { reply, findings } = guardReply(r, honestyCtx);
    // Counts and rule names only — diag.ts never logs what she said, and the
    // whole point of this event is that the string it caught must not travel.
    if (findings.length) {
      diag(mode === "call" ? "call" : "chat", "honesty_block", {
        n: findings.length,
        rules: [...new Set(findings.map((f) => f.rule))].join(","),
        kinds: [...new Set(findings.map((f) => f.kind).filter(Boolean))].join(","),
        open_items: honestyCtx.openItems.length,
      });
    }
    return reply;
  };

  let parsed = gate(parseBubbles(text));
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
    // Over budget behaves EXACTLY like a lookup that failed: `ok` stays false,
    // `facts` stays empty, and the second pass already has an honest line for
    // that — "say you couldn't check right now, casually, and don't fill the
    // gap yourself". So a rate limit degrades into her not knowing, which is
    // true, rather than into a promise she quietly drops.
    // A search HE asked for draws from the explicit bucket, not curiosity's:
    // being over budget on a direct instruction is refusal, not thrift.
    const explicitAsk = RE_EXPLICIT_SEARCH.test(latest);
    const slot = parsed.search ? (explicitAsk ? takeExplicitSearchSlot() : takeSearchSlot()) : false;
    if (!slot && parsed.search) {
      diag("chat", "search_capped", {
        window_ms: SEARCH_WINDOW_MS,
        cap: explicitAsk ? EXPLICIT_SEARCH_BUCKET : SEARCH_BUCKET,
        explicit: explicitAsk,
      });
    }
    if (parsed.search && slot && left > 1_500) {
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
      // `attachments` rides the second pass too: the lookup pass rebuilds the
      // tail, not the turns, and a photo that vanished between pass 1 and pass
      // 2 would have her answer about a picture she can no longer see.
      const second = await proxyThink(keys, sysCore, tailWithFacts, turns, maxTokens, undefined, false, chatRoute.model, attachments);
      if (second) {
        const p2 = gate(parseBubbles(second));
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

  // ── they asked her to forget something, and she said yes ──
  // This runs BEFORE her words are handed back, so the rows are already gone
  // by the time "haan, hata diya" reaches them. The other order — reply now,
  // delete on the way out — is the one that lets her say it and have it not
  // be true yet, which is the exact failure this whole feature exists to fix.
  // Awaited on both surfaces: a spoken "bhool ja" on a call must delete as
  // surely as a typed one.
  if (parsed.forget && keys.deviceId) {
    const target = resolveForget(parsed.forget, history);
    // no target = refused (a whole-memory wipe) or unreadable. Nothing is
    // deleted and nothing is claimed: `forgot` stays unset, so no caller
    // downstream shows a receipt for something that did not happen.
    const res = target
      ? await forgetMemories(keys.deviceId, target, undefined, { nohook: mode === "call" })
      : null;
    diag("chat", "forget_fire", {
      scope: target?.scope || "refused",
      ok: Boolean(res),
      receipt: res?.receipt || "none",
      ...(res?.deleted || {}),
    });
    // ── A1: THE RECEIPT IS GATED ON WHAT ACTUALLY MATCHED ─────────────────
    // She has already written "haan hata diya" by this point — the marker and
    // the agreement come out of the same generation. When nothing matched,
    // those words are a lie about the strongest promise in the product, and
    // the ask is the honest version of the same turn: name it and she will.
    //
    // Replacing her bubbles with a fixed line is a thing this file does in
    // exactly one other place (the post-search silence) and for the same
    // reason: the alternative is worse, and this line asserts nothing about
    // the world — it only asks. It is deliberately not in persona.ts, because
    // a sentence in a brief is a sentence she recites elsewhere.
    if (target && res?.receipt === "none") {
      parsed.bubbles = ["kaunsi wali? naam bata do"];
      parsed.photo = undefined;
      parsed.voice = undefined;
      parsed.gif = undefined;
      diag("chat", "forget_unmatched", { scope: target.scope });
    } else if (target && res) {
      parsed.forgot = { target, receipt: res.receipt, deleted: res.deleted };
    }
    parsed.forget = undefined;
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
