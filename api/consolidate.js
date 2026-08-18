// Nightly finalize — SPEC §4.1 (nightly pass), §4.2 (citation enforcement,
// layers 2+3), §4.3 (cost arithmetic). Runs from `.github/workflows/
// consolidate.yml` (cron 03:30 IST) directly via `node api/consolidate.js`
// against Neon (no Vercel function timeout in the loop), and is also a
// normal Vercel POST endpoint for on-demand runs / smoke tests — same
// pattern api/culture.js already uses, one function serving both.
//
// WHAT THIS FILE DOES:
//   1. finalize — for each person with STALE provisional episodes (no new
//      activity in the last FINALIZE_QUIET_MS, so we are not re-segmenting
//      something the user is still adding to), re-derive the covered
//      meera_log span into FINAL episodes + cited facts, one LLM pass.
//   2. citation enforcement layer 2 — WRITER WINDOW VALIDATION: the model
//      is never allowed to invent a citation. It is handed a NUMBERED batch
//      of log rows and may only reference episodes by INDEX into that same
//      batch; an index outside the batch cannot exist in its output space
//      by construction, and any fact whose cited segment maps to a
//      REJECTED episode is rejected too — strict, no salvage.
//   3. citation enforcement layer 3 — a 5% SAMPLED ENTAILMENT AUDIT, second-
//      family judge (extraction runs on the Azure/xAI family; the audit
//      runs on Google via OpenRouter — a different family, per SPEC §0.3).
//      Refutation >2% (n>=5) HALTS the run — the GH Actions job goes red,
//      which is this repo's existing "page the owner" convention
//      (.github/workflows/culture.yml's own comment: "still worth a red
//      run so a week of failures is visible").
//   4. contradictions — new row + t_invalid/superseded_by; never
//      update-in-place (a named defect elsewhere in this codebase).
//   5. decay — need_p recomputed in pure SQL from recency + kind.
//   6. suppression — every write filtered against meera_forget first.
//
// OUT OF SCOPE, deliberately, per the §13 file-ownership collision contract:
// vy_pattern / vy_rel_event writes (WS-RELSTATE, M4, which DEPENDS on this
// workstream rather than the reverse — this file supplies the citable
// ground truth patterns will cite), taste nomination (WS-RELSTATE's
// api/taste-queue.js), tier-compaction's weekly-digest form (logged as a
// deferred M3→M4 handoff below), prosody baseline (WS-BATTERY's
// scripts/prosody-baseline.mjs).
import { q } from "./_db.js";
import { embedBatch, toHalfvecLiteral } from "./_embed.js";
import { AZURE_ENDPOINT, AZURE_KEY, OPENROUTER_KEY } from "./_config.js";
// GAP 2 (WS-FELT) — day-1 seed HTTP path only (see the handler below).
// allow/ipOf + the device-uuid check is the exact pattern api/memory.js and
// api/episodes.js already use; personIdFor is api/memory.js's own device→
// person resolver (already imported the same way by api/episodes.js — same
// precedent, not a new coupling). Neither import is touched by the CLI/cron
// path this file also serves (`node api/consolidate.js` never calls the
// handler function at all), so this adds one more module load and nothing
// else to that path.
import { allow, ipOf } from "./_ratelimit.js";
import { personIdFor } from "./memory.js";

const AZ_ENDPOINT = process.env.AZURE_ENDPOINT || AZURE_ENDPOINT;
const AZ_KEY = process.env.AZURE_API_KEY || AZURE_KEY;
const OR_KEY = process.env.OPENROUTER_API_KEY || OPENROUTER_KEY;

// `extract-model` (context/decisions.md): judgement work, nobody waits on
// it, Azure credits first, OpenRouter fallback — "a bad Azure minute must
// cost a slower extraction, never a lost memory."
const EXTRACT_MODEL_AZURE = "grok-4-1-fast-reasoning";
const EXTRACT_MODEL_FALLBACK = "google/gemini-3.1-flash-lite";
// Second-family judge for the entailment audit (SPEC §0.3): extraction runs
// on the xAI family, so the audit must not — Google via the existing
// OpenRouter brain lane.
const AUDIT_MODEL = "google/gemini-3.6-flash";

// A provisional episode is only finalized once it has been quiet this long —
// otherwise a still-active conversation gets re-segmented out from under
// itself. 30 minutes is comfortably past the live-lane's own 45-minute
// gap-boundary, so a finalize run never races an in-turn write.
const FINALIZE_QUIET_MS = 30 * 60_000;
// §4.3: "batches of 25 with a DB cursor" — how many persons one invocation
// processes. meera_log.episode_id IS NULL is the cursor itself (see below):
// idempotent and resumable with no new table.
const DEFAULT_PERSON_LIMIT = 25;
// Cost/latency ceiling per person per run — a chatty person's whole history
// is never pulled in one call; the remainder waits for the next run
// (§12 failure mode 7: "a missed pass is late, never lost").
const LOG_BATCH_CAP = 220;
const AUDIT_SAMPLE_RATE = 0.05;
const AUDIT_REFUTATION_HALT = 0.02;
const AUDIT_MIN_N = 5;

// Anchored importance (SPEC §4.1.6): comparison against fixed exemplars,
// never raw LLM self-rating (documented inflation elsewhere in this repo).
const IMPORTANCE_ANCHORS = {
  low: { text: "\"ok yaar chalti hai, kya kar rahe ho abhi\" — routine check-in, forgettable by next week", value: 0.5 },
  medium: { text: "\"aaj interview tha, thodi nervous thi but theek gaya\" — a normal event worth remembering", value: 1.0 },
  high: { text: "\"nani chal basi is hafte, abhi bhi samajh nahi aa raha\" — a major life event", value: 1.8 },
};

// Decay defaults (SPEC §10-Q6's own stated number: "episodic half-life ~60
// days of non-use"). config/decay.json is WS-RELSTATE's exclusive file
// (§13) and does not exist yet — WS-RELSTATE depends on WS-CONSOLIDATE, so
// M3 ships first. This reads it if present (forward-compatible interface)
// and falls back to the spec's own documented default otherwise; nothing
// here breaks once WS-RELSTATE lands the file.
async function loadDecayConfig() {
  try {
    const mod = await import("../config/decay.json", { with: { type: "json" } });
    return mod.default;
  } catch {
    return {
      half_life_days: { user: 60, world: 60, self_in_relation: 60, relationship: 90, india: 90, meera: 180 },
    };
  }
}

const cost = { azure_calls: 0, azure_tokens_in: 0, azure_tokens_out: 0, fallback_calls: 0, audit_calls: 0, embed: null };

async function llm(messages, maxTokens, { model = null } = {}) {
  if (AZ_ENDPOINT && AZ_KEY) {
    try {
      const r = await fetch(`${AZ_ENDPOINT}/chat/completions`, {
        method: "POST",
        headers: { "api-key": AZ_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ model: model || EXTRACT_MODEL_AZURE, max_tokens: maxTokens, messages }),
        signal: AbortSignal.timeout(45_000),
      });
      if (r.ok) {
        const j = await r.json();
        const t = j?.choices?.[0]?.message?.content;
        if (t) {
          cost.azure_calls++;
          cost.azure_tokens_in += Number(j?.usage?.prompt_tokens) || 0;
          cost.azure_tokens_out += Number(j?.usage?.completion_tokens) || 0;
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
    body: JSON.stringify({ model: model || EXTRACT_MODEL_FALLBACK, max_tokens: maxTokens, messages }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) return null;
  const j = await res.json();
  cost.fallback_calls++;
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

// Lightweight, self-contained shape check (SPEC §3.3's word/sentence rules),
// deliberately NOT importing src/engine/shapelint.ts: that file is
// WS-COMPILER's, bundled into the client via Vite, and this is a Node
// script executed directly by a GH Actions runner outside that build graph
// — cross-bundling it here would be an untested dependency on a build path
// nothing in this repo currently exercises. The two rules that matter for
// write-time discipline (word cap, no sentence punctuation) are mechanical
// enough to duplicate safely; the compiler's own belt-and-braces pass at
// read time is the authority WS-COMPILER owns.
function telegraphic(s, cap = 160) {
  let t = String(s || "").trim().replace(/\s+/g, " ").slice(0, cap);
  t = t.replace(/[.!?]+$/, "");
  return t;
}
function wordCount(s) {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// mirrors relstate.ts's WE_TOKEN_RE exactly (source of truth:
// src/engine/relstate.ts, SPEC §6.3's own shape-lint rule for WE-summaries:
// "a we-summary with no dono/saath/we/together token pair is rejected") —
// same verbatim-port precedent as HINDI_MARKER_WORDS/computeCsRatio further
// down this file (deterministic regex, zero LLM judgement, so a duplicate
// carries none of the confabulation risk the pattern/trust cut elsewhere in
// this file is avoiding). Two shapes of the one rule: the JS RegExp
// classifies participation at insert time below (finalizePerson); the ~*
// SQL pattern (WE_TOKEN_SQL, Postgres ARE word-boundary syntax — same `\m`/
// `\M` convention HINDI_MARKER_WORDS already uses, since POSIX `\b` is not a
// word boundary in Postgres advanced regex) powers the one-time catch-up
// backfill for rows written before this classification existed.
const WE_TOKEN_RE = /\b(dono|dono[nm]e|saath|sath|we|together|hum(dono)?|humne)\b/i;
const WE_TOKEN_SQL = `\\m(dono|dono[nm]e|saath|sath|we|together|hum(dono)?|humne)\\M`;

async function suppressionRegexes(person) {
  const rows = await q(
    `select term from meera_forget where device_id = $1 order by at desc limit 200`,
    [person],
  ).catch(() => []);
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return rows.map((r) => new RegExp(`\\b${esc(r.term)}\\b`, "i")).filter(Boolean);
}
function suppressed(text, rxs) {
  return rxs.some((rx) => rx.test(text));
}

/** People with quiet-enough provisional episodes waiting to finalize. */
async function findEligiblePersons(limit) {
  const rows = await q(
    `select distinct person_id from vy_episode
      where provisional = true and superseded_by is null
        and ended_at < now() - ($1 || ' milliseconds')::interval
      order by person_id
      limit $2`,
    [String(FINALIZE_QUIET_MS), limit],
  );
  return rows.map((r) => r.person_id);
}

/** Build the numbered batch this person's finalize run may cite from. */
async function fetchLogBatch(person) {
  // meera_log is device-keyed; a person may (eventually) span devices —
  // vy_person_device is the mapping both ways.
  const devices = await q(`select device_id from vy_person_device where person_id = $1`, [person]);
  const deviceIds = devices.length ? devices.map((d) => d.device_id) : [person]; // person_id := device_id cast
  return q(
    `select id, device_id, role, channel, kind, content, at from meera_log
      where device_id = any($1::uuid[]) and episode_id is null
      order by id asc limit $2`,
    [deviceIds, LOG_BATCH_CAP],
  );
}

function renderBatch(rows) {
  let lastAt = null;
  return rows
    .map((r, i) => {
      const at = new Date(r.at);
      const gap = lastAt ? Math.round((at - lastAt) / 60_000) : 0;
      lastAt = at;
      const gapNote = gap > 5 ? ` [gap ${gap}m]` : "";
      return `[${i}] ${r.role}/${r.channel}${gapNote}: ${String(r.content).slice(0, 280)}`;
    })
    .join("\n");
}

function extractionPrompt(batchText, lastIndex) {
  return `You are segmenting a real conversation log into episodes and deriving cited facts, for a companion app's long-term memory. Reply with ONLY JSON:
{"episodes":[{"from":0,"to":4,"channel":"chat|call","reason":"gap|channel|topic|affect|goal|session","summary":"telegraphic note, <=18 words, no terminal punctuation, third person","affect":[{"tag":"warm|stressed|excited|sad|teasing|bored|anxious|content","intensity":0.0}],"importance":"low|medium|high"}],
"facts":[{"kind":"user|world|self_in_relation|relationship|india|meera","name":"short lowercase label","body":"telegraphic note, <=18 words, third person, no terminal punctuation","feel":"their own words for how it felt, or empty string","segments":[0]}]}

RULES, hard:
- "from"/"to" in "episodes" and every number in "segments" MUST be indices into the numbered log below — never invent a number outside [0, ${lastIndex}].
- Every fact's "segments" must be non-empty and point only at episode indices you actually proposed (by their position in the "episodes" array, 0-based).
- "importance": compare the episode's WEIGHT to these anchors, pick the closest —
  LOW like: ${IMPORTANCE_ANCHORS.low.text}
  MEDIUM like: ${IMPORTANCE_ANCHORS.medium.text}
  HIGH like: ${IMPORTANCE_ANCHORS.high.text}
  Never invent your own scale.
- kind "meera" = the companion's own life (only if she said something about herself in this stretch). kind "user"/"world" = the user's people/places/events. "self_in_relation" = how she is being WITH this specific person (only with real evidence in this stretch). "relationship"/"india" only with clear textual evidence (address terms, kin words, festival/food-as-care).
- Segment boundaries: a new episode on a >45-minute gap, a channel change, or a clear topic/affect/goal shift. Do not over-segment routine back-and-forth into many tiny episodes.
- Skip small talk entirely — only facts worth recalling weeks later.
- Never write a sentence-shaped line (no capital-start-plus-period prose). Telegraphic notes only, third person, never Meera's own first-person voice.

LOG (numbered, [gap Nm] marks a real time gap):
${batchText}`;
}

async function auditJudge(factBody, episodeSummaries, sourceLines) {
  const prompt = `A memory system derived this fact from a conversation. Judge ONLY whether the fact is ENTAILED by the source text — supported, not merely plausible. Reply with ONLY one word: YES, NO, or ABSTAIN (if the source is genuinely ambiguous).

FACT: ${factBody}
EPISODE SUMMARY: ${episodeSummaries.join(" / ")}
SOURCE LINES:
${sourceLines.join("\n")}`;
  const r = await llm([{ role: "user", content: prompt }], 8, { model: AUDIT_MODEL });
  const verdict = String(r || "").trim().toUpperCase();
  if (verdict.startsWith("YES")) return "entailed";
  if (verdict.startsWith("NO")) return "refuted";
  return "abstain";
}

/** Finalize one person: the whole nightly pass, scoped to their stale
 *  provisional window. Returns a per-person report for the run summary. */
async function finalizePerson(person, { dryRun = false } = {}) {
  const rep = { person, log_rows: 0, episodes: 0, facts: 0, rejected_episodes: 0, rejected_facts: 0, audited: 0, refuted: 0, superseded_episodes: 0, superseded_facts: 0 };
  const batch = await fetchLogBatch(person);
  if (!batch.length) return rep;
  rep.log_rows = batch.length;
  const inputFrom = batch[0].id;
  const inputTo = batch[batch.length - 1].id;

  const rendered = renderBatch(batch);
  const raw = await llm([{ role: "user", content: extractionPrompt(rendered, batch.length - 1) }], 2200);
  if (!raw) return rep; // a failed derivation is a late pass, never a lost one — retried next run
  const parsed = parseJsonLoose(raw);
  if (!parsed) return rep;

  const rxs = await suppressionRegexes(person);
  const proposedEpisodes = Array.isArray(parsed.episodes) ? parsed.episodes : [];
  const proposedFacts = Array.isArray(parsed.facts) ? parsed.facts : [];

  // ── writer window validation (§4.2 layer 2): strict, no salvage ──
  const acceptedEpIdx = new Map(); // proposal index -> {row data}
  proposedEpisodes.forEach((e, idx) => {
    const from = Number(e.from);
    const to = Number(e.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to >= batch.length || to < from) {
      rep.rejected_episodes++;
      return;
    }
    const chanRows = batch.slice(from, to + 1);
    const channel = chanRows.every((r) => r.channel === "call") ? "call" : "chat";
    const summary = telegraphic(e.summary, 160);
    if (suppressed(summary, rxs)) {
      rep.rejected_episodes++;
      return;
    }
    const affect = Array.isArray(e.affect)
      ? e.affect
          .filter((a) => a && typeof a.tag === "string")
          .slice(0, 4)
          .map((a) => ({ tag: a.tag.slice(0, 24), intensity: Math.max(0, Math.min(1, Number(a.intensity) || 0.3)), source: "text", extractor: EXTRACT_MODEL_AZURE, confidence: 0.7 }))
      : [];
    const band = ["low", "medium", "high"].includes(e.importance) ? e.importance : "medium";
    acceptedEpIdx.set(idx, {
      logFrom: batch[from].id,
      logTo: batch[to].id,
      startedAt: batch[from].at,
      endedAt: batch[to].at,
      channel,
      reason: ["gap", "channel", "topic", "affect", "goal", "session"].includes(e.reason) ? e.reason : "topic",
      summary,
      affect,
      importance: IMPORTANCE_ANCHORS[band].value,
    });
  });

  if (!acceptedEpIdx.size) return rep; // nothing citable was proposed this run

  const episodeIdByIdx = new Map();
  if (!dryRun) {
    for (const [idx, e] of acceptedEpIdx) {
      // GAP 1 (WS-FELT): participation was hardcoded 'user' here regardless
      // of content, so T6 we.callbacks (relstate.ts's renderWeCallbacks,
      // gated on participation='we' at the api/memory.js query) rendered ""
      // for every real user even though the summary itself carried a WE
      // token. Classify with the same WE_TOKEN_RE relstate.ts's own
      // renderWeCallbacks re-checks client-side (belt-and-braces, see that
      // function's own comment) — one rule, checked in both places, never
      // drifting.
      const participation = WE_TOKEN_RE.test(e.summary) ? "we" : "user";
      const ins = await q(
        `insert into vy_episode (person_id, device_id, channel, participation, started_at, ended_at,
           boundary_reason, log_from, log_to, summary, affect_tags, importance, provisional)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,false)
         returning id`,
        [person, batch[0].device_id, e.channel, participation, new Date(e.startedAt).toISOString(), new Date(e.endedAt).toISOString(), e.reason, e.logFrom, e.logTo, e.summary, JSON.stringify(e.affect), e.importance],
      ).catch(() => []);
      if (ins[0]) episodeIdByIdx.set(idx, ins[0].id);
    }
    rep.episodes = episodeIdByIdx.size;
    // mark the log rows as claimed — meera_log.episode_id IS the cursor:
    // "unconsolidated" simply means episode_id is still null, so the next
    // run's fetchLogBatch naturally skips everything finalized here. Each
    // episode claims exactly its own span, never another's.
    for (const [idx, e] of acceptedEpIdx) {
      const finalId = episodeIdByIdx.get(idx);
      if (finalId == null) continue;
      await q(
        `update meera_log set episode_id = $1 where device_id = $2 and id between $3 and $4 and episode_id is null`,
        [finalId, batch[0].device_id, e.logFrom, e.logTo],
      ).catch(() => {});
    }
  } else {
    for (const idx of acceptedEpIdx.keys()) episodeIdByIdx.set(idx, -1 - idx); // synthetic ids for reporting only
    rep.episodes = episodeIdByIdx.size;
  }

  // ── facts: writer window validation continues — a fact citing a
  // rejected episode index has no anchor and is rejected too ──
  const factsToEmbed = [];
  const auditPool = [];
  for (const f of proposedFacts) {
    const segIdxs = Array.isArray(f.segments) ? f.segments.filter((n) => Number.isInteger(n)) : [];
    const citedEpIds = [...new Set(segIdxs.map((i) => episodeIdByIdx.get(i)).filter((v) => v != null))];
    if (!citedEpIds.length) {
      rep.rejected_facts++;
      continue;
    }
    const kind = ["user", "world", "self_in_relation", "relationship", "india", "meera"].includes(f.kind) ? f.kind : "user";
    const body = telegraphic(f.body, 160);
    const name = String(f.name || "").trim().toLowerCase().slice(0, 60);
    if (!body || !name || wordCount(body) > 24) {
      rep.rejected_facts++;
      continue;
    }
    if (suppressed(body, rxs) || suppressed(name, rxs)) {
      rep.rejected_facts++;
      continue;
    }
    factsToEmbed.push({ kind, name, body, feel: telegraphic(f.feel, 60), citations: citedEpIds, segIdxs });
  }

  if (!factsToEmbed.length) {
    rep.facts = 0;
  } else if (dryRun) {
    rep.facts = factsToEmbed.length;
  } else {
    const vecs = await embedBatch(factsToEmbed.map((f) => f.body)).catch(() => []);
    for (let i = 0; i < factsToEmbed.length; i++) {
      const f = factsToEmbed[i];
      // contradiction handling (§4.1.3): a NEW row always; an existing
      // active final fact with the same name gets superseded, never
      // updated in place.
      const prior = await q(
        `select id, body from vy_fact where person_id = $1 and lower(name) = $2
           and provisional = false and t_invalid is null and retracted_at is null
         order by created_at desc limit 1`,
        [person, f.name],
      ).catch(() => []);
      const ins = await q(
        `insert into vy_fact (person_id, kind, name, body, feel, provenance, confidence, citations, provisional)
         values ($1,$2,$3,$4,$5,'extracted',0.85,$6::bigint[],false)
         returning id`,
        [person, f.kind, f.name, f.body, f.feel, f.citations],
      ).catch(() => []);
      if (!ins[0]) continue;
      rep.facts++;
      const newId = ins[0].id;
      if (prior[0] && prior[0].body !== f.body) {
        await q(`update vy_fact set t_invalid = now(), superseded_by = $1 where id = $2`, [newId, prior[0].id]).catch(() => {});
      }
      // supersede the provisional fact(s) this promotes, matched by name
      // under the episodes just finalized (§0.2.1: provisional is
      // second-class, replaced wholesale on finalize)
      const provChain = await q(
        `update vy_fact set superseded_by = $1
           where person_id = $2 and lower(name) = $3 and provisional = true and superseded_by is null
             and citations && $4::bigint[]
         returning id`,
        [newId, person, f.name, [...episodeIdByIdx.values()]],
      ).catch(() => []);
      rep.superseded_facts += provChain.length;

      if (vecs[i]) {
        await q(
          `insert into vy_embedding (owner_kind, owner_id, person_id, v) values ('fact',$1,$2,$3::halfvec)
           on conflict (owner_kind, owner_id) do update set v = excluded.v, at = now()`,
          [newId, person, toHalfvecLiteral(vecs[i])],
        ).catch(() => {});
      }
      // §4.2 layer 3: sampled entailment audit pool (5%, abstention-aware)
      if (Math.random() < AUDIT_SAMPLE_RATE) auditPool.push({ factId: newId, body: f.body, epIdxs: f.segIdxs });
    }

    // supersede the provisional EPISODES this run finalized
    for (const [idx, e] of acceptedEpIdx) {
      const finalId = episodeIdByIdx.get(idx);
      if (finalId == null) continue;
      const supers = await q(
        `update vy_episode set superseded_by = $1
           where person_id = $2 and provisional = true and superseded_by is null
             and channel = $3 and log_from is not null and log_to is not null
             and log_from <= $5 and log_to >= $4
         returning id`,
        [finalId, person, e.channel, e.logFrom, e.logTo],
      ).catch(() => []);
      rep.superseded_episodes += supers.length;
    }
  }

  // ── entailment audit ──
  if (!dryRun && auditPool.length) {
    const epSummaryByIdx = new Map([...acceptedEpIdx.entries()].map(([idx, e]) => [idx, e.summary]));
    for (const item of auditPool) {
      const summaries = item.epIdxs.map((i) => epSummaryByIdx.get(i)).filter(Boolean);
      const lines = item.epIdxs
        .flatMap((i) => {
          const e = acceptedEpIdx.get(i);
          if (!e) return [];
          return batch.filter((r) => r.id >= e.logFrom && r.id <= e.logTo).map((r) => `${r.role}: ${r.content}`);
        })
        .slice(0, 40);
      const verdict = await auditJudge(item.body, summaries, lines);
      cost.audit_calls++;
      rep.audited++;
      if (verdict === "refuted") rep.refuted++;
      await q(`update vy_fact set retracted_at = case when $2 = 'refuted' then now() else retracted_at end where id = $1`, [item.factId, verdict === "refuted" ? "refuted" : "ok"]).catch(() => {});
      await q(
        `insert into vy_derivation (person_id, model, prompt_hash, input_from, input_to, wrote, audit_status)
         values ($1,$2,'audit',$3,$4,$5::jsonb,$6)`,
        [person, AUDIT_MODEL, inputFrom, inputTo, JSON.stringify([{ table: "vy_fact", id: item.factId }]), verdict],
      ).catch(() => {});
    }
  }

  // ── derivation audit record for the run itself (unaudited default) ──
  if (!dryRun) {
    await q(
      `insert into vy_derivation (person_id, model, prompt_hash, input_from, input_to, wrote)
       values ($1,$2,'finalize',$3,$4,$5::jsonb)`,
      [
        person,
        AZ_KEY ? EXTRACT_MODEL_AZURE : EXTRACT_MODEL_FALLBACK,
        inputFrom,
        inputTo,
        JSON.stringify([...episodeIdByIdx.values()].map((id) => ({ table: "vy_episode", id }))),
      ],
    ).catch(() => {});

    // ── decay (§4.1.7): pure SQL, kind-banded half-life ──
    const decayCfg = await loadDecayConfig();
    const hl = decayCfg.half_life_days || {};
    for (const [kind, days] of Object.entries(hl)) {
      await q(
        `update vy_fact set need_p = greatest(0.02, exp(-0.6931471805599453 * extract(epoch from (now() - created_at)) / (86400.0 * $3)))
           where person_id = $1 and kind = $2 and t_invalid is null and retracted_at is null`,
        [person, kind, days],
      ).catch(() => {});
    }
  }

  return rep;
}

// ─────────────────────────────────────────────────────────────────────────
// WS-INTEGRATE seam 4 — deriveAndWriteRelEvents orchestrator (SPEC §13:
// "WS-RELSTATE, M4, which DEPENDS on this workstream" — this file's own
// header names vy_pattern/vy_rel_event writes OUT OF SCOPE for exactly that
// reason; this seam is the dependent step that closes the loop, run AFTER
// finalize and BEFORE relcheck per the ticket).
//
// WHERE THE ORCHESTRATOR LIVES AND WHY: relstate.ts (src/engine/relstate.ts)
// is a NEW function's natural home per its own exports (honorificShift,
// detectAddressTerm, writeRelEvent, refreshDerivedDims are all already
// there, pure or QueryFn-injected) — but that file is bundled into the
// CLIENT via Vite (its own header: "src/engine/*.ts is the CLIENT bundle").
// This script runs as `node api/consolidate.js` directly on a GH Actions
// runner with NO bundler in the loop (consolidate.yml's own comment: "off
// Vercel's clock", no esbuild step) — Node 22 cannot import a .ts file
// without a loader this workflow does not configure. So a live import is not
// possible, exactly as the ticket anticipated ("relstate.ts... NOT possible
// — it's client-bundled").
//
// RESOLUTION TAKEN: this file already established the precedent for exactly
// this situation — see `telegraphic`/`wordCount` above and their own comment
// ("deliberately NOT importing src/engine/shapelint.ts... cross-bundling it
// here would be an untested dependency on a build path nothing in this repo
// currently exercises"). The honorific hysteresis and derived-dims math
// below follow that SAME precedent: duplicated here as plain JS, each block
// commented with the exact relstate.ts function/constants it mirrors, so a
// drift is auditable at a glance rather than silently possible. This is
// smaller and lower-risk than introducing a new shared pure-JS module (a
// third file to keep in sync instead of two, and a new ownership question
// §13 does not answer) — noted as the alternative the ticket allowed and the
// reason it was not taken.
//
// SCOPE CUT, STATED PLAINLY: this orchestrator derives and writes ONLY
// honorific rel-events (fully deterministic: regex address-term detection +
// relstate.ts's own hysteresis thresholds, mirrored exactly below) and
// refreshes the three derived dims (cs_ratio/ritual_density/pacing_gap_s —
// pure SQL, zero judgement, safe to port verbatim). It does NOT derive
// trust/rupture/repair/code-switch rel-events or vy_pattern rows. Those
// require actual JUDGEMENT of what happened in an episode — a real
// extraction step (an LLM prompt, review, and its own citation/entailment
// discipline), not something a deterministic integration pass may safely
// improvise. Fabricating that judgement here would risk exactly the
// confabulation / importance-inflation failure modes SPEC repeatedly rejects
// elsewhere in this same file. TICKETED BACK to WS-RELSTATE/WS-CONSOLIDATE
// as a real extraction-prompt-delta feature, not wired here.
// ─────────────────────────────────────────────────────────────────────────

// mirrors relstate.ts's padT/TU_MARKERS/AAP_MARKERS/TUM_MARKERS/detectAddressTerm exactly
const padT = (s) =>
  " " +
  String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim() +
  " ";
const TU_MARKERS = [" tu ", " tera ", " teri ", " tere ", " tujhe ", " tujhko "];
const AAP_MARKERS = [" aap ", " aapka ", " aapki ", " aapke ", " aapko ", " aapse "];
const TUM_MARKERS = [" tum ", " tumhe ", " tumhara ", " tumhari ", " tumhare ", " tumko "];
function detectAddressTerm(text) {
  const hay = padT(String(text || ""));
  const candidates = [
    [AAP_MARKERS, "aap"],
    [TU_MARKERS, "tu"],
    [TUM_MARKERS, "tum"],
  ];
  let bestTerm = null;
  let bestIdx = -1;
  for (const [markers, term] of candidates) {
    for (const m of markers) {
      const idx = hay.lastIndexOf(m);
      if (idx >= 0 && idx > bestIdx) {
        bestIdx = idx;
        bestTerm = term;
      }
    }
  }
  return bestTerm;
}

// mirrors relstate.ts's HONORIFIC_ORDER/HONORIFIC_MIN_EPISODES/
// HONORIFIC_MIN_SPAN_DAYS/MS_PER_DAY/honorificShift exactly (explicitInvite
// detection is not implemented here — deterministic evidence accumulation
// only, the same scope cut as this file's own extraction prompt never
// proposing rel-events today)
const HONORIFIC_ORDER = { aap: 0, tum: 1, tu: 2 };
const HONORIFIC_MIN_EPISODES = 3;
const HONORIFIC_MIN_SPAN_DAYS = 7;
const MS_PER_DAY = 86_400_000;
function honorificShift(current, evidence, ruptureOpen, now = new Date()) {
  if (ruptureOpen && HONORIFIC_ORDER[current] > HONORIFIC_ORDER.aap) {
    const next = current === "tu" ? "tum" : "aap";
    return { next, direction: "regress", citations: [], note: `rupture: regress ${current}->${next}` };
  }
  const byTerm = new Map();
  for (const e of evidence) {
    if (new Date(e.at).getTime() > now.getTime()) continue;
    if (HONORIFIC_ORDER[e.term] <= HONORIFIC_ORDER[current]) continue;
    const arr = byTerm.get(e.term) ?? [];
    arr.push(e);
    byTerm.set(e.term, arr);
  }
  let best = null;
  for (const [term, rows] of byTerm) {
    const distinctEpisodes = new Set(rows.map((r) => r.episodeId));
    if (distinctEpisodes.size < HONORIFIC_MIN_EPISODES) continue;
    const times = rows.map((r) => new Date(r.at).getTime()).sort((a, b) => a - b);
    const spanDays = (times[times.length - 1] - times[0]) / MS_PER_DAY;
    if (spanDays < HONORIFIC_MIN_SPAN_DAYS) continue;
    if (!best || HONORIFIC_ORDER[term] > HONORIFIC_ORDER[best.term]) best = { term, rows };
  }
  if (!best) return null;
  const citations = [...new Set(best.rows.map((r) => r.episodeId))].sort((a, b) => a - b);
  const spanDays = (
    (new Date(best.rows[best.rows.length - 1].at).getTime() - new Date(best.rows[0].at).getTime()) /
    MS_PER_DAY
  ).toFixed(1);
  return {
    next: best.term,
    direction: "advance",
    citations,
    note: `${citations.length} episodes over ${spanDays}d: ${current}->${best.term}`,
  };
}

// mirrors relstate.ts's HINDI_MARKER_WORDS/computeCsRatio/computeRitualDensity/
// computePacingGapS/refreshDerivedDims exactly — pure SQL, zero JS judgement,
// so verbatim porting carries none of the confabulation risk the pattern/
// trust cut above is avoiding.
const HINDI_MARKER_WORDS = [
  "hai", "hain", "tha", "thi", "the", "kya", "kyun", "kyu", "nahi", "nhi",
  "haan", "haa", "mera", "meri", "mere", "tera", "teri", "tere", "tum",
  "tumhara", "tumhari", "aap", "aapka", "hum", "humara", "yaar", "bhai",
  "kar", "karo", "karna", "raha", "rahi", "rahe", "gaya", "gayi", "gaye",
  "acha", "accha", "theek", "matlab", "bas", "abhi", "kal", "aaj",
];
async function refreshDerivedDims(person) {
  const pattern = HINDI_MARKER_WORDS.map((w) => `\\m${w}\\M`).join("|");
  const [csRows, ritualRows, pacingRows] = await Promise.all([
    q(
      `with recent as (
         select l.content from meera_log l
         join vy_person_device d on d.device_id = l.device_id
         where d.person_id = $1 and l.role = 'me'
         order by l.at desc limit 200
       )
       select count(*)::int as total, count(*) filter (where content ~* $2)::int as hindi_hits
         from recent`,
      [person, pattern],
    ).catch(() => []),
    q(
      `select count(*) filter (where last_at > now() - interval '30 days')::real
                / greatest(count(*), 1)::real as density
         from vy_ritual where person_id = $1`,
      [person],
    ).catch(() => []),
    q(
      `select percentile_cont(0.5) within group (order by gap_s) as pacing_gap_s
         from (
           select extract(epoch from started_at - lag(started_at) over (order by started_at)) as gap_s
             from vy_episode where person_id = $1 and started_at > now() - interval '30 days'
         ) s where gap_s is not null`,
      [person],
    ).catch(() => []),
  ]);
  const total = Number(csRows[0]?.total ?? 0);
  const csRatio = total < 10 ? null : Math.round((Number(csRows[0]?.hindi_hits ?? 0) / total) * 1000) / 1000;
  const ritualDensity = Math.round((Number(ritualRows[0]?.density ?? 0)) * 1000) / 1000;
  const pv = pacingRows[0]?.pacing_gap_s;
  const pacingGapS = pv === null || pv === undefined ? null : Math.round(Number(pv));
  // DISCOVERED, not one of the five named gaps but load-bearing to all of
  // them: this was a plain UPDATE, which no-ops when no vy_rel_state row
  // exists yet — and nothing in the normal (non-forget) path ever INSERTs
  // the first one (confirmed against the live DB: 0 rows for 40 real
  // vy_person rows). api/memory.js's fetchRelBundle short-circuits to
  // `relstate: null` whenever the row is missing, so this single no-op was
  // silently voiding GAP 1/3/4's entire effect for every real user — the
  // WE-episode fix, the currency rows, the closeness card all read from
  // the same bundle this creates. Upsert, matching the shape
  // rebuildRelState (this file's own forget-cascade rebuild, the one place
  // that already creates this row) and relstate.ts's rebuildSnapshotFromDb
  // both already use — first-write-wins the schema defaults for every
  // other column via `insert ... on conflict do update`.
  await q(
    `insert into vy_rel_state (person_id, cs_ratio, ritual_density, pacing_gap_s)
     values ($1,$2,$3,$4)
     on conflict (person_id) do update set
       cs_ratio = $2, ritual_density = $3, pacing_gap_s = $4`,
    [person, csRatio, ritualDensity, pacingGapS],
  ).catch(() => {});
  return { csRatio, ritualDensity, pacingGapS };
}

// how far back "freshly finalized" looks — one nightly cycle's worth, plus
// slack, so a missed/halted prior run is self-healing rather than silently
// skipped (this file's own "a missed pass is late, never lost" philosophy)
const RELDERIVE_LOOKBACK_H = 30;

async function findPersonsWithFreshEpisodes(limit) {
  const rows = await q(
    `select distinct person_id from vy_episode
      where provisional = false and created_at > now() - interval '${RELDERIVE_LOOKBACK_H} hours'
      order by person_id limit $1`,
    [limit],
  ).catch(() => []);
  return rows.map((r) => r.person_id);
}

/** One person's honorific derivation: gather address-term evidence from
 *  their freshly-finalized episodes' own log spans, run it through the
 *  mirrored hysteresis, write a cited vy_rel_event if it moved, refresh the
 *  three derived dims. Returns a per-person report for the run summary. */
async function deriveRelEventsForPerson(person, { dryRun = false } = {}) {
  const rep = { person, episodes_scanned: 0, honorific_evidence: 0, honorific_moved: false, dims_refreshed: false };
  const episodes = await q(
    `select id, log_from, log_to, started_at from vy_episode
      where person_id = $1 and provisional = false
        and created_at > now() - interval '${RELDERIVE_LOOKBACK_H} hours'
        and log_from is not null and log_to is not null
      order by started_at asc limit 200`,
    [person],
  ).catch(() => []);
  rep.episodes_scanned = episodes.length;
  if (!episodes.length) return rep;

  const stateRows = await q(`select honorific, rupture_open from vy_rel_state where person_id = $1`, [
    person,
  ]).catch(() => []);
  // no vy_rel_state row yet: schema default (§2.4) — matches
  // relstate.ts's initialRelState() exactly
  const current = stateRows[0]?.honorific ?? "tum";
  const ruptureOpen = Boolean(stateRows[0]?.rupture_open ?? false);

  const evidence = [];
  for (const ep of episodes) {
    const rows = await q(
      // GAP 5 (WS-FELT), correcting a stale comment that stood here: this
      // file self-flagged relstate.ts's computeCsRatio (mirrored verbatim
      // in refreshDerivedDims below) as filtering on `l.role = 'me'`, which
      // it claimed "cannot match any row under this schema" — but
      // meera_log.role IS 'her'/'me' (api/memory.js opLog's own insert
      // shape; confirmed against db/schema.sql, which has no CHECK and so
      // is silent, and against the one file that actually writes rows).
      // The user's own turns ARE role='me'; that filter matches, in both
      // this query and refreshDerivedDims's mirror of it. There is no
      // mismatch (this is the same class of bug as the role='user' typo
      // relstate.ts itself once carried and already fixed — see that
      // file's own history — but that fix had already landed by the time
      // this comment was written, so the "flagged as a likely pre-existing
      // bug" note above was simply never true. The stale claim is removed;
      // this query and refreshDerivedDims's `l.role = 'me'` filter are both
      // already correct as written — no SQL changed.
      `select content, at from meera_log
        where device_id in (select device_id from vy_person_device where person_id = $1
                             union select $1::uuid)
          and role = 'me' and id between $2 and $3`,
      [person, ep.log_from, ep.log_to],
    ).catch(() => []);
    for (const r of rows) {
      const term = detectAddressTerm(r.content);
      if (term) evidence.push({ term, episodeId: ep.id, at: r.at });
    }
  }
  rep.honorific_evidence = evidence.length;

  const move = honorificShift(current, evidence, ruptureOpen);
  if (move && !dryRun) {
    // relstate.ts's writeRelEvent: >=1 citation enforced here too (cheaper
    // than the round trip to the DB's own CHECK, same reasoning as that
    // function's own comment)
    if (move.citations.length >= 1) {
      await q(
        `insert into vy_rel_event (person_id, dim, from_v, to_v, direction, note, citations)
         values ($1,'honorific',$2,$3,$4,$5,$6)`,
        [person, current, move.next, move.direction, telegraphic(move.note, 160), move.citations],
      ).catch(() => {});
      // same discovered no-op-on-missing-row issue as refreshDerivedDims
      // above, same upsert fix
      await q(
        `insert into vy_rel_state (person_id, honorific) values ($1,$2)
         on conflict (person_id) do update set honorific = $2`,
        [person, move.next],
      ).catch(() => {});
      rep.honorific_moved = true;
    }
  } else if (move && dryRun) {
    rep.honorific_moved = true; // reported, not written
  }

  if (!dryRun) {
    await refreshDerivedDims(person);
    rep.dims_refreshed = true;
  }
  return rep;
}

/** The orchestrator itself — SPEC §13 seam 4. Runs AFTER finalize, BEFORE
 *  relcheck (consolidate.yml wiring below). Independent of runConsolidation
 *  (own person cursor, own limit) so a partial/halted finalize run still
 *  lets already-finalized episodes get their honorific pass — "late, never
 *  lost" applies here too. */
export async function runRelEventDerivation({ limit = DEFAULT_PERSON_LIMIT, dryRun = false, onlyPerson = null } = {}) {
  const t0 = Date.now();
  const persons = onlyPerson ? [onlyPerson] : await findPersonsWithFreshEpisodes(limit);
  const reports = [];
  for (const person of persons) reports.push(await deriveRelEventsForPerson(person, { dryRun }));
  return {
    ok: true,
    persons_processed: reports.length,
    honorific_events_written: reports.filter((r) => r.honorific_moved).length,
    dims_refreshed: reports.filter((r) => r.dims_refreshed).length,
    ms: Date.now() - t0,
    reports,
  };
}

// One-time catch-up (GAP 1, WS-FELT) for episodes FINALIZED BEFORE the
// insert-time classification fix above existed: they are stuck at
// participation='user' forever even though their own summary genuinely
// carries a WE token, because finalize never revisits a row once written.
// Idempotent by construction — a row this UPDATE touches is set to 'we',
// which removes it from the WHERE clause, so running it every nightly pass
// (cheap: one indexed UPDATE) never re-touches a row twice and never races
// the insert-time fix (new rows are already classified correctly and simply
// never match `participation = 'user'` AND the WE pattern at the same time
// unless the pattern is genuinely present — the same rule, twice). Scoped
// to `onlyPerson` when given, same as the rest of this file's cursor
// discipline. `dryRun` reports the count without writing (SELECT, not
// UPDATE) — this is the "run it as SELECT count first, read-only" the
// rollout checklist asks for.
async function backfillWeParticipation({ dryRun = false, onlyPerson = null } = {}) {
  const where = onlyPerson
    ? `where person_id = $2 and participation = 'user' and summary ~* $1`
    : `where participation = 'user' and summary ~* $1`;
  const params = onlyPerson ? [WE_TOKEN_SQL, onlyPerson] : [WE_TOKEN_SQL];
  if (dryRun) {
    const rows = await q(`select count(*)::int as n from vy_episode ${where}`, params).catch(() => []);
    return Number(rows[0]?.n ?? 0);
  }
  const rows = await q(`update vy_episode set participation = 'we' ${where} returning id`, params).catch(() => []);
  return rows.length;
}

/** The run itself: pick eligible people, finalize each, halt on a runaway
 *  entailment refutation rate. */
export async function runConsolidation({ limit = DEFAULT_PERSON_LIMIT, dryRun = false, onlyPerson = null } = {}) {
  const t0 = Date.now();
  const weBackfilled = await backfillWeParticipation({ dryRun, onlyPerson });
  const persons = onlyPerson ? [onlyPerson] : await findEligiblePersons(limit);
  const reports = [];
  let totalAudited = 0;
  let totalRefuted = 0;
  let halted = false;

  for (const person of persons) {
    const rep = await finalizePerson(person, { dryRun });
    reports.push(rep);
    totalAudited += rep.audited;
    totalRefuted += rep.refuted;
    const rate = totalAudited >= AUDIT_MIN_N ? totalRefuted / totalAudited : 0;
    if (rate > AUDIT_REFUTATION_HALT) {
      halted = true;
      break; // §4.2 layer 3: refutation >2% halts the consolidator
    }
  }

  const embedCost = { ...cost, embedded_person_count: reports.length };
  return {
    ok: !halted,
    halted,
    we_backfilled: weBackfilled,
    persons_processed: reports.length,
    persons_eligible: persons.length,
    episodes_finalized: reports.reduce((s, r) => s + r.episodes, 0),
    facts_finalized: reports.reduce((s, r) => s + r.facts, 0),
    episodes_rejected: reports.reduce((s, r) => s + r.rejected_episodes, 0),
    facts_rejected: reports.reduce((s, r) => s + r.rejected_facts, 0),
    episodes_superseded: reports.reduce((s, r) => s + r.superseded_episodes, 0),
    facts_superseded: reports.reduce((s, r) => s + r.superseded_facts, 0),
    audited: totalAudited,
    refuted: totalRefuted,
    refutation_rate: totalAudited ? totalRefuted / totalAudited : 0,
    cost: embedCost,
    ms: Date.now() - t0,
    reports,
  };
}

const DEVICE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const body = req.body || {};

    // GAP 2 (WS-FELT) — day-1 seed: a SAFE, NARROW path for the client
    // itself to ask for a single-person consolidation right after
    // onboarding, so the relational engine has something to render before
    // the first 03:30 IST cron ever runs (Onboarding.tsx's fire-and-forget
    // call). This is the only branch of this handler a browser is meant to
    // reach, so it is the only branch that gets device-identity auth +
    // rate limiting — the exact pattern api/memory.js/api/episodes.js use
    // (UUID check + allow()), copied rather than invented. The part that
    // keeps this from being an arbitrary-person trigger: `onlyPerson` and
    // `limit` are DERIVED from the resolved device, never taken from the
    // request body — a caller can only ever seed their OWN device's
    // person, one person, one pass. Failure here must be invisible to the
    // caller (fire-and-forget), but the endpoint itself still answers
    // honestly; the client is the one that ignores the response.
    if (typeof body.device === "string") {
      if (!DEVICE_UUID.test(body.device)) return res.status(400).json({ error: "device uuid required" });
      if (!allow(ipOf(req), "consolidate_seed", 6)) return res.status(429).json({ error: "slow down" });
      const person = await personIdFor(body.device);
      const out = await runConsolidation({ limit: 1, dryRun: false, onlyPerson: person });
      // Chained, same order the nightly cron uses (consolidate.yml: finalize
      // THEN --derive-rel-events) — finalize alone produces FINAL episodes
      // but never touches vy_rel_state itself; without this second step a
      // day-1 seed would finalize episodes and still render nothing, since
      // fetchRelBundle short-circuits on a missing vy_rel_state row. Cheap
      // to always attempt (deriveRelEventsForPerson no-ops in ~1 query when
      // there is nothing fresh to scan) and never blocks the response the
      // client is discarding anyway.
      const relOut = await runRelEventDerivation({ limit: 1, dryRun: false, onlyPerson: person }).catch(
        () => null,
      );
      return res.status(out.halted ? 500 : 200).json({ ...out, rel_event_derivation: relOut });
    }

    // Unrestricted admin/cron/smoke-test path, unchanged — the nightly
    // workflow calls this file's exported functions directly (never this
    // HTTP handler), so the only real callers here are manual on-demand
    // runs and the smoke test the file's header already documents.
    const out = await runConsolidation({
      limit: Number(body.limit) || DEFAULT_PERSON_LIMIT,
      dryRun: body.dryRun === true,
      onlyPerson: typeof body.person === "string" ? body.person : null,
    });
    return res.status(out.halted ? 500 : 200).json(out);
  } catch (e) {
    return res.status(500).json({ error: "consolidate failure", message: e?.message });
  }
}

// Runnable directly by the GH Actions cron: `node api/consolidate.js`
// against the secrets-built api/_config.js (mirrors deploy-web.yml's
// reconstruction step) — no Vercel function timeout in the loop, matching
// culture.yml's precedent of the workflow driving the actual work itself.
//
// `--derive-rel-events` runs the WS-INTEGRATE seam-4 orchestrator instead of
// finalize — a SEPARATE CLI mode (not interleaved into runConsolidation's
// own loop) so consolidate.yml can sequence it as its own step, explicitly
// AFTER "Nightly finalize" and BEFORE "Zero-orphan sweep", per the ticket.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const limitArg = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : DEFAULT_PERSON_LIMIT;
  const dryRun = args.includes("--dry-run");
  const personArg = args.includes("--person") ? args[args.indexOf("--person") + 1] : null;
  if (args.includes("--derive-rel-events")) {
    const out = await runRelEventDerivation({ limit: limitArg, dryRun, onlyPerson: personArg });
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }
  const out = await runConsolidation({ limit: limitArg, dryRun, onlyPerson: personArg });
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.halted ? 1 : 0);
}
