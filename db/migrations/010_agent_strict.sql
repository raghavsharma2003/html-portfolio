-- Migration 010 — remove the training wheels. Contract: SPEC-AGENT-LAYER §2
-- (Law E1), §6 ("the default is removed in migration 010, after the agent-scope
-- predicate is proven"), and 009's own header, which ties the compat indexes'
-- removal to this file by name.
--
-- ██ NOT APPLIED. DO NOT APPLY UNTIL THE PRECONDITION BELOW HOLDS. ██
--
-- Written by WS-AGENTSCOPE alongside the predicate so that the exit from the
-- transitional state is a reviewed artifact rather than a thing someone
-- reconstructs later from a comment. It has been validated — applied twice, in
-- order, against a full-shape FIXTURE namespace by evals/agent/isolation.mjs,
-- which then proves both halves of what it buys (see "what this buys" below).
-- It has never been run against production.
--
-- Idempotent, one statement per request (see 001/008/009 headers). Neon's
-- SQL-over-HTTP endpoint accepts exactly ONE statement per body and
-- db/migrations/apply.mjs runs them individually with no transaction, so EVERY
-- statement below is independently re-runnable: `alter column ... drop default`
-- on a column that has no default is a no-op, not an error, and `drop index if
-- exists` is the same. An apply interrupted halfway is recovered by running
-- this same file again. No DO blocks and no functions.
--
-- ── what this migration does, and what it buys ─────────────────────────────
--
--   1. Drops the `agent_id` column DEFAULT on all twenty agent-scoped tables.
--      Today a writer that never heard of agents files rows under Meera and
--      nothing complains. After this, an INSERT that does not name agent_id
--      fails the NOT NULL constraint LOUDLY. That is the entire point: the
--      alternative to a loud failure is not "no failure", it is another
--      agent's memory silently filed under Meera, which is unrecoverable
--      because nothing recorded that it happened.
--
--   2. Drops the four `*_person_compat_ix` transitional UNIQUE indexes on the
--      old person-only keys.
--
--      These are not merely redundant after (1) — they make a second agent
--      IMPOSSIBLE. Measured, not reasoned: with 009's shape in place, inserting
--      a vy_rel_state row for agent A2 and a person agent A1 already knows
--      fails with
--
--        23505 duplicate key value violates unique constraint
--              "vy_rel_state_person_compat_ix"
--
--      even though the primary key is (agent_id, person_id) and the two rows
--      differ in it. Same for vy_ritual, vy_currency, vy_india_profile.
--      evals/agent/isolation.mjs asserts this failure BEFORE applying 010 and
--      asserts it is gone after, so the gate proves this file is necessary
--      rather than asserting it. 009's header states the same conclusion in
--      advance ("It must NOT survive into a two-agent world").
--
-- ── THE PRECONDITION ───────────────────────────────────────────────────────
--
-- Every ON CONFLICT site that names a PERSON-ONLY key on one of the four
-- re-keyed tables must first be migrated to name the composite key, and every
-- INSERT into an agent-scoped table must name agent_id explicitly. Dropping the
-- compat index while a site still names `(person_id)` does not raise a type
-- error — it raises `42P10 there is no unique or exclusion constraint matching
-- the ON CONFLICT specification` at RUNTIME, and seven of the ten sites 009
-- enumerated are `.catch()`-swallowed. The failure mode is therefore not an
-- error anyone sees: it is `relstate-zero-rows` a second time, writers silently
-- not writing, discovered months later.
--
-- The ten sites from 009's header, with their current state:
--
--   MIGRATED (WS-AGENTSCOPE, this wave — now name the composite key):
--     api/memory.js       rebuildRelState        on conflict (agent_id, person_id)
--                         opSeedCurrency         on conflict (agent_id, person_id, topic)
--     api/consolidate.js  refreshDerivedDims     on conflict (agent_id, person_id)
--                         deriveRelEventsForPerson
--                                                on conflict (agent_id, person_id)
--                         deriveTrustRepairForPerson (rupture/repair)
--                                                on conflict (agent_id, person_id)
--                         deriveTrustRepairForPerson (trust)
--                                                on conflict (agent_id, person_id)
--
--   MIGRATED after the original readiness note (all now name agent_id):
--     src/engine/relstate.ts       vy_rel_state      on conflict (agent_id, person_id)
--     src/engine/india.ts          vy_ritual         on conflict (agent_id, person_id, key)
--     src/engine/india.ts          vy_currency       on conflict (agent_id, person_id, topic)
--     src/engine/india.ts          vy_india_profile  on conflict (agent_id, person_id)
--
--   These QueryFn-injected client-bundle writers always name agent_id in SQL;
--   trusted production call chains pass the active agent explicitly. The
--   offline `agentstrict` gate protects this precondition before live apply.
--
--   NOT blockers, listed so nobody re-derives them as such:
--     api/clock.js:166             vy_person         — person-INTRINSIC (§2);
--                                                     no agent_id, never gains one
--     api/consolidate.js:1403      vy_phrase         — arbiter is vy_phrase's own
--                                                     (person_id, lower(phrase))
--                                                     unique index, untouched by
--                                                     009 and not dropped here
--     src/engine/india.ts:82       vy_kin            — arbiter is vy_kin_ix
--                                                     (person_id, lower(name)),
--                                                     untouched by 009
--     api/consolidate-sweep.js:196 vy_consolidate_lease — not agent-scoped
--     db/migrations/backfill_001_person.mjs:54  vy_person — person-intrinsic
--
--   Note that vy_phrase's and vy_kin's person-only unique indexes are a SECOND
--   AGENT CORRECTNESS question of their own (two agents may legitimately coin
--   the same phrase, or record the same aunt, with the same person) — but they
--   are not 010's business, because 010 does not touch them and nothing breaks
--   the day it runs. Ticketed, not folded in.
--
-- ── VERIFY THE PRECONDITION BEFORE APPLYING ────────────────────────────────
--
-- (a) The code half. From the repo root — this must print NOTHING:
--
--       grep -rn "on conflict (person_id)" \
--            --include=*.js --include=*.ts --include=*.mjs . \
--            --exclude-dir=node_modules --exclude-dir=dist \
--         | grep -v "vy_person\|vy_consolidate_lease"
--       grep -rn "on conflict (person_id, key)\|on conflict (person_id, topic)" \
--            --include=*.js --include=*.ts --include=*.mjs . \
--            --exclude-dir=node_modules --exclude-dir=dist
--
--     and `node evals/agent/isolation.mjs` must pass, whose call-site arm
--     asserts that every statement over an agent-scoped table in
--     api/memory.js and api/consolidate.js is either scoped by
--     api/_agentscope.js's predicate, an INSERT naming agent_id, or a declared
--     forget-lane exception.
--
-- (b) The schema half. Dropping a unique index is only safe if the composite
--     primary key it shadows actually exists to take over as the arbiter. This
--     must return exactly four rows, all with pk_cols = the composite key:
--
--       select c.relname as tbl,
--              (select string_agg(a.attname, ',' order by k.ord)
--                 from unnest(i.indkey) with ordinality k(attnum, ord)
--                 join pg_attribute a
--                   on a.attrelid = c.oid and a.attnum = k.attnum) as pk_cols
--         from pg_class c
--         join pg_index i on i.indrelid = c.oid and i.indisprimary
--        where c.relname in ('vy_rel_state','vy_ritual','vy_currency',
--                            'vy_india_profile')
--        order by 1;
--
--       expected:
--         vy_currency       agent_id,person_id,topic
--         vy_india_profile  agent_id,person_id
--         vy_rel_state      agent_id,person_id
--         vy_ritual         agent_id,person_id,key
--
-- (c) The data half. 009's PK swap was safe because these four tables held zero
--     rows. That is no longer the relevant question here — what matters is that
--     dropping the person-only unique index cannot orphan an arbiter, which (b)
--     settles. No row count is required.
--
-- ── after this migration ───────────────────────────────────────────────────
--
-- One known follow-on, named rather than left to be discovered:
-- api/memory.js's rebuildRelState rebuilds ONE agent's snapshot after a forget,
-- while the forget cascade itself deletes the person's rows across ALL agents
-- (§6, and G-E5 depends on it staying that way). With one agent those agree;
-- with two, a partial forget leaves the other agent's snapshot stale. The fix
-- is a loop over the agents holding rows for that person and it belongs with
-- whoever ships agent two.

-- ── 1. drop the agent_id column DEFAULT on all twenty agent-scoped tables ──
--
-- Order matches 009's, so the two files diff against each other cleanly.

alter table vy_episode alter column agent_id drop default;
alter table vy_fact alter column agent_id drop default;
alter table vy_rel_state alter column agent_id drop default;
alter table vy_rel_event alter column agent_id drop default;
alter table vy_pattern alter column agent_id drop default;
alter table vy_phrase alter column agent_id drop default;
alter table vy_ritual alter column agent_id drop default;
alter table vy_currency alter column agent_id drop default;
alter table vy_kin alter column agent_id drop default;
alter table vy_india_profile alter column agent_id drop default;
alter table vy_taste_candidate alter column agent_id drop default;
alter table vy_shared_moment alter column agent_id drop default;
alter table vy_visual_assertion alter column agent_id drop default;
alter table vy_embedding alter column agent_id drop default;
alter table vy_derivation alter column agent_id drop default;
alter table vy_session alter column agent_id drop default;
alter table vy_group_member alter column agent_id drop default;
alter table vy_group alter column agent_id drop default;
alter table vy_group_turn alter column agent_id drop default;
alter table vy_disclosure_grant alter column agent_id drop default;

-- ── 2. drop the four transitional person-only unique indexes ───────────────
--
-- 009 created these to keep the ten ON CONFLICT arbiters resolving while the
-- call sites were migrated, and said in its own header that they must not
-- survive into a two-agent world. They are the reason a second agent cannot
-- currently hold rel_state, a ritual, a currency row or an india profile for a
-- person Meera already knows — see the measured 23505 above.

drop index if exists vy_rel_state_person_compat_ix;
drop index if exists vy_ritual_person_compat_ix;
drop index if exists vy_currency_person_compat_ix;
drop index if exists vy_india_profile_person_compat_ix;

-- ── 3. widen the two person-only unique indexes that are NOT PKs ───────────
--
-- Added by the coordinator after WS-AGENTSCOPE named them as an interface
-- ticket rather than a blocker. They were right that these do not block 010;
-- they are, however, the same class of defect one level down, and leaving
-- them would make 010 a half-fix.
--
--   vy_kin_ix    unique (person_id, lower(name))
--   vy_phrase_ix unique (person_id, lower(phrase))
--
-- Neither is a primary key, so neither shows up in a PK audit — but both are
-- ON CONFLICT arbiters (src/engine/india.ts writeKin, api/consolidate.js
-- capturePhrasesForPerson), and both are person-only. The consequence is
-- exactly the one `pk-is-an-arbiter` describes: two agents cannot record the
-- same kin name or coin the same phrase with the same person, and the second
-- one fails 23505 rather than doing anything visible.
--
-- Two agents legitimately CAN know that this person's chachi is called Bua,
-- and can each coin the same phrase with them independently — those are
-- separate relationships and separate rows. The index has to say so.
--
-- Both call sites are migrated in the same change that applies this.
-- Idempotent: drop-then-create, and both tables hold zero rows.

drop index if exists vy_kin_ix;
create unique index if not exists vy_kin_ix on vy_kin (agent_id, person_id, lower(name));
drop index if exists vy_phrase_ix;
create unique index if not exists vy_phrase_ix on vy_phrase (agent_id, person_id, lower(phrase));
