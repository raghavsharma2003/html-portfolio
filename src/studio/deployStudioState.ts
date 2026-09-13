// deployStudioState.ts — WS-R152. The Deploy screen's own readiness banner,
// as a pure function, `wizardModel.ts`'s own reason restated one surface
// over: a status computed in JSX is a status that eventually gets typed by
// hand, and a status a plain function returns is one `evals/deploy-studio`
// can call thousands of times with no React and no fetch involved.
//
// THE MAPPING, AND WHY IT IS A SIMPLIFICATION ON PURPOSE
// ---------------------------------------------------------------------------
// `api/_room-publish.js`'s `publishBlockers` can report up to three named
// gates at once (`#runtime-gate`, `#readiness-title`, `#teacher-sheet-studio`,
// pushed in that order into `waiting_on_you`/`waiting_on_us`). This screen
// only ever shows the person ONE of three plain-words states, because the
// owner's own brief names exactly three ("Publish who you are first", "Voice
// not verified yet", "Ready to open") and DESIGN-SYSTEM.md's "one ember at a
// time" rule (`wizardModel.ts`'s own header) already forbids more than one
// glowing status on screen regardless.
//
// `stopped` (the SAME boolean `CloneExperience.tsx` already computes as
// `selected.lifecycle !== "active" && selected.lifecycle !== "ready"`, fed
// down rather than re-derived) stands in for BOTH `#runtime-gate` and
// `#readiness-title`: activation requires both the runtime capability and
// the readiness floor together (`RUNTIME_STATUS_SQL`/`readinessPasses`), so
// a replica that is not `active`/`ready` is, by construction, failing
// whichever of the two the server would have named first. `publishedRoom`
// covers the remainder: once voice is verified, the ONLY gate the wave era
// ever built a path past for a generic-mode replica is disclosure
// (`context/rejected.md#ws-r7-room-for-generic-mode-with-no-disclosure-
// pathway` — a generic self-replica's `vy_agent` never gets a
// `vy_teacher_sheet` row, so `room_disclosure_not_approved` is the
// PERMANENT remaining blocker today), so "not stopped, not published" reads
// as "publish who you are first" without needing to inspect which exact
// blocker code the server returned.
//
// REVERSAL CONDITION: the day a generic-mode replica can satisfy
// `disclosureApproved` some other way (HumanOS/R151, or the predicate
// widened), "not stopped, not published" will sometimes mean a DIFFERENT
// remaining blocker (readiness, or a real publish failure), and this
// function should read the actual `blocker.anchor` RoomStudio's own
// `onRoomState` callback already carries rather than inferring purely from
// `stopped`/`publishedRoom`. Until then, reading the anchor buys no extra
// truth: the anchor is `#teacher-sheet-studio` in every reachable case.
export type DeployBannerState = "voice" | "publish" | "ready";
export type DeployStepId = "feed" | "meet" | "deploy";

export function deployBannerState(input: { stopped: boolean; publishedRoom: boolean }): DeployBannerState {
  if (input.stopped) return "voice";
  if (input.publishedRoom) return "ready";
  return "publish";
}

/** The "See it as a visitor" action's own honest gate — WS-R152's negative
 *  control. `RoomStudio.tsx` itself shows the address card (link, story
 *  card, poster) the moment a Room row exists at all, published or not
 *  (`context/rejected.md#ws-r152-deploy-visitor-link-only-once-published`
 *  names why THIS new action does not copy that: a "see it as a visitor"
 *  button implies a visitor can see something, and an unpublished Room
 *  refuses every follower — `resolveRoom`'s own gate, unchanged by this
 *  workstream). Returns `null` — never a link the caller has to remember
 *  not to render — until `room.published` is true. */
export function deployVisitorLink(
  room: { slug: string; published: boolean } | null,
  origin: string,
): string | null {
  if (!room || !room.published) return null;
  return `${origin}/r/${room.slug}`;
}

/** `RoomStudio.tsx`'s own `onGoStep` can ask for step "feed", "meet" or
 *  "deploy" (`BLOCKER_STEP` in that file only ever maps a named blocker onto
 *  "meet" or "deploy" today; "feed" is carried in the type only because
 *  `StepId` names all three). This screen IS "deploy", so only "meet" ever
 *  needs translating — into the same review `onReview` already opens
 *  (`CloneExperience.tsx`'s `chooseRoom("evolve")`), the one place a
 *  person's own voice/consent review lives until HumanOS (R151) ships a
 *  screen of its own. */
export function shouldReviewForStep(step: DeployStepId): boolean {
  return step === "meet";
}
