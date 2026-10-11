# Private rehearsal continuity32

This is an unaccepted implementation candidate based on release31 `01a7b6f2`. No migration, real SQL, Azure model, browser or deployment was executed. Root's full release was running, so npm installation, semantic TypeScript compilation and browser work were deliberately deferred. Do not promote this candidate from the offline results alone.

## Implemented caller and boundaries

Expert Meet now has one private conversation setting, "Use earlier private conversations". It stays selected across messages and resets on account/replica change. The actual `createDialogueTurn` request carries it; the authenticated backend reads earlier completed private exchanges only when selected. Public publication remains unchanged with `memory:false`.

The backend reuses existing dialogue turns and raw logs. It reads at most three exchanges from another active private-chat session within the existing 12-hour expiry, with the same owner, replica, agent, subject person, capability and approved versions. Query matching is a small lexical first slice for Hindi/Hinglish/English; this is not semantic recall or a claimed recall-quality breakthrough. Existing full Meera recall and consolidation are not repointed.

Exact source question/reply SHA256 commitments bind admission and completion. New evidence is limited to 2048 UTF-8 bytes, also a conservative token upper bound consistent with the existing provider-budget estimator. The normal budget reservation includes it. Whole Unicode scalars are retained when shortening excerpts. Prior AI replies are explicitly untrusted conversation evidence, not verified facts. No correction examples or held-out training evidence enter this path.

The nullable migration148 JSONB column stores only source turn IDs and question/reply hashes. Sources with their own continuity references are excluded, so this first slice has no recursive recall chain. Admission, completion, ordinary history and private source inspection check current source presence, bytes, scope and lifecycle. Derived answers are currently text-only; the speech endpoint also refuses them rather than trusting a UI flag.

The compact source detail reads through an authenticated `continuity_sources` operation on demand, clears old excerpts before refreshing, and cancels stale account requests. It is actual wired component code, but has not yet been mounted in a browser in this isolate.

## Erasure and export

No new table is introduced. `api/memory.js`'s existing `PERSON_TABLES` dialogue entry includes both person/device keys, and its generic row export includes the added column. Full replica erasure deletes agent raw logs; existing foreign keys remove dialogue turns. No follower-lane content is added to creator export.

JSON references alone would leave a derived reply after individual source deletion. Migration148 therefore includes a BEFORE DELETE trigger on the source dialogue turn. It locks the exact replica parent, then deletes the derived assistant raw-log row within the same owner/replica/agent/person boundary; existing log-to-turn foreign keys perform the remaining cascade. A partial GIN index supports source-reference lookup. `CREATE OR REPLACE TRIGGER` avoids an unprotected drop/recreate interval on rerun. Four statements, no DO block, mirrored into `db/schema.sql`.

These are implementation facts, not physical-erasure proof. Real PostgreSQL must verify trigger timing, source-before/during-completion races, full-owner cascade ordering, inverse deletion, foreign-reference isolation, legacy null handling and invalid nonarray rejection. A deadlock or other failure must remain an error; nothing swallows one to claim erasure.

## Verification performed

- 21 focused offline controls pass: multilingual token filtering, bounded prompt, exact source checksums, corrupted/same-session evidence refusal, unavailable authority/database errors, explicit source inspection, SQL predicate mutation controls, migration mirror and unchanged public scope.
- 33 existing-plus-added dialogue controls pass. The two additions run the actual opted-in dialogue caller against injected SQL/provider fixtures and confirm evidence reaches its prompt, ID/hash refs reach admission, and derived voice is denied.
- 12 existing history controls pass.
- Four TS/TSX files transpile with zero syntax diagnostics. This is not a semantic type check.
- Impeccable mechanical detector reports no findings on the new detail component/CSS. This is not a visual acceptance.
- `evals/private-continuity/prepare-sql.mjs` emits seven exact production query shapes with synthetic parameters. It performs no SQL execution. The migration SHA is included; regenerate after any migration change.

The first replica-dialogue attempt failed on the missing ignored `_config.js`. It was repaired by copying a verified inert blank stub, never a credential-bearing configuration. The original failure is environmental, not a passing test. No local dependency installation was run.

## Required next checks

1. Independent source review, then isolated real SQL parsing of all seven statements and actual migration148/trigger/cascade fixtures under root's protected launcher. Retain negative controls and prove cleanup.
2. Install private dependencies after the full-release host reservation ends. Run semantic TypeScript and the prepared `evals/private-continuity/ui.mjs`, then the existing conversation and history UI suites. Inspect 390/1440 screenshots together. The new mounted suite is registered but has not been run.
3. Run the complete release gate on the combined accepted candidate. Do not infer other agents' changes were integrated.
4. Only after real authority and source erasure proof, compare held-out English/Hindi/Hinglish questions against original prior-session evidence using Azure and the existing budget ledger. Report errors and retrieval misses, not a fabricated quality percentage.

## Next voice slice

This text-only restriction is temporary. Protected speech already binds `generation.dialogue_turn_id`; `_provenance/providers/neon-ledger.js` rechecks authority at open, appendSegment and seal. Extend those actual authority predicates and `beginOwnedPrivateGeneration` to include current continuity evidence before enabling derived voice. Test source deletion during protected streaming and before sealing.

The inspected path persists segment receipts and C2PA manifests; it does not establish a raw-audio blob per generation. Verify broker payload retention and any real provider object locators before choosing cleanup. Reuse `replica-erasure-sweep`'s actual source/voice cleanup lanes where objects exist, rather than inventing an unrelated artifact queue. Existing audible disclosure, watermark, signed provenance and billing remain required.
