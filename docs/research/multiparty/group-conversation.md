# Track: group-conversation — when should an AI speak in a group?

Scope per assignment: the decision architecture for group-turn participation
— addressee detection, turn-taking/response-selection in multi-party
conversation (MPC), what's measured about deployed AI participants in group
chats, silence as a first-class action (extending our own screen-share
`NO_COMMENT` lineage), and lurk/react/bridge as a common friend's behavioral
repertoire. Grounds in `multiparty-direction` (decisions.md) and SPEC.md §2's
`vy_episode`/WE-store schema. Does not cover disclosure control (what she may
tell A about B) or WhatsApp Business API bot-in-groups feasibility — those are
other tracks; I note where this one touches them.

---

## 0. Bottom line up front

No literature answers "when should an AI speak in a group" with a validated,
transferable policy — every group I found (academic MPC, HCI proactive-agent,
and the one real-world mass deployment) converges on the same three design
moves without anyone having proven the exact thresholds:

1. **Silence must be a first-class, separately-decided action**, not the
   fallback when nothing else fires and not bundled into the same generation
   step as content. Every system that tried to jointly predict "speak or stay
   silent" *and* what to say underperformed a system that decided the two
   separately (§3). Our own repo has independently rediscovered this twice —
   `WATCH_COMMENT_DIRECTIVE`'s `NO_COMMENT` token and the killed
   silence-triggered idle nudge (§4) — which is unusually strong corroboration
   because it was arrived at from a completely different problem (1:1 screen
   share, proactive messaging) than the group-chat literature that reaches the
   same conclusion.
2. **Direct address is the one addressee signal that actually works**;
   inferring who an *un*-addressed message is "for" is close to unsolved —
   GPT-4o was reported at only marginally-above-chance accuracy on a
   triadic-dialogue addressee benchmark (§1). This bounds what the
   architecture can safely gate on: build the reliable case (explicit
   mention/reply/name) as a hard rule, and treat "should I jump in unprompted"
   as a *separate*, lower-confidence, rate-limited decision — never assume the
   model can silently infer it was being talked about.
3. **The one deployed mass-scale precedent (Meta AI in WhatsApp groups)
   optimized for presence, not for restraint, and the user reaction was
   hostile** — "clingy new roommate," "pointless and irritating," and
   specifically *the absence of an opt-out/quieting control* is the
   named complaint (§2). This is the single most directly transferable
   real-world data point for a common-friend product and it points at design
   headroom (a per-group/per-person quieting control) more than at any
   turn-taking algorithm.

None of this is a solved recipe. It is a set of converging failure modes
(over-chiming, under-addressing, joint-decision degradation, no-opt-out
backlash) that a decision architecture has to design *against*, more than a
positive spec to copy. Flagged as such throughout.

---

## 1. Addressee detection and turn-taking in multi-party conversation (MPC) — academic state

**Addressee detection is a real, load-bearing sub-problem, and it is largely
unsolved for the general (non-mentioned) case.**

- Classic framing: "are you talking to me?" — binary in human/system settings,
  N-way (which participant, or the group) in human/human/system settings.
  Established literature (Microsoft Research, IEEE) treats this with
  multimodal cues — acoustic features dominate, ASR/system-state help,
  vision/beamforming add little. [Microsoft Research, "Multimodal Addressee
  Detection in Multiparty Dialogue Systems" — https://www.microsoft.com/en-us/research/publication/multimodal-addressee-detection-in-multiparty-dialogue-systems/]
- **LLM-era benchmark, directly on point**: a 2025 paper built a multimodal,
  multi-party *triadic* (3-person) dialogue corpus, with explicit addressees
  annotated on **~20% of turns** — meaning 80% of real turns in a 3-person
  conversation carry no explicit addressee marker at all, which is itself a
  useful base rate for how often "who is this for" even has a ground-truth
  answer. On that benchmark, **GPT-4o scored only marginally above chance**
  at recognizing the addressee. [arXiv:2501.16643, "An LLM Benchmark for
  Addressee Recognition in Multi-modal Multi-party Dialogue"]
  **Load-bearing implication**: do not architect a "detect who this message
  is for, then decide whether it's her" pipeline as the primary gate. Use
  explicit signals (name mention, reply-to, @-style address) as the reliable
  channel and treat everything else as content-relevance scoring, not
  addressee inference.
- **Meta's own multi-party chat research (MultiLIGHT, FAIR)**: built a
  10,917-conversation, 313,433-utterance role-play dataset specifically to
  study who-speaks-next in group dialogue. Four decision architectures were
  compared for next-speaker/silence selection:
  - *Silence-OR-Utterance* (each character independently emits either an
    utterance or a silence token, one joint decision): **35.8%** accuracy —
    barely above the 33.3% random baseline for 3 candidates, and explicitly
    attributed to **error accumulation** from bundling the silence decision
    with generation.
  - *Speaker-AND-Utterance* (jointly predict who speaks and what they say):
    49.5%.
  - *Speaker-only* (dedicated small model, BART, predicting only who speaks
    next, generation handled separately): **54.4%** — the best performer.
  - When the actual utterance content is given as context (i.e., decide who
    said something *after* seeing what was said, not before), speaker
    identification jumps to **85%**.
  [arXiv:2304.13835, "Multi-Party Chat: Conversational Agents in Group
  Settings with Humans and Models" (Meta AI / FAIR)]
  **Load-bearing implication, reinforcing point (1) above**: the *architecture*
  of the decision matters more than the model. A dedicated, separate
  "should/who speaks" step consistently beat folding that decision into
  generation. This is an internal-consistency finding from Meta's own
  research group, independent of our repo, converging on the same shape as
  our `NO_COMMENT`-as-a-separate-token design (§4).
- **2025 survey of the field** ("Multi-Party Conversational Agents: A
  Survey") found addressee selection reported around **84.65% accuracy** and
  response selection around **91% recall** on curated benchmarks, but noted
  turn-detection methods are still "reactive rather than proactive," found
  **no unified taxonomy for *when* an agent should initiate speech**, and
  explicitly does **not discuss silence/abstention as a deliberate strategy**
  anywhere in the surveyed literature — an absence worth naming as thin
  coverage, not a negative result. [arXiv:2505.18845v1]

**Assessment**: addressee/turn-taking research is real but narrow — mostly
solved for explicit-address and next-speaker-given-content settings, mostly
unsolved for "should an unaddressed agent volunteer," which is exactly the
group-chat decision our product needs most (the common-friend case is
precisely the *unaddressed* volunteering case — a couple talking to each
other, when does she chime in unprompted).

---

## 2. What's measured about deployed AI participants in group chats

**This is the thinnest-evidence section — flagged explicitly.** There is no
public, methodologically-transparent study of engagement rates, response
appropriateness, or retention effects for an AI participant embedded in real
consumer group chats. What exists is press coverage of one deployment and one
lab study.

- **Meta AI in WhatsApp groups (the only mass-scale real-world precedent)**:
  rolled out as an always-present blue-circle presence, activatable via
  `@Meta AI` in group chats, **with no setting to disable or hide it**.
  Coverage (TechRadar, GB News, industry commentary) is uniformly about
  backlash: "clingy new roommate," "the most pointless and irritating AI
  integration into an app so far," users reporting they were switching apps.
  Meta's own response conceded the "always visible, cannot opt out" framing
  and defended it as intentional rather than announcing a fix.
  [TechRadar — https://www.techradar.com/computing/websites-apps/whatsapp-says-forcing-blue-meta-ai-circle-on-everyone-is-a-good-thing-despite-fierce-backlash;
  GB News — https://www.gbnews.com/tech/whatsapp-meta-ai-backlash]
  **This is anecdotal/press evidence, not a measured study — no engagement
  numbers, no churn numbers, no controlled comparison.** Treat it as a single
  strong qualitative signal (the complaint is about *presence control*, not
  about specific reply quality) rather than a quantitative baseline.
  Separately, WhatsApp reports **150M+ weekly users** of its AI message
  *summary* feature — a passive, on-demand, non-conversational AI role,
  which is a data point that a *requested/scoped* AI role gets heavy adoption
  where an *ambient, opt-out-less* one gets backlash, though this is my own
  inference from two disjoint numbers, not a stated finding — flagged as
  inference, not measured comparison.
- **HUMA — "Humanlike Multi-user Agent," a 2025 controlled lab study** (the
  closest thing to a rigorous human-subjects test of an AI participant in a
  group chat): 97 participants in four-person role-play chats (a community
  manager scenario), randomly assigned to a human or AI manager, ~10-minute
  sessions.
  - AI was correctly identified as AI only **55.4%** of the time (95% CI
    42.4–67.6%, n=56); the *human* manager was misidentified as AI at nearly
    the same rate — humans were correctly ID'd as human only **46.7%** of
    the time (n=41). I.e., participants could barely tell better than a coin
    flip either way.
  - On experience measures (community-manager effectiveness, social
    presence, engagement/satisfaction, human-likeness), the AI trailed the
    human manager by small effect sizes throughout (Cohen's d between −0.21
    and −0.37; human-likeness/competence was a dead heat, d=0.01).
  - Mechanism: a "Router" scores 20 predefined conversational strategies on
    **Appropriateness** (LLM-judged contextual fit) and **Timeliness**
    (`T = min(1, k/N)` where k = turns since the strategy was last used —
    a cooldown against repetition), and picks the strategy maximizing
    A+T. **"Keep Silent" is explicitly exempt from the cooldown penalty** —
    it can be chosen every turn without being "stale." Response timing is
    further gated by simulated human typing speed (50–100 wpm), and the
    agent stays **interruptible while "typing"** — mirroring the real cost
    a human incurs by starting to compose, i.e., silence/reticence is cheap
    and re-triggerable, speaking has a modeled cost.
  [arXiv:2511.17315, "Humanlike Multi-user Agent (HUMA)"]
  **Caveat stated by the authors, worth repeating**: single domain
  (generative-art community), short 10-minute sessions, role-played
  personas — no long-horizon retention or over-trust measurement. n=97 is
  respectable for a lab study but this is one scenario, once.

**Assessment**: there is no rigorous, at-scale, real-consumer-group-chat
measurement of an AI participant's turn-taking quality anywhere in the public
literature as of this search. The gap is real, not a search failure — it
matches the SPEC.md/RESEARCH.md house finding that relationship/group-state
work is "greenfield everywhere." What exists (Meta AI backlash, HUMA lab
study) both point the same direction — presence without a restraint/control
mechanism is punished — but neither is a transferable turn-taking algorithm.

---

## 3. Response-selection frameworks that explicitly model "when to speak" (the closest things to a ready-made decision architecture)

Three systems, independently arrived at, converge on the same shape: **score
candidate actions (including an explicit "stay quiet" action) against a
threshold, gated by a recency/cooldown term that exempts silence from the
cooldown.**

- **MUCA ("Multi-User Chat Assistant")** — explicit **3W** framing: *What* to
  say, *When* to respond, *Who* to address, computed by a Dialog Analyzer with
  sub-modules tracking per-topic status (not-discussed / being-discussed /
  well-discussed) and per-participant chime-in frequency. A dedicated
  **"Keep Silent"** strategy fires "when other trigger conditions are not
  met." An **"In-context Chime-in"** strategy is gated by two probabilities:
  a *silence factor* that rises with consecutive silent turns, and a
  *semantic factor* tied to the conversation being "stuck." Small-group user
  study (4–8 people, custom topics): the always-on baseline chatbot was rated
  as chiming in excessively by **56.25%** of participants; MUCA was rated
  appropriate by **13/16**; user engagement (words/conversation) rose 426.5 →
  531.5; consensus rate rose 50% → 66.7% on one topic. [arXiv:2401.04883,
  MUCA] — evidence quality: real user study, small n, single research group,
  not independently replicated — treat the specific percentages as
  suggestive, not load-bearing.
- **HUMA's Router** (§2 above) — Appropriateness+Timeliness scoring, silence
  exempt from cooldown.
- **"Proactive Conversational Agents with Inner Thoughts" (CHI 2025)** — the
  most mechanistically detailed of the three. An **intrinsic-motivation
  score** is computed per candidate "thought" using eight heuristics derived
  from a 24-participant think-aloud study (relevance, information gap,
  expected impact, urgency, coherence, originality, balance-of-participation,
  conversational dynamics), rated 1–5 by chain-of-thought prompting, combined
  as `score = Σ p(sᵢ)·sᵢ·dₚ` where `dₚ` is a term that **grows with elapsed
  silence duration** — i.e., the bar to speak drops the longer the group has
  been quiet, which is the mirror image of our own rejected 1:1 pattern
  (§4) and worth flagging as a *tension*, not an endorsement: in 1:1 we
  killed exactly this shape (silence-contingent proactivity) because it
  became incentive-salience engineering on the user's inattention. In a
  *group*, the "silence" being measured is between other humans, not a
  wait-for-Meera cue, so the two are not the same mechanism — but the
  architecture must be built carefully enough that a "gap grows the urge to
  speak" term doesn't quietly reintroduce the same anti-pattern at the group
  level (her filling silence because it's been quiet, not because she has
  something to say).
  - Evaluated against a next-speaker-prediction baseline over 100 simulated
    conversations with 10 human evaluators: Inner Thoughts won on turn
    appropriateness (Mann-Whitney U=577.0, p=2.4×10⁻⁶), coherence
    (p=1.6×10⁻⁵), anthropomorphism (p=2.4×10⁻⁴), and intelligence
    (p=7.3×10⁻⁵), with an **82% preference rate**.
  - A separate 6-pair user study varied the speaking threshold: the
    moderate-threshold "Active Contributor" condition was rated most
    favorable; a higher-threshold "Selective Participant" was rated **too
    passive**; a low-threshold "Non-stop Chatter" was rated **overwhelming**.
    This is a direct, if small-n, data point that both failure directions
    are real and the good zone is a *middle*, not an extreme — over-silencing
    is also a measured cost, not just over-chiming.
  [arXiv:2501.00383, CHI 2025]

**Convergent design pattern across all three** (MUCA, HUMA, Inner Thoughts),
independently built by different groups: (a) silence is a named, first-class
option with its own selection logic, not a default fallback; (b) a
recency/fatigue term suppresses repeated *speaking* strategies but not
repeated *silence*; (c) the always-reply baseline is measurably worse than a
gated one in every study that tested it (MUCA's 56.25% "excessive" rating);
(d) a too-quiet gate is also measurably worse (Inner Thoughts' "Selective
Participant" rated too passive). None of these three papers has been
independently replicated by a third party, and none was tested on WhatsApp-
scale, real (non-role-played) group chats — flag the specific numbers as
directional, the *shape* of the finding (separate-and-gated beats
always-on-and-joint) as the more load-bearing part because it triangulates
across three independent groups plus Meta's MultiLIGHT plus our own repo's
independent discovery (§4).

---

## 4. Silence as a first-class action — our own lineage, read as evidence

This repo already has two independent, previously-measured instances of the
exact same design principle the group literature converges on, from a
completely different problem (1:1, not group). That independence is what
makes them useful evidence rather than restated theory:

- **`WATCH_COMMENT_DIRECTIVE`** (`src/engine/persona.ts:451`): on every
  scene-change during screen share, the model is handed an explicit
  either/or — say one instant reaction under 10 words, **or** "reply with
  exactly `NO_COMMENT` and nothing else." This *is* a dedicated, separately-
  gated silence token, decided per-turn, exactly the shape MultiLIGHT's
  best-performing "Speaker-only" architecture and MUCA/HUMA/Inner Thoughts'
  "Keep Silent" strategy independently converge on.
- **Measured behavior of that gate** (`decisions.md#vision-model`,
  `context/measurements.md#vision-fab`): under the `grok-quiet` condition,
  the model returned `NO_COMMENT` on **15 of 16 frames** — i.e., the gate
  defaults hard toward silence, matching the group-literature finding that
  an ungated/eager system over-chimes and users notice (MUCA's 56.25%). But
  **when the directive was retuned to push more engagement, fabrication rose
  on a small probe** — the system invented content rather than staying
  honestly silent. This is the single most important internal data point
  for the group-turn architecture: **raising the speak-rate of a silence
  gate without a corresponding grounding fix trades under-participation for
  fabrication, not for correct participation.** In the group case, the
  analogous fabrication is not "described a screen wrong" but "claimed to
  know something about another group member it doesn't actually have
  provenance for," or bridged a reference that wasn't actually said —
  which is precisely why `multiparty-direction`'s disclosure-control
  mechanism (provenance-gated citations, episodes carrying WHO was present)
  has to be the hard constraint sitting *underneath* any bridge-type action,
  not a separate concern. This finding is n=6/16 on a small probe per the
  decision log itself ("do not ship on n=6") — cited here as a *mechanism*
  warning, not a load-bearing number.
- **The killed silence-triggered idle nudge** (`src/engine/persona.ts:427-434`,
  comment block): a proactive 1:1 message that fired when the user "went
  quiet for a few minutes with the chat open" was **removed** and explicitly
  marked "do not re-add ... in any form," because triggering on the user's
  *inattention* is "incentive salience engineering: it builds wanting without
  touching liking." The replacement rule made every unprompted message
  **REASON-contingent** — it fires because the user *said* something that
  makes a follow-up legitimate (`[followup:]` — they named a time and it
  passed), never because they simply went quiet.
  **Direct transfer to the group case**: the group-turn architecture must not
  let "the group has been quiet for N minutes" alone be a trigger to speak.
  Inner Thoughts' `dₚ` term (§3) that grows the urge to speak with elapsed
  silence is the *shape* of pattern this repo already tested and killed once
  — worth flagging explicitly as a candidate anti-pattern to avoid
  reproducing at the group layer, not because group silence and 1:1
  inattention are proven equivalent (they are not — a group going quiet is
  not "waiting on her" the way a 1:1 chat left open is), but because the
  mechanism ("longer silence → lower bar to speak, regardless of whether she
  has anything reason-contingent to say") is the same shape that was already
  shown to manufacture false engagement once.

**Net evidentiary weight**: this section is the strongest, most load-bearing
part of the track, because it is not borrowed from external literature at
all — it is the repo's own measured behavior under an equivalent problem
(a per-turn speak/stay-silent gate on a vision model), independently
corroborated by the shape of every external group-chat system found (§1–§3).
Where external literature is thin (§2) or contested, this internal precedent
is the most trustworthy single input to the architecture.

---

## 5. Lurk / react / bridge — how a common friend behaves in real group chats

This is where the evidence is weakest and most inferential — flagged
throughout. No paper studies an *AI* doing this; the grounding is human
social-network theory, imported by analogy.

- **Lurk (the default state)**: WhatsApp-specific participation research
  found groups analyzed skew small (mean 9, median 6 members) and that
  identified-user platforms like WhatsApp see *higher* participation than
  anonymous ones — but general online-community participation still follows
  a steep inequality curve (the "90-9-1" pattern: ~90% of participants
  contribute nothing on a given topic, ~9% contribute occasionally, ~1%
  account for most volume) [NN/g, "Participation Inequality"; Augsburg
  Universitätsbibliothek working paper on WhatsApp group communication].
  Personality research on lurking specifically ties **extraversion/emotional
  stability to posting** and **conscientiousness to lurking**
  [ResearchGate summary of lurker/poster personality studies]. **Implication
  for the architecture, stated plainly as inference**: lurking is not a
  failure state to be minimized — it is the modal behavior of every real
  participant in every real group, so an AI common friend that talks close
  to as often as an average human member is already talking *far* more than
  most members do, and "quiet most of the time" is not under-delivering, it
  is normal. This reframes the MUCA/HUMA/Inner Thoughts silence-exemption
  finding (§3-4) as matching ordinary human group behavior, not just being a
  safety valve.
- **React (the low-cost middle tier)**: HUMA's architecture treats
  "reactions" (its event-driven system explicitly handles "messages, replies,
  **and reactions**" as distinct event types) as a cheaper, lower-commitment
  participation channel than a full reply — this is a design choice in a
  2025 system, not a measured behavioral finding, but it matches the native
  affordance every major group-chat platform (WhatsApp included) already
  ships (emoji reactions). **No study I found measures whether an AI's
  reaction-only participation reads as more acceptable presence than
  reply-only or silence-only** — this is a genuine gap, worth naming
  explicitly rather than assuming an answer. It is a plausible cheap
  intermediate tier (a reaction has near-zero interruption cost and no
  addressee ambiguity) but the claim that users prefer it is unverified.
- **Bridge (the differentiated, common-friend-specific move)**: grounded in
  Ronald Burt's structural-holes / brokerage theory — a person spanning a
  "structural hole" (a gap between two others' networks) controls information
  flow between them and captures what Burt calls **"tertius gaudens"** ("the
  third who benefits") value: earlier access to information, more diverse
  input, and control over what crosses the bridge [Burt's "Structural Holes
  and Good Ideas" and related papers]. Triadic-closure research (repeatedly
  replicated, most recently a field experiment on a social-media platform)
  shows that **two people who share a mutual friend are more likely to
  become directly connected than two random people**, for reasons including
  the trust the mutual friend's endorsement transfers and the opportunity a
  shared context creates [PNAS field experiment, "Tendencies toward triadic
  closure"]. **The sharpest, most relevant-to-risk finding**: Burt's own
  analysis notes bridge relationships are inherently fragile — "sympathetic
  gossip within a closed network encourages ego to blame bridge difficulty on
  the character of the person on the other side," and when a bridge sits
  adjacent to a tightly closed group, difficulty at the bridge **"is likely
  to escalate into character assassination."** This is a load-bearing warning
  for the disclosure-control mechanism this track is *not* itself designing
  but sits directly upstream of: a bridging AI that gets a relayed fact
  wrong, or relays something that reads as taking a side, is not a neutral
  error in this literature's terms — it is structurally primed to become
  "she said something bad about you," which is exactly the "betrayal engine"
  failure mode `multiparty-direction` already names.
  **All of this is human-network theory, not AI-agent-tested** — flagged
  explicitly: nobody has measured whether an AI performing a "bridge" move
  ("arre, B was just talking about that") triggers the same trust-transfer
  and fragility dynamics that a human broker does. The analogy is the
  strongest reasoning available, not a verified transfer.

**What this section adds that the internal schema doesn't yet make explicit**:
`vy_episode.participation` currently enumerates `'we'|'user'|'meera'`
(SPEC.md §2.3) for the 1:1 case. A lurk/react/bridge model implies the group
layer needs at least a fourth observable action-class at the turn level —
something like a logged `no_comment`/reaction/bridge *action type* per group
turn, distinct from episode participation — so that "she chose to stay quiet
here" and "she reacted but didn't reply" are retrievable events in their own
right, not merely the absence of a `vy_episode` row. This is a schema
*implication* worth flagging to whoever owns SPEC.md, not a change I am
making — the group layer's decision architecture needs its own action log if
"silence was a deliberate, evaluable choice" (§4's central finding) is to be
auditable rather than just asserted in the prompt.

---

## 6. Adjacent finding worth flagging: bots in group chats over-collect by default

A 2024 study ("Bots can Snoop," analyzing bot behavior across group-chat
deployments) found chatbots in group settings routinely "access far more
messages than needed," including sender identity and unrelated content, and
measured a **3.6% chance that a bot recognizes and cross-links a user across
different groups** it's present in, given 50-user/10-bot group compositions
tested. The authors propose a protocol (SnoopGuard) restricting bots to
selective message access and sender anonymity while preserving end-to-end
encryption. [arXiv:2410.06587] This is not about turn-taking, but it bears
directly on the group-presence design: a common friend with access to
multiple people's private facts (per `multiparty-direction`'s WE-store) is
by construction the over-privileged case this paper is warning about — a
reason the "what she may say in the group" gate needs to be scoped by
provenance (already the plan) *and* the "how much of the group's raw
traffic does the participation-decision engine even see" question deserves
its own answer, which this track did not scope and flags as open.

---

## 7. Proposed decision architecture for group-turn participation

Synthesis of §1–6 into a concrete architecture. This is my synthesis, not a
single citation — each component names the evidence it rests on and its
confidence level.

**Stage 0 — hard gate, high confidence (§1):** Direct address (name
mention, reply-to her, explicit @-style invocation) always routes to a full
response. Do not attempt to infer implicit address from content alone as a
primary trigger — the addressee-recognition literature shows this is close
to unsolved even for frontier models (GPT-4o "marginally above chance" on a
triadic corpus, §1) and only ~20% of turns in even a fully-annotated
3-person corpus carry an explicit addressee signal — meaning most of what a
group-turn engine has to judge is inherently ambiguous, not a model
capability gap to be trained away.

**Stage 1 — candidate scoring, medium confidence (§3):** For every turn
where she is not directly addressed, score the turn (or accumulated
un-replied context) against explicit criteria before generating anything —
not "try to generate a reply and see if it's good," which is the
architecture MultiLIGHT's `Silence-OR-Utterance` baseline used and which
underperformed a dedicated silence/speak split (35.8% vs 54.4%, §1). Borrow
Inner Thoughts' heuristic set as a starting taxonomy (relevance, information
gap she uniquely holds, expected impact, urgency, coherence with the last
few turns, balance — has she talked recently relative to the humans) rather
than a single opaque score, since the taxonomy is at least independently
motivated by a think-aloud study, even though the specific weights are
unreplicated.

**Stage 2 — the silence-fatigue trap, explicit design constraint (§4):**
Do NOT let elapsed group-silence duration alone lower the bar to speak. This
repo already built and killed the analogous 1:1 pattern (§4) for a proven
reason (incentive-salience engineering on inattention); Inner Thoughts' own
`dₚ` term does exactly this at the group level and it should be treated as
a candidate anti-pattern to avoid, not adopted uncritically just because a
CHI paper used it. If a "the conversation has gone quiet" signal is wanted
at all, it should be reason-contingent the same way `[followup:]` is in 1:1
— e.g., someone in the group asked her something and never got an answer,
not merely "nobody has typed in five minutes."

**Stage 3 — three-tier action space, not two (§5, inferential):** Model the
output of Stage 1–2 as a choice among **lurk (stay silent) / react (a
reaction-weight acknowledgment, no full turn) / speak (full reply) / bridge
(a distinct action class: relay or reference between two group members)**,
not a binary speak-or-not. Bridge should be its own class with its own,
stricter gate, because it is the action this literature (§5, Burt) flags as
structurally prone to reading as taking sides or leaking, and it is the one
action type that must hard-depend on the provenance/citation mechanism
`multiparty-direction` already specifies — a bridge without a citable
episode behind it should not be constructible, mirroring the schema's own
`vy_fact_cite_or_authored` CHECK constraint (SPEC.md §2.3) at the
turn-decision level, not just the fact-write level.

**Stage 4 — rate-limit at the person/group level, not just the turn level
(§2, thin but directionally strong):** The one real deployed precedent's
core complaint was the absence of a control, not the specific reply
behavior. Build a per-group (and ideally per-member) ceiling/quieting
control into the architecture from the start rather than as a later patch —
this is a product-design implication of press-level evidence, explicitly
weaker than §1/§3/§4, but it is the only signal from an actual mass
deployment and it is unambiguous about what broke.

**Stage 5 — log the decision itself, not just its output (§4, §5 schema
note):** Whatever stage produced lurk/react/speak/bridge should be a
retrievable event, because "she chose not to comment here" is exactly the
kind of claim (per this repo's own house rule) that needs to survive audit,
not just be true in the moment — the same discipline `context/decisions.md`
already applies to every other claim in this codebase.

---

## 8. What this track did NOT establish (explicit gaps)

- No study measures AI turn-taking behavior in *real* (non-role-played,
  non-lab) consumer group chats at any scale. HUMA (§2) is the closest and
  it is a single 10-minute, 4-person, single-domain lab study.
  **Everything about how a *good* common-friend cadence looks in a real
  WhatsApp family/friend group is currently unmeasured, ours to define.**
- No paper tests "react" as a distinct, lower-cost AI participation tier
  against reply-only or silence-only — the three-tier lurk/react/bridge
  model in §7 is this track's synthesis, not a cited finding.
- No paper tests whether "bridging" behavior by an AI produces the same
  trust-transfer or fragility dynamics that human brokerage theory predicts
  — the entire §5 bridge analysis is analogy from human-network sociology,
  not AI-agent evidence, and should be treated as a hypothesis to design
  a small measurement around (a candidate for a swap-test-style protocol,
  per this repo's existing evaluation discipline), not as settled design
  guidance.
- Meta AI in WhatsApp groups (§2) has no public quantitative engagement or
  retention data — only press coverage of backlash. If Vyakti can get
  qualitative or quantitative signal on Meta AI's *actual* group behavior
  (via its own product usage, not press), that would upgrade this section
  substantially.
- I did not find literature specifically on register/pacing differences an
  AI should adopt when speaking to a group versus 1:1 (e.g., does she
  need a distinct "group voice" the way she has per-model adapters, per
  RESEARCH.md §3.1) — flagged as an open question adjacent to, but outside,
  this track's scope.

---

## Sources consulted (primary where possible)

- arXiv:2501.16643 — An LLM Benchmark for Addressee Recognition in
  Multi-modal Multi-party Dialogue
- arXiv:2304.13835 — Multi-Party Chat: Conversational Agents in Group
  Settings with Humans and Models (Meta AI / FAIR, MultiLIGHT)
- arXiv:2505.18845 — Multi-Party Conversational Agents: A Survey
- arXiv:2401.04883 — Multi-User Chat Assistant (MUCA): A Framework Using
  LLMs to Facilitate Group Conversations
- arXiv:2511.17315 — Humanlike Multi-user Agent (HUMA): Designing a
  Deceptively Human AI Facilitator for Group Chats
- arXiv:2501.00383 — Proactive Conversational Agents with Inner Thoughts
  (CHI 2025)
- arXiv:2410.06587 — Bots can Snoop: Uncovering and Mitigating Privacy
  Risks of Bots in Group Chats
- arXiv:2603.21682 — RESPOND: Responsive Engagement Strategy for Predictive
  Orchestration and Dialogue (extraction was thin/low-confidence — cited
  only as an existence pointer to ongoing predictive-turn-boundary work, not
  for any specific number)
- Microsoft Research — Multimodal Addressee Detection in Multiparty
  Dialogue Systems
- Bohus & Horvitz — Facilitating Multiparty Dialog with Gaze, Gesture, and
  Speech (ICMI 2010); Models for Multiparty Engagement in Open-World Dialog
  — classic HRI/spoken-dialogue floor-management grounding, consulted for
  context, not directly quoted with numbers above
- TechRadar, GB News — WhatsApp Meta AI backlash coverage (press, not a
  study — flagged as such throughout)
- NN/g — Participation Inequality: The 90-9-1 Rule
- Augsburg Universitätsbibliothek — Analysis of group-based communication
  in WhatsApp (working paper)
- Ronald Burt — Structural Holes and Good Ideas; Reinforced Structural
  Holes; Social Network Analysis (tertius gaudens, bridge fragility)
- PNAS — Tendencies toward triadic closure: Field experimental evidence
- Internal: `/home/user/html-portfolio/src/engine/persona.ts` (`WATCH_COMMENT_DIRECTIVE`,
  the killed idle-nudge comment block), `context/decisions.md#vision-model`,
  `context/measurements.md#vision-fab`, `docs/SPEC.md` §2 (schema),
  `context/decisions.md#multiparty-direction`
