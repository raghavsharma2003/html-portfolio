// Looking something up ON A CALL.
//
// Chat has an easy version of this: she writes "ruk dekh ke batati hu", the
// marker goes out with it, and the round trip happens behind a message that is
// already on screen. A live call has none of that. The realtime model answers
// ~1.5s after the caller stops talking, it cannot make a non-blocking tool
// call (Gemini 3.1 Flash Live does not support NON_BLOCKING, and a synchronous
// call freezes her mid-sentence for the whole lookup), and server-side
// google_search grounding is quota-blocked on this account — verified by
// opening real sessions: a no-tools setup completes in ~200ms, the same setup
// with google_search closes with 1011 "you exceeded your current quota", 3/3.
//
// So the lookup cannot sit inside her turn. It runs BESIDE it:
//
//   they finish speaking ──► transcript arrives
//        │                      │
//        │                      └─► trigger? ──► /api/search (fast, ~2.6s)
//        └─► she answers from her own head at ~1.5s ("ruk, dekhti hu")
//                                             │
//   facts land ~1s after she has already started talking ──► direct() note
//                                             └─► she says the number next
//
// Which is what a person on a phone actually does: react first, look second,
// tell you a beat later. An announced pause is human; the thing that reads as
// broken is unannounced silence — so the prompt rule that goes with this
// (see the patch file) is that on a call she ALWAYS says she is checking
// before the gap, and never goes quiet to go look.
//
// The trigger is deliberately narrow. A companion app's ambient vocabulary is
// "kitna", "kab", "aaj", "abhi" — a naive keyword trigger fires on "kitna miss
// kiya tumhe aaj", which would ship an intimate sentence to a search index and
// then answer it with an exchange rate. Requiring a factual-domain noun AND a
// question shape AND the absence of relational language measured 0 false fires
// in 55 ordinary turns (including 25 written specifically to break it) at 86%
// recall on 14 real lookups. That precision is what makes it acceptable to
// send the raw sentence at all: it leaves the device only on turns that are
// unambiguously factual questions.

import { diag } from "../engine/diag";
import { Capacitor } from "@capacitor/core";

const BASE = Capacitor.isNativePlatform() ? "https://meera-silk.vercel.app" : "";

// A factual domain has to be named. Question words alone are not evidence:
// they are how everyone talks all day.
const FACT =
  /\b(score|scores|match|rate|rates|price|prices|daam|bhav|petrol|diesel|cng|gold|sona|chandi|silver|dollar|usd|inr|rupee|exchange|weather|mausam|barish|temperature|aqi|forecast|news|khabar|headline|down|outage|band|khula|khuli|release|released|launch|launched|result|results|flight|train|metro|traffic|jeeti|jeeta|haari|haara|nifty|sensex|stock|bitcoin|crypto)\b/i;
// …and it has to be asked, not mentioned. "launch pe pizza khaya tha" is a
// story about lunch.
const ASK =
  /(\?|\bkya\b|\bkitna\b|\bkitne\b|\bkitni\b|\bkaisa\b|\bkaisi\b|\bkaise\b|\bkab\b|\bkaun\b|\bkahan\b|\bkahaan\b|\bya\b|\bhow much\b|\bwhat(?:'s| is)?\b|\bwhen\b|\bis it\b)/i;
// …and it must not be about the two of them. A factual word inside a personal
// sentence is still a personal sentence.
const PERSONAL =
  /\b(miss|pyaar|pyar|love|sad|feel|feeling|mood|yaad|thak|bore|tension|cute|dukh|khush|gussa|akela|lonely|sorry|maaf|dar|neend|sapna|tumse|tumhe|tumhara|tumhari|tumhare|tujhe|tera|teri|mera|meri|mere|main\b|hum\b|uske sath|dost)\b/i;

const MIN_GAP_MS = 45_000; // one lookup per caller turn cluster, not per clause
const FETCH_MS = 5_500; // the endpoint carries its own 4.5s fuse inside this

let lastFiredAt = 0;

/** Would this spoken turn be worth checking? Pure, local, no network. */
export function shouldLookUp(said: string): boolean {
  const s = String(said || "").trim();
  if (s.length < 8 || s.length > 240) return false;
  return FACT.test(s) && ASK.test(s) && !PERSONAL.test(s);
}

/**
 * Fire the lookup for a caller turn and resolve with the note to hand to
 * `direct()`, or "" if there is nothing worth saying. Never throws, never
 * blocks anything: the caller starts this and forgets about it.
 */
export async function callLookup(said: string): Promise<string> {
  if (!shouldLookUp(said)) return "";
  const now = Date.now();
  if (now - lastFiredAt < MIN_GAP_MS) {
    diag("call", "lookup_skip", { reason: "rate" });
    return "";
  }
  lastFiredAt = now;
  const t0 = now;
  try {
    const res = await fetch(`${BASE}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // "fast" trades a slightly shorter answer for a tighter tail — measured
      // p50 2.58s / max 3.71s against 3.18s / 4.00s for the chat settings.
      // On a call the shorter answer is also the better one: it is going to
      // be spoken out loud, not read.
      body: JSON.stringify({ q: said.slice(0, 200), mode: "fast" }),
      signal: AbortSignal.timeout(FETCH_MS),
    });
    const body = res.ok ? await res.json() : null;
    const facts = String(body?.facts || "").trim();
    diag("call", "lookup_done", {
      ms: Date.now() - t0,
      ok: !!facts,
      cached: !!body?.cached,
      klass: body?.class || "none",
      status: res.status,
    });
    if (!facts) return "";
    return note(facts, body?.confidence === "soft");
  } catch {
    diag("call", "lookup_done", { ms: Date.now() - t0, ok: false, klass: "error" });
    return "";
  }
}

// The note is injected as a user-role clientContent turn, which is the only
// channel the live session offers. So it has to say, unambiguously, that this
// is HER phone and not something the caller said — otherwise she answers the
// facts as if they had been read out to her. It also has to give her an exit:
// a lookup that missed the point must be droppable without a word.
function note(facts: string, soft: boolean): string {
  return `[not spoken by them — you just glanced at your phone while talking. This is what it said:
${facts.slice(0, 600)}
Say the useful part out loud now, in one short spoken line, the way you'd read something off your screen mid-call. ${
    soft
      ? "This one is just what the internet says, so keep it loose — no asserting it as fact."
      : "Round it, don't recite it."
  } If it doesn't actually answer what they asked, say you couldn't find it properly and move on — never fill the gap yourself. Never mention searching, looking up, or results.]`;
}

/** Test seam: forget the rate-limit window. */
export function resetLookupWindow() {
  lastFiredAt = 0;
}
