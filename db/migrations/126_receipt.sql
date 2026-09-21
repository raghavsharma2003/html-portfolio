-- Migration 126 - the follower's receipt (WS-R100). Every payment a
-- follower makes gets a number, the date, the Room, the amount with GST
-- lines, the platform's legal name and GSTIN (or a named placeholder), in
-- the follower's own language, built from the ledger (`vy_payment_event`,
-- migration 078) and never from the provider's own page.
--
-- ── one statement per request, idempotent, no DO blocks ───────────────────
-- 009's law, restated by every migration since (078/090/098's own headers,
-- verbatim rationale, binding here for the identical reason): Neon's
-- SQL-over-HTTP endpoint accepts exactly ONE statement per body, and an
-- apply interrupted halfway must be recoverable by running this same file
-- again. No functions, no explicit ::uuid casts needed on primary keys
-- (078's own convention for a `default gen_random_uuid()` column).
--
-- ── CGST Rules, 2017, Rule 46 (Tax invoice) — verified 2026-09-05 against
--    gstzen.in and studycafe.in, both quoting the rule's own clause text,
--    cross-checked against each other rather than trusted from one source —
--    the mandatory particulars api/_receipt.js builds toward ─────────────
--
--   (a) supplier's name, address and GSTIN. `PLATFORM_LEGAL_NAME`/
--       `PLATFORM_GSTIN` (api/_receipt.js, both optional env vars,
--       docs/gurukul/ENV-MANIFEST.md §32) - unset renders one clearly
--       marked placeholder sentence, never a fabricated name or number.
--   (b) "a consecutive serial number not exceeding sixteen characters...
--       unique for a financial year." THIS clause is the reason for the
--       whole design below: `receipt_no` is claimed from a per-financial-
--       year counter inside one atomic `UPDATE ... RETURNING`
--       (`vy_receipt_counter`), never a JS increment, so two concurrent
--       claims can never see the same number or leave a gap between them.
--       `api/_receipt.js`'s `formatReceiptNumber` renders it `VY/<FY>/<n>`
--       (e.g. `VY/2026-27/1`) - "VY/2026-27/" alone spends 11 of the 16
--       characters this clause allows, leaving five digits, good for 99,999
--       receipts in one financial year before the format itself needs to
--       change. A real, honest limit, logged rather than silently risked:
--       `context/decisions.md#ws-r100-receipt-number-bounded-by-rule-46b`.
--   (c) date of issue - `issued_at`.
--   (d)-(f) recipient's name, address and GSTIN, with a proviso excusing
--       an UNREGISTERED recipient's name and address when the supply's
--       value is under fifty thousand rupees (verified against the same
--       two sources). A follower here is always unregistered and always
--       pays under six hundred rupees a month (migration 078's own
--       299-599 band), so neither is mandatory - and this platform does
--       not collect either in the first place, its own standing privacy
--       posture, so the receipt states the follower's own account
--       reference rather than a name it was never given.
--   (g) HSN/SAC (the Harmonized System / Services Accounting Code). NOT
--       settled - no Services Accounting Code for a Room membership has
--       been confirmed with an accountant. Rendered as a named
--       "to be confirmed" sentence, the identical no-fake-numbers
--       treatment `api/_payments.js`'s `TDS_DISCLOSURE_SENTENCE` already
--       gives an unconfirmed tax figure two migrations over, never an
--       invented code.
--   (j)-(m) total value, taxable value, tax rate, tax amount. Split into
--       CGST+SGST only when the follower's own billing state is KNOWN to
--       equal the platform's registered state, split IGST when known to
--       differ, else one undifferentiated "GST included" line at the named
--       rate - this product collects no follower billing state today (a
--       real, honest gap: `context/decisions.md#ws-r100-follower-state-
--       unknown-gst-split-undifferentiated`), and asserting an
--       intrastate/interstate split without knowing it would be exactly
--       the fabricated precision `context/rejected.md`'s no-fake-numbers
--       law forbids.
--   (n) place of supply (state name, for an inter-state transaction). Not
--       determinable without the follower's own state either - left absent
--       rather than guessed, same reasoning as (j)-(m).
--
-- Signature/QR requirements ((q)-(s)) are out of scope for a v1 HTML/print
-- receipt with no e-invoicing integration - not claimed as met.
--
-- ── the erasure lane ────────────────────────────────────────────────────
--
--   vy_receipt          PERSON lane (carries `person_id`) but deliberately
--                        NOT a `PERSON_TABLES` (api/memory.js) entry - see
--                        scripts/relcheck.mjs's `EXEMPT` map for the written
--                        reason this check requires, and api/memory.js's own
--                        explicit door (right beside `vy_room_forget_receipt`'s)
--                        for what an account-wide "forget everything" pass
--                        actually does here: NULLS `person_id`, never
--                        deletes the row. `vy_room_subscription`'s own
--                        precedent (078/090, `context/decisions.md
--                        #ws-r11-subscription-survives-forget-until-terminal`)
--                        restated for a receipt instead of a mandate - a
--                        follower's own receipt is proof they paid real
--                        money for a real service, and forgetting a Room
--                        may not also make an accountant's or a parent's
--                        copy of that proof retroactively inaccurate. What
--                        survives the null: `receipt_no`, the amount (via
--                        the still-intact `vy_payment_event` row), the Room,
--                        the date. What is gone: which person it was issued
--                        to. The narrow, per-Room `roomForget`
--                        (api/_room-surface.js) does NOT touch this table at
--                        all, `vy_room_subscription`'s own restraint
--                        restated: forgetting what an AI remembers about a
--                        follower is a different request in kind from
--                        forgetting that they paid money.
--
--                        A full REPLICA erasure (the creator ending the
--                        whole Room, api/_replica-full-erasure.js) is a
--                        different, stronger act and DOES delete this
--                        table's rows by name, child-before-parent ahead of
--                        `vy_payment_event`, folded into the existing
--                        "owner_room_payments" receipt class (098's own
--                        precedent for the fund-account reference).
--
--   vy_receipt_counter   Content-free: a financial-year label and a bare
--                        integer. No person, no owner, nothing to forget.
create table if not exists vy_receipt_counter (
  fy   text primary key check (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  next bigint not null default 1 check (next > 0)
);

create table if not exists vy_receipt (
  receipt_id       uuid primary key default gen_random_uuid(),
  receipt_no       bigint not null check (receipt_no > 0),
  payment_event_id uuid not null references vy_payment_event(event_id) on delete cascade,
  room_id          uuid not null references vy_room(room_id) on delete cascade,
  person_id        uuid,
  issued_at        timestamptz not null default now()
);

-- LAW 1's idempotency: the INSERT itself, `on conflict (payment_event_id) do
-- nothing` in api/_payments.js, is the only guard a retried webhook needs -
-- migration 078's `vy_payment_event_provider_ref_ix` restated for this
-- table. One receipt per charge, full stop.
create unique index if not exists vy_receipt_payment_event_ix
  on vy_receipt (payment_event_id);

-- The follower's own read (`roomReceipt`/`roomReceipts`, api/_room-surface.js):
-- every receipt for one person in one room, newest first. `person_id` is
-- nullable (see the erasure-lane note above), so this index still serves a
-- nulled row's own room-scoped operator-adjacent reads even though no
-- follower can ever look one up again once their own id is gone from it.
create index if not exists vy_receipt_room_person_ix
  on vy_receipt (room_id, person_id, issued_at desc);
