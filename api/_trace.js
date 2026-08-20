// The turn-trace writer — docs/TRACE.md. ONE writer for both tables.
//
// This module is the only thing in the repo that writes meera_turn /
// meera_turn_leg, and it exists as its own file (rather than inside
// api/trace.js) because three callers need pieces of it: the batch sink, the
// evals that prove the round trip, and scripts/trace.mjs's residue check.
//
// ── the three properties that matter ──────────────────────────────────────
//
//  1. ONE STATEMENT PER BATCH. api/_db.js q() runs exactly one statement per
//     request with no transactions across calls, so the legs, the spine upsert
//     and the retention prune are a single CTE. That is not an optimisation:
//     it is the only arrangement in which the legs and the `legs` counter that
//     counts them cannot disagree, which is the same reason api/telemetry.js
//     writes its events and its session rollup in one statement.
//
//  2. THE SANITISER IS STRUCTURAL, NOT A POLICY. sanitise() below cannot be
//     talked into storing a message. Every string value is capped at 64
//     characters and every content-shaped key name is dropped outright, so a
//     future caller that hands this module a transcript stores a count of what
//     it dropped instead of the transcript. `structural-disclosure` is the law
//     being applied to ourselves: an access rule is a WHERE clause, not a hope,
//     and a redaction rule is a type check, not a code review.
//
//  3. RETENTION RUNS HERE, because `never-scheduled` says it cannot run
//     anywhere else — no scheduled job has EVER fired in this repo. Every batch
//     prunes at most PRUNE_LIMIT rows past the horizon, chosen by an index
//     range scan. Steady state a batch carries <= 8 legs and may delete 200, so
//     the table cannot outrun its own pruning by more than a burst.
//
// Nothing here is ever awaited by a request a user is waiting on. See
// docs/TRACE.md L1.
import { q } from "./_db.js";
import { MEERA_AGENT_ID } from "./_agentscope.js";

// Client-minted (docs/TRACE.md §2.1). Validated rather than CHECK-constrained
// so one malformed id is dropped with a count instead of failing a batch that
// also carries good rows.
export const TURN_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LEG_RETENTION_DAYS = 30;
export const TURN_RETENTION_DAYS = 90;
const PRUNE_LIMIT = 200;

const MAX_LEGS_PER_BATCH = 200;
const MAX_TURNS_PER_BATCH = 60;
// A trace value is a count, a byte length, a hash, a timing or an enum. 64
// characters clears every one of those (a 16-hex hash, a model slug, a uuid)
// and clears nothing that could be a sentence.
const MAX_STR = 64;
const MAX_ARRAY = 64;
const MAX_DEPTH = 4;
const MAX_PAYLOAD_CHARS = 6_000;

// Key names whose VALUE would be content or credential no matter how short.
// Dropped by name before the length rule ever runs, because "u ok?" is four
// characters and is still his message.
const FORBIDDEN_KEY =
  /(^|_)(text|content|body|summary|reply|message|msg|prompt|query|note|caption|transcript|utterance|bubble|word|phrase|feel|thread|want|owed|taste|secret|key|token|apikey|api_key|authorization|auth|password|cookie|bearer|url|href|email|phone)($|_)/i;
// …with the handful of exceptions that are unambiguously SHAPE. Checked first.
// Every one of these is a number, a boolean or an id — never a string a person
// could have typed.
const SHAPE_KEY =
  /^(msg_id|in_msg_id|out_msg_id|q_chars|q_words_n|memories_bytes|recall_bytes|tail_bytes|core_bytes|out_chars|in_chars|bubbles_n|phrases_n|wants_n|wants_bytes|owed_n|arc_n|untold_n|words_n|tokens_in|tokens_out|tokens_cached|key_pool_size|thread_present|thread_sign|thread_w_band|thread_told|thread_age_ms|thread_bytes|taste_pulled|taste_kind|body_bytes|prompt_bytes|query_bytes|url_host)$/;

/**
 * Reduce any value to trace-safe shape. Returns `undefined` for anything that
 * cannot be represented safely, so the caller drops the key rather than storing
 * a placeholder that reads like data.
 */
function safeValue(v, depth) {
  if (v === null) return null;
  const t = typeof v;
  if (t === "number") return Number.isFinite(v) ? v : null;
  if (t === "boolean") return v;
  if (t === "string") return v.length > MAX_STR ? v.slice(0, MAX_STR) : v;
  if (t === "bigint") return Number(v);
  if (Array.isArray(v)) {
    if (depth >= MAX_DEPTH) return undefined;
    const out = [];
    for (const item of v.slice(0, MAX_ARRAY)) {
      const s = safeValue(item, depth + 1);
      if (s !== undefined) out.push(s);
    }
    return out;
  }
  if (t === "object") {
    if (depth >= MAX_DEPTH) return undefined;
    return sanitise(v, depth + 1);
  }
  return undefined;
}

/**
 * The content firewall. A payload that reaches the database has been through
 * this function; there is no other path into the tables.
 *
 * Returns a plain object, plus `_stripped` when anything was refused — a count,
 * never the thing itself. A silent drop and a stored value look identical from
 * a query, which is the failure `manifest-sourcestatus` is named after.
 */
export function sanitise(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out = {};
  let stripped = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (k.length > 48) {
      stripped++;
      continue;
    }
    if (!SHAPE_KEY.test(k) && FORBIDDEN_KEY.test(k)) {
      stripped++;
      continue;
    }
    const s = safeValue(v, depth);
    if (s === undefined) {
      stripped++;
      continue;
    }
    out[k] = s;
  }
  if (stripped) out._stripped = (out._stripped || 0) + stripped;
  return out;
}

const clampInt = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
const clampStr = (v, n) => (v == null ? null : String(v).slice(0, n) || null);
const uuidOrNull = (v) => (UUID_RE.test(String(v || "")) ? String(v) : null);

/** bigint[] literal, ids only — anything non-numeric is dropped, never coerced. */
function idArray(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const x of v.slice(0, 32)) {
    const n = Number(x);
    if (Number.isFinite(n) && n > 0) out.push(Math.round(n));
  }
  return out;
}

/**
 * Derived alarms (docs/TRACE.md §5). Every flag here is a cheap invariant that
 * has ALREADY been violated in production once — this function is the list of
 * bugs this repo has paid for, written as a predicate.
 *
 * Computed at write time rather than at read time on purpose: a flag that has
 * to be recomputed by every reader is a flag every reader will compute
 * differently, and the partial index that makes "show me every bad turn" fast
 * needs the column to exist.
 */
export function deriveFlags(spine) {
  const f = {};
  const sections = spine.sections && typeof spine.sections === "object" ? spine.sections : null;
  // `realtime-recall-never`: the lane read an empty recall string on every
  // call for months and nothing observed the bytes.
  if (spine.recall_bytes === 0) f.recall_empty = true;
  // `manifest-sourcestatus` / `selflayer-rows-zero`: a slot that declares
  // itself wired and renders nothing. Only meaningful once we know the tail
  // rendered at all, otherwise every empty turn flags.
  if (sections && Number(spine.tail_bytes) > 0) {
    const zero = Object.entries(sections)
      .filter(([, n]) => Number(n) === 0)
      .map(([id]) => id);
    if (zero.length) f.slot_zero = zero.slice(0, 20);
  }
  // the silent-truncation family. api/chat.js keeps the FIRST n characters and
  // drops the rest, so an overflow eats the newest and most safety-relevant
  // text — it has already cost the crisis helplines once.
  if (Number(spine.tail_bytes) > 24_000) f.tail_over = spine.tail_bytes;
  if (Number(spine.core_bytes) > 64_000) f.core_over = spine.core_bytes;
  // a turn that tastes different because the free pool was exhausted is
  // currently indistinguishable from one that is not.
  if (spine.served_by && spine.lane && spine.served_by !== spine.lane) f.fallback = spine.served_by;
  if (Array.isArray(spine.fallbacks) && spine.fallbacks.length) f.fallback = true;
  // `relstate-zero-rows` shape: a device with traffic and no person row means
  // every person-scoped read on the turn returned nothing.
  if (spine.person_id === null && spine.retrieval && spine.retrieval.attempted) f.no_person = true;
  // the 200-carrying-an-empty-reply failure api/chat.js's own guard exists for
  if (spine.out_bubbles === 0) f.empty_reply = true;
  return f;
}

/** Column list for meera_turn, in the order buildBatch binds them. */
const TURN_COLS = [
  "turn_id", "agent_id", "device_id", "person_id", "session_id", "surface", "channel", "lane",
  "started_at", "ended_at", "in_msg_id", "in_log_id", "out_msg_id", "out_log_ids",
  "in_kind", "in_chars", "out_bubbles", "out_chars",
  "core_hash", "manifest_hash", "core_bytes", "tail_bytes", "sections", "dropped",
  "recall_bytes", "retrieval",
  "model", "served_by", "latency_ms", "tokens_in", "tokens_out", "tokens_cached", "retries",
  "fallbacks", "flags", "legs",
];

/**
 * Merge every spine patch in a batch down to ONE row per turn_id.
 *
 * Not an optimisation — a correctness requirement. Postgres refuses an
 * `on conflict do update` whose VALUES list names the same key twice ("cannot
 * affect row a second time"), and a batch legitimately carries several legs of
 * the same turn. Later patches win per field; nulls never overwrite.
 */
function mergeSpines(patches) {
  const byId = new Map();
  for (const p of patches) {
    const prev = byId.get(p.turn_id);
    if (!prev) {
      byId.set(p.turn_id, { ...p });
      continue;
    }
    for (const [k, v] of Object.entries(p)) {
      if (v === null || v === undefined) continue;
      if (k === "legs") prev.legs = (prev.legs || 0) + v;
      else if (k === "sections" || k === "retrieval") prev[k] = { ...(prev[k] || {}), ...v };
      else if (Array.isArray(v) && !v.length) continue;
      else prev[k] = v;
    }
  }
  return [...byId.values()];
}

/**
 * Normalise one caller-supplied spine patch. Everything that is not a
 * recognised column is discarded here — the tables cannot grow a content
 * column by accident.
 */
export function normaliseSpine(raw, { device, agentId, sessionId } = {}) {
  const turnId = String(raw?.turn_id || "");
  if (!TURN_ID_RE.test(turnId)) return null;
  const dev = clampStr(raw?.device_id ?? device, 64);
  if (!dev) return null;
  const sections = raw?.sections ? sanitise(raw.sections) : null;
  const retrieval = raw?.retrieval ? sanitise(raw.retrieval) : null;
  const spine = {
    turn_id: turnId,
    agent_id: uuidOrNull(raw?.agent_id ?? agentId) || MEERA_AGENT_ID,
    device_id: dev,
    person_id: uuidOrNull(raw?.person_id),
    session_id: clampStr(raw?.session_id ?? sessionId, 96),
    surface: clampStr(raw?.surface, 24),
    channel: clampStr(raw?.channel, 16),
    lane: clampStr(raw?.lane, 24),
    started_at: clampInt(raw?.started_at),
    ended_at: clampInt(raw?.ended_at),
    in_msg_id: clampStr(raw?.in_msg_id, 40),
    in_log_id: clampInt(raw?.in_log_id),
    out_msg_id: clampStr(raw?.out_msg_id, 40),
    out_log_ids: idArray(raw?.out_log_ids),
    in_kind: clampStr(raw?.in_kind, 20),
    in_chars: clampInt(raw?.in_chars),
    out_bubbles: clampInt(raw?.out_bubbles),
    out_chars: clampInt(raw?.out_chars),
    core_hash: clampStr(raw?.core_hash, 40),
    manifest_hash: clampStr(raw?.manifest_hash, 40),
    core_bytes: clampInt(raw?.core_bytes),
    tail_bytes: clampInt(raw?.tail_bytes),
    sections,
    dropped: Array.isArray(raw?.dropped) ? raw.dropped.slice(0, 20).map((d) => sanitise(d)) : null,
    recall_bytes: clampInt(raw?.recall_bytes),
    retrieval,
    model: clampStr(raw?.model, 64),
    served_by: clampStr(raw?.served_by, 24),
    latency_ms: clampInt(raw?.latency_ms),
    tokens_in: clampInt(raw?.tokens_in),
    tokens_out: clampInt(raw?.tokens_out),
    tokens_cached: clampInt(raw?.tokens_cached),
    retries: clampInt(raw?.retries) ?? 0,
    fallbacks: Array.isArray(raw?.fallbacks) ? raw.fallbacks.slice(0, 8).map((d) => sanitise(d)) : null,
    legs: 0,
  };
  return spine;
}

/** Normalise one leg. Returns null when the leg cannot be attributed. */
export function normaliseLeg(raw, { device, agentId } = {}) {
  const turnId = String(raw?.turn_id || "");
  if (!TURN_ID_RE.test(turnId)) return null;
  const leg = clampStr(raw?.leg, 32);
  if (!leg) return null;
  const dev = clampStr(raw?.device_id ?? device, 64);
  if (!dev) return null;
  let payload = sanitise(raw?.payload);
  let s = JSON.stringify(payload);
  if (s.length > MAX_PAYLOAD_CHARS) {
    // a payload over budget is a caller bug, and the useful record of it is
    // that it happened — never a half-object that reads like a whole one
    payload = { _oversize: s.length, _stripped: payload._stripped || 0 };
  }
  return {
    turn_id: turnId,
    agent_id: uuidOrNull(raw?.agent_id ?? agentId) || MEERA_AGENT_ID,
    device_id: dev,
    leg,
    seq: clampInt(raw?.seq),
    t_ms: clampInt(raw?.t_ms),
    payload,
    at: clampInt(raw?.at),
  };
}

/**
 * Build the single statement that writes a whole batch: prune, insert the legs,
 * upsert the spines.
 *
 * The upsert rules are arrival-order-proof, and each one is chosen rather than
 * defaulted:
 *   started_at  least()      — an offline drain must not drag a turn forward
 *   ended_at    greatest()   — nor a late leg drag its end backwards
 *   legs        +            — the counter and the rows it counts move together
 *   sections /
 *   retrieval   ||           — legs contribute different keys of the same map
 *   everything
 *   else        coalesce()   — a leg that does not know a field must never
 *                             erase what a leg that did know it wrote
 */
export function buildBatch(spinePatches, legs) {
  const spines = mergeSpines(spinePatches).slice(0, MAX_TURNS_PER_BATCH);
  const rows = legs.slice(0, MAX_LEGS_PER_BATCH);
  for (const l of rows) {
    const s = spines.find((x) => x.turn_id === l.turn_id);
    if (s) s.legs += 1;
  }
  if (!spines.length) return null;

  const params = [];
  const P = (v) => `$${params.push(v)}`;
  const now = Date.now();
  const legHorizon = new Date(now - LEG_RETENTION_DAYS * 86_400_000).toISOString();
  const turnHorizon = new Date(now - TURN_RETENTION_DAYS * 86_400_000).toISOString();

  const legValues = rows.map(
    (l) =>
      `(${P(l.turn_id)}, ${P(l.agent_id)}::uuid, ${P(l.device_id)}, ${P(l.leg)}, ${P(l.seq)}, ` +
      `${P(l.t_ms)}, ${P(JSON.stringify(l.payload))}::jsonb, ` +
      `${P(new Date(l.at || now).toISOString())}::timestamptz)`,
  );

  const spineValues = spines.map((s) => {
    s.flags = deriveFlags(s);
    return (
      `(${P(s.turn_id)}, ${P(s.agent_id)}::uuid, ${P(s.device_id)}, ${P(s.person_id)}::uuid, ` +
      `${P(s.session_id)}, ${P(s.surface)}, ${P(s.channel)}, ${P(s.lane)}, ` +
      `${P(new Date(s.started_at || now).toISOString())}::timestamptz, ` +
      `${P(s.ended_at ? new Date(s.ended_at).toISOString() : null)}::timestamptz, ` +
      `${P(s.in_msg_id)}, ${P(s.in_log_id)}::bigint, ${P(s.out_msg_id)}, ` +
      `${P(s.out_log_ids)}::bigint[], ` +
      `${P(s.in_kind)}, ${P(s.in_chars)}::int, ${P(s.out_bubbles)}::int, ${P(s.out_chars)}::int, ` +
      `${P(s.core_hash)}, ${P(s.manifest_hash)}, ${P(s.core_bytes)}::int, ${P(s.tail_bytes)}::int, ` +
      `${P(JSON.stringify(s.sections || {}))}::jsonb, ${P(JSON.stringify(s.dropped || []))}::jsonb, ` +
      `${P(s.recall_bytes)}::int, ${P(JSON.stringify(s.retrieval || {}))}::jsonb, ` +
      `${P(s.model)}, ${P(s.served_by)}, ${P(s.latency_ms)}::int, ${P(s.tokens_in)}::int, ` +
      `${P(s.tokens_out)}::int, ${P(s.tokens_cached)}::int, ${P(s.retries)}::int, ` +
      `${P(JSON.stringify(s.fallbacks || []))}::jsonb, ${P(JSON.stringify(s.flags))}::jsonb, ` +
      `${P(s.legs)}::int)`
    );
  });

  // COALESCE on every scalar: a leg that does not know a field must never
  // erase what a leg that did know it wrote. `excluded` first, so a later,
  // better-informed leg wins.
  const keep = new Set(["turn_id", "agent_id", "device_id", "started_at", "ended_at", "legs", "sections", "retrieval", "flags"]);
  const sets = TURN_COLS.filter((c) => !keep.has(c)).map((c) =>
    c === "out_log_ids" || c === "dropped" || c === "fallbacks"
      ? `${c} = case when ${jsonNonEmpty(c)} then excluded.${c} else meera_turn.${c} end`
      : `${c} = coalesce(excluded.${c}, meera_turn.${c})`,
  );

  const sql =
    `with prune_legs as (
       delete from meera_turn_leg where id in (
         select id from meera_turn_leg where at < ${P(legHorizon)}::timestamptz
          order by at limit ${PRUNE_LIMIT})
     ),
     prune_turns as (
       delete from meera_turn where turn_id in (
         select turn_id from meera_turn where started_at < ${P(turnHorizon)}::timestamptz
          order by started_at limit ${PRUNE_LIMIT})
     )` +
    (legValues.length
      ? `, ins_legs as (
       insert into meera_turn_leg (turn_id, agent_id, device_id, leg, seq, t_ms, payload, at)
       values ${legValues.join(", ")}
     )`
      : "") +
    `
     insert into meera_turn (${TURN_COLS.join(", ")})
     values ${spineValues.join(", ")}
     on conflict (turn_id) do update set
       started_at = least(meera_turn.started_at, excluded.started_at),
       ended_at   = greatest(meera_turn.ended_at, excluded.ended_at),
       legs       = meera_turn.legs + excluded.legs,
       sections   = meera_turn.sections || excluded.sections,
       retrieval  = meera_turn.retrieval || excluded.retrieval,
       flags      = meera_turn.flags || excluded.flags,
       ${sets.join(",\n       ")}`;

  return { sql, params, turns: spines.length, legs: rows.length };
}

// `dropped`/`fallbacks` are jsonb arrays and `out_log_ids` a bigint[]; an empty
// one means "this leg had nothing to say", never "clear what is there".
function jsonNonEmpty(col) {
  return col === "out_log_ids"
    ? `cardinality(excluded.out_log_ids) > 0`
    : `jsonb_array_length(excluded.${col}) > 0`;
}

/**
 * Write one batch. Awaited by api/trace.js only — that endpoint is never on a
 * reply path, so awaiting it costs a user nothing and guarantees the write
 * survives the serverless freeze (api/telemetry.js's own measured lesson: a
 * fire-and-forget write after the response silently disappears).
 */
export async function traceWrite(spinePatches, legs, timeoutMs = 8_000) {
  const batch = buildBatch(spinePatches, legs);
  if (!batch) return { ok: true, turns: 0, legs: 0 };
  await q(batch.sql, batch.params, timeoutMs);
  return { ok: true, turns: batch.turns, legs: batch.legs };
}
