// Cultural currency — kept deliberately small and deliberately PASSIVE.
//
// Her weights stop somewhere. That means two different failures, and only one
// of them is worth fixing here:
//   1. she goes blank when someone mentions a word or a moment that is new
//   2. she reaches for a reference that died six months ago
// Fixing (1) with a "here is what's trending today" block in her prompt would
// create a third, much worse failure: a list of current things sitting in
// context reads to a model as material to deploy, and a 24-year-old who works
// a meme into the conversation because she has one available is unbearable in
// a way that not knowing the meme never is.
//
// So this endpoint builds a RECOGNITION INDEX, not a brief. It is a list of
// {term, aliases, gist} rows that the client matches against WHAT THE USER
// SAID, locally, before a turn. No match, nothing enters the prompt — which is
// most turns. A match puts one line in the volatile tail saying what the thing
// is, framed as something she has heard OF and has NOT seen. She therefore
// cannot raise any of it first; she can only fail to go blank when they do.
// That is a structural fix for the cringe problem rather than an exhortative
// one, and it needs no exemption from the "you do not recognise things"
// rule in persona.ts — knowing OF a word is not claiming to have watched it.
//
// Everything expensive happens here, off the hot path, once a day. A failed
// fetch means she is simply not updated: the client gets an empty index and
// behaves exactly as it does today.
//
//   GET  /api/culture            → { day, items, dated, stale, age_h }
//   POST /api/culture {op:"refresh"} → builds today's row if missing (idempotent)
//
// Refresh is idempotent per IST day, so it needs no secret to be safe: the
// worst an unauthenticated caller can do is cause the one distillation pass
// that was going to happen anyway. `force` does need the secret.
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import { OPENROUTER_KEY } from "./_config.js";

const KEY = process.env.OPENROUTER_API_KEY || OPENROUTER_KEY;
const SECRET = process.env.CULTURE_SECRET || "";

// How long a stale index may still be served. Moment-level culture has a
// viral half-life just over five days and meme formats turn over in months,
// so a two-day-old index is still useful for RECOGNITION (which is all it is
// used for) while a week-old one is just noise. After this she gets nothing,
// which is the correct failure: silence beats last week's news cycle.
const MAX_AGE_H = 60;
const MAX_ITEMS = 10;
const MAX_DATED = 6;

// Anything matching this never reaches the distiller and never leaves it.
// A companion casually placing a murder trial or a communal flashpoint is a
// harm problem, not a taste problem, and Indian trending feeds carry both
// every single day (verified: the live feed the day this was written led with
// a fan's murder case, an earthquake with 111 dead, and an embassy attack).
const UNSAFE =
  /\b(murder|murdered|kill(s|ed|ing)?|death|dead|dies|died|suicide|rape|assault|molest|abuse|accident|crash(ed|es)?|collision|quake|earthquake|cyclone|flood|storm|landslide|blast|bomb|terror|riot|communal|caste|dalit|hindu|muslim|christian|sikh|temple|mosque|church|bjp|congress|aap|rss|modi|gandhi|election|vote|court|jail|prison|arrest|police|fir|cbi|verdict|plea|witness|scam|fraud|drug|overdose|cancer|virus|outbreak|hospital|icu|ipo|allotment|bonus share|stocks?|sensex|nifty|dividend|sebi|gst|budget|war|missile|strike|protest|lathi|defac|embassy|hijack|kidnap|assault|abduct|shooting|shot dead|violence|attack)\b/i;

const istDay = () =>
  new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!allow(ipOf(req), "culture", 30)) return res.status(429).json({ error: "slow down" });

  try {
    if (req.method === "GET") return await serveIndex(res);
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
    const b = req.body || {};
    if (b.op !== "refresh") return res.status(400).json({ error: "op required" });
    const forced = b.force === true && SECRET && b.secret === SECRET;
    return await refresh(res, forced);
  } catch {
    // the index is a nice-to-have; it must never be an error the app sees
    return res.status(200).json({ day: null, items: [], dated: [], stale: true });
  }
}

// ── read path ───────────────────────────────────────────────────────────
// Cheap, cacheable, and empty-safe. The client calls this in the background,
// never in front of a reply.
async function serveIndex(res) {
  let row = null;
  try {
    const rows = await q(
      `select day, items, dated, extract(epoch from (now() - at)) / 3600 as age_h
         from meera_culture order by day desc limit 1`,
    );
    row = rows[0] || null;
  } catch {
    row = null; // DB trouble → she is simply not updated today
  }
  const ageH = row ? Number(row.age_h) || 0 : Infinity;
  const fresh = row && ageH <= MAX_AGE_H;
  // Neon-over-HTTP may hand back a date as a string or as a Date depending on
  // the column type inference — normalize before comparing, or every client
  // would see stale:true forever and kick a (harmless but pointless) refresh
  const day = row ? String(row.day).slice(0, 10) : "";
  // a 10-minute browser/CDN cache is plenty: the row changes once a day
  res.setHeader("Cache-Control", "public, max-age=600, s-maxage=600");
  return res.status(200).json({
    day: fresh ? day : null,
    items: fresh ? asArray(row.items) : [],
    dated: fresh ? asArray(row.dated) : [],
    age_h: fresh ? Math.round(ageH) : null,
    // the client fires one background refresh a day when it sees this
    stale: !row || day !== istDay(),
  });
}

// ── refresh path ────────────────────────────────────────────────────────
async function refresh(res, forced) {
  const day = istDay();
  if (!forced) {
    try {
      const have = await q(`select day from meera_culture where day = $1`, [day]);
      if (have.length) return res.status(200).json({ ok: true, day, skipped: "already_built" });
    } catch {
      /* can't check → fall through and try to build; the write is an upsert */
    }
  }
  if (!KEY) return res.status(500).json({ error: "no key configured" });

  const t0 = Date.now();
  const seeds = await indianTopics();
  const tFetch = Date.now() - t0;

  const t1 = Date.now();
  const distilled = await distil(seeds, day);
  const tDistil = Date.now() - t1;
  if (!distilled) {
    // A failed distillation leaves yesterday's row untouched. Not updating is
    // always a valid outcome here; a half-built index is not.
    await note({ ok: false, stage: "distil", fetch_ms: tFetch, distil_ms: tDistil, seeds: seeds.length });
    return res.status(502).json({ error: "distil failed", fetch_ms: tFetch, distil_ms: tDistil });
  }

  const dated = cleanDated(distilled.dated);
  // a word cannot be both "she should recognise this" and "this reads as
  // try-hard now" — when the distiller says both, the warning wins
  const items = cleanItems(distilled.items).filter(
    (it) => !dated.includes(it.term) && !it.aliases.some((a) => dated.includes(a)),
  );
  const meta = {
    seeds: seeds.length,
    raw_items: Array.isArray(distilled.items) ? distilled.items.length : 0,
    dropped: (Array.isArray(distilled.items) ? distilled.items.length : 0) - items.length,
    fetch_ms: tFetch,
    distil_ms: tDistil,
  };

  // serverless freezes the instant the response is sent — this write is
  // awaited or it silently does not happen
  await q(
    `insert into meera_culture (day, items, dated, meta, at)
     values ($1, $2, $3, $4, now())
     on conflict (day) do update
       set items = excluded.items, dated = excluded.dated,
           meta = excluded.meta, at = excluded.at`,
    [day, JSON.stringify(items), JSON.stringify(dated), JSON.stringify(meta)],
  );
  await note({ ok: true, ...meta, items: items.length, dated: dated.length });
  return res.status(200).json({ ok: true, day, items: items.length, dated: dated.length, ...meta });
}

// Google Trends RSS: free, no auth, no scraping, ~1s, and the signal is in
// <ht:news_item_title> rather than <title> ("darshan" tells you nothing;
// the news title tells you what people are actually talking about). Yield is
// low (measured ~4 usable items out of 20) and it is a SEARCH-VOLUME feed
// dominated by news, so it is used only as context for the distiller — its
// text never reaches her prompt, raw or otherwise.
async function indianTopics() {
  const [a, b] = await Promise.all([rss("IN"), rss("IN-MH")]);
  const seen = new Set();
  const out = [];
  for (const it of [...a, ...b]) {
    if (!it.title || !it.news.length) continue;
    const k = it.title.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    // a title sharing no token with its own news items is a broken mapping
    if (!it.news.some((n) => shareToken(it.title, n))) continue;
    if (!/[a-z]/i.test(it.title)) continue; // devanagari-only: no matchable token
    if (UNSAFE.test(it.title + " " + it.news.join(" "))) continue;
    out.push(`${it.title} — ${it.news[0].slice(0, 110)}`);
  }
  return out.slice(0, 14);
}

async function rss(geo) {
  try {
    const r = await fetch(`https://trends.google.com/trending/rss?geo=${geo}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return [];
    const xml = await r.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => ({
      title: unxml((m[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1]),
      news: [...m[1].matchAll(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/g)].map((n) =>
        unxml(n[1]),
      ),
    }));
  } catch {
    return []; // a dead feed is a quieter day, not a broken prompt
  }
}

function unxml(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function shareToken(a, b) {
  const t = (s) =>
    new Set(
      String(s)
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 3),
    );
  const A = t(a);
  for (const w of t(b)) if (A.has(w)) return true;
  return A.size === 0;
}

// One web-grounded pass that turns the day's noise plus a live search into a
// small structured index. Its job is selection and compression; the safety
// filter runs again on everything it returns, because a prompt instruction is
// not a guarantee.
async function distil(seeds, day) {
  const sys = `You are building a RECOGNITION INDEX for a chat companion: things she should not go blank on if the user mentions them. It is never shown to her as suggestions and she never raises these herself.

Reply with STRICT JSON only, no markdown fence, no commentary:
{"items":[{"term":"","aliases":[],"gist":""}],"dated":[""]}

items — up to ${MAX_ITEMS} things an Indian 20-28 year old might type in a chat this week that someone whose knowledge stopped a year ago would NOT recognise. Priority order: (1) internet slang and meme formats, Indian first then global, (2) creators, shows, songs or audios people are quoting right now, (3) light moments people are joking about.
- term: how people actually type it, lowercase.
- aliases: the SHORT forms people actually type, lowercase — for a show called "india's got latent" include "latent"; for a person include the surname or nickname; include common misspellings. This is what makes the entry findable, so give at least one whenever a shorter form exists. [] only if there genuinely is no other form.
- gist: at most 14 words, plain lowercase, neutral, factual. Say what it IS. No numbers, no headline text, no explaining why it is funny.
dated — up to ${MAX_DATED} slang words or meme formats that were big recently but now read as try-hard to that age group.

HARD RULES: omit anything involving death, crime, courts, police, accidents, disasters, disease, religion, caste or political parties. No stocks, IPOs or finance. No brand campaigns. Nothing that has been around for years — it must be genuinely current. If a category has nothing current, return fewer items or none. Fewer correct entries beat a padded list.`;

  const user = `Today is ${day} (IST).
${seeds.length ? `Indian search topics trending today, for context only — ignore any that break the hard rules:\n${seeds.join("\n")}\n` : ""}
Search the web for what is genuinely current right now: current Indian internet slang and meme formats, indian instagram reel formats and audios people are using now, gen-z slang actually in use right now, what indian twitter/x is joking about this week.`;

  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        "X-Title": "Meera",
      },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        plugins: [{ id: "web", max_results: 6 }],
        max_tokens: 1200,
        reasoning: { effort: "minimal" },
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return parseJson(d?.choices?.[0]?.message?.content || "");
  } catch {
    return null;
  }
}

function parseJson(text) {
  const s = String(text).replace(/^\s*```(?:json)?|```\s*$/g, "");
  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try {
    const o = JSON.parse(s.slice(i, j + 1));
    return o && typeof o === "object" ? o : null;
  } catch {
    return null;
  }
}

// The distiller was told the rules; this enforces them. Anything that fails
// is dropped rather than repaired — an index of six good rows is worth more
// than ten with one bad one in it.
function cleanItems(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const taken = new Set();
  for (const it of list) {
    if (!it || typeof it !== "object") continue;
    const term = norm(it.term);
    const gist = plain(it.gist);
    // a term under 4 chars matches half the language by accident
    if (term.length < 4 || term.length > 40) continue;
    if (!gist || gist.split(/\s+/).length > 16 || gist.length > 120) continue;
    if (UNSAFE.test(term + " " + gist)) continue;
    if (taken.has(term)) continue;
    taken.add(term);
    const aliases = (Array.isArray(it.aliases) ? it.aliases : [])
      .map(norm)
      .filter((a) => a.length >= 4 && a.length <= 40 && a !== term && !UNSAFE.test(a))
      .slice(0, 4);
    out.push({ term, aliases, gist });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function cleanDated(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(norm).filter((s) => s.length >= 3 && s.length <= 24 && !UNSAFE.test(s)))].slice(
    0,
    MAX_DATED,
  );
}

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[*_`#\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const plain = (s) =>
  String(s || "")
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const asArray = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
};

// Timings and counts only — this path never sees conversation content.
async function note(detail) {
  try {
    await q(
      `insert into meera_diag (device_id, session_id, scope, event, t_ms, detail)
       values ('00000000-0000-0000-0000-000000000000', 'culture-cron', 'app', 'culture_refresh', $1, $2)`,
      [Math.round(detail.fetch_ms || 0) + Math.round(detail.distil_ms || 0), JSON.stringify(detail)],
    );
  } catch {
    /* diagnostics are not the product */
  }
}
