// DeployStudio.tsx — WS-R152. Deploy for a personal AI.
//
// The creator studio already built the whole Deploy surface: `RoomStudio.tsx`
// (the Room's address, its QR, its poster, its Telegram join, its own-site
// embed snippet — and, mounted INSIDE it, `ShareKitCard.tsx`'s WhatsApp/
// Instagram/YouTube/Telegram text kit). A person who built a voice should
// reach the SAME screen in one tap, not a second, thinner implementation of
// it — the brief's own law 2. So this file mounts `RoomStudio`, lazily,
// through its existing props, exactly as `src/creatorStudio/StudioApp.tsx`
// already does for a teacher. NOTHING here forks or copies its markup.
//
// WHAT IS ACTUALLY NEW HERE
// ---------------------------------------------------------------------------
// 1. A readiness banner named in the PERSON's own words, above `RoomStudio`.
//    `RoomStudio` already renders its own "waiting on you / waiting on us"
//    list (`api/_room-publish.js`'s own blocker codes), which stays exactly
//    as it is — this banner is additive, not a rewrite of that list, and it
//    is deliberately the only new copy this file introduces
//    (`deployStudioState.ts` carries the mapping and its own reversal
//    condition).
// 2. `onGoStep`, translated. `RoomStudio`'s blocker rows can ask to jump to
//    step "meet" (`BLOCKER_STEP` in RoomStudio.tsx) — this screen has no
//    "meet" step of its own, so the translation is simply "go back to the
//    same review `onReview` already opens", the exact place the person's own
//    voice/consent review already lives (`CloneExperience.tsx`'s
//    `chooseRoom("evolve")`). Until R151 (HumanOS) ships its own screen, this
//    IS "publish who you are first"'s fix, named honestly rather than
//    pointing at a screen that does not exist yet.
// 3. "See it as a visitor" — opens the real `/r/<slug>` in a new tab. Nothing
//    is simulated: `deployVisitorLink` returns `null` (no button at all)
//    until the Room is actually published, `deployStudioState.ts`'s own
//    negative control.
//
// WHY A NEW STYLESHEET RATHER THAN THE VOICE/CALL PANELS' `expert-
// experience.css` (what the screen this replaces borrowed): that file is
// only ever loaded as a side effect of `ExpertConversation.tsx`/
// `ExpertEntryVisual.tsx` mounting earlier in the SAME session — a person who
// lands on Deploy without visiting Meet first would get unstyled text. This
// file imports its own CSS the way `PrivateTextRehearsal.tsx` does, so it
// never depends on a sibling panel's load order.
import { lazy, Suspense, useCallback, useState } from "react";
import type { StepId } from "../creatorStudio/wizardModel";
import type { OwnedRoom } from "../creatorStudio/roomPublishApi";
import { StudioLocaleProvider } from "../creatorStudio/localeContext";
import type { StudioLocale } from "../creatorStudio/studioLocalePreference";
import { expertWorkspaceUrl } from "./workspaceNavigation";
import { deployBannerState, deployVisitorLink, shouldReviewForStep } from "./deployStudioState";
import "./deploy-studio.css";

const RoomStudio = lazy(() => import("../creatorStudio/RoomStudio"));

interface DeployCopy {
  title: string;
  intro: string;
  voiceLabel: string;
  voiceBody: string;
  voiceAction: string;
  publishLabel: string;
  publishBody: string;
  publishAction: string;
  readyLabel: string;
  readyBody: string;
  visitorLink: string;
  loading: string;
}

// The personal studio's own registry pattern (`CloneExperience.tsx`'s
// `feedCopy`, read straight off `?lang=`) rather than the creator studio's
// lazy-loaded chunk split: this screen's own new strings are ~12 short
// lines, far under the size that split exists to solve
// (`localeContext.tsx`'s own header). `?lang=hi` still drives `RoomStudio`'s
// OWN full Hindi table underneath, through `StudioLocaleProvider` below.
const DEPLOY_COPY: Record<StudioLocale, DeployCopy> = {
  en: {
    title: "Deploy your AI.",
    intro: "Open a Room when it is ready.",
    voiceLabel: "Voice not verified yet.",
    voiceBody: "Finish verifying your voice before anyone can talk with your AI.",
    voiceAction: "Check my voice",
    publishLabel: "Add your profile first.",
    publishBody: "Review and publish the details people should see before you open your Room.",
    publishAction: "Review profile",
    readyLabel: "Ready to open.",
    readyBody: "Your Room is set up. Publish it below, then share it wherever your people already are.",
    visitorLink: "See it as a visitor",
    loading: "Opening deploy",
  },
  hi: {
    title: "अपने AI को लोगों तक पहुँचाएँ।",
    intro: "तैयार होने पर अपना Room खोलें।",
    voiceLabel: "आवाज़ अभी सत्यापित नहीं है।",
    voiceBody: "किसी के आपके AI से बात करने से पहले अपनी आवाज़ की पुष्टि पूरी करें।",
    voiceAction: "अपनी आवाज़ जाँचें",
    publishLabel: "पहले अपनी प्रोफ़ाइल जोड़ें।",
    publishBody: "अपना Room खोलने से पहले वह जानकारी देखें और प्रकाशित करें जो लोग देखेंगे।",
    publishAction: "प्रोफ़ाइल देखें",
    readyLabel: "खोलने के लिए तैयार।",
    readyBody: "आपका Room तैयार है। इसे नीचे प्रकाशित करें, फिर वहाँ साझा करें जहाँ आपके लोग पहले से मौजूद हैं।",
    visitorLink: "एक विज़िटर के रूप में देखें",
    loading: "खोला जा रहा है",
  },
};

function readDeployLocale(search: string): StudioLocale {
  return new URLSearchParams(search).get("lang") === "hi" ? "hi" : "en";
}

export default function DeployStudio({
  token,
  replicaId,
  stopped,
  onAuthError,
  onReview,
}: {
  token: string;
  replicaId: string;
  stopped: boolean;
  onAuthError: (cause: unknown) => void;
  onReview: () => void;
}) {
  const locale = readDeployLocale(window.location.search);
  const t = DEPLOY_COPY[locale];
  const [room, setRoom] = useState<OwnedRoom | null>(null);
  const [roomChecked, setRoomChecked] = useState(false);

  // Fed by `RoomStudio`'s own `onRoomState` — `ShareKitCard.tsx`'s own "fed
  // up, never fetched twice" law restated: this screen never makes its own
  // `/api/room-publish` read.
  const handleRoomState = useCallback((nextRoom: OwnedRoom | null) => {
    setRoom(nextRoom);
    setRoomChecked(true);
  }, []);

  // `RoomStudio`'s blocker rows can ask for step "meet" or "deploy"
  // (`BLOCKER_STEP` in RoomStudio.tsx); "deploy" is this screen itself, so
  // only "meet" ever needs a translation, into the review this screen's own
  // "Publish who you are first" banner already points at.
  const handleGoStep = useCallback((next: StepId) => {
    if (shouldReviewForStep(next)) onReview();
  }, [onReview]);

  const banner = deployBannerState({ stopped, publishedRoom: Boolean(room?.published) });
  const visitorLink = roomChecked ? deployVisitorLink(room, window.location.origin) : null;

  return (
    // `lang={locale}`, not a `document.documentElement.lang` effect
    // (`src/creatorStudio/StudioApp.tsx`'s own mechanism, which sets it for
    // its WHOLE document because that file mounts the whole teacher page):
    // this screen is one room inside the personal studio's shell
    // (`studio.html`'s static `lang="en"`), and the rest of that shell has no
    // Hindi of its own yet ("the personal studio is English-only",
    // `context/STATE.md`), so tagging only this subtree is the honest scope
    // rather than relabeling a page most of which is still English. Covers
    // BOTH this component's own strings and `RoomStudio`'s Hindi text
    // underneath, since `lang` cascades to every descendant --
    // `scripts/check-accessibility.mjs`'s `lang-devanagari-untagged` finding
    // on the untagged tree, fixed here rather than suppressed.
    <section className="vx-deploy" aria-labelledby="deploy-title" lang={locale}>
      <div className="vx-stage-title">
        <h1 id="deploy-title">{t.title}</h1>
        <p>{t.intro}</p>
      </div>

      <div className={`vx-deploy-banner vx-deploy-banner--${banner}`} role="status">
        {banner === "voice" && (
          <>
            <p className="vx-deploy-banner__headline">{t.voiceLabel}</p>
            <p className="field-note">{t.voiceBody}</p>
            <a className="button secondary-button" href={expertWorkspaceUrl(replicaId, "voice", window.location.search)}>
              {t.voiceAction}
            </a>
          </>
        )}
        {banner === "publish" && (
          <>
            <p className="vx-deploy-banner__headline">{t.publishLabel}</p>
            <p className="field-note">{t.publishBody}</p>
            <button type="button" className="button secondary-button" onPointerDown={onReview}>
              {t.publishAction}
            </button>
          </>
        )}
        {banner === "ready" && (
          <>
            <p className="vx-deploy-banner__headline">{t.readyLabel}</p>
            <p className="field-note">{t.readyBody}</p>
          </>
        )}
      </div>

      <StudioLocaleProvider locale={locale}>
        <Suspense fallback={<p role="status" className="field-note">{t.loading}</p>}>
          <RoomStudio
            token={token}
            replicaId={replicaId}
            onAuthError={onAuthError}
            onGoStep={handleGoStep}
            onRoomState={handleRoomState}
          />
        </Suspense>
      </StudioLocaleProvider>

      {visitorLink && (
        <a className="button secondary-button vx-deploy-visitor" href={visitorLink} target="_blank" rel="noreferrer">
          {t.visitorLink}
        </a>
      )}
    </section>
  );
}
