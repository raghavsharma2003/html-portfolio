# Restored source attribution, 2026-09-07

Isolate: `scratchpad/context-restored-attribution`, branch
`codex/context-restored-attribution`, base checkpoint21
`c56cadfe72a20ee02781485752d8d67fcfc6fb21`. Integration and the frozen combined
private rehearsal candidate remain untouched.

## Product change

The existing ContextLockerPanel only showed its ownership button in recent
upload results. Reloading removed that client-only array, leaving saved
unknown-authorship writing with no action even though the remine endpoint
already supported stored text.

Both recent and restored eligible rows now use the same explicit **My writing**
and **Reference only** controls. The existing authenticated API client sends
`POST /api/context-items` with only `{op:"remine", replica_id, item_id,
authorship:"mine"|"not_mine"}`. A successful response must carry the exact
item handle, and the list is then loaded from the server. No raw text,
additional grant, speaker declaration or persona application is sent.

Controls are limited to extracted, nonempty file rows with `own_context` and
format text, markdown, pdf or docx. Received, mined, refused, routed, image,
chat, linked and empty rows do not gain an action. This restores the missing
pre-mining authorship choice; it does not implement a general retraction UI
for already-mined proposals. Current choice is represented with pressed and
disabled states; reference-only material is not silently claimed as mine.

The real panel gets a new local instance when token or replica changes, with
no token embedded in the React key. Mounted/generation guards ignore stale
loads and callbacks. A synchronous pending guard prevents duplicate remine
actions. Existing upload/remove continuations also check the mounted scope.
Refreshing an existing list keeps its rows mounted while controls are busy.
Already-dispatched work is not represented as cancelled on the server.

The UI keeps the incumbent components, CSS, fonts and palette. Impeccable
harden/craft-floor and React async-state guidance were applied. No visual
restyling or new animation was added.

## Actual verification and limits

Node24.13.0, 2026-09-07:

* Forced TypeScript build passed.
* `node evals/context-attribution/run.mjs`: 24 mounted groups passed, 12 each
  at390 and1440. The harness builds the actual component and real API wrapper
  in memory, serves actual HTTP requests on loopback port0, and supplies
  synthetic API responses. It covers reload without implicit POST, Enter and
  Space activation, exact token/replica/item request, refreshed authorship,
  reference-only choice, duplicate suppression, replica change, unmount,
  delayed old-token GET, failed POST, wrong-item response, supported and
  unsupported formats and horizontal overflow. No page errors.
* An actual checkpoint21 component is built alongside the candidate and
  reproduces the missing restored-row action. This is the negative control.
* Existing `evals/contextlocker.mjs`: 93 passed with an in-memory all-empty
  config module and `globalThis.fetch` throwing. Actual backend extraction,
  remine and canonical evidence code runs against the suite's existing fake
  database. No physical config or secrets were copied.
* `git diff --check` and focused source syntax checks passed.

These checks confirm refreshed authorship and the real client request path.
They do not prove SQL authorization, actual rehearsal readiness or answer
quality. Rehearsal eligibility continues to require its independent server
readiness checks and consent. No DB/model/provider, upload identity, voice,
activation or publication operation was performed by this agent.

The mounted host is an isolated component using actual Studio CSS, not a
complete signed-in Studio shell acceptance. Its existing links-field layout
is outside this narrow attribution change. The new controls were inspected
in the retained phone and desktop screenshots; no full-shell design claim.

## Retained evidence and rejection

`scratchpad/context-attribution/1788791872939/failure.json` retains the first
run: nine phone groups passed, then the fixture waited for two development
StrictMode effect requests in a production build. The expectation was wrong;
the fixture now waits for an actual held request, independent of duplicate
effect execution. No product code changed to satisfy that failed condition.

The confirmation batch is
`scratchpad/context-attribution/1788791933608/result.json`, with four
screenshots named `390-choice.png`, `390-reference.png`, `1440-choice.png`,
and `1440-reference.png`. The direct backend-suite invocation and first
DB-only loader attempt failed on the missing ignored config; both logs are
retained. The empty module loader fixed the offline test environment.

Reject reupload as the only recovery: the old mounted component demonstrably
has no restored-row action while the existing backend can remine stored
canonical text. Reject automatic attribution on reload: every mounted load
asserts zero remine calls until an explicit choice.

Reverse this approach only if the backend removes remine or introduces a
different explicit attribution receipt; retain stored-text reuse, exact scope,
no implicit rights grant and stale-response controls in any replacement.

Root can register `context-attribution-ui` as `context-attribution/run.mjs`.
It uses port0, an in-memory build and timestamped artifacts, with no shared
dist writer. No integration registry or full release was changed here.
