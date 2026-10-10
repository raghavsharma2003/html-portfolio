# Private correction candidate construction

2026-09-08. Continues the caller audit on release34 base `5ade4ea95209b15b0268338128514401be41b710` and initial preparation commit `b992f16d`. This source is implemented and covered by scoped fixtures; migration152 and actual Azure construction have not run.

## Connected path

`ExpertConversation → FeedbackDatasetPanel → CorrectionCandidateAction → POST /api/replica-correction-candidate → runOwnedCorrectionCandidate → existing owned learning-example reader → Azure structured extraction → private policy artifact → registerOwnedCandidate`.

The action appears for a saved correction dataset. A status GET runs before the start button can enable. A current ready dataset enables **Create private candidate**. Lost or malformed POST responses require an explicit status check, not an automatic repeated write. Scope changes discard former-account results. The current AI is unchanged throughout this path.

The worker creates one durable job per dataset, extraction-model commitment and protocol. Only the successful insert owner can proceed. Replays read the exact conflicting job, including after another model created a newer job. Running/unknown/accounting-pending jobs never reissue the provider request.

The request uses only the complete eligible preparation split, with opaque conversation-group commitments so support can span independent conversations. Output is known calibration strategy IDs plus supporting example IDs, or abstention. It stores no raw correction wording in an artifact. Original encrypted exemplars stay in the existing feedback lane.

`renderPrivateCorrectionCandidate` produces a real experimental core from the exact baseline profile/calibration and catalogued directives. It removes only the replaced axes from the approved-calibration section, then labels proposed strategies as inferred and not owner-approved. It does not fabricate an owner vote, invent a memory or alter an approved definition. The artifact records baseline/proposal commitments and controlled IDs; compiled private profile text is generated in memory rather than duplicated into the job table.

## Authority, accounting and retention

`OWNED_RUNTIME_CONTEXT_SQL` was exported without changing its query. The worker combines that existing authority query and existing feedback review query in a same-statement gate. It compares active capability, exact profile/calibration JSON, all reviewed feedback rows, assignment rows, current dataset and source commitment at admission, artifact persistence, candidate registration and completion. There is another current check immediately before the provider call. Snapshot and locking semantics still require actual SQL/race proof; database and network dispatch are not one transaction.

`registerOwnedCandidate` accepts an optional fourth, server-only admission argument with fixed SQL and values. The route never forwards client SQL or a client admission object. Ordinary existing callers preserve their previous behavior; the correction worker requires current authority instead of admitting a superseded baseline.

Azure uses the existing Foundry endpoint, key and dialogue model configuration. The new adapter limits total time to45seconds, body512000bytes and output1200tokens, refuses redirects, requires measured usage, and never retries. The existing `claim_extraction` budget operation charges behavioral-shape extraction. Reservation includes schema framing. A validly parsed but semantically rejected proposal still persists and settles measured usage. Transport or usage ambiguity holds funds. A malformed provider envelope still cannot be reported as measured success.

New `AZURE_CORRECTION_BASE_MODEL_COMMITMENT` must be provisioned from reviewed baseline deployment evidence. It is a non-secret expected SHA256, not proof that the running deployment has been inspected by this worker. No actual baseline deployment pin or extraction model compatibility was verified in this slice.

Migration152 adds private job state, usage, controlled proposal, artifact/build commitments and candidate identity. Dataset and exact candidate/dataset/owner foreign keys cascade. Source erasure deletes jobs for affected datasets. The existing relational owner-lane graph must prove this cascade on the actual catalog. `db/schema.sql` mirrors migration152. No migration was applied here.

Microsoft documents array `minItems` and `maxItems` as unsupported in Azure's structured-output schema subset. Those keywords were removed from the wire schema; the application validator retains all count, duplicate, scenario and cross-conversation checks. This is compatibility preparation, not a successful Azure call. [Microsoft structured outputs](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs)

## Executed scope

| Check | Result |
| --- | --- |
| Request preparation/proposal controls | Passed, synthetic |
| Azure transport adapter | 9 groups passed, synthetic HTTP/streams |
| Actual worker, AES exemplar reader, dataset builder, meter, artifact renderer and registration | 8 groups passed against stateful SQL fixtures |
| New mounted candidate action | 6 groups passed at390/1440 |
| Existing mounted feedback workflow | 12 groups passed at390/1440 |
| Existing candidate qualification | 27 groups passed |
| Existing private dialogue | 33 groups passed |
| App semantic TypeScript | Passed, no emit/incremental writes |
| Copy | 7 scopes clean,21 negative controls |
| Context graph | Initial3entry graph passed; final logging recheck follows |

The first worker attempt failed before any checks because ignored `api/_config.js` was absent. A known inert release34 configuration was copied only after verifying SHA256 `728dc5821336bed9c5ad851b3e837a54d342674923de81454ce11b0a2d48a432`. Tests used no real credentials. Development dependencies are a junction to the accepted frozen34 private install used for reads only; no install or dependency mutation occurred. A final release candidate must follow root's own-dependency freeze process.

`scratchpad/correction37-proof/sql-inventory.json` contains21 exact production query shapes captured through the actual worker with synthetic parameters, for separate protected parser/runtime proof. `scratchpad/correction-candidate-ui/` and `scratchpad/correction-ui/` contain mounted fixture receipts/screenshots. They do not prove actual auth, database isolation, Azure behavior or owner fidelity.

Final accounting follow-up: the adapter now attaches validated measured usage to parsed provider refusals and invalid model JSON/content errors. The worker persists and settles those units before recording failure. The new eighth worker group proves this path and its no-repeat behavior with a fixture; unknown transport outcomes still retain their reservation.

## Remaining work

- Apply and independently verify152 on the isolated development database; exercise actual admission/revocation/feedback-change races, registration and erasure. No offline substitute.
- Provision and verify the actual baseline pin, then run one bounded Azure construction under the existing grant ledger. Do not infer improvement from a valid catalog proposal.
- Implement the real blind materializer using `persistCandidateEvaluationPackage` and this private renderer. Existing owner evaluation UI and qualification remain reusable but are not newly connected by this slice.
- Add owner-visible comparison access, qualified-candidate promotion and rollback. This implementation stops at a real draft artifact; no approval or activation button is fabricated.
- Add operator reconciliation for abandoned preparation/response-recorded jobs. Replays intentionally do not restart them. Dataset/model/protocol identity prevents double dispatch, but does not yet provide automatic crash recovery.
- Measure fresh Hindi, Hinglish and English owner preference, task correctness, false memory and cost before any quality claim.

The product is not complete because this source compiles or these fixtures pass.
