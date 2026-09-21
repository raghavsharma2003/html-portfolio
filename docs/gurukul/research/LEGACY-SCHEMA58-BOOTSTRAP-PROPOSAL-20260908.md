# Legacy schema completion and held bootstrap proof proposal

2026-09-08. Followup to preserved commit `8fe09246` on `codex/schema-mirror57`.
This is a source patch and proposal only. No SQL, database creation, cloud call,
ledger modification, dependency installation, build or browser run occurred.

## Source repair and exact inventory

Eight complete historical migration bodies were missing from the schema:

| File | Statements | Repair |
| --- | ---: | --- |
| 010_agent_strict.sql | 28 | Agent defaults and uniqueness arbiters |
| 011_self_layer.sql | 9 | Five self/relationship tables and indexes |
| 012_turn_trace.sql | 16 | Two trace tables, nullability/default changes and indexes |
| 013_surface_room_binding.sql | 8 | Surface columns/indexes and historical backfills |
| 014_kin_provisional_texture_drift.sql | 3 | Provisional and cited drift columns |
| 015_push_tokens.sql | 3 | Push registration table and indexes |
| 021_raw_agent_strict.sql | 5 | Raw agent defaults removed after018 |
| 022_remaining_agent_keys.sql | 2 | Guarded session/taste composite keys |

All 74 statements and eight table definitions are now mirrored without changing
their historical files. The010 through015 push blocks follow009 and precede018;
021/022 follow018/020 and precede023. Existing016 memory consent already matches
the schema. All 35 files through032 now have all449 statements present by the
inventory's lexical comparison, including156 top-level ALTER TABLE statements
and11 guarded DO bodies. The eight added tables already have their person/device
erasure entries or documented agent-only exclusions in `api/memory.js`; this
patch changes no privacy runtime contract.

The full-file dependency check found two additional source defects:

- Five hash CHECKs in the existing schema had lost the closing dollar anchor
  and quote. These are072 verification lease/sentence,074 review dedupe,
  073 readiness inputs, and075 interview question. Their exact historical
  migration predicates supply the repair. The malformed strings let the old
  statement splitter swallow later table definitions; a raw table-name grep
  could not detect that failure.
- The095-widened `vy_payment_event` definition referenced `vy_org` and
  `vy_org_subscription` before their definitions. The entire existing091 schema
  mirror block was moved unchanged before that payment table, after `vy_room`.
  No payment column, constraint, ledger row or migration file was altered.

The repaired schema has214 separately delimited CREATE TABLE definitions and
1267 top-level statements. Every table declared by the149 canonical top-level
migration files is present. All1304 lexical FK/ALTER/index target occurrences
refer to a table already declared at that point. This establishes source
completeness and table dependency ordering for these checks; it does not prove
PostgreSQL will accept the file, that every referenced column has the right
type, or that a unique key or CHECK has the required meaning.

`SCHEMA58-STATEMENT-INVENTORY.json` records every canonical migration filename,
its LF-normalized SHA256, each statement's ordinal, source text and lexical
SHA256, whether it was present in preserved8fe09246, and its current schema
positions. It covers149 files and1342 statements:1095 exact matches and247
non-exact later statements. None of the449 legacy statements through032 is
non-exact. The inventory normalizes comments and whitespace outside quoted
values; quoted text and dollar bodies retain their contents.

The247 later differences require catalog reconciliation, not blind appending:
208 ALTER TABLE statements,25 CREATE TABLE statements,9 guarded bodies and5
other statements. Many current schema definitions fold historical ALTERs into
inline definitions or incorporate later migrations. The source inventory does
not label these equivalent or defective. Concrete examples include048/050 trial
columns,052 TeacherSheet timestamps,056 validity columns/indexes,095 payment
nullability and org FKs,098/111 payout columns/defaults, and108 historical org
attachment backfill. Evaluate the final intended catalog and empty-table
effects; do not replay old constraints or backfills onto live data to force
textual equality. The full list is the JSON rows with an empty
`currentPositions` array.

The archived local voice066 through076 and source-purpose reconciliation
artifacts stay nested and unchanged. Their existing reviewed schema additions
are included in this schema, but their compatibility with canonical lineages
still belongs in the actual catalog proof.015/016 duplicate prefixes and the
archived071 through076 collisions remain historical identities, never a reason
to rename or recursively apply files.

## Proposed fresh isolated database proof, disabled

No executable launcher or database identifier is supplied by this proposal.
The root must separately review and authorize the exact frozen source and the
exclusive DB lane. Do not target production or the existing development
integration database. Do not infer authorization to create a database from
this document.

1. Freeze the reviewed followup commit and raw file hashes for `db/schema.sql`,
   both mirror controls, this inventory, the149 canonical migrations and both
   reconciliation manifests/artifacts. Reject any source drift before imports
   or database access. The test input is the one complete schema file, not
   schema plus a migration glob. Preserve the historical catalog/SQL receipts.
2. The root selects or separately authorizes creation of one disposable empty
   database. A reviewed connection must prove its exact identity, role and
   server version, and that it contains no pre-existing application objects or
   rows. PostgreSQL must support the schema's CREATE OR REPLACE TRIGGER syntax,
   and the `pgcrypto` and `vector` extensions must be available. The schema
   already names CREATE EXTENSION; do not guess or silently substitute types.
   Database lifecycle/cleanup authorization is a distinct reviewed action.
3. Run one bounded bootstrap transaction through the established protected
   bootstrap/connection lifecycle, with exact BEGIN and ROLLBACK command-tag
   acknowledgements and a retained hard-deadline receipt. Proposed limits for
   review:30-second statement timeout,3-second lock timeout,600-second work
   deadline,660-second hard deadline, and30 seconds reserved for cleanup.
   Admit only the frozen1267 schema statements, bounded identity/settings
   queries and read-only catalog projections. No COMMIT, provider, app launch,
   job scheduler, key write or billing transaction is included. Stop at the
   first failed statement and retain its ordinal, SQL hash and SQLSTATE.
4. In that transaction, compare actual catalog table/column types and defaults,
   nullability, primary/unique keys, exact FK column order and delete actions,
   CHECK definitions, indexes/predicates, function bodies and trigger bindings
   against the reviewed final manifest. Resolve every247 non-exact inventory
   item and both reconciliation lineages explicitly. Baseline inserts inside
   historical schema statements are synthetic transaction-local bootstrap
   effects, never a reason to read or modify an existing positive ledger.
5. Use separate reviewed packets for actual candidate query parser/runtime
   checks and erasure/concurrency proof against this fresh shape. A successful
   empty DDL transaction alone cannot prove152/155/156 serving, candidate
   privacy, race handling or provider quality. Existing relational/release
   gates remain required and must not run in the current heavy-lane hold.
6. A successful bootstrap receipt must include exact input hashes, target
   identity, statement counts, catalog comparisons, explicit no-COMMIT/provider
   counts, acknowledged ROLLBACK, restoration/empty-state confirmation and
   acknowledged connection close. Any timeout or uncertain cleanup is a failed
   or unknown proof requiring root review, never a retry or assumed rollback.
   Dispose of the database only under its separately reviewed lifecycle plan.

## Validation and reversal

The source-only control verifies eight exact restored bodies, all449 legacy
statements, all214 canonical table definitions,1267 statement boundaries and
1304 earlier table targets. Four negative controls remove a legacy table,
remove a nullability ALTER, damage the readiness CHECK quote, and move org
definitions after their payment consumer. The earlier candidate mirror control
retains its three negatives and exact152/155/156 checks.

During control development, initial canonicalization retained duplicate spaces
around removed comments and falsely rejected008b. A later raw table regex
counted the words `create table if` inside a comment. Neither changed SQL.
Comment-aware whitespace handling and line-anchored declaration collection
fixed those controls; the final source metrics above are from the corrected
checks. The actual malformed predicates and payment ordering defects were
present in preserved8fe09246 and remain recorded as rejected baseline evidence.

Keep the exact historical restoration unless actual PostgreSQL parser/catalog
proof contradicts it. If a later inline schema definition differs in semantics,
preserve the failure and prepare a specific source reconciliation. Never edit
an applied migration, weaken an ownership/consent/erasure predicate, or mark
the247 non-exact statements accepted based on a textual or mocked comparison.
