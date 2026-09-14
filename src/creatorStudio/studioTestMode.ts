import type { StepView, WizardView } from "./wizardModel";

/** The frontend half of the internal self-test switch. */
export function studioSelfTestUiEnabled(mode: unknown, environment: unknown): boolean {
  return mode === "true" && environment === "internal-owner-testing";
}

/** Test builds expose source intake and clone interaction with no gate between them. */
export function selfTestWizard(base: WizardView): WizardView {
  const feed = base.steps.find((step) => step.id === "feed") ?? base.steps[0];
  const meet = base.steps.find((step) => step.id === "meet") ?? base.steps[1];
  if (!feed || !meet) return base;

  const feedView: StepView = {
    ...feed,
    number: 1,
    title: "Add sources",
    promise: "Add any mix of audio, screenshots, text, links, videos, or channels.",
    state: "waiting",
    ember: true,
    missing: [],
    statusLabel: "Add what helps",
    top: null,
  };
  const meetView: StepView = {
    ...meet,
    number: 2,
    title: "Test your AI",
    promise: "Hear it, talk to it, and correct what it gets wrong.",
    state: "later",
    ember: false,
    missing: [],
    statusLabel: "Available now",
    top: null,
  };

  return {
    steps: [feedView, meetView],
    emberStep: "feed",
  };
}
