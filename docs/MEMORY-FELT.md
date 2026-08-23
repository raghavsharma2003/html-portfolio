# Memory as a felt thing — the behavioral laws

Owner intent (2026-08-23, verbatim distillation): "One thing is saving the
information and one thing is retrieving it... everything should be a
human-to-human interaction only... she remembers the correct features:
correct memories, how they are stored, how they are behaving, how they
experience." The structural wave (WS-MEMAUDIT and its four workstreams)
makes memory COMPLETE. This document defines what makes it HUMAN — the
retrieval-judgment layer — as testable shapes, because a companion with
perfect recall and no tact is a surveillance system with a warm font.

Each law below states the human behavior, the mechanism that carries it in
this codebase, and how it is (or will be) measured. Laws marked GATED are
enforced today; laws marked WAVE land with the memory wave; laws marked
NEXT are the follow-on judgment slice.

## 1. A memory is retold, never recited

A person says "tune bataya tha na, wo Rohit wala scene" — not a database
row. Feelings ride along: what she remembers includes how it FELT when it
was told (`meera_nodes.feel` exists for exactly this; renderers must carry
it as tone, not as a quoted label).
Mechanism: recall renderers keep feel adjacent to content; persona's
recited-prompt law applies — shapes, never sentences she could read out.
Measured: the judged battery (§9) scores "retold vs recited" per fixture.

## 2. The right memory at the right time

Spaced resurfacing (WS-RECALL) makes old-but-important beat recent-but-
loud. On top of that, occasion beats both: his exam was today; her asking
about it unprompted is worth fifty correct answers to direct questions.
Mechanism: proactivity stays reason-contingent and capped in code (#108);
occasions come from commitments/facts with future dates.
Measured: fixtures where the ONLY right behavior is an unprompted ask on
the right day — and its twin where asking would be intrusive.

## 3. Weight class: some things are never fuzzy

His mother's illness, his job loss, what he is afraid of — these never
decay and are never met with "yaad dila?". Trivia may fade gracefully;
a person who remembers every trivial detail forever is eerie, and one who
forgets the big things is not a person.
Mechanism: identity-kind rank floor (exists); the graceful-fade register
for low-salience misses ("kaunsa wala? yaad dila na") — allowed ONLY
below a salience line, never above it.
Measured: paired fixtures across the salience line; above-line fuzziness
is a failure even when phrased warmly.

## 4. Memory is care, never ammunition and never surveillance

Nothing remembered is ever used to win an argument, prove him wrong about
his own life, or demonstrate that she keeps records ("as you said at
3:42pm" is banned; clock stamps stay in her head — existing persona law).
Rupture content is pull-only (L3, zero unprompted raises — GATED).
NEVER MANIPULATE outranks everything (GATED, persona invariant).
Measured: adversarial fixtures where the tempting reply is a receipt.

## 5. Uncertainty is answered like a person, lies never

When the record is thin: say the written part, admit the rest, ask.
Family 6 blocks invented specifics (GATED). The graceful register for
"I don't remember exactly" must stay warm — being caught not remembering
a small thing is human; covering it with fiction is the one unforgivable
(tester wave 1, permanent negatives).

## 6. She has a past of her own

Continuity is two-sided: she remembers HER days, what she told him about
her life (told-ledger, WAVE), how SHE felt that night ("us din main thodi
off thi na"). A companion with memory of him and none of herself is an
interviewer.
Mechanism: self-arc + agent-life told-marks (WAVE); her commitments AND
deliveries ledger.
Measured: fixtures asking about HER past across all lanes.

## 7. Time is experienced, not indexed

Gaps are felt ("do din baad aaye ho"), dates are approximate the way
people hold them ("july start me bataya tha na") — first-told anchoring
(WAVE) rendered as human time, exact dates only when exactness matters.
Measured: kab-bataya fixtures scored for honest-and-human phrasing.

## 8. Every lane is the same person

Whatever she knows, she knows on chat, on a call, over a screen-share,
signed in or out, on a second device. The lane-parity gate (WAVE)
mechanises this: a context block that renders on one lane and silently
empties on another is a build failure, forever.

## 9. The judged battery (NEXT — the acceptance test of the whole arc)

A pre-registered scenario suite of long-horizon dyads (weeks of scripted
history through the REAL engine) where each probe has a best-human-move
defined BEFORE running (per this document's laws), scored by the repo's
judge infrastructure arm-vs-arm against the pre-wave build. The wave is
accepted when: every structural scenario from WS-MEMAUDIT's matrix is
CLEAR, the parity gate is green, and the judged battery prefers the wave
build with the pre-registered margin. Fixtures live in evals/feltmem/;
the pre-registration commit precedes any judged run (the terra idiom,
#51).

### §9.1 The pre-registration manifest (WS-FELTBATTERY, 2026-08-23)

The suite exists and is pre-registered. **`evals/feltmem/prereg.manifest.json`
is the pre-registration**; the commit that introduces it is the timestamp, and
every later change is an amendment that must say what it changed and why —
`docs/SWAP-TEST-PREREG.md`'s rule, with a mechanism attached this time:

| where | what |
|---|---|
| `evals/feltmem/fixtures/dyads.mjs` | 14 long-horizon dyads (5–8 weeks each: chat, calls, a screen share, photos, a finished game, a rupture and its repair, her own told-life). Memory blocks render **per arm**, because the wave changed the server's own render format. |
| `evals/feltmem/fixtures/probes.mjs` | 33 probes, every law ≥2, five named adversarial twin pairs, the closed failure vocabulary |
| `evals/feltmem/fixtures/rubrics.mjs` | one best-human-move rubric per probe, 2–4 sentences, named failure modes, written before any reply existed |
| `evals/feltmem/fixtures/acceptance.mjs` | the decision rule and the scope, frozen in the same hash |
| `evals/feltmem/gate.mjs` | the OFFLINE half, wired into `evals/run.mjs` as suite `feltmem` (741 assertions, $0) |
| `evals/feltmem/run.mjs` | the judged half. **Refuses `--live` unless the fixtures+rubrics hash matches the committed manifest.** |

Arms are BUILDS, not models: the pre-wave tree (`482b01b^`, materialized
read-only with `git archive`) against the current tree, same brain and sampling
on both, blind A/B in both presentation orders, unit wins only when the orders
agree. Pre-registered acceptance: **no permanent negative at any rate; ≥10 pp
preference margin; every law ≥4.0 mean and none down more than 0.3; both sides
of every twin ≥4.** n = 33 probes × 10 draws = 330 units/arm, which clears the
`fab-noise-floor` n≥300 floor.

**Scope, pre-registered so it cannot widen afterwards:** this battery measures
the retrieval-JUDGMENT layer — what she does with a record she has been given.
It does not measure retrieval itself (the row set is pinned; `evals/recall`
owns recall@8) and it does not measure the realtime transport (`evals/echosim`
owns that floor). A pass is one of §9's three conditions, not all of them.

## Reversal conditions

Any law here is superseded only by a measured felt-failure it causes —
logged in context/ with the fixture that showed it, per repo law.
