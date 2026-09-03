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

//
// ── the honesty split (WS-AJ) ──────────────────────────────────────────────
// The one import this module has, and it is a pure sibling with no imports of
// its own, so the "an eval can run this without a database" property holds.
// `blockerClass.ts` carries the whole argument for why the split is a type.
import {
  activityClass,
  type BlockerClass,
  CLASS_COPY,
  disabledReason,
  type DisabledReason,
} from "./blockerClass";

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
  /**
   * The rendered class, which is what the UI actually keys on.
   *
   * It is NOT always `owner === "you" ? "you" : "us"`, and that difference is
   * the whole point of this field. A gate that is nominally the person's turn
   * but is unreachable because a platform job has not finished is OURS while
   * that is true. `person_profile_not_approved` is the live example: there is
   * nothing for an owner to approve until we have processed what they gave us,
   * and telling them it is their turn in that window is the defect this
   * workstream exists to remove.
   */
  cls: BlockerClass;
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
  /**
   * What the PLATFORM is doing, reduced from `/api/replica-activity` (WS-AF).
   *
   * THE FIELD THE OWNER'S SCREENSHOT NEEDED AND DID NOT HAVE. Their uploaded
   * audio was sitting at `quarantined` because nothing deployed drains the
   * processing queue, and the wizard, which could not see that, told them nine
   * things were waiting on them. Every one of those nine was downstream of a
   * job we had not run.
   *
   * `null` means the activity surface has not answered, and `null` reclassifies
   * NOTHING: the wizard behaves exactly as it did before this field existed.
   * That is the safe default, and it is the honest one, because "we did not
   * ask" is not "the platform is idle" (the same rule `connectedChannels`
   * above is built on).
   */
  platformWork: {
    /** Jobs running, or queued behind a worker. Ours, and moving. */
    running: number;
    /** Jobs stopped on our side: blocked, or failed with nothing to retry. */
    stuck: number;
    /** Human labels of lanes that are not deployed at all. */
    undeployedLanes: readonly string[];
  } | null;
}

/**
 * Is the platform holding work that downstream gates depend on?
 *
 * Deliberately true for `stuck` and for an undeployed lane as well as for
 * `running`. A queue nothing drains is not idle, it is broken, and both of
 * those are ours. The only state that is not ours is an empty queue.
 */
export function platformIsHoldingWork(input: WizardInput): boolean {
  const work = input.platformWork;
  if (!work) return false;
  return work.running > 0 || work.stuck > 0 || work.undeployedLanes.length > 0;
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
  /**
   * The one thing to name on a compact surface, or null when the step is clear.
   *
   * A phone rail has room for one line, and the line has to be a NAME. The old
   * rail rendered "9 waiting on you" there, which is the count defect in its
   * smallest form: nine is not a thing a person can start.
   */
  top: Missing | null;
}

export interface WizardView {
  steps: StepView[];
  /** The step the ember is on, or null when nothing is waiting on the owner. */
  emberStep: StepId | null;
}

/**
 * Titles, promises, and the two navigation phrases.
 *
 * WHY THE NAV PHRASES EXIST (WS-AJ, owner report). The pager used to render
 * "Next: Deploy it" and "Back to Feed it". Those are the STEP names, and a step
 * name is a label on a rail, not a destination in a sentence. Read aloud,
 * "Back to Feed it" is not English, and DESIGN-LAW §1's read-aloud test is the
 * whole gate. So a button says where it goes in the words a person would use:
 * "Next: talk to your clone", "Back to your material".
 *
 * `nextPhrase` is imperative because it follows "Next:" and names an act.
 * `backPhrase` is a noun phrase because it follows "Back to" and names a place.
 * Two fields rather than one, because one field cannot be both, and the version
 * that tried produced "Back to talk to your clone".
 *
 * WS-AP, 2026-08-26: `nextPhrase`/`backPhrase` are unread now that the sticky
 * pager they fed is deleted (owner directive; see the note where `nextStep`
 * used to live, a few hundred lines down). Left in the record rather than
 * stripped out: they cost nothing sitting here as data, and a future surface
 * that needs "Back to your material" phrasing again should not have to
 * reinvent it.
 */
const TITLES: Record<StepId, {
  title: string;
  promise: string;
  nextPhrase: string;
  backPhrase: string;
}> = {
  feed: {
    title: "Feed it",
    promise: "Give it your files, your videos, your links, and your voice.",
    nextPhrase: "add your material",
    backPhrase: "your material",
  },
  meet: {
    title: "Meet it",
    promise: "Talk to your AI, hear it, and correct it while it listens.",
    nextPhrase: "talk to your AI",
    backPhrase: "talking to your AI",
  },
  deploy: {
    title: "Deploy it",
    promise: "Decide where it can be reached, after you have seen what it says first.",
    nextPhrase: "choose where it can be reached",
    backPhrase: "where it can be reached",
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
 *
 * `needsProcessedMaterial` is WS-AJ's addition and it is the field that stops
 * the misattribution. Two of the person-owned gates below are only person-owned
 * ONCE WE HAVE DONE OUR PART: there is nothing to approve in a person model or
 * a calibration until the material behind it has been processed. While the
 * platform is still holding that work, those rows render as ours, with what is
 * happening and what happens next, instead of as an instruction the owner
 * cannot follow.
 */
const BLOCKER_META: Record<string, {
  label: string;
  owner: Owner;
  note: string;
  anchor: string;
  step: StepId;
  /** True when this gate cannot be acted on until our processing finishes. */
  needsProcessedMaterial?: boolean;
}> = {
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
    note: "Grant build and inference permission in Advanced on this step.",
  },
  person_profile_not_approved: {
    label: "Approved: what we learned about you",
    owner: "you", step: "meet", anchor: "#person-model-studio",
    note: "Review and confirm your claims in Advanced on this step.",
    needsProcessedMaterial: true,
  },
  calibration_not_approved: {
    label: "Approved behavior calibration",
    owner: "you", step: "meet", anchor: "#calibration-studio",
    note: "Complete the calibration comparisons in Advanced on this step.",
    needsProcessedMaterial: true,
  },
  // OWNER: "you", not "platform" — this was the class inverted, and it was
  // inverted in the single most important panel in the product. Approving a
  // voice genome is a DELIBERATE human tap (`queueOwnedVoiceGenome` is only
  // ever reached from a person pressing "Queue a draft voice model" in
  // Processing Review, and that is correct: a persona never self-updates
  // without one). So the honest owner of "review and approve" is the person,
  // exactly like `person_profile_not_approved` and `calibration_not_approved`
  // beside it, and it takes the same `needsProcessedMaterial` treatment: while
  // we are still holding processing work, nobody has anything to review yet
  // and the row reads `us`; the moment that clears, it is genuinely their turn.
  // A production run measured the old copy telling an owner "nothing to do
  // here" while their own review-and-approve tap was the entire blocker.
  voice_genome_not_approved: {
    label: "Approved voice",
    owner: "you", step: "meet", anchor: "#processing-review",
    note: "Review the evidence and queue a draft voice under Check it and correct it on this step.",
    needsProcessedMaterial: true,
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
    label: "Approved voice and behavior",
    owner: "platform", step: "deploy", anchor: "#runtime-gate",
    note: "Depends on the gates above being closed first.",
  },
};

/** Exported so the launch list and the eval read the same table. */
export function blockerMeta(code: string) {
  return BLOCKER_META[code] ?? null;
}

/** Every code in the table, so the eval can sweep the whole vocabulary. */
export function allBlockerCodes(): string[] {
  return Object.keys(BLOCKER_META);
}

/**
 * What a row says while WE are the reason it cannot be acted on.
 *
 * One sentence, and it does three things in a fixed order because a person
 * reading a blocked screen wants them in that order: what is happening, that it
 * is not theirs to fix, and what changes it. No apology and no time estimate.
 * A fabricated ETA is the same lie as a fabricated progress bar.
 */
function heldByUsNote(input: WizardInput): string {
  const work = input.platformWork;
  const lanes = work?.undeployedLanes ?? [];
  // NOTE ON A PHRASE THAT IS NOT HERE. Every one of these three lines
  // originally ended "this becomes your turn once it clears", which reads
  // perfectly well and which `blamesThePerson` rejects, because it cannot tell
  // that promise apart from the accusation "it is your turn". The check is
  // right to be strict there and the copy is what should move: "you can pick it
  // up then" says the same thing without borrowing the accusing phrase. A
  // detector loosened to admit a nicer sentence is a detector that admits the
  // sentence it exists to catch.
  if (lanes.length > 0) {
    return `We have not finished connecting ${lanes[0]}, so there is nothing here to review yet. Once that lane is running and your material has been through it, you can pick this up.`;
  }
  if ((work?.stuck ?? 0) > 0) {
    return "Your material is stopped part way through our processing, so there is nothing here to review yet. We can see it, it is on our side, and you can pick this up once it clears.";
  }
  return "We are still processing what you gave us, so there is nothing here to review yet. You can pick this up as soon as processing finishes.";
}

/**
 * The one place a `Missing` is built, so `cls` can never be forgotten.
 *
 * Everything above went through object literals that each set `owner` by hand;
 * adding a second field of the same kind by hand would have been one more
 * chance for a row to disagree with itself. This is the only constructor and
 * `cls` is derived here, once.
 */
function missing(
  row: { code: string; label: string; owner: Owner; note: string; anchor: string; needsProcessedMaterial?: boolean },
  input: WizardInput,
): Missing {
  const heldByUs = Boolean(row.needsProcessedMaterial) && platformIsHoldingWork(input);
  if (heldByUs) {
    return {
      code: row.code,
      label: row.label,
      owner: row.owner,
      cls: "us",
      note: heldByUsNote(input),
      anchor: row.anchor,
    };
  }
  return {
    code: row.code,
    label: row.label,
    owner: row.owner,
    cls: row.owner === "you" ? "you" : "us",
    note: row.note,
    anchor: row.anchor,
  };
}

/** Blockers the runtime reported that this build has copy for, for one step. */
export function blockersForStep(blockers: readonly string[], step: StepId, input: WizardInput): Missing[] {
  return blockers
    .map((code) => ({ code, meta: BLOCKER_META[code] }))
    .filter((row): row is { code: string; meta: typeof BLOCKER_META[string] } => Boolean(row.meta) && row.meta.step === step)
    .map(({ code, meta }) => missing({ code, ...meta }, input));
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

// The three step reducers. Their local arrays are `rows` rather than `missing`
// so they do not shadow the `missing()` constructor above: every row in this
// module goes through that one function, which is what makes `cls` impossible
// to forget on a new blocker.

function feedMissing(input: WizardInput): Missing[] {
  const rows: Missing[] = [];
  if (!input.sourceConsent) {
    rows.push(missing({
      code: "source_consent_required",
      label: "Permission to hold your files",
      owner: "you",
      note: "Grant capture, transcription and storage permission before uploading anything.",
      anchor: "#enrollment-workspace",
    }, input));
  }
  // `contextItemCount === null` is the Context Locker not having answered yet.
  // Claiming "you have nothing" during a load is a status derived from a
  // spinner, so the ask is withheld until both halves are actually known. The
  // step still reads as not-done, which is true.
  if (input.sourceCount === 0 && input.contextItemCount === 0) {
    rows.push(missing({
      code: "no_material",
      label: "Something to learn from",
      owner: "you",
      note: "Add one file, one link, or one recording. One is enough to start.",
      anchor: "#context-locker",
    }, input));
  }
  return rows;
}

function meetMissing(input: WizardInput): Missing[] {
  const rows: Missing[] = [];
  if (!input.identityVerified) {
    rows.push(missing({
      code: "identity_not_verified",
      label: "Proof that this is you",
      owner: "you",
      note: "Verify your identity to activate your own voice.",
      anchor: "#identity-proofing",
    }, input));
  }
  if (!input.livenessVerified) {
    rows.push(missing({
      code: "liveness_not_verified",
      label: "A live challenge, recorded now",
      owner: "you",
      note: "Record the live phrase so the voice can be bound to a living person.",
      anchor: "#liveness-capture",
    }, input));
  }
  if (input.mode === "teacher" && !input.sheetPersisted) {
    rows.push(missing({
      code: "sheet_not_saved",
      label: "A saved teaching sheet",
      owner: "you",
      note: "Review the sheet and save it, so your AI answers as you and not as an example.",
      anchor: "#teacher-sheet-studio",
    }, input));
  }
  // Runtime blockers that belong to this step are ADDED to, not merged with,
  // the checks above: the runtime can only report what it can see, and the
  // sheet is not one of the things it can see.
  for (const row of blockersForStep(input.runtime?.blockers ?? [], "meet", input)) {
    if (!rows.some((existing) => existing.label === row.label)) rows.push(row);
  }
  return rows;
}

function deployMissing(input: WizardInput): Missing[] {
  const rows: Missing[] = blockersForStep(input.runtime?.blockers ?? [], "deploy", input);
  for (const code of unknownBlockers(input.runtime?.blockers ?? [])) {
    rows.push(missing({
      code,
      label: code.replaceAll("_", " "),
      owner: "platform",
      note: "The runtime reported this gate and this build has no description for it. It is still holding activation shut.",
      anchor: "#runtime-gate",
    }, input));
  }
  if (input.runtime && !input.runtime.active && rows.length === 0) {
    rows.push(missing({
      code: "not_activated",
      label: "Activation",
      owner: "you",
      note: "Every gate is closed. Activate the runtime when you are ready.",
      anchor: "#runtime-gate",
    }, input));
  }
  if (input.connectedChannels === 0) {
    rows.push(missing({
      code: "no_channel",
      label: "One place it can be reached",
      owner: "you",
      note: "Connect at least one channel after you have read the disclosure card.",
      anchor: "#channels-studio",
    }, input));
  }
  return rows;
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

  // The ember and the `running` state now key on `cls`, not on `owner`. That
  // one-word change is the honesty fix at the rail level: a step whose only
  // remaining person-owned gate is currently unreachable because WE have not
  // finished processing does not glow ember, because glowing ember is the
  // product saying "your turn" in paint, and it is not their turn.
  let ember: StepId | null = null;
  if (!input.stopped) {
    for (const id of STEP_ORDER) {
      if (doneByStep[id]) continue;
      if (missingByStep[id].some((row) => row.cls === "you")) {
        ember = id;
        break;
      }
    }
  }

  const steps = STEP_ORDER.map((id, index): StepView => {
    const rows = missingByStep[id];
    const state: StepState = input.stopped
      ? "stopped"
      : doneByStep[id]
        ? "done"
        : ember === id
          ? "waiting"
          : rows.length > 0 && rows.every((row) => row.cls === "us")
            ? "running"
            : "later";
    return {
      id,
      number: index + 1,
      title: TITLES[id].title,
      promise: TITLES[id].promise,
      state,
      ember: state === "waiting",
      missing: rows,
      statusLabel: STATUS_LABEL[state],
      // The person's own next act wins the one line a compact surface has. If
      // there is none, the first thing WE are holding takes it, so the line is
      // never blank while something is genuinely open.
      top: rows.find((row) => row.cls === "you") ?? rows[0] ?? null,
    };
  });

  return { steps, emberStep: ember };
}

/**
 * Why "Preview my voice" has no draft to play, and whose turn closes it
 * (WS-AP, from a measured production defect).
 *
 * The panel used to hardcode `disabledReason("us", ...)` for every reason a
 * draft could be missing. On the owner's real replica, with all eight
 * processing steps complete, the true blockers were their OWN identity and
 * liveness verification and their own unreviewed evidence in Processing
 * Review — both `cls: "you"` — and the panel told them "nothing for you to do
 * here" anyway. `meetMissing` (via `computeWizard`) already knows the honest
 * class for every one of those gates; this walks them in the order a person
 * would actually clear them, so this is the ONLY place that decides and a
 * panel importing it cannot drift from the rail again.
 */
export function voicePreviewBlockReason(input: WizardInput): DisabledReason {
  const rows = computeWizard(input).steps.find((row) => row.id === "meet")?.missing ?? [];
  const lead =
    rows.find((row) => row.code === "identity_not_verified") ??
    rows.find((row) => row.code === "liveness_not_verified") ??
    rows.find((row) => row.code === "voice_genome_not_approved") ??
    rows.find((row) => row.code === "voice_not_ready" || row.code === "production_voice_required") ??
    rows[0] ??
    null;
  if (!lead) {
    return disabledReason(
      "us",
      "There is no draft voice to preview yet, because we have not built one from your recordings.",
      "Nothing here needs you. Once a recording has been through processing and a draft voice is built, this turns on. The activity panel on this step shows where your recordings are.",
    );
  }
  return disabledReason(
    lead.cls,
    `There is no draft voice to preview yet. The next thing that closes it is ${lowerFirst(lead.label)}.`,
    lead.note,
  );
}

/**
 * The blocking line a step shows when you arrive before it is ready.
 *
 * Returned as a `DisabledReason` rather than a string, and that is the whole
 * repair. The old signature returned `string | null`, which is why the sentence
 * in the owner's screenshot could exist at all: a bare string carries no class,
 * so nothing downstream could render "waiting on us" differently from "waiting
 * on you", and nothing could check that it had not blamed the wrong party.
 *
 * The rules this now keeps, all three enforced in `evals/studiowizard.mjs`:
 *
 *   NAME, NEVER COUNT. "9 things are still waiting on you" is replaced by the
 *   name of the top blocker. The rest are still listed, on the panel that owns
 *   them, one expand away.
 *
 *   THE CLASS IS PART OF THE SENTENCE. A person reading a blocked screen needs
 *   to know whether to start working or to stop worrying, and those are
 *   opposite actions behind the same disabled button.
 *
 *   OURS IS NEVER PHRASED AS THEIRS. `reasonIsHonest` is run over every string
 *   this function can produce, across the whole input space.
 */
export function stepBlockReason(step: StepId, input: WizardInput): DisabledReason | null {
  if (input.stopped) {
    return disabledReason(
      "us",
      "This workspace is revoked, so nothing on this step can run.",
      "Erasure is running. Create a new workspace if you want to start again.",
    );
  }
  if (step === "meet" && !input.sourceConsent) {
    return disabledReason(
      "you",
      "You have not granted source permission yet, so nothing you say here is kept.",
      "Grant capture, transcription and storage permission on the step before this one.",
    );
  }
  // Only claimed once BOTH intake surfaces have actually answered. See
  // `feedMissing` for why an unanswered locker may not become a sentence about
  // what the owner has or has not done.
  if (step === "meet" && input.sourceCount === 0 && input.contextItemCount === 0) {
    return disabledReason(
      "you",
      "Nothing has been added yet, so the clone has nothing of yours to speak from.",
      "You can still talk to it. It will sound generic until you add one file, link or recording.",
    );
  }
  if (step === "deploy" && !meetDone(input)) {
    const rows = meetMissing(input);
    const mine = rows.find((row) => row.cls === "you");
    if (mine) {
      return disabledReason(
        "you",
        `Your clone cannot be activated yet. The next one is ${lowerFirst(mine.label)}.`,
        `${mine.note} Every channel below stays refused until the gates on Meet it clear.`,
      );
    }
    const ours = rows[0];
    return disabledReason(
      "us",
      ours
        ? `Your clone cannot be activated yet, and the reason is on our side: ${lowerFirst(ours.label)}.`
        : "Your clone cannot be activated yet, and the reason is on our side.",
      ours
        ? `${ours.note} Every channel below stays refused until it clears.`
        : "Every channel below stays refused until it clears. Nothing for you to do here.",
    );
  }
  return null;
}

/**
 * The old string-shaped entry point, kept so nothing that reads a sentence has
 * to learn a type. It is the reason line, flattened, and it is the one the
 * eval's blame sweep runs over as well.
 */
export function stepEntryWarning(step: StepId, input: WizardInput): string | null {
  const reason = stepBlockReason(step, input);
  return reason ? `${reason.headline} ${reason.next}` : null;
}

/**
 * Lower-case an initial letter unless the word looks like a proper noun.
 *
 * Blocker labels are written as headings ("Approved voice model") and have to
 * read as clauses inside a sentence. The acronym guard stops "AI disclosure"
 * becoming "aI disclosure", which is the kind of small wrongness that makes a
 * screen feel machine-written.
 */
function lowerFirst(text: string): string {
  if (/^[A-Z]{2,}/.test(text)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * The reason to render next to a disabled control, from a class and two lines.
 *
 * Re-exported from `blockerClass` so a component needs one import rather than
 * two, and so there is exactly one construction path for the thing DESIGN-LAW
 * §2 requires beside every disabled control.
 */
export { disabledReason, CLASS_COPY };
export type { DisabledReason, BlockerClass };

/** WS-AF's activity states, projected onto the two classes. One mapper. */
export { activityClass };

/**
 * WS-AP, 2026-08-26: `nextStep`, `previousStep`, `nextLabel` and `backLabel`
 * lived here to serve the sticky pager (`StepPager`, deleted per owner
 * directive: `context/rejected.md#the-sticky-pager-was-deleted-not-shrunk`).
 * Nothing calls them any more, and this repo's own law is to grep for a
 * CALLER before trusting a capability is wired, so they went with the pager
 * rather than being left as a dangling forward-navigation API nobody reads.
 * `STEP_ORDER` above is still the one place step order lives; rebuild from
 * that, not from memory of this comment, if a future surface needs it.
 */

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
