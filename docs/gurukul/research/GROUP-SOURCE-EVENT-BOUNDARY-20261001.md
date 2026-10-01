# Group sources: admission after known consent boundaries

Date: 1 October 2026. This extends [the delivery audit](GROUP-DELIVERY-DURABILITY-20261001.md) without adopting its proposed replay-retention policy. It is a new working software candidate after verified `fe652992`; its new SQL and combined hosted acceptance are still pending at this receipt.

**Subsequent software acceptance, 1 October:** exact `808ad32f23aaac609e5793ce4e692c6c6a2a42bb` passes [release 36894264452](https://github.com/raghavsharma2003/html-portfolio/actions/runs/36894264452), all 24 configured checks on Node 22 and 24; both explicitly skip relational gates without `NEON_URL`. Separate [synthetic PostgreSQL 36894264361](https://github.com/raghavsharma2003/html-portfolio/actions/runs/36894264361) executes all 50 groups, including unmodified authority timestamps through the real helper. [APK 36894264406](https://github.com/raghavsharma2003/html-portfolio/actions/runs/36894264406) succeeds, including ingress 26, actual group caller 170 and delivery 44. Application source is unchanged from `af17fbca`; intervening fixes repair evaluation synchronization. The initial receipt below is retained as history; the [readiness ledger](GROUPAI-READINESS-20260929.md) preserves failures, repairs and exact completion evidence. This accepts the bounded software contract, not historical membership, concurrent erasure, replay suppression, live providers, deployment or whole-product readiness.

## Problem and narrow guarantee

Current membership alone is not enough to admit a delayed message. If a message predates another recipient's known consent, storing it under the current recipient set can give that old observation a newer audience. The check must cover every recipient, not just the sender.

The new contract is deliberately **admission after known consent boundaries**. An ordinary source's declared platform-sent instant must be strictly later than current group reading consent and each current recipient's linked-consent instant. The caller checks first, and both actual episode/log SQL writers repeat the comparison against their own statement snapshots. Equality refuses because a whole-second message date cannot establish later ordering within that second.

This does not reconstruct the historical platform audience. Unobserved leave/rejoin transitions, legacy writers, stale linking commands, current-state snapshots, concurrent erasure and already-completed external effects remain separate limitations. No 24-hour freshness window, 48-hour retention period, retirement policy, inbox, automatic retry or migration is introduced.

## Ingress and scope

The [Telegram Message contract](https://core.telegram.org/bots/api#message) distinguishes original sent time from edit time and identifies ephemeral, guest and business scopes. A chat identifier alone does not make those inputs ordinary group content. The [Update contract](https://core.telegram.org/bots/api#update) also distinguishes new and edited messages. These official pages were inspected on 1 October, including their Bot API 10.3 changelog; no live platform trial was run.

`api/tg.js::parse` copies primitive `sourceEventKind` and `sourceSentAtSeconds` from the ordinary update. `handleUpdate` parses before awaiting engine/binding work, so later mutation of the raw request cannot replace the normalized sent time or text. It never substitutes edit time or local arrival time. Group edits, ambiguous update variants and unsupported ephemeral/guest/business/anonymous or automated/offline forms become ignored events before group command dispatch. Legacy `parseUpdate` remains available; ordinary DM behavior and ordinary command policy are not redesigned by this change.

Only literal text/caption handling is preserved. A caption is not image, audio or video perception. Other adapters cannot invent a sent-time witness from local receipt time to make group processing work; they must supply their own explicit trusted normalization contract. The synthetic Discord isolation fixture declares such inputs without claiming a production Discord audience implementation.

## Actual application and SQL path

`api/_group-source-event.js::assertGroupSourceEvent` validates the normalized event, exact transport scope, complete current recipient/member correspondence and sender membership. It returns a canonical positive whole-second ISO string ending in `.000Z`, or a fixed content-free `group_source_event_unavailable` error. Authority timestamps preserve microsecond comparisons and accept actual PostgreSQL offset representations (`Z`, `+00`, `+0000`, `+00:00` and corresponding signed offsets) without permitting malformed calendars or coercing source seconds.

`api/_surface.js::onGroupMessage` invokes the helper after current group/audience authority and before source reads/content writes. The original event primitives are copied before awaits. The resulting `sourceSentAt` is passed unchanged to:

1. `_room.js::openOrExtendGroupEpisode`, bind 5;
2. `_room.js::logRoomTurn` for the human source, bind 10;
3. the same log writer for the later assistant audit, bind 10.

Both writers require a canonical source time before issuing SQL. Their `INSERT ... SELECT` requires group consent before that instant and rejects a current admitted member whose link time is equal or later. Existing agent/group, audience equality, episode/participant, role and disclosure predicates remain in place. A changed known link between the caller check and the next SQL statement therefore cannot be hidden merely because participant IDs stayed the same.

These are statement-snapshot predicates, not serialized membership/erasure transactions. If an assistant audit write becomes ineligible after an already accepted send, the check cannot recall that send. Source `meera_log.at` remains storage time; no new transport-time column is persisted or retrospectively inferred for existing history. Earlier stored sources continue to use the existing episode disclosure rules; this change does not backfill their event-time provenance.

## Verification and observed repair

Root local execution passes 26 source-event groups, 170 actual group-caller controls, 44 delivery controls, 48 agent-isolation checks and 13 source-only SQL groups under network blocking. Forced TypeScript exits 0. Independent ingress, SQL-source and actual-caller reviews approve their bounded software contracts. Existing control purposes remain covered.

The source-event suite executes the actual Telegram HTTP verification/handler/parser with a synthetic secret and I/O doubles. The caller suite separately feeds actual parser results into real dispatch, including unsupported group commands with zero source/model/send effects. Those tests are not a live webhook or proof of physical delivery.

Root review caught an initial authority-date parser that accepted only colon offsets: a PostgreSQL top-level timestamp can use `+00` while nested JSON uses `+00:00`. The parser was corrected, with exact-microsecond positive/negative controls. A new hosted case will pass the actual unmodified `groupTurnAuthority` result into the real helper; no normalization in the test may conceal that boundary.

The hosted SQL suite now targets 50 groups: the earlier 42, seven temporal-writer groups with rejecting query mutations, and the authority-to-helper wire-format case. None of those new actual SQL executions is claimed from source-only checks. Final run identities and any failures belong in [the readiness ledger](GROUPAI-READINESS-20260929.md).

## Remaining work

The replay/freshness/retirement choice and the consented non-production environment/budget remain unanswered user questions. Native web-to-platform identity linking is a separate [unimplemented contract](GROUP-NATIVE-IDENTITY-20261001.md), not something creator ownership authorizes. Durable effects, source-dependent forgetting, explicit sharing grants, native group UI, group media and human-value validation remain open. Neither this admission boundary nor the earlier passing software gates establish whole-layer readiness or a research-quality breakthrough.
