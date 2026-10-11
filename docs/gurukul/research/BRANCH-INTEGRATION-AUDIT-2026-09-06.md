# Branch integration audit, 2026-09-06

## Finding

Do not rebuild from zero or cherry-pick the old workstream branches. All 26 current remote html-portfolio branch heads are already ancestors of `origin/codex/vyakti-completion` (`6260611ed29669e66f5bd936ba93aaa56025f81e`). Every `gurukul-ws-*` head, `voice-cloning`, `main`, and the companion branch is already in this checkout's committed base `771feef9c124184a56abaea662bc16a079069ee1`. The real integration problem is the substantial uncommitted local voice/processing/experience work against the descendant Rooms/Suites line, 560 commits ahead.

## Method and scope

Read current STATE including dated START HERE, recent rejection/decision/measurement entries, remote branch topology, unique history, tree differences and representative caller chains. `git ls-remote --heads origin` enumerated 26 heads. The initial fetch configuration tracked only `claude/gurukul-platform`; explicit wildcard fetch downloaded all heads without checkout, pruning, merge or reset. This is not a claim every line in 560 commits was individually reviewed. Current working changes were preserved. Runtime, cloud deployment and voice quality were not tested in this audit.

## All html-portfolio heads

Counts are committed HEAD-only / branch-only commits. Zero branch-only means already included, even when files have evolved since that workstream.

| Branch | Exact SHA | HEAD-only / branch-only | Tip purpose |
|---|---|---|---|
| claude/ai-companion-app-rkt1lv | `f4d3fe4e4f9ffc665c116ce022b3f63c8fefbd21` | 270 / 0 | context: session 2026-08-25b close — full ledger, incidents, owner-opens, and the inheritance map for the next product |
| claude/gurukul-platform | `771feef9c124184a56abaea662bc16a079069ee1` | 0 / 0 | feat(voice): ship blinded model selection |
| claude/vyakti-cloning-platform-aq05n4 | `61385c57d515b0c0fbcb8a58409f1bc135a4b529` | 0 / 557 | context: the wave-twenty handover as a decision with its reversal; the graph check passes again |
| codex/vyakti-completion | `6260611ed29669e66f5bd936ba93aaa56025f81e` | 0 / 560 | fix: let first-room CLI finish pending handles before exit |
| gurukul-ws-aa | `03179bc6dac8698e2344151b66fe9532820da3e0` | 98 / 0 | journey: one owner for the studio flow, a design system with values, and a real landing |
| gurukul-ws-ab | `1a254d3dff3585ecc68b2e8bd67f6bfa7b38cd5f` | 84 / 0 | WS-AB: the Context Locker — bring your context, mined with provenance |
| gurukul-ws-ac | `91bc4c78b45c0f73eb7db242bb40d7c5c38ad053` | 81 / 0 | WS-AC: the clone answers back — the Mirror Call reply lane, unforked |
| gurukul-ws-ah | `da5897a8ac883f03713c99175dc069866ffb722b` | 76 / 0 | WS-AH: something now drains the enrollment processing queue |
| gurukul-ws-ai | `fcc2a38e46cc3fd4f9b1a1485f2881e7f51c232d` | 66 / 0 | extraction: make the YouTube route one env var, and measure the free lever out |
| gurukul-ws-aj | `98efb8deb873b6f91c89d3195ad114a089dead11` | 66 / 0 | studio: the honesty split as a type, and a phone layout stated rather than subtracted |
| gurukul-ws-ak | `5fdeaa4dc553faf70ffd75da1e41084cf5622fd5` | 59 / 0 | WS-AK: wake the evidence service, THEN sign, and diarize completes |
| gurukul-ws-al | `c28f0f31249d198af5f6ab64dd505ef21adce52e` | 57 / 0 | audio-protection: deployed and serving, and the build now proves the model runs |
| gurukul-ws-am | `f3fceac28bd9f3cf650c32c492e26a27d622fbcc` | 45 / 0 | studio: nine grids reserved a column for a child that was not there |
| gurukul-ws-an | `a9149e82df9928ca986a4b761adfafd912e27e29` | 45 / 0 | transcribe: route through Sarvam, not Azure Speech (owner directive) |
| gurukul-ws-ao | `f444d3282c43a431a415677ddf90dc1f12c9ee3d` | 42 / 0 | separate: window to the owner's own diarized speech, not the whole file |
| gurukul-ws-ap | `32815cedcc1ec7d7774c5e7d24e44216dc85e6c2` | 39 / 0 | studio: one honest next action, and the sticky pager deleted, not shrunk |
| gurukul-ws-aq | `65f36fece24b8636ee9267e8a91d3cd6902523f8` | 37 / 0 | REPLICA_SELF_TEST_MODE: self-only identity/liveness bypass for internal testing |
| gurukul-ws-ar | `235c18553e7a41e40637753679acec2cee03273b` | 35 / 0 | context: the enrollment sample-rate bug, confirmed, fixed, and proven end to end |
| gurukul-ws-as | `298c15992ee3ec50661daca1c76bd4dc66597bad` | 30 / 0 | separate: skip 16kHz sepformer when diarize shows one dominant speaker |
| gurukul-ws-v | `68054494cc9ff02e1cf59d3e9da4c04e415f86cd` | 103 / 0 | earbench: fail legibly on a synthesis error, check the listening page itself |
| gurukul-ws-w | `4328281a6be941ac8dad6691d4242dd9ef50ea3e` | 100 / 0 | Preview my voice: the owner's first surface, and the cold start told honestly |
| gurukul-ws-x | `a35327ab9c7aa4e80f371e4d0156ea7b61cc76f3` | 93 / 0 | WS-X: the Mirror Call backend — approval as one SQL clause, selection as the voice loop |
| gurukul-ws-y | `b9966ca2b76efc0f7dddd8bb275e24150566a6ea` | 99 / 0 | WS-Y: the Mirror Call tab — talk to your clone, watch what it proposes, approve with a tap |
| gurukul-ws-z | `3a80f20e69cca6122a85f658a2ac79c6e50901b0` | 99 / 0 | research(WS-Z): ongoing/online mirroring and learning sweep |
| main | `3a9217981b27636745fc70ac490aacf9ef3f392d` | 304 / 0 | Merge Maya: world layer, RelationalOS split, resilience stack, launch fixes (PR #3) |
| voice-cloning | `a7bdcaa4879698fab941d1ac19b0ca9a9099dc4c` | 263 / 0 | merge: sync latest Meera foundation into voice-cloning |

## Read-only integration collision analysis

At inventory time: 174 tracked dirty paths, 159 untracked file paths, 537 changed paths between committed HEAD and destination. 67 tracked paths changed on both sides; 0 local untracked paths also exist in destination. Counts may grow during parallel work. These are path overlaps, not proven textual conflicts.

### Tracked paths changed on both sides

- `api/_channel-ingest.js`
- `api/_clonechannel.js`
- `api/_context-locker.js`
- `api/_mirrorcall-reply.js`
- `api/_mirrorcall-wire.js`
- `api/_person-model.js`
- `api/_provider-budget.js`
- `api/_replica-full-erasure.js`
- `api/_replica-runtime.js`
- `api/_replica-source.js`
- `api/_replica.js`
- `api/_surface.js`
- `api/channel-ingest-sweep.js`
- `api/memory.js`
- `api/mirror-call.js`
- `api/replica-model-build-sweep.js`
- `api/replica.js`
- `context/STATE.md`
- `context/decisions.md`
- `context/graph.json`
- `context/measurements.md`
- `context/rejected.md`
- `db/schema.sql`
- `docs/gurukul/DEPLOY.md`
- `docs/gurukul/ENV-MANIFEST.md`
- `docs/gurukul/PRODUCT-JOURNEY.md`
- `evals/clonechannel.mjs`
- `evals/open-voice/run.mjs`
- `evals/person-model/run.mjs`
- `evals/recall/run.mjs`
- `evals/replica-review/run.mjs`
- `evals/replica-runtime/run.mjs`
- `evals/replicaactivity.mjs`
- `evals/run.mjs`
- `evals/studio-self-test-ui/run.mjs`
- `evals/studiowizard.mjs`
- `evals/voice-preview-ui.mjs`
- `evals/voicepanel.mjs`
- `package-lock.json`
- `package.json`
- `scripts/check-layout.mjs`
- `scripts/vercel-build.sh`
- `scripts/verify-release.mjs`
- `site/vyakti.html`
- `src/studio/ActivityPanel.tsx`
- `src/studio/ContextLockerPanel.tsx`
- `src/studio/EnrollmentWorkspace.tsx`
- `src/studio/LivenessCapture.tsx`
- `src/studio/MirrorCallStudio.tsx`
- `src/studio/PersonModelStudio.tsx`
- `src/studio/StudioApp.tsx`
- `src/studio/VideoEnrollPanel.tsx`
- `src/studio/VoicePreviewPanel.tsx`
- `src/studio/WizardRail.tsx`
- `src/studio/layoutFixture.tsx`
- `src/studio/main.tsx`
- `src/studio/mirrorCallApi.ts`
- `src/studio/mirrorCallMachine.ts`
- `src/studio/replicaApi.ts`
- `src/studio/studio.css`
- `src/studio/studioAuth.ts`
- `src/studio/studioTestMode.ts`
- `src/studio/types.ts`
- `src/studio/wavCapture.ts`
- `src/studio/wizardModel.ts`
- `studio.html`
- `vercel.json`

### Added locally and also present in destination

None.

## Migration identity collision

The local untracked sequence includes 066 primary voice source, 067 preview intent, 068 expression observation, 069 nearline claim queue, 070 canonical context evidence, 071 mirror-delta lineage, 072 clone-creation saga, 073 upload authorization, 074 extraction storage fence, 075 storage writer, and 076 owned-write fence. The descendant branch starts its Rooms migration sequence at 071 and runs through 136 with intentional gaps. Therefore numeric identities 071 through 076 refer to DIFFERENT schema changes across the two lines, despite different filenames. 066 through 070 are absent from destination's migration tree and need explicit provenance/catalog reconciliation too.

Never resolve this with alphabetic copy, filename deletion or blindly renumbering applied migrations. Inspect actual deployment/database target and migration catalog read-only first; determine which local objects are already applied. Preserve applied identities in their original deployment ledger; create idempotent reconciliation migrations above the confirmed highest allocated number, mirror schema and erasure/reach checks, and EXPLAIN on the intended database. 137 is only the descendant handover's next-free claim, not a newly checked catalog fact. Wave20 briefs also reserve137 and138.

## Best components and caller evidence

- **Local clone experience:** `src/studio/StudioApp.tsx` calls `handleRequestVoiceBuild`, passes owner candidate/source intent to the untracked `CloneExperience.tsx`; preserve intent recovery, `CloneVerificationJourney.tsx`, `QuickVoiceCapture.tsx`, real microphone `VoiceField.tsx`, source replacement, error states and evidence-driven progression. Reconcile destination's Studio routing, localization/readiness, product selection and billing rather than replacing its whole component.
- **Local deployed-voice lineage:** `api/mirror-call.js` imports the ASR registry and mirror-call wire/runtime; `api/_mirrorcall-reply.js` owns live reply composition. Enrollment APIs call processing/build intent machinery and worker sweeps. Preserve uncommitted renewable leases, source-scoped promotion, exact storage write fences, erasure repairs and durable preview-intent/result cleanup. The destination changes no `services/` files versus HEAD, and no `_replica-processing/` files; those local areas are promising portable groups, although interface dependencies still require tests.
- **Voice providers:** destination adds `api/_voice/providers/elevenlabs-pvc.js`, `sarvam-bulbul.js`, `vendor-common.js` and registry work. Local Chatterbox preview and Hindi frontend updates must coexist with explicit providers and benchmark receipts. Do not infer a live provider from a registry definition.
- **Rooms and revenue:** destination `api/room.js` imports `_room-surface.js`; `_room-surface.js` calls `memory.recall(payload.p, resolved.agentId)` and has `dmRecall(person,{agentId})` as the default. The follower-person plus expert-agent memory path is real composition, not merely a relational interface. Preserve Rooms, subscription/UPI lifecycle, cohorts, handoff, quiet hours, check-ins, per-room recall, payment witnesses and isolation gates.
- **Local memory/compiler:** `api/_experience-compiler/`, mirror canonical evidence, person model, context extraction and nearline queue represent additional local work. Port as one schema/API/evaluation group. Do not attach a memory compiler to the Room prompt before proving recipient scope, consent and exact current source validity.
- **Operational proofs:** destination has 19 waves of gate logs and the prior Windows reference/CLI fixes. Local has deployment upload exclusions, client-computed source commitments and newer voice erasure/recovery tests. Preserve both gate families; do not let a new broad runner replace either safety boundary.

## Related repositories

Git branch objects were fetched into `refs/remotes/audit-*` solely for inspection; no additional remotes were configured and no files checked out.

### Vyakti-GroupAI

- `claude/vyakti-cloning-platform-aq05n4` at `451de5a6a7017dc76eaac69fe551203dc94753d2`: Merge codex/relational-core: bound the shadow verifier parameter match (migration 019).
- `codex/relational-core` at `4bae159631ca3f18da0ede48596f593a55b6728c`: fix: bound shadow verifier parameter match.
- `main` at `d06efdcd42c2ee08b7c9c2221c5e1029ad6dd7c7`: feat: add durable cloud relational runtime.
### Vyakti-product

- `claude/ai-companion-app-rkt1lv` at `9fddcd24cf7ba3998900d480a7d0a9ed066bbf15`: Manifest for the move, written before the move so the check is a check.
- `main` at `fd6bdeed37d24ff2ca0664416388c7db00a411bf`: Update birthday-invite.html.
### Vyakti-website

- `claude/vyakti-cloning-platform-aq05n4` at `4a7cbefce58e3e2df9616c5076dec9afdab3471f`: Record the Rooms decision in the project context.
- `claude/vyakti-research-website-a47qnq` at `904b3701eb7ab11140b5b457c147c801b9ecd011`: Fix mobile story scroll performance.
- `codex/vyakti-rebuild` at `904b3701eb7ab11140b5b457c147c801b9ecd011`: Fix mobile story scroll performance.

GroupAI's `codex/relational-core` is an ancestor of its Claude handover by three commits. The handover is the stronger foundation source: typed recipient-aware capsules, policy-approved memory, immutable prepared turns, model ambiguity/recovery, forced-RLS Postgres runtime, follow-through and shadow pilots, plus migration019 handoff work. Its README describes implemented foundation and synthetic campaigns, not a fully connected production expert app. Integrate via a bounded adapter and existing Room handoff seam, not a second competing production memory store.

`Vyakti-product` main is an old HTML portfolio; its companion branch is the earlier Meera frontend/backend, not a separate missing expert backend. `Vyakti-products` has no branches (empty repository). Website `codex/vyakti-rebuild` equals `claude/vyakti-research-website-a47qnq`; the Claude cloning branch differs by14 files and carries subsequent positioning work. Use the authoritative current brand assets without importing an older product architecture.

Public `Meera` branches enumerated: main `72041b27ca24aa6114cc311778d5e358e5b6e6c5`, codex/maya-visual-assets `5c0b68e50a21e372bdd880bdecd866ac657447eb`, codex/meera-photos `8ec35c27a114ab885e630c9f66912fe379a23afc`, codex/meera-world `8ba97d121cad0ba793b554f1787771641229d2a1`, codex/meera-world2 `27a3b46eaa165f2e923c7190bb9c17b8436cd9ab`. These are companion visual/world history; full trees not fetched or imported in this bounded audit. No claim these exact external visual branches are merged into html-portfolio.

The public account list contains no separately named API repository. Exact `Vyakti-api` lookup returned repository-not-found; that does not prove no private/renamed API repo exists. The substantial actual expert API lives under html-portfolio `api/`, and GroupAI was reachable through Git despite absent public account listing. GitHub CLI is absent on this machine; public REST plus Git were used. A private API repo remains unidentified, not assumed missing.

## Safe integration order

1. Preserve all current dirty tracked and untracked source in a deliberate allowlisted checkpoint before touching branch state. Exclude secrets, caches, generated outputs and deployment config. Record the existing HEAD and target SHA. Do not blanket `git add .`, stash unknown secrets, overwrite this working tree or use reset.
2. Create a separate integration worktree at exact6260611 on a new integration branch. Keep this dirty working directory as the untouched source of local improvements. No new Docker runtime is required.
3. Port deployment-boundary safeguards and portable Windows/runtime checks first. Establish both baselines; distinguish absent configuration from new failure.
4. Port local source storage/erasure/write fencing, then processing leases/build saga, then voice preview quality/recovery, with schema reconciliation attached to each group. Keep intentional provider isolation and disclosure/owner consent as actual predicates.
5. Port canonical evidence and memory/compiler with recipient-aware tests. Connect to the existing Room recall lane without dual writes or invented identity merging. GroupAI adapter stays bounded until integration tests prove its invariants.
6. Port the local expert first-run UI as components inside the destination Studio navigation. Retain Rooms/Suites/revenue beneath one expert-first journey; remove competing entry states through explicit routing, not whole-file copying.
7. Run targeted changed suites after each group and the combined release/context gates before ship. SQL requires actual parser readback on the correct database; mock success is insufficient. New voice claims require matched same-reference/text protected clips and blinded human ratings, not ECAPA alone.
8. Only then connect runtime/deploy against confirmed Azure/Vercel resources. No blanket warm GPU capacity or cloud spend follows from this audit.

## Rejections and limits

Rejected whole-branch replacement: it discards uncommitted September voice reliability/UX work. Rejected old workstream cherry-picks: every historical workstream head is already inherited and replaying them risks regressions. Rejected treating an ancestor as a current runtime: source lineage proves inclusion, not current deployment, keys or quality. No merges, schema changes, deployments, credential reads, benchmark runs or live database calls occurred in this audit.


## Isolated integration prepared after audit

At the parent task's direction, created `scratchpad/expert-integration` on `codex/expert-unified` at exact6260611. The source dirty working tree was preserved. Saved an allowlisted174-file tracked patch and manifest under scratchpad; ignored/untracked files were excluded. A non-mutating `git apply --3way --check` reported48 conflict paths even though its process exit was0. `git status --porcelain` in the destination remained empty, proving no patch application. Never treat this check's exit0 as a clean merge.

- `api/_clonechannel.js`
- `api/_context-locker.js`
- `api/_mirrorcall-reply.js`
- `api/_mirrorcall-wire.js`
- `api/_person-model.js`
- `api/_replica-full-erasure.js`
- `api/_replica-runtime.js`
- `api/_replica-source.js`
- `api/_replica.js`
- `api/_surface.js`
- `api/channel-ingest-sweep.js`
- `api/memory.js`
- `api/mirror-call.js`
- `api/replica-model-build-sweep.js`
- `api/replica.js`
- `context/STATE.md`
- `context/decisions.md`
- `context/graph.json`
- `context/measurements.md`
- `context/rejected.md`
- `db/schema.sql`
- `evals/clonechannel.mjs`
- `evals/replica-runtime/run.mjs`
- `evals/studio-self-test-ui/run.mjs`
- `evals/voice-preview-ui.mjs`
- `evals/voicepanel.mjs`
- `package-lock.json`
- `package.json`
- `scripts/check-layout.mjs`
- `scripts/vercel-build.sh`
- `site/vyakti.html`
- `src/studio/ActivityPanel.tsx`
- `src/studio/ContextLockerPanel.tsx`
- `src/studio/MirrorCallStudio.tsx`
- `src/studio/PersonModelStudio.tsx`
- `src/studio/StudioApp.tsx`
- `src/studio/VideoEnrollPanel.tsx`
- `src/studio/VoicePreviewPanel.tsx`
- `src/studio/WizardRail.tsx`
- `src/studio/layoutFixture.tsx`
- `src/studio/main.tsx`
- `src/studio/mirrorCallApi.ts`
- `src/studio/mirrorCallMachine.ts`
- `src/studio/replicaApi.ts`
- `src/studio/studio.css`
- `src/studio/wavCapture.ts`
- `studio.html`
- `vercel.json`

The destination already contains `RoomStudio`, `roomPublishApi`, `_room-publish`, `/r/:slug` and authenticated Room memory. Its publishing is still teacher-sheet-bound via `loadTeacherAgent` and teacher-mode UI. Generalize that existing path for an expert; do not create a parallel generic sharing implementation.
