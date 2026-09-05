// EVERY WORD THE STUDIO'S CHROME SAYS, IN ONE PLACE, IN EVERY LANGUAGE IT
// SAYS IT (WS-R52, migration 112).
//
// `src/room/copy.ts`'s own header, and the reason transfers exactly: three
// surfaces showing one label in three files is how two of them end up saying
// something the third does not. This is the creator-facing analog WS-R47
// found missing ("no locale mechanism at all" -- context/decisions.md
// #ws-r47-studio-card-is-english-only-no-locale-mechanism-exists).
//
// SAME SHAPE AS src/room/copy.ts, on purpose (this workstream's own law 1):
// one object per locale, both required to carry the exact same keys, checked
// against the REAL export by `evals/studio-locale/run.mjs`, not a
// hand-counted list -- `src/room/copy.ts`'s own `evals/room-locale/run.mjs`
// proof shape, reused rather than re-derived.
//
// ── WHAT THIS FILE IS, AND WHAT IT IS NOT ───────────────────────────────────
//
// This is the STUDIO's own chrome: Feed/Meet/Share, Readiness, the review
// queue's three verdicts, Payouts, the Suite card, Check-ins, Handoff, the
// invite cards. It is never the AI's own replies (`src/engine/persona.ts`,
// untouched) and never the Room a FOLLOWER sees (`src/room/copy.ts`,
// untouched) -- three different people read three different files, and this
// one is the creator's own screens only.
//
// ── SCOPE, STATED HONESTLY ───────────────────────────────────────────────
//
// Not every literal in src/studio/*.tsx moved here in this workstream. Two
// classes of string are deliberately out, and both are named so the gap is
// findable rather than silent:
//
//   1. SERVER-COMPUTED PROSE. `ReadinessPanel.tsx`'s `part.label`/
//      `part.detail`/`part.method`, `RoomStudio.tsx`'s `blocker.headline`/
//      `blocker.next`, a review card's `prompt_text`/`answer_text` -- these
//      are authored server-side (api/_readiness.js, api/_room-publish.js,
//      the review queue's own generator) and arrive as English strings over
//      the wire regardless of what this file says. Translating them needs a
//      server-side locale plumb-through this brief did not ask for and this
//      workstream did not build. `evals/studio-locale/run.mjs`'s literal
//      scan allowlists the JSX expressions that render them by name, with
//      this same reason attached to each entry.
//   2. HONESTY-GATED, ENGLISH-PATTERN-CHECKED PROSE. `blockerClass.ts`'s
//      `CLASS_COPY` stays English and untouched: `evals/studiowizard.mjs`
//      (not named in this workstream's file list) checks every `us`-class
//      string against `BLAME_PATTERNS`, a set of ENGLISH regexes, and
//      re-deriving a parallel Hindi blame-language detector is a real
//      workstream of its own, not a translation. What this file DOES carry
//      is a separate, short pair of labels (`classLabels` below) that
//      `BlockerNotice.tsx` and `WizardRail.tsx` read INSTEAD of
//      `CLASS_COPY[...].label` when rendering to screen -- the two-word
//      badge translates cleanly; the honesty-gated reason sentences next to
//      it (`QuickStartPath.tsx`'s `BLOCKER_META`, `studioShellModel.ts`'s
//      composed headline sentences) do not move, for the same reason.
//
// `RoomStudio.tsx` itself (1200+ lines, the studio's largest single file,
// carrying money and tax-adjacent copy -- creator-tier pricing, the TDS
// note) is NOT converted in this workstream. Its five sub-cards that live
// inside it (`PayoutsCard.tsx`, `SuiteCard.tsx`, `CheckinsCard.tsx`,
// `HandoffCard.tsx`, `InviteCreatorCard.tsx`) all ARE, in full -- they are
// self-contained files by their own header comments, and the brief's own
// two named examples ("the Payouts card and the Suite card") are among
// them. `RoomStudio.tsx`'s own chrome (the Room address, publish switch,
// free-cap and language-default controls) is logged in
// context/rejected.md as this workstream's one deliberate scope cut, with
// the reason and what would reverse it.
//
// ── THE COPY RULES THIS FILE IS HELD TO, IN EVERY LOCALE ────────────────────
//
// Product chrome, never the AI's own voice. No em-dash or en-dash, in either
// script (scripts/check-copy.mjs). Never the word "clone", "model",
// "replica", nor their Hindi equivalents (क्लोन/मॉडल/प्रतिकृति) -- a creator
// reads "आपका AI" ("your AI"). Plain, functional Hindi a creator would say
// aloud, no Sanskritised register, numerals as digits
// (`scripts/check-layout.mjs`'s `studio-hi` target measures it set in the
// real Devanagari face). Vocabulary matched to `src/room/copy.ts` wherever
// the same concept appears in both (चेक-इन, सदस्यता, पेड, टाइमज़ोन) so a
// creator who has also read their own Room's Hindi never meets a second
// word for the same thing.

/** v1: English and Hindi (Devanagari), matching `src/room/copy.ts`'s own
 *  `ROOM_LOCALES` exactly. Adding a third locale means widening this array,
 *  migration 112's CHECK constraint, and `scripts/check-layout.mjs`'s
 *  `studio-hi`-shaped targets in the same change --
 *  `evals/studio-locale/run.mjs` fails the build otherwise, by design. */
export const STUDIO_LOCALES = ["en", "hi"] as const;
export type StudioLocale = (typeof STUDIO_LOCALES)[number];

export function normalizeStudioLocale(value: unknown): StudioLocale {
  return value === "hi" ? "hi" : "en";
}

/** Both words, always, in both locales -- `src/room/copy.ts`'s
 *  `ROOM_LANGUAGE_LABELS`' own reason: a creator who reads only Hindi still
 *  has to be able to find "English" on the way to it, and one who reads
 *  only English still has to be able to find "हिन्दी". */
export const STUDIO_LANGUAGE_LABELS: Record<StudioLocale, string> = {
  en: "English",
  hi: "हिन्दी",
};

/** A count spliced into a template at `{n}`, the same `.split().join()`
 *  shape as `src/room/copy.ts`'s `withName`/`withRetry` -- composable with
 *  itself and safe to call more than once on the same template. */
export const withCount = (template: string, n: number) => template.split("{n}").join(String(n));

/** A label spliced in at `{label}`. */
export const withLabel = (template: string, label: string) => template.split("{label}").join(label);

/** Two labels, `{name}` and `{n}`, for the handful of templates that need both. */
export const withNameAndCount = (template: string, name: string, n: number) =>
  template.split("{name}").join(name).split("{n}").join(String(n));

// ── classLabels: the two-word badge only. See the file header above for
//    why the reason sentence beside it (blockerClass.ts's CLASS_COPY.lead,
//    and every DisabledReason.headline/next) stays English. ───────────────
interface ClassLabels {
  you: string;
  us: string;
}

// ── shell: StudioShell.tsx (Feed / Meet / Share), the language switch ─────
interface ShellCopy {
  languageGroupLabel: string;
  tabsAriaLabel: string;
  /** Mirrors `studioShellModel.ts`'s own `TAB_TITLE`/`TAB_PROMISE` -- kept
   *  here rather than imported from there because that file is a
   *  dependency-free, eval-gated pure-function module
   *  (`evals/studio-shell/run.mjs`, not named in this workstream's file
   *  list) and this workstream does not touch it. Two copies of four short
   *  labels, not two sources of truth for a sentence: `evals/studio-locale/
   *  run.mjs` asserts these stay byte-identical to the English module's own
   *  constants, so a future edit to one is caught if the other drifts. */
  tabTitle: Record<"feed" | "meet" | "share", string>;
  tabPromise: Record<"feed" | "meet" | "share", string>;
  allPanelsLink: string;
  oneVideoTitle: string;
  oneVideoBlurb: string;
  stillLockedTitle: string;
  forYou: string; // "{n} for you"
  onUsCount: string; // "{n} on us"
}

// ── creatorPath: CreatorPath.tsx, the Feed tab's own path card (WS-R65) ────
interface CreatorPathCopy {
  eyebrow: string;
  /** One short name per step, `CreatorPath.tsx#CREATOR_PATH_STEPS`'s own
   *  order — the list row, shown for every step regardless of state. */
  stepLabel: Record<
    | "account_created" | "studio_opened" | "first_source_uploaded" | "processing_finished"
    | "first_preview_heard" | "readiness_first_measured" | "readiness_passed_lock" | "disclosure_approved"
    | "room_created" | "publish_clicked" | "room_published" | "first_follower_joined",
    string
  >;
  /** The one sentence shown beneath the list, for whichever step is
   *  current. `readiness_passed_lock`'s own template carries `{n}`/`{n2}`,
   *  spliced by the real floors at render time
   *  (`CreatorPath.tsx#CREATOR_PATH_READINESS_PART_FLOOR`/`_OVERALL_FLOOR`)
   *  rather than a second hardcoded 55/70 in this file. */
  currentSentence: Record<
    | "account_created" | "studio_opened" | "first_source_uploaded" | "processing_finished"
    | "first_preview_heard" | "readiness_first_measured" | "readiness_passed_lock" | "disclosure_approved"
    | "room_created" | "publish_clicked" | "room_published" | "first_follower_joined",
    string
  >;
  /** The one button beneath that sentence. */
  currentButton: Record<
    | "account_created" | "studio_opened" | "first_source_uploaded" | "processing_finished"
    | "first_preview_heard" | "readiness_first_measured" | "readiness_passed_lock" | "disclosure_approved"
    | "room_created" | "publish_clicked" | "room_published" | "first_follower_joined",
    string
  >;
  stateLabel: Record<"done" | "current" | "ahead", string>;
  pausedSentence: string;
  pausedButton: string;
}

// ── wizardRail: WizardRail.tsx's own hardcoded chrome ──────────────────────
interface WizardRailCopy {
  railLabel: string;
  navAriaLabel: string;
  nothingOpenDone: string;
  nothingOpenNotDone: string;
  seeWhatIsHappening: string;
  goThere: string;
  whatIsStillOpen: string;
  everythingElse: string;
  youCanActOn: string; // "{n} you can act on"
  onUsCount: string; // "{n} on us"
  hideWhy: string;
  whyThisStep: string;
  movedTo: string; // "Moved to {label}."
  theSection: string;
}

// ── readiness: ReadinessPanel.tsx ──────────────────────────────────────────
interface ReadinessCopy {
  eyebrow: string;
  workingOut: string;
  onUsHeadline: string;
  couldNotRead: string;
  tryAgain: string;
  stillApprenticeOne: string;
  stillApprenticeMany: string; // "{n} ..."
  outOf100: string;
  notMeasuredYet: string;
  how: string;
  sample: string;
  measured: string;
  publishingLocked: string;
  publishingOpen: string;
  lockedWhyWeakest: string; // "Weakest: {label}. To publish, every part needs {n1} and the whole needs {n2}."
  lockedWhyNoWeakest: string; // "To publish, every part needs {n1} and the whole needs {n2}."
  openWhy: string;
  trustLine: string;
  partHelp: Record<string, string>;
}

// ── driftWatch: DriftWatchCard.tsx ─────────────────────────────────────────
interface DriftWatchCopy {
  eyebrow: string;
  onUsHeadline: string;
  couldNotCheck: string;
  tryAgain: string;
  notMeasuredHeadline: string;
  notMeasuredLede: string;
  movedHeadline: string;
  steadyHeadline: string;
  ofYourOwn100: string; // ", measured {label}"
  ofYourOwn100Bare: string;
  last30Days: string;
  engineChanged: string; // "The voice engine underneath it last changed on {label}."
  engineUnchanged: string;
  anchorFallback: string;
  movedReasons: Record<string, string>;
  prosodyReasons: Record<string, string>;
  /** The sparkline's own `aria-label`, WS-R52. `{v1}`/`{d1}`/`{v2}`/`{d2}`
   *  are pre-formatted by the caller; `{n}` and the trailing plural are
   *  handled by `trendAriaOne`/`trendAriaMany`. */
  trendAriaOne: string;
  trendAriaMany: string;
}

// ── reviewQueue: ReviewQueue.tsx ───────────────────────────────────────────
interface ReviewQueueCopy {
  eyebrow: string;
  title: string;
  lede: string;
  cardOf: string; // "Card {n1} of {n2}"
  dismiss: string;
  kindLabel: Record<"question" | "claim" | "delta" | "follower_declined", string>;
  noAnswerYet: string;
  buttonSoundsRight: string;
  buttonFixed: string;
  buttonNever: string;
  emptyTitle: string;
  emptyBody: string;
  looking: string;
  lookForSomething: string;
  fixQuestionLabel: string;
  fixPlaceholder: string;
  fixNote: string;
  saving: string;
  saveThisAnswer: string;
  listening: string;
  savingHold: string;
  holdToSayIt: string;
  back: string;
  micDenied: string;
  noticeFixed: string;
  noticeNever: string;
  noticeSaved: string;
  errorLoad: string;
  errorSave: string;
  errorCorrection: string;
  errorRecording: string;
  errorFill: string;
  nothingRecorded: string;
  addedWithGenerator: string; // "Added {n}. The question generator is not available on this deployment yet, so only your own material was used."
  addedPlain: string; // "Added {n}."
  blockedAnswerOne: string; // "{n} blocked answer in force on every surface."
  blockedAnswerMany: string; // "{n} blocked answers in force on every surface."
  flaggedRepliesOne: string; // "{n} reply flagged by followers."
  flaggedRepliesMany: string; // "{n} replies flagged by followers."
}

// ── payouts: PayoutsCard.tsx ────────────────────────────────────────────────
interface PayoutsCopy {
  title: string;
  intro: string;
  fundAccountLabel: string;
  save: string;
  saving: string;
  fundAccountNote: string;
  saved: string;
  hideStatement: string;
  showStatement: string;
  gross: string;
  platformTake: string;
  tdsWithheld: string;
  netToYou: string;
  followerSubsThisPeriod: string; // "Follower subscriptions this period: {n}."
  suiteShare: string; // "Includes a Suite seat share from {name}: {label}." / without name
  suiteShareNoName: string;
  tdsNote: string;
  stateLine: string; // "State: {label}"
  providerRef: string; // ", provider reference {label}"
  settledLine: string; // "Settled: {label}"
  failureReasonLine: string; // "Failure reason: {label}"
  downloadJson: string;
  downloadText: string;
  couldNotLoadStatement: string;
  loadingStatement: string;
  noPayoutYet: string;
  stateLabel: Record<"built" | "pending_account" | "queued" | "sent" | "settled" | "failed", string>;
  netLabel: string; // "{label} net - {label2}"
  statementDocTitle: string; // "Payout statement, {label}"
  statementDocBuilt: string;
}

// ── checkins: CheckinsCard.tsx ──────────────────────────────────────────────
interface CheckinsCopy {
  title: string;
  intro: string;
  working: string;
  pause: string;
  resume: string;
  emptyList: string;
  titleLabel: string;
  titlePlaceholder: string;
  shapeLabel: string;
  shapePlaceholder: string;
  cadenceLabel: string;
  cadencePlaceholder: string;
  saving: string;
  addCheckin: string;
}

// ── handoff: HandoffCard.tsx ────────────────────────────────────────────────
interface HandoffCopy {
  title: string;
  intro: string;
  on: string;
  off: string;
  forThisRoom: string;
  working: string;
  turnOff: string;
  turnOn: string;
  capLabel: string;
  waiting: string;
  answered: string;
  whatTheySent: string;
  yourReply: string;
  replyPlaceholder: string;
  sending: string;
  sendReply: string;
  nothingWaiting: string;
}

// ── inviteCreator: InviteCreatorCard.tsx ────────────────────────────────────
interface InviteCreatorCopy {
  title: string;
  intro: string;
  publishFirst: string;
  copied: string;
  copyCode: string;
  sendNow: string;
  creating: string;
  createCode: string;
  quota: string; // "{n1} of {n2} used."
  quotaExhausted: string;
  usedAll: string;
  stateLabel: Record<"unused" | "redeemed" | "expired", string>;
}

// ── inviteGate: InviteGate.tsx ──────────────────────────────────────────────
interface InviteGateCopy {
  eyebrow: string;
  headline: string;
  lede: string;
  codeLabel: string;
  codePlaceholder: string;
  checking: string;
  continueLabel: string;
  noCodeYet: string;
  applyLink: string;
}

// ── suite: SuiteCard.tsx ────────────────────────────────────────────────────
interface SuiteCopy {
  title: string;
  intro: string;
  creating: string;
  starting: string;
  seatsUsedAdmin: string; // "{n1} of {n2} seats used - you administer this Suite"
  seatsUsedMember: string; // "{n1} of {n2} seats used - you are a member"
  working: string;
  inviteCreator: string;
  hideMembers: string;
  showMembers: string;
  hideMoney: string;
  showMoney: string;
  attachThisRoom: string;
  noSeatFree: string;
  removeFromSuite: string;
  loadingMembers: string;
  memberAdmin: string;
  memberCreator: string;
  loadingMoney: string;
  seatsAtPrice: string; // "{n1} seats at {label} a month each - state: {label2}."
  willNotRenew: string; // "Will not renew after {label}. Every attached Room keeps its seat until then."
  nextCharge: string; // "Next charge: {label1} on {label2}."
  platformTake: string; // "Vyakti's platform take is {n}%, the same as every Room's own follower price."
  cancel: string;
  updateSeats: string;
  noSubscriptionYet: string;
  startSubscription: string;
  noSuitesYet: string;
  newSuiteName: string;
  namePlaceholder: string;
  plan: string;
  planStarter: string;
  planInstitute: string;
  seats: string;
  saving: string;
  createSuite: string;
  joinSuite: string;
  joinPlaceholder: string;
  join: string;
  noticeCreated: string;
  inviteNotice: string; // "Share this Suite's id with the creator: {orgId}."
  noticeJoined: string;
  noticeAttached: string;
  noticeDetached: string;
  noticeSubscriptionStarted: string;
  noticeSeatsUpdated: string;
  noticeWillNotRenewSimple: string;
  autoStartLiveStarted: string; // "\"{name}\" is live, and its seat subscription has started."
  autoStartLivePending: string; // "\"{name}\" is live. Start its subscription below when you are ready to charge seats."
}

interface StudioCopy {
  classLabels: ClassLabels;
  shell: ShellCopy;
  creatorPath: CreatorPathCopy;
  wizardRail: WizardRailCopy;
  readiness: ReadinessCopy;
  driftWatch: DriftWatchCopy;
  reviewQueue: ReviewQueueCopy;
  payouts: PayoutsCopy;
  checkins: CheckinsCopy;
  handoff: HandoffCopy;
  inviteCreator: InviteCreatorCopy;
  inviteGate: InviteGateCopy;
  suite: SuiteCopy;
}

const EN: StudioCopy = {
  classLabels: { you: "Waiting on you", us: "Waiting on us" },

  shell: {
    languageGroupLabel: "हिन्दी / English",
    tabsAriaLabel: "Your AI, in three tabs",
    tabTitle: { feed: "Feed", meet: "Meet", share: "Share" },
    tabPromise: {
      feed: "Bring your material.",
      meet: "Meet your AI: hear it, correct it, see how ready it is.",
      share: "Publish your Room and decide where it can be reached.",
    },
    allPanelsLink: "All panels (the full bench)",
    oneVideoTitle: "One video, by link",
    oneVideoBlurb: "A fourth way in, being built right now.",
    stillLockedTitle: "Still locked on Meet",
    forYou: "{n} for you",
    onUsCount: "{n} on us",
  },

  creatorPath: {
    eyebrow: "Your path to a published Room",
    stepLabel: {
      account_created: "Your workspace",
      studio_opened: "You opened the studio",
      first_source_uploaded: "Your first source",
      processing_finished: "We finish processing it",
      first_preview_heard: "You hear your AI",
      readiness_first_measured: "We measure Readiness",
      readiness_passed_lock: "Readiness clears the floor",
      disclosure_approved: "You approve what followers are told",
      room_created: "You set up your Room",
      publish_clicked: "You publish it",
      room_published: "Your Room goes live",
      first_follower_joined: "Your first follower joins",
    },
    currentSentence: {
      account_created: "Your workspace is ready.",
      studio_opened: "You are in the studio right now.",
      first_source_uploaded: "Add one file, video, or link to start.",
      processing_finished: "We are still processing what you gave us.",
      first_preview_heard: "Go and hear your AI for the first time.",
      readiness_first_measured: "Go talk to your AI so we can measure Readiness.",
      readiness_passed_lock: "Get every part to {n} and the whole to {n2}.",
      disclosure_approved: "Read and approve what every follower is told first.",
      room_created: "Set up your Room.",
      publish_clicked: "Publish your Room when you are ready.",
      room_published: "Your Room just went live.",
      first_follower_joined: "Waiting for your first follower.",
    },
    currentButton: {
      account_created: "Continue",
      studio_opened: "Continue",
      first_source_uploaded: "Add your first source",
      processing_finished: "See what is happening",
      first_preview_heard: "Hear your AI",
      readiness_first_measured: "Talk to your AI",
      readiness_passed_lock: "Improve Readiness",
      disclosure_approved: "Review and approve",
      room_created: "Set up your Room",
      publish_clicked: "Publish your Room",
      room_published: "Open your Room",
      first_follower_joined: "Open your Room",
    },
    stateLabel: { done: "Done", current: "Now", ahead: "Later" },
    pausedSentence: "Your Room is paused, so nobody can reach it right now.",
    pausedButton: "Go and resume your Room",
  },

  wizardRail: {
    railLabel: "Your AI, in three steps",
    navAriaLabel: "Studio steps",
    nothingOpenDone: "Nothing is open on this step.",
    nothingOpenNotDone: "Nothing is open on this step yet.",
    seeWhatIsHappening: "See what is happening",
    goThere: "Go there",
    whatIsStillOpen: "What is still open on this step",
    everythingElse: "Everything else on this step",
    youCanActOn: "{n} you can act on",
    onUsCount: "{n} on us",
    hideWhy: "Hide why",
    whyThisStep: "Why this step",
    movedTo: "Moved to {label}.",
    theSection: "the section",
  },

  readiness: {
    eyebrow: "Readiness",
    workingOut: "Working out where your AI stands.",
    onUsHeadline: "This one is on us.",
    couldNotRead: "We could not read your readiness just now",
    tryAgain: "Try again",
    stillApprenticeOne: "Still an apprentice. One part has not been measured yet, so there is no score to give you.",
    stillApprenticeMany: "Still an apprentice. {n} parts have not been measured yet, so there is no score to give you.",
    outOf100: "out of 100, across the five parts below",
    notMeasuredYet: "Not measured yet",
    how: "How",
    sample: "Sample",
    measured: "Measured",
    publishingLocked: "Publishing is locked.",
    publishingOpen: "Publishing is open.",
    lockedWhyWeakest: "Weakest: {name}. To publish, every part needs {n} and the whole needs {n2}.",
    lockedWhyNoWeakest: "To publish, every part needs {n} and the whole needs {n2}.",
    openWhy: "Your AI can be reached by the people you choose on the next step.",
    trustLine: "Your voice is never listed or shared.",
    partHelp: {
      knows_your_material: "Whether it can answer from what you gave us.",
      sounds_like_you: "Whether your voice comes back as yours.",
      thinks_like_you: "Whether you keep its answers or correct them.",
      knows_what_not_to_say: "The lines you have told it never to cross.",
      up_to_date: "Whether what it knows is still true.",
    },
  },

  driftWatch: {
    eyebrow: "Drift watch",
    onUsHeadline: "This one is on us.",
    couldNotCheck: "We could not check for drift just now",
    tryAgain: "Try again",
    notMeasuredHeadline: "Not measured yet.",
    notMeasuredLede: "We have not compared your voice to your own recordings recently enough to say whether it still sounds like you.",
    movedHeadline: "Something moved.",
    steadyHeadline: "Still sounds like you.",
    ofYourOwn100: " of your own 100, measured {label}",
    ofYourOwn100Bare: " of your own 100",
    last30Days: "last 30 days",
    engineChanged: "The voice engine underneath it last changed on {label}.",
    engineUnchanged: "The voice engine underneath it has not changed since we started watching.",
    anchorFallback: "Our own alarm for this is not up to date.",
    movedReasons: {
      model_commitment_changed: "The voice engine underneath your AI changed recently.",
      score_dropped: "Your voice score dropped more than a normal day to day change.",
    },
    prosodyReasons: {
      prosody_baseline_unavailable: "We could not check whether our own alarm for this is up to date.",
      prosody_baseline_never_established: "Our own alarm for this has never been set up.",
      prosody_baseline_last_run_alarmed: "Our own alarm for this rang on its last check and has not been cleared.",
      prosody_baseline_overdue: "Our own alarm for this has not run in a while.",
    },
    trendAriaOne: "Trend from {v1} on {d1} to {v2} on {d2}, over {n} measured point.",
    trendAriaMany: "Trend from {v1} on {d1} to {v2} on {d2}, over {n} measured points.",
  },

  reviewQueue: {
    eyebrow: "Review",
    title: "Check what your AI says",
    lede: "One answer at a time. Say whether it sounds like you, fix it in your own words, or block it outright.",
    cardOf: "Card {n} of {n2}",
    dismiss: "Dismiss",
    kindLabel: {
      question: "A question people will ask",
      claim: "Something we think we learned",
      delta: "A habit we heard on a call",
      follower_declined: "A question your AI would not answer",
    },
    noAnswerYet: "Your AI has not answered this one yet. Write what you would say and it becomes the answer.",
    buttonSoundsRight: "Sounds right",
    buttonFixed: "Close, fix it",
    buttonNever: "Never say this",
    emptyTitle: "Nothing to review yet.",
    emptyBody: "It fills itself from real conversations once your Room is open.",
    looking: "Looking...",
    lookForSomething: "Look for something to review",
    fixQuestionLabel: "What would you actually say?",
    fixPlaceholder: "Answer it the way you would answer it.",
    fixNote: "This is stored as your own source and cited. It is never pasted into your AI as a script.",
    saving: "Saving...",
    saveThisAnswer: "Save this answer",
    listening: "Listening, let go when done",
    savingHold: "Saving...",
    holdToSayIt: "Hold to say it",
    back: "Back",
    micDenied: "Your browser did not give us the microphone. Type the fix instead.",
    noticeFixed: "Saved. Anything built from the old answer will be rebuilt, not patched.",
    noticeNever: "Saved. Your AI is now blocked from saying this, on every surface.",
    noticeSaved: "Saved.",
    errorLoad: "The review queue could not be read",
    errorSave: "That decision could not be saved",
    errorCorrection: "That correction could not be saved",
    errorRecording: "That recording could not be saved",
    errorFill: "The queue could not be filled",
    nothingRecorded: "Nothing was recorded. Hold the button while you speak.",
    addedWithGenerator: "Added {n}. The question generator is not available on this deployment yet, so only your own material was used.",
    addedPlain: "Added {n}.",
    blockedAnswerOne: "{n} blocked answer in force on every surface.",
    blockedAnswerMany: "{n} blocked answers in force on every surface.",
    flaggedRepliesOne: "{n} reply flagged by followers.",
    flaggedRepliesMany: "{n} replies flagged by followers.",
  },

  payouts: {
    title: "Payouts",
    intro: "One statement a month, one number you can check against your bank line: what followers paid, what the platform took, what was withheld for tax, and what reaches you.",
    fundAccountLabel: "Fund account reference (from your payment provider, never a bank detail typed here)",
    save: "Save",
    saving: "Saving...",
    fundAccountNote: "This platform never asks for your bank account number or UPI id. Your payment provider issues a reference once you finish their own onboarding, and that reference is the only thing saved here.",
    saved: "Fund account reference saved.",
    hideStatement: "Hide statement",
    showStatement: "Show statement",
    gross: "Gross",
    platformTake: "Platform take",
    tdsWithheld: "TDS withheld",
    netToYou: "Net to you",
    followerSubsThisPeriod: "Follower subscriptions this period: {n}.",
    suiteShare: "Includes a Suite seat share from {name}: {label}.",
    suiteShareNoName: "Includes a Suite seat share: {label}.",
    tdsNote: "TDS reflects the rate the platform operator has configured. Right now that rate is 0%, so nothing is withheld. The operator believes Section 194J of India's Income Tax Act applies to a creator's Room earnings, but an accountant has not confirmed this, and the rate may change before any real payout is sent.",
    stateLine: "State: {label}",
    providerRef: ", provider reference {label}",
    settledLine: "Settled: {label}",
    failureReasonLine: "Failure reason: {label}",
    downloadJson: "Download as JSON",
    downloadText: "Download as text",
    couldNotLoadStatement: "Could not load this statement.",
    loadingStatement: "Loading statement.",
    noPayoutYet: "No payout has been built for you yet. This fills in once a period closes with revenue on it.",
    stateLabel: {
      built: "Built, not yet sent",
      pending_account: "Waiting on a fund account",
      queued: "Queued with the provider",
      sent: "Sent",
      settled: "Settled",
      failed: "Failed",
    },
    netLabel: "{label} net - {label2}",
    statementDocTitle: "Payout statement, {label}",
    statementDocBuilt: "Built",
  },

  checkins: {
    title: "Check-ins",
    intro: "A paid follower opts in and picks their own schedule; your AI follows up on that schedule and never because they went quiet. Write what to check on as a note to your AI, not a line for it to read aloud; it will say it in its own words, every time.",
    working: "Working...",
    pause: "Pause",
    resume: "Resume",
    emptyList: "No check-ins yet. The first one you add here becomes something a follower can opt into.",
    titleLabel: "Title",
    titlePlaceholder: "Evening walk",
    shapeLabel: "What to check on (a note to your AI: it will phrase this itself)",
    shapePlaceholder: "ask if they went for their evening walk today; celebrate briefly if yes, no guilt if no",
    cadenceLabel: "Cadence hint (shown to the follower, e.g. \"daily\")",
    cadencePlaceholder: "daily",
    saving: "Saving...",
    addCheckin: "Add check-in",
  },

  handoff: {
    title: "Handoff",
    intro: "Off by default. When it is on, a follower can ask to hear from you directly - they choose exactly what gets sent, see it byte for byte before it goes, and your reply lands only in their own thread, marked as you, never as your AI.",
    on: "On",
    off: "Off",
    forThisRoom: "for this Room",
    working: "Working...",
    turnOff: "Turn off",
    turnOn: "Turn on",
    capLabel: "Requests one follower may send in a month (0-50)",
    waiting: "Waiting",
    answered: "Answered",
    whatTheySent: "What they sent, exactly as they sent it",
    yourReply: "Your reply",
    replyPlaceholder: "Answer in your own words - this reaches only them, marked as you.",
    sending: "Sending...",
    sendReply: "Send reply",
    nothingWaiting: "Nothing waiting right now.",
  },

  inviteCreator: {
    title: "Invite a creator",
    intro: "You can invite up to three other creators to build their own AI. A code works once, for the person you give it to, and this screen is the only place it is ever shown in full.",
    publishFirst: "Publish your Room to start inviting other creators.",
    copied: "Copied",
    copyCode: "Copy code",
    sendNow: "Send this to the person you are inviting now. It will not be shown again.",
    creating: "Creating...",
    createCode: "Create an invite code",
    quota: "{n} of {n2} used.",
    quotaExhausted: " You have used all three.",
    usedAll: "You have used all three invites, or your Room is not published yet.",
    stateLabel: {
      unused: "Not used yet",
      redeemed: "Redeemed",
      expired: "Expired",
    },
  },

  inviteGate: {
    eyebrow: "Invitation only, for now",
    headline: "Vyakti is invitation only while the first Rooms are built by hand.",
    lede: "If someone here already sent you a code, enter it below. If not, you can apply, and we will reach out.",
    codeLabel: "Invite code",
    codePlaceholder: "XXXX-XXXX-XXXX",
    checking: "Checking",
    continueLabel: "Continue",
    noCodeYet: "No code yet?",
    applyLink: "Apply for one of the first Rooms",
  },

  suite: {
    title: "Suites",
    intro: "A Suite is an organisation that pays for seats - one seat per Room. Create one to bring several Rooms (a coach, a teacher, a doctor) under one roster; an admin sees only counts for each Room, never what a follower said.",
    creating: "Creating your Suite.",
    starting: "Starting its seat subscription.",
    seatsUsedAdmin: "{n} of {n2} seats used - you administer this Suite",
    seatsUsedMember: "{n} of {n2} seats used - you are a member",
    working: "Working...",
    inviteCreator: "Invite a creator",
    hideMembers: "Hide members",
    showMembers: "Show members",
    hideMoney: "Hide money",
    showMoney: "Show money",
    attachThisRoom: "Attach this Room",
    noSeatFree: "No seat free",
    removeFromSuite: "Remove this Room from this Suite",
    loadingMembers: "Loading members.",
    memberAdmin: "Admin",
    memberCreator: "Creator",
    loadingMoney: "Loading money.",
    seatsAtPrice: "{n} seats at {label} a month each - state: {label2}.",
    willNotRenew: "Will not renew after {label}. Every attached Room keeps its seat until then.",
    nextCharge: "Next charge: {label} on {label2}.",
    platformTake: "Vyakti's platform take is {n}%, the same as every Room's own follower price.",
    cancel: "Cancel",
    updateSeats: "Update seats",
    noSubscriptionYet: "No Suite subscription yet. Seats stay capped at this Suite's own free seat limit until one starts.",
    startSubscription: "Start Suite subscription",
    noSuitesYet: "No Suites yet. Create one below, or join one a Suite admin invited you to.",
    newSuiteName: "New Suite name",
    namePlaceholder: "North Coaching",
    plan: "Plan",
    planStarter: "Starter",
    planInstitute: "Institute",
    seats: "Seats",
    saving: "Saving...",
    createSuite: "Create Suite",
    joinSuite: "Join a Suite (paste the id an admin shared with you)",
    joinPlaceholder: "Suite id",
    join: "Join",
    noticeCreated: "Suite created. You are its admin.",
    inviteNotice: "Share this Suite's id with the creator: {orgId}.",
    noticeJoined: "You have joined this Suite as a creator.",
    noticeAttached: "This Room is now part of the Suite.",
    noticeDetached: "This Room is no longer part of that Suite.",
    noticeSubscriptionStarted: "Suite subscription started.",
    noticeSeatsUpdated: "Seats updated.",
    noticeWillNotRenewSimple: "Will not renew after the current period ends.",
    autoStartLiveStarted: "\"{name}\" is live, and its seat subscription has started.",
    autoStartLivePending: "\"{name}\" is live. Start its subscription below when you are ready to charge seats.",
  },
};

const HI: StudioCopy = {
  classLabels: { you: "आप पर निर्भर", us: "हम पर निर्भर" },

  shell: {
    languageGroupLabel: "हिन्दी / English",
    tabsAriaLabel: "आपका AI, तीन टैब में",
    tabTitle: { feed: "फ़ीड", meet: "मीट", share: "शेयर" },
    tabPromise: {
      feed: "अपनी सामग्री लाएं।",
      meet: "अपने AI से मिलें: सुनें, ठीक करें, देखें यह कितना तैयार है।",
      share: "अपना रूम पब्लिश करें और तय करें कि इसे कहां पहुंचाया जा सकता है।",
    },
    allPanelsLink: "सभी पैनल (पूरी बेंच)",
    oneVideoTitle: "एक वीडियो, लिंक से",
    oneVideoBlurb: "अभी बन रहा प्रवेश का चौथा तरीका।",
    stillLockedTitle: "मीट पर अभी भी लॉक",
    forYou: "{n} आप पर",
    onUsCount: "{n} हम पर",
  },

  creatorPath: {
    eyebrow: "आपके रूम के पब्लिश होने तक का रास्ता",
    stepLabel: {
      account_created: "आपका वर्कस्पेस",
      studio_opened: "आपने स्टूडियो खोला",
      first_source_uploaded: "आपका पहला सोर्स",
      processing_finished: "हमने इसे प्रोसेस कर लिया",
      first_preview_heard: "आपने अपना AI सुना",
      readiness_first_measured: "हमने तैयारी मापी",
      readiness_passed_lock: "तैयारी ने सीमा पार की",
      disclosure_approved: "आपने मंज़ूरी दी कि फॉलोअर को क्या बताया जाता है",
      room_created: "आपने अपना रूम बनाया",
      publish_clicked: "आपने इसे पब्लिश किया",
      room_published: "आपका रूम लाइव है",
      first_follower_joined: "आपका पहला फॉलोअर जुड़ा",
    },
    currentSentence: {
      account_created: "आपका वर्कस्पेस तैयार है।",
      studio_opened: "आप अभी स्टूडियो में हैं।",
      first_source_uploaded: "शुरू करने के लिए एक फ़ाइल, वीडियो, या लिंक जोड़ें।",
      processing_finished: "हम अभी भी आपकी दी हुई चीज़ें प्रोसेस कर रहे हैं।",
      first_preview_heard: "जाकर पहली बार अपना AI सुनें।",
      readiness_first_measured: "अपने AI से बात करें ताकि हम तैयारी माप सकें।",
      readiness_passed_lock: "हर हिस्से को {n} तक और पूरे को {n2} तक पहुंचाएं।",
      disclosure_approved: "पढ़ें और मंज़ूरी दें कि हर फॉलोअर को पहले क्या बताया जाता है।",
      room_created: "अपना रूम बनाएं।",
      publish_clicked: "तैयार होने पर अपना रूम पब्लिश करें।",
      room_published: "आपका रूम अभी लाइव हुआ।",
      first_follower_joined: "आपके पहले फॉलोअर का इंतज़ार है।",
    },
    currentButton: {
      account_created: "जारी रखें",
      studio_opened: "जारी रखें",
      first_source_uploaded: "अपना पहला सोर्स जोड़ें",
      processing_finished: "देखें क्या हो रहा है",
      first_preview_heard: "अपना AI सुनें",
      readiness_first_measured: "अपने AI से बात करें",
      readiness_passed_lock: "तैयारी सुधारें",
      disclosure_approved: "पढ़ें और मंज़ूरी दें",
      room_created: "अपना रूम बनाएं",
      publish_clicked: "अपना रूम पब्लिश करें",
      room_published: "अपना रूम खोलें",
      first_follower_joined: "अपना रूम खोलें",
    },
    stateLabel: { done: "पूरा हुआ", current: "अभी", ahead: "बाद में" },
    pausedSentence: "आपका रूम रुका हुआ है, इसलिए अभी कोई इस तक नहीं पहुंच सकता।",
    pausedButton: "जाकर अपना रूम फिर शुरू करें",
  },

  wizardRail: {
    railLabel: "आपका AI, तीन चरणों में",
    navAriaLabel: "स्टूडियो के चरण",
    nothingOpenDone: "इस चरण पर कुछ भी खुला नहीं है।",
    nothingOpenNotDone: "इस चरण पर अभी कुछ भी खुला नहीं है।",
    seeWhatIsHappening: "देखें क्या हो रहा है",
    goThere: "वहां जाएं",
    whatIsStillOpen: "इस चरण पर अभी क्या खुला है",
    everythingElse: "इस चरण पर बाकी सब",
    youCanActOn: "{n} जिन पर आप कर सकते हैं",
    onUsCount: "{n} हम पर",
    hideWhy: "वजह छुपाएं",
    whyThisStep: "यह चरण क्यों",
    movedTo: "{label} पर पहुंचे।",
    theSection: "इस हिस्से",
  },

  readiness: {
    eyebrow: "तैयारी",
    workingOut: "पता लगाया जा रहा है कि आपका AI कहां खड़ा है।",
    onUsHeadline: "यह हमारी वजह से है।",
    couldNotRead: "अभी आपकी तैयारी पढ़ी नहीं जा सकी",
    tryAgain: "फिर कोशिश करें",
    stillApprenticeOne: "अभी भी अप्रेंटिस। एक हिस्सा अभी तक मापा नहीं गया, इसलिए कोई स्कोर नहीं दिया जा सकता।",
    stillApprenticeMany: "अभी भी अप्रेंटिस। {n} हिस्से अभी तक मापे नहीं गए, इसलिए कोई स्कोर नहीं दिया जा सकता।",
    outOf100: "100 में से, नीचे दिए पांच हिस्सों में",
    notMeasuredYet: "अभी मापा नहीं गया",
    how: "कैसे",
    sample: "नमूना",
    measured: "मापा गया",
    publishingLocked: "पब्लिश करना लॉक है।",
    publishingOpen: "पब्लिश करना खुला है।",
    lockedWhyWeakest: "सबसे कमज़ोर: {name}। पब्लिश करने के लिए, हर हिस्से को {n} और पूरे को {n2} चाहिए।",
    lockedWhyNoWeakest: "पब्लिश करने के लिए, हर हिस्से को {n} और पूरे को {n2} चाहिए।",
    openWhy: "आपका AI अगले चरण में आपके चुने हुए लोगों तक पहुंच सकता है।",
    trustLine: "आपकी आवाज़ कभी लिस्ट या शेयर नहीं होती।",
    partHelp: {
      knows_your_material: "क्या यह आपकी दी हुई सामग्री से जवाब दे सकता है।",
      sounds_like_you: "क्या आपकी आवाज़ आपकी जैसी ही वापस आती है।",
      thinks_like_you: "क्या आप इसके जवाब रखते हैं या ठीक करते हैं।",
      knows_what_not_to_say: "वे लाइनें जो आपने इसे कभी पार न करने को कहा है।",
      up_to_date: "क्या यह जो जानता है वह अभी भी सच है।",
    },
  },

  driftWatch: {
    eyebrow: "ड्रिफ्ट वॉच",
    onUsHeadline: "यह हमारी वजह से है।",
    couldNotCheck: "अभी ड्रिफ्ट की जांच नहीं हो सकी",
    tryAgain: "फिर कोशिश करें",
    notMeasuredHeadline: "अभी मापा नहीं गया।",
    notMeasuredLede: "हमने आपकी आवाज़ को आपकी अपनी रिकॉर्डिंग से हाल ही में इतना नहीं मिलाया कि बता सकें कि यह अभी भी आपकी जैसी लगती है या नहीं।",
    movedHeadline: "कुछ बदल गया।",
    steadyHeadline: "अभी भी आपकी जैसी लगती है।",
    ofYourOwn100: " आपके अपने 100 में से, {label} को मापा गया",
    ofYourOwn100Bare: " आपके अपने 100 में से",
    last30Days: "पिछले 30 दिन",
    engineChanged: "इसके पीछे की वॉइस इंजन आखिरी बार {label} को बदली थी।",
    engineUnchanged: "जब से हमने देखना शुरू किया, इसके पीछे की वॉइस इंजन नहीं बदली।",
    anchorFallback: "इसके लिए हमारा अपना अलार्म अभी अपडेट नहीं है।",
    movedReasons: {
      model_commitment_changed: "आपके AI के पीछे की वॉइस इंजन हाल ही में बदली।",
      score_dropped: "आपका वॉइस स्कोर सामान्य रोज़ के बदलाव से ज़्यादा गिरा।",
    },
    prosodyReasons: {
      prosody_baseline_unavailable: "हम यह जांच नहीं सके कि इसके लिए हमारा अपना अलार्म अपडेट है या नहीं।",
      prosody_baseline_never_established: "इसके लिए हमारा अपना अलार्म कभी सेट नहीं हुआ।",
      prosody_baseline_last_run_alarmed: "इसके लिए हमारा अपना अलार्म पिछली जांच में बजा और अभी तक साफ़ नहीं हुआ।",
      prosody_baseline_overdue: "इसके लिए हमारा अपना अलार्म काफी समय से नहीं चला।",
    },
    trendAriaOne: "{d1} को {v1} से {d2} को {v2} तक का रुझान, {n} मापे गए बिंदु पर।",
    trendAriaMany: "{d1} को {v1} से {d2} को {v2} तक का रुझान, {n} मापे गए बिंदुओं पर।",
  },

  reviewQueue: {
    eyebrow: "समीक्षा",
    title: "देखें आपका AI क्या कहता है",
    lede: "एक बार में एक जवाब। बताएं कि यह आपकी तरह लगता है, अपने शब्दों में ठीक करें, या इसे पूरी तरह रोक दें।",
    cardOf: "कार्ड {n} में से {n2}",
    dismiss: "हटाएं",
    kindLabel: {
      question: "एक सवाल जो लोग पूछेंगे",
      claim: "कुछ जो हमें लगता है हमने सीखा",
      delta: "कॉल पर सुनी गई एक आदत",
      follower_declined: "एक सवाल जिसका आपका AI जवाब नहीं देगा",
    },
    noAnswerYet: "आपके AI ने अभी इसका जवाब नहीं दिया। लिखें कि आप क्या कहेंगे और वही जवाब बन जाएगा।",
    buttonSoundsRight: "सही लगा",
    buttonFixed: "करीब है, ठीक करें",
    buttonNever: "यह कभी न कहें",
    emptyTitle: "अभी समीक्षा के लिए कुछ नहीं।",
    emptyBody: "आपका रूम खुलते ही यह असली बातचीत से खुद भर जाता है।",
    looking: "देखा जा रहा है...",
    lookForSomething: "समीक्षा के लिए कुछ ढूंढें",
    fixQuestionLabel: "आप असल में क्या कहेंगे?",
    fixPlaceholder: "जैसे आप जवाब देंगे, वैसे ही जवाब दें।",
    fixNote: "यह आपके अपने सोर्स के रूप में सेव होता है और इसका हवाला दिया जाता है। यह कभी आपके AI में स्क्रिप्ट की तरह नहीं डाला जाता।",
    saving: "सेव हो रहा है...",
    saveThisAnswer: "यह जवाब सेव करें",
    listening: "सुन रहे हैं, हो जाए तो छोड़ें",
    savingHold: "सेव हो रहा है...",
    holdToSayIt: "कहने के लिए दबाए रखें",
    back: "वापस",
    micDenied: "आपके ब्राउज़र ने माइक्रोफ़ोन नहीं दिया। इसके बजाय ठीक करके टाइप करें।",
    noticeFixed: "सेव हो गया। पुराने जवाब से बना कुछ भी अब दोबारा बनाया जाएगा, पैच नहीं किया जाएगा।",
    noticeNever: "सेव हो गया। आपका AI अब हर जगह यह कहने से रोका गया है।",
    noticeSaved: "सेव हो गया।",
    errorLoad: "समीक्षा कतार पढ़ी नहीं जा सकी",
    errorSave: "वह फैसला सेव नहीं हो सका",
    errorCorrection: "वह सुधार सेव नहीं हो सका",
    errorRecording: "वह रिकॉर्डिंग सेव नहीं हो सकी",
    errorFill: "कतार भरी नहीं जा सकी",
    nothingRecorded: "कुछ भी रिकॉर्ड नहीं हुआ। बोलते समय बटन दबाए रखें।",
    addedWithGenerator: "{n} जोड़े गए। इस डिप्लॉयमेंट पर सवाल जनरेटर अभी उपलब्ध नहीं है, इसलिए केवल आपकी अपनी सामग्री इस्तेमाल हुई।",
    addedPlain: "{n} जोड़े गए।",
    blockedAnswerOne: "{n} रोका गया जवाब हर जगह लागू है।",
    blockedAnswerMany: "{n} रोके गए जवाब हर जगह लागू हैं।",
    flaggedRepliesOne: "फ़ॉलोअर्स ने {n} जवाब को फ़्लैग किया है।",
    flaggedRepliesMany: "फ़ॉलोअर्स ने {n} जवाबों को फ़्लैग किया है।",
  },

  payouts: {
    title: "पेआउट",
    intro: "महीने में एक स्टेटमेंट, एक नंबर जिसे आप अपनी बैंक लाइन से मिला सकते हैं: फॉलोअर्स ने क्या दिया, प्लेटफ़ॉर्म ने क्या रखा, टैक्स के लिए क्या रोका गया, और आप तक क्या पहुंचता है।",
    fundAccountLabel: "फंड अकाउंट रेफरेंस (आपके पेमेंट प्रोवाइडर से, यहां कभी बैंक की जानकारी न डालें)",
    save: "सेव करें",
    saving: "सेव हो रहा है...",
    fundAccountNote: "यह प्लेटफ़ॉर्म कभी आपका बैंक अकाउंट नंबर या UPI आईडी नहीं मांगता। आपका पेमेंट प्रोवाइडर अपना ऑनबोर्डिंग पूरा होते ही एक रेफरेंस जारी करता है, और यहां सिर्फ वही रेफरेंस सेव होता है।",
    saved: "फंड अकाउंट रेफरेंस सेव हो गया।",
    hideStatement: "स्टेटमेंट छुपाएं",
    showStatement: "स्टेटमेंट दिखाएं",
    gross: "कुल",
    platformTake: "प्लेटफ़ॉर्म का हिस्सा",
    tdsWithheld: "TDS रोका गया",
    netToYou: "आपको मिलने वाली राशि",
    followerSubsThisPeriod: "इस अवधि में फॉलोअर सदस्यताएं: {n}।",
    suiteShare: "{name} से एक Suite सीट हिस्सा शामिल है: {label}।",
    suiteShareNoName: "एक Suite सीट हिस्सा शामिल है: {label}।",
    tdsNote: "TDS वह दर दिखाता है जो प्लेटफ़ॉर्म ऑपरेटर ने सेट की है। अभी वह दर 0% है, इसलिए कुछ भी नहीं रोका जाता। ऑपरेटर मानता है कि भारत के इनकम टैक्स एक्ट की धारा 194J क्रिएटर के रूम की कमाई पर लागू होती है, लेकिन किसी अकाउंटेंट ने इसकी पुष्टि नहीं की है, और कोई असली पेआउट भेजे जाने से पहले यह दर बदल सकती है।",
    stateLine: "स्थिति: {label}",
    providerRef: ", प्रोवाइडर रेफरेंस {label}",
    settledLine: "सेटल हुआ: {label}",
    failureReasonLine: "असफलता का कारण: {label}",
    downloadJson: "JSON के रूप में डाउनलोड करें",
    downloadText: "टेक्स्ट के रूप में डाउनलोड करें",
    couldNotLoadStatement: "यह स्टेटमेंट लोड नहीं हो सका।",
    loadingStatement: "स्टेटमेंट लोड हो रहा है।",
    noPayoutYet: "अभी आपके लिए कोई पेआउट नहीं बना। कमाई के साथ कोई अवधि बंद होते ही यह भर जाता है।",
    stateLabel: {
      built: "बना, अभी भेजा नहीं गया",
      pending_account: "फंड अकाउंट का इंतज़ार",
      queued: "प्रोवाइडर के पास कतार में",
      sent: "भेजा गया",
      settled: "निपटाया गया",
      failed: "विफल",
    },
    netLabel: "{label} नेट - {label2}",
    statementDocTitle: "पेआउट स्टेटमेंट, {label}",
    statementDocBuilt: "बना",
  },

  checkins: {
    title: "चेक-इन",
    intro: "एक पेड फॉलोअर खुद इसमें शामिल होता है और अपना समय चुनता है; आपका AI उसी समय पर फॉलो-अप करता है, कभी इसलिए नहीं कि वे चुप हो गए। यहां जो जांचना है वह अपने AI के लिए एक नोट की तरह लिखें, कोई लाइन नहीं जो वह पढ़कर सुनाए; यह हर बार अपने ही शब्दों में कहेगा।",
    working: "हो रहा है...",
    pause: "रोकें",
    resume: "फिर शुरू करें",
    emptyList: "अभी तक कोई चेक-इन नहीं। यहां जोड़ा गया पहला चेक-इन ही वह है जिसमें कोई फॉलोअर शामिल हो सकता है।",
    titleLabel: "शीर्षक",
    titlePlaceholder: "शाम की सैर",
    shapeLabel: "क्या जांचना है (अपने AI के लिए एक नोट: यह इसे खुद अपने शब्दों में कहेगा)",
    shapePlaceholder: "पूछें कि क्या उन्होंने आज शाम की सैर की; हां हो तो थोड़ा जश्न मनाएं, न हो तो कोई शर्मिंदगी नहीं",
    cadenceLabel: "समय-संकेत (फॉलोअर को दिखता है, जैसे \"रोज़ाना\")",
    cadencePlaceholder: "रोज़ाना",
    saving: "सेव हो रहा है...",
    addCheckin: "चेक-इन जोड़ें",
  },

  handoff: {
    title: "हैंडऑफ़",
    intro: "डिफ़ॉल्ट रूप से बंद। जब यह चालू हो, तो एक फॉलोअर सीधे आपसे सुनने को कह सकता है - वे तय करते हैं कि क्या भेजा जाए, भेजने से पहले उसे शब्द दर शब्द देखते हैं, और आपका जवाब सिर्फ उनके अपने थ्रेड में पहुंचता है, आपके नाम से, कभी आपके AI के नाम से नहीं।",
    on: "चालू",
    off: "बंद",
    forThisRoom: "इस रूम के लिए",
    working: "हो रहा है...",
    turnOff: "बंद करें",
    turnOn: "चालू करें",
    capLabel: "एक फॉलोअर महीने में जितनी रिक्वेस्ट भेज सकता है (0-50)",
    waiting: "इंतज़ार में",
    answered: "जवाब दिया गया",
    whatTheySent: "उन्होंने जो भेजा, बिल्कुल वैसे ही जैसे भेजा",
    yourReply: "आपका जवाब",
    replyPlaceholder: "अपने शब्दों में जवाब दें - यह सिर्फ उन्हीं तक पहुंचता है, आपके नाम से।",
    sending: "भेजा जा रहा है...",
    sendReply: "जवाब भेजें",
    nothingWaiting: "अभी कुछ भी इंतज़ार में नहीं है।",
  },

  inviteCreator: {
    title: "एक क्रिएटर को न्योता दें",
    intro: "आप तीन और क्रिएटर को अपना AI बनाने के लिए न्योता दे सकते हैं। एक कोड एक बार चलता है, उस व्यक्ति के लिए जिसे आप देते हैं, और यह स्क्रीन ही एकमात्र जगह है जहां यह पूरा दिखता है।",
    publishFirst: "दूसरे क्रिएटर को न्योता देना शुरू करने के लिए अपना रूम पब्लिश करें।",
    copied: "कॉपी हो गया",
    copyCode: "कोड कॉपी करें",
    sendNow: "इसे अभी उस व्यक्ति को भेजें जिसे आप न्योता दे रहे हैं। यह दोबारा नहीं दिखाया जाएगा।",
    creating: "बनाया जा रहा है...",
    createCode: "न्योता कोड बनाएं",
    quota: "{n2} में से {n} इस्तेमाल हुए।",
    quotaExhausted: " आप तीनों इस्तेमाल कर चुके हैं।",
    usedAll: "आप तीनों न्योते इस्तेमाल कर चुके हैं, या आपका रूम अभी पब्लिश नहीं हुआ है।",
    stateLabel: {
      unused: "अभी इस्तेमाल नहीं हुआ",
      redeemed: "भुनाया गया",
      expired: "खत्म हो गया",
    },
  },

  inviteGate: {
    eyebrow: "फिलहाल सिर्फ न्योते से",
    headline: "जब तक पहले रूम हाथ से बनाए जा रहे हैं, Vyakti सिर्फ न्योते से खुलता है।",
    lede: "अगर यहां किसी ने आपको पहले ही कोड भेजा है, तो नीचे डालें। नहीं तो आप आवेदन कर सकते हैं, और हम संपर्क करेंगे।",
    codeLabel: "न्योता कोड",
    codePlaceholder: "XXXX-XXXX-XXXX",
    checking: "जांचा जा रहा है",
    continueLabel: "जारी रखें",
    noCodeYet: "अभी कोड नहीं है?",
    applyLink: "पहले रूम में से एक के लिए आवेदन करें",
  },

  suite: {
    title: "Suites",
    intro: "एक Suite एक संस्था है जो सीटों के लिए भुगतान करती है - हर रूम की एक सीट। कई रूम (एक कोच, एक टीचर, एक डॉक्टर) को एक ही रोस्टर में लाने के लिए एक बनाएं; एक एडमिन हर रूम के सिर्फ आंकड़े देखता है, कभी यह नहीं कि किसी फॉलोअर ने क्या कहा।",
    creating: "आपका Suite बनाया जा रहा है।",
    starting: "इसकी सीट सदस्यता शुरू की जा रही है।",
    seatsUsedAdmin: "{n2} में से {n} सीटें इस्तेमाल हुईं - आप इस Suite के एडमिन हैं",
    seatsUsedMember: "{n2} में से {n} सीटें इस्तेमाल हुईं - आप इसके सदस्य हैं",
    working: "हो रहा है...",
    inviteCreator: "एक क्रिएटर को न्योता दें",
    hideMembers: "सदस्य छुपाएं",
    showMembers: "सदस्य दिखाएं",
    hideMoney: "पैसे छुपाएं",
    showMoney: "पैसे दिखाएं",
    attachThisRoom: "इस रूम को जोड़ें",
    noSeatFree: "कोई सीट खाली नहीं",
    removeFromSuite: "इस रूम को इस Suite से हटाएं",
    loadingMembers: "सदस्य लोड हो रहे हैं।",
    memberAdmin: "एडमिन",
    memberCreator: "क्रिएटर",
    loadingMoney: "पैसे लोड हो रहे हैं।",
    seatsAtPrice: "{n} सीटें {label} प्रति महीना हर एक - स्थिति: {label2}।",
    willNotRenew: "{label} के बाद नवीनीकृत नहीं होगी। हर जुड़ा हुआ रूम तब तक अपनी सीट रखता है।",
    nextCharge: "अगला भुगतान: {label} को {label2}।",
    platformTake: "Vyakti का प्लेटफ़ॉर्म हिस्सा {n}% है, हर रूम की अपनी फॉलोअर कीमत जितना ही।",
    cancel: "रद्द करें",
    updateSeats: "सीटें अपडेट करें",
    noSubscriptionYet: "अभी कोई Suite सदस्यता नहीं है। जब तक एक शुरू नहीं होती, सीटें इस Suite की अपनी मुफ़्त सीट सीमा तक ही रहती हैं।",
    startSubscription: "Suite सदस्यता शुरू करें",
    noSuitesYet: "अभी कोई Suite नहीं है। नीचे एक बनाएं, या किसी Suite एडमिन के न्योते से जुड़ें।",
    newSuiteName: "नए Suite का नाम",
    namePlaceholder: "North Coaching",
    plan: "प्लान",
    planStarter: "Starter",
    planInstitute: "Institute",
    seats: "सीटें",
    saving: "सेव हो रहा है...",
    createSuite: "Suite बनाएं",
    joinSuite: "एक Suite से जुड़ें (एडमिन ने जो आईडी शेयर की, वह पेस्ट करें)",
    joinPlaceholder: "Suite आईडी",
    join: "जुड़ें",
    noticeCreated: "Suite बन गया। आप इसके एडमिन हैं।",
    inviteNotice: "इस Suite की आईडी क्रिएटर के साथ शेयर करें: {orgId}।",
    noticeJoined: "आप इस Suite से एक क्रिएटर के रूप में जुड़ गए हैं।",
    noticeAttached: "यह रूम अब इस Suite का हिस्सा है।",
    noticeDetached: "यह रूम अब उस Suite का हिस्सा नहीं है।",
    noticeSubscriptionStarted: "Suite सदस्यता शुरू हो गई।",
    noticeSeatsUpdated: "सीटें अपडेट हो गईं।",
    noticeWillNotRenewSimple: "मौजूदा अवधि खत्म होने के बाद नवीनीकृत नहीं होगी।",
    autoStartLiveStarted: "\"{name}\" लाइव है, और इसकी सीट सदस्यता शुरू हो गई है।",
    autoStartLivePending: "\"{name}\" लाइव है। जब सीटों के लिए भुगतान लेने के लिए तैयार हों, तब नीचे इसकी सदस्यता शुरू करें।",
  },
};

export const STUDIO_COPY_TABLE: Record<StudioLocale, StudioCopy> = { en: EN, hi: HI };

export type { StudioCopy };
