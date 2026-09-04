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

## Other agents work here too

`AGENTS.md` at the repo root is the tool-neutral entry point (Codex, Cursor,
Aider, a human). It states the same laws, gates and reading order as this file.
When you change a rule here, change it there, or the next agent follows the
stale one. Both defer to `context/` if they disagree with it.

## Read this before you change anything

`context/` is this project's memory. It exists because a year-long project
cannot re-derive its own decisions every session, and because the most expensive
knowledge here is **what was already tried and did not work**.

| file | what it holds |
|---|---|
| `context/STATE.md` | **READ FIRST** — one page: what the product is, what is LIVE vs not, open owner items, and the laws not to relearn |
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

The persona invariants and the parser cases run INSIDE `verify-release`'s eval
suite — they are `evals/persona-invariants.mjs` and `evals/parse.mjs`, and
`evals/run.mjs` re-bundles from the real source on every run, so they gate the
tree being shipped rather than a frozen copy. They protect the crisis helplines,
the never-deny-being-an-AI rule, NEVER MANIPULATE, and the spoken-register
bullets. **If your change trips them, your change is wrong, not the test.**

> This paragraph used to say to run `parsetest.bundle.mjs` and `verify-v3.mjs`
> "from the session scratchpad". That was stale and quietly dangerous: the
> scratchpad is an ephemeral container directory, and both of those files import
> a FROZEN persona snapshot (`./peout/final3.mjs`), so following the instruction
> would have verified a months-old bundle while reporting a pass on today's
> tree. Both are kept in `evals/archive/` for provenance and are NOT gates. See
> `context/rejected.md#gates-that-live-nowhere`.

**The audio floor** lives at `evals/echosim/` — `node evals/echosim/build.mjs`
transpiles the REAL `liveCall.ts` standalone, then `node evals/echosim/exp1.mjs`
runs 5 couplings x 8 seeds x 2 arms = 80 simulated calls. Run it before and
after any change that touches `liveCall.ts`, and diff the tables. This is the
only thing that can prove the floor did not move, and it is why `liveCall.ts`
may import nothing beyond `./level` and `../engine/diag`.

`npx vite build` alone is NOT a gate — it exits 0 with type errors. That is why
`tsc` is separate and why CI runs both.

**This same script also gates Vyakti**, the second product built in this
repo (see the next section). As of WS-R57 (2026-09-04) it is **21
checks without `NEON_URL`** (14 plus the room leak battery, `evals/room-leak/run.mjs`,
the room export completeness battery, `evals/room-export/run.mjs`, the
room door battery, `evals/room-doors/run.mjs` — every way into a Room
attacked offline through the real decision modules the thin HTTP doors call
— and `accessibility`, `scripts/check-accessibility.mjs` — axe-core plus a
hand-written keyboard walk over every follower and creator screen in both
locales, zero `serious`/`critical` findings — and `performance budgets`,
`scripts/check-performance.mjs` — the four public entry points rendered in
real Chromium under CDP throttling shaped like a bad Indian 4G day, failing
on a named target and metric — and `mirrored constants`,
`scripts/check-mirrors.mjs` — every `// mirror of api/<file>.js#<NAME>`
marker in `src/` and `site/suites.html` parsed on both sides and asserted
equal — and `security headers`, `scripts/check-headers.mjs` — the Room, the
studio and four static marketing pages loaded in real Chromium on
127.0.0.1:8934 with `vercel.json`'s own headers applied exactly as Vercel
would and CSP violation reporting captured, plus `npm ci --dry-run` lockfile
integrity, `npm audit --omit=dev --audit-level=high` (fails, never passes
silently, if the registry is unreachable) and an install-script scan against
the named allowlist in `scripts/installScriptAllowlist.mjs` — each added as
a named gate) and **23 with
it** (adding the zero-orphan sweep and citation discipline). `scripts/check-copy.mjs` — the same em-dash ban this
file already names — also enforces a **Rooms vocabulary rule**: no `clone`,
`replica`, `model`, `fine-tune`/`train`/`training`, `weights`, `embedding`,
`LoRA` or `genome` in any user-visible string in `src/studio/`, `src/room/`,
`site/vyakti.html`, `site/suites.html`, `studio.html` or `room.html`, with the only escape hatch
(`scripts/roomsVocabAllowlist.mjs`) scoped by name to two files carrying
pre-existing legal text a person already consented to.

## Vyakti — the other product in this repo

This repo also builds Vyakti, a platform where a creator turns their own
archive into an AI version of themselves that talks to their followers.
**Vyakti Rooms v1 (adopted 2026-09-02)** is the current product definition:
a follower gets a private, continuing relationship with a creator's AI — "your
AI" to the creator, "`<Name>` AI" to a follower, never "clone" in any
user-visible string. Three scopes never blur: creator material flows down to
everyone; a follower's own words stay in that follower's private scope alone;
the creator sees only counts over an opt-in shared subgraph (`n>=5`, never
verbatim). The Room lives at `/r/<slug>`; `AGENTS.md` and `docs/gurukul/`
carry the full detail, `context/STATE.md` the current LIVE state, and this
file's rules (gates, `context/`, the copy ban, never claiming what you did not
run) bind Vyakti work exactly as they bind Meera's. Migrations: **015 through
065, 071 through 099 and 101 through 107 are applied live, except 100 and
103, which are unused (WS-R38 and WS-R41 needed no schema change); 066-070
are deliberately left unused** (another agent's unpushed tree already
occupies those numbers live). **108 is the next free number.**
`context/STATE.md`'s session log carries the live-verification entry for each.

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
