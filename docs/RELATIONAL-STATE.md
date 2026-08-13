# The Relational-State Program

This is the program brief for the pivot logged as `relational-state` in
`context/`. It survives compaction; if a session loses its memory, this file
plus `context/` is the re-entry point.

## The claim

**An AI person's identity and relationship can be made to survive replacement
of the model underneath her.** Today this is false and measured false
(`charm-grok`, `realtime-azure`). The company exists to make it true.

North star: **migration fidelity × relationship retention.**

## Phases — no phase starts before the previous one's output is reviewed and logged

```
A. RESEARCH   parallel sweep, 10 tracks → verified → RESEARCH.md
B. DESIGN     independent architecture proposals → judged → SPEC.md
C. BUILD      relational engine: identity core, relationship state,
              consolidation, context compiler, model router, eval suite
D. SWAP TEST  offline judge-based fingerprinting first, then consented cohort
E. USERS      only when the owner is satisfied
```

## Phase A: COMPLETE (2026-08-13)

Output: `docs/research/RESEARCH.md` (synthesis) plus the ten track files beside
it. 23 agents, 12 load-bearing claims adversarially verified (5 confirmed, 6
corrected, 1 killed), corrections applied inline. Headline findings are logged
in `context/` — start from `node scripts/context.mjs --node phase-a-research`.

## Research tracks (Phase A)

1. **memory-arch** — LLM-agent memory systems, measured not marketed
2. **cognitive-arch** — episodic/semantic/consolidation from cognitive science
3. **identity** — what layers of identity exist and which can live outside the model
4. **lab-products** — what OpenAI/Anthropic/CAI/Replika/Nomi/Sesame actually ship
5. **multimodal-state** — remembering how things were said and what was watched together
6. **india** — code-switching, honorific dynamics, the cultural state schema
7. **market-verify** — the strategy chat's numbers, verified with sources
8. **repo-audit** — keep/lift/rebuild verdict on every existing component
9. **swap-test** — the migration-fidelity experimental protocol
10. **safety-reg** — FTC/China/DPDP constraints as architecture, not compliance

## Standing constraints

- Safety invariants are non-negotiable inputs to the design, not features of it.
- `prompt-position`, `recited-prompt`, `silent-truncation` are laws here.
- The swap test uses a consented, debriefed cohort. No covert switches.
- Existing code has no seniority; replaced work is logged, never just deleted.
- Every phase output lands in `context/` before the next phase begins.
