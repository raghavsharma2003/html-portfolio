-- Migration 016 — the memory-consent ledger (task #148).
--
-- ── WHY THIS TABLE EXISTS ────────────────────────────────────────────────
--
-- India's DPDP Act reaches full effect on 2027-05-14. Storing cross-session
-- personal and emotional memory about a person requires its OWN specific,
-- informed, unbundled consent: not a terms-of-service checkbox, not a clause
-- folded into an 18+ confirmation, not an inference from continued use.
-- Penalties reach Rs 250 Cr. (context/measurements.md, market sweep 2026-08.)
--
-- The ASK is src/components/MemoryConsent.tsx and the answer BINDS on the
-- device (src/engine/memory.ts's gate refuses the write ops the moment the
-- local answer is no). This table is the third thing consent needs and the
-- only one the client cannot provide: EVIDENCE. An answer that lives solely in
-- the localStorage of the phone that gave it is not evidence — the user can
-- edit it, a reinstall erases it, and nothing outside that phone ever saw it.
--
-- ── APPEND-ONLY, ONE ROW PER ANSWER ──────────────────────────────────────
--
-- No unique key, no upsert, no update path. The question a regulator asks is
-- "was consent in force when this row was written", which a single mutable row
-- structurally cannot answer, and a withdrawal that overwrote its own grant
-- would destroy the record of the thing being withdrawn. So a grant is a row,
-- a withdrawal is a row, and the current answer is the newest row for a device
-- (`meera_consent_device_at` serves exactly that read). The table only grows,
-- and it grows by four small integers and a uuid per answer.
--
-- ── CONTENT LAW (migration 012's, and it binds hardest here) ─────────────
--
-- There is no column in this table that can hold anything anybody said, and
-- there must never be one. This is the ledger of a decision ABOUT memory; a
-- text column on it would make the refusal path the one path that files new
-- content about a person, which is the exact inversion of what was agreed.
--
--   device_id  who answered, in the only identity this product has for most of
--              its users. NOT NULL: an unattributable consent row is not
--              evidence of anything and cannot be honoured or deleted.
--   user_id    the account, when there is one. Nullable, because most users
--              are anonymous and requiring a login to record a REFUSAL would
--              mean the refusals we cannot prove are the ones from people who
--              never signed up.
--   kind       which consent. 'memory' is the only value today; a second
--              question (an export share, a research opt-in) is a new value
--              here rather than a second table, so one ledger answers "what
--              has this person agreed to".
--   granted    the answer itself.
--   version    which ASK it answers. The copy on the card is what a person
--              actually agreed to, so when that copy changes materially the
--              version goes up and consent to the old words stops standing in
--              for consent to the new ones (src/state/store.ts,
--              MEMORY_CONSENT_VERSION).
--   at         when the person tapped, from their clock.
--   filed_at   when we heard about it, from ours. Both, because a device that
--              was offline for an hour makes them differ and the honest answer
--              to "when was consent given" is the first one — while the second
--              is the one that cannot be forged by a wrong device clock.
--
-- ── NO FOREIGN KEY TO vy_person_device ───────────────────────────────────
--
-- Same decision migration 015 records for vy_push_token, for the same reason:
-- "an unmapped device IS its person" (§2.1), so most devices have no mapping
-- row and an FK would reject exactly the anonymous users this product mostly
-- has. Worse here than there: the row an FK would reject is a REFUSAL.
--
-- ── FORGET AND EXPORT ────────────────────────────────────────────────────
--
-- Listed in PERSON_TABLES (api/memory.js) as lane "relational", so the
-- manifest loop deletes it on a whole wipe with no further code, and
-- api/export.js includes it in a DSAR with no further code. scripts/
-- relcheck.mjs fails any device-keyed table that is in neither the manifest
-- nor its own EXEMPT map, and that gate is the reason this paragraph is a
-- decision rather than an omission.
--
-- The decision itself: A FULL WIPE TAKES THE CONSENT ROWS TOO. Two arguments
-- pointed the other way and both lose. "Keep the evidence" would mean a
-- device-id-keyed record of a person surviving the one request whose entire
-- promise is that nothing about them remains, which is the promise the product
-- is built on. "Keep the withdrawal" mistakes what the ledger says: the
-- absence of a granted row IS the absence of consent, and the device's own
-- copy of the refusal is what actually stops the writes. So a forget leaves a
-- person with no consent on record, which is the same state they were in
-- before they ever answered, and the state that permits nothing until they are
-- asked again.
--
-- Every statement below is independently idempotent (db/migrations/apply.mjs).

create table if not exists meera_consent (
  id        bigint generated always as identity primary key,
  device_id uuid not null,
  user_id   uuid,
  kind      text not null default 'memory',
  granted   boolean not null,
  version   integer not null default 1,
  at        timestamptz not null default now(),
  filed_at  timestamptz not null default now()
);

-- The only read this table has: "the current answer for this device", which is
-- its newest row. Also the shape the forget delete uses.
create index if not exists meera_consent_device_at
  on meera_consent (device_id, at desc);
