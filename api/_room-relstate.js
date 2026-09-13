// RelationOS in the Room (WS-R154). The Room reply carries a follower's
// remembered FACTS (`api/_room-memory-authority.js`) but, until this
// workstream, no relationship STATE at all — the engine's own honorific,
// trust, rupture/repair and code-switch dims (`src/engine/relstate.ts`,
// `vy_rel_state`/`vy_rel_event`) had never been read for, or written by, a
// Room follower's dyad.
//
// ── WHY THIS FILE NEEDS NO MIGRATION (read this before adding one) ────────
//
// `vy_rel_state`/`vy_rel_event` ALREADY scope by (agent_id, person_id) —
// migration 009 widened both primary keys for exactly this future (its own
// header: "agent enters at retrieval, not at identification";
// `context/rejected.md#pk-is-an-arbiter` is the migration that paid for the
// composite key this file now reuses for free). And a Room follower's own
// dyad key IS that pair: the Room's follower row carries `person_id` AND
// `agent_id` per row (unique on `(room_id, person_id)`), `vy_room` carries a
// unique `replica_id`, and `api/_replica-runtime.js`'s `created_agent` CTE
// mints a FRESH `gen_random_uuid()` agent for a replica only when
// `s.agent_id is null` and binds it permanently onto `vy_replica.agent_id` —
// so one replica gets exactly one agent, one room has exactly one replica,
// and therefore `(agent_id, person_id)` already IS `(room_id, follower)` in
// every case this schema can produce. No two rooms (different creators) can
// ever share an agent_id (each is freshly minted), so two followers of two
// different creators can never collide here, and the leak battery's layer
// 19 (`evals/room-leak/run.mjs`) proves the same for two followers of the
// SAME room. `context/decisions.md#ws-r154-no-migration-165` has the full
// citation chain.
//
// This ALSO means erasure and export need no new code: both tables already
// carry a `PERSON_TABLES` entry with `agent: true` (`api/memory.js`), so
// `api/_room-surface.js`'s `roomScopedTables()` (which filters exactly that
// flag) already reaches them from `roomForgetCore` and `roomExportManifest`
// — and `api/_room-export-readable.js`'s `TABLE_COPY` already carries a
// two-locale sentence for both `vy_rel_event` and `vy_rel_state`. Verified
// by reading, not assumed; `evals/room-relstate/run.mjs` asserts the
// `PERSON_TABLES` entries and `TABLE_COPY` entries exist by name so a future
// edit that removes either fails this suite by name too.
//
// ── WHY THIS FILE MIRRORS RELSTATE.TS'S FOLD INSTEAD OF IMPORTING IT ───────
//
// `src/engine/relstate.ts` is a `.ts` file compiled by Vite; every `api/*.js`
// file in this repo runs as plain Node on Vercel with no such build step,
// and NONE of them imports anything under `src/` (grepped before writing
// this file, `src/studio/pulseApi.ts`'s own header states the identical
// rule the other direction). So the ONE dim this file ever moves — repair,
// from "open" to "repaired" — is applied here as a narrow, direct SQL
// update, never a re-implementation of the general replay fold
// (`api/memory.js`'s own `rebuildRelState` already re-derives that fold in
// plain JS for the forget cascade; duplicating it a third time here for one
// dim would be the wrong trade). The DERIVED display fields (the stage
// word, whether a rupture reads as currently open or settled by time) are
// never computed here at all: `src/room/AccountPage.tsx` is client TypeScript
// and imports `stageForDims`/`ruptureStance` from `../../engine/relstate`
// directly, exactly as `src/components/MoreSheet.tsx` already does for
// Meera's own closeness card (relstate.ts's own "GAP 4" comment) — one
// function, one place, never drifting between what the model sees and what
// either UI shows.
//
// ── WHAT THIS FILE DOES NOT DO ─────────────────────────────────────────────
//
// It does not fetch `vy_pattern`/`vy_ritual`/`vy_currency`/`vy_india_profile`/
// `vy_kin`/`vy_phrase` rows for a Room follower. Those are dyadic derivations
// the nightly consolidator writes (`context/rejected.md#relstate-zero-rows`,
// `#never-scheduled`) and no workstream has ever wired that consolidator to
// run over a Room follower's `agent_id` — wiring it is WS-CONSOLIDATE's job,
// not named in this brief, and fabricating those blocks here would be
// exactly the "citation law" violation `writeRelEvent`'s own header warns
// against. `fetchRoomRelBundle` below hands the compiler empty arrays for
// all of them, which is byte-identical to "nothing eligible yet" for every
// follower today (matches `relstate-zero-rows`'s own finding that this
// entire family of tables holds zero production rows).
import { MEERA_AGENT_ID } from "./_agentscope.js";

/** This file, like `_room-memory-authority.js` one file over, imports
 *  NOTHING from `_room-surface.js` — that file imports FROM this one
 *  (for `fetchRoomRelBundle` inside `roomSay`, and for the two ops below),
 *  and a dependency the other way would be a cycle. Every function here
 *  therefore takes an already-resolved `follower` row (`_room-surface.js`'s
 *  own `followerRow` shape: `person_id`, `agent_id`, `memory_consent_at`,
 *  `age_attested_at`) rather than a session — the caller has already run
 *  `selfScope` and `followerRow` and checked attestation by the time either
 *  reaches here, `roomRememberedThings`'s own call shape one file over. */

/**
 * The compiler's raw ingredients for T2/T4/T6, scoped to ONE dyad. Returns
 * `null` when no `vy_rel_state` row exists yet for this (agent, person) —
 * the SAME byte-identity safety frame `api/memory.js`'s `fetchRelBundle`
 * uses for Meera's own DM path: `compile()` never calls a render function
 * without a bundle, so a follower with no relational data produces the
 * exact same prompt as before this workstream.
 */
export async function fetchRoomRelBundle(db, { personId, agentId }) {
  const stateRows = await db(
    `select honorific, cs_ratio, cs_on_stress, trust, rupture_open, repair_state,
            ritual_density, pacing_gap_s, snapshot_ver, updated_at
       from vy_rel_state
      where person_id = ($1)::uuid and agent_id = ($2)::uuid
      limit 1`,
    [String(personId), String(agentId)],
  ).catch(() => []);
  if (!stateRows.length) return null;
  const s = stateRows[0];

  const [honorificRow, ruptureMoveRow] = await Promise.all([
    db(
      `select at from vy_rel_event
        where person_id = ($1)::uuid and agent_id = ($2)::uuid and dim = 'honorific'
        order by at desc limit 1`,
      [String(personId), String(agentId)],
    ).catch(() => []),
    // record-vs-stance split (context/rejected.md `rupture-never-closes`):
    // the timestamp `ruptureStance` lapses FROM, most recent dim in
    // ('rupture','repair'), whichever moved last. Query only.
    db(
      `select at from vy_rel_event
        where person_id = ($1)::uuid and agent_id = ($2)::uuid and dim in ('rupture', 'repair')
        order by at desc limit 1`,
      [String(personId), String(agentId)],
    ).catch(() => []),
  ]);
  const lastRuptureMoveAt = ruptureMoveRow[0]?.at ?? null;

  let warmEpisodesSinceRupture = 0;
  if (s.rupture_open && lastRuptureMoveAt) {
    const warmRows = await db(
      `select count(*)::int as c from vy_episode
        where person_id = ($1)::uuid and agent_id = ($2)::uuid
          and started_at > ($3)::timestamptz
          and provisional = false and group_id is null and superseded_by is null`,
      [String(personId), String(agentId), lastRuptureMoveAt],
    ).catch(() => []);
    warmEpisodesSinceRupture = Number(warmRows[0]?.c ?? 0);
  }

  return {
    relState: {
      person_id: String(personId),
      honorific: s.honorific,
      cs_ratio: s.cs_ratio === null || s.cs_ratio === undefined ? null : Number(s.cs_ratio),
      cs_on_stress: s.cs_on_stress,
      trust: Number(s.trust),
      rupture_open: Boolean(s.rupture_open),
      repair_state: s.repair_state,
      ritual_density: Number(s.ritual_density),
      pacing_gap_s: s.pacing_gap_s === null || s.pacing_gap_s === undefined ? null : Number(s.pacing_gap_s),
      snapshot_ver: Number(s.snapshot_ver),
      updated_at: s.updated_at,
    },
    lastHonorificMoveAt: honorificRow[0]?.at ?? null,
    lastRuptureMoveAt,
    warmEpisodesSinceRupture,
    // Dyadic derivations this workstream does not populate — see file header.
    patterns: [],
    rituals: [],
    homeRegion: null,
    currency: [],
    weEpisodes: [],
    phrases: [],
    phraseLedger: [],
  };
}

/**
 * OP: relstate — "How we are", the follower's own account-page read. Raw
 * fields only: the display words (stage, "open"/"settled"/"none") are
 * computed by the CLIENT from the exact same `relstate.ts` functions the
 * compiler uses (`src/room/AccountPage.tsx`'s own import), never
 * re-derived here.
 *
 * `has_state: false` is an HONEST state, not an error — `relstate-zero-rows`
 * measured this as the common case for every dyad in this schema today
 * (no workstream has ever scheduled the consolidator over a Room follower's
 * agent_id), and law 3's "their choice is the predicate" applies here
 * exactly as it does to the compiled reply: memory off hides the section
 * the same way `roomRememberedThings` already hides remembered facts.
 */
export async function roomRelStateFromFollower(db, follower) {
  if (follower.memory_consent_at == null) return { has_state: false, memory_on: false };
  const bundle = await fetchRoomRelBundle(db, { personId: follower.person_id, agentId: follower.agent_id });
  if (!bundle) return { has_state: false, memory_on: true };
  return {
    has_state: true,
    memory_on: true,
    honorific: bundle.relState.honorific,
    trust: bundle.relState.trust,
    rupture_open: bundle.relState.rupture_open,
    repair_state: bundle.relState.repair_state,
    last_honorific_move_at: bundle.lastHonorificMoveAt,
    last_rupture_move_at: bundle.lastRuptureMoveAt,
    warm_episodes_since_rupture: bundle.warmEpisodesSinceRupture,
  };
}

/**
 * OP: relstate_reset — "Start fresh." The follower's own EXPLICIT signal
 * that they want the AI to stop holding an open rupture against them, the
 * deliberate, agency-having counterpart to `ruptureStance`'s automatic
 * time/warmth lapse (`context/rejected.md#rupture-never-closes`): where the
 * stance lapses on its own after 21 days or 8 warm episodes with no signal
 * required, this gives the follower a way to say the equivalent thing
 * themselves, today, in their own words, on their own account page.
 *
 * Writes a NEW `vy_rel_event` (dim='repair', to_v='repaired') — it never
 * deletes the rupture's own history, exactly the workstream brief's own
 * words. Citations are carried forward from whichever `vy_rel_event` most
 * recently moved rupture/repair for this dyad, never fabricated: this
 * action asserts nothing new about what happened, only that the follower
 * wants the STANCE closed on a record that already, verifiably, cites real
 * episodes (`vy_rel_event_cited`'s own CHECK, satisfied by construction).
 *
 * A no-op, honestly reported rather than silently accepted, when there is
 * nothing open to reset — `relstate-zero-rows` again: most dyads have no
 * row here at all yet.
 *
 * The `memory_consent_at` gate is the CALLER's job (`_room-surface.js`'s own
 * `roomRelStateReset`, on `roomCorrectRememberedThing`'s precedent one file
 * over: check consent, then call into the decision module) — this function
 * assumes it has already been checked and never re-derives it, so this file
 * stays free of the RoomError/HTTP-status vocabulary that belongs to the
 * surface layer alone.
 */
export async function roomRelStateResetFromFollower(db, follower) {
  const personId = follower.person_id;
  const agentId = follower.agent_id;

  const stateRows = await db(
    `select rupture_open, repair_state, snapshot_ver from vy_rel_state
      where person_id = ($1)::uuid and agent_id = ($2)::uuid limit 1`,
    [String(personId), String(agentId)],
  );
  const state = stateRows[0];
  if (!state || !state.rupture_open) return { reset: false, reason: "nothing_open" };

  const lastMove = await db(
    `select citations from vy_rel_event
      where person_id = ($1)::uuid and agent_id = ($2)::uuid and dim in ('rupture', 'repair')
      order by at desc, id desc limit 1`,
    [String(personId), String(agentId)],
  );
  const citations = lastMove[0]?.citations;
  if (!Array.isArray(citations) || citations.length < 1) {
    // No cited record to chain from — never fabricate one. Reported honestly
    // rather than thrown: from the follower's point of view nothing is
    // actually broken, there is simply nothing this action can safely do.
    return { reset: false, reason: "no_record" };
  }

  await db(
    `insert into vy_rel_event (person_id, agent_id, dim, from_v, to_v, direction, note, citations)
     values (($1)::uuid, ($2)::uuid, 'repair', $3, 'repaired', 'reset', $4, $5)`,
    [String(personId), String(agentId), state.repair_state, "follower reset: fresh start (account page)", citations],
  );
  const updated = await db(
    `update vy_rel_state
        set repair_state = 'repaired', rupture_open = false,
            snapshot_ver = snapshot_ver + 1, updated_at = now()
      where person_id = ($1)::uuid and agent_id = ($2)::uuid
      returning repair_state, rupture_open`,
    [String(personId), String(agentId)],
  );
  return {
    reset: true,
    repair_state: updated[0]?.repair_state ?? "repaired",
    rupture_open: updated[0]?.rupture_open ?? false,
  };
}

/** The five stage buckets `stageForDims` (`src/engine/relstate.ts`) can ever
 *  return, computed here in one aggregate-only SQL statement rather than by
 *  fetching every row and folding in JS (this file's own no-import-from-
 *  src/engine convention, restated: `stageForDims`'s FULL logic — the
 *  lapsing rupture STANCE, not just the raw flag — needs `vy_rel_event`
 *  timestamps this owner-facing card does not need to be exact about).
 *
 * DELIBERATE SIMPLIFICATION, logged as a decision
 * (`context/decisions.md#ws-r154-owner-stage-counts-use-the-raw-flag`): this
 * buckets on the RECORD's raw `rupture_open`, never the lapsing STANCE
 * `ruptureStance` computes. That means a dyad whose rupture settled by time
 * or warmth weeks ago can still count here as "new"/"warming" rather than
 * its true current stage — always in the direction of UNDER-claiming
 * closeness, never over-claiming it, which is the safe direction for a
 * number a creator reads as "how close are my followers, in aggregate."
 *
 * FLOORED AT n>=5 IN THE SQL ITSELF, `_pulse.js`'s own law 3 restated: the
 * `having count(*) >= 5` clause is what makes a bucket structurally unable
 * to identify fewer than five followers, not a check in this function that
 * could be wrong. AGGREGATE-ONLY: the outermost `select` is `stage,
 * count(*)` alone — no `person_id`, no `agent_id`, no raw column — the exact
 * shape `evals/room-leak/run.mjs`'s `contentColumnLeaks` checks for
 * (`evals/room-leak/run.mjs`'s own layer 19). `api/_room-cohorts.js` calls
 * this function rather than querying `vy_rel_state` itself, so it names no
 * table at all in its own source — the same "a decision in a handler is a
 * decision no offline eval can reach" delegation `roomForget`/`roomExport`
 * already use, restated in `evals/room-leak/world.mjs`'s own `TABLE_ROLES`
 * comment for this table.
 */
export async function roomRelStateStageCounts(db, { agentId }) {
  const rows = await db(
    `select stage, count(*)::int as n from (
       select case
         when r.rupture_open then (case when r.trust < 0.45 then 'new' else 'warming' end)
         when r.trust < 0.2 then 'new'
         when r.trust < 0.45 then 'warming'
         when r.trust < 0.7 then 'settled'
         when r.trust < 0.88 then 'close'
         else 'deep'
       end as stage
       from vy_rel_state r
       where r.agent_id = ($1)::uuid
     ) s
     group by stage
     having count(*) >= 5`,
    [String(agentId)],
  );
  return rows.map((r) => ({ stage: r.stage, n: Number(r.n) }));
}

// Re-exported so `evals/room-relstate/run.mjs` can assert the agent-id
// mirror this file's own writes rely on (every write above takes `agentId`
// as a caller-supplied parameter and never defaults to Meera's, unlike
// `api/memory.js`'s DM-side writers) without importing `_agentscope.js`
// twice under two different names in the same suite.
export { MEERA_AGENT_ID };
