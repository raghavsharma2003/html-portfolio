// Meera memory backend — Supabase-backed conversation log + graph memory.
// One endpoint, three ops (POST { op, device, ... }):
//   log      — append conversation turns to the permanent log
//   recall   — graph lookup: relevant nodes + their edges → compact text
//   remember — LLM extracts entities/relations from recent turns → upsert graph
// The Supabase anon key lives server-side only; this proxy is the gatekeeper.

import { allow, ipOf } from "./_ratelimit.js";

import { OPENROUTER_KEY, SUPABASE_URL, SUPABASE_KEY } from "./_config.js";

const SB_URL = process.env.SUPABASE_URL || SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY || SUPABASE_KEY;
const OR_KEY = process.env.OPENROUTER_API_KEY || OPENROUTER_KEY;
const EXTRACT_MODEL = "google/gemini-3.1-flash-lite";
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
  const rows = turns.map((t) => ({
    device_id: device,
    role: t.role === "her" ? "her" : "me",
    channel: t.channel === "call" ? "call" : "chat",
    kind: typeof t.kind === "string" ? t.kind.slice(0, 20) : "text",
    content: String(t.content || "").slice(0, 4000),
    at: Number.isFinite(t.at) ? new Date(t.at).toISOString() : new Date().toISOString(),
  }));
  await sb("meera_log", null, { method: "POST", body: JSON.stringify(rows) });
  return { ok: true };
}

async function opRecall(device, body) {
  const query = String(body.query || "").toLowerCase();
  const words = [...new Set(query.match(/[a-z]{4,}|[ऀ-ॿ]{3,}/g) || [])].slice(0, 6);

  const fetches = [
    sb("meera_nodes", {
      device_id: `eq.${device}`,
      order: "salience.desc,updated_at.desc",
      limit: "6",
    }).then((r) => r.json()),
  ];
  if (words.length) {
    const or =
      "(" +
      words.flatMap((w) => [`name.ilike.*${w}*`, `summary.ilike.*${w}*`]).join(",") +
      ")";
    fetches.push(
      sb("meera_nodes", {
        device_id: `eq.${device}`,
        or,
        order: "salience.desc",
        limit: "8",
      }).then((r) => r.json()),
    );
  }
  const results = await Promise.all(fetches);
  const seen = new Map();
  for (const arr of results) if (Array.isArray(arr)) for (const n of arr) seen.set(n.id, n);
  const nodes = [...seen.values()].slice(0, 12);
  if (!nodes.length) return { memories: "" };

  const ids = nodes.map((n) => n.id).join(",");
  const edges = await sb("meera_edges", {
    device_id: `eq.${device}`,
    or: `(src.in.(${ids}),dst.in.(${ids}))`,
    limit: "30",
  })
    .then((r) => r.json())
    .catch(() => []);

  // resolve neighbor names outside the recalled set
  const missing = new Set();
  for (const e of Array.isArray(edges) ? edges : []) {
    if (!seen.has(e.src)) missing.add(e.src);
    if (!seen.has(e.dst)) missing.add(e.dst);
  }
  if (missing.size) {
    const extra = await sb("meera_nodes", {
      device_id: `eq.${device}`,
      id: `in.(${[...missing].join(",")})`,
      select: "id,name",
    })
      .then((r) => r.json())
      .catch(() => []);
    for (const n of Array.isArray(extra) ? extra : []) seen.set(n.id, n);
  }

  const lines = nodes.map((n) => {
    const rel = (Array.isArray(edges) ? edges : [])
      .filter((e) => e.src === n.id || e.dst === n.id)
      .slice(0, 4)
      .map((e) =>
        e.src === n.id
          ? `${e.relation} ${seen.get(e.dst)?.name ?? "?"}`
          : `${seen.get(e.src)?.name ?? "?"} ${e.relation} this`,
      )
      .join("; ");
    return `- ${n.name} (${n.kind}): ${n.summary}${rel ? ` [${rel}]` : ""}`;
  });

  // touch recall time (fire-and-forget)
  sb("meera_nodes", { device_id: `eq.${device}`, id: `in.(${ids})` }, {
    method: "PATCH",
    body: JSON.stringify({ last_recalled: new Date().toISOString() }),
  }).catch(() => {});

  return { memories: lines.join("\n") };
}

async function opRemember(device, body) {
  const recent = (Array.isArray(body.recent) ? body.recent : []).slice(-16);
  if (recent.length < 2) return { ok: true, extracted: 0 };
  const convo = recent
    .map((t) => `${t.role === "me" ? "user" : "meera"}: ${String(t.content || "").slice(0, 300)}`)
    .join("\n");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OR_KEY}`,
      "Content-Type": "application/json",
      "X-Title": "Meera",
    },
    body: JSON.stringify({
      model: EXTRACT_MODEL,
      max_tokens: 600,
      messages: [
        {
          role: "system",
          content: `Extract durable memory about the USER's life from this Hinglish chat (meera is the AI companion — do NOT store facts about meera's own fictional life). Reply with ONLY JSON:
{"nodes":[{"kind":"person|place|event|preference|fact|emotion|plan|topic","name":"short lowercase","summary":"one line, <=120 chars"}],"edges":[{"src":"node name","dst":"node name","relation":"2-3 words"}]}
Only things worth remembering weeks later: people, places, jobs, plans, strong likes/dislikes, recurring feelings, big events. Skip small talk. Max 6 nodes. Empty arrays if nothing durable.`,
        },
        { role: "user", content: convo },
      ],
    }),
  });
  if (!res.ok) return { ok: false };
  const data = await res.json();
  let parsed;
  try {
    const raw = data?.choices?.[0]?.message?.content ?? "";
    parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    return { ok: false };
  }
  const nodes = (Array.isArray(parsed.nodes) ? parsed.nodes : [])
    .filter((n) => n && typeof n.name === "string" && n.name.trim())
    .slice(0, 6)
    .map((n) => ({
      kind: ["person", "place", "event", "preference", "fact", "emotion", "plan", "topic"].includes(n.kind)
        ? n.kind
        : "fact",
      name: n.name.trim().toLowerCase().slice(0, 60),
      summary: String(n.summary || "").slice(0, 160),
    }));
  if (!nodes.length) return { ok: true, extracted: 0 };

  // split into existing (bump) vs new (insert)
  const nameList = nodes.map((n) => `"${n.name.replace(/"/g, "")}"`).join(",");
  const existing = await sb("meera_nodes", {
    device_id: `eq.${device}`,
    name: `in.(${nameList})`,
    select: "id,name,mentions,salience",
  })
    .then((r) => r.json())
    .catch(() => []);
  const byName = new Map((Array.isArray(existing) ? existing : []).map((n) => [n.name, n]));

  const idOf = new Map();
  for (const n of nodes) {
    const ex = byName.get(n.name);
    if (ex) {
      idOf.set(n.name, ex.id);
      await sb("meera_nodes", { id: `eq.${ex.id}` }, {
        method: "PATCH",
        body: JSON.stringify({
          summary: n.summary,
          mentions: (ex.mentions || 1) + 1,
          salience: Math.min(10, (ex.salience || 1) + 0.6),
          updated_at: new Date().toISOString(),
        }),
      });
    }
  }
  const fresh = nodes.filter((n) => !byName.has(n.name));
  if (fresh.length) {
    const inserted = await sb("meera_nodes", null, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(fresh.map((n) => ({ ...n, device_id: device }))),
    })
      .then((r) => r.json())
      .catch(() => []);
    for (const n of Array.isArray(inserted) ? inserted : []) idOf.set(n.name, n.id);
  }

  const edges = (Array.isArray(parsed.edges) ? parsed.edges : [])
    .filter((e) => idOf.has(String(e.src).toLowerCase()) && idOf.has(String(e.dst).toLowerCase()))
    .slice(0, 8)
    .map((e) => ({
      device_id: device,
      src: idOf.get(String(e.src).toLowerCase()),
      dst: idOf.get(String(e.dst).toLowerCase()),
      relation: String(e.relation || "related to").slice(0, 40),
    }));
  if (edges.length) {
    await sb("meera_edges", { on_conflict: "device_id,src,dst,relation" }, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(edges),
    }).catch(() => {});
  }
  return { ok: true, extracted: nodes.length };
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
    return res.status(400).json({ error: "unknown op" });
  } catch (e) {
    return res.status(500).json({ error: "memory failure" });
  }
}
