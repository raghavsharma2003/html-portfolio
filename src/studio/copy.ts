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
  showcasePicker: ShowcasePickerCopy;
  reviewQueueFlags: ReviewQueueFlagsCopy;
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

  roomStudio: {
    eyebrow: "आपका रूम",
    loadingTitle: "आपका रूम लोड हो रहा है",
    checkingExists: "जांचा जा रहा है कि आपका रूम अभी है या नहीं।",
    setupTitle: "वह जगह बनाएं जहां आपका AI रहता है",
    setupIntro:
      "एक रूम हर फॉलोअर के लिए, जो आपके AI से बात करता है, एक निजी, लगातार चलने वाला पता है। यह हर एक को खुद " +
      "याद रखता है, और कभी एक फॉलोअर को दूसरे को नहीं दिखाता। इसे एक बार बना लें, फिर जब नीचे के गेट खुल जाएं तो " +
      "इसे पब्लिश करें।",
    settingUp: "बनाया जा रहा है...",
    setupButton: "अपना रूम बनाएं",
    liveTitle: "वह जगह जहां आपका AI रहता है",
    liveIntro:
      "एक निजी, लगातार चलने वाला पता। हर फॉलोअर जो जुड़ता है, आपके AI के साथ अपना ही याद रखा हुआ रिश्ता पाता है, " +
      "और उनमें से कोई भी कभी किसी और फॉलोअर की बातचीत, या आपकी, नहीं देखता।",
    statusPaused: "रुका हुआ",
    statusLive: "लाइव",
    statusDraft: "पब्लिश नहीं हुआ",
    addressCardTitle: "आपके रूम का पता",
    copied: "कॉपी हो गया",
    copyLink: "लिंक कॉपी करें",
    downloadStoryCard: "स्टोरी कार्ड डाउनलोड करें",
    partOf: "{label} का हिस्सा।",
    suiteCoversRoom: "{label} में आपकी सीट इस रूम को कवर करती है।",
    yourSuite: "आपका Suite",
    tierGroupAriaLabel: "टियर",
    tierFreeLabel: "आपका टियर: मुफ़्त क्षमता।",
    working: "हो रहा है...",
    upgradeToRoom: "Room में अपग्रेड करें ({label}/माह)",
    upgradeToStudio: "Studio में अपग्रेड करें ({label}/माह)",
    tierLabel: "आपका टियर: {label}।",
    tierRoom: "Room",
    tierStudio: "Studio",
    willNotRenewOn: " {label} के बाद नवीनीकृत नहीं होगा।",
    renewsOn: " {label} को नवीनीकृत होगा।",
    cancel: "रद्द करें",
    changeAddressLabel: "पता बदलें",
    saving: "सेव हो रहा है...",
    saveAddress: "पता सेव करें",
    enterAddress: "अपने रूम के लिए एक पता डालें।",
    addressInvalid: "3 से 40 अक्षर, अंक, या डैश के बीच।",
    willReadAs: "यह ऐसे दिखेगा: {label}",
    telegramCardTitle: "Telegram पर आपका रूम",
    open: "खोलें",
    telegramNotConnected:
      "अभी नहीं जुड़ा। फॉलोअर्स फिर भी ऊपर वाले पते पर आपके रूम तक पहुंच सकते हैं; Telegram पहुंचने का एक दूसरा " +
      "तरीका है, कोई ज़रूरत नहीं।",
    ownSiteCardTitle: "अपनी खुद की साइट पर",
    ownSiteIntro:
      "इसे किसी भी पेज पर पेस्ट करें जो आप नियंत्रित करते हैं: एक कोचिंग साइट, एक Linktree, एक ब्लॉग पोस्ट। यह " +
      "नीचे आपके रूम का डिस्क्लोज़र दिखाते हुए एक बटन दिखाता है, और क्लिक करने पर आपका रूम एक नए टैब में खोलता है। " +
      "यह कोई कुकी सेट नहीं करता और आपके विज़िटर से कुछ नहीं मांगता।",
    embedSnippetAriaLabel: "एम्बेड स्निपेट",
    copySnippet: "स्निपेट कॉपी करें",
    ownSiteFooter:
      "विज़िटर वही भाषा में डिस्क्लोज़र देखते हैं जिसमें आपका रूम पहले दिखता है, अंग्रेज़ी या हिन्दी, और यह बटन " +
      "आपके रूम को कभी उनके पेज के अंदर नहीं रखता। यह हमेशा आपके रूम का अपना पता खोलता है।",
    publishCardTitlePublished: "पब्लिशिंग",
    publishCardTitleUnpublished: "अपना रूम पब्लिश करें",
    publishing: "पब्लिश हो रहा है...",
    publishButton: "अपना रूम पब्लिश करें",
    resume: "फिर शुरू करें",
    pause: "रोकें",
    liveSince:
      "{label} से लाइव है। आपके रूम का पता रखने वाला कोई भी जुड़ सकता है और आपके AI के साथ अपना याद रखा हुआ " +
      "रिश्ता शुरू कर सकता है।",
    recently: "हाल ही में",
    pausedNotice: "रुका हुआ है। जब तक आप इसे फिर शुरू नहीं करते, कोई भी आपके रूम तक नहीं पहुंच सकता।",
    listMyRoomTitle: "मेरा रूम लिस्ट करें",
    listMyRoomIntro:
      "लिस्ट करने पर आपका रूम क्रिएटर डायरेक्टरी में दिखता है: आपका नाम, नीचे की एक-लाइन जानकारी, और जिस भाषा " +
      "में आपके रूम की स्क्रीन बोलती हैं। यह कभी नहीं दिखाता कि आपके कितने फॉलोअर हैं।",
    oneLineDescriptionLabel: "एक-लाइन जानकारी",
    oneLineDescriptionPlaceholder: "आप किस बारे में बात करते हैं, एक लाइन में",
    save: "सेव करें",
    listedNote: "लिस्टेड है। डायरेक्टरी देखने वाला कोई भी आपका रूम ढूंढ सकता है।",
    notListedNote: "लिस्टेड नहीं है। आपका रूम फिर भी लिंक रखने वाले किसी के लिए भी काम करता है।",
    publishFirstNote: "पहले अपना रूम पब्लिश करें, फिर आप इसे लिस्ट कर सकते हैं।",
    removeFromDirectory: "डायरेक्टरी से हटाएं",
    listMyRoom: "मेरा रूम लिस्ट करें",
    freeFollowersTitle: "मुफ़्त फॉलोअर्स",
    freeFollowersIntro:
      "जिस फॉलोअर ने भुगतान नहीं किया है उसे महीने में इतने मैसेज मिलते हैं, कोई वॉइस नहीं, कोई चेक-इन नहीं। " +
      "आप इसे कभी भी बदल सकते हैं।",
    freeMonthlyMessagesAriaLabel: "मुफ़्त मासिक मैसेज",
    roomLanguageTitle: "रूम की भाषा",
    roomLanguageIntro:
      "आपका AI वही बोलता रहता है जो आप उससे बोलते हैं - यह सिर्फ ऐप की अपनी स्क्रीन चुनता है: बटन, डिस्क्लोज़र " +
      "लाइन, मेन्यू। जो फॉलोअर पहले जुड़ चुका है, या जिसके अपने ब्राउज़र ने कोई भाषा बताई है, वह इसके बजाय वही " +
      "देखता है; यह बाकी सबके लिए सिर्फ पहली स्क्रीन है।",
    defaultRoomLanguageAriaLabel: "डिफ़ॉल्ट रूम भाषा",
    paidFollowersTitle: "पेड फॉलोअर्स",
    paidFollowersIntroPre: "फेयर-यूज़ सीमा के भीतर लगभग असीमित चैट, साथ ही वॉइस जवाब जब",
    paidFollowersIntroPost: "चालू हो। दोनों नंबर प्लान की सीमा के भीतर आपके तय करने के लिए हैं।",
    messagesAMonthLabel: "महीने में मैसेज",
    paidMonthlyMessagesAriaLabel: "पेड मासिक मैसेज",
    voiceMinutesAMonthLabel: "महीने में वॉइस मिनट",
    paidMonthlyVoiceMinutesAriaLabel: "पेड मासिक वॉइस मिनट",
    priceTitle: "कीमत",
    priceIntro:
      "ऊपर के मुफ़्त मैसेज के बाद, फेयर-यूज़ के भीतर असीमित के लिए एक फॉलोअर महीने में क्या देता है। {min} और " +
      "{max} के बीच। Vyakti एक फॉलोअर के भुगतान का {pct}% रखता है; बाकी आपका है।",
    followerPriceAriaLabel: "फॉलोअर कीमत",
    noPriceYet: "अभी कोई कीमत तय नहीं है। जब तक आप एक तय नहीं करते, फॉलोअर्स सदस्यता नहीं ले सकते।",
    moneyTitle: "पैसा",
    subscribers: "सब्सक्राइबर्स",
    leftThisMonth: "इस महीने छोड़ा",
    yourShareThisMonth: "इस महीने आपका हिस्सा",
    noSubscribersYet: "अभी कोई सब्सक्राइबर नहीं।",
    lastPayout: "पिछला पेआउट: {label} ({label2}), {label3} से {label4} तक के लिए।",
    noPayoutYet: "अभी कोई पेआउट नहीं है।",
    howDoingTitle: "आपका रूम कैसा कर रहा है",
    noFollowersYet: "अभी कोई फॉलोअर नहीं। इसे बदलने के लिए अपने रूम का पता शेयर करें।",
    followers: "फॉलोअर्स",
    activeToday: "आज सक्रिय",
    messagesThisMonth: "इस महीने के मैसेज",
    couldNotLoadCounts: "अभी आपके आंकड़े लोड नहीं हो सके। अगली बार लोड होने पर ये दिखेंगे।",
    weekSixTitle: "छठा हफ़्ता",
    weekSixIntro:
      "किसी हफ़्ते में जुड़े फॉलोअर्स में से, छह हफ़्ते बाद भी आपके AI से बात कर रहे लोगों का हिस्सा। यह वह नंबर " +
      "है जो सबसे ज़्यादा मायने रखता है, भेजे गए मैसेज या आज कितने आए उससे भी ज़्यादा।",
    noCohortsYet: "अभी कोई कोहॉर्ट नहीं। आपके रूम के पहले फॉलोअर मिलते ही यह भरना शुरू होगा।",
    weekOf: "{label} का हफ़्ता",
    noFollowersThatWeek: "उस हफ़्ते कोई फॉलोअर नहीं",
    stillTalkingPct: "{n}% अभी भी बात कर रहे हैं",
    notMeasurableUntil: "{label} तक मापने लायक नहीं",
    notMeasurableYetVerdict: "अभी मापने लायक नहीं। इसके लिए कम से कम छह हफ़्ते पुराना कोहॉर्ट चाहिए।",
    belowGateBand: "25% के उस गेट से नीचे जो इस प्रोडक्ट को बिल्कुल काम करने के लिए चाहिए",
    aboveCategoryBand: "40% की उस लाइन से ऊपर जहां यह एक श्रेणी बन जाता है",
    betweenBand: "25% के गेट और 40% की श्रेणी लाइन के बीच",
    cohortVerdictSentence: "आपका सबसे पुराना मापने लायक कोहॉर्ट, {label} के हफ़्ते का, {n}% वापस आया। यह {label2} है।",
    soon: "जल्द",
    gateLine: "गेट 25% या उससे ज़्यादा है। 40% या उससे ज़्यादा वह जगह है जहां यह एक फ़ीचर होना बंद कर एक श्रेणी बन जाता है।",
    couldNotLoadRetry: "अभी यह लोड नहीं हो सका। अगली बार लोड होने पर यह दिखेगा।",
    loading: "लोड हो रहा है।",
    pulseTitle: "Pulse",
    pulseIntro:
      "आपके फॉलोअर्स किस बारे में बात कर रहे हैं, सिर्फ आंकड़ों के रूप में, और सिर्फ उन बातचीत से जिन्हें किसी " +
      "फॉलोअर ने खुद गिनने देना चुना। कभी कोई मैसेज नहीं, कभी कोई नाम नहीं, और जब तक किसी नंबर के पीछे कम से कम " +
      "पांच अलग-अलग फॉलोअर न हों, तब तक कभी नहीं दिखाया जाता।",
    pulseTopicsAriaLabel: "Pulse विषय",
    removeTopicAriaLabel: "विषय {label} हटाएं",
    addTopicPlaceholder: "एक विषय जोड़ें, जैसे परीक्षा का तनाव",
    add: "जोड़ें",
    notEnoughOptins: "अभी तक पर्याप्त लोगों ने ऑप्ट-इन नहीं किया।",
    enoughOptinsNoBucket: "पर्याप्त फॉलोअर्स ने ऑप्ट-इन किया है, लेकिन अभी किसी के पीछे पांच नहीं हैं।",
    suppressedOne: "{n} संयोजन इस हफ़्ते रोका गया क्योंकि दिखाने से किसी का नाम पता चल जाता।",
    suppressedMany: "{n} संयोजन इस हफ़्ते रोके गए क्योंकि दिखाने से किसी का नाम पता चल जाता।",
    showMe: "मुझे दिखाएं",
    noticeRoomSetup: "आपका रूम बन गया है। जब तैयार हों तब इसे पब्लिश करें।",
    noticeAddressSaved: "पता सेव हो गया।",
    noticeRoomLive: "आपका रूम लाइव है।",
    noticeResumed: "फिर शुरू हुआ। आपका रूम फिर से लाइव है।",
    noticeDefaultLocaleHi: "जिन नए फॉलोअर्स ने भाषा तय नहीं की, वे पहले हिन्दी देखेंगे।",
    noticeDefaultLocaleEn: "जिन नए फॉलोअर्स ने भाषा तय नहीं की, वे पहले अंग्रेज़ी देखेंगे।",
    noticeBioSaved: "आपकी एक-लाइन जानकारी सेव हो गई।",
    noticeListed: "लिस्टेड है। आपका रूम अब क्रिएटर डायरेक्टरी में दिखता है।",
    noticeUnlisted: "अनलिस्टेड है। आपका रूम डायरेक्टरी में नहीं है; ऊपर वाला लिंक फिर भी काम करता है।",
    noticeFreeCap: "मुफ़्त फॉलोअर्स को अब महीने में {n} मैसेज मिलते हैं।",
    noticePaidCeilings: "पेड फॉलोअर्स को अब महीने में {n} मैसेज और {n2} वॉइस मिनट मिलते हैं।",
    noticePrice: "फॉलोअर्स अब महीने में {label} देते हैं।",
    noticeTierStarted: "आपकी टियर सदस्यता शुरू हो गई है।",
    noticeTierCancel: "मौजूदा अवधि खत्म होने के बाद नवीनीकृत नहीं होगी।",
  },

  videoLinkMount: {
    eyebrow: "जल्द आ रहा है",
    title: "एक वीडियो, लिंक से",
    blurb:
      "एक लेक्चर का URL पेस्ट करें और हम ऑडियो निकालते हैं, उसे ट्रांसक्राइब करते हैं, और बताते हैं कि यह आपके " +
      "समझाने के तरीके के बारे में हमें क्या सिखाता है। यह हिस्सा अभी बन रहा है और अभी जुड़ा नहीं है।",
    noBoxNote:
      "अभी जानबूझकर यहां पेस्ट करने के लिए कोई बॉक्स नहीं है। एक फ़ील्ड जो लिंक ले ले और उसका कुछ न करे, आपसे " +
      "पेस्ट और इंतज़ार दोनों लेगी, और आपको कुछ सच नहीं बताएगी।",
    worksTodayNote:
      "वीडियो के लिए आज क्या काम करता है: नीचे अपना चैनल जोड़ें, और हम आपकी दी हुई अनुमति से नए अपलोड देखते " +
      "हैं। वह हिस्सा जो भी निकालता है, वह आपको बताया जाता है, खुद से लागू नहीं किया जाता।",
  },

  runtimeGate: {
    labels: {
      self_replica_only: "सिर्फ़-खुद की नीति",
      replica_not_ready: "मंज़ूर आवाज़ और व्यवहार",
      self_identity_not_bound: "अकाउंट-से-व्यक्ति की पुष्टि हुई बाइंडिंग",
      adult_verification_required: "जीवित-वयस्क सत्यापन",
      identity_verification_required: "पहचान सत्यापन",
      liveness_verification_required: "लाइव एंटी-रीप्ले जांच",
      inference_consent_required: "इन्फ़रेंस अनुमति",
      person_profile_not_approved: "मंज़ूर: हमने आपके बारे में क्या सीखा",
      calibration_not_approved: "मंज़ूर व्यवहार कैलिब्रेशन",
      voice_genome_not_approved: "मंज़ूर आवाज़",
      voice_not_ready: "प्रोडक्शन वॉइस मैपिंग",
      production_voice_required: "गैर-टेस्ट वॉइस प्रोवाइडर",
      qualification_incomplete: "सात-सुइट क्वालिफ़िकेशन",
    },
    eyebrow: "रनटाइम",
    title: "आपका AI किसी से बात कर सके, उससे पहले क्या पास होना चाहिए",
    intro:
      "लॉन्च हमने आपके बारे में जो सीखा उसका सटीक वर्शन, सटीक आवाज़, प्रोवाइडर वॉइस, रिश्ते का नेमस्पेस, और " +
      "मूल्यांकन सेट को बांधता है। नए ड्राफ्ट चुपचाप किसी सक्रिय AI को नहीं बदल सकते।",
    sealActive: "सक्रिय",
    sealSealed: "सील्ड",
    sealSubActive: "सिर्फ़ निजी इस्तेमाल",
    sealSubSealed: "कोई जनरेशन एक्सेस नहीं",
    checkingGates: "हर लॉन्च गेट जांचा जा रहा है...",
    retry: "फिर कोशिश करें",
    qualificationSuitesPassed: "क्वालिफ़िकेशन सुइट पास हुए",
    whatWeLearnedVersion: "हमने क्या सीखा: वर्शन",
    calibrationVersion: "कैलिब्रेशन वर्शन",
    voiceVersion: "आवाज़ वर्शन",
    gatesClosedOne: "{n} लॉन्च गेट अभी भी बंद है",
    gatesClosedMany: "{n} लॉन्च गेट अभी भी बंद हैं",
    actionNote:
      "आपके AI की कॉल सिर्फ़ सुरक्षित कैस्केड स्पीच इस्तेमाल करती हैं। किसी और क्लाउड वॉइस या डिवाइस टेक्स्ट " +
      "टू स्पीच पर कोई फ़ॉलबैक नहीं है।",
    freezing: "क्षमता फ़्रीज़ की जा रही है...",
    runtimeActive: "रनटाइम सक्रिय है",
    activateButton: "निजी रनटाइम सक्रिय करें",
    readinessUnavailable: "रनटाइम की तैयारी अभी उपलब्ध नहीं है",
    activationRefused: "रनटाइम सक्रिय करना अस्वीकार हुआ",
  },

  turnFeedback: {
    dimensionLabel: {
      wording: "शब्द चयन",
      behavior: "व्यवहार",
      relationship: "रिश्ता",
      memory: "याददाश्त",
      delivery: "डिलीवरी",
      voice_identity: "आवाज़",
    },
    dimensionDescription: {
      wording: "वाक्यांश और वाक्य की बनावट",
      behavior: "आप कैसे प्रतिक्रिया देते और फैसले लेते हैं",
      relationship: "इस व्यक्ति के साथ यह कैसा लगता है",
      memory: "तथ्य, पुरानी बातें, और अनिश्चितता",
      delivery: "गति, भाव, और बिना-शब्दों वाले संकेत",
      voice_identity: "वह सुरक्षित ऑडियो जो आपने असल में सुना",
    },
    ratingLabel: { exact: "बिल्कुल सही", close: "करीब", off: "गलत" },
    reasonLabel: {
      too_generic: "बहुत सामान्य",
      wrong_fact: "गलत तथ्य",
      wrong_relationship: "गलत रिश्ता",
      wrong_tone: "गलत लहजा",
      wrong_wording: "गलत शब्द चयन",
      too_long: "बहुत लंबा",
      too_short: "बहुत छोटा",
      voice_mismatch: "आवाज़ नहीं मिली",
      emotion_mismatch: "भाव नहीं मिला",
      unsafe_or_boundary: "एक सीमा पार की",
      other: "कुछ और",
    },
    playVoiceFirst: "पहले सुरक्षित आवाज़ चलाएं",
    savedRevision: "रिविज़न {n} सुरक्षित",
    didThisFeelLikeYou: "क्या यह आपकी तरह लगा?",
    thisIsMe: "यह मैं हूं",
    tuneThis: "इसे ठीक करें",
    teachDifference: "फ़र्क सिखाएं",
    close: "बंद करें",
    gradeOnlyNote: "सिर्फ़ वही रेट करें जो आपने देखा। बिना रेट किए हिस्से अनजान ही रहते हैं।",
    whatMissed: "क्या चूक गया?",
    correctionLabel: "आप असल में क्या कहेंगे?",
    correctionOptionalNote: "वैकल्पिक, सेव होने से पहले एन्क्रिप्टेड",
    correctionPlaceholder: "वह वर्शन लिखें जो आपकी तरह लगे।",
    layersRatedOne: "{n} हिस्सा रेट किया गया",
    layersRatedMany: "{n} हिस्से रेट किए गए",
    chooseAtLeastOne: "कम से कम एक हिस्सा चुनें",
    securing: "सुरक्षित किया जा रहा है...",
    saveEvidence: "सबूत सेव करें",
    errorFallback: "यह सटीकता नोट सुरक्षित नहीं हो सका",
  },

  replicaDialogueLab: {
    eyebrow: "निजी बातचीत",
    title: "अपने AI से निजी तौर पर, टेक्स्ट में बात करें",
    intro:
      "हर जवाब उस पर बनता है जो हमने आपके बारे में सीखा, आपके अपने कैलिब्रेशन, इस रिश्ते की निजी स्थिति, और " +
      "हाल के टर्न। वॉइस प्लेबैक सिर्फ़ वही सर्वर-जारी जवाब बोल सकती है।",
    statusPrivateLive: "निजी · लाइव",
    statusSealed: "सील्ड",
    lockedHeadline: "जब तक निजी रनटाइम हर गेट पास न करे, बातचीत उपलब्ध नहीं होगी।",
    lockedNote: "कोई फ़ॉलबैक AI, सामान्य आवाज़, या आधा सक्रिय होना इस्तेमाल नहीं होता।",
    stopVoice: "आवाज़ रोकें",
    playProtectedVoice: "सुरक्षित आवाज़ चलाएं",
    emptyHeadline: "कुछ ऐसा शुरू करें जो सिर्फ़ आप ही नोटिस करेंगे।",
    emptyNote: "पहला टर्न एक निजी, वर्शन-बद्ध सेशन खोलता है।",
    thinking: "सबूत-आधारित जवाब बनाया जा रहा है...",
    messageLabel: "अपने AI को मैसेज करें",
    messagePlaceholder: "यहां मैं क्या कहूंगा?",
    sendPrivately: "निजी तौर पर भेजें",
    dismiss: "हटाएं",
    trustNote:
      "ऑडियो के लिए सिंथेटिक डिस्क्लोज़र और वॉटरमार्किंग हमेशा ज़रूरी रहती है। बातचीत के लॉग निजी और मिटाए " +
      "जा सकने वाले हैं; यह स्क्रीन कभी AI, एजेंट, व्यक्ति, स्टोरेज, या प्रोवाइडर की पहचान नहीं दिखाती।",
    errorReadinessUnavailable: "निजी बातचीत की तैयारी अभी उपलब्ध नहीं है",
    errorReconcileRequired:
      "यह जवाब पूरा हो गया, लेकिन अगले पेड टर्न से पहले Azure इस्तेमाल को ऑपरेटर की तरफ़ से मिलाना ज़रूरी है।",
    errorCouldNotAnswer: "आपका AI जवाब नहीं दे सका",
    errorVoicePlayback: "सुरक्षित आवाज़ चलाई नहीं जा सकी",
  },

  calibrationStudio: {
    layers: {
      delivery: "डिलीवरी",
      language: "भाषा",
      behaviour: "व्यवहार",
      memory: "याददाश्त",
      relationship: "रिश्ता",
    },
    blockers: {
      approved_person_profile_required: "पहले हमने आपके बारे में जो सीखा उसे मंज़ूर करें",
      delivery_calibration_required: "कम से कम एक डिलीवरी तुलना चुनें",
      language_calibration_required: "कम से कम एक भाषा तुलना चुनें",
      behaviour_calibration_required: "कम से कम एक व्यवहार तुलना चुनें",
      memory_calibration_required: "कम से कम एक याददाश्त तुलना चुनें",
      relationship_calibration_required: "कम से कम एक रिश्ता तुलना चुनें",
      calibration_depth_required: "कम से कम सात तुलनाएं हल करें",
    },
    eyebrow: "व्यवहार कैलिब्रेशन",
    title: "इसे दिखाएं कि आप असल में कैसे जवाब देंगे",
    intro:
      "सुरक्षित व्यवहार तुलनाओं में से चुनें। हर सुधार वर्शन वाला प्राथमिकता सबूत बनता है, कभी किसी प्रॉम्प्ट " +
      "में चिपकाया गया एक और वाक्य नहीं।",
    approvedPolicyLabel: "मंज़ूर नीति",
    preparingContrasts: "कैलिब्रेशन तुलनाएं तैयार की जा रही हैं...",
    retry: "फिर कोशिश करें",
    contrastsReviewedAriaLabel: "{n2} में से {n} तुलनाएं देखी गईं",
    contrastsReviewed: "तुलनाएं देखी गईं",
    calibrationScenariosAriaLabel: "कैलिब्रेशन परिदृश्य",
    openContrastAriaLabel: "{label} तुलना {n} खोलें",
    orWord: "या",
    bothFeelLikeMe: "दोनों मेरी जैसी लगती हैं",
    neitherIsMe: "कोई भी मेरी जैसी नहीं",
    freeTextNote:
      "फ़्री-टेक्स्ट नोट कभी व्यवहार में नहीं जोड़े जाते। सिर्फ़ देखी गई, सर्वर की अपनी रणनीतियां ही किसी " +
      "फ़्रीज़ की गई रनटाइम क्षमता में जा सकती हैं।",
    checkingChoices: "चुनाव जांचे जा रहे हैं...",
    approveCalibrationVersion: "कैलिब्रेशन v{n} मंज़ूर करें",
    buildingPolicy: "नीति बनाई जा रही है...",
    buildCalibrationPolicy: "कैलिब्रेशन नीति बनाएं",
    errorCouldNotLoad: "कैलिब्रेशन लोड नहीं हो सका",
    errorChoiceNotSaved: "आपका कैलिब्रेशन चुनाव सेव नहीं हुआ",
    errorBuildRefused: "कैलिब्रेशन बनाना अस्वीकार हुआ",
    errorApproveChanged: "कैलिब्रेशन बदल गई और मंज़ूर नहीं हो सकी",
  },

  candidateEvaluationLab: {
    dimensionCopy: {
      overall: { label: "कुल मिलाकर", hint: "कौन-सा आपकी जैसा ज़्यादा लगता है?" },
      wording: { label: "शब्द चयन", hint: "वाक्यांश, वाक्य की बनावट, और लंबाई" },
      behavior: { label: "व्यवहार", hint: "प्रतिक्रिया, समझ, और जवाब देने का तरीका" },
      relationship: { label: "रिश्ता", hint: "इस सटीक रिश्ते में आप कैसे बोलेंगे" },
      memory: { label: "याददाश्त", hint: "तथ्य, पुरानी बातें, और ईमानदार अनिश्चितता" },
      delivery: { label: "डिलीवरी", hint: "गति, ऊर्जा, और भाव की बनावट" },
    },
    choiceLabel: { a: "A ज़्यादा करीब है", tie: "कोई फ़र्क नहीं", b: "B ज़्यादा करीब है" },
    loadErrorFallback: "यह तुलना लोड नहीं हो सकी",
    eyebrow: "अंधी तुलना",
    title: "बिना बताए, ज़्यादा करीब वाली आवाज़ चुनें",
    intro: "दो छिपे हुए आउटपुट को परत दर परत मिलाएं। पूरी समीक्षा पूरी होने तक इनकी पहचान छिपी रहती है।",
    sealAriaLabel: "समीक्षा की गोपनीयता स्थिति",
    blindedLabel: "छिपा हुआ",
    mappingNote: "A/B मैपिंग सिर्फ़ सर्वर पर रहती है",
    loadingAriaLabel: "अंधी समीक्षा लोड हो रही है",
    comparisonUnavailable: "तुलना उपलब्ध नहीं है",
    tryAgain: "फिर कोशिश करें",
    emptyHeadline: "अभी समीक्षा के लिए कोई योग्य उम्मीदवार नहीं है।",
    emptyNote: "यह तभी खुलता है जब एक फ़्रीज़ किया टेस्ट सेट और दो एन्क्रिप्टेड उम्मीदवार आउटपुट कम से कम 30 तुलनाओं के लिए मौजूद हों।",
    completeHeadline: "अंधी समीक्षा पूरी हुई",
    completeNote: "{n} तुलनाएं सील हो गई हैं। सुरक्षा, निजता, और सांख्यिकी गेट तय करते हैं कि यह उम्मीदवार आगे बढ़ सकता है या नहीं।",
    comparisonOfLabel: "तुलना {n2} में से {n}",
    sealedCountLabel: "{n} सील हुईं",
    situationLabel: "स्थिति",
    optionsAriaLabel: "गुमनाम जवाब विकल्प",
    anonymousOutput: "गुमनाम आउटपुट",
    orWord: "या",
    judgeEveryLayer: "हर परत परखें",
    judgeInstruction: "सिर्फ़ इस स्थिति के आधार पर चुनें। बराबरी भी एक उपयोगी सबूत है।",
    layersJudged: "{n2} में से {n} परतें परखी गईं",
    sealingComparison: "तुलना सील की जा रही है...",
    sealAndContinue: "सील करें और आगे बढ़ें",
  },

  processingReview: {
    reasonLabel: {
      accepted: {
        matches_subject: "मुझसे मिलता है",
        clean_identity_signal: "साफ़ पहचान संकेत",
        measurement_verified: "मापन सत्यापित",
        segment_verified: "स्पीकर सेगमेंट सत्यापित",
      },
      rejected: {
        wrong_speaker: "गलत स्पीकर",
        third_party_present: "कोई और व्यक्ति मौजूद है",
        poor_quality: "क्वालिटी बहुत खराब है",
        corrupt_or_incomplete: "करप्ट या अधूरा",
        synthetic_or_replayed: "सिंथेटिक या रीप्ले किया गया",
        privacy_risk: "गोपनीयता जोखिम",
      },
      superseded: {
        better_variant_selected: "बेहतर वैरिएंट चुना गया",
        newer_measurement: "नया मापन",
        corrected_segmentation: "सेगमेंटेशन ठीक किया गया",
        source_replaced: "सोर्स बदला गया",
      },
    },
    recently: "हाल ही में",
    contentWithheld: "कंटेंट रोका गया है। सिर्फ़ यहां दिखे समय, विश्वास स्तर, और उद्गम की समीक्षा करें।",
    needsReview: "समीक्षा चाहिए",
    reviewAriaLabel: "{label} की समीक्षा करें",
    decisionSelectLabel: "फैसला",
    reasonSelectLabel: "वजह",
    optionAccept: "स्वीकार करें",
    optionReject: "अस्वीकार करें",
    optionSupersede: "बदलें",
    saving: "सेव हो रहा है",
    recordReview: "समीक्षा दर्ज करें",
    decisionWithheldNote: "यहां फैसला उपलब्ध नहीं है क्योंकि सबूत की सामग्री जानबूझकर रोकी गई है।",
    confidenceNotReported: "विश्वास स्तर नहीं बताया गया",
    confidencePct: "{n}% विश्वास",
    endpointSuffix: "{n} सेकंड एंडपॉइंट",
    unreportedFamily: "न बताया गया परिवार",
    unreportedAdapter: "न बताया गया एडाप्टर",
    eyebrow: "आपकी समीक्षा",
    title: "देखें हमने क्या निकाला, फिर मंज़ूर करें",
    refreshing: "रीफ़्रेश हो रहा है",
    refresh: "रीफ़्रेश करें",
    intro:
      "सिर्फ़ समीक्षा के लिए सुरक्षित माप दिखाए जाते हैं। कच्चे ट्रांसक्रिप्ट, वॉइस वेक्टर, स्टोरेज लोकेशन, " +
      "प्रोवाइडर रेफरेंस, और स्थायी डाउनलोड लिंक कभी इस पेज पर नहीं आते। एक निजी सुनने का लिंक तभी बनता है जब " +
      "आप सुनें दबाते हैं, और यह 60 सेकंड में खत्म हो जाता है।",
    loadingReceipts: "निजी प्रोसेसिंग रसीदें लोड हो रही हैं",
    emptyHeadline: "अभी कोई प्रोसेसिंग रसीद नहीं है",
    emptyNote: "ऊपर एक सोर्स जोड़ें। यह तभी दिखेगा जब निजी प्रोसेसिंग शुरू होगी।",
    sourceTitle: "{label} सोर्स",
    pipelineStepOne: "{n} पाइपलाइन स्टेप",
    pipelineStepMany: "{n} पाइपलाइन स्टेप",
    derivedVariantOne: "{n} निकाला गया वैरिएंट",
    derivedVariantMany: "{n} निकाले गए वैरिएंट",
    evidenceRecordOne: "{n} सबूत रिकॉर्ड",
    evidenceRecordMany: "{n} सबूत रिकॉर्ड",
    pipelineStepsAriaLabel: "पाइपलाइन स्टेप",
    noPipelineAttempt: "अभी कोई पाइपलाइन प्रयास दर्ज नहीं हुआ।",
    attemptLabel: "प्रयास {n}",
    selectedVoiceBadge: "चुनी गई आवाज़",
    opening: "खोला जा रहा है",
    listenPrivately: "निजी तौर पर सुनें",
    selecting: "चुना जा रहा है",
    selected: "चुना गया",
    useThisVoice: "यह आवाज़ इस्तेमाल करें",
    cannotPlayAudio: "आपका ब्राउज़र यह निजी ऑडियो नहीं चला सकता।",
    linkExpiresNote: "यह साइन किया लिंक एक मिनट से कम में खुद खत्म हो जाता है।",
    noReviewableEvidence: "इस सोर्स के लिए समीक्षा योग्य कोई सबूत नहीं भेजा गया।",
    draftOnlyEyebrow: "सिर्फ़ ड्राफ्ट",
    voiceBuildGateTitle: "वॉइस बिल्ड गेट",
    voiceBuildGateIntro:
      "क्यू में लगा बिल्ड इस्तेमाल के लिए तैयार नहीं होता। एक अलग मंज़ूरी और एक असली, अलग से रखा गया " +
      "मूल्यांकन अभी भी ज़रूरी है।",
    acousticFamilies: "ध्वनि परिवार",
    voiceMeasurements: "आवाज़ माप",
    qualityMeasurements: "क्वालिटी माप",
    speakerSegments: "स्पीकर सेगमेंट",
    queueingDraft: "ड्राफ्ट क्यू में डाला जा रहा है",
    queueDraftVoice: "ड्राफ्ट आवाज़ क्यू में डालें",
    buildLedger: "बिल्ड लेजर",
    immutableDraftLedger: "अपरिवर्तनीय ड्राफ्ट लेजर",
    voiceVersionStatus: "आवाज़ वर्शन {n}, {label}",
    voicePrintFamiliesDetail: "{n} स्वतंत्र वॉइस-प्रिंट परिवार",
    targetSegmentsDetail: "{n} टारगेट सेगमेंट",
    enrollmentArtifactsDetail: "{n} निजी एनरोलमेंट कलाकृतियां",
    draftsCannotSynthesize:
      "ड्राफ्ट ऑडियो नहीं बना सकते। मंज़ूरी के लिए अभी भी मालिक का कैलिब्रेशन और एक असली, अलग से रखा गया " +
      "पहचान मूल्यांकन ज़रूरी है।",
    errorProcessingUnavailable: "प्रोसेसिंग समीक्षा अभी उपलब्ध नहीं है",
    errorDecisionNotRecorded: "फैसला दर्ज नहीं हो सका",
    errorDraftNotQueued: "ड्राफ्ट बिल्ड क्यू में नहीं लगाया जा सका",
    errorAuditionNotOpened: "निजी सुनवाई नहीं खोली जा सकी",
    errorCandidateNotSelected: "आवाज़ उम्मीदवार चुना नहीं जा सका",
    noticeReviewRecorded: "समीक्षा का फैसला एक स्थायी रसीद के रूप में दर्ज हो गया।",
    noticeCandidateSelected: "आवाज़ उम्मीदवार चुना गया। मौजूदा ड्राफ्ट हटा दिए गए ताकि अगला वॉइस बिल्ड यही सटीक ऑडियो इस्तेमाल करे।",
    noticeDraftQueued: "ड्राफ्ट वॉइस बिल्ड क्यू में डाला गया। इस्तेमाल होने से पहले अभी भी आपकी मंज़ूरी चाहिए।",
  },

  personModelStudio: {
    blockers: {
      self_name_required: "वह नाम पुष्ट करें जो आपका AI खुद के लिए इस्तेमाल करता है",
      language_identity_required: "इसकी भाषा और कोड-स्विचिंग पहचान पुष्ट करें",
      behavior_evidence_required: "कम से कम एक व्यवहार या सुधार पैटर्न देखें",
      boundary_evidence_required: "कम से कम एक निजी सीमा पुष्ट करें",
      critical_identity_conflict: "टकराते हुए पहचान दावे सुलझाएं",
    },
    extractionBlockers: {
      transcription_consent_required: "ट्रांसक्रिप्शन की अनुमति दें",
      training_consent_required: "सहायता प्राप्त दावा निष्कर्षण के लिए AI-निर्माण अनुमति दें",
      reviewed_subject_transcript_required: "कम से कम एक सत्यापित स्पीकर ट्रांसक्रिप्ट स्वीकार करें",
    },
    confidencePct: "{n}% विश्वास",
    citedSourceOne: "{n} उद्धृत सोर्स",
    citedSourceMany: "{n} उद्धृत सोर्स",
    keepOut: "बाहर रखें",
    notAccurate: "सही नहीं है",
    outdated: "पुराना",
    thisIsMe: "यह मैं हूं",
    reviewClaimAriaLabel: "इस दावे की समीक्षा करें",
    eyebrow: "हमने आपके बारे में क्या सीखा",
    title: "हमें जो लगता है हमने आपके बारे में सीखा, एक-एक दावे के रूप में",
    intro:
      "पहचान, भाषा, व्यवहार, मूल्य, सीमाएं, और आत्मकथा को अलग-अलग सबूत-आधारित दावों के रूप में पुष्ट करें। " +
      "टकराव छिपाए नहीं जाते, एक भरोसेमंद कल्पना में औसत नहीं किए जाते।",
    approvedVersionLabel: "मंज़ूर वर्शन",
    loadingClaims: "समीक्षा किए गए दावे लोड हो रहे हैं...",
    retry: "फिर कोशिश करें",
    proposedClaims: "प्रस्तावित दावे",
    accepted: "स्वीकृत",
    criticalConflicts: "गंभीर टकराव",
    citedExtractionEyebrow: "उद्धृत निष्कर्षण",
    citedExtractionTitle: "अपनी समीक्षा की गई रिकॉर्डिंग को अपने नियंत्रण वाले दावों में बदलें",
    citedExtractionIntro:
      "सिर्फ़ स्वीकृत, लक्षित-स्पीकर ट्रांसक्रिप्ट हिस्से ही योग्य हैं। कच्चे ट्रांसक्रिप्ट सिर्फ़ सर्वर पर रहते " +
      "हैं, सीधी पहचान निष्कर्षण कॉल से पहले छिपाई जाती है, और हर नतीजा तब तक सिर्फ़ एक प्रस्ताव रहता है जब तक " +
      "आप उसे नीचे न देख लें।",
    eligibleSpans: "योग्य हिस्से",
    lastProposed: "पिछली बार प्रस्तावित",
    noExtractionRunYet: "अभी कोई निष्कर्षण नहीं हुआ",
    extractingPrivately: "निजी तौर पर निकाला जा रहा है...",
    extractNewEvidence: "नया सबूत निकालें",
    extractCitedClaims: "उद्धृत दावे निकालें",
    noClaimsHeadline: "अभी कोई व्यवहार या याददाश्त दावे नहीं हैं।",
    noClaimsNote: "प्रोसेस किया गया सबूत यहां समीक्षा के लिए दिखेगा। कच्चे ट्रांसक्रिप्ट, वेक्टर, और स्टोरेज पाथ रोके रहते हैं।",
    buildIsDeterministicNote: "एक बिल्ड निश्चित और वर्शन वाला होता है। इसे मंज़ूर करना कभी इन्फ़रेंस या आवाज़ बनाने की अनुमति नहीं देता।",
    checkingEvidence: "सबूत जांचा जा रहा है...",
    approveProfileVersion: "प्रोफ़ाइल v{n} मंज़ूर करें",
    building: "बनाया जा रहा है...",
    buildReviewDraft: "समीक्षा ड्राफ्ट बनाएं",
    errorExtractionUnavailable: "उद्धृत निष्कर्षण की स्थिति लोड नहीं हो सकी",
    errorProfileUnavailable: "हमने आपके बारे में जो सीखा वह लोड नहीं हो सका",
    errorClaimNotSaved: "दावे की समीक्षा सेव नहीं हुई",
    errorBuildRefused: "हमने आपके बारे में जो सीखा उसे बनाना अस्वीकार हुआ",
    errorApproveChanged: "प्रोफ़ाइल बदल गई और मंज़ूर नहीं हो सकी",
    errorExtractionFailed: "उद्धृत दावे नहीं निकाले जा सके",
  },
  showcase: {
    title: "अपने पेज पर दिखाएं",
    intro: "पांच तक सवाल जवाब, जो कोई अजनबी जुड़ने से पहले आपके अपने पब्लिक पेज पर देखेगा। आपके अपने शब्द, आपके अपने क्रम में।",
    publishFirst: "पहले अपना रूम पब्लिश करें, फिर आप अपने पेज पर जवाब दिखा सकते हैं।",
    slotLabel: "स्लॉट {n}, कुल 5 में से",
    questionPlaceholder: "एक सवाल जो लोग सच में पूछते हैं",
    answerPlaceholder: "आपका जवाब, आपके अपने शब्दों में",
    save: "सेव करें",
    saving: "सेव हो रहा है...",
    remove: "हटाएं",
    removing: "हटाया जा रहा है...",
    removed: "आपके पेज से हटा दिया गया।",
    saved: "आपके पेज पर सेव हो गया।",
    copyViolation: "यह टेक्स्ट ऐसे नहीं चल सकता। डैश हटाएं या जिस शब्द पर निशान लगा है उसे बदलें, फिर दोबारा कोशिश करें।",
  },
  creatorExport: {
    eyebrow: "मालिक नियंत्रण",
    title: "सब कुछ डाउनलोड करें",
    body: "यह प्लेटफ़ॉर्म आपके और आपके AI के बारे में जो कुछ भी रखता है, वह सब: आपकी सामग्री, आपकी आवाज़, आपके रूम की अपनी सेटिंग्स, आपकी पेमेंट, आपके रिव्यू फ़ैसले। किसी फॉलोअर ने आपके AI से निजी तौर पर जो कहा, वह कभी नहीं, और किसी फॉलोअर का डेटा पांच से कम की गिनती में भी कभी नहीं, वह हमेशा उन्हीं का रहता है।",
    button: "सब कुछ डाउनलोड करें",
    downloading: "आपका डाउनलोड तैयार हो रहा है...",
    rateLimited: "आप यह दिन में एक बार मांग सकते हैं। कल फिर कोशिश करें।",
    error: "आपका डाउनलोड तैयार नहीं हो सका। कृपया फिर कोशिश करें।",
    done: "आपका डाउनलोड शुरू हो गया है।",
  },
  showcasePicker: {
    pickButton: "अपनी समीक्षाओं में से चुनें",
    pickTitle: "वे कार्ड जिन्हें आपने पहले ही सही कहा है",
    pickEmpty: "अभी चुनने के लिए कुछ नहीं। पहले मिलें में कुछ कार्ड तय करें।",
    pickLoading: "देखा जा रहा है...",
    pickError: "आपके तय किए गए कार्ड पढ़े नहीं जा सके",
    pickUse: "इसे इस्तेमाल करें",
    pickCancel: "रद्द करें",
  },
  reviewQueueFlags: {
    flagsTitle: "फ़ॉलोअर्स द्वारा फ़्लैग किए गए",
    timesOne: "{n} बार फ़्लैग किया गया।",
    timesMany: "{n} बार फ़्लैग किया गया।",
    reasonsLabel: "कारण: {label}",
    reasonWrong: "गलत",
    reasonHarmful: "हानिकारक",
    reasonNotThem: "यह वे नहीं हैं",
    reasonOther: "अन्य",
    soundsRightAnyway: "फिर भी सही लगा",
    dismissing: "सेव हो रहा है...",
    dismissed: "आपकी फ़्लैग सूची से हटा दिया गया।",
    errorAction: "वह कार्रवाई सेव नहीं हो सकी",
  },
};

export const STUDIO_COPY_TABLE: Record<StudioLocale, StudioCopy> = { en: EN, hi: HI };

export type { StudioCopy };
