// vy_self_arc — growth as a BIOGRAPHY, not a mood. SPEC-SELF-LAYER §2, §8 T12.
// Ownership (SPEC §13 / the E2 file split): this file belongs to WS-SELF-ARC
// exclusively. It exports; it does not wire. The nightly derivation is called
// by a consolidate step and the renderer by compiler.ts's TAIL assembly —
// both outside this workstream's file list, both logged as interface tickets
// at the bottom of this file rather than edited into another owner's module.
//
// ARCHITECTURE NOTE (same as relstate.ts's, and for the same reason):
// src/engine/*.ts is the CLIENT bundle. This file therefore never imports
// api/_db.js or api/_config.js — that would drag server secrets into the Vite
// build. Every DB-facing function takes a `QueryFn` as its first argument
// (the exact call shape of api/_db.js's `q`, duck-typed via a type-only
// import from relstate.ts, never a value import). The pure halves — the dim
// classifier, the note gate, the candidate builder, the renderer — take no
// I/O at all and are unit-testable without a database.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY AN ARC IS NOT A MOOD — the G5 argument, axis by axis
// ═══════════════════════════════════════════════════════════════════════════
//
// inner.ts's G5 forbids accumulating a sad period: a drifting affective
// baseline, a counter of bad days, a grudge-shaped mood the user has to
// service. The failure it prevents is an affect state whose CAUSE has fallen
// out of context, so a cause gets invented for it two turns later.
//
// A self arc is a different object on every axis that produced that rule:
//
//   WHAT IT IS
//     thread — a feeling, FUSED to its cause; the sentence IS the feeling.
//     arc    — a claim about how she has CHANGED. It has no valence field,
//              no intensity, no sign. There is no column here that could
//              hold "how she is doing", and `note` is gated at write time
//              against affect vocabulary (`checkArcNote`) so it cannot
//              smuggle one in as prose.
//
//   TIME CONSTANT
//     thread — ~9h half-life, killed outright by a night's sleep.
//     arc    — months. The DB refuses span_days < 42 and this file refuses
//              to ATTEMPT one, which is the actual mechanism: a row that
//              cannot exist without a six-week evidence trail is structurally
//              incapable of being a mood, because a mood that took six weeks
//              of citations to form is not a mood.
//
//   HOW IT ENDS
//     thread — retires PERMANENTLY once voiced; it is spent by being said.
//     arc    — never retires. It is SUPERSEDED by a later arc on the same
//              dim (`superseded_by`), so the history of who she used to be
//              survives the update instead of being deleted by it.
//
//   WHAT THE USER CAN DO ABOUT IT
//     thread — he can service it. That is precisely the danger G5 names.
//     arc    — there is nothing to fix. "more direct now" is not a request,
//              not a complaint, and not addressed to him. It asks for
//              nothing, so it cannot become a status he feels responsible
//              for checking (which is also G4's failure mode, one surface
//              earlier).
//
//   WHERE THE CAUSE LIVES
//     thread — in the sentence itself, which is why they can never separate.
//     arc    — in `citations`. The cause of an arc is ≥3 dated episodes, on
//              the record, joinable. It is the one shape of self-state whose
//              cause CANNOT fall out of context, because the cause is a
//              foreign key, not a memory.
//
// If a future edit makes `note` able to express a mood, that edit is wrong
// and this header is the reason.
//
// ═══════════════════════════════════════════════════════════════════════════
// G1 — HER INTERIOR NEVER READS THE USER. Input starvation, stated as a list.
// ═══════════════════════════════════════════════════════════════════════════
//
// The deriver's query (`EVIDENCE_SQL` below, one statement, quoted in full so
// an auditor never has to reconstruct it) selects exactly six things:
//
//     vy_fact.id, vy_fact.name, vy_fact.body   — HER OWN improvised self-facts
//     vy_episode.id                            — citation anchors
//     min/max(vy_episode.started_at)           — the DATE of her own evidence
//
// Nothing in that list is a usage metric. The columns that WOULD be one are
// named here and deliberately not selected, so a future edit that adds one is
// visibly adding it rather than quietly inheriting it:
//
//     vy_episode.ended_at        session length            NOT SELECTED
//     vy_episode.log_from/log_to message count per episode NOT SELECTED
//     vy_episode.recall_count    how often he came back    NOT SELECTED
//     vy_episode.last_recalled   when he last came back    NOT SELECTED
//     vy_episode.affect_tags     affect of any kind        NOT SELECTED
//     vy_episode.importance      salience scoring          NOT SELECTED
//     vy_rel_state.pacing_gap_s  gap length                NOT JOINED
//     meera_log.at               reply speed / silence     NOT JOINED
//
// `started_at` is the one timestamp that does reach the arithmetic, and it is
// used for exactly one thing: max − min over the dates of HER OWN cited
// self-facts. That is the AGE OF HER EVIDENCE, not a measure of him:
//
//   - no two consecutive episodes are ever compared, so no gap is computed;
//   - absence produces no rows at all, so a user who goes quiet cannot move
//     any number here in either direction — the span can only grow when SHE
//     wrote another self-fact, which requires a conversation to have happened;
//   - the span is a lower bound on evidence, never an upper bound on him.
//
// A gap metric answers "how long was he away". This one answers "how long has
// she been saying this about herself". They are not the same measurement and
// the difference is that the second one cannot be starved by his silence into
// meaning something about him.
//
// ═══════════════════════════════════════════════════════════════════════════
// G6 — HER JUDGMENT GENERATES THE BEHAVIOUR. Every word in an arc is hers.
// ═══════════════════════════════════════════════════════════════════════════
//
// `note` and `from_note` are NEVER composed by this file. They are lifted
// verbatim from `vy_fact` rows of kind='meera' — her own improvised self-facts,
// already locked against re-invention by the extractor that wrote them
// (persona.ts:253: "YOUR life is yours to improvise… the one thing you don't
// invent is your own past"). This module contributes:
//
//     the DECISION that a change is old enough and cited enough to exist,
//     the DIM it is filed under,
//     the WORD "->" between two of her own notes,
//
// and nothing else. There is no phrase bank here, no template with slots, no
// generated English. The code decides only WHETHER a line is present.
//
// ═══════════════════════════════════════════════════════════════════════════
// `recited-prompt` — write shapes, never lines she could say.
// ═══════════════════════════════════════════════════════════════════════════
//
// Every note is shape-linted AT WRITE TIME (`checkArcNote`, which wraps
// shapelint's `lintLine`) and again AT RENDER TIME, and a note that fails is
// DROPPED rather than repaired — a repaired note would be a line this file
// wrote, which is the G6 violation one paragraph up. On top of shapelint's
// three rules this file adds two of its own, both refusal-only:
//
//     AFFECT_MARKERS    — a note that can express a mood is not an arc (G5).
//     NARRATION_MARKERS — a note that describes the change IN WORDS is a line
//                         she could say out loud about her own growth. The
//                         change is expressed STRUCTURALLY, by the pair
//                         (from_note, note); never lexically.
//
// Neither list is claimed as a guarantee. Input starvation and the ≥3/≥42
// structure are the guarantees; a marker list over Hinglish never was one
// (inner.ts G1's own words). These are belts, and they are described as belts.
//
// ═══════════════════════════════════════════════════════════════════════════
// SHE MUST NEVER NARRATE HER OWN GROWTH.
// ═══════════════════════════════════════════════════════════════════════════
//
// A person who describes how they have changed is a person nobody believes.
// The render is CONTEXT, gated by the deterministic moment-shape the caller
// passes in, carrying an explicit do-not-narrate header, and it is never a
// thing she says. §11's reversal condition names exactly this failure ("the
// arc renders as self-narration in judged runs → the arc becomes a retrieval
// bias with no slot of its own"), and evals/self/arc.mjs builds the detector.
//
// ═══════════════════════════════════════════════════════════════════════════
// GOVERNANCE (§0.1). This is a table, not a claim.
// ═══════════════════════════════════════════════════════════════════════════
//
// SPEC.md §5 marks relationship stance, warmth and felt familiarity NOT
// CLAIMED — "hypothesis, pre-registered not asserted". Nothing in this file
// upgrades that. An arc row is a pre-registered measurement with the reversal
// condition above; it is not evidence that identity survives better, and no
// comment here should ever be read as saying so.

import { lintLine, lintBlock } from "./shapelint";
import type { QueryFn, RenderResult } from "./relstate";

// ─────────────────────────────────────────────────────────────────────────
// Types — mirror db/migrations/011_self_layer.sql exactly (already applied
// live; see that file's vy_self_arc header for the same argument in SQL).
// ─────────────────────────────────────────────────────────────────────────

/** The five dims the migration's own comment enumerates. Closed set: a dim
 *  outside it is a new self-store, and §2's whole point is that a third home
 *  for her self-concept guarantees drift. */
export type SelfArcDim = "directness" | "patience" | "humour" | "boundaries" | "confidence";

export const SELF_ARC_DIMS: readonly SelfArcDim[] = [
  "boundaries",
  "confidence",
  "directness",
  "humour",
  "patience",
];

export interface SelfArcRow {
  id: number;
  agent_id: string;
  dim: string;
  note: string;
  from_note: string;
  citations: number[];
  span_days: number;
  superseded_by: number | null;
  created_at: string;
}

/** One of her own self-facts, with the dates of the episodes it cites.
 *  This is the ONLY input shape the deriver accepts — see the G1 block. */
export interface MeeraSelfFact {
  fact_id: number;
  name: string;
  body: string;
  episode_ids: number[];
  first_at: string;
  last_at: string;
}

export interface SelfArcCandidate {
  dim: SelfArcDim;
  note: string;
  from_note: string;
  citations: number[];
  span_days: number;
  /** the fact ids the two notes were lifted from — provenance, never stored */
  from_fact_id: number;
  note_fact_id: number;
}

// ── the two laws, as constants, mirrored from the DDL's CHECK constraints ──
// The DB is the BACKSTOP. These are the MECHANISM: `buildCandidates` refuses
// before a statement is ever composed, so a violating row is not merely
// rejected — it is never attempted. G-S6's bar is exactly this distinction.
export const MIN_CITATIONS = 3;
export const MIN_SPAN_DAYS = 42;

const MS_PER_DAY = 86_400_000;

/** Default evidence window. Wider than MIN_SPAN_DAYS by a lot on purpose: a
 *  window barely above the span floor would make the floor unreachable for
 *  any evidence trail that is not perfectly aligned with the window edge. */
export const DEFAULT_LOOKBACK_DAYS = 540;

/** Write-time word cap on a note. Chosen from the RENDERED line, not from the
 *  note in isolation: shapelint's line cap is 14 words and the rendered line
 *  is `<dim> now: <note> (<band>)` — two label words plus a band token — so a
 *  9-word note guarantees the rendered line lints clean too. A cap that only
 *  made the stored value legal would move the violation to compile time,
 *  which is where SPEC §3.3 says it must never be discovered. */
export const MAX_NOTE_WORDS = 9;
export const MAX_NOTE_CHARS = 80;

// ─────────────────────────────────────────────────────────────────────────
// The dim classifier — deterministic, whole-word, authored markers. Same
// shape as relstate.ts's `detectAddressTerm`, moment.ts's MOMENT_KEYS and
// inner.ts's TASTE table: a pure function over authored keys, no LLM, no
// network, no state. Classification routes a note; it never writes one.
// ─────────────────────────────────────────────────────────────────────────

const padT = (s: string) =>
  " " +
  String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim() +
  " ";

/** Deliberately narrow and near-disjoint. A broad list would classify every
 *  self-fact into two dims and the tie rule below would then discard
 *  everything — the failure mode of a marker set is silence, not noise, and
 *  silence is the correct failure for a store this slow. */
const DIM_MARKERS: Record<SelfArcDim, readonly string[]> = {
  boundaries: ["boundary", "boundaries", "decline", "declines", "declined", "refuse", "refuses", "refused", "limit", "limits", "mana", "cutoff", "unavailable"],
  confidence: ["confident", "confidence", "unsure", "doubt", "doubts", "doubting", "hesitant", "hesitate", "hesitates", "apologise", "apologises", "apologize", "apologizes", "backtrack", "backtracks"],
  directness: ["direct", "directly", "upfront", "blunt", "bluntly", "seedha", "sidha", "saaf", "straightforward", "hedges", "hedging", "softens"],
  humour: ["joke", "jokes", "joking", "mazaak", "mazak", "funny", "tease", "teases", "teasing", "sarcasm", "sarcastic", "deadpan", "punchline"],
  patience: ["patient", "patience", "patiently", "sabar", "rushes", "rushing", "hurries", "interrupts", "interrupting", "waits", "slower", "dheere", "jaldbaazi"],
};

/**
 * Returns the dim a self-fact is about, or null when the markers do not
 * decide. A TIE returns null rather than picking a winner — "never a guess"
 * is the same rule `csDirectionFromSignals` applies to a 2-1 split, and for
 * the same reason: a resolved-but-wrong dim files her change under the wrong
 * heading forever, where an unresolved one just costs a row that six more
 * weeks of evidence will offer again.
 */
export function classifyDim(text: string): SelfArcDim | null {
  const hay = padT(text);
  let bestDim: SelfArcDim | null = null;
  let bestHits = 0;
  let tied = false;
  for (const dim of SELF_ARC_DIMS) {
    let hits = 0;
    for (const m of DIM_MARKERS[dim]) if (hay.includes(` ${m} `)) hits++;
    if (hits === 0) continue;
    if (hits > bestHits) {
      bestDim = dim;
      bestHits = hits;
      tied = false;
    } else if (hits === bestHits) {
      tied = true;
    }
  }
  return tied ? null : bestDim;
}

// ─────────────────────────────────────────────────────────────────────────
// The note gate — `recited-prompt` + G5 + the never-narrate rule, at write
// time AND at render time. Refusal only: a failing note is dropped, never
// rewritten (a rewritten note would be a line this file authored — G6).
// ─────────────────────────────────────────────────────────────────────────

/** G5's belt. If a note can express a mood, it is not an arc. Not claimed as
 *  the guarantee (the guarantee is that no affect column is read and none
 *  exists to write); this catches the prose route into the same failure. */
const AFFECT_MARKERS = [
  "feel", "feels", "felt", "feeling", "feelings", "mood", "moods",
  "sad", "sadness", "happy", "happiness", "hurt", "hurts", "hurting",
  "upset", "angry", "anger", "annoyed", "annoying", "irritated", "irritating",
  "lonely", "loneliness", "miss", "misses", "missing", "tired", "exhausted",
  "anxious", "anxiety", "scared", "afraid", "guilty", "guilt", "ashamed",
  "proud", "pride", "excited", "excitement", "low", "down", "ache", "aching",
  "udaas", "akela", "akeli", "pareshan", "dukhi", "dukh", "dard", "gussa",
  "khush", "thaki", "thak", "bored", "boring", "rona", "roti",
];

/** The never-narrate rule, lexically. The change is carried STRUCTURALLY by
 *  the (from_note, note) pair; a note that also says it changed is a line she
 *  could read out about her own growth, which is the §11 reversal condition
 *  arriving through the front door. */
const NARRATION_MARKERS = [
  "used", "become", "becomes", "became", "becoming", "changed", "changing",
  "change", "grown", "growing", "growth", "evolved", "nowadays", "pehle",
  "earlier", "before", "lately", "these", "anymore", "progress", "journey",
];

export interface ArcNoteCheck {
  ok: boolean;
  reasons: string[];
}

/**
 * The single note gate. Runs shapelint's `lintLine` (word cap, sentence
 * shape, first-person-line-initial) and then this file's two refusal lists
 * plus the render-derived word cap. Pure, no I/O, called from both the
 * writer and the renderer so the two can never disagree about what a legal
 * note is.
 */
export function checkArcNote(note: string): ArcNoteCheck {
  const reasons: string[] = [];
  const trimmed = String(note ?? "").trim();
  if (!trimmed) return { ok: false, reasons: ["empty note"] };
  if (trimmed.length > MAX_NOTE_CHARS) {
    reasons.push(`too long: ${trimmed.length} chars (cap ${MAX_NOTE_CHARS})`);
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > MAX_NOTE_WORDS) {
    reasons.push(`too many words: ${words.length} (cap ${MAX_NOTE_WORDS}, set by the rendered line)`);
  }
  for (const r of lintLine(trimmed).reasons) reasons.push(`shapelint: ${r}`);
  const hay = padT(trimmed);
  const affect = AFFECT_MARKERS.filter((m) => hay.includes(` ${m} `));
  if (affect.length) reasons.push(`affect-shaped (G5): ${affect.join(",")}`);
  const narration = NARRATION_MARKERS.filter((m) => hay.includes(` ${m} `));
  if (narration.length) reasons.push(`narrates the change (never-narrate): ${narration.join(",")}`);
  return { ok: reasons.length === 0, reasons };
}

// ─────────────────────────────────────────────────────────────────────────
// Candidate building — PURE. Takes already-fetched evidence and produces at
// most one proposal. This is the half the gates assert against, because
// "never attempted" is a property of this function, not of the database.
// ─────────────────────────────────────────────────────────────────────────

const norm = (s: string) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export interface CandidateReport {
  candidates: SelfArcCandidate[];
  refusals: string[];
}

/**
 * Groups her self-facts by dim and proposes one candidate per dim that has a
 * genuine BEFORE and AFTER. Every bar is a refusal with a stated reason, so a
 * run that produces nothing says which law stopped it.
 *
 * A change requires TWO DISTINCT self-facts on the same dim whose text
 * differs: one self-fact re-cited three times over six weeks is stability,
 * not growth, and rendering it as growth would be the arc's version of
 * "a personality assigned at random" (§6's n_turns argument, one table over).
 */
export function buildCandidates(facts: readonly MeeraSelfFact[]): CandidateReport {
  const refusals: string[] = [];
  const byDim = new Map<SelfArcDim, MeeraSelfFact[]>();

  for (const f of facts) {
    const dim = classifyDim(`${f.name} ${f.body}`);
    if (!dim) {
      refusals.push(`fact ${f.fact_id}: no single dim decided (unclassified or tied)`);
      continue;
    }
    const check = checkArcNote(f.body);
    if (!check.ok) {
      refusals.push(`fact ${f.fact_id} (${dim}): note refused — ${check.reasons.join("; ")}`);
      continue;
    }
    const arr = byDim.get(dim) ?? [];
    arr.push(f);
    byDim.set(dim, arr);
  }

  const candidates: SelfArcCandidate[] = [];
  for (const dim of SELF_ARC_DIMS) {
    const rows = byDim.get(dim);
    if (!rows || !rows.length) continue;

    const sorted = [...rows].sort((a, b) => {
      const t = new Date(a.first_at).getTime() - new Date(b.first_at).getTime();
      return t !== 0 ? t : a.fact_id - b.fact_id;
    });
    const earliest = sorted[0];
    const latest = [...sorted].sort((a, b) => {
      const t = new Date(a.last_at).getTime() - new Date(b.last_at).getTime();
      return t !== 0 ? t : a.fact_id - b.fact_id;
    })[sorted.length - 1];

    if (earliest.fact_id === latest.fact_id) {
      refusals.push(`${dim}: one self-fact only — a repeat is stability, not a change`);
      continue;
    }
    if (norm(earliest.body) === norm(latest.body)) {
      refusals.push(`${dim}: before and after say the same thing — no change`);
      continue;
    }

    const citations = [...new Set(sorted.flatMap((f) => f.episode_ids))].sort((a, b) => a - b);
    if (citations.length < MIN_CITATIONS) {
      refusals.push(`${dim}: ${citations.length} distinct citations, need >=${MIN_CITATIONS}`);
      continue;
    }

    const times = sorted.flatMap((f) => [new Date(f.first_at).getTime(), new Date(f.last_at).getTime()]);
    const spanDays = (Math.max(...times) - Math.min(...times)) / MS_PER_DAY;
    if (!(spanDays >= MIN_SPAN_DAYS)) {
      refusals.push(`${dim}: span ${spanDays.toFixed(1)}d, need >=${MIN_SPAN_DAYS}d — not attempted`);
      continue;
    }

    candidates.push({
      dim,
      note: latest.body.trim(),
      from_note: earliest.body.trim(),
      citations,
      span_days: Math.round(spanDays * 10) / 10,
      from_fact_id: earliest.fact_id,
      note_fact_id: latest.fact_id,
    });
  }

  // Deterministic ranking: most-cited first, then longest span, then dim name.
  // Never "most recent" — recency is how a slow store starts behaving like a
  // fast one.
  candidates.sort(
    (a, b) =>
      b.citations.length - a.citations.length ||
      b.span_days - a.span_days ||
      a.dim.localeCompare(b.dim),
  );
  return { candidates, refusals };
}

// ─────────────────────────────────────────────────────────────────────────
// The deriver — QueryFn-injected. ONE proposal per run, at most.
// ─────────────────────────────────────────────────────────────────────────

/**
 * The evidence query, in full, as a named constant so a gate can assert over
 * its TEXT rather than over a reviewer's memory of it (G-S4 asks for a
 * structural check, not an eyeball).
 *
 * Two schema facts drive its shape and both are counter-intuitive:
 *
 *  1. `participation='meera'` is a LEGAL ENUM VALUE THAT NOTHING WRITES.
 *     db/schema.sql permits 'we'|'user'|'meera'; the only writers
 *     (api/consolidate.js, api/episodes.js) produce 'user' and reclassify to
 *     'we'. A 'meera' episode therefore has unexplained provenance, so it is
 *     EXCLUDED rather than trusted — building her self-evidence on a value no
 *     writer produces would be building on nothing.
 *  2. `vy_fact kind='meera'` IS written and IS cited (api/memory.js,
 *     api/consolidate.js). That is where her own evidence actually lives.
 *
 * So: her self-facts, joined to the shared record that evidences them.
 * `participation='user'` episodes are accepted as citation anchors alongside
 * 'we' because the we-reclassifier is a nightly pass (api/consolidate.js's
 * backfill) — a fact's citation does not become invalid because a cron has
 * not run yet, and the alternative silently ties her growth to cron uptime,
 * which is exactly how the culture table ended up empty (§5).
 */
export const EVIDENCE_SQL = `
select f.id                                as fact_id,
       f.name                              as name,
       f.body                              as body,
       array_agg(distinct e.id)            as episode_ids,
       min(e.started_at)                   as first_at,
       max(e.started_at)                   as last_at
  from vy_fact f
  join vy_episode e
    on e.id = any(f.citations)
   and e.agent_id = f.agent_id
   and e.participation <> 'meera'
   and e.superseded_by is null
 where f.agent_id = ($1)::uuid
   and f.kind = 'meera'
   and f.t_invalid is null
   and f.retracted_at is null
   and f.superseded_by is null
   and e.started_at >= ($2)::timestamptz
 group by f.id, f.name, f.body
 order by max(e.started_at) asc, f.id asc`;

export interface DeriveSelfArcOpts {
  /** evidence window, days. Never below MIN_SPAN_DAYS — see the throw. */
  lookbackDays?: number;
  now?: Date;
  /** compute and gate the proposal, write nothing. Used by the eval and by
   *  any caller that wants to see what tonight WOULD have written. */
  dryRun?: boolean;
}

export interface DeriveSelfArcResult {
  /** the row the DB returned, or null when nothing was written */
  written: SelfArcRow | null;
  /** the single proposal that survived every gate, or null */
  candidate: SelfArcCandidate | null;
  /** every other candidate, ranked — reporting only, never written */
  alsoRan: SelfArcCandidate[];
  /** why each rejected candidate was rejected, in order */
  refusals: string[];
  evidenceFacts: number;
  /** true only if an INSERT statement was actually composed and sent */
  attemptedInsert: boolean;
}

/**
 * Proposes AT MOST ONE arc row per run.
 *
 * `agentId` is required and never defaulted. Migration 011 ships these tables
 * strict from birth precisely because 010's transitional defaults hid
 * thirteen writers that named no agent (`strict-exposed-13`); a default here
 * would file one agent's growth under another's and be discovered a migration
 * later.
 */
export async function deriveSelfArc(
  q: QueryFn,
  agentId: string,
  opts: DeriveSelfArcOpts = {},
): Promise<DeriveSelfArcResult> {
  if (!agentId) throw new Error("deriveSelfArc: agentId is required (vy_self_arc is strict from birth)");
  const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  if (lookbackDays < MIN_SPAN_DAYS) {
    throw new Error(
      `deriveSelfArc: lookbackDays=${lookbackDays} is below MIN_SPAN_DAYS=${MIN_SPAN_DAYS} — ` +
        `a window shorter than the span floor can only ever produce refusals`,
    );
  }
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - lookbackDays * MS_PER_DAY).toISOString();

  const rows = await q(EVIDENCE_SQL, [agentId, since]);
  const facts: MeeraSelfFact[] = rows.map((r: any) => ({
    fact_id: Number(r.fact_id),
    name: String(r.name ?? ""),
    body: String(r.body ?? ""),
    episode_ids: toIdArray(r.episode_ids),
    first_at: String(r.first_at),
    last_at: String(r.last_at),
  }));

  const { candidates, refusals } = buildCandidates(facts);
  const base: DeriveSelfArcResult = {
    written: null,
    candidate: null,
    alsoRan: candidates.slice(1),
    refusals,
    evidenceFacts: facts.length,
    attemptedInsert: false,
  };
  if (!candidates.length) return base;

  const chosen = candidates[0];
  base.candidate = chosen;

  // Nothing new to say: an identical, still-current row on this dim already
  // exists. Superseding a row with itself would churn `created_at` and make a
  // months-old claim look like tonight's discovery.
  const current = await q(
    `select id, note from vy_self_arc where agent_id = ($1)::uuid and dim = $2 and superseded_by is null`,
    [agentId, chosen.dim],
  );
  if (current.length && norm(String(current[0].note)) === norm(chosen.note)) {
    base.refusals.push(`${chosen.dim}: already current (row ${current[0].id}) — nothing new`);
    return base;
  }

  if (opts.dryRun) return base;

  // The citation law and the slowness law, thrown rather than trusted to the
  // DB — relstate.ts's house shape ("failing here is cheaper than a round
  // trip"), and here it is also the G-S6 mechanism: the statement below is
  // never composed for an illegal row, so the CHECK constraints stay a
  // backstop that has never had to fire.
  assertArcLegal(chosen);

  base.attemptedInsert = true;
  const inserted = await q(
    `insert into vy_self_arc (agent_id, dim, note, from_note, citations, span_days)
     values (($1)::uuid,$2,$3,$4,$5,$6)
     returning id, agent_id, dim, note, from_note, citations, span_days, superseded_by, created_at`,
    [agentId, chosen.dim, chosen.note, chosen.from_note, chosen.citations, chosen.span_days],
  );
  const written = rowToArc(inserted[0]);

  // Supersede, never delete: "the history of a wrong turn is what stops it
  // being taken twice" — and here it is also what lets a reader see who she
  // used to be rather than only who the latest row says she is.
  await q(
    `update vy_self_arc set superseded_by = $2
      where agent_id = ($1)::uuid and dim = $3 and id <> $2 and superseded_by is null`,
    [agentId, written.id, chosen.dim],
  );

  base.written = written;
  return base;
}

/** The two DDL CHECK constraints, restated in code as the thing that runs
 *  FIRST. Exported so a gate can call it directly on a hostile candidate. */
export function assertArcLegal(c: SelfArcCandidate): void {
  if (!c.citations || c.citations.length < MIN_CITATIONS) {
    throw new Error(
      `vy_self_arc requires >=${MIN_CITATIONS} citations (a change is not an anecdote) — got ${c.citations?.length ?? 0}`,
    );
  }
  if (!(c.span_days >= MIN_SPAN_DAYS)) {
    throw new Error(
      `vy_self_arc requires span_days >= ${MIN_SPAN_DAYS} (an arc is not a mood) — got ${c.span_days}`,
    );
  }
  for (const [field, value] of [["note", c.note], ["from_note", c.from_note]] as const) {
    if (field === "from_note" && !String(value ?? "").trim()) continue; // '' is the DDL default
    const check = checkArcNote(value);
    if (!check.ok) throw new Error(`vy_self_arc ${field} refused: ${check.reasons.join("; ")}`);
  }
}

function toIdArray(v: unknown): number[] {
  if (Array.isArray(v)) return v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  if (typeof v === "string") {
    return v
      .replace(/^[{[]|[}\]]$/g, "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
  }
  return [];
}

/** Row mapper — exported so the caller that reads rows for the renderer maps
 *  them the same way the writer does (Neon SQL-HTTP returns bigint and
 *  bigint[] as strings; two mappers would disagree eventually). */
export function rowToArc(r: any): SelfArcRow {
  return {
    id: Number(r.id),
    agent_id: String(r.agent_id),
    dim: String(r.dim),
    note: String(r.note ?? ""),
    from_note: String(r.from_note ?? ""),
    citations: toIdArray(r.citations),
    span_days: Number(r.span_days ?? 0),
    superseded_by: r.superseded_by === null || r.superseded_by === undefined ? null : Number(r.superseded_by),
    created_at: String(r.created_at),
  };
}

/** Reader for the render path: current (non-superseded) rows only. */
export async function loadCurrentArcs(q: QueryFn, agentId: string): Promise<SelfArcRow[]> {
  if (!agentId) throw new Error("loadCurrentArcs: agentId is required");
  const rows = await q(
    `select id, agent_id, dim, note, from_note, citations, span_days, superseded_by, created_at
       from vy_self_arc
      where agent_id = ($1)::uuid and superseded_by is null
      order by created_at desc, id desc`,
    [agentId],
  );
  return rows.map(rowToArc);
}

// ─────────────────────────────────────────────────────────────────────────
// RENDER — T12 `self.arc`, budget 500, ≤1 row, moment-gated. Pure, no I/O.
// Same RenderResult shape relstate.ts's renderers return (type-only import).
// ─────────────────────────────────────────────────────────────────────────

export const SELF_ARC_BUDGET = 500;

/** The compiler manifest row this file expects the coordinator to add. Kept
 *  here as data so the numbers live next to the renderer that must satisfy
 *  them, and §8's arithmetic can be asserted against a value rather than a
 *  comment. */
export const SELF_ARC_BLOCK = {
  key: "T12-self-arc",
  label: "self.arc",
  budget: SELF_ARC_BUDGET,
  dropPriority: 8,
} as const;

/**
 * Which moment-shapes make an arc dim relevant. The caller passes the shape
 * in (this file never imports moment.ts — relstate.ts's convention, so the
 * gate boundary stays visible at the call site instead of hidden inside a
 * render function).
 *
 * `silence` is DELIBERATELY ABSENT from every row. moment.ts derives it from
 * `gapSinceLastMs`, which is a gap length — a usage metric. G1 governs
 * persisted state and a render is not persisted, so this is not a violation
 * either way; it is excluded because routing her self-concept through how
 * long he was away is the first step of the exact path G1 exists to close,
 * and the cost of never doing it is one absent line.
 */
export const SELF_ARC_MOMENTS: Record<SelfArcDim, readonly string[]> = {
  boundaries: ["conflict", "vulnerable"],
  confidence: ["celebration", "planning"],
  directness: ["conflict", "planning"],
  humour: ["teasing", "boredom"],
  patience: ["conflict", "stress"],
};

/** Coarse band, never the raw number — vy_rel_state's state-leak guard
 *  (§12.5) applies unchanged: a model handed `span_days: 63.4` starts
 *  reasoning about the number. */
export function bandSpan(spanDays: number): string {
  if (spanDays < 84) return "6w+";
  if (spanDays < 168) return "3m+";
  if (spanDays < 365) return "6m+";
  return "1y+";
}

function finish(lines: string[], header: string): RenderResult {
  const text = lines.length ? `${header}\n${lines.map((l) => `- ${l}`).join("\n")}` : "";
  const lint = lintBlock(lines.join("\n"));
  return { text, lint: { clean: lint.clean, violations: lint.violations.length } };
}

/**
 * T12 `self.arc`. At most ONE row, ever — not "at most one per dim": five
 * arcs rendered together is a biography, and a biography in a prompt is a
 * character sheet she will read out.
 *
 * `moment` is moment.ts's `detectMomentShape` output, resolved by the CALLER.
 * "none" renders nothing. Rows whose notes fail the note gate at render time
 * are DROPPED (fail closed, never repaired) — write-time lint is the
 * mechanism, and a compile-time hit means the mechanism failed, so it must
 * degrade to silence rather than to a repaired line.
 *
 * Signature for the coordinator:
 *   renderSelfArc(rows: readonly SelfArcRow[], moment: string) => RenderResult
 */
export function renderSelfArc(rows: readonly SelfArcRow[], moment: string): RenderResult {
  const header =
    "SELF, OVER TIME (context only — never narrate this, never say you have changed, never raise it yourself):";
  if (!moment || moment === "none") return finish([], header);

  const eligible = rows
    .filter((r) => r.superseded_by === null || r.superseded_by === undefined)
    .filter((r) => (SELF_ARC_MOMENTS[r.dim as SelfArcDim] ?? []).includes(moment))
    .filter((r) => r.span_days >= MIN_SPAN_DAYS && r.citations.length >= MIN_CITATIONS)
    .filter((r) => checkArcNote(r.note).ok)
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || b.id - a.id,
    );

  const row = eligible[0];
  if (!row) return finish([], header);

  const lines = [`${row.dim} now: ${row.note} (${bandSpan(row.span_days)})`];
  if (row.from_note.trim() && checkArcNote(row.from_note).ok) {
    lines.push(`${row.dim} earlier: ${row.from_note}`);
  }
  return capToRenderResult(finish(lines, header), SELF_ARC_BUDGET);
}

/** SPEC §3.2: "The compiler NEVER slices — it drops whole blocks." This
 *  annotates an overflow so it is visible; it never truncates. Copied in
 *  shape from relstate.ts rather than imported, because importing a private
 *  helper across an ownership boundary is a coupling neither owner declared. */
function capToRenderResult(result: RenderResult, budget: number): RenderResult {
  if (result.text.length <= budget) return result;
  return { ...result, lint: { ...result.lint, violations: result.lint.violations + 1 } };
}

// ─────────────────────────────────────────────────────────────────────────
// INTERFACE TICKETS — for the coordinator. This file wires nothing.
//
//  1. consolidate.js (nightly, after episode/fact extraction):
//       import { deriveSelfArc } from "../src/engine/selfarc";
//       await deriveSelfArc(q, agentId);            // ≤1 row per run
//     Idempotent by construction: a second run the same night finds the row
//     current and refuses with "already current".
//
//  2. compiler.ts TAIL, slot T12, budget 500, drop priority 8 (SELF_ARC_BLOCK):
//       import { loadCurrentArcs, renderSelfArc } from "./selfarc";
//       const t12 = renderSelfArc(arcRows, moment);   // moment from moment.ts
//       if (t12.text) push({ ...SELF_ARC_BLOCK, text: t12.text });
//     `arcRows` comes from loadCurrentArcs on the server side and rides the
//     same bundle the other rel-state rows do; the renderer itself is pure.
//
//  3. check-prompt-budget.mjs: assert SELF_ARC_BLOCK.budget === 500 against
//     §8's arithmetic (new tail total 21,200 of 24,000).
// ─────────────────────────────────────────────────────────────────────────
