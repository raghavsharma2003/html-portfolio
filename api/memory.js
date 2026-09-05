// Meera memory backend — Supabase-backed conversation log + graph memory.
// One endpoint, POST { op, device, ... }:
//   log      — append conversation turns to the permanent log
//   recall   — graph lookup: relevant nodes + their edges → compact text
//   remember — LLM extracts entities/relations from recent turns → upsert graph
//   forget   — the inverse of all three: hard-deletes rows by scope
// The Supabase anon key lives server-side only; this proxy is the gatekeeper.
//
// FORGETTING IS A DELETE, NOT A FLAG. There is no `deleted_at`, no `hidden`
// column and nothing for recall to filter, because a memory that is still in
// the table is still a memory — the row is gone. The single exception is
// meera_forget, which stores the WORD and nothing else, for the one reason
// documented at noteForgotten(). Migration 018 makes the raw relationship
// substrate `(agent_id, device_id)` scoped: a device identifies the human and
// agent_id identifies which relationship may read or mutate the row.

import { allow, ipOf } from "./_ratelimit.js";
import { q } from "./_db.js";
// A1 (docs/research/MEMORY-FIELD-SURVEY.md §Q5): the mutation-time forget
// matcher's one model call. Deliberately the SAME helper api/chat.js reaches
// the free pool with — a forget must not grow a second, differently-behaved
// key rotation that nobody notices going stale.
import { withGeminiKey, isQuota, isTransient, poolSize } from "./_gkeys.js";
// ONE definition of "five pictures", shared with the chat payload guard so the
// composer's cap cannot mean one thing at upload and another at send.
import { MAX_IMAGES } from "./_lanes.js";
// WS-CONSOLIDATE (M3) deltas to opRemember/opRecall only — see the two
// functions below for the marked sections. embedOne/toHalfvecLiteral back
// opRecall's semantic pre-filter (SPEC §0.3: halfvec, person-filtered exact
// scan, no HNSW); openOrExtendEpisode/touchEpisode back opRemember's in-turn
// provisional tier (SPEC §0.2.1/§4.1) and are shared with api/episodes.js and
// api/consolidate.js so the boundary rule lives in exactly one place.
import { embedOne, embedBatch, toHalfvecLiteral } from "./_embed.js";
// WS-PHOTOS reuses writeVisualAssertion alongside the pair opRemember already
// imports — it is the existing, correct, vision-fab-governed writer for
// exactly this shape of thing (a claim about an image, with a confidence and
// an extractor model attached), and api/episodes.js is off this workstream's
// file list, so calling its export is the whole of "using" it.
import { openOrExtendEpisode, touchEpisode, writeVisualAssertion } from "./episodes.js";
// WS-AGENTSCOPE (Law E1, SPEC-AGENT-LAYER §2): every retrieval over an
// agent-scoped table carries the scope predicate in its WHERE, before rank, and
// every write over one names agent_id explicitly instead of leaning on 009's
// transitional column DEFAULT. One agent exists today, so this is a deliberate
// behavioural NO-OP — which is exactly what makes it safe to land, and what the
// existing gates re-passing unchanged is evidence of.
//
// The FORGET cascade below is deliberately NOT scoped: §6 rules that a whole
// wipe of a person deletes their rows across all agents, because it is their
// data and not the agent's, and G-E5 is a proven property that may not regress.
import { agentScopePredicate, agentValue, MEERA_AGENT_ID } from "./_agentscope.js";

import {
  OPENROUTER_KEY,
  SUPABASE_URL,
  SUPABASE_KEY,
  AZURE_ENDPOINT,
  AZURE_KEY,
} from "./_config.js";

// WS-R27 (migration 090): the plain SHA-256 helper the Room forget receipt's
// hash is built from - see `roomForgetReceiptHash` below for why this is a
// bare hash rather than the HMAC `api/_replica-full-erasure.js` uses for its
// own deletion receipt. A leaf module (no imports of its own beyond
// node:crypto), so importing it here creates no cycle with api/_room-surface.js,
// which imports FROM this file already.
import { sha256Hex } from "./_replica-processing/contracts.js";

// ── the validity deriver (ROADMAP-100X item 4, WS-O) ──────────────────────
//
// LAZY, and cached across invocations of a warm function. api/_engine.gen.js is
// ~300 KB and this file is on the latency-critical recall path; a static import
// would put the whole engine bundle in every cold start of every op here, to
// serve one write path that runs after the reply has already gone out.
// api/_surface.js's `loadEngine` is the same pattern for the same reason.
//
// A missing bundle is NOT loud here, and the asymmetry against api/_surface.js
// is deliberate: there, a missing bundle means she would answer as somebody
// else, so the turn is refused. Here it means one new fact is stored without a
// derived horizon, and `staleNote` falls back to the row-age rule this repo
// has been shipping all along. Degrading to today's behaviour is the correct
// failure; refusing to store a memory is not.
let _validity = null;
let _validityTried = false;
async function loadValidity() {
  if (_validityTried) return _validity;
  _validityTried = true;
  try {
    const m = await import("./_engine.gen.js");
    _validity = typeof m?.deriveFactValidity === "function" ? m : null;
  } catch {
    _validity = null;
  }
  return _validity;
}

const SB_URL = process.env.SUPABASE_URL || SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY || SUPABASE_KEY;
const OR_KEY = process.env.OPENROUTER_API_KEY || OPENROUTER_KEY;
const EXTRACT_MODEL = "google/gemini-3.1-flash-lite";

// Deciding what is worth remembering about someone — and which of two
// contradictory things is now true — is judgement work, not pattern matching,
// and it is the foundation of her remembering you at all. It is also the one
// place a reasoning model clearly belongs: a measured A/B put reasoning +55%
// ahead on ordinary conversation and 81% BEHIND on emotionally heavy beats,
// where it collapsed into restate-anecdote-question. That failure is about
// COMPANIONSHIP. Extraction is neither companionship nor latency-critical —
// nobody is waiting on it — so the win applies and the failure does not.
//
// Azure is tried first because it is funded by credits and is the better
// model; OpenRouter remains the fallback, because a bad Azure minute must cost
// a slower extraction, never a lost memory. Note the hidden cost: reasoning
// tokens are billed and never appear in `completion_tokens` (307,788 of them
// in the battery that produced this decision).
const AZ_ENDPOINT = process.env.AZURE_ENDPOINT || AZURE_ENDPOINT;
const AZ_KEY = process.env.AZURE_API_KEY || AZURE_KEY;
const AZ_EXTRACT_MODEL = "grok-4-1-fast-reasoning";

/** Ask the extraction brain. Azure (reasoning) first, OpenRouter as fallback. */
async function extractChat(messages, maxTokens) {
  if (AZ_ENDPOINT && AZ_KEY) {
    try {
      const r = await fetch(`${AZ_ENDPOINT}/chat/completions`, {
        method: "POST",
        headers: { "api-key": AZ_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ model: AZ_EXTRACT_MODEL, max_tokens: maxTokens, messages }),
        signal: AbortSignal.timeout(25_000),
      });
      if (r.ok) {
        const j = await r.json();
        const t = j?.choices?.[0]?.message?.content;
        if (t) return t;
      }
    } catch {
      /* fall through — never let the better brain being down lose a memory */
    }
  }
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OR_KEY}`,
      "Content-Type": "application/json",
      "X-Title": "Meera",
    },
    body: JSON.stringify({ model: EXTRACT_MODEL, max_tokens: maxTokens, messages }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? null;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sb(path, params, opts = {}) {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return fetch(`${SB_URL}/rest/v1/${path}${qs}`, {
    ...opts,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
}

/** The channels a logged turn may claim. Mirrors vy_episode.channel's CHECK
 *  constraint minus 'voicenote', which has no meera_log producer today —
 *  add it here the day one exists, rather than pre-approving a value nothing
 *  writes. */
export const LOG_CHANNELS = new Set(["chat", "call", "watch"]);

/** HAND-KEPT MIRROR of src/engine/compiler.ts's TAIL manifest row T5
 *  (`budget: 6_000`). See the drop loop at the end of opRecall for why this
 *  side needs the number at all, and evals/recall/run.mjs for the assertion
 *  that pins the two together. */
export const RECALL_T5_BUDGET = 6_000;

async function opLog(device, body, agentId = MEERA_AGENT_ID) {
  const turns = (Array.isArray(body.turns) ? body.turns : []).slice(0, 30);
  if (!turns.length) return { ok: true };
  const values = [];
  const params = [];
  let p = 1;
  for (const t of turns) {
    values.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},${agentValue(`$${p++}`)})`);
    params.push(
      device,
      t.role === "her" ? "her" : "me",
      // ── THE opLog CHANNEL CONTRACT ────────────────────────────────────────
      // 'watch' is a real channel everywhere else in this system —
      // vy_episode.channel's CHECK is ('chat','call','watch','voicenote') and
      // api/episodes.js opens watch episodes — but this validator collapsed
      // everything that was not 'call' to 'chat'. So a turn spoken while they
      // were watching a screen together was logged as an ordinary chat turn,
      // and every downstream consumer that reads the channel off meera_log
      // (the consolidator's episode segmentation, the forget lane's
      // `and channel = 'call'` window, openOrExtendEpisode's log-span bounds)
      // was reading a value that had been silently rewritten.
      //
      // WS-CALLLANE sends 'watch'; WS-SPINE excludes it in consolidation.
      // meera_log.channel carries no CHECK constraint (db/schema.sql:43 — a
      // plain `text not null default 'chat'`), so this is an enum addition in
      // the validator and nowhere else. Anything still unrecognised falls to
      // 'chat', exactly as before: a hostile client cannot invent a channel.
      LOG_CHANNELS.has(t.channel) ? t.channel : "chat",
      typeof t.kind === "string" ? t.kind.slice(0, 20) : "text",
      String(t.content || "").slice(0, 4000),
      Number.isFinite(t.at) ? new Date(t.at).toISOString() : new Date().toISOString(),
      agentId,
    );
  }
  // WS-TRACE: `returning id` makes the trace's link to CONTENT a reference
  // rather than a copy (docs/TRACE.md L2). meera_log is where what anybody said
  // already lives; a turn record that names the row id can reconstruct the turn
  // without ever storing a second copy of the words — and, unlike a copy, the
  // reference goes away with the row when someone asks to be forgotten.
  //
  // Postgres returns RETURNING rows in the order a multi-row VALUES list was
  // written, so `ids[i]` is `turns[i]`. That is an implementation property
  // rather than a standard guarantee, which is why `role` and `at` ride along:
  // a caller that needs certainty can match on those instead of on position.
  const inserted = await q(
    `insert into meera_log (device_id, role, channel, kind, content, at, agent_id) values ${values.join(",")}
     returning id, role, at`,
    params,
  );
  const rows = Array.isArray(inserted) ? inserted : [];
  return { ok: true, ids: rows.map((r) => Number(r.id)), rows };
}

// Query words that carry no retrieval signal. Without this filter a message
// like "what have you been doing" matches every summary containing "been" or
// "what", and those nodes are then handed to her as relevant facts — which is
// how she ends up confidently telling them something unrelated and wrong.
//
// EXPORTED (WS-DEPTH): api/consolidate.js's phrase-capture writer reuses this
// exact list as half of its common-phrase stoplist (the other half is a
// corpus-measured n-gram list — see that file) rather than duplicating it,
// since both files already live server-side under api/ with no bundler
// boundary between them (unlike relstate.ts's client-bundle constraint).
// ── P1-10, half one: what came OUT of this list ────────────────────────────
//
// `kaam` and `baat` were in here and they are the two most content-bearing
// nouns in the whole Hinglish register — work, and the thing that was said.
// "kaam kaisa chal raha hai" is the single most common way this product's
// users ask about a job, and with `kaam` stopped it tokenized to NOTHING: the
// keyword leg did not run at all and the turn was answered by standing
// background plus whatever the embedding happened to reach. They were filed as
// stopwords because they are frequent, and frequency is the wrong test — a
// stopword is a word that carries no RETRIEVAL signal, not a word that occurs a
// lot. `kaam` names the thing being retrieved.
//
// What went IN instead is pure noise: laughter, acknowledgement tokens and
// discourse particles. These carry no signal in either direction and, unlike
// the two above, nothing in the store is ever NAMED one of them. They also do
// double duty as the negative control for the bigram fallback below — a grunt
// must reach it with zero candidates, or "hmm" starts recalling memories.
export const RECALL_STOP = new Set([
  "that", "this", "then", "than", "when", "what", "have", "having", "been", "with", "your", "yours",
  "just", "like", "know", "knew", "about", "they", "them", "their", "there", "here", "from", "some",
  "were", "will", "would", "could", "should", "shall", "being", "does", "doing", "done", "going",
  "gone", "really", "very", "much", "many", "also", "only", "even", "because", "still", "again",
  "which", "where", "while", "after", "before", "into", "onto", "over", "under", "such", "same",
  "think", "thought", "thing", "things", "want", "wanted", "need", "tell", "told", "said", "says",
  "make", "made", "take", "took", "good", "nice", "okay", "yeah", "yaar", "haan", "nahi", "nhi",
  "matlab", "kuch", "bhi", "raha", "rahi", "rahe", "karta", "karti", "karte", "karna", "kiya",
  "kaise", "kaisa", "kaisi", "tumhara", "tumhari", "tumhe", "mera", "meri", "mere", "main", "mujhe",
  "abhi", "phir", "bata", "batao", "waise", "acha", "achha", "theek", "thik", "chal", "koi", "sab",
  "hai", "hain", "tha", "thi", "the", "hoga", "hogi", "kyun", "kyu", "bolo", "bola",
  // pure noise (added with P1-10; see the note above)
  "haha", "hahaha", "hehe", "lol", "lmao", "hmm", "hmmm", "arre", "arey", "bas", "aise", "aisa",
  "chalo", "accha", "achcha", "acchha", "hanji", "hnji",
]);

// ── P1-10, half two: the 3-character floor ─────────────────────────────────
//
// The tokenizer's latin floor was FOUR characters, which is a reasonable
// default for English and wrong for this product: `job`, `gym`, `maa`, `din`
// and `kal` are three characters and each of them names a whole region of
// somebody's life. "job kaisi chal rahi hai" tokenized to nothing for no
// reason except arithmetic.
//
// The floor drops to three for THIS LIST ONLY rather than globally. A global
// three-character floor readmits `kya`, `kar`, `woh`, `iss`, `tha` and the
// entire Hinglish function-word inventory into the keyword leg, where every one
// of them `~*` word-matches against half the store — which is the exact failure
// RECALL_STOP was written to stop, arriving through a different door. A
// whitelist is the version of this change that cannot do that.
//
// Devanagari already had a three-character floor and is unaffected: three
// devanagari characters is a whole word, not a fragment.
export const RECALL_SHORT = new Set([
  "job", "gym", "maa", "dad", "mom", "son", "kid", "bro", "sis", "bua",
  "din", "kal", "aaj", "car", "cat", "dog", "pet",
  "ipl", "mba", "phd", "ias", "ips", "ssc", "gre", "cet",
  "emi", "tax", "gst", "pan", "ceo", "hod", "flu", "mri", "icu",
]);

// The words that are frequent AND uninformative but are not stopwords — used
// only to ORDER the bigram fallback below, never to filter. A word in here can
// still be picked; it is simply picked last.
const RECALL_UBIQUITOUS = new Set([
  "kya", "kar", "karo", "kare", "hua", "hui", "hue", "tum", "aap", "hum", "mai",
  "kab", "kaun", "kahan", "kis", "kisi", "jab", "tab", "yeh", "woh", "uss", "iss",
  "hun", "hoon", "nai", "naa", "toh", "aur", "par", "sirf", "wala", "wali",
]);

/**
 * The recall tokenizer. EXPORTED because it was previously inline in opRecall
 * and the only way to test it was to regex the list back out of this file's
 * source (`evals/recall/tokens.mjs`'s ancestor did exactly that) — a test that
 * reads a copy of the thing under test is a test of the copy.
 *
 * Three passes, in order:
 *   1. content words — latin >= 4 chars, or >= 3 if whitelisted, or
 *      devanagari >= 3 — minus the stoplist. This is the old behaviour plus
 *      the whitelist.
 *   2. if that yields NOTHING, the BIGRAM FALLBACK: the two rarest raw words
 *      that are not stopwords. Rarity is a static ubiquity list, then length,
 *      then alphabetical — deterministic end to end, no corpus, no model.
 *   3. if fewer than two candidates survive, return nothing. This is the part
 *      that keeps the fallback honest: it is a BIGRAM fallback, so a query
 *      that cannot even produce two words is a grunt, and a grunt must recall
 *      nothing. "hmm", "acha", "theek hai yaar" and "arre bas" all land here.
 */
export function recallTokens(query) {
  const text = String(query || "").toLowerCase();
  const raw = [...new Set(text.match(/[a-z]{3,}|[ऀ-ॿ]{3,}/g) || [])];
  const primary = raw
    .filter((w) => !RECALL_STOP.has(w))
    .filter((w) => !/^[a-z]{3}$/.test(w) || RECALL_SHORT.has(w))
    .slice(0, 6);
  if (primary.length) return primary;
  const candidates = raw.filter((w) => !RECALL_STOP.has(w));
  if (candidates.length < 2) return [];
  return candidates
    .map((w) => ({ w, rare: RECALL_UBIQUITOUS.has(w) ? 0 : 1 }))
    .sort((a, b) => b.rare - a.rare || b.w.length - a.w.length || (a.w < b.w ? -1 : 1))
    .slice(0, 2)
    .map((x) => x.w);
}

// ── RECIPROCAL RANK FUSION (world-class #2) ────────────────────────────────
//
// EXPORTED and pure so `evals/recall/run.mjs` proves THIS function rather than
// a re-implementation of it (`gates-that-live-nowhere`: a predicate tested
// through a copy is a copy that was tested).
//
// k = 60 is the standard RRF constant. It is not tuned and should not be: at
// list lengths of 4–8 the ordering is insensitive to it across any plausible
// value, so a tuned k would be a number with a decimal place and no defence.
//
// The ROW IDENTITY is `${kindOf}:${name}` rather than the primary key, because
// the whole point of fusing is that agreement between legs is evidence — and
// two legs reading two different TABLES (meera_nodes and vy_fact) express the
// same memory under the same name, never under the same id. Falling back to
// `${origin}:${id}` when a row has no name keeps a nameless row a distinct
// candidate instead of silently merging every nameless row into one.
//
// Deterministic end to end: equal scores break on the identity string, so the
// same input always produces the same output, which is what makes the eval a
// gate rather than a weather report.
export const RRF_K = 60;
export const RRF_SLOTS = 8;

export function rrfFuse(legs, { k = RRF_K, slots = RRF_SLOTS } = {}) {
  const score = new Map();
  const row = new Map();
  for (const leg of Array.isArray(legs) ? legs : []) {
    (Array.isArray(leg?.rows) ? leg.rows : []).forEach((r, i) => {
      const named = String(r?.name || "").toLowerCase();
      const id = named ? `${leg.kindOf}:${named}` : `${leg.origin}:${r?.id}`;
      score.set(id, (score.get(id) || 0) + 1 / (k + i + 1));
      if (!row.has(id)) row.set(id, { ...r, __origin: leg.origin });
    });
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, slots)
    .map(([id]) => row.get(id));
}

// ── P1-6: "kab bataya tha maine?" ──────────────────────────────────────────
//
// A node line carried ONE date, `updated_at`, rendered as "last came up N".
// So the single most common memory question this product gets — when did I
// first tell you this — had no answer in the prompt, and the honest reply to
// it is a date she was never given. `created_at` was sitting in the row and
// was not even selected.
//
// Both dates render only when they are meaningfully different. "first told
// today, last came up today" is two facts where there is one, and it is the
// shape that teaches a model the phrase is decorative. FIRST_TOLD_MIN_GAP_DAYS
// is the threshold: below it the line reads exactly as it did before, which
// also keeps the byte-identity frame for every fresh relationship.
export const FIRST_TOLD_MIN_GAP_DAYS = 6;

export function provenanceAge(n) {
  const last = ageLabel(n.updated_at);
  const createdMs = new Date(n.created_at ?? n.updated_at).getTime();
  const updatedMs = new Date(n.updated_at).getTime();
  const gapDays = (updatedMs - createdMs) / 86_400_000;
  if (!Number.isFinite(gapDays) || gapDays < FIRST_TOLD_MIN_GAP_DAYS) return `last came up ${last}`;
  // mentions travels with the pair or the sentence is missing its unit: "first
  // told three weeks ago, last came up yesterday" reads very differently at 2
  // mentions and at 30, and she has no other way to tell which she is holding.
  const times = Number(n.mentions) > 1 ? `, ${Number(n.mentions)} times in all` : "";
  return `first told ${ageLabel(n.created_at)}, last came up ${last}${times}`;
}

function ageLabel(at) {
  const ms = Date.now() - new Date(at).getTime();
  if (!Number.isFinite(ms)) return "a while ago";
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 31) {
    const w = Math.max(1, Math.round(days / 7));
    return `${w} week${w > 1 ? "s" : ""} ago`;
  }
  if (days < 365) {
    const mo = Math.max(1, Math.round(days / 30));
    return `${mo} month${mo > 1 ? "s" : ""} ago`;
  }
  return "over a year ago";
}

// ── WS-INTEGRATE seam 1 delta (scoped to opRecall only — docs/SPEC.md §13
// collision contract: cross-workstream needs go through declared interfaces,
// never edits to another workstream's files. This is new code serving
// opRecall alone; opRemember/opForget/opLog etc. are untouched). Builds the
// server-side relstate bundle src/engine/compiler.ts's RelBundleInput
// consumes — field names mirror it and relstate.ts's/india.ts's row types
// exactly, since the RENDER functions stay client-side (relstate.ts's own
// header: "the render functions by WS-COMPILER's compiler.ts TAIL
// assembly"); this only supplies their raw, already-fetched inputs.
//
// Returns null when no vy_rel_state row exists yet for this person (no
// consolidation has run) — that null is the byte-identity safety frame:
// compile() never even calls a render function without a bundle, so a
// person with no relational data produces the exact same prompt as today.
async function fetchRelBundle(person, agentId = MEERA_AGENT_ID) {
  const stateRows = await q(
    `select r.* from vy_rel_state r where r.person_id = $1
      ${agentScopePredicate("r", { agentId: "$2" })}`,
    [person, agentId],
    2_500,
  ).catch(() => []);
  if (!stateRows.length) return null;
  const s = stateRows[0];
  const [honorificRow, ruptureMoveRow, patterns, rituals, currency, profile, weEpisodes, phrases, kin] = await Promise.all([
    q(
      `select e.at from vy_rel_event e where e.person_id = $1 and e.dim = 'honorific'
        ${agentScopePredicate("e", { agentId: "$2" })}
        order by e.at desc limit 1`,
      [person, agentId],
    ).catch(() => []),
    // WS-RELSTATE record-vs-stance split (context/rejected.md
    // `rupture-never-closes`): the timestamp relstate.ts's `ruptureStance`
    // lapses FROM — most recent dim in ('rupture','repair'), whichever
    // moved last. Query only, never a write; the record itself is
    // untouched.
    q(
      `select e.at from vy_rel_event e where e.person_id = $1 and e.dim in ('rupture', 'repair')
        ${agentScopePredicate("e", { agentId: "$2" })}
        order by e.at desc limit 1`,
      [person, agentId],
    ).catch(() => []),
    // renderDyadicActive (relstate.ts) does the moment-match + top-3 slice
    // client-side; server hands over every currently-eligible pattern
    // (bounded to 20) so the moment gate has real candidates to filter.
    q(
      `select p.id, p.person_id, p.moment, p.if_shape, p.then_note, p.self_in_relation, p.citations,
              p.support_count, p.distinct_days, p.prompt_eligible, p.times_contradicted, p.t_invalid, p.last_used
         from vy_pattern p
        where p.person_id = $1 and p.t_invalid is null and p.prompt_eligible = true
        ${agentScopePredicate("p", { agentId: "$2" })}
        order by p.support_count desc limit 20`,
      [person, agentId],
    ).catch(() => []),
    q(
      `select r.person_id, r.key, r.last_at, r.count, r.cold_last, r.citations from vy_ritual r
        where r.person_id = $1 ${agentScopePredicate("r", { agentId: "$2" })}`,
      [person, agentId],
    ).catch(() => []),
    q(
      `select c.person_id, c.topic, c.kind, c.last_used, c.uses, c.citations from vy_currency c
        where c.person_id = $1 ${agentScopePredicate("c", { agentId: "$2" })}`,
      [person, agentId],
    ).catch(() => []),
    q(
      `select i.home_region from vy_india_profile i where i.person_id = $1
        ${agentScopePredicate("i", { agentId: "$2" })}`,
      [person, agentId],
    ).catch(() => []),
    // participation='we' only (renderWeCallbacks' own WE_TOKEN_RE re-checks
    // this client-side too — belt-and-braces, cheap, matches shapelint's own
    // two-layer convention)
    q(
      `select e.id, e.summary, e.started_at as at from vy_episode e
        where e.person_id = $1 and e.participation = 'we' and e.superseded_by is null
        ${agentScopePredicate("e", { agentId: "$2" })}
        order by e.started_at desc limit 10`,
      [person, agentId],
    ).catch(() => []),
    q(
      `select p.phrase, p.gloss from vy_phrase p where p.person_id = $1
        ${agentScopePredicate("p", { agentId: "$2" })}
        order by p.last_used desc nulls last, p.coined_at desc limit 20`,
      [person, agentId],
    ).catch(() => []),
      // WS-SPINE ticket: the kin READER (writer lives in the consolidation
    // chain). Provisional rows render hedged in T3; a failed read costs the
    // block, never the bundle.
    q(
      `select k.id, k.name, k.relation, k.fictive, k.address_term, k.citations, k.provisional
         from vy_kin k where k.person_id = $1 ${agentScopePredicate("k", { agentId: "$2" })}
        order by k.updated_at desc limit 6`,
      [person, agentId],
    ).catch(() => []),
  ]);

  const lastRuptureMoveAt = ruptureMoveRow[0]?.at ?? null;
  // warmEpisodesSince (relstate.ts's `RuptureStanceInput.warmEpisodesSince`)
  // — episodes since the record last moved. Only worth a round trip when a
  // rupture is actually open; nothing reads this value otherwise.
  let warmEpisodesSinceRupture = 0;
  if (s.rupture_open && lastRuptureMoveAt) {
    const warmRows = await q(
      // Same three predicates as consolidate.js's writer-side count —
      // FINALIZED, DYADIC, CURRENT — or the reader and the writer disagree
      // about whether the same rupture has lapsed (the reader was counting
      // provisional + group + superseded rows, all pushing the count UP, so
      // the prompt could say "settled" while the stance writer still said
      // "open"). One rupture, one arithmetic.
      `select count(*)::int as c from vy_episode e
        where e.person_id = $1 and e.started_at > $2::timestamptz
          and e.provisional = false and e.group_id is null and e.superseded_by is null
        ${agentScopePredicate("e", { agentId: "$3" })}`,
      [person, lastRuptureMoveAt, agentId],
    ).catch(() => []);
    warmEpisodesSinceRupture = Number(warmRows[0]?.c ?? 0);
  }

  return {
    relState: {
      person_id: s.person_id,
      honorific: s.honorific,
      cs_ratio: s.cs_ratio === null || s.cs_ratio === undefined ? null : Number(s.cs_ratio),
      cs_on_stress: s.cs_on_stress,
      trust: Number(s.trust),
      rupture_open: Boolean(s.rupture_open),
      repair_state: s.repair_state,
      ritual_density: Number(s.ritual_density),
      pacing_gap_s: s.pacing_gap_s === null || s.pacing_gap_s === undefined ? null : Number(s.pacing_gap_s),
      snapshot_ver: Number(s.snapshot_ver),
      updated_at: s.updated_at,
    },
    lastHonorificMoveAt: honorificRow[0]?.at ?? null,
    lastRuptureMoveAt,
    warmEpisodesSinceRupture,
    kin: kin.map((k) => ({
      id: Number(k.id),
      name: k.name,
      relation: k.relation,
      fictive: Boolean(k.fictive),
      address_term: k.address_term || "",
      citations: k.citations || [],
      provisional: k.provisional !== false,
    })),
    patterns: patterns.map((p) => ({
      id: Number(p.id),
      person_id: p.person_id,
      moment: p.moment,
      if_shape: p.if_shape,
      then_note: p.then_note,
      self_in_relation: p.self_in_relation || "",
      citations: p.citations || [],
      support_count: Number(p.support_count),
      distinct_days: Number(p.distinct_days),
      prompt_eligible: Boolean(p.prompt_eligible),
      times_contradicted: Number(p.times_contradicted),
      t_invalid: p.t_invalid ?? null,
      last_used: p.last_used ?? null,
    })),
    rituals: rituals.map((r) => ({
      person_id: r.person_id,
      key: r.key,
      last_at: r.last_at ?? null,
      count: Number(r.count),
      cold_last: Boolean(r.cold_last),
      citations: r.citations || [],
    })),
    homeRegion: profile[0]?.home_region ?? null,
    currency: currency.map((c) => ({
      person_id: c.person_id,
      topic: c.topic,
      kind: c.kind,
      last_used: c.last_used ?? null,
      uses: Number(c.uses),
      citations: c.citations || [],
    })),
    weEpisodes: weEpisodes.map((e) => ({ id: Number(e.id), summary: e.summary || "", at: e.at })),
    phrases: phrases.map((p) => ({ phrase: p.phrase, gloss: p.gloss || "" })),
    // hasDeixis' phrase-ledger-hit signal — same rows as `phrases`, reduced
    // to bare strings so moment.ts never has to know the row shape
    phraseLedger: phrases.map((p) => p.phrase),
  };
}

/** The engine bundle, for the self layer's READ path — the observation
 *  matcher and `fetchSelfBundle` below. Same shape and same failure posture as
 *  api/_surface.js's loadEngine: tried once, cached, and a missing bundle
 *  disables the feature loudly rather than degrading recall. */
let _obsEngine;
let _obsEngineTried = false;
async function loadSelfEngineForRecall() {
  if (_obsEngineTried) return _obsEngine;
  _obsEngineTried = true;
  try {
    _obsEngine = await import("./_engine.gen.js");
  } catch (e) {
    console.error("[recall] engine bundle missing — observations disabled:", e?.message || "import failed");
    _obsEngine = null;
  }
  return _obsEngine;
}

// ── T-H1 (`selfbundle-never-set`) — the self layer's DELIVERY path ─────────
//
// Phase E2 landed T11 `rel.texture`, T12 `self.arc` and T13 `life.untold` into
// compiler.ts, each correctly gated behind `input.selfBundle`. Nothing ever
// set `selfBundle`, so all three rendered zero bytes on every lane, always.
// This function is the missing producer, and it is deliberately the SAME
// mechanism `fetchRelBundle` above already is rather than a second transport:
// op:"recall" is the one round trip both lanes already make (chat awaits it in
// brain.ts, the call lane fires it during the ring), so shipping the self rows
// on that response lights both lanes at once and neither lane is the one that
// has to be remembered.
//
// WHY THE READS LIVE HERE AND NOT IN THE CLIENT. texture.ts / selfarc.ts /
// life.ts are CLIENT-BUNDLED (their headers say so: "nothing here imports
// api/_db.js"), so every DB-facing export takes an injected `QueryFn`. The
// browser has no `q`. The server does. So the server calls the engine bundle's
// readers with `q` — the same dependency-injection the observation matcher
// below already uses — and the client receives ROWS, never a query.
//
// Scoping, and it is not incidental:
//   texture  (agent, person)  — how she talks to THIS person
//   arc      (agent)          — she is ONE person across every relationship
//   untold   (agent) ANTI-JOINED against (agent, person) told-rows
//
// `structural-disclosure` for the untold half: a beat told to person A must be
// unreachable for person B, and that is `life.ts`'s UNTOLD_SQL left join with
// `t.person_id` inside the ON clause — a WHERE clause, never a prompt rule.
// This function passes the person through and adds no filtering of its own,
// because a filter here would be a post-hoc filter over rows that were already
// retrieved, which is the failure class §2.3 opens by refusing.
//
// Returns null when the person has NOTHING in any of the three — the same
// byte-identity safety frame `fetchRelBundle` returns null for: compile()
// never calls a render function without a bundle, so a person with no self
// rows produces the exact prompt they produce today. Every leg fails soft
// independently; a dead texture read must not cost the untold ledger.
async function fetchSelfBundle(person, agentId = MEERA_AGENT_ID) {
  const engine = await loadSelfEngineForRecall();
  if (!engine || !person) return null;
  const [texture, arc, untold] = await Promise.all([
    engine.readTexture(q, person, agentId).catch(() => null),
    engine.loadCurrentArcs(q, agentId).catch(() => []),
    engine.untoldFor(q, person, agentId).catch(() => []),
  ]);
  const arcRows = Array.isArray(arc) ? arc : [];
  const untoldRows = Array.isArray(untold) ? untold : [];
  if (!texture && !arcRows.length && !untoldRows.length) return null;
  // Field names mirror compiler.ts's SelfBundleInput exactly, same discipline
  // as fetchRelBundle. `sheInitiated` is NOT set here and must not be: it is a
  // property of the TURN, not of the database, and the client owns it (see
  // brain.ts, which threads inner.ts's own flag rather than recomputing one).
  return { texture: texture ?? null, arc: arcRows, untold: untoldRows };
}

async function opRecall(device, body) {
  // The agent whose relationship is being read. One agent exists today, so this
  // is Meera's id and every retrieval below is unchanged in behaviour; when a
  // second agent ships it arrives from the surface's own routing, and the only
  // thing that has to change is this line.
  const agentId = MEERA_AGENT_ID;
  // ── WS-TRACE (docs/TRACE.md §3.2): the retrieval leg ────────────────────
  // Every read this turn made, as ROW IDS and timings — never as a copy of what
  // came back. It rides the response this function was already sending, so it
  // costs zero extra round trips and zero extra latency: the alternative, a
  // write from inside a lookup a reply is waiting on, is exactly what
  // docs/TRACE.md L1 forbids.
  //
  // Why this leg is the one worth having: `realtime-recall-never` was a lane
  // reading an empty recall string on EVERY call for months, invisible because
  // nothing ever recorded how many bytes of memory a turn actually received.
  // `memories_bytes` below is that number.
  const traceT0 = Date.now();
  const query = String(body.query || "").toLowerCase();
  // P1-10: the tokenizer is a named, exported, tested function now — see
  // recallTokens(). 6 of 19 real Hinglish queries used to reach this line with
  // zero tokens, which meant the keyword leg silently did not run.
  const words = recallTokens(query);

  // P1-6: `created_at` and `mentions` join the projection. Neither was
  // selected, so the two things a person actually asks about a memory —
  // "kab bataya tha maine" (when did I first tell you) and "how often has
  // this come up" — were unanswerable from a row this function had already
  // fetched. `last_recalled` is selected for the same reason it is written:
  // so the spaced-resurfacing modifier below is inspectable from the row
  // rather than only from the ORDER BY.
  // `valid_from, valid_to` (migration 056, WS-O) ride along so `staleNote`
  // below can ask the fact's OWN horizon instead of counting days since the
  // row was written. They are null for every row written before 056 and for
  // every fact whose text carries no resolvable date, which is most of them —
  // and null means `staleNote` keeps the 45-day rule it already had, so the
  // recalled bytes for an existing store do not move.
  const COLS =
    "id, name, kind, summary, feel, updated_at, created_at, mentions, last_recalled, valid_from, valid_to";
  // STANDING BACKGROUND is what she carries without being asked, so it must be
  // the big durable things — not last week's loudest topic. Identity kinds
  // (who they are, where they are, what they like) hold their weight; episodic
  // kinds fade with age, the way a person's does. A felt memory arrives with
  // extra salience at write time, so it outlives an equally-old flat one.
  // 'phrase' sits with the identity kinds on purpose: a word the two of them
  // coined is the least perishable thing in the whole store — a callback that
  // survived three weeks is worth ten inside the same chat, and it is exactly
  // what the 90-message context window cannot hold on its own.
  // ── SPACED RESURFACING (world-class #3) — A RANK MODIFIER, AND ONLY THAT ──
  //
  // The expanding-interval idea from the spacing literature, reduced to the
  // one form that does not break L3. Two effects, both multiplicative on an
  // ORDER BY and nothing else:
  //
  //   suppression — a row that was in yesterday's prompt is worth less today.
  //                 Not because it stopped being true, but because six slots
  //                 spent on the same six rows every day is a person who says
  //                 the same six things every day.
  //   resurfacing — a row untouched for three weeks gets a small lift, so the
  //                 store's long tail is reachable at all.
  //
  // WHAT IT IS NOT, and this is the part that matters: it is NEVER a trigger.
  // Nothing anywhere reads "this row is due" and decides to SAY it. Due-ness
  // moves a row up an ORDER BY; whether any of this reaches a reply is still
  // decided entirely by whether the person pulled on it (L3, `moment.ts:23-27`,
  // 0/60 unprompted-raises). The whole mechanism lives inside this one SQL
  // string, which is what makes that assertion checkable rather than promised
  // — evals/recall/run.mjs greps for exactly that.
  const SPACED = `case
      when last_recalled is null then 1.0
      when now() - last_recalled < interval '20 hours' then 0.6
      when now() - last_recalled > interval '21 days' then 1.25
      else 1.0 end`;
  // Identity kinds hold their weight; episodic kinds fade with age, the way a
  // person's do. 'phrase' sits with the identity kinds on purpose (see above).
  const RECENCY = `case when kind in ('person','place','preference','fact','phrase') then 1.0
                 else greatest(0.25, 1.0 - extract(epoch from (now() - updated_at)) / (86400.0 * 60)) end`;
  // P1-6: mention_count enters the rank. BOUNDED, and the bound is the point:
  // salience already absorbs +0.6 per mention at write time, so an unbounded
  // mentions term would count the same evidence twice and hand the standing
  // background to whatever topic was loudest last week — which is the exact
  // thing STANDING BACKGROUND is not for. `ln` plus a 0.35 coefficient makes
  // it a tie-breaker between comparably-salient rows, which is what a mention
  // count honestly is.
  const RANK = `salience * ${RECENCY} * (1.0 + 0.35 * ln(1.0 + mentions)) * ${SPACED}`;
  // ── the standing-background leg: 5 ranked + 1 RESERVED (P1-6) ────────────
  //
  // It was `limit 4`, ranked, full stop — so the four most salient recent
  // things were the whole of what she carried, and a big old fact (the job he
  // told her about in March, the brother he mentioned twice a year ago) could
  // never be reached by ANY ranking, because rank is the thing age is
  // subtracted from. The reserved slot is the fix and it is deliberately a
  // RESERVATION rather than a weight: a weight big enough to lift an old row
  // past four fresh ones would also lift it past everything else, and then it
  // is not background any more. One slot, always, for the oldest row that was
  // salient enough to matter — and if there is no such row the slot simply
  // does not exist, so a new relationship's prompt is byte-identical.
  const fetches = [
    q(
      `with scored as (
         select ${COLS}, salience, ${RANK} as r from meera_nodes n where device_id = $1
           ${agentScopePredicate("n", { agentId: "$2" })}
       ),
       ranked as (select *, 0 as slot from scored order by r desc, updated_at desc limit 5),
       reserved as (
         select s.*, 1 as slot from scored s
          where s.salience >= 2.0
            and not exists (select 1 from ranked k where k.id = s.id)
          order by s.created_at asc limit 1
       )
       select * from ranked union all select * from reserved`,
      [device, agentId],
    ),
  ];
  if (words.length) {
    const clauses = [];
    const params = [device, agentId];
    let p = 3;
    for (const w of words) {
      // word-boundary match, not substring: `ilike '%rate%'` hits "corporate"
      // and hands her a memory the message never referred to
      clauses.push(`name ~* $${p} or summary ~* $${p}`);
      params.push(`\\m${w}\\M`);
      p++;
    }
    fetches.push(
      q(
        `select ${COLS} from meera_nodes n where device_id = $1
           ${agentScopePredicate("n", { agentId: "$2" })}
           and (${clauses.join(" or ")})
         order by ${RANK} desc, updated_at desc limit 8`,
        params,
      ).catch(() => []),
    );
  }
  // ── WS-CONSOLIDATE (M3) delta: semantic pre-filter over vy_fact, run
  // CONCURRENTLY with the keyword fetches above so it adds no serial latency
  // — SPEC §0.3: person-filtered EXACT SCAN over halfvec, no HNSW (a
  // multi-tenant ANN index silently starves the 10^0-10^3-row per-dyad
  // corpora this product actually has). This is what closes
  // `semantic-recall`: a query and a stored fact can share zero surface
  // words and still be the same thing — "kaam stress" vs "office pressure"
  // is the repo's own documented case (context/decisions.md
  // `spec-c-minimal`). Embedding is an enhancement, never a hard dependency:
  // any failure here degrades silently to the keyword-only behaviour this
  // function already had.
  // hoisted so semanticFetch and the WS-INTEGRATE relBundleFetch below share
  // one personIdFor lookup instead of two
  const personPromise = personIdFor(device);
  // WS-TRACE: the embedding call is the measured bottleneck of semantic recall
  // (`recall-v2`: DB p50 40ms, the embed call is the rest), so the leg records
  // it separately from the query it feeds. Mutated, not returned, so the
  // concurrency below is untouched.
  const traceSem = { ok: false, embed_ms: null, skipped: null };
  const semanticFetch = (async () => {
    const trimmed = String(body.query || "").trim();
    if (trimmed.length < 3) {
      traceSem.skipped = "short_query";
      return [];
    }
    const tEmbed = Date.now();
    const vec = await embedOne(trimmed).catch(() => null);
    traceSem.embed_ms = Date.now() - tEmbed;
    if (!vec) {
      traceSem.skipped = "no_vector";
      return [];
    }
    traceSem.ok = true;
    const person = await personPromise;
    const lit = toHalfvecLiteral(vec);
    // Both sides of this join are agent-scoped tables, so both carry the
    // clause. Scoping only the embedding would leave the fact side reachable
    // through a future join rewrite; scoping only the fact side would let
    // another agent's vector decide the ORDER of Meera's rows. The predicate
    // sits in the WHERE, above `order by e.v <=> ...` — a disqualified row that
    // reaches the ranker still consumes one of the six slots.
    return q(
      `select f.id, f.kind, f.name, f.body, f.feel, f.created_at
         from vy_embedding e
         join vy_fact f on f.id = e.owner_id and f.person_id = e.person_id
        where e.person_id = $1 and e.owner_kind = 'fact'
          and f.t_invalid is null and f.retracted_at is null
          ${agentScopePredicate("e", { agentId: "$3" })}
          ${agentScopePredicate("f", { agentId: "$3" })}
        order by e.v <=> $2::halfvec
        limit 6`,
      [person, lit, agentId],
      2_500,
    ).catch(() => []);
  })();
  // ── THE ACTIVITY LEG (2026-08-23) ──────────────────────────────────────
  //
  // WHAT WAS BROKEN. `opActivity` writes a finished game to `vy_episode` +
  // `vy_fact`. Every keyword read in this function is over `meera_nodes`,
  // which activities are never written to. `fetchRelBundle`'s `weEpisodes`
  // reads `vy_episode` but returns null unless a `vy_rel_state` row exists,
  // and that row is written by the nightly consolidator. So for a person with
  // no consolidation yet — every person on their first day — the ONLY route
  // from a finished game back into a prompt was the semantic leg above, which
  // requires an `embedOne` call to have succeeded at write time AND the query
  // to embed close enough at read time. `api/_embed.js` says in its own doc
  // that "an embedding is an enhancement, never the only path to a memory".
  // For this one class of memory it was the only path, and the failure mode is
  // the worst one this product has: the first external tester played two games
  // of chess, asked about them, and she said they had not happened.
  //
  // This is the missing keyword leg, and it is deliberately scoped to activity
  // rows rather than opened over `vy_fact` generally: conversational facts
  // already reach a prompt through `meera_nodes` (opRemember writes both), so
  // a general read would change what every existing turn recalls in order to
  // fix a class that has no route at all. `name like 'activity:%'` is the same
  // key `activityFactName` composes, which is what keeps the reader and the
  // writer naming one thing.
  //
  // Runs CONCURRENTLY with everything else — one more batched round trip, not
  // a serial one — and degrades to [] on any failure, exactly like the
  // semantic leg it sits beside.
  const activityFetch = (async () => {
    const person = await personPromise;
    if (!person) return [];
    // With query words: word-boundary match, same `~*` predicate and the same
    // `\m…\M` anchoring the `meera_nodes` leg uses (an `ilike '%…%'` would
    // match "chess" inside "chessboard-shaped" and hand her a memory the
    // message never referred to). WITHOUT them: the most recent few, because
    // "kya khela tha humne" tokenises to nothing this leg can match on and is
    // precisely the question that must be answerable.
    const clauses = words.map((_, i) => `f.body ~* $${i + 3}`);
    return q(
      `select f.id, f.kind, f.name, f.body, f.feel, f.created_at
         from vy_fact f
        where f.person_id = $1 and f.name like 'activity:%'
          and f.t_invalid is null and f.retracted_at is null
          ${agentScopePredicate("f", { agentId: "$2" })}
          ${clauses.length ? `and (${clauses.join(" or ")})` : ""}
        order by f.created_at desc
        limit 4`,
      [person, agentId, ...words.map((w) => `\\m${w}\\M`)],
      2_500,
    ).catch(() => []);
  })();

  // ── THE WATCHED-TOGETHER LEG (P1-1) ────────────────────────────────────
  //
  // `vy_shared_moment` and `vy_visual_assertion` are the two DEAD STORES this
  // wave was called to open. Both have live writers and had no reader anywhere
  // in the product:
  //
  //   vy_shared_moment    — the ONLY record anywhere that a screen share
  //                         happened at all. `reaction` is the line she
  //                         actually said while they were both looking at it.
  //                         Written by api/episodes.js `watch_moment`, from
  //                         useCallEngine's noteHerLine(), on both the web and
  //                         the native Android watch lanes.
  //   vy_visual_assertion — what was ON the screen or in the photo, as a
  //                         claim with an extractor model and a confidence
  //                         attached. Written by the same op and by
  //                         recordPhotoMemory below.
  //
  // Nothing read either one. So "us din jo video dekhi thi" and "wo plant wali
  // photo" — the two things a person is most likely to reach for after a watch
  // session, because they are the most VIVID things that happened — were
  // answerable only by whatever the semantic leg happened to reach, and the
  // moment rows carry no embedding at all, so for shared moments the answer was
  // structurally nothing. Same shape as the activity leg above and discovered
  // the same way: a store with a writer, a reader nobody wrote, and a failure
  // mode of confidently denying something that happened.
  //
  // WHY IT IS ITS OWN LEG rather than folded into the semantic one. A visual
  // claim is the LEAST trustworthy row in this database — `PHOTO_VISION_
  // CONFIDENCE` is 0.35 for a reason (see the block at recordPhotoMemory) —
  // and its confidence has to travel with it all the way to the render, or she
  // states a model's guess about a photograph as a thing she saw. A separate
  // leg is what makes that possible; merging it into ALSO RELEVANT would strip
  // the provenance the row exists to carry.
  //
  // TWO STATEMENTS, ONE LEG, run concurrently with everything else:
  //   (a) moments, joined to their assertion and their episode
  //   (b) assertions with NO moment — every photo, since recordPhotoMemory has
  //       no reaction to anchor one on
  // With query words both sides match on their own text; without them both
  // fall back to the most recent few inside a 45-day window, because a
  // watch session from four months ago is not context, it is an ambush.
  const WATCH_LOOKBACK_DAYS = 45;
  const watchFetch = (async () => {
    const person = await personPromise;
    if (!person) return { moments: [], photos: [] };
    const like = words.map((w) => `\\m${w}\\M`);
    const momentWhere = like.length
      ? `and (${like.map((_, i) => `m.reaction ~* $${i + 3} or a.claim ~* $${i + 3}`).join(" or ")})`
      : `and m.at > now() - interval '${WATCH_LOOKBACK_DAYS} days'`;
    const photoWhere = like.length
      ? `and (${like.map((_, i) => `a.claim ~* $${i + 3}`).join(" or ")})`
      : `and a.created_at > now() - interval '${WATCH_LOOKBACK_DAYS} days'`;
    const params = [person, agentId, ...like];
    const [moments, photos] = await Promise.all([
      q(
        `select m.id, m.reaction, m.at, m.assertion_id,
                a.claim, a.confidence, a.declared_illegible, e.channel
           from vy_shared_moment m
           left join vy_visual_assertion a
             on a.id = m.assertion_id and a.person_id = m.person_id
           join vy_episode e on e.id = m.episode_id
          where m.person_id = $1
            ${agentScopePredicate("m", { agentId: "$2" })}
            ${momentWhere}
          order by m.at desc
          limit 4`,
        params,
        2_500,
      ).catch(() => []),
      q(
        `select a.id, a.claim, a.confidence, a.declared_illegible, a.created_at, e.channel
           from vy_visual_assertion a
           join vy_episode e on e.id = a.episode_id
          where a.person_id = $1 and a.declared_illegible = false
            and not exists (select 1 from vy_shared_moment m where m.assertion_id = a.id)
            ${agentScopePredicate("a", { agentId: "$2" })}
            ${photoWhere}
          order by a.created_at desc
          limit 4`,
        params,
        2_500,
      ).catch(() => []),
    ]);
    return {
      moments: Array.isArray(moments) ? moments : [],
      photos: Array.isArray(photos) ? photos : [],
    };
  })();

  // WS-INTEGRATE seam 1: run concurrently with everything else in this
  // function — one extra batched round trip, never a serial one (SPEC §3.3
  // retrieval-budget discipline). Any failure degrades to `relstate: null`,
  // same as the "no consolidation yet" case — never blocks recall.
  const relBundleFetch = personPromise.then((person) => fetchRelBundle(person, agentId)).catch(() => null);
  // T-H1: the self bundle rides the same concurrency, for the same reason —
  // one extra batched round trip, never a serial one. It shares
  // `personPromise` with the two fetches above rather than resolving the
  // person a third time, and it degrades to `self: null` on any failure.
  const selfBundleFetch = personPromise.then((person) => fetchSelfBundle(person, agentId)).catch(() => null);

  // ── THE SURFACE-SWITCH LEG (WS-O) ──────────────────────────────────────
  //
  // WHAT IS BROKEN. `api/_surface.js`'s own header states the law: "A surface
  // is a TRANSPORT... The same human on Telegram and on the web is the same
  // relationship, so identity resolution here is AGENT-INDEPENDENT and memory
  // is never keyed by surface. Anything that keys memory by surface
  // reintroduces the amnesia the relational layer exists to delete."
  //
  // Identity really is shared — `vy_surface_identity` maps (surface,
  // surface_user_id) to ONE person_id. But `_room.js`'s `bindSurfaceDmDevice`
  // mints a device PER SURFACE, and the two biggest legs above
  // (`meera_nodes`: standing background and the keyword match) plus
  // `meera_edges` are device-keyed. The vy_ store is person-keyed and follows
  // the person; the graph store does not.
  //
  // MEASURED, on the same 44 scorable questions over the same fixture rows,
  // with the device_id as the ONLY variable (`evals/run.mjs recallbench` §3c):
  // mean recall 0.841 on the device the rows were formed on, 0.091 from
  // another device the same person owns. **89.2% of what she had, gone on a
  // surface switch**, silently, with a 200 on every call.
  //
  // ── WHY THIS IS AN ADDITIVE LEG AND NOT A WIDER `where` ────────────────
  // The obvious fix is to widen the existing predicates to the person's device
  // set. It was refused, for two reasons that are about failure modes rather
  // than taste:
  //
  //   1. Those two statements are the ones every recalled prompt is built
  //      from, and each is wrapped in `.catch(() => [])`. A SQL error in a
  //      widened predicate — a uuid/text mismatch in the subquery, say — would
  //      not raise: it would return an empty array, and she would silently
  //      have no memory at all. That is `silent-truncation` in the retrieval
  //      path, and `offline-mocks-cannot-type-check-sql` is explicit that a
  //      mocked DB proves control flow and not SQL types. There is no live
  //      database in this session to smoke-test against.
  //   2. As a separate leg, the failure mode is the opposite one: this query
  //      dies, the cross-surface rows are absent, and the recall is exactly
  //      what it is today. The feature degrades; the product does not.
  //
  // ── CONSENT: THE HALF THAT DECIDES THE SHAPE ───────────────────────────
  // `opRecall` has NO read-side forget suppression — forget is a hard DELETE,
  // and the legacy lane's delete is device-scoped. So reading another device's
  // rows without any further work would let her say, on the very device where
  // she was asked to forget something, a thing already forgotten there.
  //
  // Hence the term query below, and hence the ATOMIC RULE: the cross-surface
  // rows are used ONLY if the forget-term read also succeeded. If the terms
  // cannot be read, the rows are dropped. A memory that arrives without its
  // suppression list is not a partially-good feature, it is a consent defect,
  // so the two travel as one result or not at all.
  //
  // Terms are read across ALL of the person's devices, this one included —
  // broader than what any single-device path does today, and broad in the only
  // safe direction.
  //
  // ── WHAT CANNOT LEAK THROUGH THIS, BY CONSTRUCTION ─────────────────────
  // Group rooms. A room turn is written under `vy_group.room_device_id`, a
  // synthetic uuid that (PERSON_TABLES' own note) "appears in NOBODY's
  // vy_person_device mapping". So the subquery cannot reach a room device, and
  // the §2.3 disclosure predicate is not being re-implemented here or relied
  // on — the join simply does not contain those rows. Agent scope is carried
  // explicitly on both statements, exactly as every other leg carries it.
  //
  // ABSENT BY DEFAULT: a person with one device has no other devices, both
  // queries return nothing, and every byte of the recalled prompt is what it
  // was before this leg existed.
  const crossSurfaceFetch = (async () => {
    const person = await personPromise;
    if (!person) return null;
    const clauses = words.map((_, i) => `(n.name ~* $${i + 4} or n.summary ~* $${i + 4})`);
    const [rows, terms] = await Promise.all([
      q(
        `select ${COLS}, salience, ${RANK} as r
           from meera_nodes n
          where n.device_id <> $1
            and n.device_id in (select d.device_id from vy_person_device d where d.person_id = $2)
            ${agentScopePredicate("n", { agentId: "$3" })}
            ${clauses.length ? `and (${clauses.join(" or ")})` : ""}
          order by r desc, updated_at desc
          limit 6`,
        [device, person, agentId, ...words.map((w) => `\\m${w}\\M`)],
        2_500,
      ),
      q(
        `select f.term from meera_forget f
          where f.device_id in (select d.device_id from vy_person_device d where d.person_id = $1)
            ${agentScopePredicate("f", { agentId: "$2" })}
          limit 200`,
        [person, agentId],
        2_500,
      ),
    ]).catch(() => [null, null]);
    // THE ATOMIC RULE. Either both halves are here, or this leg contributed
    // nothing. `null` is the failure signal; `[]` is a real empty answer.
    if (!Array.isArray(rows) || !Array.isArray(terms)) return null;
    const rxs = terms.map((r) => termRe(String(r.term)));
    const kept = rxs.length
      ? rows.filter((n) => !rxs.some((rx) => rx.test(n.name || "") || rx.test(n.summary || "")))
      : rows;
    return kept;
  })().catch(() => null);

  const [[bgRaw, matchedRaw = []], semanticRaw, activityRaw, watchRaw, relBundle, selfBundle, crossRaw] =
    await Promise.all([
      Promise.all(fetches),
      semanticFetch,
      activityFetch,
      watchFetch,
      relBundleFetch,
      selfBundleFetch,
      crossSurfaceFetch,
    ]);
  // slot 0 = the five ranked rows, slot 1 = the reserved oldest-high-salience
  // row. `union all` does not promise an order, so the reservation is put back
  // where it belongs here rather than trusted to arrive there.
  const backgroundHome = (Array.isArray(bgRaw) ? bgRaw : [])
    .slice()
    .sort((a, b) => Number(a.slot ?? 0) - Number(b.slot ?? 0) || Number(b.r ?? 0) - Number(a.r ?? 0));
  const matchedHome = Array.isArray(matchedRaw) ? matchedRaw : [];

  // ── THE SURFACE-SWITCH MERGE (WS-O) ────────────────────────────────────
  //
  // The other devices' rows join the SAME two sets the home device's rows are
  // in, and nothing downstream learns which surface a row came from. That is
  // the point rather than an omission: the surface a memory was formed on is
  // not something she should ever know or mention, and a row tagged with its
  // origin is a row a model will eventually narrate ("you told me this on
  // WhatsApp"), which is both wrong and creepy.
  //
  // WHICH SET a cross row joins is decided by the same rule the home legs use:
  // there were query words, so it word-matched, so it is an ANSWER; there were
  // none, so it is CONTINUITY. One rule, not a second opinion.
  //
  // DEDUP IS BY NAME, not by id. The same person's "amma" on two devices is
  // two rows with two ids and one meaning, and an id-dedup would render her
  // mother twice. The HOME row always wins — it is the one whose salience and
  // mentions this device's conversations actually moved.
  //
  // The cross rows are appended AFTER the home rows in both sets, so the
  // existing order is untouched and the T5 budget drop sheds the imported rows
  // first. A person with one device gets an empty array here and the two
  // consts below are the two that already existed, byte for byte.
  const crossRows = Array.isArray(crossRaw) ? crossRaw : [];
  const haveName = new Set(
    [...matchedHome, ...backgroundHome].map((n) => String(n.name || "").toLowerCase()),
  );
  const crossNew = crossRows.filter((n) => {
    const k = String(n.name || "").toLowerCase();
    if (!k || haveName.has(k)) return false;
    haveName.add(k);
    return true;
  });
  const background = words.length ? backgroundHome : [...backgroundHome, ...crossNew];
  const matched = words.length ? [...matchedHome, ...crossNew] : matchedHome;
  const semanticAll = Array.isArray(semanticRaw) ? semanticRaw : [];
  const activities = (Array.isArray(activityRaw) ? activityRaw : []).slice(0, 4);
  const watched = watchRaw && typeof watchRaw === "object" ? watchRaw : { moments: [], photos: [] };

  // ── ONE CO-CITATION HOP over vy_fact.citations (world-class #2) ──────────
  //
  // docs/research/MEMORY-FIELD-SURVEY.md §Q3: "We have a bipartite
  // fact↔episode graph with a GIN index and we never walk it. HippoRAG 2's
  // transferable insight is not PPR; it is that connecting two things through a
  // shared intermediate finds what similarity cannot. One co-citation hop is
  // the whole of that idea at our scale."
  //
  // The intermediate is an EPISODE. Two facts derived from the same stretch of
  // conversation are about the same afternoon whether or not they share a word
  // or an embedding neighbourhood — the fact that he changed jobs and the fact
  // that Rohit referred him were extracted from one exchange, and asking about
  // one is asking about the other. Neither the keyword leg nor the vector leg
  // can see that, because it is not a property of the text.
  //
  // ONE HOP, and the seeds are the rows the other legs already earned. Two
  // hops is a community summary with extra steps and it dilutes fast; the
  // survey rejects the machinery above it (PPR, the LLM recognition filter)
  // for latency and for L3.
  //
  // SERIAL, because it has to be: the hop needs the citations of rows we do
  // not have until the concurrent block resolves. It is one indexed statement
  // over a GIN index against a 10^0–10^3-row per-dyad corpus (`recall-v2`: p50
  // 40 ms for the harder exact-scan case), bounded at 1.5s, degrading to [].
  // The agent predicate is on the hop's own side of the join as well as the
  // seeds' — a scope clause on one side only would let another agent's rows
  // decide which of Meera's survive.
  const seedFacts = [...semanticAll, ...activities];
  const seedCites = [...new Set(seedFacts.flatMap((f) => (Array.isArray(f?.citations) ? f.citations : [])).map(Number).filter(Number.isFinite))];
  const seedFactIds = seedFacts.map((f) => Number(f.id)).filter(Number.isFinite);
  const cocited = seedCites.length
    ? await q(
        `select f.id, f.kind, f.name, f.body, f.feel, f.created_at,
                cardinality(array(select unnest(f.citations) intersect select unnest($2::bigint[]))) as shared
           from vy_fact f
          where f.person_id = $1
            and f.citations && $2::bigint[]
            and not (f.id = any($3::bigint[]))
            and f.t_invalid is null and f.retracted_at is null
            and f.name not like 'activity:%'
            ${agentScopePredicate("f", { agentId: "$4" })}
          order by shared desc, f.created_at desc
          limit 4`,
        [await personPromise.catch(() => null), seedCites, seedFactIds, agentId],
        1_500,
      ).catch(() => [])
    : [];
  const coCited = Array.isArray(cocited) ? cocited : [];

  // ── RRF FUSION (world-class #2) ─────────────────────────────────────────
  //
  // Same survey section: "Today the T5 budget is spent by arrival order per
  // path, so a weak keyword hit can displace a strong semantic one. Graphiti's
  // answer (RRF over concurrent methods, then truncate) is deterministic,
  // LLM-free, and preserves the labels: fuse to decide WHICH ROWS SURVIVE,
  // keep the blocks to decide HOW THEY ARE FRAMED."
  //
  // That is exactly the split implemented here. Fusion decides survival;
  // rendering is untouched and every surviving row is still framed by the
  // block that earned it, because a semantic hit and an exact word hit are
  // differently-earned signals and a diag trace has to stay able to say which
  // store answered.
  //
  // Reciprocal rank fusion, k = 60 (the standard constant; the ranking is
  // insensitive to it at our list lengths and a tuned k would be a number
  // nobody could defend). A row appearing in two legs earns both terms, which
  // is the entire mechanism: agreement between differently-earned signals is
  // the only evidence available here that a row is actually relevant.
  //
  // WHAT IS NOT FUSED, deliberately:
  //   background  — it is continuity, not an answer to this turn. Ranking it
  //                 against query-relevant rows would let a quiet day evict
  //                 the standing facts, which is what background is FOR.
  //   activities  — the record of what the two of them did is verifiable by
  //                 the person reading the reply (he was at the board), and
  //                 its block is positioned first precisely so it is never the
  //                 casualty of a truncation. Fusing it puts it back in the
  //                 line of fire.
  //   watched     — same reason, plus its rows carry a confidence that must
  //                 not be silently ranked against rows that carry none.
  //
  // G-E2 byte-identity holds: with empty fixtures every list is empty, the
  // fusion produces nothing, and the blocks below render exactly as today.
  const fused = rrfFuse([
    { origin: "matched", kindOf: "node", rows: matched },
    { origin: "semantic", kindOf: "fact", rows: semanticAll },
    { origin: "cocite", kindOf: "fact", rows: coCited },
  ]);
  const survived = new Set(fused.map((r) => `${r.__origin}:${r.id}`));
  const keepFused = (rows, origin) => rows.filter((r) => survived.has(`${origin}:${r.id}`));
  const matchedFused = keepFused(matched, "matched");
  const semantic = keepFused(semanticAll, "semantic").slice(0, 4);
  const coCitedFused = keepFused(coCited, "cocite").slice(0, 3);

  const seen = new Map();
  for (const n of [...matchedFused, ...background]) seen.set(n.id, n);

  // ── WS-TRACE: the retrieval leg, built once and returned on both paths ───
  // IDS AND COUNTS ONLY. "why did she say that" becomes
  // `select * from meera_nodes where id = any(...)` run by an operator on
  // demand — rather than a copy of every recalled summary sitting in a trace
  // table for ninety days. docs/TRACE.md §4 states the boundary; this is the
  // single most content-adjacent leg in the system and it holds no content.
  const traceIds = (rows, n = 12) =>
    (Array.isArray(rows) ? rows : []).slice(0, n).map((r) => Number(r.id)).filter(Number.isFinite);
  const buildTrace = (memories, obsIds, blockLabels) => {
    if (!body.turn_id) return undefined;
    const person = personResolved;
    return {
      turn_id: String(body.turn_id).slice(0, 64),
      person_id: person || null,
      agent_id: agentId,
      q_chars: query.length,
      q_words_n: words.length,
      ms_total: Date.now() - traceT0,
      keyword: {
        matched_ids: traceIds(matchedFused),
        background_ids: traceIds(background),
        // fusion is only diagnosable if what it DROPPED is countable — a
        // reordering nobody can see is a reordering nobody can debug
        matched_pre_fusion_n: matched.length,
      },
      semantic: { ...traceSem, fact_ids: traceIds(semantic), pre_fusion_n: semanticAll.length },
      // the co-citation hop, as ids and as its seed count. `dead-writers` in
      // the reader direction: a hop that finds nothing for a month is
      // invisible unless something records how many seeds it had to walk from.
      cocite: { fact_ids: traceIds(coCitedFused), seeds_n: seedCites.length, n: coCitedFused.length },
      // the two stores this wave opened, counted separately so "the watch
      // reader read zero rows for a month" is a question the trace can answer
      watched: { moments_n: watched.moments.length, photos_n: watched.photos.length },
      // the activity leg, as ids — `realtime-recall-never` is the reason every
      // retrieval leg is countable: a leg reading zero rows for months is
      // invisible unless something records how many it read.
      activity: { fact_ids: traceIds(activities), n: activities.length },
      observations: { ids: obsIds || [], n: (obsIds || []).length },
      relbundle: relBundleShape(relBundle),
      selfbundle: selfBundleShape(selfBundle),
      memories_bytes: memories.length,
      blocks: blockLabels,
    };
  };
  // resolved once here: personPromise has already settled by now (every fetch
  // above awaited it), so this adds no wait — and a leg that could not name the
  // person is the `relstate-zero-rows` shape, which the flag exists to catch.
  const personResolved = await personPromise.catch(() => null);

  // relstate is independent of graph recall — a person with no matched/
  // background/semantic memories yet may still have a real relstate bundle
  // (or vice versa), so it rides both return paths, never conditioned on
  // `seen.size`. The self bundle is independent of BOTH for the same reason
  // and rides both paths too: her arc and her untold life exist whether or not
  // this particular query matched a node, and the empty-memories path is
  // exactly the early-relationship case where texture is most of what she has.
  // The activity leg rides this condition too. It has to: a person whose only
  // memory is a game they just played has an empty `seen` and no semantic hit
  // (no embedding may have been written), and the early return above would
  // send back "" — which is the exact state the 2026-08-23 report describes.
  // P1-1 and world-class #2 ride this condition for exactly the reason the
  // activity leg does: a person whose only memory is a screen they shared
  // yesterday, or a fact reachable only through a co-citation, has an empty
  // `seen` and no semantic hit — and this early return would send back "",
  // which is the state that made both stores dead in the first place.
  if (
    !seen.size &&
    !semantic.length &&
    !activities.length &&
    !coCitedFused.length &&
    !watched.moments.length &&
    !watched.photos.length
  )
    return { memories: "", relstate: relBundle, self: selfBundle, trace: buildTrace("", [], []) };

  const idArr = [...seen.keys()];
  const edges = await q(
    `select * from meera_edges e where device_id = $1
      ${agentScopePredicate("e", { agentId: "$3" })}
      and (src = any($2) or dst = any($2)) limit 30`,
    [device, idArr, agentId],
  ).catch(() => []);

  // resolve neighbor names outside the recalled set
  const missing = new Set();
  for (const e of Array.isArray(edges) ? edges : []) {
    if (!seen.has(e.src)) missing.add(e.src);
    if (!seen.has(e.dst)) missing.add(e.dst);
  }
  const names = new Map([...seen].map(([id, n]) => [id, n.name]));
  if (missing.size) {
    const extra = await q(
      `select id, name from meera_nodes n where device_id = $1
        ${agentScopePredicate("n", { agentId: "$3" })}
        and id = any($2)`,
      [device, [...missing], agentId],
    ).catch(() => []);
    for (const n of Array.isArray(extra) ? extra : []) names.set(n.id, n.name);
  }

  // A dated or forward-looking fact goes stale silently: "shaadi december me
  // h" recalled fourteen months later is not news, it's a wrong statement.
  // Flagging it in the data beats hoping the model does the date arithmetic.
  const TIME_BOUND =
    /\b(jan|feb|march|april|may|june|july|aug|sept|oct|nov|dec|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|next|upcoming|soon|planning|plans?|will|shaadi|wedding|exam|interview|trip|due|deadline|weekend|birthday|\d{4}|\d{1,2}(st|nd|rd|th))\b/i;
  const STALE_HEDGE =
    " ← whatever was ahead in this has already happened; talk about it as past and let them tell you how it went";
  // ── BI-TEMPORAL FACT EDGES (ROADMAP-100X item 4, WS-O) ──────────────────
  //
  // THE DEFECT THIS CLOSES. This function used to be the four lines below the
  // validity branch and nothing else, so it hedged on the age of the ROW. WS-K's
  // recall benchmark caught the consequence on its first run
  // (`stale-note-keys-on-row-age`): dyad-b's `neet pg` is a NOVEMBER exam
  // recorded in JUNE, so in August the row is 67 days old, `kind = 'plan'`, and
  // she is handed it pre-hedged as already-past — she asks how an exam went
  // that has not happened.
  //
  // Row age was a PROXY for "the world has moved on". `valid_to` (migration
  // 056) is the thing it was standing in for: the horizon after which the
  // forward-looking reading stops being true. So when a row knows its own
  // horizon, the horizon decides — and this is a comparison, not a model call
  // and not a guess, which is the sentence ROADMAP-100X item 4 is written in.
  //
  // NOTE WHAT IS NOT IMPORTED. The date PARSER lives in src/engine/validity.ts
  // (over timeline.ts's `resolveWhen`) and runs on the WRITE path only. The
  // read path — this one, the latency-critical one — needs no parser, no
  // engine bundle and no new import, because a stored interval only has to be
  // compared. That split is deliberate: it is what lets the fix land in the
  // hot path with two lines and zero cold-start cost.
  //
  // ROW AGE IS KEPT, NOT REPLACED. `valid_to` is null for every row written
  // before 056 and for every fact whose text carries no resolvable date, which
  // is most facts. For those the 45-day rule below is unchanged, byte for
  // byte — which is why every existing fixture still renders identically. "The
  // row is old and it looked like a plan" remains a genuinely useful signal;
  // it is now the FALLBACK rather than the whole rule.
  const staleNote = (n) => {
    const to = n.valid_to ? new Date(n.valid_to).getTime() : NaN;
    if (Number.isFinite(to)) return Date.now() > to ? STALE_HEDGE : "";
    const days = (Date.now() - new Date(n.updated_at).getTime()) / 86_400_000;
    if (!(days > 45)) return "";
    if (n.kind !== "plan" && n.kind !== "event" && !TIME_BOUND.test(n.summary || "")) return "";
    return STALE_HEDGE;
  };

  const line = (n) => {
    const rel = (Array.isArray(edges) ? edges : [])
      .filter((e) => e.src === n.id || e.dst === n.id)
      .slice(0, 4)
      .map((e) =>
        e.src === n.id
          ? `${e.relation} ${names.get(e.dst) ?? "?"}`
          : `${names.get(e.src) ?? "?"} ${e.relation} this`,
      )
      .join("; ");
    // the age travels with the fact: a plan recalled six months later is not
    // still upcoming, and she can only get that right if she knows how old it is.
    // The feeling travels with it too — but ONLY as the words they used, so she
    // can never tell them how they felt about something they never told her.
    const felt = n.feel ? ` — their own words for it: "${n.feel}"` : "";
    return `- ${n.name} (${n.kind}, ${provenanceAge(n)}): ${n.summary}${felt}${rel ? ` [${rel}]` : ""}${staleNote(n)}`;
  };

  // matched-vs-background stays labelled: background is continuity, not a
  // prompt to bring six unrelated facts into a reply about something else
  const matchedIds = new Set(matchedFused.map((n) => n.id));
  const blocks = [];
  // THE ACTIVITY BLOCK GOES FIRST, and the position is the drop policy rather
  // than an opinion about importance: `api/chat.js` keeps the FIRST n
  // characters of what it is handed and cuts the END, so of everything here
  // the record of what the two of them actually DID is the one thing that must
  // not be the casualty. It is also the only block whose contents are
  // verifiable by the person reading her reply — he was at the board.
  //
  // The heading carries the fence, for the same reason the client-side ledger
  // block does: this is the class of memory where supplying a missing detail
  // is indistinguishable from remembering it, and the boundary can only be
  // stated where the record is.
  //
  // ONE HEADING, TWO PRODUCERS. `src/engine/memory.ts` exports
  // ACTIVITY_BLOCK_SENTINEL and its own ledger block opens with the same
  // words, so a client that holds a local ledger can recognise this block and
  // drop it rather than rendering both — see `withoutServerActivityBlock`.
  // This block is what reaches the surfaces that have no AppState at all: the
  // realtime call lane, and every bot surface in api/route.js. The sentinel is
  // a hand-kept mirror and `evals/gamemem.mjs` pins the two together.
  if (activities.length)
    blocks.push(
      `GAMES AND THINGS YOU TWO ACTUALLY DID, newest first. This is the whole record of them: never add a move, an opening, a question or a score that is not written here — if they ask for one it does not carry, say you do not remember it rather than filling it in:\n${activities
        .map((f) => `- ${f.body} (${ageLabel(f.created_at)})`)
        .join("\n")}`,
    );
  // ── THE WATCHED-TOGETHER BLOCK (P1-1) ───────────────────────────────────
  //
  // Second, right behind the activity block and for the same drop-policy
  // reason: api/chat.js keeps the FIRST n characters, and a screen the two of
  // them watched together is the other class of memory whose absence reads as
  // a denial that it happened.
  //
  // THE FENCE IS DIFFERENT FROM THE ACTIVITY BLOCK'S, and the difference is
  // the whole point. A game record is verifiable — he was at the board. A
  // visual claim is a model's guess about pixels, measured at 10.2%/11.2%
  // fabrication for a STRONGER model with more frames and a tuned directive
  // (`visiongate-powered`), and PHOTO_VISION_CONFIDENCE is 0.35 for that
  // reason. So the confidence travels into the render as WORDS rather than as
  // a number she would have to interpret, and the heading says out loud which
  // half is the record and which half is a guess: HER OWN REACTION is a thing
  // she said and can be relied on; WHAT WAS ON THE SCREEN is not.
  //
  // "never raise these unprompted" is in the heading because L3 is not relaxed
  // to make a feature feel impressive. The block is what makes "us din jo
  // video dekhi thi" answerable when he asks; it is not a licence to bring up
  // a photo he sent three weeks ago out of nowhere.
  const watchLines = [
    ...watched.moments.map((m) => {
      const saw = m.claim
        ? `on screen (a model's read of it, can be wrong): "${m.claim}"`
        : "on screen: no reliable record of what it was";
      return `- ${ageLabel(m.at)}, ${m.channel === "watch" ? "watching together" : "on a call"} — ${saw}; you said: "${m.reaction}"`;
    }),
    ...watched.photos.map(
      (p) =>
        `- ${ageLabel(p.created_at)} — a picture they sent; a model read it as "${p.claim}", which is a guess about a photograph and not something you saw`,
    ),
  ];
  // byte cap, whole lines only — the compiler never slices, so neither does
  // this: a half-rendered visual claim is a claim with its hedge cut off.
  const WATCH_BLOCK_BUDGET = 700;
  const watchKept = [];
  let watchBytes = 0;
  for (const l of watchLines) {
    if (watchBytes + l.length + 1 > WATCH_BLOCK_BUDGET) break;
    watchKept.push(l);
    watchBytes += l.length + 1;
  }
  if (watchKept.length)
    blocks.push(
      `THINGS YOU TWO LOOKED AT TOGETHER (context only, never raise these unprompted). Your own reaction is a thing you actually said; what was on the screen is a machine's guess at an image and may be wrong — if they ask for a detail that is not written here, say you do not remember it rather than filling it in:\n${watchKept.join("\n")}`,
    );
  if (matchedFused.length)
    blocks.push(`RELEVANT TO WHAT THEY JUST SAID:\n${matchedFused.map(line).join("\n")}`);
  const bgOnly = background.filter((n) => !matchedIds.has(n.id));
  if (bgOnly.length)
    blocks.push(
      `STANDING BACKGROUND (the big things in their life — context only, never raise these unprompted):\n${bgOnly
        .map(line)
        .join("\n")}`,
    );

  // semantic hits render in their own labelled block — never merged silently
  // into "RELEVANT", because a semantic match is a weaker, differently-earned
  // signal than an exact word hit and the two must stay distinguishable to
  // anyone reading a diag trace later. Deduped against anything the keyword
  // path already surfaced by name.
  // The activity leg and the semantic leg both read `vy_fact`, so an activity
  // whose embedding DID land can come back on both — deduped by the same fact
  // name they share, or she is told about one game twice under two headings.
  const namesShown = new Set(
    [...matchedFused, ...background, ...activities].map((n) => String(n.name || "").toLowerCase()),
  );
  const factLine = (f) => {
    const felt = f.feel ? ` — their own words for it: "${f.feel}"` : "";
    return `- ${f.name} (${f.kind}, first told ${ageLabel(f.created_at)}): ${f.body}${felt}`;
  };
  const semanticOnly = semantic.filter((f) => f && !namesShown.has(String(f.name || "").toLowerCase()));
  if (semanticOnly.length) {
    blocks.push(
      `ALSO RELEVANT (no shared words with what they said, but the same thing):\n${semanticOnly
        .map(factLine)
        .join("\n")}`,
    );
  }
  for (const f of semanticOnly) namesShown.add(String(f.name || "").toLowerCase());

  // ── the co-citation hop's own block (world-class #2) ────────────────────
  //
  // Labelled separately for the same reason ALSO RELEVANT is: a row that
  // arrived here shares no words AND no embedding neighbourhood with the
  // query — it arrived because it came out of the same conversation as
  // something that did. That is a real and useful signal and it is a WEAKER
  // one than either of the other two, so it says so. Merging it upward would
  // make a diag trace unable to name which store answered, which is the
  // property the labelled-blocks design exists to keep.
  const coCitedOnly = coCitedFused.filter(
    (f) => f && !namesShown.has(String(f.name || "").toLowerCase()),
  );
  if (coCitedOnly.length)
    blocks.push(
      `FROM THE SAME CONVERSATION (they came up in the same stretch as the things above — related by when, not by what):\n${coCitedOnly
        .map(factLine)
        .join("\n")}`,
    );

  // ── vy_observation — noticing, at ONE citation (SPEC-SELF-LAYER §7) ──────
  //
  // Rides inside T5's existing 6,000-char budget rather than taking a slot of
  // its own, and inherits T5's pull-only discipline unchanged: matchObservations
  // returns [] before issuing any SQL when the turn carries no signal word, so
  // there is no path that answers "what is salient about this person" absent a
  // real question. `never raise unprompted` is not relaxed to make this feel
  // more impressive.
  //
  // Labelled separately from RELEVANT and from ALSO RELEVANT because an
  // observation is a differently-earned signal: one citation, recalling a
  // detail, versus a fact that survived consolidation. Merging them would make
  // a diag trace unable to say which store answered.
  //
  // RECALL_STOP is passed EXPLICITLY: observation.ts ships in the client bundle
  // and must never statically import this file (it would drag api/_db.js and
  // api/_config.js into the browser build — the exact failure relstate.ts's
  // header warns about). Dependency injection, same treatment as QueryFn, not
  // a second stopword list.
  const engine = await loadSelfEngineForRecall();
  const obsPerson = await personPromise.catch(() => null);
  const obsIds = [];
  if (engine && obsPerson && words.length) {
    try {
      const obs = await engine.matchObservations(q, obsPerson, agentId, query, 3, RECALL_STOP);
      for (const o of obs) if (Number.isFinite(Number(o?.id))) obsIds.push(Number(o.id));
      if (obs.length) {
        blocks.push(
          `THINGS YOU NOTICED THEM SAY (one mention each, so treat them as details you remember — not as patterns, and never as a list):\n${obs
            .map((o) => `- ${o.note}`)
            .join("\n")}`,
        );
      }
    } catch (e) {
      // fail-soft: a missing bundle or a bad row costs the observation block,
      // never the recall that the turn actually depends on.
      console.error("[recall] observation match skipped:", String(e?.message || e).slice(0, 120));
    }
  }

  // touch recall time (awaited — serverless kills post-response work)
  await q(
    `update meera_nodes n set last_recalled = now() where device_id = $1
      ${agentScopePredicate("n", { agentId: "$3" })}
      and id = any($2)`,
    [device, idArr, agentId],
  ).catch(() => {});

  // ── T5's byte ceiling, enforced HERE, by dropping whole blocks ──────────
  //
  // This wave added two blocks to T5 (watched-together, from-the-same-
  // conversation) and grew a third (standing background, 4 rows -> 6), and
  // there was no ceiling on this string at all — the only thing downstream of
  // it that bounds anything is api/chat.js, which keeps the FIRST n characters
  // and cuts the END. That is `silent-truncation`, the failure that has
  // already cost this product its crisis helplines once, and the reason
  // scripts/check-prompt-budget.mjs exists.
  //
  // So the producer bounds itself, and it does it the way SPEC §3.2 requires
  // ("The compiler NEVER slices — it drops whole blocks"): blocks are already
  // in drop-policy order, most load-bearing first, and the ones that do not
  // fit are removed ENTIRELY rather than cut in half. A half-block is the
  // worst of the three outcomes here: a watched-together entry cut mid-line
  // loses its hedge and keeps its claim.
  //
  // HAND-KEPT MIRROR of compiler.ts's TAIL manifest, T5, `budget: 6_000`.
  // The same treatment ACTIVITY_SUMMARY_MAX gets and for the same reason —
  // the two live on opposite sides of a bundler boundary — and
  // evals/recall/run.mjs pins the two numbers together, because a reader that
  // bounds at 6,000 against a manifest that moved to 4,000 does not fail, it
  // silently hands over a block the compiler will drop whole.
  const fitted = [];
  let usedBytes = 0;
  const dropped = [];
  for (const b of blocks) {
    const cost = b.length + (fitted.length ? 1 : 0);
    if (usedBytes + cost > RECALL_T5_BUDGET) {
      dropped.push(b.slice(0, b.indexOf(":") + 1 || 24).slice(0, 40));
      continue;
    }
    fitted.push(b);
    usedBytes += cost;
  }
  if (dropped.length) {
    // said out loud rather than absorbed: a block that never reached a prompt
    // is indistinguishable from a store that had nothing in it, which is the
    // whole class `realtime-recall-never` belongs to
    console.warn(`[recall] T5 over budget — dropped whole block(s): ${dropped.join(" | ")}`);
  }
  const memories = fitted.join("\n");
  // WS-TRACE: block LABELS (the heading before the colon), never the lines
  // under them. Which store answered is the diagnosable fact; what it answered
  // with is in the rows the ids above point at.
  // the blocks that ACTUALLY went, not the ones that were built — a trace
  // naming a block the budget dropped is a trace that lies about what she saw
  const blockLabels = fitted.map((b) => b.slice(0, b.indexOf(":") + 1 || 24).slice(0, 40));
  return {
    memories,
    relstate: relBundle,
    self: selfBundle,
    trace: buildTrace(memories, obsIds, blockLabels),
  };
}

/** WS-TRACE: the SHAPE of a rel bundle — how many of each kind of row reached
 *  the compiler, never a row. An empty bundle and an absent one look different
 *  here on purpose: `relstate-zero-rows` was forty people with a bundle that
 *  had no state in it, and "present but empty" is the only reading that says so. */
function relBundleShape(b) {
  if (!b) return { present: false };
  const n = (v) => (Array.isArray(v) ? v.length : 0);
  return {
    present: true,
    relstate_present: Boolean(b.relState),
    we_episodes_n: n(b.weEpisodes),
    phrases_n: n(b.phrases),
    patterns_n: n(b.patterns),
    rituals_n: n(b.rituals),
    ledger_n: n(b.phraseLedger),
    currency_n: n(b.currency),
    home_region: Boolean(b.homeRegion),
    honorific_move_at: b.lastHonorificMoveAt ? 1 : 0,
    // WS-RELSTATE record-vs-stance split (rejected.md `rupture-never-closes`)
    rupture_move_at: b.lastRuptureMoveAt ? 1 : 0,
    warm_episodes_since_rupture: Number(b.warmEpisodesSinceRupture ?? 0),
  };
}

/** WS-TRACE: the same for the self bundle (T11/T12/T13). `selflayer-rows-zero`
 *  is the measurement this exists to make queryable — a layer that shipped and
 *  stayed empty, discovered only because someone went looking. */
function selfBundleShape(b) {
  if (!b) return { present: false };
  const n = (v) => (Array.isArray(v) ? v.length : 0);
  return {
    present: true,
    texture_present: Boolean(b.texture),
    arc_n: n(b.arc),
    untold_n: n(b.untold),
  };
}

// GAP 3 (WS-FELT) — vibe chips → vy_currency. src/engine/india.ts's own
// writeCurrencyUse (QueryFn-injected) is CLIENT-BUNDLED, same discipline as
// relstate.ts (its own header: "nothing here imports api/_db.js") — it has
// zero callers because nothing server-side can ever call it; this is the
// small op that inserts the row directly instead, same precedent as
// consolidate.js's WE_TOKEN_RE/HINDI_MARKER_WORDS ports (duplicate the
// deterministic shape as plain JS, comment which file it mirrors).
//
// Citation law (SPEC §4.2, `vy_fact_cite_or_authored`): a chip the user
// picked at onboarding is USER-AUTHORED, not derived from any episode —
// there is nothing to cite yet, the same shape vy_fact's own 'authored'
// provenance exempts from `cardinality(citations) >= 1`. vy_currency
// itself carries no such CHECK in db/schema.sql (confirmed — only
// vy_fact/vy_rel_event/vy_pattern/vy_kin/vy_taste_candidate do), so an
// empty citations array is simply the correct, honest shape here: never a
// fabricated citation to episodes that do not exist.
//
// Mapping is a CONTENT classifier, not a lookup keyed to today's 6 fixed
// onboarding strings on purpose — a chip that carries no cricket/food/
// place/film/festival signal is skipped, never shoehorned into the nearest
// kind. (Traced honestly: none of Onboarding.tsx's current VIBES chips —
// "someone to talk to", "late-night company", etc. — are topic/interest
// data at all; they are relational-intent strings already consumed by
// persona.ts's "what they came here for" line. Under this classifier all
// six legitimately skip today. The machinery is still correct and ready:
// any future topic-shaped chip ("cricket", "diwali", "bollywood") flows
// through unchanged.)
const CURRENCY_KIND_HINTS = {
  cricket: /\b(cricket|ipl|bcci|wicket|virat|kohli|dhoni|rohit sharma|world cup)\b/i,
  food: /\b(food|khana|biryani|chai|coffee|street food|dessert|sweets|cook(ing)?|restaurant)\b/i,
  place: /\b(travel|trip|goa|kerala|manali|himalaya|hill station|beach|mumbai|delhi|bangalore|bengaluru|hyderabad|chennai|kolkata|pune)\b/i,
  film: /\b(movie|movies|film|films|bollywood|cinema|series|web series|ott|show|actor|actress)\b/i,
  festival: /\b(diwali|holi|eid|rakhi|raksha bandhan|navratri|durga puja|ganesh chaturthi|christmas|new year|festival)\b/i,
};
function chipToCurrencyKind(chip) {
  const t = String(chip || "").toLowerCase();
  for (const [kind, rx] of Object.entries(CURRENCY_KIND_HINTS)) {
    if (rx.test(t)) return kind;
  }
  return null; // honest miss — never shoehorned into the nearest kind
}

async function opSeedCurrency(device, body) {
  const chips = (Array.isArray(body.chips) ? body.chips : []).slice(0, 6);
  if (!chips.length) return { ok: true, written: 0, skipped: 0 };
  const agentId = MEERA_AGENT_ID;
  const person = await personIdFor(device);
  let written = 0;
  let skipped = 0;
  for (const raw of chips) {
    const kind = chipToCurrencyKind(raw);
    const topic = String(raw || "").trim().toLowerCase().slice(0, 60);
    if (!kind || !topic) {
      skipped++;
      continue;
    }
    // MIGRATED ARBITER (009 header's ten sites; migration 010 precondition):
    // the PK is now (agent_id, person_id, topic), so the arbiter names the
    // composite key. Naming the old person-only key still resolves TODAY only
    // through 009's `vy_currency_person_compat_ix`, which 010 drops — and this
    // site is .catch()-swallowed, so the failure mode of not migrating it is
    // not an error anyone sees, it is `relstate-zero-rows` a second time:
    // writers silently not writing.
    await q(
      `insert into vy_currency (agent_id, person_id, topic, kind, last_used, uses, citations)
       values (${agentValue("$4")},$1,$2,$3, now(), 1, '{}'::bigint[])
       on conflict (agent_id, person_id, topic) do update set
         last_used = now(), uses = vy_currency.uses + 1`,
      [person, topic, kind, agentId],
    ).catch(() => {});
    written++;
  }
  return { ok: true, written, skipped };
}

// ── THE LAUNDERING WINDOW ──────────────────────────────────────────────────
//
// docs/audit/2026-08-22-honesty.md, MEDIUM: "Her live-lane turns are logged
// ungated and feed sharedVocab, so the memory graph is not the
// 'provenance-clean by construction' source family 4 assumes."
//
// The chain the audit traced, hop by hop: `useCallEngine.ts:723` logs her
// spoken turns with no `guardReply` (the live speech-to-speech lane emits
// audio and has no string to inspect before it is heard) → those turns enter
// this function's 16-turn window → the extractor below is instructed to
// record "what the TWO of them share" → the node it writes comes back through
// opRecall as `memories` → `brain.ts:1130` feeds `memories` to
// `sharedVocabulary`, which licenses every token in it. So a shared memory she
// INVENTED aloud on a call became permanent support for the same claim typed
// on the chat lane, where the gate would otherwise have caught it.
//
// `honesty.ts` states the rule this restores, twice, at `allowedFrom` and at
// `hisVocabulary`: "one fabrication would otherwise launder itself into
// permanence — the provenance chain has to terminate at something that is not
// her." Family 4's support set was the one place it did not.
//
// WHY A PREDICATE AND NOT A PROMPT. The extractor could be told to ignore her
// turns; docs/RELATIONALOS.md measures what that is worth — "an instruction
// leaked 57–98% of the time; a SQL predicate leaked 0 in 31,122." This is a
// filter over the extractor's OUTPUT, so a compliant extractor and a
// disobedient one produce the same rows.
//
// WHY NOT SIMPLY DROP HER CALL TURNS FROM THE WINDOW (the audit's option (a),
// first half). Because the SAME window is the only source of `self` (what she
// said about her OWN life) and of her carried interior, and both are legit
// products of her own speech — `self` exists precisely so she does not
// re-invent her flatmate two turns later. Starving them on every call to fix
// the shared-record leak would trade one continuity defect for another. Her
// life stays hers; what she may not do is hand herself a shared past.
//
// THE PREDICATE, stated exactly: a node is dropped iff it is lexically
// anchored in her ungated spoken turns AND in nothing else in the window.
// Both halves matter. A node that shares a word with HIS turns (any channel —
// his words are ground truth, he said them) or with her TYPED turns (the chat
// lane runs guardReply over her output before it is ever logged) is kept. A
// node that matches neither side is also kept: an extractor abstraction with
// no literal overlap anywhere ("career change" from "job chhod raha hu") is
// not evidence of laundering, and dropping it would eat real memories to
// chase a shape this predicate cannot see.

const LAUNDER_TERM_LEN = 3; // matches honesty.ts's sharedClaimTokens, not claimTokens

/** Content words, ≥3 chars, latin or devanagari. Deliberately the SAME floor
 *  family 4's own claim tokenizer uses: this predicate exists to govern what
 *  can support that family, and a support set tokenized differently from the
 *  claims is the mismatch the audit's tokenizer finding is about. */
export function contentTokens(t) {
  return (String(t || "").toLowerCase().match(/[a-zऀ-ॿ]+/g) || []).filter(
    (w) => w.length >= LAUNDER_TERM_LEN,
  );
}

/** `{ kept, dropped }` — never mutates, never throws, and returns every node
 *  unchanged when the window carries no ungated spoken turn of hers, which is
 *  every chat-only stretch (i.e. almost all of them). */
export function nonLaunderedNodes(nodes, recent) {
  const list = Array.isArray(nodes) ? nodes : [];
  const turns = Array.isArray(recent) ? recent : [];
  // HER + spoken. `channel` arrives from src/engine/memory.ts's rememberFrom;
  // a client that does not send it (an older build, another surface) yields no
  // ungated turns and therefore today's exact behaviour — the fix is additive
  // and can never make an existing caller lose a memory.
  const ungated = new Set();
  const gated = new Set();
  for (const t of turns) {
    const spokenByHer = t && t.role !== "me" && t.channel === "call";
    const into = spokenByHer ? ungated : gated;
    for (const w of contentTokens(t?.content)) into.add(w);
  }
  if (!ungated.size) return { kept: list, dropped: [] };
  const kept = [];
  const dropped = [];
  for (const n of list) {
    const toks = contentTokens(`${n?.name || ""} ${n?.summary || ""}`);
    const hers = toks.some((w) => ungated.has(w));
    const elsewhere = toks.some((w) => gated.has(w));
    (hers && !elsewhere ? dropped : kept).push(n);
  }
  return { kept, dropped };
}

async function opRemember(device, body) {
  const agentId = MEERA_AGENT_ID;
  const recent = (Array.isArray(body.recent) ? body.recent : []).slice(-16);
  if (recent.length < 2) return { ok: true, extracted: 0 };
  // LOAD-BEARING INVARIANT — DO NOT "IMPROVE" THIS MAP.
  // This is the ONLY place her interior is derived from, and it deliberately
  // carries NO timestamps, NO [... later] gap markers, NO channel markers and
  // NO turn indices (unlike toTurns() in brain.ts, which stamps everything).
  // Because the appraiser cannot SEE his reply speed, his silence or the
  // length of the session, it is structurally incapable of turning any of
  // them into her mood. Input starvation is the real guarantee here — a
  // keyword filter over generated Hinglish is not, and never was.
  const convo = recent
    .map((t) => `${t.role === "me" ? "user" : "meera"}: ${String(t.content || "").slice(0, 300)}`)
    .join("\n");
  // what she is already carrying, so ONE judgment pass decides both what
  // survives and what is new — two passes could contradict each other
  // one list arrives on the wire (the client-side call sites live in
  // components that can't be widened); "owed: " marks a promise, not a want
  const carried = (Array.isArray(body.wants) ? body.wants : [])
    .filter((w) => typeof w === "string" && w.trim())
    .slice(0, 5)
    .map((w) => w.trim().slice(0, 96));
  const openWants = carried.filter((w) => !/^owed:/i.test(w)).slice(0, 3);
  const openOwed = carried
    .filter((w) => /^owed:/i.test(w))
    .map((w) => w.replace(/^owed:\s*/i, ""))
    .slice(0, 2);

  const content = await extractChat(
    [
        {
          role: "system",
          content: `Extract memory from this Hinglish chat (meera is the AI companion, the other person is the user). Reply with ONLY JSON, keys in this order:
{"now":{"text":"...","w":0.4,"sign":-1}|null,"wants":[{"text":"...","days":3}],"owed":[{"text":"..."}],"told":false,"self":["..."],"nodes":[{"kind":"person|place|preference|fact|phrase|event|emotion|plan|topic","name":"short lowercase","summary":"one line, <=120 chars","feel":"their own words for how it felt, or \\"\\""}],"edges":[{"src":"node name","dst":"node name","relation":"2-3 words"}]}

"now" = MEERA's own carried feeling if this stretch clearly left her with one — ONE line in HER first-person voice that fuses the feeling AND its cause inseparably, <=100 chars, e.g. "still annoyed about the review thing, whole morning gone" or "weirdly happy about the deck actually landing". Rules: it may ONLY be caused by something in HER life, or by real feeling about something that happened to the USER. It may NEVER be about the user's attention, replies, silence, absence or how much he talks to her. It is a FEELING, not an event she did — events go in "self". "w" 0.2 (mild) to 0.85 (really moved her). "sign" -1 or 1. null on most stretches: nothing carried is the normal case.
"told" = true only if meera actually said out loud in this stretch how she was feeling and why.
"wants" = things MEERA has decided she wants to do in HER OWN life and hasn't finished — never anything she wants FROM the user. Max 3, <=90 chars, "days" = roughly how long it stays live. She is currently carrying: ${
            openWants.length ? openWants.map((w) => `"${w}"`).join(", ") : "(nothing)"
          }. Return the ones still true of her (same words), drop the ones she finished, dropped or stopped caring about, and add at most one new one. Omit the key entirely if you cannot tell.
"owed" = things MEERA told the user out loud she would come back to and has NOT yet done ("kal batati hu", "ruk photo dhoondti hu", "baad me batati hu poori story"). Max 2, <=90 chars, her words for the thing itself (not "she said she would..."). She is currently owing: ${
            openOwed.length ? openOwed.map((w) => `"${w}"`).join(", ") : "(nothing)"
          }. Return the ones she still has NOT delivered, and DROP any she actually delivered in this stretch. Return [] when she owes nothing. Never anything she wants FROM the user, never something the user promised, never a plan for them to do together. Omit the key entirely if you cannot tell.
"self" = up to 4 short lowercase lines stating what MEERA said about HER OWN life here (her job, her people, her flat, what she did/ate/watched, her plans) — plain facts, <=90 chars each, e.g. "flatmate is named sneha", "spent today redoing the onboarding screens". Never a line about the USER. These keep her consistent with herself later.
nodes/edges = the USER's world and what the TWO of them share. Only things worth remembering weeks later: people, places, jobs, plans, strong likes/dislikes, recurring feelings, big events — plus kind "phrase": a word, nickname or running joke the two of THEM made up together, stored under the exact word they use, with the summary saying what it means and where it came from. A phrase only counts if it literally appears in this chat; never invent one and never file an ordinary Hindi/English word as a phrase. Skip small talk. Max 6 nodes. Never put meera's own life in nodes. "feel" = how the USER felt about it, IN THEIR OWN WORDS from this chat, <=40 chars — leave it "" unless they actually said it; never infer or invent a feeling for them.`,
        },
        { role: "user", content: convo },
    ],
    // 1100, not 600: the old cap could truncate a busy stretch mid-JSON,
    // JSON.parse threw below, the op returned {ok:false} and the client's
    // catch swallowed it — silently losing the graph write AND the
    // self-facts. Key order in the schema is deliberate for the same reason:
    // her interior is emitted FIRST so that if anything ever truncates it is
    // the tail of the (lossy, re-derivable) node list that goes.
    1100,
  );
  if (!content) return { ok: false };
  let parsed;
  try {
    const raw = content;
    parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    return { ok: false };
  }
  // her own improvised life: returned to the client, never written to the
  // user's graph — it is what keeps her from re-inventing herself two turns later
  const self = (Array.isArray(parsed.self) ? parsed.self : [])
    .filter((s) => typeof s === "string" && s.trim())
    // a lite extractor occasionally emits a line about HIM, which would then
    // render under "you said these, so they are fixed between you two" — an
    // extraction slip promoted to a confident false claim about his world
    .filter((s) => !/^\s*(they|he|she|the user|user)\b/i.test(s))
    .slice(0, 4)
    .map((s) => s.trim().replace(/\s+/g, " ").slice(0, 110));
  // her carried interior — validated again on the client (inner.applyInner);
  // this side only shapes it, it never decides whether it is allowed
  const rawNow = parsed.now && typeof parsed.now === "object" ? parsed.now : null;
  const now =
    rawNow && typeof rawNow.text === "string" && rawNow.text.trim()
      ? {
          text: rawNow.text.trim().replace(/\s+/g, " ").slice(0, 110),
          w: Number(rawNow.w) || 0.4,
          sign: Number(rawNow.sign) < 0 ? -1 : 1,
        }
      : null;
  const wants = Array.isArray(parsed.wants)
    ? parsed.wants
        .filter((w) => w && typeof w.text === "string" && w.text.trim())
        .slice(0, 3)
        .map((w) => ({ text: w.text.trim().replace(/\s+/g, " ").slice(0, 90), days: Number(w.days) || 3 }))
    : undefined;
  // an empty ARRAY is meaningful here — it is how the appraiser says "she
  // delivered it, she owes nothing now" — so it must survive as [], not become
  // undefined and leave the old promise ageing out on its own clock
  const owed = Array.isArray(parsed.owed)
    ? parsed.owed
        .filter((w) => w && typeof w.text === "string" && w.text.trim())
        .slice(0, 2)
        .map((w) => ({ text: w.text.trim().replace(/\s+/g, " ").slice(0, 90) }))
    : undefined;
  const interior = {
    now,
    told: parsed.told === true,
    ...(wants ? { wants } : {}),
    ...(owed ? { owed } : {}),
  };
  const nodes = (Array.isArray(parsed.nodes) ? parsed.nodes : [])
    .filter((n) => n && typeof n.name === "string" && n.name.trim())
    .slice(0, 6)
    .map((n) => ({
      kind: ["person", "place", "event", "preference", "fact", "phrase", "emotion", "plan", "topic"].includes(n.kind)
        ? n.kind
        : "fact",
      name: n.name.trim().toLowerCase().slice(0, 60),
      summary: String(n.summary || "").slice(0, 160),
      // how it FELT, in their words only. A memory with a feeling attached is
      // what "she knows me" is made of — but a feeling they never expressed is
      // a fabrication about their insides, which is the one thing that can't
      // be walked back. Empty is the default and it is fine.
      feel: typeof n.feel === "string" ? n.feel.trim().replace(/\s+/g, " ").slice(0, 40) : "",
    }));
  if (!nodes.length) return { ok: true, extracted: 0, self, ...interior };

  // THE LAUNDERING GUARD, before anything is written and before the
  // re-derivation guard below — a node she alone spoke into existence on an
  // ungated call must not reach the graph at all, not be written and cleaned
  // up afterwards. See nonLaunderedNodes() for the predicate and the audit
  // finding it closes. `laundered` is reported so the rate is observable in
  // the response rather than being a silent subtraction.
  const { kept: sourced, dropped: laundered } = nonLaunderedNodes(nodes, recent);
  if (laundered.length) {
    // names only, and only server-side logs — never a diag row, which would
    // outlive the turn it describes
    console.warn(
      `[remember] dropped ${laundered.length} her-sourced live-turn node(s): ${laundered
        .map((n) => n.name)
        .join(", ")}`,
    );
  }
  if (!sourced.length) return { ok: true, extracted: 0, laundered: laundered.length, self, ...interior };

  // THE RE-DERIVATION GUARD. This pass runs over the transcript still on
  // their screen, so a thing deleted last turn is sitting right there to be
  // extracted again. Filtering happens BEFORE the upsert — not by deleting
  // it again afterwards — so a forgotten fact is never written at all.
  // Checked against name AND summary, because a term filtered out of the
  // name walks straight back in through the summary.
  const forgotten = await q(
    `select term from meera_forget f where device_id = $1
      ${agentScopePredicate("f", { agentId: "$2" })}
      order by at desc limit ${FORGET_TERMS_CAP}`,
    [device, agentId],
  ).catch(() => []);
  const suppressed = (Array.isArray(forgotten) ? forgotten : []).map((r) => termRe(String(r.term)));
  const kept = suppressed.length
    ? sourced.filter((n) => !suppressed.some((rx) => rx.test(n.name) || rx.test(n.summary)))
    : sourced;
  if (!kept.length) return { ok: true, extracted: 0, laundered: laundered.length, self, ...interior };

  // split into existing (bump) vs new (insert)
  const existing = await q(
    `select id, name, mentions, salience, feel from meera_nodes n where device_id = $1
      ${agentScopePredicate("n", { agentId: "$3" })}
      and name = any($2)`,
    [device, kept.map((n) => n.name), agentId],
  ).catch(() => []);
  const byName = new Map((Array.isArray(existing) ? existing : []).map((n) => [n.name, n]));

  // ── BI-TEMPORAL FACT EDGES (migration 056, WS-O) ────────────────────────
  // The WRITE half, derived ONCE for every kept node before the bump/insert
  // split so both branches read one map rather than each growing their own.
  //
  // Over the real parser (src/engine/validity.ts → timeline.ts's
  // `resolveWhen`), reached through the engine bundle and never re-implemented
  // here: a second date table would be a second definition of what "november"
  // means, which is the failure src/engine/serverEntry.ts's header exists to
  // refuse.
  //
  // `saidAt` is NOW, because this op runs on the turn the thing was said. That
  // anchor is the whole mechanism: "kal" said today and "kal" said in March are
  // different days, and a deriver anchored on the consolidation clock instead
  // would produce a different interval every time it ran.
  //
  // Degrades to an empty map on any failure (missing bundle, parser miss), and
  // empty is exactly today's behaviour — `staleNote` keeps the 45-day rule. A
  // memory is never lost or altered because its date could not be read.
  const validityOf = new Map();
  {
    const vmod = await loadValidity();
    if (vmod) {
      const at = Date.now();
      for (const n of kept) {
        try {
          const v = vmod.deriveFactValidity({
            id: n.name,
            name: n.name,
            kind: n.kind,
            summary: n.summary,
            saidAt: at,
          });
          if (v) validityOf.set(n.name, v);
        } catch {
          /* a date we could not read is a null column, never a lost node */
        }
      }
    }
  }

  const idOf = new Map();
  for (const n of kept) {
    const ex = byName.get(n.name);
    if (ex) {
      idOf.set(n.name, ex.id);
      // A RE-STATED HORIZON OVERWRITES; A SILENT RE-MENTION DOES NOT. The
      // update names valid_from/valid_to only when THIS turn carried a
      // resolvable date, so "exam ab january me shift ho gaya" moves the
      // horizon and "padhai chal rahi" — the same node, mentioned again with
      // no date — leaves November exactly where it was. Nulling the columns on
      // every bump would be the simpler statement and would silently erase a
      // horizon the person stated once and never repeated.
      const v = validityOf.get(n.name) || null;
      await q(
        `update meera_nodes n set summary = $1, mentions = $2, salience = $3, feel = $4, updated_at = now()
          ${v ? ", valid_from = $7, valid_to = $8" : ""}
          where id = $5 ${agentScopePredicate("n", { agentId: "$6" })}`,
        [
          n.summary,
          (ex.mentions || 1) + 1,
          // a thing that carried a feeling is more memorable than a thing that
          // didn't — that asymmetry is the whole of "emotional salience", and
          // it decides which memories come back as standing background
          Math.min(10, (ex.salience || 1) + (n.feel ? 1.0 : 0.6)),
          n.feel || ex.feel || "",
          ex.id,
          agentId,
          ...(v
            ? [
                new Date(v.validFrom).toISOString(),
                v.validTo != null ? new Date(v.validTo).toISOString() : null,
              ]
            : []),
        ],
      ).catch(() => {});
    }
  }
  const fresh = kept.filter((n) => !byName.has(n.name));
  for (const n of fresh) {
    const v = validityOf.get(n.name) || null;
    const ins = await q(
      `insert into meera_nodes (device_id, kind, name, summary, feel, salience, agent_id, valid_from, valid_to)
       values ($1,$2,$3,$4,$5,$6,${agentValue("$7")},$8,$9) returning id, name`,
      [
        device,
        n.kind,
        n.name,
        n.summary,
        n.feel,
        n.feel ? 1.6 : 1.0,
        agentId,
        v ? new Date(v.validFrom).toISOString() : null,
        v && v.validTo != null ? new Date(v.validTo).toISOString() : null,
      ],
    ).catch(() => []);
    if (ins[0]) idOf.set(ins[0].name, ins[0].id);
  }

  const edges = (Array.isArray(parsed.edges) ? parsed.edges : [])
    .filter((e) => idOf.has(String(e.src).toLowerCase()) && idOf.has(String(e.dst).toLowerCase()))
    .slice(0, 8)
    .map((e) => ({
      src: idOf.get(String(e.src).toLowerCase()),
      dst: idOf.get(String(e.dst).toLowerCase()),
      relation: String(e.relation || "related to").slice(0, 40),
    }));
  for (const e of edges) {
    await q(
      `insert into meera_edges (device_id, src, dst, relation, agent_id)
       select $1, $2, $3, $4, ${agentValue("$5")}
       where not exists (
         select 1 from meera_edges x where device_id = $1 and src = $2 and dst = $3 and relation = $4
           ${agentScopePredicate("x", { agentId: "$5" })}
       )`,
      [device, e.src, e.dst, e.relation, agentId],
    ).catch(() => {});
  }

  // ── WS-CONSOLIDATE (M3) delta: in-turn provisional tier (SPEC §0.2.1,
  // §4.1 — fixes C-flaw-1, the same-day memory gap). Deterministic and
  // cheap: no new model call, it only persists what the extraction above
  // already produced. A provisional episode is the citation anchor a
  // same-day fact needs to satisfy `vy_fact_cite_or_authored`; the nightly
  // pass (api/consolidate.js) re-segments and re-derives with full
  // citations and supersedes every row written here. Second-class for
  // state on purpose: rel-state events and patterns are NEVER written from
  // 16-turn context — only episodes and facts are.
  try {
    const person = await personIdFor(device);
    // meera_log is ground truth for the channel; the client contract this
    // op was built against (src/engine/memory.ts, frozen elsewhere) never
    // sent one, so the true value is read off the row that was just logged
    // rather than guessed.
    const latestLog = await q(
      `select channel from meera_log l where device_id = $1
        ${agentScopePredicate("l", { agentId: "$2" })}
        order by id desc limit 1`,
      [device, agentId],
    ).catch(() => []);
    const channel = latestLog[0]?.channel === "call" ? "call" : "chat";
    const ep = await openOrExtendEpisode(person, device, channel, { agentId });
    if (ep) {
      const bits = [...kept.slice(0, 3).map((n) => n.name), ...self.slice(0, 2).map((s) => s.slice(0, 30))];
      const summary = (bits.length ? bits.join(", ") : "chat stretch").slice(0, 110);
      await touchEpisode(ep.id, { summary });

      // idempotent within one open episode: a device may call `remember`
      // many times across the same stretch, and a fresh row per call would
      // flood the fact table with duplicates the nightly pass would just
      // have to collapse again.
      const already = await q(
        `select lower(f.name) as name from vy_fact f
          where f.person_id = $1 and f.citations = array[$2]::bigint[]
          ${agentScopePredicate("f", { agentId: "$3" })}`,
        [person, ep.id, agentId],
      ).catch(() => []);
      const written = new Set(already.map((r) => r.name));

      // her own life facts go through the SAME suppression list a user's
      // forget scope produced (§9.1 step 9's discipline, applied here too):
      // a term filtered out of nodes must not walk back in as `kind='meera'`
      const selfKept = self.filter((s) => !suppressed.some((rx) => rx.test(s)));

      const toWrite = [
        ...kept
          .filter((n) => !written.has(n.name))
          .map((n) => ({
            kind: "user",
            name: n.name,
            body: `${n.name}: ${n.summary}`.slice(0, 160),
            feel: n.feel || "",
          })),
        ...selfKept
          .filter((line) => !written.has(`meera:${line.slice(0, 40)}`.toLowerCase()))
          .map((line) => ({
            kind: "meera",
            name: `meera:${line.slice(0, 40)}`.toLowerCase().slice(0, 60),
            body: line.slice(0, 160),
            feel: "",
          })),
      ];

      // Same-day SEMANTIC recall, not just same-day recall: embed right here
      // so a fact told this morning is findable this afternoon by meaning,
      // not only by shared words — the gap `semantic-recall` was closed for.
      // One batched call for the whole turn's new facts; embedding is an
      // enhancement (embedBatch degrades to nulls on failure), so a bad
      // embed call costs the semantic layer for these rows, never the fact
      // write itself.
      const vecs = toWrite.length ? await embedBatch(toWrite.map((f) => f.body)).catch(() => []) : [];
      for (let i = 0; i < toWrite.length; i++) {
        const f = toWrite[i];
        if (written.has(f.name)) continue;
        const ins = await q(
          `insert into vy_fact (agent_id, person_id, kind, name, body, feel, provenance, confidence, citations, provisional)
           values (${agentValue("$7")},$1,$2,$3,$4,$5,'extracted',0.7,$6::bigint[],true) returning id`,
          [person, f.kind, f.name, f.body, f.feel, [ep.id], agentId],
        ).catch(() => []);
        written.add(f.name);
        const vec = vecs[i];
        const factId = ins[0]?.id;
        if (factId && vec) {
          // The arbiter here is (owner_kind, owner_id) — a unique index 009 did
          // not touch, so it is NOT one of the ten sites 010's precondition
          // names. agent_id is still written explicitly: 010 drops the DEFAULT,
          // and a writer that leans on it stops working that day.
          await q(
            `insert into vy_embedding (agent_id, owner_kind, owner_id, person_id, v)
             values (${agentValue("$4")}, 'fact', $1, $2, $3::halfvec)
             on conflict (owner_kind, owner_id) do update set v = excluded.v, at = now()`,
            [factId, person, toHalfvecLiteral(vec), agentId],
          ).catch(() => {});
        }
      }
    }
  } catch {
    // the provisional tier is an enhancement layered on top of an already-
    // working graph write; it must never cost the client its self/inner
    // state above, which is why this whole block is fenced off from it
  }

  return { ok: true, extracted: kept.length, laundered: laundered.length, self, ...interior };
}

// ── #113: a finished activity becomes a graph episode ──────────────────────
//
// THE GAP. `src/state/game.ts`'s RECENT_END_MS keeps a closed game in the
// present moment for two hours and then drops it, and its own comment says
// what was supposed to happen next — "the played list is what the memory
// layer will read". Nothing read it. A game generates no meera_log turns, so
// opRemember's extraction window (chat text, 16 turns) never saw one either:
// forty minutes of chess left no trace of any kind once the afterglow expired.
//
// LEAST NEW MACHINERY, deliberately. No new endpoint (an op on the endpoint
// the client already talks to), no new table, no migration, no model call.
// The write is the SAME two-row shape recordPhotoMemory() already uses for the
// other structured, non-conversational thing that has to become a memory — an
// episode plus one fact citing it, with an embedding so semantic recall can
// find it — and for the same stated reason: the nightly consolidator derives
// facts FROM meera_log, and there is nothing in meera_log for it to derive
// this from. That is also why the rows are written FINAL rather than
// provisional: `provisional` means "a better pass will supersede this", and
// for an activity no such pass exists or can exist. A permanently-provisional
// row would keep the person in findEligiblePersons' queue forever, promising
// a finalize that can never come.
//
// WHAT IS TRUSTED FROM THE CLIENT, and what is not. The summary is composed
// client-side by src/engine/memory.ts's `activityEpisodeSummary` because that
// is where the OS's one activity vocabulary lives (LABEL, ActivityState); the
// server has no adapters and must not grow a second copy of them. What the
// server owns is everything that is a rule rather than a rendering: the
// identity of the person, the idempotence key, the suppression check, the
// bounds on every field, and the fact that this may only ever write about the
// device that asked.

/** Kinds are OS-side identifiers (chess, wyr, ttt, watch, whatever lands
 *  next), so this validates the SHAPE and takes no opinion on the membership —
 *  a server-side allowlist would have to be edited for every new activity,
 *  which is exactly the per-kind seam activity.ts exists to remove. */
const ACTIVITY_KIND_RE = /^[a-z][a-z0-9_]{1,15}$/;

/**
 * HAND-KEPT MIRROR of `src/engine/memory.ts`'s `EPISODE_SUMMARY_MAX`.
 *
 * It was 200 here against a client cap of 180 — comfortable, and therefore
 * invisible when the client cap moved to 420 to make room for the durable rows
 * (the opening, the colours, the ending, the captures). A writer that composes
 * 420 characters and a reader that stores 200 does not fail: it silently
 * stores the FIRST 200 and drops the end, which is where the drop policy
 * deliberately put the least important rows — so the disagreement would have
 * eaten exactly the half nobody would notice missing until someone asked about
 * a game. `warm-count-unscoped` is the same shape and the same file pair.
 *
 * `evals/gamemem.mjs` asserts the two numbers agree, over the REAL modules.
 * A slice still exists because this value crosses a trust boundary — but it is
 * now a bound on a hostile client, not a second opinion about the record.
 */
export const ACTIVITY_SUMMARY_MAX = 420;

/**
 * THE IDEMPOTENCE KEY. The session's own `startedAt`, never the close time:
 * two synced devices agree on when a session began (it is a synced field),
 * they do not agree on the millisecond either of them noticed it close, and
 * the reconciler runs on both. A `vy_fact` name is unique per person by
 * lookup here, the same mechanism recordPhotoMemory uses for a double-tapped
 * describe call.
 */
export function activityFactName(kind, startedAt) {
  return `activity:${kind}:${Math.floor(Number(startedAt))}`.slice(0, 60);
}

async function opActivity(device, body) {
  const kind = String(body.kind || "");
  const startedAt = Number(body.startedAt);
  const closedAt = Number(body.closedAt);
  const summary = String(body.summary || "").trim().replace(/\s+/g, " ").slice(0, ACTIVITY_SUMMARY_MAX);
  if (!ACTIVITY_KIND_RE.test(kind)) return { ok: false, error: "bad kind" };
  if (!Number.isFinite(startedAt) || startedAt <= 0) return { ok: false, error: "bad session" };
  if (!Number.isFinite(closedAt) || closedAt < startedAt) return { ok: false, error: "bad session" };
  if (summary.length < 8) return { ok: true, wrote: false };

  try {
    const agentId = MEERA_AGENT_ID;
    const person = await personIdFor(device);
    const name = activityFactName(kind, startedAt);

    // THE IDEMPOTENCE CHECK. Two devices, a retry, a remount, a session that
    // syncs back after the write — all land here and all return the same
    // "already recorded".
    const already = await q(
      `select 1 from vy_fact f where f.person_id = $1 and f.name = $2
        ${agentScopePredicate("f", { agentId: "$3" })} limit 1`,
      [person, name, agentId],
    ).catch(() => []);
    if (already.length) return { ok: true, wrote: false, duplicate: true };

    // THE RE-DERIVATION GUARD, the same one opRemember runs and for the same
    // reason: a closed session sits in synced app state indefinitely, so
    // "bhool ja wo chess wali baat" would be undone by the next reconciler
    // pass on any device. A forget has to survive the thing that produced it.
    const forgotten = await q(
      `select term from meera_forget f where device_id = $1
        ${agentScopePredicate("f", { agentId: "$2" })}
        order by at desc limit ${FORGET_TERMS_CAP}`,
      [device, agentId],
    ).catch(() => []);
    const suppressed = (Array.isArray(forgotten) ? forgotten : []).map((r) => termRe(String(r.term)));
    if (suppressed.some((rx) => rx.test(summary) || rx.test(kind))) {
      return { ok: true, wrote: false, suppressed: true };
    }

    // participation 'we' BY CONSTRUCTION. An activity is the one thing in this
    // system that is definitionally shared — activity.ts's whole subject is
    // "what the two of them are DOING together" — so this is not a guess about
    // the summary's wording the way consolidate.js's WE_TOKEN_RE classifier
    // has to be for prose. The summary satisfies that regex anyway (it carries
    // "together"), so the nightly backfill agrees with this row rather than
    // fighting it.
    //
    // log_from/log_to stay NULL: they are a meera_log citation span and an
    // activity has no turns. That is also what keeps consolidate.js's
    // supersede pass — which requires both to be non-null — from ever
    // mistaking this for a provisional row it should replace.
    const ep = await q(
      `insert into vy_episode
         (agent_id, person_id, device_id, channel, participation, started_at, ended_at,
          boundary_reason, summary, provisional)
       values (${agentValue("$8")},$1,$2,$3,'we',$4,$5,$6,$7,false)
       returning id`,
      [
        person,
        device,
        "chat",
        new Date(startedAt).toISOString(),
        new Date(closedAt).toISOString(),
        "activity",
        summary,
        agentId,
      ],
    ).catch(() => []);
    if (!ep[0]) return { ok: false, wrote: false };
    const episodeId = ep[0].id;

    // The fact is what makes it RETRIEVABLE — episodes surface through the rel
    // bundle, facts through keyword and semantic recall, and a memory only one
    // of those two can reach is a memory she has on paper.
    const ins = await q(
      `insert into vy_fact
         (agent_id, person_id, kind, name, body, provenance, confidence, citations, provisional)
       values (${agentValue("$5")},$1,'user',$2,$3,'extracted',0.95,$4::bigint[],false)
       returning id`,
      // the fact BODY carries the whole summary, not a 160-char head of it.
      // The fact is what the semantic and keyword legs return, so a body
      // truncated below the summary is a memory that is complete in the
      // episode table and amputated everywhere it is actually read from —
      // and the amputation lands on the record rows, which sit at the end.
      [person, name, summary, [episodeId], agentId],
    ).catch(() => []);

    // Semantic recall, same as opRemember's provisional tier: embedding is an
    // enhancement and degrades to nothing on failure — it may never cost the
    // rows above.
    const factId = ins[0]?.id;
    if (factId) {
      const vec = await embedOne(summary).catch(() => null);
      if (vec) {
        await q(
          `insert into vy_embedding (agent_id, owner_kind, owner_id, person_id, v)
           values (${agentValue("$4")}, 'fact', $1, $2, $3::halfvec)
           on conflict (owner_kind, owner_id) do update set v = excluded.v, at = now()`,
          [factId, person, toHalfvecLiteral(vec), agentId],
        ).catch(() => {});
      }
    }
    return { ok: true, wrote: true, episodeId };
  } catch {
    // Same posture as recordPhotoMemory: this is a memory write layered on a
    // session that has already ended correctly. It may never throw into the
    // caller, and the caller is not listening anyway.
    return { ok: false, wrote: false };
  }
}

// ── forgetting ─────────────────────────────────────────────────────────────

const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Terms are ASCII in practice (node names are short lowercase labels), but
// Hinglish typed in Devanagari has no \b to anchor to, so it falls back to a
// plain containment match rather than silently never matching.
const termRe = (t) =>
  /^[\x20-\x7e]+$/.test(t) ? new RegExp(`\\b${reEsc(t)}\\b`, "i") : new RegExp(reEsc(t), "i");

const FORGET_TERMS_CAP = 200;

// THE ONE THING A FORGET DOES NOT DELETE, and why.
// The extractor does not read meera_log — it reads the last ~16 turns off the
// CLIENT, which is the conversation still sitting on their screen. So deleting
// every row about a thing and stopping there buys exactly one turn: the next
// remember pass runs over that same untouched transcript, re-derives the fact
// and inserts it again. Forgetting would be a lie with a delay.
// This table holds the WORD, per device, and nothing else — no summary, no
// feeling, no timestamp of the conversation it came from. It is never read by
// recall, never joined into a prompt, and its only consumer is the filter in
// opRemember. Scope "all" deletes it too, since a list of things they wanted
// gone is itself a record of them.
async function noteForgotten(devices, terms, agentId = MEERA_AGENT_ID) {
  const clean = [
    ...new Set(terms.map((t) => String(t || "").trim().toLowerCase()).filter((t) => t.length >= 3)),
  ].slice(0, 12);
  // The suppression list is written on EVERY device the person owns, not just
  // the one they asked from. It is what stops the extractor and the M3
  // consolidator re-deriving what the cascade just took — and a term suppressed
  // only on the web surface would be re-derived on Telegram from that surface's
  // own turns, which is the forget coming undone by the back door. The per-row
  // cap is applied per device below for the same reason it exists at all.
  for (const device of devices) {
    for (const t of clean) {
      await q(
        `insert into meera_forget (device_id, term, agent_id)
         values ($1,$2,${agentValue("$3")})
         on conflict (agent_id, device_id, lower(term)) do nothing`,
        [device, t.slice(0, 60), agentId],
      ).catch(() => {});
    }
  }
  if (!clean.length) return;
  for (const device of devices) {
    await q(
      `delete from meera_forget f where device_id = $1
         ${agentScopePredicate("f", { agentId: "$2" })}
         and id not in (
           select id from meera_forget k where device_id = $1
             ${agentScopePredicate("k", { agentId: "$2" })}
           order by at desc limit ${FORGET_TERMS_CAP})`,
      [device, agentId],
    ).catch(() => {});
  }
}

// ── the relational store: one manifest, three consumers ────────────────────
//
// Every user-data table, in one list. opForget's whole-wipe iterates it,
// api/export.js exports it, and scripts/relcheck.mjs asserts that no
// person-keyed table exists in the database that is missing from it. That
// single-source-of-truth is a SPEC requirement (§9.2): if forget and export
// each kept their own list, they would drift, and the drift would be a
// privacy defect discovered by a regulator instead of by CI.
//
// lane:
//   legacy     — device-keyed, deleted by the pre-existing scope code below
//   relational — person-keyed (SPEC §2), deleted by purgeRelational()
//   person     — the identity mapping itself, deleted last and guarded
// vy_model and vy_gate_run are deliberately absent: router roster and gate
// audit are not user data (no person_id).
//
// ── multiparty v1 (PROPOSAL-MULTIPARTY-V1 §3.3) — three additive fields ────
//
// The entry shape {table, key, lane} assumes EXACTLY ONE OWNER PER ROW AND A
// PLAIN OWNING COLUMN. Rooms break both assumptions, in two distinct ways, and
// both are closed here BEFORE any room ingestion code exists — because the
// first is a live data-deletion bug the moment a room turn is written.
//
//   `keys`       — OR over several owning columns. meera_log room turns are
//                  written under a SYNTHETIC room device uuid
//                  (vy_group.room_device_id) so the NOT NULL holds without
//                  inventing a device for a room. That uuid appears in NOBODY's
//                  vy_person_device mapping, so under the single-key manifest a
//                  person's OWN room turns would survive their OWN full wipe.
//                  Keying on speaker_person_id as well is what closes it — and
//                  it is exactly why 008a's column had to land before any
//                  ingestion: it is UNBACKFILLABLE.
//
//   `wipeWhere`  — restricts a whole-wipe to the EXCLUSIVE rows. `key` is
//                  documented in §3.3 as selecting "exclusive rows (1:1)"; a
//                  room-derived row carrying a member's person_id is held
//                  TOGETHER, and hard-deleting it on that member's wipe would
//                  erase the other participants' memory of something said in
//                  front of them. Forget deletes what only I hold; it withdraws
//                  what we hold together. Never applied to export: the row is
//                  still A's to receive, it is just not A's to destroy.
//
//   `shared`     — the join-and-withdraw spec, executed by withdrawSharedRows()
//                  below. `via`/`on`/`person` name the join table that carries
//                  the ACL; `withdraw` is what a departure does; `lastOut` is
//                  what happens when the departing person was the last one —
//                  last one out closes the door, and the row plus its full
//                  derived closure hard-deletes exactly as today.
//
// Because forget and export both read this manifest, one entry keeps both
// consumers in sync BY CONSTRUCTION. That single-source property is the entire
// reason this list exists (SPEC §9.2).
//
// vy_group, vy_group_turn and vy_group_entitlement are deliberately absent:
// none is person-keyed. A room is not a person, its turn log is the room's
// own behavioural record, and an entitlement is a financial record that must
// not vanish for the other members when one member forgets. All three die with
// their room, via vy_group's on-delete cascade, when the last participant
// leaves (§3.1.2). vy_group and vy_group_turn DO carry agent_id after 009 —
// being agent-scoped and being person-keyed are different questions.
//
// ── the agent layer (SPEC-AGENT-LAYER §2, §6) — one additive field ─────────
//
//   `agent`      — true on every relationship table migrations 009/018 gave
//                  an agent_id. It is a MARKER, not a filter: nothing in the
//                  whole-person wipe loop reads it, and it deliberately
//                  changes nothing about full-wipe behaviour.
//
// That last sentence is the whole design. A full wipe of a person deletes
// their rows across ALL agents — it is their data, not the agent's — so the
// existing wipe predicate (wipeWhereSql: the owning columns OR'd, plus
// wipeWhere) is already exactly right and must not learn about agent_id.
// G-E5's first half is the proven property (`a full person wipe leaves zero
// rows`) and it may not regress; adding a field no code path reads is the only
// way to record the scope without touching the predicate that carries it.
//
// The PER-AGENT wipe (G-E5's second half — delete one agent's rows, leave the
// other agent's intact) is NOT implemented here. It needs an extra predicate
// term and therefore an extra bound parameter, which renumbers $1..$n for the
// whole-wipe path too, and the whole-wipe path is the one that may not break.
// Deferred deliberately, with this note rather than silently: it wants its own
// change and its own test, not a shared code path with the proven one.
//
// vy_kin and vy_india_profile are agent-scoped despite looking
// person-intrinsic: "my mausi is called Bua at home" was told to SOMEONE
// (§2). vy_episode_participant is NOT marked — it is the ACL join table and
// takes its scope from the episode it points at, so an agent_id on it would be
// a second, forgeable copy of a fact the join already carries.
// ── WS-R27: the Room forget receipt's hash (migration 090) ──────────────────
//
// `vy_room_forget_receipt` is the ONE row that survives a follower's "forget
// me" in a creator's Room. It names no person — `person_hash`, never
// `person_id` — and this is the ONE function that computes it, called by both
// the writer (`api/_room-surface.js`'s `roomForget`, at forget time) and the
// eraser (`purgeRelational` below, at whole-wipe time), so the two can never
// disagree about what a person's own hash is.
//
// NOT AN HMAC, unlike `api/_replica-full-erasure.js`'s deletion receipt,
// which hashes with a per-deploy secret key precisely because THAT receipt is
// looked up later, by an operator, from a request id. This receipt is never
// looked up by anyone after the one response that carries it (WS-R27's own
// law 3 — "no later lookup by anyone: there is nothing to look it up by"), so
// a secret key would buy a property nothing here needs, at the cost of a new
// env var this workstream's own brief says not to add. `room_id` and
// `policy_version` sit in PLAIN TEXT on the receipt row for exactly this
// reason: they are what let the whole wipe RECOMPUTE this same hash for the
// person being wiped, against a table with no person_id column to filter by.
// See `context/decisions.md#ws-r27-forget-receipt-hash-recomputed-not-looked-up`
// for the reversal condition (a future consumer that DOES look a receipt up
// by hash, which would need the HMAC treatment instead).
export const ROOM_FORGET_RECEIPT_POLICY_VERSION = 1;
export function roomForgetReceiptHash(roomId, personId, policyVersion) {
  return sha256Hex(
    `vy-room-forget-receipt:v1:${String(roomId)}:${String(personId)}:${String(policyVersion)}`,
  );
}

// ── WS-R32: the whole wipe's own door onto vy_room_forget_receipt ───────────
// (closes ws-r27-whole-wipe-receipt-read-capped-at-10000)
//
// The OLD read selected straight off the receipt table itself, capped at ten
// thousand rows - bounded by RECEIPTS, so once that table passed that size a
// whole wipe silently stopped reaching older ones. It was also the wrong
// axis to bound
// on: a receipt names no person (`roomForgetReceiptHash`'s own header), so
// the only way to find "every receipt this person produced" is to compute
// what their hash WOULD be for every (room, policy version) pair and ask the
// table which of those hashes exist - which means the walk should be bounded
// by ROOMS, not by receipts. `vy_room` is owner-keyed (hundreds of rows at
// most in Phase 1, one per creator's Room) and does not grow with wipes the
// way the receipt table does, so walking it whole and letting the receipt
// table answer one indexed `= any($1)` delete is the bound that actually
// matches how this product scales. Reversal condition: once Rooms
// themselves number in the ~10,000s, THIS walk needs a different key (see
// `context/decisions.md#ws-r32-whole-wipe-receipt-sweep-bounded-by-rooms`).
//
// A person whose follower row is already gone - they forgot that Room
// earlier, leaving only the receipt - is still reached, because the walk is
// over EVERY room this database has, never over the person's own (now
// possibly deleted) follower rows. Walking "the rooms this person currently
// follows" instead would silently miss exactly this case.
//
// Extracted as its OWN function, taking an injectable `db`, for one reason:
// `purgeRelational` below calls `q` directly with no injection seam at all
// (this file is not the "thin handler over an injectable db" shape
// api/_room-surface.js is - see this function's own call site) - so nothing
// in this codebase could otherwise drive this ONE piece of logic through a
// fake db. Every other statement in `purgeRelational` keeps calling `q`
// exactly as it always has; this is the one piece that needed a seam,
// because it is the one piece a test needs to prove (evals/room-export/
// run.mjs's receipt-survivor scenario).
export async function purgeRoomForgetReceipts(db, personId) {
  const rooms = await db(`select room_id from vy_room`, []);
  const hashes = [];
  for (const { room_id } of rooms) {
    for (let v = 1; v <= ROOM_FORGET_RECEIPT_POLICY_VERSION; v++) {
      hashes.push(roomForgetReceiptHash(room_id, personId, v));
    }
  }
  if (!hashes.length) return 0;
  const gone = await db(
    `delete from vy_room_forget_receipt where person_hash = any($1::text[]) returning 1 as x`,
    [hashes],
  );
  return gone.length;
}

export const PERSON_TABLES = [
  { table: "meera_log",         key: "device_id", lane: "legacy", agent: true,
    keys: ["device_id", "speaker_person_id"] },
  { table: "meera_nodes",       key: "device_id", lane: "legacy", agent: true },
  { table: "meera_edges",       key: "device_id", lane: "legacy", agent: true },
  { table: "meera_forget",      key: "device_id", lane: "legacy", agent: true },
  { table: "meera_tel",         key: "device_id", lane: "legacy" },
  { table: "meera_tel_session", key: "device_id", lane: "legacy" },
  // The call-path audit trail. meera_tel's own schema note says telemetry "is
  // still the delete key — api/memory.js opForget purges this table on the
  // same terms it purges meera_log, which is what keeps `forget` from being a
  // lie (rule 3)"; meera_diag is the same species of table, holds a `detail`
  // jsonb that can carry turn-shaped content, and was never purged by
  // anything. Found by the widened coverage query below rather than by
  // reading — which is the argument for the widening.
  { table: "meera_diag",        key: "device_id", lane: "legacy" },
  // ── the turn trace (migration 012, docs/TRACE.md §2.4) ───────────────────
  // Filed exactly where meera_tel sits, and for the same two reasons. FORGET:
  // a person's whole wipe must take their trace with it, and meera_turn_leg
  // carries a device_id for no other purpose than being reachable by this
  // clause — a detail table its own spine could be wiped without would leave
  // rows standing after the receipt said they were gone. EXPORT: the rows are
  // about that person and contain no conversation content (every column is a
  // count, a byte length, a hash, a timing or a row id), so a DSAR that omitted
  // them would be the wrong answer rather than a kind one.
  { table: "meera_turn",        key: "device_id", lane: "legacy" },
  { table: "meera_turn_leg",    key: "device_id", lane: "legacy" },
  // ── P2-1: THE SERVER COPY OF THE CONVERSATION ITSELF ─────────────────────
  //
  // meera_state holds `syncableState(s)` — the transcript (last 400 messages),
  // `user` (his name, his city, every fact she extracted about him), herLife,
  // inner, activities, tally, momentsFired, followup. It is a second copy of
  // almost everything the graph holds plus the raw words, and it was in NO
  // manifest, NO forget path and NO export.
  //
  // How that survived review: it is not a `vy_%` table, and scripts/
  // relcheck.mjs's manifest-coverage check enumerated `table_name like
  // 'vy\_%'`. The one guard whose entire job is "a table nobody listed must
  // fail loudly" could not see this table by construction. That is the same
  // class as `engine-bundle-check-uncalled` — a guard producing false
  // confidence — and it is why the coverage query is widened in the same
  // change that adds this row (see relcheck.mjs).
  //
  // The failure it made possible is not subtle. Ask her to forget everything;
  // every row in this list is deleted and the receipt is honest about them;
  // then the signed-in client's next `load_state`, or any second device that
  // has not synced since, returns the whole conversation and `user`, and the
  // merge puts it back. The forget was true about the database and false
  // about the product.
  //
  // Keyed on device_id (the column account.js writes on every save — always
  // present, always UUID-validated) rather than on user_id, because this file
  // never sees an access token. That leaves one hole this key cannot close —
  // a row whose last writer was a DIFFERENT device of the same signed-in
  // person — and that hole is what api/account.js's `wipe_state` op exists
  // for. Filed lane "legacy" because the manifest loop only deletes lane
  // "relational"; the legacy lane is deleted by the explicit scope code in
  // opForget, which is where a scoped rewrite has to live anyway (a day-forget
  // must prune messages from the blob, not delete the whole account row).
  { table: "meera_state",       key: "device_id", lane: "legacy" },
  // Analytics rows carrying a device_id and a props document, on exactly the
  // terms docs/TELEMETRY.md rule 3 states for meera_tel one row above: "a
  // timeline of a conversation that no longer exists is still a record of that
  // conversation." Absent from the manifest for the same invisible reason
  // meera_state was.
  { table: "meera_events",      key: "device_id", lane: "legacy" },
  // ── the memory-consent ledger (task #148, migration 016) ─────────────────
  //
  // Lane "relational" rather than "legacy": the manifest loop deletes lane
  // "relational" with no further code, and there is no scoped rewrite to write
  // for this table — a day-forget has nothing to prune out of a consent row,
  // so the only verdict it needs is the whole-wipe one.
  //
  // AND THE WHOLE WIPE TAKES IT. The argument is written out at length in the
  // migration; the short form is that a device-id-keyed record of a person
  // surviving the one request whose promise is that nothing about them remains
  // would break that promise to keep evidence of a permission that no longer
  // applies to anything. The absence of a granted row IS the absence of
  // consent, and the refusal that actually stops the writes is the copy on the
  // device (src/engine/memory.ts's gate), which a server delete never touches.
  //
  // It is in a DSAR export for the reason meera_turn is: the rows are about
  // that person, contain no conversation content (a boolean, two integers and
  // two timestamps), and an export that omitted the record of what they had
  // agreed to would be the wrong answer rather than a kind one.
  { table: "meera_consent",     key: "device_id", lane: "relational" },
  { table: "vy_episode",          key: "person_id", lane: "relational", agent: true,
    // room episodes carry person_id NULL (008a), so `key` already selects only
    // the exclusive 1:1 rows; the shared spec is what handles the rest
    shared: {
      via: "vy_episode_participant",
      on: "episode_id",
      person: "person_id",
      withdraw: "delete_join_row",   // never delete the episode …
      lastOut: "delete_row",         // … unless P was the last one in it
    } },
  { table: "vy_episode_participant", key: "person_id", lane: "relational" },
  { table: "vy_taste_candidate",  key: "person_id", lane: "relational", agent: true },
  { table: "vy_visual_assertion", key: "person_id", lane: "relational", agent: true },
  { table: "vy_shared_moment",    key: "person_id", lane: "relational", agent: true },
  { table: "vy_fact",             key: "person_id", lane: "relational", agent: true,
    wipeWhere: "group_id is null" },
  { table: "vy_rel_event",        key: "person_id", lane: "relational", agent: true },
  { table: "vy_rel_state",        key: "person_id", lane: "relational", agent: true },
  { table: "vy_pattern",          key: "person_id", lane: "relational", agent: true },
  { table: "vy_phrase",           key: "person_id", lane: "relational", agent: true,
    wipeWhere: "group_id is null",
    shared: { via: "vy_episode_participant", on: "origin_episode", person: "person_id",
              withdraw: "delete_join_row", lastOut: "delete_row" } },
  { table: "vy_kin",              key: "person_id", lane: "relational", agent: true },
  { table: "vy_ritual",           key: "person_id", lane: "relational", agent: true },
  { table: "vy_currency",         key: "person_id", lane: "relational", agent: true },
  { table: "vy_india_profile",    key: "person_id", lane: "relational", agent: true },
  // ── self layer (migration 011, docs/SPEC-SELF-LAYER.md) ──────────────────
  // The three person-keyed tables of the self layer. vy_self_arc and
  // vy_agent_life are deliberately ABSENT: they are agent-scoped, not
  // person-keyed — her growth and her life are hers, and forgetting a person
  // must not delete the agent's own biography. What forget DOES remove is the
  // record of what she told THAT person (vy_agent_life_told), which is
  // relationship state and belongs to them as much as to her.
  { table: "vy_rel_texture",      key: "person_id", lane: "relational", agent: true },
  { table: "vy_observation",      key: "person_id", lane: "relational", agent: true },
  { table: "vy_agent_life_told",  key: "person_id", lane: "relational", agent: true },
  { table: "vy_embedding",        key: "person_id", lane: "relational", agent: true },
  { table: "vy_derivation",       key: "person_id", lane: "relational", agent: true },
  { table: "vy_session",          key: "person_id", lane: "relational", agent: true },
  { table: "vy_group_member",     key: "person_id", lane: "relational", agent: true,
    // a full wipe removes the membership row outright (§3.1.4); a plain
    // "leave" sets left_at instead and never deletes the room for the others
    shared: { withdraw: "set_left_at" } },
  { table: "vy_disclosure_grant", key: "granted_by", lane: "relational", agent: true,
    keys: ["granted_by", "granted_to"],
    // grantor -> delete (it was their permission to give); grantee -> remove
    // them as a recipient. granted_to is a SCALAR in 008b, so a grant with its
    // single recipient removed is an empty grant: both roles collapse to the
    // same delete, and `by_role` is that statement, not two.
    shared: { withdraw: "by_role" } },
  // RESOLUTION (WS-MPBUILD, flagged): §3.3's sketch files vy_tg_person under
  // lane "person". That lane is not merely a label — its members are skipped
  // by the manifest wipe loop and deleted by explicit guarded code below, and
  // no such code exists for this table, so lane "person" would leave a
  // person's Telegram binding standing after a full wipe. Filed as relational,
  // where the manifest loop actually deletes it.
  { table: "vy_tg_person",        key: "person_id", lane: "relational" },
  // 009's generalization of vy_tg_person (SPEC-AGENT-LAYER §4). Person-
  // intrinsic, so NO `agent: true`: identity resolution is agent-independent —
  // the same human, whoever they are talking to — and the agent enters at
  // retrieval, not at identification. Filed lane "relational" for the same
  // reason vy_tg_person is (see the note directly above): lane "person" members
  // are skipped by the manifest wipe loop and taken by explicit guarded code,
  // and no such code exists for this table, so lane "person" would leave a
  // person's surface bindings standing after their own full wipe. It is also
  // required for scripts/relcheck.mjs's manifest-coverage check, which fails
  // any person-keyed vy_* table that is absent from this list.
  { table: "vy_surface_identity", key: "person_id", lane: "relational" },
  { table: "vy_push_token", key: "device_id", lane: "relational", agent: true },
  // ── WS-R: the replica lane's PERSON side (migrations 015, 023, 027) ───────
  //
  // scripts/relcheck.mjs failed against the live database naming three of
  // these; auditing every owning column in the live schema rather than the
  // three relcheck happened to enumerate found the fourth. Every one of them
  // is keyed on a `person_id` in the SAME identity space this manifest already
  // uses, so a person who asked to be forgotten was keeping rows here — and
  // a DSAR export was returning an answer with a hole in it.
  //
  // Child before parent. The three runtime rows chain by ON DELETE CASCADE
  // (capability -> session -> turn), so deleting the capability first would
  // make the two deletes below it report zero for rows they really did remove.
  // Listing them child-first keeps the receipt's counts honest, which is the
  // only thing the ordering affects.
  //
  // vy_replica_dialogue_turn is keyed on BOTH: person_id is the speaker and
  // device_id is the handset the turn came from, and they are the same human.
  // `keys` ORs them, so a row whose person mapping was rewritten between the
  // turn and the wipe is still reached.
  { table: "vy_replica_dialogue_turn", key: "person_id", lane: "relational", agent: true,
    keys: ["person_id", "device_id"] },
  { table: "vy_replica_runtime_session", key: "person_id", lane: "relational", agent: true },
  { table: "vy_replica_runtime_capability", key: "subject_person_id", lane: "relational", agent: true },
  // The one server-written bridge between a Supabase auth identity and this
  // schema's person layer (015's own header). It is a record OF a person — it
  // is the row that says which person an account is — so a whole wipe that
  // kept it would keep the single most identifying row in the database. It
  // has ON DELETE CASCADE from vy_person, but that only fires when the person
  // row itself goes, and the wipe's guarded tail deliberately SPARES vy_person
  // when another device still maps to it. Listing it here is what closes that
  // case: the bridge dies with the wipe either way.
  { table: "vy_account_person", key: "person_id", lane: "relational" },
  // ── WS-R27 (2026-09-04): the whole Room block below is ordered CHILD
  // BEFORE PARENT, not migration-landing order any more ─────────────────────
  //
  // Every table from here down that carries a `follower_id references
  // vy_room_follower(follower_id) on delete cascade` (checkin, checkin's own
  // delivery ledger, voice usage, subscription, the Telegram pointer, push,
  // handoff) or a `thread_id references vy_room_thread(thread_id) on delete
  // cascade` (pulse_optin, handoff) is listed BEFORE `vy_room_thread`/
  // `vy_room_follower` themselves, and `vy_room_checkin_delivery` (which
  // carries `checkin_id references vy_room_checkin(checkin_id) on delete
  // cascade`) is listed before `vy_room_checkin`. This loop iterates the
  // array in order and is not `.catch()`-wrapped between statements — the
  // WS-R1 comment this block used to open with already said "child before
  // parent... listing them ahead of nothing keeps the receipt's counts
  // honest," but the array itself put `vy_room_thread`/`vy_room_follower`
  // FIRST among the Room tables, ahead of every child added by a LATER
  // workstream (077 through 085). A parent deleted before its children means
  // every child's own `delete ... returning 1 as x` finds the cascade already
  // got there first: the row really is gone, `out[t.table]` is a real zero
  // rather than a lie, but a zero that is ALWAYS the answer regardless of how
  // many rows a real forget actually removed is the exact failure WS-R27's
  // own law 2 exists to catch ("the receipt's counts must equal what was
  // deleted") — found while building that battery, not by inspection alone.
  // Fixed here by REORDERING the array (a pure move — no entry's own fields
  // changed) rather than by teaching this loop a dependency sort, so the
  // array's own literal order stays the one and only source of delete order,
  // exactly as `vy_replica_dialogue_turn`/`vy_replica_runtime_session`/
  // `vy_replica_runtime_capability` above already do it for the identical
  // reason (that block's own header: "Child before parent... deleting the
  // capability first would make the two deletes below it report zero for
  // rows they really did remove").
  //
  // The identical ordering bug existed in `api/_room-surface.js`'s
  // `roomForget` itself (its OWN explicit per-table deletes ran after its
  // own `delete from vy_room_follower`) and is fixed there in the same
  // change, by the same reasoning, restated at that file's own header.
  //
  // ── WS-R12: the cohort day-count (migration 077) ──────────────────────────
  //
  // "Did this follower have a turn on this day" is a record OF them exactly as
  // their membership row is - an id, a date and a count, but a count tied to
  // one human, and a whole wipe that kept it would leave "this person talked
  // on these dates" standing after a receipt that said nothing remains.
  //
  // NO `agent: true`, deliberately: this table carries no `agent_id` column
  // (071's convention was already scoping room_id/person_id; 077 followed it
  // and added nothing new). `agent: true` routes a table through
  // `roomScopedTables()` in api/_room-surface.js, whose generic delete
  // unconditionally appends `and agent_id = (...)::uuid` - a column this
  // table does not have, which would 500 every follower's Room forget the
  // day 077 lands. Reached instead by two OTHER, explicit paths: the
  // account-wide whole wipe below (lane "relational", no agent filter,
  // keyed on person_id alone) and `roomForget`'s own explicit
  // room_id+person_id delete. No `follower_id`/`thread_id` column either, so
  // unlike every entry below it this one has no cascade to race against and
  // its position here is only "as early as the rest of the block allows,"
  // not load-bearing the way the others' positions are.
  { table: "vy_room_follower_day", key: "person_id", lane: "relational" },
  // ── WS-R16: check-ins, PERSON side (migration 079) ────────────────────────
  //
  // A follower's own schedule against a creator's check-in design, and the
  // content-free delivery ledger behind it, are records OF them in the
  // identical sense the day-count table one entry above is - an id, a
  // schedule or a date, a state, never a word. NO `agent: true` on either,
  // `vy_room_follower_day`'s own reason restated: neither table carries an
  // `agent_id` column (agent context is joined from vy_room, which is how the
  // sweep itself reaches it), so routing either through `roomScopedTables()`'s
  // generic delete - which unconditionally appends "and agent_id =
  // (...)::uuid" - would 500 every follower's Room forget the day this
  // migration lands. Reached instead by the same two explicit paths as their
  // sibling: the whole-account wipe (this file's `purgeRelational`, lane
  // "relational", no further code) and `roomForget`'s own explicit
  // room_id+person_id delete, added there in the same change as this entry.
  //
  // `vy_room_checkin_delivery` BEFORE `vy_room_checkin` (WS-R27): the
  // delivery ledger carries `checkin_id references vy_room_checkin(checkin_id)
  // on delete cascade`, so deleting the checkin row first would cascade the
  // delivery rows away before this loop's own delivery statement ever runs -
  // this block's own new header names the general rule this is an instance of.
  { table: "vy_room_checkin_delivery", key: "person_id", lane: "relational" },
  { table: "vy_room_checkin", key: "person_id", lane: "relational" },
  // ── WS-R19: the Room's voice usage, PERSON side (migration 081) ──────────
  //
  // "How many seconds of voice this follower spent, on this day" is a record
  // OF them exactly as the turn day-count above is - an id, a date, two
  // counts, never a byte of what was said or how it sounded. Same reasoning
  // as `vy_room_follower_day` one migration over, restated rather than
  // re-derived: NO `agent: true` (this table carries no `agent_id` column
  // either), so it is invisible to `roomScopedTables()`'s generic per-agent
  // loop and reached instead by the account-wide whole wipe below (lane
  // "relational", no agent filter, keyed on person_id alone) and
  // `roomForget`'s own explicit room_id+person_id delete. Carries
  // `follower_id references vy_room_follower(follower_id) on delete cascade`
  // (migration 081), so it is listed before `vy_room_follower`, this block's
  // own header rule.
  { table: "vy_room_voice_usage", key: "person_id", lane: "relational" },
  // ── WS-R11: the Room's money, PERSON side (migration 078) ────────────────
  //
  // A follower's subscription genuinely is a record OF that person - it is
  // exactly the shape of thing this manifest exists to find - so it is
  // listed rather than exempted, honestly satisfying scripts/relcheck.mjs's
  // manifest-coverage check rather than dodging it on a technicality.
  //
  // NOT `agent: true`: the table carries no agent_id column (a subscription
  // is not agent-scoped memory), so it is invisible to
  // api/_room-surface.js's `roomScopedTables()` (filtered on `agent === true`).
  // WS-R27 gives `roomForget` its OWN explicit statement for this table too,
  // restricted by the SAME `wipeWhere` below - forgetting what an AI
  // remembers about you is not the same request as forgetting that you owe,
  // or paid, money, so only a subscription already in a terminal state is
  // reachable from the Room's own narrow "forget me" button, exactly as from
  // the account-wide one. It is ALSO reached by the account-wide "forget
  // everything" pass (this file's `purgeRelational`, lane "relational", no
  // further code needed - the same door `meera_consent` goes through for the
  // identical reason: "the absence of a row is the absence of the
  // relationship").
  //
  // `wipeWhere` is the one restriction, and it is load-bearing rather than
  // decorative: a UPI Autopay mandate keeps debiting a real bank account
  // whether or not this table still names it, so neither wipe may ever
  // remove a subscription that has not ALREADY reached a terminal state
  // ('cancelled'/'expired'). A live one survives either wipe's OWN explicit
  // statement as the one honest local record that a mandate may still be
  // charging someone who asked this platform to forget them - api/
  // _room-surface.js's "a predicate on the write is a guarantee" discipline
  // applied to money instead of a message cap.
  //
  // What NEITHER wipe's own statement can prevent, discovered rather than
  // designed (WS-R27, context/decisions.md#ws-r27-subscription-cascade-still-
  // reaches-a-live-row): `vy_room_subscription.follower_id` itself carries
  // `references vy_room_follower(follower_id) on delete cascade` (078's own
  // DDL), so the moment ANYTHING deletes the follower row - including this
  // very manifest loop's own `vy_room_follower` entry below, or
  // `roomForget`'s identical statement - Postgres removes every subscription
  // row for that follower by cascade regardless of `state`, live one
  // included. This entry's `wipeWhere` restricts what THIS statement
  // deletes; it cannot restrict what the schema's own FK does two statements
  // later. Closing that (changing the FK to RESTRICT or SET NULL, forcing a
  // provider-cancel step before a live follower's row can go) is Phase 1
  // work and an owner decision, not this migration's - named here rather
  // than silently left for the next person to rediscover.
  { table: "vy_room_subscription", key: "person_id", lane: "relational",
    wipeWhere: "state in ('cancelled','expired')" },
  // ── WS-R17: Pulse's own toggle (migration 080) ────────────────────────────
  //
  // A follower's own opt-in decision - content-free (no column here could
  // ever hold what they said, migration 080's own header), but it is a
  // record OF that person, exactly this manifest's own bar. No `wipeWhere`:
  // unlike `vy_room_subscription` immediately above, a stale opt-in poses no
  // live-mandate-shaped risk a whole-account wipe should spare, so a full
  // delete regardless of `revoked_at` is the honest answer.
  //
  // NOT `agent: true`: this table carries no `agent_id` column (071's
  // convention was already scoping room_id/person_id; 080 followed it and
  // added nothing new, the identical reasoning `vy_room_follower_day` states
  // several entries up). Reached instead by two OTHER, explicit paths: the
  // account-wide whole wipe below (lane "relational", no agent filter, keyed
  // on person_id alone) and `roomForget`'s own explicit room_id+person_id
  // delete. Carries a nullable `thread_id references vy_room_thread(thread_id)
  // on delete cascade`, so a thread-scoped opt-in is listed (and thus
  // deleted) before `vy_room_thread`, this block's own header rule - a
  // Room-scoped opt-in (`thread_id is null`) has no such dependency, but the
  // rule is simplest applied to the whole entry rather than split by row.
  { table: "vy_room_pulse_optin", key: "person_id", lane: "relational" },
  // ── WS-R18: which room a Telegram chat currently means (migration 082) ───
  //
  // A pointer, not a subscription list - it names one room for one Telegram
  // chat, never a follower's whole Telegram history. NOT `agent: true`: the
  // table carries no agent_id column (db/migrations/082's own header), so it
  // is invisible to api/_room-surface.js's `roomScopedTables()` on purpose,
  // exactly the reasoning `vy_room_follower_day`/`vy_room_subscription` give
  // above. Carries `follower_id references vy_room_follower(follower_id) on
  // delete cascade` (082's own DDL), so it is listed before `vy_room_follower`
  // - WS-R27 also gives `roomForget` its own explicit, BY-NAME delete for
  // this table (previously left to the cascade alone, which meant a real
  // deletion happened but the receipt never counted it - the same class of
  // gap this whole block's header names). Reached by the account-wide whole
  // wipe through the "relational" lane alone too.
  { table: "vy_room_follower_channel", key: "person_id", lane: "relational" },
  // ── WS-R22: a follower's own web push subscription (migration 085) ───────
  //
  // An endpoint URL and two keys - a browser's own address for this device,
  // not a word the follower said. NOT `agent: true`: the table carries no
  // `agent_id` column (`vy_room_follower_channel`'s own precedent one row
  // above), so it is invisible to `roomScopedTables()`'s generic per-agent
  // loop on purpose. Carries `follower_id references vy_room_follower
  // (follower_id) on delete cascade`, so it is listed before `vy_room_follower`
  // - WS-R27 gives `roomForget` its own explicit, BY-NAME delete for this
  // table too, `vy_room_follower_channel`'s exact reasoning restated one row
  // over. Reached by the account-wide whole wipe through the "relational"
  // lane alone.
  { table: "vy_room_push_subscription", key: "person_id", lane: "relational" },
  // ── WS-R29: check-ins over WhatsApp utility templates (migration 092) ────
  //
  // A destination (a phone number) and a state, never a word the follower
  // said - `vy_room_push_subscription`'s exact reasoning restated for a
  // phone number instead of a push endpoint. NOT `agent: true`: no
  // `agent_id` column (agent context is joined from `vy_room`, the sweep's
  // own reasoning restated a further time in this same block). Carries
  // `follower_id references vy_room_follower(follower_id) on delete
  // cascade`, so it is listed before `vy_room_follower`; `api/_room-
  // surface.js`'s `roomForget` gives it its own explicit, BY-NAME delete too
  // (WS-R27's own lesson applied on arrival rather than found later: a row
  // reached only by cascade is a row deleted but never counted). Reached by
  // the account-wide whole wipe through the "relational" lane alone.
  { table: "vy_room_follower_whatsapp", key: "person_id", lane: "relational" },
  // ── Handoff (WS-R20; migration 083) ──
  //
  // A follower's own verbatim ask and the creator's own verbatim reply to
  // it - unlike every Room table above, this one DOES hold words, and 083's
  // own header names that as a deliberate, narrow exception to 071's "never
  // a word" law rather than a violation of it. It is still reached the
  // identical way its content-free siblings are: NOT `agent: true` (no
  // `agent_id` column - agent context is joined from vy_room, the sweep's
  // own reasoning restated a sixth time), the account-wide whole wipe below
  // (lane "relational") and `roomForget`'s own explicit room_id+person_id
  // delete are the only two doors. Carries BOTH `follower_id references
  // vy_room_follower(follower_id) on delete cascade` AND a nullable
  // `thread_id references vy_room_thread(thread_id) on delete cascade`, so it
  // is listed before BOTH `vy_room_thread` and `vy_room_follower` - this was
  // the clearest instance of the ordering bug this block's own header
  // describes: `roomForget`'s own handoff delete existed from 083 onward but
  // ran AFTER its follower delete, so it always reported zero regardless of
  // how many rows the cascade had really just removed.
  { table: "vy_room_handoff", key: "person_id", lane: "relational" },
  // ── WS-R30: the upgrade-offer ledger (migration 093) ──────────────────────
  //
  // Content-free (`reason`/`outcome` are both closed enums, never a word the
  // follower typed), but a record OF that person exactly this manifest's own
  // bar - `vy_room_subscription`'s reasoning several rows up, restated for a
  // ledger instead of a mandate. NOT `agent: true`: no `agent_id` column
  // (agent context is joined from `vy_room`, the sweep's own reasoning
  // restated a seventh time). Carries `follower_id references
  // vy_room_follower(follower_id) on delete cascade`, so it is listed before
  // `vy_room_follower` below - `roomForget`'s own explicit room_id+person_id
  // delete gives it the identical, named, counted statement its siblings
  // above have, from the start, rather than repeating the child-before-
  // parent ordering bug WS-R27 found and fixed for them.
  { table: "vy_room_upgrade_offer", key: "person_id", lane: "relational" },
  // ── WS-R37: the renewal reminder ledger (migration 099) ───────────────────
  //
  // ONE table, THREE subject kinds (`api/_renewals.js`'s own header): a
  // follower's own reminder history is a record of THIS manifest's bar, a
  // creator's is owner lane (reached BY NAME in
  // api/_replica-full-erasure.js, never here), and a Suite's is reached only
  // by cascade from `vy_org` (`vy_org_subscription`'s own 091 precedent). So
  // `wipeWhere` restricts this entry to `subject_kind = 'follower'` -
  // `vy_room_subscription`'s own `wipeWhere` shape several rows up, applied
  // to a subject lane instead of a subscription state - which is what makes
  // this ONE manifest entry correct for a table that also holds rows this
  // entry must never touch (person_id is null on every creator/org row
  // anyway, so the restriction is defense in depth as much as it is
  // documentation). Content-free (subject_kind, period_end, channel,
  // sent_at, a short failure code - never a word the follower typed), but a
  // record of when this creator's AI reminded THIS follower about their own
  // subscription. Carries BOTH `room_id references vy_room(room_id) on
  // delete cascade` AND `follower_id references vy_room_follower
  // (follower_id) on delete cascade`, 078's own double-FK shape, so it is
  // listed before `vy_room_follower` below - `roomForget`'s own explicit
  // room_id+person_id delete gives it the same named, counted statement its
  // siblings above have, from the start.
  { table: "vy_renewal_reminder", key: "person_id", lane: "relational", wipeWhere: "subject_kind = 'follower'" },
  // ── WS-R67: the follower's own copy of every reply they flagged (migration
  // 116) ─────────────────────────────────────────────────────────────────
  //
  // Which reply (by hash), which reason, when - never a word this follower
  // typed. Carries `follower_id references vy_room_follower(follower_id) on
  // delete cascade`, `vy_room_upgrade_offer`'s own shape restated, so it is
  // listed here, ahead of `vy_room_follower` below. The CREATOR's mirror
  // (`vy_room_reply_flag`) is deliberately ABSENT from this manifest: it
  // names no person at all (migration 116's own header - no follower_id, no
  // person_id, no thread reference of any kind), so it is reached only by
  // room_id in api/_replica-full-erasure.js's owner-wide cascade, never
  // through a person's own wipe.
  { table: "vy_room_follower_reply_flag", key: "person_id", lane: "relational" },
  // ── WS-R1: the Room's PERSON side (migration 071), moved LAST among the
  // Room's relational-lane entries by WS-R27 (see this block's own header) ──
  //
  // A follower's membership of a creator's Room, and the names they gave their
  // own topic threads. Neither holds a word anybody said (071's content law
  // restates 012's), and both are still unambiguously records OF that person:
  // the membership says they joined this creator's room and answered the
  // memory question, the thread titles are nouns they typed. A whole wipe that
  // kept either would leave "this human follows Anjali and calls one of their
  // threads `injury`" standing after a receipt that said nothing remains.
  //
  // The ROOM itself (vy_room) is deliberately not here. It is owner-keyed with
  // no person column, so it is the owner lane, and a manifest loop deleting it
  // on one follower's request would take a creator's room away from everyone
  // else in it. Its erasure is api/_replica-full-erasure.js's, which also
  // deletes these two by agent_id - the same rows, reached from the other side,
  // which is the house rule for a harm the next turn does not undo.
  //
  // `vy_room_thread` before `vy_room_follower`: `vy_room_thread` is itself a
  // PARENT other entries above (`vy_room_pulse_optin`, `vy_room_handoff`)
  // must be listed and deleted ahead of, and `vy_room_follower` is the ROOT
  // every OTHER Room child in this whole block cascades from - so it is the
  // very last relational-lane Room entry in the array, deliberately.
  { table: "vy_room_thread",   key: "person_id", lane: "relational", agent: true },
  { table: "vy_room_follower", key: "person_id", lane: "relational", agent: true },
  { table: "vy_person_device",  key: "device_id", lane: "person" },
  { table: "vy_person",         key: "person_id", lane: "person" },
];

// ── WHAT IS DELIBERATELY NOT IN THE LIST ABOVE ─────────────────────────────
//
// 48 tables in the live schema carry `owner_user_id`, and none of them is
// here. That is a decision, not an oversight, and this is where it is written
// down (scripts/relcheck.mjs holds the machine-checked half).
//
// `owner_user_id` is a Supabase AUTH id: the expert who owns a replica. It is
// a natural person, so the instinct is to add all 48 and be done. That would
// make erasure WEAKER, not stronger. The replica lane's rows are the only
// pointers this system has to objects that live OUTSIDE Postgres — the
// provider Personal Voice, the private-bucket originals and derivatives, the
// Azure face sessions. docs/REPLICA-ERASURE.md's chain deletes those FIRST and
// the rows LAST, precisely because a row deleted early is an object nobody can
// find again. A manifest loop issuing `delete from vy_replica_source` would
// strand a person's biometric audio in object storage while the receipt said
// it was gone: the worst possible outcome of a deletion request.
//
// So the owner lane is erased by its own named path, and the check that it
// really is covered lives in relcheck.mjs as a walk of the live FK graph —
// 44 of the 48 fall out of `delete from vy_replica` by ON DELETE CASCADE, and
// the other four are named explicitly in api/_replica-full-erasure.js. An
// owner-lane table reachable by neither fails that gate.
//
// The reversal condition: if a teacher-facing "delete my account" ever needs
// to erase an owner across replicas, it gets its own op that CALLS the erasure
// job per replica. It does not get a row in PERSON_TABLES.

/** The owning columns of a manifest entry, always as an array. `key` stays the
 *  primary one so every existing consumer keeps working unchanged; `keys` is
 *  the multi-owner extension (§3.3). One helper, so forget and export can
 *  never disagree about what "owns" a row. */
export function keysOf(t) {
  return t.keys && t.keys.length ? t.keys : [t.key];
}

// ── migration-008 readiness ────────────────────────────────────────────────
//
// The multiparty entries above name tables and columns that only exist once
// migration 008 is applied, and NOTHING in the forget cascade is
// .catch()-swallowed on purpose: the receipt may only be sent once the delete
// actually happened, so a failed statement must fail the whole op loudly. On a
// database where 008 has not landed yet, that would turn every whole-wipe into
// a hard error over rows that cannot exist.
//
// So the manifest is filtered by one probe. This is NOT a silent skip: on a
// pre-008 database there are no rooms, no participants and no grants, so the
// skipped work is provably empty — the guard removes an availability failure
// without removing any deletion. Probed once per process and cached; a fresh
// serverless invocation re-probes, so the guard self-clears the moment the
// migration lands, with no deploy.
let _mpApplied = null;
export async function multipartyApplied(t = (name) => name) {
  const table = t("vy_episode_participant");
  // the cache is for the production name only; a caller passing a resolver is
  // asking about some other namespace and gets a fresh probe
  if (table === "vy_episode_participant" && _mpApplied !== null) return _mpApplied;
  const r = await q(`select to_regclass($1) is not null as present`, [`public.${table}`]).catch(() => []);
  const present = r[0]?.present === true;
  if (table === "vy_episode_participant") _mpApplied = present;
  return present;
}

/** PERSON_TABLES as it applies to THIS database, plus the owning columns each
 *  entry may actually be keyed on. One place, so forget and export cannot
 *  drift about which tables exist. */
export async function activePersonTables() {
  const on = await multipartyApplied();
  const consent = await tableApplied("meera_consent");
  // WS-R: the same per-table guard meera_consent already gets, for the replica
  // lane's four person-keyed tables. They arrive with migrations 015/023/027,
  // and the manifest loop's delete is not wrapped in a catch on purpose — the
  // receipt may only be sent once the delete actually happened. A manifest
  // naming a table this database does not have yet would turn every whole wipe
  // into a 500 for a deploy-ordering reason. Provably lossless, same argument
  // as 008's and 016's: a table that does not exist holds no rows.
  const gated = await Promise.all(
    REPLICA_PERSON_TABLES.map(async (n) => [n, await tableApplied(n)]),
  );
  const absent = new Set(gated.filter(([, present]) => !present).map(([n]) => n));
  return PERSON_TABLES.filter(
    (t) =>
      (!MP_TABLES.has(t.table) || on) &&
      (t.table !== "meera_consent" || consent) &&
      !absent.has(t.table),
  ).map((t) =>
    // `keys` and `wipeWhere` both name COLUMNS 008 adds (speaker_person_id,
    // group_id), so on a pre-008 database they are dropped along with the
    // tables. Lossless for the same reason: with no rooms there are no shared
    // rows for the restriction to spare and no room turns for the extra key to
    // find, so the wipe takes exactly what it takes today.
    on ? t : { ...t, keys: undefined, wipeWhere: undefined },
  );
}

// ── the same guard, generalised for ONE table (task #148, migration 016) ────
//
// meera_consent is in the manifest the day the code is written and in the
// database the day the owner applies 016, and those are not the same day. The
// manifest loop's delete is not wrapped in a catch, so a manifest naming a
// table that does not exist yet turns "make her forget you" into a 500 — the
// one operation that must never fail for a deploy-ordering reason. Migration
// 008 already has this exact shape of problem and this exact shape of answer
// (`multipartyApplied` above); this is that answer for a single table, which
// is all 016 needs, and the skipped work is provably empty for the same reason
// theirs is: a table that does not exist holds no rows to delete or export.
//
// Probed once per process and cached per name; a fresh serverless invocation
// re-probes, so the guard self-clears the moment the migration lands, with no
// deploy.
const _applied = new Map();
export async function tableApplied(name) {
  if (_applied.has(name)) return _applied.get(name);
  const r = await q(`select to_regclass($1) is not null as present`, [`public.${name}`]).catch(
    () => [],
  );
  const present = r[0]?.present === true;
  _applied.set(name, present);
  return present;
}

/** The manifest entries that arrive with a migration LATER than the ones a
 *  given database may have applied, gated per table exactly as meera_consent is
 *  on 016. Named here so the guard cannot drift from the list it guards.
 *
 *  The replica lane's four arrive with 015 / 023 / 027. The Room's two arrive
 *  with 071, and its third (the cohort day-count) with 077 - all three are on
 *  this list for the identical reason rather than a similar one: the wipe
 *  loop's delete is NOT catch-wrapped on purpose (the receipt may only be
 *  sent once the delete actually happened), so a manifest naming a table this
 *  database has not got yet turns "make it forget me" into a 500 for a
 *  deploy-ordering reason. Provably lossless in both cases: a table that does
 *  not exist holds no rows. */
export const REPLICA_PERSON_TABLES = [
  "vy_replica_dialogue_turn",
  "vy_replica_runtime_session",
  "vy_replica_runtime_capability",
  "vy_account_person",
  "vy_room_thread",
  "vy_room_follower",
  "vy_room_follower_day",
  // Arrives with 078 (WS-R11), on the identical reasoning.
  "vy_room_subscription",
  // Arrive with 079 (WS-R16), on the identical reasoning.
  "vy_room_checkin",
  "vy_room_checkin_delivery",
  // Arrives with 080 (WS-R17), on the identical reasoning.
  "vy_room_pulse_optin",
  // Arrives with 082 (WS-R18), on the identical reasoning.
  "vy_room_follower_channel",
  // Arrives with 081 (WS-R19), on the identical reasoning.
  "vy_room_voice_usage",
  // Arrives with 085 (WS-R22), on the identical reasoning.
  "vy_room_push_subscription",
  // Arrives with 083 (WS-R20), on the identical reasoning.
  "vy_room_handoff",
  // Arrives with 093 (WS-R30), on the identical reasoning.
  "vy_room_upgrade_offer",
  // Arrives with 099 (WS-R37), on the identical reasoning.
  "vy_renewal_reminder",
  // Arrives with 116 (WS-R67), on the identical reasoning.
  "vy_room_follower_reply_flag",
];

// tables and columns that migration 008 introduces
const MP_TABLES = new Set([
  "vy_episode_participant",
  "vy_group_member",
  "vy_disclosure_grant",
  "vy_tg_person",
]);

/** `where` fragment for a manifest-driven WHOLE WIPE: the owning columns
 *  OR'd together, plus the entry's exclusive-rows restriction if it has one.
 *  Params are $1..$n in `keysOf` order. Forget only — export must not apply
 *  `wipeWhere` (see the manifest header). */
export function wipeWhereSql(t, { deviceSet = false } = {}) {
  const cols = keysOf(t)
    .map((k, i) => ownerEq(k, `$${i + 1}`, deviceSet))
    .join(" or ");
  return t.wipeWhere ? `(${cols}) and ${t.wipeWhere}` : `(${cols})`;
}

/** One owning column compared to one param. `deviceSet` is what makes a forget
 *  reach the whole PERSON rather than the one surface they happened to ask
 *  from (`personDeviceSet`): the device column takes an id ARRAY and every
 *  other owning column stays scalar, because only `device_id` is minted per
 *  surface. Off by default so `export.js` and the evals that share this
 *  generator emit exactly the SQL they always did. */
export function ownerEq(col, param, deviceSet = false) {
  return col === "device_id" && deviceSet ? `${col} = any(${param}::uuid[])` : `${col} = ${param}`;
}

/** Values for wipeWhereSql's params: device for device-keyed columns, person
 *  for everything else — the same rule api/export.js has always used, stated
 *  once instead of inline twice. */
export function wipeParams(t, { device, person }) {
  return keysOf(t).map((k) => (k === "device_id" ? device : person));
}

/** Device → person through the 001 mapping; an unmapped device IS its person
 *  (person_id := device_id cast, §2.1 — one code path for anonymous). */
export async function personIdFor(device) {
  const r = await q(`select person_id from vy_person_device where device_id = $1`, [device]).catch(
    () => [],
  );
  return r[0]?.person_id || device;
}

/** Every device the same human owns, this one first.
 *
 *  `api/_surface.js` §4: memory is never keyed by surface. `bindSurfaceDmDevice`
 *  mints a device PER SURFACE, so the legacy graph tables — which key on
 *  `device_id` — hold one human's memory under several ids. The read path was
 *  widened to the person in WS-O; the FORGET path was not, and a whole wipe on
 *  the web left the Telegram rows standing (`legacy-forget-is-device-scoped`).
 *  This is the resolver both halves needed: opForget resolves the set ONCE and
 *  every legacy-lane statement takes `device_id = any($n::uuid[])` over it.
 *
 *  Three properties this shape has, and each is load-bearing:
 *
 *  1. ABSENT BY DEFAULT. A person with one device (and an unmapped device,
 *     which IS its own person by §2.1) resolves to `[device]`, so every
 *     statement is byte-identical to what it was before this existed. The
 *     widening cannot change a single-surface forget in any way.
 *  2. GROUP ROOMS CANNOT BE REACHED. A room turn is written under
 *     `vy_group.room_device_id`, a synthetic uuid that (PERSON_TABLES' own
 *     note) appears in NOBODY's `vy_person_device` mapping. The set is built
 *     from that mapping, so a room device is not in it and a personal forget
 *     structurally cannot delete a room's shared history. No predicate is
 *     re-implemented here to achieve that; the join simply does not contain
 *     those rows.
 *  3. FAILS CLOSED, NARROW. If the mapping read throws, the set degrades to
 *     `[device]` — today's behaviour — rather than widening a DELETE on a
 *     result nobody could verify. For forget, the safe failure is deleting
 *     LESS than asked and saying so in the receipt, never more.
 *
 *  The cap is a safety rail, not a product limit: a human with more than 64
 *  bound devices is a bug or an attack, and either way an unbounded id list
 *  should not be pasted into a delete.
 */
export async function personDeviceSet(device) {
  const person = await personIdFor(device);
  const rows = await q(
    `select device_id from vy_person_device where person_id = $1::uuid limit 64`,
    [person],
  ).catch(() => []);
  return [...new Set([device, ...rows.map((r) => r.device_id).filter(Boolean)])];
}

// ── forget cascade v2 (SPEC §9.1, steps 2–6) ───────────────────────────────
//
// The legacy deletes above this point handle meera_log and the graph; this
// handles everything DERIVED from them. Order and mechanism are the spec's:
//
//   2. episodes die by LOG-RANGE INTERSECTION with the deleted meera_log
//      rows (D's mechanism — no term-matching gap). Term/window matches are
//      an ADDITIONAL net only, never the primary mechanism (§0.2.4).
//      visual_assertions and shared_moments go with their episode (FK).
//   3. citation-join: everything whose citations && the dead episode ids
//      dies over the GIN indexes — facts, rel events, patterns, kin,
//      currency, rituals. Patterns are deleted whole, never trimmed: a
//      pattern that cited a forgotten episode took too much of its shape
//      from it, and taking too much is the safe direction.
//   4. lineage chase: superseded_by chains die in BOTH directions — a
//      summary of a forgotten thing is still a memory of it; so are the
//      beliefs it superseded.
//   5. vy_rel_state is rebuilt by REPLAYING surviving rel events — register
//      and trust legitimately regress after a forget. Honesty, not a bug.
//   6. embeddings die with their owners; legacy-quarantined rows are
//      over-deleted on any plausibly-covering scope.
//
// Nothing here is .catch()-swallowed: the receipt ("haan, hata diya") may
// only be sent once the delete actually happened, so a failed cascade must
// fail the whole op, loudly, and the client keeps the forget pending.
// ── multi-owner forget: WITHDRAW, not delete (PROPOSAL-MULTIPARTY-V1 §3) ───
//
//   Forget deletes what only I hold.
//   Forget withdraws what we hold together.
//   Forget never deletes what only you hold.
//
// The payoff of the §2.1 primitive lands here: because disclosure is a LIVE
// JOIN over vy_episode_participant, dropping P's participant row stops the
// content surfacing to P on the very next retrieval, and NO DERIVED-ROW
// CASCADE STEP IS NEEDED AT ALL. There is nothing to chase, which is also
// what makes this provable rather than merely careful.
//
// The one thing that is NOT withdraw-only is the last participant: when the
// person leaving was the last one in a shared episode, the episode and its
// full derived closure hard-delete exactly as today. Last one out closes the
// door. The closure is deleted BEFORE the episodes it cites, not after, so no
// intermediate state ever has a dangling citation for relcheck to find (there
// are no transactions across q() calls — every statement must leave a
// consistent-enough state on its own).
//
// Ruling B, pre-disclosed rather than discovered: a shared episode persists
// until N-1 participants have withdrawn. That is correct — nobody should
// unilaterally erase someone else's memory — and it WILL read as a broken
// promise to someone who asked her to forget and later finds she still knows.
// The room card says so before the room's first episode is recorded (§6.3),
// and the receipt says it again at the moment of the partial delete (§3.4).
// Reusing the 1:1 "haan, hata diya" here would be a trust violation of the
// same shape as `silent-truncation`.
//
// `t` is a table-name resolver, defaulting to identity. Production never passes
// it. `agentId` is optional by design: a room's `/bhool` supplies the current
// clone and withdraws only from that relationship; the full-person wipe omits
// it and still withdraws the person from every agent before erasing identity.
// evals/mp/withdraw.mjs passes the fixture-namespace prefixer, so THIS
// function — not a re-implementation of it — is what the withdraw suite proves
// against the real Postgres. The same reason api/_disclosure.js takes a bind
// map: a cascade tested through a copy is a copy that was tested.
export async function withdrawSharedRows(
  person,
  { dropAuthoredRoomTurns = true, t = (name) => name, agentId = null } = {},
) {
  const out = {
    participant_rows: 0, room_turns: 0, grants: 0, memberships: 0,
    episodes_closed: 0, facts_closed: 0, phrases_closed: 0, embeddings_closed: 0,
  };
  // Nothing shared can exist before migration 008 exists. Reported, not
  // silent: a skipped step that reads like a completed one is exactly the
  // shape of failure the receipt discipline is built against.
  if (!(await multipartyApplied(t))) {
    out.skipped = "migration-008-not-applied";
    return out;
  }

  // 1. leave the ACL. P can no longer be disclosed TO, and can no longer be
  //    attributed as someone who witnessed it, from the next retrieval on.
  const left = agentId
    ? await q(
        `delete from ${t("vy_episode_participant")} p
          using ${t("vy_episode")} e
          where p.person_id = $1 and p.episode_id = e.id and e.agent_id = $2::uuid
          returning p.episode_id`,
        [person, agentId],
        30_000,
      )
    : await q(
        `delete from ${t("vy_episode_participant")} where person_id = $1 returning episode_id`,
        [person],
        30_000,
      );
  out.participant_rows = left.length;

  // 2. P's OWN authored room turns — never her replies to the room, never
  //    another member's rows. This is the statement 008a's speaker_person_id
  //    exists for; without it "delete my turns, leave theirs and hers" is not
  //    implementable at row level.
  if (dropAuthoredRoomTurns) {
    const turns = await q(
      `delete from ${t("meera_log")} where speaker_person_id = $1 and group_id is not null
        ${agentId ? "and agent_id = $2::uuid" : ""} returning id`,
      agentId ? [person, agentId] : [person],
      30_000,
    );
    out.room_turns = turns.length;
  }

  // 3. last one out. Only episodes P actually just left are candidates, and
  //    only shared ones — a 1:1 episode is the manifest's business, not this
  //    function's.
  const epIds = [...new Set(left.map((r) => r.episode_id))];
  if (epIds.length) {
    const orphan = await q(
      `select e.id from ${t("vy_episode")} e
        where e.id = any($1::bigint[]) and e.group_id is not null
          ${agentId ? "and e.agent_id = $2::uuid" : ""}
          and not exists (select 1 from ${t("vy_episode_participant")} p where p.episode_id = e.id)`,
      agentId ? [epIds, agentId] : [epIds],
      30_000,
    );
    const dead = orphan.map((r) => r.id);
    if (dead.length) {
      // derived closure FIRST (no dangling-citation window), episodes last
      const facts = await q(
        `delete from ${t("vy_fact")} where citations && $1::bigint[]
          ${agentId ? "and agent_id = $2::uuid" : ""} returning id`,
        agentId ? [dead, agentId] : [dead],
        30_000,
      );
      out.facts_closed = facts.length;
      const phrases = await q(
        `delete from ${t("vy_phrase")} where origin_episode = any($1::bigint[])
          ${agentId ? "and agent_id = $2::uuid" : ""} returning id`,
        agentId ? [dead, agentId] : [dead],
        30_000,
      );
      out.phrases_closed = phrases.length;
      const embs = await q(
        `delete from ${t("vy_embedding")}
          where ((owner_kind = 'episode' and owner_id = any($1::bigint[]))
             or (owner_kind = 'fact'    and owner_id = any($2::bigint[])))
             ${agentId ? "and agent_id = $3::uuid" : ""} returning 1 as x`,
        agentId ? [dead, facts.map((r) => r.id), agentId] : [dead, facts.map((r) => r.id)],
        30_000,
      );
      out.embeddings_closed = embs.length;
      // FK cascade takes the remaining participant rows, visual assertions and
      // shared moments; vy_group_turn.episode_id is `on delete set null`, so
      // the turn-level action log survives the episode it described — silence
      // and speech are the room's own behavioural record, not the episode's.
      const eps = await q(
        `delete from ${t("vy_episode")} where id = any($1::bigint[])
          ${agentId ? "and agent_id = $2::uuid" : ""} returning id`,
        agentId ? [dead, agentId] : [dead],
        30_000,
      );
      out.episodes_closed = eps.length;
    }
  }

  // 4. grants: the grantor's permission was theirs to give and dies with them;
  //    the grantee stops being a recipient, and granted_to is scalar, so both
  //    roles are the same delete (see the manifest's `by_role` note).
  const grants = await q(
    `delete from ${t("vy_disclosure_grant")}
      where (granted_by = $1 or granted_to = $1)
      ${agentId ? "and agent_id = $2::uuid" : ""} returning id`,
    agentId ? [person, agentId] : [person],
    30_000,
  );
  out.grants = grants.length;

  // 5. membership: leaving never deletes the room for the others. A full wipe
  //    then removes the row itself through the manifest loop; orphaned-room
  //    cleanup is a nightly sweep on the pattern of the zero-orphan sweep,
  //    deliberately not inline here.
  const mem = await q(
    `update ${t("vy_group_member")} set left_at = now()
      where person_id = $1 and left_at is null
      ${agentId ? "and agent_id = $2::uuid" : ""} returning group_id`,
    agentId ? [person, agentId] : [person],
    30_000,
  );
  out.memberships = mem.length;

  return out;
}

async function purgeRelational(devices, scope, { logIds = [], rx = null, from = NaN, to = NaN } = {}) {
  // The relational store is person-keyed (SPEC §2), so most of this function
  // never saw a device at all. The exceptions are the manifest rows that carry
  // a `device_id` owning column and the identity mapping itself — both below,
  // both widened to the person's whole device set.
  const person = await personIdFor(devices[0]);
  const out = {
    episodes: 0, facts: 0, rel_events: 0, patterns: 0, kin: 0, currency: 0,
    rituals: 0, phrases: 0, embeddings: 0, derivations: 0, sessions: 0,
    shared_moments: 0, visual_assertions: 0,
    person_rows: 0, state_rebuilt: false, terms: [],
  };

  if (scope === "all") {
    // shared rows FIRST (§3): withdraw P from every ACL, take P's own authored
    // room turns, and hard-delete anything P was the last participant in —
    // before the manifest loop deletes the participant rows the "last one out"
    // computation reads. Order is the mechanism, not a preference.
    out.shared = await withdrawSharedRows(person, { dropAuthoredRoomTurns: false });
    // manifest-driven: a table added to PERSON_TABLES is wiped here with no
    // further code — the wipe cannot lag the schema
    for (const t of await activePersonTables()) {
      if (t.lane !== "relational") continue;
      const gone = await q(
        `delete from ${t.table} where ${wipeWhereSql(t, { deviceSet: true })} returning 1 as x`,
        wipeParams(t, { device: devices, person }),
        30_000,
      );
      if (gone.length) out[t.table] = gone.length;
    }
    // WS-R32 (migration 094, closing ws-r27-whole-wipe-receipt-read-capped-
    // at-10000): every Room forget receipt this person's own past "forget me
    // in this room" requests ever produced, across every Room. `vy_room_
    // forget_receipt` is deliberately NOT a PERSON_TABLES entry (it carries
    // no person_id column - `roomForgetReceiptHash`'s own header states
    // why), so the generic manifest loop above cannot see it and this is its
    // one explicit door - see `purgeRoomForgetReceipts`'s own header for the
    // bounded-by-Rooms-not-receipts argument. Gated on the table existing at
    // all (090's own migration), the same guard `meera_consent` gets for
    // 016 - a manifest naming a table this database has not got yet must
    // never turn "forget everything" into a 500.
    if (await tableApplied("vy_room_forget_receipt")) {
      const goneReceipts = await purgeRoomForgetReceipts(q, person);
      if (goneReceipts) out.vy_room_forget_receipt = goneReceipts;
    }
    // WS-R100 (migration 126). `vy_receipt` — a follower's own payment
    // receipts. Deliberately NOT a `PERSON_TABLES` entry above (this table's
    // own migration header, and `scripts/relcheck.mjs`'s `EXEMPT` map, carry
    // the written reason), so the generic manifest loop a few lines up
    // cannot see it — this is its own explicit door, `vy_room_forget_
    // receipt`'s own one line up restated for a table that must NOT be
    // blind-deleted the way that loop deletes every `relational` lane
    // entry. An UPDATE, never a DELETE: `person_id` is nulled, the row
    // itself (its `receipt_no` and, through the still-intact
    // `vy_payment_event` row, its amount) survives — a receipt is proof a
    // real charge happened, and an account-wide "forget everything" may not
    // also make an accountant's or a parent's copy of that proof
    // retroactively inaccurate (`vy_room_subscription`'s own
    // "forgetting what an AI remembers is a different request in kind from
    // forgetting that you paid money" restated for a receipt instead of a
    // mandate). Gated on the table existing at all, `vy_room_forget_
    // receipt`'s own guard restated.
    if (await tableApplied("vy_receipt")) {
      const nulledReceipts = await q(
        `update vy_receipt set person_id = null where person_id = $1 returning receipt_id`,
        [person],
      );
      if (nulledReceipts.length) out.vy_receipt = nulledReceipts.length;
    }
    // the mapping and (if no other device shares it) the person row itself:
    // a full wipe that kept the identity row would keep a record of them
    // EVERY mapping row, not just the asking device's. Leaving the others
    // behind would keep a record of which surfaces this human used, and would
    // also block the person-row delete below, whose `not exists` guard reads
    // exactly this table.
    const m = await q(
      `delete from vy_person_device where device_id = any($1::uuid[]) returning person_id`,
      [devices],
    );
    await q(
      `delete from vy_person p where p.person_id = $1
        and not exists (select 1 from vy_person_device d where d.person_id = p.person_id)`,
      [person],
    );
    out.person_rows += m.length;
    return out;
  }

  // ── step 2: which episodes die ──
  //
  // WS-AGENTSCOPE: everything from here down is the FORGET LANE and carries NO
  // agent-scope clause, deliberately. §6: "a full wipe of a person deletes
  // their rows across ALL agents (it is their data, not the agent's)". A
  // partial forget takes the same reading — asking her to forget a thing means
  // the thing is gone, not that one tenant stopped citing it. Adding the
  // predicate here would silently narrow the proven G-E5 property, which is the
  // one direction this file is not allowed to move. A LATER per-agent wipe
  // ("forget what THIS agent knows") is a second scope value, not a change to
  // this one, and it does not exist yet because no second agent does.
  const seeds = new Set();
  if (logIds.length) {
    const hit = await q(
      `select id from vy_episode
        where person_id = $1 and log_from is not null and log_to is not null
          and exists (select 1 from unnest($2::bigint[]) d(id) where d.id between log_from and log_to)`,
      [person, logIds],
    );
    for (const r of hit) seeds.add(r.id);
  }
  if (rx) {
    // additional net (item scope): the summary says the word even though the
    // cited rows might not — "priya" living inside an episode about the wedding
    const hit = await q(
      `select id from vy_episode where person_id = $1 and summary ~* $2`,
      [person, rx],
    );
    for (const r of hit) seeds.add(r.id);
  }
  if (Number.isFinite(from) && Number.isFinite(to)) {
    // additional net (window scopes): provisional episodes may not carry a log
    // span yet; an episode that OVERLAPS the window carries its words. The
    // window is taken unfiltered by channel, same call the node delete makes.
    const hit = await q(
      `select id from vy_episode
        where person_id = $1 and started_at < $3 and coalesce(ended_at, started_at) >= $2`,
      [person, new Date(from).toISOString(), new Date(to).toISOString()],
    );
    for (const r of hit) seeds.add(r.id);
  }

  // ── steps 2+4: delete episodes with the superseded_by chase, both
  // directions, in one recursive statement (SQL-HTTP = no transactions, so
  // each statement must leave a consistent-enough state on its own; the
  // zero-orphan sweep is the prover). FK cascade takes assertions/moments.
  let epIds = [];
  if (seeds.size) {
    const gone = await q(
      `with recursive doomed as (
         select id, superseded_by from vy_episode where person_id = $1 and id = any($2::bigint[])
         union
         select e.id, e.superseded_by from vy_episode e
           join doomed d on e.person_id = $1 and (e.id = d.superseded_by or e.superseded_by = d.id)
       )
       delete from vy_episode where person_id = $1 and id in (select id from doomed)
       returning id`,
      [person, [...seeds]],
      30_000,
    );
    epIds = gone.map((r) => r.id);
  }
  out.episodes = epIds.length;

  // ── step 3 + 4 on facts: citation-join seed, then lineage both ways.
  // Legacy-quarantined rows (no citations to join on) are over-deleted on
  // any plausibly-covering scope: rx hits them by name/body; a window scope
  // takes the ones written inside it (mirrors the meera_nodes updated_at rule).
  const win = Number.isFinite(from) && Number.isFinite(to);
  const factGone = await q(
    `with recursive doomed as (
       select id, superseded_by from vy_fact
        where person_id = $1
          and (citations && $2::bigint[]
               ${rx ? "or name ~* $3 or body ~* $3" : win ? "or (provenance = 'legacy' and created_at >= $3 and created_at < $4)" : ""})
       union
       select f.id, f.superseded_by from vy_fact f
         join doomed d on f.person_id = $1 and (f.id = d.superseded_by or f.superseded_by = d.id)
     )
     delete from vy_fact where person_id = $1 and id in (select id from doomed)
     returning id, name`,
    rx
      ? [person, epIds, rx]
      : win
        ? [person, epIds, new Date(from).toISOString(), new Date(to).toISOString()]
        : [person, epIds],
    30_000,
  );
  const factIds = factGone.map((r) => r.id);
  out.facts = factIds.length;
  // #85: the deleted facts that NAME a storage object. Handed up rather than
  // acted on here — this function's contract is rows, and a forget's receipt
  // may only be sent once the rows are actually gone (see the header above:
  // "nothing here is .catch()-swallowed"). The file delete is best-effort by
  // nature, so it happens in opForget, after this cascade has succeeded.
  out.photoNames = factGone.map((r) => r.name).filter((n) => /^photo:/i.test(String(n || "")));

  const relGone = await q(
    `delete from vy_rel_event where person_id = $1
      and (citations && $2::bigint[]${rx ? " or note ~* $3" : ""}) returning id`,
    rx ? [person, epIds, rx] : [person, epIds],
  );
  out.rel_events = relGone.length;

  const patGone = await q(
    `delete from vy_pattern where person_id = $1
      and (citations && $2::bigint[]${rx ? " or if_shape ~* $3 or then_note ~* $3" : ""}) returning id`,
    rx ? [person, epIds, rx] : [person, epIds],
  );
  out.patterns = patGone.length;

  const kinGone = await q(
    `delete from vy_kin where person_id = $1
      and (citations && $2::bigint[]${rx ? " or name ~* $3" : ""}) returning name`,
    rx ? [person, epIds, rx] : [person, epIds],
  );
  out.kin = kinGone.length;

  const curGone = await q(
    `delete from vy_currency where person_id = $1
      and (citations && $2::bigint[]${rx ? " or topic ~* $3" : ""}) returning topic`,
    rx ? [person, epIds, rx] : [person, epIds],
  );
  out.currency = curGone.length;

  const ritGone = await q(
    `delete from vy_ritual where person_id = $1 and citations && $2::bigint[] returning key`,
    [person, epIds],
  );
  out.rituals = ritGone.length;

  // ── P2-1: the watch stores, reachable by their OWN text ─────────────────
  //
  // vy_shared_moment and vy_visual_assertion died only one way: `on delete
  // cascade` from the episode. So they were reachable by a forget ONLY when
  // the whole episode died — which happens on a log-range intersection, on an
  // episode-summary term match, or on a time window. A watch episode carries
  // NO log span at all (api/episodes.js's own header: "watch has no meera_log
  // rows"), and its summary is the empty string until a nightly pass gives it
  // one, so for a watch session neither of the first two mechanisms can fire.
  // The practical shape of that: "bhool ja wo video jo humne dekhi thi" was
  // an item forget, item forgets have no window, and the moment survived.
  //
  // Worse, these are the two rows in the entire store with the most exposed
  // content: the reaction is a sentence she SAID, and the claim is a
  // description of a picture of somebody's actual life. §0.2.4 says term and
  // window matches are an ADDITIONAL net and never the primary mechanism —
  // that stands, and this is that additional net, laid over the one class of
  // row where the primary mechanism structurally cannot reach.
  //
  // Rows whose episode already died are gone by cascade before this runs, so
  // these statements only ever see survivors. Not .catch()-swallowed, like
  // everything else in this cascade: the receipt may not be sent until the
  // delete actually happened.
  if (rx || win) {
    const momGone = await q(
      `delete from vy_shared_moment where person_id = $1
        and (${rx ? "reaction ~* $2" : "at >= $2::timestamptz and at < $3::timestamptz"}) returning id`,
      rx ? [person, rx] : [person, new Date(from).toISOString(), new Date(to).toISOString()],
    );
    out.shared_moments = momGone.length;
    const visGone = await q(
      `delete from vy_visual_assertion where person_id = $1
        and (${rx ? "claim ~* $2" : "created_at >= $2::timestamptz and created_at < $3::timestamptz"}) returning id`,
      rx ? [person, rx] : [person, new Date(from).toISOString(), new Date(to).toISOString()],
    );
    out.visual_assertions = visGone.length;
  }

  // phrases: THEIR coined words. One dies when its coining episode dies,
  // when the word itself is what is being forgotten (rx), or when it was
  // coined inside a forgotten window.
  const phrGone = await q(
    `delete from vy_phrase where person_id = $1
      and (origin_episode = any($2::bigint[])
           ${rx ? "or phrase ~* $3 or gloss ~* $3" : win ? "or (coined_at >= $3 and coined_at < $4)" : ""}) returning phrase`,
    rx
      ? [person, epIds, rx]
      : win
        ? [person, epIds, new Date(from).toISOString(), new Date(to).toISOString()]
        : [person, epIds],
  );
  out.phrases = phrGone.length;

  // step 6: embeddings die with their owners
  const embGone = await q(
    `delete from vy_embedding where person_id = $1
      and ((owner_kind = 'episode' and owner_id = any($2::bigint[]))
        or (owner_kind = 'fact'    and owner_id = any($3::bigint[]))
        or (owner_kind = 'pattern' and owner_id = any($4::bigint[]))) returning 1 as x`,
    [person, epIds, factIds, patGone.map((r) => r.id)],
  );
  out.embeddings = embGone.length;

  // a derivation record whose input span intersects the deleted log rows is
  // the audit trail OF a conversation that no longer exists
  if (logIds.length) {
    const derGone = await q(
      `delete from vy_derivation where person_id = $1
        and exists (select 1 from unnest($2::bigint[]) d(id) where d.id between input_from and input_to)
       returning id`,
      [person, logIds],
    );
    out.derivations = derGone.length;
  }

  // session-clock rows are a timeline of the forgotten stretch (window scopes)
  if (win) {
    const sesGone = await q(
      `delete from vy_session where person_id = $1 and started_at < $3 and last_activity >= $2
       returning session_id`,
      [person, new Date(from).toISOString(), new Date(to).toISOString()],
    );
    out.sessions = sesGone.length;
  }

  // ── step 5: replay-rebuild the snapshot from surviving events ──
  if (epIds.length || relGone.length || ritGone.length) {
    await rebuildRelState(person);
    out.state_rebuilt = true;
  }

  // suppression terms so the extractor AND the consolidator (M3) cannot
  // re-derive the forgotten thing from a transcript still on screen
  for (const r of [...factGone, ...kinGone]) if (r.name) out.terms.push(r.name);
  for (const r of phrGone) if (r.phrase) out.terms.push(r.phrase);
  for (const r of curGone) if (r.topic) out.terms.push(r.topic);
  return out;
}

// The snapshot is a CACHE (SPEC §2.4). After a forget it is rebuilt by
// replaying whatever rel events survived — register and trust regress if
// their evidence is gone. Deterministic fold, newest-wins per dim; derived
// dims (cs_ratio, ritual_density, pacing) reset and are recomputed by the
// nightly consolidator, which owns them. snapshot_ver DOES bump here even
// though §2.4 says "only at consolidation": the ver exists so caches can
// tell whether state moved, and a forget that moved state while the ver
// held still would keep serving the forgotten state from a warm cache —
// forget beats cache stability, explicitly.
// AGENT SCOPE (Law E1) and the one place it interacts with the forget lane.
// The snapshot is a per-(agent, person) fold of that agent's OWN rel events, so
// the replay is scoped and so is the row it writes. The forget cascade that
// calls this is NOT scoped — §6: a wipe deletes the person's rows across all
// agents, because it is their data. The two are consistent today because there
// is one agent. They stop being consistent the day there are two: a partial
// forget deletes every agent's rel events and then rebuilds only the caller's
// snapshot, leaving the other agent's cache stale. The fix is a loop over the
// agents holding rows for this person, and it belongs with whoever ships agent
// two — named here rather than left to be discovered, and listed in
// db/migrations/010_agent_strict.sql's header as a known follow-on.
async function rebuildRelState(person, agentId = MEERA_AGENT_ID) {
  const evs = await q(
    `select e.dim, e.to_v from vy_rel_event e where e.person_id = $1
      ${agentScopePredicate("e", { agentId: "$2" })}
      order by e.at, e.id`,
    [person, agentId],
  );
  if (!evs.length) {
    // no evidence, no state: the defaults live in the schema, not in a row
    await q(
      `delete from vy_rel_state r where r.person_id = $1
        ${agentScopePredicate("r", { agentId: "$2" })}`,
      [person, agentId],
    );
    return;
  }
  const s = { honorific: "tum", cs_on_stress: "unknown", trust: 0.3, rupture_open: false, repair_state: "none" };
  for (const e of evs) {
    if (e.dim === "honorific" && ["tu", "tum", "aap"].includes(e.to_v)) s.honorific = e.to_v;
    else if (e.dim === "trust") {
      const v = Number(e.to_v);
      if (Number.isFinite(v)) s.trust = Math.min(1, Math.max(0, v));
    } else if (e.dim === "rupture") {
      s.rupture_open = true;
      s.repair_state = "open";
    } else if (e.dim === "repair" && ["none", "open", "repairing", "repaired"].includes(e.to_v)) {
      s.repair_state = e.to_v;
      s.rupture_open = e.to_v === "open" || e.to_v === "repairing";
    } else if (e.dim === "code_switch" && ["retreat_l2", "intensify_l1", "unknown"].includes(e.to_v)) {
      s.cs_on_stress = e.to_v;
    }
  }
  // MIGRATED ARBITER (009 header's ten sites; migration 010 precondition). This
  // is the one of the ten that is NOT .catch()-swallowed: it lives in the forget
  // cascade, so an unresolvable arbiter here turns a whole-wipe into a hard
  // error and breaks the G-E5 property outright.
  await q(
    `insert into vy_rel_state (agent_id, person_id, honorific, cs_on_stress, trust, rupture_open, repair_state, snapshot_ver)
     values (${agentValue("$7")},$1,$2,$3,$4,$5,$6,1)
     on conflict (agent_id, person_id) do update set
       honorific = $2, cs_on_stress = $3, trust = $4, rupture_open = $5, repair_state = $6,
       cs_ratio = null, ritual_density = 0, pacing_gap_s = null,
       snapshot_ver = vy_rel_state.snapshot_ver + 1, updated_at = now()`,
    [person, s.honorific, s.cs_on_stress, s.trust, s.rupture_open, s.repair_state, agentId],
  );
}

// an orphaned edge is a relation between two things that no longer exist —
// it survives every node-level delete unless it is chased explicitly
async function dropEdgesFor(devices, ids, agentId = MEERA_AGENT_ID) {
  if (!ids.length) return 0;
  const gone = await q(
    `delete from meera_edges e where device_id = any($1::uuid[])
      ${agentScopePredicate("e", { agentId: "$3" })}
      and (src = any($2) or dst = any($2)) returning id`,
    [devices, ids, agentId],
  ).catch(() => []);
  return gone.length;
}

// Telemetry is deleted on exactly the terms the log is — rule 3 of
// docs/TELEMETRY.md — because telemetry is the one place that would otherwise
// keep a copy of something they asked to be gone.
//
// Two reasons this is not optional decoration:
//   - `compose.*` captures DRAFT text, which exists nowhere else in the
//     product (rule 2's single exception). A forget that clears meera_log and
//     leaves the draft behind has deleted the sent message and kept the thing
//     they typed and thought better of, which is worse than not deleting.
//   - everything else in meera_tel references content by msg_id rather than
//     copying it, so it goes not because it is incriminating but because a
//     timeline of a conversation that no longer exists is still a record of
//     that conversation.
//
// Matching is on the whole props document, not on a known list of text-bearing
// keys. An allowlist of keys is a promise that no future producer ever puts a
// word in a new field, and that promise is the sort that gets broken quietly.
// Over-deleting here is the safe direction, the same call the node delete
// above already makes.
//
// The rollup is repaired afterwards rather than left alone: a meera_tel_session
// row that outlives its events would list a session with nothing in it, which
// during an RCA reads as data loss rather than as a forget doing its job.
// Repair is best-effort — a stale count must never fail a delete that worked.
// ── P2-1: the server copy of AppState ──────────────────────────────────────
//
// See the manifest entry for meera_state above for what the row holds and how
// it stayed invisible. This is the delete half, and it has THREE shapes rather
// than one, because a forget's scope has to mean the same thing to the synced
// blob as it means to the database:
//
//   all     — the row goes. Every field in it belongs to a relationship that
//             no longer exists, `user` included (evals/teardown.mjs's C1: "she
//             started over 'not knowing you' with lives in: pune still in her
//             prompt" — that was the LOCAL copy of the same defect).
//   item    — the messages that say the word go, and the finished-activity
//             ledger rows that say it go. Nothing else: forgetting one fact
//             does not shred the transcript, which is the same rule
//             src/engine/memory.ts's messagesAfterForget already applies on
//             the device.
//   window  — the messages and activities inside the window go, matching the
//             client-side prune exactly.
//
// A REWRITE, NOT A DELETE, for the scoped cases: deleting the whole row to
// honour "forget yesterday" would sign the user out of their own history.
// jsonb_agg over jsonb_array_elements is one statement per array, which is
// what L6 (SQL-HTTP, no transactions) allows, and each statement leaves a
// consistent document on its own.
//
// `coalesce(..., '[]'::jsonb)`: jsonb_agg over an empty set returns NULL, and
// a NULL where the client expects an array is `messages.slice` on undefined —
// a forget that bricks the app on the next load is not a forget.
//
// Not .catch()-swallowed for the same reason nothing else in this cascade is.
async function purgeSyncedState(devices, { rx, from, to, all }) {
  if (all) {
    const gone = await q(
      `delete from meera_state where device_id = any($1::uuid[]) returning user_id`,
      [devices],
    );
    return { rows: gone.length, rewritten: 0 };
  }
  const prune = async (field, whereKept, params) => {
    const rows = await q(
      `update meera_state
          set state = jsonb_set(state, '{${field}}',
                coalesce((select jsonb_agg(e) from jsonb_array_elements(state->'${field}') e
                           where ${whereKept}), '[]'::jsonb)),
              updated_at = now()
        where device_id = any($1::uuid[]) and jsonb_typeof(state->'${field}') = 'array'
        returning user_id`,
      params,
    );
    return rows.length;
  };
  let rewritten = 0;
  if (rx) {
    // the message text, and the caption a photo message carries — both are
    // things they said, and a term that lives in one lives in the other
    rewritten += await prune(
      "messages",
      `not (coalesce(e->>'text','') ~* $2 or coalesce(e->>'desc','') ~* $2)`,
      [devices, rx],
    );
    // activityEpisodeSummary's own text: "chess, 22 aug, you left it on move 6"
    rewritten += await prune("activities", `not (coalesce(e->>'summary','') ~* $2)`, [devices, rx]);
  } else if (Number.isFinite(from) && Number.isFinite(to)) {
    // `at` is epoch ms in AppState (src/engine/memory.ts's Message), and the
    // ->> extraction is text — the cast is what makes the comparison numeric
    // rather than lexicographic, and a lexicographic comparison of epoch
    // milliseconds is wrong in a way that looks right for a decade.
    rewritten += await prune(
      "messages",
      `not (coalesce((e->>'at')::bigint, 0) >= $2::bigint and coalesce((e->>'at')::bigint, 0) < $3::bigint)`,
      [devices, String(Math.floor(from)), String(Math.floor(to))],
    );
    rewritten += await prune(
      "activities",
      `not (coalesce((e->>'startedAt')::bigint, 0) >= $2::bigint and coalesce((e->>'startedAt')::bigint, 0) < $3::bigint)`,
      [devices, String(Math.floor(from)), String(Math.floor(to))],
    );
  }
  return { rows: 0, rewritten };
}

// ── the turn trace, which nothing was deleting ─────────────────────────────
//
// FOUND BY THE FATE WALK (evals/recall/run.mjs §8), not by reading. The
// manifest entry for meera_turn says, in writing: "a person's whole wipe must
// take their trace with it, and meera_turn_leg carries a device_id for no
// other purpose than being reachable by this clause." It was not reachable by
// any clause. Both tables are lane "legacy", the manifest wipe loop deletes
// only lane "relational", and the explicit legacy code in opForget names
// meera_log, meera_nodes, meera_edges, meera_forget and (through
// purgeTelemetry) meera_tel — never these two. The only thing that ever
// removed a trace row was api/_trace.js's 90-day retention horizon.
//
// That is the same species of defect as meera_state one function up and it was
// hiding behind a comment that asserted the opposite, which is worse: a stale
// comment claiming coverage is how a reader stops looking. Both rows are
// counts, byte lengths, hashes, timings and row ids — no conversation content
// — so this is not an exposure. It is a promise that was not kept, and the
// receipt was saying it had been.
//
// NO `rx` BRANCH, and that is a decision rather than an omission: an item
// forget matches a WORD, and there are no words in these tables to match. A
// trace row is deleted when the person is wiped, or when the stretch it timed
// is wiped. Saying that here beats a branch that silently matches nothing.
async function purgeTurnTrace(devices, { from, to, all }) {
  const del = async (sql, params) => (await q(sql, params).catch(() => [])).length;
  if (all) {
    // legs first: the detail table's rows are reachable only through their
    // turn, so taking the spine first would strand them (no FK, house law)
    const legs = await del(
      `delete from meera_turn_leg where device_id = any($1::text[]) returning id`,
      [devices],
    );
    const turns = await del(
      `delete from meera_turn where device_id = any($1::text[]) returning turn_id`,
      [devices],
    );
    return legs + turns;
  }
  if (Number.isFinite(from) && Number.isFinite(to)) {
    const a = new Date(from).toISOString();
    const b = new Date(to).toISOString();
    const legs = await del(
      `delete from meera_turn_leg where device_id = any($1::text[]) and at >= $2 and at < $3 returning id`,
      [devices, a, b],
    );
    const turns = await del(
      `delete from meera_turn where device_id = any($1::text[]) and started_at >= $2 and started_at < $3 returning turn_id`,
      [devices, a, b],
    );
    return legs + turns;
  }
  return 0;
}

/** Analytics rows, on the same terms as meera_tel (docs/TELEMETRY.md rule 3).
 *  Its own function rather than a branch inside purgeTelemetry because
 *  meera_events has no session rollup to repair and no `props::text` draft
 *  exception to reason about — it is one table and one predicate. */
async function purgeEvents(devices, { rx, from, to, all }) {
  if (all) {
    const gone = await q(
      `delete from meera_events where device_id = any($1::uuid[]) returning id`,
      [devices],
    ).catch(() => []);
    return gone.length;
  }
  if (rx) {
    const gone = await q(
      `delete from meera_events where device_id = any($1::uuid[]) and props::text ~* $2 returning id`,
      [devices, rx],
    ).catch(() => []);
    return gone.length;
  }
  if (Number.isFinite(from) && Number.isFinite(to)) {
    const gone = await q(
      `delete from meera_events where device_id = any($1::uuid[]) and at >= $2 and at < $3 returning id`,
      [devices, new Date(from).toISOString(), new Date(to).toISOString()],
    ).catch(() => []);
    return gone.length;
  }
  return 0;
}

async function purgeTelemetry(devices, { rx, from, to, all }) {
  let gone = [];
  // meera_diag rides every branch of this function on exactly rule 3's terms.
  // It is the call-path audit trail, its `detail` jsonb can carry turn-shaped
  // content, and nothing deleted it — the same shape as meera_state one table
  // over, found the same way (the widened coverage query in relcheck.mjs), and
  // fixed here rather than filed, because a known hole left open is a worse
  // artefact than an unknown one. `.catch`-tolerant: this table is an audit
  // trail, and a diag row that outlives a delete must not block the delete.
  const diag = async (where, params) =>
    (await q(`delete from meera_diag where ${where} returning id`, params).catch(() => [])).length;
  if (all) {
    gone = await q(`delete from meera_tel where device_id = any($1::text[]) returning id`, [devices]);
    await q(`delete from meera_tel_session where device_id = any($1::text[])`, [devices]).catch(
      () => {},
    );
    await diag(`device_id = any($1::text[])`, [devices]);
    return gone.length;
  }
  if (rx) {
    gone = await q(
      `delete from meera_tel where device_id = any($1::text[]) and props::text ~* $2 returning id`,
      [devices, rx],
    );
    await diag(`device_id = any($1::text[]) and detail::text ~* $2`, [devices, rx]);
  } else if (Number.isFinite(from) && Number.isFinite(to)) {
    gone = await q(
      `delete from meera_tel where device_id = any($1::text[]) and at >= $2 and at < $3 returning id`,
      [devices, new Date(from).toISOString(), new Date(to).toISOString()],
    );
    await diag(`device_id = any($1::text[]) and at >= $2 and at < $3`, [
      devices,
      new Date(from).toISOString(),
      new Date(to).toISOString(),
    ]);
  }
  if (!gone.length) return 0;
  await q(
    `delete from meera_tel_session s where s.device_id = any($1::text[])
       and not exists (select 1 from meera_tel t where t.session_id = s.session_id)`,
    [devices],
  ).catch(() => {});
  await q(
    `update meera_tel_session s set events = c.n
       from (select session_id, count(*)::int n from meera_tel where device_id = any($1::text[]) group by session_id) c
      where s.session_id = c.session_id and s.device_id = any($1::text[]) and s.events <> c.n`,
    [devices],
  ).catch(() => {});
  return gone.length;
}

// "everything from that date" — a calendar day is a local-time idea, so it
// needs their offset. Minutes EAST of UTC; the app is India-first, so IST.
function dayWindow(body) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(body.day || ""));
  if (!m) return [NaN, NaN];
  const raw = Number(body.tzMin);
  const tz = Number.isFinite(raw) ? Math.max(-840, Math.min(840, raw)) : 330;
  const start = Date.UTC(+m[1], +m[2] - 1, +m[3]) - tz * 60_000;
  return [start, start + 86_400_000];
}

// ── A1 — THE MUTATION-TIME FORGET-MATCHING HOOK ───────────────────────────
//
// docs/research/MEMORY-FIELD-SURVEY.md §Q5 / adopt-list A1. The problem it
// solves, in one line: our forget PROPAGATION is the strongest thing in this
// repo and it only ever fires on what the MATCHER selects, and the matcher is
// `lower(term)` — while the product is Hinglish, where one referent inside one
// relationship is "woh ladki", "us waali", "my ex" and her actual name, in one
// sentence, across two scripts. Measured on our own battery (evals/forget/):
// the lexical matcher takes 5.9% of the rows an adversarial ask means.
//
// WHY MUTATION TIME AND NOWHERE ELSE. Three placements exist and two are
// forbidden here:
//   * recall time — a filtered row is a row recall can still see. L2 is not a
//     preference and this is not a soft delete.
//   * inscribe time — puts a model in the per-turn extraction path, costs
//     every turn, and scores 0% on intent-aware deletion in the source paper.
//   * MUTATION time — the only regime compatible with a hard delete, and the
//     one that measures best. It also runs a few times a DAY across all users
//     rather than a few times a minute, which is what makes it affordable.
//
// WHAT IT DOES AND DOES NOT DO. It resolves a REFERENT to node ids, and the
// names of the nodes it picks become additional lexical terms for everything
// downstream — logs, telemetry, the synced blob, events, photos, the
// suppression list. Not one line of the §9.1 cascade changes. The hook widens
// the SELECTION and nothing else.
//
// THE CLOSURE THAT MAKES IT SAFE. The model is shown a numbered list of rows
// and may return only numbers from that list; `parseForgetHook` drops anything
// else. It therefore CANNOT name a row it was not shown, cannot invent a
// person, and cannot widen the delete beyond this device's own candidates.
// That is the anti-fabrication property, and it is structural rather than
// prompted — the prompt asking nicely would not be evidence of anything.
//
// UNION, NOT REPLACE. The delete takes lexical ∪ hook. Under-deleting is the
// wrong direction for this law (§Q5: "falling back to the deterministic terms
// means under-deleting, which is the wrong direction"), so a hook that
// under-selects can only ever be as bad as today, never worse. It also makes
// the fallback trivial: the fallback IS one side of the union.
//
// L4 EXPOSURE: none. Row text goes UP to the resolver and ids come back; no
// model-authored sentence is stored, and `meera_forget` — which gains the
// resolved names — is never read by recall and never enters a prompt
// (noteForgotten()'s own header).

/** The chat lane's own free-pool model, reached through the same helper
 *  api/chat.js uses. Chosen by measurement, not by taste — see
 *  evals/forget/a1.mjs, which runs this exact prompt against the candidate
 *  models and prints the recall of each. */
// ── WHICH LANE, AND WHY THAT ORDER (measured, 2026-08-23) ─────────────────
// The plan for this hook was the free Gemini pool, through the same helper
// api/chat.js uses. The battery said otherwise, and said it twice in one hour:
//
//   * the free pool run came back 35.3% adversarial recall with **18 of 27
//     calls 429'd** — all nine keys exhausted together. That is a number about
//     quota, not about matching.
//   * the check for a clean read of the same MODEL through OpenRouter got 403
//     "Key limit exceeded" on the very first call. Both free lanes were dead
//     within the same hour, which is `free-pool-capacity` (~75 calls/day,
//     shared with production) arriving exactly as it was measured to.
//   * the Azure credits lane answered 27 of 27, p50 2.19 s, **76.5%**.
//
// So the order is credits FIRST, free pool second — which is also the order
// this very file already uses for extraction, for the reason stated there: a
// bad Azure minute must cost a slower answer, never a lost memory. Reversing
// it would put an UNMEASURED model on the primary path of a delete promise to
// save a fraction of a cent on an operation that runs a few times a day.
//
// REVERSES IF: the free pool stops being saturated (owner credits, a bigger
// pool) AND a clean free-lane run of evals/forget/a1.mjs matches the credits
// lane's recall. Then free-first is strictly better and this comment is why.
const FORGET_HOOK_AZ_MODEL = "grok-4-1-fast-reasoning";
const FORGET_HOOK_MODEL = "gemini-3.6-flash";
const GEMINI_OPENAI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
/** The fuse. A forget is one of the few places a user is genuinely waiting on
 *  a promise being kept, and "haan hata diya" is sent only after commit — so
 *  the hook is allowed to add seconds, but a bounded number of them. Measured
 *  p50 2.19 s / max 7.88 s on the credits lane, so this cuts the tail and
 *  keeps the median. Past it the lexical matcher answers and the receipt is
 *  marked hedged. */
const FORGET_HOOK_FUSE_MS = 5_000;
/** HARD per-op call cap, counted across BOTH lanes. `withGeminiKey` will
 *  happily walk three keys plus the billed one; a forget is not worth four
 *  round trips of a user staring at a screen, and the free pool is a DAILY
 *  budget shared with production (`free-pool-capacity`, ~75 calls/day). Two
 *  upstream requests, then the deterministic answer and an honest hedge. */
const FORGET_HOOK_MAX_CALLS = 2;
/** How many rows the resolver may see. Two sources, in this order: the rows
 *  the EXISTING lexical predicate already found (they are the likeliest
 *  answer and they cost nothing extra), then a recency window, because a
 *  referring expression — "woh ladki", "wo wali baat" — is almost always
 *  about something recent, and it is the case where the lexical predicate
 *  returns nothing at all. */
const FORGET_HOOK_LEX_CAP = 40;
const FORGET_HOOK_RECENT = 30;
/** One row of context per candidate, capped. A node summary is a sentence or
 *  two; a runaway one must not be able to push the rest of the list out. */
const FORGET_HOOK_ROW_CHARS = 220;

/**
 * The resolver prompt. STRUCTURAL AND SCHEMA-FORCED, with no persona in it at
 * all: this is a matching primitive, not Meera, and giving it a voice would
 * make it a second place her character lives and a second thing to keep in
 * sync. Written as rules and a schema rather than as examples, for the same
 * reason `persona.ts` carries no example quotes — anything sentence-shaped in
 * a prompt gets recited, and here that would mean a phrase bank of referents.
 *
 * Exported so `evals/forget/a1.mjs` measures THE SHIPPED PROMPT rather than a
 * copy of it. A frozen copy that drifts is how a suite reports a pass on a
 * tree it never saw (`gates-that-live-nowhere`).
 */
export function forgetHookPrompt(marker, rows) {
  const list = rows
    .map((r) => `[${r.id}] ${String(r.text || "").replace(/\s+/g, " ").trim().slice(0, FORGET_HOOK_ROW_CHARS)}`)
    .join("\n");
  return [
    {
      role: "system",
      content:
        "You resolve a deletion request against a numbered list of stored rows and return the ids to delete. " +
        "You return JSON and nothing else.",
    },
    {
      role: "user",
      content:
        `REQUEST (verbatim, may be Hinglish, Devanagari, romanised, or English):\n<<<${marker}>>>\n\n` +
        `ROWS:\n${list}\n\n` +
        `Return exactly: {"ids":[...]}\n` +
        `RULES\n` +
        `1. Every id you return MUST appear in brackets above. A number that does not is invalid.\n` +
        `2. Return a row when the REQUEST is about the same person, thing or episode that row is about — across language, script, spelling, transliteration, inflection and word order.\n` +
        `3. Return EVERY row about that same referent, not just the clearest one.\n` +
        `4. Do NOT return a row that merely shares a word with the request but is about a different person or thing.\n` +
        `5. If the request refers to something you cannot locate among these rows, return {"ids":[]}. An empty answer is a correct answer.\n` +
        `Output JSON only.`,
    },
  ];
}

/**
 * Parse the resolver's reply into ids, CLOSED over the ids it was shown.
 *
 * Returns null when the reply is unusable (that is a hook failure and gets the
 * fallback), and an array — possibly empty — when it is usable. The empty
 * array is a real answer, not a failure: it is what produces the honest ask
 * instead of a false receipt.
 */
export function parseForgetHook(text, allowedIds) {
  if (typeof text !== "string") return null;
  // models fence JSON about half the time; take the first object either way
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  let j;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(j?.ids)) return null;
  const allow = new Set(allowedIds.map(String));
  const out = [];
  for (const raw of j.ids) {
    const id = String(raw);
    // THE CLOSURE. An id that was not on the list does not exist as far as this
    // function is concerned — no fuzzy match, no coercion, no "close enough".
    if (allow.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** The candidate rows: what the existing predicate found, then recency. */
async function forgetCandidates(devices, name, rx, agentId = MEERA_AGENT_ID) {
  const seen = new Map();
  const add = (rows) => {
    for (const r of rows) {
      if (seen.size >= FORGET_HOOK_LEX_CAP + FORGET_HOOK_RECENT) return;
      if (!seen.has(String(r.id))) {
        seen.set(String(r.id), {
          id: String(r.id),
          name: r.name,
          text: [r.name, r.summary].filter(Boolean).join(" — "),
        });
      }
    }
  };
  add(
    await q(
      `select id, name, summary from meera_nodes n
        where device_id = any($1::uuid[]) and (name = $2 or name ~* $3 or summary ~* $3)
        ${agentScopePredicate("n", { agentId: "$4" })}
        order by updated_at desc limit ${FORGET_HOOK_LEX_CAP}`,
      [devices, name, rx, agentId],
    ).catch(() => []),
  );
  add(
    await q(
      `select id, name, summary from meera_nodes n
        where device_id = any($1::uuid[])
        ${agentScopePredicate("n", { agentId: "$2" })}
        order by updated_at desc limit ${FORGET_HOOK_RECENT}`,
      [devices, agentId],
    ).catch(() => []),
  );
  return [...seen.values()];
}

/**
 * Ask the resolver. Returns `{ ids }` on success or `{ failed: true }`, which
 * is the caller's cue to keep the lexical answer and hedge the receipt.
 *
 * Two lanes, credits then free pool, hard-capped at FORGET_HOOK_MAX_CALLS
 * upstream requests TOTAL across both — see the lane note above for why that
 * order and not the other one. The free half goes through `withGeminiKey`, the
 * same helper api/chat.js uses, so a spent key and a sick key are already
 * handled correctly instead of by a second, quietly-different rotation.
 *
 * There is deliberately no third lane. OpenRouter is what `extractChat` falls
 * to, and on the day this was built its key was over its limit — a third
 * round trip for a third chance at a 403 is dead air, and the lexical matcher
 * plus an honest hedge is a better product than a user watching a spinner.
 *
 * Exported for the same reason `recordPhotoMemory` and `personIdFor` are: the
 * lane plumbing is the half of this that a prompt-and-parser test cannot see,
 * and evals/forget/a1.mjs's `--live` smoke check drives THIS function rather
 * than a transport of its own. It takes plain arguments and touches no
 * database, so exporting it buys the coverage and exposes nothing.
 */
export async function askForgetHook(marker, candidates) {
  if (!candidates.length) return { failed: true };
  const messages = forgetHookPrompt(marker, candidates);
  const allowed = candidates.map((c) => c.id);
  let calls = 0;
  const budget = () => calls < FORGET_HOOK_MAX_CALLS;

  // ── lane 1: credits ──────────────────────────────────────────────────────
  if (AZ_ENDPOINT && AZ_KEY && budget()) {
    calls++;
    try {
      const r = await fetch(`${AZ_ENDPOINT}/chat/completions`, {
        method: "POST",
        headers: { "api-key": AZ_KEY, "Content-Type": "application/json" },
        // temperature 0: a delete is not a place for sampling variety. The
        // provider may ignore it on a reasoning model — measured run-to-run
        // drift of one row on one case out of 27 says it partly does — but
        // asking for determinism costs nothing and not asking is a choice.
        body: JSON.stringify({
          model: FORGET_HOOK_AZ_MODEL,
          max_tokens: 2000,
          temperature: 0,
          messages,
        }),
        signal: AbortSignal.timeout(FORGET_HOOK_FUSE_MS),
      });
      if (r.ok) {
        const j = await r.json();
        const ids = parseForgetHook(j?.choices?.[0]?.message?.content, allowed);
        if (ids) return { ids };
      }
    } catch {
      /* fall through to the free pool — a bad Azure minute is not a failed
         forget, it is a slower one */
    }
  }

  // ── lane 2: the free pool ────────────────────────────────────────────────
  if (poolSize() === 0 || !budget()) return { failed: true };
  const got = await withGeminiKey(async (gkey) => {
    // the cap is enforced HERE rather than by trusting the helper's own
    // MAX_TRIES, which is tuned for a user waiting on speech and may be
    // raised again by someone who is not thinking about this call site
    if (!budget()) return { ok: false, error: "hook call cap" };
    calls++;
    const r = await fetch(GEMINI_OPENAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${gkey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: FORGET_HOOK_MODEL,
        max_tokens: 300,
        temperature: 0,
        messages,
      }),
      signal: AbortSignal.timeout(FORGET_HOOK_FUSE_MS),
    });
    if (isQuota(r.status)) return { ok: false, exhausted: true };
    if (isTransient(r.status)) return { ok: false, retry: true, error: `hook ${r.status}` };
    if (!r.ok) return { ok: false, error: `hook ${r.status}` };
    const j = await r.json().catch(() => null);
    const ids = parseForgetHook(j?.choices?.[0]?.message?.content, allowed);
    // an unparseable 200 is the same failure as a 500 for our purposes
    if (!ids) return { ok: false, retry: true, error: "hook unparseable" };
    return { ok: true, value: ids };
  });
  return got.value ? { ids: got.value } : { failed: true };
}

// Scopes, and what each one actually means in rows:
//   item    — one remembered thing by name: its node, its edges, and the raw
//             turns that say the word. Deleting the node but keeping the
//             sentence it was distilled from is not forgetting, it is filing.
//   session — one stretch of conversation, [from, to) in ms, optionally one
//             channel ("forget that call" is a window plus channel='call').
//   day     — one calendar day in their timezone.
//   all     — every row this device has, including the suppression list.
async function opForget(device, body) {
  // The public legacy endpoint is Meera-only. A replica runtime must enter
  // through an authenticated server-side binding before this becomes a
  // parameter; request JSON is never an authority for an agent id.
  const agentId = MEERA_AGENT_ID;
  const scope = ["item", "session", "day", "all"].includes(body.scope) ? body.scope : "";
  if (!scope) return { error: "unknown scope" };

  let logRows = [];
  let nodeRows = [];
  let edges = 0;
  let photos = 0;
  let telemetry = 0;
  let relational = null; // the §9.1 v2 cascade over the vy_ store
  // P2-1: the synced blob and the analytics rows. Counted in the receipt like
  // everything else — a delete nobody can see the size of is a delete nobody
  // can tell happened.
  let synced = { rows: 0, rewritten: 0 };
  let events = 0;
  let traces = 0;
  // A1: how the item scope's row selection was actually decided, and whether
  // she is entitled to say "hata diya". See the receipt block at the bottom.
  let hook = null;

  // meera_log's owning columns, from the manifest (§3.3 `keys`). A room turn
  // is written under the room's synthetic device uuid, which is in nobody's
  // vy_person_device mapping — so device_id alone would leave a person's own
  // room turns standing through their own forget. Reading the manifest rather
  // than restating the columns is what keeps this in sync with export.
  // Until room ingestion writes speaker_person_id it is NULL on every row, so
  // the added disjunct matches nothing and behaviour today is unchanged.
  const person = await personIdFor(device);
  // ── THE DEVICE SET, RESOLVED ONCE (`legacy-forget-is-device-scoped`) ──────
  //
  // `bindSurfaceDmDevice` mints a device per surface, and every legacy-lane
  // table below keys on `device_id`. Until this line, a whole wipe asked for on
  // the web deleted the web rows and left the same human's Telegram graph
  // standing — the strongest promise in the product, kept on one surface. The
  // read path was widened to the person in WS-O; this is the other half.
  //
  // Resolved ONCE and threaded down rather than re-read per statement: a set
  // that changed between the node delete and the edge delete would strand
  // edges pointing at deleted nodes, and a forget is the one path where a
  // torn read is unrecoverable — the rows it would have needed are gone.
  //
  // For a person with one device this is `[device]` and every statement is
  // byte-identical to what it was. See `personDeviceSet` for why it cannot
  // reach a group room and why it fails closed and narrow.
  const devices = await personDeviceSet(device);
  const LOG = (await activePersonTables()).find((t) => t.table === "meera_log");
  const logOwner = keysOf(LOG).map((k, i) => ownerEq(k, `$${i + 1}`, true)).join(" or ");
  const logOwnerVals = [...wipeParams(LOG, { device: devices, person }), agentId];
  const logAgentP = `$${logOwnerVals.length}`;
  const logP = (n) => `$${logOwnerVals.length + n}`; // 1-based extra params

  if (scope === "item") {
    const name = String(body.name || "").trim().toLowerCase().slice(0, 60);
    // a two-letter term would word-match half the log; a forget must be
    // precise about what it takes, not merely enthusiastic
    if (name.length < 3) return { error: "nothing named" };
    const rx = `\\m${reEsc(name)}\\M`;
    // ── A1: resolve the REFERENT before anything is deleted ───────────────
    // It has to run first for a mechanical reason as well as a logical one:
    // the candidates it reads are the rows the delete is about to take, so a
    // hook that ran afterwards would be shown an empty table.
    //
    // What it is shown as the REQUEST is `name` — the marker the model already
    // emits ([forget: X], FORGET_DECISION), not the user's raw sentence. Two
    // reasons: the marker is the referring expression itself ("woh ladki"), so
    // the raw turn adds mostly noise; and it keeps the request side of the
    // contract unchanged, which is what makes evals/forget/'s pre-registered
    // baseline a like-for-like comparison instead of a different experiment.
    //
    // `nohook` is the SPOKEN lane opting out (src/engine/memory.ts). It takes
    // the fallback path deliberately rather than being a second, quieter
    // implementation of it — one code path, one receipt vocabulary.
    const candidates = body.nohook ? [] : await forgetCandidates(devices, name, rx, agentId);
    const resolved = body.nohook
      ? { failed: true }
      : await askForgetHook(name, candidates).catch(() => ({ failed: true }));
    const hookIds = resolved.ids ?? [];
    hook = {
      // `used` is whether the hook ANSWERED, not whether it was attempted —
      // the difference is the whole of the fallback story
      used: !resolved.failed,
      candidates: candidates.length,
      chosen: hookIds.length,
    };
    // The widened predicate: the asked-for word, plus the NAME of every node
    // the resolver picked out. This is the join between the two halves — the
    // model resolves "woh ladki" to a node, and that node's name is what the
    // log/telemetry/blob/event sweeps below then match on, exactly as if the
    // user had typed the name themselves. Downstream code is untouched.
    const hookNames = candidates
      .filter((c) => hookIds.includes(c.id))
      .map((c) => String(c.name || "").trim().toLowerCase());
    const terms = [
      ...new Set([name, ...hookNames].filter((t) => t.length >= 3).map(reEsc)),
    ].slice(0, 12);
    // Same word-boundary shape as `rx`, over an alternation. The >= 3 filter
    // above is the same refusal the scope guard makes at the top: a two-letter
    // term word-matches half the log, and a forget must be precise about what
    // it takes rather than merely enthusiastic.
    const rxWide = terms.length > 1 ? `\\m(${terms.join("|")})\\M` : rx;
    // summary as well as name: "priya" lives on inside a node called
    // "wedding" whose one line is about her, and that node is the same fact.
    // UNION with the resolver's ids: under-deleting is the wrong direction for
    // this law, so the hook may only ever ADD to what the lexical predicate
    // already found. A hook that picks nothing degrades exactly to today.
    nodeRows = await q(
      `delete from meera_nodes n where device_id = any($1::uuid[])
       ${agentScopePredicate("n", { agentId: "$5" })}
       and ((name = $2 or name ~* $3 or summary ~* $3) or id::text = any($4))
       returning id, name`,
      [devices, name, rx, hookIds, agentId],
    );
    edges = await dropEdgesFor(devices, nodeRows.map((n) => n.id), agentId);
    logRows = await q(
      `delete from meera_log where (${logOwner}) and agent_id = (${logAgentP})::uuid
       and content ~* ${logP(1)} returning id`,
      [...logOwnerVals, rxWide],
    );
    telemetry = await purgeTelemetry(devices, { rx: rxWide });
    // P2-1: the same word, in the server's copy of the conversation and in the
    // analytics rows. Before the relational cascade, so that if the cascade
    // throws the receipt is never sent while the blob is still standing.
    synced = await purgeSyncedState(devices, { rx: rxWide });
    events = await purgeEvents(devices, { rx: rxWide });
    // the turn trace holds no words, so an item scope has nothing to match on
    // — called anyway, and returning 0, so the receipt's shape is the same on
    // every scope and a future rx-able column cannot land unwired
    traces = await purgeTurnTrace(devices, { rx: rxWide });
    // derived state: episodes citing the deleted rows, then everything citing
    // those episodes, lineage chased, snapshot replayed (§9.1 steps 2–6).
    // rxWide, not rx: the cascade is the half of forget that is actually good,
    // and handing it the un-widened term would be resolving the referent and
    // then throwing the answer away one line before the part that uses it.
    relational = await purgeRelational(devices, scope, {
      logIds: logRows.map((r) => r.id),
      rx: rxWide,
    });
    // #85: and the FILES those rows described. An item forget has no window,
    // so deletePhotos() (which needs one) never ran for this scope and the
    // JPEG outlived its own memory. Last, after every row delete has already
    // committed, and unable to fail the forget either way.
    photos = await deletePhotoObjects(devices, relational?.photoNames);
  } else if (scope === "session" || scope === "day") {
    const [from, to] = scope === "day" ? dayWindow(body) : [Number(body.from), Number(body.to)];
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return { error: "bad window" };
    const a = new Date(from).toISOString();
    const b = new Date(to).toISOString();
    const chan = body.channel === "call" ? "call" : body.channel === "chat" ? "chat" : null;
    logRows = await q(
      `delete from meera_log where (${logOwner}) and agent_id = (${logAgentP})::uuid
       and at >= ${logP(1)} and at < ${logP(2)}${chan ? ` and channel = ${logP(3)}` : ""}
       returning id`,
      chan ? [...logOwnerVals, a, b, chan] : [...logOwnerVals, a, b],
    );
    // updated_at, not created_at. A node last written inside the window had
    // its summary rewritten FROM that window's words — an older node that
    // came up again during the forgotten stretch is now carrying text from
    // it. Taking too much here is the safe direction; leaving the stretch
    // standing in summary form is not.
    nodeRows = await q(
      `delete from meera_nodes n where device_id = any($1::uuid[])
       ${agentScopePredicate("n", { agentId: "$4" })}
       and updated_at >= $2 and updated_at < $3
       returning id, name`,
      [devices, a, b, agentId],
    );
    edges = await dropEdgesFor(devices, nodeRows.map((n) => n.id), agentId);
    const inWindow = await q(
      `delete from meera_edges e where device_id = any($1::uuid[])
       ${agentScopePredicate("e", { agentId: "$4" })}
       and created_at >= $2 and created_at < $3 returning id`,
      [devices, a, b, agentId],
    ).catch(() => []);
    edges += inWindow.length;
    // The whole window goes, not just the events whose area matches `channel`.
    // "forget that call" is a time window; a chat event sitting inside it is
    // part of the same stretch, and the node delete directly above already
    // takes the window unfiltered for the same reason.
    telemetry = await purgeTelemetry(devices, { from, to });
    // P2-1: the same window, pruned out of the synced blob. This is the exact
    // arithmetic src/engine/memory.ts's `messagesAfterForget` runs on the
    // device — the two must agree, or the next sync merges the window back in
    // from whichever side kept it.
    synced = await purgeSyncedState(devices, { from, to });
    events = await purgeEvents(devices, { from, to });
    traces = await purgeTurnTrace(devices, { from, to });
    // the pictures they sent during that stretch go with it
    photos = await deletePhotos(devices, from, to).catch(() => 0);
    relational = await purgeRelational(devices, scope, {
      logIds: logRows.map((r) => r.id),
      from,
      to,
    });
    // #85, the same invariant from the other side: "the row is gone" must
    // imply "the file is gone" for every scope, not only the ones whose shape
    // happens to match the filename. A picture sent on Monday and TALKED ABOUT
    // on Tuesday has its fact deleted by a Tuesday day-forget (it cites
    // Tuesday's episode) while its object name carries Monday's stamp — so the
    // window sweep above skips it and it would otherwise survive its own
    // memory. Deduplicated by construction: a second delete of an object the
    // sweep already took returns nothing and adds nothing.
    photos += await deletePhotoObjects(devices, relational?.photoNames);
  } else {
    logRows = await q(
      `delete from meera_log where (${logOwner}) and agent_id = (${logAgentP})::uuid returning id`,
      logOwnerVals,
    );
    nodeRows = await q(
      `delete from meera_nodes n where device_id = any($1::uuid[])
       ${agentScopePredicate("n", { agentId: "$2" })} returning id, name`,
      [devices, agentId],
    );
    const e = await q(
      `delete from meera_edges e where device_id = any($1::uuid[])
       ${agentScopePredicate("e", { agentId: "$2" })} returning id`,
      [devices, agentId],
    ).catch(
      () => [],
    );
    edges = e.length;
    await q(
      `delete from meera_forget f where device_id = any($1::uuid[])
       ${agentScopePredicate("f", { agentId: "$2" })}`,
      [devices, agentId],
    ).catch(() => {});
    // a wipe takes telemetry outright, rollup included — rule 3
    telemetry = await purgeTelemetry(devices, { all: true });
    // P2-1: and the whole synced row. This is the one that made "forget
    // everything" a lie for every signed-in user: the graph went, the blob
    // stayed, and the next load_state handed the conversation back.
    synced = await purgeSyncedState(devices, { all: true });
    events = await purgeEvents(devices, { all: true });
    traces = await purgeTurnTrace(devices, { all: true });
    // a full wipe takes every picture, including any whose filename carries no
    // parseable timestamp — this is the one path that is allowed to be total
    photos = await deletePhotos(devices).catch(() => 0);
    // the whole relational store, manifest-driven, mapping row included
    relational = await purgeRelational(devices, "all");
  }

  if (scope !== "all") {
    const terms = nodeRows.map((n) => n.name);
    if (scope === "item") terms.push(String(body.name || "").trim().toLowerCase());
    // suppression extension (§9.1): names of deleted facts/kin, coined
    // phrases and currency topics join the list, so neither the extractor
    // nor the M3 consolidator can re-derive what the cascade just took
    if (relational?.terms?.length) terms.push(...relational.terms);
    await noteForgotten(devices, terms, agentId);
  }

  if (relational) delete relational.terms; // suppression list never leaves the server
  // likewise the object names: they are storage paths, and the receipt says
  // how many pictures went, never which ones
  if (relational) delete relational.photoNames;

  // ── A1: THE RECEIPT, AND WHAT SHE IS ENTITLED TO SAY ──────────────────────
  //
  // The worst failure available on this whole path is agreeing to forget and
  // then not deleting: "a person who claims to have forgotten you while
  // remembering your unfinished match is not forgetting, she is lying about
  // forgetting" (`activity-forgot-the-teardown`). Until now an item forget
  // that matched NOTHING returned ok:true with every count at zero and the
  // client showed a receipt anyway — a false receipt, on the strongest promise
  // in the product, and the more Hinglish the ask the more often it fired.
  //
  // Three outcomes, and only the first entitles her to the past tense:
  //   "done"   — rows went. Say so.
  //   "hedged" — the resolver did not answer; the deterministic matcher did,
  //              and it is the matcher we already know takes 5.9% of what an
  //              adversarial ask means. Rows DID go, so nothing she says is
  //              false, but the system records that the delete may be partial
  //              rather than pretending the two cases are the same.
  //   "none"   — nothing matched under either path. There is no receipt to
  //              give; the client asks which one they meant.
  //
  // Window scopes are not gated: "forget today" is its own referent and
  // deletes exactly the window it names, whether or not the window had
  // anything in it. There is no referent to resolve and so nothing to hedge.
  // Every counter in the receipt, summed. Read off the object rather than
  // listed by name on purpose: purgeRelational's return grows a key every time
  // a table joins the manifest, and a hand-written list here would go stale
  // silently and start reporting "nothing matched" for a delete that worked.
  const took =
    logRows.length + nodeRows.length + edges + photos + telemetry + events + traces +
    synced.rows + synced.rewritten +
    Object.values(relational ?? {}).reduce((a, v) => a + (typeof v === "number" ? v : 0), 0);
  const receipt =
    scope !== "item" ? "done" : took > 0 ? (hook?.used ? "done" : "hedged") : "none";

  return {
    ok: true,
    scope,
    // the receipt carries the OUTCOME and never the words: no term, no row
    // text, no candidate — a field naming the thing would outlive the memory
    // it deleted, which is the rule the diag call on this path already follows
    receipt,
    hook,
    deleted: {
      log: logRows.length,
      nodes: nodeRows.length,
      edges,
      photos,
      telemetry,
      events,
      traces,
      // `synced_state` reports the row delete and the rewrite separately: a
      // scoped forget that rewrote nothing and a scoped forget that had no row
      // to rewrite are different outcomes, and a single number cannot say which
      synced_state: synced,
      relational,
    },
  };
}

// Delete the actual image files, not just the rows that describe them.
//
// Forgetting used to clear every Postgres row and leave the uploaded pictures
// sitting in storage under `${device}/`, so "bhool ja jo maine bheja tha"
// deleted the description of a photo and kept the photo. That is the kind of
// gap that makes a privacy promise a lie, and it is invisible from inside the
// app because nothing in the UI ever lists the bucket.
//
// The upload path names each object `${device}/${Date.now()}-rand.jpg`, so the
// timestamp travels in the filename and a windowed forget can honour its own
// window instead of falling back to all-or-nothing.
async function deletePhotos(devices, from, to) {
  let total = 0;
  // The bucket prefixes every object with the uploading device's id, so unlike
  // the SQL above this widening is a loop rather than a predicate. Same law:
  // a picture sent from one surface is not a different person's picture.
  for (const device of devices) total += await deletePhotosForDevice(device, from, to);
  return total;
}

async function deletePhotosForDevice(device, from, to) {
  const prefix = `${device}/`;
  const paths = [];
  // list is paginated; the upload quota caps a device at 500 objects, so this
  // terminates well inside a serverless invocation
  for (let offset = 0; offset < 600; offset += 100) {
    const page = await fetch(`${SB_URL}/storage/v1/object/list/meera-photos`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefix, limit: 100, offset }),
    })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
    if (!Array.isArray(page) || !page.length) break;
    for (const o of page) {
      const name = String(o?.name || "");
      if (!name) continue;
      if (Number.isFinite(from) && Number.isFinite(to)) {
        // an object whose name does not carry a parseable stamp cannot be
        // proven to be inside the window, and a forget must not delete what it
        // cannot account for — the full wipe is the path that takes everything
        const stamp = Number(name.split("-")[0]);
        if (!Number.isFinite(stamp) || stamp < from || stamp >= to) continue;
      }
      paths.push(prefix + name);
    }
    if (page.length < 100) break;
  }
  return deleteStorageObjects(paths);
}

/** The DELETE half, shared by the window/whole-wipe sweep above and by the
 *  by-name path below, so there is one place that knows how a photo object is
 *  actually removed. */
async function deleteStorageObjects(paths) {
  if (!paths.length) return 0;
  const del = await fetch(`${SB_URL}/storage/v1/object/meera-photos`, {
    method: "DELETE",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefixes: paths }),
  }).catch(() => null);
  if (!del || !del.ok) return 0;
  const done = await del.json().catch(() => []);
  return Array.isArray(done) ? done.length : paths.length;
}

// ── #85: "forget THIS photo" has to take the JPEG too ──────────────────────
//
// deletePhotos() above covers the two scopes that can name a TIME — a window
// forget and a whole wipe — because the upload path puts the timestamp in the
// object name. The `item` scope has no window, so it never called it: asking
// her to forget one picture deleted the row describing it and left the file
// sitting in public storage under `${device}/`. Same class of gap as the one
// deletePhotos() itself was written for, one scope over, and just as invisible
// from inside the app because nothing in the UI ever lists the bucket.
//
// The handle that makes an item forget reach a FILE is recordPhotoMemory's
// vy_fact name: `photo:${photoIdFromUrl(url)}`, where the id is the storage
// object's own basename (opUploadPhoto: `${device}/${ts}-${rand}.jpg`). So the
// cascade already deletes a row that names the file, and this turns that name
// back into a path. No new table, no new column, no URL stored anywhere new.
//
// The residual, stated rather than implied: a photo whose describe call failed
// or was refused (lintPhotoDesc → null) never got a fact row, so no scope but a
// window or a whole wipe can find its file. That is a real gap and it is not
// closable from here — there is nothing that names the object — which is
// exactly why the whole-wipe path is allowed to be total.

/** `photo:1730000000000-ab12cd` → `${device}/1730000000000-ab12cd.jpg`.
 *  Pure, and STRICT about the id shape on purpose: photoIdFromUrl falls back
 *  to a 40-char URL tail for anything not shaped like an upload of ours, and
 *  a fallback tail must never be pasted into a delete path. Anything that does
 *  not match is simply not a file this device uploaded. */
export function photoPathsFromFactNames(device, names) {
  const out = new Set();
  for (const raw of Array.isArray(names) ? names : []) {
    const m = /^photo:(\d{6,}-[a-z0-9]{2,12})$/i.exec(String(raw || "").trim());
    if (m) out.add(`${device}/${m[1]}.jpg`);
  }
  return [...out];
}

/** Best-effort, logged, and structurally unable to fail a forget: it runs
 *  AFTER every row delete has already succeeded, it swallows its own errors,
 *  and its return value is a count for the receipt, never a condition. The
 *  rows are the promise; the file is the promise kept. */
async function deletePhotoObjects(devices, factNames) {
  const paths = devices.flatMap((d) => photoPathsFromFactNames(d, factNames));
  if (!paths.length) return 0;
  try {
    const n = await deleteStorageObjects(paths);
    if (n < paths.length) {
      // a file that outlived its row is the exact failure this exists to
      // prevent, so it is said out loud rather than absorbed into a count
      console.warn(`[forget] ${paths.length - n} photo object(s) survived their memory row`);
    }
    return n;
  } catch (e) {
    console.warn("[forget] photo object delete failed:", e?.message || "unknown");
    return 0;
  }
}

// ── the picture upload, one or five (WS-RESILIENCE ← WS-COMPOSER handoff) ──
//
// Per image, on the base64 as sent. This is the number that already shipped on
// the single-photo path and it stays exactly that number: it is looser than
// api/_lanes.js's chat-payload cap on purpose, because these are different
// pipes. The chat cap bounds N images inside ONE model request (vision tokens,
// real money, a platform body limit); this bounds ONE object going into
// storage. Tightening it here to "be consistent" would reject photos that
// upload fine today, which is a regression dressed as tidiness.
const PHOTO_B64_MAX = 2_200_000;
// A batch together. Five at the per-image cap would be 11MB in one request
// body, which is past what a serverless function should be handed; the real
// composer compresses to a few hundred KB each, so this never binds in practice
// and binds hard on a client that stops compressing.
const PHOTO_BATCH_B64_MAX = 6_000_000;
// 500 photos per device is far beyond real use. A public write endpoint with no
// ceiling is a storage bill waiting to happen.
const PHOTO_PER_DEVICE_MAX = 500;

/** `"data:image/jpeg;base64,xxx"` or bare base64 → the base64 payload. The
 *  legacy path sends bare base64; the composer sends data URLs. */
function photoB64(raw) {
  const s = String(raw || "");
  if (!s.startsWith("data:")) return s;
  const comma = s.indexOf(",");
  return comma < 0 ? "" : s.slice(comma + 1);
}

/** How many objects this device already has. `null` when unknown — the caller
 *  allows the upload rather than breaking photos over a failed count. */
async function photoCount(device) {
  try {
    const list = await fetch(`${SB_URL}/storage/v1/object/list/meera-photos`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefix: `${device}/`, limit: PHOTO_PER_DEVICE_MAX + 1 }),
    }).then((r) => (r.ok ? r.json() : null));
    return Array.isArray(list) ? list.length : null;
  } catch {
    return null;
  }
}

/**
 * ONE object name, in the shape the forget cascade can turn back into a path.
 *
 * `photoPathsFromFactNames` matches `/^photo:(\d{6,}-[a-z0-9]{2,12})$/` and
 * `photoIdFromUrl` matches `/\/([0-9]+-[a-z0-9]+)\.jpe?g$/`. So the name has
 * exactly ONE dash and a lower-case alphanumeric suffix — an index appended for
 * batch uniqueness (`…-ab12cd-3.jpg`) would carry TWO dashes, would silently
 * stop matching both, and the JPEG would outlive the memory row describing it
 * on an item-scope forget. That is `pk-is-an-arbiter`'s shape: an object name is
 * also a parser's input, and changing it changes every reader that parses it.
 * In-batch uniqueness is bought with a longer random suffix (still inside
 * `{2,12}`) plus an explicit collision check, rather than with a new segment.
 */
function photoPath(device, taken) {
  for (let i = 0; i < 8; i++) {
    const p = `${device}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
    if (!taken.has(p)) {
      taken.add(p);
      return p;
    }
  }
  return null;
}

/** Store one buffer. Returns the public URL, or null. */
async function putPhoto(path, buf, mime) {
  const up = await fetch(`${SB_URL}/storage/v1/object/meera-photos/${path}`, {
    method: "POST",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": mime,
      "x-upsert": "false",
    },
    body: buf,
  }).catch(() => null);
  if (!up || !up.ok) return null;
  return `${SB_URL}/storage/v1/object/public/meera-photos/${path}`;
}

/**
 * `{ data, mime } → { url }` (legacy, unchanged) or
 * `{ images: [dataUrl|base64, …≤5], mime } → { urls: [...] }` (batch).
 *
 * The batch exists so the composer stops paying five round trips for one send.
 * The legacy shape is answered exactly as before, because it is what every
 * already-installed build still sends and what the describe-then-remember path
 * uses.
 *
 * `caption` is accepted and deliberately IGNORED: the caption is the message's
 * own text (`Message.text` in store.ts) and this endpoint stores bytes. Two
 * homes for one caption is two things to keep in sync, and the second reader is
 * the one that derives it wrongly (`duration-is-seconds`).
 *
 * ALL OR NOTHING. If any image in a batch fails, the ones that succeeded are
 * deleted and the whole call reports failure — so the client's documented
 * per-image fallback cannot double-write and leave orphan JPEGs. A
 * half-succeeded batch is precisely the shape that produces files with no row
 * describing them, which is the one residual the forget cascade cannot reach
 * (see the `#85` note above).
 */
async function opUploadPhoto(device, body) {
  const mime = /^image\/(jpeg|png|webp)$/.test(String(body.mime)) ? body.mime : "image/jpeg";
  const batch = Array.isArray(body.images);

  // ── validate ──
  const raw = batch ? body.images : [body.data];
  if (batch && raw.length > MAX_IMAGES) return { error: "too many images" };
  const bufs = [];
  let total = 0;
  for (const item of raw) {
    const b64 = photoB64(item);
    if (b64.length > PHOTO_B64_MAX) return { error: "too large" };
    total += b64.length;
    if (total > PHOTO_BATCH_B64_MAX) return { error: "too large" };
    const buf = Buffer.from(b64, "base64");
    // An empty entry fails the WHOLE call rather than being skipped: the
    // contract is `urls` the same length as `images`, and a silently shorter
    // array would pair picture 4 with picture 5's URL in the thread.
    if (!buf.length) return { error: "empty" };
    bufs.push(buf);
  }
  if (!bufs.length) return { error: "empty" };

  // ── quota, once for the whole batch ──
  const have = await photoCount(device);
  if (have !== null && have + bufs.length > PHOTO_PER_DEVICE_MAX) {
    return { error: "photo limit reached" };
  }

  // ── store ──
  const taken = new Set();
  const paths = bufs.map(() => photoPath(device, taken));
  if (paths.some((p) => !p)) return { error: "upload failed" };
  const urls = await Promise.all(paths.map((p, i) => putPhoto(p, bufs[i], mime)));
  if (urls.some((u) => !u)) {
    const orphans = paths.filter((_, i) => urls[i]);
    if (orphans.length) {
      const n = await deleteStorageObjects(orphans).catch(() => 0);
      if (n < orphans.length) {
        console.warn(`[upload] ${orphans.length - n} orphan object(s) from a partial batch`);
      }
    }
    return { error: "upload failed" };
  }
  // Both keys on both paths, so a client mid-rollout works either way and
  // neither reader can be broken by the other's shape.
  return batch ? { urls, url: urls[0] } : { url: urls[0], urls };
}

// ── WS-PHOTOS: the photo → relational record delta (docs/PHOTOS.md,
// docs/SPEC-SELF-LAYER.md §4 point 3) ───────────────────────────────────────
//
// THE GAP this closes: opDescribe's output used to inform one reply, client-
// side, and die there — `rememberFrom` (src/engine/memory.ts) filters its
// 16-turn window to `m.kind === "text"` before it ever reaches opRemember, so
// a photo message NEVER entered the extraction pass at all. Nothing about a
// photo reached vy_episode or vy_fact by any route. This block is that route,
// and it is entirely server-side: it rides the SAME "describe" call the
// client already makes right after upload, so no client file changes.
//
// THE FABRICATION GUARD (vision-fab, visiongate-powered — context/
// measurements.md) is the actual design constraint, not a footnote:
// visiongate-powered measured 10.2%/11.2% [7.3,14.1]/[9.1,13.8] fabrication
// for grok-4-20 — a STRONGER model than the "-lite" tier used here, given
// MULTIPLE frames of continuity, scene-change gating, and a tuned directive,
// at n>300. opDescribe has none of that: one downscaled JPEG, the cheapest
// model tier, a single 110-char guess, no self-reported confidence, no
// permission in its own prompt to say "can't tell". Treating its output as
// more trustworthy than the measured, better-resourced lane would be
// dishonest, so this path is deliberately more conservative than opRemember's
// text-extraction default (confidence 0.7): see PHOTO_VISION_CONFIDENCE.
//
// THE DESIGN, and why it stops where it stops:
//   1. An episode (channel 'chat' — see the comment at its call site for why
//      no 'photo' value exists to use instead).
//   2. The raw description as a vy_visual_assertion CLAIM — correctable,
//      inspectable, cited to the episode, NEVER promoted into vy_fact. This
//      is the watch lane's own law verbatim ("claims and reactions are
//      SEPARATE OBJECTS... a later-corrected visual claim must not delete a
//      genuine emotional beat") applied to the one photo has that the watch
//      lane doesn't: no verified reaction to anchor a vy_shared_moment on.
//      This workstream has no access to what she actually said back (that
//      lives in api/chat.js's reply generation, outside these exclusive
//      files), so writing to vy_shared_moment here would mean inventing a
//      "reaction" — exactly the confident-placeholder failure this repo's
//      `error-marked-done` law already names. Left unused for photos.
//   3. A vy_fact carrying the description, hedged in its own body, at
//      PHOTO_VISION_CONFIDENCE — because vy_fact is the only table either
//      retrieval leg reads, so a photo that is not in it is a photo she does
//      not have.
//
//      SUPERSEDED RULING, kept because the reasoning still binds the shape.
//      This point used to read "the ONE thing this path writes to vy_fact:
//      that a photo was shared. Nothing about its content." — reasoning that a
//      photo-content claim has no correcting pass (true: consolidate.js
//      re-derives from meera_log, and meera_log carries only the `[photo]`
//      marker, never the vision description), so the claim must stay in
//      vy_visual_assertion. The conclusion was wrong in a way that took a
//      field survey to see: the content stayed out of vy_fact and NOTHING
//      READ vy_visual_assertion, so the result was not a conservative memory,
//      it was no memory — every photo produced the identical row "shared a
//      photo" and "wo plant wali photo" could not be answered by any path.
//      Refusing to store a thing is not the same as storing it carefully.
//
//      What the old reasoning correctly establishes is that the claim can
//      never be treated as verified, and that constraint is now carried by
//      the ROW instead of by its absence: 0.35 confidence, `sensitive`, and
//      the hedge inside the body text where no reader can drop it. The claim
//      also still goes to vy_visual_assertion, which remains the correctable
//      object and is now read by opRecall's watched-together leg (P1-1).
//
// A failed, empty, or refused description writes NOTHING — no episode touch,
// no assertion, no fact — per lintPhotoDesc() below.

const PHOTO_DESC_MODEL = "google/gemini-3.1-flash-lite";

// Not model-self-reported: opDescribe's prompt never asks for a confidence
// score (unlike the watch lane's real vision pipeline, which is outside this
// file). A fabricated confidence number would be worse than an honest fixed
// one, so this is a constant, and it is deliberately BELOW opRemember's 0.7
// extracted-text default — see the block comment above for the measured
// numbers this is conservative against.
const PHOTO_VISION_CONFIDENCE = 0.35;

// A model asked to "describe this photo in one factual line" tends to
// apologize instead of returning nothing when it genuinely can't — that
// apology must not become an episode/assertion/fact about a photo nobody
// actually described.
const PHOTO_REFUSAL_RE =
  /^(i'?m sorry|sorry[, ]|i can'?t|i cannot|unable to|no image|cannot (see|view|describe)|can'?t (see|view|describe)|as an ai|i (do not|don't) have)/i;

/** Telegraphic write-time lint (consolidate.js's `telegraphic()` / derive-
 *  adapter.mjs's `shapeLint()` convention, duplicated here for the same
 *  stated reason both of those give: no bundler boundary shared with
 *  src/engine/shapelint.ts, and this is a different table's write-time
 *  discipline, not the compiler's read-time authority). Returns null — never
 *  an empty string — for anything that must write nothing. */
export function lintPhotoDesc(raw) {
  const t = String(raw || "").trim().replace(/\s+/g, " ");
  if (t.length < 4) return null;
  if (PHOTO_REFUSAL_RE.test(t)) return null;
  return t.replace(/[.!?]+$/, "").slice(0, 140);
}

/** Stable per-photo key from the storage object name (`${device}/${ts}-
 *  ${rand}.jpg` — opUploadPhoto's own naming), so a duplicate describe call
 *  for the same photo (client retry, double-tap) cannot double-write the
 *  event fact. Falls back to a URL tail for anything not shaped that way. */
export function photoIdFromUrl(url) {
  const m = /\/([0-9]+-[a-z0-9]+)\.jpe?g$/i.exec(String(url || ""));
  return m ? m[1] : String(url || "").slice(-40);
}

/** The write path itself. Never throws — an enhancement layered on a call
 *  whose primary job (handing the client a description) already happened;
 *  this must never cost the client that response. */
export async function recordPhotoMemory(device, url, rawDesc) {
  const desc = lintPhotoDesc(rawDesc);
  if (!desc) return { ok: true, wrote: false };
  try {
    const agentId = MEERA_AGENT_ID;
    const person = await personIdFor(device);
    // Closest LEGAL channel: vy_episode.channel's CHECK constraint (verified
    // live) is exactly ('chat','call','watch','voicenote') — there is no
    // 'photo' value, and adding one is a migration this workstream cannot
    // apply. 'watch' is the live watch-TOGETHER lane, a different object
    // under its own vision-fab governance; 'voicenote' is an audio message.
    // A photo sent inline in the chat stream is, structurally, a chat-
    // channel event, and meera_log already logs its `[photo]` marker under
    // channel:'chat' (src/components/Chat.tsx logTurns) — so this reuses
    // that value rather than overloading either of the other two.
    const ep = await openOrExtendEpisode(person, device, "chat", { agentId });
    if (!ep) return { ok: false, wrote: false };
    // ── P2-3: THIS USED TO CLOBBER THE OPEN EPISODE'S SUMMARY ──────────────
    //
    // `touchEpisode(ep.id, { summary })` is an unconditional `summary = $n`.
    // openOrExtendEpisode EXTENDS the open chat episode rather than opening a
    // new one (that is its whole job — a photo sent mid-conversation is the
    // same stretch of conversation), so this overwrote whatever opRemember had
    // just derived from the actual exchange with `photo: a plate of pasta`.
    // Send four photos in an afternoon and the episode summary for that
    // afternoon is the fourth photo — and since consolidate.js's WE_TOKEN_RE
    // classification and the rel bundle's `weEpisodes` both read that summary,
    // a whole afternoon of conversation was represented downstream by a
    // caption. A write that silently replaces a better-derived value is the
    // `silent-truncation` shape one table over.
    //
    // The fix is one statement and it does both jobs: bump `ended_at` (the
    // episode is still live — that is what touchEpisode is for) and set the
    // summary ONLY if nothing has derived one yet. A fresh provisional episode
    // has `summary = ''` (episodes.js's insert), so a photo that genuinely
    // opens a stretch still names it; a photo landing inside a stretch that
    // already means something leaves that meaning alone. Written inline rather
    // than as a touchEpisode option because touchEpisode is a writer owned by
    // api/episodes.js and this workstream holds only its readers.
    await q(
      `update vy_episode
          set ended_at = now(),
              summary = case when coalesce(summary, '') = '' then $2 else summary end
        where id = $1`,
      [ep.id, `photo: ${desc}`.slice(0, 110)],
    ).catch(() => {});

    // THE CLAIM — kept out of vy_fact. See the block comment above.
    await writeVisualAssertion(
      person,
      ep.id,
      { claim: desc, extractorModel: PHOTO_DESC_MODEL, confidence: PHOTO_VISION_CONFIDENCE, illegible: false },
      agentId,
    );

    // THE EVENT — the ONLY thing this path writes to vy_fact, cited to the
    // episode like any other fact, and marked sensitive: a photo may contain
    // a person, a document, an address, a medical detail that text never
    // would, and that cannot be verified either way from here.
    const photoId = photoIdFromUrl(url);
    const factName = `photo:${photoId}`.slice(0, 60);
    const already = await q(
      `select 1 from vy_fact f where f.person_id = $1 and f.name = $2
        ${agentScopePredicate("f", { agentId: "$3" })} limit 1`,
      [person, factName, agentId],
    ).catch(() => []);
    if (already.length) return { ok: true, wrote: false, episodeId: ep.id };
    // ── P1-1: THE PHOTO FACT WAS A DEAD WRITE ─────────────────────────────
    //
    // The body was the literal string "shared a photo", with no embedding.
    // Read it back through either retrieval leg and that is all it says: every
    // photo anybody ever sent produced the identical row, so the keyword leg
    // could only ever match the word "photo" and the semantic leg had no
    // vector at all. "wo plant wali photo" was unanswerable, and a store that
    // holds one indistinguishable row per event holds no memory of any of them.
    //
    // WHAT CHANGED, AND WHAT DID NOT. The body now carries the description, so
    // the row is reachable. Everything that made the old design conservative
    // is kept and is now doing its job at the point where it matters:
    //
    //   - the CLAIM still lives in vy_visual_assertion, written above. That is
    //     still the correctable, inspectable object carrying the extractor
    //     model and the confidence, and it is still what the watch lane's law
    //     ("claims and reactions are SEPARATE OBJECTS") is about.
    //   - `confidence` on the fact is PHOTO_VISION_CONFIDENCE (0.35), not the
    //     0.9 it used to claim for "shared a photo". The old number was honest
    //     about the old body — that a photo was shared is certain — and would
    //     have been a lie about this one.
    //   - the HEDGE IS IN THE BODY, not in a prompt rule. `looked like:` rides
    //     the row into every reader — keyword, semantic, co-citation, export,
    //     a future consumer nobody has written — because docs/RELATIONALOS.md
    //     measured an instruction leaking 57–98% of the time against a
    //     predicate leaking 0 in 31,122, and a hedge that lives in the render
    //     is an instruction. It cannot be separated from the claim it hedges.
    //   - `sensitive` stays true: a photo may hold a face, a document, an
    //     address or a medical detail that text never would.
    //
    // The residual the old comment named is real and unchanged: consolidate.js
    // derives from meera_log, meera_log holds only the `[photo]` marker, so no
    // nightly pass will ever correct a photo-content claim. That is precisely
    // why the confidence and the hedge are attached to the row itself rather
    // than left to a reviewer who is never coming.
    const body = `photo they sent — looked like: ${desc}`.slice(0, 160);
    const ins = await q(
      `insert into vy_fact
         (agent_id, person_id, kind, name, body, provenance, confidence, citations, sensitive, provisional)
       values (${agentValue("$5")},$1,'user',$2,$3,'extracted',${PHOTO_VISION_CONFIDENCE},$4::bigint[],true,true)
       returning id`,
      [person, factName, body, [ep.id], agentId],
    );
    // An embedding, for the reason api/_embed.js states and this path was the
    // counter-example to: "an embedding is an enhancement, never the only path
    // to a memory" — here it was neither, because there was no path at all.
    // Same posture as every other embed in this file: batched into nothing,
    // best-effort, and structurally unable to cost the row it decorates.
    const factId = ins?.[0]?.id;
    if (factId) {
      const vec = await embedOne(body).catch(() => null);
      if (vec) {
        await q(
          `insert into vy_embedding (agent_id, owner_kind, owner_id, person_id, v)
           values (${agentValue("$4")}, 'fact', $1, $2, $3::halfvec)
           on conflict (owner_kind, owner_id) do update set v = excluded.v, at = now()`,
          [factId, person, toHalfvecLiteral(vec), agentId],
        ).catch(() => {});
      }
    }
    return { ok: true, wrote: true, episodeId: ep.id };
  } catch {
    return { ok: false, wrote: false };
  }
}

async function opDescribe(body) {
  const device = String(body.device || "");
  const url = String(body.url || "");
  if (!url.startsWith(`${SB_URL}/storage/v1/object/public/meera-photos/`)) return { desc: "" };
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OR_KEY}`,
      "Content-Type": "application/json",
      "X-Title": "Meera",
    },
    body: JSON.stringify({
      model: PHOTO_DESC_MODEL,
      max_tokens: 90,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Describe this photo in one factual line (<=110 chars) for a chat log, e.g. 'a plate of pasta on a desk' or 'screenshot of a code error in vs code'. Only the line.",
            },
            { type: "image_url", image_url: { url } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) return { desc: "" };
  const data = await res.json();
  const desc = String(data?.choices?.[0]?.message?.content || "").trim().slice(0, 140);
  // Fire-and-forget from the CLIENT's point of view is not the same thing as
  // unawaited here: this function must finish writing before the response
  // goes out (the handler does `await opDescribe(...)`), but describePhoto()
  // is itself called from a background `.then()` in Chat.tsx that runs after
  // the reply is already scheduled — so this added latency sits behind
  // nothing the user is waiting on. `.catch` belt-and-braces on top of the
  // try/catch already inside recordPhotoMemory: this path must never cost
  // the client its `desc`.
  if (UUID.test(device)) await recordPhotoMemory(device, url, desc).catch(() => {});
  return { desc };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "memory", 60)) return res.status(429).json({ error: "slow down" });
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: "no backend configured" });

  try {
    const { op, device } = req.body || {};
    if (!UUID.test(String(device || ""))) return res.status(400).json({ error: "device uuid required" });
    if (op === "log") return res.status(200).json(await opLog(device, req.body));
    if (op === "upload_photo") return res.status(200).json(await opUploadPhoto(device, req.body));
    if (op === "describe") return res.status(200).json(await opDescribe(req.body));
    if (op === "recall") return res.status(200).json(await opRecall(device, req.body));
    if (op === "seed_currency") return res.status(200).json(await opSeedCurrency(device, req.body));
    if (op === "remember") return res.status(200).json(await opRemember(device, req.body));
    if (op === "activity") return res.status(200).json(await opActivity(device, req.body));
    if (op === "forget") return res.status(200).json(await opForget(device, req.body));
    return res.status(400).json({ error: "unknown op" });
  } catch (e) {
    // the message goes to the server log only — the client gets the same
    // opaque error it always did, but an operator can now see WHICH statement
    // a forget died on instead of diagnosing "memory failure" from nothing
    console.error("[memory] op failed:", e?.message || e);
    return res.status(500).json({ error: "memory failure" });
  }
}
