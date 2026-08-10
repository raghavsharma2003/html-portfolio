// Live web lookup for her brain — used ONLY when she decides a fresh fact
// would make the reply better ([search: …] protocol). One fast pass through
// OpenRouter's web plugin; returns compact facts, never raw pages.
//
// Four things this endpoint is responsible for beyond "fetch an answer":
//
//  1. LOCALE AND DATE. The old prompt said "you are a fast lookup tool" and
//     nothing else, so "dollar ka rate" came back leading with PKR and
//     answers occasionally arrived in Devanagari. Anchoring the user in India,
//     in INR, on today's date, fixes that at the source.
//  2. SHAPE. Every substantive lookup used to come back as markdown bullets
//     and bold, which was then handed to a persona whose hard rules ban bullet
//     points and bold. The style leaked into her replies. Plain text only,
//     enforced both in the prompt and with a strip on the way out.
//  3. FRAME BREAKS. "what did my flatmate eat" returned "I do not have access
//     to your private personal life", and a form-encoded probe returned "Hello!
//     How can I help you today?" — which the client then injected into her
//     prompt labelled as true facts. An assistant-voice answer is not a fact;
//     it is returned as empty so her honest "couldn't check" path fires.
//  4. TIME. The measured p50 is ~3.2s and that is dominated by the upstream
//     model, not by how many results it reads (measured: max_results 1, 4 and
//     8 are within each other's noise, and effort:"low" costs ~900ms for no
//     gain). So the real time/quality lever is not search depth — it is not
//     searching twice. Identical questions ("aaj ka score", "dollar rate",
//     "is X down") repeat constantly across users inside the window where the
//     answer has not changed, so this caches on a hash of the normalized
//     query, with a TTL set by what kind of question it is.
//
// Response: { facts, cached?, class?, confidence?, skipped? }. `facts` is ""
// for anything the caller should treat as "could not check" — the client
// already has an honest branch for that, and an empty answer is always safer
// than a confident wrong one.
import { createHash } from "node:crypto";
import { allow, ipOf } from "./_ratelimit.js";
import { q } from "./_db.js";
import { OPENROUTER_KEY } from "./_config.js";

const KEY = process.env.OPENROUTER_API_KEY || OPENROUTER_KEY;

// Upstream must die just BEFORE the client gives up (brain.ts aborts at 7s),
// otherwise the function keeps running and the web plugin keeps billing for a
// result nobody will ever read. "fast" is the voice path: on a call a lookup
// that has not landed in ~4.5s has already lost to the conversation — but the
// measured max is 3.7s, so a fuse at 3.8s was cutting off real answers.
const UPSTREAM_MS = 6_500;
const UPSTREAM_FAST_MS = 4_500;
const CACHE_READ_MS = 400; // never let a slow DB become the latency

// Staleness a person would not notice, per question type. A cricket score
// moves in seconds; a fuel price moves once a day. Getting this wrong in the
// generous direction would reintroduce exactly the failure the lookup exists
// to prevent, so the live classes stay very short.
const TTL = {
  live: 45, // scores, "is X down", anything in progress
  money: 300, // fx, fuel, gold, prices
  news: 900, // today's headlines
  weather: 1800,
  released: 21600, // "has X come out yet" — changes once, then never
  general: 600,
};

const CLASSES = [
  [/\b(score|scores|live|match|wicket|inning|goal|kaun jeet|jeeta|haar|result|down|outage|not working|status)\b/i, "live"],
  [/\b(rate|price|prices|rupee|dollar|usd|inr|gold|silver|petrol|diesel|fuel|cost|kitne ka|kitna h|kitne rupay|exchange)\b/i, "money"],
  [/\b(weather|forecast|rain|barish|temperature|humid|aqi|mausam)\b/i, "weather"],
  [/\b(released?|release|launch(ed)?|out yet|aa gaya|aayi kya|premiere|trailer)\b/i, "released"],
  [/\b(news|today|aaj|abhi|breaking|happened|hua kya|kya hua)\b/i, "news"],
];

// A lookup is for facts with sources. These shapes have no fact to find, and
// answering them from a web summary would put someone else's opinion in her
// mouth stamped as true.
const NOT_A_FACT =
  /^\s*(should i\b|what should i\b|kya karu|kya karun|do you think|tumhe kya lagta|tujhe kya lagta|is it worth|am i\b|do i\b|how do i feel|kaisa lagta h(ai)?\b)/i;

// Culture questions ("what's the trending meme") do return something, but it
// comes from listicles, not from a source. Flagged so the caller can hedge it
// instead of asserting it. The real answer for this class is the recognition
// index in api/culture.js, which is built off the hot path and cannot be
// asserted as something she saw.
const SOFT = /\b(meme|memes|trending|viral|funny|vibe|slang|aesthetic|everyone.?s (talking|posting)|popular right now)\b/i;

// An answer in assistant voice is a frame break, not a fact.
const FRAME_BREAK =
  /^\s*(i (do not|don't|cannot|can't|am|'m)\b|i'?m sorry|sorry,|as an ai|as a language model|how can i (help|assist)|hello[!,. ]|hi[!,. ]|please (provide|specify|clarify)|it (seems|appears) (like )?(you|there)|there (is|are) no (information|specific))/i;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "search", 15)) return res.status(429).json({ error: "slow down" });
  if (!KEY) return res.status(500).json({ error: "no key configured" });

  try {
    const q0 = String(req.body?.q || "").slice(0, 200).trim();
    if (!q0) return res.status(400).json({ error: "q required" });
    // "fast" is the voice path: a shorter fuse and a single result, because on
    // a call the answer is racing her next sentence, not a typing indicator.
    const fast = req.body?.mode === "fast";

    if (NOT_A_FACT.test(q0)) {
      // no upstream call, no spend — she has her own opinion, she doesn't
      // need the internet's
      return res.status(200).json({ facts: "", skipped: "not_a_fact" });
    }

    const klass = classOf(q0);
    const key = createHash("sha256").update(norm(q0)).digest("hex").slice(0, 32);
    const ttl = TTL[klass] || TTL.general;

    const hit = await readCache(key, ttl);
    if (hit) {
      return res
        .status(200)
        .json({ facts: hit, cached: true, class: klass, confidence: SOFT.test(q0) ? "soft" : "sourced" });
    }

    // a client that has hung up must not keep the web plugin billing
    const aborter = new AbortController();
    const kill = setTimeout(() => aborter.abort(), fast ? UPSTREAM_FAST_MS : UPSTREAM_MS);
    req.on?.("close", () => aborter.abort());

    let upstream;
    try {
      upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${KEY}`,
          "Content-Type": "application/json",
          "X-Title": "Meera",
        },
        body: JSON.stringify({
          model: "google/gemini-3.6-flash",
          // Depth is not the latency lever people assume: measured across 1, 3,
          // 4 and 8 results the times overlap, and dropping to a single result
          // measurably HURT accuracy (Lucknow petrol came back ₹94.65 against
          // ₹101.86 from three sources). The fast path's saving comes almost
          // entirely from generating fewer tokens, so it keeps three sources
          // and shortens the answer instead — measured p50 2.58s vs 3.18s.
          plugins: [{ id: "web", max_results: fast ? 3 : 4 }],
          max_tokens: fast ? 200 : 350,
          // "minimal" vs "low" measured ~900ms apart with no quality change
          // on this question class. Do not raise it.
          reasoning: { effort: "minimal" },
          messages: [
            { role: "system", content: systemPrompt(fast) },
            { role: "user", content: q0 },
          ],
        }),
        signal: aborter.signal,
      });
    } catch {
      clearTimeout(kill);
      return res.status(504).json({ error: "search timeout", facts: "" });
    }
    if (!upstream.ok) {
      clearTimeout(kill);
      // never collapse the cause again: a billing 402 and a slow upstream used
      // to be the same opaque "search failed", which is how a dead endpoint
      // stayed dead without anyone noticing
      return res.status(502).json({ error: "search failed", upstream: upstream.status, facts: "" });
    }

    // the deadline covers reading the body too — headers arriving fast is not
    // the same as the answer arriving fast
    let data;
    try {
      data = await upstream.json();
    } catch {
      return res.status(504).json({ error: "search timeout", facts: "" });
    } finally {
      clearTimeout(kill);
    }
    const facts = sanitize(data?.choices?.[0]?.message?.content ?? "");
    if (facts) {
      // serverless freezes after the response — the cache write is awaited or
      // it does not happen. It costs ~1 round trip against a ~3s lookup.
      await writeCache(key, facts, klass);
    }
    return res.status(200).json({
      facts,
      cached: false,
      class: klass,
      confidence: SOFT.test(q0) ? "soft" : "sourced",
    });
  } catch {
    return res.status(500).json({ error: "search failure", facts: "" });
  }
}

function systemPrompt(fast) {
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  return `You are a fast lookup tool. Answer the query with current, dated facts in ${
    fast ? "1-2 very short lines" : "2-5 short lines"
  } — numbers, names, dates.
Today is ${today} (IST). The person asking is in India: default to Indian context, Indian cities, INR and IST unless the query names somewhere else. If a figure is city-specific (fuel, weather, showtimes) say which city it is for.
Answer in Latin script only — English, or simple Hinglish if the question is Hinglish. Never Devanagari or any other script. Write PLAIN TEXT only — no markdown, no bold, no bullets, no headings, no links, no preamble, no disclaimers.
If you cannot find a real answer, reply with exactly: NONE. Never explain what you are, never apologise, never ask a question back.`;
}

function classOf(s) {
  for (const [re, name] of CLASSES) if (re.test(s)) return name;
  return "general";
}

const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Strip the formatting the persona bans, then decide whether what is left is
// actually an answer.
function sanitize(raw) {
  let s = String(raw || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*[*\-•]\s+/gm, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*|__|\*|`/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // markdown links → their text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!s || /^none\.?$/i.test(s)) return "";
  if (FRAME_BREAK.test(s)) return ""; // assistant voice is not a fact
  return s.slice(0, 1200);
}

// Shared across instances, so a repeated question is answered once for
// everybody. Only the ANSWER is stored: the key is a hash, so no user-derived
// query text is ever written to the table.
async function readCache(key, ttlSec) {
  try {
    const rows = await q(
      `select facts from meera_search_cache
        where k = $1 and at > now() - ($2 || ' seconds')::interval`,
      [key, String(ttlSec)],
      CACHE_READ_MS,
    );
    return rows[0]?.facts || "";
  } catch {
    return ""; // a cache that is slow or down must never delay a real lookup
  }
}

async function writeCache(key, facts, klass) {
  try {
    await q(
      `insert into meera_search_cache (k, facts, klass, at) values ($1, $2, $3, now())
       on conflict (k) do update set facts = excluded.facts, klass = excluded.klass, at = excluded.at`,
      [key, facts, klass],
    );
  } catch {
    /* the answer is already in hand; failing to memoize it is not a failure */
  }
}
