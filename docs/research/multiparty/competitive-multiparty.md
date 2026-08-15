# Track: competitive-multiparty — who ships group AI, and does anyone do judged cross-member disclosure with real shared memory

Scope per assignment: Meta AI in WhatsApp/Messenger groups, Snap My AI in
group chats, group companion products (Character.AI, Nomi, Kindroid,
Replika, Shapes), and a white-space search for any startup building
shared-memory-across-people AI with judged disclosure. Owner's thesis under
test (`context/decisions.md` `multiparty-direction`): one AI as a common
friend to a group — 1:1 with each member, judged references between
members, presence in the group space. The load-bearing research question is
disclosure control: what may she tell A about B.

Bottom line up front: **no shipped product found does judged cross-member
disclosure over real shared memory.** Every product in this sweep falls into
one of three buckets: (1) a shared bot with no persistent memory in the
group at all (Meta AI, Snap My AI, ChatGPT group chats); (2) one human with
multiple AI personas/companions, which is memory *without* a multiparty
problem because there is only one human in the relationship (Nomi, Kindroid,
Character.AI's current form); or (3) marketing language claiming
cross-person memory with zero published mechanism for what gets disclosed to
whom (Shapes). The only work that engages the actual disclosure-control
question — what an AI should tell one person about another — is a single
n=155 lab vignette study in social robotics, not a product. This confirms
the owner's "breakthrough candidate" framing in `decisions.md`: disclosure
control is unclaimed territory, not merely underbuilt.

---

## 1. Meta AI in WhatsApp / Messenger groups — no persistent memory in groups, by explicit design

**What `@MetaAI` in a group actually does:** it is a stateless-per-invocation
assistant. Mentioning `@Meta AI` in a group chat shares "messages from the
past 30 days" as context for that single reply (outside groups, "up to 50
recent messages at a time are shared with Meta AI"). [Messenger Help
Center, "About sharing with Meta AI on Messenger",
https://www.messenger.com/help/1093117295527969/About+sharing+with+Meta+AI+on+Messenger]

**Memory is explicitly 1:1-only and explicitly excludes groups.** Meta's own
rollout of the "chat memory" feature (remembers facts like diet, birthday,
interests across sessions) is scoped to "certain one-to-one WhatsApp and
Messenger conversations" in the US/Canada, and reporting on the launch is
explicit that it does not extend to groups: **"Meta AI won't remember things
in group chats... Memory additions will only take place in 1-on-1 chats and
not from group chats where Meta AI was called in."** [Croma Unboxed via
search snippet, corroborated by itechguides.com's 2026 guide: "Memory was
announced for certain one-to-one WhatsApp and Messenger conversations" with
"no indication the memory feature works in group chats,"
https://www.itechguides.com/meta-ai-on-whatsapp-what-it-can-and-cant-do-in-2026/]
This is a load-bearing negative result: the largest-distribution group-AI
product in the world, on the exact platform the owner's thesis targets for
distribution, deliberately does not carry memory into the group context at
all — let alone per-member, let alone judged disclosure between members.

**"Side Chat" (testing since ~June 2026) goes the opposite direction from
shared memory — it is a *privacy* feature, not a *disclosure* feature.**
Swiping into a group chat and tapping "Ask privately" opens a private,
non-persistent Meta AI panel scoped to that chat's context, answered inside
an attested secure enclave ("Private Processing," independently audited by
NCC Group and Trail of Bits) that neither Meta nor WhatsApp can read, and
nothing is saved. [WABetaInfo / Deccan Herald / Engadget reporting,
corroborated by WhatsApp's own "Incognito Chat" architecture post,
https://blog.whatsapp.com/introducing-incognito-chat-with-meta-ai-a-completely-private-way-to-chat-with-ai]
The design intent is the inverse of a common friend: it keeps each member's
question *from* the group, rather than deciding what's safe to relay
*between* members. It is evidence Meta has thought about privacy-in-groups
as a boundary problem, not a disclosure-judgment problem.

**Disclosure/consent model in groups is coarse and non-per-member.** Any
participant can turn on message-sharing for the whole group ("people can
share your messages and photos from your group chats with Meta AI, unless
this functionality is turned off for the chat"), and the guidance to users
is defensive ("be mindful before sharing sensitive information in chats
that you do not want AIs to use") rather than a system that reasons about
what's safe to say to whom. [Messenger Help Center, same URL as above]

**Net for the white-space check:** Meta AI in groups has zero shared
persistent memory, zero per-member modeling, and zero disclosure logic
between members — it is a stateless assistant summoned into an ephemeral
context window. This is the single strongest primary-sourced negative
result in this track.

---

## 2. Snap My AI in group chats — reads live, no documented memory or disclosure mechanism

My AI can be a standing participant in a group (added only at group
creation, not addable to an existing group) and, once present, "can read
messages in the chat to participate in the conversation" and "will reply
without anyone [@mentioning it]." [Snapchat Support, "How does My AI work in
group chats?",
https://help.snapchat.com/hc/en-us/articles/46434528038548-How-does-My-AI-work-in-group-chats]

The only disclosure-adjacent mechanism documented is a one-time, all-or-
nothing consent gate: a pop-up on entering a group with My AI, and if a
given member declines it, My AI simply cannot see that member's messages in
that group ("If you don't accept the pop-up... then My AI will not access
your messages in the group chat, but you can still chat with others").
Removal is also all-or-nothing — pulling My AI out removes it for every
participant, and it cannot be re-added. [same URL] The support
documentation does not address per-member knowledge, individual memory, or
any rule for what My AI may say about one member to another — there is no
evidence such a rule exists, only a binary "can see this chat / cannot."

**Net:** Snap's group mechanism is participation-gating, not
disclosure-judgment. No shared memory model is documented at all.

---

## 3. ChatGPT group chats (OpenAI, launched globally Nov 20 2025) — memory is explicitly walled off from the shared space

OpenAI's own framing is the cleanest statement in the entire sweep of the
default assumption competitors are making, and it is the opposite of the
owner's thesis: **"personal ChatGPT memory is not used in group chats, and
ChatGPT does not create new memories from these conversations... your
personal ChatGPT memory is never shared with anyone in the chat."**
[OpenAI, "Introducing group chats in ChatGPT",
https://openai.com/index/group-chats-in-chatgpt/, corroborated by
TechCrunch's Nov 20 2025 rollout coverage] OpenAI states they are
"exploring" more granular memory controls for group chats in the future,
but as shipped, group chat is a shared workspace with per-user memory
strictly isolated — the architecture treats cross-member memory-sharing as
a privacy risk to be avoided by default, not a feature to build toward.
This is a second load-bearing negative result: a second major lab, building
group chat from the memory-product side (not the messaging-platform side),
independently chose isolation over sharing.

---

## 4. Companion apps with "group chat": almost all are one-human/many-AI, not many-humans/one-AI

This is a naming trap worth flagging explicitly for the architecture
discussion: most "group chat" features in the AI-companion category solve a
*different* problem than Vyakti's — multiple AI personas for one human,
not one AI's relationship with multiple humans. None of these engage
cross-*person* disclosure because there is only one person.

- **Nomi.ai:** "Group chats are conversations between you and multiple Nomis
  in your account in one room" — one human, multiple companions. [Nomipedia,
  https://wiki.nomi.ai/How_does_group_chat_work%3F] Companions do reference
  each other and "develop opinions about each other over time" within that
  one-human frame, and a group has a shared "Mind Map" that any Nomi in the
  room can draw on — but this is multiple-AI memory converging on one
  human's data, not one AI mediating between multiple humans. [Nomi.ai
  product pages, https://nomi.ai/, https://nomi.ai/updates/mind-map-2-0-bringing-nomi-memory-into-view/]
- **Kindroid:** group chats hold up to 20 *companions* per human, explicitly
  "multiple companions and group chats" for one user; no evidence of
  multi-human group chat. [search-aggregated from Kindroid Help Center
  content, https://kindroid.ai/docs/article/groupchats/]
- **Character.AI:** launched human-plus-AI group chat in 2023 (up to a
  stated participant cap including multiple humans), but "chatting with
  other human users isn't supported anymore" as of the 2026 state described
  in current guides, and the product has no documented persistent
  cross-conversation memory at all — "each new conversation starts fresh."
  [aggregated from Character.AI blog + 2026 how-to guides,
  https://blog.character.ai/new-feature-announcement-character-group-chat/]
  This is a case of a lab trying multi-human group chat with AI and
  apparently retreating from the human-to-human dimension.
- **Replika:** 2026 memory-dashboard update covers 1:1 personalization
  (name, job, interests, dates) with user-facing correction; no group-chat
  or cross-user claim found in this sweep. [aggregated reviews, no primary
  Replika source fetched — flagged as thin evidence]

---

## 5. Shapes ($8M seed, Lightspeed-led, ~400K MAU as of end-March 2026) — the closest positioning claim, with zero published mechanism

Shapes is the one product in this sweep explicitly positioned around
AI-in-a-group-of-friends rather than AI-plus-personas. Press coverage: "AI
Enters the Group Chat," $8M seed round, "first app where you can talk to AI
with friends," AI agents ("Shapes") behave as full group members
("look, feel and interact in all the same ways as humans can... can
actively decide whom to message and when, take actions and send memes"),
400,000+ MAU (6x from start of 2026), 13M+ engaged minutes in March 2026,
3M+ user-created Shapes. [GlobeNewswire press release,
https://www.globenewswire.com/news-release/2026/04/29/3283796/0/en/ai-enters-the-group-chat-startup-shapes-emerges-from-stealth-with-8m-seed-round-addresses-ai-psychosis-with-first-app-where-you-can-talk-to-ai-with-friends.html]

Shapes' own docs claim "persistent memory that develops across days, weeks,
months" and "a distinct personality that remains consistent across all
users" — language that implies the AI knows multiple humans in a shared
space. [docs.shapes.inc via aggregator,
https://docs.shapes.inc/articles/best-ai-companion-social-ai-apps] **But
this is marketing copy, not a technical spec.** Neither the press release
nor the docs page fetched in this sweep specifies: whether memory is
per-member or pooled across all participants without attribution, how
conflicting or contradictory information from different members is
resolved, any consent or disclosure mechanism for what gets said to whom,
or any architecture for provenance (who told the AI what). No judged
cross-member reference is described or demonstrated anywhere in the sourced
material — "consistent personality across all users" most plausibly reads
as persona-consistency (the AI acts the same way to everyone), not
disclosure-competence (the AI knows what's safe to relay between them).
This is flagged explicitly as **thin evidence: absence of a documented
mechanism is not proof none exists**, but it is the strongest public claim
found and it does not clear the bar. Deeper diligence (the linked
`docs.shapes.inc/llms.txt` full documentation was not fetched in this
sweep) would be needed before ruling Shapes in or out as a direct
competitor on this exact mechanism.

---

## 6. White-space search: startups building shared-memory-across-people AI

Explicit, hard search for anyone building the owner's mechanism turned up
nothing that matches. What exists instead:

- **Professional relationship-graph tools** (Connect The Dots / ctd.ai,
  Intriq) — map who-knows-who and warm intros from calendar/email/LinkedIn
  data. No AI companion role, no judged disclosure, not a
  companionship/relationship product.
- **Single-user memory infrastructure** (Mem0 — $24M Seed+Series A;
  Supermemory — $3M seed; Memoher; MemoryGraph) — these are memory *layers*
  for one user talking to one AI, explicitly not multi-human. Mem0's own
  material distinguishes "memory shared across different AI systems/agents"
  from "memory shared across users of the same assistant," and describes
  the latter, when it appears at all, as "common memory" that lets an
  assistant "retain and selectively reference information learned across
  interactions with multiple users" — closer to the target shape in
  concept, but sourced only from a search-engine synthesis of Mem0/industry
  blog content, not a fetched primary Mem0 document describing a shipped
  disclosure mechanism. **Flagged as the one lead worth a follow-up fetch**
  if this track is extended: mem0.ai's blog on cross-user memory
  architecture.
- **Human-led memory/legacy-sharing** (Elefantia, €1.05M seed) — storytelling
  and memory *preservation* between people, not an AI companion mediating
  live disclosure.
- **AgentCore-style infra** (AWS Bedrock AgentCore cross-channel identity) —
  unifies one user's identity across channels (WhatsApp/Instagram), not
  cross-*person* memory.

No entrant combines (a) one AI in ongoing 1:1 relationships with multiple
distinct humans, (b) a real shared/pooled memory store those relationships
write into, and (c) any documented rule for what gets disclosed across
members. This is the finding the assignment asked to check for, and it
came back empty across general search, companion-app-specific search, and
funding-database search.

---

## 7. The only work that touches the actual disclosure-control question is academic, small, and not a product

**"What should a robot disclose about me? A study about privacy-appropriate
behaviors for social robots"** (Frontiers in Robotics and AI / PMC,
https://pmc.ncbi.nlm.nih.gov/articles/PMC10757370/) — a lab vignette study,
n=155 (Prolific), presenting written scenarios and asking participants to
choose among four disclosure behaviors (full disclosure / abstracted /
non-verbal / no disclosure) for a robot deciding what to tell one person
about another. Verified findings (fetched primary source, methodology
readable):

- Relationship context is the dominant factor: participants accepted
  more disclosure toward family than toward friends or acquaintances
  (χ² = 57.4, p < 0.01).
- Preferences are graduated, not binary: 45% of participants used all four
  behavior options across scenarios rather than picking one rule.
- Sensitivity ranking didn't cleanly predict disclosure comfort — health
  information was approved for disclosure more than emotion information,
  despite being rated more sensitive by the same participants.
- No significant gender effect (all p > 0.05).
- Two population clusters: "unconcerned" (30%) and "concerned" (41%) about
  disclosure in general.
- Authors' own conclusion: **"no easy solution of privacy handling in
  social robotics applications exists,"** recommending systems capable of
  multiple nuanced disclosure behaviors rather than one fixed rule.

This is real, primary-sourced, methodologically legible evidence that (a)
disclosure judgment is genuinely hard and context-dependent — supporting
the owner's own framing that done wrong it's "a betrayal engine," not a bug
— and (b) as of this study, the field's engagement with the problem is a
155-person survey about hypothetical household robots, not an operating
system for it. No comparable empirical work was found aimed at chat/text
companion AI specifically, and none at the multi-relationship,
provenance-gated version the SPEC.md schema is built for (episodes
carrying WHO was present, citations gating what can be said).

Two adjacent papers were located but not fetched to primary text in this
pass (flagged, not verified): "Chatting with Confidants or Corporations?
Privacy Management with AI Companions" (arXiv:2601.10754 — PDF fetch failed,
binary/undecoded; only the search-snippet characterization is available:
users value AI companions partly *because* "they don't know my friends,"
i.e., users currently treat AI companions' isolation from their social
graph as a *feature*, which cuts directly against the owner's thesis and
deserves a real fetch before the architecture leans on it) and "The
Governance of Intimacy: A Preliminary Policy Analysis of Romantic AI
Platforms" (arXiv:2602.22000, not fetched). Both are flagged for follow-up,
not treated as verified here.

---

## Implications for the architecture / GTM (flagged, not my call to make)

- The Meta AI and OpenAI negative results are the two most load-bearing
  facts in this file: the two largest-distribution players in exactly this
  space *chose* to wall memory off from groups rather than share it. That
  is evidence either of (a) an unclaimed opportunity, or (b) a hazard they
  independently priced in (privacy/liability/complexity) and Vyakti should
  price in too. The file cannot adjudicate which; `decisions.md` already
  treats disclosure-safety as the gating condition for shipping the group
  layer at all, which is the correct read given (a) the reversal-condition
  logic already in place and (b) the one existing academic result showing
  disclosure judgment resists simple rules.
- The search-snippet claim that companion users value AI *because* it
  "doesn't know my friends" (if it verifies on a real fetch of
  arXiv:2601.10754) would be a direct, specific threat to the common-friend
  thesis's product-market fit assumption, not just an engineering risk —
  worth an explicit fetch-and-verify pass before the group layer is
  greenlit for user testing.
- Shapes is the nearest thing to a positioned competitor and merits a
  second, deeper look (its full docs, not just the marketing aggregator
  page) before anyone claims clean white space in an external pitch — the
  claim in this file is "no *published* mechanism," not "no one is building
  this."

---

## Sources (primary unless noted)

- Messenger Help Center — About sharing with Meta AI on Messenger:
  https://www.messenger.com/help/1093117295527969/About+sharing+with+Meta+AI+on+Messenger
- itechguides.com — Meta AI on WhatsApp: Features, Privacy and Limits in
  2026 (secondary, dated Aug 2026):
  https://www.itechguides.com/meta-ai-on-whatsapp-what-it-can-and-cant-do-in-2026/
- WhatsApp Blog — Introducing Incognito Chat with Meta AI:
  https://blog.whatsapp.com/introducing-incognito-chat-with-meta-ai-a-completely-private-way-to-chat-with-ai
  (Side Chat architecture corroborated via WABetaInfo/Deccan
  Herald/Engadget secondary reporting, search-snippet only)
  https://www.deccanherald.com/technology/artificial-intelligence/whatsapp-testing-private-side-chat-feature-with-meta-ai-4054926
- About Meta — Europe, Meet Your Newest Assistant (@MetaAI group mechanic):
  https://about.fb.com/news/2025/03/europe-meet-your-newest-assistant-meta-ai/
- Snapchat Support — How does My AI work in group chats?:
  https://help.snapchat.com/hc/en-us/articles/46434528038548-How-does-My-AI-work-in-group-chats
- OpenAI — Introducing group chats in ChatGPT:
  https://openai.com/index/group-chats-in-chatgpt/
- Nomipedia — How does group chat work?:
  https://wiki.nomi.ai/How_does_group_chat_work%3F
- Nomi.ai — Mind Map 2.0: https://nomi.ai/updates/mind-map-2-0-bringing-nomi-memory-into-view/
- Character.AI Blog — New Feature Announcement: Character Group Chat:
  https://blog.character.ai/new-feature-announcement-character-group-chat/
  (current 2026 state — human-to-human chat removed, no persistent
  cross-conversation memory — via secondary 2026 how-to guides,
  search-snippet only, not independently fetched)
- GlobeNewswire — AI Enters the Group Chat: Shapes $8M seed:
  https://www.globenewswire.com/news-release/2026/04/29/3283796/0/en/ai-enters-the-group-chat-startup-shapes-emerges-from-stealth-with-8m-seed-round-addresses-ai-psychosis-with-first-app-where-you-can-talk-to-ai-with-friends.html
- docs.shapes.inc — Best AI Companion & Social AI Apps (marketing copy, not
  technical spec; accessed via fetch of the docs page):
  https://docs.shapes.inc/articles/best-ai-companion-social-ai-apps
- PMC / Frontiers in Robotics and AI — What should a robot disclose about
  me? A study about privacy-appropriate behaviors for social robots (n=155,
  primary text fetched and verified):
  https://pmc.ncbi.nlm.nih.gov/articles/PMC10757370/
- arXiv:2601.10754 — Chatting with Confidants or Corporations? Privacy
  Management with AI Companions (NOT independently verified — PDF fetch
  failed to decode; characterization is from search-engine snippets only):
  https://academic.oup.com/jcmc/article/31/4/zmag014/8741679 (JCMC version)
  / https://arxiv.org/pdf/2601.10754
- arXiv:2602.22000 — The Governance of Intimacy: A Preliminary Policy
  Analysis of Romantic AI Platforms (not fetched, flagged for follow-up):
  https://arxiv.org/pdf/2602.22000
- Kindroid Help Center — Groupchats (secondary aggregation, not
  independently fetched): https://kindroid.ai/docs/article/groupchats/
- Search-aggregated, no primary fetch (thin evidence, flagged): Mem0 "common
  memory across users" characterization; Replika 2026 memory dashboard;
  Connect The Dots / Intriq relationship-graph products; Elefantia seed
  round; AWS Bedrock AgentCore cross-channel identity.
