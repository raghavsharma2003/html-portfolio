-- Migration 008c — Telegram identity and the paying unit.
-- Contract: docs/design/PROPOSAL-MULTIPARTY-V1.md §4.3, §6.5, §6.6.
--
-- Idempotent, additive only, one statement per request (see 001 header).
--
-- vy_tg_person is THE single binding between Telegram and a vy_person. A
-- person in three rooms is one vy_person row, three vy_group_member rows and
-- one DM channel; §2.3 clause 4 is what stops those three worlds touching.
-- It is person-keyed, so it is user data: it belongs to PERSON_TABLES and is
-- swept by forget and carried by export like everything else.
--
-- The tap that writes this row is load-bearing rather than cosmetic: a
-- Telegram bot cannot initiate a conversation with a user who has never
-- started one ("Forbidden: bot can't initiate conversation with a user"), so
-- the same deep-link tap simultaneously opens the 1:1 channel, binds the
-- identity, runs the adult gate, and sets vy_group_member.linked_at. Until it
-- exists there is NO PERSON ROW AND THEREFORE NO PERSISTENCE (§6.4): an
-- unlinked member's messages are never written anywhere, which is how
-- adult-default is enforced structurally instead of by policy.
create table if not exists vy_tg_person (
  tg_user_id bigint primary key,
  person_id  uuid   not null,
  username   text   not null default '',
  linked_at  timestamptz not null default now()
);

create index if not exists vy_tg_person_person_ix on vy_tg_person (person_id);

-- The room is the paying unit, but a MEMBER pays (§6.6) — Telegram has no
-- room wallet, so one member's subscription keeps the room alive for
-- everyone. This gates room ingestion and room replies ONLY; it never gates
-- anyone's 1:1 relationship, because a downgrade that took someone's own
-- companion hostage would be NEVER MANIPULATE applied to the business model.
--
-- paid_by is a person, not a device, and is deliberately NOT in
-- PERSON_TABLES' delete path as an owning key: a lapsed-or-forgotten payer
-- must not silently delete the room's billing history for the other members.
-- Entitlement rows are financial records, and the room dies with its last
-- participant (§3.1.2), which is what takes them via the group_id cascade.
create table if not exists vy_group_entitlement (
  group_id      bigint not null references vy_group(id) on delete cascade,
  paid_by       uuid   not null,          -- a member, not the room (§6.6)
  provider      text   not null default 'tg_stars',
  charge_id     text   not null default '',
  period_start  timestamptz not null default now(),
  period_end    timestamptz not null,
  primary key (group_id, period_start)
);

create index if not exists vy_group_entitlement_active_ix
  on vy_group_entitlement (group_id, period_end desc);
