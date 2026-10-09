# October 9 legacy episode-link integrity audit

## Result

The 36-row `meera_log.episode_id` failure is a recurrence of the old Meera
partial-forget defect in the separately deployed Meera product. It is not a
new Vyakti writer failure.

All 36 rows belong to the legacy Meera agent, one legacy device and two missing
episodes. No row belongs to a current Vyakti replica subject, a Room, a Room
memory lane or a currently mapped person device. All 36 messages were written
on September 23, before the September 29 zero-orphan proof. Zero affected rows
were written on or after September 29.

The database does not have a foreign key from `meera_log.episode_id` to
`vy_episode.id`. A source delete can therefore remove an episode while leaving
surviving raw-log pointers behind.

## Metadata-only live evidence

Read at 2026-10-09T09:43:28Z using the pinned Azure service-principal helper,
the processing Job's in-memory Neon binding and SELECT-only Neon SQL-over-HTTP.
The read returned no message text, forget terms, device IDs, person IDs, agent
IDs, log IDs or episode IDs. It made zero database writes, zero cloud writes
and zero model calls.

| Shape | Count or time |
| --- | --- |
| Orphan log rows | 36 |
| Missing episodes | 2 |
| Affected devices | 1 |
| Affected agents | 1, the legacy Meera agent |
| Log interval | 2026-09-23 16:55:00Z to 17:18:22Z |
| Call rows | 33 |
| Chat rows | 3 |
| Current Vyakti replica-subject rows | 0 |
| Room or Room-memory rows | 0 |
| Existing Meera agent rows | 36 |
| Database FK protecting the episode link | absent |

The two missing episode shapes are 30 call rows over about 3.4 minutes and 6
mixed call/chat rows over about 62 seconds. The same affected device has 11
forget-ledger rows: eight inserted within 82 ms immediately after the September
23 conversation and three inserted within 13 ms on October 3 at 03:54:32Z.
The October 3 write is after the September 29 independent zero-orphan readback.

That timeline matters. The September 23 forget could run before the hourly
consolidator had made episodes. The surviving raw rows could then be
consolidated normally. The October 3 partial forget ran after episodes existed,
selected the episodes through deleted log IDs or a term/window match, deleted
those episodes, and left the 36 nonmatching raw rows pointing at them.

## Exact live source path

Vercel production history places deployment
`dpl_6h1vntvsAJoHimdfCLL2QSNk4Quu` at the `meera-silk.vercel.app` alias from
2026-08-25T20:15:05Z until the next production deployment on
2026-10-04T12:50:43Z. Its source is
`bee9061f52e95231589d9969551cd687fb6c140c` on
`claude/gurukul-platform`. It was therefore the production code at the October
3 forget time.

In that exact commit, `api/memory.js` calls `purgeRelational()` for item,
session and day forgets. The function finds every cited or overlapping episode
and runs a recursive `delete from vy_episode`. It does not first set surviving
`meera_log.episode_id` values to null and does not create a provisional wake
episode. This is the precise shape required to produce the observed rows.

The other production episode-delete door is replica full erasure. It does not
fit this incident: the rows all belong to the still-existing shared legacy
Meera agent, and the surviving logs plus post-baseline partial-forget ledger
event match the partial-forget path directly.

Meera was redeployed on October 4 and October 5. The current production alias
is READY on `dpl_Ck17zHCsMGQA1VkEFbicEUAx1Tyk`, source
`11f213ae734e93527a5626a255e1b95cbc2064f9` from
`claude/ai-companion-app-rkt1lv`. Direct inspection of that exact source shows
the same unguarded episode delete, so future recurrence remains possible.

The accepted Vyakti source `5fe2fa2590a355834bf61eea4e889103351af1f7`
contains the September 14 repair from `ecc8b6a2`: one statement first unclaims
surviving raw logs, creates content-free provisional wake episodes, and only
then deletes the doomed episodes. The defect is absent from that Vyakti source
but was never ported to Meera's separately deployed branch.

## Minimal fix

Fix the Meera product, not Vyakti:

1. Port the `ecc8b6a2` `unclaimed_logs` and `wake_episodes` CTEs into the
   current Meera branch's `purgeRelational()` statement and add the existing
   cross-surface regression case there.
2. Gate and deploy Meera. Verify the exact production source contains the CTEs
   before touching existing data.
3. Classify the 36-row incident afresh, exercise a new exact guarded repair in
   a transaction, roll it back, and verify restoration from an independent
   connection. Only then prepare a new one-use commit intent. Do not replay the
   September 14 or September 29 repair helpers.
4. Consider a later `ON DELETE SET NULL` foreign key as defense in depth. It
   cannot replace the source fix because an automatic null still needs a wake
   episode for reconsolidation.

Until Meera is fixed, the global live `relcheck` failure is real and must not be
reported as passing. For Vyakti release triage it is also precisely bounded:
the failing count is 36 legacy Meera rows and zero current Vyakti-agent rows.
This supports continuing Vyakti-specific checks while recording the full
shared-database gate as blocked by an external Meera deployment.

## Receipts

- `scratchpad/OCT09-LEGACY-INTEGRITY-READONLY.json`
- `scratchpad/OCT09-MEERA-DEPLOYMENT-READONLY.json`
- `scratchpad/oct09-legacy-integrity-readonly.py`
- `scratchpad/oct09-meera-deployment-readonly.py`

The scratchpad files are ignored and contain only the aggregate metadata named
above. No repair, migration, deployment, source edit, context edit or commit was
performed.
