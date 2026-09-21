-- Migration 111 (WS-R56). The payout status webhook: RazorpayX tells us a
-- payout it already accepted was later processed (money settled) or failed
-- (rejected, or reversed by the receiving bank). `sent -> settled` and
-- `queued|sent -> failed` are the two real transitions api/_payments.js's
-- `applyPayoutWebhook` closes (context/rejected.md and STATE.md's own open
-- item: "nothing calls sent and settled" - see db/migrations/098's own
-- state-machine header).
--
-- ── one statement per request, idempotent, no DO blocks ───────────────────
-- 009's law, restated by every migration since - Neon's SQL-over-HTTP
-- endpoint accepts exactly ONE statement per body, and an apply interrupted
-- halfway must be recoverable by running this same file again.
--
-- ── LAW 3 OF THIS WORKSTREAM'S BRIEF: a column, not a table ────────────────
-- The event IS a ledger row before it is a transition: `vy_creator_payout`
-- already has ONE row per payout (never per event - a payout receives at
-- most one settlement or one failure in its whole life, migration 098's own
-- closed state machine, `settled` and `failed` both terminal), so the
-- ROW ITSELF, widened with when-and-why it left `sent`/`queued`, already
-- carries everything a real event ledger would: no second table, because a
-- payout is never going to accumulate a SEQUENCE of these events the way
-- `vy_payment_event` genuinely needs one row per follower charge.
alter table vy_creator_payout add column if not exists settled_at timestamptz;
alter table vy_creator_payout add column if not exists failure_reason text;

-- `failure_reason` is capped the same way every provider-supplied free-text
-- field in this codebase is (`vy_creator_payout_account_ref_shape`'s own
-- precedent one migration up) - a webhook body is untrusted input, and an
-- unbounded provider string has no business becoming an unbounded column.
alter table vy_creator_payout drop constraint if exists vy_creator_payout_failure_reason_shape;
alter table vy_creator_payout add constraint vy_creator_payout_failure_reason_shape
  check (failure_reason is null or length(failure_reason) <= 500);

-- The webhook's own lookup key (api/_payments.js's `applyPayoutWebhook`:
-- "the provider ref as the key", this workstream's law 2) - `sendPayout`
-- already writes exactly one `provider_payout_ref` per payout the moment it
-- reaches `queued`, so this is unique the same way
-- `vy_payment_event_provider_ref_ix` is unique for a follower charge, one
-- migration family over: a duplicate ref would mean two different payouts
-- both claiming to be the SAME provider transfer, which the arithmetic
-- guarantee (`vy_creator_payout_sums`) and the state machine both already
-- assume can never happen.
create unique index if not exists vy_creator_payout_provider_ref_ix
  on vy_creator_payout (provider_payout_ref) where provider_payout_ref is not null;
