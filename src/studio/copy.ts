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

// ── suiteSeatLock: SuiteCard.tsx / site/suites.html (WS-R73) ───────────────
// Razorpay refuses a seat-quantity change outright on a UPI Autopay or
// Emandate subscription (`api/_payments/providers/razorpay.js`'s own
// WS-R73 addendum, quoted there). `mandateNote` is the disclosure shown
// BEFORE checkout, next to "Start Suite subscription" and on site/suites.html's
// own pricing section; `seatsLockedByMandate` is what SuiteCard.tsx shows
// instead of the generic error text when `updateOrgSeats` actually refuses
// with `org_seats_locked_by_mandate`, naming the same path the disclosure
// already promised (cancel it, keep working until the period ends, start a
// new one at the seat count needed).
interface SuiteSeatLockCopy {
  mandateNote: string;
  seatsLockedByMandate: string;
}

// ── roomStudio: RoomStudio.tsx's own chrome (WS-R61) ───────────────────────
// The Room address, publish switch, free/paid caps, price, money, stats,
// week-six cohorts and pulse. Never the five sub-cards it mounts
// (PayoutsCard/SuiteCard/CheckinsCard/HandoffCard/InviteCreatorCard) — those
// already have their own `*Copy` interfaces above, converted in WS-R52.
interface RoomStudioCopy {
  eyebrow: string;
  loadingTitle: string;
  checkingExists: string;
  setupTitle: string;
  setupIntro: string;
  settingUp: string;
  setupButton: string;
  liveTitle: string;
  liveIntro: string;
  statusPaused: string;
  statusLive: string;
  statusDraft: string;
  addressCardTitle: string;
  copied: string;
  copyLink: string;
  downloadStoryCard: string;
  partOf: string; // "Part of {label}."
  suiteCoversRoom: string; // "Your seat in {label} covers this Room."
  yourSuite: string; // fallback name when the Suite itself has none
  tierGroupAriaLabel: string;
  tierFreeLabel: string;
  working: string;
  upgradeToRoom: string; // "Upgrade to Room ({label}/mo)"
  upgradeToStudio: string; // "Upgrade to Studio ({label}/mo)"
  tierLabel: string; // "Your tier: {label}."
  tierRoom: string;
  tierStudio: string;
  willNotRenewOn: string; // " Will not renew after {label}."
  renewsOn: string; // " Renews on {label}."
  cancel: string;
  changeAddressLabel: string;
  saving: string;
  saveAddress: string;
  enterAddress: string;
  addressInvalid: string;
  willReadAs: string; // "Will read as {label}"
  telegramCardTitle: string;
  open: string;
  telegramNotConnected: string;
  ownSiteCardTitle: string;
  ownSiteIntro: string;
  embedSnippetAriaLabel: string;
  copySnippet: string;
  ownSiteFooter: string;
  publishCardTitlePublished: string;
  publishCardTitleUnpublished: string;
  publishing: string;
  publishButton: string;
  resume: string;
  pause: string;
  liveSince: string; // "Live since {label}. Anyone with your Room's address can join and start their own remembered relationship with your AI."
  recently: string;
  pausedNotice: string;
  listMyRoomTitle: string;
  listMyRoomIntro: string;
  oneLineDescriptionLabel: string;
  oneLineDescriptionPlaceholder: string;
  save: string;
  listedNote: string;
  notListedNote: string;
  publishFirstNote: string;
  removeFromDirectory: string;
  listMyRoom: string;
  freeFollowersTitle: string;
  freeFollowersIntro: string;
  freeMonthlyMessagesAriaLabel: string;
  roomLanguageTitle: string;
  roomLanguageIntro: string;
  defaultRoomLanguageAriaLabel: string;
  paidFollowersTitle: string;
  paidFollowersIntroPre: string; // "... plus voice replies when" (ROOM_VOICE) "is on. ..."
  paidFollowersIntroPost: string;
  messagesAMonthLabel: string;
  paidMonthlyMessagesAriaLabel: string;
  voiceMinutesAMonthLabel: string;
  paidMonthlyVoiceMinutesAriaLabel: string;
  priceTitle: string;
  priceIntro: string; // "... Between {min} and {max}. Vyakti keeps {pct}% ..."
  followerPriceAriaLabel: string;
  noPriceYet: string;
  moneyTitle: string;
  subscribers: string;
  leftThisMonth: string;
  yourShareThisMonth: string;
  noSubscribersYet: string;
  lastPayout: string; // "Last payout: {label} ({label2}), for {label3} to {label4}."
  noPayoutYet: string;
  howDoingTitle: string;
  noFollowersYet: string;
  followers: string;
  activeToday: string;
  messagesThisMonth: string;
  couldNotLoadCounts: string;
  weekSixTitle: string;
  weekSixIntro: string;
  noCohortsYet: string;
  weekOf: string; // "Week of {label}"
  noFollowersThatWeek: string;
  stillTalkingPct: string; // "{n}% still talking"
  notMeasurableUntil: string; // "Not measurable until {label}"
  notMeasurableYetVerdict: string;
  belowGateBand: string;
  aboveCategoryBand: string;
  betweenBand: string;
  cohortVerdictSentence: string; // "Your oldest measurable cohort, the week of {label}, returned {n}%. That is {label2}."
  soon: string;
  gateLine: string;
  couldNotLoadRetry: string;
  loading: string;
  pulseTitle: string;
  pulseIntro: string;
  pulseTopicsAriaLabel: string;
  removeTopicAriaLabel: string; // "Remove topic {label}"
  addTopicPlaceholder: string;
  add: string;
  notEnoughOptins: string;
  enoughOptinsNoBucket: string;
  suppressedOne: string; // "{n} combination was held back this week because showing them would have named someone."
  suppressedMany: string;
  showMe: string;
  noticeRoomSetup: string;
  noticeAddressSaved: string;
  noticeRoomLive: string;
  noticeResumed: string;
  noticeDefaultLocaleHi: string;
  noticeDefaultLocaleEn: string;
  noticeBioSaved: string;
  noticeListed: string;
  noticeUnlisted: string;
  noticeFreeCap: string; // "Free followers now get {n} messages a month."
  noticePaidCeilings: string; // "Paid followers now get {n} messages and {n2} voice minutes a month."
  noticePrice: string; // "Followers now pay {label} a month."
  noticeTierStarted: string;
  noticeTierCancel: string;
  // WS-R75 (migration 119). Retention: off by default, an integer floor
  // when on.
  dormancyTitle: string;
  dormancyIntro: string;
  dormancyFloorNote: string; // "Minimum {n} days."
  dormancyOff: string;
  dormancyDaysAriaLabel: string;
  noticeDormancyOn: string; // "Kept for {n} days after a follower's last visit."
  noticeDormancyOff: string;
}

// ── videoLinkMount: VideoLinkMount.tsx (WS-R61) ────────────────────────────
interface VideoLinkMountCopy {
  eyebrow: string;
  title: string;
  blurb: string;
  noBoxNote: string;
  worksTodayNote: string;
}

// ── runtimeGate: RuntimeGate.tsx (WS-R61). Launch gate labels + chrome ────
interface RuntimeGateCopy {
  labels: Record<
    | "self_replica_only"
    | "replica_not_ready"
    | "self_identity_not_bound"
    | "adult_verification_required"
    | "identity_verification_required"
    | "liveness_verification_required"
    | "inference_consent_required"
    | "person_profile_not_approved"
    | "calibration_not_approved"
    | "voice_genome_not_approved"
    | "voice_not_ready"
    | "production_voice_required"
    | "qualification_incomplete",
    string
  >;
  eyebrow: string;
  title: string;
  intro: string;
  sealActive: string;
  sealSealed: string;
  sealSubActive: string;
  sealSubSealed: string;
  checkingGates: string;
  retry: string;
  qualificationSuitesPassed: string;
  whatWeLearnedVersion: string;
  calibrationVersion: string;
  voiceVersion: string;
  gatesClosedOne: string; // "{n} launch gate still closed"
  gatesClosedMany: string;
  actionNote: string;
  freezing: string;
  runtimeActive: string;
  activateButton: string;
  readinessUnavailable: string;
  activationRefused: string;
}

// ── turnFeedback: TurnFeedback.tsx (WS-R61) ────────────────────────────────
interface TurnFeedbackCopy {
  dimensionLabel: Record<"wording" | "behavior" | "relationship" | "memory" | "delivery" | "voice_identity", string>;
  dimensionDescription: Record<"wording" | "behavior" | "relationship" | "memory" | "delivery" | "voice_identity", string>;
  ratingLabel: Record<"exact" | "close" | "off", string>;
  reasonLabel: Record<
    | "too_generic"
    | "wrong_fact"
    | "wrong_relationship"
    | "wrong_tone"
    | "wrong_wording"
    | "too_long"
    | "too_short"
    | "voice_mismatch"
    | "emotion_mismatch"
    | "unsafe_or_boundary"
    | "other",
    string
  >;
  playVoiceFirst: string;
  savedRevision: string; // "Revision {n} secured"
  didThisFeelLikeYou: string;
  thisIsMe: string;
  tuneThis: string;
  teachDifference: string;
  close: string;
  gradeOnlyNote: string;
  whatMissed: string;
  correctionLabel: string;
  correctionOptionalNote: string;
  correctionPlaceholder: string;
  layersRatedOne: string; // "{n} layer rated"
  layersRatedMany: string;
  chooseAtLeastOne: string;
  securing: string;
  saveEvidence: string;
  errorFallback: string;
}

// ── replicaDialogueLab: ReplicaDialogueLab.tsx (WS-R61) ────────────────────
interface ReplicaDialogueLabCopy {
  eyebrow: string;
  title: string;
  intro: string;
  statusPrivateLive: string;
  statusSealed: string;
  lockedHeadline: string;
  lockedNote: string;
  stopVoice: string;
  playProtectedVoice: string;
  emptyHeadline: string;
  emptyNote: string;
  thinking: string;
  messageLabel: string;
  messagePlaceholder: string;
  sendPrivately: string;
  dismiss: string;
  trustNote: string;
  errorReadinessUnavailable: string;
  errorReconcileRequired: string;
  errorCouldNotAnswer: string;
  errorVoicePlayback: string;
}

// ── calibrationStudio: CalibrationStudio.tsx (WS-R61) ──────────────────────
interface CalibrationStudioCopy {
  layers: Record<"delivery" | "language" | "behaviour" | "memory" | "relationship", string>;
  blockers: Record<
    | "approved_person_profile_required"
    | "delivery_calibration_required"
    | "language_calibration_required"
    | "behaviour_calibration_required"
    | "memory_calibration_required"
    | "relationship_calibration_required"
    | "calibration_depth_required",
    string
  >;
  eyebrow: string;
  title: string;
  intro: string;
  approvedPolicyLabel: string;
  preparingContrasts: string;
  retry: string;
  contrastsReviewedAriaLabel: string; // "{n} of {n2} contrasts reviewed"
  contrastsReviewed: string;
  calibrationScenariosAriaLabel: string;
  openContrastAriaLabel: string; // "Open {label} contrast {n}"
  orWord: string;
  bothFeelLikeMe: string;
  neitherIsMe: string;
  freeTextNote: string;
  checkingChoices: string;
  approveCalibrationVersion: string; // "Approve calibration v{n}"
  buildingPolicy: string;
  buildCalibrationPolicy: string;
  errorCouldNotLoad: string;
  errorChoiceNotSaved: string;
  errorBuildRefused: string;
  errorApproveChanged: string;
}

// ── candidateEvaluationLab: CandidateEvaluationLab.tsx (WS-R61) ────────────
interface CandidateEvaluationLabCopy {
  dimensionCopy: Record<"overall" | "wording" | "behavior" | "relationship" | "memory" | "delivery", { label: string; hint: string }>;
  choiceLabel: Record<"a" | "tie" | "b", string>;
  loadErrorFallback: string;
  eyebrow: string;
  title: string;
  intro: string;
  sealAriaLabel: string;
  blindedLabel: string;
  mappingNote: string;
  loadingAriaLabel: string;
  comparisonUnavailable: string;
  tryAgain: string;
  emptyHeadline: string;
  emptyNote: string;
  completeHeadline: string;
  completeNote: string; // "{n} comparisons are sealed. Safety, privacy, and statistical gates decide whether this candidate can advance."
  comparisonOfLabel: string; // "Comparison {n} of {n2}"
  sealedCountLabel: string; // "{n} sealed"
  situationLabel: string;
  optionsAriaLabel: string;
  anonymousOutput: string;
  orWord: string;
  judgeEveryLayer: string;
  judgeInstruction: string;
  layersJudged: string; // "{n} of {n2} layers judged"
  sealingComparison: string;
  sealAndContinue: string;
}

// ── processingReview: ProcessingReview.tsx (WS-R61). `SELF_TEST_NOTICE`'s own
//    `headline`/`next` (built via `blockerClass.ts`'s `disabledReason`) stay
//    English per `ws-r52-class-labels-split-from-blockerclass-ts-own-copy` --
//    only its two-word class badge substitutes `t.classLabels` on screen,
//    same as BlockerNotice.tsx/WizardRail.tsx already do. Everything else on
//    this screen is this workstream's own chrome and moves here in full. ────
interface ProcessingReviewCopy {
  reasonLabel: Record<
    "accepted" | "rejected" | "superseded",
    Record<string, string>
  >;
  recently: string;
  contentWithheld: string;
  needsReview: string;
  reviewAriaLabel: string; // "Review {label}"
  decisionSelectLabel: string;
  reasonSelectLabel: string;
  optionAccept: string;
  optionReject: string;
  optionSupersede: string;
  saving: string;
  recordReview: string;
  decisionWithheldNote: string;
  confidenceNotReported: string;
  confidencePct: string; // "{n}% confidence"
  endpointSuffix: string; // " · {n}s endpoint"
  unreportedFamily: string;
  unreportedAdapter: string;
  eyebrow: string;
  title: string;
  refreshing: string;
  refresh: string;
  intro: string;
  loadingReceipts: string;
  emptyHeadline: string;
  emptyNote: string;
  sourceTitle: string; // "{label} source"
  pipelineStepOne: string; // "{n} pipeline step"
  pipelineStepMany: string;
  derivedVariantOne: string;
  derivedVariantMany: string;
  evidenceRecordOne: string;
  evidenceRecordMany: string;
  pipelineStepsAriaLabel: string;
  noPipelineAttempt: string;
  attemptLabel: string; // "attempt {n}"
  selectedVoiceBadge: string;
  opening: string;
  listenPrivately: string;
  selecting: string;
  selected: string;
  useThisVoice: string;
  cannotPlayAudio: string;
  linkExpiresNote: string;
  noReviewableEvidence: string;
  draftOnlyEyebrow: string;
  voiceBuildGateTitle: string;
  voiceBuildGateIntro: string;
  acousticFamilies: string;
  voiceMeasurements: string;
  qualityMeasurements: string;
  speakerSegments: string;
  queueingDraft: string;
  queueDraftVoice: string;
  buildLedger: string;
  immutableDraftLedger: string;
  voiceVersionStatus: string; // "Voice version {n}, {label}"
  voicePrintFamiliesDetail: string; // "{n} independent voice-print families"
  targetSegmentsDetail: string; // "{n} target segments"
  enrollmentArtifactsDetail: string; // "{n} private enrollment artifacts"
  draftsCannotSynthesize: string;
  errorProcessingUnavailable: string;
  errorDecisionNotRecorded: string;
  errorDraftNotQueued: string;
  errorAuditionNotOpened: string;
  errorCandidateNotSelected: string;
  noticeReviewRecorded: string;
  noticeCandidateSelected: string;
  noticeDraftQueued: string;
}

// ── personModelStudio: PersonModelStudio.tsx (WS-R61) ──────────────────────
interface PersonModelStudioCopy {
  blockers: Record<
    | "self_name_required"
    | "language_identity_required"
    | "behavior_evidence_required"
    | "boundary_evidence_required"
    | "critical_identity_conflict",
    string
  >;
  extractionBlockers: Record<
    "transcription_consent_required" | "training_consent_required" | "reviewed_subject_transcript_required",
    string
  >;
  confidencePct: string; // "{n}% confidence"
  citedSourceOne: string; // "{n} cited source"
  citedSourceMany: string;
  keepOut: string;
  notAccurate: string;
  outdated: string;
  thisIsMe: string;
  reviewClaimAriaLabel: string;
  eyebrow: string;
  title: string;
  intro: string;
  approvedVersionLabel: string;
  loadingClaims: string;
  retry: string;
  proposedClaims: string;
  accepted: string;
  criticalConflicts: string;
  citedExtractionEyebrow: string;
  citedExtractionTitle: string;
  citedExtractionIntro: string;
  eligibleSpans: string;
  lastProposed: string;
  noExtractionRunYet: string;
  extractingPrivately: string;
  extractNewEvidence: string;
  extractCitedClaims: string;
  noClaimsHeadline: string;
  noClaimsNote: string;
  buildIsDeterministicNote: string;
  checkingEvidence: string;
  approveProfileVersion: string; // "Approve profile v{n}"
  building: string;
  buildReviewDraft: string;
  errorExtractionUnavailable: string;
  errorProfileUnavailable: string;
  errorClaimNotSaved: string;
  errorBuildRefused: string;
  errorApproveChanged: string;
  errorExtractionFailed: string;
}

// ── showcase: ShowcaseCard.tsx (WS-R66) ─────────────────────────────────────
interface ShowcaseCopy {
  title: string;
  intro: string;
  publishFirst: string;
  slotLabel: string; // "Slot {n} of 5"
  questionPlaceholder: string;
  answerPlaceholder: string;
  save: string;
  saving: string;
  remove: string;
  removing: string;
  removed: string;
  saved: string;
  copyViolation: string;
}

// ── creatorExport: the "Download everything" control (WS-R70), next to the
//    account surface's existing revoke/erasure control. ─────────────────
interface CreatorExportCopy {
  eyebrow: string;
  title: string;
  body: string;
  button: string;
  downloading: string;
  rateLimited: string;
  error: string;
  done: string;
}

// ── creatorPush: "This week on your phone" (WS-R74, migration 118) ─────────
interface CreatorPushCopy {
  title: string;
  intro: string;
  notConfigured: string;
  turnOn: string;
  turnOff: string;
  error: string;
}
// ── showcasePicker: ShowcaseCard.tsx's "Pick from your reviews" (WS-R72,
//    closes ws-r66-showcase-card-picker-ui-not-built-v0). A closed block of
//    its own rather than new keys inside `ShowcaseCopy` above, so a sibling
//    workstream editing that section's object literal never collides with
//    this one on the same lines. ───────────────────────────────────────────
interface ShowcasePickerCopy {
  pickButton: string;
  pickTitle: string;
  pickEmpty: string;
  pickLoading: string;
  pickError: string;
  pickUse: string;
  pickCancel: string;
}

// ── reviewQueueFlags: ReviewQueue.tsx's flagged-reply card actions (WS-R72,
//    wires the client-only neverRuleFromFlag from WS-R67 and adds "Sounds
//    right anyway"). Its own closed block for the same reason as the one
//    above; the button label and success notice for "Never say this" are
//    NOT repeated here, that card reuses `reviewQueue.buttonNever` and
//    `reviewQueue.noticeNever` verbatim, one sentence, one place to change
//    it. ───────────────────────────────────────────────────────────────────
interface ReviewQueueFlagsCopy {
  flagsTitle: string;
  timesOne: string; // "Flagged {n} time."
  timesMany: string; // "Flagged {n} times."
  reasonsLabel: string; // "Reasons: {label}"
  reasonWrong: string;
  reasonHarmful: string;
  reasonNotThem: string;
  reasonOther: string;
  soundsRightAnyway: string;
  dismissing: string;
  dismissed: string;
  errorAction: string;
}
// ── poster: the printable poster link in the Share tab (WS-R78), next to
//    the existing story-card download. ───────────────────────────────────
interface PosterCopy {
  download: string;
}
// ── shareKit: ShareKitCard.tsx (WS-R85, migration 122). Four rows -
//    WhatsApp, Instagram, YouTube, Telegram - each with the exact text and
//    link a creator copies. The four TEMPLATE strings are the canonical
//    source `api/_share-kit.js`'s own `SHARE_KIT_COPY` restates byte for
//    byte (`evals/share-kit/run.mjs`'s own parity section proves it against
//    the real bundled export, `TASTE_COPY`'s own shape one file over) -
//    the creator SEES this exact text before they copy it, so it lives with
//    the rest of the Share tab's own chrome rather than only server-side.
//    Every template carries exactly two holes, "{name}" and "{url}". ───────
interface ShareKitCopy {
  title: string;
  intro: string;
  loading: string;
  whatsappLabel: string;
  instagramLabel: string;
  youtubeLabel: string;
  telegramLabel: string;
  copy: string;
  copied: string;
  openWhatsapp: string;
  viewPicture: string;
  notPublishedYet: string;
  whatsappTemplate: string; // "{name}", "{url}"
  instagramTemplate: string; // "{name}", "{url}"
  youtubeTemplate: string; // "{name}", "{url}"
  telegramTemplate: string; // "{name}", "{url}"
}

// ── activityPanel: ActivityPanel.tsx (WS-R71, tier 2 wave two). Server-sent
//    fields (`job.state_reason`, `lane.label`, `lane.missing`,
//    `job.next_action.label`, `job.progress.unit`) stay English -- this
//    workstream's own carve-out, `copy.ts`'s file header's law 1: they are
//    authored by `api/_activity.js` and arrive over the wire regardless of
//    what this file says, the same reason `ReadinessPanel.tsx`'s
//    `part.label`/`part.detail` stay untranslated. ─────────────────────────
interface ActivityPanelCopy {
  groupYourTurn: string;
  groupWorkingNow: string;
  groupStopped: string;
  groupFinished: string;
  feedTitle: string;
  feedLede: string;
  meetTitle: string;
  meetLede: string;
  justNow: string;
  minutesAgo: string; // "{n}"
  hourAgoOne: string;
  hoursAgoMany: string; // "{n}"
  dayAgoOne: string;
  daysAgoMany: string; // "{n}"
  stepsDoneAriaLabel: string; // "{n} of {n2} steps done"
  notConnectedTitle: string; // "{label}: not connected yet."
  notConnectedBody: string;
  notConnectedMissingLabel: string;
  loadingGroupName: string;
  emptyState: string;
  ofCount: string; // "{n} of {n2}"
  doneLabel: string;
  retryingLabel: string;
  errorCouldNotRead: string;
  errorRetryFailed: string;
  errorAlreadyMoved: string;
}

// ── channelsStudio: ChannelsStudio.tsx (WS-R71, tier 2 wave two). ─────────
interface ChannelsStudioCopy {
  eyebrow: string;
  title: string;
  intro: string;
  embedCardTitle: string;
  embedCardBody: string;
  embedSnippetAriaLabel: string;
  copyEmbedCode: string;
  copiedLabel: string;
  disclosureNote: string;
  loadingChannels: string;
  statusLabel: string;
  notSetUp: string;
  webWidgetTitle: string;
  webWidgetRefLabel: string;
  webWidgetBlurb: string;
  webWidgetCost: string;
  telegramTitle: string;
  telegramRefLabel: string;
  telegramSecretLabel: string;
  telegramBlurb: string;
  telegramCost: string;
  whatsappTitle: string;
  whatsappRefLabel: string;
  whatsappSecretLabel: string;
  whatsappBlurb: string;
  whatsappCost: string;
  statusDraft: string;
  statusConnected: string;
  statusPaused: string;
  statusRevoked: string;
  secretOnFile: string;
  secretVaultNote: string;
  saving: string;
  update: string;
  connect: string;
  pause: string;
  resume: string;
  retire: string;
  retiredNote: string;
  instagramTitle: string;
  instagramNotOffered: string;
  instagramWhatMetaRequiresLabel: string;
  instagramRequirement: string;
  instagramNoFakeButton: string;
  liveNotice: string;
  draftNotice: string;
  errorRequestFailed: string;
}

// ── teacherSheetStudio: TeacherSheetStudio.tsx (WS-R71, tier 2 wave two).
//    STRICTNESS_LABELS/WARMTH_LABELS are the creator's own confirmed
//    self-description, not server-authored prose, so they move here in
//    full, matching `ws-r61-roomstudio-money-and-tds-copy-translated-
//    meaning-preserved`'s own "translate meaning, not just chrome" law. ────
interface TeacherSheetStudioCopy {
  eyebrow: string;
  title: string; // "Review and confirm how {name} teaches"
  titleFallbackName: string;
  intro: string;
  loadSavedDraft: string;
  provenanceSeedNotice: string;
  serviceUnavailableNotice: string;
  subjectCardTitle: string;
  subjectLabel: string;
  subjectPhysics: string;
  subjectChemistry: string;
  subjectMaths: string;
  scopeLabel: string;
  chapterNote: string;
  chapterCoverageAriaLabel: string;
  strictnessCardTitle: string;
  strictnessWarmthNote: string;
  strictnessLabel: string;
  strictness0: string;
  strictness1: string;
  strictness2: string;
  strictness3: string;
  strictness4: string;
  warmthLabel: string;
  warmth0: string;
  warmth1: string;
  warmth2: string;
  warmth3: string;
  warmth4: string;
  ladderCardTitle: string;
  ladderNote: string;
  removeRungAriaLabel: string; // "{n}"
  removeRung: string;
  addRungPlaceholder: string;
  addRung: string;
  boundariesCardTitle: string;
  boundariesNote: string;
  identityLifeLabel: string;
  mentorBoundaryLabel: string;
  ingestedTitleDraft: string;
  ingestedTitleEmpty: string;
  ingestedNoteDraft: string;
  ingestedNoteEmpty: string;
  ingestedStatusDraft: string;
  ingestedStatusEmpty: string;
  languageVoiceRuleLabel: string;
  sttSoundAlikesLabel: string;
  boardVerbalismsLabel: string;
  notationConventionsLabel: string;
  analogyBankLabel: string;
  commonMistakeBankLabel: string;
  commonMistakeBankSummary: string; // "{n}"
  publishNote: string;
  saved: string;
  savedLocalOnly: string;
  saving: string;
  save: string;
}

// ── voicePreviewLab: VoicePreviewLab.tsx (WS-R71, tier 2 wave two). The
//    calibration bench: blind A/B preference pairs and a held-out unseen-
//    speech gate. `context/decisions.md#ws-r71-voice-lab-vocabulary` names
//    the plain-Hindi choices for "workbench"/"condition"/"holdout"/"trial". ─
interface VoicePreviewLabCopy {
  title: string;
  intro: string;
  checking: string;
  refreshDraft: string;
  draftVersionLabel: string; // "{n}"
  draftRequired: string;
  identityModelsBound: string; // "{n}"
  reviewFirst: string;
  languageLegend: string;
  languageEnglish: string;
  languageHindi: string;
  whatShouldDraftSay: string;
  charactersLeft: string; // "{n}"
  disclosureAddedNote: string;
  deliveryLegend: string;
  styleFaithfulLabel: string;
  styleFaithfulCopy: string;
  styleBalancedLabel: string;
  styleBalancedCopy: string;
  styleExpressiveLabel: string;
  styleExpressiveCopy: string;
  protectingPreview: string;
  generatePreview: string;
  coldStartNotice: string;
  yourProtectedDraft: string;
  listenOnceNote: string;
  audioFallback: string;
  disclosureRowLabel: string;
  disclosureRowValue: string;
  watermarksRowLabel: string;
  provenanceRowLabel: string;
  provenanceRowValue: string;
  receiptLine: string; // "{n}" "{n2}"
  roomReady: string;
  noDraftYet: string;
  chooseWordsNote: string;
  needRecordingNote: string;
  proofOwnerOnly: string;
  proofSelfOnly: string;
  proofNoRuntimeAccess: string;
  preferenceLabTag: string;
  preferenceLabHeading: string;
  preferenceLabIntro: string;
  renderingAB: string;
  newBlindPair: string;
  startBlindAB: string;
  adaptiveComparisonLabel: string; // "{n}"
  conditionsCoveredLabel: string; // "{n}" "{n2}"
  promptFamiliesLabel: string; // "{n}" "{n2}"
  boundaryConverged: string;
  stillLearning: string;
  challengeSuffix: string;
  candidateLetterA: string;
  candidateLetterB: string;
  protectedCandidateLabel: string;
  completedLabel: string;
  listenFullyNote: string;
  audioCandidateFallback: string;
  preferenceSecured: string;
  choiceNeither: string;
  choiceTie: string;
  choiceCloser: string;
  conditionSummary: string; // "{label}" "{label2}"
  evidenceLine: string; // "{n}"
  whatSeparatedThem: string;
  optionalLabel: string;
  chooseCloserAriaLabel: string;
  aIsCloser: string;
  bIsCloser: string;
  both: string;
  neither: string;
  finishBothToUnlock: string;
  buildingTwoTakes: string;
  noComparisonOpen: string;
  voiceDeliveryTag: string;
  versionFrozen: string; // "{n}"
  buildDeliveryCandidate: string;
  championBoundNote: string; // "{label}" "{n}"
  candidateCreatedNote: string;
  comparisonsLabel: string; // "{n}"
  conditionsFractionLabel: string; // "{n}" "{n2}"
  promptsFractionLabel: string; // "{n}" "{n2}"
  freezingEvidence: string;
  freezeUpdatedVersion: string;
  freezeDeliveryCandidate: string;
  moreEvidenceRequired: string;
  freezingDoesNotActivate: string;
  unseenSpeechTag: string;
  unseenSpeechHeading: string;
  unseenSpeechIntro: string;
  heldOutJudgmentsLabel: string;
  holdoutChallengeSuffix: string;
  heldOutCandidateLabel: string;
  listenFully: string;
  heldOutJudgmentSecured: string;
  startNextCellNote: string;
  chooseCloserHeldOutAriaLabel: string;
  ownerHoldoutPassed: string;
  ownerHoldoutFailed: string;
  notProductionQualificationNote: string;
  securingTrial: string;
  nextUnseenPair: string;
  startHeldOutAB: string;
  finalizeOwnerGate: string;
  conditionIdentityAnchor: string;
  conditionFaithful: string;
  conditionSteadyWarm: string;
  conditionBalanced: string;
  conditionWarmExpressive: string;
  conditionExpressive: string;
  conditionAnimated: string;
  fallbackConditionA: string;
  fallbackConditionB: string;
  fallbackLearnedDelivery: string;
  reasonIdentity: string;
  reasonAccent: string;
  reasonRhythm: string;
  reasonEmotion: string;
  reasonNaturalness: string;
  reasonPronunciation: string;
  reasonFewerArtifacts: string;
  errorStatusUnavailable: string;
  errorPreviewNotGenerated: string;
  errorComparisonNotGenerated: string;
  errorPreferenceNotSecured: string;
  errorDeliveryNotFrozen: string;
  errorHeldOutNotGenerated: string;
  errorHeldOutJudgmentNotSecured: string;
  errorHeldOutResultNotFinalized: string;
}

// ── voicePreviewPanel: VoicePreviewPanel.tsx (WS-R71, tier 2 wave two).
//    "Preview my voice" -- the first, simple box, distinct from the
//    calibration bench above (`voicePreviewLab`). `WELCOME`/`LANGUAGE_
//    OPTIONS`' own sample greetings are what the AI SAYS, not studio chrome,
//    and stay exactly as the component already has them; only the label/
//    help text describing each language choice moves here. ────────────────
interface VoicePreviewPanelCopy {
  eyebrow: string;
  title: string;
  introTest: string;
  introReal: string;
  languageLegend: string;
  languageHindiLabel: string;
  languageHindiHelp: string;
  languageHinglishLabel: string;
  languageHinglishHelp: string;
  languageEnglishLabel: string;
  languageEnglishHelp: string;
  yourLine: string;
  charactersLeftTest: string; // "{n}"
  charactersLeftReal: string; // "{n}"
  disabledCheckingHeadline: string;
  disabledCheckingNext: string;
  disabledBusyWarming: string;
  disabledBusyGenerating: string;
  disabledBusyNext: string;
  disabledEmptyHeadline: string;
  disabledEmptyNext: string;
  disabledOverLimitHeadline: string; // "{n}"
  disabledOverLimitNext: string;
  buttonGenerating: string;
  buttonWaking: string;
  buttonAnotherTake: string;
  buttonPreview: string;
  stateReady: string;
  listenToThisTake: string;
  audioFallback: string;
  pronunciationPlanSummary: string; // "{n}"
  spokenAsLabel: string;
  originalTextUnchangedNote: string; // "{n}"
  disclosureRowLabel: string;
  disclosureRowValue: string;
  watermarkRowLabel: string;
  watermarkRowValue: string;
  notRightYet: string;
  editLineNote: string;
  editLine: string;
  receiptLine: string; // "{n}" "{n2}"
  stateWarming: string;
  runtimeStarting: string;
  nextCheckLabel: string;
  coldStartEstimateTitle: string;
  coldStartEstimateLabel: string; // "{n}" "{n2}"
  checkCompleteNote: string; // "{n}"
  keepWorkingNote: string;
  stateGenerating: string;
  makingYourTake: string;
  renderingTest: string;
  renderingReal: string;
  stateFailed: string;
  previewStopped: string;
  tryAgain: string;
  stateIdle: string;
  takeAppearsHere: string;
  chooseLanguageNote: string;
  firstWaitNote: string;
  runtimeNotWokenHeadline: string;
  ownerReportTooManyTimes: string; // "{n}" "{n2}"
}

// ── voiceExperimentPanel: VoiceExperimentPanel.tsx (WS-R71, tier 2 wave
//    two). The blind listening pack: an owner-run experiment sealed against
//    candidate identity until ratings lock. Every technical-vocabulary
//    choice here follows the SAME plain-Hindi law
//    `context/decisions.md#ws-r71-voice-lab-vocabulary` states for
//    `voicePreviewLab` -- "trial", "sealed pack", "listener sheet". ────────
interface VoiceExperimentPanelCopy {
  kindPack: string;
  kindRatings: string;
  kindResult: string;
  errorCleanupFailed: string;
  errorMappingLeak: string;
  errorBindingMismatch: string; // "{kind}"
  errorSizeLimit: string; // "{kind}"
  errorIntegrityCheck: string;
  errorNoSignature: string;
  errorNotValidExport: string; // "{kind}"
  errorAudioCouldNotStart: string;
  errorStorageFailedRemoving: string;
  removeConfirm: string;
  summaryTitle: string;
  summarySubtitle: string;
  statusIdentitiesUnlocked: string;
  statusRatingsLocked: string;
  statusReadyToLock: string;
  statusRatedCount: string; // "{n}" "{n2}"
  statusNoExperiment: string;
  dismiss: string;
  openSealedPackTitle: string;
  openSealedPackBody: string;
  checkingPack: string;
  chooseSealedPack: string;
  identitiesUnlockedTitle: string;
  acceptedListenerNote: string; // "{n}"
  signatureVerified: string;
  languageHindi: string;
  languageEnglish: string;
  meanLabel: string;
  noMean: string;
  noneLabel: string;
  noPromotionNote: string;
  learnOwnerVoiceTitle: string;
  headphonesNote: string;
  playOwnerAgain: string;
  playRealOwner: string;
  startBlindRating: string;
  ratingsLockedTitle: string;
  ratingsLockedBody: string;
  savedLocally: string;
  exportBeforeLeaving: string;
  exportLockedRatings: string;
  importUnsealedReport: string;
  privateGateCommandsSummary: string;
  privateGateCommandsNote: string;
  progressBarAriaLabel: string;
  progressAriaValueText: string; // "{n}" "{n2}"
  listeningCheck: string;
  positionLabel: string; // "{n}" "{n2}"
  playHiddenClipAgain: string;
  playHiddenClip: string;
  clipHeard: string;
  playBeforeRating: string;
  axisScaleLabel: string; // "{n}" "{n2}"
  axisButtonAriaLabel: string; // "{label}" "{n}"
  disclosureLegend: string;
  noteQuestion: string;
  playCheckAgain: string;
  playCheck: string;
  attentionPrompt: string;
  back: string;
  savingPack: string;
  progressSavedLocally: string;
  exportProgressBeforeLeaving: string;
  lockRatings: string;
  saveAndContinue: string;
  lockIrreversibleNote: string;
  exportProgress: string;
  importProgress: string;
  replaceClearsNote: string;
  working: string;
  replacePack: string;
  removePrivateExperiment: string;
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
  creatorExport: CreatorExportCopy;
  handoff: HandoffCopy;
  inviteCreator: InviteCreatorCopy;
  inviteGate: InviteGateCopy;
  suite: SuiteCopy;
  roomStudio: RoomStudioCopy;
  videoLinkMount: VideoLinkMountCopy;
  runtimeGate: RuntimeGateCopy;
  turnFeedback: TurnFeedbackCopy;
  replicaDialogueLab: ReplicaDialogueLabCopy;
  calibrationStudio: CalibrationStudioCopy;
  candidateEvaluationLab: CandidateEvaluationLabCopy;
  processingReview: ProcessingReviewCopy;
  personModelStudio: PersonModelStudioCopy;
  showcase: ShowcaseCopy;
  suiteSeatLock: SuiteSeatLockCopy;
  creatorPush: CreatorPushCopy;
  showcasePicker: ShowcasePickerCopy;
  reviewQueueFlags: ReviewQueueFlagsCopy;
  poster: PosterCopy;
  activityPanel: ActivityPanelCopy;
  channelsStudio: ChannelsStudioCopy;
  teacherSheetStudio: TeacherSheetStudioCopy;
  voicePreviewLab: VoicePreviewLabCopy;
  voicePreviewPanel: VoicePreviewPanelCopy;
  voiceExperimentPanel: VoiceExperimentPanelCopy;
  shareKit: ShareKitCopy;
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

  roomStudio: {
    eyebrow: "Your Room",
    loadingTitle: "Loading your Room",
    checkingExists: "Checking whether your Room exists yet.",
    setupTitle: "Set up the place your AI lives",
    setupIntro:
      "A Room is a private, continuing address for every follower who talks to your AI. It remembers each " +
      "of them, on its own, and never shows one follower to another. Set it up once, then publish it when " +
      "the gates below are clear.",
    settingUp: "Setting up...",
    setupButton: "Set up your Room",
    liveTitle: "The place your AI lives",
    liveIntro:
      "One private, continuing address. Every follower who joins gets their own remembered relationship with " +
      "your AI, and none of them ever sees another follower's conversation, or yours.",
    statusPaused: "Paused",
    statusLive: "Live",
    statusDraft: "Not published",
    addressCardTitle: "Your Room's address",
    copied: "Copied",
    copyLink: "Copy link",
    downloadStoryCard: "Download story card",
    partOf: "Part of {label}.",
    suiteCoversRoom: "Your seat in {label} covers this Room.",
    yourSuite: "your Suite",
    tierGroupAriaLabel: "Tier",
    tierFreeLabel: "Your tier: free capacity.",
    working: "Working...",
    upgradeToRoom: "Upgrade to Room ({label}/mo)",
    upgradeToStudio: "Upgrade to Studio ({label}/mo)",
    tierLabel: "Your tier: {label}.",
    tierRoom: "Room",
    tierStudio: "Studio",
    willNotRenewOn: " Will not renew after {label}.",
    renewsOn: " Renews on {label}.",
    cancel: "Cancel",
    changeAddressLabel: "Change the address",
    saving: "Saving...",
    saveAddress: "Save address",
    enterAddress: "Enter an address for your Room.",
    addressInvalid: "Between 3 and 40 letters, numbers, or dashes.",
    willReadAs: "Will read as {label}",
    telegramCardTitle: "Your Room on Telegram",
    open: "Open",
    telegramNotConnected:
      "Not connected yet. Followers still reach your Room at the address above; Telegram is a second way in, " +
      "not a requirement.",
    ownSiteCardTitle: "On your own site",
    ownSiteIntro:
      "Paste this into any page you control: a coaching site, a Linktree, a blog post. It shows one button " +
      "with your Room's disclosure beneath it, and opens your Room in a new tab when a visitor clicks it. It " +
      "sets no cookie and asks nothing of your visitors.",
    embedSnippetAriaLabel: "Embed snippet",
    copySnippet: "Copy snippet",
    ownSiteFooter:
      "Visitors see the disclosure in whichever language your Room shows first, English or Hindi, and this " +
      "button never places your Room inside their page. It always opens your Room's own address.",
    publishCardTitlePublished: "Publishing",
    publishCardTitleUnpublished: "Publish your Room",
    publishing: "Publishing...",
    publishButton: "Publish your Room",
    resume: "Resume",
    pause: "Pause",
    liveSince:
      "Live since {label}. Anyone with your Room's address can join and start their own remembered " +
      "relationship with your AI.",
    recently: "recently",
    pausedNotice: "Paused. Nobody can reach your Room until you resume it.",
    listMyRoomTitle: "List my Room",
    listMyRoomIntro:
      "Listing shows your Room on the creator directory: your name, the one-line description below, and the " +
      "language your Room's screens speak. It never shows how many followers you have.",
    oneLineDescriptionLabel: "One-line description",
    oneLineDescriptionPlaceholder: "What you talk about, in one line",
    save: "Save",
    listedNote: "Listed. Anyone browsing the directory can find your Room.",
    notListedNote: "Not listed. Your Room still works for anyone with the link.",
    publishFirstNote: "Publish your Room first, then you can list it.",
    removeFromDirectory: "Remove from directory",
    listMyRoom: "List my Room",
    freeFollowersTitle: "Free followers",
    freeFollowersIntro:
      "A follower who has not paid gets this many messages a month, no voice, no check-ins. You can change it " +
      "any time.",
    freeMonthlyMessagesAriaLabel: "Free monthly messages",
    roomLanguageTitle: "Room language",
    roomLanguageIntro:
      "Your AI keeps speaking whatever you speak with it - this only picks the app's own screens: the buttons, " +
      "the disclosure line, the menu. A follower who has joined before, or whose own browser reports a " +
      "language, sees that instead; this is only the first screen for everyone else.",
    defaultRoomLanguageAriaLabel: "Default room language",
    paidFollowersTitle: "Paid followers",
    paidFollowersIntroPre: "Unlimited-feeling chat under a fair-use ceiling, plus voice replies when",
    paidFollowersIntroPost: "is on. Both numbers are yours to set, within the plan's bounds.",
    messagesAMonthLabel: "Messages a month",
    paidMonthlyMessagesAriaLabel: "Paid monthly messages",
    voiceMinutesAMonthLabel: "Voice minutes a month",
    paidMonthlyVoiceMinutesAriaLabel: "Paid monthly voice minutes",
    priceTitle: "Price",
    priceIntro:
      "What a follower pays a month for unlimited within fair use, past the free messages above. Between " +
      "{min} and {max}. Vyakti keeps {pct}% of what a follower pays; the rest is yours.",
    followerPriceAriaLabel: "Follower price",
    noPriceYet: "No price set yet. Followers cannot subscribe until you set one.",
    moneyTitle: "Money",
    subscribers: "Subscribers",
    leftThisMonth: "Left this month",
    yourShareThisMonth: "Your share this month",
    noSubscribersYet: "No subscribers yet.",
    lastPayout: "Last payout: {label} ({label2}), for {label3} to {label4}.",
    noPayoutYet: "No payout yet.",
    howDoingTitle: "How your Room is doing",
    noFollowersYet: "No followers yet. Share your Room's address to change that.",
    followers: "Followers",
    activeToday: "Active today",
    messagesThisMonth: "Messages this month",
    couldNotLoadCounts: "Could not load your counts just now. They will show the next time this loads.",
    weekSixTitle: "Week six",
    weekSixIntro:
      "Of the followers who joined in a given week, the share still talking to your AI six weeks later. " +
      "This is the number that matters most, more than messages sent or how many showed up today.",
    noCohortsYet: "No cohorts yet. This fills in once your Room has its first followers.",
    weekOf: "Week of {label}",
    noFollowersThatWeek: "No followers that week",
    stillTalkingPct: "{n}% still talking",
    notMeasurableUntil: "Not measurable until {label}",
    notMeasurableYetVerdict: "Not measurable yet. This needs a cohort that has been open for at least six weeks.",
    belowGateBand: "below the 25% gate this product needs to work at all",
    aboveCategoryBand: "above the 40% line where this becomes a category",
    betweenBand: "between the 25% gate and the 40% category line",
    cohortVerdictSentence: "Your oldest measurable cohort, the week of {label}, returned {n}%. That is {label2}.",
    soon: "soon",
    gateLine: "The gate is 25% or higher. 40% or higher is where this stops being a feature and becomes a category.",
    couldNotLoadRetry: "Could not load this just now. It will show the next time this loads.",
    loading: "Loading.",
    pulseTitle: "Pulse",
    pulseIntro:
      "What your followers are talking about, as counts only, and only from conversations a follower chose to " +
      "let count. Never a message, never a name, and never shown until at least five different followers are " +
      "behind a number.",
    pulseTopicsAriaLabel: "Pulse topics",
    removeTopicAriaLabel: "Remove topic {label}",
    addTopicPlaceholder: "Add a topic, e.g. exam stress",
    add: "Add",
    notEnoughOptins: "Not enough people have opted in yet.",
    enoughOptinsNoBucket: "Enough followers have opted in, but nothing has five behind it yet.",
    suppressedOne: "{n} combination was held back this week because showing them would have named someone.",
    suppressedMany: "{n} combinations were held back this week because showing them would have named someone.",
    showMe: "Show me",
    noticeRoomSetup: "Your Room is set up. Publish it when you are ready.",
    noticeAddressSaved: "Address saved.",
    noticeRoomLive: "Your Room is live.",
    noticeResumed: "Resumed. Your Room is live again.",
    noticeDefaultLocaleHi: "New followers with no language set will see Hindi first.",
    noticeDefaultLocaleEn: "New followers with no language set will see English first.",
    noticeBioSaved: "Your one-line description is saved.",
    noticeListed: "Listed. Your Room now appears in the creator directory.",
    noticeUnlisted: "Unlisted. Your Room is off the directory; the link above still works.",
    noticeFreeCap: "Free followers now get {n} messages a month.",
    noticePaidCeilings: "Paid followers now get {n} messages and {n2} voice minutes a month.",
    noticePrice: "Followers now pay {label} a month.",
    noticeTierStarted: "Your tier subscription has started.",
    noticeTierCancel: "Will not renew after the current period ends.",
    dormancyTitle: "Keep for a limited time",
    dormancyIntro:
      "Off by default: a follower's own conversation is kept forever, exactly as it is today. Turn this on " +
      "and a quiet follower gets a plain notice before anything is forgotten, with time to return first.",
    dormancyFloorNote: "Minimum {n} days.",
    dormancyOff: "Off - keep forever",
    dormancyDaysAriaLabel: "Days of inactivity before a follower is forgotten",
    noticeDormancyOn: "A quiet follower is forgotten {n} days after their last visit, with a notice first.",
    noticeDormancyOff: "Turned off. Every follower's conversation is kept forever again.",
  },

  videoLinkMount: {
    eyebrow: "Coming online",
    title: "One video, by link",
    blurb:
      "Paste a single lecture URL and we pull the audio, transcribe it, and propose what it teaches us about " +
      "how you explain. This lane is being built right now and is not connected yet.",
    noBoxNote:
      "There is deliberately no box to paste into yet. A field that accepted a link and did nothing with it " +
      "would cost you the paste and the wait, and tell you nothing true.",
    worksTodayNote:
      "What works today for video: connect your channel below, and we watch it for new uploads with your " +
      "attested permission. Everything that lane extracts is proposed to you, never applied on its own.",
  },

  runtimeGate: {
    labels: {
      self_replica_only: "Self-only policy",
      replica_not_ready: "Approved voice and behavior",
      self_identity_not_bound: "Verified account-to-person binding",
      adult_verification_required: "Living-adult verification",
      identity_verification_required: "Identity verification",
      liveness_verification_required: "Live anti-replay check",
      inference_consent_required: "Inference permission",
      person_profile_not_approved: "Approved: what we learned about you",
      calibration_not_approved: "Approved behavior calibration",
      voice_genome_not_approved: "Approved voice",
      voice_not_ready: "Production voice mapping",
      production_voice_required: "Non-test voice provider",
      qualification_incomplete: "Seven-suite qualification",
    },
    eyebrow: "Runtime",
    title: "What has to pass before your AI can talk to anyone",
    intro:
      "Launch binds the exact version of what we learned about you, the exact voice, provider voice, " +
      "relationship namespace, and evaluation set. New drafts cannot silently change an active AI.",
    sealActive: "ACTIVE",
    sealSealed: "SEALED",
    sealSubActive: "Private use only",
    sealSubSealed: "No generation access",
    checkingGates: "Checking every launch gate...",
    retry: "Retry",
    qualificationSuitesPassed: "qualification suites passed",
    whatWeLearnedVersion: "what we learned: version",
    calibrationVersion: "calibration version",
    voiceVersion: "voice version",
    gatesClosedOne: "{n} launch gate still closed",
    gatesClosedMany: "{n} launch gates still closed",
    actionNote:
      "Your AI's calls use protected cascade speech only. There is no fallback to another cloud voice or to " +
      "device text to speech.",
    freezing: "Freezing capability...",
    runtimeActive: "Runtime active",
    activateButton: "Activate private runtime",
    readinessUnavailable: "Runtime readiness is unavailable",
    activationRefused: "Runtime activation was refused",
  },

  turnFeedback: {
    dimensionLabel: {
      wording: "Wording",
      behavior: "Behavior",
      relationship: "Relationship",
      memory: "Memory",
      delivery: "Delivery",
      voice_identity: "Voice",
    },
    dimensionDescription: {
      wording: "The phrases and sentence shape",
      behavior: "How you react and make decisions",
      relationship: "How this sounds with this person",
      memory: "Facts, callbacks, and uncertainty",
      delivery: "Pace, emotion, and nonverbals",
      voice_identity: "The protected audio you actually heard",
    },
    ratingLabel: { exact: "Exact", close: "Close", off: "Off" },
    reasonLabel: {
      too_generic: "Too generic",
      wrong_fact: "Wrong fact",
      wrong_relationship: "Wrong relationship",
      wrong_tone: "Wrong tone",
      wrong_wording: "Wrong wording",
      too_long: "Too long",
      too_short: "Too short",
      voice_mismatch: "Voice mismatch",
      emotion_mismatch: "Emotion mismatch",
      unsafe_or_boundary: "Crossed a boundary",
      other: "Something else",
    },
    playVoiceFirst: "Play protected voice first",
    savedRevision: "Revision {n} secured",
    didThisFeelLikeYou: "Did this feel like you?",
    thisIsMe: "This is me",
    tuneThis: "Tune this",
    teachDifference: "Teach the difference",
    close: "Close",
    gradeOnlyNote: "Grade only what you noticed. Unrated layers remain unknown.",
    whatMissed: "What missed?",
    correctionLabel: "What would you actually say?",
    correctionOptionalNote: "optional, encrypted before storage",
    correctionPlaceholder: "Write the version that sounds like you.",
    layersRatedOne: "{n} layer rated",
    layersRatedMany: "{n} layers rated",
    chooseAtLeastOne: "Choose at least one layer",
    securing: "Securing...",
    saveEvidence: "Save evidence",
    errorFallback: "This fidelity note could not be secured",
  },

  replicaDialogueLab: {
    eyebrow: "Private conversation",
    title: "Talk to your AI privately, in text",
    intro:
      "Every answer is generated from what we learned about you, owner calibration, this relationship's " +
      "private state, and recent turns. Voice playback can speak only the exact server-issued reply.",
    statusPrivateLive: "PRIVATE · LIVE",
    statusSealed: "SEALED",
    lockedHeadline: "Conversation stays unavailable until the private runtime passes every gate.",
    lockedNote: "No fallback AI, generic voice, or partial activation is used.",
    stopVoice: "Stop voice",
    playProtectedVoice: "Play protected voice",
    emptyHeadline: "Start with something only you would notice.",
    emptyNote: "The first turn opens a private, version-bound session.",
    thinking: "Building an evidence-bound answer...",
    messageLabel: "Message your AI",
    messagePlaceholder: "What would I say here?",
    sendPrivately: "Send privately",
    dismiss: "Dismiss",
    trustNote:
      "Synthetic disclosure and watermarking remain mandatory for audio. Conversation logs are private and " +
      "erasable; this screen never exposes AI, agent, person, storage, or provider identifiers.",
    errorReadinessUnavailable: "Private dialogue readiness is unavailable",
    errorReconcileRequired:
      "This reply completed, but Azure usage needs operator reconciliation before another paid turn.",
    errorCouldNotAnswer: "Your AI could not answer",
    errorVoicePlayback: "Protected voice could not be played",
  },

  calibrationStudio: {
    layers: {
      delivery: "Delivery",
      language: "Language",
      behaviour: "Behavior",
      memory: "Memory",
      relationship: "Relationship",
    },
    blockers: {
      approved_person_profile_required: "Approve what we learned about you first",
      delivery_calibration_required: "Choose at least one delivery contrast",
      language_calibration_required: "Choose at least one language contrast",
      behaviour_calibration_required: "Choose at least one behavior contrast",
      memory_calibration_required: "Choose at least one memory contrast",
      relationship_calibration_required: "Choose at least one relationship contrast",
      calibration_depth_required: "Resolve at least seven contrasts",
    },
    eyebrow: "Behavior calibration",
    title: "Show it how you would actually answer",
    intro:
      "Choose between safe behavioral contrasts. Every correction becomes versioned preference evidence, " +
      "never another sentence glued onto a persona prompt.",
    approvedPolicyLabel: "approved policy",
    preparingContrasts: "Preparing calibration contrasts...",
    retry: "Retry",
    contrastsReviewedAriaLabel: "{n} of {n2} contrasts reviewed",
    contrastsReviewed: "contrasts reviewed",
    calibrationScenariosAriaLabel: "Calibration scenarios",
    openContrastAriaLabel: "Open {label} contrast {n}",
    orWord: "or",
    bothFeelLikeMe: "Both feel like me",
    neitherIsMe: "Neither is me",
    freeTextNote:
      "Free-text notes are never compiled into behavior. Only reviewed, server-owned strategies can enter a " +
      "frozen runtime capability.",
    checkingChoices: "Checking choices...",
    approveCalibrationVersion: "Approve calibration v{n}",
    buildingPolicy: "Building policy...",
    buildCalibrationPolicy: "Build calibration policy",
    errorCouldNotLoad: "Calibration could not be loaded",
    errorChoiceNotSaved: "Your calibration choice was not saved",
    errorBuildRefused: "Calibration build was refused",
    errorApproveChanged: "Calibration changed and could not be approved",
  },

  candidateEvaluationLab: {
    dimensionCopy: {
      overall: { label: "Overall", hint: "Which one feels more like you?" },
      wording: { label: "Wording", hint: "Phrases, sentence shape, and length" },
      behavior: { label: "Behavior", hint: "Reaction, judgment, and way of responding" },
      relationship: { label: "Relationship", hint: "How you would speak in this exact bond" },
      memory: { label: "Memory", hint: "Facts, callbacks, and honest uncertainty" },
      delivery: { label: "Delivery", hint: "Implied pace, energy, and emotional shape" },
    },
    choiceLabel: { a: "A is closer", tie: "No difference", b: "B is closer" },
    loadErrorFallback: "The comparison could not be loaded",
    eyebrow: "Blind comparison",
    title: "Pick the closer voice, without being told which is which",
    intro: "Compare two hidden outputs layer by layer. Their identity stays sealed until the full evaluation is complete.",
    sealAriaLabel: "Evaluation blinding status",
    blindedLabel: "BLINDED",
    mappingNote: "A/B mapping stays server-side",
    loadingAriaLabel: "Loading blind evaluation",
    comparisonUnavailable: "Comparison unavailable",
    tryAgain: "Try again",
    emptyHeadline: "No qualified candidate is waiting for review.",
    emptyNote: "This opens only after a frozen test set and two encrypted candidate outputs exist for at least 30 comparisons.",
    completeHeadline: "Blind review complete",
    completeNote: "{n} comparisons are sealed. Safety, privacy, and statistical gates decide whether this candidate can advance.",
    comparisonOfLabel: "Comparison {n} of {n2}",
    sealedCountLabel: "{n} sealed",
    situationLabel: "Situation",
    optionsAriaLabel: "Anonymous response options",
    anonymousOutput: "Anonymous output",
    orWord: "OR",
    judgeEveryLayer: "Judge every layer",
    judgeInstruction: "Choose based on this situation only. A tie is useful evidence.",
    layersJudged: "{n} of {n2} layers judged",
    sealingComparison: "Sealing comparison...",
    sealAndContinue: "Seal and continue",
  },

  processingReview: {
    reasonLabel: {
      accepted: {
        matches_subject: "Matches me",
        clean_identity_signal: "Clean identity signal",
        measurement_verified: "Measurement verified",
        segment_verified: "Speaker segment verified",
      },
      rejected: {
        wrong_speaker: "Wrong speaker",
        third_party_present: "Another person appears",
        poor_quality: "Quality is too poor",
        corrupt_or_incomplete: "Corrupt or incomplete",
        synthetic_or_replayed: "Synthetic or replayed",
        privacy_risk: "Privacy risk",
      },
      superseded: {
        better_variant_selected: "Better variant selected",
        newer_measurement: "Newer measurement",
        corrected_segmentation: "Segmentation corrected",
        source_replaced: "Source replaced",
      },
    },
    recently: "Recently",
    contentWithheld: "Content withheld. Review only the timing, confidence, and provenance shown here.",
    needsReview: "needs review",
    reviewAriaLabel: "Review {label}",
    decisionSelectLabel: "Decision",
    reasonSelectLabel: "Reason",
    optionAccept: "Accept",
    optionReject: "Reject",
    optionSupersede: "Supersede",
    saving: "Saving",
    recordReview: "Record review",
    decisionWithheldNote: "A decision is unavailable here because the evidence content is intentionally withheld.",
    confidenceNotReported: "Confidence not reported",
    confidencePct: "{n}% confidence",
    endpointSuffix: "{n}s endpoint",
    unreportedFamily: "unreported family",
    unreportedAdapter: "unreported adapter",
    eyebrow: "Your review",
    title: "See what we extracted, then approve it",
    refreshing: "Refreshing",
    refresh: "Refresh",
    intro:
      "Only review-safe measurements are shown. Raw transcripts, voice vectors, storage locations, provider references, and durable download links never enter this page. " +
      "A private audition link is minted only after you press Listen and expires within 60 seconds.",
    loadingReceipts: "Loading private processing receipts",
    emptyHeadline: "No processing receipts yet",
    emptyNote: "Add a source above. It will appear here only after the private processing pipeline begins.",
    sourceTitle: "{label} source",
    pipelineStepOne: "{n} pipeline step",
    pipelineStepMany: "{n} pipeline steps",
    derivedVariantOne: "{n} derived variant",
    derivedVariantMany: "{n} derived variants",
    evidenceRecordOne: "{n} evidence record",
    evidenceRecordMany: "{n} evidence records",
    pipelineStepsAriaLabel: "Pipeline steps",
    noPipelineAttempt: "No pipeline attempt has been recorded.",
    attemptLabel: "attempt {n}",
    selectedVoiceBadge: "Selected voice",
    opening: "Opening",
    listenPrivately: "Listen privately",
    selecting: "Selecting",
    selected: "Selected",
    useThisVoice: "Use this voice",
    cannotPlayAudio: "Your browser cannot play this private audio.",
    linkExpiresNote: "The signed link expires automatically in under one minute.",
    noReviewableEvidence: "No reviewable evidence has been emitted for this source.",
    draftOnlyEyebrow: "Draft only",
    voiceBuildGateTitle: "Voice build gate",
    voiceBuildGateIntro:
      "A queued build cannot be used for synthesis. A separate approval and held-out real-world evaluation " +
      "are still required.",
    acousticFamilies: "acoustic families",
    voiceMeasurements: "voice measurements",
    qualityMeasurements: "quality measurements",
    speakerSegments: "speaker segments",
    queueingDraft: "Queueing draft",
    queueDraftVoice: "Queue a draft voice",
    buildLedger: "Build ledger",
    immutableDraftLedger: "Immutable draft ledger",
    voiceVersionStatus: "Voice version {n}, {label}",
    voicePrintFamiliesDetail: "{n} independent voice-print families",
    targetSegmentsDetail: "{n} target segments",
    enrollmentArtifactsDetail: "{n} private enrollment artifacts",
    draftsCannotSynthesize:
      "Drafts cannot synthesize audio. Approval still requires owner calibration and a real held-out identity " +
      "evaluation.",
    errorProcessingUnavailable: "Processing review is unavailable",
    errorDecisionNotRecorded: "Decision could not be recorded",
    errorDraftNotQueued: "Draft build could not be queued",
    errorAuditionNotOpened: "Private audition could not be opened",
    errorCandidateNotSelected: "Voice candidate could not be selected",
    noticeReviewRecorded: "Review decision recorded as an append-only receipt.",
    noticeCandidateSelected: "Voice candidate selected. Existing drafts were retired so the next voice build binds this exact audio.",
    noticeDraftQueued: "Draft voice build queued. It still needs your approval before anything can use it.",
  },

  personModelStudio: {
    blockers: {
      self_name_required: "Confirm the name your AI uses for itself",
      language_identity_required: "Confirm its language and code-switching identity",
      behavior_evidence_required: "Review at least one behavior or repair pattern",
      boundary_evidence_required: "Confirm at least one personal boundary",
      critical_identity_conflict: "Resolve conflicting identity claims",
    },
    extractionBlockers: {
      transcription_consent_required: "Grant transcription consent",
      training_consent_required: "Grant AI-building consent for assisted claim extraction",
      reviewed_subject_transcript_required: "Accept at least one verified speaker transcript",
    },
    confidencePct: "{n}% confidence",
    citedSourceOne: "{n} cited source",
    citedSourceMany: "{n} cited sources",
    keepOut: "Keep out",
    notAccurate: "Not accurate",
    outdated: "Outdated",
    thisIsMe: "This is me",
    reviewClaimAriaLabel: "Review this claim",
    eyebrow: "What we learned about you",
    title: "Everything we think we learned about you, one claim at a time",
    intro:
      "Confirm identity, language, behavior, values, boundaries, and autobiography as separate evidence-backed " +
      "claims. Conflicts stay visible instead of being averaged into a confident fiction.",
    approvedVersionLabel: "approved version",
    loadingClaims: "Loading reviewed claims...",
    retry: "Retry",
    proposedClaims: "proposed claims",
    accepted: "accepted",
    criticalConflicts: "critical conflicts",
    citedExtractionEyebrow: "Cited extraction",
    citedExtractionTitle: "Turn your reviewed recordings into claims you control",
    citedExtractionIntro:
      "Only accepted target-speaker transcript spans qualify. Raw transcripts stay server-side, direct " +
      "identifiers are masked before the extraction call, and every result remains a proposal until you review " +
      "it below.",
    eligibleSpans: "eligible spans",
    lastProposed: "last proposed",
    noExtractionRunYet: "No extraction run yet",
    extractingPrivately: "Extracting privately...",
    extractNewEvidence: "Extract new evidence",
    extractCitedClaims: "Extract cited claims",
    noClaimsHeadline: "No behavior or memory claims yet.",
    noClaimsNote: "Processed evidence will appear here for review. Raw transcripts, vectors, and storage paths remain withheld.",
    buildIsDeterministicNote: "A build is deterministic and versioned. Approving it never grants inference or voice generation permission.",
    checkingEvidence: "Checking evidence...",
    approveProfileVersion: "Approve profile v{n}",
    building: "Building...",
    buildReviewDraft: "Build review draft",
    errorExtractionUnavailable: "Cited extraction status could not be loaded",
    errorProfileUnavailable: "What we learned about you could not be loaded",
    errorClaimNotSaved: "Claim review was not saved",
    errorBuildRefused: "Building what we learned about you was refused",
    errorApproveChanged: "Profile changed and could not be approved",
    errorExtractionFailed: "Cited claims could not be extracted",
  },
  showcase: {
    title: "Show on your page",
    intro: "Up to five questions and answers a stranger sees on your own public page before they ever join. Your own words, in your own order.",
    publishFirst: "Publish your Room first, then you can show answers on your page.",
    slotLabel: "Slot {n} of 5",
    questionPlaceholder: "A question people actually ask",
    answerPlaceholder: "Your answer, in your own words",
    save: "Save",
    saving: "Saving...",
    remove: "Remove",
    removing: "Removing...",
    removed: "Removed from your page.",
    saved: "Saved to your page.",
    copyViolation: "That text is not allowed as written. Remove the dash or the flagged word and try again.",
  },
  creatorExport: {
    eyebrow: "Owner control",
    title: "Download everything",
    body: "Everything this platform holds about you and your AI: your archive, your voice, your Room's own settings, your payouts, your review decisions. Never anything a follower said to your AI in private, and never a follower's own data even as a count below five - that stays theirs.",
    button: "Download everything",
    downloading: "Preparing your download...",
    rateLimited: "You can request this once a day. Try again tomorrow.",
    error: "Could not prepare your download. Please try again.",
    done: "Your download has started.",
  },
  suiteSeatLock: {
    // WS-R73. razorpay.com/docs/api/payments/subscriptions/update-subscription/,
    // fetched 2026-09-05: a UPI or Emandate subscription refuses a quantity
    // change outright; a card subscription can be updated at any time.
    mandateNote:
      "If you pay for this Suite by UPI, its seat count is fixed for as long as that subscription runs. " +
      "To change it later, cancel it, which keeps working until the period ends, then start a new one at the seat count " +
      "you need. Paying by card can be updated at any time.",
    seatsLockedByMandate:
      "This Suite pays by UPI or a bank e-mandate, and Razorpay does not allow changing seats on that kind of " +
      "subscription. Cancel it below, which keeps working until the period ends, then start a new one at the seat " +
      "count you need.",
  },
  creatorPush: {
    title: "This week on your phone",
    intro: "A short push about your Room, once a Monday morning: new followers and messages, this deployment's own push key required.",
    notConfigured: "Push alerts are not set up on this deployment yet.",
    turnOn: "Turn on the weekly push on this device",
    turnOff: "Turn off the weekly push on this device",
    error: "Could not change alert settings on this device.",
  },
  showcasePicker: {
    pickButton: "Pick from your reviews",
    pickTitle: "Cards you already marked sounds right",
    pickEmpty: "Nothing to pick yet. Decide a few cards in Meet first.",
    pickLoading: "Looking...",
    pickError: "Your decided cards could not be loaded",
    pickUse: "Use this",
    pickCancel: "Cancel",
  },
  reviewQueueFlags: {
    flagsTitle: "Flagged by followers",
    timesOne: "Flagged {n} time.",
    timesMany: "Flagged {n} times.",
    reasonsLabel: "Reasons: {label}",
    reasonWrong: "wrong",
    reasonHarmful: "harmful",
    reasonNotThem: "not them",
    reasonOther: "other",
    soundsRightAnyway: "Sounds right anyway",
    dismissing: "Saving...",
    dismissed: "Cleared from your flagged list.",
    errorAction: "That action could not be saved",
  },
  poster: {
    download: "Download poster (A4)",
  },

  activityPanel: {
    groupYourTurn: "Your turn",
    groupWorkingNow: "Working now",
    groupStopped: "Stopped",
    groupFinished: "Finished",
    feedTitle: "Where each upload is right now",
    feedLede: "Everything you have handed over, and what is happening to it. Anything that needs you is at the top.",
    meetTitle: "What has finished, and what has not",
    meetLede: "If your AI does not know something you are sure you gave it, the reason is usually here. Unfinished work first.",
    justNow: "just now",
    minutesAgo: "{n} min ago",
    hourAgoOne: "1 hour ago",
    hoursAgoMany: "{n} hours ago",
    dayAgoOne: "1 day ago",
    daysAgoMany: "{n} days ago",
    stepsDoneAriaLabel: "{n} of {n2} steps done",
    notConnectedTitle: "{label}: not connected yet.",
    notConnectedBody: "Nothing in this lane can run until it is set up, so an empty list here does not mean nothing has happened.",
    notConnectedMissingLabel: "What is missing:",
    loadingGroupName: "Loading",
    emptyState: "Nothing has been started yet. Add a recording, a file or your channel and it will show up here while it runs.",
    ofCount: "{n} of {n2}",
    doneLabel: "done",
    retryingLabel: "Working",
    errorCouldNotRead: "could not read activity",
    errorRetryFailed: "the retry did not go through",
    errorAlreadyMoved: "That upload had already moved on, so there was nothing to finish.",
  },

  channelsStudio: {
    eyebrow: "Channels",
    title: "Where your AI can be reached",
    intro: "Publishing makes your AI reachable. This is where it meets people. Every channel below is one you own: your site, your bot, your business number. You can pause or retire any of them at any time without asking us.",
    embedCardTitle: "Get embed code",
    embedCardBody: "Paste this into any page you control. It works on a plain HTML site, a WordPress theme, a Squarespace code block, anywhere a script tag is allowed. It sets no cookie and asks nothing of your visitors.",
    embedSnippetAriaLabel: "Embed snippet",
    copyEmbedCode: "Copy embed code",
    copiedLabel: "Copied",
    disclosureNote: "Every visitor sees the same disclosure card you approved, before their first message. It is sent by us with the reply, not rendered by the page. A site that removed it could not hold a conversation at all.",
    loadingChannels: "Loading channels...",
    statusLabel: "Status",
    notSetUp: "Not set up",
    webWidgetTitle: "Your website",
    webWidgetRefLabel: "Public slug",
    webWidgetBlurb: "A chat bubble on any page you control. One line of HTML, no account anywhere else.",
    webWidgetCost: "Nothing to apply for. Live the moment you paste the line.",
    telegramTitle: "Telegram",
    telegramRefLabel: "Bot ID",
    telegramSecretLabel: "Bot token",
    telegramBlurb: "Your own bot, created in @BotFather, answering as your AI.",
    telegramCost: "No review process. You create the bot and register one webhook URL we give you.",
    whatsappTitle: "WhatsApp",
    whatsappRefLabel: "Phone number ID",
    whatsappSecretLabel: "Access token",
    whatsappBlurb: "A WhatsApp Business number answering as your AI.",
    whatsappCost: "Needs a Meta Business account, a verified business, and a number registered to the Cloud API. Meta's review is measured in days to weeks, and it is theirs, not ours.",
    statusDraft: "Not live. Finish the details below.",
    statusConnected: "Live",
    statusPaused: "Paused. Nothing is answered here.",
    statusRevoked: "Revoked. This address is retired for good.",
    secretOnFile: "On file. Paste a new one to replace it.",
    secretVaultNote: "Stored in our secret vault, never in the database and never shown again, not even to you. Replace it here if it is ever rotated.",
    saving: "Saving...",
    update: "Update",
    connect: "Connect",
    pause: "Pause",
    resume: "Resume",
    retire: "Retire",
    retiredNote: "Retired for good. That address will never be reattached to your AI. Set up a new one instead if you need this channel back.",
    instagramTitle: "Instagram DM",
    instagramNotOffered: "Not offered yet, and this is what stands in the way rather than a date.",
    instagramWhatMetaRequiresLabel: "What Meta requires",
    instagramRequirement: "Advanced Access to Instagram messaging, which needs a verified business, an app in Live mode, and a full App Review with a recorded demonstration of the integration. Meta grants it per app, not per teacher, and the wait is measured in weeks to months.",
    instagramNoFakeButton: "We will not put a button here that quietly does nothing.",
    liveNotice: "{name} is live.",
    draftNotice: "{name} saved as a draft. It needs the remaining detail before it can answer.",
    errorRequestFailed: "request failed",
  },

  teacherSheetStudio: {
    eyebrow: "Sheet review",
    title: "Review and confirm how {name} teaches",
    titleFallbackName: "this teacher",
    intro: "Only what you have to decide is editable here. What we drafted from your uploads is read only, and you correct it in the claims step.",
    loadSavedDraft: "Load saved draft",
    provenanceSeedNotice: "Nothing is saved for your AI yet. The fields below are blank or set to a middle default, and they carry your name because we will never show you somebody else's. Save when you are ready.",
    serviceUnavailableNotice: "The sheet service did not answer. Anything you type stays in this browser and is not saved to your account.",
    subjectCardTitle: "Subject & syllabus coverage",
    subjectLabel: "Subject your AI answers in",
    subjectPhysics: "Physics",
    subjectChemistry: "Chemistry",
    subjectMaths: "Maths",
    scopeLabel: "Scope, and what it does not answer",
    chapterNote: "Check every chapter your AI should teach. A physics teacher's AI answering organic chemistry is a misrepresentation of them.",
    chapterCoverageAriaLabel: "Chapter coverage",
    strictnessCardTitle: "Strictness & warmth",
    strictnessWarmthNote: "You confirm these, we never infer them alone. An over-read here is a real harm to a 16-year-old.",
    strictnessLabel: "Strictness: how bluntly a wrong answer is named",
    strictness0: "Never names it, reframes every miss as nearly right",
    strictness1: "Gentle, softens most corrections",
    strictness2: "Direct about the answer, easy about the person",
    strictness3: "Names a wrong step plainly, in the same breath it's met",
    strictness4: "No cushioning, the sharpest read of a mistake",
    warmthLabel: "Warmth: encouragement density, independent of strictness",
    warmth0: "All business, no encouragement beyond the correction itself",
    warmth1: "Occasional, and only for a real specific win",
    warmth2: "Steady encouragement, always tied to something they did",
    warmth3: "Warm by default, still specific",
    warmth4: "Highest encouragement density this sheet allows",
    ladderCardTitle: "Doubt-handling ladder",
    ladderNote: "The ordered hint rungs given before any full solution. This is the academic integrity spine. A full solution is never the first response.",
    removeRungAriaLabel: "Remove rung {n}",
    removeRung: "Remove",
    addRungPlaceholder: "Add the next rung",
    addRung: "Add rung",
    boundariesCardTitle: "Boundaries",
    boundariesNote: "identityLife is yours to write and is never ingested. A teacher's private life is not consented material for your AI even when it appears in your own uploaded videos.",
    identityLifeLabel: "Teaching life, in one breath",
    mentorBoundaryLabel: "Mentor boundary - not editable here",
    ingestedTitleDraft: "Drafted from your uploads",
    ingestedTitleEmpty: "Nothing drafted yet",
    ingestedNoteDraft: "Read only here. Review or correct each one in the claims step.",
    ingestedNoteEmpty: "These fill in once your uploads are processed. Read only here either way, and corrected in the claims step.",
    ingestedStatusDraft: "Drafted from your uploads",
    ingestedStatusEmpty: "Not learned yet",
    languageVoiceRuleLabel: "Language / voice ratio",
    sttSoundAlikesLabel: "STT sound-alike pairs",
    boardVerbalismsLabel: "Board verbalisms (catchphrase field)",
    notationConventionsLabel: "Notation conventions",
    analogyBankLabel: "Signature analogies",
    commonMistakeBankLabel: "Common mistake bank",
    commonMistakeBankSummary: "{n} rows, strand-scoped",
    publishNote: "Saving here never publishes your AI. Publish runs the full floor and consent gate separately.",
    saved: "Sheet draft saved.",
    savedLocalOnly: "Not saved to your account. The sheet service did not answer, so this draft is still only in this browser.",
    saving: "Saving...",
    save: "Save sheet draft",
  },

  voicePreviewLab: {
    title: "Build a draft voice and compare two takes",
    intro: "This private draft is for your ears and judgment. It cannot join calls or activate your AI.",
    checking: "Checking",
    refreshDraft: "Refresh draft",
    draftVersionLabel: "Draft voice build, version {n}",
    draftRequired: "Draft required",
    identityModelsBound: "{n} identity profiles bound",
    reviewFirst: "Review and build your selected voice first",
    languageLegend: "Language",
    languageEnglish: "English",
    languageHindi: "Hindi and Hinglish",
    whatShouldDraftSay: "What should the draft say?",
    charactersLeft: "{n}/600 characters. The audible AI disclosure is added automatically.",
    disclosureAddedNote: "The audible AI disclosure is added automatically.",
    deliveryLegend: "Delivery",
    styleFaithfulLabel: "Faithful",
    styleFaithfulCopy: "Tighter identity and steadier pacing",
    styleBalancedLabel: "Balanced",
    styleBalancedCopy: "Natural delivery for everyday speech",
    styleExpressiveLabel: "Expressive",
    styleExpressiveCopy: "More emotional movement and risk",
    protectingPreview: "Protecting your preview",
    generatePreview: "Generate private preview",
    coldStartNotice: "The scale-to-zero voice lab may take a few minutes on its first run.",
    yourProtectedDraft: "Your protected draft",
    listenOnceNote: "Listen once for identity, once for delivery, then change one control at a time.",
    audioFallback: "Your browser cannot play this protected WAV.",
    disclosureRowLabel: "Disclosure",
    disclosureRowValue: "Audible",
    watermarksRowLabel: "Watermarks",
    provenanceRowLabel: "Provenance",
    provenanceRowValue: "C2PA signed",
    receiptLine: "Receipt {n}. Build {n2}.",
    roomReady: "The room is ready",
    noDraftYet: "No draft can speak yet",
    chooseWordsNote: "Choose the words and delivery. No audio leaves the protection boundary unmarked.",
    needRecordingNote: "You need a processed recording first. Add one on the Feed step, and we will build a draft voice from it.",
    proofOwnerOnly: "Owner-only",
    proofSelfOnly: "Self-only",
    proofNoRuntimeAccess: "No runtime access",
    preferenceLabTag: "Blind preference lab",
    preferenceLabHeading: "Teach your AI with your ears.",
    preferenceLabIntro: "The server balances a multilingual challenge deck and chooses the next most informative hidden contrast. Both sides keep the assigned words, identity evidence, voice engine, language, and sampling seed fixed.",
    renderingAB: "Rendering A, then B",
    newBlindPair: "New blind pair",
    startBlindAB: "Start blind A/B",
    adaptiveComparisonLabel: "Adaptive comparison {n}",
    conditionsCoveredLabel: "{n}/{n2} conditions covered",
    promptFamiliesLabel: "{n}/{n2} prompt families",
    boundaryConverged: "Boundary converged",
    stillLearning: "Still learning",
    challengeSuffix: "challenge",
    candidateLetterA: "A",
    candidateLetterB: "B",
    protectedCandidateLabel: "Protected candidate",
    completedLabel: "Completed",
    listenFullyNote: "Listen fully before deciding",
    audioCandidateFallback: "Protected voice candidate.",
    preferenceSecured: "Preference secured",
    choiceNeither: "Neither candidate qualified.",
    choiceTie: "The candidates were equivalent.",
    choiceCloser: "{label} was closer.",
    conditionSummary: "A was {label}; B was {label2}.",
    evidenceLine: "Evidence {n} is exact-generation bound.",
    whatSeparatedThem: "What separated them?",
    optionalLabel: "optional",
    chooseCloserAriaLabel: "Choose the closer protected voice",
    aIsCloser: "A is closer",
    bIsCloser: "B is closer",
    both: "Both",
    neither: "Neither",
    finishBothToUnlock: "Finish both candidates to unlock the judgment.",
    buildingTwoTakes: "Two fully protected generations are being built. Cold starts can take a few minutes.",
    noComparisonOpen: "No comparison is open. The lab will assign a new challenge sentence and hold it constant across both sides.",
    voiceDeliveryTag: "Voice Delivery",
    versionFrozen: "Version {n} is frozen",
    buildDeliveryCandidate: "Build an immutable delivery candidate",
    championBoundNote: "{label} is bound to {n} exact judgments. It remains draft-only until held-out qualification.",
    candidateCreatedNote: "The candidate is created only after the multilingual comparison boundary is deep and diverse enough.",
    comparisonsLabel: "{n} comparisons",
    conditionsFractionLabel: "{n}/{n2} conditions",
    promptsFractionLabel: "{n}/{n2} prompts",
    freezingEvidence: "Freezing evidence",
    freezeUpdatedVersion: "Freeze updated version",
    freezeDeliveryCandidate: "Freeze delivery candidate",
    moreEvidenceRequired: "More blind evidence is required. Repeating one familiar sentence cannot unlock this gate.",
    freezingDoesNotActivate: "Freezing does not activate the voice. A separate held-out ABX gate is next.",
    unseenSpeechTag: "Unseen speech gate",
    unseenSpeechHeading: "Does the frozen delivery generalize?",
    unseenSpeechIntro: "Six prompts excluded from calibration, each tested with two deterministic seeds. The candidate stays hidden against its strongest runner-up.",
    heldOutJudgmentsLabel: "held-out judgments",
    holdoutChallengeSuffix: "holdout",
    heldOutCandidateLabel: "Held-out candidate",
    listenFully: "Listen fully",
    heldOutJudgmentSecured: "Held-out judgment secured",
    startNextCellNote: "Start the next unseen cell when you are ready.",
    chooseCloserHeldOutAriaLabel: "Choose the closer held-out voice",
    ownerHoldoutPassed: "Owner holdout passed",
    ownerHoldoutFailed: "Owner holdout failed",
    notProductionQualificationNote: "This is not production qualification. Automated identity, intelligibility, artifact, watermark, privacy, and latency gates remain locked.",
    securingTrial: "Securing trial",
    nextUnseenPair: "Next unseen pair",
    startHeldOutAB: "Start held-out A/B",
    finalizeOwnerGate: "Finalize owner gate",
    conditionIdentityAnchor: "Identity anchor",
    conditionFaithful: "Faithful",
    conditionSteadyWarm: "Steady warmth",
    conditionBalanced: "Balanced",
    conditionWarmExpressive: "Warm expression",
    conditionExpressive: "Expressive",
    conditionAnimated: "Animated",
    fallbackConditionA: "condition A",
    fallbackConditionB: "condition B",
    fallbackLearnedDelivery: "Learned delivery",
    reasonIdentity: "Voice identity",
    reasonAccent: "Accent",
    reasonRhythm: "Rhythm",
    reasonEmotion: "Emotion",
    reasonNaturalness: "Naturalness",
    reasonPronunciation: "Pronunciation",
    reasonFewerArtifacts: "Fewer artifacts",
    errorStatusUnavailable: "Voice preview status is unavailable",
    errorPreviewNotGenerated: "The protected preview could not be generated",
    errorComparisonNotGenerated: "The blind comparison could not be generated",
    errorPreferenceNotSecured: "The voice preference could not be secured",
    errorDeliveryNotFrozen: "Your voice delivery could not be frozen",
    errorHeldOutNotGenerated: "The held-out comparison could not be generated",
    errorHeldOutJudgmentNotSecured: "The held-out judgment could not be secured",
    errorHeldOutResultNotFinalized: "The held-out result could not be finalized",
  },

  voicePreviewPanel: {
    eyebrow: "Your voice",
    title: "Preview my voice",
    introTest: "Type a line and hear the current draft in Hindi, Hinglish, or English.",
    introReal: "A private draft, generated from your own consented recording. Every clip opens with the spoken AI disclosure and carries an inaudible watermark. Previewing does not activate anything and does not let anyone else hear it.",
    languageLegend: "Preview language",
    languageHindiLabel: "Hindi",
    languageHindiHelp: "Write Hindi in Devanagari. Familiar English terms can stay in English.",
    languageHinglishLabel: "Hinglish",
    languageHinglishHelp: "Write natural Roman Hindi and English. Each segment is planned before synthesis.",
    languageEnglishLabel: "English",
    languageEnglishHelp: "Write the exact English line you want the draft to say.",
    yourLine: "Your line",
    charactersLeftTest: "{n} characters left.",
    charactersLeftReal: "{n} characters left. The spoken AI disclosure is added for you.",
    disabledCheckingHeadline: "We are still checking whether you have a draft voice.",
    disabledCheckingNext: "This takes a moment. The button turns on by itself when the check comes back.",
    disabledBusyWarming: "The voice runtime is starting up, which takes two to five minutes after a quiet period.",
    disabledBusyGenerating: "Your line is being generated right now.",
    disabledBusyNext: "It retries by itself. You can leave this open or go and do something else on this step.",
    disabledEmptyHeadline: "The box is empty, so there is nothing to say.",
    disabledEmptyNext: "Type a line for your AI to read aloud.",
    disabledOverLimitHeadline: "That is longer than the {n} characters a preview can take.",
    disabledOverLimitNext: "Shorten it and the button turns on.",
    buttonGenerating: "Generating",
    buttonWaking: "Waking the voice lab",
    buttonAnotherTake: "Generate another take",
    buttonPreview: "Preview my voice",
    stateReady: "Ready",
    listenToThisTake: "Listen to this take",
    audioFallback: "Your browser cannot play this protected WAV.",
    pronunciationPlanSummary: "{n} reviewed Hindi pronunciation changes applied",
    spokenAsLabel: "Spoken as:",
    originalTextUnchangedNote: "Your original text stays unchanged. Plan {n} is saved with this preview.",
    disclosureRowLabel: "Disclosure",
    disclosureRowValue: "Spoken, on every clip",
    watermarkRowLabel: "Watermark",
    watermarkRowValue: "PerTh, verified before release",
    notRightYet: "Not right yet?",
    editLineNote: "Edit the line or switch language, then generate another take.",
    editLine: "Edit the line",
    receiptLine: "Receipt {n} · build {n2}",
    stateWarming: "Warming up",
    runtimeStarting: "Your voice runtime is starting",
    nextCheckLabel: "Next check",
    coldStartEstimateTitle: "Cold start estimate",
    coldStartEstimateLabel: "{n} to {n2} min",
    checkCompleteNote: "Check {n} complete. This page retries by itself.",
    keepWorkingNote: "You can keep working on this step while it starts. Your line and wait are kept if this tab reloads.",
    stateGenerating: "Generating",
    makingYourTake: "Making your take",
    renderingTest: "Rendering your words in the current draft voice.",
    renderingReal: "Rendering your words, adding the disclosure and the watermark.",
    stateFailed: "Did not work",
    previewStopped: "Preview stopped",
    tryAgain: "Try again",
    stateIdle: "Nothing generated yet",
    takeAppearsHere: "Your take appears here",
    chooseLanguageNote: "Choose the language, write one natural line, and generate the current draft.",
    firstWaitNote: "The first run after a quiet period can take 2 to 5 minutes while the runtime starts. After that it is usually much faster while the runtime stays warm.",
    runtimeNotWokenHeadline: "The voice runtime did not finish waking up",
    ownerReportTooManyTimes: "It has been asked {n} times over about {n2} seconds and is still starting. Try again in a few minutes, or tell support the runtime is not coming up.",
  },

  voiceExperimentPanel: {
    kindPack: "pack",
    kindRatings: "ratings",
    kindResult: "result",
    errorCleanupFailed: "The new pack was not loaded because browser storage could not fully remove the old private experiment. The current experiment remains open.",
    errorMappingLeak: "This file reveals a candidate before ratings are locked, so it was refused.",
    errorBindingMismatch: "This {kind} file belongs to a different sealed experiment.",
    errorSizeLimit: "This {kind} file is outside the safe size limit.",
    errorIntegrityCheck: "One audio file failed its integrity check. Export the sealed pack again.",
    errorNoSignature: "This report has no valid private-pack signature, so candidate identities remain hidden.",
    errorNotValidExport: "This {kind} file is not a valid Vyakti voice experiment export.",
    errorAudioCouldNotStart: "Audio could not start. Check this browser's sound permission, then try again.",
    errorStorageFailedRemoving: "Browser storage failed while removing this private experiment. The current experiment remains open. Try again before leaving this device.",
    removeConfirm: "Remove this private experiment from this browser? Exported files on your computer are not deleted.",
    summaryTitle: "Blind voice experiment",
    summarySubtitle: "Compare real outputs before seeing which candidate made them.",
    statusIdentitiesUnlocked: "Identities unlocked",
    statusRatingsLocked: "Ratings locked",
    statusReadyToLock: "Ready to lock",
    statusRatedCount: "{n} of {n2} rated",
    statusNoExperiment: "No experiment loaded",
    dismiss: "Dismiss",
    openSealedPackTitle: "Open a sealed listening pack",
    openSealedPackBody: "Import the one-file Studio bundle. It contains opaque clips and score controls, never candidate names or the private answer key.",
    checkingPack: "Checking pack...",
    chooseSealedPack: "Choose sealed pack",
    identitiesUnlockedTitle: "Experiment identities unlocked",
    acceptedListenerNote: "{n} accepted listener sheet. These are descriptive means, not an automatic winner.",
    signatureVerified: "Signature verified",
    languageHindi: "Hindi",
    languageEnglish: "English",
    meanLabel: "mean",
    noMean: "No mean",
    noneLabel: "None",
    noPromotionNote: "No candidate is promoted here. Use the ratings as evidence alongside pronunciation checks, speaker similarity, latency, and cost.",
    learnOwnerVoiceTitle: "First, learn the owner's real voice",
    headphonesNote: "Use headphones and keep one volume. Candidate identities remain outside this browser pack.",
    playOwnerAgain: "Play owner again",
    playRealOwner: "Play real owner",
    startBlindRating: "Start blind rating",
    ratingsLockedTitle: "Ratings locked on this browser",
    ratingsLockedBody: "The candidate mapping is still sealed. Export this sheet, admit it through the private listening gate, then import the unsealed report.",
    savedLocally: "Saved locally",
    exportBeforeLeaving: "Export before leaving",
    exportLockedRatings: "Export locked ratings",
    importUnsealedReport: "Import unsealed report",
    privateGateCommandsSummary: "Private gate commands",
    privateGateCommandsNote: "Then import reports/unsealed-report.json above. A failed listening check does not unlock identities.",
    progressBarAriaLabel: "Blind experiment progress",
    progressAriaValueText: "{n} of {n2} ratings complete",
    listeningCheck: "Listening check",
    positionLabel: "{n} of {n2}",
    playHiddenClipAgain: "Play hidden clip again",
    playHiddenClip: "Play hidden clip",
    clipHeard: "Clip heard",
    playBeforeRating: "Play before rating",
    axisScaleLabel: "1 {n} · 5 {n2}",
    axisButtonAriaLabel: "{label}: {n} of 5",
    disclosureLegend: "Was the spoken AI disclosure clear and complete?",
    noteQuestion: "What sounded wrong, if anything?",
    playCheckAgain: "Play check again",
    playCheck: "Play check",
    attentionPrompt: "Play the short check, then choose what you heard.",
    back: "Back",
    savingPack: "Saving pack...",
    progressSavedLocally: "Progress saved locally",
    exportProgressBeforeLeaving: "Export progress before leaving",
    lockRatings: "Lock ratings",
    saveAndContinue: "Save and continue",
    lockIrreversibleNote: "Locking is irreversible in Studio. Export remains available afterward.",
    exportProgress: "Export progress",
    importProgress: "Import progress",
    replaceClearsNote: "Replacing clears this pack, its local ratings, and any imported result from this browser.",
    working: "Working...",
    replacePack: "Replace pack",
    removePrivateExperiment: "Remove private experiment",
  },

  shareKit: {
    title: "Share kit",
    intro: "The exact text and picture for each place you already post. Copy one, or open WhatsApp with it ready to send.",
    loading: "Loading your share kit...",
    whatsappLabel: "WhatsApp",
    instagramLabel: "Instagram bio",
    youtubeLabel: "YouTube description",
    telegramLabel: "Telegram channel post",
    copy: "Copy",
    copied: "Copied",
    openWhatsapp: "Open WhatsApp",
    viewPicture: "Picture",
    notPublishedYet: "Publish your Room to get your share kit.",
    whatsappTemplate:
      "I have started {name} AI, a place to ask {name} anything, any time. It is upfront that it is an AI, not {name}, and it never shares what you say with anyone else. Talk to it here: {url}",
    instagramTemplate: "{name} AI, talk any time: {url}",
    youtubeTemplate:
      "{name} AI is here.\n\nI built an AI version of myself so you can ask questions any time, even when I am offline. It is upfront that it is an AI, not {name}, and it never shares what you say with anyone else.\n\nTalk to it: {url}",
    telegramTemplate:
      "{name} AI is live. Ask anything, any time, right here: {url}\n\nIt is an AI built from {name}'s own material, not {name} themselves, and it never shares your messages with anyone.",
  },
};


// ── the copy table: English now, Hindi as its own chunk ──────────────────
// `hi` starts as a placeholder that THROWS on any property read, never as
// English: a renderer that reaches the Hindi table before `loadStudioCopy`
// has installed it fails loudly (`studio_copy_hi_not_loaded`) instead of
// silently showing English to a Hindi creator, which is the failure this
// shape would otherwise invite. `StudioLocaleProvider` (localeContext.tsx)
// renders nothing until `studioCopyReady(locale)` is true, so no component
// under it can hit the placeholder; the layout fixture and the evals await
// `loadStudioCopy("hi")` before they read `.hi`. See
// context/decisions.md#studio-hindi-table-is-its-own-chunk.
const HI_NOT_LOADED: StudioCopy = new Proxy({} as StudioCopy, {
  get(_target, key) {
    if (key === "then" || typeof key === "symbol") return undefined;
    throw new Error(`studio_copy_hi_not_loaded: read of ${String(key)} before loadStudioCopy("hi")`);
  },
});

export const STUDIO_COPY_TABLE: Record<StudioLocale, StudioCopy> = { en: EN, hi: HI_NOT_LOADED };

const COPY_LOADED: Record<StudioLocale, boolean> = { en: true, hi: false };
let hiLoading: Promise<StudioCopy> | null = null;

/** True once `STUDIO_COPY_TABLE[locale]` is the real table for that locale. */
export function studioCopyReady(locale: StudioLocale): boolean {
  return COPY_LOADED[normalizeStudioLocale(locale)];
}

/** Installs the locale's table into `STUDIO_COPY_TABLE` (the Hindi one from
 *  its own chunk, once) and resolves to it. Idempotent; concurrent callers
 *  share one in-flight import. */
export function loadStudioCopy(locale: StudioLocale): Promise<StudioCopy> {
  const safe = normalizeStudioLocale(locale);
  if (COPY_LOADED[safe]) return Promise.resolve(STUDIO_COPY_TABLE[safe]);
  if (!hiLoading) {
    hiLoading = import("./hiCopy").then((mod) => {
      STUDIO_COPY_TABLE.hi = mod.HI;
      COPY_LOADED.hi = true;
      return mod.HI;
    });
  }
  return hiLoading;
}

export type { StudioCopy };

// ── WS-R79: language tagging for screen readers ─────────────────────────
// `src/room/copy.ts`'s own `detectRoomTextLang` comment, restated for the
// creator's own chrome rather than the follower's: `document.documentElement.
// lang` names the STUDIO locale the creator chose to read their own screens
// in - it says nothing about what script their own Room name happens to be
// written in (`StudioApp.tsx`'s own main workspace heading, a creator's own
// name shown back to them, independent of which locale they are reading the
// rest of the studio's chrome in). Duplicated rather than imported from
// `src/room/copy.ts` on the SAME precedent that file's own `withCount`/
// `withLabel` already follow next to `src/room/copy.ts`'s `withName`/
// `withRetry` - one small helper per surface, not a shared import between
// two files that are each read and reasoned about on their own.
const STUDIO_DEVANAGARI_RANGE = /[ऀ-ॿ]/;

/** Detects which of `STUDIO_LOCALES` a piece of TEXT is actually written in,
 *  from its own characters - `src/room/copy.ts`'s own `detectRoomTextLang`,
 *  the studio's own copy of the identical one-line rule. */
export function detectStudioTextLang(text: string): StudioLocale {
  return STUDIO_DEVANAGARI_RANGE.test(String(text || "")) ? "hi" : "en";
}
