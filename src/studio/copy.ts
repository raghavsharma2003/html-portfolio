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

export interface StudioCopy {
  personalAuth: PersonalAuthCopy;
  expertSharePanel: ExpertSharePanelCopy;
  quickVoiceCapture: QuickVoiceCaptureCopy;
  expertConversation: ExpertConversationCopy;
  personModelStudio: PersonModelStudioCopy;
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

const EN_STUDIO_COPY: StudioCopy = {
  personalAuth: PERSONAL_AUTH_COPY_TABLE.en,
  expertSharePanel: EN_EXPERT_SHARE_PANEL,
  quickVoiceCapture: EN_QUICK_VOICE_CAPTURE,
  expertConversation: EN_EXPERT_CONVERSATION,
  personModelStudio: EN_PERSON_MODEL_STUDIO,
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
