# Meera — working notes for whoever picks this up next

Meera is a premium Hinglish AI companion: a warm, funny, chronically-online
24-year-old Indian woman who texts, takes voice calls, and watches your screen
during a call. Web at `meera-silk.vercel.app` (landing `/`, app `/chat`) plus an
Android APK via Capacitor.

**The product is whether she feels like a real person.** Every technical
decision in this repo is downstream of that. Speed and quality are never traded
away — that is an explicit standing instruction from the owner, not a
preference.

---

## Read this before you change anything

`context/` is this project's memory. It exists because a year-long project
cannot re-derive its own decisions every session, and because the most expensive
knowledge here is **what was already tried and did not work**.

| file | what it holds |
|---|---|
| `context/graph.json` | the index: nodes + edges, machine-readable |
| `context/decisions.md` | what was decided, why, and what would reverse it |
| `context/measurements.md` | every measured number, with n and method |
| `context/rejected.md` | what was tried and failed — read this FIRST |
| `context/architecture.md` | the components and how they connect |

Start with `rejected.md`. Several obviously-good ideas in this codebase are
obviously good and also measurably wrong, and the reasons are not guessable.

Query the graph with `node scripts/context.mjs` (no args lists everything;
`--node <id>` shows one with its edges; `--check` validates it).

### Logging context at the end of a session

When the owner says to log the session, append what was learned to the files
above and re-run `node scripts/context.mjs --check`. The rule for what belongs:

- A **decision** needs its rationale AND what evidence would reverse it. A
  decision without a reversal condition is dogma and will outlive its reason.
- A **measurement** needs n, method, and date. A number without those cannot be
  compared against a future one, which is the only thing numbers are for.
- A **rejection** needs what was tried and what specifically broke. This is the
  highest-value entry type and the one most often skipped.
- Anything superseded gets a `supersedes` edge rather than deletion. The history
  of a wrong turn is what stops it being taken twice.

---

## How to work in this repo

**Gates — all must pass before anything ships:**

```
node scripts/verify-release.mjs                    # tsc + prompt budget + build
node scripts/verify-release.mjs --live <base-url>   # + production probes (costs money)
```

Plus, from the session scratchpad when persona or parsing changed:
`parsetest.bundle.mjs` (14 cases) and `verify-v3.mjs` (138 persona invariants).
The invariant suite protects the crisis helplines, the never-deny-being-an-AI
rule, NEVER MANIPULATE, and the spoken-register bullets. **If your change trips
it, your change is wrong, not the test.**

`npx vite build` alone is NOT a gate — it exits 0 with type errors. That is why
`tsc` is separate and why CI runs both.

**Prompt budget:** `scripts/check-prompt-budget.mjs` fails the build if an
assembled prompt exceeds the cap `api/chat.js` slices it at. This exists because
truncation is silent and eats the END of the prompt, where the newest and most
safety-relevant text sits. It has already cost us the crisis helplines once.

**Secrets:** `api/_config.js` is gitignored and holds every key. It is deployed
as part of the Vercel payload. Never commit it, never print a key.

**Deploying:** the Vercel build pulls the full source from the GitHub branch, so
**push before you deploy** or you will ship the previous tree with new API files.

---

## Where her personality actually lives

`src/engine/persona.ts` is ~45k characters and it is the product. Two rules
learned the hard way:

1. **Anything sentence-shaped in a prompt gets recited.** Her own example
   quotes acted as a phrase bank (recited 4/5 → 0 after removal). Later, taste
   written as polished English sentences was read out verbatim twice, eight
   turns apart. Write shapes and notes, never lines she could say.
2. **Position is mechanism, not style.** A rule buried mid-brief fired 0 times
   in 8; the identical rule appended last fired 8 in 8. `SEARCH_DECISION` and
   `FORGET_DECISION` are appended last for exactly this reason.

---

## The thing that makes this project unusual

Almost every claim in `context/` is measured, and several widely-held
assumptions in it turned out to be false when tested. Prefer measuring to
reasoning, and when you cannot measure something, say so in the commit rather
than implying coverage you do not have.

## Model policy (owner directive, 2026-08-13)

**Fable runs the main loop and everything important**: phase reviews, judge
synthesis, architecture decisions, anything that becomes a `context/` entry or
a commit. **Sonnet/Opus run the rest**: build workstreams, research sweeps,
verification fan-outs, mechanical batteries. Rationale: the main loop hit
Fable's usage limit mid-build once (two workstreams died in flight); important
judgment is worth the scarce budget, bulk execution is not.

## Logging is not optional

This is a long, deep project. Every phase output, measurement, rejection and
decision goes to `context/` (and `docs/` for full corpora) BEFORE the next
phase starts — the graph is what stops tokens being spent re-deriving what a
previous session already paid for. If it isn't logged, it didn't happen.
