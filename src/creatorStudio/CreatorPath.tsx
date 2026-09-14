// CreatorPath.tsx — WS-R65. The creator's first five minutes: one card at
// the top of the Feed tab, the whole path from sign-in to a published Room,
// one next action at a time.
//
// ═════════════════════════════════════════════════════════════════════════
// WHAT THIS CARD IS BUILT AROUND
// ═════════════════════════════════════════════════════════════════════════
//
// WS-R25's funnel (`api/_funnel.js#FUNNEL_STEPS`) already knows the order a
// creator moves through: account, studio, first source, our processing,
// their first heard preview, Readiness measured then passed, disclosure
// approved, a Room, a publish click, a live Room, a first follower. Nothing
// in the studio showed that order as a PATH before this workstream — the
// Feed/Meet/Share shell (`studioShellModel.ts`, WS-R31) collapsed it to one
// sentence per TAB, which is right for "what do I do on this tab" and wrong
// for "how far along am I, overall, from nothing to a published Room".
//
// ═════════════════════════════════════════════════════════════════════════
// WHY THIS READS FROM StudioShell'S OWN STATE, NEVER A NEW ENDPOINT
// ═════════════════════════════════════════════════════════════════════════
//
// The brief's own law 1 allows a new endpoint "when one composed read is
// cheaper" than assembling the reads panels already make. The obvious
// cheaper read is real: `api/_funnel.js#replicaFunnel` already returns this
// exact ordered `steps` object, and adding a GET beside it would be a few
// lines. It was rejected anyway (`context/rejected.md#ws-r65-funnel-read-op-
// rejected-fixture-too-heavy`): the brief's own escape hatch for a new
// endpoint names the shape it wants — "one owner op on an EXISTING DOOR with
// its door-battery case" — and `evals/room-doors/run.mjs`'s shared fake `db`
// has zero support for `vy_replica_source`, `vy_replica_processing_job`,
// `vy_replica_generation`, `vy_replica_readiness`, `vy_teacher_sheet`,
// `vy_room` or `vy_room_follower` (a grep across that whole file finds none
// of those seven table names). Wiring a real `replicaFunnel` call through
// that fixture would mean teaching it seven new table shapes in a file five
// other wave-twelve workstreams are editing concurrently, for a card whose
// job is a Feed-tab progress list, not a ledger. So this reads exactly what
// `StudioShell.tsx` ALREADY has in hand: `sources.length`,
// `wizardInput.platformWork`, the same `readiness`/`room`/`roomStats` state
// `studioShellModel.ts`'s `headlineForTab` already consumes for the tab bar
// itself. Every one of those was fetched for a reason that already existed;
// this file adds no fetch of its own.
//
// ═════════════════════════════════════════════════════════════════════════
// THE "NOT CHECKED YET" CONVENTION, INHERITED RATHER THAN REINVENTED
// ═════════════════════════════════════════════════════════════════════════
//
// `StudioShell.tsx`'s own header names it: `readiness`/`room` are
// `undefined` until Meet/Share have actually mounted THIS visit, because
// `ReadinessPanel`/`RoomStudio` only mount while their tab is active
// (`StudioApp.tsx`'s `step === "meet"` / `step === "deploy"` gates). This
// file inherits that convention rather than working around it: a step whose
// evidence is `undefined` is never rendered "done" here either, so a
// creator who has never opened Meet this session sees this card's Readiness
// steps as still ahead, exactly as the Meet tab's own headline says "Not
// checked yet this visit" — one true story, not two. The one relief from
// this is `room.published`, which is checked because a published Room is a
// PROVEN historical fact (`api/_room-publish.js`'s own gate can only ever
// SET `published_at`, never unset it — pausing is a separate flag), so once
// the Share tab has been opened once this visit and reports `published:
// true`, every step at or before `room_published` in this list is correctly
// marked done even if Meet was never reopened after — the same "walk the
// whole list, take the furthest confirmed step" shape
// `api/_funnel.js#lastReachedStep` already uses for the identical reason
// (`studio_opened` can race ahead of `first_source_uploaded` without that
// being a stall).
//
// ═════════════════════════════════════════════════════════════════════════
// THE DISAPPEARANCE RULE (law 1's own words)
// ═════════════════════════════════════════════════════════════════════════
//
// "It disappears once `room_published` is reached and returns only if the
// Room is paused." A five-minute guided path has done its job the moment
// the Room is live; a card that stayed would be exactly the kind of
// permanent dashboard chrome `docs/gurukul` already rejects for this
// studio. Pausing reopens it because pausing is the one post-publish state
// that puts a creator back in "something needs your attention before
// anyone can reach your AI" territory — the same territory this whole card
// exists to walk them through.
import { useMemo } from "react";
import { jumpTo } from "./WizardRail";
import { withCount } from "./copy";
import { useStudioLocale } from "./localeContext";
import type { StepId } from "./wizardModel";
import type { TabId } from "./studioShellModel";
import "./creator-path.css";

// ── the mirrored order ──────────────────────────────────────────────────
//
// `scripts/check-mirrors.mjs` can only read a single scalar sitting whole on
// an `export const NAME = <literal>` line, never an array — so the shared
// truth is this ONE string, split into `CREATOR_PATH_STEPS` below, never a
// second hand-typed array that could silently drift from
// `api/_funnel.js#FUNNEL_STEPS`.
export const CREATOR_PATH_STEPS_ORDER = "account_created,studio_opened,first_source_uploaded,processing_finished,first_preview_heard,readiness_first_measured,readiness_passed_lock,disclosure_approved,room_created,publish_clicked,room_published,first_follower_joined"; // mirror of api/_funnel.js#FUNNEL_STEPS_ORDER
export const CREATOR_PATH_STEPS = Object.freeze(CREATOR_PATH_STEPS_ORDER.split(",")) as readonly CreatorPathStepId[];

export type CreatorPathStepId =
  | "account_created"
  | "studio_opened"
  | "first_source_uploaded"
  | "processing_finished"
  | "first_preview_heard"
  | "readiness_first_measured"
  | "readiness_passed_lock"
  | "disclosure_approved"
  | "room_created"
  | "publish_clicked"
  | "room_published"
  | "first_follower_joined";

// The publish lock's own two floors (`api/_readiness.js#READINESS_OVERALL_
// FLOOR`/`#READINESS_PART_FLOOR`), named here so the sentence for
// `readiness_passed_lock` can state them exactly rather than guessing —
// mirrored, never a second independent literal.
export const CREATOR_PATH_READINESS_OVERALL_FLOOR = 70; // mirror of api/_readiness.js#READINESS_OVERALL_FLOOR
export const CREATOR_PATH_READINESS_PART_FLOOR = 55; // mirror of api/_readiness.js#READINESS_PART_FLOOR

// ── the pure model ──────────────────────────────────────────────────────

export interface CreatorPathReadiness {
  overall: number | null;
  publishLocked: boolean;
}

export interface CreatorPathRoom {
  published: boolean;
  paused: boolean;
}

/** Everything this card needs, already reduced to plain values by the
 *  caller — `wizardModel.ts#WizardInput`'s own reason: an eval can build
 *  the whole input space with no React, no fetch, no DOM. */
export interface CreatorPathInput {
  accountCreatedAt: string | null;
  sourceCount: number;
  platformWork: { running: number; stuck: number; undeployedLanes: readonly string[] } | null;
  /** `undefined` = Meet has not mounted this visit, so nothing here is
   *  known — the SAME convention `studioShellModel.ts#MeetInput.readiness`
   *  already carries, never re-derived. */
  readiness: CreatorPathReadiness | null | undefined;
  /** `undefined` = Share has not mounted this visit. `null` = checked, no
   *  Room yet. `studioShellModel.ts#ShareInput.room`'s own convention. */
  room: CreatorPathRoom | null | undefined;
  /** Meaningful only once `room` is defined; `null` before that. */
  followersTotal: number | null;
}

export type CreatorPathStepState = "done" | "current" | "ahead";

export interface CreatorPathStepView {
  id: CreatorPathStepId;
  state: CreatorPathStepState;
}

/** Where the current step's one control goes. `targetTab: null` means "stay
 *  on Feed and scroll to `anchor`"; a named tab means "switch tabs", and
 *  `anchor` is unused for that case — the destination tab's own headline
 *  and primary control (`studioShellModel.ts`) take over the moment it
 *  mounts, so this card does not try to reach into a panel that has not
 *  rendered yet. */
export interface CreatorPathControl {
  targetTab: TabId | null;
  anchor: string | null;
}

export interface CreatorPathView {
  steps: CreatorPathStepView[];
  /** `null` once every step this card can see is done. */
  currentStepId: CreatorPathStepId | null;
  /** Law 1's disappearance rule, already applied. */
  visible: boolean;
  /** True only when `visible` is true BECAUSE the Room is paused after
   *  having been published — the one case this card reappears rather than
   *  staying gone for good. */
  paused: boolean;
  control: CreatorPathControl | null;
}

/** Real, positive evidence only. Never `false` — an unconfirmed step is
 *  absence of evidence, not evidence of absence, and the caller below reads
 *  "the furthest step confirmed true" rather than asking each step to prove
 *  a negative. */
function stepConfirmed(id: CreatorPathStepId, input: CreatorPathInput): boolean {
  switch (id) {
    case "account_created":
      return Boolean(input.accountCreatedAt);
    case "studio_opened":
      // Trivially true: this card only ever renders inside the studio.
      return true;
    case "first_source_uploaded":
      return input.sourceCount > 0;
    case "processing_finished": {
      const work = input.platformWork;
      if (!work) return false;
      return input.sourceCount > 0 && work.running === 0 && work.stuck === 0 && work.undeployedLanes.length === 0;
    }
    case "first_preview_heard":
      // No composed read reports this directly (see file header). Left
      // unconfirmed on purpose; a later step's own evidence (Readiness
      // measured, a Room, a publish) forward-fills it the same way
      // `api/_funnel.js#lastReachedStep` already tolerates `studio_opened`
      // racing ahead of `first_source_uploaded`.
      return false;
    case "readiness_first_measured":
      return input.readiness !== undefined;
    case "readiness_passed_lock":
      return input.readiness != null && input.readiness.overall !== null && input.readiness.publishLocked === false;
    case "disclosure_approved":
      // The publish gate (`api/_room-publish.js#publishRoom`) only ever sets
      // `published_at` when the disclosure is approved, so a published Room
      // is proof this already happened even without a direct read of it.
      return Boolean(input.room && input.room.published);
    case "room_created":
      return input.room !== undefined && input.room !== null;
    case "publish_clicked":
      // Reached only by the same publish proof `room_published` uses — the
      // click itself is never independently observed here.
      return Boolean(input.room && input.room.published);
    case "room_published":
      return Boolean(input.room && input.room.published);
    case "first_follower_joined":
      return input.room !== undefined && input.followersTotal !== null && input.followersTotal > 0;
    default:
      return false;
  }
}

const CREATOR_PATH_CONTROL: Record<CreatorPathStepId, CreatorPathControl | null> = {
  account_created: null,
  studio_opened: null,
  first_source_uploaded: { targetTab: null, anchor: "#enrollment-workspace" },
  processing_finished: { targetTab: null, anchor: "#processing-status-feed" },
  first_preview_heard: { targetTab: "meet", anchor: null },
  readiness_first_measured: { targetTab: "meet", anchor: null },
  readiness_passed_lock: { targetTab: "meet", anchor: null },
  disclosure_approved: { targetTab: "share", anchor: null },
  room_created: { targetTab: "share", anchor: null },
  publish_clicked: { targetTab: "share", anchor: null },
  room_published: { targetTab: "share", anchor: null },
  first_follower_joined: null,
};

/** Pure. `evals/studio-path/run.mjs` calls this directly over the whole
 *  input space — no React, no fetch, no DOM. */
export function computeCreatorPath(input: CreatorPathInput): CreatorPathView {
  const confirmed = CREATOR_PATH_STEPS.map((id) => stepConfirmed(id, input));
  let lastReached = -1;
  for (let i = 0; i < confirmed.length; i++) {
    if (confirmed[i]) lastReached = i;
  }
  const steps: CreatorPathStepView[] = CREATOR_PATH_STEPS.map((id, i) => ({
    id,
    state: i <= lastReached ? "done" : i === lastReached + 1 ? "current" : "ahead",
  }));
  const publishedIndex = CREATOR_PATH_STEPS.indexOf("room_published");
  const roomPublishedReached = lastReached >= publishedIndex;
  const isPaused = Boolean(input.room && input.room.paused);
  const visible = !roomPublishedReached || isPaused;
  const currentStepId = lastReached + 1 < CREATOR_PATH_STEPS.length ? CREATOR_PATH_STEPS[lastReached + 1] : null;
  return {
    steps,
    currentStepId,
    visible,
    paused: roomPublishedReached && isPaused,
    control: currentStepId ? CREATOR_PATH_CONTROL[currentStepId] : null,
  };
}

// ── the component ───────────────────────────────────────────────────────

export function CreatorPathCard({
  input,
  onGoStep,
}: {
  input: CreatorPathInput;
  onGoStep: (step: StepId) => void;
}) {
  const { t } = useStudioLocale();
  const view = useMemo(() => computeCreatorPath(input), [input]);

  if (!view.visible) return null;

  if (view.paused) {
    return (
      <section className="creator-path creator-path-paused" aria-labelledby="creator-path-title">
        <p className="eyebrow" id="creator-path-title">{t.creatorPath.eyebrow}</p>
        <p className="creator-path-sentence">{t.creatorPath.pausedSentence}</p>
        <button
          type="button"
          className="button primary-button creator-path-primary"
          onPointerDown={() => onGoStep("deploy")}
        >
          {t.creatorPath.pausedButton}
        </button>
      </section>
    );
  }

  const currentSentence = view.currentStepId
    ? view.currentStepId === "readiness_passed_lock"
      ? withCount(t.creatorPath.currentSentence.readiness_passed_lock, CREATOR_PATH_READINESS_PART_FLOOR)
          .split("{n2}")
          .join(String(CREATOR_PATH_READINESS_OVERALL_FLOOR))
      : t.creatorPath.currentSentence[view.currentStepId]
    : null;

  return (
    <section className="creator-path" aria-labelledby="creator-path-title">
      <p className="eyebrow" id="creator-path-title">{t.creatorPath.eyebrow}</p>
      <ol className="creator-path-steps">
        {view.steps.map((row) => (
          <li key={row.id} className={`creator-path-step creator-path-step-${row.state}`}>
            <span className="creator-path-dot" aria-hidden="true" />
            <span className="creator-path-label">{t.creatorPath.stepLabel[row.id]}</span>
            <span className="creator-path-state">{t.creatorPath.stateLabel[row.state]}</span>
          </li>
        ))}
      </ol>
      {view.currentStepId && view.control && currentSentence && (
        <div className="creator-path-current">
          <p className="creator-path-sentence">{currentSentence}</p>
          <button
            type="button"
            className="button primary-button creator-path-primary"
            onPointerDown={() => {
              if (view.control!.targetTab) onGoStep(TAB_STEP_FOR_ANCHOR[view.control!.targetTab]);
              else jumpTo(view.control!.anchor!, t.creatorPath.currentButton[view.currentStepId!]);
            }}
          >
            {t.creatorPath.currentButton[view.currentStepId]}
          </button>
        </div>
      )}
    </section>
  );
}

// `studioShellModel.ts#TAB_STEP`'s own map restated: the shell's tab ids are
// not `wizardModel.ts#StepId` values one to one ("share" is "deploy" under
// the hood). A type-only import of `TabId` keeps this file free of a React
// import cycle back through `studioShellModel.ts`, so the literal map is
// restated here rather than imported — three entries, unlikely to drift,
// and `evals/studio-path/run.mjs` asserts it agrees with the real
// `TAB_STEP` export.
export const TAB_STEP_FOR_ANCHOR: Record<TabId, StepId> = { feed: "feed", meet: "meet", share: "deploy" };
