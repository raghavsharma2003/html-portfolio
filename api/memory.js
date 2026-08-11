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
  const [bgRaw, matchedRaw = []] = await Promise.all(fetches);
  const background = Array.isArray(bgRaw) ? bgRaw : [];
  const matched = Array.isArray(matchedRaw) ? matchedRaw : [];
  const seen = new Map();
  for (const n of [...matched, ...background]) seen.set(n.id, n);
  if (!seen.size) return { memories: "" };

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
    // the pictures they sent during that stretch go with it
    photos = await deletePhotos(device, from, to).catch(() => 0);
  } else {
    logRows = await q(`delete from meera_log where device_id = $1 returning id`, [device]);
    nodeRows = await q(`delete from meera_nodes where device_id = $1 returning id, name`, [device]);
    const e = await q(`delete from meera_edges where device_id = $1 returning id`, [device]).catch(
      () => [],
    );
    edges = e.length;
    await q(`delete from meera_forget where device_id = $1`, [device]).catch(() => {});
    // a full wipe takes every picture, including any whose filename carries no
    // parseable timestamp — this is the one path that is allowed to be total
    photos = await deletePhotos(device).catch(() => 0);
  }

  if (scope !== "all") {
    const terms = nodeRows.map((n) => n.name);
    if (scope === "item") terms.push(String(body.name || "").trim().toLowerCase());
    await noteForgotten(device, terms);
  }

  return {
    ok: true,
    scope,
    deleted: { log: logRows.length, nodes: nodeRows.length, edges, photos },
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
