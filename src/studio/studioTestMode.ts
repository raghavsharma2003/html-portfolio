import type { StepView, WizardView } from "./wizardModel";

/** The frontend half of the internal self-test switch. */
export function studioSelfTestUiEnabled(mode: unknown, environment: unknown): boolean {
  return mode === "true" && environment === "internal-owner-testing";
}

export interface SelfTestWizardTruth {
  sourceAdded: boolean;
  processing: boolean;
  voiceReady: boolean;
}

/**
 * Test builds keep both steps reachable, but "available now" is reserved for
 * a voice draft that actually exists. Processing is our turn, so no owner
 * ember is shown while a worker is running.
 */
export function selfTestWizard(base: WizardView, truth: SelfTestWizardTruth = {
  sourceAdded: false,
  processing: false,
  voiceReady: false,
}): WizardView {
  const feed = base.steps.find((step) => step.id === "feed") ?? base.steps[0];
  const meet = base.steps.find((step) => step.id === "meet") ?? base.steps[1];
  if (!feed || !meet) return base;

  const feedView: StepView = {
    ...feed,
    number: 1,
    title: "Add sources",
    promise: "Add any mix of audio, screenshots, text, links, videos, or channels.",
    state: truth.voiceReady ? "done" : truth.processing ? "running" : "waiting",
    ember: !truth.sourceAdded,
    missing: [],
    statusLabel: truth.voiceReady
      ? "Voice source ready"
      : truth.processing
        ? "Processing your recording"
        : truth.sourceAdded
          ? "Source added"
          : "Add a recording",
    top: null,
  };
  const meetView: StepView = {
    ...meet,
    number: 2,
    title: "Test your clone",
    promise: "Hear it, talk to it, and correct what it gets wrong.",
    state: truth.voiceReady ? "waiting" : "later",
    ember: truth.voiceReady,
    missing: [],
    statusLabel: truth.voiceReady ? "Available now" : "Available after voice draft",
    top: null,
  };

  return {
    steps: [feedView, meetView],
    emberStep: truth.voiceReady ? "meet" : truth.sourceAdded ? null : "feed",
  };
}
