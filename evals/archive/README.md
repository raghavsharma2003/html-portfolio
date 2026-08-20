# Archive — harnesses kept for provenance, NOT gates

These two files were named in `CLAUDE.md` as gates to run "from the session
scratchpad". They are here because that instruction was wrong in two ways at
once, and deleting them would have destroyed the record of what was verified
when.

**They are not gates. Do not run them expecting a verdict about today's tree.**

## What they are

| file | what it checks | why it is not a gate |
|---|---|---|
| `verify-v3.mjs` | that EDIT A's machine-word guard and EDIT C's English-first rule sit inside the SPOKEN REGISTER block, on both voice lanes | imports `./peout/final3.mjs`, a **frozen persona snapshot** that no longer exists in the tree |
| `parsetest.bundle.mjs` | 14 parser cases | a generated **bundle**, frozen at the moment it was built |

## Why keeping them matters

Both verify a *snapshot*. That is exactly what makes them useless as gates and
valuable as history: they record what the persona and parser looked like at the
moment a specific claim was measured, and several entries in `context/` rest on
runs of these files. Deleting them would leave those measurements unfalsifiable.

## What replaced them

The live equivalents are in the repo and run inside `verify-release`:

- `evals/persona-invariants.mjs` + `evals/persona-invariants.data.mjs`
- `evals/parse.mjs`

`evals/run.mjs` re-bundles from the **real source** on every run, which is the
property the archived pair lacks.

## The rule this cost us

A gate that lives outside the repository is not a gate. It cannot run in CI, it
cannot be reviewed, it vanishes when a container is reclaimed, and — the part
that actually bit — it can go on passing against a frozen copy long after the
source it was written for has moved, reporting green about code it has never
read.

Recorded as `context/rejected.md#gates-that-live-nowhere`.
