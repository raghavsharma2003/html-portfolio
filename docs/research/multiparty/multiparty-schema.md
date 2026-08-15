# Track: multiparty-schema — repo-grounded design for group memory

Scope per assignment: extend the `vy_` layer (SPEC.md §2, applied in
`db/schema.sql`) to support the owner's multiparty direction
(`context/decisions.md` § `multiparty-direction`): one AI as a common friend
to a group, 1:1 with each member, judged references between members, and
presence in the group's shared space. NO WEB — every claim below is sourced
to a file/line in this repo. Nothing here has been applied; this is a design
proposal for Phase D (multiparty comes after the 1:1 relational OS per the
owner's own sequencing, `decisions.md`).

Everything proposed is **additive** in the sense SPEC §2.1 requires (nothing
existing dropped or reshaped) except one constraint loosening
(`vy_episode.person_id` NOT NULL → nullable), which is itself
additive-safe (loosening a constraint cannot break rows that already
satisfy it).

---

## 0. The one insight everything else reuses

The existing schema already computes provenance as `citations bigint[]`
pointing at `vy_episode.id`, enforced by a CHECK
(`vy_fact_cite_or_authored`, `db/schema.sql:362-364`) and joined at
GIN-indexed columns everywhere (`vy_fact_cit_ix`, `vy_pattern_cit_ix`,
`vy_kin_cit_ix`, etc., `db/schema.sql` throughout §2.3-2.4 as applied).
`decisions.md`'s `multiparty-direction` entry already names the mechanism:
*"Provenance-gated disclosure (every fact already carries citations to
episodes; episodes carry WHO was present) is the mechanism the schema
already half-supports."*

The design below makes that literal instead of aspirational: add a
**participant join table** on episodes (who was actually present), and
define **the disclosure ACL of any derived row, uniformly, as the
participant set of the episodes it cites** — never a separately maintained
permissions table. This is the same shape as the rest of the repo's
successful mechanisms (SPEC §0.1 rule 1: "authored or structural state +
deterministic retrieval + guarantees in code" — `docs/SPEC.md:26-31`): the
ACL is not a flag someone sets, it is a fact about who was in the room,
computed by SQL join, unforgeable by a generated-text step.

This one join is the load-bearing mechanism for the group facts, the
disclosure filter, AND the forget/export multi-owner problem below — they
all read the same table.

---

## 1. Schema additions

### 1.1 Episode participants (the ACL seed)

```sql
-- Loosen, don't replace: person_id stays the "reporting/primary" person for
-- 1:1 episodes (zero behavior change there); nullable only so a pure GROUP
-- episode can exist with no single owner.
alter table vy_episode alter column person_id drop not null;

alter table vy_episode add column if not exists group_id bigint;
  -- references vy_group(id), see §1.3 — nullable, set only for group episodes

alter table vy_episode add column if not exists disclosure_scope text
  not null default 'participants'
  check (disclosure_scope in ('participants','participants_1to1','private'));
  -- participants        = default: disclosable to anyone in the participant set
  -- participants_1to1   = disclosable, but never rendered back INTO a group
  --                       channel — only 1:1, even to people who were there
  -- private              = never disclosed beyond the reporting person, full stop
  -- (explicit override — see §3.3, this is the "don't tell B" case that
  -- presence-based ACL alone cannot express)

alter table vy_episode add column if not exists disclosure_deny uuid[]
  not null default '{}';
  -- hard block-list, intersected against the participant-derived allow set;
  -- exists because presence at an episode is not consent to have it surfaced

create table if not exists vy_episode_participant (
  episode_id bigint not null references vy_episode(id) on delete cascade,
  person_id  uuid not null,
  role       text not null default 'participant',
             -- participant|addressed|silent_present — cheap enough to log,
             -- not load-bearing for v1 disclosure logic
  primary key (episode_id, person_id)
);
create index if not exists vy_episode_participant_person_ix
  on vy_episode_participant (person_id, episode_id);
```

Backfill: `insert into vy_episode_participant select id, person_id from
vy_episode where person_id is not null` — every existing 1:1 episode gets
exactly one participant row, its own `person_id`. Zero behavior change for
the 1:1 product; this is genuinely additive.

**Why a join table and not an array column on `vy_episode`:** the disclosure
filter needs `WHERE exists (select 1 from vy_episode_participant where
episode_id = any(citations) and person_id = $recipient)` to be index-backed
in both directions — "who was at this episode" (compiler-time ACL check)
and "which episodes was this person at" (forget/export). An array column
supports only one direction well; the citation-arrays-with-GIN pattern
already in this schema (`vy_fact.citations`, etc.) is precedent for arrays
where the repo needed `&&`-style set intersection, but participant lookups
here need row-level joins with `on delete cascade`, which a bare array
cannot express. A join table is the closer fit to what's already proven.

### 1.2 The disclosure filter — one rule, everywhere

> **A derived row (fact, pattern, rel/dyad event, kin, currency, phrase) is
> disclosable to person R iff R appears in `vy_episode_participant` for
> every episode in that row's `citations`, AND R is not in the row's (or its
> citing episode's) `disclosure_deny`, AND the row's effective
> `disclosure_scope` permits the current channel.**

"Every episode" (not "any episode") is the deliberate, safety-first choice:
it is the same "taking too much is the safe direction" principle the forget
cascade already states for pattern deletion (`api/memory.js:582-583`,
"Patterns are deleted whole, never trimmed... taking too much is the safe
direction"). If a derived row's citations span one of A's private episodes
and one shared A+B episode, requiring ALL-participants-present means B
never sees it — correct, because the row may be substantively drawn from
A's private disclosure even though it also touches shared ground.

This "every" requirement only works cleanly if citations on one derived row
never mix episodes with *different* participant sets — otherwise "every"
degenerates to "the intersection of everyone who was ever in any cited
episode," which shrinks toward nobody and makes legitimate cross-references
impossible. So this proposal adds one **write-time invariant** for the
consolidator, parallel to the existing writer-window-validation rule
(SPEC §0.3, "B's window rule is the cheapest confabulation guard proposed
by any proposal" — `docs/SPEC.md:88`):

> **Citation homogeneity for disclosure**: a single derived row's citations
> must all resolve to the same participant set (or the consolidator must
> split the derivation into separate rows, one per distinct participant
> set).

This needs the same two-layer enforcement the repo already uses for
citations generally (§4.2 of SPEC, `docs/SPEC.md:710-725`): a writer-side
check at derivation time, plus a **sampled entailment-style audit** —
except I would argue this one should NOT ride the existing 5% sample rate.
A homogeneity violation is a cross-person privacy leak, not an ordinary
confabulation; the failure mode is worse than "wrong fact," it is "right
fact, wrong audience." I'd propose 100% audit (cheap — it's a SQL
self-join, not an LLM call) and a 0%-tolerance halt (any violation pages
the owner), not the 2%-refutation threshold used for the entailment audit
(`docs/SPEC.md:721-723`).

### 1.3 Group entity

```sql
create table if not exists vy_group (
  id         bigint generated always as identity primary key,
  name       text not null default '',
  kind       text not null default 'other'
             check (kind in ('couple','family','friend_group','other')),
  created_at timestamptz not null default now()
);

create table if not exists vy_group_member (
  group_id  bigint not null references vy_group(id) on delete cascade,
  person_id uuid not null,
  role      text not null default '',
  joined_at timestamptz not null default now(),
  left_at   timestamptz,        -- null = currently active
  primary key (group_id, person_id)
);
create index if not exists vy_group_member_person_ix
  on vy_group_member (person_id) where left_at is null;
```

`vy_group_member` governs **current** group-channel eligibility (whether
something can be rendered into today's group conversation). It is
deliberately NOT the disclosure ACL for historical content — that stays
`vy_episode_participant`, which is immutable history. This split matters:
see failure mode 4 (§4).

### 1.4 Group episodes reuse `vy_episode`

A group episode is a `vy_episode` row with `group_id` set,
`participation` extended to a new value `'group'` (alongside the existing
`we|user|meera`, `db/schema.sql:280-282`), `person_id` left null, and its
real participant list living in `vy_episode_participant` (however many of
the group's members were actually present for that stretch — not
necessarily the whole group, WhatsApp groups are read by whoever opens
them). Everything downstream — facts, patterns, embeddings, the retrieval
budget's batched-query shape (SPEC §3.3, `docs/SPEC.md:628-630`) — is
unmodified: citations still point at `vy_episode.id`, the CHECK constraints
still hold, the GIN indexes still work. This is the payoff of §0: no new
citation namespace, no new fact table.

Group **facts** need the matching nullable pair: `vy_fact.person_id`
already permits any owner scheme change of that kind since it has no FK
(`db/schema.sql:341`, plain `uuid not null` — no `references vy_person`);
propose the identical loosening plus an optional `group_id` column used
only as a retrieval-scoping hint, never as the security boundary (the
security boundary is always the citations→participants join, because group
membership can change after the fact and episode-time participation
cannot — again, failure mode 4).

### 1.5 Person-graph edges

```sql
create table if not exists vy_person_edge (
  id              bigint generated always as identity primary key,
  person_a        uuid not null,
  person_b        uuid not null,
  relation        text not null,   -- partner|sibling|parent|child|friend|
                                    -- colleague|ex|other — COARSE LABEL ONLY
  reported_by     uuid not null,   -- whose testimony created this edge
  citations       bigint[] not null,
  corroborated_by uuid[] not null default '{}',
  confidence      real not null default 0.7,
  t_invalid       timestamptz,
  superseded_by   bigint,
  created_at      timestamptz not null default now(),
  constraint vy_person_edge_cited check (cardinality(citations) >= 1),
  constraint vy_person_edge_order check (person_a < person_b)
);
create index if not exists vy_person_edge_a_ix
  on vy_person_edge (person_a) where t_invalid is null;
create index if not exists vy_person_edge_b_ix
  on vy_person_edge (person_b) where t_invalid is null;
```

**Deliberate scope limit, stated as a modeling rule, not left implicit:**
`vy_person_edge.relation` holds only the coarse relationship *label*
("sibling", "partner") — never qualitative content ("jealous of",
"resents"). Anything qualitative about a relationship between two group
members is a `vy_fact` with the disclosure machinery above, not an edge.
The reason: the edge answers "how should Meera address/route around these
two people" (routing metadata, low sensitivity, useful even
single-sourced), while qualitative content about the relationship is
exactly the "mutual friend's entire value / betrayal engine" risk the owner
named (`decisions.md` `multiparty-direction`). Collapsing the two into one
table would make it easy for a future change to accidentally treat a
low-sensitivity label and a high-sensitivity confidence as the same kind of
object. This split is a proposal, not something measured — flagging it as
the actual design bet in this section (thin evidence: zero production data
exists yet, per the assignment this track is repo-only and pre-build).

A single-sourced edge (`corroborated_by = {}`) is usable for Meera's own
reasoning (don't bring up A's ex while B is in the room) but its existence
should not itself be treated as a disclosed fact to `person_b` — telling B
"A told me you two are close" when only A said so is exactly the leak this
whole design exists to prevent, even though the *label* itself seems
harmless. Practically: `vy_person_edge` rows feed engine control-flow
(compare to SPEC §12.5's "state as compiler control-flow, invisible to the
model" fallback, `docs/SPEC.md:1153`), not T-slot content, unless
corroborated.

### 1.6 Per-dyad (person-person) WE-store

The existing WE-store (`vy_rel_event`/`vy_rel_state`/`vy_pattern`,
`db/schema.sql:382-447`) is keyed by one `person_id` — it is the
(person, Meera) dyad. The multiparty extension needs Meera's read on the
(person_a, person_b) dyad — "A and B are in a rough patch" — so she can be
sensitive with both without either having said so in the same episode.
Mirror the existing shape exactly, keyed by an ordered pair instead of one
person:

```sql
create table if not exists vy_dyad_event (
  id           bigint generated always as identity primary key,
  person_a     uuid not null,
  person_b     uuid not null,
  dim          text not null,   -- closeness|rupture|repair|shared_ritual|inside_joke
  from_v       text,
  to_v         text not null,
  direction    text not null check (direction in ('advance','regress','reset','init')),
  note         text not null default '',
  citations    bigint[] not null,
  observed_via uuid not null,   -- which person's episode this came through
  at           timestamptz not null default now(),
  constraint vy_dyad_event_cited check (cardinality(citations) >= 1),
  constraint vy_dyad_event_order check (person_a < person_b)
);
create index if not exists vy_dyad_event_pair_ix
  on vy_dyad_event (person_a, person_b, at desc);
create index if not exists vy_dyad_event_cit_ix
  on vy_dyad_event using gin (citations);

create table if not exists vy_dyad_state (   -- cache, same replay contract as vy_rel_state
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
```

Disclosure follows §1.2 exactly, no bespoke logic: `citations` point at
`vy_episode.id`, so the same all-participants-present rule governs whether
`vy_dyad_event` about (A,B) is surfaceable to A, to B, or to neither yet.
This is why the homogeneity invariant matters even more here than for
`vy_fact` — a dyad event derived from an A-only episode reflects only A's
side of the story, and the schema must never let it read as verified
knowledge disclosable to B just because it's *about* B.
`vy_rel_state`'s replay-rebuild mechanism (SPEC §9.1 step 5,
`docs/SPEC.md:940-942`; implemented `api/memory.js:803-847`) extends
unchanged to `vy_dyad_state` — same fold, same "forget beats cache
stability" rule, keyed by the pair instead of one person.

---

## 2. What changes in the compiler: per-recipient disclosure filter + tail slot

SPEC §3.2's TAIL layout (`docs/SPEC.md:582-593`) is compiled **per
turn**, always for a single addressee today (the device on the other end).
Multiparty needs the compiler to know **who it is compiling for** as a
first-class input — call it `recipient_person_id` — for both cases:

- **1:1 channel, but the content pool now includes group-sourced material**
  (Meera bridging: "arre, B was just talking about that").
- **Group channel**, where the recipient conceptually is "the group" but
  the disclosure filter still has to be evaluated per-message, because a
  reply in the group is read by every currently-active member
  simultaneously — so the compile-time ACL must be the **intersection**
  across all currently-present recipients, not any single one's ACL. This
  is strictly more restrictive than 1:1 bridging and should reuse the same
  `disclosure_scope != 'private'/'participants_1to1'` filter, applied with
  `recipient_set = active group members`, `ALL of recipient_set` required
  to pass, matching the "every, not any" principle from §1.2.

**Ordering, stated as a structural requirement, not a style
recommendation:** the disclosure filter is a `WHERE`/`EXISTS` predicate
joined against `vy_episode_participant`, and it must run **before** the
retrieval rank computation SPEC already specifies (`cosine × salience ×
need_p × participation bonus`, `docs/SPEC.md:823-825`). This is not
negotiable in the way SPEC treats structural guarantees generally (§0.1
rule 1, `docs/SPEC.md:26-31`): if disclosure ran as a post-hoc filter on
already-ranked candidates, a high-salience disqualified row could still
consume a slot budget, get partially rendered, or leak through a ranking
bug — the same class of failure the repo's own laws exist to prevent
(`recited-prompt`, `silent-truncation`). Putting it in the `WHERE` clause
of the same batched SQL-HTTP round trip SPEC already budgets (§3.3, p50
≤250ms, `docs/SPEC.md:628-630`) costs one more indexed join, not a second
round trip — but this is a claim, not a measurement (no group data exists
yet); flagging it as something that must be re-measured against the
existing p50/p95 budget before it ships, per the repo's own standard
(`docs/SPEC.md:737-739`, "Estimates become measurements... or the gate
does not close").

**New TAIL block — call it `mp.bridge` (the assignment calls it the
"T8-multiparty tail slot"; I'll flag the numbering collision explicitly:
SPEC's existing T8 is already `taste.rows`, drop-priority `never`,
`docs/SPEC.md:590` — this new block cannot reuse that slot number without
a renumbering pass owned by WS-COMPILER. Proposing it as an insertion after
T6 (`we.callbacks`) in the existing table, pushing T7-T10 down one, rather
than colliding with taste.rows):**

| pos | block | budget (proposed) | drop prio | content |
|---|---|---|---|---|
| T7 (new) `mp.bridge` | ~1,200 | 5 | ≤2 disclosure-filtered cross-person facts/episode-summaries, rendered as shapes never lines (`recited-prompt` applies identically here — a bridged line is doubly dangerous, both a phrase-bank risk and a person-B's-words-in-Meera's-mouth risk), gated by an eligibility classifier analogous to the deixis detector (§6.3, `docs/SPEC.md:814-816`): topical overlap between the current turn and a disclosure-eligible row, not proactive by default |

Eval target, matching the existing pattern exactly (SPEC §6.3,
`docs/SPEC.md:818-819`, "0 unprompted raises / 60"): **0 disclosure-ACL
violations / N replayed multiparty turns**, and separately, an
unprompted-bridge rate target analogous to the WE-callback one (bridging
should be occasional and warranted, not constant — no number proposed here,
this needs the same kind of offline battery D4 already runs for WE-recall
selectivity, `docs/SPEC.md:1246-1247`, extended rather than invented fresh).

---

## 3. Forget and export: the multi-owner problem (centerpiece)

### 3.1 Restating the problem precisely

Today, `api/memory.js`'s forget cascade (SPEC §9.1, `docs/SPEC.md:918-948`;
implemented `api/memory.js:570-801`) works because every row it touches has
**exactly one owner**: `vy_episode.person_id`, `vy_fact.person_id`, etc.
Step 1 deletes `meera_log` rows by `device_id`; step 2 finds episodes by
`log_from..log_to` intersection with those deleted rows; steps 3-4 chase
citations and `superseded_by` lineage; step 5 replays the surviving
`vy_rel_state`. Every one of these is single-tenant by construction — the
person requesting forget is the only person who could ever have standing
over that row.

Group episodes break this by construction: a `vy_episode` with `group_id`
set and 3 rows in `vy_episode_participant` has **no single person whose
forget request should be allowed to hard-delete it**, because doing so
deletes the other two participants' memory of a real, shared event they
did not ask to forget. This is exactly the case the assignment names as
hardest, and it is real — not a hypothetical: the current step-1 mechanism
(`api/memory.js:606-624` for scope=all, `:627-677` for scoped forgets)
assumes deleting the requester's own `meera_log`/`vy_episode` rows is
always safe because they were always the requester's rows alone.

There is a second, sharper version of the same problem underneath: **who
authored a `meera_log` row inside a group thread?** Today `meera_log` is
keyed by `device_id uuid not null` (`db/schema.sql:41`) with no
per-speaker column — a group WhatsApp thread ingested once (not per member
device) has no way to say "this line was B's, not A's." Without that,
"delete A's authored content, leave B's and Meera's group replies
standing" is not implementable at the row level; it can only be
implemented at the *episode* level (all-or-nothing), which reintroduces
exactly the problem above. **This is a blocking schema gap, not a policy
question** — flagged as load-bearing below.

### 3.2 Proposed ownership model: participant-scoped forget, not row-scoped forget

The rule this proposes, stated as plainly as the repo's own forget-stack
prose (`api/memory.js:928-935`):

> **Forget deletes what only I hold. Forget withdraws what we hold
> together. Forget never deletes what only you hold.**

Concretely:

1. **Single-participant episodes** (today's entire product): unchanged,
   hard delete, exactly the current cascade.

2. **Multi-participant (group/shared) episodes**: a forget request from
   participant P does **not** delete the `vy_episode` row. It:
   - Deletes P's row from `vy_episode_participant` for that episode (P
     drops out of the ACL — the episode can no longer be disclosed to P,
     nor attributed as evidence P witnessed, going forward).
   - Deletes P's own authored `meera_log` rows within that episode's log
     span (requires the `speaker_person_id` column named in §3.1 as a
     blocking gap) — never Meera's replies to the group, and never other
     participants' authored rows.
   - Recomputes the disclosure ACL of every derived row (`vy_fact`,
     `vy_dyad_event`, `vy_pattern`, ...) whose citations include that
     episode: P simply drops out of `vy_episode_participant`, so the
     existing join-based filter (§1.2) automatically stops surfacing that
     content to P on the next retrieval — **no additional cascade step is
     needed for this part**, which is the practical payoff of making
     disclosure a live join instead of a stored permission.
   - If P was the **last remaining active participant** (every other
     participant has already withdrawn, or the episode's group has zero
     active members per `vy_group_member.left_at`), the row and its full
     derived closure hard-delete exactly as today's single-owner cascade
     does — "last one out closes the door."

3. **`vy_person_edge`**: owned by `reported_by`. P's forget deletes the
   edge if `corroborated_by` is empty; if corroborated, ownership
   transfers to a remaining corroborator (`reported_by` reassigned) rather
   than deleting knowledge someone else independently gave Meera. (Failure
   mode: this reassignment is exactly where a corroboration-inflation bug
   would hide — see §4.3.)

4. **`vy_dyad_event`**: owned by `observed_via`, same withdrawal-not-delete
   logic as episodes — P's own observations are removed; the pair's
   surviving events still replay-rebuild `vy_dyad_state` (reusing
   `rebuildRelState`'s exact mechanism, `api/memory.js:812-847`, keyed by
   pair instead of person).

5. **`vy_group_member`**: a forget (or "leave") request sets `left_at`,
   never deletes the group for the remaining members. A `scope=all`
   (full-account) forget removes P's own `vy_group_member` row via the
   `PERSON_TABLES` manifest (`api/memory.js:535-559` — this list is
   exactly where the new tables get registered, since it's already the
   single source of truth export and forget both read,
   `api/memory.js:522-527`) — the group survives, orphaned-group cleanup
   is a nightly sweep concern (parallel to the existing zero-orphan
   integrity sweep, SPEC §4.1 step 11, `docs/SPEC.md:705-708`).

### 3.3 What this means for the user-facing receipt

The current forget stack's honesty rule — "receipt after delete... 'haan,
hata diya' is sent only once the transaction commits" (SPEC §9.1,
`docs/SPEC.md:923-924`; implemented via the no-`.catch()`-swallowing
comment at `api/memory.js:592-594`) — has to say something more precise for
shared episodes, or it becomes a lie by omission of exactly the kind the
repo's own `rejected.md` culture would flag. Proposed receipt language
(product/copy decision, not schema, but stated here because it is
load-bearing for whether this ownership model is honest rather than
covertly partial): *"okay, I'll forget your side of that — but if \[the
other person\] told me too, that's theirs to decide, not yours to take
back."* Silently doing participant-withdrawal while the UI still says the
unqualified "forgotten" line used for 1:1 today would be a trust violation
on the scale of the ones the repo has already paid to learn about
(`recited-prompt`, `silent-truncation`).

### 3.4 Export: the same join has to reach into `PERSON_TABLES`

`api/export.js` streams every table in `PERSON_TABLES`
(`api/memory.js:535-559`) with a single `WHERE {key} = $1` per table
(`api/export.js:119-126`), where `key` is always a plain column
(`device_id` or `person_id`). This single-column-key assumption breaks for
every multiparty table proposed above:

- `vy_episode` (group rows): P's membership lives in
  `vy_episode_participant`, not in a `person_id` column that could ever
  equal P for a group row.
- `vy_dyad_event`/`vy_dyad_state`: P could be `person_a` or `person_b`.
- `vy_person_edge`: P could be `person_a`, `person_b`, or a member of
  `corroborated_by`.

Proposal: extend the `PERSON_TABLES` manifest's shape from `{table, key,
lane}` to allow `key` to name a **join spec** instead of a bare column —
e.g. `{ table: "vy_episode", key: "participant", lane: "relational_shared" }`
resolved as `select e.* from vy_episode e join vy_episode_participant p on
p.episode_id = e.id where p.person_id = $1`. Because `PERSON_TABLES` is
already the single source of truth both forget and export read
(`api/export.js:6-11` states this explicitly as a SPEC §9.2 requirement),
this is the correct place to put the extension — one manifest entry, both
consumers stay in sync by construction, which is the entire reason that
manifest exists.

**"A's export must not carry B's private facts"** is then satisfied the
same way disclosure is satisfied everywhere else in this design: A's
export query is *itself* a disclosure-filtered query (A is the recipient
of A's own export), so a fact whose ACL excludes A because A never
participated in its citing episodes is excluded from the join results
without any separate redaction step. The one place this is NOT
automatically true, flagged as an open question rather than answered here:
**should A's export of a shared group episode contain B's verbatim
authored turns from that episode's `meera_log` span?** A received those
messages in real time (they were sent to the group, A was a legitimate
recipient) but they are also B's own authored content. This is a genuine
DPDP joint-controller / joint-processing question for group chat data, not
resolvable by schema design alone — flagging it explicitly per house style
("thin evidence says so") rather than asserting an engineering-only answer.
My default recommendation, stated as a recommendation and not a finding:
include them (A did receive them, and WhatsApp itself shows A the same
transcript), but exclude any content that fails a `disclosure_scope`
check narrower than plain receipt (e.g., anything Meera derived
privately about B that was never actually said in the shared episode).

---

## 4. Failure modes, named (per assignment: name the ownership model's failure modes explicitly)

1. **Silent partial-forget marketed as full forget.** If the product
   surface ever shows the unqualified 1:1 "forgotten" confirmation for a
   participant-withdrawal on shared content, this is a trust violation of
   the same shape the repo has already paid for twice (`recited-prompt`).
   **Detect:** any UI copy audit that finds the group-forget receipt
   matching the 1:1 receipt string. **Response:** distinct receipt copy is
   not optional (§3.3).

2. **`speaker_person_id` gap blocks the whole model.** Without a
   per-speaker column on group-channel `meera_log` rows, "delete only my
   authored turns" cannot be implemented at the row level, forcing a
   fallback to all-or-nothing at the episode level — which reintroduces
   the exact problem this design exists to solve. **This is the single
   highest-severity gap in this proposal** and should block any group-chat
   ingestion path, not just be noted for later. **Detect:** trivially, at
   design review — the column does not exist today
   (`db/schema.sql:39-47`). **Response:** add it before any WhatsApp-group
   ingestion code is written, not after.

3. **Corroboration inflation.** If the consolidator (or a bug in it) ever
   marks a `vy_person_edge` or citation set as "corroborated by B" when B
   never actually said the corroborating thing, ownership reassignment
   (§3.2.3) would make a single person's private disclosure survive that
   person's own forget request under a false claim of shared ownership —
   the multiparty analogue of a confabulated fact, except the failure mode
   is a privacy leak, not just an error. **Detect:** this is exactly why
   §1.2 proposes 100% audit / 0%-tolerance halt for the homogeneity
   invariant, stricter than the existing 5%-sample / 2%-refutation rule
   used for ordinary entailment (SPEC §4.2, `docs/SPEC.md:721-723`) — the
   asymmetry is deliberate. **Response:** any detected violation halts the
   consolidator and pages the owner, same posture as the existing
   entailment-audit halt condition, never a tunable threshold.

4. **Departed-member residue.** `vy_episode_participant` is immutable
   history (correctly — you cannot retroactively un-attend a conversation)
   but `vy_group_member.left_at` changes. A member who has since left the
   group might still satisfy the ACL check for old shared episodes (they
   really were there), so content from before they left could still
   surface to *other current members* in a way that references someone no
   longer in the room to be asked. **Detect:** no repo precedent exists for
   this exact case; it needs an explicit owner ruling, not an engineering
   default. **Recommendation, not a settled answer:** downgrade
   `disclosure_scope` on episodes to `participants_1to1` (never rendered
   back into the live group channel, still available 1:1 to people who
   were genuinely present) once any of that episode's participants leaves
   the group — restrictive by default, matching "taking too much is the
   safe direction" (`api/memory.js:583`).

5. **Forget deadlock, misread as broken rather than correct.** Under this
   model, a shared episode with N participants persists in full until N-1
   of them have forgotten it — a single person cannot force it out of
   existence for everyone else. This is very likely the *correct* behavior
   (nobody should be able to unilaterally erase someone else's memory) but
   it will read as a broken promise to a user who asked Meera to "forget
   that" and finds out later she still knows, because a friend never asked.
   **Detect:** cannot be caught by an automated probe — this is a
   product-copy and consent-flow problem. **Response:** the group-consent
   flow (a real gap: nothing named "group onboarding consent" exists
   anywhere in `context/` or `docs/` yet) must say this plainly before
   anyone's first group episode is recorded, not discover it at the first
   forget request.

6. **Citation-homogeneity violation (the ACL model's single point of
   failure).** Everything in §1.2-§3 assumes a derived row's citations
   never mix episodes with different participant sets. If that invariant
   is ever violated — by a bug, not by design — the "every participant
   present" disclosure rule silently computes the wrong (too-narrow or, in
   a differently-shaped bug, too-wide) ACL, and the wide-open direction of
   that failure is a direct leak between two people who trusted Meera not
   to cross-contaminate what they told her separately. **Detect:** the
   100%-audit proposal in §1.2. **Response:** any single violation halts
   and pages — this is the one place in the entire multiparty design where
   "halt on any occurrence" rather than "halt above a measured threshold"
   is the right posture, because unlike an ordinary confabulation (wrong
   fact, embarrassing) this failure class is a disclosed confidence
   (wrong audience, a betrayal), and the two are not the same severity even
   though both would show up as "the audit found a violation."

---

## 5. What is NOT resolved here, named explicitly

- **DPDP joint-controller status of group chat data** (§3.4) — a legal
  question, flagged not answered.
- **Group consent flow** — does not exist yet in any doc; needed before
  §4.5's deadlock behavior is honest rather than surprising.
- **`participation='group'` retrieval-rank semantics** — SPEC §6.3's
  deixis/moment gates (`docs/SPEC.md:803-825`) were tuned for the 1:1
  WE-store; whether the same deterministic classifiers work for
  group-channel bridging (§2's `mp.bridge` slot) is untested and should be
  a D-battery addition, not assumed.
- **Retrieval-budget cost of the extra participant join** (§2) — a claim,
  not a measurement; the existing p50 ≤250ms budget (`docs/SPEC.md:628-630`)
  has no group-shaped fixture to test against yet.
- **Person-graph edge sensitivity calibration** (§1.5) — the coarse-label
  vs. qualitative-content split is a design bet with zero production
  evidence behind it, stated as such.

These gaps are the reason this track is scoped as a design proposal, not a
migration ready to write.
