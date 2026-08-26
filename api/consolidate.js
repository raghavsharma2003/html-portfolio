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
//
// WS-AGENTSCOPE (Law E1, SPEC-AGENT-LAYER §2): consolidation reads and writes
// the RELATIONSHIP, which lives at (agent x person), so every retrieval over an
// agent-scoped table below carries api/_agentscope.js's predicate in its WHERE
// — before rank, never as a post-hoc filter — and every write over one names
// agent_id explicitly instead of leaning on migration 009's transitional column
// DEFAULT. `agentId` is threaded through the exported run* entry points with
// Meera's id as the default, so a nightly sweep can eventually loop agents
// without any query below changing. Exactly one agent exists today: this is a
// deliberate behavioural NO-OP, which is what makes it safe to land.
//
// Migration 018 closes the raw half of the boundary too: meera_log and
// meera_forget are relationship rows and every read/write below binds the
// active agent before selection or rank. vy_person_device remains
// person-intrinsic; it resolves the human and never chooses the relationship.
import { q } from "./_db.js";
import { embedBatch, toHalfvecLiteral } from "./_embed.js";
import { AZURE_ENDPOINT, AZURE_KEY, OPENROUTER_KEY } from "./_config.js";
import { agentScopePredicate, agentValue, MEERA_AGENT_ID } from "./_agentscope.js";
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
// EXPORTED (docs/CONSOLIDATION.md "minimal export", raised there as a proposal
// and taken here): api/consolidate-sweep.js and scripts/backfill-consolidate.mjs
// both hardcoded `220` with a comment pointing at this line, which is a
// duplicate that goes stale silently rather than loudly. One number, one place.
export const LOG_BATCH_CAP = 220;
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

// WS-SPINE: `attempts` exists because the two `calls` counters below only ever
// counted SUCCESSES, and the one real measured run of this pipeline
// (`strict-exposed-13`'s correction: "0 episodes and 0 model calls") reported
// zero spend for a person whose extraction had in fact been ATTEMPTED and had
// failed. A ceiling enforced on a success counter is a ceiling a failing
// provider can walk straight through — an infinite retry loop costs real money
// and reports `azure_calls: 0`. `azure_attempts`/`fallback_attempts` count the
// request, not the outcome, and the sweep's per-invocation ceiling reads THOSE.
//
// Fallback token usage was also never recorded (only Azure's `usage` block was
// read), so every token spent on an OpenRouter fallback was invisible to the
// only arithmetic that could have caught a runaway. Recorded now.
const cost = {
  azure_calls: 0,
  azure_attempts: 0,
  azure_tokens_in: 0,
  azure_tokens_out: 0,
  fallback_calls: 0,
  fallback_attempts: 0,
  fallback_tokens_in: 0,
  fallback_tokens_out: 0,
  audit_calls: 0,
  embed: null,
};

/** A copy of the running cost counters. The object itself is module-level and
 *  therefore SHARED across every invocation a warm serverless container serves
 *  — a caller that wants "what did THIS run spend" must diff two snapshots
 *  (see `costDelta`), never read the raw object and call it a run total. */
export function costSnapshot() {
  return { ...cost };
}
export function costDelta(before, after = costSnapshot()) {
  const out = {};
  for (const k of Object.keys(after)) {
    if (typeof after[k] === "number") out[k] = after[k] - (Number(before?.[k]) || 0);
  }
  out.llm_calls = out.azure_attempts + out.fallback_attempts + out.audit_calls;
  out.tokens_in = out.azure_tokens_in + out.fallback_tokens_in;
  out.tokens_out = out.azure_tokens_out + out.fallback_tokens_out;
  return out;
}

async function llm(messages, maxTokens, { model = null } = {}) {
  if (AZ_ENDPOINT && AZ_KEY) {
    cost.azure_attempts++;
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
  cost.fallback_attempts++;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OR_KEY}`, "Content-Type": "application/json", "X-Title": "Meera" },
    body: JSON.stringify({ model: model || EXTRACT_MODEL_FALLBACK, max_tokens: maxTokens, messages }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) return null;
  const j = await res.json();
  cost.fallback_calls++;
  cost.fallback_tokens_in += Number(j?.usage?.prompt_tokens) || 0;
  cost.fallback_tokens_out += Number(j?.usage?.completion_tokens) || 0;
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

// ═══════════════════════════════════════════════════════════════════════════
// THE WATCH CONTRACT (WS-SPINE P0-3, three-way with WS-CALLLANE and WS-RECALL)
//
// Watch-derived turns reach `meera_log` with `channel = 'watch'`: WS-CALLLANE
// sends them, WS-RECALL accepts them. Their content is NOT something he said.
// It is what a vision model read off HIS SCREEN — a headline, a chat window
// belonging to someone else, a form, a video's subtitles, an OCR misread. A
// derivation that treats that text as testimony mints a durable, cited,
// entailment-audited "fact about his life" out of a machine's guess about
// pixels, and every downstream reader (T5 recall, T2 rel-state, T3 india, the
// self layer) then treats it as something he told her.
//
// THIS SIDE'S RULE, stated once and enforced everywhere below:
//   A `channel = 'watch'` log row is NEVER a source of a durable fact, a kin
//   row, a ritual, an address-term reading, a code-switch ratio sample, or a
//   captured phrase. It does not enter any prompt this file builds.
//
// SCOPE: total exclusion, deliberately — not "excluded from facts but allowed
// to inform an episode summary". A summary is prompt text she reads back, so
// letting screen-derived content in there is the same fabrication one hop
// further from the audit. Her genuine shared-moment record already exists as
// its own object (`vy_shared_moment`, api/episodes.js, written from a REAL
// reaction of hers, not from OCR); that is the safe use, it is already built,
// and it needs nothing from this file. The brief's "when in doubt exclude
// entirely and say so" — said.
//
// ENFORCED IN TWO LAYERS, the same belt-and-braces convention WE_TOKEN_RE /
// WE_TOKEN_SQL and the honorific writer's pre-DB citation check already use in
// this file:
//   1. SQL — every meera_log read below carries WATCH_EXCLUDE_SQL in its WHERE,
//      before any limit, so a watch row is never fetched in the first place.
//   2. JS  — `stripWatchRows` re-checks the fetched rows. Redundant when the
//      SQL is right, which is the point: it is what makes the eval able to
//      prove the rule against a fake driver, and what catches a future query
//      that forgets clause 1.
// `is distinct from` rather than `<>` so a NULL channel (impossible under
// today's `not null default 'chat'`, but a schema is not a promise) keeps the
// row rather than silently dropping every legacy row a migration ever leaves
// null. Failing OPEN on an unknown channel is right here: the closed set is
// "watch", not "chat and call".
export const WATCH_CHANNEL = "watch";
export const watchExcludeSql = (alias) => `and ${alias}.channel is distinct from '${WATCH_CHANNEL}'`;
export const WATCH_EXCLUDE_SQL = watchExcludeSql("l");

/** Layer 2 of the watch contract. Pure, exported, and driven directly by
 *  evals/consolidation/watch-exclusion.mjs against fabricatable fixture rows. */
export function stripWatchRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((r) => r?.channel !== WATCH_CHANNEL);
}

async function suppressionRegexes(person, agentId = MEERA_AGENT_ID) {
  const rows = await q(
    `select term from meera_forget f where device_id = $1
      ${agentScopePredicate("f", { agentId: "$2" })}
      order by at desc limit 200`,
    [person, agentId],
  ).catch(() => []);
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return rows.map((r) => new RegExp(`\\b${esc(r.term)}\\b`, "i")).filter(Boolean);
}
function suppressed(text, rxs) {
  return rxs.some((rx) => rx.test(text));
}

/** People with quiet-enough provisional episodes waiting to finalize.
 *
 *  WS-SPINE P2-2 — `e.channel <> 'watch'`: a watch episode is opened by
 *  api/episodes.js with `summary = ''` and NULL log_from/log_to (that file's
 *  own header: "watch has no meera_log rows at all... a watch episode's
 *  log_from/log_to stay null"). Nothing in `finalizePerson` can ever finalize
 *  such a row — its supersede query requires `log_from is not null and log_to
 *  is not null` and a channel match against a span derived from meera_log — so
 *  the row stays `provisional = true` FOREVER and this query returns its
 *  person on every single sweep, for the rest of time. With a per-invocation
 *  person budget that is not merely wasteful, it is STARVATION: the same
 *  people are selected every hour and everyone behind them in the cursor never
 *  runs. Watch episodes are finalized on their own deterministic path instead
 *  (`finalizeWatchEpisodes`, below) and excluded from the pin here. */
async function findEligiblePersons(limit, agentId = MEERA_AGENT_ID) {
  const rows = await q(
    `select distinct e.person_id from vy_episode e
      where e.provisional = true and e.superseded_by is null
        and e.group_id is null -- state inertness: explicit, not just NULL-person_id accident (multiparty-v1-design)
        and e.channel is distinct from '${WATCH_CHANNEL}' -- P2-2: never pinned by an unfinalizable watch row
        and e.ended_at < now() - ($1 || ' milliseconds')::interval
        ${agentScopePredicate("e", { agentId: "$3" })}
      order by e.person_id
      limit $2`,
    [String(FINALIZE_QUIET_MS), limit, agentId],
  );
  return rows.map((r) => r.person_id);
}

/** Build the numbered batch this person's finalize run may cite from.
 *  WATCH CONTRACT, layer 1 + layer 2 (see the section header above): screen-
 *  derived rows are filtered in the SQL and re-filtered in JS, so nothing that
 *  reaches `renderBatch` — and therefore nothing that reaches the extraction
 *  prompt, an episode span, a fact, a kin row or a citation — can have come
 *  from a watch turn. */
export async function fetchLogBatch(person, { queryFn = q, agentId = MEERA_AGENT_ID } = {}) {
  // meera_log is device-keyed; a person may (eventually) span devices —
  // vy_person_device is the mapping both ways.
  const devices = await queryFn(`select device_id from vy_person_device where person_id = $1`, [person]);
  const deviceIds = devices.length ? devices.map((d) => d.device_id) : [person]; // person_id := device_id cast
  const rows = await queryFn(
    `select l.id, l.device_id, l.role, l.channel, l.kind, l.content, l.at from meera_log l
      where l.device_id = any($1::uuid[]) and l.episode_id is null
        ${agentScopePredicate("l", { agentId: "$3" })}
        ${WATCH_EXCLUDE_SQL}
      order by l.id asc limit $2`,
    [deviceIds, LOG_BATCH_CAP, agentId],
  );
  return stripWatchRows(rows);
}

export function renderBatch(rows) {
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

// ═══════════════════════════════════════════════════════════════════════════
// WS-SPINE P1-2 — THE INDIA LAYER'S WRITE SIDE (vy_kin, vy_ritual)
//
// src/engine/india.ts has had `writeKin` and `recordRitualOccurrence` since
// M4 and NOTHING HAS EVER CALLED THEM (`never-scheduled`: vy_kin 0 rows,
// vy_ritual 0 rows). `dead-writers` in its purest form. This section is the
// caller, and it is built precision-first for one reason stated plainly:
//
//   A WRONG MOTHER'S NAME IS WORSE THAN NO MOTHER'S NAME.
//
// A fact she gets wrong is a fact; a KIN row she gets wrong is a person she
// will address by name, in the wrong relation, for months, and the correction
// costs the user more than the memory was ever worth. So the bar here is
// deliberately higher than the bar for `facts` above, and it is enforced in
// FOUR independent layers, none of which is the model's own confidence:
//
//   1. WRITER WINDOW (same as facts): segments must index the numbered batch.
//   2. VERBATIM EVIDENCE: the model must return the exact source substring it
//      read the relation off. `evidenceInBatch` checks it really is a
//      substring of the cited rows' own text. A model that paraphrases its
//      evidence has, by definition, not got one.
//   3. EXPLICIT RELATIONAL ANCHORING: the evidence must carry a FIRST-PERSON
//      possessive bound to a kin word (`meri maa`, `my mother`, `apni behen`).
//      A bare "maa ka phone aaya" is not enough — whose maa?
//   4. THIRD-PARTY VETO: the evidence must NOT carry someone else's
//      possessive (`uski maa`, `Rohit ki maa`, `his mother`, `dost ki`). This
//      is the trap case the eval fixture drives: a friend's mother mentioned
//      by name in his own words must never become HIS kin. The veto runs
//      AFTER the anchor check and overrides it, because "meri dost ki maa"
//      satisfies both and is a third party.
//
// Everything that survives all four is still written `provisional = true`
// (migration 014). Provisional means: derived, never confirmed by him. The T3
// reader renders it hedged, and a later contradiction supersedes it without a
// user ever having been told a wrong thing as a certainty.
// ═══════════════════════════════════════════════════════════════════════════

/** Closed vocabulary. A relation the model invents is a relation nobody can
 *  render, and role-labelling is the whole point of vy_kin (`chachi != mausi
 *  != bua` — that column's own schema comment). */
export const KIN_RELATIONS = [
  "maa", "papa", "bhai", "behen", "beta", "beti", "patni", "pati",
  "nani", "nana", "dadi", "dada", "chacha", "chachi", "mama", "mami",
  "mausi", "mausa", "bua", "fufa", "bhabhi", "jija", "saas", "sasur",
  "cousin", "in-law",
];

/** vy_ritual.key's own closed set (migration 004's column comment). */
export const RITUAL_KEYS = ["khana_khaya", "good_morning", "match_checkin"];

// Layer 3. First-person possessive bound to a kin word, within a short window
// so "meri behen ne kaha ki uske dost ki maa" does not let the leading "meri"
// license the trailing "maa". Devanagari and Latin, since meera_log carries
// both (CORPUS_COMMON_PHRASES above is half Devanagari for the same reason).
const KIN_WORD_RE =
  "(maa|maa?n|mummy|mom|mother|papa|dad|father|pita|bhai|brother|behen|behn|sister|beta|beti|nani|nana|dadi|dada|chacha|chachi|mama|mami|mausi|mausa|bua|fufa|bhabhi|jija|saas|sasur|wife|husband|patni|pati|माँ|मां|पापा|भाई|बहन|नानी|दादी|चाचा|चाची|मौसी|बुआ)";
const FIRST_PERSON_POSSESSIVE_RE = new RegExp(
  `\\b(meri|mera|mere|apni|apna|apne|my|hamari|hamara|मेरी|मेरा|मेरे|अपनी|अपने)\\b(\\W+\\w+){0,2}\\W+${KIN_WORD_RE}\\b`,
  "i",
);
// Layer 4. Any of these anywhere in the evidence vetoes the row outright.
// `\w+ (ki|ka|ke) <kinword>` catches "Rohit ki maa" — a NAMED third party,
// which is the single most likely shape of the trap.
const THIRD_PARTY_POSSESSIVE_RE = new RegExp(
  `(\\b(uski|uska|uske|unki|unka|unke|his|her|their|उसकी|उसका|उसके|उनकी|उनके)\\b` +
    `|\\b(dost|friend|colleague|boss|neighbour|neighbor|padosi|bhabhi ke|sir|ma'?am|दोस्त)\\b\\W+(ki|ka|ke|'s|की|का|के)\\b` +
    `|\\b\\w+\\b\\s+(ki|ka|ke|की|का|के)\\s+${KIN_WORD_RE}\\b\\s*(ki|ka|ke|की|का|के)?)`,
  "i",
);

function normalizeForEvidence(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Layer 2. True only when `evidence` really is a contiguous substring of the
 *  cited rows' own content — the anti-fabrication check that makes layers 3
 *  and 4 mean anything (they lint the EVIDENCE, so a made-up evidence string
 *  could otherwise be written to pass them). */
export function evidenceInBatch(evidence, rows) {
  const e = normalizeForEvidence(evidence);
  if (e.length < 6) return false; // "maa" alone is not evidence of anything
  return (Array.isArray(rows) ? rows : []).some((r) => normalizeForEvidence(r?.content).includes(e));
}

/** Layers 3 + 4, pure and exported so the kin-precision eval (including the
 *  friend's-mother trap) drives the REAL predicate rather than a restatement
 *  of it. Returns the reason it failed, or "" when the evidence is admissible. */
export function kinAnchorFailure(evidence) {
  const e = String(evidence || "");
  if (THIRD_PARTY_POSSESSIVE_RE.test(e)) return "third-party possessive: this kin belongs to someone else";
  if (!FIRST_PERSON_POSSESSIVE_RE.test(e)) return "no first-person relational anchor in the source text";
  return "";
}

function extractionPrompt(batchText, lastIndex) {
  return `You are segmenting a real conversation log into episodes and deriving cited facts, for a companion app's long-term memory. Reply with ONLY JSON:
{"episodes":[{"from":0,"to":4,"channel":"chat|call","reason":"gap|channel|topic|affect|goal|session","summary":"telegraphic note, <=18 words, no terminal punctuation, third person","affect":[{"tag":"warm|stressed|excited|sad|teasing|bored|anxious|content","intensity":0.0}],"importance":"low|medium|high"}],
"facts":[{"kind":"user|world|self_in_relation|relationship|india|meera","name":"short lowercase label","body":"telegraphic note, <=18 words, third person, no terminal punctuation","feel":"their own words for how it felt, or empty string","segments":[0]}],
"kin":[{"name":"the person's name as written","relation":"${KIN_RELATIONS.join("|")}","address_term":"what HE calls them, or empty string","fictive":false,"segments":[0],"evidence":"the EXACT words from the log that say this person is HIS relative, copied character for character"}],
"rituals":[{"key":"${RITUAL_KEYS.join("|")}","segments":[0],"evidence":"the EXACT words from the log showing this recurring exchange happened, copied character for character"}]}

RULES, hard:
- "kin" and "rituals" are almost always EMPTY ARRAYS. That is the correct answer. Propose one only when the log says it outright.
- "kin": ONLY people who are THIS user's own relatives, stated by him in his own words ("meri maa", "my sister", "apni nani"). A relative of somebody ELSE — his friend's mother, a colleague's brother, someone in a story he is retelling — is NEVER kin. If you cannot tell whose relative it is, leave it out.
- "evidence" must be COPIED VERBATIM from a numbered line below. Do not paraphrase it, do not clean it up, do not translate it. An evidence string that is not literally in the log is discarded and so is everything attached to it.
- "rituals": only the recurring exchanges named in the key list — khana_khaya (asking whether the other has eaten), good_morning (a daily first-message greeting), match_checkin (checking in about a cricket match). Never invent a key.
- "from"/"to" in "episodes" and every number in "segments" MUST be indices into the numbered log below — never invent a number outside [0, ${lastIndex}].
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

/**
 * The four precision layers, applied. PURE and exported: the kin-precision
 * eval (evals/consolidation/kin-precision.mjs, including the friend's-mother
 * trap) drives THIS function, not a restatement of it.
 *
 * @param parsed          the model's whole JSON reply
 * @param batch           the numbered log batch it was given (watch-free)
 * @param episodeIdByIdx  proposal index -> real episode id, from the episode
 *                        writer window; a kin row citing a REJECTED episode
 *                        has no anchor and is dropped, exactly as a fact is
 * @param rxs             meera_forget suppression regexes
 * @param spanByIdx       proposal index -> {logFrom, logTo}; narrows the text
 *                        an evidence string may have been copied from to the
 *                        rows the proposal actually cited
 */
export function acceptKinProposals(parsed, batch, episodeIdByIdx, rxs = [], spanByIdx = new Map()) {
  const kin = [];
  const rituals = [];
  const rejected = [];

  const cited = (segments) => {
    const idxs = Array.isArray(segments) ? segments.filter((n) => Number.isInteger(n)) : [];
    return [...new Set(idxs.map((i) => episodeIdByIdx.get(i)).filter((v) => v != null))];
  };
  // The rows a proposal's own citations point at — the ONLY text its evidence
  // may have come from. Checking the evidence against the whole batch would
  // let a model cite episode 0 and quote episode 4.
  const rowsFor = (segments) => {
    const idxs = Array.isArray(segments) ? segments.filter((n) => Number.isInteger(n)) : [];
    const out = [];
    for (const i of idxs) {
      const span = spanByIdx.get(i);
      if (span) out.push(...batch.filter((r) => r.id >= span.logFrom && r.id <= span.logTo));
    }
    // No span mapping supplied (a caller that only has ids): fall back to the
    // whole batch, which is still a real watch-free source-text check — never
    // to "accept it anyway".
    return out.length ? out : batch;
  };

  for (const k of Array.isArray(parsed?.kin) ? parsed.kin.slice(0, 4) : []) {
    const citations = cited(k?.segments);
    const name = String(k?.name || "").trim().slice(0, 60);
    const relation = String(k?.relation || "").trim().toLowerCase();
    const evidence = String(k?.evidence || "");
    if (!citations.length) { rejected.push({ kind: "kin", name, why: "no accepted episode cited" }); continue; }
    if (!name || name.length < 2) { rejected.push({ kind: "kin", name, why: "no name" }); continue; }
    if (!KIN_RELATIONS.includes(relation)) { rejected.push({ kind: "kin", name, why: `relation "${relation}" outside the closed set` }); continue; }
    if (!evidenceInBatch(evidence, rowsFor(k?.segments))) {
      rejected.push({ kind: "kin", name, why: "evidence is not verbatim in the cited source" });
      continue;
    }
    const anchorWhy = kinAnchorFailure(evidence);
    if (anchorWhy) { rejected.push({ kind: "kin", name, why: anchorWhy }); continue; }
    // The NAME must appear in the source too, not only the relation. A model
    // that read "meri maa" correctly and then supplied a name from nowhere is
    // this section's exact failure mode, and layers 2-4 alone do not catch it:
    // they lint the evidence string, and the evidence string can be perfectly
    // genuine while the `name` field beside it is invented.
    //
    // Two ways to satisfy it, because `evidenceInBatch` has a >=6-character
    // floor (a 3-letter "maa" is not evidence of anything) and real names are
    // often shorter than that: either the name is long enough to be looked up
    // in the source rows directly, or it appears inside the evidence string —
    // which was itself already proven verbatim in those same rows, so the
    // grounding is equally real either way.
    const nameInSource =
      evidenceInBatch(name, rowsFor(k?.segments)) ||
      normalizeForEvidence(evidence).includes(normalizeForEvidence(name));
    if (!nameInSource) {
      rejected.push({ kind: "kin", name, why: "name does not appear in the cited source" });
      continue;
    }
    if (suppressed(name, rxs) || suppressed(evidence, rxs)) {
      rejected.push({ kind: "kin", name, why: "suppressed by meera_forget" });
      continue;
    }
    kin.push({
      name,
      relation,
      fictive: k?.fictive === true,
      address_term: String(k?.address_term || "").trim().slice(0, 40),
      citations,
      evidence,
    });
  }

  for (const r of Array.isArray(parsed?.rituals) ? parsed.rituals.slice(0, 3) : []) {
    const citations = cited(r?.segments);
    const key = String(r?.key || "").trim().toLowerCase();
    const evidence = String(r?.evidence || "");
    if (!citations.length) { rejected.push({ kind: "ritual", name: key, why: "no accepted episode cited" }); continue; }
    if (!RITUAL_KEYS.includes(key)) { rejected.push({ kind: "ritual", name: key, why: "key outside the closed set" }); continue; }
    if (!evidenceInBatch(evidence, rowsFor(r?.segments))) {
      rejected.push({ kind: "ritual", name: key, why: "evidence is not verbatim in the cited source" });
      continue;
    }
    rituals.push({ key, citations, evidence });
  }

  return { kin, rituals, rejected };
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
async function finalizePerson(person, { dryRun = false, agentId = MEERA_AGENT_ID } = {}) {
  const rep = { person, log_rows: 0, episodes: 0, facts: 0, rejected_episodes: 0, rejected_facts: 0, audited: 0, refuted: 0, superseded_episodes: 0, superseded_facts: 0, dated_facts: 0, disjoint_facts: 0, kin: 0, kin_rejected: 0, rituals: 0, rituals_rejected: 0, kin_errors: [] };
  const batch = await fetchLogBatch(person, { agentId });
  if (!batch.length) return rep;
  // Layer 2 of the watch contract, asserted rather than assumed at the ONE
  // place it would matter: everything below — the prompt, the spans, the
  // citations — is built out of `batch`. `fetchLogBatch` already strips these
  // rows in both SQL and JS; if a third path ever produces one, this is where
  // the run stops instead of minting a screen-derived fact.
  const smuggled = batch.filter((r) => r.channel === WATCH_CHANNEL).length;
  if (smuggled) {
    rep.watch_rows_smuggled = smuggled;
    console.error(`[consolidate] ${smuggled} watch rows reached the batch for ${person} — refusing to derive`);
    return rep;
  }
  rep.log_rows = batch.length;
  const inputFrom = batch[0].id;
  const inputTo = batch[batch.length - 1].id;

  const rendered = renderBatch(batch);
  const raw = await llm([{ role: "user", content: extractionPrompt(rendered, batch.length - 1) }], 2200);
  if (!raw) return rep; // a failed derivation is a late pass, never a lost one — retried next run
  const parsed = parseJsonLoose(raw);
  if (!parsed) return rep;

  const rxs = await suppressionRegexes(person, agentId);
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
          // `source` distinguishes WHERE the feeling was read from, and until now
          // every row said "text" — including rows derived entirely from calls.
          // migration 002 declared `source:'text'|'voice_v0'` and no writer ever
          // produced the second value, so the column recorded a distinction the
          // data could not express. (`dead-writers`, in its schema form: a
          // declared enum value with no producer is an absent one.)
          //
          // voice_v0 means: this came from a CALL, and it was read from the
          // call's WORDS, not its sound. It is deliberately not "voice" — real
          // prosody has not shipped, and when it does, the rows that predate it
          // must be separable from the rows that have acoustics behind them.
          // Naming the generation now is what makes that possible later; a row
          // labelled "voice" today would be a claim about audio nobody analysed.
          //
          // `channel` above is "call" only when EVERY turn in the span is a call.
          // A mixed text-and-call span stays "text", which understates rather
          // than overstates the provenance — the safe direction for a label
          // whose whole purpose is to say what evidence exists.
          .map((a) => ({ tag: a.tag.slice(0, 24), intensity: Math.max(0, Math.min(1, Number(a.intensity) || 0.3)), source: channel === "call" ? "voice_v0" : "text", extractor: EXTRACT_MODEL_AZURE, confidence: 0.7 }))
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
        `insert into vy_episode (agent_id, person_id, device_id, channel, participation, started_at, ended_at,
           boundary_reason, log_from, log_to, summary, affect_tags, importance, provisional)
         values (${agentValue("$13")},$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,false)
         returning id`,
        [person, batch[0].device_id, e.channel, participation, new Date(e.startedAt).toISOString(), new Date(e.endedAt).toISOString(), e.reason, e.logFrom, e.logTo, e.summary, JSON.stringify(e.affect), e.importance, agentId],
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
        `update meera_log l set episode_id = $1 where device_id = $2
          and id between $3 and $4 and episode_id is null
          ${agentScopePredicate("l", { agentId: "$5" })}`,
        [finalId, batch[0].device_id, e.logFrom, e.logTo, agentId],
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
    // ── BI-TEMPORAL FACT EDGES (migration 056, WS-O) ────────────────────
    // `saidAt` is the START of the episode this fact cites, never the
    // consolidation clock. That is the whole mechanism and it is the reason
    // the derivation happens HERE rather than in a later sweep: "kal" resolves
    // against when they SAID it, and a nightly pass that anchored on its own
    // run time would put every relative date one night late — and a pass that
    // re-ran a week later would put it a week late, producing a different
    // interval each time it touched the same row.
    const saidAt = acceptedEpIdx.get(segIdxs[0])?.startedAt;
    factsToEmbed.push({
      kind,
      name,
      body,
      feel: telegraphic(f.feel, 60),
      citations: citedEpIds,
      segIdxs,
      saidAt: Number.isFinite(saidAt) ? Number(saidAt) : null,
    });
  }

  if (!factsToEmbed.length) {
    rep.facts = 0;
  } else if (dryRun) {
    rep.facts = factsToEmbed.length;
  } else {
    const vecs = await embedBatch(factsToEmbed.map((f) => f.body)).catch(() => []);
    // ── BI-TEMPORAL FACT EDGES (migration 056, WS-O) ──────────────────────
    // The parser is src/engine/validity.ts over timeline.ts's `resolveWhen`,
    // reached through the engine bundle. It is not re-implemented here for the
    // reason this file already learned once at its own cost — its header names
    // the "honorific port" as a mirrored-logic mistake, and a second date table
    // is that mistake with dates instead of address terms.
    //
    // Loaded ONCE per run, lazily, and a missing bundle degrades to null
    // validity on every row — which is exactly today's behaviour, because null
    // validity is what every row written before 056 carries.
    const vmod = await import("./_engine.gen.js").catch(() => null);
    const derive = typeof vmod?.deriveFactValidity === "function" ? vmod.deriveFactValidity : null;
    const overlaps =
      typeof vmod?.validityOverlaps === "function" ? vmod.validityOverlaps : () => true;
    const validityFor = (f) => {
      if (!derive || !Number.isFinite(f.saidAt)) return null;
      try {
        return derive({ id: f.name, name: f.name, kind: f.kind, summary: f.body, saidAt: f.saidAt });
      } catch {
        return null;
      }
    };
    for (let i = 0; i < factsToEmbed.length; i++) {
      const f = factsToEmbed[i];
      const v = validityFor(f);
      // contradiction handling (§4.1.3): a NEW row always; an existing
      // active final fact with the same name gets superseded, never
      // updated in place.
      // The contradiction lookup is a RETRIEVAL that decides a write: an
      // unscoped read here would let another agent's fact of the same name
      // supersede this one, which is the cross-agent leak inverted — not a row
      // escaping into the wrong context, but the wrong context editing a row.
      const prior = await q(
        `select v.id, v.body, v.valid_from, v.valid_to from vy_fact v
          where v.person_id = $1 and lower(v.name) = $2
           and v.provisional = false and v.t_invalid is null and v.retracted_at is null
           ${agentScopePredicate("v", { agentId: "$3" })}
         order by v.created_at desc limit 1`,
        [person, f.name, agentId],
      ).catch(() => []);
      const ins = await q(
        `insert into vy_fact (agent_id, person_id, kind, name, body, feel, provenance, confidence, citations, provisional, valid_from, valid_to)
         values (${agentValue("$7")},$1,$2,$3,$4,$5,'extracted',0.85,$6::bigint[],false,$8,$9)
         returning id`,
        [
          person,
          f.kind,
          f.name,
          f.body,
          f.feel,
          f.citations,
          agentId,
          v ? new Date(v.validFrom).toISOString() : null,
          v && v.validTo != null ? new Date(v.validTo).toISOString() : null,
        ],
      ).catch(() => []);
      if (!ins[0]) continue;
      rep.facts++;
      if (v) rep.dated_facts++;
      const newId = ins[0].id;
      // ── CONTRADICTION IS NOW A QUERY OVER VALIDITY (ROADMAP-100X item 4) ──
      //
      // WHAT WAS WRONG. "Same lowercased name + different body ⇒ supersede the
      // older row" is right for a belief that CHANGED ("lives in lucknow" →
      // "lives in delhi") and wrong for a SEQUENCE of same-named,
      // differently-dated things. Two rows named `exam`, one for a November
      // sitting and one for the May one after it, are not a contradiction —
      // they are two exams, and superseding the first sets `t_invalid`, which
      // every recall query in this repo reads as a hard exclusion. The November
      // exam would vanish from her memory the moment the May one was mentioned.
      //
      // The predicate: supersede only when the two facts' EVENT-time intervals
      // overlap. A row with no validity overlaps everything — so for every row
      // written before 056, and for every fact whose text carries no resolvable
      // date, this is byte-for-byte the rule that shipped before, and the
      // change is opt-in per row rather than a new global behaviour.
      //
      // NO LLM CALL, which is the sentence the roadmap item is written in: two
      // timestamp comparisons where a model call was the alternative design.
      const priorOverlaps =
        prior[0] &&
        overlaps(
          {
            validFrom: prior[0].valid_from ? new Date(prior[0].valid_from).getTime() : null,
            validTo: prior[0].valid_to ? new Date(prior[0].valid_to).getTime() : null,
          },
          v ? { validFrom: v.validFrom, validTo: v.validTo } : null,
        );
      if (prior[0] && prior[0].body !== f.body && priorOverlaps) {
        await q(
          `update vy_fact v set t_invalid = now(), superseded_by = $1 where v.id = $2
            ${agentScopePredicate("v", { agentId: "$3" })}`,
          [newId, prior[0].id, agentId],
        ).catch(() => {});
      } else if (prior[0] && prior[0].body !== f.body) {
        rep.disjoint_facts = (rep.disjoint_facts || 0) + 1;
      }
      // supersede the provisional fact(s) this promotes, matched by name
      // under the episodes just finalized (§0.2.1: provisional is
      // second-class, replaced wholesale on finalize)
      const provChain = await q(
        `update vy_fact v set superseded_by = $1
           where v.person_id = $2 and lower(v.name) = $3 and v.provisional = true and v.superseded_by is null
             and v.citations && $4::bigint[]
             ${agentScopePredicate("v", { agentId: "$5" })}
         returning v.id`,
        [newId, person, f.name, [...episodeIdByIdx.values()], agentId],
      ).catch(() => []);
      rep.superseded_facts += provChain.length;

      if (vecs[i]) {
        await q(
          `insert into vy_embedding (agent_id, owner_kind, owner_id, person_id, v)
           values (${agentValue("$4")},'fact',$1,$2,$3::halfvec)
           on conflict (owner_kind, owner_id) do update set v = excluded.v, at = now()`,
          [newId, person, toHalfvecLiteral(vecs[i]), agentId],
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
        `update vy_episode v set superseded_by = $1
           where v.person_id = $2 and v.provisional = true and v.superseded_by is null
             and v.channel = $3 and v.log_from is not null and v.log_to is not null
             and v.log_from <= $5 and v.log_to >= $4
             ${agentScopePredicate("v", { agentId: "$6" })}
         returning v.id`,
        [finalId, person, e.channel, e.logFrom, e.logTo, agentId],
      ).catch(() => []);
      rep.superseded_episodes += supers.length;
    }
  }

  // ── P1-2: the india layer's write side (vy_kin / vy_ritual) ──
  // Runs for dry runs too, up to the acceptance boundary: the WHOLE value of
  // a dry run over a first-ever backlog is seeing what the precision layers
  // would have accepted before anything durable exists.
  {
    const spanByIdx = new Map([...acceptedEpIdx.entries()].map(([idx, e]) => [idx, { logFrom: e.logFrom, logTo: e.logTo }]));
    const { kin, rituals, rejected } = acceptKinProposals(parsed, batch, episodeIdByIdx, rxs, spanByIdx);
    rep.kin_rejected = rejected.filter((r) => r.kind === "kin").length;
    rep.rituals_rejected = rejected.filter((r) => r.kind === "ritual").length;
    rep.kin_reasons = rejected.slice(0, 6);
    if (dryRun) {
      rep.kin = kin.length;
      rep.rituals = rituals.length;
    } else if (kin.length || rituals.length) {
      // india.ts is CLIENT-BUNDLED TypeScript and this is a plain-JS
      // serverless function under the zero-imports-from-src rule, so the
      // writers arrive through api/_engine.gen.js — the same seam the self
      // layer already uses, and for the same stated reason: hand-porting
      // writeKin's upsert into JS would be a second definition of what a kin
      // row IS, and it would drift on the first edit to either copy.
      const engine = await loadSelfEngine();
      if (!engine?.writeKin) {
        rep.kin_errors.push("engine bundle missing writeKin — india layer skipped, not approximated");
      } else {
        for (const k of kin) {
          try {
            await engine.writeKin(
              q,
              {
                person_id: person,
                name: k.name,
                relation: k.relation,
                fictive: k.fictive,
                address_term: k.address_term,
                citations: k.citations,
                // migration 014. Derived, never confirmed by him — the T3
                // reader hedges it and a contradiction supersedes it without
                // anyone ever having been told a wrong thing as a certainty.
                provisional: true,
              },
              agentId,
            );
            rep.kin++;
          } catch (e) {
            // NOT a .catch(() => {}) swallow. `relstate-zero-rows` is this
            // repo's most expensive recurring bug and every instance of it
            // was a writer failing quietly; a kin write that cannot land must
            // say so in the run report where a first-run operator will read it.
            rep.kin_errors.push(`kin ${k.name}: ${String(e?.message || e).slice(0, 140)}`);
          }
        }
        for (const r of rituals) {
          try {
            // last_at = now() (recordRitualOccurrence's own shape) rather than
            // the occurrence's real timestamp: consolidation runs within the
            // hour, and the error direction is SAFE — a ritual stamped later
            // than it happened is due later, i.e. she asks less often, never
            // more. Noted rather than worked around; changing that signature
            // is india.ts's owner's call, not a consolidation-side patch.
            await engine.recordRitualOccurrence(q, person, r.key, r.citations[0], false, agentId);
            rep.rituals++;
          } catch (e) {
            rep.kin_errors.push(`ritual ${r.key}: ${String(e?.message || e).slice(0, 140)}`);
          }
        }
      }
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
      await q(
        `update vy_fact v set retracted_at = case when $2 = 'refuted' then now() else retracted_at end
          where v.id = $1 ${agentScopePredicate("v", { agentId: "$3" })}`,
        [item.factId, verdict === "refuted" ? "refuted" : "ok", agentId],
      ).catch(() => {});
      await q(
        `insert into vy_derivation (agent_id, person_id, model, prompt_hash, input_from, input_to, wrote, audit_status)
         values (${agentValue("$7")},$1,$2,'audit',$3,$4,$5::jsonb,$6)`,
        [person, AUDIT_MODEL, inputFrom, inputTo, JSON.stringify([{ table: "vy_fact", id: item.factId }]), verdict, agentId],
      ).catch(() => {});
    }
  }

  // ── derivation audit record for the run itself (unaudited default) ──
  if (!dryRun) {
    await q(
      `insert into vy_derivation (agent_id, person_id, model, prompt_hash, input_from, input_to, wrote)
       values (${agentValue("$6")},$1,$2,'finalize',$3,$4,$5::jsonb)`,
      [
        person,
        AZ_KEY ? EXTRACT_MODEL_AZURE : EXTRACT_MODEL_FALLBACK,
        inputFrom,
        inputTo,
        JSON.stringify([...episodeIdByIdx.values()].map((id) => ({ table: "vy_episode", id }))),
        agentId,
      ],
    ).catch(() => {});

    // ── decay (§4.1.7): pure SQL, kind-banded half-life ──
    const decayCfg = await loadDecayConfig();
    const hl = decayCfg.half_life_days || {};
    for (const [kind, days] of Object.entries(hl)) {
      await q(
        `update vy_fact v set need_p = greatest(0.02, exp(-0.6931471805599453 * extract(epoch from (now() - v.created_at)) / (86400.0 * $3)))
           where v.person_id = $1 and v.kind = $2 and v.t_invalid is null and v.retracted_at is null
           ${agentScopePredicate("v", { agentId: "$4" })}`,
        [person, kind, days, agentId],
      ).catch(() => {});
    }
  }

  return rep;
}

// ═══════════════════════════════════════════════════════════════════════════
// WS-SPINE P2-2 — WATCH EPISODES FINALIZE DETERMINISTICALLY, OR NOT AT ALL
//
// api/episodes.js opens a watch episode with `summary = ''` and NULL
// log_from/log_to (its own header explains why: meera_log carried no watch
// rows). `finalizePerson` cannot touch such a row — every path it has runs off
// a meera_log span — so before this function existed a watch episode stayed
// `provisional = true` forever and re-pinned its person in
// `findEligiblePersons` on every sweep, permanently. That is not a cost bug,
// it is a STARVATION bug: with a bounded per-invocation person budget the same
// pinned people are selected every hour and the queue behind them never runs.
//
// WHAT IT WRITES: nothing derived from content. A watch episode's summary is
// built from COUNTED rows in vy_shared_moment — objects api/episodes.js wrote
// from a real reaction of hers, never from OCR — and the count is all that
// reaches the string. No LLM, no claim about what was on screen, nothing that
// could be recited. The episode becomes final so it stops pinning, carries no
// facts, and is excluded from every derivation batch below.
//
// QUIET WINDOW: WATCH_FINALIZE_QUIET_MS deliberately EXCEEDS api/episodes.js's
// GAP_MS (45m). Finalizing at the 30-minute FINALIZE_QUIET_MS would race the
// live lane: `openOrExtendEpisode` looks for a PROVISIONAL row within 45
// minutes, so finalizing at 30 would fragment a session that was still going
// into two episodes for no reason.
const WATCH_FINALIZE_QUIET_MS = 60 * 60_000; // > api/episodes.js GAP_MS (45m)

export function watchEpisodeSummary(momentCount) {
  const n = Math.max(0, Number(momentCount) || 0);
  return n > 0 ? `watched together, ${n} shared moment${n === 1 ? "" : "s"}` : "watched together";
}

/** Finalize (or exclude) this person's quiet watch episodes. Agent-scoped on
 *  every statement — vy_episode is (agent x person) state and a second agent's
 *  watch session is not this agent's to close. */
export async function finalizeWatchEpisodes(person, { dryRun = false, agentId = MEERA_AGENT_ID, queryFn = q } = {}) {
  const rows = await queryFn(
    `select e.id from vy_episode e
      where e.person_id = $1 and e.provisional = true and e.superseded_by is null
        and e.group_id is null and e.channel = '${WATCH_CHANNEL}'
        and e.ended_at < now() - ($2 || ' milliseconds')::interval
        ${agentScopePredicate("e", { agentId: "$3" })}
      order by e.id asc limit 50`,
    [person, String(WATCH_FINALIZE_QUIET_MS), agentId],
  ).catch(() => []);
  if (!rows.length || dryRun) return rows.length;
  let done = 0;
  for (const r of rows) {
    const moments = await queryFn(
      `select count(*)::int as n from vy_shared_moment m
        where m.episode_id = $1 and m.person_id = $2
        ${agentScopePredicate("m", { agentId: "$3" })}`,
      [r.id, person, agentId],
    ).catch(() => []);
    const upd = await queryFn(
      `update vy_episode e set provisional = false, summary = $2
        where e.id = $1 and e.provisional = true
        ${agentScopePredicate("e", { agentId: "$3" })}
        returning e.id`,
      [r.id, watchEpisodeSummary(moments[0]?.n ?? 0), agentId],
    ).catch(() => []);
    done += upd.length;
  }
  return done;
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
export function detectAddressTerm(text) {
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
export function honorificShift(current, evidence, ruptureOpen, now = new Date()) {
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
async function refreshDerivedDims(person, agentId = MEERA_AGENT_ID) {
  const pattern = HINDI_MARKER_WORDS.map((w) => `\\m${w}\\M`).join("|");
  const [csRows, ritualRows, pacingRows] = await Promise.all([
    q(
      // WATCH CONTRACT: a code-switch ratio sampled over screen-derived text
      // measures the language of whatever he was READING, not the register he
      // writes to her in — and cs_ratio is exactly the dial that decides how
      // much Hindi she answers in. An English-heavy work screen would quietly
      // switch her out of Hinglish.
      `with recent as (
       select l.content from meera_log l
       join vy_person_device d on d.device_id = l.device_id
       where d.person_id = $1 and l.role = 'me'
           ${agentScopePredicate("l", { agentId: "$3" })}
           ${WATCH_EXCLUDE_SQL}
         order by l.at desc limit 200
       )
       select count(*)::int as total, count(*) filter (where content ~* $2)::int as hindi_hits
         from recent`,
      [person, pattern, agentId],
    ).catch(() => []),
    q(
      `select count(*) filter (where r.last_at > now() - interval '30 days')::real
                / greatest(count(*), 1)::real as density
         from vy_ritual r where r.person_id = $1
         ${agentScopePredicate("r", { agentId: "$2" })}`,
      [person, agentId],
    ).catch(() => []),
    q(
      `select percentile_cont(0.5) within group (order by gap_s) as pacing_gap_s
         from (
           select extract(epoch from e.started_at - lag(e.started_at) over (order by e.started_at)) as gap_s
             from vy_episode e
            where e.person_id = $1 and e.group_id is null and e.started_at > now() - interval '30 days'
              ${agentScopePredicate("e", { agentId: "$2" })}
         ) s where gap_s is not null`,
      [person, agentId],
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
  // MIGRATED ARBITER (009 header's ten sites; migration 010 precondition):
  // (agent_id, person_id) is the PK now. .catch()-swallowed, so leaving it on
  // the old key would fail exactly the way `relstate-zero-rows` failed — a
  // writer silently not writing, discovered months later.
  await q(
    `insert into vy_rel_state (agent_id, person_id, cs_ratio, ritual_density, pacing_gap_s)
     values (${agentValue("$5")},$1,$2,$3,$4)
     on conflict (agent_id, person_id) do update set
       cs_ratio = $2, ritual_density = $3, pacing_gap_s = $4`,
    [person, csRatio, ritualDensity, pacingGapS, agentId],
  ).catch(() => {});
  return { csRatio, ritualDensity, pacingGapS };
}

// how far back "freshly finalized" looks — one nightly cycle's worth, plus
// slack, so a missed/halted prior run is self-healing rather than silently
// skipped (this file's own "a missed pass is late, never lost" philosophy)
const RELDERIVE_LOOKBACK_H = 30;

async function findPersonsWithFreshEpisodes(limit, agentId = MEERA_AGENT_ID) {
  const rows = await q(
    // WATCH CONTRACT: a finalized watch episode (P2-2) carries a counted,
    // content-free summary and no facts. It is not evidence of anything a
    // derivation below reads, and admitting it here would put "watched
    // together, 3 shared moments" into the trust and pattern prompts as if it
    // were something that was said.
    `select distinct e.person_id from vy_episode e
      where e.provisional = false and e.group_id is null
        and e.channel is distinct from '${WATCH_CHANNEL}'
        and e.created_at > now() - interval '${RELDERIVE_LOOKBACK_H} hours'
        ${agentScopePredicate("e", { agentId: "$2" })}
      order by e.person_id limit $1`,
    [limit, agentId],
  ).catch(() => []);
  return rows.map((r) => r.person_id);
}

/** One person's honorific derivation: gather address-term evidence from
 *  their freshly-finalized episodes' own log spans, run it through the
 *  mirrored hysteresis, write a cited vy_rel_event if it moved, refresh the
 *  three derived dims. Returns a per-person report for the run summary. */
async function deriveRelEventsForPerson(person, { dryRun = false, agentId = MEERA_AGENT_ID } = {}) {
  const rep = { person, episodes_scanned: 0, honorific_evidence: 0, honorific_moved: false, dims_refreshed: false };
  const episodes = await q(
    `select e.id, e.log_from, e.log_to, e.started_at from vy_episode e
      where e.person_id = $1 and e.provisional = false and e.group_id is null
        and e.channel is distinct from '${WATCH_CHANNEL}' -- WATCH CONTRACT
        and e.created_at > now() - interval '${RELDERIVE_LOOKBACK_H} hours'
        and e.log_from is not null and e.log_to is not null
        ${agentScopePredicate("e", { agentId: "$2" })}
      order by e.started_at asc limit 200`,
    [person, agentId],
  ).catch(() => []);
  rep.episodes_scanned = episodes.length;
  if (!episodes.length) return rep;

  const stateRows = await q(
    `select r.honorific, r.rupture_open, r.repair_state from vy_rel_state r where r.person_id = $1
      ${agentScopePredicate("r", { agentId: "$2" })}`,
    [person, agentId],
  ).catch(() => []);
  // no vy_rel_state row yet: schema default (§2.4) — matches
  // relstate.ts's initialRelState() exactly
  const current = stateRows[0]?.honorific ?? "tum";
  const ruptureOpenRaw = Boolean(stateRows[0]?.rupture_open ?? false);
  const repairState = stateRows[0]?.repair_state ?? "none";
  // record-vs-stance split (rejected.md `rupture-never-closes`): honorificShift's
  // instant-regress/re-advance-hold is meant to react to whether the rupture
  // is STILL being actively held, not to a flag that (before this fix) never
  // cleared on its own — see relstate.ts's honorificShift doc comment.
  const ruptureStanceLapsed = await ruptureStanceLapsedFor(
    person,
    agentId,
    ruptureOpenRaw,
    repairState,
    episodes[0].started_at,
  );
  const ruptureOpen = ruptureOpenRaw && !ruptureStanceLapsed;

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
      // WATCH CONTRACT: an "aap" read off a form on his screen is not him
      // choosing how to address her. The honorific is the single most
      // relationship-defining value this file writes and it moves on
      // accumulated evidence, so a stretch of screen text in the wrong
      // register could advance or regress it with nobody having said a word.
      // `l.channel` is projected only so layer 2 can see it — a strip that
      // cannot read the column it filters on is a strip that always passes.
      `select l.content, l.at, l.channel from meera_log l
        where l.device_id in (select device_id from vy_person_device where person_id = $1
                             union select $1::uuid)
          and l.role = 'me' and l.id between $2 and $3
          ${agentScopePredicate("l", { agentId: "$4" })}
          ${WATCH_EXCLUDE_SQL}`,
      [person, ep.log_from, ep.log_to, agentId],
    ).catch(() => []);
    for (const r of stripWatchRows(rows)) {
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
        `insert into vy_rel_event (agent_id, person_id, dim, from_v, to_v, direction, note, citations)
         values (${agentValue("$7")},$1,'honorific',$2,$3,$4,$5,$6)`,
        [person, current, move.next, move.direction, telegraphic(move.note, 160), move.citations, agentId],
      ).catch(() => {});
      // same discovered no-op-on-missing-row issue as refreshDerivedDims
      // above, same upsert fix. MIGRATED ARBITER (010 precondition).
      await q(
        `insert into vy_rel_state (agent_id, person_id, honorific) values (${agentValue("$3")},$1,$2)
         on conflict (agent_id, person_id) do update set honorific = $2`,
        [person, move.next, agentId],
      ).catch(() => {});
      rep.honorific_moved = true;
    }
  } else if (move && dryRun) {
    rep.honorific_moved = true; // reported, not written
  }

  if (!dryRun) {
    await refreshDerivedDims(person, agentId);
    rep.dims_refreshed = true;
  }
  return rep;
}

/** The orchestrator itself — SPEC §13 seam 4. Runs AFTER finalize, BEFORE
 *  relcheck (consolidate.yml wiring below). Independent of runConsolidation
 *  (own person cursor, own limit) so a partial/halted finalize run still
 *  lets already-finalized episodes get their honorific pass — "late, never
 *  lost" applies here too. */
export async function runRelEventDerivation({ limit = DEFAULT_PERSON_LIMIT, dryRun = false, onlyPerson = null, agentId = MEERA_AGENT_ID } = {}) {
  const t0 = Date.now();
  const persons = onlyPerson ? [onlyPerson] : await findPersonsWithFreshEpisodes(limit, agentId);
  const reports = [];
  for (const person of persons) reports.push(await deriveRelEventsForPerson(person, { dryRun, agentId }));
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
// section carries. The state-machine math itself is untouched: same five
// branches (record-vs-stance split, context/rejected.md
// `rupture-never-closes`, added a branch — see relstate.ts's own comment on
// it), same priority order (regress-on-re-rupture checked before any repair
// advance, so a fresh rupture arriving mid-repair cannot be shadowed).
// `stanceLapsed` defaults to false, same as relstate.ts, so every existing
// call is byte-identical unless a caller opts in.
export function ruptureRepairShift(state, conflictSignal, theirRepairSignal, stanceLapsed = false) {
  if (conflictSignal && !state.ruptureOpen) {
    return { ruptureOpen: true, repairState: "open", dim: "rupture", direction: "advance", note: "conflict-shaped episode: rupture opens" };
  }
  if (conflictSignal && state.ruptureOpen && state.repairState === "open" && stanceLapsed) {
    return { ruptureOpen: true, repairState: "open", dim: "rupture", direction: "advance", note: "conflict-shaped episode after lapsed stance: rupture re-opens" };
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

// mirrors relstate.ts's RUPTURE_STANCE_LAPSE_DAYS/RUPTURE_STANCE_LAPSE_WARM_EPISODES/
// ruptureStance exactly — the record-vs-stance split itself (see that
// file's section header comment for the full design). Never reads or
// writes vy_rel_event; pure function of already-fetched inputs.
const RUPTURE_STANCE_LAPSE_DAYS = 21;
const RUPTURE_STANCE_LAPSE_WARM_EPISODES = 8;
export function ruptureStance(input, now = new Date()) {
  if (!input.ruptureOpen) return "none";
  if (!input.lastMoveAt) return "open";
  const days = (now.getTime() - new Date(input.lastMoveAt).getTime()) / MS_PER_DAY;
  if (days >= RUPTURE_STANCE_LAPSE_DAYS) return "settled";
  if (input.warmEpisodesSince >= RUPTURE_STANCE_LAPSE_WARM_EPISODES) return "settled";
  return "open";
}

/** Shared by both derivation passes below: the timestamp the STANCE lapses
 *  FROM (most recent dim in ('rupture','repair')) and the warm-episode
 *  count since it, bounded to episodes strictly before `beforeTs` so a
 *  batch's own fresh conflict episode never inflates the very count that
 *  decides whether the PREVIOUS rupture had already lapsed. Only queries
 *  when a rupture is actually open — nothing reads this otherwise. */
async function ruptureStanceLapsedFor(person, agentId, ruptureOpen, repairState, beforeTs) {
  if (!ruptureOpen) return false;
  const moveRows = await q(
    `select e.at from vy_rel_event e where e.person_id = $1 and e.dim in ('rupture', 'repair')
      ${agentScopePredicate("e", { agentId: "$2" })}
      order by e.at desc limit 1`,
    [person, agentId],
  ).catch(() => []);
  const lastMoveAt = moveRows[0]?.at ?? null;
  if (!lastMoveAt) return false;
  // WHAT COUNTS AS A WARM EPISODE — the same episode population every other
  // query in this file derives from (`findPersonsWithFreshEpisodes`,
  // `deriveRelEventsForPerson`, the self-layer passes): FINALIZED
  // (`provisional = false`), DYADIC (`group_id is null`) and CURRENT
  // (`superseded_by is null`). This query alone had none of the three, and
  // each omission pushed the count the SAME direction — up — so the stance
  // lapsed EARLY: a provisional episode is written eagerly and may never be
  // finalized, a group episode is not this dyad showing up warm at all, and a
  // superseded episode is one whose successor is also being counted, i.e. one
  // evening of contact counted twice. `RUPTURE_STANCE_LAPSE_WARM_EPISODES` is
  // 8 and a provisional row exists for essentially every episode before it
  // finalizes, so the practical error was close to a factor of two on the one
  // condition that decides she has stopped holding a fight open.
  //
  // Direction matters more than size here: a stance that lapses too early is
  // a person who stops being hurt because time passed in the DATABASE, which
  // is the failure `rejected.md#rupture-never-closes`'s reversal condition
  // ("a lapsing stance makes ruptures feel unreal") names.
  const warmRows = await q(
    `select count(*)::int as c from vy_episode e
      where e.person_id = $1 and e.started_at > $2::timestamptz and e.started_at < $3::timestamptz
        and e.provisional = false and e.group_id is null and e.superseded_by is null
      ${agentScopePredicate("e", { agentId: "$4" })}`,
    [person, lastMoveAt, beforeTs, agentId],
  ).catch(() => []);
  const warmEpisodesSince = Number(warmRows[0]?.c ?? 0);
  return ruptureStance({ ruptureOpen, repairState, lastMoveAt, warmEpisodesSince }) === "settled";
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
async function fetchFreshEpisodesForPerson(person, limitN = TRUST_REPAIR_MAX_EPISODES, agentId = MEERA_AGENT_ID) {
  return q(
    `select e.id, e.log_from, e.log_to, e.started_at, e.summary, e.affect_tags, e.importance from vy_episode e
      where e.person_id = $1 and e.provisional = false and e.group_id is null
        and e.channel is distinct from '${WATCH_CHANNEL}' -- WATCH CONTRACT
        and e.created_at > now() - interval '${RELDERIVE_LOOKBACK_H} hours'
        ${agentScopePredicate("e", { agentId: "$3" })}
      order by e.started_at asc limit $2`,
    [person, limitN, agentId],
  ).catch(() => []);
}

/** A person's broader recent history for pattern-finding (behavioral
 *  regularities need more than one day's evidence) — GROUP GUARD applied,
 *  superseded episodes excluded (a compacted/replaced summary is not
 *  citable ground truth). */
async function fetchHistoryEpisodesForPerson(person, { days = PATTERN_LOOKBACK_DAYS, limitN = PATTERN_MAX_EPISODES, agentId = MEERA_AGENT_ID } = {}) {
  return q(
    `select e.id, e.log_from, e.log_to, e.started_at, e.summary, e.affect_tags, e.importance from vy_episode e
      where e.person_id = $1 and e.provisional = false and e.group_id is null and e.superseded_by is null
        and e.channel is distinct from '${WATCH_CHANNEL}' -- WATCH CONTRACT
        and e.started_at > now() - interval '${days} days'
        ${agentScopePredicate("e", { agentId: "$3" })}
      order by e.started_at asc limit $2`,
    [person, limitN, agentId],
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

// ── THE SAME EVIDENCE MAY NOT MOVE TRUST TWICE (WS-JUDGEWORK, 2026-08-23) ──
//
// This writer was designed against a NIGHTLY cadence. The only mechanism that
// actually runs it today is the HOURLY sweep (docs/CONSOLIDATION.md: "the only
// live mechanism"), and `fetchFreshEpisodesForPerson` looks back 30 hours — so
// the same person's same finalized episodes are handed to the same prompt
// repeatedly, and a model that read a real trust move off them once reads it
// again every time. `clampTrustDelta` bounds the VALUE (±0.05/day) but not the
// ROW COUNT: the arithmetic stayed honest while `vy_rel_event` filled with
// near-zero-delta trust rows all citing the identical episodes.
//
// The rule is this file's own citation law applied to re-derivation: a trust
// move must cite at least one episode that did not already move trust. Not a
// timestamp cooldown — a cooldown says "too soon", which is a guess about
// cadence; this says "nothing new happened", which is a statement about
// evidence and is the only version that stays true if the cadence changes
// again. Pure and exported so the precision fixtures drive the shipping rule.
export function trustEvidenceIsNew(priorCitations, citations) {
  const have = new Set((priorCitations ?? []).map(Number));
  return (citations ?? []).some((c) => !have.has(Number(c)));
}

/** ── THE TRUST/REPAIR ACCEPTANCE LAYER, EXTRACTED PURE ─────────────────────
 *
 *  Everything between "the model answered" and "a row is written" — the
 *  state-machine move, the writer-window citation mapping, the note choice,
 *  the rate limiter and the new-evidence rule — with no database, no clock
 *  the caller cannot set, and no LLM. Same reasoning `phraseCandidates`
 *  states for itself: the precision fixtures must drive the SHIPPING logic
 *  rather than a restatement of it, and before this extraction the only
 *  testable pieces were the two mirrored primitives, never their composition.
 *
 *  `state` is `{ trust, ruptureOpen, repairState }` as read from
 *  `vy_rel_state` (absent row = the schema defaults, matching relstate.ts's
 *  `initialRelState()`). Returns the rows to write plus a REASON for every
 *  refusal — a signal dropped silently is indistinguishable from one that was
 *  never proposed, which is how a writer that produces nothing looks healthy.
 */
export function acceptTrustRepair(parsed, episodes, state = {}, opts = {}) {
  const { lastTrustMoveAt = null, priorTrustCitations = [], stanceLapsed = false, now = new Date() } = opts;
  const out = { ruptureRepair: null, trust: null, rejected: [] };
  const ruptureOpen = Boolean(state.ruptureOpen);
  const repairState = state.repairState ?? "none";
  const currentTrust = Number.isFinite(Number(state.trust)) ? Number(state.trust) : 0.3;

  // ── rupture/repair: one state-machine move at most, mirrored exactly ──
  const conflictSignal = Boolean(parsed?.rupture?.present);
  const repairSignal = Boolean(parsed?.repair_signal?.present);
  if (conflictSignal || repairSignal) {
    const move = ruptureRepairShift({ ruptureOpen, repairState }, conflictSignal, repairSignal, stanceLapsed);
    if (!move) {
      out.rejected.push({ dim: "rupture/repair", reason: "state machine proposes no move from this state" });
    } else {
      const citeSource =
        move.dim === "rupture" || move.direction === "regress" ? parsed?.rupture?.citations : parsed?.repair_signal?.citations;
      const citations = mapEpisodeCitations(citeSource, episodes);
      if (!citations.length) {
        out.rejected.push({ dim: move.dim, reason: "no proposed citation survives the writer window" });
      } else {
        const note = move.dim === "rupture" ? parsed?.rupture?.note : parsed?.repair_signal?.note ?? parsed?.rupture?.note;
        out.ruptureRepair = {
          dim: move.dim,
          fromV: move.dim === "rupture" ? (ruptureOpen ? "open" : "closed") : repairState,
          toV: move.dim === "rupture" ? "open" : move.repairState,
          direction: move.direction,
          note: telegraphic(note || move.note, 160),
          citations,
          ruptureOpen: move.ruptureOpen,
          repairState: move.repairState,
        };
      }
    }
  }

  // ── trust: independent scalar dim, rate-limited by clampTrustDelta ──
  if (parsed?.trust_move?.present) {
    const citations = mapEpisodeCitations(parsed.trust_move.citations, episodes);
    if (!citations.length) {
      out.rejected.push({ dim: "trust", reason: "no proposed citation survives the writer window" });
    } else if (!trustEvidenceIsNew(priorTrustCitations, citations)) {
      out.rejected.push({ dim: "trust", reason: "every cited episode already moved trust — the evidence is not new" });
    } else {
      const sign = parsed.trust_move.direction === "decrease" ? -1 : 1;
      const move = moveTrust(currentTrust, sign * TRUST_STEP, lastTrustMoveAt, now);
      if (move.delta === 0) {
        out.rejected.push({ dim: "trust", reason: "rate limit or 0..1 ceiling leaves no movement" });
      } else {
        out.trust = {
          fromV: currentTrust.toFixed(3),
          toV: move.next.toFixed(3),
          direction: move.direction,
          note: telegraphic(parsed.trust_move.note, 160),
          citations,
          next: move.next,
        };
      }
    }
  }
  return out;
}

/** One person's trust/rupture/repair pass: extract, hand the model's answer
 *  to `acceptTrustRepair` (the whole decision, pure), write what it accepts.
 *  AT MOST one rupture/repair event and one trust event per run (the state
 *  machine itself only ever proposes one rupture/repair move at a time).
 *  Returns a per-person report for the run summary. */
async function deriveTrustRepairForPerson(person, { dryRun = false, agentId = MEERA_AGENT_ID } = {}) {
  const rep = { person, episodes_scanned: 0, trust_moved: false, rupture_or_repair_moved: false, rejected: [] };
  const episodes = await fetchFreshEpisodesForPerson(person, TRUST_REPAIR_MAX_EPISODES, agentId);
  rep.episodes_scanned = episodes.length;
  if (!episodes.length) return rep;

  const raw = await llm([{ role: "user", content: trustRepairPrompt(renderEpisodeBatch(episodes)) }], 500);
  if (!raw) return rep; // a failed derivation is a late pass, never a wrong write
  const parsed = parseJsonLoose(raw);
  if (!parsed) return rep;

  const stateRows = await q(
    `select r.trust, r.rupture_open, r.repair_state from vy_rel_state r where r.person_id = $1
      ${agentScopePredicate("r", { agentId: "$2" })}`,
    [person, agentId],
  ).catch(() => []);
  const currentTrust = stateRows[0] ? Number(stateRows[0].trust) : 0.3;
  const ruptureOpen = Boolean(stateRows[0]?.rupture_open ?? false);
  const repairState = stateRows[0]?.repair_state ?? "none";
  const inputFrom = Math.min(...episodes.map((e) => e.log_from ?? Infinity).filter(Number.isFinite));
  const inputTo = Math.max(...episodes.map((e) => e.log_to ?? -Infinity).filter(Number.isFinite));
  let wrote = [];

  // record-vs-stance split (rejected.md `rupture-never-closes`): lets a fresh
  // conflict re-open a rupture whose repair_state got stuck at "open" forever
  // (no repair signal ever arrived) once the STANCE has already lapsed by
  // time/warm-interaction — see ruptureRepairShift's own comment on the
  // branch this feeds. Queried only when a conflict was actually proposed.
  const stanceLapsed = parsed?.rupture?.present
    ? await ruptureStanceLapsedFor(person, agentId, ruptureOpen, repairState, episodes[0].started_at)
    : false;
  // The last trust event's TIMESTAMP feeds the rate limiter; its CITATIONS
  // feed the new-evidence rule above. One row, both jobs, one query.
  const lastTrustRows = parsed?.trust_move?.present
    ? await q(
        `select e.at, e.citations from vy_rel_event e where e.person_id = $1 and e.dim = 'trust'
          ${agentScopePredicate("e", { agentId: "$2" })}
          order by e.at desc limit 1`,
        [person, agentId],
      ).catch(() => [])
    : [];

  const decision = acceptTrustRepair(
    parsed,
    episodes,
    { trust: currentTrust, ruptureOpen, repairState },
    {
      lastTrustMoveAt: lastTrustRows[0]?.at ?? null,
      priorTrustCitations: lastTrustRows[0]?.citations ?? [],
      stanceLapsed,
    },
  );
  rep.rejected = decision.rejected;

  if (decision.ruptureRepair) {
    const m = decision.ruptureRepair;
    rep.rupture_or_repair_moved = true;
    if (!dryRun) {
      await q(
        `insert into vy_rel_event (agent_id, person_id, dim, from_v, to_v, direction, note, citations)
         values (${agentValue("$8")},$1,$2,$3,$4,$5,$6,$7)`,
        [person, m.dim, m.fromV, m.toV, m.direction, m.note, m.citations, agentId],
      ).catch(() => {});
      // MIGRATED ARBITER (010 precondition)
      await q(
        `insert into vy_rel_state (agent_id, person_id, rupture_open, repair_state)
         values (${agentValue("$4")},$1,$2,$3)
         on conflict (agent_id, person_id) do update set rupture_open = $2, repair_state = $3`,
        [person, m.ruptureOpen, m.repairState, agentId],
      ).catch(() => {});
      wrote.push({ table: "vy_rel_event", dim: m.dim });
    }
  }

  if (decision.trust) {
    const t = decision.trust;
    rep.trust_moved = true;
    if (!dryRun) {
      await q(
        `insert into vy_rel_event (agent_id, person_id, dim, from_v, to_v, direction, note, citations)
         values (${agentValue("$7")},$1,'trust',$2,$3,$4,$5,$6)`,
        [person, t.fromV, t.toV, t.direction, t.note, t.citations, agentId],
      ).catch(() => {});
      // MIGRATED ARBITER (010 precondition)
      await q(
        `insert into vy_rel_state (agent_id, person_id, trust) values (${agentValue("$3")},$1,$2)
         on conflict (agent_id, person_id) do update set trust = $2`,
        [person, t.next, agentId],
      ).catch(() => {});
      wrote.push({ table: "vy_rel_event", dim: "trust" });
    }
  }

  if (!dryRun && wrote.length && Number.isFinite(inputFrom) && Number.isFinite(inputTo)) {
    await q(
      `insert into vy_derivation (agent_id, person_id, model, prompt_hash, input_from, input_to, wrote)
       values (${agentValue("$6")},$1,$2,'trust_repair',$3,$4,$5::jsonb)`,
      [person, AZ_KEY ? EXTRACT_MODEL_AZURE : EXTRACT_MODEL_FALLBACK, inputFrom, inputTo, JSON.stringify(wrote), agentId],
    ).catch(() => {});
  }
  return rep;
}

/** The orchestrator — same person cursor (findPersonsWithFreshEpisodes) as
 *  runRelEventDerivation, run independently so a partial honorific pass
 *  never blocks this one. */
export async function runTrustRepairDerivation({ limit = DEFAULT_PERSON_LIMIT, dryRun = false, onlyPerson = null, agentId = MEERA_AGENT_ID } = {}) {
  const t0 = Date.now();
  const persons = onlyPerson ? [onlyPerson] : await findPersonsWithFreshEpisodes(limit, agentId);
  const reports = [];
  for (const person of persons) reports.push(await deriveTrustRepairForPerson(person, { dryRun, agentId }));
  return {
    ok: true,
    persons_processed: reports.length,
    trust_events_written: reports.filter((r) => r.trust_moved).length,
    rupture_repair_events_written: reports.filter((r) => r.rupture_or_repair_moved).length,
    // A refusal is reported, never silent: a run that wrote nothing because
    // the model proposed nothing and a run that wrote nothing because every
    // proposal failed the citation law look identical without this line, and
    // only one of them is the pipeline working.
    signals_refused: reports.reduce((s, r) => s + (r.rejected?.length ?? 0), 0),
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

// ── PATTERN TEXT IS PROMPT TEXT (WS-JUDGEWORK, 2026-08-23) ────────────────
//
// `if_shape` and `then_note` are rendered VERBATIM into T4 by
// relstate.ts's `renderDyadicActive` (`${p.if_shape} -> ${p.then_note}`).
// That makes them the exact thing CLAUDE.md's first law is about: "anything
// sentence-shaped in a prompt gets recited". The prompt above asks for
// "<=14 words, no terminal punctuation, never her own first-person voice"
// and, before this, NOTHING enforced any of it — `telegraphic()` caps
// CHARACTERS (120) and strips terminal punctuation, which lets a 25-word
// piece of prose through intact.
//
// Write time is the only gate that exists for this string. `renderDyadicActive`
// runs `lintBlock` over its output, but `finish()` REPORTS violations and
// emits the lines anyway — an over-long pattern note reaches the model either
// way. So a failing string is refused here rather than truncated: a truncated
// regularity is a corrupted claim, and the cost of refusing is one night.
//
// Mirrors src/engine/shapelint.ts's `lintLine` (MAX_WORDS,
// FIRST_PERSON_LINE_INITIAL_RE) — same mirror-don't-import resolution, and
// the same reason, as clampTrustDelta/moveTrust above: this script runs bare
// under Node with no bundler. The eval drives the REAL `lintLine` against the
// same strings, so a drift between the two is a failing gate rather than a
// discovery months later.
const PATTERN_MAX_WORDS = 14;
const PATTERN_FIRST_PERSON_RE = /^(i\b|i'm\b|i've\b|main\b|mai\b|mujhe\b|meri\b|mera\b|maine\b)/i;
export function patternTextRejection(s) {
  const t = String(s || "").trim();
  if (!t) return "empty";
  const n = wordCount(t);
  if (n > PATTERN_MAX_WORDS) return `too long: ${n} words (cap ${PATTERN_MAX_WORDS})`;
  if (PATTERN_FIRST_PERSON_RE.test(t)) return "first-person voice, line-initial — a line she would recite";
  return "";
}

// ── SUPPORT IS COUNTED FROM EPISODES, NOT ASSUMED (WS-JUDGEWORK, 2026-08-23) ──
//
// THE DEFECT THIS CLOSES, and it made every pattern this file has ever written
// unreachable: `vy_pattern.prompt_eligible` is a Postgres GENERATED column,
// `support_count >= 3 and distinct_days >= 2` (db/schema.sql:434). Both
// counters default to 0. This writer set neither, and `reinforcePattern`
// (relstate.ts) has no caller anywhere in api/ — so every row it inserted sat
// at support 0 / days 0 forever. `api/memory.js`'s rel-bundle query filters
// `prompt_eligible = true`, and `renderDyadicActive` filters it again. T4
// `dyadic.active` therefore rendered ZERO BYTES for every user on every lane,
// no matter how many patterns the nightly pass wrote — `spine-that-ran-one-
// step-of-six` in miniature: the writer ran, the run report counted rows, and
// the render was empty by construction.
//
// The lane-parity gate could not see this: its fixture supplies
// `prompt_eligible: true` directly, so it proves the LANE carries T4 and says
// nothing about whether the WRITER can ever produce a row the lane accepts.
//
// Support is derived, never asserted: one unit per CITED EPISODE THAT EXISTS
// IN THE NUMBERED BATCH, and `distinct_days` from those same episodes' own
// `started_at`. Every unit traces to one source row — the same discipline the
// citation law puts on the claim itself, applied to its weight.
export function patternSupport(citations, episodes) {
  const byId = new Map(episodes.map((e) => [Number(e.id), e]));
  const days = new Set();
  let support = 0;
  for (const c of citations ?? []) {
    const e = byId.get(Number(c));
    if (!e) continue; // an episode outside the batch cannot support anything
    support++;
    const d = new Date(e.started_at);
    if (Number.isFinite(d.getTime())) days.add(d.toISOString().slice(0, 10));
  }
  return { support_count: support, distinct_days: days.size };
}

/** A re-proposal of a regularity already on record. Before this it was
 *  counted as `deduped` and dropped — which is why the ladder
 *  `src/engine/observation.ts`'s header describes ("day 1 write + day-2 +
 *  day-3 recurrence is the earliest prompt_eligible can go true") could never
 *  actually be climbed: the only step that raises support was never taken.
 *
 *  A re-proposal only counts when it cites an episode the stored row does
 *  NOT already cite. Same rule as `trustEvidenceIsNew` and for the same
 *  reason: under an HOURLY sweep the identical batch is re-scanned within the
 *  lookback window, and a bump on repeated evidence would let one evening's
 *  conversation promote a pattern to prompt-eligible by itself. */
export function patternReinforcement(existingRow, proposedCitations) {
  const have = new Set((existingRow?.citations ?? []).map(Number));
  const fresh = [...new Set((proposedCitations ?? []).map(Number))].filter((c) => !have.has(c));
  const merged = [...have, ...fresh].sort((a, b) => a - b);
  // No counts are returned. `support_count` is incremented by `fresh.length`
  // and `distinct_days` is RECOMPUTED by Postgres over `merged` straight from
  // vy_episode — the stored citations may point at episodes outside this
  // run's 60-day batch, so a JS count computed here would be an undercount
  // wearing an authoritative name.
  return { patternId: existingRow?.id ?? null, fresh, merged };
}

/** ── THE PATTERN ACCEPTANCE LAYER, EXTRACTED PURE ──────────────────────────
 *
 *  Model answer + numbered batch + this person's existing patterns -> the
 *  exact set of inserts and reinforcements, with a reason attached to every
 *  refusal. No database, no LLM. Same reasoning as `acceptTrustRepair` and
 *  `phraseCandidates`: the precision fixtures drive the shipping decision.
 */
export function acceptPatternProposals(parsed, episodes, existingRows = []) {
  const dedupeKey = (m, s) => `${m}::${String(s).toLowerCase().trim()}`;
  const byKey = new Map(existingRows.map((p) => [dedupeKey(p.moment, p.if_shape), p]));
  const out = { writes: [], reinforcements: [], rejected: [], deduped: 0 };
  const proposals = Array.isArray(parsed?.patterns) ? parsed.patterns.slice(0, PATTERN_CAP_PER_NIGHT) : [];
  out.proposed = proposals.length;

  for (const p of proposals) {
    const moment = PATTERN_MOMENTS.includes(p?.moment) ? p.moment : null;
    const ifShape = telegraphic(p?.if_shape, 120);
    const thenNote = telegraphic(p?.then_note, 120);
    const selfInRelation = telegraphic(p?.self_in_relation, 120);
    const citations = mapEpisodeCitations(p?.citations, episodes);
    if (!moment) {
      out.rejected.push({ reason: `moment outside the closed set: ${JSON.stringify(p?.moment)}` });
      continue;
    }
    if (!ifShape || !thenNote) {
      out.rejected.push({ moment, reason: "if_shape or then_note is empty" });
      continue;
    }
    if (citations.length < 2) {
      out.rejected.push({ moment, reason: `one instance is an anecdote: ${citations.length} citation(s) survived the writer window` });
      continue;
    }
    // Every string that reaches T4 verbatim, linted before it is stored.
    const shape = [
      ["if_shape", ifShape],
      ["then_note", thenNote],
      ["self_in_relation", selfInRelation],
    ]
      .filter(([, v]) => v) // self_in_relation is optional (schema default '')
      .map(([k, v]) => [k, patternTextRejection(v)])
      .find(([, why]) => why);
    if (shape) {
      out.rejected.push({ moment, reason: `${shape[0]}: ${shape[1]}` });
      continue;
    }

    const key = dedupeKey(moment, ifShape);
    const prior = byKey.get(key);
    if (prior) {
      const r = patternReinforcement(prior, citations);
      if (!r.fresh.length) {
        out.deduped++;
        continue;
      }
      out.reinforcements.push({ moment, if_shape: ifShape, ...r });
      // the merged set is now on record for any later proposal in this batch
      byKey.set(key, { ...prior, citations: r.merged });
      continue;
    }
    const support = patternSupport(citations, episodes);
    out.writes.push({ moment, if_shape: ifShape, then_note: thenNote, self_in_relation: selfInRelation, citations, ...support });
    byKey.set(key, { id: null, moment, if_shape: ifShape, citations });
  }
  return out;
}

/** One person's pattern-extraction pass. New regularities are inserted with
 *  their support counted from the cited episodes; a regularity already on
 *  record is REINFORCED when it recurs in an episode it does not already
 *  cite, which is the only path to `prompt_eligible` and therefore to T4. */
async function extractPatternsForPerson(person, { dryRun = false, agentId = MEERA_AGENT_ID } = {}) {
  const rep = { person, episodes_scanned: 0, proposed: 0, written: 0, reinforced: 0, rejected: 0, deduped: 0, reasons: [] };
  const episodes = await fetchHistoryEpisodesForPerson(person, { agentId });
  rep.episodes_scanned = episodes.length;
  if (episodes.length < PATTERN_MIN_EPISODES_TO_TRY) return rep;

  // The dedupe read is a RETRIEVAL that decides a write: unscoped, another
  // agent's pattern would silently suppress this agent's identical finding,
  // which is a cross-agent read wearing a write's clothes. `id` and
  // `citations` are selected because a re-proposal is now a REINFORCEMENT,
  // and both are needed to decide whether it carries new evidence.
  const existing = await q(
    `select p.id, p.moment, p.if_shape, p.citations from vy_pattern p
      where p.person_id = $1 and p.t_invalid is null
      ${agentScopePredicate("p", { agentId: "$2" })}`,
    [person, agentId],
  ).catch(() => []);

  const raw = await llm([{ role: "user", content: patternPrompt(renderEpisodeBatch(episodes)) }], 700);
  if (!raw) return rep;
  const parsed = parseJsonLoose(raw);
  const decision = acceptPatternProposals(parsed, episodes, existing);
  rep.proposed = decision.proposed;
  rep.rejected = decision.rejected.length;
  rep.deduped = decision.deduped;
  rep.reasons = decision.rejected.map((r) => r.reason);

  for (const w of decision.writes) {
    if (dryRun) {
      rep.written++;
      continue;
    }
    try {
      await q(
        `insert into vy_pattern (agent_id, person_id, moment, if_shape, then_note, self_in_relation,
                                 citations, support_count, distinct_days)
         values (${agentValue("$9")},$1,$2,$3,$4,$5,$6,$7,$8)`,
        [person, w.moment, w.if_shape, w.then_note, w.self_in_relation, w.citations, w.support_count, w.distinct_days, agentId],
      );
      rep.written++;
    } catch {
      rep.rejected++;
    }
  }

  for (const r of decision.reinforcements) {
    if (dryRun) {
      rep.reinforced++;
      continue;
    }
    try {
      // `distinct_days` is recomputed by Postgres over the MERGED citation
      // set, straight from vy_episode — never incremented, so a re-run that
      // somehow repeated a citation cannot inflate it. `prompt_eligible` is
      // the generated column and is never assigned here (relstate.ts's
      // reinforcePattern says the same about itself, and is mirrored rather
      // than imported for this file's usual bundler reason).
      await q(
        `update vy_pattern p
            set citations = $2::bigint[],
                support_count = p.support_count + $3,
                distinct_days = (select count(distinct date_trunc('day', e.started_at))::int
                                   from vy_episode e where e.id = any($2::bigint[])),
                last_used = now()
          where p.id = $1 and p.person_id = $4
          ${agentScopePredicate("p", { agentId: "$5" })}`,
        [r.patternId, r.merged, r.fresh.length, person, agentId],
      );
      rep.reinforced++;
    } catch {
      rep.rejected++;
    }
  }
  return rep;
}

export async function runPatternExtraction({ limit = DEFAULT_PERSON_LIMIT, dryRun = false, onlyPerson = null, agentId = MEERA_AGENT_ID } = {}) {
  const t0 = Date.now();
  const persons = onlyPerson ? [onlyPerson] : await findPersonsWithFreshEpisodes(limit, agentId);
  const reports = [];
  for (const person of persons) reports.push(await extractPatternsForPerson(person, { dryRun, agentId }));
  return {
    ok: true,
    persons_processed: reports.length,
    patterns_written: reports.reduce((s, r) => s + r.written, 0),
    // the number that decides whether T4 ever renders: an insert alone can
    // never reach support_count >= 3
    patterns_reinforced: reports.reduce((s, r) => s + r.reinforced, 0),
    patterns_deduped: reports.reduce((s, r) => s + r.deduped, 0),
    patterns_refused: reports.reduce((s, r) => s + r.rejected, 0),
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

// ── PHRASE DISTINCTIVENESS (WS-SPINE, 2026-08-23) ────────────────────────
//
// WHY THIS EXISTS, and it is a live coordination story rather than a
// hypothetical: WS-RECALL changed `RECALL_STOP` — half of this scan's
// stoplist — REMOVING `kaam` and `baat` because they are content-bearing.
// That is unarguably right for RECALL, whose job is to MATCH on what someone
// said. It is wrong for PHRASE CAPTURE, whose job is the opposite: to find
// the one string nobody else would say. Two callers, one list, opposite
// definitions of "worth keeping" — so this file needs its own.
//
// The exposure was real and wider than the two words. `RECALL_STOP` and
// `HINDI_MARKER_WORDS` between them contain NEITHER the bare postpositions
// (`ka ki ke ko se na to hi`) NOR everyday content nouns, and the old rule
// skipped a gram only when EVERY token was a stopword. So "kaam ka",
// "baat hi", "ghar se", "office ka kaam" all survived, and any of them said
// on three different days became a COINED PHRASE — a thing she then says back
// as something they made up together. That is `recited-prompt`'s worst case
// with a database behind it: not a line she was handed, a line she claims to
// remember them inventing.
//
// THE RULE: a coined phrase must contain at least ONE token that is not a
// stopword, not a Hindi function marker, and not everyday vocabulary. Not
// "not all of them" — AT LEAST ONE, which is the difference between "kaam ka
// pressure" (nothing distinctive; everyone says this) and "chai pe scene set"
// (`scene`, `set` — nobody else phrases it that way).
//
// Authored and dated, same convention as CORPUS_COMMON_PHRASES and
// HINDI_MARKER_WORDS. Deliberately NOT derived at runtime: a frequency cut
// computed from the live corpus would shrink as the corpus grows and would
// re-measure this person's own phrase back at itself on a slow day.
export const PHRASE_PLAIN_VOCAB = new Set([
  // bare postpositions and particles — in neither existing list
  "ka", "ki", "ke", "ko", "se", "me", "mein", "pe", "par", "tak", "hi", "to",
  "na", "ye", "yeh", "wo", "woh", "is", "us", "kuch", "sab", "phir", "ab",
  "aur", "ya", "agar", "lekin", "par", "toh",
  // everyday content nouns that recur in EVERY dyad — content-bearing for
  // recall (which is why WS-RECALL took two of them out of RECALL_STOP) and
  // useless as evidence that a phrase is theirs
  "kaam", "baat", "ghar", "khana", "khaana", "office", "time", "din", "raat",
  "subah", "shaam", "phone", "paisa", "paise", "log", "saal", "mahina",
  "hafta", "aaj", "kal", "parso", "pani", "sona", "soya", "utha", "gaya",
  "bahut", "thoda", "thodi", "zyada", "jaldi", "der", "achha", "acha",
  "problem", "pressure", "meeting", "call", "message", "reply",
  "khatam", "shuru", "start", "band", "busy", "free", "late", "ready",
]);
// COVERAGE IS DELIBERATELY NOT EXHAUSTIVE, and pretending otherwise would be
// the failure this note prevents. It is a small reviewed table, matched
// deterministically — the same posture FESTIVAL_CALENDAR states for itself
// ("a two-person team cannot author every regional calendar in one pass;
// extend by adding rows, never by inferring one at runtime"). A plain phrase
// this list misses becomes a captured phrase, which is why capture is ALSO
// capped at one per person per night and gated on >=3 distinct days: the
// list is the precision layer, not the only one. When a bad capture is found
// in production, the repair is a row here plus the phrase deleted — not a
// runtime frequency cut, which would shrink as the corpus grows.

/** True when the gram carries at least one token nobody else's dyad would
 *  supply. Pure and exported — the quality eval drives THIS, not a copy. */
export function phraseIsDistinctive(gram) {
  return tokenizePhrase(gram).some(
    (t) => !RECALL_STOP.has(t) && !HINDI_MARKER_WORDS.includes(t) && !PHRASE_PLAIN_VOCAB.has(t),
  );
}

/**
 * The n-gram scan itself, extracted PURE so the precision fixtures drive the
 * shipping logic rather than a restatement of it. Rows are `{content, at,
 * episode_id}`, newest-first or not — order does not matter, only distinct
 * days do.
 *
 * `existingPhrases` is matched SUBSTRING-AWARE, not by equality: the night
 * after "chai pe scene set karo" is captured must not then capture "chai pe
 * scene set" or "pe scene set karo aaj" — near-duplicate variants of the SAME
 * stored utterance. (Found live in WS-DEPTH's own fixture test: the
 * exact-match version kept capturing one-word-shorter substrings of what it
 * had just written, night after night.)
 */
export function phraseCandidates(rows, existingPhrases = new Set()) {
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
        // THE DISTINCTIVENESS BAR. Frequency alone is not evidence that a
        // phrase is theirs — everyday vocabulary is frequent BY DEFINITION,
        // so a days-threshold on its own selects FOR it.
        if (!phraseIsDistinctive(gram)) continue;
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
  return [...ngrams.entries()]
    .filter(([, e]) => e.days.size >= PHRASE_MIN_DISTINCT_DAYS)
    .sort((a, b) => b[1].days.size - a[1].days.size || b[0].length - a[0].length);
}

/** One person's deterministic phrase-capture pass: scan their own turns,
 *  count 2-5 word n-grams by distinct day, filter the stoplists, and write
 *  AT MOST ONE new phrase — the most-recurring surviving candidate — citing
 *  the episode it was FIRST said in (vy_phrase.origin_episode is a single
 *  bigint by schema design, "the coining episode", not a citations array;
 *  the >=3-distinct-day recurrence requirement is the evidence bar, this is
 *  which one anchor episode gets stored per that column's own shape). */
async function capturePhrasesForPerson(person, { dryRun = false, agentId = MEERA_AGENT_ID } = {}) {
  const rep = { person, rows_scanned: 0, candidates: 0, written: 0 };
  const devices = await q(`select device_id from vy_person_device where person_id = $1`, [person]).catch(() => []);
  const deviceIds = devices.length ? devices.map((d) => d.device_id) : [person];
  // WATCH CONTRACT: a captured phrase is the highest-consequence row in this
  // file — she SAYS it back (T6 renderWeCallbacks). A recurring string of OCR
  // text ("continue watching", a UI label, a channel name) would recur across
  // days exactly the way a real shared phrase does, pass every stoplist, and
  // come out of her mouth as something they supposedly coined together. This
  // is the one place a watch row could do the most damage and the one place
  // the >=3-distinct-days bar makes screen furniture MORE likely to qualify,
  // not less.
  const rows = stripWatchRows(
    await q(
      `select l.content, l.at, l.episode_id, l.channel from meera_log l
      where l.device_id = any($1::uuid[]) and l.role = 'me' and l.group_id is null
        and l.episode_id is not null
        ${agentScopePredicate("l", { agentId: "$3" })}
        ${WATCH_EXCLUDE_SQL}
      order by l.at desc limit $2`,
      [deviceIds, PHRASE_SCAN_LIMIT, agentId],
    ).catch(() => []),
  );
  rep.rows_scanned = rows.length;
  if (!rows.length) return rep;

  const existing = await q(
    `select lower(v.phrase) as p from vy_phrase v where v.person_id = $1
      ${agentScopePredicate("v", { agentId: "$2" })}`,
    [person, agentId],
  ).catch(() => []);
  const existingPhrases = new Set(existing.map((r) => r.p));
  const candidates = phraseCandidates(rows, existingPhrases);
  rep.candidates = candidates.length;
  if (!candidates.length) return rep;

  const [gram, evidence] = candidates[0];
  const originEpisode = [...evidence.episodeAt.entries()].sort((a, b) => a[1] - b[1])[0][0];
  rep.written = 1;
  if (dryRun) return rep;
  // The arbiter here is vy_phrase's own (person_id, lower(phrase)) unique
  // index, which 009 did not touch — NOT one of the ten sites 010's
  // precondition names, and not dropped by it. Left as-is deliberately: this
  // is a second-agent CORRECTNESS question (two agents may legitimately coin
  // the same phrase with the same person) rather than a 010 blocker, and the
  // index is not mine to widen. Named in the report as an interface ticket
  // for whoever owns the schema.
  await q(
    `insert into vy_phrase (agent_id, person_id, phrase, origin_episode, coined_at, last_used, uses)
     values (${agentValue("$5")},$1,$2,$3, now(), now(), $4)
     on conflict (agent_id, person_id, lower(phrase)) do nothing`,
    [person, gram, originEpisode, evidence.days.size, agentId],
  ).catch(() => {});
  return rep;
}

export async function runPhraseCapture({ limit = DEFAULT_PERSON_LIMIT, dryRun = false, onlyPerson = null, agentId = MEERA_AGENT_ID } = {}) {
  const t0 = Date.now();
  const persons = onlyPerson ? [onlyPerson] : await findPersonsWithFreshEpisodes(limit, agentId);
  const reports = [];
  for (const person of persons) reports.push(await capturePhrasesForPerson(person, { dryRun, agentId }));
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
async function backfillWeParticipation({ dryRun = false, onlyPerson = null, agentId = MEERA_AGENT_ID } = {}) {
  // The one query in this file with NO person cursor when onlyPerson is null —
  // it sweeps every row in the table. That is exactly the shape a missing
  // agent scope hurts most, so the clause is not optional here: without it a
  // Meera-triggered backfill would rewrite another agent's episodes.
  //
  // Written as four COMPLETE statements rather than one shared `where` fragment
  // so that each one carries the predicate visibly in its own text. That is not
  // cosmetic: evals/agent/isolation.mjs's call-site arm reads these literals,
  // and a statement whose scoping lives behind an interpolated variable reads
  // to any reviewer — human or gate — exactly like a statement with no scoping
  // at all.
  const params = onlyPerson ? [WE_TOKEN_SQL, onlyPerson, agentId] : [WE_TOKEN_SQL, agentId];
  if (dryRun) {
    const rows = onlyPerson
      ? await q(
          `select count(*)::int as n from vy_episode e
            where e.participation = 'user' and e.summary ~* $1 and e.person_id = $2
            ${agentScopePredicate("e", { agentId: "$3" })}`,
          params,
        ).catch(() => [])
      : await q(
          `select count(*)::int as n from vy_episode e
            where e.participation = 'user' and e.summary ~* $1
            ${agentScopePredicate("e", { agentId: "$2" })}`,
          params,
        ).catch(() => []);
    return Number(rows[0]?.n ?? 0);
  }
  const rows = onlyPerson
    ? await q(
        `update vy_episode e set participation = 'we'
          where e.participation = 'user' and e.summary ~* $1 and e.person_id = $2
          ${agentScopePredicate("e", { agentId: "$3" })}
          returning e.id`,
        params,
      ).catch(() => [])
    : await q(
        `update vy_episode e set participation = 'we'
          where e.participation = 'user' and e.summary ~* $1
          ${agentScopePredicate("e", { agentId: "$2" })}
          returning e.id`,
        params,
      ).catch(() => []);
  return rows.length;
}

/** The run itself: pick eligible people, finalize each, halt on a runaway
 *  entailment refutation rate. */

// ─────────────────────────────────────────────────────────────────────────
// The self layer's nightly pass (Phase E2, docs/SPEC-SELF-LAYER.md).
//
// Chained AFTER phrase capture for the same reason phrase capture runs after
// pattern extraction: every one of these reads rows the earlier steps wrote,
// so running them earlier does not fail — it silently derives from yesterday.
//
// Posture matches the rest of the nightly chain: NEVER halts the job. A
// missed self-layer pass is late, never lost (texture is recomputed from a
// trailing window, an arc needs 42 days so one night is noise, and decay is
// idempotent by construction). Only the finalize pass's entailment refutation
// is allowed to halt, and that is deliberate — it is the citation law's only
// alarm.
//
// The engine arrives through api/_engine.gen.js, not a src/ import: this file
// is a plain-JS serverless function under the zero-imports-from-src rule, and
// hand-porting four derivers into JS would be the mirrored-persona failure
// serverEntry.ts exists to prevent, one level down. A missing bundle SKIPS
// the pass loudly rather than degrading to a hand-rolled approximation.
// ─────────────────────────────────────────────────────────────────────────
let _selfEngine;
let _selfEngineTried = false;
async function loadSelfEngine() {
  if (_selfEngineTried) return _selfEngine;
  _selfEngineTried = true;
  try {
    _selfEngine = await import("./_engine.gen.js");
  } catch (e) {
    console.error("[self] engine bundle missing — self-layer pass skipped:", e?.message || "import failed");
    _selfEngine = null;
  }
  return _selfEngine;
}

export async function runSelfLayer({ limit = DEFAULT_PERSON_LIMIT, dryRun = false, onlyPerson = null, agentId = MEERA_AGENT_ID } = {}) {
  const t0 = Date.now();
  const engine = await loadSelfEngine();
  if (!engine) return { ok: false, skipped: "engine-bundle-missing", ms: Date.now() - t0 };

  const persons = onlyPerson ? [onlyPerson] : await findPersonsWithFreshEpisodes(limit, agentId);
  let textures = 0;
  const textureErrors = [];
  for (const person of persons) {
    try {
      const row = await engine.deriveTexture(q, person, agentId);
      if (!dryRun) await engine.upsertTexture(q, row);
      textures++;
    } catch (e) {
      // per-person isolation: one malformed history must not cost the other
      // 24 people their pass. Collected and reported, never swallowed silently.
      textureErrors.push({ person, error: String(e?.message || e).slice(0, 160) });
    }
  }

  // The arc is AGENT-scoped, not person-scoped — she is one person across all
  // her relationships — so it runs exactly once per pass, not once per person.
  let arc = null;
  try {
    arc = await engine.deriveSelfArc(q, agentId, { dryRun });
  } catch (e) {
    arc = { error: String(e?.message || e).slice(0, 160) };
  }

  // Decay moves retrieval priority only. config/decay.json's own law: it can
  // never set t_invalid and never delete, so decay and honest-forget cannot
  // collide by construction.
  let decayed = 0;
  if (!dryRun) {
    try {
      decayed = await engine.decayObservations(q, agentId);
    } catch (e) {
      decayed = -1;
      console.error("[self] observation decay failed:", String(e?.message || e).slice(0, 160));
    }
  }

  return {
    ok: true,
    persons_processed: persons.length,
    textures_written: dryRun ? 0 : textures,
    texture_errors: textureErrors,
    arc,
    observations_decayed: decayed,
    ms: Date.now() - t0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// WS-SPINE P1-3 — THE markTold CALL SITE
//
// WHY THIS IS SERVER-SIDE, AND NOT A JUDGEMENT CALL: `markTold` requires the
// FINAL episode she told them in (life.ts: "told is an outcome, never an
// intent" — the INSERT's FROM clause is the episode, and it requires
// `provisional = false`). A final episode does not exist at the moment she
// speaks; this file mints it, up to a day later. So there is no client-side
// seam that COULD call markTold with a legal argument — the client would have
// to invent an episode id, which is precisely the intent-shaped write the
// function was built to make impossible. The seam is here or nowhere.
//
// PRECISION POSTURE: a false told-row is permanent and silent — she simply
// never tells them that beat, and nobody ever learns why. So the bar is two
// independent gates, cheapest first:
//   1. DETERMINISTIC PRE-GATE: at least LIFE_TOLD_MIN_TOKENS distinctive
//      tokens shared between the beat and one of HER OWN turns inside the
//      episode. No overlap, no LLM call, no cost — which is also what keeps
//      this affordable: on a normal night this pass makes ZERO model calls.
//   2. LLM CONFIRMATION, one YES/NO per surviving pair, capped per person.
// A beat that fails either gate stays untold, which is the recoverable
// direction: she tells it tomorrow.
const LIFE_TOLD_MIN_TOKENS = 2;
const LIFE_TOLD_MAX_CHECKS = 2; // model calls per person per run

/** Distinctive tokens of a beat: content words a shared-token overlap can
 *  actually mean something about. Reuses the two stoplists this file already
 *  has rather than authoring a third. Pure and exported for the eval. */
export function distinctiveTokens(text) {
  return [
    ...new Set(
      tokenizePhrase(text).filter(
        (t) => t.length >= 4 && !RECALL_STOP.has(t) && !HINDI_MARKER_WORDS.includes(t),
      ),
    ),
  ];
}

/** Gate 1, pure and exported. Returns the shared distinctive tokens. */
export function lifeToldOverlap(beat, herLines) {
  const want = new Set(distinctiveTokens(beat));
  if (want.size < LIFE_TOLD_MIN_TOKENS) return [];
  const hit = new Set();
  for (const line of herLines) {
    for (const t of tokenizePhrase(line)) if (want.has(t)) hit.add(t);
  }
  return [...hit];
}

async function deriveLifeToldForPerson(person, { dryRun = false, agentId = MEERA_AGENT_ID } = {}) {
  const rep = { person, beats_untold: 0, pairs_checked: 0, told: 0, errors: [] };
  const engine = await loadSelfEngine();
  if (!engine?.untoldFor || !engine?.markTold) {
    rep.errors.push("engine bundle missing untoldFor/markTold — life-told pass skipped, not approximated");
    return rep;
  }
  const beats = await engine.untoldFor(q, person, agentId, 20).catch(() => []);
  rep.beats_untold = beats.length;
  if (!beats.length) return rep;

  const episodes = await fetchFreshEpisodesForPerson(person, TRUST_REPAIR_MAX_EPISODES, agentId);
  if (!episodes.length) return rep;

  let checks = 0;
  for (const ep of episodes) {
    if (ep.log_from == null || ep.log_to == null) continue;
    // HER turns only: the beat is hers to tell, so evidence of the telling is
    // in her own lines, never in his. Watch-excluded like every other read.
    const herRows = stripWatchRows(
      await q(
        `select l.content, l.channel from meera_log l
          where l.device_id in (select device_id from vy_person_device where person_id = $1
                                union select $1::uuid)
            and l.role = 'her' and l.id between $2 and $3
            ${agentScopePredicate("l", { agentId: "$4" })}
            ${WATCH_EXCLUDE_SQL}`,
        [person, ep.log_from, ep.log_to, agentId],
      ).catch(() => []),
    );
    if (!herRows.length) continue;
    const herLines = herRows.map((r) => String(r.content || ""));
    for (const beat of beats) {
      if (checks >= LIFE_TOLD_MAX_CHECKS) break;
      const shared = lifeToldOverlap(beat.beat, herLines);
      if (shared.length < LIFE_TOLD_MIN_TOKENS) continue;
      checks++;
      rep.pairs_checked++;
      const verdict = await llm(
        [
          {
            role: "user",
            content: `Did the speaker actually TELL the listener this piece of her own news, in these lines? Reply with ONLY YES or NO. Say NO if the lines merely touch the same topic without her telling them the news itself.

HER NEWS: ${beat.beat}

HER LINES:
${herLines.slice(0, 30).join("\n")}`,
          },
        ],
        4,
      );
      if (!String(verdict || "").trim().toUpperCase().startsWith("YES")) continue;
      if (dryRun) {
        rep.told++;
        continue;
      }
      try {
        const out = await engine.markTold(q, agentId, beat.id, person, ep.id);
        if (out?.recorded && !out.already) rep.told++;
        else if (!out?.recorded) rep.errors.push(`beat ${beat.id}: ${out?.reason || "not recorded"}`);
      } catch (e) {
        rep.errors.push(`beat ${beat.id}: ${String(e?.message || e).slice(0, 140)}`);
      }
    }
    if (checks >= LIFE_TOLD_MAX_CHECKS) break;
  }
  return rep;
}

export async function runLifeTold({ limit = DEFAULT_PERSON_LIMIT, dryRun = false, onlyPerson = null, agentId = MEERA_AGENT_ID } = {}) {
  const t0 = Date.now();
  const persons = onlyPerson ? [onlyPerson] : await findPersonsWithFreshEpisodes(limit, agentId);
  const reports = [];
  for (const person of persons) reports.push(await deriveLifeToldForPerson(person, { dryRun, agentId }));
  return {
    ok: true,
    persons_processed: reports.length,
    told_written: reports.reduce((s, r) => s + r.told, 0),
    pairs_checked: reports.reduce((s, r) => s + r.pairs_checked, 0),
    ms: Date.now() - t0,
    reports,
  };
}

export async function runConsolidation({ limit = DEFAULT_PERSON_LIMIT, dryRun = false, onlyPerson = null, agentId = MEERA_AGENT_ID } = {}) {
  const t0 = Date.now();
  const weBackfilled = await backfillWeParticipation({ dryRun, onlyPerson, agentId });
  const persons = onlyPerson ? [onlyPerson] : await findEligiblePersons(limit, agentId);
  const reports = [];
  let totalAudited = 0;
  let totalRefuted = 0;
  let halted = false;

  let watchFinalized = 0;
  for (const person of persons) {
    // P2-2 first: cheap, deterministic, no model call, and it is what stops
    // this person re-pinning `findEligiblePersons` for the rest of time.
    watchFinalized += await finalizeWatchEpisodes(person, { dryRun, agentId });
    const rep = await finalizePerson(person, { dryRun, agentId });
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
    watch_episodes_finalized: watchFinalized,
    kin_written: reports.reduce((s, r) => s + (r.kin || 0), 0),
    kin_rejected: reports.reduce((s, r) => s + (r.kin_rejected || 0), 0),
    rituals_written: reports.reduce((s, r) => s + (r.rituals || 0), 0),
    kin_errors: reports.flatMap((r) => r.kin_errors || []),
    audited: totalAudited,
    refuted: totalRefuted,
    refutation_rate: totalAudited ? totalRefuted / totalAudited : 0,
    cost: embedCost,
    ms: Date.now() - t0,
    reports,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// WS-SPINE — THE WHOLE CHAIN, IN ORDER, FOR ONE PERSON.
//
// THE SECOND HALF OF THE FINDING, and it is worth stating flatly because it
// is not what the ticket said: the hourly cron being dry-run was only ONE of
// the two reasons the derived layer is empty. The other is that
// `api/consolidate-sweep.js` called `runConsolidation` AND NOTHING ELSE.
// `.github/workflows/consolidate.yml` chains six steps (finalize,
// --derive-rel-events, --derive-trust-repair, --extract-patterns,
// --capture-phrases, --derive-self) and that workflow has never run. So even
// with the flag flipped, the sweep would have written episodes and facts and
// left vy_rel_state, vy_pattern, vy_phrase, vy_rel_texture and vy_self_arc
// exactly as empty as they are now — T2/T3/T4/T6/T11/T12 would still render
// 0 bytes, and the flip would have LOOKED like it worked (episodes appear,
// cost appears, nothing renders). This function is the chain the workflow
// encodes, callable in-process, so the one live scheduler runs the same six
// steps the dead one does.
//
// ORDER IS LOAD-BEARING and matches consolidate.yml exactly: every step reads
// rows an earlier step wrote. Running phrase capture before finalize does not
// fail — it silently derives from yesterday, which is the worse failure.
//
// FAIL-SOFT, per step: only finalize's entailment refutation may halt (the
// citation law's one alarm). Every later step is wrapped, so a bad night for
// pattern extraction costs pattern extraction and nothing else.
//
// AGENT-SCOPED THROUGHOUT: `agentId` threads into every call and each of them
// carries the predicate in its own WHERE. There is no agent-conditional
// branch anywhere in this file — a second agent runs this identical chain by
// passing its own id, which is the whole point of Law E1.
export async function runFullChainForPerson(person, { dryRun = false, agentId = MEERA_AGENT_ID } = {}) {
  const t0 = Date.now();
  const out = { person, ms: 0, halted: false, steps: {} };
  const step = async (name, fn) => {
    try {
      out.steps[name] = await fn();
    } catch (e) {
      out.steps[name] = { error: String(e?.message || e).slice(0, 200) };
    }
  };

  const finalize = await runConsolidation({ onlyPerson: person, limit: 1, dryRun, agentId });
  out.steps.finalize = finalize;
  if (finalize.halted) {
    out.halted = true;
    out.ms = Date.now() - t0;
    return out; // never override the layer-3 halt
  }

  await step("rel_events", () => runRelEventDerivation({ onlyPerson: person, limit: 1, dryRun, agentId }));
  await step("trust_repair", () => runTrustRepairDerivation({ onlyPerson: person, limit: 1, dryRun, agentId }));
  await step("patterns", () => runPatternExtraction({ onlyPerson: person, limit: 1, dryRun, agentId }));
  await step("phrases", () => runPhraseCapture({ onlyPerson: person, limit: 1, dryRun, agentId }));
  await step("life_told", () => runLifeTold({ onlyPerson: person, limit: 1, dryRun, agentId }));
  await step("self_layer", () => runSelfLayer({ onlyPerson: person, limit: 1, dryRun, agentId }));

  out.ms = Date.now() - t0;
  return out;
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
      // WS-SPINE: the self layer costs ZERO model calls — `deriveTexture` is
      // pure counting over meera_log and `deriveSelfArc` is pure arithmetic
      // over vy_fact — so there is no cost argument for leaving T11 and T12
      // dark until the first sweep an hour later. The two paid derivations
      // (trust/repair, patterns) stay OUT of the day-1 seed deliberately:
      // both need history a day-1 person does not have, so they would spend
      // real money to derive nothing.
      const selfOut = await runSelfLayer({ limit: 1, dryRun: false, onlyPerson: person }).catch(() => null);
      return res.status(out.halted ? 500 : 200).json({ ...out, rel_event_derivation: relOut, self_layer: selfOut });
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
  if (args.includes("--derive-self")) {
    const out = await runSelfLayer({ limit: limitArg, dryRun, onlyPerson: personArg });
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }
  if (args.includes("--capture-phrases")) {
    const out = await runPhraseCapture({ limit: limitArg, dryRun, onlyPerson: personArg });
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }
  if (args.includes("--life-told")) {
    const out = await runLifeTold({ limit: limitArg, dryRun, onlyPerson: personArg });
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }
  // The whole chain for ONE person, in consolidate.yml's own order — the same
  // entry point api/consolidate-sweep.js drives.
  if (args.includes("--full-chain")) {
    if (!personArg) {
      console.error("--full-chain requires --person <uuid>");
      process.exit(2);
    }
    const out = await runFullChainForPerson(personArg, { dryRun });
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.halted ? 1 : 0);
  }
  const out = await runConsolidation({ limit: limitArg, dryRun, onlyPerson: personArg });
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.halted ? 1 : 0);
}
