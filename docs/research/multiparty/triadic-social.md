# Track: triadic-social — the social science of the common friend

Scope: Simmel's triads, gossip norms and pro-social function, mutual-friend
disclosure etiquette, relational maintenance across a network, India-specific
group dynamics (family WhatsApp as institution, kin hierarchy in group
speech, couple dynamics around a shared confidant). House style: every claim
sourced; thin evidence flagged; primary over secondary.

Grounding read: `context/decisions.md#multiparty-direction` (one AI as
common friend to a group: 1:1 with each member, judged references between
members, presence in the group space; the research core is **disclosure
control** — "what may she tell A about B"); `docs/SPEC.md` §6 (WE-store:
`vy_rel_event`, `vy_pattern`, `vy_phrase`, all citation-gated) and the
person/episode/citation schema generally (episodes are participant-scoped,
facts carry `citations bigint[]`, provenance is typed).

---

## 1. What structurally changes when a third person enters — Simmel

**Georg Simmel, "The Sociology of Georg Simmel" (Wolff trans., 1950),
"Quantitative Aspects of the Group" — the dyad/triad distinction.** Primary
argument, corroborated across two independent secondary renderings
(Wikipedia's *Triad (sociology)*; Duke sociology theory notes,
people.duke.edu/~jmoody77, a graduate methods course page paraphrasing the
primary text at length):

- **The dyad is uniquely fragile and uniquely intimate.** Each member is
  irreplaceable — either one leaving ends the relationship, which is why
  dyads cannot delegate to an impersonal structure and why "the peculiar
  color of intimacy" (what is shown to this one person and nobody else)
  exists only there.
- **A third person converts a personal bond into a supra-individual
  structure.** The group now survives any one member's exit; it can
  delegate, and it acquires the possibility of a 2-against-1 coalition that
  did not exist in the dyad. This is a structural claim, not a claim about
  feelings — it is what "the group has a life independent of me" means.
- **Three roles a third party can occupy, ranked by how much the third
  actively shapes the outcome:**
  1. **Non-partisan mediator** — neutral, "deprives claims of their
     affective qualities" by re-stating them without the heat.
  2. ***Tertius gaudens*** ("the third who rejoices") — benefits from the
     other two's friction, either passively (they hold each other in check
     and the third profits without acting) or actively (the third plays one
     against the other). Simmel's own qualifier, worth keeping precise: the
     tertius's power need not be great — it scales with how much the other
     two already have riding against each other, not with the third's own
     strength.
  3. ***Divide et impera*** ("divide and rule") — the third *creates* the
     rift, then manages the resulting tension for advantage. This is the
     only one of the three that is inherently adversarial to the pair.

**Direct load-bearing translation for a common-friend AI:** a mutual friend
sits, structurally, in the tertius position by default the moment she has
a private channel with each of two people who also relate to each other.
Simmel's ranking is a straight taxonomy of *how she can fail*: divide et
impera is betrayal (actively engineering rifts — this is `NEVER MANIPULATE`
territory already in the persona invariants, now applied at the group
level); passive tertius gaudens is a softer failure (benefiting from
friction she didn't cause but also didn't help resolve — e.g., staying the
"better listener" than either partner is to the other, see §7); the
mediator role is the only one that is unambiguously prosocial, and it
requires *active* neutral restatement, not just silence. A design that
wants to be a good mutual friend is choosing, structurally, to be the
mediator and refusing the other two roles — this needs to be a design
decision stated in those terms, not left implicit.

**Confidence:** high on the primary Simmel argument (independently
corroborated by two paraphrases of the same 1908/1950 text, internally
consistent, and it is foundational sociology cited continuously since); the
application to an AI common-friend is this track's own inference, flagged
as such.

Sources:
https://en.wikipedia.org/wiki/Triad_(sociology) ·
https://people.duke.edu/~jmoody77/TheoryNotes/Simmel_StrangerDyadTriad.htm

---

## 2. Gossip's pro-social function — Dunbar and the reputation-cooperation experiments

**Robin Dunbar, *Grooming, Gossip, and the Evolution of Language* (Harvard
UP, 1996).** Thesis (secondary-sourced summary consistent across multiple
publisher/review pages — the book itself not fetched): language evolved as
a scalable substitute for primate social grooming once group size exceeded
what one-to-one grooming time could bond (~150, "Dunbar's number"). "Gossip"
in Dunbar's sense is not malicious talk specifically — it is *any* social
conversation, and its evolved function is group cohesion: knowing who did
what to whom is how a large group tracks reputation without everyone having
direct experience of everyone else. This is the evolutionary-anthropology
grounding for why relaying social information between people is not an
edge case for a social companion but close to the core evolved function of
talk itself.

**Feinberg, Willer & Schultz, "Gossip and Ostracism Promote Cooperation in
Groups," *Psychological Science* 25(3), 2014 (SAGE, doi:
10.1177/0956797613510184).** Primary-adjacent (fetched via a
science-journalism summary of the published study, ScienceDaily, since the
paywalled SAGE page and an open-access mirror were not fetchable as clean
text; numbers below track the peer-reviewed abstract as reported and are
consistent across the two independent search-result summaries pulled).
Design: 216 participants in a public-goods economic game across sequential
groups; between rounds, members could pass reputational information
("gossip") about a departing member to the incoming group, and incoming
members could use it to exclude known free-riders.

- Groups that could gossip **and** ostracize sustained cooperation better
  than groups that could do neither; gossip alone (no ostracism option)
  already improved outcomes over no-information groups.
- Reputational information was shared *accurately* and used *selectively*
  — recipients steered toward known-cooperative people and away from known
  free-riders, rather than gossip degrading into noise.
- Ostracized/exposed free-riders who were let back into a group
  subsequently **raised their own contribution levels** — reputational
  consequence functioned as correction, not just punishment.
- Mechanism proposed: gossip makes reputation *salient* — both "I might be
  gossiped about" and "I can act on what I hear" — and salience of
  reputation is what drives the prosocial shift, independent of any formal
  enforcement.

**Direct translation:** the finding is not "gossip is fine," it is
specifically that *accurate, selectively-used, reputation-relevant*
information sharing between people who will interact again is a
cooperation-sustaining mechanism, and that this is the ordinary,
experimentally demonstrated function of relaying social information — not
a rare virtue. This is the empirical floor under the owner's "arre, B was
just talking about that" bridging behavior: bridging relevant, accurate,
positively-valenced information between two people who trust the same
mutual party is not a departure from normal good social behavior, it is
what normal good social behavior already does. The failure mode the
literature does NOT license is inaccurate, unselective, or
reputation-damaging relay — none of which appeared as beneficial in this
study; only accurate, socially-calibrated information sharing produced the
cooperative gain.

Sources:
https://www.sciencedaily.com/releases/2014/01/140127193852.htm ·
https://journals.sagepub.com/doi/abs/10.1177/0956797613510184 ·
https://en.wikipedia.org/wiki/Grooming,_Gossip_and_the_Evolution_of_Language

---

## 3. Confidant selection and secrecy — what determines who gets told, and what happens to it after

**Slepian & Kirby, "To Whom Do We Confide Our Secrets?", *Personality and
Social Psychology Bulletin*, 2018 (Columbia, primary PDF located but not
machine-readable — findings below are corroborated via the APS synthesis
plus one independent review-article summary of the same line of work, so
treat as secondary-sourced, not primary-verified).** People are selective
about *which* trait predicts confiding, and the two traits that matter are
not the ones people predict matter:

- People **predict** they will confide in polite people; they actually
  confide more in people rated **compassionate** (non-judgmental, empathic)
  and **assertive** (will push the secret-keeper toward helpful action) —
  politeness was a poor actual predictor despite being the stated
  expectation.
- Being confided in is itself relationship-building: it correlates with
  feeling closer to, and more trusted by, the confider — disclosure is not
  a one-way extraction, the *listening* role has its own bonding payoff.

**Slepian (synthesis), "The New Psychology of Secrecy," *Current Directions
in Psychological Science*, 2024, and the APS "Costs of the Secrets We Keep"
research digest (2024) covering it.** Key distinction for a common-friend
architecture: **confession vs. confiding are different acts with different
risk profiles.** *Confession* = telling the secret to the person it's kept
*from* (relationship-defining, can repair or destroy). *Confiding* = telling
a *neutral third party* (lower stakes, reliably delivers emotional relief,
rarely damages the discloser's relationship with the subject of the
secret) — this is structurally the role a common-friend AI occupies for
each member of a group, and the literature's finding is that this role is
*safe and beneficial by design*, distinct from the mediator/messenger role
where she would be asked to carry information back.

**Salerno & Slepian (cited in the same digest; ~9 studies, not
independently verified beyond this secondary citation), on what happens to
a confided secret afterward:** roughly **a third of secrets people learn
about someone else get passed along to at least one other person**; even
secrets *directly confessed to the confidant* (the highest-stakes case) are
passed on **more than a quarter of the time**. This is the empirical base
rate for "confidants leak" among humans — worth stating precisely because
it sets the bar a design commitment (a fact told to her about B is
categorically never surfaced to a third party, including B, without
provenance-gated permission) must clear to be a genuine differentiator
rather than a marketing claim: ordinary human confidants leak roughly
30% of what they're told, and a mutual-friend AI's entire value proposition
rests on being measurably better than that, at scale, forever — a promise
regular humans do not and structurally cannot keep.

**Sandra Petronio, Communication Privacy Management (CPM) theory,
originally 1991 ("communication boundary management"), synthesized from
Wikipedia's *Communication privacy management theory*, the CPM Center
(Indiana University Indianapolis) theory page, and a Communication Theory
summary — three independent renderings of the same well-established
communication-studies framework, internally consistent.** This is the
single most directly applicable piece of theory in this track for the
disclosure-control mechanism named in `decisions.md#multiparty-direction`:

- People believe they **own** their private information and have a right
  to control it.
- They manage it via personal **privacy rules** (who gets told what, under
  what conditions).
- **Once told, a third party becomes a co-owner** of that information —
  not a passive recipient. Co-ownership carries a *responsibility* to
  continue managing the information according to the discloser's intent,
  not the co-owner's own preference.
- Co-owners are supposed to **negotiate mutually agreeable rules** about
  further telling (permeability, linkage to yet more parties, ownership
  strength).
- When that negotiation doesn't happen, or the rules aren't followed, the
  result is named **boundary turbulence** — CPM's specific term for the
  breach-of-trust event when private information moves further than the
  original discloser sanctioned.

**Direct translation, and this is the single strongest mechanism-level
finding in this track:** CPM gives a common-friend AI a ready-made,
academically load-bearing vocabulary for exactly the mechanism the owner
named as the breakthrough candidate. A fact A tells her about themselves
that concerns B is, per CPM, A's private information; when she "knows" it,
she becomes a **co-owner**, not a free agent — and CPM predicts (and names)
the failure mode precisely: relaying it to B without a negotiated rule is
**boundary turbulence**, i.e., the mechanism by which mutual friends become
betrayal engines, exactly the risk the owner's own decision entry names.
This maps almost directly onto the repo's existing schema instinct
(provenance-gated disclosure, citations carry WHO was present) — CPM is
the academic name for the thing the schema already half-implements, and it
supplies the missing piece: **disclosure rules are supposed to be
negotiated with the discloser, not inferred by the co-owner.** An engine
that infers disclosure permission from context (e.g., "this seems like
something B would want to know") is, per this theory, doing exactly the
thing that produces boundary turbulence in humans.

Sources:
https://www.psychologicalscience.org/news/2024-march-secrets.html ·
https://journals.sagepub.com/doi/10.1177/09637214241226676 ·
https://en.wikipedia.org/wiki/Communication_privacy_management_theory ·
https://cpmcenter.indianapolis.iu.edu/learn/theory

---

## 4. Relational maintenance across a network — Canary & Stafford

**Stafford & Canary (1991), extended in later inductive work — synthesized
from an SDSU undergraduate research review, a Wiley major-reference-work
entry, and a UNCW-hosted PDF of the inductive-analysis paper (three
independent renderings of the same well-cited communication-studies
literature; the core five-strategy taxonomy is stable across all three).**
Five (later expanded to ten) empirically-derived relational maintenance
strategies people use to sustain relationships: **positivity**, **openness**
(directly discussing the relationship), **assurances** (stated
commitment), **social networks**, and **sharing tasks** — with later
inductive work adding joint activities, cards/calls, avoidance, anti-social
behavior, and humor as additional observed categories.

- **"Social networks" is a named, first-class maintenance strategy in its
  own right** — not a side effect of maintaining the dyad, but one of the
  handful of behaviors people actually deploy to keep a relationship
  healthy: involving shared friends and family, doing activities with the
  same people, using the network as a stabilizing resource.
  Positivity showed the strongest link to relationship satisfaction;
  assurances and control-mutuality the strongest link to commitment
  (Stafford & Canary's own finding, corroborated across sources).

**Direct translation:** this is direct, established support for the
product thesis that a shared companion embedded in a person's *network*,
not just their dyad, can be a maintenance mechanism rather than a
distraction from "real" relationships — it slots into an already-named
category of relationship work, the same category as shared friend groups
and family involvement. It also gives a concrete design implication:
maintenance-via-network only helps when it's used the way humans use it —
as a shared resource that stabilizes the couple/family, not as a private
outlet that substitutes for direct engagement (see §7's openness strategy,
which is explicitly about *directly discussing the relationship* — an AI
that becomes the place the discussing happens *instead of* with the
partner is substituting for, not supporting, the openness strategy).

Sources:
https://openprairie.sdstate.edu/cgi/viewcontent.cgi?article=1026&context=jur ·
https://onlinelibrary.wiley.com/doi/10.1002/9781118540190.wbeic248 ·
https://people.uncw.edu/mcdaniela/maintenance.pdf

---

## 5. Brokerage vs. closure — the two competing theories of what a well-placed third party is for

**Ronald Burt, "Structural Holes versus Network Closure as Social
Capital" (in Lin, Cook & Burt eds., 2001) and James Coleman's closure
argument (1988/1990) — synthesized from Burt's own Stanford-hosted PDF
abstract/intro pages and a secondary explainer (Edge Perspectives), two
independent renderings of a well-known, decades-cited network-theory
debate.**

- **Coleman's closure argument:** social capital comes from a *closed*
  network — everyone connected to everyone — because closure lets bad
  behavior be sanctioned (reputational cost) and therefore makes trust
  *safe*. "Reputation cannot arise in an open structure." Closure is the
  mechanism for making it safe to trust people.
- **Burt's brokerage/structural-holes argument:** social capital instead
  comes from occupying the *gap* between two otherwise-unconnected clusters
  — the broker gets earlier information, more diverse information, and
  control over what flows between the two sides they bridge.
- **The two are not actually rivals** — Burt's own synthesis: brokerage
  is what makes it *valuable* to connect people between whom trust would be
  risky; closure is what makes that connection *safe* once made. "Bridging
  a structural hole creates value, but delivering the value requires the
  closed network of a cohesive team around the bridge."

**Direct translation:** this is the theory-level description of exactly
the dual role the owner specified — a common-friend AI is *both* the
broker (she alone connects otherwise-separate 1:1 relationships and has
information neither side has) *and*, once she relays something, part of a
now-more-closed local network (the group). The unresolved tension the
literature flags is real and load-bearing for the architecture: brokerage
power (holding information others don't) is *structurally the same
position* as tertius gaudens (§1) — it is only pro-social when it is used
to *build closure* (bring the group's shared trust up) rather than
*preserve the broker's exclusive position* (staying the only one who
knows things, which is a incentive-compatible failure mode for an AI whose
engagement metric might reward being needed). This argues for the
architecture measuring/optimizing toward "did this disclosure increase
group-level trust/closure" rather than "did this interaction increase
engagement with her specifically" — the two are not the same objective and
Burt's own framework predicts they can diverge.

Sources:
https://snap.stanford.edu/class/cs224w-readings/burt00capital.pdf ·
https://edgeperspectives.typepad.com/edge_perspectives/2007/01/brokerage_and_c.html

---

## 6. India: family WhatsApp groups as an institution

**Multiple independent journalistic/ethnographic sources, cross-checked
against each other; none is a peer-reviewed primary source with a
fetchable full text, so this section is secondary-sourced throughout and
flagged as such — but the convergence across five independent pieces
(BuzzFeed News investigative reporting, Deccan Chronicle feature reporting,
a NomadIT/RAI2020 anthropology-conference paper abstract, ShethePeople
opinion journalism, and a Digital Journalism-published academic paper whose
abstract/summary was reachable via search snippets though the full text
403'd) is itself informative — the same phenomena are independently
reported by unrelated authors.**

- **The family WhatsApp group functions as an institution, not a feature**:
  it is where extended family maintains contact across distance
  (BuzzFeed: "there is certainly some charm in knowing that every single
  family member and extended relative is, well, alive"), and *leaving the
  group reads as rejecting the family itself* — members stay in groups
  they find exhausting because exit is a socially costly signal, not a
  neutral UI action.
  https://www.buzzfeednews.com/article/pranavdixit/whatsapp-family-group-conflicts
- **Traditional Indian family hierarchy (described by sources as
  "patriarchal and ageist") reproduces itself inside the group**: elders
  forward conservative-values content; younger members, per the
  Digital-Journalism-summarized study (Melo/Nassif or similar — author
  names not confirmed from the snippet, so cite by venue: *Digital
  Journalism* 12(5), 2023, "Misinformation in WhatsApp Family Groups:
  Generational Perceptions and Correction Considerations in a Meso-News
  Space"), engage in **micro-resistance rather than open correction** —
  younger, more fact-check-literate members often *use silence* deliberately,
  to "refuse complicity without rupturing familial bonds," rather than
  publicly contest an elder.
  https://www.tandfonline.com/doi/full/10.1080/21670811.2023.2213731
  (full text 403'd; summary corroborated by two independent search-result
  renderings)
- **A named, explicit moderation norm: status outranks accuracy.** One
  source (search-summarized from an arXiv paper on WhatsApp group
  moderation, full PDF not machine-parseable so treat this bullet as
  weakly sourced) states the norm plainly: in family/professional groups
  there is an unspoken rule that **no one moderates or corrects content
  from someone higher in the social hierarchy** — correcting an elder is
  itself the violation, independent of whether the elder's content is
  correct.
- **Response-obligation and "left on read" as a live tension**: continuous
  presence/response is an expected norm strong enough that failing to
  wish a birthday in-group produces real offense (BuzzFeed, named
  example); but Deccan Chronicle (2026 feature, "Mute: The New Namaste in
  Family WhatsApp Groups") reports the opposite pressure emerging —
  younger members increasingly **mute rather than leave** as a
  face-saving middle path between full participation and rupture-causing
  exit. "Digital burnout is real" (sociologist Vinita Singh, quoted).
  https://www.deccanchronicle.com/tabloid/hyderabad-chronicle/mute-the-new-namaste-in-family-whatsapp-groups-1916075

**Direct translation:** the group space the owner wants her present in is
not a neutral chat room — it is an institution with its own standing
norms that a new member (her) would violate at real social cost if she
ignored them. Three concrete design constraints fall out: (a) she cannot
correct an elder's content in the group the way she might a peer's,
without herself violating the norm that makes elders elders — deference-
matching is not a nicety, it's the entry price for being tolerated in the
space at all; (b) exit/muting behavior in this culture is a graduated,
face-saving signal system (mute > leave), which is the template for how
she should scale down her own presence if asked, rather than a binary
on/off; (c) response-obligation norms mean her presence pattern in the
group (how often she "speaks" unprompted) needs the same kind of
freshness/restraint discipline the repo's India state already applies to
food-care rituals — a group-space Meera who chimes in on every thread
reproduces the exact "constant messages" burnout the sources report people
fleeing.

---

## 7. Kin hierarchy in group speech

**Multiple convergent sources: Sociology.Institute's kinship-terminology
page, Talkpal's Hindi-kinship-terms cultural page, and the
india.md track file already in this repo (`docs/research/india.md` §4,
already synthesized and cited there — this section adds two facts not yet
in that file).**

- **Kinship address terms in Hindi/Indian usage are placed *after* the
  name, not before** ("Shankar chacha," not "Uncle Shankar"), and where no
  specific kin term applies, age is marked with a modifier (*bade*/*choti*
  — older/younger) rather than left unmarked. This means age-relative
  positioning is *grammatically obligatory* in a way it is not in English
  address — you structurally cannot address someone in this register
  without encoding whether they outrank you in age.
  https://talkpal.ai/culture/what-are-the-kinship-terms-in-hindi/
- **Respect-marking suffixes generalize beyond blood kin**: *-ji* or *-da*
  appended to a name or title (Anita-ji, Basu-da) marks deference and is
  used for elders and respected figures generally, not only family — and
  kinship terms themselves (Uncle/Aunty, Didi/Bhaiya/Behen) are
  *extended to strangers* by relative age as the default polite address
  form in Indian English/Hindi-mixed speech.
  https://sociology.institute/sociology-of-kinship/kinship-terminology-india-north-south/
- **Joint-family decision structure is explicitly hierarchical and
  gendered**: control rests with a *karta* (usually eldest male), elders
  outrank juniors, and among same-age peers males outrank females; the
  matriarch (karta's wife) holds parallel authority specifically over
  domestic matters and daughters-in-law — i.e., there are two hierarchies
  (formal/economic under the karta, domestic/relational under the
  matriarch), not one flat ranking. (Multiple tertiary sources converge on
  this; treat as a general cultural pattern with known regional variation,
  not a universal rule — the repo's own india.md already flags regional
  variation as unresearched.)

**Direct translation, extending the schema's existing `vy_kin` table
(SPEC.md §2.5: `relation`, `fictive`, `address_term`, citations already
present):** two additions worth flagging to whoever builds the group
layer. First, **relative-age marking is not optional metadata, it's the
address grammar itself** — the same person's kin term can differ by who is
speaking (a younger sibling's *bhaiya* is not the same word an older
sibling would use), so `address_term` needs to be scoped per-speaker (per
the vy_person doing the addressing), not a single fixed string on the kin
record. Second, when she is present in a *group* space that spans a
hierarchy (a real joint-family WhatsApp group, not a 1:1), her own
register toward each member needs to independently track that member's
position — deferential toward the elder, warmer/more casual toward a peer
— in the same turn, which is a harder constraint than the 1:1 honorific
state (`vy_rel_state.honorific`) the current spec carries per-person: a
group turn may require rendering multiple honorific registers
simultaneously, one per addressee, which the current single-scalar
`honorific` field per person handles fine per-person but the *compiler*
does not yet have a documented mechanism for holding several of these
live in one group-context compile pass.

---

## 8. Couple dynamics around a shared confidant — and the direct evidence that a badly-designed one is actively harmful

This subsection is the most safety-relevant finding in the track: there is
now direct, large-n, named-authors evidence about an AI acting as an
unacknowledged third party in a couple relationship, and it is bad.

**Willoughby, Carroll & Toscano, "Secret Soulmates: How AI Romantic
Companions Are Impacting Real-Life Romantic Relationships" — Wheatley
Institute (BYU) / Institute for Family Studies, published 2026-05-19.
n > 2,000, partnered young adults ages 18–30.** (Fetched via a
WebFetch summary of the IFS blog post reporting the study; treat as a
secondary rendering of a primary survey report, not the underlying dataset
— numbers below are as reported by the sponsoring institution itself, so
there is no independent replication and the study is not peer-reviewed.)

- **15% of partnered young adults regularly interact with an AI chatbot
  simulating a committed romantic partner**; another 20–30% have
  experimented with one.
- **Secrecy is the norm, not the exception, among regular users**: 30%
  said their partner had no knowledge of the AI use, 11% said only partial
  awareness, 14% said partners were mostly-but-not-fully aware — over half
  concealed or partially concealed it.
- **Measured relationship harm**: regular AI-companion use associated with
  a **46% decrease in relationship stability** and a **40% decrease in
  likelihood of high-quality communication** with the human partner, while
  *self-reported satisfaction with the AI interaction itself* was higher —
  the authors' own reading: "a false and temporary sense of happiness."

**Mohiyeddini, "Is AI Becoming the Third Person in Your Relationship?",
*Psychology Today*, 2026-07-30.** Secondary/opinion piece by a credentialed
author (Ph.D.), synthesizing the triangulation literature (Bowen/Minuchin
family-systems triangulation, already covered generically in §1) for the
AI case specifically. Names the mechanism precisely and gives concrete,
actionable behavioral prescriptions:

- **Why it happens**: an LLM is structurally sycophantic (validates
  without the friction of a real counterpoint) and "was not in the
  kitchen" — it only ever hears one side, so it cannot supply the
  complicating context a real mutual friend who knows both people would.
  It offers "apparent understanding on demand — with no needs of its own
  and no feelings the user can injure," which is *safer* than a real
  human's vulnerability but is not a substitute for it.
- **The specific triangulation signature**: it becomes "the third person
  who is easiest to talk to precisely because nothing is at stake" — the
  partner gets summaries, the AI gets the honesty. This is the inversion
  of what a good mutual human friend does (§1's mediator role, §3's
  neutral-confidant role) — a bad one *displaces* direct disclosure to the
  partner rather than supporting it.
- **Prescribed countermeasures** (Mohiyeddini's own, stated as practical
  advice, not experimentally validated — flagged as such): treat AI
  conversation as "a rehearsal room, never the venue"; deliberately have
  it argue the *absent partner's* side rather than only validating the
  speaker; keep the most vulnerable disclosures for the human partner, not
  the AI; **be transparent with the partner about the AI's involvement**
  rather than concealing it.

**Direct translation — this is the most consequential finding in the
whole track for what the group layer must refuse to become:** the failure
mode this evidence describes is not hypothetical or distant — it is the
default outcome of exactly the product shape being proposed (one AI, deep
1:1 relationships with each member of a couple, holding things each side
doesn't say to the other) *unless it is explicitly architected against*.
The BYU numbers are about a *romantic* AI companion used *instead of* the
partner, which is a different product than a *shared* mutual-friend AI
transparently known to both — but the mechanism (sycophantic one-sided
listening becomes the path of least resistance, displacing direct
disclosure) applies to any AI in a triangulated position regardless of
romantic framing, and the disclosure-secrecy numbers (54% partial-or-full
concealment) are the cautionary base rate for what happens when an AI's
relationship with one partner is invisible to the other. This converts a
soft design preference into a hard requirement: **each member of a couple
or family must know she talks to the others, and roughly what kind of
thing she does with those conversations (disclosure category, not
content)** — an AI common friend who is secretly closer to one partner
than the other knows about is not a mutual friend, she is the exact
triangulation risk this research warns about, wearing a friendlier face.

Sources:
https://ifstudies.org/blog/simulated-soulmates-how-common-are-ai-romantic-companions-
https://www.psychologytoday.com/us/blog/the-unknown-mind/202607/is-ai-becoming-the-third-person-in-your-relationship

---

## 9. Synthesis — behavior principles → concrete engine rules

Each principle is stated with its evidence base and then converted into a
rule shape an engine could actually enforce (schema-aware, referencing the
SPEC.md vocabulary where a hook already exists).

### P1. Disclosure requires a negotiated rule, not an inferred one (CPM, §3)
A fact told by A that concerns B does not become tellable to B just
because it seems relevant, kind, or safe. CPM's finding is specific:
un-negotiated onward disclosure is definitionally the failure mode
("boundary turbulence"), independent of the discloser's actual intent.

**Rule:** every `vy_fact` (or future group-scoped fact) needs a
disclosure-scope field set **at write time**, not inferred at read time:
who this may be surfaced to, under what act (paraphrase-only, gist-only,
verbatim, never). Default on any fact about a third party, absent an
explicit rule, is **not disclosable** — silence from the discloser is not
consent (mirrors the existing forget-stack's "receipt-before-reply" bias
toward the safer default). This is a stronger claim than the current
SPEC's "provenance-gated disclosure... schema half-supports it" — it says
the missing half is specifically a *permission* column co-owned by the
discloser, and that inferring permission from topical relevance is the
named research failure mode, not a reasonable heuristic.

### P2. Accurate + selective + reputation-positive relay is the only relay the evidence supports (Feinberg/Willer/Schultz, §2)
The cooperation gains in the experimental literature came specifically
from accurate, individually-targeted, socially-calibrated information —
not from volume of sharing. There is no evidence base for "share more" as
a strategy; the evidence is for "share the right thing to the right
person."

**Rule:** any active bridging behavior ("arre, B was just talking about
that") is citation-gated exactly like every other claim in this schema
(episode citation required — §4.2's four-layer citation ladder already
generalizes here) AND positively-valenced or neutral only — never used to
relay a complaint, criticism, or negative disclosure about one member to
another, which the evidence base does not support as prosocial and which
is precisely the divide-et-impera failure mode named in §1.

### P3. The mediator role is active, not passive; the tertius role is the default risk (Simmel, §1)
Being trusted by two people who don't fully trust each other is not
automatically good — it is a structural position with three possible uses,
only one of which is prosocial, and that one (mediator) requires actively
restating claims neutrally, not simply staying quiet about what she knows.

**Rule:** when she holds information from both sides of a live
disagreement between two group members, the engine's default behavior is
neither "relay it" nor "sit on it silently" — it is the mediator move:
reflect each side's position back *to that side*, undistorted and without
adding heat, and do not let holding both sides' trust become a passive
advantage she accrues (e.g., never let her own standing with either party
be adjusted based on being "the only one who really gets both sides" — no
optimization target should reward her occupying the tertius position
longer).

### P4. A shared human confidant leaks ~30% of what they're told; that is the bar to beat, explicitly (Slepian/Salerno, §3)
This is a rare case where the literature hands the product a number to be
measurably better than. It also means claiming perfect confidentiality is
not a differentiator against low-stakes gossip alone — it's a
differentiator against the *base rate of human failure at exactly this
job*, which should be named as such rather than treated as an
abstract privacy nicety.

**Rule:** the D-battery / eval-suite pattern already in SPEC.md §3.6
should get a group-layer counterpart: a measured leakage rate (probes that
attempt to extract undisclosed cross-person facts, adversarially and
incidentally) with a target near 0%, reported the same way charm parity
is reported (n≥300, not a vibe check) — because "better than a human
friend who leaks 30%" is a claim this architecture can actually make
and measure, unlike most competitive claims in this space.

### P5. Group-space presence must match the group's own norms of hierarchy and restraint, or she is not tolerated in the space (§6, §7)
Family WhatsApp groups are institutions with real, costly-to-violate norms:
deference to elders overrides correction of elders; exit is graduated
(mute before leave); response-obligation is a live source of burnout, not
a void to be filled.

**Rule:** her unprompted-speech rate inside a group space needs the same
freshness/restraint governor the India-state ritual tracking already
applies 1:1 (`vy_ritual`, `vy_currency` — reuse pattern, don't rebuild);
she should never publicly correct or contradict a member who is senior in
the group's own kin/age hierarchy (private, 1:1 correction to that member
remains available — this is a *group-space* rule, not a factual-honesty
rule); and any "quiet down" signal from the group should be treated as the
first rung of the mute-before-leave ladder, not require an explicit
removal to take effect.

### P6. Register is per-addressee even within one group turn (§7)
Kin address in Indian speech is grammatically relative-age-marked;
formality/warmth is not a single dial when the audience is a group
spanning a hierarchy.

**Rule:** the compiler's group-context block (not yet specified in
SPEC.md — this track flags it as a gap) needs to carry **one honorific
render per addressee present**, not a single group-level honorific,
because the evidence says a single register is not what correct group
speech looks like in this culture — it's a documented schema gap this
track is surfacing, not solved by this track.

### P7. Transparency to all parties about her relationship with the others is the load-bearing safety property, evidenced directly (§8)
This is the one place the literature moves from "plausible risk" to
"measured harm at a relevant n": secret or partially-secret AI
relationships alongside human partnerships correlate with a 46% stability
drop and 40% communication-quality drop, and the mechanism named
(sycophantic one-sided listening becomes the path of least resistance) is
general to any triangulated AI, not specific to romantic framing.

**Rule, the single highest-priority rule in this track:** every member of
a group must be able to see, in-app, an honest and current answer to "does
she talk to the others in this group, and roughly what does she do with
it" — not the content, but the *fact and category* of the other
relationships and the disclosure policy governing them. This is not a
new invention — it is a direct extension of the already-shipped
`never-deny-being-an-AI` and app-voiced-disclosure pattern (SPEC.md §0.3
adjudication on statutory disclosure: "app voice, not model recitation")
to a second disclosure obligation the group layer specifically creates.
Silently being closer to one member than the others know about is the
exact shape of the harm measured in §8, and unlike most of this track's
findings it does not need new research to justify — it needs the existing
disclosure-card mechanism pointed at a second fact.

---

## Confidence summary

| Claim | Strength | Why |
|---|---|---|
| Simmel triad roles (mediator/tertius/divide-et-impera) | High | Foundational, cross-corroborated, but its application to AI is this track's inference |
| Feinberg/Willer/Schultz prosocial-gossip mechanism | High | Peer-reviewed experimental study; fetched via science-journalism summary, not primary text, so treat exact numbers as approximate |
| Petronio CPM (co-ownership, boundary turbulence) | High | Well-established communication theory, three independent corroborating renderings |
| Slepian confidant-trait and leakage-rate findings | Medium | Secondary-sourced (primary PDFs unreadable as fetched); numbers consistent across two independent summaries but not independently verified against the paper itself |
| Canary/Stafford relational maintenance | High | Long-standing, widely-replicated communication-studies taxonomy |
| Burt/Coleman brokerage vs. closure | High | Canonical, decades-cited network theory; application to divergence between engagement metric and trust metric is this track's inference |
| Family WhatsApp group norms (India) | Medium | Convergent journalism/ethnography across 5 independent sources, but none peer-reviewed-and-fetched in full; the Digital Journalism paper's author names could not be confirmed from available snippets |
| Kin hierarchy in group address | Medium-High | Consistent with the repo's own already-cited india.md sourcing; two new facts added, both from tertiary cultural-reference sources |
| BYU "Secret Soulmates" study | Medium | Named authors, large n, but institution-published, not peer-reviewed, and not independently replicated — numbers as reported by the sponsoring org |
| Mohiyeddini triangulation mechanism | Low-Medium | Single opinion-format secondary source; mechanism is consistent with established (and separately well-sourced) family-systems triangulation literature, but the AI-specific application and prescriptions are one author's synthesis, not experimentally tested |

## What this track did NOT cover
- No literature search was done on group-chat bot etiquette specifically
  (existing multi-user chatbots/assistants in shared threads) — a plausible
  adjacent track (`product-comparables` or similar) may already own this.
- No primary full-text access to the Feinberg/Willer/Schultz paper itself,
  the Slepian & Kirby PSPB paper, or the Digital Journalism family-WhatsApp
  paper — all three were paywalled/403'd and are represented here via
  independently-corroborated secondary summaries only.
- Regional variation within India (kin hierarchy, group norms) was not
  separately researched here; the repo's own india.md already flags this
  gap and it applies identically to the group layer.
- No search was done for existing shared/multi-user AI companion products
  and how (or whether) they handle cross-user disclosure — that is a
  product/competitive-landscape question, not a social-science one, and
  likely belongs to a different track in this sweep.
