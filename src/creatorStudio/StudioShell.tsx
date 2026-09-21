// StudioShell.tsx — WS-R31. The studio collapsed to three words: Feed, Meet,
// Share.
//
// THE PROBLEM THIS FIXES. The studio is an instrument bench: thirty-odd
// panels, a wizard rail, a quick-start path. The plan's own promise is a Room
// in minutes; WS-R25's funnel is what proves whether that promise holds.
// Nothing below the top of the studio changes here. What changes is the top:
// three tabs a creator can hold in their head, each with one honest sentence
// and one control, standing in front of the exact panels that already exist.
//
// LAW 1 (nothing is deleted, no gate moves). This component does not fork
// `ReplicaWorkspace`, does not re-mount its panels a second time, and does
// not recompute a blocker `wizardModel.ts` already computed. It renders the
// SAME `ReplicaWorkspace` the old rail renders, with the SAME `step` prop
// (this shell's tabs are the wizard's existing "feed" / "meet" / "deploy"
// step ids under new names, `studioShellModel.ts`'s `TAB_STEP`), so every
// panel, every API call and every blocker keeps its existing component and
// its existing semantics by construction, not by care. The old rail stays
// one link away ("All panels", `onShowAllPanels`), which `StudioApp.tsx`
// wires to a plain view toggle, not a rebuild.
//
// LAW 2 (one honest headline per tab, from real reads). Feed reads
// `sources.length` and `wizardInput.platformWork`, both already fetched by
// `StudioApp.tsx` regardless of which tab is open. Meet and Share depend on
// panels that only mount while their tab is open (`ReadinessPanel`,
// `MirrorCallStudio`'s interview preview, `RoomStudio`), so this shell tracks
// whether each has EVER reported in this visit and says "not checked yet"
// rather than fabricating an empty state before it has looked
// (`studioShellModel.ts`'s `undefined`-means-unchecked convention).
//
// LAW 3 (one primary control). `studioShellModel.headlineForTab()` returns at
// most one `PrimaryControl`, and Feed/Meet's are built from
// `wizard.steps[i].top` — the exact "next thing" `computeWizard()` already
// derives, whose blocker vocabulary its own header says is "inherited
// verbatim" from `QuickStartPath.tsx`'s `BLOCKER_META`. Routing through `top`
// rather than re-deriving a second lookup from raw blocker codes is the SAME
// fact read once (`context/rejected.md#a-panel-hardcoding-its-own-blocker-class-will-drift-from-the-rail`).
// `BLOCKER_META` itself is imported directly below (never copied) for the one
// thing `top` does not carry: the Meet tab's "still locked, and who it is
// waiting on" breakdown, the one part of the retired `QuickStartPath` screen
// this workstream re-homes here.
import { useEffect, useState, type ComponentProps } from "react";
import { ReplicaWorkspace } from "./StudioApp";
import { BLOCKER_META } from "./QuickStartPath";
import { CreatorPathCard, type CreatorPathInput } from "./CreatorPath";
import VideoLinkMount from "./VideoLinkMount";
import { Band, jumpTo } from "./WizardRail";
import { roomLink } from "./roomPublishApi";
import type { Readiness } from "./readinessApi";
import type { InterviewPreview } from "./mirrorCallApi";
import type { OwnedRoom, RoomStats } from "./roomPublishApi";
import type { StepId } from "./wizardModel";
import {
  TAB_ORDER,
  TAB_STEP,
  headlineForTab,
  type TabId,
  type HeadlineInputs,
  type PrimaryControl,
} from "./studioShellModel";
import { STUDIO_LANGUAGE_LABELS, STUDIO_LOCALES, withCount, type StudioLocale } from "./copy";
import { useStudioLocale } from "./localeContext";
import "./studio-shell.css";

/**
 * WS-R52. "A language control in the same place the Room has one" -- the
 * brief's own words, and `RoomApp.tsx`'s `LanguageSwitch` is exactly the
 * shape reused here: both words shown, always, in both locales (see
 * copy.ts's `STUDIO_LANGUAGE_LABELS` for why), the current locale reading
 * as pressed (`aria-pressed`) rather than disabled so a screen reader still
 * announces it as the state it is.
 */
function StudioLanguageSwitch({
  locale,
  busy,
  onSwitch,
}: {
  locale: StudioLocale;
  busy: boolean;
  onSwitch: (next: StudioLocale) => void;
}) {
  const { t } = useStudioLocale();
  return (
    <div className="studio-lang-switch" role="group" aria-label={t.shell.languageGroupLabel}>
      {STUDIO_LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          className="studio-lang-btn"
          // WS-R79: same reason `RoomApp.tsx`'s own `LanguageSwitch` gets
          // this — both labels are always shown, side by side, in every
          // locale, so the OTHER one needs its own `lang`.
          lang={l}
          aria-pressed={locale === l}
          disabled={busy}
          onClick={() => onSwitch(l)}
        >
          {STUDIO_LANGUAGE_LABELS[l]}
        </button>
      ))}
    </div>
  );
}

type WorkspaceProps = ComponentProps<typeof ReplicaWorkspace>;

function tabForStep(step: StepId): TabId {
  return step === "deploy" ? "share" : step;
}

/** The "still locked, and who it is waiting on" list, re-homed from
 *  `QuickStartPath` onto the Meet tab. Same mapping, same two columns, the
 *  one difference being the source of the codes: the runtime's own
 *  `blockers` array, already fetched by `StudioApp.tsx`. */
function StillLocked({ blockers }: { blockers: readonly string[] }) {
  const { t } = useStudioLocale();
  const known = blockers.filter((code) => BLOCKER_META[code]);
  if (known.length === 0) return null;
  const yours = known.filter((code) => BLOCKER_META[code].owner === "you");
  const platform = known.filter((code) => BLOCKER_META[code].owner === "platform");
  return (
    <details className="studio-shell-locked" open={yours.length > 0}>
      <summary>
        <strong>{t.shell.stillLockedTitle}</strong>
        <span>
          {yours.length > 0 && withCount(t.shell.forYou, yours.length)}
          {yours.length > 0 && platform.length > 0 && ", "}
          {platform.length > 0 && withCount(t.shell.onUsCount, platform.length)}
        </span>
      </summary>
      <div className="studio-shell-locked-columns">
        {yours.length > 0 && (
          <div>
            <p className="studio-shell-locked-owner">{t.classLabels.you}</p>
            <ul>
              {yours.map((code) => (
                <li key={code}>
                  {/* BLOCKER_META's label/note stay English -- honesty-gated
                      prose, copy.ts's own header names the reason. */}
                  <span>{BLOCKER_META[code].label}</span>
                  <small>{BLOCKER_META[code].note}</small>
                  <button type="button" className="text-button" onPointerDown={() => jumpTo(BLOCKER_META[code].anchor, BLOCKER_META[code].label)}>
                    {t.wizardRail.goThere}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {platform.length > 0 && (
          <div>
            <p className="studio-shell-locked-owner">{t.classLabels.us}</p>
            <ul>
              {platform.map((code) => (
                <li key={code}>
                  <span>{BLOCKER_META[code].label}</span>
                  <small>{BLOCKER_META[code].note}</small>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

export default function StudioShell(
  props: WorkspaceProps & {
    /** Switches `StudioApp.tsx` back to the old rail + full panel list, the
     *  "All panels" link Law 1 requires. Never a rebuild, never a flag. */
    onShowAllPanels: () => void;
    /** WS-R52. The creator's own chrome locale and the control that changes
     *  it, threaded here rather than into `WorkspaceProps` at large --
     *  `StudioApp.tsx` owns the read/write (`replica.locale`,
     *  `setReplicaLocale`), and only the shell renders the switch, in the
     *  same place `RoomApp.tsx` renders the Room's own. */
    locale: StudioLocale;
    localeBusy: boolean;
    onSwitchLocale: (next: StudioLocale) => void;
  },
) {
  const { replica, mode, wizard, wizardInput, sources, step, onGoStep, compact, testEnvironment, runtimeStatus, onShowAllPanels, locale, localeBusy, onSwitchLocale } = props;
  const { t } = useStudioLocale();

  // `undefined` = not opened this visit yet (see the file header and
  // `studioShellModel.ts`'s own doc comment on why that is a different fact
  // from "opened, and empty"). Reset on a replica switch: the previous
  // workspace's readiness is not this one's.
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [readinessChecked, setReadinessChecked] = useState(false);
  const [interviewPreview, setInterviewPreview] = useState<InterviewPreview | null | undefined>(undefined);
  const [room, setRoom] = useState<OwnedRoom | null>(null);
  const [roomStats, setRoomStats] = useState<RoomStats | null>(null);
  const [roomBlocker, setRoomBlocker] = useState<PrimaryControl | null>(null);
  const [roomChecked, setRoomChecked] = useState(false);

  useEffect(() => {
    setReadiness(null);
    setReadinessChecked(false);
    setInterviewPreview(undefined);
    setRoom(null);
    setRoomStats(null);
    setRoomBlocker(null);
    setRoomChecked(false);
  }, [replica.replica_id]);

  const activeTab = tabForStep(step);

  const topFor = (id: StepId) => wizard.steps.find((row) => row.id === id)?.top ?? null;

  const inputs: HeadlineInputs = {
    feed: {
      sourceCount: sources.length,
      platformWork: wizardInput.platformWork,
      top: topFor("feed"),
    },
    meet: {
      readiness: !readinessChecked
        ? undefined
        : readiness
          ? {
            overall: readiness.overall,
            weakestLabel: readiness.parts.find((part) => part.id === readiness.weakest_part)?.label ?? null,
            publishLocked: readiness.publish_locked,
            suggestedAction: readiness.suggested_action
              ? { label: readiness.suggested_action.label, anchor: readiness.suggested_action.anchor }
              : null,
          }
          : null,
      interviewNextTopic: interviewPreview && interviewPreview.gaps.length > 0 ? interviewPreview.gaps[0].topic : null,
      top: topFor("meet"),
    },
    share: {
      mode,
      runtimeActive: Boolean(runtimeStatus?.active),
      room: mode === "teacher" ? (roomChecked ? room && { published: room.published, paused: room.paused, slug: room.slug } : undefined) : null,
      followersTotal: roomStats ? roomStats.followers_total : null,
      link: room ? roomLink(room.slug) : null,
      roomBlocker,
      top: topFor("deploy"),
    },
  };

  const active = headlineForTab(activeTab, inputs);

  // WS-R65. Built from the SAME reads `inputs` above already assembles —
  // no fetch of its own (`CreatorPath.tsx`'s own header names why a new
  // endpoint was rejected). Only meaningful in teacher mode: a generic
  // (self) replica has no Room at all, so `inputs.share.room` is always
  // `null` there and the card would have nothing past "we finish
  // processing it" to ever show.
  const creatorPathInput: CreatorPathInput = {
    accountCreatedAt: replica.created_at,
    sourceCount: inputs.feed.sourceCount,
    platformWork: inputs.feed.platformWork,
    readiness: inputs.meet.readiness,
    room: inputs.share.room,
    followersTotal: inputs.share.followersTotal,
  };

  return (
    <div className="studio-tabshell">
      <StudioLanguageSwitch locale={locale} busy={localeBusy} onSwitch={onSwitchLocale} />

      <nav className="studio-tabbar" aria-label={t.shell.tabsAriaLabel}>
        {TAB_ORDER.map((tab) => {
          const headline = headlineForTab(tab, inputs);
          const isCurrent = tab === activeTab;
          return (
            <button
              key={tab}
              type="button"
              className={`studio-tab studio-tab-${headline.state} ${isCurrent ? "current" : ""}`}
              aria-current={isCurrent ? "step" : undefined}
              onClick={() => onGoStep(TAB_STEP[tab])}
            >
              <span className="studio-tab-title">{t.shell.tabTitle[tab]}</span>
              <span className="studio-tab-dot" aria-hidden="true" />
              <span className="studio-tab-sentence">{headline.sentence}</span>
            </button>
          );
        })}
      </nav>

      <section className="studio-shell-headline" aria-live="polite" aria-labelledby="studio-shell-headline-title">
        <p className="eyebrow" id="studio-shell-headline-title">{t.shell.tabTitle[activeTab]}</p>
        <p className="studio-shell-promise">{t.shell.tabPromise[activeTab]}</p>
        <p className={`studio-shell-sentence studio-shell-sentence-${active.state}`}>{active.sentence}</p>
        {active.primary && (
          <button
            type="button"
            className={`button primary-button studio-shell-primary studio-shell-primary-${active.primary.cls}`}
            onPointerDown={() => jumpTo(active.primary!.anchor, active.primary!.label)}
          >
            {active.primary.label}
          </button>
        )}
      </section>

      {activeTab === "feed" && mode === "teacher" && (
        <CreatorPathCard input={creatorPathInput} onGoStep={onGoStep} />
      )}

      {activeTab === "meet" && !testEnvironment && runtimeStatus && (
        <StillLocked blockers={runtimeStatus.blockers} />
      )}

      {activeTab === "feed" && (
        <Band
          collapsible={compact}
          defaultOpen={false}
          title={t.shell.oneVideoTitle}
          blurb={t.shell.oneVideoBlurb}
        >
          <VideoLinkMount />
        </Band>
      )}

      <ReplicaWorkspace
        {...props}
        onReadiness={(next) => { setReadiness(next); setReadinessChecked(true); }}
        onInterviewPreview={setInterviewPreview}
        onRoomState={(nextRoom, stats, blocker) => {
          setRoom(nextRoom);
          setRoomStats(stats);
          setRoomBlocker(blocker);
          setRoomChecked(true);
        }}
      />

      <button type="button" className="text-button studio-all-panels-link" onClick={onShowAllPanels}>
        {t.shell.allPanelsLink}
      </button>
    </div>
  );
}
