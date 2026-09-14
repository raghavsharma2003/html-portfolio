# Text publication HTTP and expiry runtime

2026-09-08 candidate in `scratchpad/expert-text-publication-next`, base `7d4b121abf73a171b44e3e1baba467c39d8ba38f`. This slice is implementation and offline control-flow evidence. It is not deployment, real SQL, paid-answer quality, verified identity or voice acceptance.

## Owned source boundary

- `api/_text-publication-runtime.js`: owner and visitor orchestration.
- `api/replica-text-publication.js`: actual owner auth, limiter and HTTP caller.
- `api/text-publication.js`: actual visitor auth, limiter, structured Azure generator and shared-gate caller, 60-second function limit.
- `api/text-publication-expire.js`: cron authentication, bounded cleanup drain and actual expiry store caller.
- `vercel.json`: one additive `/api/text-publication-expire` entry every ten minutes, preserving all existing entries.
- `evals/text-publication-runtime/{run,expiry,authority-race,all}.mjs` and `fixtures/vercel-before.json`: focused controls and immutable old scheduler negative. Root registers `text-publication-runtime` using `node evals/text-publication-runtime/all.mjs`; no runner registry was edited here.

Schema, store, crypto, source reader, compiler, generated bundle and erasure belong to the collaborating store agent. The compiler is tested through the actual generated artifact. The public API is documented in `TEXT-PUBLICATION-CONTRACT.md`; read its POST-result correction and minimal never-created publication response. No session token goes in a URL.

## Decision and reversal

Only a winning durable admission can reserve and claim a question. Existing complete, pending, uncertain and withdrawn requests are read without resolving a provider. The authenticated visitor is distinct from the publication owner; server-returned owner/replica authority supplies the scoped never-rule reader. The new publication compiler rejects private rehearsal authority. No existing identity, Room, voice or private compiler predicate is relaxed.

Usage is settled even when cancellation or current authority withholds the answer. An attempted ledger begin is treated as ambiguous until reconciled, never released on a speculative assumption that no call ran. Pre-begin reservation release depends on exclusive admission identity surviving erasure/reuse; the store now allocates content-free permanent request-ID ledger entries before admitting a request, so erased IDs cannot be admitted again. The actual SQL overlap proof remains pending. A null release receipt stays reconciliation-required. No automatic provider retry exists. Structured reply text is refused whole above 1600 UTF-16 units or on malformed Unicode, before the cleaner. Every retained segment passes the actual expert parser, honesty and owner never rules. Completion and a separate result read recheck authority before the HTTP response. A persisted dispatch authority epoch now refuses any later authority edit, including a never rule added after the gate. This does not mutate or revoke the published projection; fresh questions can still use an otherwise current publication.

Reversal: if SQL overlap or actual provider-ledger evidence disproves exclusive admission ownership, current authority, cancellation withholding or payable-usage handling, keep publication unavailable and repair that boundary before another paid experiment. Source/prompt quality does not reverse ownership rules.

## Offline measurements

Final focused checks executed29 runtime groups,10 expiry groups and4 held authority/replay groups together through `all.mjs`. The legacy private rehearsal handler's17 groups also passed separately. Runtime uses actual generated compiler/shared gates and actual endpoint modules with dependency injection. Expiry uses the actual expiry and fresh cleanup store SQL handed to an injected database and the actual scheduler registry. Held tests use the real store, compiler, crypto and shared gate with a fixture database. They pause completion after the gate, mutate the authority epoch and observe real store refusal; an unchanged control delivers, stale completed replay refuses, and a second same-ID HTTP ask while completion is held reads pending with one reservation and dispatch. This does not parse PostgreSQL or establish locks. No network, provider, database, browser or full build was executed by this slice.

Controls cover old private authority refusal, authenticated foreign-visitor rejection, inert replay during provider outage, same canonical durable IDs, non-Azure adapter refusal, ambiguous begin/claim/release/transport, post-provider cancellation, usage settlement, current-authority refusal, final readback refusal, late substantive bullet never rules, rule-read failure, whole malformed/overlong output refusal, platform readiness, owner publish replay/stale review and unpublish availability.

Expiry uses strict Bearer `CRON_SECRET`, at least24 bytes and constant-time equality. Caller overrides cannot increase50 publications/page, four pages/run, or the8-second between-query budget. A full final page returns503 backlog; a short page reports observed counts. The budget is checked between queries, not a claimed hard SQL timeout. The function limit is60 seconds. The store expires no request later than its publication. Read eligibility ends at persisted expiry; physical scrubbing occurs on a successful sweep and is not an exact-second or scheduler-uptime guarantee. Actual scheduler activation and retention lag remain deployment evidence.

## Rejections and limitations

Rejected plausible empty expiry success: the store now refuses missing or malformed aggregate results and requires a separate fresh cleanup confirmation. Rejected stale rule acceptance: a new authority epoch obtained after output gating cannot establish that the old gate saw the new rule; persisted dispatch epoch and held controls address the JS/orchestration case. Rejected request-UUID reuse after row erasure while an old spend row or handler survives; allocation now retains a content-free request ID outside source/request cascades. All SQL semantics and overlap behavior still need root's actual development proof.

The first expiry harness assertion failed because its request helper default supplied a valid header for the intended undefined-header negative. The test now passes the explicit undefined header directly. No product authentication was relaxed.

The first held-control failure expected the wrong proposed error name (`dispatch_authority_changed`); actual store returned `text_publication_output_authority_changed`. The fixture now asserts the actual named contract. The scheduler negative is pinned to the base25 bytes, not mutable Git HEAD, so committing the candidate cannot erase its own negative control. Future unrelated cron additions and CSP changes are permitted while every retained predecessor cron remains checked.

Runtime availability validates the Azure adapter, shared compiler/gate and global budget syntax at owner readiness; status, unpublish, forget and stored-result routes do not need an available model. Publication crypto, source permission, visitor quotas and publication cap remain store checks. Existing Supabase auth, Neon, Azure structured dialogue configuration and rates, encryption key, per-publication cap and cron secret must be configured separately. No configuration is activated here. Adult self-attestation is not verified age, and the display name is not verified identity.

Root still owns exact SQL parser/overlap proof, the connected owner/visitor UI proof, provider usage/quality experiment, deployed scheduler inspection and canary/rollback acceptance. New context entries should retain these evidence limits rather than describing mocked SQL as executed.
