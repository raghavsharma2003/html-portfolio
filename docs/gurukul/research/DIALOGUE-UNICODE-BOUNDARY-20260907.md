# Shared dialogue Unicode boundary, 2026-09-07

Candidate: `codex/dialogue-unicode`, based on checkpoint21
`c56cadfe72a20ee02781485752d8d67fcfc6fb21`. This is an isolated patch, not a
deployment or completed full release. Integration and private rehearsal files
were not edited.

## Decision and reversal

Keep the existing numeric UTF-16 budgets: reply 1600, language hint 32, current
question 4000, core 6000, relationship 4000, each history row 2000, total history
16000. Reject the entire current question, reply, or hint if oversized or if it
contains an unpaired surrogate, before cleaning it. Service question admission
is before scoped IO; the exported prompt compiler also rejects invalid current
questions. Deliberately shortened context/history prefixes omit a boundary
surrogate pair whole; prompt sanitation removes existing lone surrogates.

This avoids changing storage/prompt capacity while preventing truncation from
changing a complete answer. Reverse the UTF-16 choice only with an explicit,
coordinated change to API, storage, UI, token/budget and history contracts. Do
not change only the validation count to code points.

## Measured negative evidence

The focused suite imports the actual frozen checkpoint21 contract from Git,
resolving its dependency to the real provenance module. Its answer of 1599
ASCII characters followed by U+1F642 has 1600 code points but 1601 UTF-16 units.
The incumbent validator accepts it and returns 1600 units ending in lone
U+D83D. Its hint of 31 ASCII characters plus the same emoji similarly splits.
The incumbent cleaner splits a 1999-ASCII-plus-emoji history prefix, and the
incumbent compiler splits a 3999-ASCII-plus-emoji current question. These are
executed counterexamples, not inferred defects or fabricated model responses.
The new code refuses the complete answer/hint/question and preserves whole
scalars when intentionally shortening context. No provider response was used.

Rejected: widening reply admission to 1600 code points while retaining a
1600-unit cleaner; the exact incumbent counterexample demonstrates corruption.
Rejected: clipping an oversized current question before validation; the
direct compiler negative control demonstrates the accepted changed question.

## Caller inventory and compatibility limits

* `api/_dialogue/contracts.js`: `compileDialoguePrompt` bounds core,
  relationship and history, and admits the complete current question.
  `validateDialogueOutput` normalizes and hashes complete model output;
  `dialogueSpeechStyle` revalidates delivery.
* `api/_replica-dialogue.js`: `generateOwnedDialogue` admits the raw question
  before runtime/session/DB/budget work, compiles the prompt, then validates
  generated output before recording a completed answer. Its handler is the
  ordinary `api/replica-dialogue.js` caller. `loadOwnedDialogueSpeech` applies
  the validator to the exact persisted answer and delivery.
* `api/_replica-dialogue-history.js`: completed history also revalidates the
  persisted output. Bad historical data now refuses with
  `dialogue_history_invalid`, rather than exposing a prefix. No rows are
  repaired or deleted by this patch.
* `api/_replica-speech.js` calls `loadOwnedDialogueSpeech` before synthesizing
  a completed private dialogue turn. No speech/provider code changes here.

Valid BMP Hindi, English, Roman Hinglish and within-budget supplementary
characters retain normalization and response/prompt hashes in the tested
fixtures. Strings previously accepted only because code-point counts hid a
larger UTF-16 size now fail. JSON Schema `maxLength` remains a code-point
constraint; the server intentionally also enforces its stricter UTF-16 cap.
This can refuse schema-valid supplementary-heavy output. No schema-based
guarantee of server acceptance is claimed. Combining sequences/grapheme
clusters may still be split in deliberately shortened context: this change
guarantees well-formed scalar pairs, not grapheme-aware truncation.

The private rehearsal candidate is outside this base. Its independent
post-settlement preflight remains in place; root should run its actual route
tests after integration. No conclusion about its whole request or compiler
limits is inferred from these tests.

## Accounting and error compatibility

The entire production block from turn creation through generation, completion,
settlement and failure handling is byte-identical to checkpoint21, verified
in the suite. A valid turn still records completion then settles. Invalid
generated output still marks the existing reservation uncertain and fails the
turn, without a completed answer; it does not silently release money. This
patch does not change that existing accounting policy. Malformed questions
fail with `dialogue_message_invalid`/400 and oversized ones with
`dialogue_message_too_large`/413 before scoped IO. Reply/hint errors retain the
existing error family; malformed replies use `dialogue_reply_invalid`.

## Checks and limits

Run on Node v24.13.0, 2026-09-07, latest focused run completed before
14:13:47Z:

* `node evals/dialogue-unicode.mjs`: 13 groups passed. Actual production
  contracts, generation service, speech reader and history reader execute.
  Runtime/authority/budget dependencies and SQL rows are explicit offline
  seams, with zero default DB/provider calls. Tests cover exact baseline
  corruption, complete boundary refusal, scalar preservation, four language
  and normalization fixtures, zero-IO invalid admission, successful turn
  ordering, uncertain-output handling and historical corruption.
* `node evals/dialogue-history.mjs`: 12 incumbent groups passed.
* `evals/replica-dialogue/run.mjs`: 31 incumbent checks passed with an inline
  Node module loader that replaces `_db.js` with a throwing default `q` and
  `_recall-run.js` with only its actual version constant. The suite's existing
  injected adapters and SQL rows remain in use; this is offline control-flow
  evidence. A direct invocation first failed on the isolate's absent ignored
  `api/_config.js`; no config/secrets were copied or inspected. The first
  inline loader attempt also failed at shell quoting before execution; the
  PowerShell literal here-string form fixed the harness, not product code.
* `node --check` passed for both changed production modules and the new eval;
  `git diff --check` passed.

No SQL parsing/authorization proof, live model, real microphone, browser,
TypeScript build or full release run was performed. Root owns registration
of `dialogue-unicode` in the integration eval runner and integration context.
