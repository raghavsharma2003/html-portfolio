# Private text comparison materializer

2026-09-08. Based on correction37 commit1a4f34fccd3035311bad595cb66c1322c38b7396. Source and scoped fixtures are implemented. No migration155, Azure generation, real owner preference or deployment has run in this slice.

## Connected owner journey

The saved private correction candidate now shows **Prepare blind comparison**. One explicit click starts a durable job and advances confirmed work sequentially. Progress counts generated responses. The owner does not click once per response. Reload, account change, unmount or an uncertain response stops new writes. A safe status read and explicit **Continue preparation** resume only work that the server has confirmed is still eligible. An uncertain provider outcome remains held and never redispatches.

When all responses and accounting are accepted, the existing encrypted A/B owner evaluation opens for the exact candidate. Neither role mapping nor provider identities are returned to that UI. No fabricated judgment, candidate qualification, active profile update or approval is performed.

The browser currently drives bounded internal work while open. Background completion after closing it requires a separately connected durable Azure worker. A held job needs operator reconciliation; it is not quietly retried.

## Materialization and commitments

The worker reuses the correction dataset basis, exact baseline profile/calibration and private artifact renderer. It generates both baseline and candidate answers through the same Azure dialogue adapter. It never treats the original historical answer as a generated baseline. Test questions come from the original owner-bound user turns; correction wording, original answers and held-out ratings never enter generation prompts.

All test examples are required,30–100 across at least two held-out sessions, without train/development session overlap. The first scope compares isolated original questions against the baseline and candidate cores with identical empty history and relationship inputs. It does not reproduce the historical conversation or establish long-term memory/relationship quality. Questions that the normal prompt compiler would truncate or normalize differently are refused. Cores over the shared dialogue compiler's6000-unit cap are refused before candidate directives can disappear silently.

Each response has a durable item ID, exact prompt hash, encrypted question and output, reservation, measured usage and reported provider identity. An atomic job claim prevents two concurrent advances from dispatching work. A missing item stops admission before any extra model call. Job IDs and secrets never appear in model prompts. A private random seed gives deterministic, balanced A/B ordering through the existing package builder. Final run commitment includes artifact, baseline deployment commitment, outputs, examples and order. The seed and role identities remain server-side.

The materializer supplies an optional fixed server-owned authority predicate to the existing package persistence function. It rechecks current owner/runtime, exact feedback dataset and assignments, source hash, artifact and candidate at admission, immediately before dispatch, output persistence and package persistence. The package retry branch also applies this predicate. SQL snapshots and the network dispatch are not an atomic transaction; actual races still need database proof.

## Azure reported revision binding

Ordinary dialogue calls retain their previous response contract. Private comparisons use opt-in strict mode. The current bounded contract requires the observed endpoint, deployment `gpt-4.1-mini`, response model `gpt-4.1-mini-2025-04-14`, a configured baseline snapshot hash and a nonempty Azure system fingerprint. Every response in an evaluation must share the same verified reported identity. Missing identity, alias-only model, fingerprint drift or binding changes refuse publication. Measured usage is retained and settled before refusal. Transport/usage ambiguity holds funds.

Configuration uses existing Azure endpoint/key/model and budget settings, existing evaluation encryption keys, `AZURE_CORRECTION_BASE_MODEL_COMMITMENT`, plus `AZURE_FOUNDRY_EXPECTED_RESPONSE_MODEL`. No values were provisioned here. An operator hash alone does not prove a live deployment is immutable; response metadata does not prove identical underlying weights forever. The separately observed current Azure deployment can auto-upgrade, so response checks are required.

## Retention

Migration155 is four separate statements and mirrors into `db/schema.sql`. Job/item content stays encrypted; the parent package field stores only run ID/commitment. Owned candidate/dataset/correction-job and feedback foreign keys connect erasure. Source erasure already deletes affected correction jobs, which now cascade to intermediate assets. Existing final A/B assets use their existing erasure chain. `scripts/relcheck.mjs` includes these tables in the normal owner reach walk, with no exemption. These are source declarations until actual SQL/erasure proof runs.

## Executed evidence

- Actual materializer worker, AES, artifact renderer, budget and blind package under stateful SQL fixtures:10groups passed. Includes full held-out paired responses, simultaneous requests, replay/unknown hold, authority withdrawal, usage settlement, missing items, revision drift and no activation.
- Actual bound/unbound Azure adapter with synthetic HTTP:7revision groups passed. Existing Azure adapter54checks passed, including retained mutation controls.
- Existing candidate owner evaluation31checks and qualification27checks passed.
- Materializer API ownership/candidate filter4groups and UI response/transport contract passed.
- App semantic TypeScript passed with private frozen34 dependencies. Copy7scopes clean and21negative controls passed.
- Mounted mobile/desktop UI controls are authored, not yet run at this handoff revision.

The worker inventory at `scratchpad/materializer41-proof/sql-inventory.json` contains29 exact executed production SQL strings with synthetic parameters. It is not a parser or referential-integrity proof.

Two actual failed attempts are retained as lessons: the incumbent adapter mutation loader rewrites only double-quoted relative imports; the new helper's single-quoted import initially broke that loader before negative controls. Using the existing import style preserved every negative control and the suite then passed. Initial semantic TypeScript used ancestor ROOT dependencies and failed on missing existing KaTeX; ROOT lacks that package while the frozen34 install includes0.18.7. A private copy resolved the environment mismatch without modifying `ExpertAnswer.tsx`.

Remaining acceptance: mounted UI, independent source review, actual155 parser/runtime/concurrency/erasure proof, reviewed live baseline binding, bounded real Azure materialization, fresh owner judgments and separate qualification/approval/rollback connection. No quality improvement or competitor superiority follows from these fixture passes.
