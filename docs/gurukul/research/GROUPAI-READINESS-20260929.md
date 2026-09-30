# GroupAI readiness ledger, 29 September 2026

## Preservation update, 30 September

Saved on `codex/multimodal-layer-20260927` in `raghavsharma2003/html-portfolio` at the user's request before a usage limit. This is an unverified implementation checkpoint, not a ready release. Root's fresh network-blocked results: backend review 21, Telegram audience 58, UI source-only 14, SQL-harness source-only five groups passed. Group-turn authority failed at `run.mjs:337` after 46 groups, in the source-receipt mutation's expected wire-delivery refusal. Preserve and diagnose that exact failure. No database, browser server, live provider or deployment was run locally.

Immediate resume order:

1. Repair or explain the failing mutation without weakening the production authority guards.
2. Register `source-aware-claim-review`, `source-aware-review-ui`, `group-audience`, `group-turn-authority` and a safe SQL source-only check in the real eval registry; these are not wired yet.
3. Run the prepared keyless hosted PostgreSQL workflow and inspect its exact production-SQL outcomes. Local source-only success is not SQL proof.
4. Run mounted review tests in hosted CI, retain their synthetic screenshots, inspect mobile/desktop behavior, and rerun typecheck and the full combined release gates.
5. Continue the open capability rows below. Older query-aware group-source recall is still a sketch. Assistant outputs remain excluded from model history until complete durable dependency lineage is implemented.

The previous agent-reported passes below remain historical and attributed; they do not override the fresh root failure. The original archived `Vyakti-GroupAI` folder and dirty coordinator worktree were not modified.

The user asked to continue until the Group AI layer is ready. This ledger records what that claim requires and the evidence available for the active implementation. Base `6718bc24a081ecb4f4f10355681b878398f8ffb0` plus working changes is not yet a verified combined candidate. The prior green `4cc5e662` receipt applies to its historical source only. The broad objective remains unfinished.

## Two product paths, different authority

| Path | Actual entry/caller | Acceptance scope |
|---|---|---|
| Common-friend group | `/api/tg`, `/api/discord`, `/api/whatsapp` dispatch through `api/_surface.js` and `api/_room.js`. | Everyone who can read the shared conversation, source audience, membership, consent, disclosure and delivery. |
| Creator-private follower Room | `/api/room` through the creator/follower Room implementation. | One follower's private continuing relationship with the creator AI. Its passing tests do not authorize the shared-group path. |

The Telegram candidate adds a current platform witness using the same bound bot client as delivery. Source code now restricts it to reviewed private, unlinked chats without visible history, verifies the bot and member identities, and compares membership counts. This is not an atomic audience/send transaction: a participant can join after a check, history policy can change, and forwarding/copying is outside recall revocation. Unsupported transports cannot silently borrow this witness. No real transport has been exercised in this wave.

## Source findings and current candidate status

These 12 findings were supplied by the architecture/root audit. Candidate source is not a completed fix receipt.

| Finding | Candidate or remaining gap | Evidence still required |
|---|---|---|
| Raw `roomHistory` omitted audience ACLs. | `_surface` now delegates to audience-bound raw evidence reads. | Actual SQL refusal/allow cases and real caller checks. |
| A mutable 45-minute episode added late joiners retroactively. | `_room` creates a fresh audience-bound episode per human turn. | Late-join and cross-turn SQL non-interference. |
| `logRoomTurn` omitted `episode_id`. | Writes now bind episode, audience and speaker lineage. | Actual SQL rejects missing/mismatched ancestry. |
| DB recipient sets omitted unlinked readers. | Group admission compares full current membership with a verified platform witness. | Current/unlinked/changed audience controls and actual transport witness. |
| Guessed `/start rID` admitted membership. | Telegram linking calls verified membership. | Guessed/foreign/stale membership refusal through real dispatch. |
| Ordinary messages revived withdrawal. | Source changes preserve withdrawal unless a verified explicit linking path authorizes it. | Withdraw/rejoin lifecycle checks and SQL proof. |
| Only clone-public authority guarded egress. | Shared-group guard binds current authority and source receipts around generation/delivery. | No provider/send after authority or source changes; actual transport limits recorded. |
| No connected group fact writer. | Open. | An actual scoped writer caller, citation lineage and deletion/withdrawal tests. |
| No native group screen. | Open; owner source-review changes are not a shared-group screen. | A complete group-facing user flow and hosted browser evidence. |
| No private-to-group disclosure-grant writer. | Open. | Explicit scoped disclosure authoring, current-consent enforcement and revocation. |
| No group multimedia evidence admission. | Open; existing owner extraction is a separate boundary. | Group-source attribution, audience and modality admission through actual callers. |
| No durable transport deduplication. | Open. | Durable replay identity and repeated-delivery/recovery controls. |

Owner source review is a separate useful slice: selected Context Locker source flows into claim review with authenticated provenance, modality and available coordinates. It must preserve existing decisions, profile approval and learning thresholds. It does not implement the missing group writers or prove a consented group task.

## Acceptance ledger

| Evidence level | Current state | What it establishes |
|---|---|---|
| Source review | Working guard/Telegram/source-review code exists; independent reviews are in progress or reported. | Inspectable mechanisms only. |
| Offline real-caller controls | Initial author reports below; final root results pending. | Bounded control flow with doubles, not PostgreSQL semantics. |
| Actual PostgreSQL | New keyless ephemeral GitHub CI workflow/harness written; no run result yet. | Must execute production SQL against synthetic hosted PostgreSQL, with no local DB or owner data. |
| Hosted browser and full release | Pending for the combined source. | Desktop/mobile interactions and normal configured software gates. |
| Real transport/provider | Not run. | Requires current permissions, consent, bot/platform configuration and a bounded provider budget. |
| Consented human group task | Not run. | Participants can use, inspect, correct, withdraw and delete within the agreed group task. Required for whole-layer readiness. |

The SQL workflow uses a synthetic GitHub service database without a Neon key. This is new proof preparation, not an assertion of actual SQL success. No local database/container/server, live provider call, cloud resource or deployment is part of the current checkpoint. Goal status is not changed by this ledger.

## Initial evidence, attributed precisely

Root relayed author-reported source-review backend 21, PersonModel 50, grounding seven, citation-coordinate seven and multimodal 19 offline passes with independent review. They are not recorded as root-executed outcomes. Telegram audience initially passed 48 checks before additional public-chat/visible-history restrictions; its final count is pending. Group source-guard syntax and ten refusal controls passed; the surface suite was 83/84 with a stale mutation test being repaired. These are preliminary receipts, not a combined green run.

The logging agent inspected the current shared-route wiring, group guard/episode/log source and new workflow. No product, SQL or provider test was run by that inspection. Final root-executed outcomes and actual hosted receipts will be appended here without erasing failed or provisional checkpoints.
