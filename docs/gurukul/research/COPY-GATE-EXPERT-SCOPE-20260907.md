# Current expert product vocabulary scope, 2026-09-07

This follows the separately retained execution-only repair in COPY-GATE-PORTABLE-20260907.md and ROOT expert-tools/COPY-GATE-EXECUTION-ONLY-20260907.patch. The old125findings remain in the original scan log; they were not rewritten or waived individually.

Root conveyed the current owner directive explicitly: the user requested expert AI cloning, voice models, and an expert-first unified platform. Root's resulting policy decision is to supersede the obsolete application-wide Rooms-only naming, keep full dash/filler/accessibility/codename rules, and retain Rooms vocabulary on actual Room consumer/distribution surfaces and Room-specific Studio components. This is a product-scope decision, not a scanner false-positive claim. The August26 horizontal directive alone was not treated as superseding the later September3 Rooms decision.

## Exact boundary

The path matcher in scripts/copy-room-scope.mjs is:

```js
/^(?:src\/room\/|src\/(?:studio|creatorStudio)\/(?:RoomStudio|ReadinessPanel|CheckinsCard|HandoffCard|SuiteCard|PayoutsCard|InviteCreatorCard|ShowcaseCard|ShareKitCard)\.tsx$|site\/(?:vyakti|creators|suites)\.html$|room\.html$)/
```

It currently selects35existing scanned files. RoomStudio imports the seven cards directly; ReadinessPanel controls Room publishing readiness. The Room recipient directory and existing public Room distribution sites remain covered. Modern studio.html mounts the private expert workspace and is no longer subject to the Rooms naming rule; all its other checks remain. The creator preparation pages and general external clone-channel controls are not reclassified as follower-facing Rooms.

Mixed `src/(studio|creatorStudio)/(copy|hiCopy).ts` tables additionally retain the vocabulary rule for these16top-level content sections:

```
readiness recallRun payouts checkins handoff inviteCreator suite roomStudio
showcase suiteSeatLock showcasePicker poster shareKit suiteWeeklyNote
roomStudioMandate shareKitWhatsappJoin
```

The English EN and Hindi HI object declarations are parsed as TypeScript source, never imported or executed. A source mask preserves actual line offsets and retained comments, so existing copy-ok handling and findings remain meaningful. Missing declarations, missing selected sections, top-level spreads/computed keys/duplicates, malformed syntax and nonliteral selected sections fail with named errors. TypeScript loads only in this CLI mixed-table pass; ordinary existing server imports of scanSource do not load it. The scanner function and rule definitions remain byte-identical to the retained original. Explicit server callers that ask scanSource for Rooms vocabulary retain that contract.

Every file in the existing full/dash scan scopes still receives its prior other rules. No accessibility checker, legal string, receipt, confirmation token or allowlist entry changed. The existing disclosure allowlist remains effective wherever the rule applies. This is not a125-item exception list, and there is no fallback from a failed source parse to an empty or clean result.

## Evidence and limits

2026-09-07, Windows Node24.13.0, c56cadfe isolate. Before policy: repaired actual CLI exited1 on125Rooms-vocabulary findings across27files. After policy: actual `node scripts/check-copy.mjs` exits0,7scopes clean and21original negative controls pass. Earlier before/after path-only simulation was125to0 with35selected paths; the final run also includes both actual mixed locale tables.

`node evals/copy-gate-portable/run.mjs`:9actual process/filesystem groups pass, including original Windows silent0 and forced-old pathname failure, encoded filesystem paths, import-only behavior and real dash/Room vocabulary failures. `node evals/copy-gate-portable/scope.mjs`:12groups pass, including32mutations across every actual selected section in both locale sources, Hindi banned words, private clone/model terms allowed, private dash/filler/codename still rejected, and10malformed-table negative controls. The first test draft used the wrong existing rule ID filler rather than filler-verb, then assumed values were un-concatenated string literals; tests were corrected to inspect actual AST string values. No production rule was relaxed to accommodate either harness error.

No browser, DB, model, provider, build or deployment call. No claim that all conditional UI paths were mounted, that public copy has been human-reviewed, or that the complete release is accepted. The path/section inventory must grow when a new Room-owned UI or translated section appears; missing known sections already fail rather than silently dropping coverage. A new independently named Room section requires explicit registration and a matching negative control.

Reversal: observed owner confusion from clone/model terminology, or an owner change in the product scope, warrants revisiting the relevant surface's naming and this matcher together. It does not justify reinstating the inert Windows entrypoint, silently changing consent words or deleting source-scoped negative controls.
