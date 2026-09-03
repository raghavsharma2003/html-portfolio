# PRODUCT JOURNEY — the whole path, audited and then designed

**WS-AA, 2026-08-26.** Owner directive this document exists to serve:
`context/decisions.md#owner-intent-is-the-spec` — UI/UX/product flow must be
"amazing and very well thought out", no compromises, and *"an unpolished-but-
working flow is now a defect, not a milestone."*

Nobody has owned the JOURNEY. The studio is the union of ten parallel
workstreams, each of which built a good component and placed it where the
component made sense. This document walks the path as it actually exists,
brutally, then designs the path it should be.

**Scope note, stated up front so nothing here implies coverage it does not
have:** this is a source audit and a design, not user research. Not one teacher
has used this product. Every defect below is derived from the code, the specs,
or a law already written down in `context/`; every judgment beyond that is
marked **[taste]**. Nothing here is presented as a finding about real users,
because there are none.

---

## Part 1 — The teacher journey as it is

### Step 0. Landing

**Before this branch:** there was none. `scripts/vercel-build.sh:53` wrote a
one-line meta refresh into `/studio?mode=teacher` as `dist/index.html`.

The consequences were larger than "no marketing page":

- A teacher's first impression of a product that wants their **government ID
  and a video of their face** was a page that appeared for one frame and
  vanished. Nothing explained who we are, what happens to the ID, or why the
  clone can only be of them.
- `studio.html:7` titles the tab **"Replica Studio | Vyakti"** and
  `studio.html:6` sets `robots: noindex, nofollow`. So the entire product was
  unindexable, and a stranger's browser tab said the wrong product's name.
- `site/index.html` on this branch is still **Maya's** landing (a Hinglish AI
  companion), and it is what a non-`claude/gurukul-platform` preview deploy
  serves at `/` — so any `gurukul-ws-*` preview shows a *different product
  entirely* at its root. (`scripts/vercel-build.sh:50`.)

**Fixed in this workstream.** `site/vyakti.html` is a real landing; the build
copies it instead of writing the redirect. The preview-branch condition is
deliberately left alone and queued (UX-Q-12): a deploy trigger is not a thing to
widen unilaterally while `context/STATE.md` open item 1 is a deploy problem.

### Step 1. Sign in — `StudioApp.tsx:231-399`, `studioAuth.ts`

What the teacher sees: a genuinely handsome split page. Left, an honesty pitch
and a three-item trust strip. Right, a card with Google, then email OTP.

**BREAK 1 (worst in the audit, and it was silent). Google sign-in changed the
product underneath the user.** `studioAuth.ts:53` sent the OAuth provider to a
bare `window.location.origin + "/studio"`. `StudioApp.readStudioMode()`
(`StudioApp.tsx:80-86`) reads `?mode=teacher` **once, at mount, and never
again**, and that one parameter decides whether the person is in the Gurukul
teacher studio or the generic self-replica lab: brand tag, intro copy,
`QuickStartPath`, `TeacherSheetStudio`, `IngestChannelStudio`,
`DisclosurePreview` and `ChannelsStudio` are all behind `mode === "teacher"`
(`StudioApp.tsx:641, 663-697`).

So: teacher lands on `/` → redirected to `/studio?mode=teacher` → reads the
teacher pitch → clicks the fastest, most-used button on the page → comes back
to **a different product**, with different copy, none of the teacher steps, and
the entire advanced surface uncollapsed. No error. Nothing on screen to explain
where the page went. Email OTP was unaffected *because it never leaves the
page*, which means the defect selected precisely for the users who took the
quick path.

The same bug had a second mouth: a teacher who bookmarks the page they actually
work in bookmarks `/studio`, and loses teacher mode on every future visit.

**Fixed in this workstream** (`studioAuth.ts` `restoreStudioMode()`, called from
`main.tsx` before render). Deliberately *not* fixed by adding the query to the
OAuth redirect: that only works if the value survives the Supabase redirect
allow list, which is configured outside this repo, and a fix whose correctness
lives in someone else's dashboard is not a fix. Belt-and-braces version is
UX-Q-02.

**BREAK 2. The sign-in card talks about the wrong product.**
`StudioApp.tsx:299`: *"Use the same account as Meera. Your existing session is
recognized automatically."* Meera is a deprioritized consumer companion app
(`SPEC-GURUKUL.md` §8.4). A JEE teacher has never heard of it. This is an
internal implementation detail (shared Supabase project) printed as user copy,
on the highest-stakes screen in the product.

Related, same cause: `session.ts:4` stores the Vyakti session under
`STATE_KEY = "meera.state.v1"`.

**BREAK 3. `AuthGate` computes `canRetry` and throws it away.** `errorCopy.ts`
carefully classifies every failure and returns `{headline, detail, canRetry}` —
but `AuthGate` does not use `friendlyError` at all. Its two error paths
(`StudioApp.tsx:250, 264`) produce `cause.message.replaceAll("_", " ")` and a
hand-written string. So the one screen where a stranger decides whether we are
competent shows raw server error codes with the underscores swapped for spaces.

**BREAK 4. "I already have a code" is a trap.** `StudioApp.tsx:344-351` moves to
the code step without sending one. A person who clicks it after a failed send
sits in front of a six-digit field with no code coming and no way to know that.
There is no resend affordance and no countdown anywhere in the OTP step, and
`context/STATE.md` records the mailer is capped at roughly **2 per hour** — the
one fact in the system that most needs to be on this screen and is on none of
it.

**BREAK 5. Trust strip promises three things and evidences none.**
`StudioApp.tsx:287-291`: "Self-replication only / No public voice library /
Auditable deletion." All three are true and all three are *load-bearing* claims
made without a link, a number, or a mechanism. This product's whole thesis is
that it shows its work. **[taste]** The first screen is where it should start.

### Step 2. Create a replica — `StudioApp.tsx:401-439`

A portrait placeholder with a scanning ring, a name field, one button. Clean,
and probably the best-judged screen in the studio.

**BREAK 6. It asks for a name and never asks for the subject.** The copy at
`StudioApp.tsx:132` promises "Your name, as students will see it", then
`QuickStartPath.tsx:141-148` immediately tells the teacher step 3 is "Confirm
subject and teaching style" — a step it then links to rather than doing. The
subject is the single field that changes what every later screen should say, and
it is collected nine screens later, in a panel that does not save to a server
(see BREAK 13).

**BREAK 7. `createdNotice` reads as a refusal.** *"Teaching clone created.
Enrollment remains locked until verification services are ready."* The teacher's
first success message is 60% about what does not work. **[taste]** Truth is
non-negotiable; the *proportion* is a choice, and this proportion makes a
working product sound broken.

### Step 3. The workspace, on arrival — `StudioApp.tsx:617-639`

**BREAK 8. The readiness grid contains a hardcoded lie.**
`StudioApp.tsx:629-633`:

```tsx
<article className="readiness-card">
  <span className="metric-label">Voice versions</span>
  <strong>0</strong>
  <span>No model trained</span>
</article>
```

Literal `0`, literal "No model trained", never read from anything. A teacher who
has built a VoiceGenome, run the blind A/B lab and frozen a delivery policy
still sees "Voice versions 0 / No model trained" at the top of their workspace.
`RuntimeGate.tsx:103` renders the real value (`runtime.versions.voice_genome`)
1 000 lines further down the page. This is the exact failure shape
`context/rejected.md` names for spinners that outlive their request: a display
that cannot be distinguished from a working one while being wrong.

**BREAK 9. "Public access: Off / Cannot be changed" is false and demotivating.**
`StudioApp.tsx:634-638`. It can be changed — `ChannelsStudio` is a whole step
about changing it. The card means "no public voice library", which is a
different and better claim.

**BREAK 10. Four cards, three of which are zeroes, is the first thing a teacher
sees after paying attention to us.** **[taste]** The moment after "create" is
the moment of highest intent in the entire funnel and it currently renders as a
scoreboard of things not done.

### Step 4. QuickStartPath — `QuickStartPath.tsx`

This component is the best idea in the studio. Splitting blockers into "waiting
on you" and "waiting on the platform", sourced from the real
`/api/replica-runtime` blocker list and never guessed, is exactly right, and its
header comment is the standard the rest of the studio should be held to.

**BREAK 11. Its three-step checklist can never complete.**
`QuickStartPath.tsx:140` hardcodes `className="quickstart-step next"` on step 3.
There is no `done` branch, because there is no signal to branch on — the sheet
does not persist (BREAK 13). A progress list that structurally cannot reach 3/3
teaches the teacher that our progress indicators do not mean anything, which is
the most expensive thing a product can teach on day one.

**BREAK 12. It is placed above `EnrollmentWorkspace`, and its step 2 links
down into it.** `StudioApp.tsx:641-661`. So the "short way" panel and the
long-form panel it summarises are stacked, both fully expanded, both asking for
the same upload. `jumpTo("#enrollment-workspace")` scrolls past nothing. Two
surfaces for one action is how a teacher learns to distrust which one is real.

### Step 5. Consent + upload — `EnrollmentWorkspace.tsx`

Genuinely strong. Four self-attestations, a receipt with an expiry, scope cards
that say what each permission does, a withdrawal path with a typed
confirmation, browser-side SHA-256 before a signed URL is issued, and a source
ledger that states it does not keep filenames. The consent moment is designed,
not defaulted. Keep essentially all of it.

**BREAK 13-adjacent, upload:** the phase labels (`EnrollmentWorkspace.tsx:279,
281, 293, 296`) are honest and specific ("Computing integrity fingerprint",
"Authorizing private upload", "Uploading directly to private storage",
"Verifying stored file"), which is unusually good. But the progress model is
half-honest: `upload-status`'s secondary line says `"Please keep this page
open"` for three of the four phases with **no time expectation at all**, and
`context/STATE.md` records that the finalize step ("Verifying stored file")
currently **fails closed for every real upload** until the deployment catches up
with the `replicaObjectInfo` fix. A teacher hitting that today gets a raw server
string via `cause.message` (`EnrollmentWorkspace.tsx:308`), because this
component predates `errorCopy.ts` and never adopted it.

**BREAK 14. The source-type dropdown leads with "Government ID".**
`EnrollmentWorkspace.tsx:520` renders `IDENTITY_DOCUMENT_POLICY` as the FIRST
option, and `uploadMode` defaults to `"audio"` — so the default selection is the
second item in the list. The first thing in the menu on the "add your teaching"
step is a demand for a government ID, and identity has its own dedicated panel
(`IdentityProofing`) further down. Two doors to one legal act.

### Step 6. Identity + liveness — `IdentityProofing.tsx`, `LivenessCapture.tsx`

The copy here is the best in the product. *"Bind one real person to this
replica"*, *"Prove this recording was made now"*, *"No name, date of birth,
document number, address, portrait, or OCR transcript is written to the replica
database"* (`IdentityProofing.tsx:137`). This is what the whole studio should
sound like.

**BREAK 15. Both are inside the collapsed `<details>`.**
`StudioApp.tsx:708-715, 717-728`, under a summary reading *"Advanced &
verification steps"* (`StudioApp.tsx:224`). Identity verification is not
advanced. It is the **mandatory** gate that `QuickStartPath` will list as
"waiting on you" and that `RuntimeGate` refuses activation without. Filing the
required path under "Advanced" is the progressive-disclosure pattern applied to
the wrong axis: what should collapse is what is *optional*, not what is *later*.

### Step 7. Sheet review — `TeacherSheetStudio.tsx`

**BREAK 16 (the most damaging single line in the studio). Every teacher is shown
Arjun Sir's sheet.** `StudioApp.tsx:668` passes `sheetDraft={DEMO_TEACHER}`,
`:684` passes `sheet={DEMO_TEACHER}` to `DisclosurePreview`, and `:693` passes
`slug={DEMO_TEACHER.slug}` to `ChannelsStudio`. `demoTeacher.ts:33-34` is
`slug: "teacher-demo-arjun"`, `name: "Arjun Sir"`.

Consequences, in order of severity:

1. `DisclosurePreview.tsx:32` renders **"You're talking with an AI clone of
   Arjun Sir"** to every teacher, on the screen whose entire purpose is
   *"so your consent is informed by exactly what a student will experience"*
   (`DisclosurePreview.tsx:23-26`). A teacher named Priya is asked to consent to
   a disclosure naming someone else. `safety-floor-teacher.md` §2.1 is quoted
   two files away: *"a clone published under a name the artifact does not cover
   is impersonation."*
2. `ChannelsStudio` generates embed code and a public address against
   `teacher-demo-arjun`, so the "where your clone can be reached" step is
   showing every teacher a link to the demo.
3. The sheet review shows demo strictness, warmth, syllabus and doubt ladder as
   though they were drafted from the teacher's uploads, and
   `TeacherSheetStudio.tsx:311` titles that section **"Drafted from your
   uploads"**.

**BREAK 17. The sheet does not save.** `TeacherSheetStudio.tsx:148`:
`setNotice("Kept locally — the sheet service isn't connected yet.")`. Honest,
and correctly honest — but it is *inside* a panel that presents itself as the
review-and-confirm step, and `QuickStartPath` step 3 sends the teacher here to
"Confirm subject and teaching style". The honest state exists at the wrong
altitude: the step should announce it is not connected *before* asking for
twenty minutes of careful input, not after.

**BREAK 18. Read-only fields presented as reviewable.**
`TeacherSheetStudio.tsx:313`: *"Read-only until the ingestion pipeline is
connected. Review or correct each one in the claims step."* There is no
reachable claims step for those items yet.

### Step 8. Voice preview — `VoicePreviewLab.tsx`

**BREAK 19. The emotional peak of the entire product is inside a collapsed
`<details>` labelled "Advanced".** `StudioApp.tsx:745`. Hearing your own voice
come back out of a machine is *the* moment this product exists to deliver, it is
the moment that converts a skeptical teacher, and it is currently three clicks
and one scroll behind a disclosure widget for verification chores. The component
itself is excellent: `"Hear the evidence become a voice."`, a blind A/B lab with
both sides seed-locked, a held-out generalisation gate, honest
`"The scale-to-zero voice lab may take a few minutes on its first run."`
(`VoicePreviewLab.tsx:272`).

**BREAK 20. It is the only major panel with no `id`.** Every other step has an
anchor (`#enrollment-workspace`, `#identity-proofing`, `#liveness-capture`,
`#model-consent-gate`, `#processing-review`, `#person-model-studio`,
`#calibration-studio`, `#voice-enrollment-lab`, `#runtime-gate`,
`#teacher-sheet-studio`, `#disclosure-preview`) and every one of those resolves
from `QuickStartPath.BLOCKER_META`. `VoicePreviewLab` has none, so nothing can
ever link a teacher to the best screen we have. (`ReplicaDialogueLab`,
`CandidateEvaluationLab`, `ChannelsStudio` and `IngestChannelStudio` are also
anchorless.)

**BREAK 21. A cold start is 161-176 s and the wait state is one sentence.**
`context/STATE.md` records 161 s to ready, a 504 at 242 s, and an HMAC skew
window of 60 s that returns **401 on the request that wakes the service** — an
auth error for a latency problem. The studio's entire treatment of this is
`"Protecting your preview"` on a button plus one line of prose. A teacher who
waits three minutes and receives "unauthorized" will conclude their account is
broken, and will be right to.

### Step 9. Mirror Call

**BREAK 22. It does not exist.** `grep -rn "MirrorCall\|mirror-call"` over
`src/` and `api/` returns nothing. `docs/gurukul/MIRROR-CALL-SPEC.md` is a good
spec (WS-X/WS-Y are building it) and this document's Part 3 designs its place in
the flow so the wave after the merge is mechanical rather than another
placement-by-arrival.

### Step 10. Channels / deploy — `ChannelsStudio.tsx`

Correctly placed after `DisclosurePreview` — `StudioApp.tsx:685-688` explains
why in a comment that is exactly right: *"a teacher decides where their clone can
be reached only once they have seen exactly what every person reaching it is told
first. The order is the informed half of informed consent."* That is the
standard.

**BREAK 23.** It inherits BREAK 16's demo slug, and `context/STATE.md` records
that nothing in this lane is live (migration 055 unapplied,
`CLONE_WIDGET_SESSION_SECRET` unset, `CHANNEL_SECRET_BACKEND=none` refuses). The
panel does not lead with that.

### Cross-cutting

**BREAK 24. The step numbers collide and the sequence is not the render order.**
Two different panels are both **04**: `ProcessingReview.tsx:117`
(`<div className="panel-index">04</div>`) and `ModelConsentGate.tsx:74`
(`"Verified permission · Gate 04"`) — and `ModelConsentGate` renders *before*
`ProcessingReview` (`StudioApp.tsx:730, 738`). `IdentityProofing` and
`LivenessCapture` carry no number at all despite sitting between 02 and 04.
`VoicePreviewLab`, `TeacherSheetStudio`, `DisclosurePreview`, `ChannelsStudio`,
`IngestChannelStudio`, `CandidateEvaluationLab` and `QuickStartPath` carry no
number either. And **08** is `STAGES` (`StudioApp.tsx:162-170`) — a permanently
locked "Embodiment laboratory" teaser for visual modeling that is not being
built, sitting inside a teacher's launch path telling them something is missing
that is not missing.

Two prefixes are also in use for the same concept: `"Gate 04"`, `"Gate 07"`
versus `"05 · Person Model"`, `"06 · Behavior calibration"`.

**BREAK 25. The disclosure text is duplicated across the consent boundary with
no gate binding the two copies.** `api/_clonechannel.js:101-108`
(`cloneDisclosureCard`) is the string a student actually receives, and
`evals/clonechannel.mjs:444` asserts it byte-for-byte. `DisclosurePreview.tsx:32-36`
re-types the same sentences in JSX, and **nothing checks them against each
other**. `api/_clonechannel.js:95-96` states the risk in its own comment: *"a
disclosure the teacher consented to and a disclosure the student sees that
differ by one word is a consent defect."* The runtime half is gated; the consent
half is a copy-paste.

**BREAK 26. The one typographic rule this repo wrote down is unenforced on the
product.** `scripts/check-copy.mjs` bans em-dashes in UI copy and scans
`src/components/` and `site/*.html`. It does not scan `src/studio/`, which now
carries **73** of them in user-visible strings (measured by applying the gate's
own algorithm to that directory). `docs/DESIGN-STANDARDS.md`'s ban is therefore
binding on Meera and optional for Vyakti, which is how one product ends up
speaking in two voices.

**BREAK 27. Errors are handled at three different qualities in one page.**
`errorCopy.ts` (excellent, never fabricates a cause, always quotes the server
verbatim) is used by `QuickStartPath` and `StudioApp`'s banner. `AuthGate`,
`EnrollmentWorkspace`, `VoicePreviewLab` and `TeacherSheetStudio` each roll
their own `cause instanceof Error ? cause.message : "..."`. So the same failure
renders as a designed message in one panel and a raw string in the panel below
it.

**BREAK 28. There is no page-level sense of place.** The studio is one
1 475-line vertical scroll of fourteen full-width panels. There is a rail for
switching *replicas* (`StudioApp.tsx:441-477`) and nothing for navigating
*steps*. `QuickStartPath`'s `jumpTo` is the only wayfinding in the product and
it only points at blockers.

---

## Part 2 — The student journey as it is

`src/gurukul/surface.ts` gates a `gurukul-student` build; `App.tsx:1532-1541`
mounts a two-button `.gurukul-nav` and `App.tsx:1767-1768` mounts
`PracticeActivity` and `MasteryMap` as full-screen siblings.

**BREAK S1. The disclosure the teacher consented to has no UI on this surface.**
`cloneDisclosureFact` is a *prompt* field (`teacherTypes.ts:173`,
`demoTeacher.ts:269`) and `cloneDisclosureCard` lives in the **channel** lane
(`api/_clonechannel.js:101`). `grep` finds no session-open disclosure card in
`src/components/` on the student surface. `safety-floor-teacher.md` §1 is
explicit that disclosure is a predicate on the output and not a persona rule
precisely so that it cannot depend on the model remembering — but on this
surface it currently depends on exactly that. **This is the highest-priority
item in Part 2** and is queued as UX-Q-01.

**BREAK S2. Navigation is two unlabelled buttons.** `App.tsx:1533-1540`. The
spec (`student-app-spec.md` §5) calls for three primary surfaces (Chat,
Practice, Mastery) plus a Teacher Profile screen answering "who am I talking
to". Two buttons bolted above the thread is a seam, not a navigation model, and
it is honestly labelled as such in its own comment.

**BREAK S3. There is no Teacher Profile surface.** `student-app-spec.md` §5
names it and calls it *"where 'who am I talking to' lives"*. In a product where
the answer is "an AI built from a real person who is not reading this", that
screen is not a nicety.

**BREAK S4. The student never sees the fidelity number or the provenance.** The
teacher gets a measured guarantee; the student gets a sentence. **[taste]** The
student is the one being asked to trust a synthetic voice.

---

## Part 3 — The target journey

**The design rule underneath all of it:** *the shortest honest path.* Not the
shortest path — every gate stays at full strength, and nothing below removes,
weakens, defers or hides a consent or safety step. What changes is that the
teacher always knows where they are, what is next, whose turn it is, and how
long it takes; and that the moment which earns their trust arrives before the
moments which spend it.

### 3.1 The spine

Five **phases**, each with a plain-language promise and an honest exit
condition. Every panel in the studio belongs to exactly one phase. Numbering is
per-phase and never global, which is what kills the 04/04 collision permanently
rather than renumbering it once.

| # | Phase | The promise | Exit condition | Whose turn |
|---|---|---|---|---|
| 1 | **Say who you are** | Name, subject, and the one-line way you'd describe how you teach | A workspace with a subject on it | You, 2 min |
| 2 | **Give it something to learn from** | Permission, then one file | One source in the ledger, quarantined | You, 5 min |
| 3 | **Hear yourself** | A private draft voice, and a blind A/B to tune it | You have listened to your own clone | You, plus one honest cold-start wait |
| 4 | **Prove it is you** | ID, live challenge, and the permissions that unlock modelling | Identity, liveness and inference consent bound | You, 10 min |
| 5 | **Meet it, then publish it** | Mirror Call, sheet confirmation, disclosure preview, channels | Runtime gates cleared, one channel connected | Shared |

**Phase 3 before phase 4 is the single most important ordering change.** Today
identity proofing (a government ID, a video of your face) is asked for *before*
the teacher has any evidence we can do the thing. The reordering costs nothing
in safety: the voice preview is already `"private... cannot join calls or
activate a replica"` (`VoicePreviewLab.tsx:242`), the runtime gate already
refuses without identity, and consent for capture/transcription/storage is
already separate from consent for biometric modelling. It is exactly the
distinction `EnrollmentWorkspace.tsx:431-433` already makes in prose. We simply
stop asking for the expensive trust before we have offered any.

### 3.2 The persistent step rail

Replace the vertical scroll with a two-column shell: a sticky left rail listing
the five phases and their panels, and the panel column on the right. The rail
is the answer to BREAK 28 and it absorbs `QuickStartPath` rather than stacking
another summary on top of it (BREAK 12).

Every rail row carries exactly one of the four status tokens now defined in
`src/studio/design/tokens.css`:

- `--state-done` (forest) — recorded, nothing owed
- `--state-waiting` (ember) — **your turn**, the only state that asks for action
- `--state-running` (slate) — we are working, you cannot speed it up
- `--state-stopped` (danger) — refused, revoked, erased

Ember appears on the rail at most once at a time. **[taste]** A checklist with
six things glowing is a checklist nobody starts.

Status comes from the same `/api/replica-runtime` blockers `QuickStartPath`
already reads, plus real consent and source state. **Never a literal.**
BREAK 8 and BREAK 11 are both the same defect and the rail must be built so that
defect is impossible: no rail row may render a status that is not derived from
data.

### 3.3 Every wait state, designed

The system's real numbers (`context/STATE.md`): voice-evidence 4 977 ms warm /
**176 s cold**; runtime 161 s to ready, 504 observed at 242 s; ASR sync 4 134 ms
under a hard 30 s input cap; batch ASR **137 s** for 71 s of audio; HMAC skew
window **60 s**, shorter than the cold start.

| Wait | Design |
|---|---|
| < 1 s | No indicator. |
| 1-4 s | In-control spinner with the phase name. Never a modal. |
| 4-30 s | Named phase + elapsed counter. `EnrollmentWorkspace`'s four phase labels are the model to copy. |
| **> 30 s (cold start)** | A **named, honest wait**: "Your voice lab is starting up. First run after a quiet period takes about three minutes." Elapsed timer counting **up**, never a fake bar. A one-line explanation of *why* (it scales to zero so it costs nothing while idle, which is also why it is not billed to you). At 240 s the copy changes to acknowledge it is running long **before** the 504 arrives. |
| **The 401 that is really a cold start** | `hmac-skew-shorter-than-cold-start` must never reach a teacher as "unauthorized". The client warms `/healthz` first, and if a 401 arrives during a known warm-up window the copy says *"still starting up"* and retries, because showing a security error for a latency problem is a lie in the highest-stakes direction available. |
| Fine-tune queued at Mirror Call end | Stated as queued, with no ETA invented. `MIRROR-CALL-SPEC.md` already forbids the fake progress bar. |

### 3.4 Every error, designed

One rule: **`errorCopy.ts` is the only path to a user-visible error string**, and
`friendlyError` gains a `retryLabel`. Every panel adopts it (BREAK 27). Its
existing discipline is exactly right and does not change: classify only what is
knowable, quote the server verbatim, never invent a cause.

Three additions:

1. **Own it.** `errorCopy.ts:40` already says *"This is our error, not something
   you did"* for 5xx. Extend to the storage-finalize path, which is a known
   deployment lag and is currently the most likely error a real teacher meets.
2. **Name whose turn it is** — the same "you / platform" split `QuickStartPath`
   pioneered. An error a teacher can fix and one they cannot are different
   screens.
3. **Never a bare code.** `AuthGate`'s `message.replaceAll("_", " ")` and every
   `cause instanceof Error ? cause.message` fallback go.

### 3.5 Every consent moment, designed

The existing consent design is the strongest thing in the product and is mostly
kept. Four moments, each with its own shape:

1. **Source permission** (capture / transcription / storage) — four
   self-attestations, scope cards, a receipt with an expiry, withdrawal with a
   typed confirmation. Keep as built. Add: what withdrawal *costs*, stated
   before granting rather than only in the withdrawal modal.
2. **Identity + liveness** — keep the copy verbatim; it is the best in the
   product. Move it out from under "Advanced" (BREAK 15). Add a plain "what
   happens to my ID" answer inline, because
   `IdentityProofing.tsx:137` already has the answer and it is currently only
   visible *after* the upload.
3. **Modelling + inference** (`ModelConsentGate`) — this is the one that
   authorises the clone to *exist*. It should read as the biggest moment in the
   studio and currently reads as gate number four of ten.
4. **Publication** (`DisclosurePreview` → `ChannelsStudio`) — the order is
   already right and is the model for the other three. Add: the teacher's own
   name, not the demo's (BREAK 16), and a byte-level guarantee that what they
   are consenting to is what a student receives (BREAK 25).

### 3.6 Where Mirror Call goes

Phase 5, **first panel**, before sheet confirmation and before
`DisclosurePreview`. Rationale: `MIRROR-CALL-SPEC.md`'s delta chips are proposals
against the sheet, so the call should run *before* the teacher signs off on the
sheet, not after — otherwise confirmation happens twice and the second one is
the real one. The fidelity meter belongs here and nowhere else, printed against
the speaker's own ceiling exactly as the spec requires.

### 3.7 The student journey, target

1. **Disclosure card, before the first turn, from the same string the teacher
   consented to.** A UI predicate on the student surface, not a prompt field.
   Same shared constant as `cloneDisclosureCard`, gated by an eval that reads
   both call sites.
2. **Three tabs** (Chat, Practice, Mastery) per `student-app-spec.md` §5, with
   Call reachable from inside Chat.
3. **A Teacher Profile surface** that answers "who am I talking to": the real
   teacher, what the clone was built from, when it was last updated, the
   fidelity number with its ceiling, and how to reach a human.
4. **Honest states, minor-first.** No streak danger states, no countdowns; the
   spec's §2.3 framing is already correct and needs building, not redesigning.

---

## Part 4 — What this workstream implemented

| Change | File |
|---|---|
| Teacher/generic mode survives Google sign-in and a bookmark of bare `/studio` (BREAK 1) | `src/studio/studioAuth.ts`, `src/studio/main.tsx` |
| The design system as values: type, space, radius, status, focus, motion | `src/studio/design/tokens.css` |
| A real landing at `/` instead of a meta refresh (Step 0) | `site/vyakti.html`, `scripts/vercel-build.sh` |
| The design system, described | `docs/gurukul/DESIGN-SYSTEM.md` |
| This audit and target journey | `docs/gurukul/PRODUCT-JOURNEY.md` |
| Everything designed and not safely implementable while WS-W and WS-Y hold `StudioApp.tsx` and `studio.css` | `docs/gurukul/UX-QUEUE.md` |

Everything else is queued rather than done, because two sibling workstreams are
editing `src/studio/StudioApp.tsx` and `src/studio/studio.css` right now
(`origin/gurukul-ws-w` touches both) and a parallel rewrite of those files would
collide. The queue is ordered and each item names its target files so the wave
after those merges is mechanical.

---

## Part 5 — Vyakti Rooms v1, new surfaces on this journey (WS-R1..R10, 2026-09-03)

Nothing in Parts 1-4 above is closed by this wave — Rooms is additive, not a
fix to the audit's BREAK list, and none of the open UX-Q items in
`UX-QUEUE.md` cite a Rooms workstream as their closer. What changed is that
the five-phase spine in §3.1 now has real panels behind two of its phases that
did not exist when that spine was drawn. Status below is honest, not
aspirational: **"code-complete, gated offline" is not "live"**, and none of
the six surfaces below has ever been driven by a real signed-in browser
session against the live database.

| Surface | Where in the §3.1 spine | Status |
|---|---|---|
| **The Room** (`/r/<slug>`, `api/room.js` over `api/_room-surface.js`) | Outside the creator's own five phases — this is the FOLLOWER's surface, reached only after phase 5 publishes something | Migration 071 applied live. `evals/room/run.mjs` 54/54 offline. The leak battery (`evals/room-leak/run.mjs`, a release gate) proves the three-scope boundary holds across 2/5/20-follower scenarios, 16,080 retrieval checks + 441 boundary checks, 0 leaks. **No real Room has ever been opened, joined or said-to outside a fake `db`** (WS-R7's own words about `vy_room`) |
| **RoomStudio** (creator publishes/pauses/renames the Room, sets the free-message cap) | Phase 5, mounted above `ChannelsStudio`'s band, `mode==='teacher'`-gated | `api/_room-publish.js`, 37 offline checks, one required negative control (the readiness `EXISTS` clause struck from the real statement text). No migration of its own — reuses `vy_room`'s existing columns. **No real `vy_room` row has ever been inserted anywhere outside a fake `db`**, so this panel has never been exercised against a real replica either |
| **Readiness** (`ReadinessPanel.tsx`, one number / five parts / one suggested action, publish lock at 70 overall / 55 per part) | Phase 5, replacing the old `ReadinessStrip` on Meet | Migration 073 applied live. `evals/readiness/run.mjs` 120/120 offline, including the negative control that removes the overall-undefined guard. `scripts/relcheck.mjs`'s reach walk for this table has never run against real Postgres in any WS-R1..R10 session log; **no real readiness snapshot has been written outside a fake `db`** |
| **The review queue** (`ReviewQueue.tsx`, the Meet step's thirty-second card: Sounds right / Close, fix it / Never say this) | Phase 5, on Meet | Migration 074 applied live. `evals/review-queue/run.mjs` 117/117 offline with five negative controls, including the structural one that matters most: strike the never-rule predicate from `gateReply` and a forbidden reply travels. **No real card has ever been shown to a real creator**; the question generator has only ever been driven by an injected fixture, so "thirty seconds a card" remains the brief's design target, not a measurement |
| **The interview** (a Mirror Call mode that asks about the archive's own gaps, never quoting the archive back) | Phase 5, opened as `mode=interview` on the Mirror Call's existing `create` op — the placement §3.6 already reasoned about | Migration 075 applied live. `evals/interview/run.mjs` 173/173 offline with two negative controls. **No real call has ever asked a real question** — this inherits every blocker Part 1's Step 9 already named for the Mirror Call backend itself, which has never spoken to a live `api/mirror-call.js` from a browser |
| **Drift watch** (`DriftWatchCard.tsx`, mounted directly under `ReadinessPanel`: has the voice-engine or the fidelity score moved since the creator last checked) | Phase 5, on Meet, beside Readiness | Migration 076 **built, and stated applied by this workstream's own brief, but with no confirmed live-apply record in `context/` as of this writing** — check before assuming it is there. `evals/drift-watch/run.mjs` 89/89 offline. **Found and logged as an open gap by its own author**: `recordOwnedFidelity` has exactly one caller in the whole tree (its own offline eval), so the score-drop half of this feature reads `not_measured` for every real replica today — the swap-detection half is unaffected because it reads the generation ledger every real preview does write |

**The vendor voice bench arms** (ElevenLabs PVC, Sarvam Bulbul, behind
`VOICE_VENDOR_ARMS`) are not a journey surface — no panel shows them to
anyone — and are noted here only because they share this wave: no vendor has
ever been contacted from this repository, no vendor audio exists, and there is
no listening result for either arm.

**What this means for §3.1's five-phase spine, plainly:** phase 5 ("Meet it,
then publish it") now carries five new panels (Readiness, the review queue,
the interview mode, drift watch, RoomStudio) on top of the Mirror Call,
`TeacherSheetStudio`, `DisclosurePreview` and `ChannelsStudio` it already had.
Nobody has re-audited phase 5 for the ordering, numbering-collision and
wayfinding problems Part 1 found in the OLD studio (BREAK 24, BREAK 28) now
that it is five panels heavier. That re-audit is not done here and is not
claimed to be; it is the natural next `PRODUCT-JOURNEY.md` pass once these
surfaces are live enough to look at with a signed-in session.
