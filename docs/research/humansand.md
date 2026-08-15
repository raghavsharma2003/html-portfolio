# Research: "humanand.ai" — existence, findings, and takeaways for Vyakti

Grounded against `context/decisions.md#relational-state` (the falsifiable claim:
identity/relationship can survive a model swap; north star = migration fidelity
× retention) and `context/decisions.md#multiparty-direction` (common-friend-to-a-group,
disclosure control as the research core, provenance-gated retrieval).

## 1. Existence verdict

**The domain the owner typed, `humanand.ai`, does not resolve — `curl` and DNS
both fail (`getaddrinfo ETIMEOUT humanand.ai`, checked 2026-08-15).** It is not
a parked page; it is not registered to anything reachable. The owner's spelling
is off by one character.

**What exists is `humansand.ai` — the company "humans&" (styled with an
ampersand, read "humans and").** This is a real, well-documented, heavily
funded company:

- Homepage fetched directly (curl, 2026-08-15, HTTP 200): https://humansand.ai/
- TechCrunch, Jan 20 2026: https://techcrunch.com/2026/01/20/humans-a-human-centric-ai-startup-founded-by-anthropic-xai-google-alums-raised-480m-seed-round/
- Forbes, Oct 31 2025 (pre-launch fundraising report): https://www.forbes.com/sites/annatong/2025/10/31/xai-researcher-early-googler-in-talks-to-raise-1-billion-at-5-billion-valuation-for-new-frontier-lab/
- Reworked.co: https://www.reworked.co/collaboration-productivity/humans-bets-480m-that-ai-can-be-human-centric/
- Company X/Twitter: https://x.com/humansand
- Crunchbase profile exists but blocked fetch (403 via WebFetch — not independently verified beyond the search-snippet level; **flagged thin**): https://www.crunchbase.com/organization/humans-36f3
- Grokipedia page exists but also 403'd on fetch — **not used as a source below, flagged thin, cite only if independently corroborated.**

Verdict: this is very likely the company the owner meant. Recommend flagging
the spelling correction back (`humansand.ai` / "humans&", not `humanand.ai`).

## 2. What they actually do

### Public self-description (primary source: homepage, fetched directly)

Full text of the founding post, dated January 20, 2026, verbatim from the site:

> "No one changes the world alone. AI models are rapidly learning to reason
> better, code faster, and take actions in the world with increasing autonomy.
> But for humans, progress happens when we understand one another, build
> trust, make connections, and work together. That is where we believe the
> next chapter of AI should begin.
>
> Today we introduce humans&, a human-centric frontier AI lab. We believe AI
> can be reimagined, centering around people and their relationships with each
> other. At its best, AI should serve as a deeper connective tissue that
> strengthens organizations and communities.
>
> This requires rethinking everything about how we train models at scale and
> how people interact with AI. This needs innovations in long-horizon and
> multi-agent reinforcement learning, memory, and user understanding. At
> humans&, we will tightly integrate science and product development to drive
> this new paradigm."

No product screenshot, no app, no waitlist link on the homepage as of the
fetch. The only calls to action are a careers link
(https://jobs.ashbyhq.com/humans-and) and a follow-us-on-X link. **There is no
shipped consumer product visible anywhere in this research** — searches for a
launched app, waitlist, or Product Hunt listing returned nothing (2026-08-15).
This reads as a pre-product, seed-stage research lab, not a live consumer
companion app.

### Positioning: B2B/collaboration-flavored, not companion/romantic

Secondary reporting (Reworked.co, citing Zelikman) frames the target
explicitly around **human-to-human collaboration**, not human-AI companionship:
"software enabling human collaboration through AI... an AI version of an
instant messaging app that helps people work together more effectively."
Zelikman is quoted (via Reworked.co, thin — single secondary source, no
primary quote found) describing current AI as trapped in a "task-centric
trap" that prioritizes reasoning over "the emotional intelligence required for
human collaboration," and the article notes a structural tension the company
itself flags: "collaboration always becomes automation" once enterprise cost
metrics dominate.

The technical focus areas named on their own homepage — "long-horizon and
multi-agent reinforcement learning, memory, and user understanding" — overlap
with Vyakti's problem space in *mechanism* (memory, multi-agent/multi-party) but
the stated *use case* is organizations/communities/collaboration, not a
one-on-one romantic/companion relationship. Nothing in any source ties them to
dating, romance, or a girlfriend-style companion product — a direct web search
for "humans& companion romantic dating" returned zero hits connecting the two
(2026-08-15).

### The "stranger problem"

Forbes (Oct 31 2025, pre-funding-close report) is the one place this framing
appears: Zelikman describes the core problem as AI interactions feeling like
"repeatedly meeting someone new because models lack long-term memory and fail
to learn users' values or ambitions." This is close in spirit to
`relational-state`'s framing (identity/relationship should survive model
churn) but Forbes gives no technical detail on how they intend to solve it —
**no mechanism, no architecture, no eval is described anywhere in the press
coverage.** Flagged: this is journalist paraphrase of a founder interview, not
a technical claim from the company itself.

## 3. Published research — what's actually there

The homepage links to exactly **one** blog post
(https://humansand.ai/blog/nvfp4-rl.html, "The 4-bitter Lesson: Balancing
Stability and Performance in NVFP4 RL," by Ziang Li, dated July 10, 2026 —
fetched directly, full text read). This is the entirety of their public
technical output as of this research.

**What it's actually about:** low-level GPU training infrastructure for RL —
specifically, how to run reinforcement learning training in 4-bit floating
point (NVFP4) without the gradient instability that naive quantization causes.
Contents, summarized from the primary source:

- A baseline recipe that quantizes only MoE-layer weights/activations to
  NVFP4 (forward pass) while keeping the backward pass in BF16, because MoE
  experts are ~97% of parameters in DeepSeek-V3-style architectures.
- "Dequantized backward" — running the backward pass on the BF16-dequantized
  value of the exact quantized forward-pass tensor, to fix a chain-rule
  inconsistency that was causing gradient-norm spikes.
- "Four-over-six" (4/6) quantization — an adaptive block-scaling technique
  (credited to an external paper, "Four Over Six: More Accurate NVFP4
  Quantization with Adaptive Block Scaling," Cook et al.) applied to RL
  weights, with a bit-exact-across-trainer-and-sampler implementation
  requirement specific to async RL.
- Selective higher-precision layers (final 15% of layers, the always-active
  "shared expert" in MoE) — cheap insurance where quantization error hurts most.
- A "pleasant side effect": the same rollout-quantization path doubles as an
  online post-training quantization method for serving, with .924 correlation
  between FP8 and NVFP4 deployment on an internal GLM-5.1-as-judge multi-turn
  benchmark.
- Everything describ ed is open-sourced across TransformerEngine, FlashInfer,
  SGLang, in collaboration with NVIDIA and "RadixArk."

**This post contains zero content about relational memory, disclosure,
persona design, multi-party dynamics, retention, or any consumer-facing
technique.** It is pure ML-systems/RL-infra work. The single line connecting
it to their mission is the closing metaphor: "in our company, we focus on the
dynamics of the interactions between people and models" — asserted, not
demonstrated.

## 4. Team, funding, traction

All from TechCrunch (Jan 20 2026) and Forbes (Oct 31 2025), cross-checked
against the company's own homepage investor list (primary source, fetched
directly) where it overlaps:

- **Founded:** ~September 2025 (per TechCrunch, "three months old" as of the
  Jan 2026 article). Public launch post-dated Jan 20, 2026.
- **Founders (from the homepage's own "we" language plus press):** Eric
  Zelikman (CEO, ex-xAI, co-author of STaR/Quiet-STaR; personal site
  https://zelikman.me/), Noah Goodman (Stanford CS/psych professor, Zelikman's
  PhD advisor), Andi Peng (ex-Anthropic, RL/post-training on Claude 3.5–4.5),
  Georges Harik (Google's 7th employee, lead seed investor via SV Angel),
  Yuchen He (ex-xAI), and Ray Ramadorai (named as co-founder in one search
  snippet — not corroborated on the homepage itself, **flagged thin**).
- **Team size:** ~20 employees per TechCrunch, drawn from OpenAI, Meta,
  Reflection, AI2, Stanford, MIT in addition to the founders' own Anthropic/
  xAI/Google DeepMind backgrounds (self-described on homepage).
- **Funding:** $480M seed at a $4.48B valuation, closed and announced Jan 20,
  2026 (TechCrunch, Yahoo Finance, AIBusiness, Techstrong.ai, Crunchbase News
  all independently report the same figures — well-corroborated). Forbes'
  Oct 31 2025 piece had reported the round as "in talks," targeting $1B at a
  $5B valuation — the actual close ($480M / $4.48B) came in lower than the
  reported target, worth noting as a data point, not spin.
- **Investors (primary source — homepage):** led by SV Angel and co-founder
  Georges Harik; NVIDIA, Jeff Bezos, GV, Emerson Collective, Forerunner, S32,
  DCVC, Human Capital, Liquid 2, Felicis, CRV, plus a long tail of funds and
  individual angels (Anne Wojcicki, Marissa Mayer, Thomas Wolf, Igor
  Babuschkin, Logan Kilpatrick, others).
- **Product traction:** none found. No shipped app, no waitlist, no user
  numbers, no revenue signal in any source as of 2026-08-15.

## 5. THE POINT — what Vyakti can take, mapped against what we have

**Directly usable technique (low confidence it matters at our scale, but
real):** the NVFP4/RL quantization recipe is a training-infra optimization
for large-scale RL post-training of frontier-size models on NVIDIA hardware.
Vyakti's stack (per `context/architecture.md`) runs on OpenRouter/Azure-hosted
third-party models (Gemini, Grok) — **we do not train or RL-tune base models
ourselves**, so this specific technique has no near-term application. It's
useful only as a signal of what humans& is actually capable of executing
technically (serious, credible systems-ML engineering) versus what they've
demonstrated on the relational/product side (nothing yet, publicly).

**Nothing transferable on the actual contested ground.** Cross-checking their
one published artifact against our real assets:

| Vyakti asset (from `context/`) | humans& public evidence of equivalent work |
|---|---|
| Citation-enforced memory, 4-layer enforcement ladder (`spec-c-minimal`) | None published |
| Disclosure control / provenance-gated retrieval for groups (`multiparty-direction`, `structural-disclosure`) | None published — their homepage names "multi-agent RL" and "user understanding" as goals but gives zero mechanism |
| Persona-recitation findings (own-example quotes get parroted; position-as-mechanism for rule placement) | None published — no persona/prompt-design research at all |
| The D-battery / swap-test methodology (migration fidelity across model swaps) | None published — their "stranger problem" framing gestures at the same problem Zelikman names in a press quote, but no eval design has been shown |

So: **there is nothing to take from them on the relational-engine,
disclosure-control, or persona-stability fronts, because they haven't
published anything there.** The one thing worth taking is the *practice*, not
the content: they open-source infra work in detail with reproducible numbers
even when it's not their core differentiator, which is a credibility move
worth noting for how Vyakti could eventually publish (if we ever want a
research-credibility play alongside the product).

**Market/positioning lesson:** their framing — "AI as connective tissue for
organizations and communities" — is adjacent to but distinct from
`multiparty-direction`'s framing (AI as *common friend* to a group: couple,
family, friend circle). Theirs reads B2B/collaboration-tool-shaped (per
Reworked.co's "instant messaging app" analogy and the "collaboration becomes
automation" tension they themselves flag); ours is explicitly personal/
relational (dyadic companion first, group layer for existing intimate social
graphs, disclosure control modeled on Petronio's boundary-turbulence theory
per `structural-disclosure`). Worth logging as a decision-adjacent data point:
if a $4.48B-valuation lab with this pedigree is choosing the enterprise/
collaboration wedge over the companion wedge, that's either (a) evidence the
companion wedge is underpriced/open, or (b) evidence they see something in
enterprise we should sanity-check we're not missing. No strong signal either
way from public sources — worth a line in `decisions.md` if the owner wants
it logged, not a verdict this research can supply on its own.

## 6. Competitor assessment

**Not a direct competitor to Vyakti today, on current public evidence.**
Reasoning:

1. **No shipped product.** Zero traction signal anywhere. A pre-product,
   ~20-person, seed-stage research lab three quarters old cannot be a
   competitor in the market sense yet, whatever its valuation.
2. **Stated target is different.** Their own words are "organizations and
   communities" / collaboration tooling; ours is a personal companion
   relationship (Meera) extending to intimate social groups (couple, family,
   friend circle) per `multiparty-direction`. These are adjacent but not the
   same buyer or the same relationship shape — a coworker-facing "connective
   tissue" tool and a girlfriend-shaped AI a WhatsApp group of friends shares
   are different products even if both chase "AI that understands people's
   relationships."
3. **Overlapping thesis, not overlapping mechanism.** The "stranger problem"
   (memory should survive/persist, relationship should compound) is
   philosophically identical to `relational-state`'s central falsifiable
   claim. That's a real overlap worth tracking — if they publish a memory or
   multi-agent architecture paper, that's the one to read closely, since their
   team (Zelikman/Goodman on reasoning and cognitive modeling, Peng on RL/
   post-training) is credible enough that a future publication could leak
   real technique. **Nothing they've shown yet does this** — today's overlap
   is thesis-level, not implementation-level.

**Threat level: LOW today, WATCH going forward.** Specifically watch for: (a)
any published memory/multi-agent architecture work — that team can execute;
(b) any pivot of their product surface toward consumer/companion rather than
enterprise collaboration, given a Stanford cognitive-science co-founder
(Goodman) and a "relationships" framing that could drift personal; (c) their
capital ($480M) meaning they can outspend on compute for exactly the kind of
long-horizon multi-agent RL training Vyakti cannot afford to do from scratch.

## 7. What they got wrong or left open (exploitable)

- **The gap between mission language and shipped evidence is total.** The
  homepage promises "reimagining AI around people and their relationships,"
  but the only artifact backing that claim is a GPU-quantization paper with no
  relational content. If the owner wants a one-line pressure-test: *ask what
  in their public output demonstrates the relational claim, and the honest
  answer today is nothing does.* Vyakti's `context/` — measured numbers,
  named rejections, falsifiable reversal conditions — is a sharper
  evidentiary posture than anything humans& has shown publicly, even accounting
  for the fact that we're comparing an internal research log to a company's
  external-facing communications (not a fully fair comparison, but the
  *content* asymmetry — they have zero relational-mechanism content public,
  we have a whole falsification framework — is real).
- **No mention of disclosure control, privacy-in-groups, or the
  betrayal-engine failure mode** that `structural-disclosure` treats as the
  central hazard of any multi-party "AI knows everyone" system. If they build
  toward "connective tissue for organizations and communities" without solving
  this, it's a specific, nameable place they can get burned publicly (a
  "common friend" that leaks is the same trust failure in an enterprise
  context as in ours) — and a place Vyakti's provenance-gated retrieval
  mechanism (episodes carry WHO-was-present, ACL computed from participants)
  is already ahead on a designed, if not yet fully validated, solution.
- **No eval methodology published for the "stranger problem"/memory claim** —
  no equivalent of a swap test, no migration-fidelity metric, nothing like the
  D-battery. If they publish first, whatever eval they publish is worth a
  close read against our own; if we publish first (with real measured
  numbers, which `context/measurements.md` already has some of), that's a
  credibility edge while their team is still pre-product.

## Sources (all consulted 2026-08-15 unless noted)

- https://humansand.ai/ — homepage, fetched directly via curl, HTTP 200, primary source
- https://humansand.ai/blog/nvfp4-rl.html — the one blog post, fetched directly, primary source
- https://techcrunch.com/2026/01/20/humans-a-human-centric-ai-startup-founded-by-anthropic-xai-google-alums-raised-480m-seed-round/
- https://www.forbes.com/sites/annatong/2025/10/31/xai-researcher-early-googler-in-talks-to-raise-1-billion-at-5-billion-valuation-for-new-frontier-lab/ (dated Oct 31 2025; pre-close reporting)
- https://www.reworked.co/collaboration-productivity/humans-bets-480m-that-ai-can-be-human-centric/
- https://finance.yahoo.com/news/humans-human-centric-ai-startup-160057256.html (corroborating funding figures)
- https://techstrong.ai/features/ai-startup-humans-a-believer-in-humans-raises-480-million-at-4-48-billion-valuation/ (corroborating funding figures)
- https://news.crunchbase.com/ai/humans-raises-huge-seed-round-unicorn-valuation/ (corroborating funding figures)
- https://x.com/humansand — company account, not independently fetched (WebFetch blocked), used only as a link target, not a cited claim
- https://zelikman.me/ — Eric Zelikman's personal site, linked for bio context, not fetched for content
- **Not used / flagged thin:** Crunchbase org profile and Grokipedia page — both returned HTTP 403 on fetch; any figures attributed to them elsewhere in this doc are marked thin inline and were corroborated only via search-result snippets, not primary reading.
- `humanand.ai` — does not resolve (curl: `getaddrinfo ETIMEOUT humanand.ai`), confirming the owner's exact spelling has no live target.
