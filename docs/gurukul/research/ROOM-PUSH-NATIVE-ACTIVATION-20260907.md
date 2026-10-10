# Room push activation handoff, 2026-09-07

Frozen separate file: `scratchpad/expert-capture-lifetime/evals/room-push/run.mjs`.
SHA-256: `5d37c84ea07a3aa03748591196666865677ede867edc0376bbe29d13275a779b`. All13 previously frozen capture files still match their manifest. No public worker, API, integration or dist bytes edited. Parent owns full-suite integration check.

## Exact cause and reversal

Root's first state-poll repair still produced78 pass/5 fail in `scratchpad/expert-integration/scratchpad/room-push-twenty-repair.log`: page notification control reported no active registration, then first checkin was absent; renewal/dormancy worked later. Our native/CDP diagnostic reproduced precisely those five browser failures on the same prebuilt integration dist,25 pass/5fail in browser-only sections8+9.

At13:35:53.000Z immediately after the supposedly activated wait returned, the real root worker had active:null/installing:'installing'/controller:null. At13:35:53.044Z the control still saw that state. CDP independently reported installing. After the first push, by13:35:53.373Z the worker was activated, explaining why later kinds worked. This is actual retained native state, not inferred browser incompatibility or host load.

Installed Playwright's `node_modules/playwright-core/lib/coreBundle.js:23886` evaluates `const success = predicate(); if(success) fulfill(success)`. A returned Promise is truthy, so `waitForFunction(() => getRegistration(...).then(...))` stops polling and returns even when the promised Boolean is false. The exact async-false negative control in the repaired suite demonstrates this behavior. Reversal condition: a new wait mechanism is acceptable only if it cannot resolve until the exact script/scope's active worker is activated, with failures and deadline surfaced. Never restore swallowed state-wait errors or increase arbitrary sleeps.

## Repair

Use page.evaluate to await a real activation event promise on the registration's actual installing/waiting/active worker. Verify exact scope and script URL, reject missing/mismatched worker, reject redundant installation, bound activation to15s, remove the statechange listener and clear deadline on success/failure. Both real and old-guard worker registrations use this function. Native state must be activated before showing control notification or dispatching a push.

The existing300ms post-push observation remains unchanged. Optional ROOM_PUSH_DIAGNOSTICS captures timestamped native/controller and CDP registration/version state plus source/build identities. ROOM_PUSH_DIST allows this isolated fixture to serve a prebuilt integration dist read-only. ROOM_PUSH_BROWSER_ONLY=1 clearly labels diagnostic output and avoids loading private API config when only browser sections8+9 are intended; normal invocation retains all API/crypto sections.

## Measured checks and retained failures

- First isolated launch could not import absent api/_config.js; a preliminary edit command also used the wrong text decoding. Error log retained as room-push-native-first-diagnostic-20260907.log. No credentials were copied or read.
- Root's actual first state-only repair and our25/5 diagnostic failure remain retained. Our trace/log: `room-push-native-second-diagnostic-20260907.json` / `.log` in this report's directory.
- Repaired browser-only run:33/33 checks, including deterministic async-false polling control, real and broken actual activation checks, page notification capability control, first checkin title/body/url, renewal/dormancy, unknown-kind rejection, exact old renewal guard negative control, and actual built dynamic imports. Artifacts `room-push-native-fixed-20260907.json` / `.log`.
- `node --check evals/room-push/run.mjs` and scoped git diff --check passed. No full release or full83+ API suite ran in isolate; root will run the normal invocation. No network delivery/provider/real subscriber notifications were performed; native notifications were confined to the synthetic localhost browser context and closed with it.
- Final trace browser version: 151.0.7922.34.

Exact source/build hashes from actual passing browser trace:
- `C:\Users\raghav.s\Desktop\build\Vyakti-platform\scratchpad\expert-capture-lifetime\evals\room-push\run.mjs`: `5d37c84ea07a3aa03748591196666865677ede867edc0376bbe29d13275a779b`
- `C:\Users\raghav.s\Desktop\build\Vyakti-platform\scratchpad\expert-integration\dist\room-sw.js`: `da7f3ef02298aa2127af7952ad8a4e360bccae773b491b86bad92ada14a62bbb`
- `C:\Users\raghav.s\Desktop\build\Vyakti-platform\scratchpad\expert-integration\dist\room.html`: `4754c9da345840d09bb5ed3e6f3b7d75984037a03f5cd9e66b86d68d7b2a93d6`

## Final portability review correction

The async-false negative control now accepts only the actual false JSHandle result OR an instance of Playwright's exported TimeoutError. It labels which path occurred and propagates every other error. Neither path grants worker readiness. The retained native33/33 run observed the false-handle path on the installed implementation; the final portability branch was syntax-checked but not browser-rerun, per root direction.

ROOM_PUSH_DIST is now honored only when ROOM_PUSH_BROWSER_ONLY=1. Default release invocation always reads its own local dist, even when ROOM_PUSH_DIST happens to exist. The15s activation deadline and300ms post-push observation are unchanged.

Final frozen runner SHA-256: `69038501ddd09d98953376807e3ab6d7ddf2a453f5a3bfdfafbdf4af1278071a`. This supersedes the earlier runner hash above; root will run the default complete suite after copying.
