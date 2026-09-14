# Wave 25: live readback before changing production

Date: 2026-09-14. Source base: `16fae19ff5a176178be11f7897d946d73a3bf68b`, fetched from the owner's requested `claude/vyakti-cloning-platform-aq05n4` branch. Work continues on that branch in the isolated `Vyakti-platform-standalone25` checkout. Older dirty worktrees are preserved.

## Meera production differs from the handover's assumption

The Vercel `get_deployment` response for `meera-silk.vercel.app` identifies:

- Project: `meera`, `prj_NZ4BT0Vr2BbkVrvWPcJNF68XCObp`.
- Deployment: `dpl_6h1vntvsAJoHimdfCLL2QSNk4Quu`, production, READY.
- Source: `raghavsharma2003/html-portfolio`, branch `claude/gurukul-platform`, commit `bee9061f52e95231589d9969551cd687fb6c140c`.

This is not the `html-portfolio` Vercel project. The current source branch tip is newer than the deployed source, so redeploying its tip would not preserve the exact running product.

GitHub reports that `raghavsharma2003/Meera` already exists, default `main` at `72041b27ca24aa6114cc311778d5e358e5b6e6c5`. Its two-commit history does not contain the deployed commit (`git merge-base --is-ancestor` exit 1). Rather than overwrite that independent work, the exact deployed source and its full reachable history were pushed to `raghavsharma2003/Meera`, branch `archive/production-20260914`. `git ls-remote` verified its tip equals `bee9061f52e95231589d9969551cd687fb6c140c`.

Meera's default branch, Vercel repository connection, aliases and production deployment have not been changed. Preserve this distinction: history is secured; the deployment connection has not yet moved.

## Access actually observed

- GitHub connector reports admin/push access to both repositories; Git transport push succeeded.
- Vercel connectors can inspect all three projects. Their exposed tools do not include environment-variable writes or repository-link updates.
- No Vercel CLI credential file was found in the standard locations checked. No Vercel/Azure secret-bearing environment variable names were present in the current shell.
- The sole connected browser reaches Vercel's sign-in screen. Browser navigation initially timed out, then the same tab readback proved sign-in was required; this was not a deployment failure.
- Existing local Azure account/helper access is being checked independently, without provider calls or resource mutations. Do not assume Claude's missing cloud credentials imply this machine has none.

The latest STATE block, unlike the older CODEX-HANDOFF paragraph, says production-scoped service settings exist for Vyakti. Their values and scope have not been independently inspected in this readback. Never treat the older blanket claim that all settings are empty as current evidence.

## Source correction

The Room caller trace is `_room-surface.js` -> `_surface.js` -> `think()`. Removing `api/chat.js` alone cannot migrate Room replies to Azure. The provider workstream owns the actual call path and preserves budget enforcement; surface removal must coordinate shared prompt-cap tests.

No new deployment, model invocation, GPU wake, database mutation, or successful final release gate is claimed by this readback.

## Follow-up results

- The owner-requested retirement of `raghavsharma2003/Vyakti-GroupAI` completed through GitHub REST. Independent GET readback at `2026-09-14T07:26:26.866Z` reported `archived: true`, `private: true`, default branch `main`. Archiving retains its history. The current Vyakti port is the disclosure evaluator described in `docs/gurukul/HANDOFF-KERNEL.md`, not a claim that every GroupAI subsystem was copied.
- Existing protected Azure service-principal authentication succeeded for read-only ARM queries. The existing Foundry account `raghavsharma1729-compan-resource` in `rg-raghavsharma1729-7190`, East US 2, reports succeeded deployments including `gpt-5.6-terra` and `gpt-4.1-mini`. Its services endpoint is `https://raghavsharma1729-compan-resource.services.ai.azure.com/`. No new Foundry provisioning is needed merely to obtain an account and chat deployments.
- Two existing AI Services accounts returned HTTP200 and provisioning state Succeeded. This does not prove the Speech key flagged in Vercel is valid or that Personal Voice access is approved.
- The protected local helper can retrieve an Azure key in memory when it is time to bind the app; no key was requested or printed in this discovery. Vercel write access remains the missing connection. The browser's normal ChatGPT sign-in route also reached an authentication screen; no account session was manufactured.
- Baseline `npm ci --ignore-scripts --no-audit --no-fund` installed 161 packages and `node node_modules/typescript/bin/tsc -b --force` exited0 before product changes. Ignored config contains the checked-in blank stub only. Neither result proves the final release, real authentication or voice quality.
