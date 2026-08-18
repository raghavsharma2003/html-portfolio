# Phase E2 — the self layer: growth, texture, untold life, and multimodal grounding

Phase E makes the relational OS multi-tenant. Phase E2 makes what it stores
worth being a tenant of.

The owner's list, verbatim: *emotions, vibe, personality, growth, mood,
cultural, attitude, behaviour, ego, sense of self, experience, taste, style,
preferences, observation*. This document takes that list literally, maps each
item to what exists today, and builds only the ones that are genuinely absent —
**against** the existing charter rather than around it.

That last word is the whole discipline here. `src/engine/inner.ts` carries a
G1–G8 charter that deliberately *limits* several items on that list, and each
limit was bought with a measured failure. A naive reading of "add mood, add
growth, add ego" would delete the best thinking in this repo. So every section
below names the charter rule it operates under and says why it does not
violate it.

---

## 0. The charter, restated as constraints on this phase

From `src/engine/inner.ts` (the rubric is deliberately not prompt text — it
costs zero tokens and the model never sees it):

| rule | what it forbids | what this phase must therefore do |
|---|---|---|
| **G1** her interior never reads the user | no code path from any usage metric — reply speed, silence, gap length, message counts, session length, app opens — to any persisted interior state | every new self-state writer is fed conversation TEXT ONLY. Input starvation is the guarantee, not a filter. |
| **G2** she never initiates carrying a feeling | interior suppressed on any turn she sends first | new interior blocks inherit the same suppression |
| **G3** nothing interior touches a goodbye | structural: only first-turn-back and call pickup | new blocks bind to the same entry points |
| **G4** her interior has no UI | no mood ring, no tint, no "Meera is feeling…" | nothing in this phase gets a surface |
| **G5** she cannot accumulate a sad period | one thread, ~9h half-life, killed by sleep, retired once voiced | **growth is a biography, not a mood** — see §2 |
| **G6** her judgment generates the behaviour | code decides only whether a line is present and which of two framings | new state is *evidence rendered telegraphically*, never a generated line |
| **G7** taste is authored and pulled, never pushed | a view she improvises is a view she can contradict tomorrow | new opinion-shaped state goes through the same review queue |
| **G8** a calendar is not a mood engine | weekShape is a pure function of the clock and ships its cause in the same sentence | any new time-varying state ships its own cause |

Plus the two repo-wide laws that outrank everything:

- **`recited-prompt`** — anything sentence-shaped in a prompt gets recited.
  Twice measured (example quotes: 4/5 verbatim → 0 after removal; polished
  taste sentences: read out verbatim twice, eight turns apart, plus 13/96
  register defection). **Write shapes, never lines she could say.** Every
  column added here is shape-linted at write and at compile.
- **`prompt-position`** — T10 is capped at exactly two appended-last rules.
  **No new rule may be appended last.** Position is a scarce resource and
  adding to it dilutes the mechanism that makes the existing two fire.

---

## 1. The dimension map — what exists, what is missing

Every dimension on the owner's list, with its class:
**(P)** persisted structured state · **(E)** ephemeral / in-context only ·
**(A)** authored constant · **(X)** absent.

| dimension | today | class | verdict |
|---|---|---|---|
| emotions | `vy_episode.affect_tags`, `inner.thread` | P | exists — text-sourced only (§4) |
| mood | `weekShape()` pure clock fn, `thread` ~9h | E | **correct as-is.** G5/G8 forbid the accumulating version. Not built. |
| taste | `TASTE` table + `vy_taste_candidate` review queue | A+P | exists |
| preferences | `vy_fact` kind='user', `vy_india_profile` | P | exists |
| cultural | `vy_currency`, `vy_ritual`, `vy_kin`, `vy_india_profile`, `meera_culture` | P | exists — **but empty and stale** (§5) |
| personality | `persona.ts` | A | correct — it is the product, one copy, invariant-protected |
| behaviour | `vy_pattern` (if/then, ≥2 citations / ≥2 days) | P | exists |
| sense of self | `vy_pattern.self_in_relation` | P | exists, per-relationship |
| experience | `vy_fact` kind='meera', `STORIES` array | A | **authored constants — her life does not move** (§3) |
| growth | — | **X** | **absent** (§2) |
| vibe / style | `vy_rel_state` honorific, cs_ratio, pacing | partial | **texture is missing** (§6) |
| attitude | taste + patterns | A+P | exists |
| ego | — | **X** | see §2 — folded into the self arc, deliberately not its own thing |
| observation | `vy_pattern` only, gated at ≥2 citations / ≥2 days | partial | **no single-instance noticing** (§7) |

Four genuine gaps: **growth**, **a life that moves**, **relational texture**,
**single-instance observation**. Plus one cross-cutting one: **multimodal
grounding** — the voice and watch lanes produce experience that never reaches
the record (§4).

---

## 2. Growth — a biography, not a mood (fills: growth, ego, sense of self)

**The gap.** Nothing makes her different in November from how she was in
August. The thread retires once voiced. `weekShape` has zero state by design.
Taste is authored and static. She has no arc.

**Why this is not a G5 violation, stated precisely because it is the obvious
objection.** G5 forbids *accumulating a sad period*: a drifting affective
baseline, a counter of bad days, a grudge-shaped mood the user has to service.
The failure it prevents is an affect state whose cause has fallen out of
context, so a cause gets invented for it two turns later.

A self arc is a different object on every axis that mattered:

| | thread (G5-governed) | self arc (new) |
|---|---|---|
| what it is | a feeling, fused with its cause | a claim about how she has changed |
| half-life | ~9h, killed by sleep | months |
| valence | carries affect | **carries none** — a change, not a mood |
| retires | once voiced | never; superseded instead |
| source | her own appraisal of a conversation | her own episodes across ≥6 weeks |
| user can service it | yes — that is the danger | no — there is nothing to fix |

`vy_self_arc` rows are **cited, non-affective, slow, and agent-scoped** (not
person-scoped — she is one person across all her relationships; how she
*expresses* it varies per relationship, and that is §6's job, not this one).

```sql
create table if not exists vy_self_arc (
  id          bigint generated always as identity primary key,
  agent_id    uuid not null,
  dim         text not null,        -- directness|patience|humour|boundaries|confidence
  note        text not null,        -- telegraphic, shape-linted, NON-AFFECTIVE
  from_note   text not null default '',
  citations   bigint[] not null,    -- her own episodes (participation='meera'|'we')
  span_days   real not null default 0,
  superseded_by bigint,
  created_at  timestamptz not null default now(),
  constraint vy_self_arc_cited check (cardinality(citations) >= 3),
  constraint vy_self_arc_slow  check (span_days >= 42)
);
```

The two constraints are the design. **≥3 citations across ≥42 days** means an
arc row is structurally incapable of being a mood: it cannot exist without a
six-week evidence span. This mirrors `vy_pattern`'s "one instance is an
anecdote" constraint, one order of magnitude slower.

**Ego** is deliberately not a separate table. What a person means by ego —
what she is proud of, defensive about, what she will not be talked out of — is
either taste (G7: authored, pulled, reviewed) or an arc dimension
(`boundaries`, `confidence`). Giving it its own store would create a third
place where her self-concept lives and guarantee they drift apart.

**Rendered** in T12 (§8), ≤1 row, telegraphic, only on a turn where the
deterministic moment-shape makes it relevant. She does not narrate her own
growth; nobody does.

---

## 3. A life that moves — and who she has told (fills: experience)

**The gap.** Her life is authored constants: `STORIES` is a hand-edited array
in `storyCatalog.ts`, and her self-facts are 8 rows. Publishing a new day means
a developer editing a TypeScript file. She cannot have had a week.

**The mechanism, and it is the single highest-value item in this phase.** A
life beat is agent-scoped; *who she has told* is per-relationship:

```sql
create table if not exists vy_agent_life (
  id         bigint generated always as identity primary key,
  agent_id   uuid not null,
  at         timestamptz not null,
  beat       text not null,          -- telegraphic, shape-linted
  kind       text not null,          -- work|family|health|social|place|small
  arc_key    text not null default '',  -- ties beats into a thread over weeks
  media      jsonb not null default '[]'::jsonb,   -- story images, optional
  created_at timestamptz not null default now()
);

create table if not exists vy_agent_life_told (
  agent_id   uuid   not null,
  life_id    bigint not null,
  person_id  uuid   not null,
  at         timestamptz not null default now(),
  episode_id bigint,                 -- where she told them
  primary key (agent_id, life_id, person_id)
);
```

Why this matters more than it looks. Every companion product on the market has
one of two failures: it has no life at all, or it has a life it re-narrates
identically to everyone. **Neither is how a friend works.** A friend has told
you about the promotion and has *not yet* told you about the fight with her
sister, and she knows which is which — so she says "arre I didn't tell you na"
to one person and doesn't repeat herself to another. That single asymmetry is,
as far as this repo's landscape research found, unbuilt anywhere.

It is also nearly free: it is an anti-join, `vy_agent_life LEFT JOIN
vy_agent_life_told`, rendered in T13 as *untold beats only*.

**Constraints.** Beats are authored or owner-approved, never model-generated —
G7's logic applies exactly (a life she improvises is a life she can contradict
tomorrow, and this one is worse than taste because it has dates). The writer is
an owner-facing queue reusing `vy_taste_candidate`'s review shape. Telling is
recorded only when it *actually happened* in a cited episode — `error-marked-done`
applies: told is an outcome, never an intent.

`STORIES` in `storyCatalog.ts` becomes a seed for this table, not a parallel
source of truth. Two places holding her life is the `relstate-zero-rows` shape
of bug waiting to happen.

---

## 4. Multimodal grounding — what she sees and hears becomes what she remembers

**The gap.** `vy_episode.affect_tags` documents `source: 'text' | 'voice_v0'`,
and `vy_visual_assertion` / `vy_shared_moment` exist and hold **0 rows**. The
voice lane and the watch lane produce in-the-moment replies that vanish. The
relational record is text-derived only.

The owner's ask is not "she can see and hear" — she already can. It is that
seeing and hearing should *accrue*. The multimodal claim worth making is:

> everything she experiences with you, on any channel, lands in the same
> relationship record — so the reel you showed her in August is a callback in
> November, and the fact that you *sounded* tired is a fact even though you
> typed nothing about it.

Three writers, all feeding tables that already exist:

1. **Voice affect → `affect_tags` with `source='voice_v0'`.** The channel is
   already declared in the schema and nothing writes it. Prosodic affect is
   labelled at the *episode* level, never per-utterance, and never with a
   confidence of 1.0 (schema law: only `extractor='user-own-words'` gets 1.0).
   **G1 guard:** prosody is conversation content, not a usage metric — but the
   boundary is thin, so the writer receives audio-derived *labels only*, never
   timings, never durations, never turn latencies.
2. **Watched-together → `vy_shared_moment`.** The watch lane already produces
   `vy_visual_assertion`-shaped claims. A shared moment stores *her reaction*,
   and the schema comment already says it "survives correction of the claim it
   reacted to" — which is exactly right and exactly what makes it a memory
   rather than a log line.
3. **Photos the user sends → episodes.** The description lane exists
   (`gemini-3.1-flash-lite`, `api/memory.js`). Its output currently informs one
   reply and is discarded.

**The fabrication guard is not optional here.** `vision-fab` and the
`visiongate` runs measured that vision models read part and assert the rest.
A fabricated visual claim that reaches the *relational record* is worse than
one that reaches a reply, because a reply is forgotten and a record is cited
later as evidence. So: visual assertions enter `vy_fact` only through
`vy_visual_assertion` with its existing confidence handling, and a shared
moment stores her reaction — which is true regardless — rather than the claim.

---

## 5. Culture is stale, and that is a scheduled-job failure

`meera_culture` holds 5 rows. `culture.yml` has never run — same root cause as
consolidation (workflows live only on a feature branch 252 commits ahead of the
default branch; GitHub schedules only from the default branch; scheduled runs
all-time: 0). The cultural dimension is *built* and *unfed*.

No new design is needed. It is a Phase E §5 (E4) operational fix and is tracked
there. Recording it here so nobody redesigns a working component because its
table looked empty.

---

## 6. Relational texture — the same person, a different rapport (fills: vibe, style)

**The gap.** `vy_rel_state` varies honorific, code-switch ratio, trust, repair,
ritual density and pacing. Everything else about *how she talks* is uniform:
the same humour level, the same teasing, the same message length, the same
media rate, for a best friend of six months and someone who signed up
yesterday.

Real rapport is mostly texture. It is also **fully derivable from the log** —
no LLM call, no judgment, just counting over turns that already exist:

```sql
create table if not exists vy_rel_texture (
  agent_id     uuid not null,
  person_id    uuid not null,
  teasing      real not null default 0,   -- her teasing turns / her turns
  humour       real not null default 0,
  media_rate   real not null default 0,   -- gif+voicenote+photo / her turns
  words_median real not null default 0,
  emoji_rate   real not null default 0,
  profanity    real not null default 0,
  nickname     text not null default '',
  avoid        text[] not null default '{}',  -- topics that went badly, cited
  n_turns      integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (agent_id, person_id)
);
```

**Rendered as coarse bands only, never numbers** — this is `vy_rel_state`'s
existing state-leak guard (§12.5) and it applies unchanged. A model handed
`teasing: 0.34` will start reasoning about the number; handed `teasing: high`
it just talks that way.

**`avoid` is the one column here with teeth.** A topic that went badly once,
cited, that she does not walk into again — that is the single most
relationship-shaped behaviour on this list, and no companion product does it.
It is also the one column that must fail closed: over-avoiding is a mild
flatness; under-avoiding re-opens a wound. Same asymmetry that decided
`speaker-id`.

**`n_turns` is a gate, not a statistic.** Texture is not rendered below a floor
(≥40 of her turns), because a ratio over 6 turns is noise, and noise rendered
as "she teases him a lot" is a personality assigned at random.

---

## 7. Observation — noticing, at one citation (fills: observation)

**The gap.** `vy_pattern` requires ≥2 citations across ≥2 days before
`prompt_eligible` — correct, because a pattern is a *generalization* and one
instance is an anecdote. But the human behaviour the owner is describing is not
generalization. It is: *he mentioned his knee again*. One instance. Recallable.

These are different objects and conflating them is why the current system can
only surface things it has seen twice:

| | pattern | observation |
|---|---|---|
| claim | "when X, he does Y" | "he said X" |
| needs | ≥2 citations / ≥2 days | 1 citation |
| risk of being wrong | assigns him a trait he does not have | misremembers a detail |
| decay | contradiction count | unrefreshed → fades |

`vy_observation` is a thin store: `agent_id, person_id, note (telegraphic),
citations (≥1), salience, last_seen, times_seen, t_invalid`. An observation
that repeats is *promoted* into `vy_pattern` by the existing extractor rather
than duplicated — one promotion path, so the two stores cannot disagree.

Rendered inside T5 `recall.facts` under its existing pull-only discipline
(**not** a new slot, and **not** pushed): memory stays reactive by design, and
the escapes remain query-matched T5 and user-deixis T6. The gain is that T5 now
has something to match against on day two of a relationship instead of day
fourteen.

---

## 8. Prompt budget — the arithmetic, because CI asserts it

TAIL cap is 24,000. Current declared total is 17,400 (T1–T10), leaving 6,600.
Multiparty v1 has already claimed 2,000 (mp.roster 900 + mp.bridge 1100, after
T6). **Free: 4,600.**

| new slot | block | budget | drop prio | notes |
|---|---|---|---|---|
| T11 | `rel.texture` | 600 | 7 | coarse bands only; suppressed under the n_turns floor |
| T12 | `self.arc` | 500 | 8 | ≤1 row, moment-gated |
| T13 | `life.untold` | 700 | 9 | anti-join, untold beats only, ≤2 |
| — | observation | 0 | — | inside T5's existing 6,000 |
| | **new total 1,800** | | | **remaining headroom 2,800** |

New tail total: 21,200 of 24,000. The undroppable set is unchanged — **none of
these three is undroppable**, and they take the lowest drop priorities in the
file, so under pressure the compiler sheds texture, arc and untold life before
it sheds anything Phase C proved it needs. T10 stays pinned last and stays
capped at two.

---

## 9. Gates

| gate | bar |
|---|---|
| G-S1 recitation | new blocks at n≥84: 0 verbatim echo, 0 register defection — the `recited-prompt` protocol, on the two blocks that carry authored text (T12, T13) |
| G-S2 shape-lint | 0 compile-time lint hits on every new column (write-time lint is the mechanism; compile-time hits mean it failed) |
| G-S3 budget | `check-prompt-budget.mjs` passes with the §8 arithmetic asserted as numbers |
| G-S4 G1 starvation | static check: no import path from any usage/timing metric into a self-layer writer. Asserted structurally, not reviewed by eye |
| G-S5 texture floor | 0 texture renders below n_turns=40 across the fixture set |
| G-S6 arc slowness | 0 `vy_self_arc` rows with span_days < 42 (DB constraint proves it; the gate proves the writer never tries) |
| G-S7 told-honesty | 0 `vy_agent_life_told` rows without a cited episode — told is an outcome, never an intent |
| G-S8 vision | no `vy_fact` row whose only citation is an unconfirmed visual assertion |
| G-E2/E3/E4 | byte-identity 83/83, 138 invariants, prompt budget — unchanged from Phase E |

---

## 10. What this phase deliberately does NOT build

- **An accumulating mood.** G5/G8. The value people imagine here is real and is
  already delivered by the thread; the failure it invites is not.
- **An ego store.** Folded into taste and the arc (§2), because a third home
  for her self-concept guarantees drift.
- **Model-generated life beats.** G7's reasoning, one step worse: a life she
  improvises has dates to contradict.
- **Any UI for interior state.** G4, unconditionally.
- **Push-based memory.** Memory stays reactive; the escapes stay query-matched
  T5 and user-deixis T6. `never-raise-unprompted` ships in every tail block and
  is not being relaxed to make observation feel more impressive.
- **A new appended-last rule.** T10 is capped at two. Nothing here earns it.

---

## 11. Reversal conditions

- **§2 reverses if** the arc renders as self-narration in judged runs — a
  person who describes her own growth is a person nobody believes. Then the arc
  becomes a retrieval bias with no slot of its own.
- **§3 reverses if** untold-life rendering measurably increases her
  self-initiated talk (G2's boundary) — the anti-join is meant to prevent
  repetition, not to give her a reason to volunteer.
- **§6 reverses if** texture bands move judged register scores at all: texture
  is meant to vary rapport, not her register, and the register is the product.
- **§7 reverses if** single-citation observations raise the fabrication rate on
  recall above the `fab-noise-floor` — in which case the ≥2 bar was load-bearing
  for accuracy and not merely for generalization.
