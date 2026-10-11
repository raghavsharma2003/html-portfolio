# Remote recovery verified

On 9 September 2026, a new empty bare repository fetched the handover and historical archive directly from GitHub. It reused no local Git objects.

- Handover tested: `31833cdf122be561437c10edb7789d9c45eeb47d`.
- Historical archive: `7a8ad90dd63fd30ea5a1a64bde4cf8dc016b3fb4`.
- All 55 archived evidence files matched their recorded sizes and SHA-256 hashes.
- All 33 historical file lookups required by existing tests matched their original bytes.
- All 10 deliberately absent historical paths remained absent.
- The original policy, development-config and punctuation fix commits were available.

This verifies recovery of the handover, not product quality or launch readiness. No model calls or cloud compute runs occurred. See `remote-recovery-result.json` for the actual receipt.

A normal clone fetches the preservation branches. If using a single-branch or shallow clone, fetch the historical archive explicitly before running tests that use historical Git objects:

```sh
git fetch origin refs/heads/codex/handoff-history-20260909:refs/remotes/origin/codex/handoff-history-20260909
```

Do not merge the archive into the product branch. It exists to preserve Git objects. Continue from `codex/handoff206` and read `START-HERE.md` for the actual unfinished work.
