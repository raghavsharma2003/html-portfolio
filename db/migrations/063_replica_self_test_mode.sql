-- Migration 063 — provenance for REPLICA_SELF_TEST_MODE's auto-grants.
--
-- Contract: WS-AQ. The owner's directive (verbatim, said three times): no
-- identity or liveness check for internal, self-only testing — "upload, my
-- clone should start being made". That behaviour lives entirely in
-- application code, gated by the REPLICA_SELF_TEST_MODE env flag (default
-- OFF, see api/_replica-processing/self-test.js). This migration adds only
-- what that code needs to keep every auto-grant FINDABLE and REVOCABLE, which
-- the owner will need before any real (non-owner) user exists on this
-- product:
--
--   1. vy_replica gets a `metadata` jsonb column, so the four identity
--      timestamps a self-test grant sets can be told apart from a real
--      verification. Nothing before this migration ever wrote to it.
--   2. vy_replica_processing_evidence_decision and
--      vy_replica_processing_artifact_decision get the same `metadata`
--      column consent already had since migration 015 — every OTHER
--      append-only decision/receipt table in this schema already carries
--      one, and these two were the exception, not the rule.
--
-- Idempotent, ONE STATEMENT PER REQUEST (Neon SQL-over-HTTP; see 001/apply.mjs).
-- No DO blocks — plain DDL only, drop-then-add is not needed because nothing
-- here is a CHECK constraint.
--
-- relcheck.mjs needs no changes: it discovers owner-keyed tables and their
-- cascade reach by walking information_schema/pg_constraint directly, not
-- from a maintained list, and these are existing tables gaining a column,
-- not new tables.

alter table vy_replica
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table vy_replica_processing_evidence_decision
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table vy_replica_processing_artifact_decision
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- One index per table so "find everything the flag ever created" (the
-- revocation query) is an index scan, not a sequential one, once a
-- self-test replica has hundreds of evidence rows.
create index if not exists vy_replica_self_test_ix
  on vy_replica ((metadata ->> 'self_test_mode'))
  where metadata ->> 'self_test_mode' = 'true';

create index if not exists vy_replica_evidence_decision_self_test_ix
  on vy_replica_processing_evidence_decision ((metadata ->> 'self_test_mode'))
  where metadata ->> 'self_test_mode' = 'true';

create index if not exists vy_replica_artifact_decision_self_test_ix
  on vy_replica_processing_artifact_decision ((metadata ->> 'self_test_mode'))
  where metadata ->> 'self_test_mode' = 'true';
