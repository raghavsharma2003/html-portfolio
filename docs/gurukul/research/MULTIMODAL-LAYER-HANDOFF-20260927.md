# Multimodal evidence continuation, 27 September 2026

Final software receipt verified on 29 September at 05:09 UTC: exact code `4cc5e66285e176ee80cbd4a21dafd880e01922fc` passes all 24 configured release checks on both Node 22 and Node 24, and its APK build succeeds. The checks actually ran on 27 September; complete logs were inspected on 29 September. This supersedes earlier pending/failed checkpoints below. Relational database gates were explicitly skipped without `NEON_URL`, and the weekly Hindi-rehearsal job was skipped on this push. Owner-value source gaps remain unimplemented; this is not deployment or owner-quality acceptance. The following handoff commit is documentation-only, with no CI result claimed for a later documentation hash.

This source candidate extends the active platform's Human Experience Compiler. It fixes a specific gap between stored evidence and the existing claim extractor: document timestamps became zero and source modality/locator metadata was lost. The intended user value is a suggestion traceable to the owner's actual text or media, with limitations visible to the extractor. Artwork plus the owner's explanation remains the first proposed experience; this wave does not implement image understanding.

The user authorized successor integration after the archived GroupAI push was rejected. Work is isolated on branch `codex/multimodal-layer-20260927` in `C:/Users/raghav.s/Desktop/build/Vyakti-platform-multimodal-20260927`, based on remote `codex/handoff206` at `20263775f06d471f7d69a09d4b4aa711955ee952`. Existing dirty coordinator work is preserved. The [canonical handoff](../../handoff/2026-09-09/START-HERE.md) still records broader product and release gaps.

## Connected implementation

`api/_experience-compiler/claim-evidence.js` normalizes rows already selected by current claim authority. The real `createExtractionBatch` and `extractionMessages` functions consume that projection. `api/_replica-claims.js` adds source type, format and locator to the existing SELECT without replacing current ownership, consent, review or erasure policy. Text/document evidence retains canonical character coordinates and null times. Audio/video evidence carries transcript timing and machine-transcription limitations; a video transcript does not establish visible content. Missing legacy metadata remains unknown. Image geometry is refused as semantic text evidence.

Claim schema v2 remains unchanged, preserving the SQL exclusion of evidence already completed under that schema. Prompt v3 describes the richer evidence envelope and changes the prompt-bound input hash for newly eligible batches. This is neither a migration nor a replay/backfill. No old GroupAI runtime or context graph is imported.

The [manual research cycle](MULTIMODAL-RESEARCH-CYCLE-20260927.md) adapts nine selected source cards to active paths. It retains completed failed and inconclusive outcomes in the queue. The prior Actual213 Hindi failure remains a completed historical failure with no replay command. Commands are display-only; the checker does not fetch sources, run experiments, choose providers or start a watcher. Source retrieval dates refer to the earlier review, not a new internet sweep in this integration.

## Verified scope

Root recorded these actual exit-0 outcomes on 27 September 2026. Provider-facing fixtures used the offline preload and mocked responses; network access was blocked.

| Check | Actual result |
|---|---|
| New multimodal claim evidence | 19 checks; includes the real `extractOwnedClaims` caller and Azure serialization with mocked responses |
| New research workflow | 15 groups; registry check and queue cover nine sources/five experiments |
| Incumbent extraction | 55 checks |
| Context grounding | 7 checks |
| Mirror learning | 25 checks |
| Canonical-context evidence | 39 checks |
| Citation coordinates | 7 checks |
| Existing compiler baseline | 82 named checks plus 1,000 property trials |

Both new suites also passed through the actual `evals/run.mjs` registry. Forced TypeScript exited 0. Copy checking passed seven scopes/21 negative controls, workflow validation six files, upload-boundary checking five rules, and prompt-budget checking 83 byte-identity fixtures plus operational caps. Existing target-cap/tight-tail warnings remain visible. Context graph validation passed at 2,977 nodes/2,492 edges after an append-only change of four nodes/five edges.

Root reproduced a sparse two-slot array with only index one present passing validation, then added an own-index guard and sparse/inherited-index regressions. Initial copy checking lacked TypeScript in the isolated worktree; the unchanged handoff passed. A private `npm ci --ignore-scripts --no-audit --no-fund` installed 160 packages without changing the lockfile, after which current copy checking passed. These observed failures and fixes remain in the context log.

Full release/browser gates were not run locally. No actual PostgreSQL statement, perception provider, paid call, local server or deployment was executed in this wave. Existing SQL predicates and ordering are unchanged; only four selected metadata columns were added. Offline fixtures establish shape and caller behavior, not SQL semantics, owner usefulness, visual interpretation or voice likeness.

## Publication and hosted CI checkpoint

Commit `ba3169cb6e8ecd112d81f76cd686a06641a0932b` was actually pushed to `origin/codex/multimodal-layer-20260927` and verified with `ls-remote`, superseding the earlier dry-run-only status. [Draft PR 8](https://github.com/raghavsharma2003/html-portfolio/pull/8) targets `codex/handoff206`.

APK [run 36301230958](https://github.com/raghavsharma2003/html-portfolio/actions/runs/36301230958), job `108569122606`, failed its eval step with 55 failed suites. The hosted log explicitly passes both new suites plus context grounding, canonical-context evidence and replica claim extraction. It also shows widespread missing Chromium, built-fixture and historical Git-object prerequisites. Five relevant suite passes do not make the failed run green.

Root reproduced two exact failures on untouched handoff `20263775` using the network-blocked preload: consolidation config's `ROOM_MEMORY_COMMIT_SQL` hash mismatch and processing-worker's line-342 eight-stage-to-VoiceGenome assertion. Those source/eval files are unchanged by this PR. Only these two have the stated baseline reproduction; the remaining 53 have not each been classified. Release-gate [run 36301230948](https://github.com/raghavsharma2003/html-portfolio/actions/runs/36301230948) remained in progress on Node 22/24 at this checkpoint. No final result is inferred.

At that publication checkpoint, the PR remained draft and blocked on full-release acceptance. No workflow patch or broad inherited-source repair was included then. The context log retains that failed run and bounded baseline evidence.

## Authorized release-blocker phase, later 27 September checkpoint

The user asked to continue. Work now addresses observed blockers after published head `14914bfcd6ac42cf2f3482c0b8b3dfe9d1205b96`. Release [run 36301775017](https://github.com/raghavsharma2003/html-portfolio/actions/runs/36301775017), Node 24 job `108570649583`, failed two of 24 gates: evaluation and Room doors (2,236 passing/two failing checks). The other gates, including layout, performance, accessibility and security, passed in that job. APK [run 36301775018](https://github.com/raghavsharma2003/html-portfolio/actions/runs/36301775018) failed with the old prerequisites. None of these runs verifies the repairs below.

Both workflows fetch the pinned historical archive at depth two without merging historical source. APK evaluation now follows Chromium installation, Vite fixture build, EchoSim build and exact bundled Devanagari font preparation. Release diagnostics retain only sanitized gate failure logs for seven days. The stale worker-call assertion is replaced by bounded execution of the actual main body, including active and idle paths and nine mutants; production worker code is unchanged. Two memory SQL pins now match approved communication162 history/proof208, with 34 guard-deletion mutants; six other pins and migration159 remain unchanged. Room-door tests cover the existing `memory_classify` operation through its actual decision function.

The creator export now includes existing owner/replica-scoped GPU source authority and returns 503 if its query fails. Shared GPU lifecycle, child-job and monetary-hold records remain excluded. Incident/observer coverage uses doubles and performs no ARM calls. A real compiler defect was also found: T2 ignored `input.nowMs`. Snapshot stance and both relative-age labels now share the supplied turn clock, with host-clock and advanced-turn controls. The generated engine was rebuilt from this source.

Final local outcomes executed by root are CI prerequisites 13/13 groups, worker 47/47, memory config 8/8 plus separate authority 29/meter 27, Room doors 2,268/zero failures, incidents 146/zero, export 70/zero and actual-observer fixture eight groups. New multimodal evidence remains green at 19 checks. These improve on the observed worker stop after 33, doors 2,236/two, incidents 130/one and export 56/one. Clock controls have zero failed assertions for both fresh and settled labels under a 365-day host shift and for an advanced explicit turn. The generated engine is 377,198 UTF-8 bytes and passes freshness checking. Forced TypeScript, six-file workflow lint, copy seven scopes/21 negatives, and prompt-budget 83 byte-identity fixtures/operational caps passed; existing budget warnings remain visible.

A fresh temporary bare Git repository fetched the pinned archive at depth two and passed five selected historical lookup specifications, not the entire original 33-lookup matrix. This establishes availability of those objects without relying on local shared history. No local server or font installation accompanied that check. At that checkpoint, CI font preparation was statically verified only and awaited the new hosted run. No new SQL execution, hosted-green result, provider trial, deployment or user-quality result was asserted. PR 8 remained draft pending the complete gate.

## Published candidate: three remaining suites, 27 September at 08:08 UTC

Published head `0fdbf7d1e3f29197cf9212409f2534edad67a038` reached APK [run 36304766280](https://github.com/raghavsharma2003/html-portfolio/actions/runs/36304766280), job `108579115964`. Its evaluation registry failed three suites rather than the initial 55. All previously repaired suites and the new multimodal/research suites pass in this hosted log.

| Remaining suite | Observed failure |
|---|---|
| `private-rehearsal-combined` | Stale whole-file build-intent equality rejects the approved source-scope guard. |
| `primary-intent-recovery` | The first pending scope-change case creates a new request; cause remains under investigation. |
| `private-teaching-refinement-ui` | The 390-pixel run completes; at 1440 pixels, Ask privately blocks in the refreshed-readiness/attestation follow-up case. |

These three bounded investigations preserve source scope and current readiness/attestation checks. No fix is accepted by this checkpoint. Release [run 36304766286](https://github.com/raghavsharma2003/html-portfolio/actions/runs/36304766286) remained in progress at 08:08 UTC on Node 24 job `108579116085` and Node 22 job `108579116187`. PR 8 remains draft, with no full-green, actual SQL, provider or deployment claim.

## Reviewed evaluation repair candidate

The next candidate changes evaluation files only; production `src/`, `api/`, services and workflows are unchanged from `0fdbf7d1`. All four patches received independent review and root review, with these bounded local checks:

| Repair | Executed local evidence | Hosted result on exact `4cc5e662` |
|---|---|---|
| Private rehearsal | Nine groups; both original exclusion mutants plus nine current-reconciler mutants. Full historical SQL plus exact source fence, bounds 12/1/50, malformed scope rejected before query. | Nine groups pass in the APK registry; no actual SQL execution is claimed. |
| Primary-intent recovery | Three actual StudioApp caller and 20 actual-handler controls, plus baseline recorder preservation. The handler cases comprise one positive, ten invalidations and nine guard mutants. | 18 mounted groups plus three caller/20 guard controls pass. |
| Private teaching refinement | Four source-only groups and syntax check passed. | 42 groups pass, including 390/1440 delayed-readiness controls. |
| Azure-web signal fixture | Six pure no-socket controls and syntax check passed. | 32 native-loopback groups pass; the six pure controls remain separate. |

The recovery fixture now waits for committed scope before releasing the held read and checks the original durable saga without an 80 ms sleep. The refinement fixture holds readiness deliberately, requires exactly three named fresh attestations, and denies partial attestation before the actual POST while retaining its existing bindings. These mounted controls subsequently passed on GitHub-hosted runners; they were not run on the local laptop.

Review caught an overly broad query-row exclusion and a mutant aimed at the wrong first occurrence. Final controls compare complete historical SQL and require unique mutation targets in the extracted current function. Root also passed forced TypeScript, copy seven scopes/21 negatives, six-file workflow lint, generated-engine freshness, multimodal 19 and research 15 under network blocking. The four patches were reviewed and subsequently published as `4cc5e662`; their successful hosted rerun is recorded below.

## Completed release run and Azure-web fixture diagnosis

The same published `0fdbf7d1` release [run 36304766286](https://github.com/raghavsharma2003/html-portfolio/actions/runs/36304766286) has now completed. Node 22 job `108579116187` and Node 24 job `108579116085` each pass 23/24 gates, failing evaluation only. Node 22 fails rehearsal/recovery; Node 24 fails those plus `azure-web`, which receives HTTP 500 instead of 200 at `run.mjs:113` after three passing groups. No 24/24 result exists for this head.

Refinement passes both release jobs but fails the separate APK run. This is consistent with a timing race, not a deterministic Node-version result; retain all three observations. Root downloaded and checked sanitized Node 24 failure artifact `10926748620`, SHA-256 `4a46b80cde736352e6244e6e2b37e8cad33c77fc6c5d54622c470d19daa2bdfa`; Node 22 artifact is `10927200761`.

Root independently compared authoritative Node [v24.18.1](https://github.com/nodejs/node/blob/v24.18.1/lib/_http_incoming.js) and [v24.21.0](https://github.com/nodejs/node/blob/v24.21.0/lib/_http_incoming.js) source. The newer native `IncomingMessage.signal` leaves a normally completed request live after message close. The fixture synthesized the older abort-on-close behavior only when no native signal existed; under the newer native behavior, its own historical-regression assertion threw and returned sanitized 500. The production adapter supports both behaviors.

The evaluation-only repair always creates an explicitly synthetic historical-close controller and composes it with the actual native signal using `AbortSignal.any`. Getter-only, disconnect, deadline, completed-body assertions and the old-unconditional-composition negative remain. Root ran six no-socket controls plus syntax checking; no local HTTP server/browser ran. The 32 native-loopback groups subsequently passed in hosted APK evaluation. This is software-fixture evidence, not actual SQL, a live provider trial or deployment.

## Publication checkpoint, 27 September at 08:20 UTC

Root pushed `4cc5e66285e176ee80cbd4a21dafd880e01922fc`, verified the remote head with `ls-remote`, and updated draft PR 8. Release [run 36305821248](https://github.com/raghavsharma2003/html-portfolio/actions/runs/36305821248) was running on Node 24 job `108582163582` and Node 22 job `108582163664`; APK [run 36305821217](https://github.com/raghavsharma2003/html-portfolio/actions/runs/36305821217), job `108582163332`, was also running. No result was available at that checkpoint. The prior `0fdbf7d1` is retained as a completed failed receipt.

## Final hosted result, verified 29 September at 05:09 UTC

Root checked complete logs and confirmed local/remote code remained `4cc5e66285e176ee80cbd4a21dafd880e01922fc`. Release [run 36305821248](https://github.com/raghavsharma2003/html-portfolio/actions/runs/36305821248) succeeded on both configured Node versions:

| Job | Actual 27 September execution receipt |
|---|---|
| Node 22, `108582163664` | All 24 configured checks pass, logged at `2026-09-27T08:32:39.1618564Z`. |
| Node 24, `108582163582` | All 24 configured checks pass, logged at `2026-09-27T08:33:01.5488899Z`. |

Layout, performance, evaluation registry, Room doors, accessibility and security passed. Both runners explicitly skipped relational database gates because no `NEON_URL` was set. The separate weekly Hindi-rehearsal job was skipped for the push trigger. Neither is counted as database or scheduled-rehearsal evidence.

APK [run 36305821217](https://github.com/raghavsharma2003/html-portfolio/actions/runs/36305821217), job `108582163332`, succeeded. Full registry step 15 passes the exact repaired groups listed above, plus multimodal 19/research 15. Watch-performance, offline multimodal and Vite/EchoSim passed. Gradle reported BUILD SUCCESSFUL in one minute 51 seconds. Browser/native-loopback verification occurred only on GitHub-hosted runners.

Artifact `meera-apk`: ID `10927591729`; 19,305,290 bytes; digest `9cbe1b3e9f23272242975e15f21280a8c5c28fd78f89ddcf6e6e4beaa0a7c5f2`; expires 26 December 2026. Artifact creation is not deployment. These results verify exact code `4cc5e662`; the following handoff commit will be documentation-only, and this record makes no new CI claim for its later hash. Real SQL, live provider behavior, owner quality and the source-provenance UX gaps remain outside this result.

## Read-only owner-value audit and one proposed experiment

The `active_multimodal_safety_audit` source audit identified three gaps. It made no implementation change and ran no owner experiment:

| Source gap | User consequence |
|---|---|
| `ContextLockerPanel.tsx:534` passes an item ID, but `CloneExperience.tsx:1205` opens Evolve without forwarding selection to `PersonModelStudio`. | Teaching from one source does not carry that source selection into review. |
| `api/_person-model.js`'s `clientClaim`/`CLAIMS_SQL` omit modality and locator in claim previews; `PersonModelStudio` shows generic "From your source" excerpts. | Review lacks the modality/locator detail now preserved in extraction. |
| The existing Meet-correction dataset gate requires 12 independent sessions, 30 preparation/train preference pairs, 20 development examples and 30 test examples. | One correction is not a completed learning cycle; keep the gate intact. |

The smallest proposed owner experiment uses a text/PDF art-method note plus a single-speaker explanation. Follow the existing path: cited claim review and explicit acceptance, the same Meet question, an owner-supplied corrected source with supersede/accept decisions, the existing profile-build/approval setup, and repetition in a new conversation. Record whether the answer changes for the supported reason and whether the owner finds it useful. This experiment has not run, and the three audit gaps have not been implemented.

Images remain uninterpreted. A quick private-draft `explanationOrder` demonstration would show a narrower edit, not multimodal proof. Before real calls, the owner needs to supply authorized assets, sign in, review explicitly, hold current permissions and authorize a bounded Azure budget. No new key is inherently required. Do not weaken learning thresholds or infer owner quality from the audit.

## Handoff boundary

The focused projection/grounding checks and configured hosted software gates are complete for exact code `4cc5e662`. A later real product trial must use the established signed-in Feed, review and Meet path and separately authorized assets/providers. It must show that the source-grounded suggestion is useful and that correction/removal changes subsequent behavior. The documented source-provenance UX gaps and actual SQL/owner-quality evidence remain unresolved. Do not open a parallel ingestion service or infer that passing software gates completes that journey.
