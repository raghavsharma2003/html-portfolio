# October 10: useful answers, corrections and controllable voice

Continue `raghavsharma2003/html-portfolio`, branch
`claude/vyakti-cloning-platform-aq05n4`, standalone25 checkout. Accepted live
application remains52160982, documentationad02edc8. No new deployment yet.
Read the latest STATE block and October9 handoff for live evidence/access.

Owner asks to keep iterating toward a sellable product better than competitors.
This authorizes continuing Vyakti work, not a claim of achieved quality or PMF.
Maya/Meera/other products remain out of scope. Azure-only serving, existing
budgets, no personal Microsoft login and no reuse of retained voice samples.
Do not restart paused goals/automations or replay consumed October9 intents.

## Current implementation work

1. Fix a reproduced memory omission: a relevant Section X row outside the newest20
   was dropped because the selector discarded one-letter identifiers. Bounded
   rarity-aware lexical fix and12selector/31compiler tests pass. This is not
   semantic or cross-language memory quality proof.
2. Improve private rehearsal rendering and Hindi usability. Existing code renders
   answers as raw text and leaves most controls/errors English. Reuse safe
   ExpertAnswer rendering, localize the experience, make follow-up primary,
   retain all existing ownership/request/cancellation rules.
3. Permit owner-entered bounded Hindi/Hinglish voice-test text through the existing
   pinned Chatterbox Hindi V3 path. Model/language/cost remain server controlled;
   English requires another artifact and realtime another transport. No GPU or
   voice call authorized from stale owner recordings. CPU deployment will need
   an accepted new runtime build; web-only deployment is insufficient.
4. Extend existing reviewed private-draft refinement to closed person language/
   register choices. Existing generic saved corrections are evidence, not an
   immediate runtime update. Person facts belong in owned knowledge/profile.
   Retry must be a fresh, explicitly sent question against the changed draft,
   never a follow-up carrying the rejected answer. Shared snapshots stay immutable.

## Real-answer benchmark being prepared

`evals/expert-answer-quality/cases.mjs`:8invented Cedar workshop probes covering
English, Hindi, Hinglish, source facts, missing information, quoted instructions
and one follow-up. Rules are narrow regression checks; human review still needed.
Fresh ignored `expert-tools/oct10-answer-quality.{py,mjs}` targets only the accepted
protected October preview, with a new labelled synthetic account. Maximum8calls,
50000microusd reservation per call,400000total, inside existingUSD1text budget;
no emails, voice/GPU, other-product changes or budget increases. Product APIs
create/use/remove test material; Neon reads verify costs and exact terminal rows.
Independent review completed. The run passed8/8specific factual probes, each read
by root; median2376ms and23186microusd total. Exact synthetic cleanup completed.
Sanitized evidence: docs/research/2026-10-10-answer-quality.json. Intent consumed;
never replay it. No voice/competitor/overall accuracy claim.
October9 canary identities/intents are not reused. Update this status from receipts.

## Commercial truth

Personal text sharing is real Azure-backed visitor chat. Optional continuity is
three exchanges/3000characters, not established durable learner memory. Room
payment code exists, but payments are not configured and personal text shares
have no payment gate. No real paid pilot/renewal/voice-likeness proof exists.
Prioritize verified usefulness and explicit correction over more feature breadth.

## Integration checkpoint

Voice and live benchmark checkpoint `c0e22210` is pushed. Application candidate
`39cc26676e479cb177082bfafd3202afaf7337da` is also pushed; it is NOT deployed.
Its source commitment is
`sha256:a947542544050055874bbca60235af317a684c300b1ed95e6bd9a11c67783a20`
(1,127 files, 29,336,643 bytes).

The long-source change now covers private rehearsal AND shared visitor chat.
It remains lexical retrieval over one source, with an 8,000-character selected
passage budget. It does not establish semantic, cross-source or corpus search.
Private pronoun follow-ups can reuse the parent's passage; public pronoun-only
questions fall back deterministically. All selected passages are bound to the
full source and exact canonical evidence. No schema migration was introduced.

Actual PostgreSQL EXPLAIN passed six parameter sets for the changed refinement
and publication statements, in a read-only transaction with no ANALYZE/writes.
The separate October 10 database gates still fail only on the same 36 external
legacy Meera pointers; other integrity, citation and dialogue checks pass.
Do not alter another product to remove that finding or call the DB globally green.

CI on candidate39cc: Android run38025692755 passed. Release run38025692817
failed on both Node22(job114135946645) and Node24(job114135946536):24/25 checks.
Only the eval-suite gate failed, in `verification-knowledge` and
`feed-meet-return-ui`: old copy/punctuation and diagnostic-visibility assertions
no longer matched the localized interface. Exact bilingual responsibility,
source-name and action checks now pass; hidden technical codes are checked as
attached rather than visible. Feed/Meet passed13/13 with exit0. Verification
passed14/14 and wrote its artifact, then its local server teardown hung and was
stopped; do not call that process exit0. Do not deploy until the new head passes
the full matrix. Both CI performance gates
passed. The separate Windows full run exceeded Studio/Hindi performance budgets;
record it as a local failure, not an application regression established by a
baseline comparison. The obsolete Windows run and only its own process tree
were stopped after these CI results; it is not a completed acceptance run.

Candidate a95589f8 release38029305864 finished24/25 on both Node versions.
Only private-text-rehearsal-ui failed: an immediate assertion read a transient
paragraph before the blocked response. The focused repair holds that response,
checks a proper in-flight generation state, waits for the exact final recovery
copy, and retains the no-auto-retry/fresh-root checks. All26mounted groups and
11response/2navigation/14cancellation controls pass. This repair needs a new
full CI run. Android38029305923 passed for a955; no cloud build/deploy occurred.

Access passes are being implemented separately in the isolated checkout
`Vyakti-platform-accesspass-oct10`, branch`codex/vyakti-access-passes-oct10`,
based on a95589f8, with migration173 reserved. It is not merged or deployed.
Current Vyakti Preview embedding runtime endpoint/key names are absent despite
an existing Azure model deployment. No env change or embedding call was made.

Candidate c9f12d24 also finished24/25 on both matrices. Node24 had one voice
test that counted its reconciliation GET before that GET arrived. Node22 had
one text retry test that snapshotted checkbox locators before refreshed readiness.
Both fixtures now deliberately hold those responses and verify before/after
states, exact request counts and explicitly enabled retries. Focused voice14/14
and text26/26 pass. These last fixes change test code only. No October10 image,
deployment, provider activation or mutation claim has occurred.

Root read the signed-in Supabase dashboard on October10 without changes:
the exact Vyakti project's redirect list already includes
`https://*.vercel.app/**`, so new Preview callback origins match. Custom SMTP
is OFF and the default sign-in email is link-only, without a numeric code.
Supabase's official SMTP documentation says default delivery is restricted to
project-team recipients. The earlier synthetic admin-created accounts bypassed
email delivery and do not prove arbitrary-account sign-in. Google is enabled;
actual human Google completion remains untested. Auth link/code copy and clear
platform-setup errors are being repaired in the isolated access-pass worktree.
Source: https://supabase.com/docs/guides/auth/auth-smtp . No Microsoft login.

## Access integration and real development proof

Access/auth feature7db6a80e is merged as03c285b0 and pushed on the canonical
branch. Its transaction-PID test fix dadde8a7 is cherry-picked asd6391a25.
The two actual concurrency races, revoke response and independent exact cleanup
passed in the dedicated development DB. Migration173 remains there; production
173 is NOT applied. Read docs/research/2026-10-10-access-pass-postgres.json.
Dev V1 rehearsal and V2 rehearsal/commit-race intents are consumed. V2 final
receipt63ddab81aaf3cba5222764f295b27794eb0fa9310d3f075d0c37776fa4379979.

The03 matrix passed24/25 on each node; only rehearsal-personal and
first-five-minutes expected a permanently visible numeric code input. Both now
perform the actual optional-code action and pass65and11assertions. Push these
test/context changes and require the next full matrix before release. Existing
operator web/canary helpers remain pinned to older candidates and must be rebound
only to the final accepted head. There has still been no October10 production
migration, CPU build/update, Vercel deployment, email or voice generation.

Next work is isolated in Vyakti-platform-authmail-oct10, branch
codex/vyakti-azure-authmail-oct10 from03c285b0, migration174 reserved. It implements
Vyakti-only Supabase admin link generation plus native Azure email, with encrypted
durable recovery and a50-message initial pilot cap. Shared Supabase SMTP/hooks
must remain unchanged. Azure Contributor/API access is available; exact new
ACS/Email names were404and providerRegistered, but resources are only PLANNED.
No key retrieval or email has happened. Root must review the finished code and
free provisioning plan before activation. Other products remain out of scope.

Final voice presentation review caught another mismatch: the permission sentence
was labelled as the spoken sample. Legacy service responses now show the actual
fixed `config.text` separately, with the unchanged permission statement correctly
labelled. Missing or invalid required voice config is rejected before rendering.
The mounted voice suite now passes14/14, with typecheck and copy checks passing.
This is a UI/API-contract fix; it is not a new model or a voice-quality result.

One additional real UI bug was fixed before the retry: a definite custom-voice
text rejection followed by exact run-not-found previously stranded the editor
in an unknown state. The editor now recovers only on that confirmed combination,
retaining the text and recording choice. Ambiguous failures still retain the
handle and block duplicate submission. The mounted voice suite passes13/13.

Ignored operator receipts/helpers use fresh OCT10 names. The eight-call answer
benchmark and six-case SQL EXPLAIN intents are consumed. No CPU build, CPU update
or new Vercel deployment has happened. Prepared ACR/CPU helpers require exact
future gate and source hashes; CPU update preserves configuration and checks
for active private voice work immediately before an image-only rollout.
