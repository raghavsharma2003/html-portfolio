// src/studio/copy.ts — WS-R159. The PERSONAL studio's own copy registry,
// generalizing `personalAuthCopy.ts` / `personalAuthCopyRegistry.ts`'s
// sign-in-screen pattern (the WS-R71 chunk shape:
// `context/decisions.md#studio-hindi-table-is-its-own-chunk`) to the rest of
// the personal studio: `localeContext.tsx` is the provider that reads this
// table, `hiCopy.ts` is the lazily-loaded Hindi chunk.
//
// SCOPE THIS SESSION. Every string in the four screens below moved here:
// `ExpertSharePanel.tsx`, `QuickVoiceCapture.tsx`, `ExpertConversation.tsx`,
// `PersonModelStudio.tsx`. `VoiceField.tsx` and `PersonalStudioEntry.tsx`
// carry no section of their own: the former renders no text at all (a pure
// SVG dial), the latter already reads every string it shows through the
// EXISTING `personalAuthCopy.ts` registry and needed no change. Everything
// else the brief named (`CloneExperience.tsx`, `CloneVerificationJourney.tsx`,
// `VoicePreviewPanel.tsx`, `MirrorCallStudio.tsx`, `ContextLockerPanel.tsx`,
// `VideoEnrollPanel.tsx`, and the bulk of `StudioApp.tsx`'s own signed-in
// shell) is Tier 2 this session, one line each with its reason:
// `context/decisions.md#ws-r159-tier-1-scope-and-tier-2-allowlist`.
//
// VOCABULARY. `scripts/check-copy.mjs`'s rooms-vocabulary rule (the
// CLAUDE.md ban on "clone"/"model"/"train(ing)"/etc.) is gated by
// `ROOM_VOCAB_PATH` in `scripts/copy-room-scope.mjs`, which does not name
// this file or the personal studio's own components at all — private
// expert-preparation copy is deliberately exempt from that rule; only
// Room-recipient and Room-publishing surfaces are held to it
// (`copy-room-scope.mjs`'s own header comment). This file avoids
// "clone"/"model"/"training" anyway, as a matter of product voice rather
// than gate compliance, reusing `src/creatorStudio/copy.ts#personModelStudio`
// (WS-R61)'s own already-reviewed rephrasing wherever the content overlaps
// (`context/decisions.md#ws-r159-tier-1-scope-and-tier-2-allowlist`).
import type { StudioLocale } from "../creatorStudio/studioLocalePreference";
import type { PersonalAuthCopy } from "./personalAuthCopy";
import { PERSONAL_AUTH_COPY_TABLE, loadPersonalAuthCopy, personalAuthCopyReady } from "./personalAuthCopyRegistry";

export interface ExpertSharePanelCopy {
  title: string;
  voiceOtherChannelsSummary: string;
  voiceOtherChannelsNote: string;
  reviewReadiness: string;
}

export interface QuickVoiceCaptureCopy {
  recommendedEyebrow: string;
  heading: string;
  instructionsOne: string;
  instructionsTwo: string;
  localUntilUpload: string;
  languageGroupAriaLabel: string;
  promptSummary: string;
  promptHint: string;
  startRecording: string;
  micPermissionNote: string;
  openingMic: string;
  checkPermissionPrompt: string;
  recordingVisuallyHidden: string;
  recordingLabel: string;
  ofMaxTemplate: string;
  speakMoreTemplate: string;
  finishAndBuild: string;
  meterAriaLabel: string;
  keepSpeakingTemplate: string;
  goodKeepGoing: string;
  targetReached: string;
  progressAriaLabel: string;
  improveSampleHeading: string;
  durationFormatTemplate: string;
  retakeNeeded: string;
  levelTooHigh: string;
  quietRecording: string;
  usableLevel: string;
  notEnoughYet: string;
  recordAgain: string;
  errorTooShort: string;
  errorClipped: string;
  errorTooQuiet: string;
  errorFinishFailed: string;
  errorStartFailed: string;
  errorCloseMicFailed: string;
}

export interface ExpertConversationCopy {
  ariaLabel: string;
  statusActive: string;
  statusInactive: string;
  aiReviewedByYou: string;
  continuityAudioNote: string;
  readinessTitle: {
    stopped: string;
    reconciling: string;
    checking: string;
    privateUnavailable: string;
    unavailable: string;
    setup: string;
  };
  readinessBody: {
    stopped: string;
    reconciling: string;
    checking: string;
    privateUnavailable: string;
    unavailable: string;
    setup: string;
  };
  openConversationSetup: string;
  checkAgain: string;
  newConversation: string;
  retryOpeningConversation: string;
  openingConversation: string;
  checkConversation: string;
  recentCompletedReplies: string;
  runtimeChangedNotice: string;
  historyPendingNotice: string;
  historyUnconfirmedNotice: string;
  emptyHeading: string;
  emptyBody: string;
  emptyStarterButton: string;
  emptyStarterQuestion: string;
  youLabel: string;
  yourAiLabel: string;
  stopAudio: string;
  listen: string;
  teachCorrection: string;
  workingStatus: string;
  recallPreviousLabel: string;
  askYourAi: string;
  questionPlaceholder: string;
  privateToThisRelationship: string;
  answering: string;
  send: string;
  errorRecovered: string;
  errorConversationUnavailable: string;
  errorRestoreFailed: string;
  errorOpenFailed: string;
  errorReplyFailed: string;
  errorReplySavedNeedsReconcile: string;
  errorAudioPlaybackFailed: string;
  errorVoiceUnavailable: string;
  // WS-R161 (wave twenty-two). The status beacon this workstream's own
  // brief names: shown only while Meet is open on a text-ready person sheet
  // with no voice pipeline reached yet (`runtime.text_ready` true,
  // `runtime.active` false) — a PEER addition, never inside the existing
  // block above.
  apprenticeVoiceNotice: string;
}

export interface PersonModelStudioCopy {
  blockers: Record<
    | "self_name_required"
    | "language_identity_required"
    | "behavior_evidence_required"
    | "boundary_evidence_required"
    | "critical_identity_conflict",
    string
  >;
  extractionBlockers: Record<
    | "transcription_consent_required"
    | "training_consent_required"
    | "reviewed_subject_transcript_required"
    | "reviewed_confident_subject_transcript_required"
    | "reviewed_confident_subject_evidence_required",
    string
  >;
  confidencePctTemplate: string;
  fromYourSource: string;
  citedSourceOne: string;
  citedSourceMany: string;
  keepOut: string;
  notAccurate: string;
  outdated: string;
  thisIsMe: string;
  reviewClaimAriaLabel: string;
  eyebrow: string;
  title: string;
  intro: string;
  noApprovedVersion: string;
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
  observedRangeLabel: string;
  nextCheckLabel: string;
  leaveOrReturnLabel: string;
  checkStatusNow: string;
  submittingExtraction: string;
  extractionRunning: string;
  waitingToRetry: string;
  extractionQueued: string;
  extractNewEvidence: string;
  extractCitedClaims: string;
  noClaimsHeadline: string;
  noClaimsNote: string;
  buildIsDeterministicNote: string;
  checkingEvidence: string;
  approveProfileVersionTemplate: string;
  building: string;
  buildReviewDraft: string;
  errorLoadFailed: string;
  errorExtractionUnavailable: string;
  errorProfileUnavailable: string;
  errorClaimNotSaved: string;
  errorBuildRefused: string;
  errorApproveChanged: string;
  errorExtractionFailed: string;
  errorExtractionScopeChanged: string;
  errorExtractionCheckFailed: string;
  errorExtractionCheckFailedRetryable: string;
}

// WS-R167 (own closed block, appended, never folded into
// ExpertConversationCopy above): "It remembers" — the owner's own
// continuity controls on the Meet screen, the same honest weight the
// Room's account page gives a follower over their own remembered facts and
// relationship state.
export interface MeetMemoryCopy {
  heading: string;
  onDescription: string;
  offDescription: string;
  toggleOn: string;
  toggleOff: string;
  factsHeading: string;
  factsEmpty: string;
  correctAction: string;
  forgetAction: string;
  correctPromptLabel: string;
  correctPlaceholder: string;
  correctSave: string;
  correctCancel: string;
  classificationUnconfirmed: string;
  howWeAreHeading: string;
  startFreshAction: string;
  startFreshConfirm: string;
  startFreshNothingOpen: string;
  startFreshDone: string;
  errorStatusUnavailable: string;
  errorToggleFailed: string;
  errorFactsUnavailable: string;
  errorCorrectFailed: string;
  errorForgetFailed: string;
}

// WS-R166: tier-two conversion of CloneVerificationJourney.tsx,
// VoicePreviewPanel.tsx, MirrorCallStudio.tsx, ContextLockerPanel.tsx and
// CloneExperience.tsx's own shell/menu chrome
// (`context/decisions.md#ws-r159-tier-1-scope-and-tier-2-allowlist`'s own
// allowlist, closed one file at a time). Every EN value below is the
// pre-existing literal string, moved here byte for byte: several are
// asserted verbatim by pre-existing suites this brief does not own
// (`evals/clone-verification-journey/`, `evals/comparison-reference/mounted.mjs`,
// `context/rejected.md#ws-166-english-wording-frozen-by-sibling-suites`),
// so the English column is a RELOCATION, never a rewrite. The HI column is
// new translation and, per this brief's own law 5, never uses the word
// "clone": the concept renders as "AI" throughout, matching the product
// voice `ExpertSharePanel.tsx`'s own copy already established
// ("Give your AI a home").
export interface CloneVerificationJourneyCopy {
  verificationStepTemplate: string;
  verificationPaused: string;
  leaveVerification: string;
  makeYoursTemplate: string;
  privateVerification: string;
  legacyReset: {
    erasureFailedError: string;
    title: string;
    body: string;
    startClean: string;
    confirmAriaLabel: string;
    confirmBody: string;
    startingErasure: string;
    eraseAndStartAgain: string;
    cancel: string;
  };
  identity: {
    fileEmpty: string;
    fileTooLarge: string;
    chooseFileType: string;
    uploadAuthMissing: string;
    uploadStopped: string;
    removeFailed: string;
    securingTitle: string;
    uploadNotFinished: string;
    checkingStoredFile: string;
    checkAgain: string;
    removing: string;
    removeUnfinished: string;
    addTitle: string;
    addBody: string;
    rejected: string;
    deleting: string;
    typeSelectedTemplate: string;
    pdfLabel: string;
    imageLabel: string;
    chooseId: string;
    sizeOnDeviceTemplate: string;
    fileTypesHint: string;
    declaration: string;
    statusChecking: string;
    statusAuthorizing: string;
    statusUploading: string;
    statusVerifying: string;
    keepPageOpen: string;
    uploadProgressAriaLabel: string;
    documentSecured: string;
    securingDocument: string;
    retryUpload: string;
    uploadPrivately: string;
    retryWithoutChoosing: string;
    privacyNote: string;
  };
  deferred: {
    identityProof: string;
    liveness: string;
    modelConsent: string;
    review: string;
    stepsSaved: string;
  };
  main: {
    ariaLabel: string;
    stopped: { title: string; body: string };
    sourcePermission: { title: string; body: string; label: string };
    primarySource: { title: string; body: string; label: string };
    sourceProcessing: {
      title: string;
      body: string;
      autoCheckLabel: string;
      autoCheckValue: string;
      returnLabel: string;
      returnValue: string;
      checkNow: string;
    };
    comparisonSummary: string;
    openingComparisonReview: string;
    review: { failedStrong: string; failedSpan: string; loading: string };
    building: {
      title: string;
      body: string;
      currentStateLabel: string;
      stateRetry: string;
      stateLeased: string;
      stateBuilding: string;
      stateQueued: string;
      completionLabel: string;
      completionValue: string;
      checkNow: string;
    };
    complete: { title: string; body: string; label: string };
  };
}

// WS-R166. ContextLockerPanel.tsx's own `REASON_COPY` (~40 server refusal/
// mined-nothing/routing codes) is reused as a keyed Record rather than
// enumerated as named fields: the code IS the key both sides already share
// (`copyFor`), so a Record keeps the English/Hindi pair mechanically aligned
// with the server's own vocabulary instead of inventing a second name for
// each one.
export interface ContextLockerPanelCopy {
  reasons: Record<string, string>;
  errorFallback: string;
  teachYourAi: string;
  testThisSource: string;
  viewPhrases: string;
  writingAttributionAriaLabel: string;
  myWriting: string;
  referenceOnly: string;
  heading: string;
  intro: string;
  dropzoneTitle: string;
  dropzoneBodyTemplate: string;
  fewMb: string;
  reading: string;
  chooseFiles: string;
  chatConsentNote: string;
  pasteLinksLabel: string;
  linksPlaceholder: string;
  addLinks: string;
  iAmSpeakerTemplate: string;
  openingPhrases: string;
  inYourLocker: string;
  loadingEllipsis: string;
  nothingYet: string;
  charactersTemplate: string;
  yourMessagesAsTemplate: string;
  remove: string;
  quotaTemplate: string;
  states: {
    notAdded: string;
    suggestionSingularTemplate: string;
    suggestionPluralTemplate: string;
    suggestionsSaved: string;
    notRead: string;
    belongsElsewhere: string;
    read: string;
    working: string;
  };
  phraseSuggestionsSavedPrivately: string;
}

// WS-R166. VoicePreviewPanel.tsx's own `WELCOME` sample scripts (the default
// text in the composer for each PREVIEW language: Hindi/Hinglish/English) are
// deliberately NOT here: they are content in the language the owner picked to
// preview, independent of which language the STUDIO CHROME itself is in, so a
// Hindi-interface owner previewing in English still starts from the English
// sample. `LANGUAGE_OPTIONS`' labels/help text below ARE chrome (they name
// the picker itself) and are converted.
export interface VoicePreviewPanelCopy {
  languageOptions: {
    hi: { label: string; help: string };
    hiLatn: { label: string; help: string };
    en: { label: string; help: string };
  };
  likeness: {
    ariaLabel: string;
    heading: string;
    scoreTemplate: string;
    measuredOnTemplate: string;
    stale: string;
    notMeasuredYet: string;
    tieTemplate: string;
    preferredTemplate: string;
    noListeningTestYet: string;
    // WS-R179. The method behind the number: which verdicts, which axes, n.
    methodMeasuredTemplate: string;
    methodNotMeasured: string;
  };
  stage: {
    protecting: string;
    generating: string;
    waitingForRuntime: string;
    wakingRuntime: string;
  };
  eyebrow: string;
  heading: string;
  introTest: string;
  introLive: string;
  lineage: {
    ariaLabel: string;
    versionTemplate: string;
    primaryVoiceLabel: string;
    chooseRecordingLabel: string;
    sourceDetailsLoading: string;
    rolePrimary: string;
    roleVideo: string;
    roleAudio: string;
    roleSource: string;
    kindPrimary: string;
    kindVideo: string;
    kindAudio: string;
    kindContext: string;
    referenceSecondsTemplate: string;
    referenceSelected: string;
    addedOnTemplate: string;
    technicalReference: string;
    privateSourceTemplate: string;
    manageSources: string;
  };
  languageLegend: string;
  yourLine: string;
  charactersLeftTemplate: string;
  disclosureAddedSuffix: string;
  remoteIntentNote: string;
  joinThatPreview: string;
  reasons: {
    checkingDraftHeadline: string;
    checkingDraftDetail: string;
    busyPendingTemplate: string;
    busyConnecting: string;
    busyOnlineDetail: string;
    busyOfflineDetail: string;
    offlineHeadline: string;
    offlineDetail: string;
    emptyHeadline: string;
    emptyDetail: string;
    overLimitTemplate: string;
    overLimitDetail: string;
  };
  button: {
    connecting: string;
    previewUpdatedLine: string;
    regeneratePreview: string;
    previewMyVoice: string;
  };
  announcement: {
    connectionLost: string;
    pendingTemplate: string;
    joinedNote: string;
    savedCheckingNote: string;
    connectingExisting: string;
    ready: string;
    stopped: string;
    errorTemplate: string;
  };
  ready: {
    readyLabel: string;
    listenHeading: string;
    audioFallback: string;
    pronunciationSummaryTemplate: string;
    spokenAsPrefix: string;
    planNoteTemplate: string;
    disclosureLabel: string;
    disclosureValue: string;
    watermarkLabel: string;
    watermarkValue: string;
    notRightYet: string;
    correctionNote: string;
    editTheLine: string;
    receiptTemplate: string;
    reusedNote: string;
  };
  pending: {
    runtimeStarting: string;
    audioProcessing: string;
    offlineNote: string;
    joinedFromAnotherTab: string;
    waitMetricsAriaLabel: string;
    elapsedLabel: string;
    observedRangeLabel: string;
    observedRangeTemplate: string;
    returnAroundLabel: string;
    beyondWindowNote: string;
    reusedRequestNote: string;
    savedRequestOnlineTemplate: string;
    savedRequestOfflineNote: string;
    leaveNote: string;
    requestDetails: string;
    savedRequestReceiptTemplate: string;
    requestSnapshotTemplate: string;
    closingPausesNote: string;
    keepOpenNote: string;
    lastCheckUnfinished: string;
    noReceiptYet: string;
  };
  submitting: {
    stateLabel: string;
    heading: string;
    messageTest: string;
    messageLive: string;
    note: string;
  };
  failed: {
    stateLabel: string;
    heading: string;
    body: string;
    note: string;
    receiptTemplate: string;
  };
  error: {
    stateLabel: string;
    heading: string;
    voiceNotReadyHeadline: string;
    connectionDetail: string;
    attemptCheckDetail: string;
    checkVoiceSources: string;
  };
  idle: {
    stateLabel: string;
    heading: string;
    body: string;
    firstWaitNote: string;
  };
  /** WS-R168's "Hear the vibe" opt-in on the preview, registered at the
   *  wave-22 merge as its own closed block (WS-R166 converted this panel and
   *  WS-R168 added these four strings on a sibling branch). */
  vibe: {
    toggle: string;
    helpOn: string;
    helpOff: string;
    confirmed: string;
  };
}

// WS-R166. MirrorCallStudio.tsx's own copy: the `availability` object's eight
// phase branches (each {title, phase, range, next, leave}) are the largest
// single block in this brief, kept as one nested group per phase rather than
// flattened, so the component's own `useMemo` can stay a near 1:1 mirror of
// the English source it replaces.
export interface MirrorCallStudioCopy {
  kindLabel: { phraseHabit: string; register: string; boundary: string; fact: string; delivery: string };
  caption: { you: string; yourClone: string; missed: string; call: string };
  recovery: {
    recoveredEndReceipt: string;
    recovering: string;
    recoverFailed: string;
    speakerCheckSaved: string;
  };
  mic: {
    permissionTimeout: string;
    micCouldNotOpen: string;
  };
  changeApplied: string;
  changeDismissed: string;
  callNoLongerOpen: string;
  contexts: {
    backendUnreachable: string;
    couldNotStart: string;
    couldNotEndCleanly: string;
    couldNotRecoverEndReceipt: string;
    speakerCheckCouldNotBeSaved: string;
    windowCouldNotBeSent: string;
    proposedChangesCouldNotBeRefreshed: string;
    changeCouldNotBeTemplate: string;
    ratingCouldNotBeSaved: string;
    micCouldNotOpenForRerecord: string;
    reRecordCouldNotBeSaved: string;
  };
  header: { eyebrow: string; heading: string; body: string };
  stateBadge: {
    checking: string; notDeployed: string; waitingOnUs: string; ready: string;
    connecting: string; gpuWarming: string; live: string; ending: string; ended: string; stopped: string;
  };
  tabs: { ariaLabel: string; call: string; reviewLater: string; countSuffixTemplate: string };
  availabilityLabels: { observedRange: string; nextCheck: string; leaveOrReturn: string };
  availability: {
    checking: { title: string; phase: string; range: string; next: string; leave: string };
    replyUnavailable: { title: string; phase: string; range: string; next: string; leave: string };
    recovering: { title: string; phase: string; range: string; next: string; leave: string };
    idle: { title: string; phase: string; range: string; next: string; leave: string };
    connecting: { title: string; phase: string; range: string; next: string; leave: string };
    warming: {
      titleNormal: string;
      titleBeyondRange: string;
      phase: string;
      rangeNoEstimate: string;
      rangeWithEstimateTemplate: string;
      minuteSingular: string;
      minutePlural: string;
      next: string;
      leaveNoObservedHigh: string;
      leaveBeyondWindow: string;
      leaveWithinWindowTemplate: string;
      leaveSuffix: string;
    };
    live: {
      title: string;
      phaseCapturing: string;
      phaseUploading: string;
      phaseThinking: string;
      phaseSpeaking: string;
      phaseIdle: string;
      range: string;
      nextIdle: string;
      nextTurn: string;
      leaveIdle: string;
      leaveTurn: string;
    };
    ending: { title: string; phase: string; range: string; next: string; leave: string };
    ended: {
      title: string;
      phase: string;
      range: string;
      nextQueued: string;
      nextNotQueued: string;
      leaveChoosePending: string;
      leaveMayLeave: string;
    };
    recoveryPaused: { title: string; range: string; next: string; leave: string };
    stopped: { title: string; range: string; next: string; leave: string };
  };
  recoveryPausedPhaseFallback: string;
  stoppedPhaseFallback: string;
  speaker: {
    savedHeading: string;
    savedBodyTemplate: string;
    excludedHeading: string;
    excludedBody: string;
    consentRequiredHeading: string;
    consentRequiredBody: string;
    questionLegend: string;
    questionBody: string;
    saving: string;
    yesOnlyMe: string;
    noOrNotSure: string;
  };
  backendAbsent: {
    heading: string;
    bodyBefore: string;
    bodyAfterTemplate: string;
    missingTemplate: string;
  };
  replyUnavailable: {
    heading: string;
    body: string;
    note: string;
  };
  controls: {
    checkingNote: string;
    endingCallSetup: string;
    endCallSetup: string;
    recoveringReceipt: string;
    recoverEndReceipt: string;
    finishSpeakerCheck: string;
    startAnotherCall: string;
    startTheCall: string;
    ending: string;
    finishReplyBeforeEnding: string;
    endCall: string;
  };
  mic2: {
    sendThisWindow: string;
    discard: string;
    openingMicrophone: string;
    transcribing: string;
    cloneAnswering: string;
    cloneSpeaking: string;
    talk: string;
    capturingNote: string;
    turnTakingNote: string;
    autoCutNote: string;
    micErrorSuffix: string;
    voiceUnavailableNote: string;
  };
  thread: {
    soundedLikeMe: string;
    didNotSoundLikeMe: string;
    stopAndSend: string;
    idSayItLikeThis: string;
    emptyHeading: string;
    emptyBody: string;
  };
  dismiss: string;
  fidelity: {
    heading: string;
    noPrintedCeiling: string;
    ceilingTemplate: string;
    ofCeilingTemplate: string;
    windowSingularTemplate: string;
    windowPluralTemplate: string;
    secondsPooledTemplate: string;
    confidenceTemplate: string;
    noWindowYet: string;
    windowSecondsTemplate: string;
    reselectionSingularTemplate: string;
    reselectionPluralTemplate: string;
    referenceSetSingularTemplate: string;
    referenceSetPluralTemplate: string;
    droppedSingularTemplate: string;
    droppedPluralTemplate: string;
  };
  rail: {
    heading: string;
    waitingTemplate: string;
    rollIntoReviewTemplate: string;
    heldBackTemplate: string;
    refresh: string;
    heardTemplate: string;
    becauseYouSaidTemplate: string;
    applying: string;
    accept: string;
    dismissing: string;
    reject: string;
    emptyLive: string;
    emptyIdle: string;
    actionedThisCall: string;
    applied: string;
    acceptedNotOnSheet: string;
    rejected: string;
  };
  review: {
    intro: string;
    neverShown: string;
    notAppliedReviewLater: string;
    emptyWaiting: string;
    summaryTemplate: string;
    finetuneQueued: string;
    finetuneNotQueuedTemplate: string;
  };
}

// WS-R166. CloneExperience.tsx's own shell and menus (this brief's law 2):
// the tab chrome, the recorder, the source-use agreement, the drawer of
// saved clones, and the enrich/voice/share/evolve/call room content this
// file renders directly (the four panels it mounts as children —
// ExpertSharePanel, PersonModelStudio, ExpertConversation, QuickVoiceCapture
// — carry their OWN sections already, WS-R159). Deep imperative error/status
// strings reached only from `submitRecording`/`reissueSavedRecording`'s own
// catch branches ARE included (`upload.message` renders directly on the
// primary "Securing your recording." screen); `feedCopy` (this file's own
// pre-existing `?lang=hi` ad hoc bilingual object for two labels handed to
// ContextLockerPanel) is untouched — it already carries both locales through
// its own mechanism, predating this registry.
export interface CloneExperienceShellCopy {
  capture: {
    stayLocalHint: string;
    addKnowledgeFirst: string;
    readyHeading: string;
    sayHeading: string;
    readyBody: string;
    sayBody: string;
    minMinimum: string;
    idealLength: string;
    localFirst: string;
    finishRecordingAriaTemplate: string;
    startRecordingAria: string;
    opening: string;
    finish: string;
    begin: string;
    audioReady: string;
    sealedWav: string;
    fileLabelTemplate: string;
    videoFallback: string;
    audioFallback: string;
    onlyMyVoice: string;
    howDidYouSpeak: string;
    tryAgain: string;
    continueLabel: string;
    secondsToGoTemplate: string;
    enoughToFinish: string;
    strongSampleLength: string;
    aboutThirtySeconds: string;
    finishAtEnd: string;
    useFileInstead: string;
    chooseRecordingAria: string;
    signalCouldNotReadDuration: string;
    signalChooseTwelveSeconds: string;
    signalVerifiedDuringProcessing: string;
    signalClipped: string;
    signalTooQuiet: string;
    signalUsable: string;
    initialHint: string;
    keepSpeakingTemplate: string;
    reviewHint: string;
    recordingFailed: string;
    recordingHint: string;
    micOpenFailed: string;
  };
  agreement: {
    labelOwnSources: string;
    labelAgeAndDisclosure: string;
    labelPrivacyTerms: string;
    heading: string;
    body: string;
    everythingSelected: string;
    selectAll: string;
    legalPrefix: string;
    legalLinkText: string;
    legalSuffix: string;
    openingPrivateSpace: string;
    agreeAndContinue: string;
    couldNotRecordAgreement: string;
  };
  roomNav: {
    ariaLabel: string;
    meet: string;
    knowledge: string;
    review: string;
    call: string;
    share: string;
  };
  describeMe: {
    savedNote: string;
    notStoredError: string;
    notSavedError: string;
    heading: string;
    body: string;
    placeholder: string;
    savingPrivately: string;
    addToContext: string;
    charactersTemplate: string;
  };
  drawer: {
    closeDrawerAria: string;
    dialogAria: string;
    heading: string;
    closeAria: string;
    voiceVersionTemplate: string;
    createAnother: string;
    replacePrimary: string;
    deleteClone: string;
    deleteConfirmBody: string;
    deleting: string;
    deletePermanently: string;
    cancel: string;
  };
  header: {
    openClonesAria: string;
    homeAria: string;
    openAccountMenuAria: string;
    signOut: string;
  };
  readStates: {
    workspaceError: string;
    workspaceLoading: string;
    tryAgain: string;
    checkingSavedClones: string;
    openingPrivateDraftTest: string;
    consentError: string;
    consentLoading: string;
    checkAgain: string;
    loadingAgreement: string;
  };
  upload: {
    hashMessage: string;
    authorizeMessage: string;
    uploadAuthMissing: string;
    uploadMessage: string;
    sourceReceiptMissing: string;
    renewMessage: string;
    resumeMessage: string;
    verifyMessage: string;
    selectMessage: string;
    stoppedBeforeBuild: string;
    pausedHeading: string;
    securingHeading: string;
    checkingRecording: string;
    uploadingPercentTemplate: string;
    paused: string;
    openingPrivateUpload: string;
    verifyingReceipt: string;
    selectingVoice: string;
    recordingStillHere: string;
    retrySafely: string;
    recordAgain: string;
    keepPageOpen: string;
  };
  sagaRecovery: {
    heading: string;
    body: string;
    checkReceipt: string;
    startAgain: string;
    cannotReadSaved: string;
    cannotSaveNew: string;
    changedInAnotherTab: string;
    couldNotCheckRecording: string;
    notEligibleForNewRequest: string;
  };
  verification: {
    chooseWhetherToUse: string;
    couldNotBuild: string;
    needsNewConfirmation: string;
    confirmToReplace: string;
    buildStoppedOurSide: string;
    checkingUnavailable: string;
    checkingRecording: string;
    useThisRecording: string;
    recordAgain: string;
    actionNeeded: string;
    stepStopped: string;
    checking: string;
    backToKnowledge: string;
  };
  rooms: {
    voice: { headingTemplate: string; body: string; meetExperienceAria: string; conversation: string; voiceSample: string; privateDraftTest: string; listeningTest: string; openingListeningTest: string; lookingForSamples: string; needTwoSamples: string; couldNotOpen: string; close: string; openingConversation: string };
    share: { backToKnowledge: string; openingSharing: string };
    enrich: {
      backToVoice: string;
      heading: string;
      body: string;
      shareKnowledgeTitle: string;
      shareKnowledgeNote: string;
      testDraftTitle: string;
      testDraftNote: string;
      describeMeTitle: string;
      describeMeNote: string;
      whoYouAreTitle: string;
      whoYouAreNote: string;
      filesTitle: string;
      filesNote: string;
      videoTitle: string;
      videoNote: string;
      improveVoiceTitle: string;
      improveVoiceNote: string;
      vibeTitle: string;
      vibeNote: string;
      backToChoices: string;
      recordInstead: string;
      reviewTextSharing: string;
      openingWhoYouAre: string;
    };
    evolve: { heading: string; body: string; openingHistory: string };
    emotionos: { openingVibe: string };
    call: { headingTemplate: string; body: string; openingCallRoom: string };
  };
}

// WS-R164 (wave twenty-two): the first five minutes' own small rail,
// `FirstFiveMinutes.tsx`. Its own closed block, appended rather than folded
// into an existing section, per `docs/gurukul/waves/wave-22/ws-common.md`'s
// own merge rule for this file. Three named steps only (sign in, tell it
// about you, meet it), matching the brief's own three timed transitions
// (landing to sign-in, sign-in to first source, first source to Meet); no
// step number or version-stamp text (`DESIGN-LAW.md` §1), no fake-precise
// duration (a range word, never a second count).
export interface FirstFiveMinutesCopy {
  railLabel: string;
  signInTitle: string;
  firstSourceTitle: string;
  firstSourceHint: string;
  meetTitle: string;
  meetHint: string;
  stepDoneLabel: string;
}

export interface StudioCopy {
  personalAuth: PersonalAuthCopy;
  expertSharePanel: ExpertSharePanelCopy;
  quickVoiceCapture: QuickVoiceCaptureCopy;
  expertConversation: ExpertConversationCopy;
  personModelStudio: PersonModelStudioCopy;
  meetMemory: MeetMemoryCopy;
  cloneVerificationJourney: CloneVerificationJourneyCopy;
  contextLockerPanel: ContextLockerPanelCopy;
  voicePreviewPanel: VoicePreviewPanelCopy;
  mirrorCallStudio: MirrorCallStudioCopy;
  cloneExperienceShell: CloneExperienceShellCopy;
  firstFiveMinutes: FirstFiveMinutesCopy;
}

const EN_EXPERT_SHARE_PANEL: ExpertSharePanelCopy = {
  title: "Give your AI a home.",
  voiceOtherChannelsSummary: "Voice and other channels",
  voiceOtherChannelsNote: "These need their own verification before sharing.",
  reviewReadiness: "Review readiness",
};

const EN_QUICK_VOICE_CAPTURE: QuickVoiceCaptureCopy = {
  recommendedEyebrow: "Recommended",
  heading: "Record a clean voice sample",
  instructionsOne: "Talk naturally about anything. After 12 seconds, one tap finishes the recording and starts your AI.",
  instructionsTwo: "About 30 seconds gives us more clean speech to choose from. We keep it private.",
  localUntilUpload: "Local until you upload",
  languageGroupAriaLabel: "Recording language",
  promptSummary: "Need an idea? Show an optional prompt",
  promptHint: "You do not have to read this. Your own natural words are preferred.",
  startRecording: "Start recording",
  micPermissionNote: "Your browser asks for microphone access only after this click.",
  openingMic: "Opening your microphone",
  checkPermissionPrompt: "Check the browser permission prompt.",
  recordingVisuallyHidden: "Recording started. Finish and build becomes available after 12 seconds.",
  recordingLabel: "Recording",
  ofMaxTemplate: "{time} of 1:00 maximum",
  speakMoreTemplate: "Speak {n}s more",
  finishAndBuild: "Finish and build",
  meterAriaLabel: "Live microphone input level",
  keepSpeakingTemplate: "Keep speaking for {n} more seconds",
  goodKeepGoing: "Good. Keep going for a stronger choice.",
  targetReached: "Target reached. Stop when this sentence feels complete.",
  progressAriaLabel: "Recommended recording length",
  improveSampleHeading: "Let's improve this sample",
  durationFormatTemplate: "{duration} · 24 kHz private WAV",
  retakeNeeded: "Retake needed",
  levelTooHigh: "The level may be too high. Move slightly away from the microphone and retake.",
  quietRecording: "Much of this recording is quiet. Speak closer to the microphone and retake.",
  usableLevel: "The local input level looks usable. Private processing makes the final reference choice.",
  notEnoughYet: "Speak for at least 12 seconds. About 30 seconds gives processing more clean speech to choose from.",
  recordAgain: "Record again",
  errorTooShort: "This sample is too short. Speak for at least 12 seconds.",
  errorClipped: "The microphone level clipped. Move slightly away and record once more.",
  errorTooQuiet: "Too much of this sample is quiet. Move closer and record once more.",
  errorFinishFailed: "The recording could not be finished.",
  errorStartFailed: "The browser could not start recording.",
  errorCloseMicFailed: "The microphone could not be closed.",
};

const EN_EXPERT_CONVERSATION: ExpertConversationCopy = {
  ariaLabel: "Private expert conversation",
  statusActive: "Private conversation",
  statusInactive: "Private workspace",
  aiReviewedByYou: "AI, reviewed by you",
  continuityAudioNote: "Audio is unavailable for replies using earlier conversations.",
  readinessTitle: {
    stopped: "This AI is stopped",
    reconciling: "Reply saved",
    checking: "Checking your AI",
    privateUnavailable: "Your private version is unavailable",
    unavailable: "Readiness is unavailable",
    setup: "Set up your first conversation",
  },
  readinessBody: {
    stopped: "Private replies are unavailable for this AI.",
    reconciling: "We are checking usage before another reply can begin.",
    checking: "Checking the current server state.",
    privateUnavailable: "We could not load the selected private version. Check again while we resolve this.",
    unavailable: "We could not check conversation readiness. Try again.",
    setup: "Check what is still needed before private replies can begin.",
  },
  openConversationSetup: "Open conversation setup",
  checkAgain: "Check again",
  newConversation: "New conversation",
  retryOpeningConversation: "Retry opening conversation",
  openingConversation: "Opening conversation",
  checkConversation: "Check conversation",
  recentCompletedReplies: "Recent completed replies",
  runtimeChangedNotice: "Your private version changed. Start a new conversation after the previous reply is checked.",
  historyPendingNotice: "We are checking the previous reply and its usage. Check the conversation before sending again.",
  historyUnconfirmedNotice: "The previous reply could not be confirmed. Check this conversation, or explicitly start a new one. We have not sent your message again.",
  emptyHeading: "Try a real question.",
  emptyBody: "Ask something a client would ask you. Listen, then show your AI what you would change.",
  emptyStarterButton: "Help someone get started",
  emptyStarterQuestion: "What is the first step you would recommend to someone new to my work?",
  youLabel: "You",
  yourAiLabel: "Your AI",
  stopAudio: "Stop audio",
  listen: "Listen",
  teachCorrection: "Teach a correction",
  workingStatus: "Your AI is preparing a reply",
  recallPreviousLabel: "Use earlier private conversations",
  askYourAi: "Ask your AI",
  questionPlaceholder: "Bring a question from your work",
  privateToThisRelationship: "Private to this relationship",
  answering: "Answering",
  send: "Send",
  errorRecovered: "Your saved reply has been recovered.",
  errorConversationUnavailable: "The previous conversation is unavailable. You can explicitly start a new conversation.",
  errorRestoreFailed: "We could not restore this conversation. Check again before sending another message.",
  errorOpenFailed: "Opening the conversation could not be confirmed. Retry opening to check the same conversation.",
  errorReplyFailed: "Your AI could not complete this reply. Your message is still here. We have not retried it automatically.",
  errorReplySavedNeedsReconcile: "Your reply is saved. We need to reconcile its usage before another reply.",
  errorAudioPlaybackFailed: "This audio could not play. Try listening again.",
  errorVoiceUnavailable: "Voice playback is unavailable. The text reply is still here.",
  apprenticeVoiceNotice: "You can talk now. The voice is still being built.",
};

const EN_PERSON_MODEL_STUDIO: PersonModelStudioCopy = {
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
    reviewed_confident_subject_transcript_required: "Accept at least one confident, verified speaker transcript",
    reviewed_confident_subject_evidence_required: "Accept a confident verified speaker transcript, or mark an uploaded document as your own writing",
  },
  confidencePctTemplate: "{n}% confidence",
  fromYourSource: "From your source:",
  citedSourceOne: "{n} cited source",
  citedSourceMany: "{n} cited sources",
  keepOut: "Keep out",
  notAccurate: "Not accurate",
  outdated: "Outdated",
  thisIsMe: "This is me",
  reviewClaimAriaLabel: "Review this claim",
  eyebrow: "What we learned about you",
  title: "Everything we think we learned about you, one claim at a time",
  intro: "Confirm identity, language, behavior, values, boundaries, and autobiography as separate evidence-backed claims. Conflicts stay visible instead of being averaged into a confident fiction.",
  noApprovedVersion: "Not yet approved",
  approvedVersionLabel: "approved version",
  loadingClaims: "Loading reviewed claims…",
  retry: "Retry",
  proposedClaims: "proposed claims",
  accepted: "accepted",
  criticalConflicts: "critical conflicts",
  citedExtractionEyebrow: "Cited extraction",
  citedExtractionTitle: "Turn your reviewed recordings into claims you control",
  citedExtractionIntro: "Only accepted target-speaker transcript spans qualify. Raw transcripts stay server-side, direct identifiers are masked before the extraction call, and every result remains a proposal until you review it below.",
  eligibleSpans: "eligible spans",
  lastProposed: "last proposed",
  noExtractionRunYet: "No extraction run yet",
  observedRangeLabel: "Observed range",
  nextCheckLabel: "Next check",
  leaveOrReturnLabel: "Leave or return",
  checkStatusNow: "Check status now",
  submittingExtraction: "Submitting extraction...",
  extractionRunning: "Extraction running",
  waitingToRetry: "Waiting to retry",
  extractionQueued: "Extraction queued",
  extractNewEvidence: "Extract new evidence",
  extractCitedClaims: "Extract cited claims",
  noClaimsHeadline: "No behavior or memory claims yet.",
  noClaimsNote: "Processed evidence will appear here for review. Raw transcripts, vectors, and storage paths remain withheld.",
  buildIsDeterministicNote: "A build is deterministic and versioned. Approving it never grants inference or voice generation permission.",
  checkingEvidence: "Checking evidence…",
  approveProfileVersionTemplate: "Approve profile v{n}",
  building: "Building…",
  buildReviewDraft: "Build review draft",
  errorLoadFailed: "What we learned about you could not be loaded",
  errorExtractionUnavailable: "Cited extraction status could not be loaded",
  errorProfileUnavailable: "What we learned about you could not be confirmed. Retry.",
  errorClaimNotSaved: "Claim review was not saved",
  errorBuildRefused: "Building what we learned about you was refused",
  errorApproveChanged: "Profile changed and could not be approved",
  errorExtractionFailed: "Cited claims could not be extracted",
  errorExtractionScopeChanged: "Extraction scope changed",
  errorExtractionCheckFailed: "The extraction status could not be confirmed. Retry.",
  errorExtractionCheckFailedRetryable: "The latest durable extraction status could not be checked. Server work may still be continuing; this page will try again after it reconnects or reloads.",
};

// WS-R167 (own closed block, appended after EN_EXPERT_CONVERSATION).
const EN_MEET_MEMORY: MeetMemoryCopy = {
  heading: "It remembers",
  onDescription: "Your AI remembers what you tell it here, so testing feels like one continuing conversation instead of starting over every time.",
  offDescription: "Memory is off. Each conversation starts fresh, and nothing you say here is kept afterward.",
  toggleOn: "Turn memory on",
  toggleOff: "Turn memory off",
  factsHeading: "What it remembers",
  factsEmpty: "Nothing remembered yet.",
  correctAction: "Correct this",
  forgetAction: "Forget this",
  correctPromptLabel: "What should it remember instead?",
  correctPlaceholder: "Say it exactly as you want it remembered",
  correctSave: "Save correction",
  correctCancel: "Cancel",
  classificationUnconfirmed: "Not yet classified",
  howWeAreHeading: "How we are",
  startFreshAction: "Start fresh",
  startFreshConfirm: "This closes anything currently open between you and your AI, without erasing what happened.",
  startFreshNothingOpen: "Nothing is open right now.",
  startFreshDone: "Started fresh.",
  errorStatusUnavailable: "We could not check whether memory is on.",
  errorToggleFailed: "That could not be saved. Try again.",
  errorFactsUnavailable: "What it remembers could not be loaded.",
  errorCorrectFailed: "That correction was not saved.",
  errorForgetFailed: "That could not be forgotten right now.",
};

const EN_CLONE_VERIFICATION_JOURNEY: CloneVerificationJourneyCopy = {
  verificationStepTemplate: "Verification step {n} of 5",
  verificationPaused: "Verification paused",
  leaveVerification: "Leave verification",
  makeYoursTemplate: "Make {name} yours",
  privateVerification: "Private verification",
  legacyReset: {
    erasureFailedError: "Erasure did not start. This test clone is still blocked. Try again.",
    title: "This test clone cannot continue.",
    body: "An older internal test permission was used to build this draft. It cannot continue through real verification. Erase this test clone and begin again with a clean record.",
    startClean: "Start clean",
    confirmAriaLabel: "Confirm test clone erasure",
    confirmBody: "This blocks the clone now and starts verified erasure of its recordings and derived data. The new clone will not inherit this draft or its permissions.",
    startingErasure: "Starting erasure",
    eraseAndStartAgain: "Erase and start again",
    cancel: "Cancel",
  },
  identity: {
    fileEmpty: "This file is empty.",
    fileTooLarge: "The document is larger than 50 MB.",
    chooseFileType: "Choose a JPEG, PNG, or PDF.",
    uploadAuthMissing: "Private upload authorization is missing.",
    uploadStopped: "The private upload stopped before verification.",
    removeFailed: "The unfinished upload could not be removed.",
    securingTitle: "Securing your document.",
    uploadNotFinished: "The private upload has not finished.",
    checkingStoredFile: "Vyakti is checking the stored file. This page does not need another copy.",
    checkAgain: "Check again",
    removing: "Removing",
    removeUnfinished: "Remove unfinished upload",
    addTitle: "Add one private ID.",
    addBody: "A JPEG, PNG, or PDF confirms your age and identity. A separate live check connects you to the recording. The file is never used to train the clone.",
    rejected: "The previous document was not accepted. Choose a new file.",
    deleting: "The old document is being erased. Check again before adding another.",
    typeSelectedTemplate: "{type} selected",
    pdfLabel: "PDF",
    imageLabel: "Image",
    chooseId: "Choose your ID",
    sizeOnDeviceTemplate: "{size} on this device",
    fileTypesHint: "JPEG, PNG, or PDF up to 50 MB",
    declaration: "This current government ID shows only me.",
    statusChecking: "Checking the file",
    statusAuthorizing: "Opening private storage",
    statusUploading: "Uploading privately",
    statusVerifying: "Verifying the stored copy",
    keepPageOpen: "Please keep this page open",
    uploadProgressAriaLabel: "Private document upload progress",
    documentSecured: "Document secured. Opening the identity check.",
    securingDocument: "Securing document",
    retryUpload: "Retry private upload",
    uploadPrivately: "Upload privately",
    retryWithoutChoosing: "Retry without choosing the file again",
    privacyNote: "The file goes straight to private storage after you press Upload.",
  },
  deferred: {
    identityProof: "Opening the private identity check",
    liveness: "Opening the live identity check",
    modelConsent: "Opening model permission",
    review: "Opening the evidence review",
    stepsSaved: "Your completed steps stay saved while this screen opens.",
  },
  main: {
    ariaLabel: "Clone verification",
    stopped: { title: "This clone is no longer active.", body: "Generation is blocked while verified erasure finishes." },
    sourcePermission: { title: "Permission needs attention.", body: "Your recording stays private. Building is paused until capture, transcription, and storage permission are active.", label: "Review permission" },
    primarySource: { title: "Finish your voice first.", body: "A prepared primary recording is required before identity verification can begin.", label: "Return to voice" },
    sourceProcessing: {
      title: "Preparing your recording.",
      body: "The private worker is checking the exact source you selected. Recent recordings took about 5 to 15 minutes after worker pickup; long files can take longer.",
      autoCheckLabel: "Automatic check",
      autoCheckValue: "Every 10 seconds while this page is open",
      returnLabel: "You can return",
      returnValue: "This continues on the server",
      checkNow: "Check now",
    },
    comparisonSummary: "Review a prepared comparison recording",
    openingComparisonReview: "Opening private comparison review",
    review: {
      failedStrong: "We could not finish building your voice.",
      failedSpan: "Check the results below. You only need a new recording if this one was rejected.",
      loading: "Loading your recording checks.",
    },
    building: {
      title: "Building your private voice.",
      body: "Your voice is building from your reviewed recording. This page checks progress every 10 seconds while open. You can leave and return.",
      currentStateLabel: "Current state",
      stateRetry: "Waiting for an automatic retry",
      stateLeased: "Preparing to build",
      stateBuilding: "Creating the draft",
      stateQueued: "Queued",
      completionLabel: "Completion",
      completionValue: "An estimate is not available yet",
      checkNow: "Check now",
    },
    complete: { title: "Your draft voice is ready.", body: "This draft uses your reviewed recording. Listen before you approve or share it.", label: "Meet your clone" },
  },
};

const EN_CONTEXT_LOCKER_PANEL: ContextLockerPanelCopy = {
  reasons: {
    pdf_no_text_layer: "This PDF is a scan. There is no text in it to read, only pictures of text. We have no OCR, so we would rather say so than store it empty.",
    pdf_text_layer_unreadable: "We found text in this PDF but it does not read as language. The fonts use an encoding we cannot map. Export it as text or DOCX instead.",
    pdf_encrypted: "This PDF is password-protected. Remove the password and try again.",
    pdf_unsupported_filter: "This PDF compresses its text in a way we do not read.",
    pdf_malformed: "This file is not a readable PDF.",
    docx_malformed: "This file is not a readable Word document.",
    docx_encrypted: "This Word document is password-protected.",
    docx_no_text: "This Word document has no text in its body.",
    doc_legacy_binary_unsupported: "The old .doc format is not read. Save it as .docx and try again.",
    rtf_unsupported: "RTF is not read. Save it as .docx or plain text.",
    odt_unsupported: "OpenDocument is not read. Export as .docx or text.",
    pages_unsupported: "Pages files are not read. Export as .docx or a PDF with real text in it.",
    epub_unsupported: "EPUB is not read.",
    archive_unsupported: "We do not unpack archives. Upload the files inside it.",
    csv_unsupported: "A spreadsheet is not prose. Mining it would put column headers in your phrasing.",
    spreadsheet_unsupported: "A spreadsheet is not prose.",
    slides_unsupported: "Slides are titles and fragments, not how you talk. Export the speaker notes if that is what you meant.",
    structured_data_unsupported: "Structured data is not prose.",
    html_upload_unsupported: "Paste the page's link instead. An uploaded HTML file has no source to cite.",
    text_not_utf8: "This file is not UTF-8 text. Re-save it as UTF-8.",
    text_unreadable: "This file does not read as language.",
    format_unsupported: "We do not read this file type.",
    image_format_unsupported: "Use a PNG, JPEG, or WebP image. Other image containers are not read yet.",
    image_dimensions_unreadable: "We could not verify this image's pixel dimensions, so no image evidence was kept.",
    image_dimensions_invalid: "This image reports invalid pixel dimensions.",
    image_malformed: "This is not a readable image.",
    extracted_text_too_large: "This document is longer than one item may be. Split it and upload the parts. We do not trim anything silently.",
    file_too_large: "This file is larger than one upload may be.",
    chat_export_third_party_consent_required: "This is a chat export, so it contains someone else's private messages. Tick the box above and add it again. We only ever mine your own messages, and theirs are read only to tell them apart.",
    chat_export_too_many_speakers: "This is a large group chat, mostly other people's words. Export a one-to-one chat instead.",
    whatsapp_export_unparseable: "This looks like a chat export but no line in it matched a message. Export the chat again 'Without media' and upload the .txt unchanged.",
    link_unparseable: "That is not a link.",
    link_scheme_unsupported: "Only https links are read.",
    link_host_not_public: "We only read links on public websites.",
    article_fetch_not_configured: "This deployment cannot read links yet. Upload the text instead.",
    article_fetch_failed: "We could not load that page.",
    article_no_text: "That page had no readable text.",
    article_unreadable: "That page did not read as language.",
    channel_lane: "This is YouTube. It belongs to the channel lane, which asks you to confirm the channel is yours before reading a single video.",
    voice_evidence_lane: "This is audio. It belongs to the voice lane, which carries the consent your voice needs.",
    not_owner_authored_no_style_evidence: "Read, but not used for how you talk, because it is not your own writing. Mark it as yours if it is.",
    speaker_unattributed_no_style_evidence: "Read. Tell us which of these people is you and we will mine only your messages.",
    declared_speaker_not_in_export: "Nobody by that name sends messages in this export.",
    no_candidates_cleared_held_out: "Read, but nothing in it repeated often enough to be worth proposing. That is normal for a short document.",
    citation_integrity_failed: "Read, but the proposals could not be traced back to the text they came from, so none were kept.",
    proposal_already_exists: "Suggestions are already saved privately.",
    image_ocr_not_configured: "Stored privately with an exact image hash and pixel region. OCR and visual interpretation are not connected, so no claim was made from it.",
    context_source_permissions_required: "Record source capture and private storage permission before adding this file.",
    context_private_storage_failed: "Private storage could not retain this file. Nothing was claimed from it. Try again.",
    context_locker_response_invalid: "Private context returned an unreadable response. Nothing was added. Try again.",
    context_item_quota_exhausted: "Your locker is full. Remove something to add more.",
    context_byte_quota_exhausted: "Your locker is out of space. Remove something to add more.",
    replica_not_found: "That clone is not yours.",
  },
  errorFallback: "request failed",
  teachYourAi: "Teach your AI",
  testThisSource: "Test this source",
  viewPhrases: "View phrases",
  writingAttributionAriaLabel: "Writing attribution",
  myWriting: "My writing",
  referenceOnly: "Reference only",
  heading: "Bring your context",
  intro: "Everything you have already written about yourself, or that is already about you. Drop the files in, paste the links. Each one tells you what it became, and anything we cannot honestly read, we say so instead of quietly keeping it.",
  dropzoneTitle: "Drop your files here",
  dropzoneBodyTemplate: "Text, Markdown, Word documents, PDFs with real text, WhatsApp chat exports, and PNG, JPEG, or WebP images. Up to {size} each. Audio goes to the voice lane and YouTube goes to the channel lane. Paste those and we will point you there rather than doing it twice.",
  fewMb: "a few MB",
  reading: "Reading…",
  chooseFiles: "Choose files",
  chatConsentNote: "If I upload a chat export, I understand it contains another person's private messages, that only MY messages are ever used, and that theirs are read only to tell the two apart.",
  pasteLinksLabel: "Or paste links, one per line",
  linksPlaceholder: "https://example.com/an-interview-with-me\nhttps://example.com/my-essay",
  addLinks: "Add links",
  iAmSpeakerTemplate: "I am {name} ({count})",
  openingPhrases: "Opening phrases",
  inYourLocker: "In your locker",
  loadingEllipsis: "Loading…",
  nothingYet: "Nothing yet.",
  charactersTemplate: "{n} characters",
  yourMessagesAsTemplate: "your messages as {name}",
  remove: "Remove",
  quotaTemplate: "{items} of {maxItems} items · {bytes} of {maxBytes}.",
  states: {
    notAdded: "Not added",
    suggestionSingularTemplate: "{n} suggestion",
    suggestionPluralTemplate: "{n} suggestions",
    suggestionsSaved: "Suggestions saved",
    notRead: "Not read",
    belongsElsewhere: "Belongs elsewhere",
    read: "Read",
    working: "Working…",
  },
  phraseSuggestionsSavedPrivately: "Phrase suggestions are saved privately.",
};

const EN_VOICE_PREVIEW_PANEL: VoicePreviewPanelCopy = {
  languageOptions: {
    hi: { label: "Hindi", help: "Write Hindi in Devanagari. Familiar English terms can stay in English." },
    hiLatn: { label: "Hinglish", help: "Write natural Roman Hindi and English. The whole line is planned once so language switches keep one rhythm." },
    en: { label: "English", help: "Write the exact English line you want the draft to say." },
  },
  likeness: {
    ariaLabel: "Sounds like you",
    heading: "Sounds like you",
    scoreTemplate: "{n} out of 100",
    measuredOnTemplate: ", measured on {date}.",
    stale: " Your voice changed since this was measured, so a fresh score is due.",
    notMeasuredYet: "Not measured yet.",
    tieTemplate: "In your last listening test on {date}, you rated both samples the same.",
    preferredTemplate: "In your last listening test on {date}, you preferred one sample over the other.",
    noListeningTestYet: "You have not run a listening test yet.",
    methodMeasuredTemplate: "Based on {n} of your own blind listening tests, comparing two saved samples against your own reference recording on how much it sounds like you, how natural it sounds, how well the accent fits, and how clear the words are.",
    methodNotMeasured: "This score is only an automatic measurement so far. Run a blind listening test to compare it with what you actually hear.",
  },
  stage: {
    protecting: "Protecting your preview",
    generating: "Generating your preview",
    waitingForRuntime: "Waiting for the voice runtime",
    wakingRuntime: "Waking the voice runtime",
  },
  eyebrow: "Your voice",
  heading: "Preview my voice",
  introTest: "Type a line and hear the current draft in Hindi, Hinglish, or English.",
  introLive: "A private draft, generated from your own consented recording. Every clip opens with the spoken AI disclosure and carries an inaudible watermark. Previewing does not activate anything and does not let anyone else hear it.",
  lineage: {
    ariaLabel: "Voice draft sources",
    versionTemplate: "Voice draft v{version}",
    primaryVoiceLabel: "Primary voice: your main recording",
    chooseRecordingLabel: "Choose which recording should drive the voice",
    sourceDetailsLoading: "Source details are still loading",
    rolePrimary: "Primary voice",
    roleVideo: "Supporting video",
    roleAudio: "Supporting audio",
    roleSource: "Supporting source",
    kindPrimary: "Your main recording",
    kindVideo: "Uploaded video",
    kindAudio: "Uploaded audio",
    kindContext: "Supporting context",
    referenceSecondsTemplate: "{n} sec voice reference",
    referenceSelected: "Voice reference selected",
    addedOnTemplate: " · added {date}",
    technicalReference: "Technical reference",
    privateSourceTemplate: "Private source {code}",
    manageSources: "Manage sources",
  },
  languageLegend: "Preview language",
  yourLine: "Your line",
  charactersLeftTemplate: "{n} characters left",
  disclosureAddedSuffix: " The spoken AI disclosure is added for you.",
  remoteIntentNote: "Another tab started a preview while you were editing here.",
  joinThatPreview: "Join that preview",
  reasons: {
    checkingDraftHeadline: "We are still checking whether you have a draft voice.",
    checkingDraftDetail: "This takes a moment. The button turns on by itself when the check comes back.",
    busyPendingTemplate: "{stage}. This is one durable request, even when several tabs are watching it.",
    busyConnecting: "We are connecting to your existing preview request.",
    busyOnlineDetail: "It checks while this page is open. If you leave, the request stays saved and checking resumes when you return.",
    busyOfflineDetail: "Your device is offline. The request stays saved and this page reconnects automatically.",
    offlineHeadline: "This device is offline, so it cannot start a preview.",
    offlineDetail: "Reconnect to the internet. Your line stays here.",
    emptyHeadline: "The box is empty, so there is nothing to say.",
    emptyDetail: "Type a line for your clone to read aloud.",
    overLimitTemplate: "That is longer than the {max} characters a preview can take.",
    overLimitDetail: "Shorten it and the button turns on.",
  },
  button: {
    connecting: "Connecting",
    previewUpdatedLine: "Preview updated line",
    regeneratePreview: "Regenerate preview",
    previewMyVoice: "Preview my voice",
  },
  announcement: {
    connectionLost: "Connection lost. Your preview request remains saved and this page will reconnect automatically.",
    pendingTemplate: "{stage}. {note}",
    joinedNote: "This page joined the existing preview request.",
    savedCheckingNote: "Your request is saved and this page is checking its server state.",
    connectingExisting: "Connecting to your existing preview request.",
    ready: "Your protected voice preview is ready to play.",
    stopped: "This preview request stopped. Regenerate once to start a new request.",
    errorTemplate: "Preview stopped. {headline}",
  },
  ready: {
    readyLabel: "Ready",
    listenHeading: "Listen to this take",
    audioFallback: "Your browser cannot play this protected WAV.",
    pronunciationSummaryTemplate: "{n} Hindi speech spellings applied",
    spokenAsPrefix: "Spoken as: ",
    planNoteTemplate: "Your original text stays unchanged. Plan {plan} is saved with this preview.",
    disclosureLabel: "Disclosure",
    disclosureValue: "Spoken, on every clip",
    watermarkLabel: "Watermark",
    watermarkValue: "PerTh, verified before release",
    notRightYet: "Not right yet?",
    correctionNote: "Edit the line for a new intent, or use Regenerate preview for another take of these exact words.",
    editTheLine: "Edit the line",
    receiptTemplate: "Receipt {generationId}, request {intentId}, model {modelCommitment}",
    reusedNote: ". This is the protected result already sealed for this request.",
  },
  pending: {
    runtimeStarting: "Runtime starting",
    audioProcessing: "Audio processing",
    offlineNote: "This phone is offline. The request and latest server state are saved. This page checks again after you reconnect.",
    joinedFromAnotherTab: "This page joined the preview already started from another tab or an earlier visit.",
    waitMetricsAriaLabel: "Voice runtime wait",
    elapsedLabel: "Elapsed",
    observedRangeLabel: "Observed range",
    observedRangeTemplate: "{low} to {high} min",
    returnAroundLabel: "Return around",
    beyondWindowNote: "This is beyond the observed cold-start window. The same request is still being checked; starting over will not make it faster.",
    reusedRequestNote: "The server found this exact request and attached this page to it. No second generation was created.",
    savedRequestOnlineTemplate: "The server saved this request. Next check in about {n} seconds.",
    savedRequestOfflineNote: "The server saved this request. Checks resume after reconnect.",
    leaveNote: "You can leave this page after a request number appears. Returning resumes the same saved request.",
    requestDetails: "Request details",
    savedRequestReceiptTemplate: "Saved request {id}, started {started}, server attempt {attempt}",
    requestSnapshotTemplate: "Request snapshot saved · started {started}",
    closingPausesNote: "Closing this page pauses browser checks. The request and latest server state stay saved, and the same request resumes when you return. The line and language stay locked while this page checks it.",
    keepOpenNote: "Keep this page open until the server returns a saved request number. Your exact line is safe in this browser, and this page checks again automatically.",
    lastCheckUnfinished: "The last server check did not finish. Your saved preview request has not been replaced.",
    noReceiptYet: "The server did not return a request receipt yet. Your exact line is saved in this browser.",
  },
  submitting: {
    stateLabel: "Connecting",
    heading: "Finding this preview request",
    messageTest: "The server is finding or creating one request for these exact words.",
    messageLive: "The server is finding or creating one request for these exact words, voice draft and language.",
    note: "If another tab already started it, this page joins that request. It does not create another audio generation.",
  },
  failed: {
    stateLabel: "Request closed",
    heading: "This preview stopped",
    body: "The server ended this request before a protected clip was sealed. This is our side, not something you did.",
    note: "Edit the line to make a different request, or use Regenerate preview once for a new take of these exact words.",
    receiptTemplate: "Request {intentId} / stopped {updatedAt} / attempt {attempt} / code {errorCode}",
  },
  error: {
    stateLabel: "Did not work",
    heading: "Preview stopped",
    voiceNotReadyHeadline: "Voice preview is not ready yet",
    connectionDetail: "We are finishing the voice connection. No preview has started.",
    attemptCheckDetail: "We need to check this voice attempt before trying again.",
    checkVoiceSources: "Check voice sources",
  },
  idle: {
    stateLabel: "Nothing generated yet",
    heading: "Your take appears here",
    body: "Choose the language, write one natural line, and generate the current draft.",
    firstWaitNote: "The GPU starts only after you press Preview. The first run after a quiet period has an observed 2 to 8 minute cold-start range. After that it is usually much faster while the runtime stays warm.",
  },
  vibe: {
    toggle: "Hear the vibe",
    helpOn: "This preview uses your current EmotionOS vibe: pace, pauses and energy.",
    helpOff: "Off: this preview uses the plain voice, with no vibe styling.",
    confirmed: "Shaped by your current vibe.",
  },
};

const EN_MIRROR_CALL_STUDIO: MirrorCallStudioCopy = {
  kindLabel: { phraseHabit: "Phrase habit", register: "Register", boundary: "Boundary", fact: "Fact", delivery: "Delivery" },
  caption: { you: "You", yourClone: "Your clone", missed: "Missed", call: "Call" },
  recovery: {
    recoveredEndReceipt: "Recovered the saved end receipt. No recording was stored in this browser.",
    recovering: "Recovering the saved end receipt. No microphone or audio is being restored.",
    recoverFailed: "The saved end receipt could not be recovered yet. The session id is kept in this tab so you can try again.",
    speakerCheckSaved: "Speaker check saved. This tab no longer needs the call recovery record.",
  },
  mic: {
    permissionTimeout: "Microphone permission did not finish within 30 seconds.",
    micCouldNotOpen: "The microphone could not open",
  },
  changeApplied: "applied",
  changeDismissed: "dismissed",
  callNoLongerOpen: "The call is no longer open",
  contexts: {
    backendUnreachable: "The Mirror Call backend could not be reached",
    couldNotStart: "The Mirror Call could not start",
    couldNotEndCleanly: "The call could not be ended cleanly",
    couldNotRecoverEndReceipt: "The call end receipt could not be recovered",
    speakerCheckCouldNotBeSaved: "The speaker check could not be saved",
    windowCouldNotBeSent: "That window could not be sent",
    proposedChangesCouldNotBeRefreshed: "The proposed changes could not be refreshed",
    changeCouldNotBeTemplate: "This change could not be {action}",
    ratingCouldNotBeSaved: "That rating could not be saved",
    micCouldNotOpenForRerecord: "The microphone could not open for a re-record",
    reRecordCouldNotBeSaved: "That re-record could not be saved",
  },
  header: {
    eyebrow: "Mirror Call",
    heading: "Talk to your clone and correct it while it listens.",
    body: "Your side goes up in windows of up to 30 seconds. The deployed learner can suggest cited phrase or slang patterns, and show advisory observations about fillers, laughter, stretched speech, and code-switching. Only a cited proposal you tap Accept on can reach your sheet; everything else stays in Review later.",
  },
  stateBadge: {
    checking: "CHECKING", notDeployed: "NOT DEPLOYED", waitingOnUs: "WAITING ON US", ready: "READY",
    connecting: "CONNECTING", gpuWarming: "GPU WARMING", live: "LIVE", ending: "ENDING", ended: "ENDED", stopped: "STOPPED",
  },
  tabs: { ariaLabel: "Mirror Call", call: "Call", reviewLater: "Review later", countSuffixTemplate: " · {n}" },
  availabilityLabels: { observedRange: "Observed range", nextCheck: "Next check", leaveOrReturn: "Leave or return" },
  availability: {
    checking: {
      title: "Checking call availability",
      phase: "Verifying the deployed call routes before showing Start call.",
      range: "No finish estimate is shown until the server answers.",
      next: "This check is running now.",
      leave: "Keep this page open for the availability check.",
    },
    replyUnavailable: {
      title: "Calls are waiting on us",
      phase: "The private call route is online, but its conversational reply service is not configured.",
      range: "There is no start estimate yet.",
      next: "Vyakti needs to restore the reply service before a call can begin.",
      leave: "You can leave this page. Recording is off, and no new call session will be created.",
    },
    recovering: {
      title: "Recovering the previous call",
      phase: "This tab found a saved session id and is replaying the same idempotent end request.",
      range: "No audio, transcript, caption, proposal, or speaker decision was stored in this browser.",
      next: "The saved end receipt is being requested now.",
      leave: "Keep this tab open until the recovered receipt or a named retry appears.",
    },
    idle: {
      title: "Available to start",
      phase: "The call routes are present. The GPU is requested only after you press Start call.",
      range: "A cold voice GPU has an observed 2 to 8 minute start range. A warm GPU connects faster.",
      next: "No GPU is running for this call yet.",
      leave: "Start when you have time to keep this tab open through the connection step.",
    },
    connecting: {
      title: "Opening the private call",
      phase: "Creating the server session and checking its signed voice-runtime readiness.",
      range: "The server has not returned a GPU estimate yet.",
      next: "The next state comes from the session response.",
      leave: "Keep this tab open. The browser does not ask for microphone access until you press Talk.",
    },
    warming: {
      titleNormal: "Voice GPU is starting",
      titleBeyondRange: "GPU start is beyond the observed range",
      phase: "The call session exists and the server is waiting for its private voice runtime.",
      rangeNoEstimate: "Observed cold-start range: 2 to 8 minutes.",
      rangeWithEstimateTemplate: "Observed cold-start range: 2 to 8 minutes. The server's current estimate is about {n} {unit}, but that does not shorten the observed range.",
      minuteSingular: "minute",
      minutePlural: "minutes",
      next: "Next server readiness check within 6 seconds. The server estimate is refreshed from that response.",
      leaveNoObservedHigh: "You may switch tabs or apps, but keep this tab open so the call can become ready.",
      leaveBeyondWindow: "The observed eight-minute window has passed; we are still checking.",
      leaveWithinWindowTemplate: "A useful time to return is around {time}, the high end of the observed range.",
      leaveSuffix: " You may switch tabs or apps, but keep this tab open. Reloading ends this call setup.",
    },
    live: {
      title: "Call ready now",
      phaseCapturing: "Recording locally. Nothing is sent until you press Send this window.",
      phaseUploading: "Sending and transcribing the window you approved.",
      phaseThinking: "The clone is preparing its reply.",
      phaseSpeaking: "Playing the protected clone reply.",
      phaseIdle: "Ready for your next voice window. The microphone is off until you press Talk.",
      range: "Turn completion has no measured range on this deployment, so no countdown is shown.",
      nextIdle: "Waiting for you.",
      nextTurn: "This turn updates when its current server phase finishes.",
      leaveIdle: "Keep this tab open for the live call.",
      leaveTurn: "Keep this tab open until the current turn finishes.",
    },
    ending: {
      title: "Ending the call",
      phase: "Saving the end receipt and moving untouched proposals to Review later.",
      range: "No measured completion range is available for this step.",
      next: "The server response closes the session.",
      leave: "Keep this tab open until the end receipt appears.",
    },
    ended: {
      title: "Call ended",
      phase: "The end receipt is saved. Unaccepted proposals remain unapplied in Review later.",
      range: "The live call is complete.",
      nextQueued: "The server recorded a call-learning request. Check Activity for whether its runner is connected before expecting it to finish.",
      nextNotQueued: "No call-learning request was recorded.",
      leaveChoosePending: "Choose who spoke before starting another call. Reloading this tab restores this question from the server.",
      leaveMayLeave: "You may leave now. Review items remain available when you return.",
    },
    recoveryPaused: {
      title: "Call recovery paused",
      range: "The server may already have ended the call. Starting a new call would not resolve that ambiguity.",
      next: "Press Recover end receipt to replay the same session end safely.",
      leave: "The content-free session id remains in this tab. No audio is stored here.",
    },
    stopped: {
      title: "Call stopped",
      range: "A stopped call has no completion estimate.",
      next: "Start another call when you are ready.",
      leave: "Nothing is recording or progressing silently in this call.",
    },
  },
  recoveryPausedPhaseFallback: "The end receipt did not reach this tab.",
  stoppedPhaseFallback: "The call did not continue.",
  speaker: {
    savedHeading: "Speaker check saved",
    savedBodyTemplate: "{n} microphone window{plural} can now be checked for cited memory proposals. Each proposal still waits for your review. Your clone voice did not change.",
    excludedHeading: "These recordings will stay out of memory learning",
    excludedBody: "Your clone voice is unchanged. You can start another call when you have a clean recording.",
    consentRequiredHeading: "This call cannot enter memory learning",
    consentRequiredBody: "One or more permissions used for capture, storage, transcription, or learning is no longer active. The recording stays out of claim proposals and does not change your clone voice.",
    questionLegend: "Were you the only person speaking into your microphone?",
    questionBody: "Choose Yes only if every recorded window was you. This choice is final for this call. The clone's generated playback is excluded and never counts as your speech. This only allows cited memory proposals to be prepared. Each proposal still waits for your review, and this does not change the clone voice.",
    saving: "Saving...",
    yesOnlyMe: "Yes, only me",
    noOrNotSure: "No or not sure",
  },
  backendAbsent: {
    heading: "The Mirror Call backend is not deployed on this environment.",
    bodyBefore: "This tab talks to ",
    bodyAfterTemplate: ", which answered nothing here ({detail}). There is no offline demo of a Mirror Call on purpose: a simulated call would look exactly like a working one.",
    missingTemplate: "What is missing: {list}.",
  },
  replyUnavailable: {
    heading: "Voice calls are not available yet.",
    body: "Your microphone and clone are not the problem. Vyakti's conversational reply service is not ready in this environment, so this screen will not start or record a call.",
    note: "No call session or GPU start is requested while this service is unavailable.",
  },
  controls: {
    checkingNote: "Checking whether this environment has the call backend.",
    endingCallSetup: "Ending...",
    endCallSetup: "End call setup",
    recoveringReceipt: "Recovering receipt...",
    recoverEndReceipt: "Recover end receipt",
    finishSpeakerCheck: "Finish the speaker check above",
    startAnotherCall: "Start another call",
    startTheCall: "Start the call",
    ending: "Ending...",
    finishReplyBeforeEnding: "Finish this reply before ending",
    endCall: "End call",
  },
  mic2: {
    sendThisWindow: "Send this window",
    discard: "Discard",
    openingMicrophone: "Opening microphone...",
    transcribing: "Transcribing...",
    cloneAnswering: "Your clone is answering...",
    cloneSpeaking: "Your clone is speaking...",
    talk: "Talk",
    capturingNote: "Recording. The window is capped at 30 seconds. It is sent when you say so, or cut at the cap.",
    turnTakingNote: "One window at a time: your side, then its side. This is the cascade lane, not a duplex call.",
    autoCutNote: "The 30-second cap cut this window. Send it and say the rest in the next one. Nothing was quietly dropped.",
    micErrorSuffix: " Tap Talk to try again.",
    voiceUnavailableNote: "Captions only on this environment. The clone's voice route is not deployed.",
  },
  thread: {
    soundedLikeMe: "This sounded like me",
    didNotSoundLikeMe: "This did not sound like me",
    stopAndSend: "Stop and send",
    idSayItLikeThis: "I'd say it like this",
    emptyHeading: "Nothing has been said yet.",
    emptyBody: "Your clone answers what you say and never opens a call on its own.",
  },
  dismiss: "Dismiss",
  fidelity: {
    heading: "Voice fidelity",
    noPrintedCeiling: "no printed ceiling",
    ceilingTemplate: "ceiling {n}",
    ofCeilingTemplate: "{pct} of ceiling",
    windowSingularTemplate: "{n} window",
    windowPluralTemplate: "{n} windows",
    secondsPooledTemplate: "{n}s pooled",
    confidenceTemplate: "{pct} confidence",
    noWindowYet: "no window yet",
    windowSecondsTemplate: "{n}s window",
    reselectionSingularTemplate: "{n} re-selection",
    reselectionPluralTemplate: "{n} re-selections",
    referenceSetSingularTemplate: "Reference set: {n} consented window, {sec}s.",
    referenceSetPluralTemplate: "Reference set: {n} consented windows, {sec}s.",
    droppedSingularTemplate: "{n} window did not make it through transcription.",
    droppedPluralTemplate: "{n} windows did not make it through transcription.",
  },
  rail: {
    heading: "Proposed changes",
    waitingTemplate: "{n} waiting",
    rollIntoReviewTemplate: " · {n} will roll into Review later if you end now",
    heldBackTemplate: " · {n} held back by the {cap}-per-minute cap",
    refresh: "Refresh",
    heardTemplate: "heard {n}x",
    becauseYouSaidTemplate: "Because you said “{quote}”",
    applying: "Applying...",
    accept: "Accept",
    dismissing: "Dismissing...",
    reject: "Reject",
    emptyLive: "Nothing mined from this call yet. Chips appear as you talk, each quoting what produced it.",
    emptyIdle: "Chips appear during a call.",
    actionedThisCall: "Actioned this call",
    applied: "Applied",
    acceptedNotOnSheet: "Accepted, not yet on the sheet",
    rejected: "Rejected",
  },
  review: {
    intro: "Nothing here was applied. These are the chips you did not action before the call ended, plus any the {cap}-per-minute rail cap held back so the call did not turn into a stream of questions. They went to the ordinary review queue, exactly like a delta mined from an upload.",
    neverShown: "Never shown, held back by the rail cap, not applied",
    notAppliedReviewLater: "Not applied · review later",
    emptyWaiting: "Nothing is waiting for review.",
    summaryTemplate: "{accepted} accepted, {rejected} rejected, {deferred} deferred",
    finetuneQueued: "The server recorded a voice-learning request. This is not a completion claim; Activity must show its runner as connected before it can run.",
    finetuneNotQueuedTemplate: "No fine-tune was queued{reason}.",
  },
};

const EN_CLONE_EXPERIENCE_SHELL: CloneExperienceShellCopy = {
  capture: {
    stayLocalHint: "This file stays local until you choose Continue.",
    addKnowledgeFirst: "Add knowledge first",
    readyHeading: "Your voice is ready to become.",
    sayHeading: "Say something only you would say.",
    readyBody: "Listen once, choose the language, then continue.",
    sayBody: "One natural thought is enough. No script needed.",
    minMinimum: "12 s minimum",
    idealLength: "30 s ideal",
    localFirst: "Local first",
    finishRecordingAriaTemplate: "Finish recording. {duration} recorded",
    startRecordingAria: "Start voice recording",
    opening: "Opening",
    finish: "Finish",
    begin: "Begin",
    audioReady: "Audio ready",
    sealedWav: "24 kHz private WAV",
    fileLabelTemplate: "{size} {kind} file",
    videoFallback: "Your browser cannot preview this video.",
    audioFallback: "Your browser cannot preview this audio.",
    onlyMyVoice: "This file contains only my voice, or I have removed every other speaker.",
    howDidYouSpeak: "How did you speak?",
    tryAgain: "Try again",
    continueLabel: "Continue",
    secondsToGoTemplate: "{n} seconds to go",
    enoughToFinish: "Enough to finish",
    strongSampleLength: "Strong sample length",
    aboutThirtySeconds: "About 30 seconds gives the selector more clean speech.",
    finishAtEnd: "Finish at the end of this thought.",
    useFileInstead: "Use an audio or video file instead",
    chooseRecordingAria: "Choose your voice recording",
    signalCouldNotReadDuration: "This browser could not read the duration. Choose a different audio or video file.",
    signalChooseTwelveSeconds: "Choose at least 12 seconds of clear, single-speaker audio.",
    signalVerifiedDuringProcessing: "Speech and signal quality will be verified during private processing.",
    signalClipped: "The microphone clipped. Move a little farther away and try again.",
    signalTooQuiet: "Much of the sample is quiet. Move closer and try again.",
    signalUsable: "The audio level looks usable and no clipping was detected on this device.",
    initialHint: "Press once to begin. Let go whenever you like. Press again to finish.",
    keepSpeakingTemplate: "Keep speaking for {n} more seconds.",
    reviewHint: "Your sample stayed on this device. Listen once, then continue or record again.",
    recordingFailed: "The recording could not be finished.",
    recordingHint: "Speak naturally about anything. A complete thought is better than a script.",
    micOpenFailed: "The browser could not open your microphone.",
  },
  agreement: {
    labelOwnSources: "These are my sources, and I am creating only my own private clone.",
    labelAgeAndDisclosure: "I am 18 or older and I understand every generated clip is disclosed and protected.",
    labelPrivacyTerms: "I accept the privacy policy and terms for private capture, storage, and transcription.",
    heading: "Your source-use agreement.",
    body: "This allows private source storage and transcription. Each private text question has its own permission; cloned voice also needs identity checks.",
    everythingSelected: "Everything selected",
    selectAll: "Select all",
    legalPrefix: "Read the ",
    legalLinkText: "privacy policy and terms",
    legalSuffix: ". Model authorization is separate, identity-bound, and shown before a voice model is built. You can erase a source or the whole clone later.",
    openingPrivateSpace: "Opening your private space",
    agreeAndContinue: "Agree and continue",
    couldNotRecordAgreement: "We could not record the agreement. Nothing was uploaded.",
  },
  roomNav: {
    ariaLabel: "Clone rooms",
    meet: "Meet",
    knowledge: "Knowledge",
    review: "Review",
    call: "Call",
    share: "Share",
  },
  describeMe: {
    savedNote: "Saved as private context. Any durable change will wait for your review.",
    notStoredError: "The note was not stored.",
    notSavedError: "The note could not be saved.",
    heading: "Describe yourself naturally.",
    body: "A sentence or a page is fine. Vyakti turns it into cited proposals, never silent personality changes.",
    placeholder: "I am warm with close friends, direct at work, and I switch to Hindi when I get excited...",
    savingPrivately: "Saving privately",
    addToContext: "Add to my context",
    charactersTemplate: "{n} characters",
  },
  drawer: {
    closeDrawerAria: "Close clone drawer",
    dialogAria: "Your clones and versions",
    heading: "Your Vyaktis",
    closeAria: "Close",
    voiceVersionTemplate: "Voice v{n}",
    createAnother: "Create another clone",
    replacePrimary: "Replace primary recording",
    deleteClone: "Delete this clone",
    deleteConfirmBody: "This blocks the clone now and starts verified erasure.",
    deleting: "Deleting",
    deletePermanently: "Delete permanently",
    cancel: "Cancel",
  },
  header: {
    openClonesAria: "Open your clones",
    homeAria: "Vyakti home",
    openAccountMenuAria: "Open account menu",
    signOut: "Sign out",
  },
  readStates: {
    workspaceError: "We could not load your workspace.",
    workspaceLoading: "Opening your workspace.",
    tryAgain: "Try again",
    checkingSavedClones: "Checking your saved clones.",
    openingPrivateDraftTest: "Opening private draft test",
    consentError: "We could not confirm your permissions.",
    consentLoading: "Checking your permissions.",
    checkAgain: "Check again",
    loadingAgreement: "Loading your saved agreement.",
  },
  upload: {
    hashMessage: "Checking the recording on this device",
    authorizeMessage: "Opening a private upload",
    uploadAuthMissing: "Private upload authorization is missing.",
    uploadMessage: "Sending the recording to private storage",
    sourceReceiptMissing: "The private source receipt is missing.",
    renewMessage: "Renewing the private upload",
    resumeMessage: "Resuming the private upload",
    verifyMessage: "Verifying the stored recording",
    selectMessage: "Opening private verification for this exact recording",
    stoppedBeforeBuild: "The upload stopped before the build began.",
    pausedHeading: "Upload paused.",
    securingHeading: "Securing your recording.",
    checkingRecording: "Checking recording",
    uploadingPercentTemplate: "Uploading {n}%",
    paused: "Paused",
    openingPrivateUpload: "Opening private upload",
    verifyingReceipt: "Verifying receipt",
    selectingVoice: "Selecting voice",
    recordingStillHere: "The recording is still in this tab. Keep it open to retry.",
    retrySafely: "Retry safely",
    recordAgain: "Record again",
    keepPageOpen: "Keep this page open until private storage confirms the upload.",
  },
  sagaRecovery: {
    heading: "Reconnect your recording.",
    body: "This browser remembers the exact private upload request. Check once for its server receipt, or start a fresh recording if the previous tab closed before upload.",
    checkReceipt: "Check private receipt",
    startAgain: "Start again",
    cannotReadSaved: "This browser could not read the saved request. No build was sent. Allow local storage and try again.",
    cannotSaveNew: "This browser could not save the new request. No build was sent. Allow local storage and try again.",
    changedInAnotherTab: "This recording request changed in another tab. Reload before choosing again.",
    couldNotCheckRecording: "Could not check this recording. Your saved request has been kept.",
    notEligibleForNewRequest: "This saved recording is not available for a new request. Refresh its status before trying again.",
  },
  verification: {
    chooseWhetherToUse: "Choose whether to use this saved recording.",
    couldNotBuild: "This exact recording could not build.",
    needsNewConfirmation: "This older request needs a new confirmation. Your saved recording is still available.",
    confirmToReplace: "Your selected recording changed. Confirm only if you want this saved recording to replace that choice.",
    buildStoppedOurSide: "The private build stopped on our side.",
    checkingUnavailable: "Checking this saved recording is unavailable here. Your previous request has been kept.",
    checkingRecording: "Checking recording",
    useThisRecording: "Use this recording",
    recordAgain: "Record again",
    actionNeeded: "One action is needed",
    stepStopped: "This step stopped",
    checking: "Checking",
    backToKnowledge: "Back to knowledge",
  },
  rooms: {
    voice: {
      headingTemplate: "Meet {name}.",
      body: "Ask a question or listen to a voice sample.",
      meetExperienceAria: "Meet experience",
      conversation: "Conversation",
      voiceSample: "Voice sample",
      privateDraftTest: "Private draft test",
      listeningTest: "Listening test",
      openingListeningTest: "Opening the listening test",
      lookingForSamples: "Looking for two saved voice samples to compare.",
      needTwoSamples: "You need two saved voice samples before you can run a listening test.",
      couldNotOpen: "We could not open the listening test. Nothing was recorded.",
      close: "Close",
      openingConversation: "Opening conversation",
    },
    share: { backToKnowledge: "Back to knowledge", openingSharing: "Opening sharing" },
    enrich: {
      backToVoice: "Back to voice",
      heading: "Add more of you.",
      body: "Choose one thing. Every durable change remains a proposal until you accept it.",
      shareKnowledgeTitle: "Share your knowledge",
      shareKnowledgeNote: "Review material for a text-only link",
      testDraftTitle: "Test a private draft",
      testDraftNote: "One text answer from your saved source",
      describeMeTitle: "Describe me",
      describeMeNote: "Write naturally",
      whoYouAreTitle: "Who you are",
      whoYouAreNote: "Identity, values, and how you talk",
      filesTitle: "Files, images, links",
      filesNote: "Add private context",
      videoTitle: "YouTube or video",
      videoNote: "Bring your own material",
      improveVoiceTitle: "Improve my voice",
      improveVoiceNote: "Add a stronger recording",
      vibeTitle: "Your vibe",
      vibeNote: "Warmth, energy, humour, directness, formality",
      backToChoices: "Back to choices",
      recordInstead: "Record my voice instead",
      reviewTextSharing: "Review text sharing",
      openingWhoYouAre: "Opening who you are",
    },
    evolve: { heading: "Choose what becomes you.", body: "Nothing changes the clone until you accept the cited proposal.", openingHistory: "Opening your evolution history" },
    emotionos: { openingVibe: "Opening your vibe" },
    call: { headingTemplate: "Talk with {name}.", body: "Calls can propose memories and language habits. You decide what stays.", openingCallRoom: "Opening the private call room" },
  },
};

const EN_FIRST_FIVE_MINUTES: FirstFiveMinutesCopy = {
  railLabel: "Getting your AI started",
  signInTitle: "Sign in",
  firstSourceTitle: "Tell it about you",
  firstSourceHint: "Record your voice or describe yourself in writing. Usually a minute or two.",
  meetTitle: "Meet it",
  meetHint: "It can take a few minutes to build. You can keep adding sources while you wait.",
  stepDoneLabel: "Done",
};

const EN_STUDIO_COPY: StudioCopy = {
  personalAuth: PERSONAL_AUTH_COPY_TABLE.en,
  expertSharePanel: EN_EXPERT_SHARE_PANEL,
  quickVoiceCapture: EN_QUICK_VOICE_CAPTURE,
  expertConversation: EN_EXPERT_CONVERSATION,
  personModelStudio: EN_PERSON_MODEL_STUDIO,
  meetMemory: EN_MEET_MEMORY,
  cloneVerificationJourney: EN_CLONE_VERIFICATION_JOURNEY,
  contextLockerPanel: EN_CONTEXT_LOCKER_PANEL,
  voicePreviewPanel: EN_VOICE_PREVIEW_PANEL,
  mirrorCallStudio: EN_MIRROR_CALL_STUDIO,
  cloneExperienceShell: EN_CLONE_EXPERIENCE_SHELL,
  firstFiveMinutes: EN_FIRST_FIVE_MINUTES,
};

// The Hindi table is its own chunk (WS-R71's shape). `STUDIO_COPY_TABLE.hi`
// is a placeholder that THROWS on any property read until `loadStudioCopy`
// installs the real table, never English in its place — `localeContext.tsx`
// renders nothing for a locale whose table is not ready, the same
// `personalAuthCopyRegistry.ts` contract restated for the rest of the studio.
let hiInstalled: StudioCopy | null = null;
const HI_NOT_LOADED = new Proxy({} as StudioCopy, {
  get(_target, key) {
    if (key === "then" || typeof key === "symbol") return undefined;
    if (hiInstalled) return hiInstalled[key as keyof StudioCopy];
    throw new Error(`studio_personal_copy_hi_not_loaded: read of ${String(key)} before loadStudioCopy("hi")`);
  },
  has(_target, key) {
    return hiInstalled ? Object.prototype.hasOwnProperty.call(hiInstalled, key) : false;
  },
  ownKeys() {
    return hiInstalled ? Reflect.ownKeys(hiInstalled) : [];
  },
  getOwnPropertyDescriptor(_target, key) {
    if (!hiInstalled || !Object.prototype.hasOwnProperty.call(hiInstalled, key)) return undefined;
    return { enumerable: true, configurable: true, value: hiInstalled[key as keyof StudioCopy] };
  },
});

export const STUDIO_COPY_TABLE: Record<StudioLocale, StudioCopy> = {
  en: EN_STUDIO_COPY,
  hi: HI_NOT_LOADED,
};

export function studioCopyReady(locale: StudioLocale): boolean {
  return locale === "en" || hiInstalled !== null;
}

let hiLoading: Promise<StudioCopy> | null = null;

/** Installs the Hindi table (own chunk, `./hiCopy`) AND the shared personal
 *  auth table's own Hindi (`personalAuthCopyRegistry.ts`'s own already-lazy
 *  loader, not re-fetched or re-translated here) together, so a caller that
 *  awaits this once gets every section this provider will ever expose. */
export function loadStudioCopy(locale: StudioLocale): Promise<StudioCopy> {
  if (locale === "en") return Promise.resolve(EN_STUDIO_COPY);
  if (hiInstalled) return Promise.resolve(hiInstalled);
  if (!hiLoading) {
    hiLoading = Promise.all([
      import("./hiCopy"),
      loadPersonalAuthCopy("hi"),
    ]).then(([{ HI_STUDIO_COPY }, personalAuthHi]) => {
      hiInstalled = { ...HI_STUDIO_COPY, personalAuth: personalAuthHi };
      return hiInstalled;
    }).catch((cause) => {
      hiLoading = null;
      throw cause;
    });
  }
  return hiLoading;
}

export { personalAuthCopyReady };
