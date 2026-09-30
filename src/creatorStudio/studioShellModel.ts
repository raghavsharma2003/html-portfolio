// studioShellModel.ts — WS-R31. The three-tab collapse, as a pure function.
//
// WHY THIS IS A SEPARATE, DEPENDENCY-FREE MODULE
// ---------------------------------------------------------------------------
// Same reason `wizardModel.ts` and `blockerClass.ts` are: no React and no
// fetch in it, so `evals/studio-shell/run.mjs` can construct the whole input
// space (empty, partial, complete) and call these functions thousands of
// times without a browser, a database, or a mock DOM. The only imports here
// are TYPE-only (`import type`), which erase at compile time and add nothing
// to the bundle a caller actually runs.
//
// WHAT THIS FILE REFUSES TO DO, same law as `ReadinessPanel.tsx`: compute a
// number, or invent a sentence that is not backed by a real read handed in by
// the caller. A `null` stays `null` here and renders as "not measured yet" or
// "nothing yet" one layer up, never as a zero and never as a guess.
//
// THE PRIMARY CONTROL. Law 3 of the WS-R31 brief: one per tab, never two, and
// it is "the one the blocker list says is next". `computeWizard()`
// (`wizardModel.ts`) already derives that per step as `StepView.top`, and its
// own header says its blocker vocabulary is "inherited verbatim" from
// `QuickStartPath.tsx`'s `BLOCKER_META` — so routing the primary control
// through `top` rather than re-deriving a second lookup from raw blocker
// codes is the SAME fact, read once, not a second place for it to drift
// (`context/rejected.md#a-panel-hardcoding-its-own-blocker-class-will-drift-from-the-rail`).
// `StudioShell.tsx` imports `BLOCKER_META` from `QuickStartPath.tsx` directly
// (never copied) for the one thing `top` does not carry: the "still locked,
// and who it is waiting on" breakdown list, the one part of the retired
// `QuickStartPath` screen this workstream re-homes onto the Meet tab.
import type { Missing, StepId } from "./wizardModel";

export type TabId = "feed" | "meet" | "share";

export const TAB_ORDER: readonly TabId[] = ["feed", "meet", "share"];

/** The shell's tab ids map onto the wizard's existing step ids one to one.
 *  "share" is "deploy" under the hood: no new step, no new gate, the exact
 *  step `RoomStudio`/`ChannelsStudio`/`RuntimeGate` already live on. */
export const TAB_STEP: Record<TabId, StepId> = { feed: "feed", meet: "meet", share: "deploy" };

export const TAB_TITLE: Record<TabId, string> = { feed: "Feed", meet: "Meet", share: "Share" };

export const TAB_PROMISE: Record<TabId, string> = {
  feed: "Bring your material.",
  meet: "Meet your AI: hear it, correct it, see how ready it is.",
  share: "Publish your Room and decide where it can be reached.",
};

export type TabState = "empty" | "working" | "blocked_you" | "blocked_us" | "clear";

export interface PrimaryControl {
  label: string;
  anchor: string;
  cls: "you" | "us";
}

export interface TabHeadline {
  /** One honest sentence, computed from real reads. Never a guess. */
  sentence: string;
  state: TabState;
  /** At most one. Null means nothing is open on this tab right now. */
  primary: PrimaryControl | null;
}

function controlFromMissing(top: Missing | null): PrimaryControl | null {
  if (!top) return null;
  return { label: top.label, anchor: top.anchor, cls: top.cls };
}

// ── FEED ─────────────────────────────────────────────────────────────────

export interface PlatformWork {
  running: number;
  stuck: number;
  undeployedLanes: readonly string[];
}

export interface FeedInput {
  sourceCount: number;
  platformWork: PlatformWork | null;
  /** `wizard.steps.find(s => s.id === "feed").top`, for the rare case a Feed
   *  gate exists (source permission, say) that source count alone does not
   *  cover. Most builds this stays null once a source exists. */
  top: Missing | null;
}

export function feedHeadline(input: FeedInput): TabHeadline {
  const { sourceCount, platformWork, top } = input;
  const stuck = platformWork ? platformWork.stuck > 0 : false;
  const working = Boolean(
    platformWork && (platformWork.running > 0 || platformWork.stuck > 0 || platformWork.undeployedLanes.length > 0),
  );

  if (sourceCount === 0) {
    const fromTop = controlFromMissing(top);
    return {
      sentence: "Nothing added yet. Bring one file, video, or link to start.",
      state: "empty",
      primary: fromTop ?? { label: "Add your first source", anchor: "#enrollment-workspace", cls: "you" },
    };
  }

  const plural = sourceCount === 1 ? "" : "s";
  if (working) {
    return {
      sentence: stuck
        ? `${sourceCount} source${plural} added. One is stuck in our processing.`
        : `${sourceCount} source${plural} added. We are still processing what you gave us.`,
      state: stuck ? "blocked_us" : "working",
      primary: { label: "See what is happening", anchor: "#processing-status-feed", cls: "us" },
    };
  }

  return {
    sentence: `${sourceCount} source${plural} added.`,
    state: "clear",
    primary: controlFromMissing(top),
  };
}

// ── MEET ─────────────────────────────────────────────────────────────────

export interface ReadinessSummary {
  overall: number | null;
  weakestLabel: string | null;
  publishLocked: boolean;
  suggestedAction: { label: string; anchor: string } | null;
}

export interface MeetInput {
  /** `undefined` means this session has not opened Meet yet, so
   *  `ReadinessPanel` has never mounted and never read anything: that is a
   *  DIFFERENT fact from "checked, and nothing is measured" (`null`), and
   *  conflating the two would be exactly the fabricated-negative shape
   *  `docs/HONESTY.md` forbids. */
  readiness: ReadinessSummary | null | undefined;
  /** The interview's next question topic, or null when none is queued. */
  interviewNextTopic: string | null;
  /** `wizard.steps.find(s => s.id === "meet").top`. */
  top: Missing | null;
}

export function meetHeadline(input: MeetInput): TabHeadline {
  const { readiness, interviewNextTopic, top } = input;

  if (readiness === undefined) {
    return {
      sentence: "Not checked yet this visit.",
      state: "empty",
      primary: { label: "Hear it, then talk to it", anchor: "#hear-voice", cls: "you" },
    };
  }

  if (readiness && readiness.overall !== null) {
    const sentence = readiness.weakestLabel
      ? `Readiness ${readiness.overall}. Weakest: ${readiness.weakestLabel.toLocaleLowerCase("en-IN")}.`
      : `Readiness ${readiness.overall}.`;
    const primary = readiness.suggestedAction
      ? { label: readiness.suggestedAction.label, anchor: readiness.suggestedAction.anchor, cls: "you" as const }
      : controlFromMissing(top);
    return { sentence, state: readiness.publishLocked ? "blocked_you" : "clear", primary };
  }

  if (top) {
    return {
      sentence: top.cls === "you"
        ? `Still an apprentice. ${top.label} is next.`
        : `Still an apprentice. We are still working on ${top.label.toLocaleLowerCase("en-IN")}.`,
      state: top.cls === "you" ? "blocked_you" : "blocked_us",
      primary: controlFromMissing(top),
    };
  }

  if (interviewNextTopic) {
    return {
      sentence: `Still an apprentice. The interview can ask about ${interviewNextTopic} next.`,
      state: "working",
      primary: { label: "Continue the interview", anchor: "#mirror-call-studio", cls: "you" },
    };
  }

  return {
    sentence: "Nothing measured yet.",
    state: "empty",
    primary: { label: "Hear it, then talk to it", anchor: "#hear-voice", cls: "you" },
  };
}

// ── SHARE ────────────────────────────────────────────────────────────────

export interface RoomSummary {
  published: boolean;
  paused: boolean;
  slug: string;
}

export interface ShareInput {
  mode: "generic" | "teacher";
  /** RuntimeGate's own answer. Only read when there is no Room (generic mode,
   *  or teacher mode before a Room has ever been created). */
  runtimeActive: boolean;
  /** `undefined` means this session has not opened Share yet in teacher
   *  mode, so `RoomStudio` has never mounted and never read anything: a
   *  different fact from "checked, and there is no Room" (`null`). Not used
   *  in generic mode, where `runtimeActive`/`top` above are already fetched
   *  by the shell regardless of which tab is open. */
  room: RoomSummary | null | undefined;
  followersTotal: number | null;
  link: string | null;
  /** The Room's own blocker list, first "waiting_on_you" row else first
   *  "waiting_on_us" row, already computed by `RoomStudio`'s own read. */
  roomBlocker: PrimaryControl | null;
  /** `wizard.steps.find(s => s.id === "deploy").top`. */
  top: Missing | null;
}

export function shareHeadline(input: ShareInput): TabHeadline {
  const { mode, runtimeActive, room, followersTotal, link, roomBlocker, top } = input;

  if (mode === "teacher" && room === undefined) {
    return {
      sentence: "Not checked yet this visit.",
      state: "empty",
      primary: { label: "Open your Room", anchor: "#room-studio", cls: "you" },
    };
  }

  if (mode !== "teacher") {
    if (runtimeActive) return { sentence: "Your AI is active.", state: "clear", primary: null };
    const fromTop = controlFromMissing(top);
    return {
      sentence: fromTop
        ? (fromTop.cls === "you" ? `Not active yet. ${fromTop.label} is next.` : `Not active yet. We are still working on ${fromTop.label.toLocaleLowerCase("en-IN")}.`)
        : "Your AI is not active yet.",
      state: fromTop ? (fromTop.cls === "you" ? "blocked_you" : "blocked_us") : "empty",
      primary: fromTop ?? { label: "Open the gates", anchor: "#runtime-gate", cls: "you" },
    };
  }

  if (!room) {
    return {
      sentence: "No Room yet. Set one up when you are ready to publish.",
      state: "empty",
      primary: controlFromMissing(top) ?? { label: "Set up your Room", anchor: "#room-studio", cls: "you" },
    };
  }

  if (room.paused) {
    return {
      sentence: `Your Room is paused${link ? ` at ${link}` : ""}.`,
      state: "blocked_you",
      primary: { label: "Resume your Room", anchor: "#room-studio", cls: "you" },
    };
  }

  if (room.published) {
    const followers = followersTotal === null ? "an unmeasured number of" : String(followersTotal);
    const noun = followersTotal === 1 ? "follower" : "followers";
    return {
      sentence: `Your Room is live${link ? ` at ${link}` : ""}. ${followers} ${noun}.`,
      state: "clear",
      primary: null,
    };
  }

  if (roomBlocker) {
    return {
      sentence: roomBlocker.cls === "you"
        ? `Your Room is a draft. ${roomBlocker.label} is next.`
        : `Your Room is a draft. We are still working on ${roomBlocker.label.toLocaleLowerCase("en-IN")}.`,
      state: roomBlocker.cls === "you" ? "blocked_you" : "blocked_us",
      primary: roomBlocker,
    };
  }

  return {
    sentence: "Your Room is a draft, ready to publish.",
    state: "clear",
    primary: { label: "Publish your Room", anchor: "#room-studio", cls: "you" },
  };
}

// ── the one function StudioShell actually calls ────────────────────────────

export interface HeadlineInputs {
  feed: FeedInput;
  meet: MeetInput;
  share: ShareInput;
}

export function headlineForTab(tab: TabId, inputs: HeadlineInputs): TabHeadline {
  if (tab === "feed") return feedHeadline(inputs.feed);
  if (tab === "meet") return meetHeadline(inputs.meet);
  return shareHeadline(inputs.share);
}
