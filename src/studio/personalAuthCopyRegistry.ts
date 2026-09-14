import type { StudioLocale } from "../creatorStudio/studioLocalePreference";
import type { PersonalAuthCopy } from "./personalAuthCopy";

const EN_PERSONAL_AUTH_COPY: PersonalAuthCopy = {
  homeAriaLabel: "Vyakti home",
  safeguardsAriaLabel: "Studio safeguards",
  privateByDefault: "Private by default",
  everyClipDisclosed: "Every clip disclosed",
  deleteAnytime: "Delete anytime",
  welcomeBackTitle: "Welcome back",
  emailTitle: "Start with your email",
  inboxTitle: "Check your inbox",
  resumeTitle: "Sign in again to continue where you were.",
  resumeBodyTemplate: "We will return you to {name} on the {step} step. Private uploads and server work continue. For safety, an unsent recording or form field is not stored.",
  sameClone: "the same clone",
  stepTitle: { feed: "Add sources", meet: "Test your clone", deploy: "Deploy" },
  emailBody: "Get a secure sign-in link in your inbox.",
  inboxBodyTemplate: "We sent a sign-in email to {email}. Open its link. If the email also shows a six-digit code, you can enter it below.",
  emailLabel: "Email address",
  emailPlaceholder: "you@example.com",
  sendingAriaLabel: "Sending sign-in email",
  sending: "Sending email",
  sendLink: "Email me a sign-in link",
  or: "or",
  google: "Continue with Google",
  inboxHelp: "The email link opens the studio directly. This tab will also continue when sign-in finishes in another tab.",
  checkingLink: "Checking sign-in",
  openedLink: "I opened the email link",
  optionalCodeDivider: "or enter a code if shown",
  codeLabel: "Six-digit code (optional)",
  codePlaceholder: "000000",
  verifyingAriaLabel: "Verifying code",
  verifying: "Verifying",
  verify: "Verify and enter",
  differentEmail: "Use a different email",
  linkNotReadyError: "Sign-in has not reached this tab yet. Open the email link, or enter a code if your email shows one.",
  sendError: "Could not send a sign-in email. Try again shortly.",
  networkError: "Could not connect. Check your connection and try again.",
  rateLimitError: "Too many sign-in attempts. Wait a moment and try again.",
  serviceUnavailableError: "Sign-in is temporarily unavailable. Please try again shortly.",
  invalidEmailError: "Enter a valid email address.",
  codeMismatchError: "That code did not match. Check it and try again.",
  googleError: "Google sign-in is unavailable. Use your email instead.",
  workspaceLoadError: "Your studio could not open. Your sign-in is still saved. Try again to reopen it.",
  retryWorkspace: "Try again",
  legalNotice: "After sign-in, you choose what your AI can use.",
  visualAlt: "Luminous curved glass panels in soft silver light",
  visualCaptions: { knowledge: "Your knowledge.", voice: "Your voice.", people: "Your people." },
  variant: {
    generic: { brandTag: "PERSONAL AI", introEyebrow: "", introTitle: "Your expertise. More personal.", introBody: "Create an AI with your knowledge, your voice, and a memory for each person." },
    teacher: { brandTag: "PERSONAL AI", introEyebrow: "", introTitle: "Your expertise. More personal.", introBody: "Create an AI with your knowledge, your voice, and a memory for each person." },
    test: { brandTag: "INTERNAL TEST STUDIO", introEyebrow: "", introTitle: "Add your sources. Then test your clone.", introBody: "Upload useful examples of your voice, writing, videos, and context. Then hear the draft, talk to it, and correct it." },
  },
};

let hiInstalled: PersonalAuthCopy | null = null;
const HI_NOT_LOADED = new Proxy({} as PersonalAuthCopy, {
  get(_target, key) {
    if (key === "then" || typeof key === "symbol") return undefined;
    if (hiInstalled) return hiInstalled[key as keyof PersonalAuthCopy];
    throw new Error(`personal_auth_copy_hi_not_loaded: read of ${String(key)} before loadPersonalAuthCopy("hi")`);
  },
  has(_target, key) {
    return hiInstalled ? Object.prototype.hasOwnProperty.call(hiInstalled, key) : false;
  },
  ownKeys() {
    return hiInstalled ? Reflect.ownKeys(hiInstalled) : [];
  },
  getOwnPropertyDescriptor(_target, key) {
    if (!hiInstalled || !Object.prototype.hasOwnProperty.call(hiInstalled, key)) return undefined;
    return { enumerable: true, configurable: true, value: hiInstalled[key as keyof PersonalAuthCopy] };
  },
});

export const PERSONAL_AUTH_COPY_TABLE: Record<StudioLocale, PersonalAuthCopy> = {
  en: EN_PERSONAL_AUTH_COPY,
  hi: HI_NOT_LOADED,
};

let hiLoading: Promise<PersonalAuthCopy> | null = null;

export function personalAuthCopyReady(locale: StudioLocale): boolean {
  return locale === "en" || hiInstalled !== null;
}

export function loadPersonalAuthCopy(locale: StudioLocale): Promise<PersonalAuthCopy> {
  if (locale === "en") return Promise.resolve(EN_PERSONAL_AUTH_COPY);
  if (hiInstalled) return Promise.resolve(hiInstalled);
  if (!hiLoading) {
    hiLoading = import("./hiPersonalAuthCopy").then(({ HI_PERSONAL_AUTH_COPY }) => {
      hiInstalled = HI_PERSONAL_AUTH_COPY;
      return HI_PERSONAL_AUTH_COPY;
    }).catch((cause) => {
      hiLoading = null;
      throw cause;
    });
  }
  return hiLoading;
}
