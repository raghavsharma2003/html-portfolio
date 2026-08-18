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
// taste nomination (WS-RELSTATE's api/taste-queue.js), tier-compaction's
// weekly-digest form (logged as a deferred M3→M4 handoff below), prosody
// baseline (WS-BATTERY's scripts/prosody-baseline.mjs).
//
// NO LONGER OUT OF SCOPE (WS-DEPTH, 2026-08-18): trust/rupture/repair
// rel-event derivation and vy_pattern writes were carved out of the seam-4
// orchestrator below with an explicit "TICKETED BACK... not wired here"
// comment — that comment is now stale. The trust/repair deriver, the
// pattern extractor, and a new deterministic phrase-capture writer live in
// their own section further down this file, chained after the honorific
// orchestrator. See that section's header for why they are separate
// functions rather than folded into deriveRelEventsForPerson.
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
import { personIdFor, RECALL_STOP } from "./memory.js";

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
        and group_id is null -- state inertness: explicit, not just NULL-person_id accident (multiparty-v1-design)
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
// trust/rupture/repair/code-switch rel-events or vy_pattern rows — those
// require actual JUDGEMENT of what happened in an episode, not something a
// deterministic integration pass may safely improvise.
//
// WS-DEPTH (2026-08-18) closes the trust/rupture/repair and pattern half of
// that ticket, plus a third, deterministic phrase-capture writer — see the
// "WS-DEPTH" section below runRelEventDerivation. Kept as SEPARATE functions
// from deriveRelEventsForPerson rather than folded in, for one reason worth
// stating: honorific derivation is a pure deterministic fold over regex
// evidence (no LLM call, cannot confabulate), while trust/rupture/repair and
// pattern extraction are real LLM judgement calls with their own prompt,
// their own writer-window citation validation, and their own conservative
// "ambiguous days write NOTHING" posture — mixing a call that cannot be
// wrong with calls that must fail closed into one function would make the
// wrong half of that sentence harder to audit at a glance. code_switch
// derivation (csDirectionFromSignals) stays out of scope: not named in this
// workstream's mandate, and no caller anywhere classifies retreat_l2 vs
// intensify_l1 today, so wiring only the write half without the classifier
// would be dead code.
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
             from vy_episode where person_id = $1 and group_id is null and started_at > now() - interval '30 days'
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
      where provisional = false and group_id is null and created_at > now() - interval '${RELDERIVE_LOOKBACK_H} hours'
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
      where person_id = $1 and provisional = false and group_id is null
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

// ═══════════════════════════════════════════════════════════════════════════
// WS-DEPTH (2026-08-18) — the three depth writers left out of the seam-4
// orchestrator above on purpose (see that section's SCOPE CUT comment):
// trust/rupture/repair rel-event derivation, dyadic pattern extraction, and
// deterministic phrase capture. Chained AFTER runRelEventDerivation, same
// dry-run flag support, same person cursor discipline, same fail-soft
// posture ("a bad night costs a night, never a wrong write").
//
// GROUP GUARD (context/decisions.md `multiparty-v1-design`: "Group episodes
// are state-inert in v1"): every episode/log query below filters
// `group_id is null` EXPLICITLY, in addition to the structural guarantee
// that a group episode's person_id is NULL by construction (migration
// 008a) and so could never match `person_id = $1` anyway — belt-and-braces,
// the same two-layer convention WE_TOKEN_RE and the honorific writer's own
// pre-DB citation check already use in this file.
//
// CITATION LAW, same shape as finalizePerson's writer-window validation
// (§4.2 layer 2): every prompt below hands the model a NUMBERED batch and
// the model may cite ONLY by index into that batch. An index outside the
// batch cannot exist in the model's output space; a signal whose mapped
// citation set ends up empty is DROPPED, never written with zero citations
// — the DB's own CHECK constraints (vy_rel_event_cited, vy_pattern_needs_two)
// would refuse it anyway, but failing here is cheaper and gives the caller a
// concrete reason instead of a generic constraint violation, same reasoning
// relstate.ts's writeRelEvent/writePattern give for their own pre-DB checks.
// ═══════════════════════════════════════════════════════════════════════════

// mirrors relstate.ts's clampTrustDelta/moveTrust exactly (source of truth:
// src/engine/relstate.ts TRUST_MAX_DELTA_PER_DAY/clampTrustDelta/moveTrust —
// same mirror-don't-import resolution as honorificShift above, same reason:
// this script runs bare under Node with no bundler, relstate.ts is the
// client bundle).
const TRUST_MAX_DELTA_PER_DAY = 0.05;
export function clampTrustDelta(rawDelta, lastMoveAt, now = new Date()) {
  if (rawDelta === 0) return 0;
  const days = lastMoveAt ? Math.max(0, (now.getTime() - new Date(lastMoveAt).getTime()) / MS_PER_DAY) : 1;
  const maxAbs = TRUST_MAX_DELTA_PER_DAY * days;
  const sign = Math.sign(rawDelta);
  return sign * Math.min(Math.abs(rawDelta), maxAbs);
}
export function moveTrust(current, rawDelta, lastMoveAt, now = new Date()) {
  const clamped = clampTrustDelta(rawDelta, lastMoveAt, now);
  const next = Math.max(0, Math.min(1, current + clamped));
  const direction = clamped > 0 ? "advance" : clamped < 0 ? "regress" : "init";
  return { next, direction, delta: next - current };
}

// mirrors relstate.ts's ruptureRepairShift exactly, EXCEPT for how its two
// booleans are produced: relstate.ts's own doc comment says conflictSignal
// comes from "moment.ts's classifier" and theirRepairSignal must be "an
// explicit affirmative FROM THE USER's own turn" — here the conservative
// extraction prompt below plays both roles, gated by the same "CLEAR
// evidence only, else present:false" instruction every prompt in this
// section carries. The state-machine math itself is untouched: same four
// branches, same priority order (regress-on-re-rupture checked before any
// repair advance, so a fresh rupture arriving mid-repair cannot be shadowed).
export function ruptureRepairShift(state, conflictSignal, theirRepairSignal) {
  if (conflictSignal && !state.ruptureOpen) {
    return { ruptureOpen: true, repairState: "open", dim: "rupture", direction: "advance", note: "conflict-shaped episode: rupture opens" };
  }
  if (conflictSignal && state.ruptureOpen && state.repairState !== "open") {
    return { ruptureOpen: true, repairState: "open", dim: "repair", direction: "regress", note: "re-rupture during repair: repair regresses to open" };
  }
  if (state.ruptureOpen && state.repairState === "open" && theirRepairSignal) {
    return { ruptureOpen: state.ruptureOpen, repairState: "repairing", dim: "repair", direction: "advance", note: "their signal: repair begins" };
  }
  if (state.ruptureOpen && state.repairState === "repairing" && theirRepairSignal) {
    return { ruptureOpen: false, repairState: "repaired", dim: "repair", direction: "advance", note: "their signal sustained: repaired, rupture closes" };
  }
  return null;
}

// Fixed, ANCHORED nightly trust step — never an LLM-self-rated magnitude
// (same anti-inflation reasoning as IMPORTANCE_ANCHORS above: a model asked
// "how much" inflates; a model asked "did this happen, yes or no" does not).
// The rate limit (clampTrustDelta, ±0.05/day) is what actually bounds the
// real movement regardless of this constant's size, so 0.08 here is
// deliberately ABOVE the daily cap — one clear night's evidence should be
// enough to use the full daily allowance, not a fraction of it.
const TRUST_STEP = 0.08;

// Cost/latency ceiling per person, same reasoning as LOG_BATCH_CAP: a
// chatty person's whole history is never pulled into one extraction call.
const TRUST_REPAIR_MAX_EPISODES = 40;
const PATTERN_LOOKBACK_DAYS = 60;
const PATTERN_MAX_EPISODES = 60;
const PATTERN_MIN_EPISODES_TO_TRY = 4; // below this there is nothing to find a REGULARITY in
const PATTERN_CAP_PER_NIGHT = 2; // "accumulation should feel geological, not chatty"
const PATTERN_MOMENTS = ["conflict", "vulnerable", "silence", "teasing", "stress", "planning", "celebration", "boredom"];

/** Today's freshly-finalized 1:1 episodes for one person, with the fields
 *  the trust/repair prompt needs (summary + affect, already telegraphic and
 *  already citation-anchored by finalizePerson's own entailment discipline).
 *  GROUP GUARD applied (see section header). */
async function fetchFreshEpisodesForPerson(person, limitN = TRUST_REPAIR_MAX_EPISODES) {
  return q(
    `select id, log_from, log_to, started_at, summary, affect_tags, importance from vy_episode
      where person_id = $1 and provisional = false and group_id is null
        and created_at > now() - interval '${RELDERIVE_LOOKBACK_H} hours'
      order by started_at asc limit $2`,
    [person, limitN],
  ).catch(() => []);
}

/** A person's broader recent history for pattern-finding (behavioral
 *  regularities need more than one day's evidence) — GROUP GUARD applied,
 *  superseded episodes excluded (a compacted/replaced summary is not
 *  citable ground truth). */
async function fetchHistoryEpisodesForPerson(person, { days = PATTERN_LOOKBACK_DAYS, limitN = PATTERN_MAX_EPISODES } = {}) {
  return q(
    `select id, log_from, log_to, started_at, summary, affect_tags, importance from vy_episode
      where person_id = $1 and provisional = false and group_id is null and superseded_by is null
        and started_at > now() - interval '${days} days'
      order by started_at asc limit $2`,
    [person, limitN],
  ).catch(() => []);
}

function renderEpisodeBatch(episodes) {
  return episodes
    .map((e, i) => {
      const affect = Array.isArray(e.affect_tags) ? e.affect_tags.map((a) => a.tag).filter(Boolean).join(",") : "";
      const day = new Date(e.started_at).toISOString().slice(0, 10);
      return `[${i}] (${day})${affect ? ` [${affect}]` : ""} ${e.summary}`;
    })
    .join("\n");
}

/** Maps model-proposed indices back to real episode ids, dropping anything
 *  outside the numbered batch — the writer-window validation this whole
 *  section's citation law depends on. */
export function mapEpisodeCitations(idxArr, episodes) {
  if (!Array.isArray(idxArr)) return [];
  const idxs = [...new Set(idxArr.filter((n) => Number.isInteger(n) && n >= 0 && n < episodes.length))];
  return idxs.map((i) => episodes[i].id).sort((a, b) => a - b);
}

function trustRepairPrompt(batchText) {
  return `You are reviewing a companion app's recent conversation history with ONE real person, already segmented into dated episodes, looking ONLY for CLEAR evidence of trust movement or a relationship rupture/repair. Reply with ONLY JSON, this exact shape:
{"trust_move":{"present":false,"direction":"increase|decrease","citations":[],"note":""},
"rupture":{"present":false,"citations":[],"note":""},
"repair_signal":{"present":false,"citations":[],"note":""}}

RULES, hard:
- CLEAR evidence only. If it is ambiguous, arguable, or you would be inferring rather than reading it off the episodes, set "present":false for that field. A missed signal is recoverable tomorrow; a wrong one is not — when in doubt, say nothing.
- "citations" must be indices from the numbered list below, never invented, and non-empty whenever "present" is true.
- "trust_move": present only when the person did something that concretely signals trusting her MORE (real vulnerability shared, a returned confidence, explicit reliance on her) or LESS (withdrawal, sudden guardedness, a stated loss of trust) — never routine warmth or a good mood.
- "rupture": present only when something genuinely hurt or damaged the RELATIONSHIP in this stretch (a real conflict, offense, or hurt between them and her) — not a bad day about something unrelated.
- "repair_signal": present only when THE PERSON THEMSELVES explicitly signals repair — an apology, a reaching-back-out after distance, a stated wish to move past a conflict. Never her own words, never inferred from her side.

EPISODES (numbered, dated, affect-tagged where known):
${batchText}`;
}

/** One person's trust/rupture/repair pass: extract, validate citations
 *  against the numbered batch, apply the mirrored state machine, write AT
 *  MOST one rupture/repair event and one trust event per run (the state
 *  machine itself only ever proposes one rupture/repair move at a time).
 *  Returns a per-person report for the run summary. */
async function deriveTrustRepairForPerson(person, { dryRun = false } = {}) {
  const rep = { person, episodes_scanned: 0, trust_moved: false, rupture_or_repair_moved: false };
  const episodes = await fetchFreshEpisodesForPerson(person);
  rep.episodes_scanned = episodes.length;
  if (!episodes.length) return rep;

  const raw = await llm([{ role: "user", content: trustRepairPrompt(renderEpisodeBatch(episodes)) }], 500);
  if (!raw) return rep; // a failed derivation is a late pass, never a wrong write
  const parsed = parseJsonLoose(raw);
  if (!parsed) return rep;

  const stateRows = await q(`select trust, rupture_open, repair_state from vy_rel_state where person_id = $1`, [person]).catch(() => []);
  const currentTrust = stateRows[0] ? Number(stateRows[0].trust) : 0.3;
  const ruptureOpen = Boolean(stateRows[0]?.rupture_open ?? false);
  const repairState = stateRows[0]?.repair_state ?? "none";
  const inputFrom = Math.min(...episodes.map((e) => e.log_from ?? Infinity).filter(Number.isFinite));
  const inputTo = Math.max(...episodes.map((e) => e.log_to ?? -Infinity).filter(Number.isFinite));
  let wrote = [];

  // ── rupture/repair: one state-machine move at most, mirrored exactly ──
  const conflictSignal = Boolean(parsed?.rupture?.present);
  const repairSignal = Boolean(parsed?.repair_signal?.present);
  if (conflictSignal || repairSignal) {
    const move = ruptureRepairShift({ ruptureOpen, repairState }, conflictSignal, repairSignal);
    if (move) {
      const citeSource = move.dim === "rupture" || move.direction === "regress" ? parsed?.rupture?.citations : parsed?.repair_signal?.citations;
      const citations = mapEpisodeCitations(citeSource, episodes);
      if (citations.length) {
        rep.rupture_or_repair_moved = true;
        if (!dryRun) {
          const fromV = move.dim === "rupture" ? (ruptureOpen ? "open" : "closed") : repairState;
          const toV = move.dim === "rupture" ? "open" : move.repairState;
          const note = move.dim === "rupture" ? parsed?.rupture?.note : parsed?.repair_signal?.note ?? parsed?.rupture?.note;
          await q(
            `insert into vy_rel_event (person_id, dim, from_v, to_v, direction, note, citations)
             values ($1,$2,$3,$4,$5,$6,$7)`,
            [person, move.dim, fromV, toV, move.direction, telegraphic(note || move.note, 160), citations],
          ).catch(() => {});
          await q(
            `insert into vy_rel_state (person_id, rupture_open, repair_state) values ($1,$2,$3)
             on conflict (person_id) do update set rupture_open = $2, repair_state = $3`,
            [person, move.ruptureOpen, move.repairState],
          ).catch(() => {});
          wrote.push({ table: "vy_rel_event", dim: move.dim });
        }
      }
    }
  }

  // ── trust: independent scalar dim, rate-limited by clampTrustDelta ──
  if (parsed?.trust_move?.present) {
    const citations = mapEpisodeCitations(parsed.trust_move.citations, episodes);
    if (citations.length) {
      const lastTrustRows = await q(
        `select at from vy_rel_event where person_id = $1 and dim = 'trust' order by at desc limit 1`,
        [person],
      ).catch(() => []);
      const lastMoveAt = lastTrustRows[0]?.at ?? null;
      const sign = parsed.trust_move.direction === "decrease" ? -1 : 1;
      const move = moveTrust(currentTrust, sign * TRUST_STEP, lastMoveAt);
      if (move.delta !== 0) {
        rep.trust_moved = true;
        if (!dryRun) {
          await q(
            `insert into vy_rel_event (person_id, dim, from_v, to_v, direction, note, citations)
             values ($1,'trust',$2,$3,$4,$5,$6)`,
            [person, currentTrust.toFixed(3), move.next.toFixed(3), move.direction, telegraphic(parsed.trust_move.note, 160), citations],
          ).catch(() => {});
          await q(
            `insert into vy_rel_state (person_id, trust) values ($1,$2)
             on conflict (person_id) do update set trust = $2`,
            [person, move.next],
          ).catch(() => {});
          wrote.push({ table: "vy_rel_event", dim: "trust" });
        }
      }
    }
  }

  if (!dryRun && wrote.length && Number.isFinite(inputFrom) && Number.isFinite(inputTo)) {
    await q(
      `insert into vy_derivation (person_id, model, prompt_hash, input_from, input_to, wrote)
       values ($1,$2,'trust_repair',$3,$4,$5::jsonb)`,
      [person, AZ_KEY ? EXTRACT_MODEL_AZURE : EXTRACT_MODEL_FALLBACK, inputFrom, inputTo, JSON.stringify(wrote)],
    ).catch(() => {});
  }
  return rep;
}

/** The orchestrator — same person cursor (findPersonsWithFreshEpisodes) as
 *  runRelEventDerivation, run independently so a partial honorific pass
 *  never blocks this one. */
export async function runTrustRepairDerivation({ limit = DEFAULT_PERSON_LIMIT, dryRun = false, onlyPerson = null } = {}) {
  const t0 = Date.now();
  const persons = onlyPerson ? [onlyPerson] : await findPersonsWithFreshEpisodes(limit);
  const reports = [];
  for (const person of persons) reports.push(await deriveTrustRepairForPerson(person, { dryRun }));
  return {
    ok: true,
    persons_processed: reports.length,
    trust_events_written: reports.filter((r) => r.trust_moved).length,
    rupture_repair_events_written: reports.filter((r) => r.rupture_or_repair_moved).length,
    ms: Date.now() - t0,
    reports,
  };
}

// ── pattern extraction: dyadic if-then regularities, gated on writePattern's
//    own >=2-citation rule (mirrored here, same as its DB CHECK) ──

function patternPrompt(batchText) {
  return `You are looking for GENUINE behavioral regularities in one person's history with a companion app — the kind of "if-then" you would only notice about someone after knowing them for months. "we both like coffee" is a SHARED TASTE, not a pattern, and must never be proposed. "goes quiet after work stress, wants distraction not questions" IS a pattern. Reply with ONLY JSON, this exact shape:
{"patterns":[{"moment":"conflict|vulnerable|silence|teasing|stress|planning|celebration|boredom","if_shape":"telegraphic, <=14 words, no terminal punctuation","then_note":"telegraphic guidance, <=14 words, no terminal punctuation","self_in_relation":"telegraphic, how to BE with them here, <=14 words","citations":[0,3]}]}

RULES, hard:
- Propose AT MOST 2 patterns. An empty array is the correct, expected answer most nights — do not force one to exist.
- A pattern is REAL only if you can point to >=2 DISTINCT numbered episodes below where the SAME regularity clearly happened. One instance is an anecdote, not a pattern — "citations" must have >=2 distinct indices, never invented, never outside the numbered list.
- Never propose a pattern that is really just a fact about them, a shared interest, or a single memorable event. Only a recurring IF (a situation or mood) -> THEN (what actually helps, or actually happens).
- Telegraphic notes only: no capital-start-plus-period prose, never a full sentence, never her own first-person voice.

EPISODES (numbered, dated):
${batchText}`;
}

/** One person's pattern-extraction pass. Dedupes against this person's own
 *  existing active patterns (same moment + same normalized if_shape) so a
 *  regularity already on record is not re-proposed nightly. */
async function extractPatternsForPerson(person, { dryRun = false } = {}) {
  const rep = { person, episodes_scanned: 0, proposed: 0, written: 0, rejected: 0, deduped: 0 };
  const episodes = await fetchHistoryEpisodesForPerson(person);
  rep.episodes_scanned = episodes.length;
  if (episodes.length < PATTERN_MIN_EPISODES_TO_TRY) return rep;

  const existing = await q(
    `select moment, if_shape from vy_pattern where person_id = $1 and t_invalid is null`,
    [person],
  ).catch(() => []);
  const dedupeKey = (m, s) => `${m}::${String(s).toLowerCase().trim()}`;
  const seen = new Set(existing.map((p) => dedupeKey(p.moment, p.if_shape)));

  const raw = await llm([{ role: "user", content: patternPrompt(renderEpisodeBatch(episodes)) }], 700);
  if (!raw) return rep;
  const parsed = parseJsonLoose(raw);
  const proposals = Array.isArray(parsed?.patterns) ? parsed.patterns.slice(0, PATTERN_CAP_PER_NIGHT) : [];
  rep.proposed = proposals.length;

  for (const p of proposals) {
    const moment = PATTERN_MOMENTS.includes(p?.moment) ? p.moment : null;
    const ifShape = telegraphic(p?.if_shape, 120);
    const thenNote = telegraphic(p?.then_note, 120);
    const selfInRelation = telegraphic(p?.self_in_relation, 120);
    const citations = mapEpisodeCitations(p?.citations, episodes);
    if (!moment || !ifShape || !thenNote || citations.length < 2) {
      rep.rejected++;
      continue;
    }
    if (seen.has(dedupeKey(moment, ifShape))) {
      rep.deduped++;
      continue;
    }
    if (dryRun) {
      rep.written++;
      continue;
    }
    try {
      await q(
        `insert into vy_pattern (person_id, moment, if_shape, then_note, self_in_relation, citations)
         values ($1,$2,$3,$4,$5,$6)`,
        [person, moment, ifShape, thenNote, selfInRelation, citations],
      );
      rep.written++;
      seen.add(dedupeKey(moment, ifShape));
    } catch {
      rep.rejected++;
    }
  }
  return rep;
}

export async function runPatternExtraction({ limit = DEFAULT_PERSON_LIMIT, dryRun = false, onlyPerson = null } = {}) {
  const t0 = Date.now();
  const persons = onlyPerson ? [onlyPerson] : await findPersonsWithFreshEpisodes(limit);
  const reports = [];
  for (const person of persons) reports.push(await extractPatternsForPerson(person, { dryRun }));
  return {
    ok: true,
    persons_processed: reports.length,
    patterns_written: reports.reduce((s, r) => s + r.written, 0),
    patterns_deduped: reports.reduce((s, r) => s + r.deduped, 0),
    ms: Date.now() - t0,
    reports,
  };
}

// ── phrase capture: DETERMINISTIC, no LLM. A genuine shared phrase is a
//    user-authored 2-5 word token sequence that recurred on >=3 DISTINCT
//    days and is not a generic Hinglish filler — precision over recall,
//    since these get spoken back by her (T6 renderWeCallbacks) and a false
//    positive there is the recited-prompt law's worst case: a line she
//    never should have "remembered". ──

const PHRASE_MIN_WORDS = 2;
const PHRASE_MAX_WORDS = 5;
const PHRASE_MIN_DISTINCT_DAYS = 3;
const PHRASE_CAP_PER_NIGHT = 1;
const PHRASE_SCAN_LIMIT = 1500; // cost/latency ceiling, same reasoning as LOG_BATCH_CAP

// measured 2026-08-18: n-gram frequency scan over meera_log (role='me',
// n=751 rows, 37 distinct devices at scan time) — the phrases here are the
// ones said by the MOST DISTINCT DEVICES, i.e. generic across many dyads
// ("photo bhejo na", "kya kar rahe ho") rather than distinctive to one
// relationship. This is the "top corpus n-grams" half of the stoplist the
// spec calls for; RECALL_STOP (imported from api/memory.js) and
// HINDI_MARKER_WORDS (this file, above) supply the per-token half. Static
// and dated on purpose (same authored-constant convention as
// IMPORTANCE_ANCHORS/HINDI_MARKER_WORDS) rather than a live per-run query —
// a stoplist that is too fresh would just be re-measuring this person's own
// phrase back at itself on a slow day.
const CORPUS_COMMON_PHRASES = new Set([
  "रही है", "है क्या", "रहा हूं", "kya kar", "bhejo na", "photo bhejo", "na apni",
  "photo bhejo na", "bhejo na apni", "photo bhejo na apni", "आवाज आ", "आ रही",
  "आवाज आ रही", "आ रही है", "आवाज आ रही है", "कर रहे", "रहे हो", "साथ में",
  "कह रहा", "नहीं है", "मैं तो", "ek photo", "apni abhi", "abhi kya",
  "ek photo bhejo", "na apni abhi", "apni abhi kya", "abhi kya kar",
  "ek photo bhejo na", "bhejo na apni abhi", "na apni abhi kya",
  "apni abhi kya kar", "ek photo bhejo na apni", "photo bhejo na apni abhi",
  "bhejo na apni abhi kya", "na apni abhi kya kar", "i m", "are you",
  "kar raha", "raha kya", "raha hai", "kuch nhi", "क्या कर", "मैं कह",
  "मैं कह रहा", "कह रहा हूं", "मैं कह रहा हूं", "do you", "ho raha", "rahi hai",
  "रही है क्या", "क्या कर रहे", "कर रहे हो", "क्या कर रहे हो", "कुछ नहीं",
  "मैं भी", "है ना", "नहीं कर", "रहा था",
]);

export function tokenizePhrase(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** One person's deterministic phrase-capture pass: scan their own turns,
 *  count 2-5 word n-grams by distinct day, filter the stoplists, and write
 *  AT MOST ONE new phrase — the most-recurring surviving candidate — citing
 *  the episode it was FIRST said in (vy_phrase.origin_episode is a single
 *  bigint by schema design, "the coining episode", not a citations array;
 *  the >=3-distinct-day recurrence requirement is the evidence bar, this is
 *  which one anchor episode gets stored per that column's own shape). */
async function capturePhrasesForPerson(person, { dryRun = false } = {}) {
  const rep = { person, rows_scanned: 0, candidates: 0, written: 0 };
  const devices = await q(`select device_id from vy_person_device where person_id = $1`, [person]).catch(() => []);
  const deviceIds = devices.length ? devices.map((d) => d.device_id) : [person];
  const rows = await q(
    `select content, at, episode_id from meera_log
      where device_id = any($1::uuid[]) and role = 'me' and group_id is null and episode_id is not null
      order by at desc limit $2`,
    [deviceIds, PHRASE_SCAN_LIMIT],
  ).catch(() => []);
  rep.rows_scanned = rows.length;
  if (!rows.length) return rep;

  const existing = await q(`select lower(phrase) as p from vy_phrase where person_id = $1`, [person]).catch(() => []);
  const existingPhrases = new Set(existing.map((r) => r.p));
  // Substring-aware, not just exact-match: a night AFTER "chai pe scene set
  // karo" is captured must not then capture "chai pe scene set" or "pe
  // scene set karo aaj" the following night — those are near-duplicate
  // variants of the SAME already-stored utterance (found live in this
  // workstream's own fixture test: the exact-match-only version kept
  // capturing one-word-shorter substrings of what it had just written,
  // night after night).
  const overlapsExisting = (gram) => {
    for (const ep of existingPhrases) {
      if (gram.includes(ep) || ep.includes(gram)) return true;
    }
    return false;
  };

  const ngrams = new Map(); // gram -> { days: Set<string>, episodeAt: Map<episodeId, Date> }
  for (const r of rows) {
    const toks = tokenizePhrase(r.content);
    const day = new Date(r.at).toISOString().slice(0, 10);
    for (let n = PHRASE_MIN_WORDS; n <= PHRASE_MAX_WORDS; n++) {
      for (let i = 0; i + n <= toks.length; i++) {
        const slice = toks.slice(i, i + n);
        const gram = slice.join(" ");
        if (CORPUS_COMMON_PHRASES.has(gram)) continue;
        if (overlapsExisting(gram)) continue;
        if (slice.every((t) => RECALL_STOP.has(t) || HINDI_MARKER_WORDS.includes(t))) continue;
        let e = ngrams.get(gram);
        if (!e) {
          e = { days: new Set(), episodeAt: new Map() };
          ngrams.set(gram, e);
        }
        e.days.add(day);
        const at = new Date(r.at);
        if (!e.episodeAt.has(r.episode_id) || at < e.episodeAt.get(r.episode_id)) e.episodeAt.set(r.episode_id, at);
      }
    }
  }

  const candidates = [...ngrams.entries()]
    .filter(([, e]) => e.days.size >= PHRASE_MIN_DISTINCT_DAYS)
    .sort((a, b) => b[1].days.size - a[1].days.size || b[0].length - a[0].length);
  rep.candidates = candidates.length;
  if (!candidates.length) return rep;

  const [gram, evidence] = candidates[0];
  const originEpisode = [...evidence.episodeAt.entries()].sort((a, b) => a[1] - b[1])[0][0];
  rep.written = 1;
  if (dryRun) return rep;
  await q(
    `insert into vy_phrase (person_id, phrase, origin_episode, coined_at, last_used, uses)
     values ($1,$2,$3, now(), now(), $4)
     on conflict (person_id, lower(phrase)) do nothing`,
    [person, gram, originEpisode, evidence.days.size],
  ).catch(() => {});
  return rep;
}

export async function runPhraseCapture({ limit = DEFAULT_PERSON_LIMIT, dryRun = false, onlyPerson = null } = {}) {
  const t0 = Date.now();
  const persons = onlyPerson ? [onlyPerson] : await findPersonsWithFreshEpisodes(limit);
  const reports = [];
  for (const person of persons) reports.push(await capturePhrasesForPerson(person, { dryRun }));
  return {
    ok: true,
    persons_processed: reports.length,
    phrases_written: reports.reduce((s, r) => s + r.written, 0),
    ms: Date.now() - t0,
    reports,
  };
}
// (PHRASE_CAP_PER_NIGHT is enforced by construction above — candidates[0]
// only — kept as a named constant for readability/tests rather than a
// magic 1.)
void PHRASE_CAP_PER_NIGHT;

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
//
// `--derive-trust-repair` / `--extract-patterns` / `--capture-phrases`
// (WS-DEPTH) are the same shape — separate CLI modes, chained by
// consolidate.yml as their own steps AFTER "Derive rel-events" (honorific)
// and BEFORE "Zero-orphan sweep", same fail-soft posture: any one of these
// three failing does not block the others or the sweep.
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
  if (args.includes("--derive-trust-repair")) {
    const out = await runTrustRepairDerivation({ limit: limitArg, dryRun, onlyPerson: personArg });
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }
  if (args.includes("--extract-patterns")) {
    const out = await runPatternExtraction({ limit: limitArg, dryRun, onlyPerson: personArg });
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }
  if (args.includes("--capture-phrases")) {
    const out = await runPhraseCapture({ limit: limitArg, dryRun, onlyPerson: personArg });
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }
  const out = await runConsolidation({ limit: limitArg, dryRun, onlyPerson: personArg });
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.halted ? 1 : 0);
}
