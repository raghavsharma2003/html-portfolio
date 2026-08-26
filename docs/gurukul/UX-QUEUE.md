# UX QUEUE — designed, not yet implementable

**WS-AA, 2026-08-26.** Everything in `docs/gurukul/PRODUCT-JOURNEY.md` that
this workstream designed but could not safely land, because
`src/studio/StudioApp.tsx` and `src/studio/studio.css` are being edited
concurrently by WS-W (voice preview panel: confirmed touching both, plus
`VoicePreviewPanel.tsx` and `voicePanelApi.ts`) and WS-Y (Mirror Call UI: not
yet pushed at audit time, and by `MIRROR-CALL-SPEC.md` §"Build shape" will land
a studio Call tab, i.e. both files again).

Ordered. Each item names its target files, what it replaces, and how it is
verified. **The wave after WS-W and WS-Y merge should be mechanical.**

Legend: **B*n*** = break number in `PRODUCT-JOURNEY.md`. **[taste]** = a
judgment call, not a derivation from a law or a measurement.

---

## Tier 0 — correctness. These are wrong, not merely rough.

### UX-Q-01 · The student never sees the disclosure card (BS1)
**Severity: highest in the queue.** `safety-floor-teacher.md` §1 makes proactive
clone disclosure a predicate on the output, precisely so it cannot depend on a
model remembering a prompt field. On the student surface it currently *does*:
`cloneDisclosureFact` is a `TeacherSheet` field (`teacherTypes.ts:173`), and the
only real card lives in the channel lane (`api/_clonechannel.js:101`,
`cloneDisclosureCard`). A `grep` over `src/components/` finds no session-open
disclosure UI on the student build.
**Do:** a session-open disclosure card component on the student surface, fed by
the *same shared constant* as `cloneDisclosureCard`, rendered before the first
turn of every session.
**Files:** new `src/components/CloneDisclosureCard.tsx`; `src/App.tsx` (mount
under `isGurukulStudentSurface()`); a shared constant module both `api/` and
`src/` can read.
**Verify:** an eval asserting the rendered card and `cloneDisclosureCard()` are
byte-identical, and that the card renders before turn one.

### UX-Q-02 · Every teacher is shown "Arjun Sir" (B16)
`StudioApp.tsx:668` `sheetDraft={DEMO_TEACHER}`, `:684`
`sheet={DEMO_TEACHER}`, `:693` `slug={DEMO_TEACHER.slug}`
(`demoTeacher.ts:33-34` = `teacher-demo-arjun` / `Arjun Sir`). So
`DisclosurePreview.tsx:32` renders "You're talking with an AI clone of Arjun
Sir" to a teacher named someone else, on the screen that exists to make consent
informed; and `ChannelsStudio` builds embed code against the demo slug.
**Do:** load the real sheet draft and slug for the selected replica; render an
explicit, labelled empty state when none exists yet. Never fall back to demo
data on a consent surface.
**Files:** `src/studio/StudioApp.tsx`, `src/studio/teacherSheetApi.ts`,
`src/studio/DisclosurePreview.tsx`, `src/studio/ChannelsStudio.tsx`.
**Verify:** an eval that fails if `DEMO_TEACHER` is reachable from any component
rendered on a non-demo replica.

### UX-Q-03 · Disclosure copy is duplicated across the consent boundary, ungated (B25)
`api/_clonechannel.js:95-96` states the risk in its own comment; the runtime
half is gated (`evals/clonechannel.mjs:444`), the studio half
(`DisclosurePreview.tsx:32-36`) is a re-typed copy that nothing checks.
**Do:** one exported constant, imported by both. If the module boundary forbids
it, a gate that reads both files and compares.
**Files:** `api/_clonechannel.js`, `src/studio/DisclosurePreview.tsx`,
`evals/clonechannel.mjs` or a new `evals/disclosureparity.mjs` wired into
`evals/run.mjs`.

### UX-Q-04 · Hardcoded status literals (B8, B11)
`StudioApp.tsx:629-633` renders a literal `0` / "No model trained" regardless of
the real `runtime.versions.voice_genome` (which `RuntimeGate.tsx:103` already
has). `QuickStartPath.tsx:140` hardcodes `className="quickstart-step next"` on
step 3, so the checklist structurally cannot reach 3/3.
**Do:** derive both from data. Step 3 becomes `done` when a sheet draft
persists, which depends on UX-Q-06.
**Files:** `src/studio/StudioApp.tsx`, `src/studio/QuickStartPath.tsx`.
**Verify:** extend the design-system rule "no literal in a status position" into
a lint over `src/studio/` (see UX-Q-16).

### UX-Q-05 · Identity and liveness are filed under "Advanced" (B15)
`StudioApp.tsx:708-728`, summary at `:224`. These are mandatory gates that
`RuntimeGate` refuses activation without and `QuickStartPath` lists as "waiting
on you". Progressive disclosure applied to the wrong axis: collapse what is
*optional*, never what is *required-but-later*.
**Files:** `src/studio/StudioApp.tsx`.

### UX-Q-06 · The sheet review does not persist, and says so too late (B17, B18)
`TeacherSheetStudio.tsx:148` reports "Kept locally" *after* the teacher has
filled the panel in. `QuickStartPath` step 3 sends them there to "Confirm".
**Do:** connect the sheet service; until it is connected, announce the honest
state at panel-open, not at save.
**Files:** `src/studio/TeacherSheetStudio.tsx`, `src/studio/teacherSheetApi.ts`.

## Tier 1 — the journey. The reordering that makes it one product.

### UX-Q-07 · The persistent step rail, and phase-scoped numbering (B24, B28, B12)
Replace the fourteen-panel vertical scroll with the two-column shell in
`PRODUCT-JOURNEY.md` §3.2. `QuickStartPath` is absorbed into the rail rather
than stacked above the panel it summarises. Phase-scoped numbering permanently
kills the `04`/`04` collision between `ProcessingReview.tsx:117` and
`ModelConsentGate.tsx:74`, the unnumbered `IdentityProofing` /
`LivenessCapture`, and the two prefixes ("Gate 04" vs "05 ·") in use for one
concept.
**Rail status comes only from `/api/replica-runtime` blockers plus real consent
and source state, using the four `--state-*` tokens. One ember at a time.**
**Files:** `src/studio/StudioApp.tsx`, `src/studio/studio.css`,
`src/studio/QuickStartPath.tsx`, and the eyebrow line of every numbered panel.

### UX-Q-08 · Hear yourself before you hand over your ID (B19, B10)
Move `VoicePreviewLab` from inside `AdvancedSurface` (`StudioApp.tsx:745`) into
phase 3, ahead of identity proofing. Costs nothing in safety: the preview is
already "private... cannot join calls or activate a replica"
(`VoicePreviewLab.tsx:242`), `RuntimeGate` still refuses without identity, and
capture/transcription/storage consent is already separate from biometric
consent.
**Files:** `src/studio/StudioApp.tsx`.

### UX-Q-09 · Give the anchorless panels anchors (B20)
`VoicePreviewLab`, `ReplicaDialogueLab`, `CandidateEvaluationLab`,
`ChannelsStudio` and `IngestChannelStudio` have no `id`, so nothing can link a
teacher to them; every other panel does and every one of those resolves from
`QuickStartPath.BLOCKER_META`.
**Files:** the five components; `src/studio/QuickStartPath.tsx`.

### UX-Q-10 · Retire the permanently-locked "08 Embodiment laboratory" (B24)
`StudioApp.tsx:162-170`. A never-shipping visual-modelling teaser inside a
teacher's launch path, telling them something is missing that is not missing.
**Files:** `src/studio/StudioApp.tsx`.

### UX-Q-11 · Collect the subject at creation (B6)
The one field that changes what every later screen should say is collected nine
screens later, in a panel that does not save.
**Files:** `src/studio/StudioApp.tsx` (`CreateReplicaCard`),
`src/studio/replicaApi.ts`.

### UX-Q-12 · Vyakti previews serve Meera's landing (Step 0)
`scripts/vercel-build.sh:50` selects studio-root on `STUDIO_ROOT=1` or
`VERCEL_GIT_COMMIT_REF = claude/gurukul-platform` only, so a `gurukul-ws-*`
preview serves `site/index.html`, a *different product*. Deliberately not
changed by WS-AA: `context/STATE.md` open item 1 is already a deploy problem and
a deploy trigger is not a thing to widen unilaterally. Widening the case to
`claude/gurukul-platform|gurukul-ws-*` cannot touch Meera (different branch) and
respects `gurukul-no-production-glob`, which forbids matching *another
product's* trigger.
**Files:** `scripts/vercel-build.sh`. **Owner sign-off recommended.**

### UX-Q-13 · Belt-and-braces for the OAuth mode drop (B1)
WS-AA fixed this client-side (`studioAuth.ts` `restoreStudioMode()`), which
needs nothing outside the repo. Additionally carrying `?mode=teacher` on the
OAuth redirect would make the URL self-describing during the round trip, but
only works if the value survives the Supabase redirect allow list.
**Do:** add `/studio?mode=teacher` (or a `**` pattern) to the Supabase project's
redirect allow list, *then* carry the filtered query in `googleSignIn()`.
**Files:** Supabase dashboard, then `src/studio/studioAuth.ts`.

## Tier 2 — waits, errors and copy.

### UX-Q-14 · Every wait state, per `PRODUCT-JOURNEY.md` §3.3 (B21)
Cold start is 161-176s with a 504 at 242s, and the HMAC skew window is 60s, so
the request that *wakes* a service returns **401** (`context/STATE.md`,
`hmac-skew-shorter-than-cold-start`). A teacher must never see "unauthorized"
for a latency problem. Warm `/healthz` first; during a known warm-up window a
401 renders as "still starting up" and retries. Elapsed timer counting up,
never a fake bar; copy changes at 240s *before* the 504 lands.
**Files:** `src/studio/VoicePreviewLab.tsx`,
`src/studio/voicePreviewApi.ts`, `src/studio/replicaApi.ts`, and WS-W's
`voicePanelApi.ts` once merged. **Coordinate with WS-W.**

### UX-Q-15 · One error path (B3, B27)
`errorCopy.ts` is excellent and is used by two of eight panels. `AuthGate`
(`StudioApp.tsx:250, 264`), `EnrollmentWorkspace` (`:245, 259, 308, 344, 364,
390`), `VoicePreviewLab` and `TeacherSheetStudio` each roll their own
`cause instanceof Error ? cause.message : "..."`, so the same failure renders as
designed copy in one panel and a raw server code in the panel below it.
**Do:** `friendlyError` becomes the only path to a user-visible error string;
add `retryLabel` and an owner ("you" / "platform") field.
**Files:** `src/studio/errorCopy.ts` and every panel above.

### UX-Q-16 · Extend the lints to `src/studio/` (B26)
`scripts/check-copy.mjs` bans em-dashes in UI copy and scans `src/components/`
and `site/*.html` only. `src/studio/` carries **73** in user-visible strings
(measured by applying the gate's own algorithm to that directory), so the one
typographic rule this repo wrote down is binding on Meera and optional for
Vyakti. Roughly six of the 73 are the `"—"` empty-value placeholder
(`PersonModelStudio.tsx:159`, `RuntimeGate.tsx:101-103`) and take
`// emdash-ok:`; the rest are prose.
**Do:** add `src/studio/` to `check-copy.mjs`'s scan and fix the copy in the
same change. Add the "no literal in a status position" lint from UX-Q-04.
**Files:** `scripts/check-copy.mjs`, all of `src/studio/`.

### UX-Q-17 · The copy audit
Full findings table below. Implement alongside UX-Q-16 so the studio's voice
changes once, not twice.

### UX-Q-18 · Wire the studio to the tokens (design system §3)
`src/studio/design/tokens.css` ships the scale; nothing consumes it yet, which
is deliberate (adding a token changes nothing on screen, which is what made it
safe to land mid-flight). Migration is one component at a time, with eyes on it:
type first (the 9px and 10px consent captions are below the readable floor),
then the 34-38px controls that violate the 44px touch target
(`.review-refresh`, `.artifact-actions button`, `.review-controls select`), then
the focus ring (currently ~1.9:1 against paper, under WCAG 2.2's 3:1).
**Files:** `src/studio/studio.css`, one section per commit.

## Tier 3 — the student surface.

### UX-Q-19 · Three tabs, not two buttons (BS2)
`App.tsx:1532-1541`'s `.gurukul-nav` is honestly labelled a seam in its own
comment. `student-app-spec.md` §5 specifies Chat / Practice / Mastery with Call
reachable from inside Chat.
**Files:** `src/App.tsx`, new nav component, `src/styles/`.

### UX-Q-20 · The Teacher Profile surface (BS3, BS4)
`student-app-spec.md` §5 names it as "where 'who am I talking to' lives". Should
carry: the real teacher, what the clone was built from, when it last updated,
the fidelity number **with its ceiling**, and how to reach a human.
**Files:** new `src/components/TeacherProfile.tsx`, `src/App.tsx`.

---

## The copy audit

Every user-facing string that needs to change, with a replacement. Tone target
per `DESIGN-SYSTEM.md` §4.6: say what is true then what to do, name whose turn
it is, never invent a cause, no em-dashes, short sentences a bilingual reader
does not have to unpack.

| # | File:line | Today | Proposed | Why |
|---|---|---|---|---|
| C1 | `StudioApp.tsx:299` | "Use the same account as Meera. Your existing session is recognized automatically." | "Sign in with the email you want to manage this clone from. If you are already signed in on this device, we will recognise you." | Names a deprioritized consumer product a JEE teacher has never heard of. An implementation detail as user copy, on the highest-stakes screen. |
| C2 | `StudioApp.tsx:350` | "I already have a code" | Remove the button. Replace with a resend control that states the limit: "Send another code" / "You can request a new code in 0:42. Codes are limited to about two an hour." | Today it jumps to the code step without sending one, so a person waits for a code that is not coming. The rate cap (`STATE.md`) is the fact that most needs to be on this screen and is on none of it. |
| C3 | `StudioApp.tsx:250` | `cause.message.replaceAll("_", " ")` | `friendlyError(cause, "Could not send a sign-in code")` | Raw server codes with underscores swapped for spaces, on the screen where a stranger decides whether we are competent. |
| C4 | `StudioApp.tsx:134` | "Teaching clone created. Enrollment remains locked until verification services are ready." | "Your workspace is ready. Add one recording next, and you can hear a private draft voice before any verification is needed." | 60% of the first success message is about what does not work. Truth is non-negotiable; the proportion is a choice. **[taste]** |
| C5 | `StudioApp.tsx:636-637` | "Public access / Off / Cannot be changed" | "Public voice library / Never / Your voice is never listed or shared" | False as written: `ChannelsStudio` exists to change public access. The intended (better) claim is the no-library one. |
| C6 | `StudioApp.tsx:631-632` | "0 / No model trained" | Derived value, or "Not built yet" when genuinely zero | A hardcoded literal that is wrong for any teacher who has built a voice. See UX-Q-04. |
| C7 | `StudioApp.tsx:224` | "Identity, liveness, provider consent, voice training, and launch — open this to work through them directly." | Delete the wrapper; these are required steps, not advanced ones (UX-Q-05). | Filing the mandatory path under "Advanced" teaches teachers that required steps are optional. |
| C8 | `StudioApp.tsx:288-290` | "Self-replication only / No public voice library / Auditable deletion" | Keep the three claims, add the mechanism to each: "Self-cloning only, enforced by a live identity match" / "No public voice library, ever" / "Deletion you can watch complete" | Three load-bearing claims with no evidence, in a product whose thesis is that it shows its work. **[taste]** |
| C9 | `QuickStartPath.tsx:166` | "Locked until — honestly, not a wall" | "What is still locked, and who it is waiting on" | The em-dash aside undercuts the strongest feature in the studio by sounding defensive about it. |
| C10 | `QuickStartPath.tsx:105` | "Get to a reviewable draft first — the rest stays exactly as strict" | "Get to something you can review, without skipping anything" | Same. Also drops an em-dash. |
| C11 | `QuickStartPath.tsx:37-38` | "Voice synthesis infrastructure is still being connected — not something you can unblock yet." | "We are still connecting the voice service. Nothing you can do here, and we will move this to done when it clears." | "Infrastructure is still being connected" is passive and vague; the second half is exactly right and should lead. |
| C12 | `EnrollmentWorkspace.tsx:410` | "Permission before evidence" | "Permission first, then anything you upload" | Reads as a slogan. The panel is a legal act. |
| C13 | `EnrollmentWorkspace.tsx:575` | "Please keep this page open" | Phase-specific with an expectation: "Hashing in your browser, a few seconds" / "Uploading, {n}%" / "Verifying with storage, usually under a minute" | Three of four phases show one generic line and no time expectation. |
| C14 | `EnrollmentWorkspace.tsx:520` | Government ID is the first option in the source-type menu | Move to last, or remove entirely and route identity through `IdentityProofing` | The first item on the "add your teaching" step is a demand for a government ID, and identity has its own panel. Two doors to one legal act. |
| C15 | `EnrollmentWorkspace.tsx:308, 344, 364, 390` | `cause.message` | `friendlyError(...)` | See UX-Q-15. |
| C16 | `TeacherSheetStudio.tsx:148` | "Kept locally — the sheet service isn't connected yet." | Move the state to panel-open: "Not connected yet. Anything you enter here stays in this browser and is not saved to your account." | Honest, but announced after twenty minutes of input rather than before. |
| C17 | `TeacherSheetStudio.tsx:311, 321` | "Drafted from your uploads" | "Drafted from your uploads" only when it was; otherwise "Example values, replaced when your first upload is processed" | Currently shown over `DEMO_TEACHER` data (B16). The label makes a false provenance claim. |
| C18 | `VoicePreviewLab.tsx:271-272` | "Protecting your preview" / "The scale-to-zero voice lab may take a few minutes on its first run." | "Generating" plus the designed cold-start wait (UX-Q-14) with an elapsed counter | "Protecting your preview" describes our watermarking, not the teacher's wait. A 176s wait needs a timer, not a sentence. |
| C19 | `VoicePreviewLab.tsx:292` | "Select a processed voice candidate, accept its evidence, and build a draft VoiceGenome." | "You need a processed recording first. Add one under Sources, and we will build a draft voice from it." | Three internal nouns in one sentence, on an empty state whose job is to tell a stranger what to do. |
| C20 | `ModelConsentGate.tsx:74` | "Verified permission · Gate 04" / "Choose what your verified identity may become" | "Permission to build the model" / "This is the consent that lets your clone exist" | The heading is abstract for the single most consequential consent in the product, and the number collides with `ProcessingReview`'s. |
| C21 | `ProcessingReview.tsx:120` | "Owner review boundary" / "Inspect processing, then decide" | "Your review" / "See what we extracted, then approve it" | "Owner review boundary" is an architecture term. |
| C22 | `RuntimeGate.tsx:79` | "One qualified identity, frozen at launch." | "What has to pass before your clone can talk to anyone" | Poetic where the teacher needs a checklist. |
| C23 | `ReplicaDialogueLab.tsx:105` | "Meet the model, not a generic chatbot." | "Talk to your clone privately" | Comparative marketing inside the product, to a user already sold. |
| C24 | `CalibrationStudio.tsx:130` | "Teach the differences a prompt cannot hold." | "Show it how you'd actually answer" | Explains our architecture rather than the teacher's task. |
| C25 | `PersonModelStudio.tsx:153` | "Not a persona prompt. A model you can inspect." | "Everything we think we learned about you, one claim at a time" | Same: defines by contrast with an implementation the teacher does not know about. |
| C26 | `CandidateEvaluationLab.tsx:96` | "Teach the model without knowing which model spoke." | "Pick the closer voice, without being told which is which" | Same meaning, no internal nouns. |
| C27 | `ChannelsStudio.tsx:209` | "Where your clone can be reached" | Keep. Add a leading honest-state line: nothing in this lane is live (migration 055 unapplied, widget secret unset, `CHANNEL_SECRET_BACKEND=none` refuses). | The heading is good; the panel does not lead with the fact that none of it works yet. |
| C28 | `IdentityProofing.tsx:121, 137`, `LivenessCapture.tsx:394` | "Bind one real person to this replica" / "No name, date of birth, document number, address, portrait, or OCR transcript is written to the replica database" / "Prove this recording was made now" | **Keep verbatim.** | The best copy in the product and the standard the rest should be rewritten toward. Surface `:137` *before* the upload, not after. |
| C29 | `session.ts:4` | `STATE_KEY = "meera.state.v1"` | `"vyakti.studio.state.v1"`, with a one-time migration read of the old key | Not user-visible, but it is the same category of error as C1 and will become visible the first time both products share an origin. |
| C30 | All of `src/studio/` | 73 em-dashes in UI copy | Comma, colon or full stop; `// emdash-ok:` on the ~6 that are the `"—"` empty-value placeholder | `docs/DESIGN-STANDARDS.md`'s ban, currently unenforced on this half of the repo (UX-Q-16). |
## WS-AB — the Context step ("bring your context"), MOUNTED

Filed here as a queue item and then resolved in the same pass, because the
condition that would have made it a queue item stopped holding: WS-Y and WS-AA
both merged into `claude/gurukul-platform` while this workstream was building,
so `StudioApp.tsx` had exactly one owner again and the insertion was
mechanical — which is what this file's own header predicted ("the wave after
WS-W and WS-Y merge should be mechanical").

`<ContextLockerPanel>` is mounted in the DEFAULT path in both modes, directly
after `EnrollmentWorkspace`, on MirrorCallStudio's precedent: it is not a
verification step. Gating it on `mode === "teacher"` would re-narrow the
platform that `horizontal-platform-reweight` just widened — a teacher's
lectures are one kind of context and everyone else's files are the rest.

`onProposals?: (count: number) => void` is an optional fifth prop, currently
unwired. Wire it to whatever nudges the owner toward the sheet-review surface;
the panel deliberately does not navigate on its own, because a screen that jumps
while a nine-file batch is still uploading throws away the rest of the batch's
answers.

Backing: `/api/context-items`, `api/_context-locker.js`, migration 058,
`evals/contextlocker.mjs` (77 checks). Matrix:
`docs/gurukul/context-locker.md`.

---

# WS-AG — queued for the two files this workstream may not touch

**WS-AG, 2026-08-26.** `scripts/check-copy.mjs` is now the mechanical copy gate
for DESIGN-LAW §1 and it scans `src/studio/`, `src/gurukul/`, `src/replica/` and
`site/`. It found 120 violations; 117 are fixed on `gurukul-ws-ag`. The three
below are in `src/studio/StudioApp.tsx`, which WS-AE owns this window.

They are **waived, not muted**: the gate prints them in full on every run and
exits 0, and it FAILS THE BUILD the moment the file comes back clean, telling
whoever fixed it to delete the waiver entry. Fix these, delete the `WAIVED` map
entry in `scripts/check-copy.mjs`, and the gate is fully closed.

Replacement strings are ready to paste. Each turns one em-dash into a full stop
or a comma without changing a claim.

### UX-Q-AG-01 · Three em-dashes in `StudioApp.tsx` (DESIGN-LAW §1)
**Owner: WS-AE.** Verify with `node scripts/check-copy.mjs`.

`StudioApp.tsx:126` — `introTitle`
```
- "A teaching clone that begins with your permission — and is disclosed to every student."
+ "A teaching clone that begins with your permission, and is disclosed to every student."
```

`StudioApp.tsx:128` — the intro body
```
- ...and students are told plainly — before every session — that they are talking to an AI clone, not you.
+ ...and students are told plainly, before every session, that they are talking to an AI clone, not you.
```

`StudioApp.tsx:227` — the launch-rail summary
```
- <span>Identity, liveness, provider consent, voice training, and launch — open this to work through them directly.</span>
+ <span>Identity, liveness, provider consent, voice training, and launch. Open this to work through them directly.</span>
```

### UX-Q-AG-02 · `--ink-faint` fails WCAG AA and is used for body-size text
**Owner: whoever holds `src/studio/studio.css`.** MEASURED, not judged:
`--ink-faint` is `#7a7e74`, which is **3.67:1 on `--paper`** and **4.11:1 on
`--panel`**, against AA's 4.5:1 for text under 18px. `studio.css` uses it for
captions, metadata and help text at 11px to 13px, and `site/vyakti.html` used it
for 12.5px body copy until this pass.

**Do:** `--ink-faint: #676b62` in `studio.css`'s `@layer tokens` block. That is
**4.82:1 on paper and 5.39:1 on panel**, clears AA at every size the studio uses
it at, and is a hue-preserving darkening (same warm neutral, one step down), so
nothing else in the palette has to move. `site/vyakti.html` already ships the
new value; `tokens.css` cannot fix it because studio.css declares the same name
later in the same cascade layer and wins by source order, which is exactly the
ordering `tokens.css`'s own header describes.

**Verify:** the numbers above are reproducible from the WCAG 2.x relative
luminance formula on the two ground colours in `DESIGN-SYSTEM.md` §4.1.

### UX-Q-AG-03 · Numbered eyebrows removed outside StudioApp, may exist inside
DESIGN-LAW §1 bans the `06 · how it works` eyebrow shape. WS-AG removed five
(`CalibrationStudio`, `PersonModelStudio`, `ReplicaDialogueLab`, `RuntimeGate`,
and the two `voice-step` spans in `VoiceEnrollmentLab`, which became "Step one"
and "Step two" because the ORDER there is real and only the decoration was
not). If WS-AE or WS-AF adds one, `check-copy.mjs`'s `section-number` rule
fails the build and names the line. There is nothing to do here unless a new one
appears; this entry exists so the rule is not mistaken for a style preference.

### UX-Q-AG-04 · Thirteen em-dashes in `VideoEnrollPanel.tsx` (DESIGN-LAW §1)
**Owner: WS-AF.** This component landed after `check-copy.mjs` was widened, so
it is waived on the same self-expiring terms as UX-Q-AG-01: printed every run,
not failing the build, and the gate FAILS once the file is clean so the waiver
cannot outlive its reason. Delete the `WAIVED` entry with the last fix.

Line numbers will drift; the left-hand strings are the stable identifiers.

```
- "This is my channel — I own or control it."
+ "This is my channel. I own or control it."

- "YouTube would not serve our server — it asked it to sign in and prove it is not a bot.
+ "YouTube would not serve our server. It asked it to sign in and prove it is not a bot.

- "...This is ours to fix — it needs a version bump...
+ "...This is ours to fix, and it needs a version bump...

- "Too many requests in a row — wait a moment and try again."
+ "Too many requests in a row. Wait a moment and try again."

- Paste a link to one of your own videos — a lecture, a talk, anything
+ Paste a link to one of your own videos: a lecture, a talk, anything

- "Working — this takes a few minutes…"
+ "Working. This takes a few minutes."          (also drops the ellipsis glyph)

- Scored by {window.score_source} — a signal-quality measure of the
+ Scored by {window.score_source}, a signal-quality measure of the

- <p>We also transcribed the whole lecture — {...} cha
+ <p>We also transcribed the whole lecture: {...} cha
```

Three are the EN-dash in a numeric range and one is the empty-value glyph, which
need a decision rather than a swap:

```
- {clock(window.start_ms)}–{clock(window.end_ms)}          (x2, and in candidates)
+ {clock(window.start_ms)} to {clock(window.end_ms)}

- if (ms == null || !Number.isFinite(ms)) return "—";
+ if (ms == null || !Number.isFinite(ms)) return "not yet";
```

On the last one: WS-AG made the same call in five places (`RuntimeGate`,
`CalibrationStudio`, `PersonModelStudio`, `MirrorCallStudio` twice) rather than
taking the `emdash-ok:` exemption the old queue entry C30 suggested. A dash in a
value slot is not punctuation, it is a word the product declined to choose, and
"not yet" or "none yet" says the true thing instead. Use whichever of the two
fits the slot.

Two more lines in that file carry a `·` each, which is within the one-per-line
rule and needs no change.
