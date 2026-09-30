# GroupAI and relational integration audit

Date: 2026-09-06. Scope: repository evidence and offline integration inspection, not a new cloud deployment or human study.

## Decision

Keep the expert product's existing person-by-agent Room memory and exact-payload human handoff. Reuse GroupAI's disclosure and durable-runtime mechanisms through explicit adapters when a real multiparty feature needs them. Do not replace the current working memory with a second parallel datastore, or claim the app already runs the whole GroupAI kernel.

## All GroupAI branches

| Branch | Exact head | Interpretation |
|---|---|---|
| main | d06efdcd42c2ee08b7c9c2221c5e1029ad6dd7c7 | Earlier foundation: relational contracts, capsule, intervention policy, Postgres inbox/outbox, initial synthetic campaign |
| codex/relational-core | 4bae159631ca3f18da0ede48596f593a55b6728c | Adds mature source-bound gateway, orchestration, follow-through and shadow runtime work; 479 files differ from main |
| claude/vyakti-cloning-platform-aq05n4 | 451de5a6a7017dc76eaac69fe551203dc94753d2 | Descends relational-core by three commits; 15-file delta primarily migration019 correctness, evidence and handover |

All branch objects were read through Git without checking them over the app tree. Main README, latest architecture, handoff, September3 journal, relationship types and orchestrator caller paths were inspected. This is bounded architectural review, not a line-by-line certification of every package.

## What the terms mean in code

**RelationalOS:** a channel-neutral system that keeps a stable AI identity and remembers a particular person with explicit source and recipient boundaries. The app already has an engine and Room composition. GroupAI adds a richer social-world kernel for relationships across private and group conversations.

**GroupAI:** a separate typed foundation for an AI participating in a social world. Channels are verified addresses, not identities or authorization boundaries. The world and agent form isolation scope. Later group membership does not authorize earlier conversation history.

**EmotionalOS:** no independently implemented product or engine with that name was found in the inspected app/context and GroupAI docs/code search. GroupAI has relationship-state schemas and an affect design boundary. `relationships.ts` validates familiarity, trust, warmth, playfulness, tension and reciprocity in a bounded range; a schema is not a measured estimator or a proven emotional capability. Its architecture treats emotion as a short-lived uncertain hypothesis with evidence. The app's experience compiler records observable speech mechanics such as pause ratio, pitch range, speaking rate and interruptions, with source/provenance fields. These are not inner feelings, diagnoses or permission to manipulate the user.

**Expert identity:** accepted owner knowledge, style and voice evidence remain distinct from the client's private memory. A better identity clone must not achieve its apparent familiarity by exposing another client's information.

## Mature mechanisms worth preserving

| Mechanism | Concrete implementation evidence | Value for expert product | Boundary |
|---|---|---|---|
| Recipient-aware disclosure | `packages/relational-core/src/privacy.ts`, privacy matrix/property tests | A client can authorize an exact handoff without exposing all chat | Full policy supports multiple owners, purposes and derivation; app's port is smaller |
| Derived permission intersection | Memory/context assembly and architecture invariants | Summaries cannot widen source access | Must be enforced before prompt construction, not only by output filtering |
| Scoped context capsule | `packages/context-capsule` authorization-issued blocks, source citations, manifest hash | Debug why a reply used a fact; enforce token budgets without losing provenance | Requires authenticated request and current authorization adapter |
| Immutable turn binding | `packages/agent-orchestrator/src/orchestrator.ts` preparation key, capsule checks, privacy barrier and model-request binding | Retries cannot silently substitute another source set or expert identity | Current orchestrator executes only silent/reply; other typed actions remain no-output |
| Durable model ambiguity | `packages/model-gateway` ledger and reconciliation-only seam | Avoid double billing and duplicate replies after timeout | Provider support and actual deployed adapters remain required |
| Ordered delivery | `packages/delivery-runtime` fences, leases, cancellation and reconciliation | Preserve conversational order during reconnects | Reference mechanics do not prove a deployed WhatsApp/voice adapter |
| Follow-through | `packages/follow-through-core`, Postgres014–016 | Potential shared commitments and private reminders | Pre-pilot kernel; multi-person consent and completion attestations cannot be replaced by a model guess |
| Shadow pilot | `packages/shadow-pilot-core` and orchestrator, SQL017–019 | Evaluate group suggestions without delivering them to people | Structurally no delivery surface; not a hidden production agent |
| Source erasure lineage | Postgres provenance/erasure adapters and terminal model-key binding | A forgotten source should stop influencing future client help | Real destruction worker/KMS receipts are still explicit launch blockers |

## What the current app actually calls

`api/room.js` routes to `_room-surface.js`. Its default memory adapter invokes `dmRecall(person,{agentId})`; talk calls recall for the resolved follower person and expert agent. This is the primary private-client path to preserve. It is not the separate multiparty room model merely because both use the word Room.

`api/_handoff.js` imports `_relational-core.js` directly. That module is a handwritten dependency-free subset from an older GroupAI revision, not a package import of the full latest kernel. It carries a closed disclosure act set, deny-first evaluation, exact scope/policy version, exclusive expiry and named refusal. It deliberately omits multi-owner policy derivation, audience epochs, full schema validation and capsule/runtime layers.

The subset is used only when `ROOM_HANDOFF_KERNEL` equals `1`. `evaluateHandoffAct` constructs a grant from the exact submitted act. Production has no populated creator deny-list input; the injectable deny seam is not an owner-facing feature. The actual handoff boundary remains exact follower-selected payload, explicit send, creator reply to only that follower, and a separate human-reply row. The reply is not inserted into the binary user/AI conversation log and therefore cannot masquerade as either speaker during later compilation.

## Evidence hierarchy and unfinished foundations

The September3 GroupAI handoff records hosted run33758157417 at17096b9 applying/verifying001–019 with four runtime integration files and17tests. The decisive019 test tombstoned a non-input context source after binding and proved authorization denial with no extra provider body, candidate or user delivery. These are historical hosted results from repository evidence, not rerun here.

The same handoff explicitly states that immediate revalidation of the persisted witness under the privacy barrier immediately before provider egress remains unimplemented. Durable binding is necessary but does not prove the same source set actually reached a provider. Migration019 has no fresh Neon, provider, KMS, reviewer or human evidence. Production provider/channel adapters are absent in GroupAI. Participant control plane, authentic KMS destruction/receipts, reviewer current-authority checks and durable preparation/decryption remain launch boundaries. Some names and counts in earlier journal sections are superseded; use the latest dated evidence rather than treating all historical green statuses as current.

The September3 rejection matters: a validator argument collided with a SQL column (`evaluated_at`), creating SQLSTATE42702 while core TypeScript checks were green. The eventual fix preserved call signatures and disambiguated argument use. Reuse that lesson: mocked SQL and typechecks do not certify real query execution.

## Practical acceptance matrix

These are proposed integration gates, not claimed results.

| Slice | Required positive test | Required negative/race test | Evidence needed before activation |
|---|---|---|---|
| Private client memory | Returning client recalls an authorized prior goal under the same expert | Different client or different expert cannot recover it, including summaries | Real authenticated API + intended database + adversarial fixtures |
| Cross-channel continuity | Verified same person continues from web to an opted-in channel | Matching display name alone cannot merge identities | Identity proof and actual adapter readback |
| Exact human handoff | Selected payload arrives verbatim and response is marked human | Unselected chat never reaches creator; stale scope/version denied | End-to-end two-account test and SQL checks |
| Capsule adapter | Included source witnesses exactly match allowed request scope | Source deleted/revoked between binding and provider egress blocks the call | Hosted race test and actual provider boundary instrumentation |
| Ambiguous generation | Timeout can reconcile one logical request | Recovery cannot redispatch a model call or charge twice | Durable ledger + real provider semantics |
| Client erasure | Source and derived recall disappear from future context | Delayed old-source deletion cannot retire a clean replacement | Catalog-backed causal reach tests and authentic receipts |
| Voice identity | Same reference/text pack has protected output and owner ratings | Proxy similarity cannot replace blinded listening | Native Hindi/Hinglish ratings, latency and cost per accepted output |
| Expression adaptation | Owner approves a cited speech/style correction | No inferred hidden emotion becomes a durable fact or automatic persona update | Observable-source tests plus user review |
| Shared commitment | Each participant independently accepts the exact action | One person's inferred intent cannot authorize another | Follow-through replay and human comprehension pilot |
| Group intervention | Shadow suggestion remains invisible until authorized review | No outbox/action method exists; revoke/breaker stops further work | All-member opt-ins and independent pilot evidence |

## Integration sequence

1. Finish expert private Rooms and owner clone loop using the existing engine, source pipeline and voice stack.
2. Preserve and test the narrow human handoff. Add explicit deny-list UI only with a real persisted policy caller.
3. Introduce a versioned capsule adapter in shadow diagnostics first; retain one authoritative memory store and compare allowed source sets.
4. Close GroupAI's pre-provider/current-authority/KMS gaps before any full-runtime activation. Avoid importing its SQL procedures into the app's one-statement migration convention as if they were interchangeable.
5. Add shared commitments or groups only after a paid expert workflow demonstrates demand. These are expansions, not prerequisites for an expert to help a client today.

## Azure provenance and migration repair

The parent task's September6 API inventory reports authenticated service-principal access,33resources and16AI deployments. This audit read its sanitized local inventory, not provider secrets or model keys. Existing IndicF5, Qwen3TTS, VoxCPM2 and OpenVoice services are evaluation candidates, not proof of an accepted owner fine-tune, production routing or world-leading quality. No cloud mutation follows from inventory.

Twelve offline suites now resolve local066–076 source migrations through `evals/lib/reconciled-migration.mjs`. It selects the exact original path from the archive manifest, rejects ambiguous identity/path traversal and checks the full SHA256 before returning SQL text. It does not execute SQL or fall back to a different migration with the same number. The six-test helper suite passed, including tampering and wrong-lineage negative controls. Existing Rooms migration readers remain unchanged.

A separate unexecuted reconciliation candidate widens the source-purpose CHECK to the seven purposes used by both lineages: memory, identity_document, identity_challenge, correction, interview, mirror_window and context_item. Its manifest requires actual catalog/data inspection and allocation of a new migration ID. The combined schema mirrors the candidate. This removes a source-level contradiction without claiming the live database has been changed.


## Fresh read-only database readback

The original checkout's configured Neon connection was used in memory, without printing or copying the connection string. On September6, direct catalog SELECTs returned195public tables,2263columns and1161constraints. No public migration-ledger table was found. This database carries both the Rooms line and substantial earlier local voice objects, but not the entire local source-fencing lineage.

Missing integration tables: `vy_channel_extraction_object`, `vy_replica_source_storage_writer`, `vy_replica_storage_writer_rollout`. Missing named columns: `upload_authorization_expires_at` on `vy_replica_source`, `vy_ingest_run` and `vy_video_enrollment`. All13named FK constraints introduced by local076 were absent. Existence inspection of other added columns is not proof their types/defaults/check definitions are equivalent; the saved catalog supports further exact comparison.

The live purpose CHECK accepts only memory, identity_document, correction and interview. Aggregate readback found13sources, all purpose memory. This confirms the proposed seven-purpose union addresses a real catalog mismatch; it is still not applied.

The original checkout's read-only relcheck failed three checks:17Rooms-family tables absent from its older person manifest;20tables absent from its older owner-erasure reach; and20`meera_log` rows with dangling episode references. The first two compare newer database objects to older root code and must be rerun with integrated manifests before attributing all to the final app. The dangling episode count is a real data-integrity finding, not explained away by branch age. No row contents, identifiers or private conversation text were read. No delete, update, migration or repair was performed.

The synthetic Azure connectivity probe separately returned one correct structured answer, HTTP200,2794ms,83input/26output tokens. This remains n=1connectivity/schema evidence, not a quality benchmark.


## Model lineage: pretrained conditioning versus owner training

| Stack | What the repository proves | What it does not prove |
|---|---|---|
| IndicF5 | Pinned AI4Bharat pretrained Hindi model and Vocos; inference conditioned on an owner reference. `services/indicf5-runtime/README.md` names exact revisions and isolated evaluation routing. | No accepted owner-specific fine-tune or production winner follows from hosting it. |
| Qwen3-TTS | Pinned pretrained `Qwen/Qwen3-TTS-12Hz-1.7B-Base`, English-only evaluation contract with reference audio/text and disclosure. See `services/qwen3-tts-runtime/README.md`. | Not evidence for Hindi/Hinglish or an accepted custom owner model. |
| Chatterbox LoRA | A real historical owner-training experiment exists. `context/measurements.md#lora-vs-zero-shot-71s` records a 71-second source, 60 epochs on an Azure T4, and same-session zero-shot mean ECAPA 0.775278 versus LoRA 0.795857. | One speaker and two independent runs per arm; not human acceptance, broad generalization or perceptual naturalness. Runtime/provider adapter support does not prove the ordinary Studio preview caller selected the adapter. |

The LoRA result is a speaker-embedding proxy increase of 0.020579, not a percentage claim about sounding human. Training used 62.1 seconds of transcribed speech from the 71-second source, with 140.4 seconds of T4 training wall time. The recorded reference-self ceiling was 0.886850. The historical experiment had no held-out training partition, blinded ABX or ElevenLabs comparison; synthesis was recorded as about 26% slower. No private checkpoint storage or current live checkpoint was inspected in this audit. An automated band crossing is not a substitute for blinded owner/native-listener judgment. `services/open-voice-runtime/app.py` accepts optional signed, content-addressed adapter bytes; `api/_voice/providers/open-chatterbox-preview.js` can serialize them. Ordinary owner-preview adapter selection remains unproven in this bounded caller audit.

## Live Azure accounting evidence

The parent retained two synthetic answers through the real adapter and durable development ledger: the supplied workshop time was answered as Monday at 10 AM; an unsupported price question correctly returned unknown. Wall times were 3,241 ms and 1,836 ms, including SQL accounting. The ledger contains four settled receipts totaling 152 micro-USD, or USD 0.000152. The first two paid outputs were not saved because the result collector queried a nonexistent `status` column and received SQLSTATE 42703. It was corrected to `state`, and outputs are now written before the accounting readback. The four receipts must not be misreported as only two provider calls. Evidence: parent `scratchpad/expert-tools/azure-live-ledger-result.json`. This is fixture connectivity, grounding and accounting evidence, not product quality or a latency benchmark.
