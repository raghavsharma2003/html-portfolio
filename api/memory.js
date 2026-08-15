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
const RECALL_STOP = new Set([
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
  const semanticFetch = (async () => {
    const trimmed = String(body.query || "").trim();
    if (trimmed.length < 3) return [];
    const vec = await embedOne(trimmed).catch(() => null);
    if (!vec) return [];
    const person = await personIdFor(device);
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

  const [[bgRaw, matchedRaw = []], semanticRaw] = await Promise.all([Promise.all(fetches), semanticFetch]);
  const background = Array.isArray(bgRaw) ? bgRaw : [];
  const matched = Array.isArray(matchedRaw) ? matchedRaw : [];
  const semantic = (Array.isArray(semanticRaw) ? semanticRaw : []).slice(0, 4);
  const seen = new Map();
  for (const n of [...matched, ...background]) seen.set(n.id, n);
  if (!seen.size && !semantic.length) return { memories: "" };

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

  return { memories: blocks.join("\n") };
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
export const PERSON_TABLES = [
  { table: "meera_log",         key: "device_id", lane: "legacy" },
  { table: "meera_nodes",       key: "device_id", lane: "legacy" },
  { table: "meera_edges",       key: "device_id", lane: "legacy" },
  { table: "meera_forget",      key: "device_id", lane: "legacy" },
  { table: "meera_tel",         key: "device_id", lane: "legacy" },
  { table: "meera_tel_session", key: "device_id", lane: "legacy" },
  { table: "vy_episode",          key: "person_id", lane: "relational" },
  { table: "vy_taste_candidate",  key: "person_id", lane: "relational" },
  { table: "vy_visual_assertion", key: "person_id", lane: "relational" },
  { table: "vy_shared_moment",    key: "person_id", lane: "relational" },
  { table: "vy_fact",             key: "person_id", lane: "relational" },
  { table: "vy_rel_event",        key: "person_id", lane: "relational" },
  { table: "vy_rel_state",        key: "person_id", lane: "relational" },
  { table: "vy_pattern",          key: "person_id", lane: "relational" },
  { table: "vy_phrase",           key: "person_id", lane: "relational" },
  { table: "vy_kin",              key: "person_id", lane: "relational" },
  { table: "vy_ritual",           key: "person_id", lane: "relational" },
  { table: "vy_currency",         key: "person_id", lane: "relational" },
  { table: "vy_india_profile",    key: "person_id", lane: "relational" },
  { table: "vy_embedding",        key: "person_id", lane: "relational" },
  { table: "vy_derivation",       key: "person_id", lane: "relational" },
  { table: "vy_session",          key: "person_id", lane: "relational" },
  { table: "vy_person_device",  key: "device_id", lane: "person" },
  { table: "vy_person",         key: "person_id", lane: "person" },
];

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
async function purgeRelational(device, scope, { logIds = [], rx = null, from = NaN, to = NaN } = {}) {
  const person = await personIdFor(device);
  const out = {
    episodes: 0, facts: 0, rel_events: 0, patterns: 0, kin: 0, currency: 0,
    rituals: 0, phrases: 0, embeddings: 0, derivations: 0, sessions: 0,
    person_rows: 0, state_rebuilt: false, terms: [],
  };

  if (scope === "all") {
    // manifest-driven: a table added to PERSON_TABLES is wiped here with no
    // further code — the wipe cannot lag the schema
    for (const t of PERSON_TABLES) {
      if (t.lane !== "relational") continue;
      const gone = await q(
        `delete from ${t.table} where ${t.key} = $1 returning 1 as x`,
        [person],
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
    logRows = await q(`delete from meera_log where device_id = $1 and content ~* $2 returning id`, [
      device,
      rx,
    ]);
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
      `delete from meera_log where device_id = $1 and at >= $2 and at < $3${chan ? " and channel = $4" : ""}
       returning id`,
      chan ? [device, a, b, chan] : [device, a, b],
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
    logRows = await q(`delete from meera_log where device_id = $1 returning id`, [device]);
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
    if (op === "remember") return res.status(200).json(await opRemember(device, req.body));
    if (op === "forget") return res.status(200).json(await opForget(device, req.body));
    return res.status(400).json({ error: "unknown op" });
  } catch (e) {
    return res.status(500).json({ error: "memory failure" });
  }
}
