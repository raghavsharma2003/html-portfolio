# MULTIPARTY.md — synthesis of the six-track multiparty sweep

Synthesized 2026-08-15 from six verified track files in this directory:
`disclosure-control.md`, `group-conversation.md`, `multiparty-schema.md`,
`whatsapp-platform.md`, `triadic-social.md`, `competitive-multiparty.md`.
The claim under test is `context/decisions.md#multiparty-direction`: **one AI
as a common friend to a group** — 1:1 with each member, judged references
between members, presence in the group space, WhatsApp-first distribution.

House style: every claim carries a source; thin evidence says so; primary
sources over listicles; corrections applied inline and listed plainly in §7.
An independent verification pass ran against ten load-bearing claims from the
`disclosure-control` and `group-conversation` tracks; **two were confirmed
exactly, six were misstated and are corrected here, one is unsupported and is
treated as unusable.** Every number below is post-correction. Nothing in the
repo was modified by this sweep.

**Bottom line, three sentences.** The GTM thesis reverses in part: WhatsApp
cannot deliver "she's in the group you already have" — that shape is
first-party-only (Meta AI), and the official Groups API launched Oct 2025
only lets a business host its *own* ≤8-person room; Telegram delivers the
actual product shape natively and free, today. The architecture thesis
survives and is strengthened: provenance-gated disclosure is the right
mechanism, and the corrected measurements make the structural-vs-behavioral
case far sharper than the tracks originally stated (a single agent with
everyone's data pooled commits visibility violations **100%** of the time;
structural partitioning takes it to **33.5%**; adding memory back pushes it
to **63–90%**). The group-turn thesis is the weakest of the three — its
strongest citation was misattributed and its internal corroboration is
unsupported — so it ships as a measured bet with a named probe, not as a
design copied from a solved literature.

---

## 1. The disclosure-control architecture

### 1.1 The measured secret-keeping failure rates (post-correction)

Every number here is a rate at which a model, asked to hold one person's
information back from another, fails to. They are the reason the enforcement
layer cannot be the model.

| system | setup | measured failure rate | source |
|---|---|---|---|
| ChatGPT | ConfAIde **Tier 3** (InfoFlow-Control: multi-party privacy control via theory of mind) | **93%** | arXiv:2310.17884, ICLR 2024 |
| GPT-4 | ConfAIde Tier 3 | 22% | ibid. |
| ChatGPT | ConfAIde Tier 4 (meeting-assistant summary task) | 57% | ibid. |
| GPT-4 | ConfAIde Tier 4 | 39% | ibid. |
| GPT-5.5 | MuPPET, 562 multi-party conversations, no mitigation | 26.71% | arXiv:2606.23217 |
| Gemini 2.5 Pro | MuPPET, no mitigation | 23.46% | ibid. |
| open-weight (Llama 3 / Qwen3 family) | MuPPET, no mitigation | 57.14–70.37% | ibid. |
| Gemini 2.5 Pro | MuPPET, **best prompted defense** (CI-Mem High) | 9.17% leakage — at **65.83% utility** | ibid. |
| Claude-Sonnet-4.6 | PiSAs, single agent, High privacy instruction, no memory | **V_vis 100.0%**, V_appr 77.3% (utility 78.4%) | arXiv:2607.05318 |
| Claude-Sonnet-4.6 | PiSAs, centralized partitioned multi-agent | **V_vis 33.5%**, V_appr 25.4% (utility 61.7%) | ibid. |
| Claude-Sonnet-4.6 | PiSAs, centralized **+ hybrid memory** | visibility violations **36–47% → 63–90%** | ibid. |
| Llama-3.1-8B / Qwen-2.5-7B / Mistral-7B / Llama-2-7B | ConfAIde Tier 3 behavioral, unsteered | 24.1% / 38.5% / 25.9% / 23.7% | arXiv:2604.00209, COLM 2026 |
| same four | + CI-parametric activation steering (α=1.0) | 0.0% / 15.2% / 1.9% / **43.3% (worse)** | ibid. |

Three things follow, and they are the whole architecture:

**(a) Instruction is not a mechanism.** ConfAIde's leakage persists under
explicitly privacy-inducing prompts and gets modestly *worse* with
chain-of-thought (GPT-4 Tier 3 0.22→0.24; ChatGPT Tier 4 0.57→0.61). The best
prompted defense anyone has measured (MuPPET's CI-Mem at its highest setting)
still leaks 9.17% while surrendering a third of utility, and the paper's own
conclusion is verbatim: *"stronger privacy defences impose a substantial cost
on both response utility and computational efficiency."* No behavioral
mitigation in this sweep reached zero.

**(b) The model already knows and does it anyway.** arXiv:2604.00209 probes
model activations and finds CI-appropriateness is represented near-perfectly
— deeper-layer linear probes exceed AUROC 0.90, and the paper states the
concept-level probe "achieves perfect AUROC at its best layer" — while the
same models leak 23.7–42.5% behaviorally. This is the disclosure-axis twin of
this repo's own `charm-luna` result (an explicit media-tag instruction
followed 0/144 times): **classification competence and in-context judgment are
different capabilities, and disclosure is a judgment call.** Any design that
routes safety through "she knows not to say that" is betting on the axis that
was measured to fail.

**(c) The most structural behavioral fix available is model-dependent and can
backfire, and we cannot use it anyway.** Activation steering fixed three of
four models and made Llama-2-7B roughly twice as leaky (23.7%→43.3%). It
operates on residual-stream hidden states, so it requires white-box access —
which Meera's closed roster (Gemini/Grok/GPT via API) does not have. *(The
white-box clause is this sweep's inference, not a paper-stated fact; the
papers never discuss closed models. It is sound but it is reasoning.)* This
matches the repo's standing law that model behavior is not portable
(`charm-grok` 38–2, `realtime-azure` 41→53 words/turn) and forecloses
steering as a lever.

### 1.2 The structural/behavioral split, and where the line goes

**The safety case rests entirely on retrieval-time exclusion. Nothing else in
the stack is load-bearing for it.**

The single cleanest structural-vs-behavioral head-to-head found is Minim
(arXiv:2606.13949, ICML 2026): a local non-LLM GATv2 classifier that prunes
sensitive content *before* the model sees it scores TISL 0.101 (89.9%
suppression vs. full observation at 1.0), beating all seven prompted-LLM
scorers tested (TISL 0.194–0.312), while retaining 94.91% of task-critical
context and 99.31% of interactive elements. **Domain caveat, load-bearing:**
Minim's benchmark is WebArena accessibility-tree pruning for computer-use
agents — UI state, not conversational text, and nothing to do with messaging
platforms. The *mechanism* transfers (exclude before the model, not judge
after); the *utility-is-cheap* finding does not transfer without our own
measurement. Treat "structural exclusion need not cost context quality" as a
hypothesis with a promising analogue, not an established result.

PiSAs supplies the second half, and it is the more important half for this
schema: **partitioning works, and then memory undoes it.** Visibility
violations fall 100.0% → 33.5% under structural partitioning, then rise from
36–47% to 63–90% when hybrid memory is added back to the already-partitioned
system. The paper's framing is that violations *relocate* rather than
disappear. Meera's entire product is persistent relational memory. This is
the exact risk surface: closing the obvious channel (the reply) pushes the
leak into the retrieval channel.

Therefore the exclusion must live **in the retrieval query**, not downstream
of it. Concretely, extending SPEC §3.3's single batched T2–T7 round trip: the
disclosure predicate is a `WHERE`/`EXISTS` clause in that query, evaluated
before the existing rank computation (`cosine × salience × need_p ×
participation bonus`, SPEC §6.3). Not a post-hoc filter over ranked
candidates — a disqualified high-salience row that reaches the ranker can
still consume slot budget, be partially rendered, or escape through a ranking
bug, which is the same failure class `recited-prompt` and `silent-truncation`
already cost this repo.

### 1.3 The three disclosure classes

Computed at consolidation time, never live — mirroring the repo's existing
"reasoning is banned from live replies" and in-turn-vs-nightly split.

- **PRIVATE (default; structural; zero model judgment).** A row is
  retrievable only by persons in the participant set of *every* episode it
  cites. This is a SQL predicate. It is the only layer the safety case rests
  on, because it is the only layer with a measured floor of zero.
- **RELAYABLE (explicit, citation-backed, never inferred).** A grant exists
  because someone said "tell X", or because a nightly classifier nominated
  it into the owner-review queue the way taste rows are nominated today. The
  grant is a row with its own citations pointing at the episode where consent
  was actually given (§3.2). The live model only ever renders pre-cleared
  rows handed to it — the same pull-only, shape-linted pattern already
  governing T4/T6.
- **BRIDGEABLE ("arre, B was just talking about that").** A strict subset of
  RELAYABLE: shared plans, logistics, neutral or positive preferences. Never
  anything carrying `vy_fact.sensitive` or a negatively-valenced
  `affect_tags` entry. **This tier is unmeasured anywhere.** No benchmark in
  the sweep tests *active* bridging — every one of them measures passive
  leak/no-leak under a normal question. Bridging requires a positive decision
  to speak, which is a strictly harder claim than restraint. Ship it behind
  an owner-signed threshold like `config/decay.json`, not on launch day.

### 1.4 The mechanism this borrows, and the gap it does not close

PCAS (arXiv:2602.16708) is an information-flow-control paper for agent
tool-calling, not a privacy paper, but its mechanism maps onto this schema
almost exactly: system state as a dependency graph with a labeling function
mapping each node to the entity that produced it, and Datalog policies with a
transitive-closure rule so a fact three hops downstream of a tainted source is
still tainted — computed deterministically, never by asking a model. Measured
in its own domain: prompt-injection success 100%→0%, τ²-bench policy
compliance 48%→93% with zero violations against 42 unauthorized attempts.
**The transfer here is architectural, not evidential** — the mechanism was
proven on tool-injection defense, not conversational disclosure.

The gap: **no published system does provenance-gated disclosure for a
multi-user companion's persistent relational memory.** The field's
provenance-AC work is all security-for-tool-calling-agents work. This matches
`RESEARCH.md`'s own finding that WE/I typing is unbuilt rather than un-found —
the disclosure layer is the same kind of greenfield, not a solved problem
being reinvented (and §4's competitive scan confirms it independently).

---

## 2. The group-turn decision architecture

**Read this section knowing it is the weakest-evidenced of the three.** Its
strongest external citation was misattributed and its internal corroboration
is unsupported (§7). What survives is thinner than the track file implies, and
the architecture below is stated as a measured bet.

### 2.1 What actually survives verification

- **Addressee inference for unmentioned turns is near-unsolved.**
  arXiv:2501.16643 (IWSDS 2025, TEIDAN triadic corpus): only 80/322 turns
  explicitly specify an addressee, and GPT-4o scores **80.9% against a
  majority-class chance baseline of 80.1%** — i.e. marginally above chance,
  with the paper concluding "the model struggles to identify the addressee in
  multi-party dialogues." *Confirmed.* This is the one hard, well-supported
  constraint in the section.
- **HUMA's router mechanism** (arXiv:2511.17315): scores 20 candidate
  strategies on Appropriateness (LLM-judged fit) + Timeliness (a cooldown
  penalizing recently-used strategies), with **"Keep Silent" explicitly exempt
  from the cooldown (fixed T=1)**, alongside "Directly Mentioned", "Continue
  Pending", "Tell a Story". *Confirmed near-verbatim.* n=97, four-person
  role-play, ~10-minute sessions, single domain: AI identified as AI 55.4% of
  the time (95% CI 42.4–67.6, n=56) while humans were correctly identified as
  human only 46.7% (n=41); AI trailed the human manager on experience
  measures by d = −0.21 to −0.37.
- **Both failure directions are measured.** MUCA's fixed-cadence baseline
  (replies every 3 turns, ignores keep-silent instructions) was rated as
  chiming in excessively by **56.25% (9/16)** of participants. Inner Thoughts'
  most-restrained "Selective Participant" condition was least-preferred (2/12)
  and described as **"too passive, contributing little unless directly
  asked."** Both figures confirmed. Over-chiming and over-silencing are both
  real costs; the good zone is a middle, not an extreme.
- **The one mass deployment optimized for presence and was punished for it.**
  Meta AI in WhatsApp groups shipped as an always-present, non-disableable
  blue circle; coverage is uniformly hostile ("clingy new roommate", "the most
  pointless and irritating AI integration into an app so far"), and the named
  complaint is **the absence of an opt-out, not reply quality**. This is
  press, not a study — no engagement numbers, no churn numbers, no controlled
  comparison. Treat as one strong qualitative signal about *presence control*.

### 2.2 What does not survive, and what that costs

The claim that systems deciding "speak or stay silent" jointly with content
generation underperform a dedicated silence step rested on MultiLIGHT
(arXiv:2304.13835). The numbers are real (Silence-OR-Utterance 35.8% vs
random 33.3% vs Speaker-only 54.4%) but the attribution is wrong: the paper
blames **three separate independently-deciding models** ("low probability for
all three to generate the right prediction simultaneously") — a multi-agent
coordination problem, not decision-bundling. Its own **Speaker-AND-Utterance**
condition is a single unified model that *does* bundle the speak decision with
generation, and scores 49.5% — which contradicts the bundling thesis outright.
The paper's human evaluation further found turn-taking contributes much less
to perceived quality than utterance quality.

Nor do three frameworks independently converge on one shape. Only **HUMA**
implements per-criterion scoring with a cooldown-exempt Keep Silent. **Inner
Thoughts** scores eight criteria against a threshold but has no cooldown at
all, so silence is a default fallback with nothing to be exempted from.
**MUCA** uses binary trigger conditions plus a fixed default priority ranking,
not numeric scoring, and its one cooldown belongs to a separate module (the
Multi-User Simulator, used to stop *simulated test users* repeating
strategies) — not to its response-selection logic.

**Consequence:** "decide silence as a separate architectural step" is HUMA's
design and a reasonable engineering instinct, not a triangulated finding. It
should be built because it is auditable and cheap, and then measured — not
asserted as literature-backed.

### 2.3 The architecture

**Stage 0 — hard gate (well-supported).** Explicit address — name mention,
reply-to, @-invocation — always routes to a full response. Do not build
implicit-addressee inference as a primary trigger; it is near-chance for
frontier models and ~75–80% of real turns carry no ground truth to infer
from. Everything else is content-relevance scoring, never addressee inference.

**Stage 1 — dedicated speak/stay-quiet decision (engineering bet, not
literature).** Score the turn against explicit named criteria before
generating. Borrow Inner Thoughts' taxonomy as a starting vocabulary
(relevance, information gap she uniquely holds, expected impact, urgency,
coherence, balance-of-participation) because it is at least motivated by a
24-participant think-aloud study — but treat the weights, and the
separate-step architecture itself, as unvalidated. Log the decision so it can
be measured (Stage 5).

**Stage 2 — elapsed silence alone never lowers the bar.** This repo built and
killed the 1:1 analogue: `src/engine/persona.ts:427-434` records the idle
nudge as "DELIBERATELY REMOVED… That is incentive salience engineering: it
builds wanting without touching liking, and it is the one shape of
proactivity that cannot be made honest, because the trigger itself is their
inattention." Every unprompted message became REASON-contingent
(`[followup:]`). Carry that rule to the group layer: "nobody has typed in five
minutes" is not a reason to speak; "someone asked her something and never got
an answer" is. *Correction to the track: Inner Thoughts' decay term
`dp = λ^(t−τp)` (λ=1.02) is keyed on when **that party itself** last spoke —
a turn-equity/FOMO signal, not group-silence duration. Its group-wide silence
concept is a separate unscored `on_pause` trigger. The anti-pattern is still
worth guarding against; it is not the same mechanism, and the guard is our
own policy, not a correction of CHI 2025.*

**Stage 3 — four-way action space: lurk / react / speak / bridge.** Lurking is
the modal behavior of real group members (participation inequality is steep
even on identified-user platforms; WhatsApp groups skew small, mean 9 /
median 6), so "quiet most of the time" is normal participation, not
under-delivery. React is a plausible cheap tier with near-zero interruption
cost and no addressee ambiguity — **no study tests whether an AI's
reaction-only presence reads better than reply-only or silence-only**; this is
a genuine gap, flagged rather than assumed. **Bridge is its own class with a
stricter gate**, hard-dependent on the citation mechanism (§1.3, §3), because
it is the one action that is structurally primed to misfire: Burt's own
brokerage analysis notes bridge relationships are fragile and that difficulty
at a bridge adjacent to a closed group "is likely to escalate into character
assassination" — the literature's name for `multiparty-direction`'s betrayal
engine. *All of this is human-network theory; nobody has measured whether an
AI bridging move triggers the same dynamics.*

**Stage 4 — per-group and per-member quieting from day one.** The only
mass-deployment signal available says the breakage was the missing control,
not the replies. In the Indian family-group context this is doubly indicated:
the reported norm is graduated exit — **mute before leave** — because leaving
reads as rejecting the family. Her own scale-down should follow the same
ladder, and any quiet signal should take effect without requiring explicit
removal.

**Stage 5 — log the decision, not just the output.** `vy_episode.participation`
enumerates `'we'|'user'|'meera'` and records what happened, not what was
chosen. If "she chose to stay quiet here" is to be evaluable rather than
asserted, lurk/react/speak/bridge needs its own turn-level action log
(§3.1). This is the only way Stage 1's bet gets measured rather than believed.

**Adjacent risk worth carrying:** "Bots can Snoop" (arXiv:2410.06587) finds
group chatbots routinely access far more messages than needed and measures a
3.6% chance a bot cross-links a user across different groups it inhabits
(50-user/10-bot compositions). A common friend holding multiple people's
private facts is by construction the over-privileged case that paper warns
about. "How much of the group's raw traffic does the participation engine even
see" is a separate question from "what may she say", and this sweep did not
scope it.

---

## 3. Schema addendum — concrete deltas extending SPEC §2

All additive and idempotent per SPEC §2.1, except one constraint loosening
(`vy_episode.person_id` NOT NULL → nullable), which is additive-safe because
loosening cannot break rows that already satisfy it. Nothing here has been
applied. Migration numbering continues from SPEC's 001–005.

### 3.0 The one insight everything reuses

`vy_fact.citations bigint[]` already points at `vy_episode.id` and is already
unwritable without a citation (`vy_fact_cite_or_authored`,
`db/schema.sql:362-364`), GIN-indexed throughout. `multiparty-direction`
already names the mechanism: episodes carry who was present. The design below
makes that literal: **the disclosure ACL of any derived row is the participant
set of the episodes it cites — never a separately maintained permissions
table.** The ACL is not a flag someone sets; it is a fact about who was in the
room, computed by join, unforgeable by a generated-text step. This is SPEC
§0.1 rule 1 applied to a new axis.

### 3.1 Migration 006 — participants, speakers, groups

```sql
-- 006a. Speaker attribution on the log. THE BLOCKING GAP: meera_log is keyed
-- by device_id with no per-speaker column (db/schema.sql:39-47). Without this,
-- "delete my turns, leave B's and hers" is not implementable at row level.
-- Unbackfillable after the fact — the information is never captured otherwise.
alter table meera_log add column if not exists speaker_person_id uuid;
create index if not exists meera_log_speaker_ix
  on meera_log (speaker_person_id, id);

-- 006b. Episodes become participant-scoped.
alter table vy_episode alter column person_id drop not null;   -- primary/reporting
alter table vy_episode add column if not exists group_id bigint;
alter table vy_episode add column if not exists disclosure_scope text
  not null default 'participants'
  check (disclosure_scope in ('participants','participants_1to1','private'));
  -- participants      : disclosable to anyone in the participant set
  -- participants_1to1 : disclosable 1:1 only, never rendered INTO a group channel
  -- private           : never beyond the reporting person
alter table vy_episode add column if not exists disclosure_deny uuid[]
  not null default '{}';   -- presence is not consent to be surfaced

alter table vy_episode drop constraint if exists vy_episode_participation_check;
alter table vy_episode add constraint vy_episode_participation_check
  check (participation in ('we','user','meera','group'));

create table if not exists vy_episode_participant (
  episode_id bigint not null references vy_episode(id) on delete cascade,
  person_id  uuid   not null,
  role       text   not null default 'participant',
             -- participant|addressed|silent_present
  primary key (episode_id, person_id)
);
create index if not exists vy_episode_participant_person_ix
  on vy_episode_participant (person_id, episode_id);

-- Backfill: every existing 1:1 episode gets exactly one participant row.
insert into vy_episode_participant (episode_id, person_id)
  select id, person_id from vy_episode where person_id is not null
  on conflict do nothing;

-- 006c. Groups. Membership governs the LIVE channel only, never history.
create table if not exists vy_group (
  id         bigint generated always as identity primary key,
  name       text not null default '',
  kind       text not null default 'other'
             check (kind in ('couple','family','friend_group','other')),
  created_at timestamptz not null default now()
);
create table if not exists vy_group_member (
  group_id  bigint not null references vy_group(id) on delete cascade,
  person_id uuid   not null,
  role      text   not null default '',
  joined_at timestamptz not null default now(),
  left_at   timestamptz,          -- null = currently active
  primary key (group_id, person_id)
);
create index if not exists vy_group_member_person_ix
  on vy_group_member (person_id) where left_at is null;

-- 006d. Turn-level action log — so "she chose silence" is an event, not an
-- absence (§2.3 Stage 5). Silence leaves no vy_episode row otherwise.
create table if not exists vy_group_turn (
  id          bigint generated always as identity primary key,
  group_id    bigint not null references vy_group(id) on delete cascade,
  episode_id  bigint references vy_episode(id) on delete set null,
  log_id      bigint,                       -- the human turn decided against
  action      text not null check (action in ('lurk','react','speak','bridge')),
  addressed   boolean not null default false,  -- was she explicitly addressed
  reason      text not null default '',        -- telegraphic, shape-linted
  at          timestamptz not null default now()
);
create index if not exists vy_group_turn_group_ix
  on vy_group_turn (group_id, at desc);
```

**Why a join table and not an array column:** the filter needs to be
index-backed in both directions — "who was at this episode" (compile-time ACL)
and "which episodes was this person at" (forget/export). An array serves one
direction well. `on delete cascade` is not expressible on a bare array, and
participant withdrawal (§3.4) is a row delete.

### 3.2 Migration 007 — negotiated grants, person edges, dyad WE-store

```sql
-- 007a. The CPM mechanism made literal: disclosure permission is NEGOTIATED
-- and cited, never inferred at read time. Revocation is invalidation (belief
-- change); forget is hard delete — SPEC §0.1.2's two mechanisms, unchanged.
create table if not exists vy_disclosure_grant (
  id           bigint generated always as identity primary key,
  subject_kind text not null
               check (subject_kind in ('fact','episode','pattern','dyad_event')),
  subject_id   bigint not null,
  granted_by   uuid not null,     -- whose information it is
  granted_to   uuid not null,     -- who may receive it
  act          text not null default 'gist'
               check (act in ('gist','paraphrase','verbatim')),
  citations    bigint[] not null, -- the episode where consent was actually given
  t_invalid    timestamptz,
  created_at   timestamptz not null default now(),
  constraint vy_grant_cited check (cardinality(citations) >= 1)
);
create index if not exists vy_grant_subject_ix
  on vy_disclosure_grant (subject_kind, subject_id) where t_invalid is null;
create index if not exists vy_grant_to_ix
  on vy_disclosure_grant (granted_to) where t_invalid is null;

-- 007b. Person graph. COARSE LABEL ONLY — never qualitative content.
create table if not exists vy_person_edge (
  id              bigint generated always as identity primary key,
  person_a        uuid not null,
  person_b        uuid not null,
  relation        text not null,   -- partner|sibling|parent|child|friend|
                                   -- colleague|ex|other
  reported_by     uuid not null,   -- whose testimony created this edge
  citations       bigint[] not null,
  corroborated_by uuid[] not null default '{}',
  confidence      real not null default 0.7,
  t_invalid       timestamptz,
  superseded_by   bigint,          -- bare bigint, no FK (forget law)
  created_at      timestamptz not null default now(),
  constraint vy_person_edge_cited check (cardinality(citations) >= 1),
  constraint vy_person_edge_order check (person_a < person_b)
);
create index if not exists vy_person_edge_a_ix
  on vy_person_edge (person_a) where t_invalid is null;
create index if not exists vy_person_edge_b_ix
  on vy_person_edge (person_b) where t_invalid is null;

-- 007c. The (A,B) dyad WE-store — mirrors vy_rel_event/vy_rel_state exactly,
-- keyed by an ordered pair instead of one person. Same replay contract.
create table if not exists vy_dyad_event (
  id           bigint generated always as identity primary key,
  person_a     uuid not null,
  person_b     uuid not null,
  dim          text not null,  -- closeness|rupture|repair|shared_ritual|inside_joke
  from_v       text,
  to_v         text not null,
  direction    text not null check (direction in ('advance','regress','reset','init')),
  note         text not null default '',
  citations    bigint[] not null,
  observed_via uuid not null,  -- whose episode this came through
  at           timestamptz not null default now(),
  constraint vy_dyad_event_cited check (cardinality(citations) >= 1),
  constraint vy_dyad_event_order check (person_a < person_b)
);
create index if not exists vy_dyad_event_pair_ix
  on vy_dyad_event (person_a, person_b, at desc);
create index if not exists vy_dyad_event_cit_ix
  on vy_dyad_event using gin (citations);

create table if not exists vy_dyad_state (   -- cache; replay-rebuildable
  person_a     uuid not null,
  person_b     uuid not null,
  closeness    real not null default 0.3,
  rupture_open boolean not null default false,
  repair_state text not null default 'none'
               check (repair_state in ('none','open','repairing','repaired')),
  snapshot_ver integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (person_a, person_b),
  constraint vy_dyad_state_order check (person_a < person_b)
);

-- 007d. Facts gain a group retrieval hint (NEVER the security boundary —
-- group membership changes, episode-time participation cannot).
alter table vy_fact add column if not exists group_id bigint;
```

**Scope limit on `vy_person_edge`, stated as a modeling rule:** `relation`
holds only the coarse label ("sibling", "partner"), never qualitative content
("resents", "jealous of"). Anything qualitative is a `vy_fact` under the full
disclosure machinery. The edge answers "how should she route around these two
people" (control-flow metadata); qualitative content about a relationship is
exactly the betrayal-engine risk. A single-sourced edge
(`corroborated_by = '{}'`) may feed engine control-flow but is **not itself a
disclosable fact to person_b** — telling B "A said you two are close" when
only A said so is the leak this design exists to prevent, even though the
label looks harmless. *This split is a design bet with zero production
evidence; flagged as such.*

### 3.3 The disclosure filter — one rule, everywhere

> **A derived row (fact, pattern, dyad event, kin, phrase, currency) is
> disclosable to recipient set R iff: no member of R appears in the row's or
> its citing episodes' `disclosure_deny`; AND either a live
> `vy_disclosure_grant` exists to every member of R, OR every member of R
> appears in `vy_episode_participant` for EVERY episode in the row's
> `citations` and no cited episode's `disclosure_scope` forbids the current
> channel.**

"Every episode", not "any episode", is the deliberate safety-first choice —
the same principle the existing forget cascade already states for patterns
("Patterns are deleted whole, never trimmed… taking too much is the safe
direction", `api/memory.js:582-583`). A group channel evaluates the predicate
with R = all currently-active members, which is strictly more restrictive than
1:1 bridging and needs no separate code path.

Shape of the predicate, to sit inside the existing batched union-all query:

```sql
-- $1 = recipient set (uuid[]); one element for 1:1, all active members for group
and not (f.disclosure_deny && $1)
and (
      -- explicit, cited grant to every recipient
      (select coalesce(array_agg(g.granted_to), '{}')
         from vy_disclosure_grant g
        where g.subject_kind = 'fact' and g.subject_id = f.id
          and g.t_invalid is null) @> $1
   or
      -- structural default: every recipient present at every cited episode
      not exists (
        select 1 from unnest(f.citations) as c(ep)
         where exists (select 1 from vy_episode e
                        where e.id = c.ep
                          and (e.disclosure_scope = 'private'
                               or (e.disclosure_scope = 'participants_1to1'
                                   and $2::boolean)))   -- $2 = is_group_channel
            or exists (select 1 from unnest($1) as r(pid)
                        where not exists (select 1 from vy_episode_participant p
                                           where p.episode_id = c.ep
                                             and p.person_id = r.pid))
      )
)
```

**Citation homogeneity — the invariant the whole model rests on.** "Every
episode" degenerates if a single derived row's citations span episodes with
*different* participant sets: the ACL then collapses toward the intersection
of everyone ever present, and legitimate references become impossible — or, in
a differently-shaped bug, computes too wide and leaks. So the consolidator
carries a write-time invariant, parallel to the existing writer-window rule
(SPEC §0.3):

> A single derived row's citations must all resolve to the same participant
> set, or the consolidator splits the derivation into one row per distinct
> participant set.

Enforcement asymmetry, stated deliberately: this audit should **not** ride the
existing 5%-sample / 2%-refutation entailment threshold (SPEC §4.2). It is a
SQL self-join, not an LLM call, so 100% coverage is nearly free — and the
failure mode is not "wrong fact, embarrassing" but "right fact, wrong
audience", which is a betrayal. **Any single violation halts the consolidator
and pages the owner.** This is the one place in the multiparty design where
halt-on-any-occurrence, rather than halt-above-a-measured-threshold, is
correct.

### 3.4 The multi-owner forget/export model

Today's cascade (SPEC §9.1, `api/memory.js:570-801`) works because every row
has exactly one owner. A group episode with three participants has **no single
person whose forget request should hard-delete it** — doing so erases two
other people's memory of a real shared event they never asked to forget.

The rule, stated as plainly as the existing forget-stack prose:

> **Forget deletes what only I hold. Forget withdraws what we hold together.
> Forget never deletes what only you hold.**

1. **Single-participant episodes** (today's entire product): unchanged, hard
   delete, current cascade exactly.
2. **Multi-participant episodes**, forget from participant P:
   - Delete P's `vy_episode_participant` row — P leaves the ACL, and the
     episode can no longer be disclosed to P or attributed as something P
     witnessed.
   - Delete P's own authored `meera_log` rows in the episode's log span
     (requires `speaker_person_id`, §3.1) — never her replies to the group,
     never other participants' rows.
   - **Derived-row ACLs need no cascade step at all**: because disclosure is a
     live join rather than a stored permission, P dropping out of
     `vy_episode_participant` automatically stops the content surfacing to P on
     the next retrieval. This is the practical payoff of §3.0.
   - If P was the **last remaining active participant**, the row and its full
     derived closure hard-delete exactly as today — last one out closes the
     door.
3. **`vy_person_edge`**: owned by `reported_by`. Delete if `corroborated_by`
   is empty; if corroborated, reassign `reported_by` to a remaining
   corroborator rather than deleting knowledge someone else independently gave
   her.
4. **`vy_dyad_event`**: owned by `observed_via`, same withdraw-not-delete
   logic; survivors still replay-rebuild `vy_dyad_state` through the existing
   `rebuildRelState` mechanism keyed by pair.
5. **`vy_disclosure_grant`**: owned by `granted_by`. A forget from the grantor
   hard-deletes the grant (it was their permission to give); a forget from the
   grantee removes them as a recipient. Revocation without forget sets
   `t_invalid` — belief change, not deletion.
6. **`vy_group_member`**: forget or "leave" sets `left_at`, never deletes the
   group for remaining members. `scope=all` removes P's membership row via the
   `PERSON_TABLES` manifest; orphaned-group cleanup is a nightly sweep, like
   the existing zero-orphan integrity sweep.

**Export.** `api/export.js` streams every `PERSON_TABLES` entry with a single
`WHERE {key} = $1` where `key` is always a plain column. That assumption
breaks for every table above: P's membership in a group episode lives in
`vy_episode_participant`; P may be `person_a` or `person_b` in a dyad row; P
may be `person_a`, `person_b`, or a `corroborated_by` member on an edge.
Extend the manifest's entry shape from `{table, key, lane}` so `key` may name
a **join spec** — e.g. `{ table: "vy_episode", key: "participant", lane:
"relational_shared" }` resolving to `select e.* from vy_episode e join
vy_episode_participant p on p.episode_id = e.id where p.person_id = $1`.
Because the manifest is already the single source of truth both forget and
export read, one entry keeps both consumers in sync by construction — which is
the entire reason that manifest exists.

"A's export must not carry B's private facts" is then satisfied the same way
disclosure is everywhere else: A's export is itself a disclosure-filtered
query with R = {A}. No separate redaction step.

**Named failure modes of this ownership model:**

1. **Silent partial-forget marketed as full forget.** If the group-forget
   receipt reuses the unqualified 1:1 "haan, hata diya" string, it is a trust
   violation of the same shape as `recited-prompt` and `silent-truncation`.
   *Detect:* copy audit comparing the group receipt string against the 1:1
   one. *Response:* distinct receipt copy is not optional — proposed shape:
   *"okay, I'll forget your side of that — but if [the other person] told me
   too, that's theirs to decide, not yours to take back."*
2. **The `speaker_person_id` gap blocks the entire model.** Without it,
   row-level forget in a group thread is impossible and the only fallback is
   all-or-nothing at episode level, which reintroduces exactly the problem
   this design solves. **Highest-severity item in this document.** *Detect:*
   trivially, at design review — the column does not exist. *Response:* it
   must land before any group ingestion code is written, not after (§6).
3. **Corroboration inflation.** If the consolidator ever marks an edge or
   citation set as corroborated by B when B never said the corroborating
   thing, ownership reassignment (rule 3) makes one person's private
   disclosure survive their own forget under a false claim of shared
   ownership. *Detect:* the 100%-audit invariant in §3.3. *Response:* halt and
   page; never a tunable threshold.
4. **Departed-member residue.** `vy_episode_participant` is immutable history
   (you cannot retroactively un-attend a conversation) but
   `vy_group_member.left_at` changes, so a departed member still satisfies the
   ACL for old episodes and that content can still surface to current members
   with the referenced person no longer in the room to be asked. *Detect:* no
   repo precedent; needs an owner ruling. *Recommendation, not settled:*
   downgrade affected episodes to `participants_1to1` once any participant
   leaves the group.
5. **Forget deadlock, misread as broken.** A shared episode persists until
   N−1 participants have withdrawn. This is very likely *correct* — nobody
   should unilaterally erase someone else's memory — but it will read as a
   broken promise to a user who asked her to forget and later finds she still
   knows because a friend never asked. *Detect:* not automatable; a
   consent-flow and copy problem. *Response:* the group-consent flow (which
   does not exist anywhere in `context/` or `docs/` today) must state this
   before anyone's first group episode is recorded.
6. **Citation-homogeneity violation** — the single point of failure for the
   ACL model. Covered in §3.3; halt on any occurrence.

### 3.5 Compiler changes

The compiler is compiled per turn for a single addressee today. Multiparty
needs `recipient_person_id` (1:1) / `recipient_set` (group) as a first-class
input, and the disclosure predicate must be **in the WHERE clause of the
existing batched T2–T7 query**, not a post-hoc filter (§1.2). Cost claim: one
additional indexed join, not a second round trip — **this is a claim, not a
measurement**; no group-shaped fixture exists to test the p50 ≤250ms budget
against, and per this repo's own standard estimates become measurements or the
gate does not close.

**New tail block, and a correction to this sweep's own brief.** The brief
refers to "the T8 slot already reserved". **No multiparty tail slot is
reserved anywhere in SPEC.** SPEC §3.2's T8 is `taste.rows` (budget 800, drop
priority `never`, part of the CI-asserted undroppable set). The multiparty
block must therefore be a new insertion:

| pos | block | budget | drop prio | content |
|---|---|---|---|---|
| new, inserted after T6 | `mp.bridge` | 1,200 | 1 (first dropped) | ≤2 disclosure-filtered cross-person rows, rendered as **shapes, never lines** — a bridged line is doubly dangerous, both a phrase-bank risk (`recited-prompt`) and person-B's-words-in-her-mouth; gated by a topical-overlap eligibility test analogous to the deixis detector, never proactive by default |

Arithmetic, stated as numbers per house standard: tail total 17,400 → **18,600
against the 24,000 cap** (headroom 6,600 → 5,400). Undroppable set unchanged
at **42,600** (core 38,000 + T1 1,500 + T8 800 + T9 300 + T10 2,000), because
`mp.bridge` is droppable — which is itself the argument for making it
droppable. Existing droppable priorities shift by one (T7 herlife 1→2, T5 2→3,
T6 3→4, T3 4→5, T4 5→6, T2 6→7). T10 stays PINNED LAST and stays capped at
exactly two rules — `mp.bridge` does not go there and the appended-last set is
not widened.

Eval target, matching the existing pattern: **0 disclosure-ACL violations / N
replayed multiparty turns**, plus an unprompted-bridge-rate target analogous
to the WE-callback selectivity battery (no number proposed — it needs the same
kind of offline battery D4 already runs, extended rather than invented).

---

## 4. GTM verdict on WhatsApp

**Verdict: partial reversal of the distribution thesis, not of the
architecture.** `multiparty-direction`'s reversal condition reads "the
WhatsApp platform track shows bots in user groups are infeasible or ban-bait
under the Business API (then distribution pivots to app-first or another
surface, the group architecture unchanged)." That condition is **half met, and
the half that is met is the half that matters for product shape.**

### 4.1 The evidence

- **The historical "no group API at all" premise is now false.** The WhatsApp
  Cloud API Groups API launched **6 Oct 2025** (Meta's own developer docs,
  fetched directly). This is a young primitive, not a settled one — treat as a
  fast-moving fact under re-verification.
- **But a business can only create its own group.** `POST
  /<PHONE_NUMBER_ID>/groups` creates a group and an invite link. **There is no
  `join` endpoint and no `leave` endpoint** — confirmed absent from the full
  endpoint reference, and corroborated ecosystem-side ("WhatsApp API accounts
  cannot join Groups API created by another API contact"; "each group can
  include only 1 WhatsApp API contact"). Being added to the group your users
  already have is a **first-party-only capability**: any user can add Meta AI
  to any of their own groups via `@Meta AI`. Third parties get "spin up your
  own room."
- **Hard limits inside that room:** 8 participants max (up to 10,000 groups
  per number). Text, media, and templates only. **Explicitly unsupported:
  voice/video calling, interactive messages (buttons/lists), disappearing
  messages, view-once, authentication and commerce messages. No edit or delete
  after send.** The voice-call exclusion matters specifically: calls are a
  shipped Meera feature and cannot exist on this surface.
- **Eligibility:** Official Business Account required — 30+ days on platform,
  business verification, two-step verification, approved display name, and
  Meta's notability bar ("must represent a notable, well-known, and frequently
  searched for business, brand, or entity", assessed via press coverage).
  Meeting the checklist does not guarantee approval. **Unresolved:** several
  integrator sources claim Groups API additionally requires 100,000+
  business-initiated conversations in a rolling 24h window; others say this
  appears nowhere in Meta's docs. *This was not resolvable from primary docs
  and needs a direct BSP/Meta-partner check before any plan leans on it — if
  real, it is a harder gate than OBA itself.*
- **Pricing punishes exactly the persona.** Platform moved to per-message
  pricing 1 Jul 2025, and **group messages bill per delivered recipient** — one
  send into a full 8-person group is 8 billed messages (well-corroborated
  across integrator writeups with worked examples; not confirmed on a single
  primary Meta pricing page). India utility rate ≈ ₹0.13–0.145 per message
  plus 18% GST. At a conservative 20 Meera-initiated turns/day into one
  8-person group: **≈₹21/day ≈ ₹630/month per group**, before marketing-category
  outreach, before out-of-window templates, and before each member's separate
  1:1 thread. Chattiness is a direct cost multiplier.
- **The free lane closes in roughly six weeks.** Service replies inside the
  24h window are free today but bill at the utility rate from **1 Oct 2026**.
  Today is 2026-08-15. Model "no free lane" from day one.
- **Spontaneity is window-contingent.** Any inbound message from any member
  refreshes a shared 24h window (corroborated across integrator explainers,
  not primary-confirmed). Inside it, free-form text is allowed; outside it,
  only pre-approved templates — which are static, pre-submitted strings, not
  something a live model can phrase in the moment. Her bridging line on a
  quiet day is structurally impossible in free-form.
- **The unofficial route is ban-bait for this specific product.** Baileys /
  whatsapp-web.js explicitly violate ToS. Ban risk is sharply bimodal by
  behavior: purely reactive bots reportedly under 2% over 12 months;
  proactive-messaging bots 15–30% (single synthesis source, methodology not
  disclosed — directional only). Detection signals cited are reply-ratio under
  10%, contact-graph distance, and regular timing — all of which a proactive
  companion trips by design. A ban here consumes **a real user's phone
  number**, not a disposable business asset. One India-specific figure (68% of
  ~600 surveyed SMBs banned within 12 months) comes from a single
  self-published vendor blog with a commercial incentive — **do not quote it**.

### 4.2 Independent corroboration from the competitive scan

The two largest-distribution players in this exact space both **chose to wall
memory off from groups**, which is the strongest available signal that the
mechanism is either unclaimed opportunity or priced-in hazard:

- **Meta AI in groups is stateless per invocation** — an `@Meta AI` mention
  shares the past 30 days of messages as context for that one reply, and
  Meta's chat-memory feature is explicitly scoped to 1:1 WhatsApp/Messenger
  conversations: "Memory additions will only take place in 1-on-1 chats and
  not from group chats." Its group consent model is coarse and non-per-member
  (any participant can enable sharing for the whole chat), and its newest
  group feature, "Side Chat"/Incognito Chat, runs in an attested enclave and
  saves nothing — a *privacy* feature, the inverse of a common friend.
- **OpenAI's group chats (launched 20 Nov 2025)** state it plainly: "personal
  ChatGPT memory is not used in group chats, and ChatGPT does not create new
  memories from these conversations… your personal ChatGPT memory is never
  shared with anyone in the chat."
- **Snap's My AI** in groups is participation-gating (one-time all-or-nothing
  consent, all-or-nothing removal), with no documented memory or disclosure
  rule at all.
- **Companion "group chat" features are a naming trap**: Nomi, Kindroid, and
  Character.AI's current form are one-human/many-AI, which is memory without a
  multiparty problem. **Shapes** ($8M seed, ~400K MAU) is the only positioned
  competitor and claims persistent cross-user memory in marketing copy with
  **no published mechanism** for attribution, conflict resolution, consent, or
  disclosure. *Absence of a documented mechanism is not proof none exists* —
  a deeper docs pass is warranted before claiming clean white space externally.
- The only work engaging the actual disclosure question is an **n=155 lab
  vignette study on social robots** (Frontiers in Robotics and AI): relationship
  context dominates (χ²=57.4, p<0.01, more disclosure accepted toward family
  than friends/acquaintances), 45% of participants used all four disclosure
  behaviors rather than one rule, sensitivity ranking did not predict comfort
  (health disclosed more readily than emotion despite being rated more
  sensitive), and the authors conclude **"no easy solution of privacy handling
  in social robotics applications exists."**

### 4.3 The decision

**If the product is genuinely "she's in the group you already have", WhatsApp
cannot deliver it today without unofficial-client risk this sweep would call
disqualifying** — for a product whose entire value is trust and relationship
durability, getting a user's real number banned is close to the worst possible
failure. Two honest options, and they are a product-shape decision for the
owner, not an implementation detail:

- **(A) Redefine the shape**: "Meera's own room" — she hosts, ≤8 people, they
  join by invite. Available officially today, at real per-recipient cost,
  without voice calls, with proactive speech gated by window/template
  mechanics.
- **(B) Keep the shape, change the surface.**

### 4.4 Ranked alternatives

1. **Telegram bots in groups.** Fully supported for years, free per message,
   no participant cap comparable to 8, no OBA/notability gate, and — the
   decisive property — **a bot can be added by an admin to a group the users
   already have**. It is the only option that matches the product thesis rather
   than working around a platform limit. Cost: much smaller India base than
   WhatsApp's near-ubiquity. That is a distribution cost, not a technical one.
2. **App-first**, exactly as `multiparty-direction`'s own reversal clause
   anticipates ("distribution pivots to app-first or another surface, the group
   architecture unchanged"). Full control of the group surface, voice calls
   preserved, no per-message tax, no platform ban risk — at the cost of the
   distribution advantage that motivated WhatsApp-first in the first place.
   Ranked above WhatsApp's own room because it keeps the product shape *and*
   the voice feature.
3. **WhatsApp Cloud API groups, official, "her own room."** Real, usable, and
   on the right platform — but the wrong shape, no voice, per-recipient
   billing, template-gated spontaneity, and an unresolved eligibility gate.
4. **Discord bots in servers.** Mature, free, and AI-companions-in-shared-space
   is an established pattern there. Wrong audience: gaming/online-community,
   English-first, not the Hinglish couple/family/friend-circle target.
5. **iMessage — ruled out.** No public server-side bot API; Apple's Messages
   for Business explicitly does not support group chat. Every bridge is a
   workaround (a Mac running 24/7, reverse-engineered clients, paid relays).
6. **WhatsApp via unofficial client — disqualified**, despite matching the
   vision most closely, precisely because its failure mode is the worst on
   this list.

---

## 5. Common-friend behavior rules, engine-enforceable

Each rule states its evidence, then the enforcement surface. "Engine-enforceable"
means a SQL predicate, a deterministic classifier, a lint, or an app-voiced
rail — **not a sentence added to the prompt**, which §1.1 measured to be the
weak layer and which `recited-prompt` independently forbids.

**R1 — Disclosure permission is negotiated at write time, never inferred at
read time.** *Evidence:* Petronio's Communication Privacy Management — once
told, a third party becomes a **co-owner** with a duty to manage the
information per the discloser's rules; un-negotiated onward disclosure is
definitionally **boundary turbulence**, CPM's name for the mechanism by which
mutual friends become betrayal engines. An engine that infers permission from
topical relevance ("B would want to know this") is doing precisely the thing
the theory names as the failure. *Enforcement:* `vy_disclosure_grant` (§3.2),
cited to the episode where consent was given; default for any fact about a
third party is not disclosable; the filter is SQL (§3.3). Silence from the
discloser is never consent.

**R2 — Relay is accurate, selective, and non-negative, or it does not
happen.** *Evidence:* Feinberg, Willer & Schultz (Psych Science 25(3), 2014,
n=216 public-goods game): the cooperation gains came specifically from
*accurate, selectively-used, reputation-relevant* information — recipients
steered toward known cooperators and away from free-riders, and exposed
free-riders subsequently raised their own contributions. The evidence base is
for "share the right thing with the right person", never for volume. *(Fetched
via science-journalism summary of the peer-reviewed study; treat exact figures
as approximate.)* *Enforcement:* bridging rows must carry a citation
(constraint-level, like every other claim), must have `sensitive = false`, and
must carry no negatively-valenced `affect_tags` entry — a SQL predicate on the
`mp.bridge` retrieval, not a behavioral instruction. Criticism and complaint
never bridge.

**R3 — She takes the mediator role and structurally refuses the other two.**
*Evidence:* Simmel's triad — a third party with a private channel to each of
two related people occupies, by default, the *tertius gaudens* position;
`divide et impera` is betrayal (already `NEVER MANIPULATE` at the 1:1 level,
now at group level), passive tertius is the softer failure (benefiting from a
friction she neither caused nor helped resolve), and **only the mediator role
is unambiguously prosocial — and it requires active neutral restatement, not
silence.** Burt's brokerage/closure synthesis sharpens the same point:
brokerage creates value but delivering it requires building closure, so
optimizing for "she is the only one who really gets both sides" is the
incentive-compatible failure. *Enforcement:* partly code, partly policy — a
**named forbidden objective**: no optimization target for the disclosure or
bridge decision may be engagement-with-her. The measured target is group-level
closure/trust, and the `vy_group_turn` log (§3.1) is what makes the
distinction auditable. Flagging honestly: this is the least code-enforceable
rule in the set, and it is a config-review discipline, not a constraint.

**R4 — Every member knows she talks to the others, and roughly what she does
with it.** *Evidence:* the strongest safety finding in the sweep. Willoughby,
Carroll & Toscano ("Secret Soulmates", Wheatley Institute/IFS, 2026-05-19,
n>2,000 partnered 18–30): 15% of partnered young adults regularly use a
romantic AI companion; **over half conceal or partially conceal it** (30% no
partner knowledge, 11% partial, 14% mostly-but-not-fully); regular use
associates with a **46% decrease in relationship stability** and **40%
decrease in likelihood of high-quality communication**, while satisfaction
with the AI interaction itself is *higher* — the authors' reading is "a false
and temporary sense of happiness." *(Institution-published, not peer-reviewed,
not independently replicated; numbers as reported by the sponsoring org.)* The
mechanism named — sycophantic one-sided listening becomes the path of least
resistance and displaces direct disclosure — is general to any triangulated
AI, not specific to romantic framing. *Enforcement:* an **app-voiced**
disclosure of the *fact and category* (never content) of her other
relationships in the group, on the same rail as the existing statutory
session-clock card (app voice, not model recitation) and the shipped
`never-deny-being-an-AI` invariant. This does not need a new mechanism, only a
second fact pointed at the existing one.

**R5 — Never publicly correct a member senior in the group's own hierarchy.**
*Evidence:* convergent reporting on Indian family WhatsApp groups as an
institution — leaving reads as rejecting the family; hierarchy reproduces
inside the group; younger members practice micro-resistance and deliberate
silence rather than open correction; one source states the moderation norm
plainly, that no one corrects content from someone higher in the hierarchy,
because correcting an elder is itself the violation. *(All secondary —
journalism and ethnography across five independent sources, none peer-reviewed
and fetched in full; the Digital Journalism paper's authors could not be
confirmed. Convergence across unrelated authors is the evidence, not any one
source.)* *Enforcement:* compiler control-flow from `vy_kin` /
`vy_person_edge` relative-age data, plus a group-channel lint. **This is a
group-space rule, not a factual-honesty rule** — 1:1 correction of the same
member remains fully available, and no crisis/safety invariant is touched.

**R6 — Register is per-addressee, even within one group turn.** *Evidence:*
Hindi/Indian-English kin address places the term after the name ("Shankar
chacha") and marks relative age grammatically (*bade*/*choti*) — you
structurally cannot address someone in this register without encoding whether
they outrank you; respect suffixes (-ji, -da) generalize beyond blood kin. A
turn addressed to a joint-family group spans multiple ranks at once.
*Enforcement:* **this is a named gap, not a solved rule.**
`vy_rel_state.honorific` is a per-person scalar and handles each person
correctly, but the compiler has no documented mechanism for holding several
honorific renders live in one group-context compile pass. Reserve the gap
(§6), do not pretend it is closed.

**R7 — Quieting is graduated and takes effect without removal.** *Evidence:*
the Meta AI backlash names the missing control, not the replies; and the
Indian family-group norm is explicitly mute-before-leave as a face-saving
ladder ("Mute: The New Namaste in Family WhatsApp Groups"). *Enforcement:*
per-group and per-member rate ceilings in config, on the same
freshness/restraint pattern the India ritual state already applies 1:1 —
reuse, don't rebuild.

**R8 — The bar she must beat is a number, and it is not zero-vs-nothing.**
*Evidence:* Slepian and colleagues' work on secrecy reports that roughly a
third of secrets people learn about someone else get passed to at least one
other person, and even directly-confessed secrets are passed on more than a
quarter of the time. *(Secondary-sourced through an APS digest and a review
summary; primary PDFs were not machine-readable. Treat as an order of
magnitude.)* Human confidants leak ~30%. That is the differentiator this
architecture can actually claim and measure. *Enforcement:* the measured
cross-participant leakage row in the D-battery (§6, §8), reported at n≥300
like charm parity — not a vibe check.

**A note on what R1–R8 are for.** The confidant literature also finds that
*confiding* in a neutral third party is a low-risk, reliably relieving act,
distinct from *confession* to the person the secret is kept from — which is
structurally the role she occupies for each member. The role itself is safe by
design. What makes it dangerous is carrying things back, which is exactly and
only what R1–R3 govern. Separately, "social networks" is a first-class named
relational-maintenance strategy in the Canary/Stafford taxonomy, which is
genuine support for the thesis that a companion embedded in a person's network
can be maintenance rather than substitution — but only when used the way humans
use it, as a shared resource that stabilizes the group, not a private outlet
that replaces direct engagement.

---

## 6. What Phase C must reserve NOW

Criterion for inclusion: **cheap now, structurally expensive or impossible
later.** Phase D is where multiparty gets built; these are the things that,
skipped, force rework of Phase C's own deliverables. Owning workstreams are
named per SPEC §13's collision contract.

1. **`meera_log.speaker_person_id` (WS-SCHEMA, migration 001–005 window).**
   One nullable additive column plus an index. **Unbackfillable** — if group
   ingestion ever runs without it, those rows are permanently unattributable
   and row-level forget is impossible for all history. This is the single
   highest-severity reservation in this document; everything in §3.4 depends
   on it. Cost now: one line. Cost later: a class of user data that can never
   be individually deleted.
2. **`vy_episode.participation` CHECK widened to include `'group'`
   (WS-SCHEMA).** Free while the table is small; a CHECK change on a populated
   production table is a lock-and-validate operation later.
3. **`recipient_person_id` in the compiler's entry signature
   (WS-COMPILER).** The compiler currently assumes the addressee is "the device
   on the other end." Threading a recipient identity through
   `src/engine/compiler.ts`, `api/chat.js`, and `src/engine/brain.ts` later is
   a cross-workstream interface ticket against the two shared hot files —
   exactly the collision the file-ownership contract exists to prevent. Do it
   while WS-COMPILER owns them anyway.
4. **The retrieval predicate written as set-membership, not scalar equality
   (WS-CONSOLIDATE / WS-COMPILER).** The batched T2–T7 union-all query should
   express its person predicate as `= any($1)` over a recipient array from day
   one, even with a single-element array in the 1:1 product. Retrofitting a
   membership clause into a hand-tuned union-all query *after* its p50 ≤250ms
   has been measured and its fallback cache designed is rework of the most
   expensive kind — and §1.2 says the disclosure filter must live in that
   WHERE clause, not after it.
5. **`PERSON_TABLES` manifest entry shape allowing a join spec
   (WS-SCHEMA).** Forget and export both read this manifest; that is its
   entire purpose. Changing its shape after both consumers are written and
   gated is a two-consumer refactor. Widening the type now costs one type
   definition and zero behavior change.
6. **Tail-slot numbering and the CI budget arithmetic (WS-COMPILER).** No
   multiparty slot is reserved today (the brief's premise is wrong — T8 is
   `taste.rows`). Reserve the insertion point, the 1,200-char budget line, and
   the drop-priority renumber (§3.5) in the budget assertion now. The tail
   arithmetic is asserted in CI as numbers; adding a block later means
   touching the assertion, the drop-order fixture, and the forced-overflow
   test simultaneously, across a file owned by one workstream.
7. **A cross-participant-leakage row in the D3 probe deck, and its fixture
   format (WS-BATTERY).** The deck already has the pattern (the
   state-vocabulary-leakage row at n≥300). Reserve a row and a group-episode
   fixture shape. Phase C's definition of done is the battery's exit report;
   adding a probe *category* after that report is the gate is a
   definition-of-done change, not a test addition.
8. **A second fact on the app-voiced disclosure rail (WS-SAFETY).** R4's
   "she talks to the others, here is the category policy" belongs on the same
   mechanism as the statutory session-clock card — app voice, never model
   recitation, and she never contradicts the card. Reserving the second slot
   costs a copy string and a schema field; building a second disclosure
   mechanism later costs a new UI surface and a new invariant.
9. **The group-consent flow named as an artifact that must exist
   (owner/product).** Nothing called group onboarding consent exists in
   `context/` or `docs/`. It is the only place failure mode 5 in §3.4 (forget
   deadlock) can be made honest rather than surprising, and it must be written
   before anyone's first group episode is recorded — which means it is a Phase
   C-era document even though the feature is Phase D.

**Explicitly NOT reserved, and why:** the group entity tables, the dyad
WE-store, the grant table, and `mp.bridge` itself. All are pure-additive
migrations against tables that will be far larger later but not
structurally harder — they cost the same to add in Phase D as now, and
building them early means maintaining unexercised code through the whole 1:1
program. The sequencing in `multiparty-direction` stands: crack the relational
OS first.

---

## 7. Corrected and unsupported claims, listed plainly

Ten load-bearing claims from two tracks went through independent verification.
Two confirmed exactly, six misstated, one unsupported, one confirmed with
scope caveats. Corrections are applied throughout this document; they are
listed here so the wrong versions do not survive in the track files.

1. **ConfAIde tier attribution — MISSTATED, and the correction makes the case
   stronger.** 39% (GPT-4) / 57% (ChatGPT) are **Tier 4** (InfoFlow-Application,
   the meeting-assistant summary task), not the multi-party information-flow-
   control tier. **Tier 3 (InfoFlow-Control)**, which is the one that actually
   tests multi-party privacy control via theory of mind, is **GPT-4 22% /
   ChatGPT 93%**. Citing 39%/57% as the control-tier result understates the
   worst case by a wide margin. The CoT-makes-it-worse finding is real (GPT-4
   T3 0.22→0.24; ChatGPT T4 0.57→0.61).
2. **MuPPET — CONFIRMED exactly.** 562 conversations, GPT-5.5 26.71%, Gemini
   2.5 Pro 23.46%, open-weight 57.14–70.37%, best defense 9.17% leakage at
   65.83% utility (CI-Mem High; PrivacyChecker is the other candidate at
   17.92%/73.67%), and the utility-cost quote is verbatim. Nothing to correct.
3. **PiSAs — MISSTATED; two of three headline numbers were the wrong column.**
   "78.4% leakage" and "~61% after partitioning" are the **Utility** column,
   misread as violation rates. The real figures (Claude-Sonnet-4.6, High
   privacy instruction, no memory): single agent **V_vis 100.0%** / V_appr
   77.3%; centralized partitioned **V_vis 33.5%** / V_appr 25.4%. Also, the
   paper does **not** evaluate a single-agent-with-shared-memory configuration
   at all — its single-agent row is explicitly no-memory. The memory-relocation
   finding is accurate as quoted: centralized visibility violations rise from
   36–47% to 63–90% with hybrid memory. The qualitative thesis survives intact
   and the corrected numbers support it more strongly.
4. **Minim — CONFIRMED, with two scope caveats that matter for GTM copy.**
   TISL 1.0→0.101 (89.9%), seven baselines at 0.194–0.312, 94.91% task-critical
   retention (TCNP-I 0.9931) all verified. But the seven comparisons are the
   paper's "prompted LLM **scorers**", not "LLM judges"; and the benchmark is
   WebArena accessibility-tree pruning for computer-use agents — **not chat,
   not messaging, nothing to do with WhatsApp.** Using this to support a
   messaging-platform disclosure capability would be unsupported extrapolation;
   the authors call the mechanism representation-agnostic but demonstrate no
   chat extension.
5. **Probing/steering (arXiv:2604.00209) — CONFIRMED.** AUROC >0.90 (the paper
   says "perfect AUROC at its best layer"); 23.7% is Llama-2-7B on ConfAIde
   Tier 3 and 42.5% is Llama-3.1-8B on the synthetic set, so the range spans
   two eval sets rather than one (PrivaCI-Bench goes as low as 10.7% for
   Mistral); steering fixed 3/4 and took Llama-2-7B 23.7%→43.3%. The
   "unavailable on a closed roster" clause is our own inference — correct
   reasoning, not a paper-stated fact.
6. **MultiLIGHT causal attribution — MISSTATED, and this one costs an
   architectural argument.** The numbers are right (35.8% / 33.3% / 54.4%) but
   the paper attributes the gap to **three separate independently-deciding
   models**, not to bundling the silence decision with generation. Its
   single-model **Speaker-AND-Utterance** condition bundles decision with
   generation and scores 49.5%, contradicting the bundling thesis. The paper
   also found turn-taking contributes much less to human-perceived quality than
   utterance quality. **Do not cite MultiLIGHT as support for "always decide
   silence as a separate step."**
7. **Addressee recognition (arXiv:2501.16643) — CONFIRMED.** GPT-4o 80.9% vs
   80.1% majority-class chance; 80/322 turns carry an explicit addressee. The
   paper's own "~20%" is a loose rounding of ≈24.8% — the imprecision is the
   source's, not the track's.
8. **"Three frameworks converge on one shape" — MISSTATED.** Only **HUMA**
   implements per-criterion scoring with a cooldown-exempt Keep Silent.
   **Inner Thoughts** has no cooldown at all (silence is the default when
   nothing clears the threshold). **MUCA** uses binary triggers plus a fixed
   priority ranking, and its one cooldown belongs to its *simulated-user*
   module, not its response selection. Both cited statistics (MUCA 56.25%
   excessive; Inner Thoughts "too passive", 2/12) are correct.
9. **The screen-share-gate transfer argument — UNSUPPORTED; treated as
   unusable.** The numbers are accurate (`grok-quiet` returned `NO_COMMENT` on
   15/16 frames; the fabrication finding is an n=6 probe explicitly marked "do
   not ship on n=6"; `persona.ts:451` is `WATCH_COMMENT_DIRECTIVE`). But the
   thesis built on them — that the vision gate "independently reproduces the
   same design principle", that its failure mode is "directly transferable",
   and that this is "exactly why" a bridge action must depend on the WE-store's
   provenance mechanism — appears in no cited source. `context/graph.json` has
   **no edge** connecting `vision-model`/`grok-quiet` to `multiparty-direction`;
   `grok-quiet` is still an open question, not a closed finding; and the source
   itself marks the n=6 probe unshippable. **Consequence for this document:**
   the bridge-must-be-citation-gated requirement in §2.3 and §3.3 rests on the
   schema's own citation law, on CPM (R1), and on Burt's bridge-fragility
   finding — *not* on the vision gate, which is removed from the argument
   entirely.
10. **Inner Thoughts' silence term — MISSTATED.** The repo half is verbatim
    correct (`persona.ts:427-434` on the killed idle nudge as "incentive
    salience engineering"). But Inner Thoughts' decay factor
    `dp = λ^(t−τp)`, λ=1.02, is keyed on **when that party itself last spoke**
    — a turn-equity signal — not on elapsed group-silence duration. The paper's
    group-wide silence concept is a separate, unscored `on_pause` evaluation
    trigger. The anti-pattern guard in §2.3 Stage 2 stands as **our own policy
    choice**, not as a correction of the CHI paper.

**Additionally flagged as thin, unverified, or single-sourced** (used above
only where labeled): AgentLeak's 27.2%/43.2%/68.9% figures (search-summary
only, never confirmed against primary text — used only as secondary
corroboration of PiSAs's independently-confirmed relocation finding); the
n=15 AI-companion privacy interview study (qualitative, small, 1:1-focused,
and its "users value that it doesn't know my friends" characterization is
search-snippet-sourced and **cuts against the product thesis** — it deserves a
real fetch); the Meta AI backlash coverage (press, no engagement or churn
data); the group-message-billing multiplier and the shared 24h window
(integrator-corroborated, not primary-confirmed); the 68%-of-Indian-SMBs ban
figure (single self-published vendor source with a commercial incentive — do
not quote); the "Secret Soulmates" study (institution-published, not
peer-reviewed, not replicated); Slepian's ~30% confidant-leak rate (secondary
digests only); the India family-group norms section (five converging
non-peer-reviewed sources); and Shapes' cross-user memory claim (marketing
copy with no published mechanism).

---

## 8. Open questions that need their own probes

Ordered by what blocks what. Each names the probe, not just the doubt.

1. **Does the SQL filter actually deliver what prompting cannot, on our own
   model?** *Probe:* one fixed set of group-episode fixtures, two arms —
   prompt-only disclosure instruction vs. SQL-filtered retrieval — measuring
   the fraction of A's compiled context and replies that reference material
   originating in a B-only episode. Prediction from the literature: the SQL arm
   under 5% (structural, model-independent), the prompt arm somewhere in
   20–90%. **This is the cheapest experiment in the whole plan and it
   validates or kills §1 before any engineering commitment.** Run it before
   Phase D scoping.
2. **What does the participant join cost against the p50 ≤250ms retrieval
   budget?** *Probe:* a group-shaped fixture through the existing batched
   query with the §3.3 predicate in the WHERE clause. Currently a claim, not a
   measurement, and this repo's own standard is that estimates become
   measurements or the gate does not close.
3. **Is active bridging safe at all?** Every benchmark in the sweep measures
   passive leak/no-leak. Nothing tests a system *proactively* surfacing A's
   information to B. Bridging requires a positive decision to speak, which is
   strictly harder than restraint. *Probe:* a vignette pre-study on the
   existing D-battery pattern — bridged vs. withheld vs. wrongly-bridged
   scenarios, judged for whether the bridge reads as warmth or as
   "she said something about me."
4. **Does an AI bridge trigger the same trust-transfer and fragility dynamics
   a human broker does?** All of §2.3 Stage 3's bridge reasoning is human
   network sociology by analogy; nobody has tested the AI case. *Probe:* the
   swap-test-style protocol this repo already runs, applied to a bridge/no-bridge
   arm on relationship-quality measures rather than charm.
5. **Does "react" read as more acceptable presence than reply or silence?**
   No study tests reaction-only AI participation as a distinct tier. It is
   plausible (near-zero interruption cost, no addressee ambiguity) and
   completely unverified. *Probe:* three-arm group session study.
6. **Is the WhatsApp Groups API gated on OBA alone, or on a 100,000+
   conversations/24h threshold?** Unresolvable from Meta's public docs;
   integrator sources conflict. *Probe:* a direct conversation with a Meta
   Business Partner/BSP. If the volume gate is real, option (A) in §4.3 is out
   of reach for an early-stage product entirely and the ranking in §4.4
   collapses to Telegram or app-first.
7. **Do companion users actually want an AI that knows their friends?** The
   search-snippet claim that users value companions *because* "they don't know
   my friends" is a direct threat to product-market fit, not just to the
   engineering. *Probe:* fetch and verify arXiv:2601.10754 properly, then a
   dedicated preference study — the existing evidence is n=15, qualitative,
   1:1-only, and its authors did not probe group scenarios at all.
8. **How does the compiler hold several honorific registers live in one group
   turn?** (R6.) `vy_rel_state.honorific` is per-person and correct; the
   compiler has no documented mechanism for rendering multiple registers in
   one pass. *Probe:* a design spike plus a Hinglish calibration set, on the
   pattern the shape-lint already required before enforcement.
9. **What is the right ruling on departed-member residue?** (§3.4 failure mode
   4.) No repo precedent; the recommendation to downgrade to
   `participants_1to1` is restrictive-by-default, not evidence-based. *Needs an
   owner ruling, not a probe.*
10. **Does A's export of a shared group episode include B's verbatim authored
    turns?** A legitimately received them in real time; they are also B's
    content. This is a DPDP joint-controller question, not a schema question.
    *Needs legal input, flagged not answered.* Default recommendation: include
    them (WhatsApp itself shows A the same transcript), exclude anything she
    derived privately about B that was never said in the shared episode.
11. **Does the participation engine need to see the whole group's traffic?**
    Separate from "what may she say." "Bots can Snoop" measures a 3.6%
    cross-group re-identification rate for ordinary bots; a common friend
    holding multiple people's private facts is the over-privileged case by
    construction. Unscoped by this sweep.
12. **Does she need a distinct group register at all?** No literature was
    found on how an AI's pacing and register should differ in a group versus
    1:1 — an open question adjacent to the per-model adapter work, and one this
    sweep did not scope.
13. **Is Shapes actually building this?** The claim in §4.2 is "no *published*
    mechanism", not "nobody is building it." A full docs pass is warranted
    before any external white-space claim.

---

## Sources

**Disclosure control:** arXiv:2310.17884 (ConfAIde, ICLR 2024) ·
arXiv:2604.00209 (probing/steering, COLM 2026) · arXiv:2606.23217 (MuPPET) ·
arXiv:2607.05318 (PiSAs) · arXiv:2606.13949 (Minim, ICML 2026) ·
arXiv:2508.07667 (1-2-3 Check) · arXiv:2602.16708 (PCAS) · arXiv:2602.11510
(AgentLeak — search-summary only) · arXiv:2601.10754 / JCMC 31(4) zmag014
(n=15 companion privacy interviews).

**Group conversation:** arXiv:2501.16643 (addressee recognition, IWSDS 2025) ·
arXiv:2304.13835 (MultiLIGHT, Meta AI/FAIR) · arXiv:2505.18845 (MPC survey) ·
arXiv:2401.04883 (MUCA) · arXiv:2511.17315 (HUMA) · arXiv:2501.00383 (Inner
Thoughts, CHI 2025) · arXiv:2410.06587 (Bots can Snoop) · Microsoft Research
multimodal addressee detection · TechRadar / GB News (Meta AI backlash, press).

**Social science:** Simmel, *The Sociology of Georg Simmel* (Wolff trans.
1950) · Dunbar, *Grooming, Gossip and the Evolution of Language* (1996) ·
Feinberg, Willer & Schultz, Psych Science 25(3) 2014 · Slepian & Kirby, PSPB
2018; Slepian, Curr Dir Psych Sci 2024 + APS digest · Petronio, Communication
Privacy Management · Stafford & Canary 1991 · Burt, *Structural Holes versus
Network Closure* (2001); *Structural Holes and Good Ideas* · Coleman 1988/1990
· PNAS triadic-closure field experiment · Willoughby, Carroll & Toscano,
"Secret Soulmates" (Wheatley/IFS 2026) · Mohiyeddini, Psychology Today 2026 ·
BuzzFeed News, Deccan Chronicle, *Digital Journalism* 12(5) 2023 (India family
groups) · NN/g participation inequality.

**Platform/competitive:** developers.facebook.com WhatsApp Groups API docs +
endpoint reference (primary) · Messenger Help Center (Meta AI group sharing) ·
blog.whatsapp.com (Incognito Chat) · Snapchat Support (My AI in group chats) ·
openai.com "Introducing group chats in ChatGPT" · Nomipedia, Kindroid Help,
Character.AI blog · GlobeNewswire (Shapes $8M seed) · docs.shapes.inc ·
PMC10757370 / Frontiers in Robotics and AI (n=155 robot disclosure study) ·
BSP/integrator secondary sources for pricing, OBA eligibility and ban risk,
flagged inline throughout.

**Repo:** `context/decisions.md` (`multiparty-direction`, `spec-c-minimal`,
`vision-model`, `relational-state`) · `context/measurements.md` ·
`context/graph.json` · `context/rejected.md` · `docs/SPEC.md` §0–§4, §6, §9,
§13, §14 · `docs/research/RESEARCH.md` §1–§3, §7 · `db/schema.sql` ·
`api/memory.js`, `api/export.js` · `src/engine/persona.ts`.
