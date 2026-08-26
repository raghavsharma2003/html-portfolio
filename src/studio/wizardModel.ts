// wizardModel.ts — the three-step studio wizard, as a pure function.
//
// WHY THIS IS A SEPARATE, DEPENDENCY-FREE MODULE
// ---------------------------------------------------------------------------
// `context/decisions.md#three-step-wizard-ia` is an owner directive with a
// shape: FEED, then MEET, then DEPLOY. The defect it fixes ("one single screen
// of nonsense") was not a styling problem, it was the absence of a state
// machine: fourteen panels rendered unconditionally, each deciding on its own
// whether it was ready, and nothing anywhere held the answer to "where am I and
// what is missing".
//
// So the answer lives here, in one place, with no React and no fetch in it, for
// the reason `docs/gurukul/PRODUCT-JOURNEY.md` §3.2 gives and then repeats:
// **no rail row may render a status that is not derived from data.** BREAK 8
// (a literal "0 / No model trained") and BREAK 11 (a hardcoded `next` class on
// QuickStartPath step 3, which made 3/3 structurally unreachable) are the same
// defect twice. A status computed in JSX is a status that will eventually be
// typed by hand; a status computed by a function an eval can call 4 000 times
// is not. `evals/studiowizard.mjs` is that eval.
//
// THE TWO RULES THAT ARE PROPERTIES, NOT PREFERENCES
// ---------------------------------------------------------------------------
// 1. **One ember at a time.** `DESIGN-SYSTEM.md` §4.1: at most one
//    `--state-waiting` on screen. A rail with three things glowing is a rail
//    nobody starts. Enforced below by construction (`emberStep`), not by each
//    row deciding for itself, and asserted over the whole input space.
//
// 2. **A step is never silently blocked.** The owner's report says the point of
//    the product is "to interact with the agent, check it, tweak it" — so a
//    wizard that refuses to open MEET until FEED is perfect is the wall again,
//    wearing a progress bar. Every step is always REACHABLE; what changes with
//    readiness is what the step SAYS. `stepEntryWarning` is the honest line a
//    step shows when you arrive early, and it names what will be empty rather
//    than pretending the door is locked.
//
// The vocabulary of blockers is inherited verbatim from the surface this
// replaces (`QuickStartPath.tsx`, WS-P), including its best idea: every missing
// thing names whose turn it is, "you" or "platform". That split is the house
// pattern (`DESIGN-SYSTEM.md` §4.6 rule 2) and it survives the restructure
// because it was the one part of the old screen that was right.

/** The three steps, in the owner's order and the owner's words. */
export type StepId = "feed" | "meet" | "deploy";

export const STEP_ORDER: readonly StepId[] = ["feed", "meet", "deploy"] as const;

/**
 * The four `--state-*` tokens, plus `later`.
 *
 * `later` is not a fifth colour: it is the neutral rendering a not-yet-reached
 * step gets so that `waiting` (the ember) can mean exactly one thing. Without
 * it, "not done" and "your turn" are the same paint on three rows at once.
 */
export type StepState = "done" | "waiting" | "running" | "later" | "stopped";

export type Owner = "you" | "platform";

export interface Missing {
  /** Stable code so an eval can assert on identity rather than on prose. */
  code: string;
  label: string;
  owner: Owner;
  /** What to do about it, second person, present tense. */
  note: string;
  /** An in-page anchor on the step that owns it. Empty when there is none. */
  anchor: string;
}

/**
 * Everything the wizard needs, already reduced to plain values by the caller.
 *
 * Deliberately not `Replica` / `ReplicaRuntimeStatus` / `ConsentReceipt[]`: the
 * point of this module is that an eval can construct its whole input space
 * without a database, and a type that drags six API shapes in defeats that.
 * `StudioApp` does the reduction once, in `wizardInput()`.
 */
export interface WizardInput {
  /** `revoked` and `purging` stop the whole wizard. */
  stopped: boolean;
  /** capture + transcription + storage are all active. */
  sourceConsent: boolean;
  /** Rows in the private source ledger. */
  sourceCount: number;
  /** Items in the Context Locker (files and links). `null` = not loaded yet. */
  contextItemCount: number | null;
  identityVerified: boolean;
  livenessVerified: boolean;
  /** A sheet draft that came back from `/api/teacher-sheet`, not a seed. */
  sheetPersisted: boolean;
  /** Only teacher mode has a sheet to confirm. */
  mode: "generic" | "teacher";
  /** `null` until `/api/replica-runtime` answers. Never guessed. */
  runtime: {
    active: boolean;
    blockers: readonly string[];
    voiceGenomeVersion: number | null;
  } | null;
  /**
   * Channels with a stored external reference.
   *
   * `null` means UNKNOWN, and unknown is not zero. Generic (self-replica) mode
   * has no channels surface at all, and in teacher mode the list has not
   * answered until the panel mounts. In both cases the wizard says nothing
   * about channels rather than reporting "none connected", which would be a
   * literal in a status position wearing a variable's clothes.
   */
  connectedChannels: number | null;
}

export interface StepView {
  id: StepId;
  /** 1-based, phase-scoped. There is no global step number in this product. */
  number: number;
  title: string;
  /** The promise, in the owner's terms. One line, no em-dash. */
  promise: string;
  state: StepState;
  /** True only for the single ember step, if there is one. */
  ember: boolean;
  missing: Missing[];
  /** Human summary of `state`, always a word, never only a colour. */
  statusLabel: string;
}

export interface WizardView {
  steps: StepView[];
  /** The step the ember is on, or null when nothing is waiting on the owner. */
  emberStep: StepId | null;
}

const TITLES: Record<StepId, { title: string; promise: string }> = {
  feed: {
    title: "Feed it",
    promise: "Give it your files, your videos, your links, and your voice.",
  },
  meet: {
    title: "Meet it",
    promise: "Talk to your clone, hear it, and correct it while it listens.",
  },
  deploy: {
    title: "Deploy it",
    promise: "Decide where it can be reached, after you have seen what it says first.",
  },
};

const STATUS_LABEL: Record<StepState, string> = {
  done: "Done",
  waiting: "Your turn",
  running: "We are working",
  later: "Not started",
  stopped: "Stopped",
};

/**
 * The blocker vocabulary, carried over from `QuickStartPath.BLOCKER_META`
 * unchanged in meaning, re-homed onto the step that now owns each anchor.
 *
 * `voice_not_ready` and `production_voice_required` keep their platform owner
 * and their honest note: the voice service genuinely is not connected, and a
 * teacher cannot unblock it. Saying so is the whole point (`docs/HONESTY.md`).
 */
const BLOCKER_META: Record<string, { label: string; owner: Owner; note: string; anchor: string; step: StepId }> = {
  self_identity_not_bound: {
    label: "Verified account-to-person binding",
    owner: "you", step: "meet", anchor: "#identity-proofing",
    note: "Verify your identity here, on this step.",
  },
  adult_verification_required: {
    label: "Living-adult verification",
    owner: "you", step: "meet", anchor: "#liveness-capture",
    note: "Complete the live challenge here, on this step.",
  },
  identity_verification_required: {
    label: "Identity verification",
    owner: "you", step: "meet", anchor: "#identity-proofing",
    note: "Verify your identity here, on this step.",
  },
  liveness_verification_required: {
    label: "Live anti-replay check",
    owner: "you", step: "meet", anchor: "#liveness-capture",
    note: "Complete the live challenge here, on this step.",
  },
  inference_consent_required: {
    label: "Inference permission",
    owner: "you", step: "meet", anchor: "#model-consent-gate",
    note: "Grant training and inference permission in Advanced on this step.",
  },
  person_profile_not_approved: {
    label: "Approved person model",
    owner: "you", step: "meet", anchor: "#person-model-studio",
    note: "Review and confirm your claims in Advanced on this step.",
  },
  calibration_not_approved: {
    label: "Approved behavior calibration",
    owner: "you", step: "meet", anchor: "#calibration-studio",
    note: "Complete the calibration comparisons in Advanced on this step.",
  },
  voice_genome_not_approved: {
    label: "Approved voice model",
    owner: "platform", step: "meet", anchor: "#processing-review",
    note: "We are waiting on processing review and approval. Nothing for you to do.",
  },
  voice_not_ready: {
    label: "Production voice mapping",
    owner: "platform", step: "meet", anchor: "#voice-enrollment-lab",
    note: "We are still connecting the voice service. Nothing you can do here, and we will move this to done when it clears.",
  },
  production_voice_required: {
    label: "Non-test voice provider",
    owner: "platform", step: "meet", anchor: "#voice-enrollment-lab",
    note: "We are still connecting the voice service. Nothing you can do here, and we will move this to done when it clears.",
  },
  qualification_incomplete: {
    label: "Automated qualification suite",
    owner: "platform", step: "deploy", anchor: "#runtime-gate",
    note: "Runs automatically once every other gate is closed.",
  },
  replica_not_ready: {
    label: "Approved voice and behavior models",
    owner: "platform", step: "deploy", anchor: "#runtime-gate",
    note: "Depends on the gates above being closed first.",
  },
};

/** Exported so the launch list and the eval read the same table. */
export function blockerMeta(code: string) {
  return BLOCKER_META[code] ?? null;
}

/** Blockers the runtime reported that this build has copy for, for one step. */
export function blockersForStep(blockers: readonly string[], step: StepId): Missing[] {
  return blockers
    .map((code) => ({ code, meta: BLOCKER_META[code] }))
    .filter((row): row is { code: string; meta: typeof BLOCKER_META[string] } => Boolean(row.meta) && row.meta.step === step)
    .map(({ code, meta }) => ({ code, label: meta.label, owner: meta.owner, note: meta.note, anchor: meta.anchor }));
}

/**
 * Blockers the runtime reported that this build has NO copy for.
 *
 * Rendered, not swallowed. A gate we do not recognise is still a gate that is
 * holding a teacher's clone shut, and dropping it from the list is how a
 * checklist reaches 3/3 while the Activate button stays disabled. The old
 * surface filtered these out silently (`QuickStartPath.tsx:96`).
 */
export function unknownBlockers(blockers: readonly string[]): string[] {
  return blockers.filter((code) => !BLOCKER_META[code]);
}

function feedMissing(input: WizardInput): Missing[] {
  const missing: Missing[] = [];
  if (!input.sourceConsent) {
    missing.push({
      code: "source_consent_required",
      label: "Permission to hold your files",
      owner: "you",
      note: "Grant capture, transcription and storage permission before uploading anything.",
      anchor: "#enrollment-workspace",
    });
  }
  // `contextItemCount === null` is the Context Locker not having answered yet.
  // Claiming "you have nothing" during a load is a status derived from a
  // spinner, so the ask is withheld until both halves are actually known. The
  // step still reads as not-done, which is true.
  if (input.sourceCount === 0 && input.contextItemCount === 0) {
    missing.push({
      code: "no_material",
      label: "Something to learn from",
      owner: "you",
      note: "Add one file, one link, or one recording. One is enough to start.",
      anchor: "#context-locker",
    });
  }
  return missing;
}

function meetMissing(input: WizardInput): Missing[] {
  const missing: Missing[] = [];
  if (!input.identityVerified) {
    missing.push({
      code: "identity_not_verified",
      label: "Proof that this is you",
      owner: "you",
      note: "Verify your identity to activate your own voice.",
      anchor: "#identity-proofing",
    });
  }
  if (!input.livenessVerified) {
    missing.push({
      code: "liveness_not_verified",
      label: "A live challenge, recorded now",
      owner: "you",
      note: "Record the live phrase so the voice can be bound to a living person.",
      anchor: "#liveness-capture",
    });
  }
  if (input.mode === "teacher" && !input.sheetPersisted) {
    missing.push({
      code: "sheet_not_saved",
      label: "A saved teaching sheet",
      owner: "you",
      note: "Review the sheet and save it, so the clone answers as you and not as an example.",
      anchor: "#teacher-sheet-studio",
    });
  }
  // Runtime blockers that belong to this step are ADDED to, not merged with,
  // the checks above: the runtime can only report what it can see, and the
  // sheet is not one of the things it can see.
  for (const row of blockersForStep(input.runtime?.blockers ?? [], "meet")) {
    if (!missing.some((existing) => existing.label === row.label)) missing.push(row);
  }
  return missing;
}

function deployMissing(input: WizardInput): Missing[] {
  const missing: Missing[] = blockersForStep(input.runtime?.blockers ?? [], "deploy");
  for (const code of unknownBlockers(input.runtime?.blockers ?? [])) {
    missing.push({
      code,
      label: code.replaceAll("_", " "),
      owner: "platform",
      note: "The runtime reported this gate and this build has no description for it. It is still holding activation shut.",
      anchor: "#runtime-gate",
    });
  }
  if (input.runtime && !input.runtime.active && missing.length === 0) {
    missing.push({
      code: "not_activated",
      label: "Activation",
      owner: "you",
      note: "Every gate is closed. Activate the runtime when you are ready.",
      anchor: "#runtime-gate",
    });
  }
  if (input.connectedChannels === 0) {
    missing.push({
      code: "no_channel",
      label: "One place it can be reached",
      owner: "you",
      note: "Connect at least one channel after you have read the disclosure card.",
      anchor: "#channels-studio",
    });
  }
  return missing;
}

function feedDone(input: WizardInput): boolean {
  return input.sourceConsent && (input.sourceCount > 0 || (input.contextItemCount ?? 0) > 0);
}

function meetDone(input: WizardInput): boolean {
  return meetMissing(input).length === 0;
}

function deployDone(input: WizardInput): boolean {
  if (!input.runtime?.active) return false;
  // Unknown channel state cannot complete the step: "we did not ask" is not
  // "one is connected". It is also not a blocker with a name, which is why
  // `deployMissing` stays quiet about it.
  return (input.connectedChannels ?? 0) > 0;
}

/**
 * The whole rail, derived. Nothing here reads the DOM, a clock, or a literal.
 *
 * The ember rule is applied LAST and centrally: compute done/not-done for every
 * step first, then hand the single ember to the earliest step that is not done
 * and has at least one thing waiting on the owner. A step whose every missing
 * item is owned by the platform renders `running` (slate) and does not take the
 * ember, because `--state-running` means exactly "you cannot speed this up".
 */
export function computeWizard(input: WizardInput): WizardView {
  const missingByStep: Record<StepId, Missing[]> = {
    feed: feedMissing(input),
    meet: meetMissing(input),
    deploy: deployMissing(input),
  };
  const doneByStep: Record<StepId, boolean> = {
    feed: feedDone(input),
    meet: meetDone(input),
    deploy: deployDone(input),
  };

  let ember: StepId | null = null;
  if (!input.stopped) {
    for (const id of STEP_ORDER) {
      if (doneByStep[id]) continue;
      if (missingByStep[id].some((row) => row.owner === "you")) {
        ember = id;
        break;
      }
    }
  }

  const steps = STEP_ORDER.map((id, index): StepView => {
    const missing = missingByStep[id];
    const state: StepState = input.stopped
      ? "stopped"
      : doneByStep[id]
        ? "done"
        : ember === id
          ? "waiting"
          : missing.length > 0 && missing.every((row) => row.owner === "platform")
            ? "running"
            : "later";
    return {
      id,
      number: index + 1,
      title: TITLES[id].title,
      promise: TITLES[id].promise,
      state,
      ember: state === "waiting",
      missing,
      statusLabel: STATUS_LABEL[state],
    };
  });

  return { steps, emberStep: ember };
}

/**
 * The line a step shows when you arrive before it is ready.
 *
 * `null` means "say nothing": the step works. This is the honesty half of rule
 * 2 at the top of this file. It never says "you cannot be here" and it never
 * says "complete step 1 first" — it names the specific thing that will be
 * empty, because that is what a person actually needs in order to decide
 * whether to go back.
 */
export function stepEntryWarning(step: StepId, input: WizardInput): string | null {
  if (input.stopped) return "This workspace is revoked. Nothing on this step can run.";
  if (step === "meet" && !input.sourceConsent) {
    return "You have not granted source permission yet, so nothing you say here is kept and the clone has nothing of yours to learn from.";
  }
  // Only claimed once BOTH intake surfaces have actually answered. See
  // `feedMissing` for why an unanswered locker may not become a sentence about
  // what the owner has or has not done.
  if (step === "meet" && input.sourceCount === 0 && input.contextItemCount === 0) {
    return "You have not added anything yet, so the clone has nothing of yours to speak from. You can still talk to it, and it will sound generic until you feed it.";
  }
  if (step === "deploy" && !meetDone(input)) {
    const owed = meetMissing(input).filter((row) => row.owner === "you").length;
    return owed > 0
      ? `Your clone is not activatable yet. ${owed} thing${owed === 1 ? "" : "s"} on Meet it are still waiting on you, and every channel below stays refused until they clear.`
      : "Your clone is not activatable yet. The remaining gates are waiting on us, not on you, and every channel below stays refused until they clear.";
  }
  return null;
}

/** The label on the Next button, which always says where it goes. */
export function nextStep(step: StepId): StepId | null {
  const index = STEP_ORDER.indexOf(step);
  return index >= 0 && index < STEP_ORDER.length - 1 ? STEP_ORDER[index + 1] : null;
}

export function previousStep(step: StepId): StepId | null {
  const index = STEP_ORDER.indexOf(step);
  return index > 0 ? STEP_ORDER[index - 1] : null;
}

export function stepTitle(step: StepId): string {
  return TITLES[step].title;
}

/**
 * Read the step out of a URL query string.
 *
 * Unknown, absent and malformed all collapse to `feed`, because the first step
 * is the only answer that is never wrong: it is where a new workspace starts
 * and it is non-destructive to land on. Parsing throws in exactly one place
 * (a `URLSearchParams` on a hostile string) and that is caught by the caller.
 */
export function stepFromQuery(search: string): StepId {
  try {
    const value = new URLSearchParams(search).get("step");
    return (STEP_ORDER as readonly string[]).includes(value || "") ? (value as StepId) : "feed";
  } catch {
    return "feed";
  }
}

/**
 * The query string for a step, preserving every other parameter.
 *
 * `mode=teacher` is the one that matters and losing it across a Next click
 * would flip the whole studio's copy mid-flow, which is BREAK 1 in
 * `PRODUCT-JOURNEY.md` arriving by a second route.
 */
export function queryForStep(search: string, step: StepId): string {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    params = new URLSearchParams();
  }
  params.set("step", step);
  return `?${params.toString()}`;
}
