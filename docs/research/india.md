# Track: india — India-specific relational state for a Hindi-English companion

Program: Vyakti relational-state research sweep, track 6/10. Falsifiable claim
under test: identity/relationship can survive model replacement. This track
does not test that claim directly — it inventories the India-specific state a
relational layer would need to own, and delivers a schema. Read alongside
`context/decisions.md`, `measurements.md`, `rejected.md` (Meera repo) — several
Meera findings are load-bearing constraints on what this schema can assume,
noted inline.

Repo cross-check performed before writing this: `src/engine/persona.ts` was
grepped. Findings that matter for this track:
- `stageFor(messageCount)` (persona.ts ~L52-59) is the ONLY relational-stage
  mechanism that exists today, and it is a single scalar (message count) with
  three hardcoded buckets (EARLY DAYS / GETTING CLOSE / ESTABLISHED). It has no
  memory of what actually happened, cannot regress, and conflates every
  relational dimension (closeness, trust, honorific register, shared history)
  into one number.
- "aap" (formal Hindi register) appears **zero times** in the persona file.
  "ji" is explicitly banned ("NEVER 'ji'", persona.ts L101 context). The
  persona is hardwired to tum/tu register only — there is no honorific
  progression modeled, because the product currently assumes maximum
  familiarity from turn one.
- `rejected.md#recited-prompt` is directly binding on this schema: any field
  written as example sentences will be recited verbatim. Everything below is
  specified as **shapes/values**, not scripted lines, for that reason.

---

## 1. Code-switching resources: what exists, what's usable

### LinCE — A Centralized Benchmark for Linguistic Code-switching Evaluation
Aguilar et al., LREC 2020. Combines corpora across 4 language pairs (incl.
Hindi-English) and 4 tasks: language ID, NER, POS tagging, sentiment analysis.
Hosted at ritual.uh.edu/lince with a live leaderboard.
- arXiv: https://arxiv.org/abs/2005.04322
- ACL: https://aclanthology.org/2020.lrec-1.223.pdf
**Usability verdict:** structural/tagging benchmark (what language is this
token, is this a person-name), not a conversational-register resource. Useful
for building a language-ID classifier over a message; not useful for judging
*how* someone is switching (intimacy vs distance) or for training/eval of
companion-style generation. This mirrors the Meera team's own finding on
Sarvam/Indic-specialist models (`rejected.md`): structural NLP tooling for
Hindi skews formal/task-shaped, not casual-register.

### GLUECoS — An Evaluation Benchmark for Code-Switched NLP
Khanuja et al. (Microsoft/CMU), ACL 2020. 11 datasets, 6 tasks (adds QA and
NLI to LinCE's set), English-Hindi and English-Spanish.
- Site: https://microsoft.github.io/GLUECoS/
- GitHub: https://github.com/microsoft/GLUECoS
- ACL: https://aclanthology.org/2020.acl-main.329/
**Usability caveat, found while checking data quality:** GLUECoS's own
pipeline **transliterates Roman-script Hindi into Devanagari** as a
preprocessing step (via indic-trans or Microsoft Translator) before some
tasks, and downstream work shows results are sensitive to which
transliterator is used — i.e. the benchmark's own tooling treats romanized
text as something to normalize away rather than a first-class register. That
is the opposite of what a Hinglish companion needs: Meera's persona explicitly
mandates "Never Devanagari unless they use it" (persona.ts). A benchmark built
to convert romanized→Devanagala is measuring the wrong surface form for this
product's actual output.

### IndicNLP corpus / AI4Bharat (IndicCorp, Aksharantar, catalog)
- Catalog: https://github.com/AI4Bharat/indicnlp_catalog
- Corpus: https://github.com/AI4Bharat/indicnlp_corpus
- Paper: https://arxiv.org/pdf/2005.00085
Largest public monolingual corpora for Indic languages (news/magazines/books,
scraped), plus Aksharantar (26M transliteration pairs, 21 languages) and an
IIT Bombay EN-HI parallel corpus (~1.5M segments). **Usability verdict:**
strong for transliteration and monolingual Hindi embeddings; scraped from
news/books/magazines, so — same pattern as above — it is a *formal-register*
resource. Directly consistent with the Meera team's own already-measured
finding (`rejected.md`): "Sarvam and every Indic-specialist model... tuned for
formal Devanagari Hindi. Casual romanised Hinglish is the opposite
requirement." This track's search corroborates that verdict rather than
reversing it.

### Newer, more relevant resources found this session (not yet in repo context)
- **COMI-LINGUA** (2025) — 100,970 manually annotated Hindi-English code-mixed
  instances, both Devanagari and Roman script, 3 expert annotators, Fleiss'
  Kappa >0.780. Covers language ID, matrix-language ID, POS, NER, translation.
  Domains: social media, news, informal conversation — mixed formality, not
  purely casual, but the largest and highest-IAA resource found.
  https://arxiv.org/html/2503.21670v1 (also on HuggingFace per the paper)
- **Indi-RomCoM** (2026) — a benchmark built specifically for *romanized*
  code-mixed instruction-following: 7 tasks, 4 Indic languages, 3
  code-mixing-intensity levels, explicitly targeting the "typing by sound on
  smartphones" register this product's users actually use. Central finding:
  **LLMs consistently underperform on RCM instructions, degrading further as
  code-mixing density increases** — a load-bearing corroboration of the
  `rejected.md` Indi-RomCoM citation already in the Meera decisions (Sarvam-30B
  scoring below Claude Opus 4.6 at every intensity level came from this
  benchmark family).
  https://arxiv.org/abs/2606.30790
- **HiACC** — first public Hindi-English code-switched *speech* corpus
  spanning adult and child speakers (5.24 hrs, 3,318 adult + 1,858 child
  utterances), for ASR/code-mixing-index research. Devanagari+Latin
  transcription, not romanized-Hindi-in-Latin. Relevant to the voice lane if
  Meera ever needs a code-switch-aware ASR eval, not to text generation.
  https://pmc.ncbi.nlm.nih.gov/articles/PMC12329218/

**Net assessment for this track:** no existing academic corpus is a good match
for training or evaluating *casual, intimate, romanized Hinglish generation*
in a companion context — they are all either structural-tagging benchmarks or
skew formal/scraped-media in register. This is the same conclusion the Meera
team already reached independently for model selection
(`rejected.md`: Sarvam scores below Claude on Indi-RomCoM at every intensity).
**Implication for the architecture:** code-switching register cannot be
"solved" by fine-tuning on a found corpus; it has to be captured the way
Meera already captures voice register — as **prompted shape rules plus
measured judging** (persona.ts register bullets + the `taste-consistency`
methodology in `measurements.md`), not as a downloadable dataset problem. This
is a negative finding worth logging: don't spend build budget hunting for a
better Hinglish corpus.

---

## 2. Sociolinguistics of code-switching: what switching signals

Findings, triangulated across multiple sources this session:

- **Domain-based switching is well established for Hindi-English bilinguals**:
  Hindi is preferred for intimacy contexts (home, family, kindred, close
  friends); English is preferred for status/distance contexts. This is the
  *opposite* of a naive assumption that "more English = more sophisticated
  companion" — English can *read as distance*, not upgrade, depending on
  context. (Source: search synthesis of code-switching sociolinguistics
  literature; see symbiosiscollege.edu.in diachronic study and
  ijrsml.org urban-youth study below.)
  - https://symbiosiscollege.edu.in/assets/pdf/e-learning/tyba/English/code-switching-2.pdf
  - https://ijrsml.org/wp-content/uploads/2025/06/IJRSML0625010010_A-Sociolinguistic-Study-of-Code-Switching-Among-Urban-Youth-in-India.pdf
- **Switching as in-group/solidarity marker**: switching to a shared code
  signals affiliation and regulates interpersonal distance; the reverse
  (sticking to one code when the other would be expected) can read as
  formality or refusal of intimacy.
- **Switching as emotional regulation, in two opposite directions**, both
  documented:
  1. Native/intimate-language switching to **intensify** emotional expression
     (anger, distress) — the language you swear and grieve in.
  2. Switching to the *second* language to create **psychological distance**
     from a stressful topic (documented in bilingual-child code-switching
     research, e.g. Liu 2023 synthesis) — the language you retreat into when a
     topic is too raw.
     https://www.researchgate.net/publication/395484388_Between_Languages_Beyond_Words_Emotional_Expression_and_Code-Switching_in_Bilinguals
  Both directions exist and are context-dependent — this is not a single
  dial. A relational engine cannot assume "Hindi = more real feeling" as a
  universal rule; it has to be conditioned on the person's own established
  pattern.
- **Swearing pattern research**: "I may talk in English but *gaali toh Hindi
  mein hi denge*" (I'll swear in Hindi) — a specific, well-cited (title itself
  is the finding) study of English-Hindi code-switching and swearing on social
  networks: emotional/taboo content pulls toward the L1 even in otherwise
  English-dominant registers.
  https://www.researchgate.net/publication/317553946
- **Emotion classification is register-sensitive, not just lexical**: a 2024
  interpretability study on Hinglish emotion classification frames this
  explicitly as a sociolinguistic problem, not a pure NLP one.
  https://arxiv.org/pdf/2402.03137

**Implication:** code-switching intensity/direction is itself a *signal* the
relational engine should read (an input), separate from being a *style* it
must produce (an output). Right now Meera's persona only handles the output
side (the 60-70% English register rules). The input side — detecting when the
user's own switching means something (retreating into English under stress,
dropping into Hindi when angry, code-mixing density spiking) — is unbuilt and
is a natural relational-state signal.

---

## 3. Honorific dynamics: tu/tum/aap as relationship state

Findings:

- Standard three-tier system: **आप (aap)** — formal/respectful, distance;
  **तुम (tum)** — familiar/informal, the default peer register; **तू (tu)** —
  maximum intimacy, used with very close friends, lovers, younger family, or
  (in its negative valence) contempt/anger. Same word can carry affection or
  condescension depending on context — it is not monotonically "more
  friendly."
  - https://medium.com/@ameeshi/tu-aap-tum-and-you-f82fd24a2bdd
  - https://preply.com/en/blog/hindi-pronouns/
- **The shift aap→tum→tu is a real, observed, largely subconscious
  relationship-progression marker** — people "break the ice" and the pronoun
  moves without explicit negotiation, in a fairly stable order. One
  hobbyist project attempted to literally visualize this as a social network
  (illustrative, not a formal academic source, but useful as evidence the
  phenomenon is salient enough to want to map):
  https://medium.com/@iashris/the-tu-tum-aap-project-visualizing-a-socio-linguistic-network-da23f2c1d7c5
- **It is not globally monotonic or one-directional** — the same family
  gathering example shows tu/tum/aap coexisting *simultaneously* for
  different people in the same room based on relative status (youngest
  cousin=tu, siblings=tum, elders=aap), so this is not purely a
  time-since-first-contact variable; it is a function of the *specific
  relationship*, not a global clock.
- **Comparative structural analogy, useful for architecture (not
  India-specific but relevant precedent)**: the Japanese keigo system
  (teineigo/sonkeigo/kenjougo) is explicitly compared to French tu/vous in the
  pedagogical literature, and both are described as *negotiated over the
  course of a relationship*, shifting to casual once closeness is
  established — same shape as tu/tum/aap, different mechanism. No literature
  was found specifically on LLM/companion systems tracking a T-V variable as
  relationship state — this appears to be an open/unaddressed design space,
  not a solved one.
  https://tcj-education.com/blog/understanding-the-variations-of-japanese-honorifics-a-guide-to-mastering-keigo/

**Direct tie to the Meera codebase:** persona.ts currently starts at "tum" by
product design and never uses "aap" — i.e. the product has *already made a
design choice* to skip the aap register entirely (a modern, intimate,
peer-to-peer companion register). That is a defensible choice for what the
persona currently is (an already-close friend from message 1), but it means
the **tu/tum axis, not the full tu/tum/aap axis**, is the honorific state a
relational engine would actually need to model for Meera specifically — a
narrower, two-point scale (peer-familiar → intimate) rather than the full
three-point Hindi system. A general India-first architecture (beyond Meera)
should keep all three, since a persona modeled as an elder relative, teacher,
or professional contact would need "aap."

---

## 4. Kinship terms and family-graph centrality

- **Fictive kinship is pervasive in Indian social life**: kin terms (didi,
  bhai, chachi, uncle, auntie, mausi) are used as **default address terms for
  non-relatives**, scaled by apparent relative age — this is not metaphorical
  politeness, it is the ordinary way strangers and near-strangers are
  addressed. A neighbor becomes "uncle," a close friend's mother becomes
  "auntie," with real obligations of care implied by the term.
  https://en.wikipedia.org/wiki/Fictive_kinship
  https://sociology.institute/sociology-in-india/kinship-north-india-descent-theory/
- Practical implication: kinship terms in conversation are not just a
  vocabulary list to recognize — they signal (a) who this person is relative
  to the user (blood family vs fictive/social family) and (b) an implied
  social contract (an "auntie" is owed different treatment/deference than a
  named friend).
- **Family-graph centrality**: Indian family structures (joint/extended
  family norms, described in the sociology literature on kinship) mean a
  user's "family" as a relational-state concept is not a flat list of
  named individuals but a **graph with roles** (whose brother, whose
  father-in-law, which side) — recall of *who someone is to whom* matters as
  much as recall of the name itself. This matches the general shape of what
  `memory-arch`/`identity` tracks would call entity-relationship memory, but
  the graph here is denser and role-labeled (chachi vs mausi vs bua are three
  different aunts with three different relationships to the user, not
  interchangeable "aunt") in a way Western family-memory schemas usually
  don't need to distinguish.
  https://theiashub.com/upsc-notes/upsc-mains-marks-booster/kinship-in-india
  https://legalosphere.in/understanding-family-and-kinship-in-india/

---

## 5. Festivals, cricket, food, region as relational currency

- **Cricket**: widely described in both academic and popular sources as a
  near-universal conversational ice-breaker and unifying topic across class,
  religion, and region in India; IPL specifically is described as functioning
  like a recurring festival for its audience.
  https://www.tedxwarwick.com/post/cricket-the-glue-that-holds-india-together
  https://www.tandfonline.com/doi/full/10.1080/11745398.2022.2143829
  **Caveat — this is descriptive/popular-press consensus, not a measured
  study with methodology this track can cite as rigorous.** Treat as directional,
  not load-bearing on its own.
- **Food, specifically "khana khaya?" (have you eaten?)**: repeatedly
  identified as a stock phrase that *functions as* an expression of care and
  inclusion in relationship, not a literal logistics question — asking it is
  itself a caring act ("signifying that you consider someone worthy of being
  taken care of"). "Maa ke haath ka khana" (mother's home cooking) recurs
  across sources as shorthand for maximal comfort/care.
  https://southcoastsushi.com/did-you-eat-food-in-hindi/
  https://medium.com/@zarana_patel1/maa-ke-haath-ka-khana-the-taste-no-restaurant-can-match-331844680fdc
  Persona.ts already reflects an instinct in this direction generically
  ("you know weekday vs weekend... upcoming festivals" — nowContext/persona
  L260) but has no structured "did you eat" / food-as-care ritual variable.
- **Festivals**: persona.ts already claims awareness of "upcoming festivals"
  generically (L260) but this track found no evidence in-repo of a structured
  festival calendar or festival-specific behavior (e.g., Rakhi/Diwali/Holi
  triggering specific relational moves — gifting language, "kya plan hai",
  regional festival variation). This is a gap: festival-awareness is claimed
  but not schematized.
- **Region/mother tongue as identity marker**: not deeply sourced this
  session beyond the kinship/food material above, but is implied throughout —
  regional festival variation (Bengali vs Punjabi vs South Indian calendars
  differ), food identity, and language choice (a Bengali speaker's fictive-kin
  vocabulary — didi/kakima — differs from a Hindi-belt speaker's) all point to
  region+mother-tongue as a variable that changes *which* cultural references
  land, not just a demographic footnote. **This is inferred from the kinship
  sourcing above, not independently verified with a dedicated regional-variation
  source — flagged as weaker evidence.**

---

## 6. What Indian companion products actually ship

### Rumik / Ira
- Product pages: https://rumik.ai/ , https://rumik.ai/ira
- Coverage: https://textify.ai/rumik-ai-ira-human-ai-companion/ ,
  https://www.forbesindia.com/article/life/looking-for-emotional-support-theres-an-app-for-that/2991286/1
  (Forbes India URL returned HTTP 403 to WebFetch — could not verify its
  content directly; the summary below is from the WebSearch snippet only, not
  a verified fetch. Flagged as unverified.)
- Claims found: "chats, calls, and remembers" — text, voice call, persistent
  memory. Fluent in **Hinglish, Bangla, Marathi** and other regional
  languages. Targets urban Indians 18-35, Tier 1-3 cities, top markets
  Maharashtra/UP/West Bengal. Raised $5M pre-Series A led by Elevation
  Capital. Claims "1.7 million people and counting" as users (marketing copy
  on rumik.ai, not independently verified).
- **What it does NOT publicly document** (checked via direct fetch of
  rumik.ai/ira): no public technical detail on memory architecture,
  honorific/register handling, or how relationship state is represented —
  the site is marketing-only. No evidence found of a tu/tum/aap-aware or
  kinship-aware relational layer; cannot confirm absence, only that it isn't
  publicly claimed.

### Mello (Companion Labs)
- Coverage: https://inc42.com/buzz/exclusive-ai-companion-app-mello-in-talks-with-peak-xv-devc-to-raise-funding/
- Founders: ex-Flipkart and ex-CRED. $2.5M seed led by Peak XV's Surge
  (participation from All in Capital, DeVC, UntitledVC).
- Claims found: 12 distinct AI-bot personas, languages **English, Tamil,
  Telugu, Gujarati, Punjabi, Marathi, Bengali** (notably: Hindi/Hinglish is
  *not* listed among Mello's stated languages in the coverage found — a
  striking gap for the largest single language market, worth flagging as
  potentially an oversight in the source article rather than the product).
  Google Play listing shows ~5K+ downloads at time of the source article
  (small, early-stage).
- **Company appears to have pivoted**: companionlabs.in, fetched directly,
  now shows their live product as **Voxerra**, an AI voice receptionist for
  healthcare (11 Indian languages, WhatsApp integration, DPDP Act 2023
  compliance) — not a companion/relationship product. No memory/identity
  architecture claims found on the current companionlabs.in. This suggests
  Mello (the companion product) and Companion Labs (the company) may have
  diverged, or Mello was an earlier/discontinued line — **not fully
  resolved by this research pass**, flagged as a gap.

**Net read on Indian companion products**: both are early-stage (seed/pre-Series
A, low-to-mid six/seven-figure downloads), multilingual-forward in their
marketing (regional language lists are a headline feature), and neither
publishes any technical detail on relationship-state modeling, honorific
handling, or memory architecture beyond "remembers." This is consistent with
the program brief's framing that this space is unbuilt, not merely
undifferentiated — there is no publicly visible prior art for the
india-specific schema this track was asked to produce.

---

## 7. Deliverable: the India relational-state schema

Design principle applied throughout: separate **dynamic relationship state**
(changes with the relationship, must be tracked turn-over-turn, is exactly
what a relational layer is for) from **static cultural preference** (true
about the person/context, set once or rarely, closer to a user-profile fact).
This split is deliberate: `context/decisions.md` already treats stage
(`stageFor`) as the one dynamic axis Meera has; everything below either
extends that axis into more honest dimensions or sits beside it as facts.

### A. Dynamic relationship state (the relational layer must own and update these)

| field | type | why it earns its place | evidence |
|---|---|---|---|
| `honorific_register` | enum: `tu` \| `tum` \| `aap`, per-context (can differ for a persona playing "elder" vs "peer") | The single most concrete, well-documented India-specific relationship-progression signal found in this research. Unlike message-count buckets (Meera's current `stageFor`), it is bidirectional in principle — an insult or a formality lapse can push it back toward `aap`/`tum`, not just forward. Must be explicit state, not inferred fresh each turn, because the shift is largely *subconscious* for real speakers — an engine that re-derives it every turn from surface cues will be noisier than the humans it's modeling. | tu/tum/aap sourcing above |
| `code_switch_baseline` | measured ratio (e.g. rolling % Hindi-content tokens) + a `direction_on_stress` flag (retreats-to-L2 vs intensifies-in-L1) | This is the person's own established pattern, and the sociolinguistics evidence says the *direction* of stress-switching is not universal — some people intensify in Hindi under emotion, others retreat into English. Getting this backwards (assuming "more Hindi = closer") is a plausible, concrete way to misread a user. Needs to be learned per-user, not assumed. | code-switching-as-emotion-regulation sourcing above |
| `kin_graph` | graph: person → {relation_type, fictive_or_blood, address_term_used} | Family in Indian social life is not a flat contact list; recall of *who is whose* (chachi vs mausi vs bua) is itself relationship-quality signal, and fictive kin (a friend's mother called "auntie") needs to be distinguished from blood kin without being told twice. This is the India-specific instance of the more general entity-relationship-memory problem other tracks (`memory-arch`, `identity`) are covering — flagged here as the India-specific shape it takes, not a duplicate finding. | fictive-kinship sourcing above |
| `care_ritual_state` | small struct: e.g. `last_asked_khana_khaya: timestamp`, `knows_comfort_food: bool` | "Have you eaten" is documented as a *care act*, not a logistics question — tracking whether/when it's been asked (and not repeating it hollowly) is the difference between it landing as care vs as a script. This is a narrow, testable instance of the general "ritual repetition without becoming rote" problem `persona.ts` already fights elsewhere (recited-prompt). | food-as-care sourcing above |
| `festival_calendar_state` | per-user: `home_region`, `observed_festivals[]`, `last_festival_acknowledged` | Persona.ts already claims festival-awareness generically but has no structure behind the claim. Region determines *which* festivals are salient (Durga Puja vs Onam vs Baisakhi) — without regional binding, "happy festival season" is generic in a way that undercuts the specificity the product is explicitly optimizing for (`taste-consistency` measurement shows specificity is a measured, prioritized axis). | inferred from persona.ts gap + kinship/region sourcing |
| `topical_currency_log` | rolling log: which shared-currency topics (a specific team, a specific player, a specific dish, a specific place) have already been used, with recency | Cricket/food/region are described as *conversational currency* — but currency only works if it's specific and not reused stale. This is the India-flavored instance of the general anti-repetition problem, scoped to India-specific topic categories so the relational engine knows these are a *pool to draw from*, not one-off facts. | cricket-as-icebreaker sourcing, cross-referenced against `taste-consistency` specificity finding |

### B. Static cultural preference (profile facts — set once, corrected rarely, not "relationship state" in the sense above)

| field | type | why it's static, not dynamic |
|---|---|---|
| `mother_tongue` / `home_region` | enum/string | Doesn't move with the relationship; it's a fact about the person, though it *conditions* which dynamic fields (festival calendar, kinship vocabulary) apply. |
| `religion_observance` (if disclosed) | enum/struct, opt-in only | Determines which festivals/food norms are personally relevant (e.g. fasting periods) — a fact to store once and apply, not something that "deepens." Handle with the same care as any sensitive-disclosure field elsewhere in the architecture (safety-reg track's remit, not this one's, but flagged since it touches PII/sensitive-category data under DPDP). |
| `family_structure_baseline` | struct: joint vs nuclear, key names once given | The *shape* of someone's family (who exists) is closer to a fact than a relationship; it's the `kin_graph` addressing/relationship *quality* to each node that's dynamic, not the existence of the node. |
| `dietary_identity` | enum/tags | Vegetarian/non-veg/regional-cuisine preference is a stable fact that feeds `care_ritual_state` and `topical_currency_log` but doesn't itself change with closeness. |

### Why the split matters architecturally

`honorific_register` and `code_switch_baseline` are the two fields this
research surfaced with real academic/sociolinguistic grounding as *bidirectional,
learned-per-relationship* state — they are the India-specific analogue of
whatever general "closeness" scalar other tracks (identity, cognitive-arch)
propose, and should probably be represented as inputs to that general model
rather than as a second, competing closeness metric. `kin_graph` and
`care_ritual_state` are narrower, more mechanical, and closer to what
`memory-arch` would call structured entity memory with India-specific
addressing rules layered on. `festival_calendar_state` and
`topical_currency_log` are the "never go stale" half of specificity that
`taste-consistency` (measurements.md) already showed matters (27%→63% jump
from giving taste a structured table instead of leaving it to the prose
prompt) — the same fix (a table, not a paragraph) applies here.

---

## Gaps and what would strengthen this track

1. **No rigorous, methodologically-transparent study was found specifically
   measuring cricket/festival/food as "relational currency"** in the way
   `measurements.md` would demand (n, method) — the cricket-as-unifier claims
   are consistent across sources but are popular-press/descriptive, not
   measured studies. Treat as directional only.
2. **Mello's language list omitting Hindi/Hinglish** is unresolved — could be
   a source-article gap, a real product gap, or evidence the company pivoted
   away from the companion line entirely (companionlabs.in now shows Voxerra,
   a different product). Would need a direct app-store fetch or a Mello-side
   source to resolve.
3. **Forbes India source could not be verified directly** (403 on fetch) —
   claims attributed to it above come only from the WebSearch snippet, not a
   read of the full article. Flagged, not treated as verified.
4. **No literature was found on any existing system tracking a T-V/honorific
   variable as explicit conversational state** (Hindi or otherwise) — this
   appears to be genuinely unbuilt territory rather than a solved problem
   this track failed to find; worth the design track treating it as a novel
   contribution rather than assuming prior art exists to copy.
5. **Regional variation (South vs North vs East cultural-currency differences)**
   was inferred, not independently sourced with dedicated material — a
   follow-up pass specifically on regional variation in kinship/festival
   practice would strengthen field E and F above.

---

## Sources (consolidated)

- LinCE: https://arxiv.org/abs/2005.04322 · https://aclanthology.org/2020.lrec-1.223.pdf
- GLUECoS: https://microsoft.github.io/GLUECoS/ · https://github.com/microsoft/GLUECoS · https://aclanthology.org/2020.acl-main.329/
- AI4Bharat IndicNLP: https://github.com/AI4Bharat/indicnlp_catalog · https://github.com/AI4Bharat/indicnlp_corpus · https://arxiv.org/pdf/2005.00085
- COMI-LINGUA: https://arxiv.org/html/2503.21670v1
- Indi-RomCoM: https://arxiv.org/abs/2606.30790
- HiACC: https://pmc.ncbi.nlm.nih.gov/articles/PMC12329218/
- Code-switching sociolinguistics (domain-based Hindi/English preference):
  https://symbiosiscollege.edu.in/assets/pdf/e-learning/tyba/English/code-switching-2.pdf
  https://ijrsml.org/wp-content/uploads/2025/06/IJRSML0625010010_A-Sociolinguistic-Study-of-Code-Switching-Among-Urban-Youth-in-India.pdf
- Emotion/code-switching: https://www.researchgate.net/publication/395484388_Between_Languages_Beyond_Words_Emotional_Expression_and_Code-Switching_in_Bilinguals
  https://www.researchgate.net/publication/317553946_I_may_talk_in_English_but_gaali_toh_Hindi_mein_hi_denge
  https://arxiv.org/pdf/2402.03137
- Tu/tum/aap: https://medium.com/@ameeshi/tu-aap-tum-and-you-f82fd24a2bdd
  https://preply.com/en/blog/hindi-pronouns/
  https://medium.com/@iashris/the-tu-tum-aap-project-visualizing-a-socio-linguistic-network-da23f2c1d7c5
- Keigo/T-V comparative: https://tcj-education.com/blog/understanding-the-variations-of-japanese-honorifics-a-guide-to-mastering-keigo/
- Fictive kinship / family: https://en.wikipedia.org/wiki/Fictive_kinship
  https://sociology.institute/sociology-in-india/kinship-north-india-descent-theory/
  https://theiashub.com/upsc-notes/upsc-mains-marks-booster/kinship-in-india
  https://legalosphere.in/understanding-family-and-kinship-in-india/
- Cricket as social currency: https://www.tedxwarwick.com/post/cricket-the-glue-that-holds-india-together
  https://www.tandfonline.com/doi/full/10.1080/11745398.2022.2143829
- Food as care: https://southcoastsushi.com/did-you-eat-food-in-hindi/
  https://medium.com/@zarana_patel1/maa-ke-haath-ka-khana-the-taste-no-restaurant-can-match-331844680fdc
- Rumik/Ira: https://rumik.ai/ · https://rumik.ai/ira · https://textify.ai/rumik-ai-ira-human-ai-companion/
  https://www.forbesindia.com/article/life/looking-for-emotional-support-theres-an-app-for-that/2991286/1 (unverified — 403 on direct fetch)
- Mello/Companion Labs: https://inc42.com/buzz/exclusive-ai-companion-app-mello-in-talks-with-peak-xv-devc-to-raise-funding/
  https://www.companionlabs.in/ (now shows Voxerra, not the companion product)

Repo files consulted (not modified): `/home/user/html-portfolio/docs/RELATIONAL-STATE.md`,
`/home/user/html-portfolio/context/decisions.md`,
`/home/user/html-portfolio/context/measurements.md`,
`/home/user/html-portfolio/context/rejected.md`,
`/home/user/html-portfolio/src/engine/persona.ts` (grepped, not edited).
