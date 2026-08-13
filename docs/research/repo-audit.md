# Track: repo-audit — demolition-and-salvage plan for the Meera repo

Date: 2026-08-13. Repo: `/home/user/html-portfolio`. No web access needed or used;
every claim below cites either code read in full or a measured entry in
`context/`. Verdicts: **KEEP** (evidence it works), **LIFT** (right idea, needs
rebuilding), **REBUILD** (wrong shape), **MISSING** (doesn't exist).

Target architecture slots, from RELATIONAL-STATE.md Phase C: identity core,
relationship state, episodic memory, consolidation, context compiler, model
router, eval suite.

---

## 0. The headline finding

The repo already contains, scattered and unnamed, about 60% of a
relational-state layer — and the parts that were **measured** are consistently
the parts that work. The single most important pattern in the codebase, proven
twice, is:

> **State that must be stable is AUTHORED or STRUCTURAL, never generated;
> generated text is treated as hostile input; and the guarantee is placed in
> code (position, input starvation, hard delete) rather than in prompt wording.**

- Authored beats generated: `taste-consistency` 27% → 63% self-agreement
  (n=480 live turns) when opinions moved from "improvise them" to a fixed table
  in `src/engine/inner.ts` (`TASTE`, lines 244–326). The remaining 37% is
  topics with no table row — "the fix is more rows, not more prompt"
  (measurements.md).
- Structural beats instructed: the appraiser that writes her mood is fed
  conversation text **with timestamps and gap markers stripped**
  (`api/memory.js` opRemember, "LOAD-BEARING INVARIANT" comment, ~line 285), so
  it is *incapable* of turning the user's reply speed into her mood. Charter
  G1–G8 in `inner.ts` is the best safety-as-architecture document in the repo.
- Position is mechanism: `prompt-position` — the same rule fired 0/8 buried
  mid-brief and 8/8 appended last (`persona.ts` comment above `FORGET_DECISION`,
  lines 496–509; `FORGET_DECISION` written into the core produced **zero**
  markers across three direct forget requests).

And the company's falsifiable claim is measured FALSE by this repo's own
harness: `charm-grok` (38–2 on a byte-identical prompt, n=48 conversations,
96 blind counterbalanced judgments) and `realtime-azure` (41→53 words/turn
against her 20.5 lane, byte-identical prompt). **The prompt sets a ceiling; the
model decides how close you get.** Nothing currently in the repo lifts identity
above the model — that layer must be built, and the audit below says what it
can be built from.

---

## 1. Identity core

### 1a. `src/engine/persona.ts` (~86KB source, ~45k-char assembled core) — LIFT

What it is: one hand-authored monolith. `buildSystemPromptParts(user, count,
medium)` returns a byte-stable `core` (cacheable) and a volatile `tail`;
`buildSpeechStyle(engine)` appends per-voice-engine register rules; watch-mode
directives; `SEARCH_DECISION` / `FORGET_DECISION` exported separately so
`brain.ts` can append them dead last.

Evidence it works *as content*: the incumbent behind this prompt beat grok
38–2 on warmth/humour/personhood, and the register rules are what the persona
invariant suite protects. Evidence it fails *as architecture*:

- **It is entangled with model-specific tuning.** The spoken-register block is
  written for engines that literalize brackets (`ack-bracket-direction`:
  "[laughs softly]" performed as the spoken word "Softly"); the cascade lane
  emitted stage directions 10/10 when a tag vocabulary and a bracket ban
  coexisted (comment at persona.ts:392–404); effort tiers are inverted per lane
  (api/chat.js:121–141). None of this transfers to a new model — which is the
  whole company problem.
- **Identity, behavior rules, safety, and protocol share one document** whose
  integrity depends on byte position and on not being truncated
  (`silent-truncation` has already deleted the crisis helplines once).
- **Two laws are portable and proven:** `recited-prompt` (example quotes
  recited 4/5 → 0 at n=84 after removal; polished-English taste read out
  verbatim twice, 8 turns apart — "write shapes, never lines she could say")
  and `prompt-position`. Any rebuilt identity core inherits both as invariants.

Verdict: **LIFT.** The *content* (voice, humor shape, comfort ladder, secure
attachment, NEVER MANIPULATE, crisis protocol) survives; the *shape* — one
45k-char position-sensitive string — is exactly what cannot survive a model
swap. The rebuild should factor: (i) model-independent identity facts/stances,
(ii) behavioral invariants testable by the eval suite, (iii) a per-model
"adapter" (register rendering, tag vocabulary, effort/token config) that is
expected to be re-derived per model.

Safety invariants specifically — crisis lines (`CRISIS_LINES`, persona.ts:45),
never-deny-AI (persona.ts:275), NEVER MANIPULATE (persona.ts:223–230), the
deleted idle nudge with its do-not-re-add rationale (persona.ts:427–434) —
**KEEP verbatim as requirements**; RELATIONAL-STATE.md already declares them
non-negotiable inputs.

### 1b. `src/engine/inner.ts` — carried feeling / wants / owed / taste / weekShape — KEEP (design), LIFT (storage)

The strongest existing piece of a portable identity layer, because every
guarantee is structural:

- One `Thread` = feeling **fused** with cause in one sentence of her own words;
  decay `TAU_H=9h`, killed by `sleptBetween()`, retired permanently once
  voiced. State that "feeling outlived its cause" is unrepresentable.
- G1 input starvation (no path from usage metrics to her state), G2 never
  initiates carrying a feeling, G4 no UI, G5 no accumulating sad period —
  each enforced in code paths, not prompts (`innerContext()` gates:
  `gapEntry && !sheInitiated && surface !== "watch"`).
- `TASTE` table: authored, pull-only, whole-word matched, one take max —
  the 27→63% measurement. `REFS_USER` / `EVENT_SHAPED` rejects on write
  (applyInner:605–624) block the manipulation surface at the merge, again.
- `weekShape()` is a pure function of the clock — mood arc with zero state.

Weakness: the whole interior lives in **client localStorage**
(`store.ts` AppState.inner, "~600 bytes ... rides this state's existing local +
account sync") with container-revision merge. For a layer whose job is to make
identity survive model *and device* replacement, client-side residence is a
liability — LIFT the storage to the server-side identity record; KEEP the
mechanics and the charter unchanged. The charter G1–G8 should be promoted to
spec text for the new architecture.

### 1c. `src/engine/culture.ts` + `api/culture.js` — KEEP (pattern)

Pull-only cultural currency: daily index, consulted only by
`cultureNote(userText)`, structurally unable to be raised by her first, fails
to "". Same proven pull-not-push pattern as taste. India-track relevance: this
is the only India-specific state machinery in the repo besides the register
rules.

### 1d. `storyCatalog.ts` / `photoCatalog.ts` / `memeCatalog.ts` — KEEP (marginal)

Hand-authored media identity (her photos, her stories with descriptions
injected "so she KNOWS her own story"). Small, consistent with
authored-not-generated. Carries forward trivially.

---

## 2. Relationship state

### 2a. `stageFor(messageCount)` (persona.ts:52–58) — REBUILD

The **entire** relationship model is three prose stages keyed on raw message
count (<30, <150, else). No trust dimension, no rupture/repair history, no
register drift, no ritual registry, no per-relationship pacing. Message count
is not relationship depth (90 messages in one evening ≠ 90 across a month —
the code already knows this elsewhere: gap markers, `agoLabel`). Nothing here
is measured. This is the emptiest slot relative to its importance to
"relationship retention," half the north star.

### 2b. Fragments worth salvaging into a real relationship-state schema

- `meera_nodes.kind='phrase'` — coined words / running jokes as first-class
  memory, ranked as identity-durable in recall (`api/memory.js` RANK comment:
  "a callback that survived three weeks is worth ten inside the same chat").
  The one existing piece of *shared*-relationship state. LIFT.
- `feel` column — the user's **own words** for how something felt, never
  inferred (schema.sql:50–52, opRemember node shaping). Right principle for
  any affect-bearing relationship record. LIFT.
- `user.facts` Record<string,string> filled by `localHeart.ts` regex captures —
  REBUILD: the code itself documents that captures were "confidently wrong,
  which is exactly what reads as lying" and patches with `DANGLING`/`NOT_A_FACT`
  filters. Fact learning belongs in the extraction pass, not client regex.
- `herLife` SelfFact ledger + `formatHerLife()` newest-wins-on-2-word-overlap
  dedupe (brain.ts:63–85) — LIFT: right invariant (store everything, make only
  the prompt consistent), crude resolution (word-overlap collision).

Verdict for the slot overall: **MISSING → build new**, salvaging 2b. The swap
test needs relationship state *serialized and inspectable* — today it is
smeared across message history, node graph, herLife, inner, and a message
counter.

---

## 3. Episodic memory

### 3a. `meera_log` (schema.sql:39–48) — KEEP

Permanent per-device transcript with channel (chat/call) and kind. It is the
ground truth every other store is derived from, and the forget system's
windowed scopes depend on its shape. Cheap, correct, already deletion-honest.

### 3b. Graph memory `meera_nodes`/`meera_edges` + `opRecall` — LIFT storage, REBUILD retrieval

- Retrieval is **keyword matching, not semantic** — the repo says so itself:
  graph node `semantic-recall` [open]: "Recall is keyword matching, not
  semantic." Mechanism (api/memory.js:158–210): lowercase the query, take
  words ≥4 chars, drop a 90-word hand-made `RECALL_STOP` list (with Hinglish
  stopwords), word-boundary regex against `name`/`summary`, cap 8 matched + 4
  background. "kaam stress" will not recall a node summarized as "office
  pressure". `text-embedding-3-small` is **deployed on Azure and not wired**
  (architecture.md:23). REBUILD retrieval on embeddings + the existing rank.
- Worth keeping from the ranking: salience bumped by presence of `feel`
  (+1.0 vs +0.6 per mention, insert 1.6 vs 1.0) — "emotional salience" as an
  asymmetry, and identity-kind vs episodic-kind decay split in `RANK`
  (person/place/preference/fact/phrase hold weight; events fade over 60 days).
  Unmeasured but well-shaped. LIFT.
- Stale-fact flagging (`TIME_BOUND` + `staleNote`, api/memory.js:233–240):
  time-bound facts >45 days old get an inline "this already happened; talk
  about it as past" annotation — data-level fix for the wrong-tense recall
  failure. LIFT.
- matched-vs-STANDING-BACKGROUND labeling in the injected block — mirrors the
  pull-not-push law ("context only, never raise these unprompted"). LIFT.

### 3c. Forgetting — `opForget` + `meera_forget` + `resolveForget`/`messagesAfterForget` + photo/telemetry purge — KEEP, near-verbatim

The most complete subsystem in the repo and a direct regulatory asset
(DPDP/FTC track). The full chain:

1. Marker parsed strictly, no salvage (brain.ts:216–223 — "guessing at a
   mangled forget costs rows that do not come back").
2. Whole-memory wipe **structurally excluded** from the generated-marker
   vocabulary (`resolveForget` returns null on "all/everything/sab kuch";
   comment: the irreversible action must not be "one stray token away").
3. Hard delete, no tombstones ("a memory that is still in the table is still a
   memory"). Item scope chases name AND summary AND log content; window scope
   deletes nodes by `updated_at` ("taking too much here is the safe direction").
4. `meera_forget` suppression terms defeat **re-derivation** from the client
   transcript the extractor still reads — checked against name and summary
   pre-upsert.
5. `messagesAfterForget` prunes the client context window so she can't "read
   what she forgot three lines above".
6. Photos deleted from storage by filename timestamp window; telemetry purged
   on the same terms (TELEMETRY.md rule 3); rollups repaired.
7. Delete happens **before** her "haan, hata diya" reply is delivered
   (brain.ts:903–922), so the receipt (`forgot`) is never a lie; the live
   voice lane, which cannot delete, is told to say so honestly
   (persona.ts buildSpeechStyle "live" branch).

This is "honest forget" as listed in the standing constraints. Any rebuilt
memory store must re-implement this contract on day one; carrying the code
forward is cheaper than re-deriving it.

### 3d. Multimodal episodic memory — mostly MISSING

What exists: user photos get a one-line vision description (`opDescribe`,
≤110 chars) that survives as text after the 6-turn vision window
(brain.ts toTurns visionCutoff); call turns survive as transcripts with
`[a voice call starts]` medium markers; watch frames are **deliberately not
retained** (WATCH_MODE_NOTE's honest-answer paragraph: "you have nothing from
before the share started and nothing after it stops"). "Remembering how things
were said" (prosody, tone) and "what was watched together" beyond her spoken
comments does not exist. Note the privacy stance on watch frames is a
*decision* with user-facing honesty text — extending retention there
contradicts a shipped promise and needs the owner, not just architecture.

---

## 4. Consolidation

### `opRemember` (api/memory.js:282–476) + client `rememberFrom` — LIFT

Right ideas, proven decisions, insufficient depth:

- **Off the critical path, judgement work on a reasoning model** — the
  `extract-model` decision (`grok-4-1-fast-reasoning` on Azure credits,
  OpenRouter fallback because "a bad Azure minute must cost a slower
  extraction, never a lost memory"; Azure `DeploymentNotFound` on 7.5% of 40
  calls). This is the one lane where `reasoning-split`'s +55%/−81% split says
  reasoning belongs. KEEP the decision.
- **One pass decides everything** — nodes, edges, self-facts, inner patch,
  wants/owed survival — "two passes could contradict each other". KEEP.
- **Truncation-ordered JSON** — interior emitted first so a mid-JSON cut loses
  the re-derivable node list, not her feeling (maxTokens comment, 1100 not
  600). Same silent-truncation law applied to a machine channel. KEEP.
- **Input starvation** (no timestamps to the appraiser) — see G1. KEEP.

What's missing for a relational-state layer: window is the last 16 client
turns only; no episode summaries, no hierarchy (turn → episode → narrative),
no re-consolidation of old nodes, no contradiction resolution in the store
(only render-time newest-wins for herLife; node updates blind-overwrite
`summary`), no offline "sleep" pass. Verdict **LIFT**: keep the pipeline
shape and its four invariants, extend into real consolidation.

---

## 5. Context compiler

### `brain.ts think()` + `buildSystemPromptParts` split + `api/chat.js` caps + `scripts/check-prompt-budget.mjs` — LIFT

There **is** a context compiler here, in embryo, and its laws are the
project's most expensive knowledge:

- **Cache-stable core / volatile tail** with a `cache_control` breakpoint —
  `cache-9x`: 9.2× cost difference, 99.8–99.9% cached in production. Any
  future compiler must emit a byte-stable prefix or multiply cost by ~9.
- **Ordered assembly with priority under truncation**: thread first in the
  tail ("if anything is ever lost it must be the recall list ... never where
  she actually is"), watch block early because it carries privacy rules,
  decision rules dead last because position is mechanism, and the explicit
  note that the last thing in the tail is the first casualty of overflow.
- **CI budget gate** (`check-prompt-budget.mjs`) that parses the caps out of
  `api/chat.js` so the guard can't drift from the thing it guards; born from
  `silent-truncation` deleting the crisis helplines. KEEP this gate pattern.

Why LIFT rather than KEEP: the compiler is string concatenation scattered
across brain.ts / persona.ts / inner.ts / memory recall, budgeted in
**characters** against server-side slice caps, with comments that amount to
"if this trips, the trim has to happen in recall instead" — i.e. no graceful
degradation, no per-block token accounting, no eviction policy, no assembly
manifest that an eval can assert against. The rebuild is an explicit compiler:
typed blocks with priorities, token budgets, a declared truncation order, and
the three laws (`prompt-position`, `recited-prompt` shape-linting,
`silent-truncation` loud-fail) as enforced properties. Also KEEP: the
protocol-marker parser discipline in `parseBubbles` (generated text treated as
hostile; META_LEAK filter; strict-vs-salvage asymmetry keyed to blast radius —
search salvages, forget never does).

---

## 6. Model router

### brain.ts fallback chain + api/chat.js free-pool/paid + per-lane model map (architecture.md) — REBUILD (as router), KEEP (its measured constraints)

What exists is a **failover chain**, not a router: user OpenRouter key →
user Claude key → hosted proxy → offline heart; inside the proxy, Google free
pool → OpenRouter paid. Lane-to-model mapping is hardcoded per file
(architecture.md model map). No capability negotiation, no identity-fidelity
gating, no per-model adapter selection.

The measured constraints any real router must encode — this is the salvage:

- `cache-9x`: a model without prefix caching is ~9× more expensive on this
  workload regardless of sticker price.
- `credits-partner`: Azure credits cover only Azure-billed models; Anthropic
  excluded outright; with a card on file an ineligible model **bills the card
  silently**.
- Effort-tier inversion (api/chat.js measured table, n=5/cell): chat+low
  correct, chat+minimal → 4/5 EMPTY replies; call+minimal correct, call+low →
  4/5 EMPTY. "Any fixed value is catastrophic on one of them." Plus the
  empty-200 guard (a 200 carrying an empty reply treated as quota-exhausted).
- `max_tokens` semantics differ per provider: xAI caps visible output only
  (0/984 truncated with 2,305 hidden reasoning tokens); GPT-5.6 truncated
  3–5% of spoken turns at 190. A router that moves models without moving
  token config re-introduces the mid-word cutoff bug brain.ts:735–750 fixed.
- Beat-routing rejected (`reasoning-live`): classify-then-route puts the
  misclassification on the crisis turn. A future router must not resurrect
  this without new evidence.
- `live-model-bake` / `azure-realtime-shape`: realtime lanes have hard
  protocol constraints (bidi audio, video acceptance, barge-in signal
  semantics — `serverContent.interrupted` vs VAD onset; 16 kHz vs ≥24 kHz
  uplink; frame streaming vs conversation-item injection). Realtime model
  choice is an architecture choice, not a slug swap.

And the reason the router slot is the company: three bake-offs
(`charm-grok`, `charm-luna`, `realtime-azure`) all ended "keep the incumbent"
because **identity leaked through byte-identical prompts**. The router the
architecture needs routes *through an identity layer with per-model adapters
and a fingerprint gate*, which nothing here does.

`localHeart.ts` offline fallback: KEEP the crisis/honesty `critical` path
(crisis replies must survive total network failure — brain.ts:766–769 honors
it) and the honest-connectivity lines ("never fake conversation"); REBUILD its
regex fact learner (see 2b).

---

## 7. Eval suite

### Methodology — KEEP; assets — partially MISSING FROM THE REPO

- **The judging methodology is the company's best asset**: blind,
  counterbalanced, both presentation orders, win only when both orders agree,
  order-flips charged as ties — built because measured position bias was 61%
  slot-A (`charm-grok`). A discarded 256-conversation run (rate limits hitting
  only the fastest arm) shows the discipline. `fab-noise-floor` (13.6 pp
  spread on byte-identical input; "any fabrication claim from this harness at
  n<300 is noise") is an eval-design law. All of this is exactly the
  fingerprinting machinery Phase D needs — as *method*. KEEP.
- **The assets are not versioned.** `verify-v3.mjs` (138 persona invariants
  protecting crisis lines, never-deny-AI, NEVER MANIPULATE, spoken register)
  and `parsetest.bundle.mjs` (14 parser cases) are referenced by CLAUDE.md as
  shipping gates but live in a **session scratchpad**, not the repo — grep
  finds them only in CLAUDE.md and rejected.md; `scripts/` contains neither.
  The charm-judging harness code is likewise absent (results live in
  measurements.md only). For a company whose product *is* these invariants,
  the suite being outside version control is the single most urgent repo
  defect. Recover and commit them, or re-derive from measurements.md before
  they rot.
- **In-repo and KEEP**: `scripts/verify-release.mjs` (one reproducible gate
  list; tsc separate from vite because `npx vite build` exits 0 on type
  errors), `check-prompt-budget.mjs`, `scripts/context.mjs --check`,
  `scripts/session.mjs --rca`.
- **Telemetry as eval substrate — KEEP**: `docs/TELEMETRY.md` + `api/telemetry.js`
  + `src/engine/telemetry.ts`. Second-by-second reconstruction (`t_ms`
  monotonic ordering, seq gap detection, `watch.grounding` fabrication audit
  with entity **counts** not content), and — critically — telemetry is wired
  into `forget` (rule 3), so the eval substrate doesn't undermine the privacy
  contract. This is the field-measurement half of "migration fidelity ×
  relationship retention" waiting to be pointed at the swap test.
- **Swap-test / identity-fingerprint harness — MISSING.** Nothing measures
  "does she still sound like herself" as a first-class offline metric; today
  that judgment is reconstructed ad hoc per bake-off (words/turn,
  questions/turn, media-tag usage, register markers, mirror-echo rate). Those
  ad hoc axes — words/turn 20.5, ≤1-in-3 questions, media tags present,
  spoken-register markers, "mujhe bhi" reach-for rate — are the seed feature
  set for the fingerprint. `voice-ears`' lesson generalizes: measure identity
  axes (accent identity ≠ pronunciation), not proxy quality axes.

---

## 8. Components outside the seven slots

- `src/voice/liveCall.ts` (138KB) + audio floor — **KEEP untouched.** Client
  as floor authority (hold-ring, κ echo model, burst release), measured to
  the millisecond (self-duck 91%→14% at −6 dB; barge-in 5/5 @279 ms; ring
  must hold open-gate audio only). Orthogonal to relational state except:
  the live lane receives the full ~45–48k system at connect (`live-floor`:
  720 ms prefill) and gets memories prefetched at pickup only — relational
  state is frozen per call. A future context compiler must treat the realtime
  lane as "compile once at pickup," which it already implicitly does.
- `src/watch/scene.ts` + wake directives — KEEP (scene-hold-800,
  wake-hold-curve, her-reaction-736 all measured; `scene.ts`/`SceneReader.java`
  twin constants trap documented).
- `db/schema.sql` — KEEP as pattern: device_id-scoped everything ("you can
  only delete your own rows ... by construction"), schema transcribed from the
  live DB, the meera_tel_session index/table namespace trap recorded. Note
  device-as-identity means identity is per-install unless signed in
  (`meera_state` keyed by user_id) — a portability gap for an identity layer.
- `context/` + `scripts/context.mjs` — KEEP; it is the reason this audit could
  cite n and method for every verdict.

---

## 9. Verdict table (function-level where it matters)

| Component | Where | Verdict | Evidence |
|---|---|---|---|
| Persona content + safety invariants | persona.ts | KEEP (content) | charm-grok 38–2 defended; invariant suite scope |
| Persona as monolithic prompt | persona.ts / buildSystemPromptParts | LIFT | recited-prompt, prompt-position, silent-truncation; model entanglement (effort inversion, bracket semantics) |
| TASTE table (authored opinions) | inner.ts TASTE/tasteNote | KEEP | 27→63% at n=480; 0 false fires / 60; 20/20 hits |
| Inner thread/wants/owed + charter G1–G8 | inner.ts, applyInner | KEEP (design), LIFT (client-side storage → server identity record) | structural guarantees; taste-consistency; G1 starvation in api/memory.js |
| weekShape mood arc | inner.ts | KEEP | stateless by construction (G5/G1 free) |
| culture pull-only index | culture.ts, api/culture.js | KEEP (pattern) | structural cannot-raise-first guarantee |
| stageFor(messageCount) relationship model | persona.ts:52 | REBUILD | unmeasured; count ≠ depth; no dimensions |
| user.facts via regex capture | localHeart.ts | REBUILD | documented confidently-wrong captures |
| herLife ledger + render-time dedupe | store.ts, brain.ts formatHerLife | LIFT | right invariant, crude overlap resolution |
| 'phrase' nodes, `feel` own-words column | api/memory.js, schema | LIFT into relationship schema | RANK rationale; fabrication-proof affect |
| meera_log transcript | schema.sql | KEEP | ground truth; forget depends on it |
| Graph store + salience/staleness rank | api/memory.js opRecall | LIFT | feel-salience asymmetry, staleNote — unmeasured but shaped right |
| Recall retrieval | opRecall keyword match | REBUILD | `semantic-recall` open node; embeddings deployed, unwired |
| Forget stack (all 7 layers) | memory.ts + api/memory.js + schema | KEEP | only wipe-refusal + suppression + client-prune + media/telemetry purge in repo; receipt-before-reply |
| Consolidation pass | opRemember + rememberFrom | LIFT | extract-model decision; one-pass, starved-input, truncation-ordered — but 16-turn window, no hierarchy |
| Multimodal memory | photo desc only | MISSING | watch retention contradicts shipped honesty text — owner decision |
| Context assembly | brain.ts think() + chat.js caps | LIFT | cache-9x, prompt-position, priority-under-truncation comments; but char-count concat, no eviction policy |
| check-prompt-budget CI gate | scripts/ | KEEP | caps parsed from guarded file; born from helpline loss |
| parseBubbles hostile-output parser | brain.ts | KEEP (discipline) | voicenote direction bug measured 4/4, 2/5 live; strict-forget asymmetry |
| Model fallback chain | brain.ts, api/chat.js | REBUILD (into router) | failover only; encode cache-9x, credits-partner, effort inversion, max_tokens semantics, no-beat-routing |
| Offline crisis path | localHeart critical + brain.ts | KEEP | crisis must survive network failure |
| Judging methodology | measurements.md method | KEEP | counterbalanced both-orders; 61% position bias; fab-noise-floor n≥300 |
| verify-v3 (138 invariants), parsetest | session scratchpad | MISSING from repo | referenced by CLAUDE.md gates; not under version control |
| Swap-test fingerprint harness | — | MISSING | ad hoc axes exist (words/turn, tags, register markers) as seed features |
| Telemetry (client+server+contract) | telemetry.* , TELEMETRY.md | KEEP | forget-integrated (rule 3); watch.grounding; t_ms/seq discipline |
| Audio floor / liveCall | liveCall.ts | KEEP | audio-floor table; backchannel/speaker-id rejections |
| Scene/watch wake model | scene.ts | KEEP | scene-hold-800, wake-hold-curve, dedupe MAD 0.00–0.77 |
| Device-id identity scoping | schema.sql, _db | KEEP (pattern), note portability gap | delete-own-rows by construction; per-install identity |

## 10. What this means for Phase B (design inputs, not proposals)

1. The identity core should be **authored state + structural guarantees +
   per-model adapters**, because every measured success here (taste table,
   inner charter, culture pull) is that shape, and every measured failure
   (improvised opinions, recited sentences, per-model register bleed) is the
   other shape.
2. The context compiler is the highest-leverage rebuild: it already owns the
   three laws and the cache constraint; making it explicit gives the swap test
   a controlled variable ("same compiled context, different model").
3. Relationship state is greenfield; do not let `stageFor` anchor it.
4. Recover the eval assets into the repo before anything else in Phase C —
   the invariant suite is the only executable definition of "she is still
   her" that exists today, and the swap test is built on top of exactly that.
