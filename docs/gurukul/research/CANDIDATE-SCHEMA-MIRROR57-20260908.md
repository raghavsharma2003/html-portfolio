# Candidate schema mirror audit, 2026-09-08

Followup: `LEGACY-SCHEMA58-BOOTSTRAP-PROPOSAL-20260908.md` records the subsequent
repair of the eight legacy table omissions, exact legacy ALTER inventory and
additional source defects. The findings below describe preserved8fe09246;
they are retained as history rather than fresh bootstrap acceptance.

Source baseline: release56 `fd6cb49ded6ec7d260ee9202079ac8c87fa08979`.
This audit performed no SQL, catalog read, cloud operation, dependency install,
build or browser run. Existing development tables are not evidence that a fresh
database can be provisioned from this file.

## Finding and bounded repair

The baseline schema jumps from migration018 to033. It omits all ten direct
feedback/dataset/candidate/evaluation tables from029 through032. Mirroring032
alone would fail because its candidate and feedback parents are also absent.
The replica runtime, generation, calibration, source and provider accounting
prerequisites are absent as well.

The patch inserts fifteen complete, unchanged historical migration bodies before
the existing033 block. Whole historical blocks preserve their unique indexes,
owner tuple FKs, CHECKs, alterations and erasure behavior instead of inventing
reduced table definitions. The order is:

| Historical file | Missing table definitions restored |
| --- | --- |
| 015_replica_core.sql | vy_account_person, vy_replica, vy_replica_consent, vy_replica_source, vy_replica_claim, vy_replica_voice_genome, vy_replica_voice_profile, vy_replica_profile, vy_replica_preference, vy_replica_eval_run, vy_replica_audit, vy_replica_erasure_job, vy_replica_deletion_receipt |
| 016_replica_enrollment.sql | vy_replica_liveness_challenge, vy_replica_processing_job |
| 017_replica_processing_manifests.sql | vy_replica_processing_attempt, vy_replica_processing_artifact, vy_replica_processing_evidence, vy_replica_processing_evidence_decision, vy_replica_model_build |
| 019_replica_generation_provenance.sql | vy_replica_generation, vy_replica_generation_receipt, vy_replica_generation_segment_receipt |
| 020_replica_review_isolation.sql | No new table; evidence owner columns, owner tuple constraints and model-build index |
| 023_replica_runtime.sql | vy_replica_runtime_capability, vy_replica_runtime_session |
| 024_person_model.sql | vy_replica_claim_decision; owner columns/constraints and profile source identity |
| 025_replica_calibration.sql | vy_replica_calibration; calibration version columns and FKs |
| 026_claim_extraction.sql | vy_replica_claim_extraction, vy_replica_claim_citation |
| 027_replica_dialogue.sql | vy_replica_dialogue_turn; generation dialogue binding and unique indexes |
| 028_provider_budget.sql | vy_provider_budget, vy_provider_spend |
| 029_replica_turn_feedback.sql | vy_replica_turn_feedback, vy_replica_turn_exemplar |
| 030_replica_feedback_dataset.sql | vy_replica_feedback_dataset, vy_replica_feedback_split |
| 031_replica_candidate_qualification.sql | vy_replica_candidate, vy_replica_candidate_qualification |
| 032_replica_candidate_owner_eval.sql | vy_replica_candidate_eval_run, vy_replica_candidate_eval_assignment, vy_replica_candidate_eval_asset, vy_replica_candidate_eval_judgment |

This is42 table definitions and151 top-level statements. The15 restored blocks
contain75 explicit indexes. The candidate identity index created by032 is also
needed by152/155/156 composite candidate FKs. The schema already mirrors all20
statements of152 correction jobs,155 materialization jobs/items, and156 private
selection/transition/activation plus functions, triggers and column alterations.
They stay after their restored prerequisites.

Historical guarded DO bodies remain byte-identical to their tracked migrations;
this patch does not author a new DO block or change any migration. No migration
number is allocated, rewritten or renumbered. This is a source mirror repair,
not an upgrade to an existing database and not acceptance of a new privacy
contract. The separate source-erasure/materializer review remains necessary.

## Numbering and bootstrap plan

Top-level015 identifies both `015_push_tokens.sql` and `015_replica_core.sql`;
016 identifies both `016_memory_consent.sql` and `016_replica_enrollment.sql`.
The runner's prefix selection expands to both files. These are existing names,
not a collision introduced by this patch. Use exact filenames in a reviewed
manifest, never assume one three-digit argument identifies one migration.

Archived local voice071 through076 conflict with the canonical room/challenge/
readiness/review/interview/drift071 through076. The archive's066 through070
also are not top-level runner inputs. Those artifacts are deliberately nested
under `db/migrations/reconciliation/local-voice-20260906/`; do not recursively
apply them, move them to top level, or renumber applied identities. The existing
source-purpose reconciliation archive is likewise separate. Migration156 needs
transactional application of its state CHECK replacement; the generic SQL-HTTP
runner does not supply that transaction.

A full empty-database bootstrap remains blocked after this scoped repair.
Eight unrelated CREATE TABLE definitions are still missing:011 has vy_self_arc,
vy_agent_life, vy_agent_life_told, vy_rel_texture and vy_observation;012 has
meera_turn and meera_turn_leg;015_push_tokens has vy_push_token. This audit did
not establish complete legacy ALTER/index/function parity, so eight is the
observed missing-table count, not a claim of only eight remaining defects.

The next bootstrap work must follow this sequence:

1. Freeze the accepted source SHA and a manifest of exact input paths/hashes.
   Merge this mirror patch and the separately reviewed156/erasure changes before
   constructing that manifest. Do not run the current schema on any database.
2. In a separate bounded bootstrap repair, reconcile the eight named legacy
   table omissions and all legacy alterations needed by the assembled schema.
   Resolve each archived lineage against its existing schema mirror. Preserve
   applied filenames/identities. Produce one reviewed complete `db/schema.sql`
   as the empty-bootstrap input; do not combine it with a migration glob.
3. Obtain a dedicated empty disposable PostgreSQL database with the required
   extensions, then execute that frozen complete input through a reviewed
   transactional connection that splits top-level statements while preserving
   function/DO bodies. Stop at the first failure. This is future work requiring
   the root's DB lane; no credentials or launcher are included here.
4. Compare actual resulting catalog columns, types, unique keys, FK targets and
   delete actions, CHECK definitions, indexes, triggers and functions against
   the exact canonical migrations and reviewed reconciliation manifest. Run the
   actual candidate queries/erasure/race controls against this fresh schema,
   including152/155/156, then roll back/clean up and record acknowledgements.
   SQL text comparison is not this parser or runtime proof.
5. Only after that proof and the normal release gates can fresh provisioning be
   described as supported. Existing development/production upgrades remain a
   different catalog-driven plan; do not replay this schema onto either.

## Validation, failure and reversal condition

`node scripts/check-candidate-schema-mirror.mjs` passed source parity for15
historical bodies/151 statements,86 lexical FK references to earlier table
definitions, and20 exact ordered downstream statements. Three negative controls
reject a missing evaluation asset definition, a changed FK delete action, and
evaluation-before-candidate ordering. SQL executed:0. `git diff --check` passed.
These checks cannot validate SQL types, unique target suitability, constraint
semantics, trigger execution, actual erase concurrency or provider behavior.

Initial local generation used a JavaScript replacement string containing SQL
`$'` anchors; JavaScript expanded them as replacement suffix tokens, bloating the
file. Exact mirror parity rejected it. The file was rebuilt from pinned HEAD
using a replacement callback; the same problem in the reorder negative control
was corrected before the recorded pass. No SQL ran with either rejected file.

Keep the exact mirror strategy unless actual fresh-catalog/parser evidence
shows a historical statement conflicts with the intended assembled schema. If
it does, preserve the failure and prepare a separately reviewed reconciliation;
do not silently edit an applied migration or weaken the mirror control.
