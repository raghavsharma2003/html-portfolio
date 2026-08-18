# PROPOSAL-MULTIPARTY-V1.md — the shared-memory companion, v1

**Status:** proposal for coordinator judgement. Nothing here is applied; no
migration is written; no file outside this one was touched.
**Mandate:** `context/decisions.md#relational-wedge` item 3 — the consumer
wedge is a multiparty shared-memory companion, Telegram-first.
**Inputs treated as settled and not re-derived:** `docs/research/multiparty/`
(all seven files), `context/decisions.md` (`multiparty-direction`,
`group-distribution`, `structural-disclosure`, `adult-default`,
`phase-c-complete`), `context/measurements.md#disclosure-leak-rates`,
`context/rejected.md` (`recited-prompt`, `speaker-id`), `docs/SPEC.md` §0–§4,
§6.3, §9, §13, `db/schema.sql`, `api/memory.js`.

---

## 0. Governing laws this design inherits, and two corrections to the brief

### 0.1 Inherited laws (inputs, never trade-offs)

1. **Safety invariants are room-blind.** CRISIS_LINES verbatim,
   never-deny-being-an-AI, NEVER MANIPULATE apply identically in a 1:1 DM and
   in a room. The 138-invariant suite is not relaxed for group context; a
   change that trips it is wrong (CLAUDE.md). §2.7 states the one place a
   naive reading of "group privacy" would try to suppress a helpline, and
   refuses it.
2. **Adult-only stands** (`adult-default`). A room is the highest-risk place
   for an unverified member, because the material is not only theirs. v1 adds
   a structural rule: **no person row, no persistence** (§6.4).
3. **`recited-prompt`.** Every moment in §1 is a *design target*, not prompt
   text. None of §1 may be pasted into `src/engine/persona.ts` or any
   compiler block. Bridged content in particular is doubly dangerous — it is
   both a phrase-bank risk and another person's words in her mouth
   (MULTIPARTY.md §3.5). Bridge rows render as shapes, never lines.
4. **Position is mechanism.** T10 stays PINNED LAST and stays capped at
   exactly two rules (SPEC §3.2). No multiparty rule goes there. The
   appended-last set is not widened by this proposal.
5. **`structural-disclosure`.** Disclosure is a retrieval property. Every
   rule in §2 maps to a `WHERE` clause, a CHECK, a join, or an app-voiced
   deterministic string — never to a sentence in the prompt. Measured basis:
   `disclosure-leak-rates` (ConfAIde Tier-3 ChatGPT 93%; PiSAs single-agent
   V_vis 100% → 33.5% partitioned → 63–90% when memory is added back;
   9–90% residual for every behavioural mitigation ever measured).
6. **Measure > reason.** Every number below is either cited to a research
   file or explicitly labelled a claim awaiting measurement.

### 0.2 Correction 1 — the reserved T8 multiparty slot does not exist

The brief states "the T8-multiparty compiler slot is reserved at ≤2000
chars." **It is not.** SPEC §3.2 T8 is `taste.rows` (budget 800, drop
priority `never`, member of the CI-asserted undroppable set,
`docs/SPEC.md:590`). MULTIPARTY.md §3.5 and §6.6 already flagged this same
premise as wrong in the earlier sweep's brief; the error has propagated.

**Resolution, honouring both:** the 2,000-char multiparty allowance is
real and is spent, but as **two new blocks at a new insertion point**, not
by colliding with `taste.rows` — `mp.roster` (900, undroppable, group
channels only) and `mp.bridge` (1,100, drop priority 1). Arithmetic in §5.

### 0.3 Correction 2 — `measurements.md` still carries a corrected claim

`context/measurements.md#disclosure-leak-rates` (2026-08-13) states:
"**silence must be a separately-decided action** — MultiLIGHT measured a
joint speak-or-silent architecture at 35.8% … against 54.4% for a dedicated
decision step."

MULTIPARTY.md §7 item 6 (2026-08-15, post-verification) says the numbers are
right and **the causal attribution is wrong**: the paper blames three
separate independently-deciding models, and its own single-model
Speaker-AND-Utterance condition — which *bundles* the decision with
generation — scores 49.5%, contradicting the thesis. The verdict is
explicit: *"Do not cite MultiLIGHT as support for 'always decide silence as
a separate step.'"*

Per the brief's law ("if the research contradicts this brief, trust the
research"), this proposal treats the separate silence step as an
**engineering bet, logged for measurement** (§5.4), not as a finding. **The
`measurements.md` entry should be amended with a `supersedes` edge rather
than left standing** — flagged for the coordinator, not edited here (that
file is not this workstream's to write).

---

## 1. The felt product

Ten scripted moments. Each carries the row that makes it possible and the
ACL clause that makes it legal — a moment we cannot name the mechanism for
is a moment we cannot ship. **Design targets. Not prompt text.**

The through-line: *v1's value comes from the room, not from carrying secrets
between DMs.* That is the §2.2 default policy stated as a product feeling —
she is the friend who was **in the room with you**, and who therefore has a
right to remember it.

---

**M1 — "wahi wala plan."** Three weeks after the room half-planned a Goa
trip and dropped it, someone types *"bhai woh plan ka kya hua"*. She has the
plan: dates floated, who said budget, who never replied. She lays it out in
four lines and asks who is still in.
*Row:* `vy_fact(kind='world', group_id=<room>)` cited to the room episodes ·
*ACL:* every current member was a participant in every cited episode → the
structural branch passes with zero grants. *Deixis-gated* per SPEC §6.3 —
"woh plan" is a shared-reference cue, not a scheduled nudge.

**M2 — she remembers the room, in your DM.** You DM her, alone: *"main
Priya ko kaise bataun ki mujhe nahi aana"*. She already knows the trip is
the 14th, that you said budget twice, and that Priya booked. She helps you
say it.
*ACL:* group→1:1, recipient set = {you}, and you were a participant in
every cited episode. **This is the highest-value, zero-risk direction and
it is where most of v1's felt value lives.** Nothing crossed a wall; she
just did not amnesia the room when you opened a DM.

**M3 — the running joke.** Someone in the room mistypes *"biryani"* as
*"biriyanii"* once. Eleven days later a restaurant comes up and she uses it
back at them, once, correctly.
*Row:* `vy_phrase(group_id=<room>)`, the room's phrase ledger · *ACL:*
coined in the room, in front of everyone. **This is the safest and most
delightful memory class in v1** — inside jokes are shared by construction,
non-sensitive by construction, and no one can be betrayed by one. Gated by
the same 14-day freshness/reuse discipline `vy_currency` already applies.

**M4 — the consent moment (the hero).** In a DM, Rohan says *"14th ko
Anjali ka birthday hai, kuch karna chahiye"*. She does **not** carry it. She
asks Rohan, in Rohan's DM, one question with two buttons:
*group mein plan shuru karun? — [haan] · [nahi, abhi nahi]*.
He taps `haan`. Only then does she open it in the room, without ever
attributing it to him unless he also allowed that.
*Rows:* the tap writes a `vy_episode` (the consent event) and a
`vy_disclosure_grant` citing it (`vy_grant_cited` CHECK, §4.2) ·
*ACL:* the explicit-grant branch. **The consent UX is one tap and it
produces a cited, auditable, revocable row.** This is CPM's negotiated rule
(MULTIPARTY.md R1) made literal: she may *ask* whether B can know; she may
never decide it alone.

**M5 — she stays quiet.** Forty messages of election banter in ten minutes.
She says nothing. Someone finally types *"@meera tu bata"* and she answers
once, briefly, and stops.
*Row:* `vy_group_turn(action='lurk')` × 40 — silence is an event, not an
absence (MULTIPARTY.md §2.3 Stage 5). *Basis:* over-chiming and
over-silencing are both measured failures (MUCA fixed-cadence rated
excessive by 56.25%; Inner Thoughts' most-restrained condition
least-preferred at 2/12), and the one mass deployment optimised for presence
was punished for exactly that (Meta AI in WhatsApp groups). Lurking is the
modal behaviour of real group members; quiet is not under-delivery.

**M6 — the wall, felt.** In a DM: *"Priya ne mere baare mein kuch kaha?"*
She answers honestly and without hedging that Priya's DMs are not something
she carries out — and she does not soften it with a hint, a tone, or a
"well…". She does not know, because the rows were never retrieved.
*Mechanism:* nothing to leak — the compile for recipient {you} never
contained a Priya-only row. **This moment is the product.** A user who tests
the wall once and finds it solid is the retention event; a user who finds it
porous is gone and tells the room. Note the shape law: this is the one place
where the *absence* of information is the feature, and it works only because
§2's exclusion is structural — a model asked to decline while holding the
answer leaks at 9–90% (`disclosure-leak-rates`).

**M7 — two rooms, one person.** You are in the college room and the family
room. She never once mentions one in the other, and if asked she says so
plainly.
*ACL:* the room-isolation clause (§2.4). *Basis:* "Bots can Snoop"
(arXiv:2410.06587) measures a 3.6% cross-group re-identification rate for
ordinary bots; a common friend holding several people's private facts is the
over-privileged case by construction.

**M8 — forget, honestly.** You ask her to forget the fight the room had.
She deletes your side of it and says, without dressing it up, that the
others' side is theirs to take back, not yours.
*Mechanism:* §3, participant withdrawal + a **distinct receipt string**
(app-voiced, deterministic, sent only after commit — SPEC §9.1). Reusing the
1:1 "haan, hata diya" here would be a trust violation of the same shape as
`silent-truncation` (MULTIPARTY.md §3.4 failure mode 1).

**M9 — register per person, in one turn.** In the family room she says
*aap* to the chachi and *tu* to her cousin, in the same message, and never
publicly corrects the elder.
*Row:* `mp.roster` (§5.2) renders each active member's honorific band and
relative rank as k:v data. *Basis:* R5/R6 (MULTIPARTY.md §5) — Hindi kin
address encodes rank grammatically, and the Indian family-group moderation
norm is that no one corrects someone higher in the hierarchy. **R6 is a
named open gap in the research** (`vy_rel_state.honorific` is per-person and
the compiler has no documented multi-render mechanism); §5.2's roster strip
plus the ≤6-member cap is this proposal's answer to it, and it is a bet, not
a solved problem.

**M10 — the newcomer.** A seventh friend is added to the room. She greets
them and does not spill six months of room history at them.
*ACL:* joins the `vy_episode_participant` set from now; past episodes'
participant sets are immutable history, so the "every recipient at every
cited episode" rule excludes them from group-channel retrieval automatically
— no new code path (§2.3).

### 1.1 The anti-moments — what must never happen, once

M6/M7/M8/M10 are the trust half of the product and each has an inverse that
is not a bug but an ending:

| never | why it ends the product |
|---|---|
| she repeats a 1:1 line in the room | CPM boundary turbulence; the betrayal engine `multiparty-direction` names |
| she hints without repeating ("uske paas apne reasons hain…") | a hint is a disclosure with deniability — worse, not better |
| she takes a side in a room fight | Simmel's *tertius gaudens*; NEVER MANIPULATE at group scale (R3) |
| she says "hata diya" when she deleted half | §3, failure mode 1 |
| she mentions room A in room B | M7 |
| she nudges a quiet room to talk | the killed idle nudge, `persona.ts:470-477` — incentive salience engineering, already rejected at 1:1 |

---

## 2. The privacy architecture

### 2.1 Rooms, channels, and the one primitive

Two channel types, one primitive:

- **1:1 channel** — recipient set `R = {A}`. Exactly today's product.
- **group channel (a "room")** — recipient set `R = all currently-active,
  linked members`. Strictly more restrictive than any 1:1 evaluation of the
  same predicate, and therefore **needs no separate code path**
  (MULTIPARTY.md §3.3).

The primitive is the research's, unchanged and adopted verbatim:

> **The disclosure ACL of a derived row is the participant set of the
> episodes it cites.** Not a permissions table. Not a flag anyone sets. A
> fact about who was in the room, computed by join, unforgeable by a
> generated-text step (MULTIPARTY.md §3.0).

### 2.2 The default disclosure policy — v1's central design call

The research's structural default (PRIVATE unless every recipient was
present at every cited episode) is correct and is adopted. What v1 adds is a
**scope decision about which direction of flow the product sells on**:

| flow | v1 default | mechanism |
|---|---|---|
| room → room (she remembers the room, in the room) | **allowed, no consent needed** | structural branch: all members were participants |
| room → your DM (M2) | **allowed, no consent needed** | structural branch: you were a participant |
| your DM → the room | **never, without an explicit cited grant** | grant branch only (M4) |
| your DM → another person's DM | **never in v1, grant or not** | §2.4 clause 3 — the tier is disabled, not merely defaulted off |
| room A → room B | **never** | §2.4 clause 4 |
| anything `sensitive=true` or negatively-valenced | **never crosses any boundary, grant or not** | §2.4 clause 5 (hard floor above the grant branch) |

**Why this is the right cut.** The flashiest demo — "she told me what your
girlfriend said about you" — is also the one with a measured floor of
nothing and a literature that names it a betrayal engine. Rows 1–2 need
**zero model judgement and zero user consent**, are instantly legible ("she
was there, of course she remembers"), and cover M1, M2, M3, M5, M9, M10 —
six of ten moments. Row 3 is the one consent flow and it is the hero moment
(M4). Rows 4–6 are off.

This also answers the sharpest evidence *against* the product thesis:
`disclosure-control.md` §3 (n=15, qualitative, flagged thin) finds companion
users expect a **"socially contained partner"** — the transferred default is
*silence*, not discretion, and the paper's own authors note the study never
probed group scenarios. Building v1 on "she remembers what you already know
she heard" does not fight that expectation; it never invokes it.

**Reverses if:** the pilot (§8) shows rows 1–2 do not produce the
instant-value moment (users report her room memory as unremarkable), *and*
exit interviews show appetite for row 3+. Then BRIDGEABLE moves from an
owner-signed dark flag to a scoped test — never to a default.

### 2.3 The predicate — every rule as a WHERE clause

One predicate, in the WHERE clause of the existing batched T2–T7 union-all
round trip (SPEC §3.3), evaluated **before** the rank computation
(`cosine × salience × need_p × participation bonus`, SPEC §6.3). Not a
post-hoc filter: a disqualified high-salience row that reaches the ranker can
still consume slot budget, be partially rendered, or escape through a
ranking bug — the failure class `recited-prompt` and `silent-truncation`
already cost this repo (MULTIPARTY.md §1.2).

Bindings: `$1 uuid[]` recipient set · `$2 boolean` is_group_channel ·
`$3 bigint` current room id (null in 1:1).

```sql
-- (0) explicit deny always wins; presence is not consent to be surfaced
and not (f.disclosure_deny && $1)

-- (5) hard floor: sensitive / negative rows never cross, grant or no grant
and not (f.sensitive and $2)
and not (f.sensitive and f.person_id <> all($1))
and not exists (select 1 from jsonb_array_elements(f.affect_tags) t
                 where (t->>'tag') = any($4::text[]))   -- $4 = negative tag set

-- (1)+(2) grant branch OR structural branch
and (
      (select coalesce(array_agg(g.granted_to), '{}')
         from vy_disclosure_grant g
        where g.subject_kind = 'fact' and g.subject_id = f.id
          and g.t_invalid is null) @> $1
   or
      not exists (
        select 1 from unnest(f.citations) as c(ep)
         where exists (select 1 from vy_episode e
                        where e.id = c.ep
                          and (e.disclosure_scope = 'private'
                               or (e.disclosure_scope = 'participants_1to1'
                                   and $2)))
            or exists (select 1 from unnest($1) as r(pid)
                        where not exists (select 1 from vy_episode_participant p
                                           where p.episode_id = c.ep
                                             and p.person_id = r.pid))
      )
)

-- (4) room isolation: a room-sourced row never renders into another room
and (not $2 or f.group_id is null or f.group_id = $3)

-- (6) v1 kill-switch on the untested tier: no DM→DM carry, ever
and (f.group_id is not null or f.person_id = any($1)
     or exists (select 1 from vy_disclosure_grant g
                 where g.subject_kind='fact' and g.subject_id=f.id
                   and g.t_invalid is null and g.granted_to = any($1)
                   and $2))            -- grants only ever fire INTO a room in v1
```

The same predicate, with `subject_kind` swapped, guards `vy_phrase`,
`vy_episode` summaries and `vy_pattern`. **"Every episode", not "any
episode"** is deliberate and matches the existing forget cascade's stated
principle ("patterns are deleted whole, never trimmed… taking too much is
the safe direction", `api/memory.js:867-869`).

**Recipient-set derivation** (the only place membership is read; membership
governs the live channel, never history):

```sql
select coalesce(array_agg(m.person_id), '{}')
  from vy_group_member m
 where m.group_id = $1 and m.left_at is null and m.linked_at is not null;
```

**Citation homogeneity — the single point of failure.** "Every episode"
degenerates if one derived row's citations span episodes with *different*
participant sets. The consolidator therefore carries a write-time invariant
(MULTIPARTY.md §3.3), and this proposal adopts its enforcement asymmetry
unchanged:

> A single derived row's citations must all resolve to the same participant
> set, or the consolidator splits the derivation into one row per distinct
> participant set.

Audited at **100%**, not at SPEC §4.2's 5% sample, because it is a SQL
self-join rather than an LLM call and the failure mode is not "wrong fact,
embarrassing" but "right fact, wrong audience". **Any single violation halts
the consolidator and pages the owner.** This is the one place in the design
where halt-on-any-occurrence, rather than halt-above-a-threshold, is
correct.

### 2.4 What the numbered clauses buy

| clause | rule | basis |
|---|---|---|
| 0 | explicit deny beats everything | presence ≠ consent (MULTIPARTY.md §3.1) |
| 1 | grant branch, cited to the consent episode | CPM / R1; never inferred |
| 2 | structural branch: every recipient at every cited episode | `disclosure-leak-rates`; the only layer with a measured floor of zero |
| 3 | `disclosure_scope='participants_1to1'` never renders into a room | a DM is not a room even between the same two people |
| 4 | room isolation | "Bots can Snoop" 3.6% cross-linking |
| 5 | sensitive / negative never crosses | R2 — the relay evidence is for *accurate, selective, reputation-positive* information only (Feinberg/Willer/Schultz 2014); criticism and complaint never bridge |
| 6 | DM→DM disabled in v1 | BRIDGEABLE is unmeasured anywhere — no benchmark in the sweep tests *active* bridging (MULTIPARTY.md §1.3) |

### 2.5 Consent UX — one tap, one cited row

Telegram inline keyboards give us a consent primitive that is structural
rather than conversational. The flow, in full:

1. **Trigger — user-initiated only in v1.** A grant is offered *only* when
   the owner of the information has typed something the deterministic
   intent-classifier reads as a share instruction (`bata do`, `tell them`,
   `group mein bol`, `share`). She never proposes a share on her own
   initiative. *(The one exception category — open plans/logistics, M4's
   shape — sits behind an owner-signed flag in `config/decay.json` style,
   **OFF at launch**, because active bridging is the tier the literature has
   never measured.)*
2. **The card.** An app-voiced deterministic string (not model-generated,
   not in the prompt — therefore not a `recited-prompt` surface) plus two
   inline buttons carrying an opaque `callback_data` token: the subject row
   id, the target room, the act (`gist` | `paraphrase` | `verbatim`,
   defaulting to `gist`), and a nonce.
3. **The tap** writes, in one transaction: a `vy_episode`
   (`participation='user'`, telegraphic summary of the consent act) and a
   `vy_disclosure_grant` citing it. The `vy_grant_cited` CHECK means a grant
   that cannot point at the moment consent was given cannot exist.
4. **Revocation** — `t_invalid` (belief change), not deletion. A "stop
   sharing that" typed later invalidates the grant; already-said turns are
   history and she says so rather than pretending.
5. **Silence is never consent.** No timeout auto-grants. An unanswered card
   expires with the nonce.
6. **Default act is `gist`.** `verbatim` requires the word-level explicit
   ask, because verbatim is simultaneously a phrase-bank risk
   (`recited-prompt`) and person-B's-words-in-her-mouth.

### 2.6 Transparency — R4, the strongest safety finding in the sweep

Every member must know she talks to the others, and roughly what she does
with it. Evidence: "Secret Soulmates" (Wheatley/IFS 2026, n>2,000 partnered
18–30 — institution-published, not peer-reviewed, flagged): >half of users
conceal companion use; regular use associates with a 46% decrease in
relationship stability and 40% decrease in high-quality communication, while
satisfaction with the AI itself is higher. The mechanism named — sycophantic
one-sided listening displacing direct disclosure — is general to any
triangulated AI.

*Enforcement:* a **second fact on the existing app-voiced disclosure rail**
(SPEC §9.3, the statutory session-clock card) — app voice, never model
recitation, she never contradicts it and owns it plainly if asked
(never-deny-AI). It states the *fact and category* of her other
relationships in the room, never content. Posted on room creation (§6.3) and
re-postable by any member with `/kya /kaise`.

### 2.7 Safety invariants in a room — the one adjudication

A member types something crisis-flagged **in the room**. A naive reading of
"group privacy" suppresses the helplines to avoid disclosing their state to
the room.

**Ruling: the crisis protocol is room-blind and fires verbatim, in the room
it was triggered in.** Reasons: (a) the person disclosed it themselves, in
that room, to those people — there is no ACL question, only a social
discomfort one; (b) suppressing a helpline for social comfort is precisely a
behavioural override of a safety invariant, which the 138-suite exists to
make impossible; (c) `check-prompt-budget` exists because truncation has
already cost us the helplines once (CLAUDE.md). She additionally opens the
1:1 **only if that member is linked** — an unlinked member gets the room
response and nothing else (§6.4).

---

## 3. Multi-owner forget — the v1 policy

The rule, adopted from MULTIPARTY.md §3.4 and stated in the same register as
the existing forget stack:

> **Forget deletes what only I hold. Forget withdraws what we hold together.
> Forget never deletes what only you hold.**

### 3.1 The mechanics

1. **Single-participant episodes** — today's entire product. Unchanged, hard
   delete, current cascade exactly (`api/memory.js:856-911`).
2. **Room episodes, forget from participant P:**
   - delete P's `vy_episode_participant` row → P leaves the ACL; the episode
     can no longer be disclosed *to* P or attributed as something P
     witnessed;
   - delete P's own authored `meera_log` rows in the episode's log span —
     **requires `speaker_person_id`** (§4.1), never her replies to the room,
     never another member's rows;
   - **no derived-row cascade step is needed at all.** Because disclosure is
     a live join, P dropping out of `vy_episode_participant` stops the
     content surfacing to P on the very next retrieval. This is the payoff
     of §2.1's primitive;
   - if P was the **last remaining active participant**, the row and its
     full derived closure hard-delete exactly as today — last one out closes
     the door.
3. **`vy_disclosure_grant`** — owned by `granted_by`. Forget from the grantor
   hard-deletes it (it was their permission to give); forget from a grantee
   removes them as a recipient. Revocation without forget sets `t_invalid`.
4. **`vy_group_member`** — forget or "leave" sets `left_at`. It never deletes
   the room for the others. `scope=all` removes P's membership row via the
   manifest; orphaned-room cleanup is a nightly sweep on the pattern of the
   existing zero-orphan sweep.
5. **`vy_phrase` with `group_id`** — a room's inside joke is co-authored by
   construction. Same withdraw semantics: P's departure removes P from the
   ACL; the phrase survives for the others; it dies with the last
   participant.

### 3.2 Two rulings v1 makes that the research left open

**Ruling A — departed-member residue** (MULTIPARTY.md §3.4 failure mode 4;
open question 9, explicitly "needs an owner ruling, not a probe").

The research's tentative recommendation was to downgrade affected episodes
to `participants_1to1` once any participant leaves. **This proposal declines
it**: a member leaving is a common event and that rule silently amputates
the room's memory for everyone who stayed, which reads as the product
breaking rather than as a privacy feature.

> **v1 ruling:** a departed member's participation in *past* episodes is
> immutable history and their co-participants keep recall of it — they were
> there. What changes is **proactive eligibility**: once
> `vy_group_member.left_at is not null`, rows whose citing episodes have that
> person as the sole non-Meera speaker lose `mp.bridge` eligibility. She will
> answer if asked by someone who was present; she will not raise it herself
> when the person is no longer in the room to be asked.

One clause, in the `mp.bridge` retrieval only:

```sql
and not exists (
  select 1 from vy_group_member gm
   where gm.group_id = $3 and gm.left_at is not null
     and gm.person_id = f.person_id)
```

**Ruling B — forget deadlock is correct and must be pre-disclosed**
(failure mode 5). A shared episode persists until N−1 participants have
withdrawn. This is right — nobody should unilaterally erase someone else's
memory — and it *will* read as a broken promise to someone who asked her to
forget and later finds she still knows.

> **v1 ruling:** the room-consent card (§6.3) states this **before the room's
> first episode is recorded**, and the forget receipt restates it at the
> moment of the partial delete. This closes MULTIPARTY.md §6 reservation 9
> ("the group-consent flow named as an artifact that must exist") — §6.3 is
> that artifact.

### 3.3 `PERSON_TABLES` semantics for shared rows

`api/memory.js:820-845` is the manifest both forget and export read; that
single-source property is the entire reason it exists (`api/memory.js:890-891`
— "a table added to PERSON_TABLES is wiped here with no further code"). Its
entry shape `{table, key, lane}` assumes **exactly one owner per row and a
plain owning column**. Both assumptions break here, in two distinct ways:

**(a) `meera_log` room rows have no owning device.** A room has no device
uuid, and `meera_log.device_id` is `uuid not null`. v1 mints a deterministic
**synthetic room device uuid** (`vy_group.room_device_id`, uuid-v5 over the
Telegram chat id) so the NOT NULL holds and the legacy lane is untouched —
but that uuid appears in nobody's `vy_person_device` mapping, so **a person's
own room turns would survive their own full wipe** under today's manifest.
That is a live data-deletion bug the moment room ingestion runs, and it is
closed by keying `meera_log` on `speaker_person_id` as well.

**(b) shared rows must be withdrawn, not deleted.**

Proposed manifest shape extension — additive, one type definition, zero
behaviour change for existing entries:

```js
// today
{ table: "vy_episode", key: "person_id", lane: "relational" }

// v1: `keys` = OR over plain columns; `shared` = the join-and-withdraw spec
{ table: "meera_log",
  keys: ["device_id", "speaker_person_id"],       // device via mapping, or speaker
  lane: "legacy" },

{ table: "vy_episode",
  key:  "person_id",                              // exclusive rows (1:1)
  lane: "relational",
  shared: {                                       // shared rows (person_id is null)
    via:      "vy_episode_participant",
    on:       "episode_id",
    person:   "person_id",
    withdraw: "delete_join_row",                  // never delete the episode
    lastOut:  "delete_row",                       // unless P was the last one
  } },

{ table: "vy_phrase",  key: "person_id", lane: "relational",
  shared: { via: "vy_episode_participant", on: "origin_episode", … } },
{ table: "vy_group_member",     key: "person_id", lane: "relational",
  shared: { withdraw: "set_left_at" } },
{ table: "vy_disclosure_grant", keys: ["granted_by", "granted_to"], lane: "relational",
  shared: { withdraw: "by_role" } },              // grantor→delete, grantee→remove
{ table: "vy_tg_person",        key: "person_id", lane: "person" },
```

Because forget and export both read this manifest, **one entry keeps both
consumers in sync by construction.** Export gains nothing else: "A's export
must not carry B's private facts" is satisfied the same way disclosure is
everywhere else — A's export is itself a disclosure-filtered query with
`R = {A}`. No separate redaction step.

**Left open, flagged not answered** (MULTIPARTY.md open question 10): does
A's export include B's verbatim authored turns from a shared room? A
legitimately received them in real time; they are also B's content. This is
a DPDP joint-controller question needing legal input. *Default
recommendation carried forward unchanged:* include them (Telegram itself
shows A the same transcript), exclude anything she derived privately about B
that was never said in the room.

### 3.4 The receipt

Distinct copy is not optional. Both strings are **app-voiced deterministic
text sent after the transaction commits** (SPEC §9.1) — not prompt text,
therefore not a `recited-prompt` surface, and shape-linted only for register.

- 1:1, unchanged: the existing receipt.
- room, partial: a receipt that names what was deleted (your turns, your
  place in the memory) and what was not (theirs), in her register, without
  apology and without a promise it cannot keep.

*Detection:* a copy audit comparing the room receipt string against the 1:1
one is a CI assertion, not a review habit.

---

## 4. Schema deltas — migration 008

All additive and idempotent per SPEC §2.1, except one constraint loosening
(`vy_episode.person_id` NOT NULL → nullable), which is additive-safe because
loosening cannot break rows that already satisfy it. Index naming carries the
`_ix` suffix (the measured `meera_tel_session` namespace trap). No FK on
lineage columns. No `deleted_at` anywhere.

### 4.1 008a — speaker attribution and participants

```sql
-- THE BLOCKING GAP (MULTIPARTY.md §6.1, highest-severity reservation).
-- meera_log is keyed by device_id with no per-speaker column
-- (db/schema.sql:39-47). Without this, "delete my turns, leave theirs and
-- hers" is not implementable at row level, and §3.3(a) is an open data-
-- deletion bug. UNBACKFILLABLE — the information is never captured otherwise.
alter table meera_log add column if not exists speaker_person_id uuid;
alter table meera_log add column if not exists group_id bigint;
create index if not exists meera_log_speaker_ix
  on meera_log (speaker_person_id, id);
create index if not exists meera_log_group_ix
  on meera_log (group_id, id) where group_id is not null;

-- episodes become participant-scoped
alter table vy_episode alter column person_id drop not null;  -- primary/reporting
alter table vy_episode add column if not exists group_id bigint;
alter table vy_episode add column if not exists disclosure_scope text
  not null default 'participants'
  check (disclosure_scope in ('participants','participants_1to1','private'));
alter table vy_episode add column if not exists disclosure_deny uuid[]
  not null default '{}';

alter table vy_episode drop constraint if exists vy_episode_participation_check;
alter table vy_episode add constraint vy_episode_participation_check
  check (participation in ('we','user','meera','group'));

create table if not exists vy_episode_participant (
  episode_id bigint not null references vy_episode(id) on delete cascade,
  person_id  uuid   not null,
  role       text   not null default 'participant',
             -- participant | addressed | silent_present
  primary key (episode_id, person_id)
);
create index if not exists vy_episode_participant_person_ix
  on vy_episode_participant (person_id, episode_id);

-- backfill: every existing 1:1 episode gets exactly one participant row
insert into vy_episode_participant (episode_id, person_id)
  select id, person_id from vy_episode where person_id is not null
  on conflict do nothing;
```

*Join table, not an array column:* the filter must be index-backed in both
directions — "who was at this episode" (compile-time ACL) and "which
episodes was this person at" (forget/export). `on delete cascade` is not
expressible on a bare array, and participant withdrawal is a row delete.

### 4.2 008b — rooms, grants, turn log

```sql
create table if not exists vy_group (
  id             bigint generated always as identity primary key,
  name           text not null default '',
  kind           text not null default 'friend_group'
                 check (kind in ('couple','family','friend_group','other')),
  room_device_id uuid not null,          -- synthetic; keeps meera_log NOT NULL
  tg_chat_id     bigint,                 -- Telegram binding (§6)
  read_consent_at timestamptz,           -- admin promotion observed (§6.2)
  quiet_level    text not null default 'normal'
                 check (quiet_level in ('normal','quiet','silent')),
  member_cap     smallint not null default 6,
  created_at     timestamptz not null default now()
);
create unique index if not exists vy_group_tg_chat_ix
  on vy_group (tg_chat_id) where tg_chat_id is not null;

create table if not exists vy_group_member (
  group_id    bigint not null references vy_group(id) on delete cascade,
  person_id   uuid   not null,
  tg_user_id  bigint,
  role        text   not null default '',
  quiet_level text   not null default 'normal'
              check (quiet_level in ('normal','quiet','silent')),
  linked_at   timestamptz,               -- null = seen but not onboarded (§6.4)
  joined_at   timestamptz not null default now(),
  left_at     timestamptz,               -- null = currently active
  primary key (group_id, person_id)
);
create index if not exists vy_group_member_person_ix
  on vy_group_member (person_id) where left_at is null;

-- CPM made literal: permission is NEGOTIATED and CITED, never inferred at read
create table if not exists vy_disclosure_grant (
  id           bigint generated always as identity primary key,
  subject_kind text not null
               check (subject_kind in ('fact','episode','phrase')),
  subject_id   bigint not null,
  granted_by   uuid not null,            -- whose information it is
  granted_to   uuid not null,            -- who may receive it
  group_id     bigint,                   -- v1: grants fire INTO a room only
  act          text not null default 'gist'
               check (act in ('gist','paraphrase','verbatim')),
  citations    bigint[] not null,        -- the episode where consent was given
  t_invalid    timestamptz,
  created_at   timestamptz not null default now(),
  constraint vy_grant_cited check (cardinality(citations) >= 1)
);
create index if not exists vy_grant_subject_ix
  on vy_disclosure_grant (subject_kind, subject_id) where t_invalid is null;
create index if not exists vy_grant_to_ix
  on vy_disclosure_grant (granted_to) where t_invalid is null;

-- turn-level action log: silence must be an event, not an absence
create table if not exists vy_group_turn (
  id         bigint generated always as identity primary key,
  group_id   bigint not null references vy_group(id) on delete cascade,
  episode_id bigint references vy_episode(id) on delete set null,
  log_id     bigint,
  action     text not null check (action in ('lurk','react','speak','bridge')),
  addressed  boolean not null default false,
  reason     text not null default '',   -- telegraphic, shape-linted
  at         timestamptz not null default now()
);
create index if not exists vy_group_turn_group_ix
  on vy_group_turn (group_id, at desc);

-- retrieval hints (NEVER the security boundary — membership changes,
-- episode-time participation cannot)
alter table vy_fact   add column if not exists group_id bigint;
alter table vy_phrase add column if not exists group_id bigint;
create index if not exists vy_fact_group_ix
  on vy_fact (group_id, need_p desc)
  where group_id is not null and t_invalid is null and retracted_at is null;
```

### 4.3 008c — Telegram identity and the paying unit

```sql
create table if not exists vy_tg_person (
  tg_user_id bigint primary key,
  person_id  uuid   not null,
  username   text   not null default '',
  linked_at  timestamptz not null default now()
);
create index if not exists vy_tg_person_person_ix on vy_tg_person (person_id);

create table if not exists vy_group_entitlement (
  group_id      bigint not null references vy_group(id) on delete cascade,
  paid_by       uuid   not null,          -- a member, not the room (§6.6)
  provider      text   not null default 'tg_stars',
  charge_id     text   not null default '',
  period_start  timestamptz not null default now(),
  period_end    timestamptz not null,
  primary key (group_id, period_start)
);
```

### 4.4 Explicitly NOT in v1's schema

`vy_person_edge`, `vy_dyad_event`, `vy_dyad_state` — the person graph and the
dyadic WE-store from MULTIPARTY.md §3.2. **Deliberately deferred.** They are
pure-additive migrations that cost the same later as now (§6 of the research
says so itself), they carry the sweep's own label "a design bet with zero
production evidence", and — decisively — **no moment in §1 needs them**. A
qualitative edge between two members ("A resents B") is the betrayal-engine
surface in its purest form. v1 does not create the table it could leak from.

---

## 5. The compiler — recipient sets and the multiparty blocks

### 5.1 Entry signature

`compile()` gains a recipient descriptor as a first-class input (MULTIPARTY.md
§6.3 reservation):

```ts
recipient: { persons: string[]; room: number | null; channel: "1to1" | "group" }
```

and the batched T2–T7 person predicate becomes `= any($1)` over a uuid array
even in the 1:1 product with a one-element array (reservation 4 — retrofitting
set-membership into a hand-tuned union-all *after* its p50 has been measured
is the most expensive kind of rework).

**Gate G1, non-negotiable, mirroring `phase-c-complete`'s 83/83
byte-identity property:** for a person with no room membership,
`compile({persons:[p], room:null, channel:"1to1"})` produces output
**byte-identical** to today's. The multiparty layer must be provably free
until a room exists. Asserted by hash over the eval corpus, in CI.

### 5.2 The blocks — what goes in the 2,000 chars

Two new blocks at a new insertion point after T6 (`we.callbacks`), not a
collision with T8 `taste.rows` (§0.2). They are **mutually exclusive with T2
by channel**, which is what keeps the arithmetic cheap.

| pos | block | budget | drop prio | channel | content |
|---|---|---|---|---|---|
| new, after T6 | `mp.roster` | **900** | **never** | group only | the address strip: for each of ≤6 active members — display name, honorific band (`tu`/`tum`/`aap` from `vy_rel_state`), relative rank vs. the others, quiet level, and whether they are linked. Telegraphic k:v, ~150 chars/member. This is R6's answer and it is undroppable because dropping it means addressing an elder wrongly in front of the family |
| new, after `mp.roster` | `mp.bridge` | **1,100** | **1** (first dropped) | both | ≤2 disclosure-filtered cross-person rows **as shapes, never lines**; ≤2 room phrase-ledger hits; ≤1 open room plan row. Every row has already passed §2.3 in the WHERE clause — this block renders, it never decides |

In a group channel **T2 `rel.snapshot` renders empty** (there is no single
dyad to snapshot; the per-member state is in `mp.roster`). In a 1:1 channel
`mp.roster` renders empty and T2 is exactly as today.

**Arithmetic, as numbers per house standard.** Tail today 17,400 / cap
24,000. 1:1 worst case: 17,400 + 1,100 = **18,500** (headroom 5,500). Group
worst case: 17,400 − 1,200 (T2 empty) + 900 + 1,100 = **18,200** (headroom
5,800). Undroppable set: 42,600 + 900 = **43,500 actual** (44,600 + 900 =
45,500 at cap) — both strictly under core 40,000 + tail 24,000 = 64,000 =
SYSTEM_MAX. Drop priorities renumber by one below `mp.bridge`: T7 herlife
1→2, T5 2→3, T6 3→4, T3 4→5, T4 5→6, T2 6→7. **T10 stays PINNED LAST and
stays capped at exactly two rules.** All of this is asserted in
`scripts/check-prompt-budget.mjs` as numbers, with a forced-overflow fixture
proving the declared drop order actually executes — and a new group-shaped
fixture dyad added to the existing six.

**What must never enter `mp.bridge`:** a quoted line; a row with
`sensitive=true`; a row with a negatively-valenced `affect_tags` entry; a row
from another room; a row whose grant is absent or `t_invalid`; a row whose
sole non-Meera speaker has left the room (§3.2 ruling A). Each is a WHERE
clause in §2.3, not a bullet in the prompt.

### 5.3 The participation decision

Adopted from MULTIPARTY.md §2.3, with its evidence grading intact:

- **Stage 0, hard gate (well-supported):** explicit address — name mention,
  `@meera`, reply-to her message — always routes to a full response. **Do
  not build implicit-addressee inference.** GPT-4o scores 80.9% against a
  majority-class chance baseline of 80.1% (arXiv:2501.16643, confirmed); only
  80/322 real turns carry an explicit addressee at all. Everything else is
  content-relevance scoring, never addressee inference.
- **Stage 1, the bet:** a dedicated speak/stay-quiet score before generation,
  using Inner Thoughts' criteria vocabulary as a starting point. **Logged as
  an engineering bet, not a finding** (§0.3). Every evaluation writes a
  `vy_group_turn` row so Stage 1 gets measured rather than believed.
- **Stage 2:** elapsed silence *never* lowers the bar. "Nobody has typed in
  five minutes" is not a reason to speak; "someone asked her something and
  never got an answer" is. Direct carry of the killed idle nudge
  (`persona.ts:470-477`).
- **Stage 3:** four actions — lurk / react / speak / bridge. `react` is
  implementable on Telegram (`setMessageReaction`) and is a genuinely
  unverified tier — no study tests whether reaction-only AI presence reads
  better than reply-only or silence-only. Ship it, log it, measure it.
  `bridge` carries the stricter gate of §2.3.
- **Stage 4:** per-room and per-member quieting from day one
  (`vy_group.quiet_level`, `vy_group_member.quiet_level`) — the Meta AI
  backlash named the *missing control*, not the replies, and the Indian
  family-group norm is explicitly mute-before-leave.

### 5.4 Group episodes are recall-eligible but **state-inert** in v1

A deliberate, structural scope cut with a one-line enforcement:

> Room turns write `vy_episode`, `vy_fact` (non-sensitive), and `vy_phrase`.
> They write **no** `vy_rel_event`, **no** `vy_rel_state` movement, **no**
> `vy_pattern`, **no** `vy_taste_candidate`, **no** `vy_currency`, **no**
> `vy_india_profile` field.

*Why:* trust, honorific and code-switch ratio are dyadic dimensions
calibrated on 1:1 evidence (`vy_rel_state`, SPEC §6.2). Whether a person's
group register even *predicts* their 1:1 register is MULTIPARTY.md open
question 12 — unscoped, unmeasured, no literature found. Letting an
unmeasured channel move the state layer that the shipped 1:1 product depends
on risks damaging the thing that already works. `where group_id is null` on
the rel-event writer is the entire implementation.

*Reverses if:* the pilot shows her room register is systematically wrong for
a member in a way 1:1 evidence alone cannot fix.

---

## 6. The Telegram surface

Verified against the live Bot API on 2026-08-18: **Bot API 10.2, 14 July
2026** (core.telegram.org/bots/api). The research's Telegram section
(`whatsapp-platform.md` §5) is secondary-sourced; the following is primary
except where marked.

### 6.1 What the platform gives us

| capability | status | why it matters |
|---|---|---|
| a bot can be added to a **group users already have** | yes, by any member permitted to add members | the decisive property WhatsApp denies third parties; it is the entire reason for `group-distribution`'s Telegram fallback |
| one-tap add: `t.me/<bot>?startgroup=<payload>`, payload → `/start@bot <payload>` | yes, primary docs | ≤64 chars, `A-Za-z0-9_-` — carries our onboarding token |
| `&admin=<rights>` to request admin in the same dialog | yes, but **buggy across clients** (multiple open tdesktop issues; parameters sometimes not delivered) | needs a fallback path, §6.2 |
| reading all room messages | **only if she is an admin** — privacy mode is on by default and admins bypass it | this is the consent artifact, §6.2 |
| `message_thread_id` / forum topics | yes | not used in v1 (§7) |
| `setMessageReaction` | yes | makes the `react` tier real |
| `my_chat_member` update (added/removed/promoted) | yes, delivered by default | drives room lifecycle |
| `chat_member` update (member joins/leaves) | **requires bot admin AND explicit `allowed_updates`**; reliability issues reported | roster maintenance needs a reconcile sweep, not just events |
| per-message cost | **zero** | vs. WhatsApp's ≈₹630/month/group at 20 turns/day billed per recipient |
| group size | far above our cap | irrelevant — we cap at 6 (§7) |
| Telegram Stars subscriptions (`XTR`) | yes; `subscription_period` **must be 2592000** (30 days), price ≤10,000 Stars | the paying-unit rail, §6.6 |

### 6.2 The admin bit *is* the room's read consent

Privacy mode is enabled by default for all bots and restricts them to
commands, replies and mentions; **bots added as admins receive all
messages**. Two ways to get full traffic: disable privacy mode globally in
BotFather, or promote her per room.

> **v1 decision: privacy mode stays ON globally; she is promoted per room.**

*Why this is the better trade.* Global disable means she reads every message
in every group she is ever added to, forever, which is exactly the
over-collection pattern "Bots can Snoop" measures (MULTIPARTY.md §2.3,
adjacent risk). Per-room promotion is a deliberate, visible act by a room
admin — a consent artifact Telegram gives us for free — and **demotion is
instant, total, user-controlled revocation** with no code path of ours
involved. The cost is one extra tap in onboarding. `vy_group.read_consent_at`
records the `my_chat_member` promotion event; ingestion is gated on it being
non-null.

*Flagged as needing a live probe, not reasoning:* the docs phrase the
exemption as bots *"added to a group as admins"*. Whether **promotion after
addition** clears privacy mode for that chat must be verified against a real
bot before onboarding copy is written — measure, don't assume. If it does
not, the flow becomes add-as-admin in one step via `&admin=`, with the
known client bugs as the risk.

### 6.3 Onboarding a room in under two minutes

1. **(0:00–0:20)** An admin taps a share card / landing link:
   `t.me/MeeraBot?startgroup=r<token>&admin=delete_messages`. Telegram shows
   the group picker and the permission dialog. One confirm.
2. **(0:20–0:35)** `my_chat_member` fires. She creates `vy_group` (with a
   synthetic `room_device_id`), records `read_consent_at`, and posts **the
   room card**: an app-voiced deterministic string, not model-generated,
   stating in plain Hinglish (a) that she talks to members 1:1 too (R4,
   §2.6), (b) that DM contents never come into the room, (c) that room
   memory is shared and **that a shared memory only fully disappears when
   everyone in it asks** (§3.2 ruling B — pre-disclosed *before* the first
   episode is recorded), (d) how to make her quiet, (e) how to make her
   forget. This card **is** MULTIPARTY.md §6 reservation 9's missing
   artifact.
3. **(0:35–2:00)** The card carries one inline button per unlinked member:
   **`mujhse baat karo`** → `t.me/MeeraBot?start=r<token>` in their DM. The
   tap is load-bearing, not cosmetic: **a Telegram bot cannot initiate a
   conversation with a user who has never started it** (`Forbidden: bot
   can't initiate conversation with a user`). The tap simultaneously (a)
   opens the 1:1 channel that makes M2/M4/M6 possible, (b) binds
   `tg_user_id → person_id` in `vy_tg_person`, (c) runs the adult gate, (d)
   sets `vy_group_member.linked_at`.
4. **Quorum.** She begins ingesting the room at **≥2 linked members**. Below
   quorum she is present, polite, and remembers nothing.

Admin path: ~35 seconds. Each member: ~15 seconds. **Under two minutes for a
four-person room** if members are present; asynchronous otherwise.

### 6.4 No person row, no persistence

> Messages from a room member who has not linked are **never written** — not
> to `meera_log`, not to any episode, never cited, never in an ACL. They exist
> in the live turn window (everyone in the room can see them anyway) and
> nowhere else.

Three things this buys, each otherwise expensive: the ACL has no unattributed
rows by construction; the adult gate (`adult-default`) is enforced
structurally rather than by policy; and the "Bots can Snoop" over-collection
risk is answered with a storage rule rather than a promise. It also creates
honest onboarding pressure — she genuinely cannot remember what she cannot
attribute, and she can say so.

### 6.5 The 1:1 + group duality

One bot, two channel types, one person identity:

- `chat.type = 'private'` → 1:1 channel, `recipient = {persons:[P],
  room:null}`. Byte-identical to today's product (gate G1).
- `chat.type in ('group','supergroup')` → room channel,
  `recipient = {persons: <active linked members>, room:<id>}`.
- `vy_tg_person` is the single binding. A person in three rooms is one
  `vy_person` row with three `vy_group_member` rows and one DM channel — and
  §2.3 clause 4 is what stops those three worlds touching.
- **Existing web/APK users:** `vy_person_device` already maps devices to
  persons; a signed-in web user linking Telegram merges via account evidence
  only, never heuristics (SPEC §2.1 — "a wrong merge is a privacy defect").

### 6.6 The group as the paying unit

Hook points, not a pricing decision:

- `vy_group_entitlement` gates **room ingestion and room replies**, never
  anyone's 1:1 relationship. If the room lapses she goes quiet in the room;
  nobody loses their own companion. Downgrade must never read as hostage-
  taking (NEVER MANIPULATE applies to the business model too).
- Telegram Stars is the rail: `XTR`, 30-day period (the only period the API
  allows), ≤10,000 Stars. Because Telegram has no room wallet, **one member
  pays and the room stays alive for everyone** — which is precisely the
  amortisation `relational-wedge` item 4 is after (₹2,260/mo heavy user vs.
  pooled willingness-to-pay).
- The payment tap is the *same* deep-link mechanic as onboarding and consent:
  an in-room button that resolves into the payer's DM (the bot cannot invoice
  a user it has never met). **One mechanic, three jobs.**
- Free trial is per-room and time-boxed, so the paying decision arrives after
  the room has its own memory — the thing being bought is legible.

---

## 7. What v1 does NOT do

| non-goal | reason |
|---|---|
| **No voice or calls in rooms** | Speaker attribution is the foundation of the ACL, and `context/rejected.md#speaker-id` is a *measured* rejection: real speaker ID needs an embedding model in the barge-in path, and a 95%-accurate gate converts a reliable floor into an unreliable one. Unattributable audio cannot be written under §6.4. Text rooms only. |
| **No photos or media ingestion in rooms** | `vision-fab` measured fabrication on real screenshots; `visiongate-powered` shows fabrication *not detectably* raised, which is not the same as zero. A fabricated visual claim in a DM is embarrassing; in a room it is a claim *about a person, in front of their people*. |
| **No proactive bridging (the BRIDGEABLE tier)** | Unmeasured anywhere. Every benchmark in the sweep measures passive leak/no-leak; nothing tests a system *proactively* surfacing A's information to B, and a positive decision to speak is strictly harder than restraint (MULTIPARTY.md §1.3, open question 3). Ships behind an owner-signed flag, OFF. |
| **No DM→DM carry, with or without a grant** | Same reason, plus §2.2: v1's value does not need it. |
| **No cross-room memory** | "Bots can Snoop" 3.6% cross-linking; and the failure is unrecoverable — you cannot un-tell a family group what the college group said. |
| **Rooms capped at 6 linked members** | Falls out of the budget: `mp.roster` is 900 chars and a telegraphic per-member snapshot is ~150. Independently supported: WhatsApp groups skew small (mean 9 / median 6). Above 6 she stays but goes read-only-and-quiet rather than degrading her register. |
| **No person graph, no dyad WE-store** | §4.4 — zero production evidence, pure betrayal-engine surface, no §1 moment needs them. |
| **No group state writes** | §5.4 — an unmeasured channel must not move the state layer the 1:1 product depends on. |
| **No forum topics / threads** | `message_thread_id` exists; multi-thread ACL semantics are a second privacy surface for no v1 value. |
| **No unprompted room messages except REASON-contingent** | The killed idle nudge, `persona.ts:470-477`. A quiet room is not a reason. |
| **No WhatsApp** | `group-distribution` + MULTIPARTY.md §4: joining a user's existing group is first-party-only; the official Groups API is her-own-room-only, ≤8, no voice, per-recipient billing, an unresolved eligibility gate, and the free service window closes 1 Oct 2026. The unofficial route risks a real user's real phone number, which for a trust product is close to the worst possible failure. |
| **No minors, no unverified members** | `adult-default`, enforced structurally by §6.4. |
| **No new appended-last rules** | T10 stays capped at exactly two. Position is a scarce resource. |

---

## 8. The riskiest assumption, and the cheapest test

### 8.1 Naming the bet

`relational-wedge` reverses if "the multiparty pilot shows groups do NOT
retain better than 1:1." That is the wedge's core assumption and it is the
riskiest thing in this document. Two nearer risks gate it:

- **R-A (product):** users may not want a companion that knows their
  friends. `disclosure-control.md` §3 finds the transferred default
  expectation is a "socially contained partner" — silence, not discretion
  (n=15, qualitative, 1:1-only, authors confirm they never probed group
  scenarios). §2.2's scope cut is designed so v1 never invokes this, but it
  is not proof.
- **R-B (engineering):** the SQL filter may not deliver on our own model what
  prompting cannot. MULTIPARTY.md open question 1 calls this *"the cheapest
  experiment in the whole plan"* and says to run it before Phase D scoping.

### 8.2 Gate 0 — the offline fixture A/B (run this first, before any user)

One fixed set of group-episode fixtures, two arms through the **real
compiler**: prompt-only disclosure instruction vs. §2.3's SQL-filtered
retrieval. Metric: the fraction of A's compiled context *and* replies that
reference material originating in a B-only episode.

- **Pre-registered prediction** from the literature: SQL arm **<5%**;
  prompt arm **20–90%**.
- **Pass bar: 0 ACL violations in compiled context**, at n≥300 replayed
  turns, matching the D3 deck's existing state-vocabulary-leakage row and
  the house's n≥300 charm-parity standard. Context violations are audited at
  100%, not sampled (§2.3's asymmetry).
- Cost: no new users, no new judges, one harness on the existing `evals/`
  replay path. **A single violation blocks the pilot.**
- Secondary, also required before the pilot: the participant join measured
  against the p50 ≤250 ms retrieval budget on a group-shaped fixture. Today
  this is a claim; SPEC's own standard is that estimates become measurements
  or the gate does not close.

### 8.3 The pilot — "Ten Days, Three Rooms"

Cohort: the owner's own friend groups. **n = 3 rooms, 4–6 members each,
10 days, Telegram, free.** Every member verified adult and personally known.

**Pre-registered, before the first room is created:**

| axis | metric | bar |
|---|---|---|
| **instant value** | **time-to-first-acknowledged-room-memory**: elapsed time from quorum to the first turn where she references something a *different* member said earlier in the room AND a human replies or reacts within 2 minutes | **< 48 h in ≥ 2 of 3 rooms** |
| **retention (the wedge test)** | per-person **active-days in-room** vs. **the same person's active-days in their own 1:1 channel** over the same 10 days — within-subject, each person is their own control | median in-room ≥ median 1:1 |
| **room survival** | rooms with ≥1 human message on ≥7 of 10 days | ≥ 2 of 3 |
| **safety** | disclosure-ACL violations, 100% replay audit of every compiled context | **0. One violation halts the pilot.** |
| **restraint** | `vy_group_turn` action mix; unprompted-speak rate | reported, not targeted — the first measurement of Stage 1's bet (§5.3) |
| **the R-A probe** | exit interview, one question per member, asked identically: what did it feel like that she knows the others | reported verbatim, coded |

**Why within-subject is the whole design.** n=3 rooms cannot power a
between-groups retention claim and this proposal will not pretend otherwise.
Comparing each person's room activity against their own 1:1 activity over
the same window removes the confounds that would otherwise eat a sample this
small, and it is the exact comparison `relational-wedge`'s reversal
condition asks about. **The pilot is powered to detect a catastrophe (rooms
die by day 3) and a blowout (rooms out-engage 1:1 by >2×), not a subtle
difference.** Stated up front so the result is not over-read later.

**Decision rule, pre-registered:**
- Instant-value bar met + retention bar met → build. Log a `measurements.md`
  entry with n, method, date.
- Instant-value met, retention not → the wedge's distribution premise is
  wrong but the product is not. Log as a rejection with the specific
  breakage; do not silently re-run.
- Instant-value missed → §2.2's scope cut is too conservative *or* the
  premise is wrong. The BRIDGEABLE flag becomes the next experiment, not the
  next feature.
- Any ACL violation → design-falsifying, ship-blocking, not tunable (the
  same standing this repo already gives forget-probe recovery, SPEC §9.1.7).

**Cost:** Telegram is free per message; model cost is ordinary chat cost;
no judges, no grant burn. This is the cheapest experiment that can answer the
company's re-rank question.

---

## 9. Build plan and file ownership

New workstream **WS-MP**, under SPEC §13's collision contract (every file has
exactly one owning workstream; cross-workstream needs are interface tickets,
never edits).

| owns exclusively | interface tickets it must raise |
|---|---|
| `api/telegram.js` (webhook, room lifecycle, consent cards, Stars) · `src/engine/room.ts` (recipient sets, participation decision, roster render) · `db/migrations/008*.sql` · `evals/mp/*` · `docs/design/PROPOSAL-MULTIPARTY-V1.md` | **WS-COMPILER**: recipient descriptor in `compile()`, `mp.roster`/`mp.bridge` blocks, drop-order renumber, budget assertions + group fixture (`src/engine/compiler.ts`, `scripts/check-prompt-budget.mjs`, `api/chat.js`, `src/engine/brain.ts`) · **WS-SCHEMA**: `PERSON_TABLES` shape extension + withdraw semantics + `meera_log.speaker_person_id` in the forget cascade (`api/memory.js`, `api/export.js`) · **WS-CONSOLIDATE**: participant-set write path, citation-homogeneity 100% audit, `where group_id is null` on state writers · **WS-SAFETY**: the second fact on the app-voiced disclosure rail (R4) · **WS-BATTERY**: the cross-participant-leakage row + group-episode fixture format |

**Order, and the one thing that must land first:** `meera_log.speaker_person_id`
is **unbackfillable**. If a single room message is ingested without it, that
row is permanently unattributable and row-level forget is impossible for it
forever. It is one nullable column and an index. It lands before any
ingestion code is written, not after.

**Gates (all must be green, in order):**

1. **G1** — byte-identity: no-room persons compile identically to today
   (§5.1), hashed over the eval corpus.
2. **G2** — Gate 0's fixture A/B: 0 ACL violations in compiled context at
   n≥300; prompt-arm number recorded as the contrast (§8.2).
3. **G3** — forget-then-probe extended to shared rows: withdraw leaves the
   room's memory intact for the others, removes it for P, and the last
   participant's withdrawal hard-deletes the closure; zero-orphan sweep
   green; export round-trips a room fixture person.
4. **G4** — budget battery with the group fixture: every block in budget,
   helplines present in C2, T10 last, declared drop order executing under
   forced overflow.
5. **G5** — 138 invariants + 14 parse cases green on the room path,
   unchanged and unweakened.
6. **G6** — participant join measured against p50 ≤250 ms; the number lands
   in `measurements.md` with n, method, date, or the gate does not close.

---

## 10. Open questions carried forward, unclosed

Named so they are not mistaken for solved. Numbers refer to MULTIPARTY.md §8.

1. **(3)** Is active bridging safe at all? Unmeasured. v1 answers by not
   shipping it; the answer is a deferral, not a finding.
2. **(5)** Does `react` read as more acceptable presence than reply or
   silence? Genuinely untested. v1 ships it logged.
3. **(8)** How does the compiler hold several honorific registers in one
   group turn? §5.2's roster strip + the ≤6 cap is a bet, and needs a
   Hinglish calibration set on the pattern the shape-lint already required.
4. **(10)** Does A's export include B's verbatim room turns? Legal, not
   schematic. Default recommendation in §3.3.
5. **(11)** How much raw room traffic must the participation engine see?
   §6.2 and §6.4 narrow it structurally; they do not close it.
6. **(12)** Does she need a distinct group register at all? No literature
   found. §5.4 quarantines the risk rather than answering it.
7. **(13)** Is Shapes actually building this? "No *published* mechanism" is
   not "nobody is building it." A docs pass is owed before any external
   white-space claim.
8. Whether **promotion-after-addition** clears Telegram privacy mode (§6.2) —
   a live probe, not a reasoning exercise.

## 11. What would falsify this design

- Any disclosure-ACL violation in a compiled context, ever — not tunable,
  ship-blocking (§8.3).
- The Gate 0 SQL arm landing materially above 5%: then structural exclusion
  does not transfer to our stack and §2 needs rebuilding before anything
  ships.
- The participant join blowing the p50 ≤250 ms budget with no cache that is
  honest: then the batched round trip is the wrong shape, not the predicate.
- Rooms retaining no better than 1:1 in the pilot: `relational-wedge`'s own
  named reversal condition fires.
- A lab shipping cross-person shared memory with real privacy walls:
  `relational-wedge`'s second reversal condition. Watch Meta and OpenAI, who
  both today *deliberately* wall memory off from group spaces — "personal
  ChatGPT memory is not used in group chats"; "Memory additions will only
  take place in 1-on-1 chats" — which is the strongest available evidence
  that this is unclaimed opportunity rather than priced-in hazard.
