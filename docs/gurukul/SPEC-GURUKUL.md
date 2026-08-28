# SPEC — Gurukul (working title): teacher clones on the RelationalOS

Owner intent (2026-08-25, voice note, verbatim gist): *get the best from both
branches and build a product where a credible JEE Advanced teacher uploads
YouTube videos / voice snippets / texts, and the platform builds a clone of
them — info, personality, behavior, culture, style, tone, voice — carrying all
the relational-OS machinery; students then chat and call that clone in an app
with Duolingo-grade gamification. Quality cannot be compromised: on a call you
should not be able to tell the clone from the teacher.*

This spec is the synthesis of four commissioned drafts in this directory —
`teacher-arc.md`, `teacher-sheet-spec.md`, `safety-floor-teacher.md`,
`student-app-spec.md`, `ingestion-research.md` — plus the two source-branch
audits. Where this file and a draft disagree, this file wins; the drafts keep
their full detail.

---

## 0. What this branch is

`claude/gurukul-platform` = the union of the two parent lines, verified:

- **RelationalOS / companion line** (`claude/ai-companion-app-rkt1lv` @ f4d3fe4)
  — the relational engine: prompt compiler with CORE/TAIL budgets, memory
  graph + consolidation with citation enforcement, rel-state (trust, rupture/
  repair, honorifics), honesty gates as output-path predicates, safety floor
  (crisis lines, never-deny-AI, NEVER MANIPULATE, internals fence), the audio
  floor (`liveCall.ts` + echosim), activities, surfaces (web/Telegram/
  Capacitor), multi-agent tenancy (migrations 009/010, `_agentscope.js`), and
  the CharacterSheet/AgentModule seam proven by Kabir (412/412, zero engine
  changes).
- **Replica Lab line** (`voice-cloning` @ a7bdcaa) — the identity-verified
  self-cloning platform: Studio SPA (`/studio`), consent scopes (versioned,
  revocable), evidence upload → quarantine → VoiceGenome, Azure Personal
  Voice + self-hosted Chatterbox provider adapters behind one contract,
  Person Model (cited claims, owner-approved one by one), calibration,
  frozen runtime capabilities, watermark/C2PA provenance, erasure cascades.

The merge (554cc5d) had 10 contested files; two integration fixes followed
(d2d85be). **All 11 verify-release gates pass on the union tree.**
`liveCall.ts` is byte-identical to the companion's verified state, so the
audio floor's standing measurement carries over.

## 1. The thesis

Gurukul is not a third codebase. It is the first *composition* of the two
layers that were each built to be composed:

```
teacher uploads (video/audio/text)          student app (chat + calls + practice)
        │                                            ▲
   REPLICA LAB  ──── produces ────►  TEACHER AGENT ──┤
   (consent, identity, evidence,     = vy_agent row  │
    VoiceGenome, Person Model,       + TeacherSheet  │
    calibration, provenance)         + voice profile │
                                     + knowledge kit │
                                            ▲        │
                                     RELATIONAL OS ──┘
                                     (memory per dyad, rel-state, honesty,
                                      safety floor, compiler, activities,
                                      call engine, surfaces)
```

A teacher clone is: **one `vy_agent` row + one TeacherSheet (CharacterSheet
extension) + one voice profile + one knowledge kit**, dropped onto the
unchanged engine. Every student–teacher pair is a dyad the OS already knows
how to hold: episodes, facts, patterns ("you always rush integration by
parts" is a `vy_pattern` with two citations), rituals ("mock test ho gaya?"),
milestones, trust. Isolation between teachers is `_agentscope.js`'s SQL
predicate — the same law that already guarantees 0-in-31,122 leakage.

## 2. What each parent contributes, and what is genuinely new

**Inherited unchanged (no code):** compiler, memory pipeline, honesty
predicates, safety floor invariants (now covering every registered agent via
`evals/persona-invariants.mjs`), audio floor, burst pacing, sound system,
Studio consent/identity/evidence/erasure machinery, provider contracts,
budget fencing, eval harnesses.

**Inherited with parameterization (bounded, mechanical):**
- `api/memory.js` extraction prompts naming "meera"/Hinglish → agent-
  parameterized wording; `vy_fact.kind` CHECK gains a generalized value
  (migration).
- Registry: today compile-time static (`registry.ts`). Gurukul needs
  **DB-backed sheets**: TeacherSheet rows stored at publish time, an
  AgentModule constructed at runtime from the stored sheet, with the
  invariant checks run at **publish time** (studio-side) instead of build
  time. The static registry stays for Maya/Kabir; the dynamic loader is
  additive.
- Stage paragraphs / rituals / currency: the mechanisms stay; the content
  becomes sheet-suppliable **optional overrides** (absent → today's bytes,
  preserving the 83-fixture byte-identity gate for Maya).

**Genuinely new (the real build):**
1. **TeacherSheet** — CharacterSheet (61 fields; the "46" in early notes was
   wrong) + 24 pedagogy fields (`explanationOrder`, `workedExamplePattern`,
   `firstMoveOnDoubt`, `doubtEscalationLadder`, `commonMistakeBank`,
   `analogyBank`, `boardVerbalisms`, `strictness`/`warmth`…) — full field
   table and publish-time validation in `teacher-sheet-spec.md`.
2. **Ingestion pipeline** — teacher uploads (direct upload preferred over
   YouTube scraping; OAuth "acting as owner" for their own channel is the
   compliant YouTube path) → Hinglish ASR (Sarvam Saaras first candidate;
   Whisper large-v3 measured 32–52% CER on code-switched pairs — see
   `ingestion-research.md`) → statistical pass (filler/laughter/code-switch
   ratios, catchphrase candidates with the ≥5-occurrences phrase-bank rule)
   + LLM extraction pass through the existing claim-extraction machinery
   (cited claims, teacher approves each) → sheet draft → teacher review →
   publish gates.
3. **Teacher-student relational arc** — replacement stage paragraphs
   (competence → shared working history → durable standards), ability-label
   ban, praise-the-method-never-the-ability, exam-cycle calendar as
   window-not-countdown. Full content in `teacher-arc.md`.
4. **Pedagogy layer** — practice-session activity (`practiceTalk.ts` adapter
   mirroring `chessTalk.ts`: deterministic grading engine emits facts, the
   persona only talks about them), JEE PCM syllabus taxonomy, mastery map,
   question formats incl. JEE Advanced partial marking. Full spec in
   `student-app-spec.md`.
5. **Voice** — cloned-voice calls are **cascade only** (verified: neither
   Gemini Live nor OpenAI Realtime takes custom cloned voices in 2026). The
   existing cascade (STT → brain → TTS) is already built; the work is a
   cloned-voice TTS engine slot behind the existing provider contract.
   Provider strategy: Azure Personal Voice (Limited Access, pending
   Microsoft approval) and self-hosted Chatterbox (no approval gate) are
   already coded; ElevenLabs PVC / Cartesia (markets Hinglish code-switching
   by name, ~40ms TTFA) / Sarvam cloning are the bench-test candidates. No
   vendor publishes cloned+Hinglish+streaming numbers — we measure ourselves
   before committing. Target < 1.5s turn latency; achievable but STT-bound.

## 3. Safety floor — the deltas (binding)

Full text in `safety-floor-teacher.md`. The non-negotiables:

1. **Disclosure inversion.** Never-deny-being-an-AI stays verbatim; "don't
   volunteer it" inverts to **proactive clone disclosure**: session-open
   card, spoken disclosure opening every synthesized call (already law in
   the Replica Lab: watermarked, C2PA-signed, non-disableable), and a new
   honesty predicate `teacher-relay-claim` — the clone never implies the
   real teacher saw or said anything they didn't.
2. **Minors are the default.** Student accounts default `AgeTier: "minor"`
   with `MINOR_HARD_GATES` (engagement mechanics structurally off). The
   companion's `unverified → adult` mapping is a Meera-scoped owner decision
   and does NOT carry over. The romance-register escalation clause is
   deleted from teacher content at the content layer AND gated at the config
   layer — two independent layers, per the house both-layers rule.
3. **Consent is the teacher's, always.** The Replica Lab's self-only law
   carries over exactly: identity + liveness verification before any clone
   activates; revocation deregisters the module and invalidates the voice
   profile in one transaction (citing `cache-outlives-the-voice`); slugs
   never reused (citing `pk-is-an-arbiter`).
4. **Gamification must survive NEVER MANIPULATE.** The falsifiable test: a
   mechanic is allowed iff removing every fear and obligation from it leaves
   the mechanic intact. No streak-freeze economy, no loss-anxiety framing,
   no manufactured urgency (JEE countdown included), XP only from graded
   outcomes. `milestones.ts`'s stance is the model — and the syllabus is
   already a real progression system.
5. **Academic integrity by structure**: `firstMoveOnDoubt` +
   `doubtEscalationLadder` make a full solution structurally never the
   first response; assembly-layer suppression during live-assessment
   windows.
6. **Crisis floor**: locale helplines stay invariant-gated per module;
   adding Childline 1098 to a sheet REQUIRES adding it to
   `honesty.ts` `PUBLISHED_HELPLINES` in the same change, or the gate will
   suppress the number it was meant to guarantee.

## 4. Deployment reality (from the Replica Lab audit — nothing hidden)

The replica platform is thoroughly built and thoroughly **un-turned-on**:
- 36 DB migrations (015–050) exist, none applied to live Neon.
- 5 standalone services (azure-verifier, voice-evidence, audio-protection,
  open-voice-runtime, replica-processing-worker) have Dockerfiles + Bicep
  and **no CI/CD path**; never deployed.
- ~55 env vars consumed by the replica lanes, none set anywhere; most fail
  closed by design. `CRON_SECRET` alone silently 401s all five sweeps.
- Two Microsoft Limited Access approvals (Personal Voice, Face liveness)
  are manual gates not yet requested. Chatterbox is the approval-free lane.
- The "codex service" recalled by the owner does not exist in the tree; the
  only "Codex" references are to an external coding agent that apparently
  deployed the vyakti.ai marketing site. Flagged, not guessed at.

Phase order therefore: sheets + arc + pedagogy on the existing deployed
stack first (they need none of the above), replica activation second
(migrations → Vercel env → services → approvals), cloned-voice calls third
(provider bench + cascade slot).

## 5. Workstreams

| WS | scope | depends on |
|---|---|---|
| A | TeacherSheet type + arc-override seam (optional sheet fields; Maya byte-identity preserved) + demo teacher sheet | — |
| B | Dynamic agent loading: `vy_teacher_sheet` table, publish-time invariant runner, runtime AgentModule constructor | A |
| C | Pedagogy: practice activity state + `practiceTalk.ts` + syllabus taxonomy + question formats | — |
| D | Student surface: minor-first gating defaults, practice hub + mastery map screens on the existing shell | C |
| E | Studio re-skin: teacher onboarding flow over the Replica Lab wizard (sheet review/approve step alongside Person Model claims) | A |
| F | Ingestion v1: upload → ASR → statistical + claim extraction → sheet draft | A, E |
| G | Deploy/keys: migrations plan, env var manifest (single place, ending the reverse-engineering), CI for services | — |
| H | Voice bench: cloned+Hinglish+streaming latency across Chatterbox/ElevenLabs/Cartesia/Sarvam; cascade TTS slot | G |

## 6. Open owner decisions

1. **Name.** "Gurukul" is a working title.
2. **Repo.** This branch composes cleanly in-place; `TRANSFER.md`'s manifest
   is the playbook if/when it moves to its own repo (Vyakti-products exists
   and was empty at last check).
3. **Microsoft Limited Access** applications (Personal Voice, Face
   liveness) — owner-initiated, lead-time unknown.
4. **Key rotations** recommended by session-2026-08-25b (two keys printed
   into transcripts) — still open.
5. **Provider spend**: the voice bench (WS-H) costs real money; the
   existing `AZURE_REPLICA_APP_BUDGET_USD` fencing is the mechanism, owner
   sets the number.

## 7. Fixed bugs / findings carried from the drafts

- Cross-agent leak in `forgetCandidates()` — **fixed** (d2d85be).
- Studio motion-lint violations — **fixed** (d2d85be).
- `STAGE_GETTING_CLOSE` contains a literal, uninterpolated
  `${C.stageNickname}` (double-quoted string in `persona.ts`) — the model
  receives those raw characters today. Filed, NOT fixed here: fixing changes
  Maya's compiled bytes and must be done deliberately with the fixture
  battery regenerated, not as a drive-by.
- `clock.ts` unverified→adult mapping: correct for Meera per owner decision,
  must not leak into the student surface (WS-D flips the default per
  product, not globally).

---

## 8. Owner reweight (2026-08-26, verbatim intent)

North star: *"a self-serve platform where an expert builds an AI version of
themselves that stays current just by giving some context and their YouTube
channel — voice, style, personality, everything that makes a human — remembers
each person it talks to, and comes with a MEASURED guarantee that it still
sounds like them"*, running on RelationalOS end to end, cloning through
deployment (edtech first: the clone deploys to students as an app). Long-run
bar: beat Delphi.ai and ElevenLabs (instant cloning included). No compromises.

Binding consequences:

1. **In-house replica stack, vendor-independent.** The self-hosted lane
   (`services/open-voice-runtime`, open weights on our own GPUs, fine-tuned
   per expert) is the PRIMARY voice path, not the fallback. Azure Personal
   Voice drops to optional; its Microsoft Limited Access application is no
   longer on the critical path. Honest framing, held to by measurement: raw
   TTS parity with ElevenLabs is a BENCH RESULT we chase (fine-tuning, our
   own curricula), never a marketing claim; the durable moat is what no TTS
   vendor has — RelationalOS person-ness, continuity memory per listener,
   consent/provenance, and the fidelity guarantee below.
2. **The fidelity guarantee is a product feature.** "Still sounds like them"
   = a numeric fidelity score per clone (speaker-embedding similarity from
   the voice-evidence stack + the blind owner-calibration pass), recomputed
   on every voice/model update, surfaced to the expert, gating activation.
3. **Stays-current is a loop, not an upload.** Channel link → new-video
   detection → re-ingestion → PROPOSED claims/sheet deltas the expert
   approves — never silent self-update of a live persona.
4. **Maya/Meera is deprioritized as a product.** The engine gates stay (they
   are what keep the OS honest); no further effort goes to Meera surfaces.
