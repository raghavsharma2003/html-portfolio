// Her life, and who she has told — SPEC-SELF-LAYER §3. WS-LIFE.
// Ownership: this file belongs to WS-LIFE exclusively.
//
// ── WHAT THIS FIXES, because it is a live correctness bug and not a feature ──
//
// `context/rejected.md` → `life-per-person`. Her improvised self-facts are
// locked against contradiction per LISTENER: the extraction pipeline writes
// them into `vy_fact kind='meera'` cited to the episode they were said in
// (api/memory.js, api/consolidate.js), specifically so she cannot re-invent
// herself two turns later. That half is right. But `vy_fact.person_id` scopes
// the row, so the guarantee holds inside one relationship and nowhere else:
// two people can be told two contradictory versions of her flatmate and
// nothing in the system can notice.
//
// The repo already states the opposite principle in the taste table's own
// header (inner.ts): "Meera is one person, not one person per install."
// Honoured for taste, violated for self-facts. In the multiparty wedge, where
// members share context by construction, that reads as LYING rather than as
// forgetting, and that is not a failure a user forgives.
//
// The rule this file exists to enforce, stated once:
//
//   STATE THAT BELONGS TO THE AGENT IS SCOPED TO THE AGENT.
//   ONLY STATE THAT BELONGS TO THE RELATIONSHIP IS SCOPED TO THE PERSON.
//
// So: a life beat is agent-scoped (`vy_agent_life`, one life). The TELLING is
// per-relationship (`vy_agent_life_told`, one row per person who heard it).
// Getting that backwards recreates the bug. The render is an ANTI-JOIN
// (life LEFT JOIN told, untold only) and it is nearly free — one indexed
// query, no model call, no new round trip.
//
// ── THE FOUR LAWS THIS FILE IS BUILT AGAINST ─────────────────────────────
//
//  G2  SHE NEVER INITIATES CARRYING A FEELING. `renderUntold` takes a
//      REQUIRED turn gate and returns nothing on any turn she sends first —
//      the same suppression inner.ts applies to the thread, enforced here
//      rather than left to the caller's diligence (a non-optional parameter
//      makes a call site that forgot it a type error, not a bug). The
//      anti-join exists to prevent REPETITION, not to hand her a reason to
//      volunteer; the block ships "context only, never raise unprompted" in
//      its own header for the same reason every other tail block does.
//      SPEC §11's reversal condition for §3 is measured against exactly this:
//      if untold-life rendering measurably raises her self-initiated talk,
//      the section reverses.
//
//  G7  AUTHORED, NEVER GENERATED. G7's reasoning for taste applies here one
//      step worse: a view she improvises is one she can contradict tomorrow,
//      and a LIFE she improvises has DATES to contradict. Beats enter as
//      `status='pending'` and are published only by a separate owner request
//      (api/life.js). Nothing in this file's write path accepts model output:
//      `seedFromStories` reads a checked-in constant, and `markTold` writes
//      no text at all.
//
//  `recited-prompt`  A beat is the most sentence-shaped thing in this phase
//      and therefore the most likely to be read out verbatim. Every beat is
//      shape-linted AT WRITE (here and in api/life.js) and again at render;
//      a render-time hit means the write-time lint failed, which is what
//      SPEC's G-S2 gate asserts. Write shapes, never lines she could say.
//
//  `error-marked-done`  TOLD IS AN OUTCOME, NEVER AN INTENT. There is no
//      "will tell", no "queued", no "scheduled" — no column for it and no
//      argument for it. `markTold` requires a cited episode and the INSERT
//      is `insert … select` whose FROM clause is the episode itself, so the
//      database, not the caller, decides whether the row may exist.
//
// ── ARCHITECTURE ─────────────────────────────────────────────────────────
// Same client-bundle discipline as relstate.ts / india.ts: nothing here
// imports api/_db.js or api/_config.js. Every DB-facing function takes a
// `QueryFn` first argument, duck-typed against api/_db.js's `q`, so a server
// caller passes the real driver and a test passes a fake one.
//
// CALL-SITE WIRING IS NOT THIS FILE'S JOB — compiler.ts's T13 slot, the
// markTold call in the extraction pass, and the one-time seed are each
// outside WS-LIFE's file ownership and go to the coordinator as interfaces.

import { lintLine, lintBlock } from "./shapelint";
import type { QueryFn, RenderResult } from "./relstate";
// Mirrored constant, not a second source of truth — see relstate.ts's own
// note on why this comes from there rather than from agents/registry.
import { MEERA_AGENT_ID } from "./relstate";
// Static, deliberately. `seedFromStoryCatalog` used `await import()` here, but
// Chat.tsx, StoryView.tsx and persona.ts all import this module statically, so
// the dynamic form moved nothing and only printed INEFFECTIVE_DYNAMIC_IMPORT.
// The catalog is a data table (no side effects, no assets pulled at import).
import { STORIES } from "./storyCatalog";

// ─────────────────────────────────────────────────────────────────────────
// Types — mirror db/migrations/011_self_layer.sql exactly (already APPLIED).
// ─────────────────────────────────────────────────────────────────────────

/** migration 011's CHECK on vy_agent_life.kind, mirrored. */
export type LifeKind = "work" | "family" | "health" | "social" | "place" | "small";
export const LIFE_KINDS: readonly LifeKind[] = ["work", "family", "health", "social", "place", "small"];

/** migration 011's CHECK on vy_agent_life.status, mirrored.
 *  `pending`  — proposed, NOT published; invisible to `untoldFor`.
 *  `approved` — owner-published; the ONLY status the anti-join returns.
 *  `retired`  — withdrawn; disappears from the render, told-rows survive as
 *               history (she did tell them, and un-telling is not a thing). */
export type LifeStatus = "pending" | "approved" | "retired";
export const LIFE_STATUSES: readonly LifeStatus[] = ["pending", "approved", "retired"];

export interface LifeBeat {
  id: number;
  agent_id: string;
  at: string; // ISO, as returned by Postgres over SQL-HTTP
  beat: string;
  kind: LifeKind;
  arc_key: string;
  media: unknown[];
  status: LifeStatus;
}

/** What the anti-join returns: an approved beat this person has not heard.
 *  Deliberately has no person_id field — the BEAT is not theirs, only the
 *  absence of a told-row is. */
export interface UntoldRow {
  id: number;
  at: string;
  beat: string;
  kind: LifeKind;
  arc_key: string;
  media: unknown[];
}

// ─────────────────────────────────────────────────────────────────────────
// Budgets — SPEC-SELF-LAYER §8's arithmetic, as numbers, so a caller cannot
// disagree with the table. T13 `life.untold`: 700 chars, drop priority 9,
// NOT undroppable.
// ─────────────────────────────────────────────────────────────────────────

export const LIFE_UNTOLD_BUDGET = 700;
/** At most TWO. Not a style choice: an untold-life block that lists five
 *  things reads as a queue of material to get through, which is the exact
 *  failure §11 names as the reversal condition for this section. */
export const MAX_UNTOLD_BEATS = 2;
/** Hard character cap on one beat. 110 is inner.ts's own TasteItem cap, and
 *  it is chosen here by ARITHMETIC rather than taste: two beats at this
 *  length plus the header plus the longest `whenLabel` must fit inside
 *  LIFE_UNTOLD_BUDGET (see UNTOLD_WORST_CASE_CHARS below, asserted by the
 *  eval). The 14-word shape-lint cap usually binds first; this is the
 *  backstop for fourteen very long words. */
export const MAX_BEAT_CHARS = 110;

// ─────────────────────────────────────────────────────────────────────────
// THE ANTI-JOIN. This is the whole mechanism.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Exported as a string so the eval can assert the exact shape of the query
 * that ships, and so a reviewer can read the mechanism without reading the
 * function. Four clauses carry the design:
 *
 *   `l.agent_id = $2`   the life is HERS — one life, every listener. This is
 *                       the line that fixes `life-per-person`.
 *   `t.person_id = $1`  the JOIN is narrowed to THIS listener inside the ON
 *                       clause, never the WHERE — moved to WHERE it would
 *                       silently become an inner join and return nothing.
 *   `t.life_id is null` the anti-join proper: keep only beats with no told-row
 *                       for this person.
 *   `l.status='approved'` pending beats are unpublished and retired beats are
 *                       withdrawn; neither is something she has to tell.
 *
 * `l.at <= now()` because a beat dated tomorrow has not happened to her yet,
 * and a life she has not lived is not a life she is withholding.
 */
export const UNTOLD_SQL = `select l.id, l.at, l.beat, l.kind, l.arc_key, l.media
       from vy_agent_life l
       left join vy_agent_life_told t
         on t.agent_id  = l.agent_id
        and t.life_id   = l.id
        and t.person_id = ($1)::uuid
      where l.agent_id = ($2)::uuid
        and l.status   = 'approved'
        and l.at <= now()
        and t.life_id is null
      order by l.at desc
      limit $3`;

/**
 * Approved beats this person has NOT been told, newest first.
 *
 * Agent-scoped, person-filtered: `personId` never selects WHICH beats exist,
 * only which have already been heard. Read that sentence again before
 * changing this function — inverting it is the bug this file was written to
 * remove.
 */
export async function untoldFor(
  q: QueryFn,
  personId: string,
  agentId: string = MEERA_AGENT_ID,
  limit: number = MAX_UNTOLD_BEATS,
): Promise<UntoldRow[]> {
  const n = Math.max(0, Math.min(Math.floor(limit), 20));
  if (n === 0) return [];
  const rows = await q(UNTOLD_SQL, [personId, agentId, n]);
  return rows.map(toUntoldRow);
}

function toUntoldRow(r: any): UntoldRow {
  return {
    id: Number(r.id),
    at: String(r.at),
    beat: String(r.beat ?? ""),
    kind: (LIFE_KINDS as readonly string[]).includes(r.kind) ? (r.kind as LifeKind) : "small",
    arc_key: String(r.arc_key ?? ""),
    media: asArray(r.media),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// TOLD IS AN OUTCOME. `error-marked-done`.
// ─────────────────────────────────────────────────────────────────────────

export interface MarkToldResult {
  /** there is now a told-row for (agent, life, person) */
  recorded: boolean;
  /** the row already existed — she told them before, this is a re-tell */
  already: boolean;
  /** why not, when `recorded` is false. Never a silent no-op. */
  reason: string;
}

/**
 * The write that makes the anti-join mean something. Every argument is
 * required, and `episodeId` is required FOR A REASON:
 *
 * A told-row asserts a thing that happened in the world — she said it, they
 * heard it. `error-marked-done` is the law that a status may only be written
 * from the outcome, never from the intent to produce it, and the way that law
 * gets broken is always the same: someone adds an optional `episodeId`, a
 * caller omits it, and the row now means "we decided to tell them".
 *
 * Two defences, and the second is the one that holds:
 *
 *  1. An absent or non-positive `episodeId` THROWS. Not `return false` — a
 *     caller trying to record a telling with no telling in it is a
 *     programming error and should not be able to swallow it.
 *  2. The INSERT is an `insert … select` whose FROM clause is the episode.
 *     There is no VALUES list anywhere in this file. The row can only
 *     materialize if a NON-PROVISIONAL episode with that id exists, belongs
 *     to this agent, and belongs to THIS person — so the database decides,
 *     not the caller, and no argument the caller invents can bypass it.
 *
 * Room episodes carry `person_id NULL` (migration 008a), so `e.person_id =
 * ($3)::uuid` never matches one: a beat mentioned in a group room does not
 * count as having told any individual, which matches `multiparty-v1-design`'s
 * state-inert group episodes rather than quietly making an exception to them.
 */
export async function markTold(
  q: QueryFn,
  agentId: string,
  lifeId: number,
  personId: string,
  episodeId: number,
): Promise<MarkToldResult> {
  // Postgres bigints arrive as STRINGS over Neon's SQL-over-HTTP endpoint, so
  // an id handed straight back from a previous query is a string more often
  // than not. Normalize, then validate — validating first would reject every
  // real caller, and a caller who worked around that by dropping the check is
  // how the guarantee gets lost.
  const ep = Number(episodeId);
  const life = Number(lifeId);
  if (!Number.isFinite(ep) || Math.floor(ep) <= 0) {
    throw new Error(
      `markTold requires the episode she told them IN (life ${String(lifeId)}, person ${personId}): ` +
        `told is an outcome, never an intent (error-marked-done)`,
    );
  }
  if (!Number.isFinite(life) || Math.floor(life) <= 0) {
    throw new Error(`markTold requires a life beat id (got ${String(lifeId)})`);
  }

  const inserted = await q(
    `insert into vy_agent_life_told (agent_id, life_id, person_id, episode_id, at)
     select l.agent_id, l.id, e.person_id, e.id, now()
       from vy_agent_life l
       join vy_episode e
         on e.id          = ($4)::bigint
        and e.agent_id    = l.agent_id
        and e.person_id   = ($3)::uuid
        and e.provisional = false
      where l.agent_id = ($1)::uuid
        and l.id       = ($2)::bigint
        and l.status   = 'approved'
     on conflict (agent_id, life_id, person_id) do nothing
     returning life_id`,
    [agentId, Math.floor(life), personId, Math.floor(ep)],
  );
  if (inserted.length) return { recorded: true, already: false, reason: "" };

  // Nothing inserted: either the row was already there (a re-tell, which is
  // fine and idempotent) or the guard rejected it. Distinguishing the two is
  // the difference between "we already knew" and "this telling did not
  // happen", and a caller that cannot tell them apart will eventually treat
  // the second as the first.
  const existing = await q(
    `select 1 from vy_agent_life_told
      where agent_id = ($1)::uuid and life_id = ($2)::bigint and person_id = ($3)::uuid`,
    [agentId, Math.floor(life), personId],
  );
  if (existing.length) return { recorded: true, already: true, reason: "already told" };
  return {
    recorded: false,
    already: false,
    reason:
      "no cited episode: episode must exist, be final (not provisional), and belong to this agent " +
      "and this person; the beat must exist and be approved",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// T13 `life.untold` — the render.
// ─────────────────────────────────────────────────────────────────────────

/**
 * The G2 gate, as a REQUIRED argument rather than a convention.
 *
 * `sheInitiated` is true on any turn she sends first — an open, a follow-up,
 * any push. inner.ts suppresses the carried thread on exactly those turns
 * ("a low mood arriving unprompted is 'implying you suffer without them' with
 * none of the banned words typed"), and untold life is the same shape of
 * hazard wearing a friendlier face: a list of things she has not told them,
 * present on a message she chose to send, is a reason to send it.
 *
 * This is a gate on WHETHER THE BLOCK EXISTS, not on which rows it selects —
 * the same discipline as moment.ts's pull-only rule and renderWeCallbacks'
 * `pulled` flag, and the literal mechanism behind "0 unprompted raises".
 */
export interface TurnGate {
  sheInitiated: boolean;
}

/** Not a sentence, and deliberately coarse. Her own calendar only — no
 *  reading of the user, so G1 is untouched (nothing here is derived from
 *  their reply speed, silence, gaps, counts or app opens). G8's rule that a
 *  time-varying block ships its own cause holds because the label rides in
 *  the same line as the beat it dates. */
export function whenLabel(atIso: string, now: number = Date.now()): string {
  const t = new Date(atIso).getTime();
  if (!Number.isFinite(t)) return "recently";
  const days = Math.floor((now - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 31) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.max(1, Math.round(days / 30))} months ago`;
}

/**
 * T13 `life.untold` — budget 700 chars, at most 2 beats, telegraphic.
 *
 * The header does two jobs and both are load-bearing. It says what the block
 * IS (a repetition guard) and it says what the block is NOT (a list of things
 * to bring up). Written as instructional English — the shape every other tail
 * header uses — precisely because instructional English is not a line she can
 * recite; the ROWS are where `recited-prompt` bites, and those are linted.
 */
export function renderUntold(rows: readonly UntoldRow[], turn: TurnGate): RenderResult {
  // G2. First statement in the function, on purpose.
  if (turn.sheInitiated) return finish([], "");
  const picked = rows.slice(0, MAX_UNTOLD_BEATS);
  const now = Date.now();
  const lines = picked.map((r) => `${r.kind}, ${whenLabel(r.at, now)}: ${r.beat}`);
  const result = finish(lines, UNTOLD_HEADER);
  return capToRenderResult(result, LIFE_UNTOLD_BUDGET);
}

export const UNTOLD_HEADER =
  "YOUR LIFE — WHAT THEY HAVE NOT HEARD (context only, never raise unprompted). " +
  "Here so you don't re-tell them something they already heard, and so you know what would be new to them. " +
  "Not a list to get through; nothing here is a reason to start a topic. " +
  "If they ask, or it comes up on its own, this is what they don't know yet:";

/** The budget is not a hope. Worst case, asserted by evals/self/life.mjs:
 *  header + MAX_UNTOLD_BEATS lines each carrying the longest legal beat
 *  (MAX_BEAT_CHARS) under the longest `whenLabel` must fit LIFE_UNTOLD_BUDGET
 *  with room to spare — a render function that can exceed its own budget
 *  makes the compiler's drop machinery the only thing standing between a
 *  long beat and a silently truncated prompt, and `silent-truncation` eats
 *  the END of the tail, where the newest and most safety-relevant text is. */
export const UNTOLD_WORST_CASE_CHARS =
  UNTOLD_HEADER.length + MAX_UNTOLD_BEATS * (1 + 2 + 24 + MAX_BEAT_CHARS);

/** Mirrors relstate.ts's private `finish` — one line per row, lint-reported
 *  rather than lint-repaired. A violation here means the WRITE-time lint let
 *  something through, which is exactly what SPEC's G-S2 gate is looking for,
 *  so silently dropping the line would hide the signal the gate exists to
 *  catch. */
function finish(lines: string[], header: string): RenderResult {
  const text = lines.length ? `${header}\n${lines.map((l) => `- ${l}`).join("\n")}` : "";
  const lint = lintBlock(lines.join("\n"));
  return { text, lint: { clean: lint.clean, violations: lint.violations.length } };
}

/** Mirrors relstate.ts: "The compiler NEVER slices — it drops whole blocks."
 *  This annotates an overflow so it is visible; it never truncates. */
function capToRenderResult(result: RenderResult, budget: number): RenderResult {
  if (result.text.length <= budget) return result;
  return { ...result, lint: { ...result.lint, violations: result.lint.violations + 1 } };
}

// ─────────────────────────────────────────────────────────────────────────
// Write-time shape lint. `recited-prompt`.
// ─────────────────────────────────────────────────────────────────────────

export interface BeatLint {
  clean: boolean;
  reasons: string[];
}

/**
 * The predicate every write path runs before a beat may exist. shapelint.ts's
 * three content rules (>14 words, capital-start-plus-terminal-punctuation,
 * first-person-line-initial) plus two this table needs specifically:
 *
 *  - a beat carrying quoted speech is a LINE, not a shape. "told her 'you
 *    should just go'" is a phrase bank with a date attached.
 *  - a beat that ends in an emotion word with no event in it is a mood, and
 *    G5 forbids the accumulating version of that. Not enforced here (it needs
 *    judgment); flagged as an authoring rule in api/life.js's header instead,
 *    because a lint that guesses is worse than a rule that is written down.
 *
 * api/life.js carries a deliberately-duplicated copy of this predicate — it
 * is a Vercel function outside the Vite build graph, and api/taste-queue.js
 * and api/consolidate.js both state the same reason for not cross-bundling a
 * TS engine file into a serverless function. The duplication is not left to
 * good intentions: evals/self/life.mjs runs BOTH implementations over the
 * same corpus and fails if they ever disagree.
 */
export function lintBeat(beat: string): BeatLint {
  const trimmed = String(beat ?? "").trim();
  const reasons: string[] = [];
  if (!trimmed) reasons.push("empty");
  if (trimmed.length > MAX_BEAT_CHARS) {
    reasons.push(`too long: ${trimmed.length} chars (cap ${MAX_BEAT_CHARS})`);
  }
  reasons.push(...lintLine(trimmed).reasons);
  if (/["“”']\s*\w[^"“”']*["“”']/.test(trimmed) || /\bsaid\s*[:,]/i.test(trimmed)) {
    reasons.push("quoted speech: a beat is a shape, not a line she could recite");
  }
  return { clean: reasons.length === 0, reasons };
}

// ─────────────────────────────────────────────────────────────────────────
// The seed. ONE source of truth, and it is this table.
// ─────────────────────────────────────────────────────────────────────────

/** The subset of storyCatalog.ts's `Story` this seed reads. Structural, so
 *  the seed can be tested without the catalog and so nothing here depends on
 *  a file WS-LIFE does not own beyond the shape it already has. */
export interface SeedStory {
  id: string;
  at: number; // epoch ms
  desc: string;
  src?: string;
}

export interface SeedReport {
  /** rows that did not already exist and were written */
  inserted: number;
  /** rows already present under the same arc_key — the seed is idempotent */
  skipped: number;
  /** written as `approved` (shape-lint clean) */
  approved: number;
  /** written as `pending` (shape-lint dirty — see below) */
  pending: number;
  details: { arc_key: string; status: LifeStatus; inserted: boolean; reasons: string[] }[];
}

/** `arc_key` doubles as the seed's natural key. vy_agent_life has no unique
 *  constraint to hang an ON CONFLICT from (db/ is not WS-LIFE's file), so
 *  idempotency is a `where not exists` inside the INSERT — one statement,
 *  re-runnable, no DDL. */
export const storyArcKey = (storyId: string) => `story:${storyId}`;

/**
 * Import authored stories into `vy_agent_life` AS DATA, once. After this runs
 * the TABLE is the source of truth and the catalog is history — two places
 * holding her life is the `relstate-zero-rows` shape of bug waiting to
 * happen, and this function exists to end that, not to keep both in sync.
 *
 * G7, structurally: the beats come from the `stories` argument, which the
 * only shipped caller (`seedFromStoryCatalog`) fills from a checked-in
 * constant reviewed at commit time. No request body reaches this function and
 * api/life.js exposes no seed op at all — an HTTP endpoint that accepts beat
 * text in bulk is precisely the hole G7 forbids.
 *
 * THE SHAPE-LINT ASYMMETRY, stated because it looks like a bug and is not:
 * a dirty beat is seeded as `pending`, not rejected. These descs were written
 * as IMAGE CAPTIONS for `storyContext()`, not as life beats, and both of the
 * two live ones are ~20-27 words against a 14-word cap. Rejecting them loses
 * the data; approving them puts a recitable sentence in her tail. Seeding
 * them as pending does neither: they are preserved, they are invisible to the
 * anti-join, and api/life.js's `approve` re-lints before publishing, so a
 * dirty beat cannot reach a prompt without a human shortening it first.
 * Contrast api/life.js's `propose`, which REJECTS a dirty beat outright —
 * there a human is at the keyboard and can be told.
 */
export async function seedFromStories(
  q: QueryFn,
  stories: readonly SeedStory[],
  agentId: string = MEERA_AGENT_ID,
): Promise<SeedReport> {
  const report: SeedReport = { inserted: 0, skipped: 0, approved: 0, pending: 0, details: [] };
  for (const s of stories) {
    const beat = String(s.desc ?? "").trim();
    if (!beat) continue;
    const arcKey = storyArcKey(String(s.id));
    const lint = lintBeat(beat);
    const status: LifeStatus = lint.clean ? "approved" : "pending";
    const media = s.src ? [{ src: s.src }] : [];
    const rows = await q(
      `insert into vy_agent_life (agent_id, at, beat, kind, arc_key, media, status)
       select ($1)::uuid, ($2)::timestamptz, $3, 'small', $4, ($5)::jsonb, $6
        where not exists (
          select 1 from vy_agent_life where agent_id = ($1)::uuid and arc_key = $4)
       returning id`,
      [agentId, new Date(s.at).toISOString(), beat, arcKey, JSON.stringify(media), status],
    );
    const inserted = rows.length > 0;
    if (inserted) {
      report.inserted++;
      if (status === "approved") report.approved++;
      else report.pending++;
    } else {
      report.skipped++;
    }
    report.details.push({ arc_key: arcKey, status, inserted, reasons: lint.reasons });
  }
  return report;
}

/**
 * The one-time seed, wired to the real catalog. Run once; after that the
 * table is authoritative and this function is a no-op by construction (every
 * arc_key already exists).
 *
 * `storyCatalog.ts` is READ here and never written — it is not WS-LIFE's
 * file. See this workstream's report for what should happen to it afterwards.
 */
export async function seedFromStoryCatalog(
  q: QueryFn,
  agentId: string = MEERA_AGENT_ID,
): Promise<SeedReport> {
  return seedFromStories(
    q,
    STORIES.map((s) => ({ id: s.id, at: s.at, desc: s.desc, src: s.src })),
    agentId,
  );
}

// ─────────────────────────────────────────────────────────────────────────

function asArray(v: unknown): unknown[] {
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
}
