// backfill-episodes — SPEC §2.7 migration path, §0.3's bounded-backfill
// adjudication: "deterministic boundaries for all history (no LLM); LLM
// consolidation for top-K=200 salient episodes/device (≈$0.25/device) + B's
// legacy quarantine." Three deterministic-then-priced stages, in order,
// each resumable independently:
//
//   1. BOUNDARIES (free, deterministic) — every meera_log row still
//      unclaimed (episode_id IS NULL) gets covered by a >45-min-gap /
//      channel-change segmented vy_episode. No LLM. This alone gives every
//      historical row a citation anchor, even before a cent is spent.
//   2. LEGACY QUARANTINE (free, deterministic) — every meera_nodes row
//      becomes ONE vy_fact provenance='legacy' row: no citation required
//      (the schema CHECK exempts 'legacy'), but the frozen forget cascade
//      (api/memory.js, WS-SCHEMA's) already treats provenance='legacy' as
//      barred from being cited by new derivations and over-deleted on any
//      plausibly-covering scope — quarantine is enforced elsewhere, this
//      script only needs to WRITE the rows correctly labelled.
//   3. LLM ENRICHMENT (priced, bounded) — the K=200/device MOST SALIENT
//      backfilled episodes (ranked by message count — a cheap, honest proxy
//      for "something happened here" with zero model cost) get a real
//      summary + affect tags + anchored importance + cited facts, via the
//      SAME writer-window-validated shape api/consolidate.js uses, but
//      scoped to one already-boundaried episode at a time (segmentation is
//      done, so citation validation degrades to "does every fact cite THIS
//      episode" — trivially checkable).
//
//   node scripts/migrate/backfill-episodes.mjs --device <uuid> [--k 200] [--dry-run]
//   node scripts/migrate/backfill-episodes.mjs --all [--k 200]   (every device with unclaimed log rows)
//
// NEVER the free Gemini-key pool for this (api/_gkeys.js is a DAILY budget
// meant for live user-facing traffic; a bulk backfill would starve it for
// everyone else the same day). Azure credits first (extract-model), a PAID
// OpenRouter fallback second — same two models api/memory.js's opRemember
// already uses for the identical class of work.
import { q } from "../../api/_db.js";
import { embedBatch, toHalfvecLiteral, embedCostSnapshot } from "../../api/_embed.js";
import { AZURE_ENDPOINT, AZURE_KEY, OPENROUTER_KEY } from "../../api/_config.js";

// Meera's agent id — mirrored, asserted by scripts/verify-agent-id.mjs.
// Migration 010 dropped the transitional column defaults, so every writer
// into an agent-scoped table names it explicitly or fails loudly. Note the
// .catch() swallows below: without an explicit agent_id these would have
// failed SILENTLY post-010 — the relstate-zero-rows shape, again.
const MEERA_AGENT_ID = "a0000000-0000-4000-8000-000000000001";


const AZ_ENDPOINT = process.env.AZURE_ENDPOINT || AZURE_ENDPOINT;
const AZ_KEY = process.env.AZURE_API_KEY || AZURE_KEY;
const OR_KEY = process.env.OPENROUTER_API_KEY || OPENROUTER_KEY;
const EXTRACT_MODEL_AZURE = "grok-4-1-fast-reasoning";
const EXTRACT_MODEL_FALLBACK = "google/gemini-3.1-flash-lite"; // paid OpenRouter, not the free pool

const GAP_MS = 45 * 60_000;
const DEFAULT_K = 200;

const cost = { azure_calls: 0, azure_tok_in: 0, azure_tok_out: 0, or_calls: 0, or_tok_in: 0, or_tok_out: 0 };

async function llm(messages, maxTokens) {
  if (AZ_ENDPOINT && AZ_KEY) {
    try {
      const r = await fetch(`${AZ_ENDPOINT}/chat/completions`, {
        method: "POST",
        headers: { "api-key": AZ_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ model: EXTRACT_MODEL_AZURE, max_tokens: maxTokens, messages }),
        signal: AbortSignal.timeout(30_000),
      });
      if (r.ok) {
        const j = await r.json();
        const t = j?.choices?.[0]?.message?.content;
        if (t) {
          cost.azure_calls++;
          cost.azure_tok_in += Number(j?.usage?.prompt_tokens) || 0;
          cost.azure_tok_out += Number(j?.usage?.completion_tokens) || 0;
          return t;
        }
      }
    } catch {
      /* fall through — a bad Azure minute costs a slower call, never a lost memory */
    }
  }
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OR_KEY}`, "Content-Type": "application/json", "X-Title": "Meera" },
    body: JSON.stringify({ model: EXTRACT_MODEL_FALLBACK, max_tokens: maxTokens, messages }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return null;
  const j = await res.json();
  cost.or_calls++;
  cost.or_tok_in += Number(j?.usage?.prompt_tokens) || 0;
  cost.or_tok_out += Number(j?.usage?.completion_tokens) || 0;
  return j?.choices?.[0]?.message?.content ?? null;
}

function parseJsonLoose(s) {
  if (typeof s !== "string") return null;
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b < a) return null;
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch {
    return null;
  }
}
function telegraphic(s, cap = 160) {
  return String(s || "").trim().replace(/\s+/g, " ").slice(0, cap).replace(/[.!?]+$/, "");
}

// ── stage 1: deterministic boundaries, no LLM ──
async function backfillBoundaries(device) {
  const rows = await q(
    `select id, role, channel, kind, content, at from meera_log
      where device_id = $1 and episode_id is null order by id asc`,
    [device],
  );
  if (!rows.length) return { episodes: 0, rows: 0 };
  let episodes = 0;
  let segStart = 0;
  const flush = async (from, to) => {
    const span = rows.slice(from, to + 1);
    const channel = span.every((r) => r.channel === "call") ? "call" : "chat";
    const ins = await q(
      `insert into vy_episode
         (person_id, agent_id, device_id, channel, participation, started_at, ended_at,
          boundary_reason, log_from, log_to, summary, importance, tier, provisional)
       values ($1,($7)::uuid,$1,$2,'user',$3,$4,'backfill',$5,$6,'',1.0,0,false)
       returning id`,
      [device, channel, span[0].at, span[span.length - 1].at, span[0].id, span[span.length - 1].id, MEERA_AGENT_ID],
    );
    const epId = ins[0].id;
    await q(`update meera_log set episode_id = $1 where device_id = $2 and id between $3 and $4`, [
      epId,
      device,
      span[0].id,
      span[span.length - 1].id,
    ]);
    episodes++;
  };
  for (let i = 1; i < rows.length; i++) {
    const gap = new Date(rows[i].at) - new Date(rows[i - 1].at);
    const channelChange = rows[i].channel !== rows[i - 1].channel;
    if (gap > GAP_MS || channelChange) {
      await flush(segStart, i - 1);
      segStart = i;
    }
  }
  await flush(segStart, rows.length - 1);
  return { episodes, rows: rows.length };
}

// ── stage 2: legacy quarantine, no LLM ──
async function legacyQuarantine(device, person) {
  const nodes = await q(
    `select id, kind, name, summary, feel from meera_nodes where device_id = $1`,
    [device],
  );
  if (!nodes.length) return { written: 0, skipped: 0 };
  const existing = await q(
    `select lower(name) as name from vy_fact where person_id = $1 and provenance = 'legacy'`,
    [person],
  );
  const have = new Set(existing.map((r) => r.name));
  let written = 0;
  let skipped = 0;
  const toWrite = nodes.filter((n) => !have.has(String(n.name).toLowerCase()));
  const vecs = toWrite.length
    ? await embedBatch(toWrite.map((n) => `${n.name}: ${n.summary}`.slice(0, 300))).catch(() => [])
    : [];
  for (let i = 0; i < toWrite.length; i++) {
    const n = toWrite[i];
    if (have.has(n.name.toLowerCase())) {
      skipped++;
      continue;
    }
    const ins = await q(
      `insert into vy_fact (person_id, agent_id, kind, name, body, feel, provenance, confidence, citations, provisional)
       values ($1,($5)::uuid,'user',$2,$3,$4,'legacy',0.6,'{}',false) returning id`,
      [person, n.name.toLowerCase().slice(0, 60), `${n.name}: ${n.summary}`.slice(0, 160), n.feel || "", MEERA_AGENT_ID],
    ).catch(() => []);
    if (ins[0] && vecs[i]) {
      await q(
        `insert into vy_embedding (owner_kind, owner_id, person_id, agent_id, v)
           values ('fact',$1,$2,($4)::uuid,$3::halfvec)`,
        [ins[0].id, person, toHalfvecLiteral(vecs[i]), MEERA_AGENT_ID],
      ).catch(() => {});
    }
    if (ins[0]) written++;
  }
  return { written, skipped };
}

// ── stage 3: LLM enrichment, top-K salient backfilled episodes ──
async function salientBackfillEpisodes(person, k) {
  return q(
    `select e.id, e.device_id, e.log_from, e.log_to, e.started_at, e.ended_at, e.channel,
            (e.log_to - e.log_from + 1) as span
       from vy_episode e
      where e.person_id = $1 and e.boundary_reason = 'backfill' and e.summary = ''
      order by span desc
      limit $2`,
    [person, k],
  );
}

function enrichPrompt(lines) {
  return `Summarize this ALREADY-SEGMENTED conversation stretch for a companion app's long-term memory. Reply with ONLY JSON:
{"summary":"telegraphic note, <=18 words, third person, no terminal punctuation","affect":[{"tag":"warm|stressed|excited|sad|teasing|bored|anxious|content","intensity":0.0}],"importance":"low|medium|high","facts":[{"kind":"user|world|self_in_relation|relationship|india|meera","name":"short lowercase label","body":"telegraphic note, <=18 words, third person","feel":"their own words, or empty string"}]}

Anchored importance — compare to these exemplars, pick the closest, never invent your own scale:
  LOW like: "ok yaar chalti hai, kya kar rahe ho abhi" — routine check-in
  MEDIUM like: "aaj interview tha, thodi nervous thi but theek gaya" — a normal worth-remembering event
  HIGH like: "nani chal basi is hafte, abhi bhi samajh nahi aa raha" — a major life event

Skip small talk. Max 4 facts. Never sentence-shaped prose, never Meera's own first-person voice.

CONVERSATION:
${lines}`;
}

async function enrichEpisode(person, ep, rxs) {
  const rows = await q(
    `select role, channel, content, at from meera_log where device_id = $1 and id between $2 and $3 order by id`,
    [ep.device_id, ep.log_from, ep.log_to],
  );
  const lines = rows.map((r) => `${r.role}/${r.channel}: ${String(r.content).slice(0, 280)}`).join("\n");
  const raw = await llm([{ role: "user", content: enrichPrompt(lines) }], 700);
  if (!raw) return { ok: false };
  const parsed = parseJsonLoose(raw);
  if (!parsed) return { ok: false };

  const summary = telegraphic(parsed.summary, 160);
  if (!summary || rxs.some((rx) => rx.test(summary))) return { ok: false };
  const band = ["low", "medium", "high"].includes(parsed.importance) ? parsed.importance : "medium";
  const importance = { low: 0.5, medium: 1.0, high: 1.8 }[band];
  const affect = Array.isArray(parsed.affect)
    ? parsed.affect
        .filter((a) => a && typeof a.tag === "string")
        .slice(0, 4)
        .map((a) => ({
          tag: a.tag.slice(0, 24),
          intensity: Math.max(0, Math.min(1, Number(a.intensity) || 0.3)),
          source: "text",
          extractor: EXTRACT_MODEL_AZURE,
          confidence: 0.65,
        }))
    : [];
  await q(`update vy_episode set summary = $1, affect_tags = $2::jsonb, importance = $3 where id = $4`, [
    summary,
    JSON.stringify(affect),
    importance,
    ep.id,
  ]);

  const facts = (Array.isArray(parsed.facts) ? parsed.facts : [])
    .map((f) => ({
      kind: ["user", "world", "self_in_relation", "relationship", "india", "meera"].includes(f.kind) ? f.kind : "user",
      name: String(f.name || "").trim().toLowerCase().slice(0, 60),
      body: telegraphic(f.body, 160),
      feel: telegraphic(f.feel, 60),
    }))
    .filter((f) => f.name && f.body && !rxs.some((rx) => rx.test(f.body) || rx.test(f.name)));

  let written = 0;
  if (facts.length) {
    const vecs = await embedBatch(facts.map((f) => f.body)).catch(() => []);
    for (let i = 0; i < facts.length; i++) {
      const f = facts[i];
      const ins = await q(
        `insert into vy_fact (person_id, agent_id, kind, name, body, feel, provenance, confidence, citations, provisional)
         values ($1,($7)::uuid,$2,$3,$4,$5,'extracted',0.75,$6::bigint[],false) returning id`,
        [person, f.kind, f.name, f.body, f.feel, [ep.id], MEERA_AGENT_ID],
      ).catch(() => []);
      if (ins[0]) {
        written++;
        if (vecs[i]) {
          await q(
            `insert into vy_embedding (owner_kind, owner_id, person_id, agent_id, v)
               values ('fact',$1,$2,($4)::uuid,$3::halfvec)`,
            [ins[0].id, person, toHalfvecLiteral(vecs[i]), MEERA_AGENT_ID],
          ).catch(() => {});
        }
      }
    }
  }
  await q(
    `insert into vy_derivation (person_id, agent_id, model, prompt_hash, input_from, input_to, wrote)
     values ($1,($6)::uuid,$2,'backfill-enrich',$3,$4,$5::jsonb)`,
    [person, AZ_KEY ? EXTRACT_MODEL_AZURE : EXTRACT_MODEL_FALLBACK, ep.log_from, ep.log_to, JSON.stringify([{ table: "vy_episode", id: ep.id }]), MEERA_AGENT_ID],
  ).catch(() => {});
  return { ok: true, facts: written };
}

async function suppressionRegexes(device) {
  const rows = await q(`select term from meera_forget where device_id = $1 order by at desc limit 200`, [device]).catch(() => []);
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return rows.map((r) => new RegExp(`\\b${esc(r.term)}\\b`, "i"));
}

async function personIdFor(device) {
  const r = await q(`select person_id from vy_person_device where device_id = $1`, [device]).catch(() => []);
  return r[0]?.person_id || device;
}

async function backfillDevice(device, k, dryRun) {
  const person = await personIdFor(device);
  const boundaries = dryRun ? { episodes: 0, rows: 0 } : await backfillBoundaries(device);
  const legacy = dryRun ? { written: 0, skipped: 0 } : await legacyQuarantine(device, person);
  const rxs = await suppressionRegexes(device);
  const candidates = await salientBackfillEpisodes(person, k);
  let enriched = 0;
  let factsWritten = 0;
  if (!dryRun) {
    for (const ep of candidates) {
      const r = await enrichEpisode(person, ep, rxs);
      if (r.ok) {
        enriched++;
        factsWritten += r.facts;
      }
    }
  }
  return {
    device,
    person,
    boundaries,
    legacy,
    enrichment_candidates: candidates.length,
    enriched,
    facts_written: factsWritten,
  };
}

async function activeDevices() {
  const rows = await q(
    `select distinct device_id from meera_log where episode_id is null
     union
     select distinct device_id from vy_episode where boundary_reason = 'backfill' and summary = ''`,
  );
  return rows.map((r) => r.device_id);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const k = args.includes("--k") ? Number(args[args.indexOf("--k") + 1]) : DEFAULT_K;
  const deviceArg = args.includes("--device") ? args[args.indexOf("--device") + 1] : null;
  const all = args.includes("--all");

  const devices = deviceArg ? [deviceArg] : all ? await activeDevices() : [];
  if (!devices.length) {
    console.log("nothing to do: pass --device <uuid> or --all");
    process.exit(0);
  }

  const t0 = Date.now();
  const reports = [];
  for (const device of devices) {
    const r = await backfillDevice(device, k, dryRun);
    reports.push(r);
    console.log(
      `${device.slice(0, 8)}  boundaries:${r.boundaries.episodes}ep/${r.boundaries.rows}rows  legacy:${r.legacy.written}w/${r.legacy.skipped}skip  enriched:${r.enriched}/${r.enrichment_candidates}  facts:${r.facts_written}`,
    );
  }

  const embed = embedCostSnapshot();
  const summary = {
    devices: devices.length,
    boundaries_episodes: reports.reduce((s, r) => s + r.boundaries.episodes, 0),
    legacy_written: reports.reduce((s, r) => s + r.legacy.written, 0),
    enriched_episodes: reports.reduce((s, r) => s + r.enriched, 0),
    facts_written: reports.reduce((s, r) => s + r.facts_written, 0),
    cost: {
      ...cost,
      embed_azure_calls: embed.azure_calls,
      embed_azure_tokens: embed.azure_tokens,
      embed_openrouter_calls: embed.openrouter_calls,
      embed_openrouter_tokens: embed.openrouter_tokens,
      embed_failures: embed.failures,
    },
    ms: Date.now() - t0,
    per_device_ms: devices.length ? Math.round((Date.now() - t0) / devices.length) : 0,
  };
  console.log("\n" + JSON.stringify(summary, null, 2));
}

main();
