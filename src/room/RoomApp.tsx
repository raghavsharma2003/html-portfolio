/* THE ROOM — a follower's side of a creator's AI, at /r/<slug>.
 *
 * The one screen this product is judged on. A person taps a link in a bio and
 * is in a conversation; everything below exists to make that sentence true on a
 * 390px phone with one thumb.
 *
 * ── WHAT IT OWNS AND WHAT IT DOES NOT ────────────────────────────────────
 *
 * It owns rendering and nothing else. Every rule about who may say what, what
 * is remembered, what the cap is and what the disclosure says lives in
 * `api/_room-surface.js`, where the offline suite can reach it. In particular:
 *
 *   THE DISCLOSURE CARD IS NOT WRITTEN HERE. It arrives as data from `open`,
 *   in the app's voice, and the session token carries its digest — so a fork
 *   of this file that deleted the render below could not buy a turn. That is
 *   deliberate and it is `structural-disclosure`: a card that depends on a
 *   client rendering it is a preference, not a guarantee.
 *
 *   THE CAP IS NOT COUNTED HERE. `quota` comes back on every turn and the
 *   twenty-first message is refused by a SQL predicate. This file renders a
 *   number it was told; it never decides one.
 *
 * ── THE UPGRADE MOMENT ───────────────────────────────────────────────────
 *
 * `upgrade_prompt` is a flag on a turn that WORKED, and it renders as a line
 * under the last reply. It never interrupts, never blocks a send, and never
 * appears mid-sentence. The only moment a message does not happen is the cap
 * itself, which is a state with its own screen. NEVER MANIPULATE is the floor
 * and manufactured urgency is the named failure.
 *
 * ── MOTION ───────────────────────────────────────────────────────────────
 *
 * Transform and opacity only, feedback on press, everything under 300ms, and a
 * reduced-motion branch in room.css. A new bubble rises 6px; nothing else
 * moves, because a conversation that animates is a conversation you are
 * watching rather than having.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StudioSession } from "../studio/types";
import { readStoredSession, restoreSession, writeStoredSession } from "../studio/session";
import { googleSignIn, sendPhoneOtp, verifyPhoneOtp } from "../studio/studioAuth";
import {
  ROOM_COPY_TABLE,
  ROOM_LANGUAGE_LABELS,
  ROOM_LOCALES,
  normalizeLocale,
  withName,
  withPrice,
  withRetry,
  type RoomCopy,
  type RoomLocale,
} from "./copy";
import CheckinsPanel from "./CheckinsPanel";
import SubscriptionPanel from "./SubscriptionPanel";
import HandoffPanel from "./HandoffPanel";
import AccountPage from "./AccountPage";
import { useDialogInView } from "./useDialogInView";
import { Localized, LocalizedName, LocalizedDisclosure } from "./Localized";
import {
  RoomApiError,
  dismissOffer,
  exportRoomData,
  flagReply,
  followerFlags,
  forgetRoomData,
  joinRoom,
  newRoomThread,
  openRoom,
  replySha256,
  roomCitations,
  roomHistory,
  roomSettings as fetchRoomSettings,
  roomStats,
  revokePulseOptIn,
  sayInRoom,
  setPulseOptIn,
  setRoomLocale,
  speakInRoom,
  slugFromPath,
  tasteInRoom,
  unflagReply,
  viaFromLocation,
  refFromLocation,
  type RoomCitations,
  type RoomFlagReason,
  type RoomFollower,
  type RoomForgetReceipt,
  type RoomOffer,
  type RoomOpen,
  type RoomQuota,
  type RoomSettings,
  type RoomTasteTurn,
  type RoomThread,
} from "./roomApi";
import { RoomPayApiError, startSubscription, type RoomPaymentStatus } from "./roomPayApi";
import { noteInstallVisit, markInstallDismissed, shouldShowInstallCard } from "./installPrompt";

type Turn = { role: "user" | "assistant"; content: string; fresh?: boolean };
/** The one shape this file needs off a captured `beforeinstallprompt` event
 *  (WS-R59) — typed loosely rather than importing a DOM lib type, since none
 *  ships with this project's `lib` and every browser that fires the real
 *  event satisfies this shape regardless. */
type InstallPromptEvent = {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
// "offline" (WS-R59) is distinct from "unavailable": the initial open failed
// because the BROWSER itself reports no connection, never because a Room's
// own status is in question — see `copy.offline`'s own comment for why the
// two must never share one message.
type Phase = "loading" | "unavailable" | "join" | "talking" | "gone" | "offline";

/** WS-R50 (WCAG 2.1.1, keyboard). A handful of controls in this file fire
 *  their action on `onPointerDown` rather than `onClick` — DESIGN-LAW's own
 *  "feedback on pointerdown" law, taken further than it asked: pointerdown
 *  fires the whole action here, not just the press feedback `:active` in
 *  `room.css` already gives for free. A native `<button>` only turns
 *  Enter/Space into a synthetic CLICK, never a pointer event, so every one
 *  of those controls was unreachable from a keyboard — measured on the
 *  pulse toggle, true of every button built the same way. This does not
 *  touch the pointerdown behaviour (still fires first, still fast); it adds
 *  the missing other half so Enter and Space reach the same action. */
export const activateOnKey = (fn: () => void) => (e: React.KeyboardEvent) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  fn();
};

/** WS-R19: the play control never renders for a free follower, whatever this
 *  says - `import.meta.env.VITE_ROOM_VOICE` only decides whether the FLAG
 *  itself is on for this deployment. `voiceIdentityChallengeUiEnabled`'s own
 *  shape, one flag over: a stray non-"1" value (empty, "0", "false") reads as
 *  off rather than throwing. */
export const ROOM_VOICE_UI = String(import.meta.env.VITE_ROOM_VOICE ?? "") === "1";

interface Props {
  /** The layout fixture passes both so the gate can see the signed-in screens
   *  without a secret. Production passes neither. */
  fixtureOpen?: RoomOpen;
  fixtureTurns?: Turn[];
  /** WS-R39: `?screen=account` opens the account page immediately, with its
   *  own composed read supplied rather than fetched — the layout gate has no
   *  network at all, `AccountPage.tsx`'s own `fixtureSettings` seam. */
  fixtureAccountOpen?: boolean;
  fixtureSettings?: RoomSettings;
  fixturePayment?: RoomPaymentStatus;
  /** WS-R86 (migration 123). `AccountPage.tsx`'s own `fixtureReferralUrl`
   *  seam, threaded through here exactly as `fixtureSettings` already is. */
  fixtureReferralUrl?: string;
  /** WS-R43. The Room's own layout battery: three screens no fixture reached
   *  before ("Hindi glyphs unverified" since WS-R24 — no session had ever
   *  rendered the cap-reached card, the forget receipt, or either dialog in a
   *  real browser). Same seam as every fixture prop above: state supplied
   *  directly, no network, no real forget/cap flow run. */
  fixtureCapped?: boolean;
  fixtureCapOffer?: RoomOffer | null;
  fixturePhase?: Phase;
  fixtureForgetReceipt?: RoomForgetReceipt | null;
  fixtureCheckinsOpen?: boolean;
  fixtureHandoffOpen?: boolean;
  /** WS-R59. Forces the install card visible, bypassing the real-world gate
   *  (`installPrompt.ts`'s `shouldShowInstallCard`) entirely — the layout
   *  fixture has no `beforeinstallprompt` event, no `localStorage` visit
   *  count, and no real sign-in to drive that gate with.
   *  `?ios=1` alongside it renders the iOS "Add to Home Screen" hint variant
   *  instead of the working button, so both variants are reachable by the
   *  same layout-gate target this one prop adds. */
  fixtureInstallPrompt?: boolean;
  fixtureInstallPromptIOS?: boolean;
  /** WS-R53. `?screen=join` must still measure the JOIN sheet on its own
   *  (the layout gate's existing target) rather than the taste screen that
   *  now sits in front of it for a real, signed-out visitor — this forces
   *  the taste screen already dismissed, `layoutFixture.tsx`'s own seam for
   *  every other screen that sits behind an earlier one. Production never
   *  passes it; a real visitor always sees the taste screen first when the
   *  creator has not switched it off. */
  fixtureTasteDismissed?: boolean;
  /** WS-R84. The accessibility gate's own language walk needs to exercise a
   *  REAL locale switch (a real click on `LanguageSwitch`, through the real
   *  `switchLocale`) so it can prove the resulting DOM, not a hand-built
   *  stand-in for it — every other fixture prop on this component supplies
   *  DATA and leaves the app's own logic untouched, and this one scenario is
   *  the one exception, narrowly scoped to exactly this flag rather than
   *  loosening `switchLocale`'s own `fixtureOpen` guard for every screen.
   *  `layoutFixture.tsx`'s fetch stub answers `op: "locale"` for exactly this
   *  case; production code never sets this prop, so nothing here changes for
   *  a real follower. */
  fixtureLiveLocaleSwitch?: boolean;
}

export default function RoomApp({
  fixtureOpen,
  fixtureTurns,
  fixtureAccountOpen,
  fixtureSettings,
  fixturePayment,
  fixtureReferralUrl,
  fixtureCapped,
  fixtureCapOffer,
  fixturePhase,
  fixtureForgetReceipt,
  fixtureCheckinsOpen,
  fixtureHandoffOpen,
  fixtureInstallPrompt,
  fixtureInstallPromptIOS,
  fixtureTasteDismissed,
  fixtureLiveLocaleSwitch,
}: Props) {
  const slug = useMemo(() => (fixtureOpen ? fixtureOpen.room.slug : slugFromPath()), [fixtureOpen]);
  const [phase, setPhase] = useState<Phase>(
    fixturePhase ?? (fixtureOpen ? (fixtureOpen.joined ? "talking" : "join") : "loading"),
  );
  const [room, setRoom] = useState<RoomOpen | null>(fixtureOpen ?? null);
  // WS-R53. Once true, the "join" phase renders JoinSheet directly rather
  // than TasteScreen — either because a stranger tapped its own join
  // control, or because the fixture forced it (see Props above).
  const [tasteDismissed, setTasteDismissed] = useState(fixtureTasteDismissed ?? false);
  const [auth, setAuth] = useState<StudioSession | null>(null);
  const [session, setSession] = useState<string | null>(fixtureOpen?.session ?? null);
  const [turns, setTurns] = useState<Turn[]>(fixtureTurns ?? []);
  const [threads, setThreads] = useState<RoomThread[]>(fixtureOpen?.threads ?? []);
  const [thread, setThread] = useState<string | null>(null);
  const [quota, setQuota] = useState<RoomQuota | null>(null);
  const [upgrade, setUpgrade] = useState(false);
  const [capped, setCapped] = useState(fixtureCapped ?? false);
  // WS-R30 (migration 093). Independent of `upgrade` above: that flag is a
  // fact about the quota (few messages left this month), this one is a fact
  // about the session that just happened. Both can be true on the same turn;
  // both render, never one hiding the other.
  const [offerCard, setOfferCard] = useState<RoomOffer | null>(null);
  const [talkedToday, setTalkedToday] = useState<number | null>(null);
  // WS-R27: the forget receipt, shown once on the "gone" screen and nowhere
  // else - there is nothing to look it up by later (law 3), so this is the
  // only copy this session will ever hold.
  const [forgetReceipt, setForgetReceipt] = useState<RoomForgetReceipt | null>(fixtureForgetReceipt ?? null);
  // "Let this count" (WS-R17), per scope (a thread id, or "" for the whole
  // Room). Local-only, optimistic on a successful toggle: the server never
  // told this client whether an old opt-in already existed for a scope, and
  // asking it to would mean an extra fetch on every screen load for a state
  // that starts OFF for everyone by construction (opt-IN, never opt-out).
  const [pulseOn, setPulseOn] = useState<Record<string, boolean>>({});
  const [pulseBusy, setPulseBusy] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [cite, setCite] = useState<RoomCitations | null>(null);
  // WS-R67 (migration 116). Which bubble's sheet is open (an index into
  // `turns`, never a second copy of the reply text), which replies are
  // already flagged this session (by hash, so the control can read
  // "flagged" rather than offer to flag the same reply twice - the server's
  // own unique index is the real guarantee; this is only the UI reading it
  // back before a click can hit it), and whether a flag is in flight.
  const [flagSheetFor, setFlagSheetFor] = useState<number | null>(null);
  const [flaggedHashes, setFlaggedHashes] = useState<Set<string>>(new Set());
  // Turn index -> that turn's own reply_sha256, computed once per turn (the
  // Web Crypto digest is async; the bubble list itself renders
  // synchronously) so the "already flagged" state can be read at render
  // time rather than only discovered on submit.
  const [turnHashes, setTurnHashes] = useState<Record<number, string>>({});
  const [flagBusy, setFlagBusy] = useState(false);
  const [flagNotice, setFlagNotice] = useState("");
  const [menu, setMenu] = useState(false);
  const [checkinsOpen, setCheckinsOpen] = useState(fixtureCheckinsOpen ?? false);
  // WS-R37: the follower's own subscription panel - shown whenever there is
  // a paid tier to manage, `canCheckin`'s own gate one line below minus the
  // memory requirement (managing a subscription needs no standing memory
  // consent).
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(fixtureHandoffOpen ?? false);
  // WS-R39: the follower's own page, and the memory-consent toggle that lives
  // there. `memoryBusy` is its own flag rather than reusing `localeBusy` —
  // the two writes go through different ops (`join` versus `roomSetLocale`)
  // and a follower could in principle tap both in close succession.
  const [accountOpen, setAccountOpen] = useState(fixtureAccountOpen ?? false);
  const [memoryBusy, setMemoryBusy] = useState(false);
  // WS-R30's cap-reached offer card. Independent of `offerCard` above (that
  // one is `session_worked`, delivered on a turn that WORKED): this is
  // fetched only after a `room_free_cap_reached` refusal, and only rendered
  // when the server confirms an offer was actually recorded — the workstream
  // brief's own law ("renders only when both the refusal and the offer row
  // exist").
  const [capOffer, setCapOffer] = useState<RoomOffer | null>(fixtureCapOffer ?? null);
  // WS-R59: the install card's own state. `installEvent` is the captured
  // `beforeinstallprompt` (typed loosely — no such DOM type ships with this
  // project's `lib`), null on every browser that never fires one, iOS
  // included by design (`installPrompt.ts`'s own comment). `installReady`/
  // `installDismissed` come from `noteInstallVisit` below, off THIS slug's
  // own `localStorage` keys — never a guess, never re-derived here.
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [installReady, setInstallReady] = useState(false);
  const [installDismissed, setInstallDismissed] = useState(false);
  const foot = useRef<HTMLDivElement | null>(null);
  // WS-R50: whether the scroll-to-bottom effect below has already run once.
  // See that effect's own comment for why this exists.
  const scrolledOnce = useRef(false);
  // WS-R19: which bubble is being fetched/played, and the one <audio> both
  // share (one clip at a time - a second tap stops the first rather than
  // layering two voices).
  const [voiceBusy, setVoiceBusy] = useState<number | null>(null);
  const [voicePlaying, setVoicePlaying] = useState<number | null>(null);
  const audioEl = useRef<HTMLAudioElement | null>(null);
  // WS-R24: the follower's own chrome language. `room.locale` is the server's
  // answer (the follower row once joined, the browser hint before that, the
  // creator's own default when the browser gave nothing) - never guessed here
  // a second time. `copy` is the ONE lookup every string in this file reads
  // through from here down; nothing below picks a locale for itself.
  const locale: RoomLocale = room?.locale ?? "en";
  const copy: RoomCopy = ROOM_COPY_TABLE[locale];
  const [localeBusy, setLocaleBusy] = useState(false);

  const name = room?.room.name || room?.room.display_name || "";
  const remembers = room?.follower?.remembers === true;
  // Check-ins are paid-only and require a remembered thread to land in
  // (api/_checkins.js's own reasoning) — the button is simply absent rather
  // than present-and-disabled, `context/rejected.md`'s standing rule that a
  // control still shown for a state it cannot act on reads as a bug.
  const canCheckin = room?.follower?.tier === "paid" && remembers;
  const canManageSubscription = room?.follower?.tier === "paid";
  // WS-R20: no tier gate, by the workstream's own law - Handoff is the
  // creator's choice per Room, never money's. `room.handoff_enabled` is the
  // SAME column `sendHandoffRequest`'s predicate reads, never a client guess.
  const canHandoff = room?.room.handoff_enabled === true;
  // The tier this session actually knows right now: `quota` (set after the
  // first turn) if present, the join/open response otherwise. Both are real
  // server state - this line picks between two true answers, never guesses.
  const tier = quota?.tier ?? room?.follower?.tier ?? "free";

  // WS-R39: the quarterly reminder's own math, pure and client side (no
  // analytics event, `_room-surface.js`'s own law 5). The baseline is the
  // follower's own last review, or their join date when they have never
  // reviewed at all — both are real timestamps already on `room.follower`,
  // so the sentence never has to say "since" a date it does not have.
  const settingsBaseline = room?.follower?.settings_reviewed_at ?? room?.follower?.joined_at ?? null;
  const settingsReminderDue =
    !!settingsBaseline && Date.now() - new Date(settingsBaseline).getTime() >= 90 * 24 * 60 * 60 * 1000;
  const settingsReminderDate = settingsBaseline
    ? new Date(settingsBaseline).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

  // WS-R59: the install card's own derived state — `isIOS` and
  // `alreadyInstalled` are read straight off the platform once, `showInstall`
  // is `installPrompt.ts`'s real `shouldShowInstallCard`, never a
  // second copy of that predicate written out here. `fixtureInstallPrompt`
  // short-circuits all of it for the layout gate, which has no
  // `beforeinstallprompt`, no visit count, and no real sign-in to drive the
  // real gate with — see the prop's own comment.
  const isIOS =
    !fixtureOpen && typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const alreadyInstalled =
    !fixtureOpen &&
    typeof window !== "undefined" &&
    (() => {
      try {
        return (
          window.matchMedia?.("(display-mode: standalone)").matches === true ||
          (window.navigator as Navigator & { standalone?: boolean }).standalone === true
        );
      } catch {
        return false;
      }
    })();
  const showInstall = fixtureOpen
    ? Boolean(fixtureInstallPrompt)
    : shouldShowInstallCard({
        signedIn: !!auth,
        talking: phase === "talking",
        readyBySecondVisit: installReady,
        dismissed: installDismissed,
        alreadyInstalled,
        hasPromptEvent: !!installEvent,
        isIOS,
      });
  const showInstallIOS = fixtureOpen ? Boolean(fixtureInstallPromptIOS) : isIOS;

  const playReply = useCallback(
    async (index: number, text: string) => {
      if (!session) return;
      if (voicePlaying === index) {
        audioEl.current?.pause();
        setVoicePlaying(null);
        return;
      }
      setVoiceBusy(index);
      setError("");
      try {
        const spoken = await speakInRoom(session, text);
        const audio = new Audio(`data:audio/wav;base64,${spoken.audio}`);
        audioEl.current = audio;
        audio.onended = () => setVoicePlaying((current) => (current === index ? null : current));
        setVoicePlaying(index);
        await audio.play();
      } catch (e) {
        setError(
          e instanceof RoomApiError && e.code === "room_voice_paid_only"
            ? copy.voice.freeOnly
            : copy.voice.unavailable,
        );
      } finally {
        setVoiceBusy((current) => (current === index ? null : current));
      }
    },
    [session, voicePlaying],
  );

  /**
   * WS-R67 (migration 116). "Flag this." `reply` is the exact text of the
   * turn the sheet was opened on - never a body-supplied text, only what
   * `flagReply` hashes CLIENT-SIDE for routing; the server reads the words
   * back off its OWN copy of this follower's history and refuses a hash
   * that matches nothing there. This function never invents a state: the
   * hash is added to `flaggedHashes` only after the server confirms it
   * landed.
   */
  const submitFlag = useCallback(
    async (reply: string, reason: RoomFlagReason) => {
      if (!session || flagBusy) return;
      setFlagBusy(true);
      setFlagNotice("");
      try {
        const result = await flagReply(session, reply, reason);
        setFlaggedHashes((prev) => new Set(prev).add(result.reply_sha256));
        setFlagNotice(copy.flag.done);
        setFlagSheetFor(null);
      } catch (e) {
        setFlagNotice(
          e instanceof RoomApiError && e.code === "room_flag_already_flagged"
            ? copy.flag.alreadyFlagged
            : copy.flag.error,
        );
        if (e instanceof RoomApiError && e.code === "room_flag_already_flagged") {
          void replySha256(reply).then((hash) =>
            setFlaggedHashes((prev) => new Set(prev).add(hash)),
          );
        }
      } finally {
        setFlagBusy(false);
      }
    },
    [session, flagBusy, copy],
  );

  /** Withdraw one flag. `hash` comes from `turnHashes`, this file's own
   *  cache of the same digest `submitFlag` computes on the write path -
   *  never re-derived from a stale closure over the bubble text. */
  const withdrawFlag = useCallback(
    async (hash: string) => {
      if (!session || flagBusy) return;
      setFlagBusy(true);
      setFlagNotice("");
      try {
        await unflagReply(session, hash);
        setFlaggedHashes((prev) => {
          const next = new Set(prev);
          next.delete(hash);
          return next;
        });
        setFlagNotice(copy.flag.withdrawn);
        setFlagSheetFor(null);
      } catch {
        setFlagNotice(copy.flag.error);
      } finally {
        setFlagBusy(false);
      }
    },
    [session, flagBusy, copy],
  );

  /* The address resolves once, and it resolves BEFORE any sign-in: a follower
   * arriving from a bio link must see the room, not a login wall. */
  useEffect(() => {
    if (fixtureOpen) return;
    let live = true;
    (async () => {
      const restored = await restoreSession().catch(() => null);
      if (!live) return;
      if (restored) setAuth(restored);
      try {
        // The browser's own language is only a HINT, read once on first
        // open: a follower who has already joined gets back their OWN stored
        // locale regardless of what this says (`api/_room-surface.js`'s
        // `openRoom` ignores the hint once a follower row exists), and one
        // who has not gets it only as a fallback behind the creator's own
        // `default_locale`.
        const hint = normalizeLocale(typeof navigator !== "undefined" ? navigator.language : "");
        // WS-R40: read once, off this tab's own URL - the same value every
        // openRoom call in this component passes, `roomApi.ts`'s own header.
        const via = typeof window !== "undefined" ? viaFromLocation() : "";
        const opened = await openRoom(slug, restored?.accessToken ?? null, hint, via);
        if (!live) return;
        setRoom(opened);
        setSession(opened.session);
        setThreads(opened.threads ?? []);
        setPhase(opened.joined ? "talking" : "join");
      } catch {
        if (!live) return;
        // WS-R59: distinguish "the browser has no connection" from every
        // other reason `openRoom` can fail — `copy.offline`'s own comment on
        // why the two must never share one message. `navigator.onLine` is a
        // real, first-class signal here (not a guess): this catch only runs
        // once the fetch itself already failed, so a browser reporting
        // `false` at that exact moment is reporting the actual cause, never
        // a coincidence.
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        setPhase(offline ? "offline" : "unavailable");
      }
    })();
    return () => {
      live = false;
    };
  }, [slug, fixtureOpen]);

  /* `lang` on the document, not just on this component's own root: a screen
   * reader and the browser's own find-in-page both read it from here, and
   * this is chrome, not the AI's voice - the AI's own replies keep the
   * creator's Room-level language setting regardless of what this says. */
  useEffect(() => {
    if (fixtureOpen) return;
    document.documentElement.lang = locale;
  }, [locale, fixtureOpen]);

  /* The language switch. Two shapes, because a follower who has not joined
   * yet has no session to persist a choice against - `roomDisclosureCard`'s
   * bytes are locale-bound, so switching before joining re-opens for a fresh
   * card in the new language rather than only relabelling buttons around a
   * card the follower never actually saw in that language. Once joined, the
   * choice is a session-scoped write (`api/_room-surface.js`'s `roomSetLocale`)
   * that mints a fresh session bound to the new card's digest. */
  const switchLocale = useCallback(
    async (next: RoomLocale) => {
      // WS-R84: `fixtureLiveLocaleSwitch` is the one, narrowly-scoped
      // exception - every other fixture screen still blocks this function
      // entirely, exactly as before. See the prop's own comment.
      if ((fixtureOpen && !fixtureLiveLocaleSwitch) || localeBusy || next === locale) return;
      setLocaleBusy(true);
      try {
        if (session && phase === "talking") {
          const result = await setRoomLocale(session, next);
          setSession(result.session);
          // WS-R84: the fresh CARD rides along with the fresh session now,
          // not just its digest - without this line `room.disclosure` kept
          // showing whatever language the follower opened in, forever, no
          // matter how many times they tapped the switch
          // (`context/rejected.md#ws-r84-disclosure-left-out-of-
          // roomsetlocales-response`). `locale` and `disclosure` are set
          // together so there is never a render with one but not the other.
          setRoom((prev) => (prev ? { ...prev, locale: result.locale, disclosure: result.disclosure } : prev));
        } else {
          const opened = await openRoom(slug, auth?.accessToken ?? null, next, viaFromLocation());
          setRoom(opened);
          setSession(opened.session);
          setThreads(opened.threads ?? []);
        }
      } catch {
        // Honest silence: the switch stays where it was, and the next tap
        // tries again - never a fake success on the language a person reads.
      } finally {
        setLocaleBusy(false);
      }
    },
    [fixtureOpen, fixtureLiveLocaleSwitch, localeBusy, locale, session, phase, slug, auth],
  );

  /* WS-R39: the memory-consent toggle, changed from the account page. The
   * `join` op already replaces the answer (`api/_room-surface.js`'s own
   * `ON CONFLICT ... DO UPDATE` sets `memory_consent_at = excluded...`, never
   * coalesced) — this calls it again rather than adding a second write, and
   * mints a fresh session exactly as a repeat join always has. */
  const updateMemoryConsent = useCallback(
    async (next: boolean) => {
      if (fixtureOpen || !auth || memoryBusy) return;
      setMemoryBusy(true);
      try {
        const joined = await joinRoom(slug, auth.accessToken, { age18: true, remember: next }, locale);
        setRoom(joined);
        setSession(joined.session);
        setThreads(joined.threads ?? []);
      } catch {
        // Honest silence, `switchLocale`'s own posture: the answer stays
        // where it was, and the next tap tries again.
      } finally {
        setMemoryBusy(false);
      }
    },
    [fixtureOpen, auth, memoryBusy, slug, locale],
  );

  /* The one statistic, and only when it is real. A null renders nothing rather
   * than a zero that looks like a measurement. */
  useEffect(() => {
    if (fixtureOpen || phase === "loading" || phase === "unavailable" || phase === "offline") return;
    roomStats(slug)
      .then((s) => setTalkedToday(typeof s.talked_today === "number" ? s.talked_today : null))
      .catch(() => setTalkedToday(null));
  }, [slug, phase, fixtureOpen]);

  /* WS-R67. One hash per assistant turn, kept in step with `turns` - used
   * only to READ the "already flagged" state (`flaggedHashes`); the write
   * path (`submitFlag`) hashes its own copy of the text again rather than
   * trusting this cache, so a race between an edit and a stale index can
   * never send the wrong hash. */
  useEffect(() => {
    if (fixtureOpen) return;
    let live = true;
    Promise.all(
      turns.map((turn, i) => (turn.role === "assistant" ? replySha256(turn.content).then((h) => [i, h] as const) : null)),
    ).then((pairs) => {
      if (!live) return;
      const next: Record<number, string> = {};
      for (const pair of pairs) if (pair) next[pair[0]] = pair[1];
      setTurnHashes(next);
    });
    return () => { live = false; };
  }, [turns, fixtureOpen]);

  /* WS-R67 (migration 116). The follower's own flags for THIS room, read
   * once a session exists - so a reply they already flagged (in an earlier
   * visit, or on another tab) shows "flagged" rather than offering to flag
   * it again. Best-effort: a failed read leaves the set empty, which is
   * merely "the control does not yet know" - the server's own unique index
   * is still what actually refuses a duplicate. */
  useEffect(() => {
    if (fixtureOpen || !session) return;
    followerFlags(session)
      .then((result) => setFlaggedHashes(new Set(result.flags.map((f) => f.reply_sha256))))
      .catch(() => {});
  }, [session, fixtureOpen]);

  /* Remembered history, per thread. A follower who declined memory gets an
   * honestly empty answer from the server rather than an invented one here. */
  const loadHistory = useCallback(
    async (token: string, which: string | null) => {
      try {
        const past = await roomHistory(token, which);
        setTurns(past.turns.map((t) => ({ role: t.role, content: t.content })));
      } catch {
        setTurns([]);
      }
    },
    [],
  );

  useEffect(() => {
    if (fixtureOpen || phase !== "talking" || !session || !remembers) return;
    void loadHistory(session, thread);
  }, [phase, session, thread, remembers, loadHistory, fixtureOpen]);

  /* WS-R22 built this as a client-side Blob-URL swap, because no server
   * route for a per-Room manifest existed yet. WS-R59 adds one
   * (`api/_room-manifest.js` over `api/_room-publish.js`'s own
   * unpublished/paused/unknown collapse, `vercel.json`'s
   * `/r/:slug/manifest.webmanifest` rewrite) and this effect now just points
   * the `<link>` at it — no manifest object built here to drift from what
   * the server already builds, and the server's own version carries
   * `?via=install` on `start_url` (this workstream's own arrival channel,
   * `api/_room-surface.js`'s `ROOM_ARRIVAL_VIA`) which a client-built object
   * never did. A browser that installs before this effect runs (or with JS
   * disabled) still gets the static `room.webmanifest` fallback
   * `room.html` already links — this only makes "Add to Home Screen" land
   * back on the right creator instead of a generic, unrouted `/r/`. Never
   * runs for the layout fixture — it touches `document.head`, not this
   * component's own rendered DOM. */
  useEffect(() => {
    if (fixtureOpen || !slug) return;
    try {
      let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "manifest";
        document.head.appendChild(link);
      }
      link.href = `/r/${encodeURIComponent(slug)}/manifest.webmanifest`;
    } catch {
      // Best effort only — a browser that cannot do this still has the
      // static room.webmanifest room.html already links.
    }
  }, [slug, fixtureOpen]);

  /* WS-R59: register the Room's service worker unconditionally on every real
   * mount, not only when a follower turns on push (`AccountPage.tsx`'s own
   * `togglePush`, unchanged) — precaching the shell needs the worker
   * installed BEFORE a follower ever goes offline, not the first time they
   * happen to open the account page. `register` on an already-registered
   * scriptURL+scope is a no-op per spec, so this cannot conflict with that
   * later call. Never runs for the layout fixture (no real page, nothing to
   * register against) or off `serviceWorker`-less browsers. */
  useEffect(() => {
    if (fixtureOpen || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/room-sw.js").catch(() => {
      // Best effort — a browser that refuses (private mode, a disabled
      // setting) still gets the full Room over the network exactly as
      // before this workstream; only the offline/instant-open benefit is
      // lost, never the Room itself.
    });
  }, [fixtureOpen]);

  /* WS-R59: capture `beforeinstallprompt` once, this tab's own lifetime.
   * `preventDefault` stops the browser's own default mini-infobar so the
   * card below (`installPrompt.ts`'s own second-visit rule) is the only UI
   * that ever offers this — never a browser-native prompt racing a
   * product one. iOS never fires this event at all
   * (`installPrompt.ts`'s own comment); this effect simply never captures
   * anything there; `showInstallIOS` is not gated on it. */
  useEffect(() => {
    if (fixtureOpen) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as unknown as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, [fixtureOpen]);

  /* WS-R59: the visit count and any live dismissal, read (and the count
   * incremented) once per real mount — `installPrompt.ts`'s `noteInstallVisit`
   * is the ONLY place this file touches its own `localStorage` keys, keyed
   * per slug so a second visit to Anjali's Room says nothing about Priya's. */
  useEffect(() => {
    if (fixtureOpen || !slug) return;
    const storage = (() => {
      try {
        return window.localStorage;
      } catch {
        return null;
      }
    })();
    const state = noteInstallVisit(storage, slug, Date.now());
    setInstallReady(state.readyBySecondVisit);
    setInstallDismissed(state.dismissed);
  }, [slug, fixtureOpen]);

  const dismissInstall = useCallback(() => {
    setInstallEvent(null);
    setInstallDismissed(true);
    if (fixtureOpen || !slug) return;
    try {
      markInstallDismissed(window.localStorage, slug, Date.now());
    } catch {
      // Best effort — see `noteInstallVisit`'s own header.
    }
  }, [fixtureOpen, slug]);

  const doInstall = useCallback(async () => {
    if (!installEvent) {
      dismissInstall(); // iOS's "Got it" — nothing to prompt, only to dismiss.
      return;
    }
    try {
      await installEvent.prompt();
      await installEvent.userChoice;
    } catch {
      // Best effort — a prompt already consumed (a second tap, or the
      // browser revoked it between capture and tap) fails silently; the
      // dismiss below still runs so the card does not linger either way.
    }
    dismissInstall();
  }, [installEvent, dismissInstall]);

  // WS-R50 (WCAG 2.4.3, focus order): this used to fire on the FIRST paint
  // too, whenever `turns` already held anything at mount — every returning
  // follower with `remembers: true` and a history, since `loadHistory`
  // populates `turns` moments after mount. A page that scrolls itself on
  // load, before anyone has done anything, is disorienting on its own
  // (nothing here asked to move), and it was measured to have a second,
  // sharper cost: with the viewport already carried to the foot of the
  // thread, a keyboard user's very first Tab landed on the composer at the
  // BOTTOM of the screen instead of the language switch at the TOP - a real
  // browser's "focus nothing -> Tab" heuristic starts from what is on
  // screen, not from the top of the DOM. `scrolledOnce` skips exactly the
  // one call that fires before any real exchange has happened; every
  // scroll that follows a person's OWN new message, or the creator's own
  // reply, still runs exactly as before.
  useEffect(() => {
    if (!scrolledOnce.current) {
      scrolledOnce.current = true;
      return;
    }
    foot.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns.length, sending]);

  async function send() {
    const text = draft.trim();
    if (!text || !session || sending) return;
    setError("");
    setCite(null);
    setDraft("");
    setTurns((prev) => [...prev, { role: "user", content: text, fresh: true }]);
    setSending(true);
    try {
      const turn = await sayInRoom(session, text, {
        thread,
        // Only the memory-free lane needs the transcript, and the server binds
        // it by digest. Sending it when the server is remembering would be a
        // second, unsigned copy of a history the server already owns.
        transcript: remembers ? [] : turns.map((t) => ({ role: t.role, content: t.content })),
      });
      setSession(turn.session);
      setQuota(turn.quota);
      setUpgrade(turn.upgrade_prompt);
      if (turn.offer) setOfferCard(turn.offer);
      setTurns((prev) => [...prev, { role: "assistant", content: turn.reply, fresh: true }]);
      if (turn.thread_id && !threads.some((t) => t.thread_id === turn.thread_id)) {
        setThreads((prev) => prev);
      }
    } catch (cause) {
      if (cause instanceof RoomApiError && cause.code === "room_free_cap_reached") {
        setCapped(true);
        // The message is handed back, not swallowed: the follower typed it and
        // it is still theirs.
        setDraft(text);
        setTurns((prev) => prev.slice(0, -1));
        // WS-R30/WS-R39: the cap-reached refusal itself never carries an
        // offer (it throws before any response body could). This is the ONE
        // place a follower ever learns whether WS-R30's best-effort write on
        // the SAME refusal actually landed — checked here, not assumed, so
        // the card renders only when the server confirms both halves are
        // true: `roomSettings`'s own `offer` field is `null` unless an OPEN
        // `cap_reached` row exists for this follower right now.
        if (session) {
          fetchRoomSettings(session)
            .then((s) => {
              if (s.offer?.reason === "cap_reached") {
                setCapOffer({
                  reason: "cap_reached",
                  price_inr: s.price?.price_inr ?? null,
                  currency: s.price?.currency ?? null,
                });
              }
            })
            .catch(() => {});
        }
      } else if (cause instanceof RoomApiError && cause.code === "room_disclosure_stale") {
        setError(copy.errors.stale);
      } else if (cause instanceof RoomApiError && cause.code === "room_message_too_long") {
        setError(copy.errors.tooLong);
      } else if (cause instanceof RoomApiError && cause.code === "rate_limited") {
        // WS-R26 (api/_rate-limit.js). The message is handed back, same
        // posture as the free-cap branch above: a follower who was refused
        // for going too fast, not for what they said, keeps their draft.
        setError(withRetry(copy.errors.rateLimited, cause.retryAfterSeconds ?? 60));
        setDraft(text);
        setTurns((prev) => prev.slice(0, -1));
      } else {
        setError(copy.errors.generic);
        setTurns((prev) => prev.slice(0, -1));
        setDraft(text);
      }
    } finally {
      setSending(false);
    }
  }

  /* THE UPGRADE MOMENT'S OWN ACTION. `startSubscription` either hands back a
   * checkout link (the provider's own UPI Autopay mandate collection page,
   * which this file never renders itself - a payment form built here would
   * be exactly the "collect a credential under false pretenses" shape the
   * Artifact rules refuse, and it is no different in a real product: the
   * mandate must be authenticated on the provider's own surface) or refuses
   * with a named, honest reason. Every reason renders as a stated fact, never
   * a dead button - `context/rejected.md#a-step-is-never-silently-blocked`,
   * one surface over from the studio's own publish lock. */
  const subscribe = useCallback(async () => {
    if (!session || payBusy) return;
    setPayBusy(true);
    setPayError("");
    try {
      const result = await startSubscription(session);
      if (result.checkout_url) {
        window.location.href = result.checkout_url;
        return;
      }
      // A subscription already exists with no fresh link to open - a prior
      // attempt was abandoned before the mandate was authenticated. Re-
      // fetching a link for it is Phase 1 work; today the honest answer is
      // to say so rather than pretend the tap did nothing.
      setPayError(copy.pay.noLink);
    } catch (cause) {
      if (cause instanceof RoomPayApiError && cause.code === "payments_not_configured") {
        setPayError(copy.pay.notConfigured);
      } else if (cause instanceof RoomPayApiError && cause.code === "room_price_not_set") {
        setPayError(copy.pay.priceNotSet);
      } else if (cause instanceof RoomPayApiError && cause.status === 401) {
        setPayError(copy.errors.stale);
      } else {
        setPayError(copy.pay.failed);
      }
    } finally {
      setPayBusy(false);
    }
  }, [session, payBusy]);

  /* "Continue free" (WS-R30). The card is dismissed locally the moment the
   * tap happens - a follower who taps "continue free" expects the card gone,
   * not a spinner - and the outcome write is fire-and-forget, `RoomStudio.
   * tsx`'s `publish_clicked` mark precedent: a failed write here must never
   * block the one thing the follower actually asked for, which is to keep
   * talking. */
  const dismissOfferCard = useCallback(() => {
    setOfferCard(null);
    if (!session) return;
    void dismissOffer(session).catch(() => {});
  }, [session]);

  /* "Continue next month" (WS-R39, the cap-reached variant). Same op, same
   * fire-and-forget posture as `dismissOfferCard` above — `roomDismissOffer`
   * finds the follower's own most recent OPEN offer regardless of reason. */
  const dismissCapOffer = useCallback(() => {
    setCapOffer(null);
    if (!session) return;
    void dismissOffer(session).catch(() => {});
  }, [session]);

  const togglePulse = useCallback(async () => {
    if (!session || pulseBusy) return;
    const scope = thread ?? "";
    const on = pulseOn[scope] === true;
    setPulseBusy(true);
    try {
      const result = on ? await revokePulseOptIn(session, thread) : await setPulseOptIn(session, thread);
      setPulseOn((prev) => ({ ...prev, [scope]: result.active }));
    } catch {
      // Honest silence: the toggle simply stays where it was, and the next
      // tap tries again - never a fake success on a decision this private.
    } finally {
      setPulseBusy(false);
    }
  }, [session, thread, pulseOn, pulseBusy]);

  if (phase === "loading") {
    return (
      <main className="room-shell" lang={locale}>
        <div className="room-thread">
          <p className="room-lede">{copy.loading}</p>
        </div>
      </main>
    );
  }

  if (phase === "unavailable") {
    return (
      <main className="room-shell" lang={locale}>
        <section className="room-gone">
          <h2>{copy.unavailable.title}</h2>
          <p className="room-lede">{copy.unavailable.body}</p>
        </section>
      </main>
    );
  }

  /* WS-R59: the shell's own honest offline card — `copy.offline`'s own
   * comment on why it is a SEPARATE message from `unavailable` above, never
   * that one repurposed. "Try again" reloads rather than re-running the open
   * effect in place: a reload also re-asks the precached service worker for
   * `room.html` (public/room-sw.js's own navigate handler), which is the
   * one path that recovers cleanly whether the reload lands back online or
   * still offline. */
  if (phase === "offline") {
    return (
      <main className="room-shell" lang={locale}>
        <section className="room-gone">
          <h2>{copy.offline.title}</h2>
          <p className="room-lede">{copy.offline.body}</p>
          <button type="button" className="room-btn primary" onClick={() => window.location.reload()}>
            {copy.offline.retry}
          </button>
        </section>
      </main>
    );
  }

  if (phase === "gone") {
    return (
      <main className="room-shell" lang={locale}>
        <section className="room-gone">
          <h2>{copy.menu.forgetDone}</h2>
          <p className="room-lede">{withName(copy.menu.forgetNote, name)}</p>
          {/* WS-R27: the receipt, shown here and ONLY here (law 3 - there is
              nothing to look it up by later). `null` only on a database that
              has not applied migration 090 yet; the screen above still holds
              without it. */}
          {forgetReceipt && (
            <div className="room-receipt">
              <h3>{copy.menu.receiptTitle}</h3>
              <p className="room-fine">{copy.menu.receiptBody}</p>
              <button
                type="button"
                className="room-btn"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(forgetReceipt, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "forget-receipt.json";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                {copy.menu.receiptSave}
              </button>
            </div>
          )}
        </section>
      </main>
    );
  }

  if (phase === "join" && room) {
    // WS-R53: the taste, ahead of the sign-in wall — unless the creator
    // switched it off (`room.room.taste_enabled`, read from the server,
    // never guessed) or this visitor already tapped through it once this
    // tab (`tasteDismissed`, which the taste screen's OWN join control and
    // its "no more questions today" state both set).
    if (room.room.taste_enabled !== false && !tasteDismissed) {
      return (
        <TasteScreen
          room={room}
          name={name}
          copy={copy}
          locale={locale}
          localeBusy={localeBusy}
          onSwitchLocale={switchLocale}
          onJoin={() => setTasteDismissed(true)}
        />
      );
    }
    return (
      <JoinSheet
        room={room}
        name={name}
        auth={auth}
        copy={copy}
        locale={locale}
        localeBusy={localeBusy}
        onSwitchLocale={switchLocale}
        onAuth={(next) => {
          setAuth(next);
          writeStoredSession(next);
        }}
        onJoined={(joined) => {
          // WS-R94, a real defect this workstream's own rehearsal caught,
          // the first time this transition has ever run against a real
          // server rather than a fixture prop: `joinRoom` (api/_room-
          // surface.js) returns `{joined, locale, follower, threads,
          // session}` — deliberately NO `room` sub-object, `openRoom`'s own
          // response is the one place that lives — so `setRoom(joined)`
          // replaced the whole state with an object whose `.room` was
          // `undefined`, and the very next render (`room.room.display_name`
          // in the header) threw. `switchLocale`'s own line just above this
          // component (`RoomApp.tsx`, `setRoom((prev) => prev ? {...prev,
          // locale, disclosure} : prev)`) is the established fix shape for
          // exactly this class of partial server response — applied here.
          setRoom((prev) => (prev ? { ...prev, ...joined } : prev));
          setSession(joined.session);
          setThreads(joined.threads ?? []);
          setPhase("talking");
        }}
      />
    );
  }

  return (
    <main className="room-shell" lang={locale}>
      <header className="room-head">
        <div className="room-head-row">
          {/* WS-R79: the creator's own name is not guaranteed to be in the
              script the follower reads the rest of this chrome in - tagged
              on its own rather than inheriting `<main lang={locale}>` above. */}
          <h1>
            {name ? (
              <>
                <Localized as="span" text={name} /> AI
              </>
            ) : (
              <Localized as="span" text={room?.room.display_name || ""} />
            )}
          </h1>
          <div className="room-head-actions">
            {/* WS-R40: growth is a follower sending this link to a friend. */}
            {room && (
              <ShareButton slug={room.room.slug} disclosure={room.disclosure} copy={copy} />
            )}
            <LanguageSwitch locale={locale} busy={localeBusy} onSwitch={switchLocale} />
            {canCheckin && (
              <button
                type="button"
                className="room-menu-open"
                // WS-R63: a locale-independent hook for the layout gate's own
                // click (`scripts/check-layout.mjs`) - never read by the app
                // itself, so it carries no behaviour of its own.
                data-dialog-open="checkins"
                onClick={() => setCheckinsOpen(true)}
              >
                {copy.checkins.title}
              </button>
            )}
            {canHandoff && (
              <button
                type="button"
                className="room-menu-open"
                data-dialog-open="handoff"
                onClick={() => setHandoffOpen(true)}
              >
                {withName(copy.handoff.title, name || room?.room.display_name || "")}
              </button>
            )}
            {canManageSubscription && (
              <button type="button" className="room-menu-open" onClick={() => setSubscriptionOpen(true)}>
                {copy.subscription.title}
              </button>
            )}
            <button type="button" className="room-menu-open" onClick={() => setMenu(true)}>
              {copy.menu.title}
            </button>
            {/* WS-R39: the follower's own page, reachable from every screen. */}
            <button type="button" className="room-menu-open" onClick={() => setAccountOpen(true)}>
              {copy.account.open}
            </button>
          </div>
        </div>
        {/* ONE statistic, and only if a real count came back. WS-R43:
            `room-num` (room.css) is the Room's own numeric-figure marker —
            tabular digits, so a count changing on a live poll never
            reflows its neighbours. */}
        {typeof talkedToday === "number" && talkedToday > 0 && (
          <p className="room-stat room-num">
            {talkedToday === 1
              ? copy.stats.talkedTodayOne
              : withCount(copy.stats.talkedToday, talkedToday)}
          </p>
        )}
        {/* WS-R39: the quarterly reminder — a plain sentence, never a nag,
            shown only once `settingsReviewedAt` is 90 days old or more (or
            never set at all). Resets the moment the follower actually opens
            the page (`onReviewed` below writes the fresh timestamp straight
            into `room.follower`, so the sentence disappears without a
            reload). */}
        {settingsReminderDue && (
          <p className="room-stat room-num">
            {copy.settingsReminder.note.split("{date}").join(settingsReminderDate)}{" "}
            <button type="button" className="room-menu-open" onClick={() => setAccountOpen(true)}>
              {copy.settingsReminder.review}
            </button>
          </p>
        )}
      </header>

      {/* WS-R59: the install card. `installPrompt.ts`'s own predicate
          (`shouldShowInstallCard`) decides whether this renders at all;
          this block only decides which of the two variants — a browser with
          a captured `beforeinstallprompt` gets a working button, iOS gets
          static "Add to Home Screen" instructions instead, since no button
          can ever exist there. `room-cap`/`room-btn` are the SAME classes
          `capOffer`'s own card below already uses — one visual language for
          every dismissible card this screen shows, not a second one
          invented for this workstream. */}
      {showInstall && (
        <section className="room-cap" role="note">
          <h2>{withName(showInstallIOS ? copy.install.iosTitle : copy.install.title, name)}</h2>
          <p className="room-lede">{showInstallIOS ? copy.install.iosBody : copy.install.body}</p>
          {showInstallIOS ? (
            <button
              type="button"
              className="room-btn"
              onPointerDown={dismissInstall}
              onKeyDown={activateOnKey(dismissInstall)}
            >
              {copy.install.iosDismiss}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="room-btn primary"
                onPointerDown={() => void doInstall()}
                onKeyDown={activateOnKey(() => void doInstall())}
              >
                {copy.install.cta}
              </button>
              <button
                type="button"
                className="room-btn"
                onPointerDown={dismissInstall}
                onKeyDown={activateOnKey(dismissInstall)}
              >
                {copy.install.dismiss}
              </button>
            </>
          )}
        </section>
      )}

      <ThreadRail
        copy={copy}
        threads={threads}
        active={thread}
        onPick={setThread}
        onCreate={async (title) => {
          if (!session) return;
          const made = await newRoomThread(session, title).catch(() => null);
          if (made) {
            setThreads((prev) => [made, ...prev]);
            setThread(made.thread_id);
          }
        }}
      />

      <div className="room-pulse">
        <button
          type="button"
          className="room-pulse-toggle"
          aria-pressed={pulseOn[thread ?? ""] === true}
          disabled={pulseBusy}
          onPointerDown={() => void togglePulse()}
          onKeyDown={activateOnKey(() => void togglePulse())}
        >
          {pulseBusy
            ? copy.pulse.working
            : pulseOn[thread ?? ""] === true
              ? copy.pulse.off
              : copy.pulse.on}
        </button>
        <p className="room-pulse-explain">{withName(copy.pulse.explain, name)}</p>
      </div>

      <div className="room-thread">
        {/* The card, as DATA, at the top of the first screen. Never generated,
            never paraphrased, and never below the fold. */}
        <div className="room-card" role="note">
          {/* WS-R79: the disclosure card is rendered in the locale it was
              FETCHED in, never re-picked - a locale switch mid-conversation
              updates the document's own `lang` without ever refetching this
              text (`copy.ts`'s own comment on `detectRoomTextLang`). Tagged
              from its own characters so it stays correct regardless. */}
          <LocalizedDisclosure text={room?.disclosure || ""} />
        </div>

        {!remembers && <p className="room-fine">{copy.conversation.notRemembering}</p>}

        {turns.map((turn, i) => (
          <div
            key={`${i}-${turn.content.slice(0, 24)}`}
            className={`room-bubble ${turn.role === "user" ? "from-me" : "from-them"}${
              turn.fresh ? " room-bubble-enter" : ""
            }`}
          >
            {turn.content}
            {/* WS-R19: paid only, flag only. A free follower's bubble never
                grows this control - law 3 restated at the render, not just
                at the door: `roomSpeak` refuses a free follower's request
                regardless, but a control that renders and then always fails
                would still read as a broken feature rather than an absent
                one. */}
            {ROOM_VOICE_UI && turn.role === "assistant" && tier === "paid" && session && (
              <button
                type="button"
                className="room-bubble-voice"
                disabled={voiceBusy === i}
                onClick={() => void playReply(i, turn.content)}
              >
                {voicePlaying === i ? copy.voice.playing : copy.voice.play}
              </button>
            )}

            {/* WS-R67 (migration 116). Every follower, free or paid, law 4's
                own "a small control on each AI bubble" - never gated by
                tier the way voice is, since this is a safety report, not a
                paid feature. */}
            {turn.role === "assistant" && session && (
              <button
                type="button"
                className="room-bubble-flag"
                aria-pressed={Boolean(turnHashes[i] && flaggedHashes.has(turnHashes[i]))}
                onClick={() => setFlagSheetFor(flagSheetFor === i ? null : i)}
              >
                {turnHashes[i] && flaggedHashes.has(turnHashes[i]) ? copy.flag.withdraw : copy.flag.buttonLabel}
              </button>
            )}

            {flagSheetFor === i && (
              <div className="room-flag-sheet" role="dialog" aria-label={copy.flag.sheetTitle}>
                {turnHashes[i] && flaggedHashes.has(turnHashes[i]) ? (
                  <>
                    <p>{copy.flag.alreadyFlagged}</p>
                    <button
                      type="button"
                      className="room-flag-reason"
                      disabled={flagBusy}
                      onClick={() => void withdrawFlag(turnHashes[i])}
                    >
                      {flagBusy ? copy.flag.withdrawing : copy.flag.withdraw}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="room-flag-sheet-title">{copy.flag.sheetTitle}</p>
                    <div className="room-flag-reasons">
                      {(Object.keys(copy.flag.reasons) as RoomFlagReason[]).map((reason) => (
                        <button
                          key={reason}
                          type="button"
                          className="room-flag-reason"
                          disabled={flagBusy}
                          onClick={() => void submitFlag(turn.content, reason)}
                        >
                          {copy.flag.reasons[reason]}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <button
                  type="button"
                  className="text-button"
                  disabled={flagBusy}
                  onClick={() => setFlagSheetFor(null)}
                >
                  {copy.flag.cancel}
                </button>
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div className="room-typing" aria-label={copy.conversation.thinking}>
            <i />
            <i />
            <i />
          </div>
        )}

        {/* The citation affordance, phrased as the question a person asks. It
            appears only after a reply, because there is nothing to ask about
            before one. */}
        {!sending && turns.some((t) => t.role === "assistant") && session && (
          <button
            type="button"
            className="room-cite"
            onClick={async () => {
              const answer = await roomCitations(session).catch(() => null);
              if (answer) setCite(answer);
            }}
          >
            {copy.conversation.whereFrom}
          </button>
        )}

        {cite && (
          <div className="room-cite-answer">
            {withName(copy.conversation.citedFrom, cite.name || name)}
            {cite.sources.length > 0 && (
              <ul>
                {cite.sources.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && <p className="room-error">{error}</p>}
        {flagNotice && <p className="room-fine" role="status">{flagNotice}</p>}

        {/* THE END OF A SESSION THAT WORKED. Under the last reply, never across
            one, and it states a fact rather than making one up. */}
        {upgrade && quota && quota.messages_left !== null && !capped && (
          <p className="room-upgrade room-num">
            {quota.messages_left === 0
              ? copy.quota.lastOne
              : withIncluded(copy.quota.left, quota.messages_left, quota.messages_included)}
            {" "}
            <button
              type="button"
              className="room-btn"
              disabled={payBusy}
              onPointerDown={() => void subscribe()}
              onKeyDown={activateOnKey(() => void subscribe())}
            >
              {payBusy ? copy.pay.working : copy.pay.cta}
            </button>
          </p>
        )}

        {capped && (
          <section className="room-cap">
            <h2>{copy.quota.capped.title}</h2>
            <p className="room-lede">{copy.quota.capped.body}</p>
            <button
              type="button"
              className="room-btn primary"
              disabled={payBusy}
              onPointerDown={() => void subscribe()}
              onKeyDown={activateOnKey(() => void subscribe())}
            >
              {payBusy ? copy.pay.working : copy.pay.cta}
            </button>
            {/* WS-R69: no price is wired to this render point (this section
                has never shown one), so the price-less mandate disclosure —
                `pay.mandateNote`'s own no-price twin, `capOffer`/`offer`'s
                own `bodyNoPrice` pattern restated for this sentence. */}
            <p className="room-fine">{copy.pay.mandateNoteNoPrice}</p>
            {payError && <p className="room-error">{payError}</p>}
          </section>
        )}

        {/* WS-R39: the cap-reached offer card, UNDER the capped screen above,
            never replacing its sentence — the workstream brief's own law.
            Rendered only when the server confirmed BOTH halves: the refusal
            happened (`capped`) AND WS-R30 actually recorded a `cap_reached`
            offer (`capOffer`, fetched in `send()`'s own catch block above). */}
        {capped && capOffer && (
          <section className="room-cap" role="note">
            <h2>{copy.capOffer.title}</h2>
            <p className="room-lede room-num">
              {capOffer.price_inr != null
                ? withName(withPrice(copy.capOffer.body, `Rs ${capOffer.price_inr}`), name)
                : withName(copy.capOffer.bodyNoPrice, name)}
            </p>
            {/* WS-R69: what tapping this button actually starts — a UPI
                Autopay mandate, not a one-time charge — in a person's own
                words, both locales, `copy.pay.mandateNote`. */}
            <p className="room-fine">
              {capOffer.price_inr != null
                ? withPrice(copy.pay.mandateNote, `Rs ${capOffer.price_inr}`)
                : copy.pay.mandateNoteNoPrice}
            </p>
            <button
              type="button"
              className="room-btn primary"
              disabled={payBusy}
              onPointerDown={() => void subscribe()}
              onKeyDown={activateOnKey(() => void subscribe())}
            >
              {payBusy ? copy.pay.working : copy.capOffer.subscribe}
            </button>
            <button
              type="button"
              className="room-btn"
              onPointerDown={dismissCapOffer}
              onKeyDown={activateOnKey(dismissCapOffer)}
            >
              {copy.capOffer.continue}
            </button>
          </section>
        )}
        {/* THE CONVERSION MOMENT (WS-R30). "The offer belongs at the end of a
            session that worked" - under the last reply, dismissible, and
            never rendered on top of the capped screen (which already has its
            own subscribe control). `cap_reached` offers are ledger-only and
            never reach this render at all - see roomApi.ts's `RoomOffer`. */}
        {offerCard && offerCard.reason === "session_worked" && !capped && (
          <section className="room-cap" role="note">
            <h2>{copy.offer.title}</h2>
            <p className="room-lede room-num">
              {offerCard.price_inr != null
                ? withName(withPrice(copy.offer.body, `Rs ${offerCard.price_inr}`), name)
                : withName(copy.offer.bodyNoPrice, name)}
            </p>
            {/* WS-R69: the same mandate disclosure `capOffer`'s own card
                carries one section up - one shared sentence family, not a
                third copy of it. */}
            <p className="room-fine">
              {offerCard.price_inr != null
                ? withPrice(copy.pay.mandateNote, `Rs ${offerCard.price_inr}`)
                : copy.pay.mandateNoteNoPrice}
            </p>
            <button
              type="button"
              className="room-btn primary"
              disabled={payBusy}
              onPointerDown={() => void subscribe()}
              onKeyDown={activateOnKey(() => void subscribe())}
            >
              {payBusy ? copy.pay.working : copy.offer.subscribe}
            </button>
            <button
              type="button"
              className="room-btn"
              onPointerDown={dismissOfferCard}
              onKeyDown={activateOnKey(dismissOfferCard)}
            >
              {copy.offer.continueFree}
            </button>
          </section>
        )}

        {!capped && payError && <p className="room-error">{payError}</p>}

        <div ref={foot} />
      </div>

      <div className="room-composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={copy.conversation.placeholder}
          rows={1}
          disabled={capped}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          className="room-send"
          // Feedback on pointerdown, per DESIGN-LAW: the press is acknowledged
          // by the transform in room.css before the network is asked anything.
          onPointerDown={() => setError("")}
          onClick={() => void send()}
          disabled={sending || capped || !draft.trim()}
        >
          {copy.conversation.send}
        </button>
      </div>

      {menu && session && (
        <DataMenu
          name={name}
          copy={copy}
          session={session}
          auth={auth}
          follower={room?.follower ?? null}
          onClose={() => setMenu(false)}
          onForgotten={(receipt) => {
            setForgetReceipt(receipt);
            setMenu(false);
            setPhase("gone");
          }}
        />
      )}
      {checkinsOpen && session && (
        <CheckinsPanel session={session} copy={copy} onClose={() => setCheckinsOpen(false)} />
      )}
      {subscriptionOpen && session && (
        <SubscriptionPanel session={session} copy={copy} onClose={() => setSubscriptionOpen(false)} />
      )}
      {handoffOpen && session && (
        <HandoffPanel
          session={session}
          turns={turns}
          threadId={thread}
          creatorName={name || room?.room.display_name || ""}
          copy={copy}
          onClose={() => setHandoffOpen(false)}
        />
      )}
      {accountOpen && session && (
        <AccountPage
          session={session}
          copy={copy}
          locale={locale}
          name={name || room?.room.display_name || ""}
          auth={auth}
          remembers={remembers}
          memoryBusy={memoryBusy}
          onMemoryChange={(next) => void updateMemoryConsent(next)}
          localeBusy={localeBusy}
          onSwitchLocale={(next) => void switchLocale(next)}
          payBusy={payBusy}
          payError={payError}
          onSubscribe={() => void subscribe()}
          onReviewed={(at) => setRoom((prev) => (prev?.follower ? { ...prev, follower: { ...prev.follower, settings_reviewed_at: at } } : prev))}
          onClose={() => setAccountOpen(false)}
          onForgotten={(receipt) => {
            setForgetReceipt(receipt);
            setAccountOpen(false);
            setPhase("gone");
          }}
          fixtureSettings={fixtureSettings}
          fixturePayment={fixturePayment}
          fixtureReferralUrl={fixtureReferralUrl}
        />
      )}
    </main>
  );
}

const withCount = (template: string, n: number) => template.split("{n}").join(String(n));
const withIncluded = (template: string, n: number, included: number) =>
  withCount(template, n).split("{included}").join(String(included));

/* ── the share control (WS-R40) ─────────────────────────────────────────────
 *
 * `navigator.share` where the browser has it (the native sheet - WhatsApp,
 * Messages, whatever the person already uses); a copy-to-clipboard
 * confirmation otherwise. Either way the url is built ONCE, here, and
 * carries `?via=share` and NOTHING else - never a follower id, never a
 * token that could identify the sender, so a recipient can never be traced
 * back to who invited them (a decision this workstream logs with its own
 * reversal condition: the day this product needs to credit a specific
 * follower for a referral, which nothing in it does today).
 *
 * Feedback fires on `pointerdown`, DESIGN-LAW's own law, and Enter/Space
 * reach the same action through `activateOnKey` - this file's own pattern
 * for every control here that has a real effect rather than only opening a
 * panel. The confirmation is `role="status"`/`aria-live="polite"` so a
 * screen reader announces it without moving focus, and it clears itself
 * after a few seconds rather than sitting there stale. */
function ShareButton({
  slug,
  disclosure,
  copy,
}: {
  slug: string;
  disclosure: string;
  copy: RoomCopy;
}) {
  const [copied, setCopied] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined" || !slug) return "";
    return `${window.location.origin}/r/${encodeURIComponent(slug)}?via=share`;
  }, [slug]);

  const share = useCallback(() => {
    if (!shareUrl) return;
    const nav = typeof navigator !== "undefined" ? navigator : null;
    if (nav && typeof nav.share === "function") {
      nav.share({ title: copy.share.button, text: disclosure, url: shareUrl }).catch(() => {});
      return;
    }
    if (!nav?.clipboard?.writeText) return;
    nav.clipboard
      .writeText(shareUrl)
      .then(() => {
        setCopied(true);
        if (clearTimer.current) clearTimeout(clearTimer.current);
        clearTimer.current = setTimeout(() => setCopied(false), 3000);
      })
      .catch(() => {});
  }, [shareUrl, disclosure, copy]);

  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    [],
  );

  if (!shareUrl) return null;

  return (
    <span className="room-share">
      <button
        type="button"
        className="room-share-btn"
        onPointerDown={share}
        onKeyDown={activateOnKey(share)}
      >
        {copy.share.button}
      </button>
      <span className="room-share-toast" role="status" aria-live="polite">
        {copied ? copy.share.copied : ""}
      </span>
    </span>
  );
}

/* ── the language switch (WS-R24) ───────────────────────────────────────────
 *
 * Two words, both shown, in both locales, always: `ROOM_LANGUAGE_LABELS`'s own
 * header explains why - a follower who can only read one script still has to
 * be able to find the OTHER one's name to reach it. The current locale reads
 * as pressed (`aria-pressed`) rather than disabled, so it stays announced by a
 * screen reader as the state it is. */
export function LanguageSwitch({
  locale,
  busy,
  onSwitch,
}: {
  locale: RoomLocale;
  busy: boolean;
  onSwitch: (next: RoomLocale) => void;
}) {
  return (
    <div className="room-lang-switch" role="group" aria-label="हिन्दी / English">
      {ROOM_LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          className="room-lang-btn"
          // WS-R79: this button's own label is in `l`'s script, not
          // necessarily the DOCUMENT's — both are always shown, side by
          // side, in every locale (`ROOM_LANGUAGE_LABELS`'s own comment),
          // so on an English page the "हिन्दी" button needs its own `lang`
          // or a screen reader reads it in an English voice.
          lang={l}
          aria-pressed={locale === l}
          disabled={busy}
          onClick={() => onSwitch(l)}
        >
          {ROOM_LANGUAGE_LABELS[l]}
        </button>
      ))}
    </div>
  );
}

/* ── the thread rail ────────────────────────────────────────────────────── */

function ThreadRail({
  copy,
  threads,
  active,
  onPick,
  onCreate,
}: {
  copy: RoomCopy;
  threads: RoomThread[];
  active: string | null;
  onPick: (id: string | null) => void;
  onCreate: (title: string) => void | Promise<void>;
}) {
  const [naming, setNaming] = useState(false);
  const [title, setTitle] = useState("");
  return (
    <nav className="room-rail" aria-label={copy.threads.title}>
      <button type="button" aria-pressed={active === null} onClick={() => onPick(null)}>
        {copy.threads.all}
      </button>
      {threads.map((t) => (
        <button
          key={t.thread_id}
          type="button"
          aria-pressed={active === t.thread_id}
          onClick={() => onPick(t.thread_id)}
        >
          {t.title}
        </button>
      ))}
      {naming ? (
        <>
          <input
            aria-label={copy.threads.namePlaceholder}
            placeholder={copy.threads.namePlaceholder}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button
            type="button"
            onClick={() => {
              const clean = title.trim();
              if (!clean) return;
              void onCreate(clean);
              setTitle("");
              setNaming(false);
            }}
          >
            {copy.threads.save}
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setNaming(true)}>
          {copy.threads.create}
        </button>
      )}
    </nav>
  );
}

/* ── the taste ───────────────────────────────────────────────────────────── */

/* Three questions, answered by the creator's AI, from their own material
 * alone, before the sign-in wall (WS-R53). No session, no thread — nothing
 * sent to or received from the server survives past this one component:
 * `tasteInRoom` (roomApi.ts) mints no session, and `exchanges` below lives
 * only in this screen's own state, gone the moment the tab is (the SAME
 * "stateless by construction" property api/_room-taste.js's own header
 * states for the server side of this exact boundary). The join control is
 * always present and always works — a stranger who wants to skip straight
 * to signing in never has to spend a question first. */
function TasteScreen({
  room,
  name,
  copy,
  locale,
  localeBusy,
  onSwitchLocale,
  onJoin,
}: {
  room: RoomOpen;
  name: string;
  copy: RoomCopy;
  locale: RoomLocale;
  localeBusy: boolean;
  onSwitchLocale: (next: RoomLocale) => void;
  onJoin: () => void;
}) {
  const [exchanges, setExchanges] = useState<{ q: string; a: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // WS-R53: true from turn 1 onward (`api/_room-taste.js`'s own law - the
  // card is carried on the first answer and stays shown after). WS-R84: this
  // used to be the disclosure TEXT itself, captured once from that first
  // `tasteInRoom` response and held in local state - which meant a follower
  // who switched languages AFTER asking one question kept reading the OLD
  // language's card forever, since nothing here ever updated it again. Now
  // it is only a flag, and the text always renders straight off `room.
  // disclosure` below - the SAME `open` response `switchLocale`'s own
  // pre-join branch already re-fetches on every switch (`RoomApp.tsx`'s own
  // header: "refetched through the same path that fetched it on open"), so
  // the card can never be one switch behind. `room.disclosure` and a taste
  // turn's own `disclosure` field are byte-identical by construction (both
  // `roomDisclosureCard(name, locale)` off the same name and the same
  // locale this screen passes to `tasteInRoom` below), so nothing is lost by
  // reading the PROP instead of the per-turn response.
  const [hasAsked, setHasAsked] = useState(false);
  const [turnsLeft, setTurnsLeft] = useState(3);
  // True once the daily allowance is spent, whichever way that happened
  // (the server said `turns_left: 0`, or the rate gate refused outright) —
  // the one flag that decides whether the input still renders.
  const [spent, setSpent] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [exchanges.length]);

  async function ask() {
    const text = draft.trim();
    if (!text || busy || spent) return;
    setBusy(true);
    setError("");
    try {
      // `room.locale` — the exact language the lede/disclosure above is
      // already rendered in, passed through rather than re-picked, `join`'s
      // own reason one screen over.
      const turn: RoomTasteTurn = await tasteInRoom(room.room.slug, text, room.locale);
      setDraft("");
      setExchanges((prev) => [...prev, { q: text, a: turn.reply }]);
      if (turn.disclosure) setHasAsked(true);
      setTurnsLeft(turn.turns_left);
      if (turn.turns_left <= 0) setSpent(true);
    } catch (e) {
      if (e instanceof RoomApiError && e.code === "rate_limited") {
        setError(copy.taste.rateLimited);
        setSpent(true);
      } else {
        setError(copy.errors.generic);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="room-shell" lang={locale}>
      <section className="room-taste">
        <div className="room-head-row">
          {/* WS-R79: see the talk screen's own comment on the identical h1
              two screens over — same reason, same fix. */}
          <h1>
            {name ? (
              <>
                <Localized as="span" text={name} /> AI
              </>
            ) : (
              <Localized as="span" text={room.room.display_name || ""} />
            )}
          </h1>
          <LanguageSwitch locale={locale} busy={localeBusy} onSwitch={onSwitchLocale} />
        </div>
        {/* WS-R45. Plain text the creator wrote about themselves — never
            rendered as anything but a paragraph, exactly like the directory
            card that already shows it. WS-R79: tagged on its own, since it is
            written in the Room's own default locale, not necessarily the
            one this screen's chrome is in. */}
        {room.room.bio && <Localized as="p" className="room-lede" text={room.room.bio} />}
        {/* The card, the moment it exists (turn 1's own reply) — and once
            shown it STAYS shown, `api/_room-taste.js`'s own "carried on the
            first answer" law rendered rather than re-requested. Before that
            first reply, the lede alone says what this screen is. */}
        {hasAsked ? (
          <div className="room-card" role="note">
            {/* WS-R84: `room.disclosure`, never a locally-held copy - see
                `hasAsked`'s own comment above on why this can never go
                stale across a language switch. */}
            <LocalizedDisclosure text={room.disclosure} />
          </div>
        ) : (
          <p className="room-lede">
            <LocalizedName template={copy.taste.lede} name={name} />
          </p>
        )}

        {exchanges.length > 0 && (
          <div className="room-taste-turns">
            {exchanges.map((ex, i) => (
              <div className="room-taste-turn" key={i}>
                <p className="room-taste-q">{ex.q}</p>
                <p className="room-taste-a">{ex.a}</p>
              </div>
            ))}
          </div>
        )}
        {busy && <p className="room-lede">{copy.taste.thinking}</p>}
        <div ref={bottomRef} />

        {error && <p className="room-error">{error}</p>}

        {/* Three dots, empty as they are spent — the workstream's own
            product number (WS-R53 law 4), never re-derived from the
            server's own configurable limit: a display convention, not the
            enforcement (the enforcement is `api/_rate-limit.js`'s own
            `room_taste` scope, entirely server-side). */}
        <div className="room-taste-dots" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`room-taste-dot${i < exchanges.length ? " room-taste-dot-spent" : ""}`} />
          ))}
        </div>

        {!spent && (
          <div className="room-actions">
            <input
              className="room-taste-input"
              aria-label={copy.taste.placeholder}
              placeholder={copy.taste.placeholder}
              value={draft}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void ask();
              }}
            />
            <button
              type="button"
              className="room-btn primary"
              disabled={busy || !draft.trim()}
              onClick={() => void ask()}
            >
              {copy.taste.send}
            </button>
          </div>
        )}

        {!spent && turnsLeft > 0 && turnsLeft < 3 && (
          <p className="room-fine">
            {turnsLeft === 1 ? copy.taste.turnsLeftOne : withCount(copy.taste.turnsLeft, turnsLeft)}
          </p>
        )}
        {spent && !error && <p className="room-fine">{copy.taste.spent}</p>}

        {/* Always present, always works — a stranger who wants to sign in
            right away never has to spend a question first. */}
        <div className="room-actions">
          <button type="button" className="room-btn" onClick={onJoin}>
            {copy.taste.join}
          </button>
        </div>
      </section>
    </main>
  );
}

/* ── the join sheet ─────────────────────────────────────────────────────── */

/* Sign in, attest, answer. Three things on one screen, in that order, because
 * the memory question has to be answerable by somebody who already knows what
 * they are joining. The card is above all of it, so nobody answers a question
 * about a product they have not been told the nature of. */
function JoinSheet({
  room,
  name,
  auth,
  copy,
  locale,
  localeBusy,
  onSwitchLocale,
  onAuth,
  onJoined,
}: {
  room: RoomOpen;
  name: string;
  auth: StudioSession | null;
  copy: RoomCopy;
  locale: RoomLocale;
  localeBusy: boolean;
  onSwitchLocale: (next: RoomLocale) => void;
  onAuth: (session: StudioSession) => void;
  onJoined: (joined: RoomOpen & { session: string }) => void;
}) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [age18, setAge18] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function finish(remember: boolean) {
    if (!auth) {
      setError(copy.errors.signIn);
      return;
    }
    setBusy(true);
    setError("");
    try {
      // `room.locale` is the exact language the disclosure card above was
      // rendered in - passed through rather than re-picked, so the follower
      // row's initial locale can never disagree with the card the follower
      // actually read before agreeing to anything.
      //
      // WS-R86: `refFromLocation()` read here, on THIS join call only - the
      // one moment a follower row is genuinely new, `joinRoom`'s (roomApi.ts)
      // own header on why a repeat join elsewhere in this file never passes
      // one.
      const joined = await joinRoom(
        room.room.slug, auth.accessToken, { age18, remember }, room.locale, refFromLocation(),
      );
      onJoined(joined);
    } catch {
      setError(copy.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="room-shell" lang={locale}>
      <section className="room-join">
        <div className="room-head-row">
          <h2>
            <LocalizedName template={copy.join.title} name={name} />
          </h2>
          <LanguageSwitch locale={locale} busy={localeBusy} onSwitch={onSwitchLocale} />
        </div>
        {/* The card first, and as data. A person answering the memory question
            below has already been told what they are talking to. */}
        <div className="room-card" role="note">
          <LocalizedDisclosure text={room.disclosure} />
        </div>
        <p className="room-lede" style={{ marginTop: "var(--space-item)" }}>
          {copy.join.lede}
        </p>

        {error && <p className="room-error">{error}</p>}

        {!auth && (
          <>
            <h3>{copy.join.signIn}</h3>
            <label className="room-field">
              <span>{copy.join.phoneLabel}</span>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={copy.join.phonePlaceholder}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            {codeSent && (
              <label className="room-field">
                <span>{copy.join.codeLabel}</span>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
            )}
            <div className="room-actions">
              <button
                type="button"
                className="room-btn primary"
                disabled={busy || phone.trim().length < 8}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    if (!codeSent) {
                      await sendPhoneOtp(phone);
                      setCodeSent(true);
                    } else {
                      onAuth(await verifyPhoneOtp(phone, code));
                    }
                  } catch {
                    setError(copy.errors.generic);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? copy.join.working : codeSent ? copy.join.verify : copy.join.sendCode}
              </button>
              <button
                type="button"
                className="room-btn"
                onClick={() => {
                  // Back to THIS room, not to a creator's studio. The path must
                  // also be on the Supabase redirect allow list; see
                  // studioAuth.googleSignIn for that dependency stated in full.
                  void googleSignIn(`/r/${room.room.slug}`).catch(() => setError(copy.errors.generic));
                }}
              >
                {copy.join.google}
              </button>
            </div>
          </>
        )}

        {auth && (
          <>
            <label className="room-check">
              <input type="checkbox" checked={age18} onChange={(e) => setAge18(e.target.checked)} />
              <span>{copy.join.age}</span>
            </label>
            <p className="room-fine">{copy.join.ageWhy}</p>

            {/* THE MEMORY QUESTION. Its own moment, its own words, asked once.
                Both answers are buttons of equal weight: a "no" that is a link
                under a "yes" is not an unbundled question. */}
            <h3>{copy.memory.title}</h3>
            <p className="room-lede">{copy.memory.lede}</p>
            <ul className="room-keeps">
              {copy.memory.keeps.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
            <p className="room-fine">
              {copy.memory.only} {withName(copy.memory.private, name)}{" "}
              {copy.memory.undo}
            </p>
            <div className="room-actions">
              <button
                type="button"
                className="room-btn primary"
                disabled={!age18 || busy}
                onClick={() => void finish(true)}
              >
                {copy.memory.yes}
              </button>
              <button
                type="button"
                className="room-btn"
                disabled={!age18 || busy}
                onClick={() => void finish(false)}
              >
                {copy.memory.no}
              </button>
            </div>
            {/* What "no" means, stated where "no" is chosen. */}
            <p className="room-note">{copy.memory.noMeans}</p>
          </>
        )}
      </section>
    </main>
  );
}

/* ── the data menu ──────────────────────────────────────────────────────── */

/* Download and delete, both scoped to this room and both saying so. The
 * download is built in the browser from the server's own JSON rather than
 * offered as a link, so there is no URL anywhere that returns one follower's
 * data to whoever holds it. */
function DataMenu({
  name,
  copy,
  session,
  auth,
  follower,
  onClose,
  onForgotten,
}: {
  name: string;
  copy: RoomCopy;
  session: string;
  auth: StudioSession | null;
  follower: RoomFollower | null;
  onClose: () => void;
  onForgotten: (receipt: RoomForgetReceipt | null) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // WS-R63: scrolls into view, moves focus in, closes on Escape (WS-R50's
  // own law, now this one hook's job rather than five ad hoc copies of it),
  // returns focus to the opener on close - `useDialogInView`'s own header.
  const dialogRef = useDialogInView(onClose);

  return (
    <section className="room-menu" role="dialog" aria-modal="true" aria-label={copy.menu.title} ref={dialogRef}>

      <h2>{copy.menu.title}</h2>
      {/* WS-R19: real numbers from the follower's own row, never estimated -
          law 5. Renders only for a paid follower with the flag on; a free
          follower's own copy of these fields is always 0 by construction
          (`clientFollower`), so there is nothing honest to show them here. */}
      {ROOM_VOICE_UI && follower?.tier === "paid" && (
        <p className="room-fine room-num">
          {copy.voice.minutesLeft
            .replace("{used}", String(Math.round(follower.voice_seconds_used / 60)))
            .replace("{included}", String(Math.round(follower.voice_seconds_included / 60)))}
        </p>
      )}
      {error && <p className="room-error">{error}</p>}
      <div className="room-actions">
        <button
          type="button"
          className="room-btn"
          disabled={busy || !auth}
          onClick={async () => {
            if (!auth) return;
            setBusy(true);
            try {
              const dump = await exportRoomData(session, auth.accessToken);
              const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "your-data.json";
              a.click();
              URL.revokeObjectURL(url);
            } catch {
              setError(copy.errors.generic);
            } finally {
              setBusy(false);
            }
          }}
        >
          {copy.menu.download}
        </button>
        <p className="room-fine">{copy.menu.downloadNote}</p>

        {!confirming ? (
          <button type="button" className="room-btn danger" onClick={() => setConfirming(true)}>
            {copy.menu.forget}
          </button>
        ) : (
          <>
            <p className="room-fine">{withName(copy.menu.forgetNote, name)}</p>
            <button
              type="button"
              className="room-btn danger"
              disabled={busy || !auth}
              onClick={async () => {
                if (!auth) return;
                setBusy(true);
                try {
                  const result = await forgetRoomData(session, auth.accessToken);
                  onForgotten(result.receipt ?? null);
                } catch {
                  setError(copy.errors.generic);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {copy.menu.forgetConfirm}
            </button>
            <button type="button" className="room-btn" onClick={() => setConfirming(false)}>
              {copy.menu.forgetCancel}
            </button>
          </>
        )}

        <button type="button" className="room-btn" onClick={onClose}>
          {copy.menu.close}
        </button>
      </div>
    </section>
  );
}

/** Exported for the layout fixture, which needs the stored session helper to
 *  stay a single implementation rather than a second one beside it. */
export { readStoredSession };
