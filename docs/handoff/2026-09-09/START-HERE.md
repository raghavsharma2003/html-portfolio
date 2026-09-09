# Vyakti handover: 9 September 2026

**Not ready for production. Preserve the full product goal. Do not restart research or mistake an offline test for real quality.**

The user asked to prioritize committing and pushing all completed work before their usage limit. New paid experiments were stopped. The intended product is creator-first: **Feed it → Meet it → Deploy it**, an expert's editable knowledge, voice, personality and scoped memory for each person. Azure-only serving; no local Docker. Hindi, Hinglish and English are priorities. Existing safety, consent, AI-disclosure, watermark and explicit human-approval invariants remain binding.

## Start efficiently

1. Read this page, then the active block in `context/STATE.md`.
2. Read the failure and next-action entries below before running anything.
3. This folder's `context-root/` is the complete canonical coordinator context snapshot. The main repository retains its own graph; do not overwrite one graph with the other. Use the snapshot for historical decisions, measurements and rejected attempts when needed.
4. `MANIFEST.json` records every archived file's origin, size and SHA-256. Source-specific work is also preserved on the Git branches listed below.
5. Never print or commit `api/_config.js`, environment files, access tokens, registry passwords or credentials. Protected local helpers use the existing machine's credentials; absolute paths and pinned packets are not automatically portable to a new machine.

## Source to resume

- Main handover branch: `codex/handoff206` in `raghavsharma2003/html-portfolio`. Use its actual remote HEAD after push, not a hash guessed from this document.
- Its base is clean integrated205 `c0eeca5de69db471e99833fa3386af15b78094e6`.
- Added reviewed fixes: communication policy `c171234c9a15023d76989f60c3d4b571b67ab89f`; expert punctuation `200daa3fa775cafdb61618ac4c7c39827538f1ab` followed by `1877ce291d7989c9f196862600ed74daa17bef43`; local development config `cf5748be3eebbf3c2d5681a46b4990e131e69d52`.
- Separate experiment branch `codex/handoff-voice-comparison106` preserves source `0b47b2b892f60b3f45f5d56bd647d97e2308329d`.
- Separate processing branch `codex/handoff-processing204` preserves source `e913ffcb0c86711fca7ed6c449d94266c63f1312`.
- ROOT's unrelated dirty tree, other worktrees, old consumed claims and historical evidence must remain intact. Do not use broad `git add`, reset, cleanup or force-push.

## What actually works, and what does not

| Area | Actual evidence | Remaining work |
|---|---|---|
| Processing | Synthetic upload completed all eight Azure processing stages. Selected reference is 10 seconds, mono24kHz; object/hash/native WAV checks passed. Hindi transcript content retained all lexical items after three explicit spelling/segmentation equivalences. | Real owner enrollment and likeness; context extraction's new chronological ordering still needs a full input-to-claims trial. |
| Memory | Actual213 made seven real calls, settled and cleaned up. Saved Roman Hinglish worked. Correction stored Hindi/Devanagari/detailed correctly. Forget cleared recalled facts and private prompt context. | Actual213's corrected-language reply was entirely English. Latest policy fix removes conflicting teacher language defaults, but has NOT been tested with a new actual model call. |
| Text correctness | Concentration brackets now survive actual delivery. Latest punctuation fix maps expert Unicode dashes to ASCII hyphens rather than erasing bonds, subtraction or ranges. | Latest punctuation change is source/focused-test verified; no fresh end-to-end trial after it. |
| Voice | Both Azure jobs succeeded; six clips per model, two Hindi/two Hinglish/two English each, same stock reference. Twelve artifacts passed integrity verification. | No human ratings, owner likeness, perceptual winner, competitor superiority or voice intelligibility screen yet. Do not infer these from generation success. |
| Login | Missing ignored config module caused the local account handler to fail before dispatch. Temporary isolated repair produced Google URL HTTP200 and normal unknown-operation400. Checked-in startup fix now prepares the inert template without copying secrets. | Real OAuth provider handoff, OTP delivery, owner session and the authenticated journey remain unverified. |
| Release | Integrated205 TypeScript and focused math/Room/authority/meter/compiler/extraction checks passed. Last full release203 was23/24 gates; its two evaluation timing failures were repaired. | Run the full gate on the final candidate. No handover change has been deployed as a finished release. |

## Most important next actions, in order

1. Verify final handover checkout and run `node scripts/context.mjs --check`. Review the exact changed source and focused receipts. Dependencies must be private and match the lockfile; do not mutate shared dependencies.
2. Start the app with the repaired development launcher and existing isolated dev DB/Azure bindings. Verify real sign-in, consent, upload and Meet. Do not accept HTTP200 HTML as proof that API imports work. No auth bypass or invented owner session.
3. Run one bounded successor of semantic213 using the latest policy and punctuation fixes. Reuse the existing production Room/consolidation/correction/forget path. Freshly read the ledger first. Inspect raw and delivered replies, especially corrected Hindi; a harness exit0 is not a language-quality pass. Keep explicit English override and forget checks. No silent provider retries.
4. Listen to the archived twelve clips with blind A/B labels. The disabled ASR draft is optional further evidence, not executed work. Use it only after reviewing its dependencies, endpoint, budget and actual audio. ASR accuracy cannot establish human likeness or naturalness.
5. Verify owner correction → review → explicit selection → changed reply; then publication/consumer access/retention scheduling. The callers exist. Fix operational gaps instead of adding parallel frameworks.
6. Run `node scripts/verify-release.mjs` and `node scripts/context.mjs --check` on the final frozen candidate. Only then pursue the production deployment. Prepare a draft PR with honest limitations while work remains.

## Actual runs: do not replay consumed identities

- Processing: `vyakti-replica-preview-oqni2gz` succeeded. Its observer timed out on its final poll, but later readback confirmed natural zero replicas and zero claimed children. Do not restart the worker because of that observer failure.
- Chatterbox: `vyakti-stock106-chatterbox-u5wgkm7`, window `e5b58f2d-b5e0-4556-b718-6db1654b0b0a`, succeeded; six outputs.
- VoxCPM2: `vyakti-stock106-voxcpm2-xmvvmp0`, window `968c6269-0271-4d93-a100-67a3e8c97003`, succeeded; six outputs.
- Voice runner28195 is terminal exit0. Both captures verified on their first read. Jobs are Manual, retry0; no continuous GPU warmth was enabled.
- Semantic209 stopped before provider calls because its starting-spend guard was stale. The2700microUSD difference was actual settled Azure transcription usage.
- Semantic211 made four calls and exposed missing `detailed` classification plus bracket deletion. Its data was cleaned up. Do not replay it.
- Semantic213 `a730b630faa547d148b0e814` made seven calls, cost25595microUSD, all settlements and cleanup acknowledged. Receipt SHA `50de4a2a9838498ec1dc1cf3e02ffe38bf1157164571abc602c4dcc34af4d7c7`. It is a completed experiment with a failed Hindi-adherence outcome, NOT an overall quality pass.
- Development migration162 is already applied. Actual apply210 receipt `b5ba1ba5fc4c7c075c39621fd4ba77d8f6be01fd88ea9d385d0648127c9cde23`. No replay, backfill or reset.

## Money and external dependencies

- Latest verified text ledger: `expert-development-20260906`, limit1000000, spent246480, reserved0 microUSD. Re-read before any new call; do not assume this snapshot is current forever.
- GPU ledger: `gpu-control-probe-20260908`, limit2500000. Old970200 plus two582120 experiment reservations remain liabilities pending attributable usage. Do not reset or release money merely because jobs finished. This is not an invoice total.
- Existing CPU build/release holds remain; no new fullrelease206 CPU execution was scheduled. Its prepared205 archive became stale when source changed.
- Unattended processing needs Reader at the exact resource scope for its managed identity. Current operator metadata excludes `Microsoft.Authorization/*/Write`; an RBAC administrator is required. Do not retry the known-denied role write or broaden scope.
- Fresh real owner enrollment/consent is still needed for owner voice likeness. Revoked historical grants must not be reused.
- Two local command attempts (5180 restart and an offline config test) were automatically rejected before process creation, with no explanation beyond `Rejected(command)`. Do not characterize them as Azure/provider refusal or claim they ran.

## Local URLs are development conveniences, not deployment evidence

- `http://127.0.0.1:5179/studio`: older204 preview; its missing config module caused account API failures. Do not call it fully working.
- `http://127.0.0.1:5194/`: actual twelve-clip listening page. Public files are archived here; private A/B mapping is outside its served directory.
- `5180` was used for a successful temporary account-handler probe, then stopped; restart was rejected. Do not assume it is running.
- Older5177/5178/5193 were preserved. Verify process and port state before reusing anything.

The target remains an excellent end-to-end expert product. No evidence currently supports “1000x better,” exact human replication, competitor superiority or PMF. Preserve that distinction so the next agent spends effort on real gaps rather than defending an unsupported completion claim.
