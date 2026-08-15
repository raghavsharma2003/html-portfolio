# Generalization Audit — Meera-specificity map of the relational-state stack

Commissioned under the `beyond-meera` owner directive (context/decisions.md,
2026-08-15): a read-only map of every Meera-specific coupling in the research
infrastructure, classified **(a) PARAMETER** (data/config-driven — a second
product swaps it without touching code), **(b) SOFT-CODED** (a constant,
string, path, or single import — mechanically trivial to lift), or
**(c) STRUCTURAL** (the design itself assumes Meera/Hinglish/India — reuse is
real work). This is a map, not a plan; no rewrite is implied by an entry
existing. UI/app code and android/ were excluded — the product layer is
allowed to be Meera.

## 1. src/engine/compiler.ts + fixtures

~85% of the file (MANIFEST arithmetic, drop-order, hashing, telemetry
shaping) is **(a)** — fully persona-agnostic. The assembly function is
**(b)**, bound to persona.ts by one static import block, not an injected
dependency:

- `compiler.ts:27-36` — `import { buildSystemPromptParts, ... } from
  "./persona"`; the header calls persona.ts "READ-ONLY here" and CORE
  arrives "as one opaque, byte-stable string".
- `CORE_MANIFEST` rows C1–C4 carry `sourceStatus: { fused: "persona.core" }`
  — the manifest documents Meera's content blocks as a target shape but has
  no code path producing them independently of persona.ts.
- `CompileInput.user: UserProfile` / `voiceEngine: VoiceEngine` are
  persona.ts's own types — a second persona must satisfy persona.ts's
  interface shape, not compiler.ts's.
- `AGE_TIER_SAFETY_OVERRIDE` is authored in compiler.ts and is
  register-neutral English — reusable as-is.
- Fixtures import `UserProfile`/`VoiceEngine` from `../persona` — same
  coupling one level down.

**Verdict:** the CORE/TAIL manifest structure is genuinely persona-agnostic;
what binds it to Meera is a single static import and the opacity of
`parts.core`. A second product needs its own persona module swapped in at
that import path, or a persona-selection parameter added to `compile()` —
a small, well-bounded, mechanical change that doesn't exist as a seam today.

## 2. src/engine/router.ts + config/models.json + vy_gate_run

Effectively 100% **(a)** — the most portable component audited. `Lane =
"chat" | "vision" | "extraction"` are generic pipeline stages; the route/
eligibility/telemetry functions are pure over `ModelRow`/`LaneConfig` with
zero Meera/Hinglish/India literals; `models.json` is data; `vy_model`/
`vy_gate_run` carry no person or persona reference (deliberately absent from
PERSON_TABLES). Only trace: `"X-Title": "Meera"` HTTP headers in callers —
cosmetic.

**Verdict:** a second AI person can be onboarded onto the router/gate
machinery today by adding rows to models.json/vy_model and calling
`route()` — no code change. This component already meets the beyond-meera
bar.

## 3. evals/dbattery/*

`judge-provider.mjs` ~100% **(a)** (JudgeConfig dispatch, mock, cost —
already generalized). `common.mjs`/`d0`/`d1` majority **(a)** (pure
statistics; bands data-driven from fixtures.json) with **(b)** islands.
One genuine **(c)**.

Soft-coded (Meera-register data):
- `common.mjs:46` — `MEDIA_RE` tag vocabulary (gif/voicenote/photo/selfie...).
- `common.mjs:59-60` — `HINGLISH_MARKERS` word list.
- `d0.mjs`/`d2.mjs` — archive IDs as literals; `usable.length === 3` as the
  pass bar (Meera's historical bake-off count).
- `d2.mjs:121` RUBRIC — "...companion app called Meera" inside a FROZEN
  judge prompt: mechanically a string edit, but house governance treats
  rubric wording changes as requiring judge re-qualification — stickier than
  an ordinary constant.
- `judge-backtest.mjs:141-153` — `loadArchive()` recognizes only
  charm-grok/charm-luna via if/else; terra-leakage check hardcodes one model
  string.

Structural:
- `common.mjs:52-53` — the Devanagari hard-fail axis is a validity-gate
  POLICY ("target register is romanized Hinglish; Devanagari is always
  wrong") — correct for Meera, undefined for a persona in another script;
  the axis's existence assumes the register choice.

**Verdict:** the battery mechanism (counters, CIs, dispatch, cost metering,
both-orders tallying) is persona-universal; what's Meera's is a handful of
regex/word-list constants, rubric strings naming her, and the archives
themselves — a second persona needs its own known-bad archives regardless of
harness genericity.

## 4. evals/candidate/generate.mjs, scripts/replay.mjs, scripts/derive-adapter.mjs

- `derive-adapter.mjs` **(a)**-dominant; **(b)**: X-Title header, one
  literal Hinglish drift probe ("kaisi ho, kya chal raha hai?").
- `generate.mjs` **(b)**-heavy: SOURCES hardcodes archive names +
  incumbent model literal; TERRA_MODEL/PARAMS pin one candidate. The
  --corpus mode is more portable (compiles fresh through the real compiler,
  inheriting item 1's coupling rather than adding new).
- `replay.mjs`: queries `meera_log` by literal table name — **(c)**-adjacent
  (the legacy anchor, see item 5); UserProfile-shaped stub user **(b)**;
  determinism/rel-event replay **(a)**.

**Verdict:** engines reusable; each script carries hardcoded literals naming
THIS swap test's incumbent/candidate/archives. A second product's swap test
copies these files and edits the constants rather than parameterizing.

## 5. db/schema.sql vy_* tables

Nearly every vy_* table shape is **(a)** — person_id-keyed, no Meera
literal. Exceptions:

- **(b)** `vy_fact.kind` CHECK includes literal `'meera'` (the companion's
  own identity facts) and `'india'`; config/decay.json mirrors the enum.
  A second persona needs a migration.
- **(c)** `vy_rel_state.honorific` CHECK `('tu','tum','aap')` and
  `cs_on_stress` — honorific progression (T-V distinction) and code-switch
  under stress are first-class relational-health dimensions whose
  DEFINITIONS are Hindi/Urdu-family-specific. An English-only or Japanese
  persona has no T-V distinction to enumerate — redesign, not config.
- **(c)** `vy_india_profile`, `vy_kin` (chachi/mausi/bua), `vy_currency`
  (cricket/food/film/festival), `vy_ritual` (khana_khaya/match_checkin) —
  the mechanism (citations, person-keying) is reusable; the concept of what
  counts as a ritual/currency is not culture-neutral.
- **(c)** Legacy `meera_*` tables are product-named yet load-bearing:
  `vy_episode.log_from/log_to` cite `meera_log` spans directly, and
  PERSON_TABLES treats them as authoritative (lane "legacy"). A second
  product needs its own log-equivalent or a generalization of that layer —
  real work.

## 6. api/consolidate.js, api/memory.js

Pipeline mechanics (citation enforcement, writer-window validation,
entailment audit, decay, forget cascade, provisional tier) are **(a)** —
fully person-generic. Specificity concentrates in extraction content:

Soft-coded: IMPORTANCE_ANCHORS few-shots are literal Hinglish/India family
sentences; kind-enum text duplicated into LLM instructions ("kind 'meera' =
the companion's own life..."); "Extract memory from this Hinglish chat
(meera is the AI companion...)"; RECALL_STOP mixed English+Hindi stopword
set; PERSON_TABLES hand-lists Meera's legacy tables.

Structural: `detectAddressTerm` (TU/AAP/TUM_MARKERS — exact Hindi pronoun
forms) and `computeCsRatio` (HINDI_MARKER_WORDS) — the derivation code for
the schema's Hindi-specific dimensions; no analogue for a monolingual
persona. The extraction interior model itself ("now"/"wants"/"owed"/"self")
is a genuinely persona-portable design pinned only by the literal words
"Hinglish"/"meera" — soft-coded wrapping around a reusable idea.

## 7. evals/persona-invariants.mjs

Runner (**a**): ~10 lines of assert/report logic, persona-agnostic in
principle. Invariant data (**c**): every probe is a literal excerpt of
Meera's persona.ts text — it IS Meera, encoded as containment assertions.
The two are conceptually separable but interleaved in one 147-line file with
no module boundary today: lifting the runner means extracting it.

## What a second AI person would actually need

The relational engine — schema, router/gate machinery, judge-provider
dispatch, consolidation/forget control flow — is already close to the
"Meera is instance one" thesis: person-generic by construction; a second
product plugs in with config and fixture changes (new models.json rows, new
archives, a persona.ts-shaped module at compiler.ts's one import). Two
things need real work, not parameter swaps:

1. **Linguistic/cultural relational dimensions** — honorific progression
   (tu/tum/aap) and code-switch ratio are hard-coded into schema CHECKs and
   consolidate.js derivations as Hindi-specific detectors. A persona in a
   non-T-V language has no equivalent axis without schema + derivation
   redesign.
2. **The legacy product-scoped layer** — `meera_log`/`meera_diag` remain the
   ground truth the citation chain anchors to. A second persona sharing the
   database needs its own log-equivalent or that layer generalized.

Everything else — tag regexes, Hinglish word lists, rubrics naming Meera,
archive-name literals, X-Title headers, the `kind='meera'` enum value — is
soft-coded: real, currently un-lifted, and each a bounded edit rather than a
design change.
