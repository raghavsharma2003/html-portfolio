# Vyakti handoff: September 30

This restores the closing context update interrupted after the September29
voice deployment. Operational facts below are verified September29 receipts,
not new September30 cloud checks. Do not replay provisioning to rediscover them.

## Connect here

- Repository: `raghavsharma2003/html-portfolio`.
- Development branch: `claude/vyakti-cloning-platform-aq05n4`, latest remote tip.
- Local development checkout: `C:/Users/raghav.s/Desktop/build/Vyakti-platform-standalone25`.
- Read the latest START HERE block in `context/STATE.md`, this file, then
  `context/rejected.md`, `context/decisions.md` and `context/measurements.md`.
- Preserve the original dirty `Vyakti-platform` checkout. It holds ignored
  operator helpers and receipts, not the current development branch.
- Local `origin/claude/...` tracking ref has been stale even after successful
  pushes. Verify the remote tip with `git ls-remote` or fetch that exact branch.

The product goal remains a simple expert/person AI: knowledge, personality,
voice, private relationships, memory and sharing. The owner prioritizes a
complete usable journey, Hindi/Hinglish/English quality and economical work.
No claim of exact human replication, PMF or competitor superiority is supported.

## Latest live preview

https://vyakti-replica-14kfokzor-raghav-carbonsettles-projects.vercel.app/studio

- Vercel deployment: `dpl_ADhVvHMuTvaZ97oomTngjJzR9wps`, verified READY/protected.
- Project: `prj_rfW81HIge0vtG6nzIcO41OGB5fP9`, `vyakti-replica-lab`.
- Team: `team_hQIoipGIvf1GHVj3878tDOR3`.
- Accepted application source: `5fe2fa2590a355834bf61eea4e889103351af1f7`.
- Source fingerprint: `sha256:d7dd4313d69f2833afc7d78e753cd4d19ce0b7a552ae2f190d06d8bd9d3e8918`;
  1120 inputs,29,207,006 bytes.
- Release36527580868: Node24job109273896691 and Node22job109273897011 each25/25.
  Android36527580905/job109273896828passed.
- This latest deployment changes environment settings, not accepted app code.
  Subsequent context-only commits are not themselves fresh full-gate receipts.
- Live probe60/0findings; deploy verifier6/6; both Studio CSPs and marker match;
  exact new Azure upload CORS origin verified. Sign-in renders at390px without
  horizontal overflow; no browser errors observed.
- Private-voice Preview and direct Azure endpoints each return401 without a
  bearer. They are enabled and authenticated. This is not a real-user generation.

Older exjrjsy9f/dudt3ubik previews are superseded. Failed lqn5a9atv deployment
must never be supplied as the working preview. No production/main cutover or
Meera application deployment was performed.

## Private voice: enabled, quality still unmeasured

The owner approved GPU use with startup credits, reported nearlyUSD5000 left,
then explicitly said to avoid the provider spending-limit step. Do not ask that
question again. Azure spending limits remainOff; this is not proof of a hard
invoice cap or an API-measured credit balance. Preserve the bounded pilot.

| Resource | Last verified state |
| --- | --- |
| Subscription / group | `c60a32f6-c812-4c0e-bc42-b6431ee90b8f` / `vyakti-voice`, centralindia |
| CPU app | `vyakti-internal-voice25`,0.5CPU/1Gi,min1/max1 |
| Latest and ready CPU revision | `vyakti-internal-voice25--private29-enabled-5fe2fa25`; health200 |
| Immutable CPU image | `vyaktivoiceacr.azurecr.io/vyakti/internal-voice@sha256:c3d961f8f5ced34fd847d1b6fd2d9d6ae24caa35d329b52d4dd53f25b4515793` |
| CPU mode | `VYAKTI_PRIVATE_VOICE_MODE=account-private`; supervisor enabled |
| GPU app | `vyakti-open-voice-hi`,min0/max1; all3revisions inactive,0replicas |
| Pilot budget | `gpu-private-voice-internal-v1`,USD1 planning limit; last spent0/reserved0 |
| Independent watchdog Job | `vyakti-voice-watchdog29`,0.25CPU/0.5GiB,every15minutes UTC,1020s timeout,0retries |
| Watchdog proof | Manual execution succeeded; scheduled executions running; fresh matching database heartbeat |

The watchdog has recurring Azure CPU usage. Zero GPU ledger counters do not
mean zero total Azure costs. Recheck live state and usage before new operations;
never reset spend or release uncertain reservations merely to allow another run.

Vercel Preview has two verified bindings:

- `VYAKTI_PRIVATE_VOICE_MODE=account-private`
- `VYAKTI_PRIVATE_VOICE_ORIGIN=https://vyakti-internal-voice25.purpletree-6dea69e2.centralindia.azurecontainerapps.io`

The current voice path produces one fixed Hindi/Hinglish sample with the
existing `hindi_v3` Chatterbox model. It is not English cloning or realtime
conversation. The creator must sign in, record/upload a fresh own-voice sample,
allow processing and explicitly request generation. No fresh voice generation
or acoustic comparison was initiated by the assistant. The expired retained-
owner diagnostic grant cannot be reused. Do not fake a new attestation.

## Database and actual model evidence

Migration172 IS applied:3DDLstatements,36actualEXPLAINs withoutANALYZE and all
3database gates passed; integrity sweep42checks. Deferred non-cascading parent
FKs protect the private cleanup ledger against older erasers. Source cleanup
explicitly removes private rows after lease/write/GPU-release fences.

Two legacy Meera message cursors pointing to an absent episode were repaired
after rollback proof. Both messages and all4forget requests were preserved;
independent readback confirmed zero orphan pointers. No message contents were
exported. Never replay that fixed-incident repair.

One real synthetic Azure text canary passed on September27:
`gpt-5.6-terra-2026-07-09`,191input/49output tokens,3218ms including settlement.
It proves adapter/model/usage plumbing, not full account flow or memory fidelity.

## Honcho findings

Read `docs/research/2026-09-29-honcho-fit.md`, now committed with this handoff.
Seven public source/config files were reviewed at Honcho commit
`9d6fe8ca5dc666b99ef04bc00047fea4ca675017`, version3.2.1/Python>=3.13.
No Honcho code/plugin/service/model was installed and no customer material was
sent to its cloud. Benchmark claims have not been reproduced.

Useful candidates are compact relationship context, facts separated from
tentative interpretations, and correction-aware consolidation. Vyakti already
has owner/Room scope enforcement, corrections, forgetting and communication
preferences. Owner recall's newest30fact pool is a concrete evaluation target,
not a measured model failure. Self-hosting with Azure-compatible model routes
is plausible but not yet validated; public defaults are not a verified copy of
managed Neuromancer. Evaluate before replacing working memory infrastructure.

## Remaining work, in order

1. Observe a genuine signed-in creator journey and fresh voice generation,
   playback and listening. User chose phone testing; no successful new account
   journey or voice-likeness result has been supplied.
2. Diagnose actual failures from that attempt, preserving its run ID and
   accounting. Use the blind voice benchmark kit in `evals/voice-frontier27`;
   no MOS/speaker similarity/competitor win currently exists.
3. Close private rehearsal's saved EmotionOS-style gap: regular dialogue reads
   saved vibe, but the private person rehearsal currently does not. The quick
   private-draft fallback is still teacher-oriented; general creators use the
   Personality editor for a personal profile.
4. Evaluate the Honcho-inspired context mechanism on English/Hindi/Hinglish,
   including old relevant facts, correction, negation, attribution, project
   separation, withdrawal and cross-person leakage. No memory-engine migration
   is authorized merely by reading Honcho's website installation instructions.
5. English voice, realtime interactions, public/follower voice rollout and
   revenue/PMF are not accepted as complete.

## Access and operational recovery

Never open personal Microsoft accounts in a browser or interactive CLI on this
employer laptop. Authorized Azure service-principal APIs work. No local Docker.
Never print or commit credentials, `api/_config.js`, bearer links or recordings.

Ignored local operator root:
`C:/Users/raghav.s/Desktop/build/Vyakti-platform/scratchpad/expert-tools`.
Existing `azure-web38-readback.py` and `vercel-access25.py` load authorized
credentials without printing them. They are machine-local: a cloud agent must
use its own authorized connectors/identity; do not expect DPAPI access remotely.
Required bindings were found in existing Azure resources/vaults. No new key
needs to be pasted into this conversation.

Key receipts:

- `REBUILD29-VOICE-ACCEPTANCE.json`: final combined deployment verification.
- `REBUILD29-VOICE-OBSERVE.json`, `REBUILD29-CPU-OBSERVE.json`:
  enabled mode, ready CPU, recurring watchdog and budget readback.
- `REBUILD29-GPU-AFTER-VOICE-ENABLE.json`: inactive revisions/min0/max1.
- `REBUILD29-DATABASE-APPLY.json`, `REBUILD29-CI-5fe2fa25.json`,
  `REBUILD29-ACR-VERIFY.json`: DB, release and immutable image evidence.
- `REBUILD29-OWNER-SPENDING-STEP-WAIVER.json`: scope of owner's latest approval.
- `standalone25-preview-cors-1790671123451634000.json`: exact latest upload origin.

Consumed one-use intents cover budget creation, Job creation, runtime enable,
manual Job start, migration, incident repair and deployment. Inspect/read back
instead of replaying them.

Recoveries already completed:

- First Job name was33characters; Azure400andGET404 proved no creation. New
  valid22-character name above succeeded with a separate intent.
- Vercel API redeploy omitted deployment-scoped source metadata; the install
  guard correctly failed. Recovery used the verified CLI wrapper.
- Detached export `Vyakti-platform-release29` is exact5fe2fa25, with21EOL-only
  mirrors of already-tested bytes to reproduce the accepted fingerprint. Git
  diff ignoring line endings is empty. Do not develop there or merge those
  export differences; development belongs in standalone25.
- The initial extra boundary probe tried to use the exact-origin Vercel
  transport for Azure. It correctly refused before transmitting. Only that
  failing probe was rerun with separate Azure transport. The final acceptance
  retains the60passedprobes and6passeddeploychecks; do not weaken origin guards.

No daily research automation was created. The goal/task automation is not to
be resumed through a workaround. Previous subagents reached quota; do not
spawn agents merely to retry that limit. This product is not fully complete.
