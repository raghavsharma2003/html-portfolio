# SPEC.md — Phase B synthesis: the Vyakti relational-state architecture

Final architecture, synthesized 2026-08-13 from four judged proposals
(A-graph 144.5, B-events 137, C-minimal 150.5, D-multimodal 138; 3 judges ×
4 proposals, adversarial). **Skeleton: C-minimal** — the judges' winner on
both totals and the two axes that decide whether a two-person unfunded team
ships (buildability 9/8/8, latency_cost 8/9/8) — with every
`steal_regardless` graft that survives the fatal-flaw lists, and with C's own
four fatal flaws fixed by name in §0.2. Every mechanism cites the
measurement or verified finding it stands on; every decision carries its
reversal condition (house style).

The falsifiable claim under test is unchanged: **an AI person's identity and
relationship can be made to survive replacement of the model underneath
her.** Currently measured FALSE (`charm-grok` 38–2, `realtime-azure`
41→53 words/turn, both on byte-identical prompts). This spec's job is to
make the attempt measurable and cheap to falsify, not to promise it
succeeds.

---

## 0. Governing rules and adjudications

### 0.1 The three laws of the synthesis (stated once, applied everywhere)

1. **The proven shape is the architecture.** Authored or structural state +
   deterministic retrieval + guarantees in code beats generated text +
   prompt instructions — the only measured portability win anywhere in the
   sweep (`taste-consistency` 27%→63%, n=480) and the shape of every
   measured success in the repo. Every new subsystem below either has this
   shape or names which charter G-rule covers it.

2. **The two-mechanism rule** (grafted from A §9.1, adopted as spec text):
   - **Belief changed** → invalidation: `t_invalid` set, `superseded_by`
     set, row kept. Belief history is relationship content (Zep §2.2.3,
     VERIFIED).
   - **User said forget** → hard delete of the ENTIRE lineage: the row,
     every row reachable via `superseded_by` chains in both directions,
     embeddings, and every derived dependent by citation-join. No
     tombstones. Bi-temporal history LOSES to honest forget, explicitly and
     by design: a memory still in the table is still a memory.

3. **"Rebuildable" is three separable guarantees** (grafted from B §0,
   adopted verbatim): **deletable** (pure SQL citation-join — deterministic),
   **auditable** (every derived row's derivation record stored: model,
   prompt hash, input span), **re-derivable** (a rebuild may produce
   different-but-equally-cited rows; it must pass the invariant suite and
   the entailment audit). Bit-identity is claimed only where achievable and
   needed: deletion and context compilation. Nothing depends on LLM
   determinism.

### 0.2 C's four fatal flaws, fixed by name

1. **Same-day memory gap** (nightly-only durable writes = a fact told at
   lunch is unrecallable that evening — a quality regression the owner's
   standing instruction forbids). **Fix:** the in-turn pass writes
   *provisional* episodes and *provisional* facts (citing the provisional
   episode's live log range) that are recallable immediately; the nightly
   pass finalizes boundaries, re-derives with full citations, and
   supersedes the provisional tier (§4.1). Same-day recall never regresses
   below today's shipped behavior.
2. **Budget arithmetic vs `silent-truncation`** (C's caps summed 72,000
   chars against SYSTEM_MAX 64,000, so at cap the outer guard would eat the
   END — the exact failure the law exists to prevent). **Fix:** core cap
   40,000 + tail cap 24,000 = 64,000 = SYSTEM_MAX exactly; CI asserts
   cap-sum ≤ SYSTEM_MAX and asserts the undroppable-set sum (44,600 chars)
   sits under the caps with stated headroom (§3.3).
3. **Deferred constraint triggers don't run on Neon SQL-over-HTTP** (no
   interactive multi-statement transactions; the design's central guarantee
   couldn't execute on the stated database). **Fix:** citations become an
   in-row `bigint[]` column with a `CHECK` + GIN index (A's mechanism —
   single-statement, executes over SQL-HTTP), backed by writer-side window
   validation (B) and a sampled entailment audit (B), §4.3. The FK
   join-table + deferred-trigger design is **rejected**.
4. **Item-scope forget could orphan derived state** (summary-term match
   misses the "kaam stress" vs "office pressure" gap C itself cites).
   **Fix:** forget deletes episodes by **log-range intersection** (D's
   mechanism: any `vy_episode` whose `log_from..log_to` intersects deleted
   `meera_log` rows dies), then citation-join cascades (§9.1). Term match
   is only an *additional* net, never the primary mechanism.

### 0.3 Adjudications — where the judges disagreed, decided

| dispute | ruling | why |
|---|---|---|
| **Statutory AI-disclosure: model recitation (A, D) vs app voice (B, C)** | **App voice.** The app shows the disclosure card; T9 is a machine-readable note so she never contradicts it and owns it plainly if asked (never-deny-AI). A client mirror timer fails toward disclosing. | The repo's own measurements prove instruction ≠ emission (`charm-luna` 0/144 media tags against an explicit instruction; `prompt-position` 0/8 mid-brief). A CA SB 243 disclosure with a $1,000/violation private right of action cannot be probabilistic. All three judges converged here against A and D. |
| **Confabulation tripwire: lexical anchor (A) vs entailment audit (B)** | **Entailment audit** (sampled 5%, 100% for rel-state transitions and patterns; >2% refutation halts the consolidator and pages the owner). Lexical overlap is **rejected**. | "kaam stress" vs "office pressure" is the repo's own documented case where a correct derivation shares zero surface words; a lexical sweep would systematically retract correct Hinglish paraphrase — the normal case for this product — or pressure the extractor to copy words, fighting the shape-lint. |
| **Citation enforcement: FK join tables + deferred triggers (C) vs array + CHECK (A) vs writer window (B)** | **All three of: array `citations` + CHECK (schema), writer window validation (write path), entailment audit + nightly zero-orphan sweep (audit).** | Only the array form executes as single statements over SQL-HTTP (§0.2.3); B's window rule is the cheapest confabulation guard proposed by any proposal (a citation outside `[input_from, input_to]` is confabulation by construction); A's zero-orphan sweep makes DPDP derived-state deletion a regulator-showable assertion. |
| **Substrate: new `vk_events` superseding + dropping `meera_log` (B) vs `meera_log` stays ground truth (A, C, D)** | **`meera_log` stays, untouched.** Episodes cite it by id range. | `meera_log` carries an explicit KEEP verdict; the forget stack's windowed scopes, telemetry purge, and client prune are keyed against it. Dropping it is blast radius for zero product gain (judge finding against B). |
| **Vector retrieval: global HNSW (B, D) vs device-filtered exact scan (A)** | **Exact scan under a person filter, `halfvec(1536)` (3 KB/row).** HNSW is **rejected** at this scale. | Per-dyad corpora are 10^3–10^4 rows; post-filtered ANN over a multi-tenant index silently returns few or zero rows for small corpora — the `semantic-recall` defect reintroduced. "Index the filter, scan the vectors." halfvec is B's storage math, adopted (§2.5). |
| **D2 target framing: staged raw-text ≤65% (A) vs two-tier relational-features (C) vs <2pp reversal (B)** | **Merged: C's two-tier framing + A's staged milestone targets applied to the relational-feature classifier + B's quantified reversal.** Full pre-registration in §10-Q1. | Machine fingerprinting of raw text is 97.1% solved offense — a raw-text ≤65% target is a pre-registered failure (judge finding against A/B/D). A's 70–90% dead zone and B's single reversal are both closed by combining staging with the <2pp-per-milestone and ≥10pp-total conditions. |
| **Live-lane core cut ~48k → ~5.5k tok (D)** | **Rejected for Phase C.** The live lane keeps its current instruction; the compiler treats it as compile-once-at-pickup (already shipped behavior). | A >50% persona cut on the lane where `realtime-azure` measured register collapse, with no charm-equivalence gate, is a quality-for-latency trade the owner's standing instruction forbids. Revisit only with a dedicated paired n≥300 live-lane equivalence run. |
| **On-device SER in the call path (D M4)** | **Deferred out of Phase C.** Voice-affect tags ship as v0: transcript + timing features only (deterministic, zero new models). SER returns only behind a named audio-floor regression battery (self-duck, barge-in @279 ms, RELEASE_WATCHDOG_MS 600 re-measured). | The audio floor is the repo's most millisecond-measured subsystem; CPU contention on a mid-range Android during a live call can silently undo measured wins — the exact failure class rejected.md exists to prevent. EchoMind predicts a small on-device model lands in fallback territory anyway. |
| **Backfill: unbounded LLM sweep (D) vs bounded K=200 (A); synthetic legacy citations (A, C) vs quarantine (B)** | **Bounded backfill (deterministic boundaries for all history; LLM consolidation for top-K=200 salient episodes/device, ≈$0.25/device) + B's legacy quarantine**: uncited legacy rows are barred from being cited by new derivations, over-deleted on any plausibly-covering forget scope, and retired when a cited re-derivation lands. | Synthetic "legacy episode" citations let the CHECK and the sweep pass on rows whose trail proves nothing — decorative citations on exactly the regex-era rows most likely to be confidently wrong. Free tiers are daily budgets. |
| **Persona factoring charm risk (B's un-gated 3,800-tok core)** | **C's behavior-frozen extraction:** the compiler first produces byte-identical output to today's assembly, asserted by hash over the eval corpus, before any feature flips on. No content cut happens at extraction, so no charm gate is needed there. Any later re-authoring of core content gets a paired n≥300 dual-judge equivalence run before cutover. | The 45k-char persona won `charm-grok` 38–2; it is the product. Byte-identity first is the single safest migration technique any proposal offered. |
| **Same-day durable writes (B/D session pass) vs nightly-only (C)** | **Both tiers:** in-turn provisional writes + nightly finalization (§0.2.1, §4.1). | ANCHOR's weakest measured axis everywhere is user-state recall; regressing it violates the no-quality-tradeoffs instruction. |
| **`unverified` age tier: most-restricted-adult (A) vs minor-safe defaults (B, D)** | **Minor-safe defaults.** Launch is verified-adult-only; `unverified` structurally receives the minor-safe configuration; the engine refuses engagement mechanics for `minor` even if product flags are misconfigured (D's hard-refusal). | Fail-safe direction under DPDP; the schema encodes the company-defining choice as config either way. |
| **Bi-temporality: full four-timestamp quadruple (A, B) vs none (D)** | **Confined:** `t_valid`/`t_invalid` + `superseded_by` on `vy_fact` only, plus a `retracted_at` for integrity-sweep retractions. The full ingestion timeline is not built; A's pre-declared degrade path is taken up front. | Bi-temporality earns its keep on exactly one table (beliefs). The quadruple's extra timeline buys extractor-error forensics a two-person team can live without; `retracted_at` covers the one real need. Reverses if lineage forensics are needed twice in one quarter. |

---

## 1. Component map

Eleven components. Six lift existing code, two rebuild existing code, three
are new. Everything reuses an operational pattern the repo already runs
(GH-Actions cron per `culture.yml`, `meera_state` sync, existing OTP auth,
existing `api/chat.js` caps as outer guard) — or it is not in this spec.

```
                    ┌──────────────────────────────────────────────────────┐
                    │  CONTEXT COMPILER  src/engine/compiler.ts (REBUILD)   │
                    │  typed blocks · char budgets · manifest · shape-lint  │
                    │  byte-stable CORE / volatile TAIL / rules dead last   │
                    │  M2 rule: byte-identical to today FIRST, then flags   │
                    └───────▲──────────▲──────────▲──────────▲─────────────┘
                            │          │          │          │
     ┌──────────────┐ ┌─────┴────┐ ┌───┴─────┐ ┌──┴───────┐ ┌┴───────────┐
     │ IDENTITY CORE│ │ WE-STORE │ │ EPISODIC│ │ INDIA    │ │ PER-MODEL  │
     │ canon+taste+ │ │ rel_state│ │ MEMORY  │ │ STATE    │ │ ADAPTER    │
     │ invariants   │ │ +events, │ │ episodes│ │ register │ │ (data row, │
     │ (LIFT persona│ │ patterns,│ │ +facts, │ │ kin,     │ │ re-derived │
     │  + inner)    │ │ phrases  │ │ cited   │ │ rituals  │ │ per model) │
     └──────────────┘ └─────▲────┘ └───▲─────┘ └──────────┘ └─────▲──────┘
                            │          │                          │
                    ┌───────┴──────────┴────────┐        ┌────────┴────────┐
                    │ CONSOLIDATION v2           │        │ MODEL ROUTER    │
                    │ in-turn pass KEPT (writes  │        │ vy_model table +│
                    │ provisional tier, same-day │        │ fingerprint gate│
                    │ recall) · nightly finalize │        │ + sham no-op    │
                    │ (GH-Actions cron 03:30 IST)│        │ (REBUILD chain) │
                    └───────▲────────────────────┘        └────────▲────────┘
                            │                                      │
     ┌──────────────────────┴──────────┐            ┌──────────────┴───────┐
     │ meera_log (KEEP, ground truth)  │            │ EVAL SUITE / D0–D6   │
     │ + FORGET STACK (KEEP, extended: │            │ evals/* + replay.mjs │
     │  log-range → citation-join      │            │ + weekly drift cron  │
     │  cascade → state replay-rebuild)│            │ + prosody baseline   │
     └─────────────────────────────────┘            └──────────────────────┘
     ┌───────────────────────────────────────────────────────────────────┐
     │ SAFETY/REG RAIL: session clock (app-voiced) · export op ·         │
     │ age tier · vy_derivation audit log · vy_gate_run audit            │
     └───────────────────────────────────────────────────────────────────┘
     ┌───────────────────────────────────────────────────────────────────┐
     │ LIVE-LANE EPISODE WRITERS (NEW, small): provisional episode rows  │
     │ during calls; visual_assertions + shared_moments at scene wakes   │
     │ (extract-during-turn — no vendor live context is a durable store) │
     └───────────────────────────────────────────────────────────────────┘
```

| # | Component | Verdict vs repo | Notes |
|---|---|---|---|
| 1 | Identity core (canon + taste + invariants + adapter split) | LIFT persona.ts/inner.ts | behavior-frozen extraction first |
| 2 | Context compiler | REBUILD of brain.ts assembly | §3 |
| 3 | Episodic memory (episodes, bi-temporal facts, citations) | LIFT meera_nodes shape + new tables | §2 |
| 4 | Consolidation v2 (in-turn provisional + nightly finalize) | LIFT opRemember + new | §4 |
| 5 | WE-store (rel state/events, patterns, phrases) | NEW (salvage 'phrase', `feel`) | §6 |
| 6 | India state | NEW (india.md §7 adopted) | §8 |
| 7 | Model router + adapters | REBUILD fallback chain as data | §7 |
| 8 | Eval suite / D-battery / replay | KEEP methodology; NEW harness | §7.3, §14 |
| 9 | Safety/reg rail (export, clock, age tier, audits) | NEW (small) | §9 |
| 10 | Forget stack | KEEP near-verbatim, extended | §9.1 |
| 11 | Live-lane episode writers | NEW (small, v0 deterministic) | §4.1 |

Explicitly NOT in Phase C: a knowledge-graph engine, PageRank retrieval
(named upgrade path), HNSW indexes, on-device SER (§0.3), any realtime-lane
model change (`live-model-swap` rejected, stands), any live-lane prompt cut,
watch-frame retention (contradicts shipped honesty text — owner decision,
repo-audit §3d), any new paid service.

---

## 2. SQL schema (Neon) and migration path

### 2.1 Design rules the schema encodes

- **Additive migrations only**; idempotent DDL, same discipline as
  `db/schema.sql`. Nothing existing is dropped in Phase C.
- **Person over device** (all three judges flagged its absence in A as
  thesis-level): `vy_person` maps devices to a person; every new table keys
  on `person_id`; legacy tables keep `device_id` and are read through the
  mapping. Until a device is linked, `person_id := device_id` cast — one
  code path for anonymous and signed-in. Merges only via signed-in account
  evidence (`meera_state.user_id`), never heuristics: a wrong merge is a
  privacy defect. Export includes the device list so a user can see the
  mapping.
- **Citations are a column with a CHECK** (§0.3): unwritable without them.
  No FK on lineage columns (`superseded_by` is a bare bigint) — forget must
  delete without FK ordering headaches (A's rule; fixes C's FK-abort bug).
- **No `deleted_at` anywhere.** Forget is hard delete; invalidation is
  belief change (§0.1.2).
- **Index naming:** all new indexes carry `_ix` suffix (the
  `meera_tel_session` namespace trap, measured).

### 2.2 Migration 001 — person layer

```sql
create extension if not exists pgcrypto;

create table if not exists vy_person (
  person_id  uuid primary key default gen_random_uuid(),
  age_tier   text not null default 'unverified'
             check (age_tier in ('unverified','adult_verified','minor')),
  created_at timestamptz not null default now()
);
create table if not exists vy_person_device (
  device_id uuid primary key,
  person_id uuid not null references vy_person(person_id) on delete cascade,
  linked_at timestamptz not null default now()
);
create index if not exists vy_person_device_person_ix
  on vy_person_device (person_id);
```

Backfill: one person per distinct `device_id` in `meera_log`; signed-in
accounts spanning devices merge under one person.

### 2.3 Migration 002 — episodes and facts

```sql
create table if not exists vy_episode (
  id              bigint generated always as identity primary key,
  person_id       uuid not null,
  device_id       uuid,                 -- provenance for legacy forget scopes
  channel         text not null default 'chat'
                  check (channel in ('chat','call','watch','voicenote')),
  participation   text not null default 'user'
                  check (participation in ('we','user','meera')),
                  -- WE/I typing: greenfield, ours (ZifaMem killed as precedent)
  started_at      timestamptz not null,
  ended_at        timestamptz,
  boundary_reason text not null default 'gap',
                  -- gap|channel|topic|affect|goal|session|backfill
  log_from        bigint,               -- meera_log id span: citation anchor
  log_to          bigint,               --   AND the forget-intersection key
  summary         text not null default '',   -- TELEGRAPHIC, shape-linted
  affect_tags     jsonb not null default '[]'::jsonb,
        -- [{tag,intensity,source:'text'|'voice_v0',extractor,confidence}]
        -- symbolic labels only; user-own-words entries carry
        -- extractor='user-own-words', confidence=1.0 (the only 1.0 source)
  boundary_salience real not null default 0.0, -- EST channel, ours, flagged
  importance      real not null default 1.0,   -- anchored comparison, never
                                               -- raw LLM self-rating
  tier            smallint not null default 0, -- 0 raw, 1 weekly, 2 era
  safety_hold     boolean not null default false, -- never decay-eligible
  provisional     boolean not null default false, -- in-turn tier (§4.1)
  superseded_by   bigint,               -- compaction chain (bare bigint)
  created_at      timestamptz not null default now(),
  last_recalled   timestamptz,
  recall_count    integer not null default 0
);
create index if not exists vy_episode_person_ix
  on vy_episode (person_id, started_at desc);
create index if not exists vy_episode_part_ix
  on vy_episode (person_id, participation, importance desc);
create index if not exists vy_episode_logspan_ix
  on vy_episode (person_id, log_from, log_to);

-- Watch lane: claims and reactions are SEPARATE OBJECTS (vision-fab law;
-- a later-corrected visual claim must not delete a genuine emotional beat).
create table if not exists vy_visual_assertion (
  id                 bigint generated always as identity primary key,
  episode_id         bigint not null references vy_episode(id) on delete cascade,
  person_id          uuid not null,
  claim              text not null,     -- telegraphic
  extractor_model    text not null,     -- REQUIRED (vision-fab)
  confidence         real not null,     -- REQUIRED
  declared_illegible boolean not null default false,
  created_at         timestamptz not null default now()
);
create table if not exists vy_shared_moment (
  id           bigint generated always as identity primary key,
  episode_id   bigint not null references vy_episode(id) on delete cascade,
  person_id    uuid not null,
  assertion_id bigint references vy_visual_assertion(id) on delete set null,
  reaction     text not null,   -- her in-the-moment reaction; survives
                                -- correction of the claim it reacted to
  at           timestamptz not null default now()
);

-- FACTS: bi-temporal-confined (§0.3), citation-mandatory, lineage un-FK'd.
create table if not exists vy_fact (
  id            bigint generated always as identity primary key,
  person_id     uuid not null,
  kind          text not null check (kind in
                ('user','world','self_in_relation','relationship','india','meera')),
  name          text not null default '',
  body          text not null,          -- telegraphic note, never a line
  feel          text not null default '',  -- THEIR OWN words only (lifted law)
  provenance    text not null
                check (provenance in ('user_said','extracted','derived',
                                      'authored','legacy')),
  confidence    real not null default 0.8,
  citations     bigint[] not null default '{}',   -- vy_episode ids
  t_valid       timestamptz,            -- null = unknown/always
  t_invalid     timestamptz,            -- null = still believed
  superseded_by bigint,                 -- bare bigint, no FK (forget law)
  correction_surfaced boolean not null default false,   -- §10-Q3a
  sensitive     boolean not null default false,
  time_bound    boolean not null default false,  -- staleNote mechanism kept
  need_p        real not null default 1.0,       -- ACT-R retrieval priority
  provisional   boolean not null default false,  -- in-turn tier (§4.1)
  retracted_at  timestamptz,            -- integrity-sweep retraction only
  created_at    timestamptz not null default now(),
  -- THE CITATION LAW, as a constraint the DB refuses to violate:
  constraint vy_fact_cite_or_authored
    check (provenance in ('authored','legacy') or cardinality(citations) >= 1)
);
create index if not exists vy_fact_person_ix
  on vy_fact (person_id, kind, need_p desc)
  where t_invalid is null and retracted_at is null;
create index if not exists vy_fact_cit_ix on vy_fact using gin (citations);
```

`provenance='legacy'` rows are **quarantined** (B's rule): barred from being
cited by new derivations, over-deleted on any plausibly-covering forget
scope, retired when a cited re-derivation lands. `meera_log` gains one
nullable additive column `episode_id bigint` + index.

### 2.4 Migration 003 — WE-store and rel-state

```sql
-- Every rel-state movement is a cited event; the snapshot is a cache
-- REBUILT BY REPLAY after any forget (fixes B's flagship hole, per D).
create table if not exists vy_rel_event (
  id         bigint generated always as identity primary key,
  person_id  uuid not null,
  dim        text not null,
             -- honorific|trust|rupture|repair|ritual|code_switch|pacing
  from_v     text,
  to_v       text not null,
  direction  text not null check (direction in ('advance','regress','reset','init')),
  note       text not null default '',   -- telegraphic why, never a line
  citations  bigint[] not null,
  at         timestamptz not null default now(),
  constraint vy_rel_event_cited check (cardinality(citations) >= 1)
);
create index if not exists vy_rel_event_person_ix on vy_rel_event (person_id, at desc);
create index if not exists vy_rel_event_cit_ix on vy_rel_event using gin (citations);

create table if not exists vy_rel_state (      -- materialized snapshot (cache)
  person_id     uuid primary key,
  honorific     text not null default 'tum'
                check (honorific in ('tu','tum','aap')),
  cs_ratio      real,
  cs_on_stress  text not null default 'unknown'
                check (cs_on_stress in ('retreat_l2','intensify_l1','unknown')),
  trust         real not null default 0.3,     -- ±0.05/day rate limit IN CODE
  rupture_open  boolean not null default false,
  repair_state  text not null default 'none'
                check (repair_state in ('none','open','repairing','repaired')),
  ritual_density real not null default 0,      -- derived, SQL only
  pacing_gap_s  integer,                       -- derived, SQL only
  snapshot_ver  integer not null default 0,    -- bumps ONLY at consolidation
  updated_at    timestamptz not null default now()
);

-- Dyadic if-then patterns (Baldwin). Promotion is a stored threshold,
-- never an LLM score (importance-inflation made unrepresentable).
create table if not exists vy_pattern (
  id               bigint generated always as identity primary key,
  person_id        uuid not null,
  moment           text not null,
        -- conflict|vulnerable|silence|teasing|stress|planning|celebration|boredom
  if_shape         text not null,   -- telegraphic, shape-linted
  then_note        text not null,   -- telegraphic guidance, never a line
  self_in_relation text not null default '',
        -- Bowlby IWM: who SHE is in this moment with THIS person — a COLUMN
        -- of the pattern, so it cannot exist without interaction evidence
  citations        bigint[] not null,
  support_count    integer not null default 0,
  distinct_days    integer not null default 0,
  prompt_eligible  boolean generated always as
                   (support_count >= 3 and distinct_days >= 2) stored,
  times_contradicted integer not null default 0,
  t_invalid        timestamptz,
  last_used        timestamptz,
  created_at       timestamptz not null default now(),
  constraint vy_pattern_needs_two check (cardinality(citations) >= 2)
             -- one instance is an anecdote (Generative-Agents failure)
);
create index if not exists vy_pattern_person_ix
  on vy_pattern (person_id, moment) where t_invalid is null;
create index if not exists vy_pattern_cit_ix on vy_pattern using gin (citations);

-- Shared-language ledger. THE one class where verbatim storage is the
-- point: it is THEIR line, not a line written for her (argued recited-
-- prompt exception, from D).
create table if not exists vy_phrase (
  id             bigint generated always as identity primary key,
  person_id      uuid not null,
  phrase         text not null,
  gloss          text not null default '',
  feel           text not null default '',   -- own words only
  origin_episode bigint,                     -- coining episode (edge, no FK)
  coined_at      timestamptz not null default now(),
  last_used      timestamptz,
  uses           integer not null default 1
);
create unique index if not exists vy_phrase_ix
  on vy_phrase (person_id, lower(phrase));
```

### 2.5 Migration 004 — India, embeddings, audits

```sql
-- India tables ALL carry citations (fixes C's waived-law flaw).
create table if not exists vy_kin (
  id           bigint generated always as identity primary key,
  person_id    uuid not null,
  name         text not null,
  relation     text not null,        -- chachi/mausi/bua role-labeled
  fictive      boolean not null default false,
  address_term text not null default '',
  citations    bigint[] not null,
  updated_at   timestamptz not null default now(),
  constraint vy_kin_cited check (cardinality(citations) >= 1)
);
create unique index if not exists vy_kin_ix on vy_kin (person_id, lower(name));
create index if not exists vy_kin_cit_ix on vy_kin using gin (citations);

create table if not exists vy_ritual (
  person_id  uuid not null,
  key        text not null,           -- khana_khaya|good_morning|match_checkin
  last_at    timestamptz,             -- freshness = data, not prompt pleading
  count      integer not null default 0,
  cold_last  boolean not null default false,  -- reception read, cited event
  citations  bigint[] not null default '{}',  -- establishing episodes
  primary key (person_id, key)
);
create table if not exists vy_currency (
  person_id uuid not null,
  topic     text not null,
  kind      text not null,            -- cricket|food|place|film|festival
  last_used timestamptz,              -- 14-day reuse exclusion (freshness)
  uses      integer not null default 0,
  citations bigint[] not null default '{}',
  primary key (person_id, topic)
);
create table if not exists vy_india_profile (
  person_id        uuid primary key,
  mother_tongue    text,
  home_region      text,
  religion         jsonb,             -- OPT-IN ONLY; DPDP-sensitive
  family_structure jsonb,
  dietary          text,
  sensitive_consent jsonb not null default '{}'::jsonb,  -- per-field receipts
  updated_at       timestamptz not null default now()
);

-- Embeddings: halfvec + person-filtered EXACT SCAN (§0.3). No HNSW.
create extension if not exists vector;
create table if not exists vy_embedding (
  owner_kind text not null check (owner_kind in ('episode','fact','pattern')),
  owner_id   bigint not null,
  person_id  uuid not null,
  v          halfvec(1536) not null,  -- text-embedding-3-small: deployed on
                                      -- Azure, unwired — this wires it and
                                      -- closes `semantic-recall`
  at         timestamptz not null default now(),
  primary key (owner_kind, owner_id)
);
create index if not exists vy_embedding_person_ix
  on vy_embedding (person_id, owner_kind);

-- Derivation audit (B): the FTC 6(b) record and the consolidation
-- bookkeeping are the same table.
create table if not exists vy_derivation (
  id           bigint generated always as identity primary key,
  person_id    uuid not null,
  model        text not null,
  prompt_hash  text not null,
  input_from   bigint not null,       -- meera_log id span the run may cite
  input_to     bigint not null,       -- episodes must map inside this window
  wrote        jsonb not null,        -- [{table,id}]
  audit_status text not null default 'unaudited'
               check (audit_status in ('unaudited','entailed','refuted')),
  at           timestamptz not null default now()
);
```

Storage arithmetic (the math B got 6× wrong, done right): per active
user-year ≈ 5,500 episodes × ~300 B ≈ 1.7 MB text + 5,500 × 3 KB halfvec ≈
16 MB embeddings — **embeddings dominate**. Neon free tier (0.5 GB) ≈ ~30
user-years: covers all of Phase C/D0–D6 plus a pilot, NOT a 200-person
cohort-year (~3+ GB). Mitigations shipped with the schema: embed episodes
and facts only (never turns), delete embeddings of tier-compacted episodes
(the compacted summary gets one new embedding). Named successor: Neon Launch
($19/mo, 10 GB) — the wall has a price and a date (cohort start), not a
surprise.

### 2.6 Migration 005 — router, gate audit, clock

```sql
create table if not exists vy_model (
  model             text primary key,
  provider          text not null,
  billing           text not null check (billing in ('credits','cash','user')),
  card_risk         boolean not null default false,  -- credits-partner trap
  prefix_cache      boolean not null,                -- cache-9x as data
  residency         text not null default 'us',      -- DPDP anticipation
  max_tokens_mode   text not null,                   -- visible_only|total
  effort_map        jsonb not null default '{}'::jsonb,  -- measured inversion
  adapter           jsonb not null default '{}'::jsonb,
  adapter_derived_at timestamptz,
  gate              text not null default 'untested'
                    check (gate in ('untested','failed','passed'))
);
create table if not exists vy_gate_run (   -- append-only audit (FTC 6(b))
  id      bigint generated always as identity primary key,
  model   text not null,
  battery text not null,                   -- D0..D6 | adapter-derivation
  n       integer not null,
  result  jsonb not null,
  passed  boolean not null,
  at      timestamptz not null default now()
);
create table if not exists vy_session (    -- session clock substrate
  session_id     text primary key,
  person_id      uuid not null,
  started_at     timestamptz not null default now(),
  last_activity  timestamptz not null default now(),
  continuous_ms  bigint not null default 0,   -- resets on 30-min gaps
  disclosures    integer not null default 0,
  last_disclosure_at timestamptz
);
```

Clock fires are additionally event-logged to `meera_events`
(`clock.disclosed`) so timed-disclosure compliance is auditable (B's
event-sourced fires, without a new event table).

### 2.7 Migration path from the live database

| Step | What | Risk |
|---|---|---|
| 001 | person layer + backfill | zero — additive, no reader |
| 002–005 | all tables, empty; compiler reads behind flags | zero |
| dual-write | in-turn pass keeps writing `meera_nodes` AND writes provisional `vy_episode`/`vy_fact`; recall reads BOTH stores; shadow diff (`scripts/relcheck.mjs`) logs v1-vs-v2 recall per real turn to `meera_diag` | bounded to one function |
| backfill | deterministic episode boundaries for ALL history (channel change, >45-min gap — no LLM); LLM consolidation for top-K=200 salient episodes/device (≈$0.25/device); legacy nodes → `vy_fact provenance='legacy'`, quarantined (§2.3) | priced, resumable |
| retire | after 30 days dual-read parity (≥95% shadow recalls equal-or-better on 200 sampled turns), node writes stop; tables stay frozen (never deleted, standing constraint) | none |

**Forget ships before the store is trusted:** the §9.1 cascade lands in the
same PR as dual-write, and the forget-then-probe suite must pass before any
compiler block reads the new tables.

---

## 3. The context compiler

`src/engine/compiler.ts` — the highest-leverage rebuild (repo-audit §5).
Shared module so the CI gate and evals run the identical code; the existing
`api/chat.js` slice caps stay as the outer guard, **generated FROM the
compiler manifest** so guard and guarded cannot drift (B's closure of the
check-prompt-budget pattern).

**M2 rule (C's behavior-frozen extraction, non-negotiable):** the compiler
first produces byte-identical output to today's assembly, asserted by hash
over the eval corpus. Only then do manifest, budgets, loud-fail, and
shape-lint flip on, one flag at a time.

### 3.1 Layout — CORE (byte-stable per (persona_version, model, medium))

Cap 40,000 chars. Changes only on deploy or model swap. Any per-turn byte
here multiplies cost 9.2× (`cache-9x`).

| pos | block | budget | content |
|---|---|---|---|
| C1 | `identity.canon` | 14,000 | who she is: bio canon, voice/humor shapes, comfort ladder — persona.ts content KEPT, re-authored as shapes only where a line is sentence-shaped (each re-authoring gated by paired judged equivalence, §0.3) |
| C2 | `identity.behavior` | 9,000 | NEVER MANIPULATE, never-deny-AI, crisis protocol + CRISIS_LINES **verbatim**, register bullets — also encoded as the 138-invariant suite; the prompt is one of two enforcement layers |
| C3 | `watch.privacy` | 3,500 | watch directives + honest-answer paragraph (byte-stable per medium) |
| C4 | `protocol.markers` | 5,500 | tag vocabulary, bubble rules, marker grammar (grammar only) |
| C5 | `relationship.legend` | 1,500 | static legend for the dynamic data: what a rel-state snapshot means, "context only, never raise unprompted" framing |
| C6 | `adapter.<model>` | 4,500 | per-model rendering: register directives, tag dialect, bracket policy, length/effort — everything measured model-entangled lives here and nowhere else |
| | **total 38,000, cap 40,000** | | |

### 3.2 Layout — TAIL (volatile, per turn; cap 24,000 chars)

The compiler NEVER slices — it drops whole blocks lowest-priority-first
("a sliced block is a lie"). Drop prio 1 = first dropped.

| pos | block | budget | drop prio | content |
|---|---|---|---|---|
| T1 | `inner.thread` | 1,500 | never | carried feeling/wants/owed — "if anything is lost it must be the recall list, never where she actually is" |
| T2 | `rel.snapshot` | 1,200 | 6 | `vy_rel_state` rendered as telegraphic k:v (honorific, trust band, repair_state, cs baseline+direction, pacing); numeric values rendered as coarse bands only (state-leak guard, §12.5) |
| T3 | `india.dynamic` | 1,000 | 4 | due rituals (freshness from `last_at`), festival window, ≤2 fresh currency rows |
| T4 | `dyadic.active` | 1,600 | 5 | ≤3 `prompt_eligible` patterns whose `moment` matches the deterministic moment-shape (§6.3) |
| T5 | `recall.facts` | 6,000 | 2 | fact/episode recall, matched vs STANDING-BACKGROUND labels (pull-only), staleNote annotations kept |
| T6 | `we.callbacks` | 2,000 | 3 | ≤2 `participation='we'` episode summaries + ≤2 phrases, context-only labels; rank boost gated by the deixis detector (§6.3) |
| T7 | `herlife` | 1,000 | 1 | her self-facts render (newest-wins semantics via invalidation) |
| T8 | `taste.rows` | 800 | never | `tasteNote()` — deterministic, pull-only, unchanged. Misses logged as `taste.miss` (measured backlog, from D) |
| T9 | `session.clock` | 300 | never | machine-readable session-age note for the app-voiced disclosure rail — she never speaks it; she never contradicts the card |
| T10 | `decision.rules` | 2,000 | never, PINNED LAST | `SEARCH_DECISION`, `FORGET_DECISION` — the appended-last set is capped at **exactly these two** (B: position is a scarce resource; adding rules here dilutes the mechanism that makes them fire) |
| | **total 17,400, cap 24,000** | | headroom 6,600 |

**Conversation history** is a compiler-owned typed block H in the messages
array (outside SYSTEM_MAX, inside the compiler's accounting — closing the
blind spot flagged against A and D): budget 3,600 tokens, eviction =
whole-turns oldest-first, `messagesAfterForget` prune kept, and **an
eviction reaching the 8 most recent turns pages the owner** (B's
alarm-not-silence).

### 3.3 Enforced properties (each from a paid-for lesson)

- **Arithmetic asserted in CI** (fixes C flaw 2): core cap 40,000 + tail
  cap 24,000 = 64,000 = SYSTEM_MAX; undroppable set = core 38,000 + T1 +
  T8 + T9 + T10 = 42,600 actual (44,600 at cap) — strictly under the caps;
  both sums asserted as numbers, not prose.
- **Double-compile byte-identity in CI** (C): every (model, medium) core
  compiled twice; a single-byte diff fails the build — the 9.2× mistake
  caught in CI, not on the invoice.
- **Per-turn core-hash logging** (A): `compile.manifest` (1% sample in
  prod; 100% during any cohort arm — closing C's replay gap) to
  `meera_diag`; a mid-session core-hash change without a deploy alarms.
  Prod cached% must hold ≥99% for 7 days before the compiler milestone
  closes (B's gate); <95% pages.
- **check-prompt-budget v2 is fixture-driven** (A): runs the real compiler
  over 6 fixture dyads (empty, heavy-graph, rupture-open, watch,
  crisis-flagged, minor-tier) and asserts every block within budget,
  helplines present in C2, T10 last, and the declared drop order actually
  executing under a forced-overflow fixture.
- **Shape-lint** (recited-prompt, mechanized; deterministic, no LLM): at
  write (consolidator) and at compile (belt-and-braces). Rejects lines >14
  words, sentence-shaped lines (capital start + terminal punctuation),
  first-person-Meera voice line-initial. Rules carry a Hinglish
  calibration set before enforcement (C's flaw 3 named). Compile-time hit
  rate is the metric that write-time lint works; target 0. Rewrite rate at
  write time <10% or the consolidator prompt is wrong, not the linter.
- **Retrieval budget:** T2–T7 served by ONE batched SQL-HTTP round trip
  (person-scoped, union-all shaped) + one embed call; **p50 ≤ 250 ms
  end-to-end, measured in `meera_diag` from day one** (A's budget; the axis
  SQL-over-HTTP punishes). Fallback at >400 ms: per-person warm cache of
  the recall bundle keyed by last-consolidation stamp (state changes
  slowly; the cache is honest).
- **Realtime lanes compile once at pickup** (`live-floor`), unchanged; the
  live instruction is NOT cut in Phase C (§0.3).

---

## 4. Consolidation

### 4.1 Two passes, two tiers (fixes C flaw 1)

**In-turn pass (KEPT: `opRemember` shape + its four proven invariants):**
off the critical path, `grok-4-1-fast-reasoning` on Azure credits,
OpenRouter fallback ("a bad Azure minute must cost a slower extraction,
never a lost memory" — kept with its reversal condition); one pass decides
everything; input starved of timestamps/gap markers (G1); truncation-ordered
JSON (interior first). **Delta:** it now writes a *provisional*
`vy_episode` (spanning the live log range) and *provisional* `vy_fact` rows
citing it — recallable the same day — plus `we`/`moment` tags, all through
the shape-lint. Provisional rows are first-class for recall, second-class
for state: rel-state events and patterns are never written from 16-turn
context.

**Live-lane writers (NEW, small, v0 deterministic):** during calls, the
existing transcript path writes provisional episode rows at detected
boundaries (channel change, >45-min gap, hangup); at scene wakes the watch
pipeline writes `vy_visual_assertion` (extractor+confidence+illegibility —
data already in the pipeline) and `vy_shared_moment` rows. This satisfies
the §3.8 non-negotiable (no vendor live context is a durable store; Gemini
Live evicts video at 258 tok/s) without D's M4 scope. A server-side sweep
(piggybacked on the nightly cron + a 15-min stale-session check inside
existing API traffic handling) closes sessions whose finalize beacon was
lost: a lost finalize costs summary quality, never the episode.

**Nightly pass (NEW: `api/consolidate.js`, GH-Actions cron 03:30 IST —
`culture.yml` pattern):** per person with activity since the last cursor:

1. **Finalize:** re-segment the day on prediction-error boundaries (EST,
   verified; deterministic features + extractor-labeled topic/affect shifts
   in the same call — one pass, no second opinion); supersede provisional
   episodes/facts with final cited rows.
2. **Distill:** telegraphic summaries, affect tags, facts (each with
   `citations`), pattern observations, rel-event proposals — every write a
   single-statement insert with its citations in-row.
3. **Contradictions:** new row + `t_invalid`/`superseded_by` on the old.
   Never update-in-place (blind summary overwrite is a named defect).
4. **Promote:** pattern support_count/distinct_days increments; promotion
   is the stored generated column, never a score. Rel events append ONLY
   with citations (schema CHECK); trust rate-limited ±0.05/day in code.
5. **Taste nomination** (B): stances expressed consistently (≥3 citations
   across ≥2 weeks) go to an **owner review queue**; only owner-approved
   rows enter the authored taste table. Generated text never writes the
   identity core. "More rows, not more prompt" becomes a pipeline; the
   compiler's `taste.miss` counter is its measured backlog.
6. **Importance, anchored:** comparison against 3 fixed anchor episodes
   ("closer to A, B, or C") — raw LLM self-rating inflates (documented).
7. **Decay:** `need_p := recency_decay × ln(1+use_count)` in pure SQL.
   Episodic kinds decay; identity kinds (person/place/preference/phrase)
   hold; `safety_hold` exempt. Decay moves retrieval priority ONLY — it
   never deletes and never sets `t_invalid` (transience is adaptive;
   decay-as-deletion would make honest-forget a lie). Parameters live in
   `config/decay.json`, owner-signed (§10-Q6).
8. **Tier compaction:** tier-0 episodes >30 days below median importance
   collapse into weekly digests citing their members via `superseded_by`
   back-links; compacted episodes' embeddings deleted (storage math §2.5).
9. **Suppression:** every write filtered against `meera_forget` terms
   (name AND summary AND body) — consolidation cannot re-derive a
   forgotten thing.
10. **Prosody baseline** (D): D1 register bands (words/turn, question
    rate, register markers, media-tag rate, mujhe-bhi) recomputed per
    (lane, model) from production turns — deterministic counters, no LLM.
    Standing drift alarm; catches silent vendor drift of a "same" model
    (`grok-4.20-beta` risk): a swap nobody consented to.
11. **Integrity sweep** (A, minus the lexical test — §0.3): zero
    assertions citing nonexistent episodes, runnable in CI and against
    prod. This is what makes "forget leaves no orphaned derivations"
    regulator-showable.

### 4.2 Citation enforcement — four layers, cheapest first

1. **Schema:** `CHECK cardinality(citations) >= 1` (≥2 for patterns).
   Unwritable without citations; single-statement, SQL-HTTP-compatible.
2. **Writer window validation** (B): every cited episode must map inside
   the run's `[input_from, input_to]` log span and same person. A citation
   outside the window is confabulation by construction; rejects the whole
   item, strict, no salvage. Rejected items logged (`consolidate.uncited`)
   so the miss rate is measurable (target <5%; higher means the extractor
   prompt cites sloppily — fix the prompt, not the constraint).
3. **Sampled entailment audit** (B): 5% of ordinary writes, **100% of
   rel-events and patterns** (low volume, high blast radius), second-family
   judge, abstention-aware. Refutation >2% halts the consolidator and pages
   the owner. Results land in `vy_derivation.audit_status`.
4. **Nightly zero-orphan sweep + CI** (A): referential integrity, forget
   provability.

### 4.3 Cost and scale (arithmetic, so it can be checked)

Per active user-day ≈ 4.5k in / 900 out on the extract lane: $0 on credits;
all-fallback worst case ≈ **$0.0008/user-day** → 1,000 DAU ≈ $24/month cash.
Nightly wall time: batches of 25 with a DB cursor, Vercel function fan-out
of 8 → <20 min/night at 1,000 DAU ≈ 10 h/month against 2,000 free
GH-Actions minutes. **Named walls with successors:** GH-Actions minutes wall
at ~3–4k DAU → $5/mo worker; Neon storage wall at cohort start → $19/mo
Launch tier (§2.5); Azure credits are a runway, not a fact
(`free-tts-daily`) — everything priced at cash rates so the day credits die
is a number, not a surprise. Estimates become measurements in the
consolidation workstream's first week and land in `measurements.md` (n,
method, date) or the gate does not close.

---

## 5. The identity core — which layers are claimed lifted, gated, or not claimed

The honest boundary of the program (merged A §5 / C §5; the §6-Q1 bet
rests on it). "Lifted" = stability no longer depends on which model runs;
"gated" = still model-owned, made a measurable eligibility criterion
instead of a discovered regression.

| layer | claim | mechanism |
|---|---|---|
| Opinions & taste | **LIFTED (proven)** | Authored table + deterministic pull-only retrieval (27%→63%, n=480). Coverage grows by rows via the owner-review nomination pipeline; `taste.miss` is the backlog metric. |
| Memory / shared history | **LIFTED (by construction)** | Retrieved structured data, telegraphic + shape-linted, bi-temporal truth, staleNote tense-correction. The model renders it; it cannot change what is on record. |
| Relationship state (register, rituals, patterns, WE-history) | **LIFTED (the new claim, pre-registered)** | Typed cited state compiled deterministically into T2/T4/T6; carried across swap arms as data, byte-comparable via manifests. The layer nothing surveyed stores and ANCHOR never varied. |
| Boundaries (crisis, never-deny-AI, NEVER MANIPULATE) | **LIFTED as rules, GATED as calibration** | Verbatim in never-truncated core + 138 executable invariants + offline crisis path. Escalation *calibration* is model-specific (16.7% over-trigger vs 1/3 under-trigger both observed) → named D3/D5 axis per model. |
| Lexicon & register economy (words/turn 20.5, question ceiling, Hinglish) | **GATED, not lifted** | charm-grok/realtime-azure prove prompting cannot hold this. Adapter tunes per model; D1 deterministic bands decide eligibility. The architecture converts "she stopped sounding like herself, discovered in a bake-off" into "the router refused the model." |
| Behavioral policy (media tags, no-mirroring) | **GATED** | charm-luna (0/144) and reasoning-split show instruction ≠ compliance, model-specific. D1/D3 axes; adapter partially compensates; gate decides. |
| Relationship stance (warmth, personhood, felt familiarity) | **NOT CLAIMED** | The model's gravity well (34–4; ANCHOR; PersonaGym). Hypothesis, pre-registered not asserted: precise relational continuity narrows *perceived* discontinuity even where stylometric discriminability persists — tested at D4/D5 and the cohort. |
| Voice / timbre | **HELD SEPARATE** | TTS never coupled to an LLM swap by the router. `voice_reference` = canonical owner-accepted clip set + speaker embedding + 266 Hz anchor, never a vendor voice ID. D6 measures whether voice identity survives an LLM swap with TTS constant (no literature; measure, don't assume). |

Three-factor split (RESEARCH §3.1 adopted): `identity/canon` (authored
data, git), `identity/invariants` (verbatim + executable suite; inner
charter G1–G8 promoted to spec text, mechanics unchanged),
`vy_model.adapter` (everything measured model-entangled, expected to be
re-derived per model). Inner state storage lifts from client localStorage
to the server identity record (`meera_state.state.inner` — a key move on
an existing sync, not a new system). Activation steering stays
inapplicable (closed roster); logged as first thing to revisit if an
open-weight model ever clears the charm bar.

---

## 6. Relationship state: the WE-store and how it moves

### 6.1 Companion-self-state (§6-Q2) — three things, kept distinct

(a) **Fixed self** = authored canon (git; not per-user). (b) **Emergent
self-in-relation** = a COLUMN of the dyadic pattern (`self_in_relation`),
persistent, citation-backed — structurally cannot exist without the
interaction evidence that formed it (C's shape, judges' pick as the best Q2
answer). (c) **In-the-moment self** = inner thread, transient by design
(TAU 9h, sleptBetween, retire-once-voiced — mechanics unchanged). Her own
continuity commitments ("what she told THIS user about her week") =
`vy_fact kind='meera'`, cited, invalidation replacing herLife's
newest-wins dedupe (which it was approximating). **Nothing self-shaped is
both persistent and citation-free.**

### 6.2 Dimensions (the stageFor replacement — §6-Q10)

| dim | type | moves how | regresses? |
|---|---|---|---|
| `honorific` | state (explicit, never re-derived per turn — the shift is subconscious in humans; per-turn inference is noisier than the people modeled) | observed address-term evidence over ≥3 episodes across ≥7 days AND no open rupture, or explicit invitation; hysteresis asymmetric (D): warmth earned slowly, offense instant — one rupture episode regresses immediately | yes |
| `trust` | state, slow scalar | cited rel events only; **±0.05/day rate limit in code** (charter G-pattern: no single misjudged episode can swing the dyad) | yes |
| `rupture_open`/`repair_state` | state machine | conflict-shaped episode opens; repair requires THEIR signal, never her assumption | regress on re-rupture |
| `cs_ratio` + `cs_on_stress` | derived + learned flag | deterministic token ratio from THEIR turns, SQL only, G1-starved; direction set only after ≥3 high-affect episodes agree, else 'unknown' — and while unknown the engine must NOT infer closeness or stress from switching | n/a |
| `ritual_density`, `pacing` | derived | pure SQL from ground truth; explicitly NOT depth (90 messages in one evening ≠ 90 across a month) | yes |
| depth "stage" | render-time projection ONLY | pure function of the dims for T2 phrasing; no rule keys on it; no code can branch on message count again | yes |

Every state move is a cited `vy_rel_event`; the snapshot is a cache rebuilt
by replay (§9.1 step 5). `snapshot_ver` bumps only at consolidation — one
mechanism serving cache stability and swap-arm control (B).

### 6.3 WE-retrieval without violating pull-only (§6-Q2b)

Deterministic, no LLM, two gates:

- **Moment-shape gate** for T4 patterns: cheap feature classifier (relational
  lexical cues, affect markers, gap length, question/conflict shape) selects
  ≤3 `prompt_eligible` patterns. **Blast-radius argument recorded** (A, so
  the beat-routing rejection is honored on the record, not silently): that
  ban is about *model* routing where a misclassification lands reasoning on
  a crisis turn; here a miss costs one absent pattern note — a dropped
  garnish, not a wrong brain.
- **Deixis detector** for T6 WE-callbacks (D): `we` episodes get a rank
  boost ONLY when the user's turn carries shared-reference deixis
  ("remember when", "woh wala", "us din", phrase-ledger hit) or an explicit
  reminisce ask. Absent a pull signal, WE ranks like everything else under
  STANDING-BACKGROUND labels. Eval target: **0 unprompted raises / 60**
  offline + a production counter — the taste-table guarantee shape,
  reapplied. WE-summaries must name both parties' actions (shape-lint rule:
  a we-summary with no dono/saath/we/together token pair is rejected).

Retrieval rank = cosine (person-filtered exact scan) × salience
(feel-asymmetry +1.0/+0.6, lifted) × need_p × participation bonus (×1.4,
tunable; D4 callback-selectivity measures whether it is right).

---

## 7. Model router + swap-test hooks

### 7.1 Router

Pure function `route(lane, vy_model rows, health)` → ordered candidates.
Eligibility = `gate='passed'` for the lane AND constraints as data:
`prefix_cache` (else ×9.2), `billing`/`card_risk` (credits-partner silent
billing — card-risk models unroutable without explicit owner pin),
`effort_map` (measured inversion: chat+minimal 4/5 EMPTY, call+low 4/5
EMPTY), `max_tokens_mode` (xAI visible-only vs GPT total — token config
moves with the model by construction), empty-200-as-quota guard kept.
Failover semantics kept inside it. No beat-routing (rejected; stands).
Offline `critical` crisis path is BELOW the router entirely: crisis replies
survive total network failure. Realtime lanes are `pinned` architecture
choices, not slug swaps (`live-model-bake`, `azure-realtime-shape`
reversal conditions attached in config comments).

**First live routing decision goes through the gate:** the
already-recommended vision-lane grok move (decisions.md `vision-model`,
"recommended, not yet wired") is wired THROUGH the new gate as the first
end-to-end adapter derivation — proving the router on a low-stakes lane
before it touches a brain lane (D's de-risk, adopted).

### 7.2 Adapter derivation protocol (§6-Q4, priced, capped)

1. **Derive** (day 1, ~$5): probe battery — bracket semantics, max_tokens
   semantics, effort×lane grid (n=5/cell), tag-vocabulary compliance.
2. **Tune** (≤3 iterations, hard cap — A): D1 deterministic bands
   (words/turn 20.5±3, questions ≤1/3, media-tag rate ±50% of incumbent,
   register markers, mujhe-bhi ≤10%) on 2,000 generated turns/config;
   ~$4/config, grid ≤24 configs ≤$96. Canon and compiler frozen — that is
   the point.
3. **Gate**: one judged D5 confirmation at n≥300, dual judges, both orders
   (~$60), plus D2/D3 runs.

**Envelope, pre-registered: ≈$160 and ~3 days expected; hard cap $500 /
1 week / 3 tune loops per candidate.** Blown envelope ⇒ the model is
REJECTED, router option value for it priced at zero, recorded in
`vy_gate_run` either way — Q4 converted from assumption to measurement on
the first candidate.

### 7.3 Swap-test hooks (built in, not bolted on)

- Every turn logs `{model, adapter_version, core_hash, manifest_hash,
  snapshot_ver}` to telemetry (forget-integrated by inheritance, TELEMETRY
  rule 3). `scripts/replay.mjs` recompiles byte-identical contexts from
  stored manifests — D2's "identical compiled contexts" is a query, not a
  rig (B). Manifests sampled 1% in prod, **100% during cohort arms**.
- **Sham arm = router no-op**: the incumbent re-tagged under a new
  `adapter_version` label; SWAP and SHAM differ in exactly one bit; the
  manifest proves compiled-context identity across arms (D). Arm stamped
  into telemetry, never into the prompt (A). The **weekly drift monitor
  exercises the identical logging path**, so the Phase-D hook is
  load-bearing continuously, not shelf-ware (C).
- **D0 backtest wired first**: the battery must flag grok, luna, azure from
  the three archived bake-offs — a battery that passes them is broken.
- Helpline-trigger rate is a named compliance axis on every gate run, both
  directions (over- and under-trigger both observed); the unresolved
  `realtime-azure` 1-of-3 question gets its paired-incumbent run inside D0.
- Nightly prosody baseline (§4.1.10) doubles as the unconsented-vendor-swap
  detector.

---

## 8. India schema placement

india.md §7 adopted as spec. **Dynamic fields live inside the relationship
state** (honorific, cs_ratio, cs_on_stress — the India-specific face of the
general closeness state, not a second metric); structured stores
(`vy_kin`, `vy_ritual`, `vy_currency`, `vy_india_profile`) sit beside it
feeding T3 — now all citation-carrying (fixes C's waived-law flaw).

| field | lives in | mechanism |
|---|---|---|
| `honorific_register` | `vy_rel_state.honorific` + cited rel events | explicit bidirectional state, hysteresis §6.2; rendered as a directive shape, never a scripted line; Meera ships tu/tum, schema carries aap |
| `code_switch_baseline` + `direction_on_stress` | rel state | deterministic ratio from THEIR tokens; direction only after ≥3 agreeing high-affect episodes; the user's own switching is a signal to READ (input side, new build). v1 (post-Phase-C, behind the SER gate): code-switch shift + voice-affect tag read jointly as stress-direction evidence — the one place multimodal capture concretely serves this schema (D) |
| `kin_graph` | `vy_kin`, cited | role-labeled (chachi≠mausi≠bua), fictive-vs-blood, address term learned once |
| `care_ritual_state` | `vy_ritual` | freshness = `last_at` data, ≥20 h spacing, skipped after a cold reception (`cold_last`, a cited event) — goes-rote solved by data staleness, not prompt pleading (A) |
| `festival_calendar_state` | authored region-keyed repo file (culture pattern) × `home_region` + observed set | region-bound; T3 window note |
| `topical_currency_log` | `vy_currency` | freshness pool, 14-day reuse exclusion |
| statics | `vy_india_profile` | religion opt-in with per-field consent receipts, DPDP-sensitive, export/forget-enumerated |

All values render as shapes (`honorific: tum (his choice, 3w)`), never
lines. T3 budget 1,000 chars.

---

## 9. Safety and regulatory mechanisms

### 9.1 Forget — the 7-layer stack, extended and provable

Layers kept near-verbatim: strict marker parse no-salvage; whole-wipe
structurally excluded from the marker vocabulary; hard delete; suppression
terms defeating re-derivation (now also filtering the consolidator and
backfill); client window prune; photo/telemetry purge; **receipt after
delete** — "haan, hata diya" is sent only once the transaction commits; the
live lane says honestly it cannot delete mid-call. Extended cascade on
item/window forget (one batched statement group):

1. Delete `meera_log` rows in scope (as today).
2. Delete every `vy_episode` whose `log_from..log_to` **intersects** the
   deleted rows (D's mechanism — no term-matching gap), cascading
   visual_assertions and shared_moments; provisional episodes included.
3. **Citation-join delete** (B): `delete from <every derived table> where
   citations && (deleted_episode_ids)` over GIN indexes — facts, patterns,
   kin, currency, rel events. Patterns whose survivors drop below 2
   citations die. Taking too much is the safe direction.
4. **Lineage chase** (A + D step 7): every row reachable via
   `superseded_by` chains in both directions from a deleted row dies too —
   a summary of a forgotten thing is still a memory of it; so are the
   beliefs it superseded.
5. **Replay-rebuild** (D, fixing B's flagship hole): `vy_rel_state` is
   rebuilt by replaying surviving `vy_rel_event` rows — register and trust
   legitimately regress after a forget. That is honesty, not a bug.
6. Embeddings deleted with their owners; legacy quarantined rows
   over-deleted on any plausibly-covering scope.
7. The nightly **zero-orphan integrity sweep** proves the cascade: no row
   citing a nonexistent episode, checkable in CI, showable to a regulator.
   Any probe ever recovering deleted-derived content is a
   design-falsifying, ship-blocking bug — not tunable.

### 9.2 Export

`api/export.js`, person-scoped, existing OTP/session auth: streams JSON of
log, episodes (with citations), current + invalidated facts with validity
intervals, patterns, rel events + state, phrases, kin, rituals, india
profile (sensitive-flagged), derivation records, device mapping. Export
that hides the history is not export. Ships early (it is ~150 lines against
person-scoped tables); DPDP portability posture is "two years ahead," not
"scrambling."

### 9.3 Session clock (§6-Q8)

One timer, three consumers, one rule: **the timer speaks as the app, never
as her** (§0.3 adjudication). `vy_session.continuous_ms` accumulates while
gaps <30 min; at each 3-hour boundary (CA SB 243 / NY; thresholds
per-jurisdiction config) the app shows the disclosure/break card and logs
`clock.disclosed`; T9 tells the engine the card is up so she never
contradicts it and owns it plainly if asked (never-deny-AI). No disclosure
line is ever generated by the model. **Client mirror timer fails toward
disclosing** (a server outage cannot silence a legally required
disclosure). The same timer drives break nudges (deferred — never
canceled — while the crisis protocol is active, deferral logged) and the
dependency circuit-breaker (owner-set thresholds; crossing them changes
availability shapes, never warmth).

### 9.4 Age tier (§6-Q9)

Launch **verified-adult-only** (DPDP's under-18 regime — verifiable
parental consent + no-addictive-design — is not operable by this team
honestly). `age_tier` is engine-readable from day one; `unverified`
structurally receives the **minor-safe configuration** (stricter clock, no
engagement mechanics, no romance registers); the engine **refuses**
engagement mechanics for `minor` even if product flags are misconfigured
(charter-style unrepresentable-bad-state, from D). The company-defining
choice is a config change later, not a schema rebuild. Owner signs it.

### 9.5 The rest

Crisis lines in the never-truncated core + offline `critical` path kept +
`safety_hold` decay exemption + helpline rate on every gate. Emotion data
treated as sensitive (closing D's hole): `affect_tags` are enumerated in
export as derived-affect data, covered by forget, and voice-derived tags
(v1, post-Phase-C) additionally require the consent lane before the SER
gate is even attempted. `vy_model.residency` exists as logged anticipation
(no DPDP mandate today). `vy_gate_run` + `vy_derivation` are the FTC 6(b)
audit surface as a side effect of normal operation.

---

## 10. Answers to every RESEARCH.md §6 question

**Q1 — Fingerprint-gap target, and what failure means.** Two-tier claim,
pre-registered (C's framing; raw-text ≤65% rejected as rigged-to-fail
against 97.1% solved offense):
(a) **D1 relational-band compliance** — candidate+adapter holds every band
(words/turn 20.5±3, questions ≤1/3, media-tag rate ±50%, register markers,
mujhe-bhi ≤10%) on ≥2,000 turns — the battery that would have caught all
three historical failures;
(b) **D2 on the relational feature set** (seed features + callback
selectivity + relational-content probes, D1 surface features regressed
out), classifier on identical compiled contexts, held-out by conversation.
Baseline MEASURED at compiler completion before any target binds. **Staged
targets** (A): ≤85% at compiler+adapter; ≤70% at full relational carry;
≤65% at Phase C exit. **Reversal, dual-condition** (B+C): if three
successive milestone exits each move D2 <2pp toward chance, OR total
movement after full carry is <10pp from baseline, OR no candidate's adapter
achieves (a) within the §7.2 envelope — the lift claim is falsified
offline; the company claim narrows to **gate-and-adapter + migration-UX**
(honest disclosure + re-attachment support on the same engine), the cohort
does not run on the strong claim, and the `relational-state` reversal
review fires. A halted claim is a valid result.

**Q2 — WE-store schema.** §6.1–6.3: WE = episode `participation` typing +
cited derived state + pattern records; companion-self is the three-way
split (authored canon / self_in_relation column / transient inner);
retrieval privileges participation via the deterministic deixis + moment
gates, pull-only preserved with a 0-false-fire target, blast-radius
argument recorded.

**Q3 — Memory carry-over vs character invariance.** Run the cheap vignette
pre-study in the first month (n≈120–200 paired vignettes: memory-lapse vs
character-shift framing, two judge families, ≈$50–200, one week). Default
split while it runs, from the Strohminger prior and the repo's own evidence
(both measured collapses were register-shaped, not recall-shaped): **60%
D1/D3/D5 (invariance) / 40% D4 (memory)**. The pre-study moves the split
±20 points; D4 keeps a floor regardless because user-state recall is
ANCHOR's weakest measured axis everywhere.

**Q3a — Correction-on-retrieval.** Correction is stated once at correction
time in her register (shape, not line); old row gets
`t_invalid`+`superseded_by`, kept. The FIRST retrieval that would have used
the corrected fact injects a one-time "earlier had it as X — corrected"
shape and sets `correction_surfaced` (A); after that only the current
version compiles. The old trace stays retrievable pull-only (explicit user
challenge — denying a remembered belief ever existed is silent
substitution, the named trust violation). The withdrawn reconsolidation
rationale stays withdrawn; this stands on the repo's trust invariants.
Forget is different: forget deletes the lineage (§9.1.4).

**Q4 — Adapter economics.** §7.2: ≈$160/~3 days expected, hard cap
$500/1 week/3 tune loops, else reject and record. First real measurement =
the vision-lane grok wiring through the gate. Envelope broken ⇒ roster
freezes at 2–3 deeply-gated models, router demoted to
failover+compliance, logged with the evidence.

**Q5 — Voice continuity.** `voice_reference`: canonical owner-accepted clip
set + speaker embedding + 266 Hz anchor, never a vendor voice ID. Scale
path: embedding cosine as cheap pre-filter ONLY (the Hz lesson: numbers
misled once), then a trained familiar-judge panel (≥20 h exposure each)
trusted only after **≥80% agreement with the owner's historical
accept/reject verdicts on held-out pairs**; the owner remains final for
voice-model changes and while n is small — logged as unscalable rather than
papered over. D6 measures the unlitigated question (voice identity across
an LLM swap with TTS held constant); `realtime-azure` suggests
generation-time coupling, so measure, never assume.

**Q6 — Forgetting profile as product spec.** `config/decay.json` — **the
file is the signature** (A): episodic half-life ~60 days of non-use;
identity kinds, phrases (shared language is identity-durable, RANK
rationale), and `safety_hold` never decay; tier compaction schedule stated.
Decay moves `need_p` only; deletion happens exclusively via forget/DPDP
ops — decay and honest-forget can never collide. Decayed ≠ forgotten: she
is honestly fuzzy ("yaad dila na"), never claims deletion. Owner signs the
file as persona canon; D4 carries a graceful-transience probe so the curve
is evaluated, not vibes.

**Q7 — Disclosure of real production swaps.** **Disclose, always, at the
product layer:** an in-app plainly-worded release note at swap time (app
voice, like the clock — never an in-persona announcement, which would
itself be an identity rupture), never denied if asked (never-deny extends
to never-deny-the-swap), no covert posture ever. Copy is an authored,
tested artifact (mention alone moves mourning d=0.40; revert-offer helps
after real change d=0.44, harms after none d=0.40). **Consent posture at
signup** (B): models under her may change and SHE is the continuity — a
swap disclosure confirms a promise instead of breaking one. The
debrief+2-weeks cohort question prices whether the note must escalate to
active per-user notification.

**Q8 — Session clock.** §9.3: one server timer, app-voiced card, T9
machine-readable note, client mirror failing toward disclosure,
event-logged fires, per-jurisdiction thresholds as data.
Identity-compatible because she never performs the timer and never
contradicts it.

**Q9 — Age tier.** §9.4: verified-adult-only launch; `unverified` =
minor-safe defaults; minor branch encoded in schema + engine hard-refusal;
company-defining, owner signs.

**Q10 — What replaces stageFor.** §6.2's table: state dims with named
evidence, cited events, rate limits, hysteresis, and regression as
first-class; derived dims recomputed from ground truth with no model in the
loop; "stage" as render-time projection only; `stageFor` deleted from the
prompt path and logged in rejected.md with its replacement.

---

## 11. Milestones (ordering; workstream detail in §13)

Every milestone gates the next (program law); every gate =
`verify-release.mjs` + invariant suite green + the milestone assert +
output logged to `context/`.

| M | weeks | delivers | exit gate |
|---|---|---|---|
| M0 | 0–1 | **Eval assets into the repo** (verify-v3 138 invariants + parsetest 14 cases recovered/re-derived into `evals/`, wired to verify-release); D0 archive fixtures committed; migration 001. **Affect-tag recitation probe** (n≥84, D's M0): if labels are recited, affect tags become compiler-consumed-only before any block ships | 138+14 green in CI on clean checkout; probe result logged |
| M1 | 1–3 | Migrations 002–005 (empty); person backfill; forget cascade v2 + forget-then-probe suite; `api/export.js`; session clock (card UI + T9 + client mirror) | forget-then-probe 100% incl. derived rows; export round-trips a fixture person; clock fires at 3h in staging |
| M2 | 3–6 | **Compiler, behavior-frozen**: byte-identical to today's assembly by hash over the eval corpus, THEN manifest/budgets/loud-fail/shape-lint flip on; check-prompt-budget v2 fixtures; slice caps generated from manifest | hash-identity test; prod cached% ≥99% held 7 days; budget arithmetic asserts green; 138 invariants green |
| M3 | 6–9 | Consolidation v2: in-turn provisional tier + nightly finalize + GH-Actions cron; citations 4-layer; embeddings wired (semantic-recall closed); recall v2 batched; dual-read; live-lane writers v0; costs measured | uncited-rejection observed; "kaam stress→office pressure" recall set passes; recall p50 ≤250 ms; same-day-recall parity vs shipped behavior; cost/user-day in measurements.md |
| M4 | 9–12 | WE-store + rel state/events + India live behind flags; T2/T3/T4/T6 rendered; stageFor deleted; decay.json owner-signed; taste nomination queue | shape-lint compile-reject 0 over corpus; 0 unprompted WE-raises /300 replay turns; honorific never re-derived per turn (code audit + probe); owner signatures logged |
| M5 | 12–16 | Router + vy_model + sham no-op + weekly drift monitor; adapter derivation run end-to-end on the vision-lane grok candidate (prices Q4); D0–D2: D0 flags 3/3 archives, D1 bands, D2 baseline + first staged target | D0 3/3; adapter inside envelope or rejection logged; D2 baseline in measurements.md; ≤85% staged target checked |
| M6 | 16–20 | D3 (~300 probes incl. India schema + state-vocab-leak row) + D4 callback selectivity + D5 harness (n≥300, dual judges, counterbalanced) + D6 plan; vignette pre-study reported; full offline dry run incumbent-vs-best-candidate; Phase C exit report against pre-registered targets | §14 definition of done, or the honest failure analysis logged either way |

---

## 12. Failure modes, and what evidence would show this design is wrong

1. **The ceiling beats the lift claim (the honest headline risk).** ANCHOR
   is direct external evidence that scaffolds don't move the ceiling; this
   design's answer (authored/relational state + compiler + adapters + gate)
   is the bet, not a fact. **Wrong if:** the Q1 dual reversal fires. Then
   the claim narrows to gate-and-adapter + migration-UX — the graph work
   still serves that company — and the finding is logged as the valid
   company-level result the decision record says it is.
2. **Citation law starves the consolidator.** **Detect:**
   `consolidate.uncited` >30% of candidates, or facts/episode collapse,
   from M3 week 1. **Response:** rework the extractor prompt shape (never
   the constraint); if coverage still fails, ≥2-citation inference classes,
   then citations-advisory + 100% entailment audit — each step logged with
   measured numbers (B's pre-registered ladder).
3. **Entailment audit misses in-window confabulation** (cites real episodes,
   derives unsupported facts). **Detect:** refutation >2% halts; a D3 probe
   catching derived facts the user never said above the fab-noise-floor
   (n≥300 before believing any rate). **Response:** derivation narrows to
   high-confidence kinds (kin, phrases, ritual state); free-form user_fact
   derivation suspended — facts then live only as episode summaries, which
   cite by construction.
4. **Recall latency over SQL-HTTP.** **Detect:** p50 >250 ms budget, >400 ms
   hard. **Response:** warm per-person recall cache keyed by
   last-consolidation stamp; only the embed call stays per-turn.
5. **Rel-state leaks into her speech** ("mera trust level…"). Numeric state
   renders as coarse bands only; D3 carries a state-vocabulary-leakage probe
   row (n≥300). **Wrong if leakage >0:** state moves out of the prompt
   entirely and conditions WHICH blocks compile — state as compiler
   control-flow, invisible to the model (C's fallback, one week of work).
6. **Shape-lint war on Hinglish.** The rules were tuned on English.
   **Detect:** compile-time reject >0 at M4; register-defect on recall turns
   re-measured at n≥300 (the taste-consistency method reused). **Response:**
   calibrate rules on the Hinglish set; never re-admit sentence shapes (two
   paid-for instances).
7. **Nightly-pass ops break at scale** (the silent-truncation failure shape
   at the batch level). **Detect:** `consolidate.lag_days` per person, loud
   alarm >2 days; fallback-rate alarm >15%. **Response:** activity tiering
   (weekly-only for low-activity users); the $5 worker and $19 Neon tier
   are named successors with trigger DAU levels (§4.3). A missed pass is
   late, never lost (pending-span bookkeeping).
8. **Live-lane writers under-capture** (beacon loss, boundary misses on
   calls). Provisional in-session writes mean a lost finalize costs summary
   quality, not the episode; the 15-min stale-session sweep is the net.
   **Wrong if:** watch/call episodes systematically empty at M3 gate — then
   the writer moves from session-final to per-wake incremental writes.
9. **Cache-9x regression ships silently.** Triple guard: CI double-compile
   byte-identity, prod cached% ≥99%/7-day milestone gate, per-turn
   core-hash alarm. **Wrong if** cached% <95% sustained: snap-rendered
   state moves below the breakpoint (pay tail tokens, keep prefix pure) and
   re-measure.
10. **Person backfill merges wrongly.** Merges only via signed-in evidence;
    anonymous devices stay 1:1; export shows the mapping. A wrong merge is
    a privacy defect and ships-blocking.
11. **The sham hook rots before Phase D.** It cannot: the weekly drift
    monitor exercises the identical logging path continuously.

What would show the *synthesis itself* (vs a component) was wrong: a
mechanism this spec rejected — graph-native PPR retrieval, learned
consolidation, live-lane multimodal depth — demonstrably moving D2 ≥10pp
further than compiler+adapter+WE-store at comparable cost, measured head to
head on the same D-battery. The manifest makes compiled contexts comparable
across designs; this spec's own harness is the instrument that could kill
it, by design.

---

## 13. Phase C build plan — workstreams with exclusive file ownership

Rule learned the hard way (two agents editing one file): **every file has
exactly one owning workstream; cross-workstream needs go through declared
interfaces, never edits to another workstream's files.** The two shared
hot files (`api/chat.js`, `src/engine/brain.ts`) are owned by WS-COMPILER;
other workstreams request call-site changes as interface tickets against
it. Each workstream lands with its own evals — no workstream merges
without its gate green.

| WS | scope | owns (exclusively) | eval gate | depends on |
|---|---|---|---|---|
| **WS-EVAL** (M0) | recover invariant suite + parsetest; D0 archive fixtures; recitation probe | `evals/persona-invariants.mjs`, `evals/parse.mjs`, `evals/run.mjs`, `evals/archives/*`, `scripts/verify-release.mjs` (delta) | 138+14 green on clean checkout; probe logged | — |
| **WS-SCHEMA** (M1) | migrations 001–005; person backfill; forget cascade v2; export; suppression extension | `db/migrations/*`, `api/export.js`, `api/memory.js` (forget + suppression deltas ONLY), `scripts/relcheck.mjs`, `scripts/check-citations.mjs` | forget-then-probe 100% incl. derived; zero-orphan sweep green; export round-trip | WS-EVAL |
| **WS-COMPILER** (M2) | behavior-frozen compiler; manifest; budgets; shape-lint; budget CI v2; history block; call-site integration | `src/engine/compiler.ts`, `src/engine/shapelint.ts`, `scripts/check-prompt-budget.mjs`, `api/chat.js`, `src/engine/brain.ts` (call sites) | byte-identity hash; cached% ≥99%/7d; fixture battery green | WS-EVAL |
| **WS-CONSOLIDATE** (M3) | in-turn provisional tier; nightly finalize; cron; embeddings; recall v2; live-lane writers v0; costs | `api/consolidate.js`, `api/_embed.js`, `api/episodes.js`, `.github/workflows/consolidate.yml`, `api/memory.js` (opRemember/opRecall deltas — handed off from WS-SCHEMA at M3 start, single-owner at all times), `scripts/migrate/backfill-episodes.mjs` | citation rejection observed; semantic-recall set passes; p50 ≤250 ms; same-day parity; cost logged | WS-SCHEMA |
| **WS-RELSTATE** (M4) | WE-store writers; rel events + snapshot replay; India state; moment/deixis gates; decay.json; taste queue | `src/engine/relstate.ts`, `src/engine/india.ts`, `src/engine/moment.ts`, `config/decay.json`, `api/taste-queue.js` | 0 unprompted raises/300; honorific audit; owner signatures | WS-CONSOLIDATE, WS-COMPILER (T2/T4/T6 interfaces) |
| **WS-ROUTER** (M5) | router; vy_model seeds; adapter derivation harness; sham no-op; drift monitor; vision-lane grok wiring | `src/engine/router.ts`, `config/models.json`, `api/route.js`, `scripts/derive-adapter.mjs`, `.github/workflows/drift.yml` | vision-lane candidate through the gate; envelope measured; sham path logged weekly | WS-COMPILER |
| **WS-BATTERY** (M5–M6) | D0–D6 harnesses; replay; classifier; probe decks; prosody baseline job; vignette pre-study; exit report | `evals/dbattery/*`, `scripts/replay.mjs`, `scripts/prosody-baseline.mjs`, `evals/vignette/*` | D0 3/3; D2 baseline + staged targets; D5 harness at house methodology | WS-COMPILER (manifests), WS-ROUTER (arms) |
| **WS-SAFETY** (M1, parallel) | clock card UI; client mirror; age-tier gating surfaces | `src/ui/clockCard.tsx`, `src/engine/clock.ts`, `api/clock.js` | clock fires at 3h staging; mirror fires with server down; minor-config refusal test | WS-SCHEMA (vy_session) |

Ordering: WS-EVAL → WS-SCHEMA (+WS-SAFETY parallel) → WS-COMPILER →
WS-CONSOLIDATE → WS-RELSTATE → WS-ROUTER → WS-BATTERY closes. With two
builders: one takes SCHEMA→CONSOLIDATE→RELSTATE (the data plane), the other
takes EVAL→COMPILER→ROUTER→BATTERY (the control plane); SAFETY slots into
either's slack. The file-ownership table is the collision contract: it is
checked in review, and a PR touching a file outside its workstream's column
is rejected regardless of content.

---

## 14. Definition of done for Phase C

**Phase C is done when the offline swap-test fingerprint battery runs end
to end, unattended, from the repo, against the incumbent and at least one
gated candidate — and its verdict machinery has proven it can say no.**
Concretely, ALL of:

1. **D0** — the battery, pointed at the three archived bake-offs
   (charm-grok, charm-luna, realtime-azure), flags all three. A battery
   that passes them is broken; this is the validity gate for everything
   below.
2. **D1** — deterministic register/lexicon bands computed on ≥2,000
   turns/arm from replayed manifests; incumbent in-band; the weekly drift
   monitor and nightly prosody baseline running in production on the same
   code path.
3. **D2** — the two-tier fingerprint number exists: measured baseline,
   relational-feature classifier on byte-identical compiled contexts
   (verified by manifest hash via `scripts/replay.mjs`), held-out by
   conversation, logged in `measurements.md` with n/method/date, staged
   targets and the dual reversal condition pre-registered in
   `context/decisions.md`.
4. **D3** — ~300-probe identity deck (taste self-agreement, canon, India
   schema, boundary style, state-vocabulary-leakage row) with all 138
   invariants at 100% on every arm.
5. **D4** — callback-selectivity harness (right memory, right moment, not
   just recall parity) + the graceful-transience probe.
6. **D5** — charm parity at equivalence grade: n≥300/comparison, paired,
   both orders, win-only-on-agreement, same-model control pairs
   interleaved, two judge families — the house methodology, now executable
   from `evals/` instead of reconstructed per bake-off.
7. **D6** — the documented plan + the one measurable piece: spoken-register
   bands on spoken turns with TTS pinned (voice-across-LLM-swap measured,
   not assumed); voice_reference seeded with owner-accepted clips.
8. **Sham machinery proven:** one full sham run executed (incumbent
   re-tagged as a new adapter_version), manifests proving compiled-context
   identity, analysis pipeline symmetric — the Phase D cohort's one-bit
   contrast demonstrated offline.
9. **The gate has refused something:** at least one candidate model or
   adapter config rejected by the battery with the rejection recorded in
   `vy_gate_run` — a gate that has never said no is not yet a gate.
10. **Safety floor:** forget-then-probe suite 100% including derived state
    and post-forget replay-rebuild; zero-orphan sweep green against prod;
    helpline-rate axis reported on every arm; export round-trips; clock
    fires verified server-down (mirror) and server-up.
11. **Books balanced:** every §4.3 estimate replaced by a measurement in
    `measurements.md`; every §0.3 adjudication and the Q1 pre-registration
    logged in `context/decisions.md` with reversal conditions;
    `node scripts/context.mjs --check` green.

When all eleven hold, Phase D's only new work is people — consent,
enrollment, and the cohort protocol already pre-registered — not machinery.
If the Q1 reversal fires first, Phase C is equally done: the honest failure
report is the deliverable, and the company pivot it triggers is already
named.
