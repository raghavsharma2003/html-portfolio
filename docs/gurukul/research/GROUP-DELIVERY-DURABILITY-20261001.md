# Group delivery: observed failures and a bounded durability path

Date: 1 October 2026. Observed baseline: `34da5259acad448b6204b3dbc0a791ca2b2c6ad6` on `codex/multimodal-layer-20260927`. This read-only audit extends [the portable-layer research](PORTABLE-GROUP-LAYER-20261001.md) and [Group AI readiness](GROUPAI-READINESS-20260929.md).

The schema-free receipt fix below is the next working phase, **not an implemented or verified result in this report**. No durability package, migration, deployment, live transport, paid model, or production database was exercised by this audit. Existing source/audience checkpoints remain necessary but do not provide atomic external disclosure or exactly-once delivery.

## Observed actual-caller failures

Method: execute the complete current production modules through the fixture already defined in `evals/group-turn-authority/run.mjs`. The fixture substitutes database, model and transport I/O, checks actual query clauses, and supplies synthetic authority. The audit evaluated only that file's fixture-definition prefix and appended three probes in memory; it created no script or source file. It did not import or read the real `api/_config.js`.

The three observations were first obtained during the recall working tree and repeated at the committed baseline above. They prove control flow under supplied results, not PostgreSQL semantics or live delivery:

| Probe | Observed baseline result |
| --- | --- |
| Dispatch the identical normalized group event twice sequentially | Both return `ok:true`; two model calls, two sends, two episodes, two human logs and two assistant logs. |
| Inject `send` returning `{ok:false,error:"network"}` | Group dispatch returns `ok:true` and `said:true`; one send attempt and one assistant log. |
| Make fragment 1 fail and fragment 2 succeed | Both fragments are attempted; `deliver()` returns the last receipt, `{ok:true}`. |

No concurrent dispatch race was measured. The duplicate observation is already present in sequential replay. The synthetic model returns fixed text and incurs no charge; two calls demonstrate the duplicate dispatch path, not a measured billing amount.

## Production ordering and the narrow seam

The following line references identify the observed baseline; prefer function names after later edits.

`api/_surface.js:onGroupMessage` (line 1346) performs:

1. Freeze event/context handles, resolve room and speaker.
2. Handle commands on their separate path.
3. Obtain current SQL authority and a complete platform audience witness.
4. Decide participation.
5. Call `api/_room.js:openOrExtendGroupEpisode` (line 684), creating an immutable audience episode and participants in one SQL statement.
6. Call `logRoomTurn` (line 756), inserting the human turn in a separate SQL request.
7. Call `recordTurnAction` (line 795), inserting participation intent; this helper currently swallows write failures.
8. Read and bind permitted sources, select attributed turns, compile, invoke the model, and gate its answer.
9. Call `_surface.js:deliver` (line 645).
10. Insert the assistant log and return `said:true` for nonempty generated text.

No transport-event identity is bound to steps 5-7. A repeated event therefore obtains fresh rows. An adapter's negative receipt does not currently interrupt step 9, so step 10 can describe text that was not acknowledged as accepted.

The durable admission seam is after current group/speaker permission checks but before episode/log/model effects. Its first scope should be ordinary, linked, authorized Telegram group messages only. Commands, DMs, edits, membership events, WhatsApp batches and Discord interactions need their own contracts. An inbox must not become a new store for unlinked users' words: the existing no-person/no-persistence rule still applies.

`onDirectMessage` (line 1071) likewise writes the human log, generates, awaits delivery, then writes the assistant log. `onLinkTap` (line 1142), `onCommand` (line 1637) and bot-membership handling can change identity/quiet/withdrawal/consent state before delivering an acknowledgement. A failed acknowledgement does not undo their completed state changes.

## Exact current adapter receipts

| Production function | Before external dispatch | Network/timeout | HTTP/parsed response |
| --- | --- | --- | --- |
| `api/tg.js:tgCall` (334), through `sendVia` | Missing token returns `{ok:false,error:"no bot token"}`. | Rejected fetch, including its 15-second abort, becomes `{ok:false,error:"network"}`. | Returns `{ok:j?.ok===true,result:j?.result}`. Invalid/unreadable JSON becomes an empty object and therefore false. It does not independently check HTTP status. A real successful `sendMessage` result can contain `message_id`; reactions return a different result. |
| `api/discord.js:send` (263) | Missing token returns `{ok:false,error:"no bot token"}`. | Rejected fetch/15-second abort becomes `{ok:false,error:"network"}`. | Returns `{ok:r.ok}`. It discards the body, status code and message ID; non-2xx becomes false. |
| `api/whatsapp.js:send` (282), `post` (325) | Missing credentials returns `{ok:false,error:"no access token"}`. Closed local window returns `{ok:false,error:"outside 24h window",requiresTemplate:true}`. | Rejected fetch/15-second abort becomes `{ok:false,error:"network"}`. | Returns `{ok:r.ok}`. It discards the body, status code and message ID; non-2xx becomes false. |

Unexpected synchronous argument/serialization errors and injected implementations can throw; these functions do not give every thrown value a reliable before/after-dispatch classification. An HTTP error alone is not a universal proof that an external service performed no effect. A lost response can follow successful acceptance.

`makeCtx` (line 1719) captures the default adapter method with a frozen receiver, or uses an injected `deps.send`. Existing surface, agent-room and group-turn successful send fixtures return `{ok:true}`. The production web collectors in `_clonechat.js:collector` (157) and `_room-surface.js:collector` (2480) also return `{ok:true}` after collecting response text. `_room-taste.js` uses that collector. `_mirrorcall-reply.js` has an `{ok:true}` no-op adapter for its request/response lane.

Therefore a generic success contract must retain `{ok:true}` compatibility. It cannot immediately require a provider message ID, nor claim that acceptance by an in-memory web collector proves browser receipt. The observable concept is **adapter-reported acceptance**, not recipient/device delivery.

## First fix: stop reporting unconfirmed sends as successful

Proposed schema-free change to `deliver()`:

- Require an explicit boolean `ok:true` after each send, including reactions. Stop on the first other result; do not send subsequent fragments.
- Throw a bounded, sanitized, typed failure such as `surface_delivery_unconfirmed` for unconfirmed transport outcomes. Do not retain the raw error, response body, generated text or token in its message/cause.
- Treat timeout, network error, thrown send, malformed receipt and undifferentiated `ok:false` conservatively as `unknown`. Do not infer safe retry from an error string.
- Empty render is locally `not_executed`, because no send was attempted. Explicit adapter refusal may later carry a validated not-executed receipt, but current generic false results do not establish that contract.
- Keep authority checks outside transport-error normalization, preserving `group_authority_unavailable` and its current mutation tests.
- Account for an already accepted prefix of a fragmented message without calling the whole message delivered. No later error or cancellation retracts those fragments.

All existing calls await delivery before the relevant assistant-log/normal-success path, so a rejection at this seam stops the false continuation. The proof must include actual group and DM callers, reactions, first/middle/last fragment failures, thrown/malformed results, empty rendering, collector compatibility, and negative controls that remove the new check. It must also keep commands' already-applied changes distinct from their acknowledgement status.

This fix does not persist outcome state, prevent webhook replay, recover an answer, refund a model request, or make outbound sends atomic with authority checks. Do not adjust automatic retry or claim a cost guarantee as part of it.

## Transport intake and acknowledgement gaps

**Telegram.** `parse` (251) keeps the message payload in `raw` but drops the top-level `update_id`; `parseUpdate` also folds an edited message into the ordinary message kind. `message_id` alone is not an intake identity. `handleUpdate` (449) resolves a clone and dispatches. The HTTP handler (544) returns 200 after authenticated processing, including exceptions. Its comments say Telegram retries forever; current primary documentation instead describes a bounded, unspecified number of attempts for non-2xx responses. Telegram specifically identifies `update_id` as useful for duplicate detection and notes that numbering can restart nonsequentially after a quiet interval. A monotonic maximum is not a complete deduplication policy. [Update contract](https://core.telegram.org/bots/api#update), [webhook contract](https://core.telegram.org/bots/api#setwebhook)

**Discord.** `parse` (195) places both an interaction ID and a gateway-style message ID in `messageId`. Those are distinct event kinds; an interaction ID is not generally the message ID to use in a reply reference. The current HTTP handler (315) sends a deferral before work and then awaits `handleEvent` (306); no durable admission backs that acknowledgement. Gateway-relay handling is a future shape, not verified ingestion. Discord requires a three-second initial interaction response and documents dedicated follow-up/edit routes; posting a separate channel message is not completion of the deferred interaction. [Interaction responses](https://docs.discord.com/developers/interactions/receiving-and-responding)

**WhatsApp.** `parse` (225) splits messages in a batched body; deduplication must therefore be per message, not per HTTP body. It preserves `phone_number_id` as `channelRef` and message ID but drops delivery-status callbacks. `handleEvents` (366) processes the array sequentially; an exception interrupts later items, while the HTTP handler (437) still responds 200. `post` discards outbound IDs, so the current status path cannot reconcile uncertain delivery. The local 24-hour window is an in-memory policy, not durable receipt evidence. The current Meta documentation endpoint could not be retrieved during this audit; no precise retry-duration claim is adopted from secondary pages.

Keep the immediate schema-free fix's HTTP acknowledgement behavior unchanged. Changing webhook retries safely requires durable event admission and per-item recovery first. A receipt fix alone is not permission to return retryable failures for the whole pipeline.

## Stable identity and conflict handling

Define a versioned envelope with surface, immutable bot/installation identity, event kind, transport event ID, bound agent, binding generation, destination chat/group, sender identity and a canonical payload hash.

- Telegram: retain update ID and update type; pin the receiving bot ID. Token rotation must not create a new dedup namespace for the same bot.
- Discord: distinguish interaction IDs from gateway message-create IDs and scope to the application/installation. Current `vy_clone_channel.kind` does not support Discord; do not invent a working installation binding.
- WhatsApp: scope each `messages[].id` to the authenticated phone-number installation and bind sender/chat independently.

Use a unique transport intake key such as `(surface, installation_identity, event_kind, event_id)`. Agent and destination belong to the immutable admitted record and must match on replay. Do not include only the newly resolved agent in the dedup key: rebinding a bot to another agent must not make an old update a new event. Hash the complete validated, versioned decision input before application truncation, not only a 4,000-character text prefix. Stable key/same hash reads recorded state; stable key/different hash or routing fails as a conflict, with no overwrite or second execution.

The schema already has `vy_clone_channel.channel_id`, `agent_id`, `replica_id`, `owner_user_id`, `kind`, `external_ref` and `credentials_ref`. `_clonechannel.js:resolveInboundClone` exposes the row internally, but Telegram/WhatsApp binders currently return only a subset. Default Telegram has no equivalent channel row; `_group-audience.js` verifies `getMe` and includes the bot ID in a revision digest, not as an exposed durable installation field. A digest is not a substitute for an explicit stable binding. These gaps must be closed at the authenticated edge, not filled with request-supplied claims.

## Persistence proposal, not a migration result

At this baseline, the greatest numbered migration source is `162_fact_communication.sql`; **163 is free in this checkout only**. This is not a production-catalog statement or an allocation reservation. Recheck the branch before creating `163_group_transport_effects.sql`; ignore the stale next-number comments in `AGENTS.md`.

Use the existing PostgreSQL authority through a small injected module such as `_group-effects.js`, not another database or workflow service. Mirror any new DDL into `db/schema.sql`. `_db.js:q` executes one statement per SQL-over-HTTP request; use conditional updates and single-statement CTEs, not a pretend transaction spanning requests. Prefer one admission statement that links the first intake to the episode/participants/human log, so recovery cannot duplicate source rows.

Separate immutable intake from effects/attempts. Effect identity includes parent intake, operation and fragment index. Model generation is itself an effect: journaling only outbound messages still allows duplicate paid generations. Proposed states:

| State | Meaning |
| --- | --- |
| `prepared` | The external dispatch has not been claimed. |
| `executing` | A specific attempt may be in flight. |
| `confirmed` | The adapter acknowledgement was durably recorded; it is not proof of human delivery. |
| `not_executed` | Positive evidence establishes that external dispatch did not occur. |
| `unknown` | Dispatch or its settlement may have occurred, but a reliable outcome is unavailable. |
| `cancelled` | Pending work was invalidated before dispatch; it does not undo an in-flight/completed disclosure. |

Do not recycle expired `executing` work into `prepared`. A fresh lease cannot fence an old HTTP request unless the downstream protocol actually honors that fence. Unknown model dispatch must not automatically generate again; unknown Telegram delivery must not automatically resend. Discord offers `nonce` with `enforce_nonce`, but its documented deduplication window is only the past few minutes, not unlimited replay protection. [Discord create-message contract](https://docs.discord.com/developers/resources/message#create-message)

A bounded first durable slice can store content-free intake and attempt state to suppress duplicates and expose unknown outcomes. Resumable generated-text delivery is a separate enlargement: retaining text creates a new content copy that needs source lineage, authority revalidation and erasure. Do not call a metadata-only ledger a replayable outbox.

Do not repurpose `vy_room_checkin_delivery`: it belongs to creator/follower Rooms, has UUID room ownership, and uses unrelated states. Voice-preview intents, GPU execution and correction-candidate jobs are also different authorities. They offer state-machine precedents, not a shared transport table.

## Erasure, retention and recovery UX

Any new stored content or person-attributed metadata must be covered by `api/memory.js:PERSON_TABLES`, export and `withdrawSharedRows`, group deletion, source/episode invalidation, and the replica-owner erasure path in `_replica-full-erasure.js`. `scripts/relcheck.mjs` must prove both person coverage and owner reach. The hosted group-SQL harness must select the new canonical DDL and exercise real parameterized queries.

Queued disclosures must be cancelled or rendered unusable when their source/consent/audience support changes. Already in-flight effects remain uncertain; cancellation cannot promise recall of external messages. Deleting an intake row can reopen an old replay after forgetting and rejoining. A retained payload hash or hashed transport identity is not automatically anonymous or exempt. A bounded retirement/tombstone policy, old-event admission barriers, and relink behavior need explicit design and tests; do not silently retain such data forever or claim this dilemma solved.

Recovery needs a status read independent of the original webhook: processing, accepted, not executed, delivery uncertain, cancelled. An uncertain state should support inspection and cancellation, not automatic resend. An explicit new attempt requires fresh authority and clear duplicate/cost implications. A quiet/withdrawal acknowledgement failure must show that the setting/action may already be applied; it must never instruct blind replay of the mutation.

Safe current proof path: offline actual-caller fault injection, source/schema changes and hosted synthetic PostgreSQL tests, including simultaneous duplicates, conflicting payloads, crash windows and settlement failures. No local database/server, cloud resource, paid provider, real installation or production migration is authorized by this audit. Live transport acceptance, operational reconciliation, billing behavior and consented human recovery remain separate requirements.

## Reproduction without a local file or network

Run the following from the active worktree at the observed baseline, using PowerShell. It reads the existing fixture definitions, rewrites only import resolution in memory, and appends the three probes. Fixture production modules execute with only their I/O dependencies replaced. Do not replace this with a native import of secret-bearing production modules or with the `evals/mp` SQL suite.

```powershell
@'
import { readFileSync } from 'node:fs';
const root = new URL('file:///C:/Users/raghav.s/Desktop/build/Vyakti-platform-multimodal-20260927/');
let source = readFileSync(new URL('evals/group-turn-authority/run.mjs', root), 'utf8').split('\nlet groups = 0;')[0];
source = source.replace(/from "\.\.\/\.\.\/(api\/[^\"]+)"/g,
  (_, path) => 'from ' + JSON.stringify(new URL(path, root).href));
source = source.replace('new URL(`../../${path}`, import.meta.url)',
  'new URL(path, ' + JSON.stringify(root.href) + ')');
source = source.replace('from "typescript"',
  'from ' + JSON.stringify(new URL('node_modules/typescript/lib/typescript.js', root).href));
source += `
const duplicate = fixture();
const first = await duplicate.run();
const second = await duplicate.run();
console.log(JSON.stringify({case:'duplicate',firstOk:first.ok,secondOk:second.ok,
  models:duplicate.calls.model.length,sends:duplicate.calls.sent.length,
  episodes:duplicate.calls.episodes.length,
  humanLogs:duplicate.calls.logs.filter(r=>r.role==='me').length,
  assistantLogs:duplicate.calls.logs.filter(r=>r.role==='her').length}));
const rejected = fixture();
rejected.ctx.send = async (chat,msg)=>{
  rejected.calls.sent.push({chat,msg}); return {ok:false,error:'network'};
};
const result = await rejected.run();
console.log(JSON.stringify({case:'unconfirmed',ok:result.ok,said:result.said,
  sends:rejected.calls.sent.length,
  assistantLogs:rejected.calls.logs.filter(r=>r.role==='her').length}));
const partial = fixture({split:true});
let attempts=0;
partial.ctx.send = async()=> (++attempts===1 ? {ok:false,error:'network'} : {ok:true});
const receipt = await partial.surface.deliver(partial.ctx,'-100001',
  {kind:'text',text:'two fragments'});
console.log(JSON.stringify({case:'partial',attempts,receipt}));
`;
await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
'@ | node --input-type=module
```

Later delivery fixes should make the unconfirmed probes reject; that change is expected and must be recorded as a separate candidate result, not substituted into this preserved baseline receipt.

## Subsequent working-candidate review, 1 October

After the baseline report was saved, root added an uncommitted schema-free `deliver()` candidate. This section records limited independent review, not final acceptance, hosted execution, durable delivery or a replacement for the three baseline failures.

The candidate accepts only an own data property `ok:true` on a non-array object. Its send/receipt catch emits a frozen, bounded `surface_delivery_unconfirmed` error with `status:502`, `phase:'delivery'`, `outcome:'unknown'`, fixed reason, accepted/attempted fragment counts, zero-based failed fragment and `retrySafe:false`; it carries no raw cause. Authority checks remain outside that catch. The complete rendered text list is validated and shallow-copied before transport effects.

Independent review executed ten focused checks successfully: false, null, scalar, array, inherited, accessor and thrown receipts; failure on the middle of three fragments; an invalid later rendered text property; and the actual `onCommand` body for `/bolo` with only its database/quiet-setting/delivery dependencies supplied. The last case confirms the setting changes before the failed acknowledgement, whose error is correctly scoped to delivery rather than claiming rollback. An additional full actual-group probe observes one model call, zero assistant logs, and the sanitized unknown-delivery error. Another two-fragment probe confirms that a later authority failure still propagates `group_authority_unavailable` after one accepted send.

The review also found two failing privacy-normalization cases in this working candidate: the initial `Array.isArray(rendered)` and `rendered.length` checks were outside its validation catch. A render-returned array Proxy with a throwing length read propagates its raw synthetic message; a revoked array Proxy propagates a raw TypeError. Both attempt zero sends, so these are bounded-error/privacy contract gaps, not observed unauthorized delivery. Root was asked to bring both checks under the validation catch and retain negative cases. Their correction and rerun are pending at this entry. Production collectors were inspected for their explicit `{ok:true}` compatibility; no live browser response delivery was inferred.

The test agent extracted the existing actual-module fixture into `evals/group-turn-authority/fixture.mjs` during this phase. New independent probes import `fixture` from that file directly and do not execute the complete authority suite as a side effect. The baseline reproduction above remains intentionally pinned to the old file shape at `34da5259`; do not rewrite the historical recipe to imply the fixed candidate still returns baseline failures.

Root subsequently moved the array-kind and initial length checks into the validation catch. Independent rerun passes all 12 focused checks: the original ten plus both reproduced Proxy cases. The Proxy failures now produce only `surface_delivery_unconfirmed`, `phase:'delivery'`, `status:502`, `outcome:'not_executed'`, `reason:'invalid_render'`, zero accepted/attempted fragments, null failed-fragment index, `retrySafe:false` and no cause, with zero sends. Exact `_surface.js` source SHA-256 read by the fixture and hashed within that run: `3c9da1b4854ad07b5b17045d0266e1b9e80fd1c48a7d0edf7fc31b23678d9669`. Preserve the earlier working failure above; this later correction does not erase it.

Independent review approves the bounded adapter-acceptance/early-stop/error-privacy contract at that source hash. This is not full integrated or hosted acceptance, actual PostgreSQL, durable replay suppression, transport reconciliation, provider billing proof or a live-user result. No code/context files were changed by the reviewer; only this audit document was written.
