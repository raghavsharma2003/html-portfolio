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
// documented at noteForgotten(). Every statement in here is scoped by
// device_id: the device is the identity, so a device can only ever delete
// its own rows.

import { allow, ipOf } from "./_ratelimit.js";
import { q } from "./_db.js";
// WS-CONSOLIDATE (M3) deltas to opRemember/opRecall only — see the two
// functions below for the marked sections. embedOne/toHalfvecLiteral back
// opRecall's semantic pre-filter (SPEC §0.3: halfvec, person-filtered exact
// scan, no HNSW); openOrExtendEpisode/touchEpisode back opRemember's in-turn
// provisional tier (SPEC §0.2.1/§4.1) and are shared with api/episodes.js and
// api/consolidate.js so the boundary rule lives in exactly one place.
import { embedOne, embedBatch, toHalfvecLiteral } from "./_embed.js";
import { openOrExtendEpisode, touchEpisode } from "./episodes.js";

import {
  OPENROUTER_KEY,
  SUPABASE_URL,
  SUPABASE_KEY,
  AZURE_ENDPOINT,
  AZURE_KEY,
} from "./_config.js";

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

async function opLog(device, body) {
  const turns = (Array.isArray(body.turns) ? body.turns : []).slice(0, 30);
  if (!turns.length) return { ok: true };
  const values = [];
  const params = [];
  let p = 1;
  for (const t of turns) {
    values.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
    params.push(
      device,
      t.role === "her" ? "her" : "me",
      t.channel === "call" ? "call" : "chat",
      typeof t.kind === "string" ? t.kind.slice(0, 20) : "text",
      String(t.content || "").slice(0, 4000),
      Number.isFinite(t.at) ? new Date(t.at).toISOString() : new Date().toISOString(),
    );
  }
  await q(
    `insert into meera_log (device_id, role, channel, kind, content, at) values ${values.join(",")}`,
    params,
  );
  return { ok: true };
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
  "hai", "hain", "tha", "thi", "the", "hoga", "hogi", "kyun", "kyu", "kaam", "baat", "bolo", "bola",
]);

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
async function fetchRelBundle(person) {
  const stateRows = await q(`select * from vy_rel_state where person_id = $1`, [person], 2_500).catch(() => []);
  if (!stateRows.length) return null;
  const s = stateRows[0];
  const [honorificRow, patterns, rituals, currency, profile, weEpisodes, phrases] = await Promise.all([
    q(
      `select at from vy_rel_event where person_id = $1 and dim = 'honorific' order by at desc limit 1`,
      [person],
    ).catch(() => []),
    // renderDyadicActive (relstate.ts) does the moment-match + top-3 slice
    // client-side; server hands over every currently-eligible pattern
    // (bounded to 20) so the moment gate has real candidates to filter.
    q(
      `select id, person_id, moment, if_shape, then_note, self_in_relation, citations,
              support_count, distinct_days, prompt_eligible, times_contradicted, t_invalid, last_used
         from vy_pattern
        where person_id = $1 and t_invalid is null and prompt_eligible = true
        order by support_count desc limit 20`,
      [person],
    ).catch(() => []),
    q(
      `select person_id, key, last_at, count, cold_last, citations from vy_ritual where person_id = $1`,
      [person],
    ).catch(() => []),
    q(
      `select person_id, topic, kind, last_used, uses, citations from vy_currency where person_id = $1`,
      [person],
    ).catch(() => []),
    q(`select home_region from vy_india_profile where person_id = $1`, [person]).catch(() => []),
    // participation='we' only (renderWeCallbacks' own WE_TOKEN_RE re-checks
    // this client-side too — belt-and-braces, cheap, matches shapelint's own
    // two-layer convention)
    q(
      `select id, summary, started_at as at from vy_episode
        where person_id = $1 and participation = 'we' and superseded_by is null
        order by started_at desc limit 10`,
      [person],
    ).catch(() => []),
    q(
      `select phrase, gloss from vy_phrase where person_id = $1
        order by last_used desc nulls last, coined_at desc limit 20`,
      [person],
    ).catch(() => []),
  ]);

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

async function opRecall(device, body) {
  const query = String(body.query || "").toLowerCase();
  const words = [...new Set(query.match(/[a-z]{4,}|[ऀ-ॿ]{3,}/g) || [])]
    .filter((w) => !RECALL_STOP.has(w))
    .slice(0, 6);

  const COLS = "id, name, kind, summary, feel, updated_at";
  // STANDING BACKGROUND is what she carries without being asked, so it must be
  // the big durable things — not last week's loudest topic. Identity kinds
  // (who they are, where they are, what they like) hold their weight; episodic
  // kinds fade with age, the way a person's does. A felt memory arrives with
  // extra salience at write time, so it outlives an equally-old flat one.
  // 'phrase' sits with the identity kinds on purpose: a word the two of them
  // coined is the least perishable thing in the whole store — a callback that
  // survived three weeks is worth ten inside the same chat, and it is exactly
  // what the 90-message context window cannot hold on its own.
  const RANK = `salience * case when kind in ('person','place','preference','fact','phrase') then 1.0
                 else greatest(0.25, 1.0 - extract(epoch from (now() - updated_at)) / (86400.0 * 60)) end`;
  const fetches = [
    q(
      `select ${COLS} from meera_nodes where device_id = $1
       order by ${RANK} desc, updated_at desc limit 4`,
      [device],
    ),
  ];
  if (words.length) {
    const clauses = [];
    const params = [device];
    let p = 2;
    for (const w of words) {
      // word-boundary match, not substring: `ilike '%rate%'` hits "corporate"
      // and hands her a memory the message never referred to
      clauses.push(`name ~* $${p} or summary ~* $${p}`);
      params.push(`\\m${w}\\M`);
      p++;
    }
    fetches.push(
      q(
        `select ${COLS} from meera_nodes where device_id = $1 and (${clauses.join(" or ")})
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
  const semanticFetch = (async () => {
    const trimmed = String(body.query || "").trim();
    if (trimmed.length < 3) return [];
    const vec = await embedOne(trimmed).catch(() => null);
    if (!vec) return [];
    const person = await personPromise;
    const lit = toHalfvecLiteral(vec);
    return q(
      `select f.id, f.kind, f.name, f.body, f.feel, f.created_at
         from vy_embedding e
         join vy_fact f on f.id = e.owner_id and f.person_id = e.person_id
        where e.person_id = $1 and e.owner_kind = 'fact'
          and f.t_invalid is null and f.retracted_at is null
        order by e.v <=> $2::halfvec
        limit 6`,
      [person, lit],
      2_500,
    ).catch(() => []);
  })();
  // WS-INTEGRATE seam 1: run concurrently with everything else in this
  // function — one extra batched round trip, never a serial one (SPEC §3.3
  // retrieval-budget discipline). Any failure degrades to `relstate: null`,
  // same as the "no consolidation yet" case — never blocks recall.
  const relBundleFetch = personPromise.then((person) => fetchRelBundle(person)).catch(() => null);

  const [[bgRaw, matchedRaw = []], semanticRaw, relBundle] = await Promise.all([
    Promise.all(fetches),
    semanticFetch,
    relBundleFetch,
  ]);
  const background = Array.isArray(bgRaw) ? bgRaw : [];
  const matched = Array.isArray(matchedRaw) ? matchedRaw : [];
  const semantic = (Array.isArray(semanticRaw) ? semanticRaw : []).slice(0, 4);
  const seen = new Map();
  for (const n of [...matched, ...background]) seen.set(n.id, n);
  // relstate is independent of graph recall — a person with no matched/
  // background/semantic memories yet may still have a real relstate bundle
  // (or vice versa), so it rides both return paths, never conditioned on
  // `seen.size`.
  if (!seen.size && !semantic.length) return { memories: "", relstate: relBundle };

  const idArr = [...seen.keys()];
  const edges = await q(
    `select * from meera_edges where device_id = $1 and (src = any($2) or dst = any($2)) limit 30`,
    [device, idArr],
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
      `select id, name from meera_nodes where device_id = $1 and id = any($2)`,
      [device, [...missing]],
    ).catch(() => []);
    for (const n of Array.isArray(extra) ? extra : []) names.set(n.id, n.name);
  }

  // A dated or forward-looking fact goes stale silently: "shaadi december me
  // h" recalled fourteen months later is not news, it's a wrong statement.
  // Flagging it in the data beats hoping the model does the date arithmetic.
  const TIME_BOUND =
    /\b(jan|feb|march|april|may|june|july|aug|sept|oct|nov|dec|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|next|upcoming|soon|planning|plans?|will|shaadi|wedding|exam|interview|trip|due|deadline|weekend|birthday|\d{4}|\d{1,2}(st|nd|rd|th))\b/i;
  const staleNote = (n) => {
    const days = (Date.now() - new Date(n.updated_at).getTime()) / 86_400_000;
    if (!(days > 45)) return "";
    if (n.kind !== "plan" && n.kind !== "event" && !TIME_BOUND.test(n.summary || "")) return "";
    return " ← whatever was ahead in this has already happened; talk about it as past and let them tell you how it went";
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
    return `- ${n.name} (${n.kind}, last came up ${ageLabel(n.updated_at)}): ${n.summary}${felt}${rel ? ` [${rel}]` : ""}${staleNote(n)}`;
  };

  // matched-vs-background stays labelled: background is continuity, not a
  // prompt to bring six unrelated facts into a reply about something else
  const matchedIds = new Set(matched.map((n) => n.id));
  const blocks = [];
  if (matched.length) blocks.push(`RELEVANT TO WHAT THEY JUST SAID:\n${matched.map(line).join("\n")}`);
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
  const namesShown = new Set([...matched, ...background].map((n) => String(n.name || "").toLowerCase()));
  const semanticOnly = semantic.filter((f) => f && !namesShown.has(String(f.name || "").toLowerCase()));
  if (semanticOnly.length) {
    const factLine = (f) => {
      const felt = f.feel ? ` — their own words for it: "${f.feel}"` : "";
      return `- ${f.name} (${f.kind}, last came up ${ageLabel(f.created_at)}): ${f.body}${felt}`;
    };
    blocks.push(
      `ALSO RELEVANT (no shared words with what they said, but the same thing):\n${semanticOnly
        .map(factLine)
        .join("\n")}`,
    );
  }

  // touch recall time (awaited — serverless kills post-response work)
  await q(`update meera_nodes set last_recalled = now() where device_id = $1 and id = any($2)`, [
    device,
    idArr,
  ]).catch(() => {});

  return { memories: blocks.join("\n"), relstate: relBundle };
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
    await q(
      `insert into vy_currency (person_id, topic, kind, last_used, uses, citations)
       values ($1,$2,$3, now(), 1, '{}'::bigint[])
       on conflict (person_id, topic) do update set
         last_used = now(), uses = vy_currency.uses + 1`,
      [person, topic, kind],
    ).catch(() => {});
    written++;
  }
  return { ok: true, written, skipped };
}

async function opRemember(device, body) {
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

  // THE RE-DERIVATION GUARD. This pass runs over the transcript still on
  // their screen, so a thing deleted last turn is sitting right there to be
  // extracted again. Filtering happens BEFORE the upsert — not by deleting
  // it again afterwards — so a forgotten fact is never written at all.
  // Checked against name AND summary, because a term filtered out of the
  // name walks straight back in through the summary.
  const forgotten = await q(
    `select term from meera_forget where device_id = $1 order by at desc limit ${FORGET_TERMS_CAP}`,
    [device],
  ).catch(() => []);
  const suppressed = (Array.isArray(forgotten) ? forgotten : []).map((r) => termRe(String(r.term)));
  const kept = suppressed.length
    ? nodes.filter((n) => !suppressed.some((rx) => rx.test(n.name) || rx.test(n.summary)))
    : nodes;
  if (!kept.length) return { ok: true, extracted: 0, self, ...interior };

  // split into existing (bump) vs new (insert)
  const existing = await q(
    `select id, name, mentions, salience, feel from meera_nodes where device_id = $1 and name = any($2)`,
    [device, kept.map((n) => n.name)],
  ).catch(() => []);
  const byName = new Map((Array.isArray(existing) ? existing : []).map((n) => [n.name, n]));

  const idOf = new Map();
  for (const n of kept) {
    const ex = byName.get(n.name);
    if (ex) {
      idOf.set(n.name, ex.id);
      await q(
        `update meera_nodes set summary = $1, mentions = $2, salience = $3, feel = $4, updated_at = now() where id = $5`,
        [
          n.summary,
          (ex.mentions || 1) + 1,
          // a thing that carried a feeling is more memorable than a thing that
          // didn't — that asymmetry is the whole of "emotional salience", and
          // it decides which memories come back as standing background
          Math.min(10, (ex.salience || 1) + (n.feel ? 1.0 : 0.6)),
          n.feel || ex.feel || "",
          ex.id,
        ],
      ).catch(() => {});
    }
  }
  const fresh = kept.filter((n) => !byName.has(n.name));
  for (const n of fresh) {
    const ins = await q(
      `insert into meera_nodes (device_id, kind, name, summary, feel, salience) values ($1,$2,$3,$4,$5,$6) returning id, name`,
      [device, n.kind, n.name, n.summary, n.feel, n.feel ? 1.6 : 1.0],
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
      `insert into meera_edges (device_id, src, dst, relation)
       select $1, $2, $3, $4
       where not exists (
         select 1 from meera_edges where device_id = $1 and src = $2 and dst = $3 and relation = $4
       )`,
      [device, e.src, e.dst, e.relation],
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
      `select channel from meera_log where device_id = $1 order by id desc limit 1`,
      [device],
    ).catch(() => []);
    const channel = latestLog[0]?.channel === "call" ? "call" : "chat";
    const ep = await openOrExtendEpisode(person, device, channel);
    if (ep) {
      const bits = [...kept.slice(0, 3).map((n) => n.name), ...self.slice(0, 2).map((s) => s.slice(0, 30))];
      const summary = (bits.length ? bits.join(", ") : "chat stretch").slice(0, 110);
      await touchEpisode(ep.id, { summary });

      // idempotent within one open episode: a device may call `remember`
      // many times across the same stretch, and a fresh row per call would
      // flood the fact table with duplicates the nightly pass would just
      // have to collapse again.
      const already = await q(
        `select lower(name) as name from vy_fact where person_id = $1 and citations = array[$2]::bigint[]`,
        [person, ep.id],
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
          `insert into vy_fact (person_id, kind, name, body, feel, provenance, confidence, citations, provisional)
           values ($1,$2,$3,$4,$5,'extracted',0.7,$6::bigint[],true) returning id`,
          [person, f.kind, f.name, f.body, f.feel, [ep.id]],
        ).catch(() => []);
        written.add(f.name);
        const vec = vecs[i];
        const factId = ins[0]?.id;
        if (factId && vec) {
          await q(
            `insert into vy_embedding (owner_kind, owner_id, person_id, v)
             values ('fact', $1, $2, $3::halfvec)
             on conflict (owner_kind, owner_id) do update set v = excluded.v, at = now()`,
            [factId, person, toHalfvecLiteral(vec)],
          ).catch(() => {});
        }
      }
    }
  } catch {
    // the provisional tier is an enhancement layered on top of an already-
    // working graph write; it must never cost the client its self/inner
    // state above, which is why this whole block is fenced off from it
  }

  return { ok: true, extracted: kept.length, self, ...interior };
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
async function noteForgotten(device, terms) {
  const clean = [
    ...new Set(terms.map((t) => String(t || "").trim().toLowerCase()).filter((t) => t.length >= 3)),
  ].slice(0, 12);
  for (const t of clean) {
    await q(
      `insert into meera_forget (device_id, term) values ($1,$2)
       on conflict (device_id, lower(term)) do nothing`,
      [device, t.slice(0, 60)],
    ).catch(() => {});
  }
  if (!clean.length) return;
  await q(
    `delete from meera_forget where device_id = $1 and id not in (
       select id from meera_forget where device_id = $1 order by at desc limit ${FORGET_TERMS_CAP})`,
    [device],
  ).catch(() => {});
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
// leaves (§3.1.2).
export const PERSON_TABLES = [
  { table: "meera_log",         key: "device_id", lane: "legacy",
    keys: ["device_id", "speaker_person_id"] },
  { table: "meera_nodes",       key: "device_id", lane: "legacy" },
  { table: "meera_edges",       key: "device_id", lane: "legacy" },
  { table: "meera_forget",      key: "device_id", lane: "legacy" },
  { table: "meera_tel",         key: "device_id", lane: "legacy" },
  { table: "meera_tel_session", key: "device_id", lane: "legacy" },
  { table: "vy_episode",          key: "person_id", lane: "relational",
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
  { table: "vy_taste_candidate",  key: "person_id", lane: "relational" },
  { table: "vy_visual_assertion", key: "person_id", lane: "relational" },
  { table: "vy_shared_moment",    key: "person_id", lane: "relational" },
  { table: "vy_fact",             key: "person_id", lane: "relational",
    wipeWhere: "group_id is null" },
  { table: "vy_rel_event",        key: "person_id", lane: "relational" },
  { table: "vy_rel_state",        key: "person_id", lane: "relational" },
  { table: "vy_pattern",          key: "person_id", lane: "relational" },
  { table: "vy_phrase",           key: "person_id", lane: "relational",
    wipeWhere: "group_id is null",
    shared: { via: "vy_episode_participant", on: "origin_episode", person: "person_id",
              withdraw: "delete_join_row", lastOut: "delete_row" } },
  { table: "vy_kin",              key: "person_id", lane: "relational" },
  { table: "vy_ritual",           key: "person_id", lane: "relational" },
  { table: "vy_currency",         key: "person_id", lane: "relational" },
  { table: "vy_india_profile",    key: "person_id", lane: "relational" },
  { table: "vy_embedding",        key: "person_id", lane: "relational" },
  { table: "vy_derivation",       key: "person_id", lane: "relational" },
  { table: "vy_session",          key: "person_id", lane: "relational" },
  { table: "vy_group_member",     key: "person_id", lane: "relational",
    // a full wipe removes the membership row outright (§3.1.4); a plain
    // "leave" sets left_at instead and never deletes the room for the others
    shared: { withdraw: "set_left_at" } },
  { table: "vy_disclosure_grant", key: "granted_by", lane: "relational",
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
  { table: "vy_person_device",  key: "device_id", lane: "person" },
  { table: "vy_person",         key: "person_id", lane: "person" },
];

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
  return PERSON_TABLES.filter((t) => !MP_TABLES.has(t.table) || on).map((t) =>
    // `keys` and `wipeWhere` both name COLUMNS 008 adds (speaker_person_id,
    // group_id), so on a pre-008 database they are dropped along with the
    // tables. Lossless for the same reason: with no rooms there are no shared
    // rows for the restriction to spare and no room turns for the extra key to
    // find, so the wipe takes exactly what it takes today.
    on ? t : { ...t, keys: undefined, wipeWhere: undefined },
  );
}

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
export function wipeWhereSql(t) {
  const cols = keysOf(t)
    .map((k, i) => `${k} = $${i + 1}`)
    .join(" or ");
  return t.wipeWhere ? `(${cols}) and ${t.wipeWhere}` : `(${cols})`;
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
// it. evals/mp/withdraw.mjs passes the fixture-namespace prefixer, so THIS
// function — not a re-implementation of it — is what the withdraw suite proves
// against the real Postgres. The same reason api/_disclosure.js takes a bind
// map: a cascade tested through a copy is a copy that was tested.
export async function withdrawSharedRows(
  person,
  { dropAuthoredRoomTurns = true, t = (name) => name } = {},
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
  const left = await q(
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
      `delete from ${t("meera_log")} where speaker_person_id = $1 and group_id is not null returning id`,
      [person],
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
          and not exists (select 1 from ${t("vy_episode_participant")} p where p.episode_id = e.id)`,
      [epIds],
      30_000,
    );
    const dead = orphan.map((r) => r.id);
    if (dead.length) {
      // derived closure FIRST (no dangling-citation window), episodes last
      const facts = await q(
        `delete from ${t("vy_fact")} where citations && $1::bigint[] returning id`,
        [dead],
        30_000,
      );
      out.facts_closed = facts.length;
      const phrases = await q(
        `delete from ${t("vy_phrase")} where origin_episode = any($1::bigint[]) returning id`,
        [dead],
        30_000,
      );
      out.phrases_closed = phrases.length;
      const embs = await q(
        `delete from ${t("vy_embedding")}
          where (owner_kind = 'episode' and owner_id = any($1::bigint[]))
             or (owner_kind = 'fact'    and owner_id = any($2::bigint[])) returning 1 as x`,
        [dead, facts.map((r) => r.id)],
        30_000,
      );
      out.embeddings_closed = embs.length;
      // FK cascade takes the remaining participant rows, visual assertions and
      // shared moments; vy_group_turn.episode_id is `on delete set null`, so
      // the turn-level action log survives the episode it described — silence
      // and speech are the room's own behavioural record, not the episode's.
      const eps = await q(
        `delete from ${t("vy_episode")} where id = any($1::bigint[]) returning id`,
        [dead],
        30_000,
      );
      out.episodes_closed = eps.length;
    }
  }

  // 4. grants: the grantor's permission was theirs to give and dies with them;
  //    the grantee stops being a recipient, and granted_to is scalar, so both
  //    roles are the same delete (see the manifest's `by_role` note).
  const grants = await q(
    `delete from ${t("vy_disclosure_grant")} where granted_by = $1 or granted_to = $1 returning id`,
    [person],
    30_000,
  );
  out.grants = grants.length;

  // 5. membership: leaving never deletes the room for the others. A full wipe
  //    then removes the row itself through the manifest loop; orphaned-room
  //    cleanup is a nightly sweep on the pattern of the zero-orphan sweep,
  //    deliberately not inline here.
  const mem = await q(
    `update ${t("vy_group_member")} set left_at = now()
      where person_id = $1 and left_at is null returning group_id`,
    [person],
    30_000,
  );
  out.memberships = mem.length;

  return out;
}

async function purgeRelational(device, scope, { logIds = [], rx = null, from = NaN, to = NaN } = {}) {
  const person = await personIdFor(device);
  const out = {
    episodes: 0, facts: 0, rel_events: 0, patterns: 0, kin: 0, currency: 0,
    rituals: 0, phrases: 0, embeddings: 0, derivations: 0, sessions: 0,
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
        `delete from ${t.table} where ${wipeWhereSql(t)} returning 1 as x`,
        wipeParams(t, { device, person }),
        30_000,
      );
      if (gone.length) out[t.table] = gone.length;
    }
    // the mapping and (if no other device shares it) the person row itself:
    // a full wipe that kept the identity row would keep a record of them
    const m = await q(`delete from vy_person_device where device_id = $1 returning person_id`, [device]);
    await q(
      `delete from vy_person p where p.person_id = $1
        and not exists (select 1 from vy_person_device d where d.person_id = p.person_id)`,
      [person],
    );
    out.person_rows += m.length;
    return out;
  }

  // ── step 2: which episodes die ──
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
async function rebuildRelState(person) {
  const evs = await q(
    `select dim, to_v from vy_rel_event where person_id = $1 order by at, id`,
    [person],
  );
  if (!evs.length) {
    // no evidence, no state: the defaults live in the schema, not in a row
    await q(`delete from vy_rel_state where person_id = $1`, [person]);
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
  await q(
    `insert into vy_rel_state (person_id, honorific, cs_on_stress, trust, rupture_open, repair_state, snapshot_ver)
     values ($1,$2,$3,$4,$5,$6,1)
     on conflict (person_id) do update set
       honorific = $2, cs_on_stress = $3, trust = $4, rupture_open = $5, repair_state = $6,
       cs_ratio = null, ritual_density = 0, pacing_gap_s = null,
       snapshot_ver = vy_rel_state.snapshot_ver + 1, updated_at = now()`,
    [person, s.honorific, s.cs_on_stress, s.trust, s.rupture_open, s.repair_state],
  );
}

// an orphaned edge is a relation between two things that no longer exist —
// it survives every node-level delete unless it is chased explicitly
async function dropEdgesFor(device, ids) {
  if (!ids.length) return 0;
  const gone = await q(
    `delete from meera_edges where device_id = $1 and (src = any($2) or dst = any($2)) returning id`,
    [device, ids],
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
async function purgeTelemetry(device, { rx, from, to, all }) {
  let gone = [];
  if (all) {
    gone = await q(`delete from meera_tel where device_id = $1 returning id`, [device]);
    await q(`delete from meera_tel_session where device_id = $1`, [device]).catch(() => {});
    return gone.length;
  }
  if (rx) {
    gone = await q(`delete from meera_tel where device_id = $1 and props::text ~* $2 returning id`, [
      device,
      rx,
    ]);
  } else if (Number.isFinite(from) && Number.isFinite(to)) {
    gone = await q(
      `delete from meera_tel where device_id = $1 and at >= $2 and at < $3 returning id`,
      [device, new Date(from).toISOString(), new Date(to).toISOString()],
    );
  }
  if (!gone.length) return 0;
  await q(
    `delete from meera_tel_session s where s.device_id = $1
       and not exists (select 1 from meera_tel t where t.session_id = s.session_id)`,
    [device],
  ).catch(() => {});
  await q(
    `update meera_tel_session s set events = c.n
       from (select session_id, count(*)::int n from meera_tel where device_id = $1 group by session_id) c
      where s.session_id = c.session_id and s.device_id = $1 and s.events <> c.n`,
    [device],
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

// Scopes, and what each one actually means in rows:
//   item    — one remembered thing by name: its node, its edges, and the raw
//             turns that say the word. Deleting the node but keeping the
//             sentence it was distilled from is not forgetting, it is filing.
//   session — one stretch of conversation, [from, to) in ms, optionally one
//             channel ("forget that call" is a window plus channel='call').
//   day     — one calendar day in their timezone.
//   all     — every row this device has, including the suppression list.
async function opForget(device, body) {
  const scope = ["item", "session", "day", "all"].includes(body.scope) ? body.scope : "";
  if (!scope) return { error: "unknown scope" };

  let logRows = [];
  let nodeRows = [];
  let edges = 0;
  let photos = 0;
  let telemetry = 0;
  let relational = null; // the §9.1 v2 cascade over the vy_ store

  // meera_log's owning columns, from the manifest (§3.3 `keys`). A room turn
  // is written under the room's synthetic device uuid, which is in nobody's
  // vy_person_device mapping — so device_id alone would leave a person's own
  // room turns standing through their own forget. Reading the manifest rather
  // than restating the columns is what keeps this in sync with export.
  // Until room ingestion writes speaker_person_id it is NULL on every row, so
  // the added disjunct matches nothing and behaviour today is unchanged.
  const person = await personIdFor(device);
  const LOG = (await activePersonTables()).find((t) => t.table === "meera_log");
  const logOwner = keysOf(LOG).map((k, i) => `${k} = $${i + 1}`).join(" or ");
  const logOwnerVals = wipeParams(LOG, { device, person });
  const logP = (n) => `$${logOwnerVals.length + n}`; // 1-based extra params

  if (scope === "item") {
    const name = String(body.name || "").trim().toLowerCase().slice(0, 60);
    // a two-letter term would word-match half the log; a forget must be
    // precise about what it takes, not merely enthusiastic
    if (name.length < 3) return { error: "nothing named" };
    const rx = `\\m${reEsc(name)}\\M`;
    // summary as well as name: "priya" lives on inside a node called
    // "wedding" whose one line is about her, and that node is the same fact
    nodeRows = await q(
      `delete from meera_nodes where device_id = $1 and (name = $2 or name ~* $3 or summary ~* $3)
       returning id, name`,
      [device, name, rx],
    );
    edges = await dropEdgesFor(device, nodeRows.map((n) => n.id));
    logRows = await q(
      `delete from meera_log where (${logOwner}) and content ~* ${logP(1)} returning id`,
      [...logOwnerVals, rx],
    );
    telemetry = await purgeTelemetry(device, { rx });
    // derived state: episodes citing the deleted rows, then everything citing
    // those episodes, lineage chased, snapshot replayed (§9.1 steps 2–6)
    relational = await purgeRelational(device, scope, {
      logIds: logRows.map((r) => r.id),
      rx,
    });
  } else if (scope === "session" || scope === "day") {
    const [from, to] = scope === "day" ? dayWindow(body) : [Number(body.from), Number(body.to)];
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return { error: "bad window" };
    const a = new Date(from).toISOString();
    const b = new Date(to).toISOString();
    const chan = body.channel === "call" ? "call" : body.channel === "chat" ? "chat" : null;
    logRows = await q(
      `delete from meera_log where (${logOwner}) and at >= ${logP(1)} and at < ${logP(2)}${chan ? ` and channel = ${logP(3)}` : ""}
       returning id`,
      chan ? [...logOwnerVals, a, b, chan] : [...logOwnerVals, a, b],
    );
    // updated_at, not created_at. A node last written inside the window had
    // its summary rewritten FROM that window's words — an older node that
    // came up again during the forgotten stretch is now carrying text from
    // it. Taking too much here is the safe direction; leaving the stretch
    // standing in summary form is not.
    nodeRows = await q(
      `delete from meera_nodes where device_id = $1 and updated_at >= $2 and updated_at < $3
       returning id, name`,
      [device, a, b],
    );
    edges = await dropEdgesFor(device, nodeRows.map((n) => n.id));
    const inWindow = await q(
      `delete from meera_edges where device_id = $1 and created_at >= $2 and created_at < $3 returning id`,
      [device, a, b],
    ).catch(() => []);
    edges += inWindow.length;
    // The whole window goes, not just the events whose area matches `channel`.
    // "forget that call" is a time window; a chat event sitting inside it is
    // part of the same stretch, and the node delete directly above already
    // takes the window unfiltered for the same reason.
    telemetry = await purgeTelemetry(device, { from, to });
    // the pictures they sent during that stretch go with it
    photos = await deletePhotos(device, from, to).catch(() => 0);
    relational = await purgeRelational(device, scope, {
      logIds: logRows.map((r) => r.id),
      from,
      to,
    });
  } else {
    logRows = await q(`delete from meera_log where ${logOwner} returning id`, logOwnerVals);
    nodeRows = await q(`delete from meera_nodes where device_id = $1 returning id, name`, [device]);
    const e = await q(`delete from meera_edges where device_id = $1 returning id`, [device]).catch(
      () => [],
    );
    edges = e.length;
    await q(`delete from meera_forget where device_id = $1`, [device]).catch(() => {});
    // a wipe takes telemetry outright, rollup included — rule 3
    telemetry = await purgeTelemetry(device, { all: true });
    // a full wipe takes every picture, including any whose filename carries no
    // parseable timestamp — this is the one path that is allowed to be total
    photos = await deletePhotos(device).catch(() => 0);
    // the whole relational store, manifest-driven, mapping row included
    relational = await purgeRelational(device, "all");
  }

  if (scope !== "all") {
    const terms = nodeRows.map((n) => n.name);
    if (scope === "item") terms.push(String(body.name || "").trim().toLowerCase());
    // suppression extension (§9.1): names of deleted facts/kin, coined
    // phrases and currency topics join the list, so neither the extractor
    // nor the M3 consolidator can re-derive what the cascade just took
    if (relational?.terms?.length) terms.push(...relational.terms);
    await noteForgotten(device, terms);
  }

  if (relational) delete relational.terms; // suppression list never leaves the server

  return {
    ok: true,
    scope,
    deleted: { log: logRows.length, nodes: nodeRows.length, edges, photos, telemetry, relational },
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
async function deletePhotos(device, from, to) {
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

async function opUploadPhoto(device, body) {
  const b64 = String(body.data || "");
  if (b64.length > 2_200_000) return { error: "too large" };
  const mime = /^image\/(jpeg|png|webp)$/.test(String(body.mime)) ? body.mime : "image/jpeg";
  const buf = Buffer.from(b64, "base64");
  if (!buf.length) return { error: "empty" };
  // per-device quota: a public write endpoint with no ceiling is a storage
  // bill waiting to happen. 500 photos per device is far beyond real use.
  try {
    const list = await fetch(`${SB_URL}/storage/v1/object/list/meera-photos`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefix: `${device}/`, limit: 501 }),
    }).then((r) => (r.ok ? r.json() : []));
    if (Array.isArray(list) && list.length > 500) return { error: "photo limit reached" };
  } catch {
    /* quota check unavailable — allow the upload rather than break photos */
  }
  const path = `${device}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const up = await fetch(`${SB_URL}/storage/v1/object/meera-photos/${path}`, {
    method: "POST",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": mime,
      "x-upsert": "false",
    },
    body: buf,
  });
  if (!up.ok) return { error: "upload failed" };
  return { url: `${SB_URL}/storage/v1/object/public/meera-photos/${path}` };
}

async function opDescribe(body) {
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
      model: "google/gemini-3.1-flash-lite",
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
  return { desc: String(data?.choices?.[0]?.message?.content || "").trim().slice(0, 140) };
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
    if (op === "forget") return res.status(200).json(await opForget(device, req.body));
    return res.status(400).json({ error: "unknown op" });
  } catch (e) {
    return res.status(500).json({ error: "memory failure" });
  }
}
