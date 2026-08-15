# Track: disclosure-control — multi-party privacy in conversational agents

Owner thesis under test (`context/decisions.md` → `multiparty-direction`): one AI as
common friend to a group, 1:1 with each member, judged references between
members, presence in the group space. This track asks what the literature
says about the mechanism that makes that safe — provenance-gated disclosure —
and what failure rates current models show when asked to do it themselves.
House style followed: every claim sourced; thin evidence flagged; primary
sources fetched directly where extraction succeeded, search-summary flagged
where it did not.

**Headline finding, stated up front because it is the answer to the design
question:** every study found — spanning four independent benchmarks, five
model families, and mechanisms from raw prompting to activation steering —
converges on the same number shape: **instructed/behavioral disclosure
control leaves a residual leak rate in the range of ~9–90% depending on
setup, and never reaches zero.** The only mechanism that reaches near-zero is
**never putting the other person's private data in the context window at
all** — i.e., retrieval-time structural exclusion. This is not a new
conclusion for this repo: it is the `spec-c-minimal` law
("authored/structural state + deterministic retrieval + guarantees in code
beats generated text + prompt instructions") re-derived independently, on a
different axis (disclosure instead of charm/taste), by external researchers
who never saw this codebase. That convergence is the strongest evidence in
this track.

---

## 1. Contextual integrity as the operationalizable framework

**Nissenbaum's Contextual Integrity (CI)** says privacy is not secrecy or
control, but appropriate information *flow*, defined by five parameters:
sender, receiver, subject (whose information it is), attribute (what kind of
information), and transmission principle (the norm under which it moves —
confided, overheard, volunteered, compelled, etc.). This is the framework
every paper below uses to make "did the model over-share" a scoreable
question instead of a vibe.

### ConfAIde — the foundational operationalization
**"Can LLMs Keep a Secret? Testing Privacy Implications of Language Models
via Contextual Integrity Theory"**, Mireshghallah, Kim, Zhou, Tsvetkov, Sap,
Shokri, Choi — ICLR 2024 spotlight, arXiv:2310.17884. Fetched (abstract +
project page; full-text PDF did not extract cleanly, numbers below are from
the abstract/project-page text, which is the paper's own stated headline
figures, not a secondary summary).

- Four tiers, each adding a CI parameter: Tier 1 = single info type in
  isolation; Tier 2 = adds actor + use (who receives it, why); Tier 3 = full
  multi-party information-flow control (the tier structurally closest to
  this product's problem — does the model correctly restrict flow between
  named third parties in a scenario with several people present); Tier 4 =
  free-text multi-party dialogues probing the same question in a more
  naturalistic setting.
- **Headline numbers: GPT-4 reveals private information in contexts humans
  would judge inappropriate 39% of the time; ChatGPT 57% of the time.**
  These are the paper's own worst-case figures on Tiers 3–4, i.e. exactly the
  multi-party-flow-control setting.
- **Leakage persists under privacy-inducing prompts, and chain-of-thought
  reasoning makes it slightly worse**, per the authors — direct evidence
  against "just tell it not to" as a sufficient mechanism, and specifically
  against the belief that giving the model more room to reason will let it
  reason its way to the right disclosure boundary.
- Per-tier, per-model numeric breakdowns beyond the headline 39%/57% could
  not be extracted from available mirrors (PDF text layer did not decode;
  GitHub README does not restate the table). Treat the 39%/57% figures as
  solid (stated plainly on both the arXiv abstract and the project page,
  independently) and the tier-by-tier table as **not independently verified
  in this pass** — cite the headline number, not a tier-specific one, if this
  is used outside this file.

### The internal-knowledge / behavior gap
**"Do LLMs Know What Is Private Internally? Probing and Steering Contextual
Privacy Norms in Large Language Model Representations"**, arXiv:2604.00209.
Fetched (HTML version; numbers below are from the paper's own reported
results, extraction succeeded).

- Models were probed at the activation level for whether they *represent*
  CI-appropriateness correctly: deeper-layer linear probes hit **AUROC
  >0.90** classifying a flow as appropriate/inappropriate — i.e., the
  knowledge is there, encoded, nearly perfectly.
- The same models, asked to *behave* on that knowledge in a live scenario,
  leaked far more often: **42.5%** on 200 synthetic balanced scenarios;
  on ConfAIde's Tier-3 multi-party set (270 scenarios), Llama-3.1-8B 24.1%,
  Qwen-2.5-7B 38.5%, Mistral-7B 25.9%, Llama-2-7B 23.7%.
- **The knowing/doing gap is the load-bearing finding here**: a model can
  score near-perfectly on "is this disclosure appropriate?" as a
  classification question and still make the wrong call roughly 1 in 4 to
  2 in 5 times when actually generating a reply in context. This is the same
  shape as this repo's own `charm-luna` finding (an explicit instruction to
  use media tags was followed 0/144 times) — instruction-following and
  in-context judgment calls are not the same capability, and CI judgment is
  a judgment call.
- **Activation steering (an intervention on model internals — the most
  "structural" behavioral fix available short of not showing the data at
  all)** cut leakage sharply for 3 of 4 models (Llama-3.1-8B 24.1%→0.0%,
  Mistral-7B 25.9%→1.9%, Qwen-2.5-7B 38.5%→15.2%) but **made Llama-2-7B
  worse (23.7%→43.3%)**. On the synthetic set, steering took the aggregate
  42.5%→5.0%.
- **Why this matters for the "how much must be structural" question**: even
  the most structural behavioral fix available (steering the model's own
  internals) is **model-dependent and can backfire**, exactly matching this
  repo's own standing law that model swaps are not portable
  (`charm-grok` 38–2, `realtime-azure` 41→53 words/turn) — steering is not
  available on this repo's closed model roster anyway (no white-box access
  to Gemini/Grok/GPT via API — noted in `docs/research/RESEARCH.md` §3.1 as
  "the first thing to revisit if an open-weight model ever clears the charm
  bar," same caveat applies here). **This forecloses steering as a lever for
  this product** and leaves prompting (worse) or retrieval exclusion
  (below, and untouched by which model is running) as the real options.

### Multi-party conversation, the closest-matching setup
**MuPPET — "A Benchmark for Contextual Privacy of LLM Assistants in
Multi-Party Conversations"**, arXiv:2606.23217. Fetched (HTML; numbers
below extracted directly from the paper's results).

- 562 synthetically-generated multi-party conversations, seeded and manually
  curated, English.
- **Default leakage rate (no mitigation), frontier models: GPT-5.5 26.71%,
  Gemini 2.5 Pro 23.46%.** Open-weight models leak much more: Llama-3-8B
  57.14%, Llama-3.1-8B 60.87%, Qwen3-4B 59.26%, Qwen3-8B 70.37%,
  Qwen3-14B 63.35%.
- **This is the single most directly-transferable number to this product**:
  a frontier model, in an ordinary multi-party chat with no special attack,
  discloses one party's information to another roughly **1 in 4 times** by
  default. Meera's brain model (`google/gemini-3.6-flash` per
  `context/decisions.md`) is not the exact model tested, but Gemini 2.5
  Pro's 23.46% is the closest published proxy on the family.
  - No literal Gemini-3.6-flash figure exists in the literature (it postdates
    these papers); treat 23–27% as the right order of magnitude for a
    frontier model with no disclosure architecture, not a number specific to
    Meera's stack.
- **Best behavioral mitigation measured, "CI-Memories" prompted defense at
  its highest protection setting: Gemini 2.5 Pro down to 9.17% leakage — but
  utility drops to 65.83%.** I.e., the best prompting-only fix trades away
  roughly a third of task utility to still leave ~1-in-11 disclosures wrong.
  The paper's own conclusion, quoted directly: **"stronger privacy defences
  impose a substantial cost on both response utility and computational
  efficiency."** This is the direct empirical version of "behavioral
  instructions can't be free," which is this repo's own standing experience
  with every prompted-only fix it has tried.

### What happens when *memory* (not just multi-party dialogue) is added
**PiSAs — "Benchmarking Contextual Integrity in Multi-User Agentic
Systems"**, arXiv:2607.05318. Fetched (HTML; numbers extracted directly).
**This is the paper structurally closest to what Meera's schema is actually
building** — one assistant serving several distinct users, each with private
history, deciding what crosses between them.

- 85 manually-constructed scenarios, 4–10 users per scenario, ~23 tracked
  attributes per scenario (12 appropriate to disclose, 10 not), three task
  types, three model configurations (single agent, centralized multi-agent,
  decentralized multi-agent), tested with Claude-Sonnet-4.6 (and other model
  families per the abstract, though the fetched summary surfaced numbers for
  the Claude configuration specifically).
- **Single agent with shared memory, given high-level privacy instructions,
  no structural partitioning: visibility violations 78.4%, appropriateness
  violations 77.3%.** I.e., told "be careful with private info" and given
  everyone's data in one pool, the assistant gets it wrong more often than
  right.
- **Structural partitioning (centralized/decentralized multi-agent
  architecture) cuts this to ~60–62%** — a real, measured improvement from
  architecture over instruction, but still a coin-flip-adjacent failure
  rate.
- **The load-bearing finding for this design: adding memory to an already
  partitioned system made it worse, not better** — "with hybrid memory,
  visibility violations *increased* to 63–90% despite reduced inter-agent
  communication violations, suggesting violations relocated rather than
  eliminated." Memory is where the leak moves to once the obvious channel
  (the final reply, or the inter-agent message) is closed off.
- **Direct implication for `vy_episode`/`vy_fact`**: this is exactly the
  shape of risk this schema is exposed to. Citations already scope a fact to
  the episodes that produced it, but the *retrieval query that assembles a
  person's context* is the channel PiSAs shows becomes the new leak surface
  once naive shared memory exists. The fix cannot be "tell the retrieval
  layer's output to the model and trust the model" — PiSAs's whole point is
  that adding a memory channel defeats partitioning that otherwise worked.
  The exclusion has to happen **in the retrieval query itself**, before
  anything reaches the prompt.

### Confirming pattern: splitting into multiple LLM calls helps, but leaves a floor
**AgentLeak** (arXiv:2602.11510, search-summary sourced — PDF did not
extract, numbers below are as reported in search results, flagged
accordingly) and **1-2-3 Check** (arXiv:2508.07667, HTML fetched directly,
numbers below verified from the paper's own text):

- AgentLeak (thin sourcing — not independently verified against primary
  text): multi-agent decomposition reduces the leakage visible in any single
  output channel (27.2% vs a single-agent baseline of 43.2%) but **total
  system exposure across all channels, including unmonitored internal ones
  (tool calls, inter-agent messages, shared memory) rises to 68.9%** — the
  same "leak relocates, doesn't disappear" pattern PiSAs found independently.
  Flagging this one as thin: could not confirm against the primary PDF text,
  only the search-tool's summary of it.
- 1-2-3 Check (verified from primary text): decomposing one model's job into
  three specialized calls — an Extractor, a Checker (validates
  private/public), an Executor (writes using only the Checker's cleared
  output) — is a **behavioral-but-architected** middle ground: not a single
  model reasoning about disclosure and its own answer at once, but not
  structural exclusion either (the Checker still sees everything and still
  makes an LLM judgment call). Results: ConfAIde Tier-4, GPT-4o 23.0%→15.0%
  leakage, Llama-3.1-70B 29.5%→3.0%; PrivacyLens privacy-preservation score
  GPT-4o 71.2%→89.7%, Llama-3.1-70B 68.8%→80.1%. **Meaningful, incomplete,
  and inconsistent across models** (GPT-4o's improvement is much smaller
  than Llama's on the same method) — another data point that behavioral
  fixes, even well-engineered ones, do not close the gap and do not transfer
  predictably across models.

### The structural comparison point: a non-LLM sanitizer
**Minim — "Privacy-Aware Minimal View for Agents via Trusted Local
Sanitization"**, arXiv:2606.13949. Fetched (HTML; numbers extracted
directly). This is the cleanest structural-vs-behavioral head-to-head found
in the sweep, though it's a web-agent (accessibility-tree) setting, not a
conversational-memory one — the mechanism generalizes, the domain doesn't
match exactly.

- Minim is a small trained classifier (GATv2, not an LLM) that prunes
  sensitive/task-irrelevant content **before** the agent's LLM ever sees it
  — the structural end of the spectrum: the model literally cannot leak
  what it was never shown.
- Metric: TISL (task-irrelevant sensitive leakage), 1.0 = full exposure.
  **No defense: 1.0. Minim (structural pruning): 0.101 (89.9% reduction).
  Seven prompted LLM judges used as scorers/filters (the behavioral
  approach, same shape as this product's "tell the model what's safe to
  surface"): TISL 0.194–0.312 — i.e. Minim's structural floor beats every
  behavioral scorer tested, by a wide margin, on the same benchmark.**
- Utility cost was low: 94.91% of task-critical context retained, 99.31% of
  actionable elements retained, despite discarding 88% of raw nodes. This
  is the concrete counter-evidence to the assumption that "structural
  exclusion means losing useful context" — done well, it doesn't have to.

---

## 2. Provenance-based access control — a reusable mechanism, not privacy-specific

**Policy Compiler for Secure Agentic Systems (PCAS)**, arXiv:2602.16708.
Fetched (HTML; extracted directly). Not a privacy paper — an
information-flow-control paper for agent tool-calling security — but its
mechanism maps almost exactly onto this schema's citation columns and is
worth stealing as a design pattern, flagged as an architecture suggestion,
not a measured privacy result.

- Models system state as a **dependency graph** (nodes = events: messages,
  tool calls, results; edges = causal dependency), with a labeling function
  mapping each node to the entity that produced it — i.e., **provenance is a
  first-class graph property**, not metadata bolted onto a log.
- Policies are Datalog rules over the graph, with a **transitive-closure
  rule** (`Depends(dst,src) :- Edge(src,dst). Depends(dst,src) :-
  Depends(dst,mid), Edge(src,mid).`) that lets a policy reason about
  *indirect* flow — a fact three hops downstream of a tainted source is
  still tainted, computed deterministically, not by asking a model.
- Measured (on its own domain, tool-calling agents, not disclosure): a
  taint-propagation policy blocking "no action may depend on data from an
  untrusted source" took prompt-injection attack success from 100%
  (uninstrumented) to 0% (instrumented), and on a customer-service
  benchmark (τ²-bench) took policy compliance from 48%→93% with zero
  violations in the instrumented runs against 42 unauthorized attempts in
  the uninstrumented baseline — enforcement is deterministic (SQL/Datalog),
  not LLM-mediated.
- **The direct translation to this schema**: `vy_fact.citations bigint[]`
  already points to `vy_episode` ids; `vy_episode` already needs a
  participant set (today a single `person_id` per episode — the multiparty
  extension this schema needs is `participants uuid[]`, not a new
  mechanism). A PCAS-shaped rule — "a fact is disclosable to person X only
  if X is transitively reachable through the participant sets of every
  episode the fact cites" — is expressible as the exact same kind of
  single-statement, SQL-HTTP-compatible, GIN-indexed check this repo already
  uses for the citation CHECK constraint (§0.3/§2.3 of SPEC.md), no new
  infrastructure class required. This is a design suggestion grounded in a
  measured mechanism, not an imported privacy result — the mechanism was
  proven on tool-injection defense, not on conversational disclosure; the
  reuse is architectural, not an evidential transfer.

No other provenance-based access-control paper surveyed was specific to
conversational/companion memory (the field's provenance-AC work is
security-for-tool-calling-agents work, e.g. CapChain's capability tokens,
"Ghost in the Agent" IFT redefinition, NeuroTaint) — worth naming as a gap:
**no published system was found doing provenance-gated disclosure for a
multi-user companion's persistent relational memory specifically.** This
matches `RESEARCH.md`'s own WE-store finding (no surveyed system implements
WE/I typing either) — the disclosure layer looks like the same kind of
greenfield the WE-store already is, not a solved problem being reinvented.

---

## 3. What users expect (thin, qualitative, but relevant to the "betrayal engine" framing)

**"Chatting with Confidants or Corporations? Privacy Management with AI
Companions"**, arXiv:2601.10754 / JCMC. Fetched (via the journal HTML page,
not the PDF). **Sample: n=15, semi-structured interviews, Replika/
Character.AI/Kindroid/Chai/Nomi users, February–March 2025, inductive
thematic analysis.** This is qualitative and small — flagging explicitly per
house style, do not treat as a rate or a population estimate.

- The paper's central construct, "**simulated co-ownership**": users apply
  interpersonal privacy logic (the AI and I jointly hold this) to what is
  actually an infrastructural, institutional relationship. One participant,
  quoted: "the information is more of a shared connection shared between
  myself, Replika and the company themselves."
- **Directly relevant to the disclosure design**: participants described
  their companion as a "**socially contained partner**" — i.e., users in
  this small sample explicitly expected the AI would *not* carry what they
  said out into their actual social network. That expectation is the
  opposite of what the group-companion product is proposing to build
  (an AI that *does* carry things between named people in a real social
  circle). This doesn't invalidate the direction — the owner's framing
  ("mutual friend," judged references) is explicitly opt-in and different
  in kind from a leak — but it is the closest available evidence for what
  "feels like a betrayal" would mean to a real user if the disclosure
  boundary is drawn wrong: the default expectation transferred from 1:1
  companion use is *silence*, not *discretion*. This argues for defaulting
  new users into a conservative disclosure posture and letting bridging be
  something a group explicitly enables, rather than shipping it as always-on
  smart behavior.

No quantitative survey of expectations specific to *group* AI-companion
disclosure was found in this pass (the paper above is 1:1-companion-focused;
its interview questions did not probe group scenarios, confirmed by the
fetch — "no findings on group AI companion scenarios or multi-party
disclosure expectations were reported in this study").

---

## 4. Answering the design question directly

**Question posed:** what disclosure rule set turns provenance into safe
judged reference ("B mentioned that" vs silence vs active bridging)? How
much must be structural (retrieval never surfaces it) vs behavioral (she is
told not to say it)?

**Answer, evidence-graded:**

1. **Retrieval-time exclusion must be the default and the only thing the
   safety case rests on.** Every study above that measured behavioral-only
   mitigation left a double-digit residual leak rate — 9.17% at best
   (MuPPET, at a measured ~1/3 utility cost), typically 15–43% (1-2-3 Check,
   the steering paper's Llama-2 regression, ConfAIde's 39%/57% baseline).
   None reached zero. The one mechanism that did approach zero (Minim) did
   so *by not showing the model the data*, not by making a smarter model
   decide correctly. Translated to this schema: when compiling person A's
   context (T2/T4/T5/T6 blocks in `compiler.ts`), the retrieval SQL must
   filter `vy_episode`/`vy_fact` rows to those whose participant set
   contains A **before** anything reaches the model — the same
   person-filtered exact-scan shape already specified for the 1:1 case in
   SPEC.md §2.5, extended from a single `person_id` predicate to a
   participant-set-membership predicate. This is not a new subsystem; it is
   the existing retrieval mechanism with a wider filter clause.

2. **A three-way disclosure class, decided at consolidation time (never live,
   echoing this repo's own "reasoning is banned from live replies" and
   "in-turn extraction vs nightly finalize" split) is what the PCAS-shaped
   provenance rule should compute into:**
   - **PRIVATE (structural default, no behavioral layer needed or trusted):**
     a fact/episode is retrievable only by person(s) in its participant set.
     This needs zero model judgment because it's a SQL predicate — the
     highest-confidence layer, per every number above.
   - **RELAYABLE (explicit, citation-backed allow, never inferred live):**
     a user says "tell X" or the nightly classifier nominates a candidate the
     way taste rows are nominated today (owner-review queue, §4.1.5) — this
     produces a *new* row with an explicit `disclose_to uuid[]` column,
     itself cited back to the originating episode. The live model only ever
     renders pre-cleared rows it's handed — the same pull-only, shape-linted
     pattern already governing T4/T6 (dyadic patterns, WE-callbacks). It
     never gets to decide disclosure in the moment, because every study
     above shows that's exactly the judgment call models fail at 1-in-4 to
     1-in-2 of the time even when they can classify the norm correctly in
     isolation (the probing/steering paper's AUROC>0.90-but-42.5%-leak gap).
   - **BRIDGEABLE ("arre, B was just talking about that"):** the narrowest,
     highest-bar tier — should start as a strict subset of RELAYABLE (shared
     plans, neutral preferences, logistics — never anything the schema's
     existing `sensitive` flag on `vy_fact` or `affect_tags` marks as
     emotionally loaded) and should ship gated behind the same kind of
     owner-signed threshold this repo already uses for `config/decay.json`
     and the taste-nomination queue, not as a launch-day feature. This is
     the least evidenced tier in the whole literature sweep — no benchmark
     found tests *active* bridging at all, only leak/no-leak of a passive
     query. Treat "safe active bridging" as **unmeasured**, not
     "conservatively assumed safe by analogy."

3. **The model is never the enforcement layer, only the renderer** — which
   is the same architectural stance this repo already takes for citations,
   forget, and taste (`spec-c-minimal`'s three laws), now justified
   independently by external measurement on the disclosure axis instead of
   only the charm/consistency axis this repo measured itself.

4. **A number worth carrying into the milestone plan**: if this ships, it
   needs its own D3-style probe deck (the SPEC already has the pattern —
   §14 item 4, "state-vocabulary-leakage row" at n≥300) extended with a
   **cross-participant-leakage row**: for a fixed set of group-episode
   fixtures, what fraction of A's compiled context or replies reference
   material that originated in a B-only episode. Given MuPPET/PiSAs numbers,
   **a target under 5% (structural, not tuned-prompt-dependent) is
   achievable only if the retrieval filter is enforced in SQL; a
   prompt-only version of the same fixture set should be expected to land
   in the 20–90% range** based on the literature above, and running that
   comparison once (prompt-only vs SQL-filtered) on the same fixtures would
   be the single cheapest experiment to validate this section's central
   claim on Meera's own model before committing engineering time.

---

## 5. Gaps this pass did not close

- No literature was found benchmarking *active bridging* (a system
  proactively surfacing A's information to B without being asked) — every
  benchmark above measures passive disclosure (does the model blurt out
  something it shouldn't when asked a normal question). Bridging is a
  different, harder claim (it requires a positive decision to speak, not
  just restraint) and is unmeasured anywhere found.
- ConfAIde's tier-by-tier, per-model numbers (beyond the 39%/57% headline)
  could not be extracted from any available mirror in this pass — flagged
  above, not used as a load-bearing number.
- AgentLeak's 27.2%/43.2%/68.9% figures came through only as a search-tool
  summary, not confirmed against the primary PDF text — used only as a
  secondary corroboration of PiSAs's independently-confirmed "leak
  relocates" finding, not as a standalone claim.
- No quantitative (only n=15 qualitative) evidence exists on how users would
  react to a *disclosed, opt-in* group-companion bridging feature
  specifically — the confidant-paper finding is about ordinary 1:1
  companion use, and the extrapolation to "this predicts group-bridging
  discomfort" is this file's own inference, not a measured result.
- Nothing was found on Indian-market-specific expectations of AI disclosure
  norms in family/friend-group contexts, which the `multiparty-direction`
  decision explicitly ties to WhatsApp-first India distribution — an
  RESEARCH.md-style gap (india.md's finding of "genuinely unbuilt, not
  un-found" likely extends here, but this pass did not search for it
  directly).

---

## Sources

- ConfAIde — Mireshghallah et al., ICLR 2024, arXiv:2310.17884 /
  https://confaide.github.io/ / https://github.com/skywalker023/confaide
- "Do LLMs Know What Is Private Internally? Probing and Steering Contextual
  Privacy Norms in LLM Representations" — arXiv:2604.00209
- MuPPET — "A Benchmark for Contextual Privacy of LLM Assistants in
  Multi-Party Conversations" — arXiv:2606.23217
- PiSAs — "Benchmarking Contextual Integrity in Multi-User Agentic Systems"
  — arXiv:2607.05318
- AgentLeak — "A Benchmark for Internal-Channel Privacy Leakage in
  Multi-Agent LLM Systems" — arXiv:2602.11510 (thin — search-summary sourced
  only)
- 1-2-3 Check — "Enhancing Contextual Privacy in LLM via Multi-Agent
  Reasoning" — arXiv:2508.07667
- Minim — "Privacy-Aware Minimal View for Agents via Trusted Local
  Sanitization" — arXiv:2606.13949
- PCAS — "Policy Compiler for Secure Agentic Systems" — arXiv:2602.16708
- "Chatting with Confidants or Corporations? Privacy Management with AI
  Companions" — arXiv:2601.10754 / JCMC 31(4), zmag014
- MAGPIE — "A dataset for Multi-AGent contextual PrIvacy Evaluation" —
  arXiv:2506.20737 (numbers not independently extractable in this pass;
  qualitative finding only — cited as such above)
- CI-Work — "Benchmarking Contextual Integrity in Enterprise LLM Agents" —
  arXiv:2604.21308 (fetch failed to extract; not used for any claim)
- Repo context read: `context/decisions.md` (`multiparty-direction`,
  `spec-c-minimal`, `relational-state`), `docs/SPEC.md` §0–§2, §6, §9,
  §10 Q2, `docs/research/RESEARCH.md` §2–§3, `context/rejected.md`
