-- Migration 011 — the self layer (docs/SPEC-SELF-LAYER.md).
--
-- Five tables for the four dimensions the audit found genuinely absent, plus
-- the told-ledger that makes the third one worth having:
--
--   vy_self_arc         growth — a biography, NOT a mood (§2)
--   vy_agent_life       her life, agent-scoped so she has ONE (§3)
--   vy_agent_life_told  who she has told what, per relationship (§3)
--   vy_rel_texture      how she talks to THIS person specifically (§6)
--   vy_observation      noticing, at one citation (§7)
--
-- STRICT FROM BIRTH. Migration 010 dropped the transitional agent_id defaults
-- that 009 introduced, after they exposed thirteen writers that named no
-- agent (five of them inside .catch() swallows — see measurements
-- `strict-exposed-13`). These tables therefore ship with agent_id NOT NULL and
-- NO DEFAULT from the first statement: a writer that forgets it fails loudly
-- on day one rather than filing another agent's memory under Meera and being
-- discovered a migration later.
--
-- Every statement is independently idempotent and independently re-runnable —
-- Neon SQL-HTTP takes exactly one statement per request and db/migrations/
-- apply.mjs runs them one at a time with no transaction, so an apply
-- interrupted halfway is recovered by running the file again.

-- ── vy_self_arc — growth (§2) ─────────────────────────────────────────────
--
-- The two CHECK constraints ARE the design, and they are what makes this not
-- a mood. inner.ts's G5 forbids accumulating a sad period: a drifting
-- affective baseline, a counter of bad days, a feeling whose cause has fallen
-- out of context so a cause gets invented for it two turns later.
--
-- An arc row cannot become that, structurally: >=3 citations spanning >=42
-- days means it cannot exist without a six-week evidence trail, and `note` is
-- required to be non-affective (a claim about how she has changed, never how
-- she feels). Compare vy_pattern's "one instance is an anecdote" constraint —
-- same mechanism, one order of magnitude slower.
--
-- agent_id is NOT person-scoped on purpose. She is one person across all her
-- relationships; how she EXPRESSES that varies per relationship, and that is
-- vy_rel_texture's job, not this one's.

create table if not exists vy_self_arc (
  id            bigint generated always as identity primary key,
  agent_id      uuid not null,
  dim           text not null,
                -- directness|patience|humour|boundaries|confidence
  note          text not null,      -- telegraphic, shape-linted, NON-affective
  from_note     text not null default '',
  citations     bigint[] not null,  -- episodes evidencing the change
  span_days     real not null default 0,
  superseded_by bigint,             -- bare bigint, no FK (forget law)
  created_at    timestamptz not null default now(),
  constraint vy_self_arc_cited check (cardinality(citations) >= 3),
  constraint vy_self_arc_slow  check (span_days >= 42)
);

create index if not exists vy_self_arc_agent_ix on vy_self_arc (agent_id, dim);

-- ── vy_agent_life — she has ONE life (§3) ─────────────────────────────────
--
-- Fixes `life-per-person` (rejected.md): her improvised self-facts are locked
-- against contradiction per LISTENER, because vy_fact.person_id scopes them —
-- so two users can be told two different versions of her flatmate and nothing
-- can notice. The repo already states the opposite principle in the taste
-- table's own header: "Meera is one person, not one person per install."
--
-- Beats are AUTHORED or owner-approved, never model-generated. G7's reasoning
-- for taste applies here one step worse: a life she improvises has dates to
-- contradict. storyCatalog.ts's STORIES becomes a seed for this table rather
-- than a parallel source of truth — two places holding her life is the
-- relstate-zero-rows shape of bug waiting to happen.

create table if not exists vy_agent_life (
  id         bigint generated always as identity primary key,
  agent_id   uuid not null,
  at         timestamptz not null,
  beat       text not null,          -- telegraphic, shape-linted
  kind       text not null default 'small'
             check (kind in ('work','family','health','social','place','small')),
  arc_key    text not null default '',   -- ties beats into a thread over weeks
  media      jsonb not null default '[]'::jsonb,
  status     text not null default 'approved'
             check (status in ('pending','approved','retired')),
  created_at timestamptz not null default now()
);

create index if not exists vy_agent_life_agent_ix on vy_agent_life (agent_id, at desc);

-- ── vy_agent_life_told — the half that makes it feel human (§3) ───────────
--
-- A friend has told you about the promotion and has NOT yet told you about
-- the fight with her sister, and she knows which is which. That asymmetry is
-- the whole feature: rendered as an ANTI-JOIN (life LEFT JOIN told), untold
-- beats only, so she never re-narrates something you already heard and can
-- say "arre I didn't tell you na" to someone who hasn't.
--
-- `error-marked-done` applies: told is an OUTCOME, never an intent. A row
-- exists only when she actually told them, in a cited episode.

create table if not exists vy_agent_life_told (
  agent_id   uuid   not null,
  life_id    bigint not null,
  person_id  uuid   not null,
  at         timestamptz not null default now(),
  episode_id bigint,                 -- where she told them (edge, no FK)
  primary key (agent_id, life_id, person_id)
);

create index if not exists vy_agent_life_told_person_ix
  on vy_agent_life_told (agent_id, person_id);

-- ── vy_rel_texture — same person, different rapport (§6) ──────────────────
--
-- Derived by COUNTING turns that already exist. No LLM call, no judgment.
--
-- Rendered as coarse bands only, never numbers — vy_rel_state's existing
-- state-leak guard (§12.5) applies unchanged: a model handed teasing 0.34
-- starts reasoning about the number; handed "high" it just talks that way.
--
-- n_turns is a GATE, not a statistic: texture is not rendered below a floor,
-- because a ratio over six turns is noise, and noise rendered as "she teases
-- him a lot" is a personality assigned at random.
--
-- `avoid` is the column with teeth — topics that went badly, cited, that she
-- does not walk into again. It must fail CLOSED: over-avoiding is a mild
-- flatness, under-avoiding re-opens a wound. Same asymmetry that decided
-- `speaker-id`.

create table if not exists vy_rel_texture (
  agent_id     uuid not null,
  person_id    uuid not null,
  teasing      real not null default 0,
  humour       real not null default 0,
  media_rate   real not null default 0,
  words_median real not null default 0,
  emoji_rate   real not null default 0,
  profanity    real not null default 0,
  nickname     text not null default '',
  avoid        text[] not null default '{}',
  avoid_cites  bigint[] not null default '{}',
  n_turns      integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (agent_id, person_id)
);

-- ── vy_observation — noticing, at one citation (§7) ───────────────────────
--
-- Distinct from vy_pattern and the distinction is the point. A pattern
-- GENERALIZES ("when X, he does Y") and needs >=2 citations to write plus
-- support_count >= 3 across >= 2 days to become prompt_eligible — measured,
-- that is three calendar days and three nightly passes minimum. An
-- observation RECALLS ("he said X") and needs one citation, because the risk
-- of being wrong is misremembering a detail rather than assigning someone a
-- trait they do not have.
--
-- An observation that repeats is PROMOTED into vy_pattern by the existing
-- extractor rather than duplicated — one promotion path, so the two stores
-- cannot disagree. Rendered inside T5's existing pull-only budget: memory
-- stays reactive, and "never raise unprompted" is not being relaxed to make
-- this feel more impressive.

create table if not exists vy_observation (
  id          bigint generated always as identity primary key,
  agent_id    uuid not null,
  person_id   uuid not null,
  note        text not null,          -- telegraphic, shape-linted
  citations   bigint[] not null,
  salience    real not null default 0.5,
  times_seen  integer not null default 1,
  last_seen   timestamptz not null default now(),
  promoted_to bigint,                 -- vy_pattern id, once it generalizes
  t_invalid   timestamptz,
  created_at  timestamptz not null default now(),
  constraint vy_observation_cited check (cardinality(citations) >= 1)
);

create index if not exists vy_observation_person_ix
  on vy_observation (agent_id, person_id, last_seen desc);
