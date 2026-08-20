# Moving to `raghavsharma2003/Vyakti-products`

The owner's requirement was *"nothing is lost, no context, no code, not even one
line."* This document is the manifest: what moves, what cannot move through git,
and how each half is verified.

Written before the move so the check is a check and not a memory.

---

## 1. State at the time of writing

| | |
|---|---|
| source | `raghavsharma2003/html-portfolio` |
| target | `raghavsharma2003/Vyakti-products` — reachable, **0 refs, completely empty** |
| commits | **300** on `claude/ai-companion-app-rkt1lv` |
| `main` | 4 commits, **verified an ancestor** of the work branch (`git merge-base --is-ancestor` passes) |
| tags | none |
| working tree | clean, everything pushed |

Because old `main` is an ancestor, its four commits are already contained in the
work branch's history. Nothing is lost by promoting the work branch — but the
old pointer is preserved anyway, below, because "nothing lost" should not rest
on an argument.

## 2. The push

```sh
git remote add vyakti https://github.com/raghavsharma2003/Vyakti-products
git push vyakti HEAD:refs/heads/main
git push vyakti HEAD:refs/heads/claude/ai-companion-app-rkt1lv
git push vyakti origin/main:refs/heads/legacy/html-portfolio-main
```

**`main` gets the current code**, and that is not cosmetic — it fixes
`never-scheduled`. GitHub registers `schedule:` triggers **only from the default
branch**, and in the old repo `main` was 296 commits behind with no
`.github/workflows` at all, which is why no consolidation job has ever run in
the life of this project. In the new repo the default branch carries the
workflows on day one.

The work branch keeps its name so this session's history and any open work
continue to line up.

## 3. Verification (run after the push, do not assume)

```sh
# every ref present and pointing where it should
git ls-remote vyakti

# the trees are identical, not merely the same length
git rev-parse HEAD                      # local
git ls-remote vyakti refs/heads/main    # must equal it exactly

# history depth matches
git rev-list --count HEAD               # expect 300
```

Then, in a fresh clone of the target: `node scripts/verify-release.mjs` must
report **8/8**, and `node evals/echosim/build.mjs && node evals/echosim/exp1.mjs`
must reproduce the floor table cell for cell.

## 4. What git CANNOT carry, and what to do about each

This is the part a repository move actually loses, and every item here is
something the push above will silently not include.

| thing | why git misses it | what to do |
|---|---|---|
| `api/_config.js` | gitignored — holds every key | recreated by `scripts/write-config.mjs` from GitHub Actions secrets. **Never commit it.** |
| GitHub Actions secrets | live in repo settings, not the tree | re-add on the new repo: `VERCEL_TOKEN`, `OPENROUTER_KEY`, `GOOGLE_KEY`, `GOOGLE_KEYS`, `GOOGLE_PAID_KEY`, `NEON_URL`, `SUPABASE_URL`, `SUPABASE_KEY`, `AZURE_KEY`, `AZURE_ENDPOINT`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME` — the full list is the `env:` block of `.github/workflows/deploy-web.yml` |
| Vercel project link | the Vercel project points at the OLD repo | repoint the project's Git integration at `Vyakti-products`, or the auto-deploy keeps building the dummy repo |
| the database | Neon is external and **unaffected** | nothing to do — the 131 episodes and 26 texture rows written today are in Neon, not in git |
| Supabase storage | external, unaffected | nothing to do |
| PR #1 | belongs to the old repo | it stays there as history; new work opens a new PR |
| the scratchpad | ephemeral container directory | **already handled** — see below |

## 5. The scratchpad audit, which is why this document exists

Auditing "what would a move lose" found three things living **only** in the
ephemeral scratchpad, none of which git would have carried:

1. **`evals/echosim/`** — the audio-floor simulator. `azure-tts`,
   `goaway-rotation-parity`, `device-seam-closed` and the `liveCall.ts`
   no-imports law all depend on it. Its `build.mjs` also hardcoded
   `/home/user/html-portfolio`, so it would have broken on arrival even if
   copied. **Now vendored, path derived from its own location, verified by
   reproducing the floor table.**
2. **`verify-v3.mjs` / `parsetest.bundle.mjs`** — named as gates in `CLAUDE.md`,
   living outside the repo, and verifying a **frozen persona snapshot**. Kept in
   `evals/archive/` as provenance, explicitly marked not-a-gate. See
   `context/rejected.md#gates-that-live-nowhere`.
3. **The Vercel token** — held at `scratchpad/.sec/vt`, deliberately outside the
   tree. It does not move; it is re-added as a secret on the new repo.

Everything else in the scratchpad is build output, downloaded packages, model
corpora and screenshots — reproducible, and not referenced by any gate.

## 6. After the move

- `origin` should point at the new repo; the old remote can stay as `oldrepo`
  for reference until the transfer is confidently done.
- The `git push -u origin <branch>` habit in this project's instructions then
  means the new repo, with no further change.
- Delete nothing in `html-portfolio` until §3's verification has passed in a
  fresh clone.
